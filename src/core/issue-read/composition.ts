/**
 * `issue-read-surface` design D1 — ONE composition, two callers.
 *
 * The Issue read surface (list-with-status, one Issue's full projection read,
 * the Store-wide attention scan) was assembled inline inside two CLI commands.
 * Serving the same reads over HTTP would have made the daemon a third
 * assembly of the same ordered inputs — and the ordered input gathering is
 * exactly where silent drift lives: a forgotten `predecessorPlan` yields
 * `delta: null` with no error, a forgotten `acceptance` yields a `done` Issue
 * that never reads done. So the assembly moved DOWN here, and both callers
 * compose through the same functions. Parity between the command line and the
 * API is then a property of construction, not a property two code paths have
 * to keep agreeing about.
 *
 * The payload types below ARE the CLI's `--json` bodies, named. Their key
 * order is load-bearing: `printJson` serializes insertion order, so each
 * compose function builds its object literal in the order the CLI has always
 * printed. The existing CLI suites pin those bytes across this extraction.
 *
 * Nothing here writes, locks, or caches. Every call re-derives from committed
 * Store evidence plus whatever machine-local run-state the supplied
 * {@link IssueRunStateContext} makes visible (design D4: an absent execution
 * root degrades to committed evidence only, disclosed as
 * `runStateVisibility: { kind: 'none' }`, never fabricated).
 */
import { StoreError } from '../store/errors.js';
import {
  listProjectEntries,
  nodeStoreQueryFileSystem,
  productionStoreQueryDependencies,
  resolveQueryStore,
  type AggregateProblem,
  type IssueDetail,
  type IssueSummary,
  type IssueSummaryPage,
  type ResolvedExecutionPlan,
  type StoreQueryModule,
  type UnsearchedRef,
} from '../store/query/index.js';
import type { IssueState } from '../store/issues/types.js';
import {
  listAllWorkspaceIndexEntries,
  type WorkspaceIndexEntry,
} from '../store/workspace/registry.js';
import {
  ISSUE_ATTENTION_KIND_ORDER,
  deriveIssueAttention,
  deriveIssueDeliveryEvidence,
  deriveIssueReview,
  issueAttentionKindRank,
  projectIssueStatus,
  type IssueAttentionItem,
  type IssueAttentionKind,
  type IssueDeliveryEvidence,
  type IssueHealth,
  type IssuePhase,
  type IssueReview,
  type IssueRunStateVisibility,
  type IssueStatus,
  type ProjectIssueStatusInput,
} from '../issue-status/index.js';
import { readIssueAcceptanceFacts } from '../issue-acceptance/index.js';
import type { IssueRunStateContext } from './run-context.js';

// -----------------------------------------------------------------------------
// Scope
// -----------------------------------------------------------------------------

/**
 * The Store scope every read here is taken through — the `StoreQuery` shape,
 * narrowed to what a read needs. The CLI supplies the operator's `--store` and
 * working directory; the daemon supplies the resolved Store's stable uid and
 * an inert `startPath` (its uid-addressed query never reads one).
 */
export interface IssueReadScope {
  readonly store?: string;
  readonly startPath: string;
}

/** The scope fields spread into a query input, with `store` omitted when absent. */
function scopeInput(scope: IssueReadScope): { store?: string; startPath: string } {
  return {
    ...(scope.store === undefined ? {} : { store: scope.store }),
    startPath: scope.startPath,
  };
}

// -----------------------------------------------------------------------------
// Payload types — the CLI `--json` bodies, named
// -----------------------------------------------------------------------------

/** One Issue of the list read: its summary with the status projected over it. */
export type IssueProjectionListEntry = IssueSummary & { readonly status: IssueStatus };

/** `store issue list --json` / `GET /api/v1/stores/issue-projections`. */
export interface IssueProjectionListPayload {
  readonly issues: readonly IssueProjectionListEntry[];
  readonly complete: boolean;
  readonly unsearchedRefs: readonly UnsearchedRef[];
  readonly problems: readonly AggregateProblem[];
}

/** `store issue show --json` / `GET /api/v1/stores/issue-projection`. */
export interface IssueProjectionDetailPayload {
  readonly issue: IssueSummary;
  readonly plan: ResolvedExecutionPlan | null;
  readonly status: IssueStatus;
  /** Null exactly when no readable revision derived a rollup. */
  readonly delivery: IssueDeliveryEvidence | null;
  readonly review: IssueReview;
  readonly complete: boolean;
  readonly unsearchedRefs: readonly UnsearchedRef[];
  readonly problems: readonly AggregateProblem[];
}

/** One scanned Issue's roll facts — what keeps "honestly unlisted" visible. */
export interface StoreAttentionScanEntry {
  readonly issueId: string;
  readonly phase: IssuePhase;
  readonly health: IssueHealth;
  readonly itemCount: number;
  readonly runStateVisibility: IssueRunStateVisibility;
}

/** `store attention --json` / `GET /api/v1/stores/issue-attention`. */
export interface StoreAttentionPayload {
  readonly narrowed: boolean;
  readonly issueId: string | null;
  readonly scannedCount: number;
  readonly scanned: readonly StoreAttentionScanEntry[];
  readonly items: readonly IssueAttentionItem[];
  readonly counts: Record<IssueAttentionKind, number>;
  readonly total: number;
  readonly unsearchedRefs: readonly UnsearchedRef[];
  readonly complete: boolean;
}

// -----------------------------------------------------------------------------
// The moved seams (from `src/commands/store-issue.ts`)
// -----------------------------------------------------------------------------

export function statusInputFor(
  detail: IssueDetail,
  context: {
    executionRoot?: string;
    changesDir?: string;
    storeRoot?: string;
    workspaceEntries?: readonly WorkspaceIndexEntry[];
    projectAliases?: Readonly<Record<string, string>>;
    acceptance?: Awaited<ReturnType<typeof readIssueAcceptanceFacts>>;
    predecessorPlan?: ResolvedExecutionPlan | null;
  }
): ProjectIssueStatusInput {
  return {
    detail,
    ...(context.executionRoot === undefined ? {} : { executionRoot: context.executionRoot }),
    ...(context.changesDir === undefined ? {} : { changesDir: context.changesDir }),
    ...(context.storeRoot === undefined ? {} : { storeRoot: context.storeRoot }),
    ...(context.workspaceEntries === undefined ? {} : { workspaceEntries: context.workspaceEntries }),
    ...(context.projectAliases === undefined ? {} : { projectAliases: context.projectAliases }),
    ...(context.acceptance === undefined ? {} : { acceptance: context.acceptance }),
    ...(context.predecessorPlan === undefined ? {} : { predecessorPlan: context.predecessorPlan }),
  };
}

/**
 * The predecessor revision the latest revision's `supersedes` names, when the
 * plan carries one — resolved with the SAME query the latest revision read
 * through, so the revision delta derives from two digest-verified reads. A
 * first revision (or an unreadable predecessor) contributes null, which the
 * projection reads as "no delta section".
 */
export async function resolvePredecessorPlan(
  query: StoreQueryModule,
  scope: IssueReadScope,
  issueId: string,
  supersedes: string | null
): Promise<ResolvedExecutionPlan | null> {
  if (supersedes === null) return null;
  return query.resolveExecutionPlan({
    ...scopeInput(scope),
    issueId,
    revisionId: supersedes,
  });
}

/**
 * The Store-scoped widening inputs, gathered ONCE per read: the resolved
 * Store's registered root (the store-side active-change address for evidence
 * locators), the machine workspace index entries filtered to that Store's
 * uid — exactly the storeUid-first filter `gatherReferenceEvidence` applies,
 * so an index entry from another Store can never masquerade as this one's —
 * and the display aliases read from the Store's own project catalogs (the
 * catalog display `id` when one resolves; display-only composition, never a
 * guess — grouping, gating, and progress key on the project id regardless).
 * Returns an empty widening when no Store selector was given; the Store-scoped
 * query itself refuses that case before any of this matters.
 */
export async function resolveStoreWideningContext(
  store: string | undefined
): Promise<{
  storeId?: string;
  storeUid?: string;
  storeRoot?: string;
  workspaceEntries?: readonly WorkspaceIndexEntry[];
  projectAliases?: Readonly<Record<string, string>>;
}> {
  if (store === undefined) return {};
  const resolved = await resolveQueryStore({ fs: nodeStoreQueryFileSystem }, { store });
  const workspaceEntries = (
    await listAllWorkspaceIndexEntries(productionStoreQueryDependencies.coordination())
  ).filter(entry => entry.storeUid === resolved.storeUid);
  // An invalid catalog (the entry carries a diagnostic) contributes no alias;
  // the lane falls back to the raw id, which never guesses.
  const projectAliases: Record<string, string> = {};
  for (const entry of await listProjectEntries(
    { fs: nodeStoreQueryFileSystem },
    resolved.registeredRoot
  )) {
    if (entry.catalog !== null && entry.catalog.id !== undefined) {
      projectAliases[entry.projectId] = entry.catalog.id;
    }
  }
  return {
    storeId: resolved.storeId,
    storeUid: resolved.storeUid,
    storeRoot: resolved.registeredRoot,
    workspaceEntries,
    projectAliases,
  };
}

/**
 * `list` has the summary page but not the plans, so each Issue's latest plan
 * is resolved here (one `resolveExecutionPlan` per Issue — accepted at
 * single-project scale) and assembled into the `IssueDetail` shape the
 * projection consumes.
 */
async function detailForList(
  query: StoreQueryModule,
  scope: IssueReadScope,
  summary: IssueSummary,
  page: IssueSummaryPage
): Promise<IssueDetail> {
  const plan =
    summary.latestRevisionId === null
      ? null
      : await query.resolveExecutionPlan({
          ...scopeInput(scope),
          issueId: summary.issueId,
        });
  return {
    issue: summary,
    plan,
    complete: plan === null ? page.complete : plan.complete,
    unsearchedRefs: plan === null ? page.unsearchedRefs : plan.unsearchedRefs,
    problems: plan === null ? page.problems : plan.problems,
  };
}

/** Per-kind counts over all five kinds, zeros included — the summary, never a replacement. */
export function attentionCounts(
  items: readonly IssueAttentionItem[]
): Record<IssueAttentionKind, number> {
  const counts = Object.fromEntries(
    ISSUE_ATTENTION_KIND_ORDER.map(kind => [kind, 0])
  ) as Record<IssueAttentionKind, number>;
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

/** Code-point comparator for the stable cross-Issue (issueId, nodeId) order. */
function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// -----------------------------------------------------------------------------
// The three compositions
// -----------------------------------------------------------------------------

/**
 * Every Issue of the Store with its status projected over it, optionally
 * narrowed to one lifecycle state. Each Issue is composed through the SAME
 * inputs `show` composes with (its latest plan, its acceptance facts), so the
 * list and the detail can never disagree about an Issue's axes.
 */
export async function composeIssueProjectionList(
  query: StoreQueryModule,
  scope: IssueReadScope,
  runState: IssueRunStateContext,
  state?: IssueState
): Promise<IssueProjectionListPayload> {
  const page = await query.listIssues({
    ...scopeInput(scope),
    ...(state === undefined ? {} : { state }),
  });
  const widening = await resolveStoreWideningContext(scope.store);
  const statuses: IssueStatus[] = [];
  for (const summary of page.issues) {
    const detail = await detailForList(query, scope, summary, page);
    // Done follows the recorded acceptance, so the list's phase needs each
    // Issue's acceptance facts exactly as show's does.
    const acceptance = await readIssueAcceptanceFacts({
      ...scopeInput(scope),
      issueId: summary.issueId,
    });
    statuses.push(
      await projectIssueStatus(statusInputFor(detail, { ...runState, ...widening, acceptance }))
    );
  }
  return {
    issues: page.issues.map((summary, index) => ({ ...summary, status: statuses[index] })),
    complete: page.complete,
    unsearchedRefs: page.unsearchedRefs,
    problems: page.problems,
  };
}

/**
 * One Issue's whole read: the record and its latest plan, the status, the
 * delivery evidence rolled up from that same status, and the review view
 * composed over it. One projection read, one rollup, one review — no second
 * truth and no second derivation path.
 */
export async function composeIssueProjectionDetail(
  query: StoreQueryModule,
  scope: IssueReadScope,
  runState: IssueRunStateContext,
  issueId: string
): Promise<IssueProjectionDetailPayload> {
  const detail = await query.showIssue({ ...scopeInput(scope), issueId });
  const widening = await resolveStoreWideningContext(scope.store);
  const status = await projectIssueStatus(
    statusInputFor(detail, {
      ...runState,
      ...widening,
      acceptance: await readIssueAcceptanceFacts({ ...scopeInput(scope), issueId }),
      // The predecessor the latest revision supersedes, for the revision
      // delta — resolved only when there is one; a first revision contributes
      // nothing and reports no delta section.
      predecessorPlan: await resolvePredecessorPlan(
        query,
        scope,
        issueId,
        detail.plan?.revision?.supersedes ?? null
      ),
    })
  );
  const revisionId = detail.plan?.revisionId ?? null;
  const delivery = deriveIssueDeliveryEvidence(revisionId, status);
  const review = deriveIssueReview(issueId, revisionId, status);
  return {
    issue: detail.issue,
    plan: detail.plan,
    status,
    delivery,
    review,
    complete: detail.complete,
    unsearchedRefs: detail.unsearchedRefs,
    problems: detail.problems,
  };
}

/**
 * The Store-wide attention scan: every Issue composed through the exact
 * composition {@link composeIssueProjectionDetail} performs, so attention and
 * show cannot disagree about an Issue's facts. An unknown narrowing id is
 * REFUSED, never read as an empty store — the empty state is a claim about
 * scanned Issues, and it must stay true.
 */
export async function composeStoreAttention(
  query: StoreQueryModule,
  scope: IssueReadScope,
  runState: IssueRunStateContext,
  narrowIssueId?: string
): Promise<StoreAttentionPayload> {
  const page = await query.listIssues(scopeInput(scope));
  const selected =
    narrowIssueId === undefined
      ? page.issues
      : page.issues.filter(summary => summary.issueId === narrowIssueId);
  if (narrowIssueId !== undefined && selected.length === 0) {
    throw new StoreError(
      `Issue '${narrowIssueId}' is not known to this Store; an unknown id is refused rather than read as an empty scan.`,
      'issue_attention_unknown_issue',
      {
        fix:
          `Run 'rasen store issue list${
            scope.store === undefined ? '' : ` --store ${scope.store}`
          }' to read the Store's Issue ids.`,
      }
    );
  }
  // Gathered ONCE for the whole scan, exactly as show gathers them for its one
  // Issue: the caller's run-state context and the Store-scoped widening inputs.
  const widening = await resolveStoreWideningContext(scope.store);
  const scanned: StoreAttentionScanEntry[] = [];
  const items: IssueAttentionItem[] = [];
  for (const summary of selected) {
    const detail = await query.showIssue({ ...scopeInput(scope), issueId: summary.issueId });
    const status = await projectIssueStatus(
      statusInputFor(detail, {
        ...runState,
        ...widening,
        acceptance: await readIssueAcceptanceFacts({
          ...scopeInput(scope),
          issueId: summary.issueId,
        }),
        predecessorPlan: await resolvePredecessorPlan(
          query,
          scope,
          summary.issueId,
          detail.plan?.revision?.supersedes ?? null
        ),
      })
    );
    const derived = deriveIssueAttention(summary.issueId, status);
    scanned.push({
      issueId: summary.issueId,
      phase: status.phase,
      health: status.health,
      itemCount: derived.length,
      runStateVisibility: status.runStateVisibility,
    });
    items.push(...derived);
  }
  // The fleet answer's order: fail-first kind rank, then the stable
  // (issueId, nodeId) order — the same key the per-Issue derivation already
  // sorted each Issue's items by, composed across Issues.
  items.sort(
    (left, right) =>
      issueAttentionKindRank(left.kind) - issueAttentionKindRank(right.kind) ||
      codePointOrder(left.issueId, right.issueId) ||
      codePointOrder(left.nodeId ?? '', right.nodeId ?? '')
  );
  return {
    narrowed: narrowIssueId !== undefined,
    issueId: narrowIssueId ?? null,
    scannedCount: scanned.length,
    scanned,
    items,
    counts: attentionCounts(items),
    total: items.length,
    unsearchedRefs: page.unsearchedRefs,
    complete: page.complete,
  };
}
