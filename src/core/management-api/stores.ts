/**
 * Store aggregate HTTP bridge (`store-issue-resources` tasks 5.1/5.3).
 *
 * Every READ here is a thin, lock-free pass-through to `StoreAggregateQuery`'s
 * uid-addressed factory (`createStoreQueryByUid`) — the `management-http-api`
 * spec's read requirement: "These paths SHALL be reads: they SHALL NOT mutate
 * anything and SHALL NOT take a lock." The three mutation bridges call
 * `StoreIssuesModuleInstance` directly.
 *
 * `handleStorePublishPlan` is where the OTHER `management-http-api`
 * requirement is enforced — "A Store-scoped project mutation carries its
 * complete scope and never infers one." `ExecutionPlanNodeInput.projectId`/
 * `.targetLineId` are non-optional TypeScript fields, which enforces nothing
 * at THIS boundary: the request body is untrusted JSON with no runtime shape
 * check upstream, so a node missing either field arrives here as `undefined`
 * despite the type. `query/types.ts`'s own doc comment calls this "decision
 * 10's first of three redundant enforcements" — this file is a second,
 * independent one, not a substitute for whatever `publishPlan`'s own node
 * normalization already checks.
 *
 * Every handler resolves its Store by STABLE IDENTITY (uid), never by display
 * alias. `resolveStoreBinding`'s `store.id` is the LOCAL REGISTRY id (an
 * alias, "always known for a resolved Store" per `identity-types.ts`) — NOT
 * what `resolveQueryStoreByUid` matches against, which is the separate,
 * optional `store.uid` field. The generic `resolveRequestSpace` closure in
 * `router.ts` discards both `type` and `uid` and keeps only a root, which is
 * enough for a filesystem-rooted read but not for a uid match, so this file
 * resolves the store binding itself rather than reusing that helper. This is
 * also the `management-ui-shell` spec's "Store-scoped calls address their
 * Store by stable identity" requirement's server-side counterpart.
 */
import { createStoreQueryByUid } from '../store/query/module.js';
import { StoreIssuesModuleInstance } from '../store/issues/module.js';
import { findPlanNodeSchemaProblems } from '../store/issues/plans.js';
import { isStoreIssueError } from '../store/issues/diagnostics.js';
import { resolveStoreBinding } from '../store/identity.js';
import { isValidStoreUid } from '../store/identity-types.js';
import { parseSpaceSelector, unavailableStoreHttpResult } from '../config-api/project-addressing.js';
import type {
  StoreQuery,
  ProjectRollup,
  TargetLineRollup,
  GroupedChanges,
  IssueSummaryPage,
  IssueDetail,
  ResolvedExecutionPlan,
  FinalizationOutcomeName,
} from '../store/query/types.js';
import type {
  IssueState,
  IssueRecordResult,
  ExecutionPlanResult,
  ExecutionPlanNodeInput,
  StoreIssueErrorCode,
} from '../store/issues/types.js';

// -----------------------------------------------------------------------------
// Result envelope
// -----------------------------------------------------------------------------

export type StoreHandlerResult<T> =
  | { ok: true; status: 200; response: T }
  | { ok: false; status: number; code: string; message: string };

// -----------------------------------------------------------------------------
// Store space resolution (by stable identity)
// -----------------------------------------------------------------------------

export interface ResolvedStoreSpace {
  readonly storeUid: string;
  readonly storeId: string;
  readonly root: string;
}

export type StoreSpaceResolution =
  | { ok: true; space: ResolvedStoreSpace }
  | { ok: false; status: number; code: string; message: string };

/**
 * Resolves a `space` selector to a Store's stable identity. Deliberately
 * separate from `router.ts`'s `resolveRequestSpace`: that helper resolves
 * through `resolveSpaceSelector` and keeps only `root`, discarding `type` and
 * `uid` — sufficient for the filesystem-rooted reads it serves today, not for
 * the uid match this file needs. `selector` is REQUIRED here: unlike a
 * project space, there is no "launch store" fallback for an omitted selector,
 * so an absent one is refused rather than defaulted.
 */
export async function resolveStoreSpace(selector: string | undefined): Promise<StoreSpaceResolution> {
  if (!selector) {
    return {
      ok: false,
      status: 400,
      code: 'space_required',
      message: 'A Store aggregate path requires a "space" selector (space=store:<id>).',
    };
  }
  const parsed = parseSpaceSelector(selector);
  if (!parsed.ok) return parsed;
  if (parsed.namespace !== 'store') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_space',
      message: `Store aggregate paths require a "store:" selector; got "${parsed.namespace}:${parsed.selector}".`,
    };
  }

  const binding = await resolveStoreBinding({
    declaration: isValidStoreUid(parsed.selector)
      ? { form: 'durable', uid: parsed.selector }
      : { form: 'alias', id: parsed.selector },
  });

  if (binding.kind === 'absent') {
    return {
      ok: false,
      status: 404,
      code: 'space_not_found',
      message: `No registered store matches "${parsed.selector}" in the store namespace.`,
    };
  }
  if (binding.kind === 'unavailable') {
    // `unavailableStoreHttpResult` already maps `reason: 'not-registered'` to
    // 404 `space_not_found` (`SPACE_STATUS_BY_REASON`), so no special case is
    // needed here for that arm.
    return { ok: false, ...unavailableStoreHttpResult(binding, parsed.selector) };
  }
  if (binding.store.uid === undefined) {
    return {
      ok: false,
      status: 409,
      code: 'space_unavailable',
      message: `Store "${binding.store.id}" has no stable identity recorded; the Store aggregate API requires one.`,
    };
  }
  return {
    ok: true,
    space: { storeUid: binding.store.uid, storeId: binding.store.id, root: binding.store.root },
  };
}

// -----------------------------------------------------------------------------
// Error mapping
// -----------------------------------------------------------------------------

function statusForIssueCode(code: StoreIssueErrorCode): number {
  switch (code) {
    case 'issue_scope_required':
    case 'store_query_scope_incomplete':
      return 400;
    case 'issue_not_found':
      return 404;
    case 'store_query_ref_unreadable':
      return 502;
    case 'issue_already_exists':
    case 'issue_record_divergent':
    case 'issue_state_transition_refused':
    case 'issue_reference_unresolved':
    case 'issue_reference_uncommitted':
    case 'issue_reference_ambiguous':
    case 'issue_reference_scope_conflict':
    case 'issue_reference_foreign_store':
    case 'execution_plan_revision_exists':
    case 'execution_plan_cycle':
    case 'execution_plan_node_duplicate':
    case 'execution_plan_digest_mismatch':
    case 'issue_write_requires_store_checkout':
      return 409;
    default:
      return 400;
  }
}

function mapThrown(error: unknown): { status: number; code: string; message: string } {
  if (isStoreIssueError(error)) {
    return { status: statusForIssueCode(error.issueCode), code: error.issueCode, message: error.message };
  }
  if (error instanceof Error) {
    return { status: 500, code: 'store_query_failed', message: error.message };
  }
  return { status: 500, code: 'store_query_failed', message: String(error) };
}

async function run<T>(operation: () => Promise<T>): Promise<StoreHandlerResult<T>> {
  try {
    const response = await operation();
    return { ok: true, status: 200, response };
  } catch (error) {
    return { ok: false, ...mapThrown(error) };
  }
}

// -----------------------------------------------------------------------------
// Reads — StoreAggregateQuery, uid-addressed, lock-free
// -----------------------------------------------------------------------------

const storeQuery = createStoreQueryByUid();

/**
 * `startPath` is unread in uid-addressed mode: `StoreQueryModuleImpl.open`
 * branches on `addressBy` before ever touching `input.startPath`
 * (`resolveQueryStoreByUid` takes only `storeUid`). Held as `''` here rather
 * than omitted so every read call site states the field is inert, not
 * forgotten — `StoreQuery.startPath` is non-optional at the type level.
 */
function baseQuery(space: ResolvedStoreSpace): StoreQuery {
  return { store: space.storeUid, startPath: '' };
}

export function handleStoreProjects(space: ResolvedStoreSpace): Promise<StoreHandlerResult<ProjectRollup>> {
  return run(() => storeQuery.listProjects(baseQuery(space)));
}

export function handleStoreTargetLines(space: ResolvedStoreSpace): Promise<StoreHandlerResult<TargetLineRollup>> {
  return run(() => storeQuery.listTargetLines(baseQuery(space)));
}

export interface StoreChangesFilter {
  readonly projects?: readonly string[];
  readonly targetLines?: readonly string[];
  readonly outcomes?: readonly FinalizationOutcomeName[];
  readonly state?: 'active' | 'archived';
}

export function handleStoreChanges(
  space: ResolvedStoreSpace,
  filter: StoreChangesFilter
): Promise<StoreHandlerResult<GroupedChanges>> {
  return run(() => storeQuery.listChanges({ ...baseQuery(space), ...filter }));
}

export function handleStoreIssues(
  space: ResolvedStoreSpace,
  state?: IssueState
): Promise<StoreHandlerResult<IssueSummaryPage>> {
  return run(() => storeQuery.listIssues({ ...baseQuery(space), ...(state ? { state } : {}) }));
}

export async function handleStoreIssue(
  space: ResolvedStoreSpace,
  issueId: string | undefined
): Promise<StoreHandlerResult<IssueDetail>> {
  if (!issueId) {
    return { ok: false, status: 400, code: 'issue_id_required', message: 'issueId is required.' };
  }
  return run(() => storeQuery.showIssue({ ...baseQuery(space), issueId }));
}

export async function handleStoreIssueReferences(
  space: ResolvedStoreSpace,
  changeInstanceId: string | undefined
): Promise<StoreHandlerResult<IssueSummaryPage>> {
  if (!changeInstanceId) {
    return {
      ok: false,
      status: 400,
      code: 'change_instance_id_required',
      message: 'changeInstanceId is required.',
    };
  }
  return run(() => storeQuery.issuesReferencing({ ...baseQuery(space), changeInstanceId }));
}

export async function handleStoreExecutionPlan(
  space: ResolvedStoreSpace,
  issueId: string | undefined,
  revisionId: string | undefined
): Promise<StoreHandlerResult<ResolvedExecutionPlan>> {
  if (!issueId) {
    return { ok: false, status: 400, code: 'issue_id_required', message: 'issueId is required.' };
  }
  return run(() =>
    storeQuery.resolveExecutionPlan({
      ...baseQuery(space),
      issueId,
      ...(revisionId ? { revisionId } : {}),
    })
  );
}

// -----------------------------------------------------------------------------
// Mutations — StoreIssues
// -----------------------------------------------------------------------------

/**
 * Unlike `StoreAggregateQuery`, `StoreIssuesModuleInstance` has no
 * uid-addressed factory variant: its own scope resolution (`resolveIssueScope`
 * → `resolveQueryStore`) requires an explicit `store` selector and accepts
 * EITHER a display alias or a permanent identity (`resolveRegisteredStore`:
 * "The operand may be a display name or a permanent identity"), so the
 * already-resolved stable uid is passed through unchanged. `startPath` IS read
 * here, but only AFTER the Store itself resolves, to pick which of the
 * Store's own worktrees is the write checkout
 * (`isContainedIn(candidate, startPath)`) — the Store's own registered root is
 * never itself one of those worktrees, so passing it here correctly falls
 * back to the Store's canonical checkout, which is the right default for an
 * HTTP-originated write with no ambient working directory.
 */
function writeScope(space: ResolvedStoreSpace): { store: string; startPath: string } {
  return { store: space.storeUid, startPath: space.root };
}

export async function handleStoreIssueCreate(
  space: ResolvedStoreSpace,
  body: { issueId?: unknown; title?: unknown; readme?: unknown }
): Promise<StoreHandlerResult<IssueRecordResult>> {
  const issueId = typeof body.issueId === 'string' ? body.issueId : '';
  const title = typeof body.title === 'string' ? body.title : '';
  const missing = [!issueId ? 'issueId' : null, !title ? 'title' : null].filter(
    (value): value is string => value !== null
  );
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'issue_create_incomplete',
      message: `Creating an Issue requires ${missing.join(' and ')}.`,
    };
  }
  return run(() =>
    StoreIssuesModuleInstance.create({
      ...writeScope(space),
      issueId,
      title,
      ...(typeof body.readme === 'boolean' ? { readme: body.readme } : {}),
    })
  );
}

const ISSUE_STATES: readonly IssueState[] = ['open', 'resolved', 'dropped'];

export async function handleStoreIssueSetState(
  space: ResolvedStoreSpace,
  body: { issueId?: unknown; state?: unknown; reason?: unknown }
): Promise<StoreHandlerResult<IssueRecordResult>> {
  const issueId = typeof body.issueId === 'string' ? body.issueId : '';
  const state = typeof body.state === 'string' && (ISSUE_STATES as readonly string[]).includes(body.state)
    ? (body.state as IssueState)
    : undefined;
  const missing = [!issueId ? 'issueId' : null, !state ? 'a valid state ("open", "resolved", or "dropped")' : null].filter(
    (value): value is string => value !== null
  );
  if (missing.length > 0 || state === undefined) {
    return {
      ok: false,
      status: 400,
      code: 'issue_state_incomplete',
      message: `Setting an Issue's state requires ${missing.join(' and ')}.`,
    };
  }
  return run(() =>
    StoreIssuesModuleInstance.setState({
      ...writeScope(space),
      issueId,
      state,
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    })
  );
}

export interface IncompletePlanNodeScope {
  readonly nodeId: string;
  readonly missing: readonly ('projectId' | 'targetLineId')[];
}

/**
 * Validates every node's scope BEFORE any node reaches `publishPlan`
 * (`management-http-api` spec: "A Store-scoped project mutation carries its
 * complete scope ... and the server SHALL refuse a mutation whose scope is
 * incomplete"). A WHOLE-REQUEST refusal, not a per-node drop: publishing the
 * well-scoped nodes while silently discarding the ill-scoped one would be a
 * different, quieter defect — a plan that looks complete but is not what the
 * caller submitted. Deliberately never treats a Store with exactly one
 * project (or one target line) as licence to fill a missing field; nothing
 * here even looks at how many projects the Store has — the spec's "single
 * candidate does not become an inference" scenario is satisfied by this
 * function never having a path that could adopt one.
 */
export function findIncompletePlanNodeScopes(
  nodes: readonly { nodeId?: unknown; projectId?: unknown; targetLineId?: unknown }[]
): readonly IncompletePlanNodeScope[] {
  const incomplete: IncompletePlanNodeScope[] = [];
  for (const node of nodes) {
    const missing: ('projectId' | 'targetLineId')[] = [];
    if (typeof node.projectId !== 'string' || node.projectId.length === 0) missing.push('projectId');
    if (typeof node.targetLineId !== 'string' || node.targetLineId.length === 0) missing.push('targetLineId');
    if (missing.length > 0) {
      incomplete.push({
        nodeId: typeof node.nodeId === 'string' && node.nodeId.length > 0 ? node.nodeId : '(unnamed node)',
        missing,
      });
    }
  }
  return incomplete;
}

export interface InvalidPlanNode {
  readonly nodeId: string;
  readonly problem: string;
}

/**
 * Which node kind this is, and the one field that kind cannot do without,
 * answered in the product's own voice.
 *
 * `normalizePlanNodes` now runs `NodeSchema` itself, so the 500 this check was
 * introduced against is closed at the core as well. It stays because a wrong
 * `kind` is the one node defect worth naming as a product fact ("kind must be
 * change or intent") rather than as a discriminated-union parser message, and
 * because it runs first: a body caught here never has to be explained twice.
 * `findPlanNodeSchemaProblems` below it covers everything else the schema
 * declares.
 *
 * Deliberately kept out of `findIncompletePlanNodeScopes`: that function
 * answers one spec requirement (a Store-scoped mutation carries its complete
 * scope, and a sole candidate never fills a gap) and folding a second rule
 * into it would make its refusal message answer two questions at once.
 */
export function findInvalidPlanNodes(
  nodes: readonly {
    nodeId?: unknown;
    kind?: unknown;
    changeInstanceId?: unknown;
    summary?: unknown;
  }[]
): readonly InvalidPlanNode[] {
  const invalid: InvalidPlanNode[] = [];
  for (const node of nodes) {
    const nodeId =
      typeof node.nodeId === 'string' && node.nodeId.length > 0 ? node.nodeId : '(unnamed node)';
    if (node.kind !== 'change' && node.kind !== 'intent') {
      invalid.push({
        nodeId,
        problem: `kind must be "change" or "intent", not ${JSON.stringify(node.kind ?? null)}`,
      });
      continue;
    }
    if (
      node.kind === 'change' &&
      (typeof node.changeInstanceId !== 'string' || node.changeInstanceId.length === 0)
    ) {
      invalid.push({ nodeId, problem: 'a change node requires a changeInstanceId string' });
      continue;
    }
    if (
      node.kind === 'intent' &&
      (typeof node.summary !== 'string' || node.summary.length === 0)
    ) {
      invalid.push({ nodeId, problem: 'an intent node requires a summary string' });
    }
  }
  return invalid;
}

export async function handleStorePublishPlan(
  space: ResolvedStoreSpace,
  body: { issueId?: unknown; nodes?: unknown }
): Promise<StoreHandlerResult<ExecutionPlanResult>> {
  const issueId = typeof body.issueId === 'string' ? body.issueId : '';
  if (!issueId) {
    return {
      ok: false,
      status: 400,
      code: 'issue_id_required',
      message: 'Publishing an execution plan requires issueId.',
    };
  }
  if (!Array.isArray(body.nodes)) {
    return {
      ok: false,
      status: 400,
      code: 'plan_nodes_required',
      message: 'Publishing an execution plan requires a "nodes" array.',
    };
  }
  const rawNodes = body.nodes as readonly {
    nodeId?: unknown;
    kind?: unknown;
    projectId?: unknown;
    targetLineId?: unknown;
    changeInstanceId?: unknown;
    summary?: unknown;
  }[];
  const incomplete = findIncompletePlanNodeScopes(rawNodes);
  if (incomplete.length > 0) {
    const detail = incomplete
      .map((entry) => `node ${entry.nodeId} is missing ${entry.missing.join(' and ')}`)
      .join('; ');
    return {
      ok: false,
      status: 400,
      code: 'store_query_scope_incomplete',
      message:
        `A Store-scoped project mutation carries its complete scope — Store, project, and target line — ` +
        `and this one does not: ${detail}.`,
    };
  }
  const invalid = findInvalidPlanNodes(rawNodes);
  if (invalid.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'plan_node_invalid',
      message:
        `An execution plan node declares a kind the product does not define, or omits the ` +
        `field that kind requires: ${invalid
          .map((entry) => `node ${entry.nodeId}: ${entry.problem}`)
          .join('; ')}.`,
    };
  }
  // Everything else `NodeSchema` declares, reported rather than thrown. The
  // core enforces the identical schema for every caller, but it enforces it by
  // THROWING a `StorePlanningValidationError`, which is not a `StoreIssueError`
  // and so reaches `mapThrown` as a 500 — an internal-fault status for a body
  // the product simply does not accept. Running the non-throwing twin here is
  // what turns that into the 400 an untrusted caller is owed.
  const schemaProblems = findPlanNodeSchemaProblems(
    rawNodes as unknown as readonly ExecutionPlanNodeInput[]
  );
  if (schemaProblems.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'plan_node_invalid',
      message:
        `An execution plan node does not satisfy the node schema: ${schemaProblems
          .map((entry) => `node ${entry.nodeId}: ${entry.problem}`)
          .join('; ')}.`,
    };
  }
  return run(() =>
    StoreIssuesModuleInstance.publishPlan({
      ...writeScope(space),
      issueId,
      nodes: rawNodes as unknown as readonly ExecutionPlanNodeInput[],
    })
  );
}
