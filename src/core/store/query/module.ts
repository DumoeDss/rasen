/**
 * `StoreQueryModule` — the implementation.
 *
 * Every method here READS. There is no write path in this directory at all: the
 * filesystem adapter has no write method, the Git adapter has no writing verb,
 * and `test/core/store/store-query-read-only-guard.test.ts` fails if either
 * changes. Reading an Archive record treats it as passive data — no spec action
 * is applied, replayed, or re-derived.
 *
 * A query never ASSERTS a state it cannot prove. It reports the unproven as
 * unproven (`unresolved`, `ambiguous`, `divergent`), names the refs it did and
 * did not reach and the items it reached and could not read, and marks the
 * whole result incomplete. Nothing is ever dropped for being broken, and a
 * declared project or target line that holds nothing is reported present and
 * empty rather than omitted — an absent group and an empty one are different
 * answers. The mutation that
 * touches the same references — publishing a revision — refuses outright
 * instead. Same fail-closed invariant, two correct expressions, stated here so
 * whoever writes the next handler does not have to infer it.
 */
import { validateArchiveV2 } from '../finalization-v2.js';
import {
  parseIssueId,
  parseIssueStorageKey,
  parseIssueUid,
  parseProjectId,
  parseTargetLineId,
  type ProjectId,
  type TargetLineId,
} from '../planning-validation.js';
import type { StoredExecutionPlanRevision } from '../issues/types.js';
import {
  isStoreIssueError,
  resolveIssueSelector,
  type IssueIdentityCandidate,
  type ResolvedIssueIdentity,
} from '../issues/index.js';
import {
  productionStoreQueryDependencies,
  type StoreQueryDependencies,
} from './dependencies.js';
import {
  collectIssues,
  divergenceOf,
  presentedDiagnostic,
  presentedIdentity,
  presentedRecord,
  readRevision,
} from './issues-read.js';
import {
  archiveTreePath,
  listProjectEntries,
  listTargetLineEntries,
  RefReader,
  resolveQueryStore,
  resolveQueryStoreByUid,
  type CommittedChangeEvidence,
  type ProjectCatalogEntry,
  type ResolvedQueryStore,
  type StoreRefTarget,
  type TargetLineCatalogEntry,
} from './refs.js';
import {
  gatherReferenceEvidence,
  resolveChangeReference,
  type ReferenceEvidence,
} from './references.js';
import type {
  AggregateArchiveEntry,
  AggregateChangeEntry,
  AggregateCompleteness,
  ChangeGroup,
  ChangeQuery,
  ExecutionPlanSelector,
  FinalizationOutcomeName,
  GroupedChanges,
  IssueArchiveDelivery,
  IssueDetail,
  IssueQuery,
  IssueReadiness,
  IssueSelector,
  IssueSummary,
  IssueSummaryPage,
  PlanNodeReadiness,
  ProjectRollup,
  ProjectRollupEntry,
  ResolvedExecutionPlan,
  ResolvedPlanNode,
  StoreQuery,
  StoreQueryModule,
  TargetLineRollup,
  TargetLineRollupEntry,
} from './types.js';

const ARCHIVE_RECORD_FILENAME = 'archive.json';
const ARCHIVE_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})-/u;
/** `<YYYY-MM-DD>-<alias>--<instanceShort>`, or a legacy `<YYYY-MM-DD>-<alias>`. */
const ARCHIVE_ENTRY_PATTERN = /^\d{4}-\d{2}-\d{2}-(.+?)(?:--[0-9a-f]{6,64})?$/u;

function resolvedSummaryIdentity(issue: IssueSummary): ResolvedIssueIdentity | null {
  if (issue.identity === null || issue.record === null) return null;
  return {
    identity: issue.identity,
    storageKey: parseIssueStorageKey(
      issue.record.version === 1 ? issue.record.id : issue.record.identity.uid
    ),
    sourceVersion: issue.record.version,
  };
}

function summaryIdentityCandidates(
  issues: readonly IssueSummary[]
): readonly IssueIdentityCandidate[] {
  const candidates: IssueIdentityCandidate[] = [];
  for (const issue of issues) {
    const resolved = resolvedSummaryIdentity(issue);
    if (resolved !== null && issue.record !== null) {
      candidates.push({ ...resolved, title: issue.record.title });
      continue;
    }
    for (const copy of issue.divergence?.copies ?? []) {
      if (copy.identity !== null && copy.record !== null) {
        candidates.push({ ...copy.identity, title: copy.record.title });
      }
    }
  }
  return candidates;
}

function resolveSummarySelector(
  issues: readonly IssueSummary[],
  selector: string,
  complete: boolean
): IssueSummary | undefined {
  const uidText = selector.toLowerCase().startsWith('uid:') ? selector.slice(4) : selector;
  try {
    const uid = parseIssueUid(uidText);
    const authoritative = issues.find(issue => {
      if (issue.identity?.uid === uid) return true;
      return (issue.divergence?.copies ?? []).some(
        copy => copy.identity?.identity.uid === uid
      );
    });
    if (authoritative !== undefined) return authoritative;
  } catch {
    // Convenience selectors still require a complete catalog below so a
    // hidden ref can never turn an ambiguous alias into a guessed winner.
  }
  try {
    const selected = resolveIssueSelector({
      selector,
      candidates: summaryIdentityCandidates(issues),
      complete,
    });
    return issues.find(issue => {
      if (issue.identity?.uid === selected.identity.uid) return true;
      return (issue.divergence?.copies ?? []).some(
        copy => copy.identity?.identity.uid === selected.identity.uid
      );
    });
  } catch (error) {
    if (isStoreIssueError(error) && error.issueCode === 'issue_not_found') {
      // Preserve the aggregate query's report-not-throw contract for an
      // unreadable physical copy and for a genuinely absent selector.
      return issues.find(issue => issue.identity === null && issue.issueId === selector);
    }
    throw error;
  }
}

/** The Change alias an archive entry name carries, or the name when it carries none. */
function aliasFromArchiveEntryName(entryName: string): string {
  return ARCHIVE_ENTRY_PATTERN.exec(entryName)?.[1] ?? entryName;
}

/**
 * A v1 ledger scalar, read defensively: the ledger shape has no schema (it is
 * the v1 writer's output), so a field that is absent or not a string reads as
 * its named absence `null` — never repaired, never defaulted. The legacy basis
 * already says "unvalidated"; this keeps the delivery facts equally honest.
 */
function ledgerString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * A v1 ledger string array, read defensively: `null` when the field is absent
 * or not an array (no inventory was recorded — a different truth than the
 * empty array a present field froze); only string members contribute facts.
 */
function ledgerStrings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * A v1 ledger evidence inventory, read defensively under the same rule as
 * `ledgerStrings`: `null` for an absent or non-array field, and only entries
 * of the `{ path, sha256 }` string shape contribute facts.
 */
function ledgerEvidence(value: unknown): IssueArchiveDelivery['evidence'] {
  if (!Array.isArray(value)) return null;
  const entries = value.filter(
    (entry): entry is { path: string; sha256: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { path?: unknown }).path === 'string' &&
      typeof (entry as { sha256?: unknown }).sha256 === 'string'
  );
  return entries.map(entry => ({ path: entry.path, sha256: entry.sha256 }));
}

interface QueryContext {
  readonly store: ResolvedQueryStore;
  readonly reader: RefReader;
  readonly refs: readonly StoreRefTarget[];
  readonly targetLines: readonly TargetLineCatalogEntry[];
  readonly projects: readonly ProjectCatalogEntry[];
  readonly projectIds: readonly string[];
}

export interface StoreQueryOptions {
  readonly dependencies?: StoreQueryDependencies;
  /**
   * How `input.store` is interpreted.
   *
   * `selector` (the default) is the CLI's contract: a display name OR a stable
   * identity, the same operand every other Store command accepts. `uid` is the
   * management API's: the Store's STABLE IDENTITY and nothing else, because a
   * `store:<id>` space selector carries the Store's local registry id, and
   * accepting both there would resolve the wrong Store on any machine with more
   * than one. Making it an instance property rather than a per-call flag means
   * the API's client cannot forget it on one route.
   */
  readonly addressBy?: 'selector' | 'uid';
}

export class StoreQueryModuleImpl implements StoreQueryModule {
  private readonly dependencies: StoreQueryDependencies;
  private readonly addressBy: 'selector' | 'uid';

  constructor(options: StoreQueryOptions = {}) {
    this.dependencies = options.dependencies ?? productionStoreQueryDependencies;
    this.addressBy = options.addressBy ?? 'selector';
  }

  /**
   * Opens one query's context. Called once per public method, so every memo in
   * `RefReader` lives exactly as long as the call that created it and nothing
   * survives to be invalidated later.
   */
  private async open(input: StoreQuery): Promise<QueryContext> {
    const store =
      this.addressBy === 'uid'
        ? await resolveQueryStoreByUid(this.dependencies, {
            storeUid: input.store ?? '',
            ...(input.globalDataDir === undefined
              ? {}
              : { globalDataDir: input.globalDataDir }),
          })
        : await resolveQueryStore(this.dependencies, {
            ...(input.store === undefined ? {} : { store: input.store }),
            ...(input.globalDataDir === undefined
              ? {}
              : { globalDataDir: input.globalDataDir }),
          });
    const targetLines = await listTargetLineEntries(this.dependencies, store.registeredRoot);
    const projects = await listProjectEntries(this.dependencies, store.registeredRoot);
    const reader = new RefReader(this.dependencies, store.registeredRoot);
    const refs: StoreRefTarget[] = [];
    for (const entry of targetLines) {
      if (entry.catalog === null) {
        // An unparsable catalog names no ref this query can search. Reporting
        // it as unsearched is what keeps its Changes from reading as absent.
        reader.markUnsearched(
          { targetLineId: entry.targetLineId, storeRef: `(catalog ${entry.path})` },
          'the target-line catalog does not validate, so its Store ref is unknown'
        );
        continue;
      }
      refs.push({ targetLineId: entry.catalog.id, storeRef: entry.catalog.storeRef });
    }
    return {
      store,
      reader,
      refs,
      targetLines,
      projects,
      projectIds: projects.map(entry => entry.projectId),
    };
  }

  /**
   * The completeness block every result carries, taken from the one reader
   * that did the reading.
   *
   * Built in a single place so no method can report a ref it could not search
   * and quietly forget an item it could not read, or the other way round:
   * `complete` is false for either, and both lists travel with it.
   */
  private completeness(context: QueryContext): AggregateCompleteness {
    return {
      unsearchedRefs: context.reader.unsearchedRefs,
      problems: context.reader.problems,
      complete: context.reader.complete,
    };
  }

  // ---------------------------------------------------------------------------
  // Rollups
  // ---------------------------------------------------------------------------

  async listProjects(input: StoreQuery): Promise<ProjectRollup> {
    const context = await this.open(input);
    const changes = await this.collectGroups(context, {});
    const projects: ProjectRollupEntry[] = context.projects.map(entry => {
      const groups = changes.filter(group => group.projectId === entry.projectId);
      return {
        projectId: entry.projectId,
        roles: entry.catalog === null ? null : { ...entry.catalog.roles },
        diagnostic: entry.diagnostic,
        targetLines: context.targetLines
          .filter(line => line.catalog?.projects[entry.projectId] !== undefined)
          .map(line => line.targetLineId),
        activeChangeCount: groups.reduce((total, group) => total + group.active.length, 0),
        archivedChangeCount: groups.reduce(
          (total, group) => total + group.archived.length,
          0
        ),
      };
    });
    return {
      storeId: context.store.storeId,
      storeUid: context.store.storeUid,
      projects,
      ...this.completeness(context),
    };
  }

  async listTargetLines(input: StoreQuery): Promise<TargetLineRollup> {
    const context = await this.open(input);
    const changes = await this.collectGroups(context, {});
    const targetLines: TargetLineRollupEntry[] = context.targetLines.map(entry => {
      const groups = changes.filter(group => group.targetLineId === entry.targetLineId);
      return {
        targetLineId: entry.targetLineId,
        storeRef: entry.catalog?.storeRef ?? null,
        diagnostic: entry.diagnostic,
        projects: entry.catalog === null ? [] : Object.keys(entry.catalog.projects).sort(),
        activeChangeCount: groups.reduce((total, group) => total + group.active.length, 0),
        archivedChangeCount: groups.reduce(
          (total, group) => total + group.archived.length,
          0
        ),
      };
    });
    return {
      storeId: context.store.storeId,
      storeUid: context.store.storeUid,
      targetLines,
      ...this.completeness(context),
    };
  }

  // ---------------------------------------------------------------------------
  // Grouped Changes
  // ---------------------------------------------------------------------------

  async listChanges(input: ChangeQuery): Promise<GroupedChanges> {
    const context = await this.open(input);
    const groups = await this.collectGroups(context, input);
    return { groups, ...this.completeness(context) };
  }

  /**
   * The grouping. The key is a pair of VALIDATED identities carried in the
   * result, not something a consumer recovers from a path — which is why there
   * is no flat listing to regroup.
   *
   * A Change's group comes from its COMMITTED identity, never from the ref it
   * happened to be read on: a Change frozen against `line-0.2` that is also
   * reachable from `main` after a merge still belongs to `line-0.2`.
   *
   * The GROUP SET is the declared (project, target line) matrix plus any pair
   * committed evidence names, so an empty declared pair is present and empty
   * and an unexpected pair is never dropped for being undeclared.
   */
  private async collectGroups(
    context: QueryContext,
    filters: {
      readonly projects?: readonly string[];
      readonly targetLines?: readonly string[];
      readonly outcomes?: readonly FinalizationOutcomeName[];
      readonly state?: 'active' | 'archived';
    }
  ): Promise<readonly ChangeGroup[]> {
    const projectFilter = filters.projects === undefined ? null : new Set(filters.projects);
    const lineFilter = filters.targetLines === undefined ? null : new Set(filters.targetLines);
    const outcomeFilter = filters.outcomes === undefined ? null : new Set(filters.outcomes);

    const evidence = await gatherReferenceEvidence(this.dependencies, {
      reader: context.reader,
      refs: context.refs,
      projectIds: context.projectIds,
      storeUid: context.store.storeUid,
    });

    const buckets = new Map<
      string,
      { active: AggregateChangeEntry[]; archived: AggregateArchiveEntry[] }
    >();
    // The composite bucket key joins the two identities with NUL, the one
    // character neither a project id nor a target-line id can contain. A
    // printable separator ('/', ':', '-') appears in real target-line ids
    // and would make two different pairs collide on one group. It is written
    // as the ESCAPE rather than a raw byte: a raw NUL makes Git classify the
    // whole file as binary, which costs the diff and every whitespace gate.
    const bucketFor = (projectId: string, targetLineId: string) => {
      const key = `${projectId}\0${targetLineId}`;
      const existing = buckets.get(key);
      if (existing !== undefined) return existing;
      const created = { active: [] as AggregateChangeEntry[], archived: [] as AggregateArchiveEntry[] };
      buckets.set(key, created);
      return created;
    };

    // Every DECLARED (project, target line) pair, bucketed BEFORE any evidence
    // is placed, so a pair that holds no Change is reported present and empty
    // rather than omitted. Iterating found evidence alone can only ever emit a
    // group somebody already put a Change in, which makes "this project has
    // nothing" and "this project does not exist" the same answer.
    //
    // The pairs come from the target-line catalogs, the only declaration of
    // which projects live on which line — the same relation `listProjects`
    // reports as a project's `targetLines`, so the two surfaces cannot
    // disagree about what exists. Two exclusions, both because an empty group
    // is a claim that somebody looked:
    //
    //   - a line whose ref could not be READ seeds nothing. Its Changes are
    //     unknown, not absent; the ref is in `unsearchedRefs` and the result
    //     is incomplete.
    //   - a project the line names but the Store has no catalog for seeds
    //     nothing either, because `collectCommittedChanges` only searches the
    //     projects the Store declares, so nobody looked there.
    //
    // The entry filters (`state`, `outcomes`) deliberately do NOT narrow this:
    // they select which ENTRIES populate a group, not which groups exist.
    const searchedRefs = new Set(context.reader.searchedRefs);
    const declaredProjects = new Set(context.projectIds);
    for (const line of context.targetLines) {
      if (line.catalog === null || !searchedRefs.has(line.catalog.storeRef)) continue;
      if (lineFilter !== null && !lineFilter.has(line.catalog.id)) continue;
      for (const projectId of Object.keys(line.catalog.projects)) {
        if (!declaredProjects.has(projectId)) continue;
        if (projectFilter !== null && !projectFilter.has(projectId)) continue;
        bucketFor(projectId, line.catalog.id);
      }
    }

    for (const candidate of evidence.committed) {
      if (projectFilter !== null && !projectFilter.has(candidate.projectId)) continue;
      if (lineFilter !== null && !lineFilter.has(candidate.targetLineId)) continue;
      if (candidate.archived) {
        if (filters.state === 'active') continue;
        const archive = await this.readArchiveEntry(context, candidate);
        if (outcomeFilter !== null && (archive.outcome === null || !outcomeFilter.has(archive.outcome))) {
          continue;
        }
        bucketFor(candidate.projectId, candidate.targetLineId).archived.push(archive);
        continue;
      }
      if (filters.state === 'archived') continue;
      // An outcome filter is a filter on FINALIZED state; an active Change has
      // no outcome and is therefore excluded rather than reported as null.
      if (outcomeFilter !== null) continue;
      const local = evidence.localWorkspaces.find(
        entry => entry.changeInstanceId === candidate.changeInstanceId
      );
      bucketFor(candidate.projectId, candidate.targetLineId).active.push({
        changeId: candidate.changeId,
        changeInstanceId: candidate.changeInstanceId,
        projectId: candidate.projectId,
        targetLineId: candidate.targetLineId,
        foundAtRef: candidate.foundAtRef,
        localLocator:
          local === undefined
            ? null
            : { root: local.planning.root, kind: 'planning-worktree', portable: false },
      });
    }

    const groups: ChangeGroup[] = [];
    for (const [key, bucket] of [...buckets.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const [rawProject, rawLine] = key.split('\0') as [string, string];
      let projectId: ProjectId;
      let targetLineId: TargetLineId;
      try {
        projectId = parseProjectId(rawProject);
        targetLineId = parseTargetLineId(rawLine);
      } catch {
        // A committed identity whose ids do not validate cannot key a group
        // without inventing a key. It is skipped here and surfaces through the
        // catalog diagnostics the rollups already report.
        continue;
      }
      groups.push({
        projectId,
        targetLineId,
        active: bucket.active.sort((left, right) =>
          left.changeId.localeCompare(right.changeId)
        ),
        archived: bucket.archived.sort((left, right) =>
          left.entryName.localeCompare(right.entryName)
        ),
      });
    }
    return groups;
  }

  /**
   * Reads one archived entry's accounting record as DATA.
   *
   * A relocated legacy v1 record found in a v2 partition reports no outcome and
   * is marked as legacy. Nothing is inferred, defaulted, or upgraded: inventing
   * `landed` to fill a column is exactly the lie the four-outcome model exists
   * to prevent, and child 5 keeps such entries byte-identical on purpose.
   *
   * The record BASIS (issue-ready-set-scheduling D4) is recorded beside the
   * display facts, machine-facing: the two pre-v2 shapes (no record, or a
   * non-schemaVersion-2 document) are `legacy`; bytes that exist in v2 shape
   * but do not parse or validate are `invalid` — damaged evidence, never a
   * legacy truth. `legacyRecord`'s display semantics are unchanged: it stays
   * collapsed over all four null-outcome branches exactly as before.
   *
   * The DELIVERY block (issue-delivery-evidence-rollup D2) rides the same one
   * read: the parsed record's delivery facts (a v1 ledger defensively, a
   * validated v2 record mapped verbatim), or `null` when the record was absent
   * or damaged — no second blob read, no fact the record does not carry.
   */
  private async readArchiveEntry(
    context: QueryContext,
    candidate: CommittedChangeEvidence
  ): Promise<AggregateArchiveEntry> {
    const entryName = candidate.archiveEntryName ?? candidate.changeId;
    const blobPath = `${archiveTreePath(candidate.projectId)}/${
      candidate.archiveLineId ?? candidate.targetLineId
    }/${entryName}/${ARCHIVE_RECORD_FILENAME}`;
    const text = await context.reader.blob(candidate.foundAtRef, blobPath);
    const base = {
      // The ALIAS, recovered from the entry name. Identity already came from the
      // committed metadata; an alias is a name by definition, so reading it from
      // the name it is printed in is not the identity-from-a-path move the
      // layout rules forbid — and a card that showed
      // `2026-08-07-telemetry-emit--94344b6993d4` where the reader expects
      // `telemetry-emit` would be unreadable.
      changeId: aliasFromArchiveEntryName(entryName),
      changeInstanceId: candidate.changeInstanceId,
      projectId: candidate.projectId,
      targetLineId: candidate.targetLineId,
      entryName,
      outcomeBasisPath: blobPath,
      foundAtRef: candidate.foundAtRef,
    };
    const nameDate = ARCHIVE_DATE_PATTERN.exec(entryName)?.[1] ?? null;
    if (text === null) {
      return {
        ...base,
        archiveDate: nameDate,
        outcome: null,
        legacyRecord: true,
        outcomeBasis: 'legacy',
        outcomeBasisReason: null,
        // The entry carries no archive record at all: no delivery facts exist
        // to extract, and null names exactly that (the projection's
        // `no-record` state; the `legacy` basis is what distinguishes it from
        // damaged bytes).
        delivery: null,
      };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      return {
        ...base,
        archiveDate: nameDate,
        outcome: null,
        legacyRecord: true,
        outcomeBasis: 'invalid',
        outcomeBasisReason: `archive.json is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
        delivery: null,
      };
    }
    if ((raw as { schemaVersion?: unknown } | null)?.schemaVersion !== 2) {
      const ledger = (raw ?? {}) as Record<string, unknown>;
      return {
        ...base,
        archiveDate: nameDate,
        outcome: null,
        legacyRecord: true,
        outcomeBasis: 'legacy',
        outcomeBasisReason: null,
        // The v1 ledger's delivery facts, each field its own spelling read
        // defensively: absent or wrongly typed reads as the named absence
        // `null`, never repaired. The outcome is null by construction — the
        // legacy basis predates v2 outcome records, and the absence is the
        // record's own statement.
        delivery: {
          basis: 'legacy',
          archivedAt: ledgerString(ledger.archivedAt),
          codeCommit: ledgerString(ledger.codeCommit),
          planningBranch: ledgerString(ledger.planningBranch),
          outcome: null,
          evidence: ledgerEvidence(ledger.evidence),
          missing: ledgerStrings(ledger.missing),
          entryName,
          foundAtRef: candidate.foundAtRef,
          blobPath,
        },
      };
    }
    try {
      const record = validateArchiveV2(raw);
      return {
        ...base,
        archiveDate: record.archivedAt.slice(0, 10),
        outcome: record.outcome,
        legacyRecord: false,
        outcomeBasis: 'v2',
        outcomeBasisReason: null,
        // The validated v2 record's delivery facts, mapped per the
        // issue-delivery-evidence contract: `codeMerge.commit` (null is the
        // record's own no-merge absence), the full `planning.sourceRef`, the
        // outcome, and the frozen inventory — each verbatim.
        delivery: {
          basis: 'v2',
          archivedAt: record.archivedAt,
          codeCommit: record.codeMerge === null ? null : record.codeMerge.commit,
          planningBranch: record.planning.sourceRef,
          outcome: record.outcome,
          evidence: record.evidence.map(entry => ({
            path: entry.path,
            sha256: entry.sha256,
          })),
          missing: [...record.missing],
          entryName,
          foundAtRef: candidate.foundAtRef,
          blobPath,
        },
      };
    } catch (error) {
      return {
        ...base,
        archiveDate: nameDate,
        outcome: null,
        legacyRecord: true,
        outcomeBasis: 'invalid',
        outcomeBasisReason: `schemaVersion-2 record failed validation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        // Damaged bytes derive no delivery facts — the standing
        // `invalid-archive-record` problem stays authoritative.
        delivery: null,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------

  async listIssues(input: IssueQuery): Promise<IssueSummaryPage> {
    const context = await this.open(input);
    const issues = await this.summaries(context);
    const filtered =
      input.state === undefined
        ? issues
        : issues.filter(issue => issue.record?.state === input.state);
    return { issues: filtered, ...this.completeness(context) };
  }

  async issuesReferencing(
    input: StoreQuery & { readonly changeInstanceId: string }
  ): Promise<IssueSummaryPage> {
    const context = await this.open(input);
    const issues = await this.summaries(context);
    const matched: IssueSummary[] = [];
    for (const issue of issues) {
      if (issue.latestRevisionId === null) continue;
      const owner = resolvedSummaryIdentity(issue);
      if (owner === null) {
        const copy = issue.divergence?.copies[0];
        context.reader.recordProblem({
          kind: 'issue',
          itemId: issue.issueId,
          storeRef: copy?.storeRef ?? null,
          path: `rasen/issues/${String(copy?.storageKey ?? issue.issueId)}/issue.yaml`,
          reason:
            issue.divergence === null
              ? `Issue identity is unreadable; Execution Plan revision '${issue.latestRevisionId}' cannot be checked for Change references.`
              : `Issue records diverge; Execution Plan revision '${issue.latestRevisionId}' has no coherent owner for Change-reference resolution.`,
        });
        continue;
      }
      const read = await readRevision(
        this.dependencies,
        context.reader,
        context.refs,
        context.store.registeredRoot,
        owner,
        issue.latestRevisionId
      );
      const references = (read.revision?.nodes ?? []).some(
        node => node.kind === 'change' && node.changeInstanceId === input.changeInstanceId
      );
      if (references) matched.push(issue);
    }
    return { issues: matched, ...this.completeness(context) };
  }

  private async summaries(context: QueryContext): Promise<readonly IssueSummary[]> {
    const contents = await collectIssues(
      this.dependencies,
      context.reader,
      context.refs,
      context.store.registeredRoot,
      context.store.storeUid
    );
    return contents.map(content => ({
      identity: presentedIdentity(content.copies),
      issueId: content.issueId,
      record: presentedRecord(content.copies),
      // The reason the record is null, carried on the ITEM. `collectIssues`
      // has already reported the same failure as a result-level problem; both
      // exist because a caller reading one Issue's summary should not have to
      // search a Store-wide list to learn why its record is missing.
      diagnostic: presentedDiagnostic(content.copies),
      divergence: divergenceOf(content.copies),
      revisionIds: content.revisionIds,
      latestRevisionId: content.revisionIds.at(-1) ?? null,
      refs: content.copies
        .map(copy => copy.storeRef)
        .filter((ref): ref is string => ref !== null)
        .sort(),
      uncommitted:
        content.copies.length > 0 && content.copies.every(copy => copy.storeRef === null),
    }));
  }

  async showIssue(input: IssueSelector): Promise<IssueDetail> {
    const context = await this.open(input);
    const issues = await this.summaries(context);
    const issue = resolveSummarySelector(issues, input.issueId, context.reader.complete);
    if (issue === undefined) {
      return {
        issue: {
          identity: null,
          issueId: input.issueId,
          record: null,
          diagnostic: null,
          divergence: null,
          revisionIds: [],
          latestRevisionId: null,
          refs: [],
          uncommitted: false,
        },
        plan: null,
        ...this.completeness(context),
      };
    }
    const plan =
      issue.latestRevisionId === null || resolvedSummaryIdentity(issue) === null
        ? null
        : await this.resolvePlanIn(context, issue, issue.latestRevisionId);
    return { issue, plan, ...this.completeness(context) };
  }

  async resolveExecutionPlan(input: ExecutionPlanSelector): Promise<ResolvedExecutionPlan> {
    const context = await this.open(input);
    let revisionId = input.revisionId ?? null;
    const issues = await this.summaries(context);
    const issue = resolveSummarySelector(issues, input.issueId, context.reader.complete);
    if (revisionId === null) {
      revisionId = issue?.latestRevisionId ?? null;
    }
    if (revisionId === null || issue === undefined) {
      return {
        issueId: input.issueId as ResolvedExecutionPlan['issueId'],
        revisionId: null,
        revision: null,
        diagnostic: null,
        readiness: { nodes: [], readyToResolve: false },
        ...this.completeness(context),
      };
    }
    return this.resolvePlanIn(context, issue, revisionId);
  }

  private async resolvePlanIn(
    context: QueryContext,
    issue: IssueSummary,
    revisionId: string
  ): Promise<ResolvedExecutionPlan> {
    const owner = resolvedSummaryIdentity(issue);
    if (owner === null) {
      return {
        issueId: issue.issueId as ResolvedExecutionPlan['issueId'],
        revisionId: revisionId as ResolvedExecutionPlan['revisionId'],
        revision: null,
        diagnostic: 'Issue record identity is unreadable or divergent; no storage copy can be selected.',
        readiness: { nodes: [], readyToResolve: false },
        ...this.completeness(context),
      };
    }
    const read = await readRevision(
      this.dependencies,
      context.reader,
      context.refs,
      context.store.registeredRoot,
      owner,
      revisionId
    );
    if (read.revision === null) {
      return {
        issueId: issue.issueId as ResolvedExecutionPlan['issueId'],
        revisionId: revisionId as ResolvedExecutionPlan['revisionId'],
        revision: null,
        diagnostic: read.diagnostic,
        readiness: { nodes: [], readyToResolve: false },
        ...this.completeness(context),
      };
    }
    const evidence = await gatherReferenceEvidence(this.dependencies, {
      reader: context.reader,
      refs: context.refs,
      projectIds: context.projectIds,
      storeUid: context.store.storeUid,
    });
    const readiness = await this.deriveReadiness(context, evidence, read.revision);
    return {
      issueId: parseIssueId(issue.issueId),
      revisionId: read.revision.revisionId,
      revision: read.revision,
      diagnostic: null,
      readiness,
      ...this.completeness(context),
    };
  }

  /**
   * Readiness, DERIVED and reported. Nothing here writes: not the Issue record,
   * not the revision, not a referenced Change. An Issue is never auto-resolved
   * by its graph — `readyToResolve` informs an operator who still has to
   * declare the state.
   */
  private async deriveReadiness(
    context: QueryContext,
    evidence: ReferenceEvidence,
    revision: StoredExecutionPlanRevision
  ): Promise<IssueReadiness> {
    const resolutions = new Map<string, ResolvedPlanNode>();
    for (const node of revision.nodes) {
      if (node.kind === 'intent') {
        resolutions.set(node.nodeId, {
          node,
          resolution: {
            status: 'not-created',
            claimants: [],
            searchedRefs: context.reader.searchedRefs,
            localLocator: null,
            outcome: null,
            archived: false,
          },
          readiness: 'not-started',
          blockedBy: [],
        });
        continue;
      }
      const resolved = resolveChangeReference(evidence, node.changeInstanceId);
      if (resolved.status === 'resolved') {
        const found = resolved.evidence;
        const archive =
          found !== null && found.archived ? await this.readArchiveEntry(context, found) : null;
        // A committed identity that names a DIFFERENT project or line than the
        // node declared is a scope conflict. A read reports it as ambiguous
        // with both claimants rather than silently preferring either side; the
        // mutation path refuses it outright with `issue_reference_scope_conflict`.
        const conflict =
          found !== null &&
          (found.projectId !== node.projectId || found.targetLineId !== node.targetLineId);
        resolutions.set(node.nodeId, {
          node,
          resolution: {
            status: conflict ? 'ambiguous' : 'resolved',
            claimants: resolved.claimants,
            searchedRefs: context.reader.searchedRefs,
            localLocator: resolved.localLocator,
            outcome: archive?.outcome ?? null,
            archived: found?.archived ?? false,
            // The record basis rides beside the outcome facts (additive,
            // machine-facing): the projection's finalized ruling reads it, the
            // query's own readiness stays archive-outcome based exactly as
            // before — the two-bases-by-design split. The delivery block
            // threads the same way: present whenever a record was consulted,
            // null when its bytes were absent or damaged.
            ...(archive === null
              ? {}
              : {
                  outcomeBasis: archive.outcomeBasis,
                  outcomeBasisReason: archive.outcomeBasisReason,
                  outcomeBasisPath: archive.outcomeBasisPath,
                  delivery: archive.delivery,
                }),
          },
          readiness: conflict
            ? 'unknown'
            : archive !== null && archive.outcome !== null
              ? 'finalized'
              : 'in-progress',
          blockedBy: [],
        });
        continue;
      }
      resolutions.set(node.nodeId, {
        node,
        resolution: {
          status: resolved.status,
          claimants: resolved.claimants,
          searchedRefs: context.reader.searchedRefs,
          localLocator: null,
          outcome: null,
          archived: false,
        },
        readiness: 'unknown',
        blockedBy: [],
      });
    }

    const nodes: ResolvedPlanNode[] = revision.nodes.map(node => {
      const current = resolutions.get(node.nodeId) as ResolvedPlanNode;
      const blockedBy = node.dependsOn.filter(
        dependency => resolutions.get(dependency)?.readiness !== 'finalized'
      );
      if (current.readiness === 'finalized' || blockedBy.length === 0) {
        return { ...current, blockedBy };
      }
      return { ...current, readiness: 'blocked' as PlanNodeReadiness, blockedBy };
    });

    return {
      nodes,
      readyToResolve:
        nodes.length > 0 &&
        context.reader.complete &&
        nodes.every(entry => entry.readiness === 'finalized'),
    };
  }
}

/** The sole production aggregate query Module, addressed the way the CLI does. */
export const StoreAggregateQuery: StoreQueryModule = new StoreQueryModuleImpl();

/**
 * The management API's Module: the same implementation, addressing its Store by
 * stable identity only.
 */
export function createStoreQueryByUid(
  options: Omit<StoreQueryOptions, 'addressBy'> = {}
): StoreQueryModule {
  return new StoreQueryModuleImpl({ ...options, addressBy: 'uid' });
}
