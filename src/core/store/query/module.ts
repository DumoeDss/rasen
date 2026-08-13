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
 * did not reach, and marks the whole result incomplete. The mutation that
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
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
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
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
    };
  }

  // ---------------------------------------------------------------------------
  // Grouped Changes
  // ---------------------------------------------------------------------------

  async listChanges(input: ChangeQuery): Promise<GroupedChanges> {
    const context = await this.open(input);
    const groups = await this.collectGroups(context, input);
    return {
      groups,
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
    };
  }

  /**
   * The grouping. The key is a pair of VALIDATED identities carried in the
   * result, not something a consumer recovers from a path — which is why there
   * is no flat listing to regroup.
   *
   * A Change's group comes from its COMMITTED identity, never from the ref it
   * happened to be read on: a Change frozen against `line-0.2` that is also
   * reachable from `main` after a merge still belongs to `line-0.2`.
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
    return {
      issues: filtered,
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
    };
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
    return {
      issues: matched,
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
    };
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
          divergence: null,
          revisionIds: [],
          latestRevisionId: null,
          refs: [],
          uncommitted: false,
        },
        plan: null,
        unsearchedRefs: context.reader.unsearchedRefs,
        complete: context.reader.complete,
      };
    }
    const plan =
      issue.latestRevisionId === null
        ? null
        : await this.resolvePlanIn(context, input.issueId, issue.latestRevisionId);
    return {
      issue,
      plan,
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
    };
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
        unsearchedRefs: context.reader.unsearchedRefs,
        complete: context.reader.complete,
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
        unsearchedRefs: context.reader.unsearchedRefs,
        complete: context.reader.complete,
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
      unsearchedRefs: context.reader.unsearchedRefs,
      complete: context.reader.complete,
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
