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
  parseProjectId,
  parseTargetLineId,
  type ProjectId,
  type TargetLineId,
} from '../planning-validation.js';
import type { ExecutionPlanRevisionV1 } from '../issues/types.js';
import {
  productionStoreQueryDependencies,
  type StoreQueryDependencies,
} from './dependencies.js';
import {
  collectIssues,
  divergenceOf,
  presentedDiagnostic,
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

/** The Change alias an archive entry name carries, or the name when it carries none. */
function aliasFromArchiveEntryName(entryName: string): string {
  return ARCHIVE_ENTRY_PATTERN.exec(entryName)?.[1] ?? entryName;
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
      foundAtRef: candidate.foundAtRef,
    };
    const nameDate = ARCHIVE_DATE_PATTERN.exec(entryName)?.[1] ?? null;
    if (text === null) {
      return { ...base, archiveDate: nameDate, outcome: null, legacyRecord: true };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return { ...base, archiveDate: nameDate, outcome: null, legacyRecord: true };
    }
    if ((raw as { schemaVersion?: unknown } | null)?.schemaVersion !== 2) {
      return { ...base, archiveDate: nameDate, outcome: null, legacyRecord: true };
    }
    try {
      const record = validateArchiveV2(raw);
      return {
        ...base,
        archiveDate: record.archivedAt.slice(0, 10),
        outcome: record.outcome,
        legacyRecord: false,
      };
    } catch {
      return { ...base, archiveDate: nameDate, outcome: null, legacyRecord: true };
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
      const read = await readRevision(
        this.dependencies,
        context.reader,
        context.refs,
        context.store.registeredRoot,
        issue.issueId,
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
      context.store.registeredRoot
    );
    return contents.map(content => ({
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
    const issue = issues.find(candidate => candidate.issueId === input.issueId);
    if (issue === undefined) {
      return {
        issue: {
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
      issue.latestRevisionId === null
        ? null
        : await this.resolvePlanIn(context, input.issueId, issue.latestRevisionId);
    return { issue, plan, ...this.completeness(context) };
  }

  async resolveExecutionPlan(input: ExecutionPlanSelector): Promise<ResolvedExecutionPlan> {
    const context = await this.open(input);
    let revisionId = input.revisionId ?? null;
    if (revisionId === null) {
      const issues = await this.summaries(context);
      revisionId =
        issues.find(candidate => candidate.issueId === input.issueId)?.latestRevisionId ?? null;
    }
    if (revisionId === null) {
      return {
        issueId: input.issueId as ResolvedExecutionPlan['issueId'],
        revisionId: null,
        revision: null,
        diagnostic: null,
        readiness: { nodes: [], readyToResolve: false },
        ...this.completeness(context),
      };
    }
    return this.resolvePlanIn(context, input.issueId, revisionId);
  }

  private async resolvePlanIn(
    context: QueryContext,
    issueId: string,
    revisionId: string
  ): Promise<ResolvedExecutionPlan> {
    const read = await readRevision(
      this.dependencies,
      context.reader,
      context.refs,
      context.store.registeredRoot,
      issueId,
      revisionId
    );
    if (read.revision === null) {
      return {
        issueId: issueId as ResolvedExecutionPlan['issueId'],
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
      issueId: read.revision.issueId,
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
    revision: ExecutionPlanRevisionV1
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
