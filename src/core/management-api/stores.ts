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
import { isStoreIssueError, issueError } from '../store/issues/diagnostics.js';
import { StoreError } from '../store/errors.js';
import {
  composeChangeIssueLinks,
  composeIssueProjectionDetail,
  composeIssueProjectionList,
  composeStoreAttention,
  type ChangeIssueLinksPayload,
  type IssueProjectionDetailPayload,
  type IssueProjectionListPayload,
  type IssueRunStateContext,
  type StoreAttentionPayload,
} from '../issue-read/index.js';
import { parseExecutionPlanRevisionId } from '../store/planning-validation.js';
import { listPipelines } from '../pipeline-registry/resolver.js';
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
  AggregateProblem,
} from '../store/query/types.js';
import type {
  IssueState,
  IssueRecordResult,
  ExecutionPlanResult,
  ExecutionPlanNodeInput,
  IssuePublicationRecovery,
  IssueWriteWarning,
  StoreIssues,
  StoreIssueErrorCode,
} from '../store/issues/types.js';
import type {
  StoreIssueDetailResponse,
  StoreIssueProjectionResponse,
  StoreIssueProjectionsResponse,
  StoreIssueReferencesResponse,
  StoreIssueRecordResponse,
  StoreIssuesResponse,
  StoreExecutionPlanResponse,
  StoreExecutionPlanPublishResponse,
  StorePublicIssueRecordCopy,
  StorePublicIssueSummary,
} from './wire-types.js';

// -----------------------------------------------------------------------------
// Result envelope
// -----------------------------------------------------------------------------

export type StoreHandlerResult<T> =
  | { ok: true; status: 200; response: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      recovery?: IssuePublicationRecovery;
    };

const PUBLIC_ISSUE_DIAGNOSTIC =
  'Issue data could not be read or verified; inspect the Store locally for storage details.';

function samePublicIdentity(
  left: StorePublicIssueRecordCopy['identity'],
  right: StorePublicIssueRecordCopy['identity']
): boolean {
  return left !== null && right !== null && left.uid === right.uid && left.key === right.key;
}

function publicIdentityForSummary(
  summary: IssueSummaryPage['issues'][number]
): StorePublicIssueSummary['identity'] {
  if (summary.identity !== null) return summary.identity;
  const copies = summary.divergence?.copies ?? [];
  const first = copies[0]?.identity?.identity ?? null;
  return first !== null && copies.every(copy => samePublicIdentity(first, copy.identity?.identity ?? null))
    ? first
    : null;
}

function publicIssueCopy(
  copy: NonNullable<IssueSummaryPage['issues'][number]['divergence']>['copies'][number]
): StorePublicIssueRecordCopy {
  const { storageKey: _storageKey, identity, diagnostic: _diagnostic, ...publicCopy } = copy;
  return {
    ...publicCopy,
    identity: identity?.identity ?? null,
    diagnostic: copy.diagnostic === null ? null : PUBLIC_ISSUE_DIAGNOSTIC,
  };
}

export function projectIssueSummaryForWire(
  summary: IssueSummaryPage['issues'][number]
): StorePublicIssueSummary {
  const identity = publicIdentityForSummary(summary);
  return {
    ...summary,
    identity,
    issueId: identity?.uid ?? '(unavailable Issue identity)',
    diagnostic: summary.diagnostic === null ? null : PUBLIC_ISSUE_DIAGNOSTIC,
    divergence:
      summary.divergence === null
        ? null
        : { copies: summary.divergence.copies.map(publicIssueCopy) },
  };
}

/** Issue filesystem locations remain actionable in core/human diagnostics, not JSON. */
export function projectIssueProblemsForWire(
  problems: readonly AggregateProblem[],
  safeIssueIds: ReadonlySet<string> = new Set()
): readonly AggregateProblem[] {
  return problems.map(problem =>
    problem.kind === 'issue'
      ? {
          ...problem,
          itemId: safeIssueIds.has(problem.itemId)
            ? problem.itemId
            : '(unavailable Issue identity)',
          path: '(internal Issue storage)',
          reason: PUBLIC_ISSUE_DIAGNOSTIC,
        }
      : problem
  );
}

function safeIssueIdsForWire(
  summaries: readonly IssueSummaryPage['issues'][number][]
): ReadonlySet<string> {
  return new Set(
    summaries
      .map(publicIdentityForSummary)
      .filter((identity): identity is NonNullable<typeof identity> => identity !== null)
      .flatMap(identity => [identity.uid, identity.key])
  );
}

function unsafeIssueLocatorsForWire(
  summaries: readonly IssueSummaryPage['issues'][number][]
): ReadonlySet<string> {
  return new Set(
    summaries
      .filter(summary => publicIdentityForSummary(summary) === null)
      .map(summary => summary.issueId)
  );
}

function redactIssueDiagnosticValue(
  value: unknown,
  unsafeIssueLocators: ReadonlySet<string>,
  propertyName?: string
): unknown {
  if (typeof value === 'string') {
    if (
      (propertyName === 'issueId' ||
        propertyName === 'issueKey' ||
        propertyName === 'itemId') &&
      unsafeIssueLocators.has(value)
    ) {
      return '(unavailable Issue identity)';
    }
    if (
      unsafeIssueLocators.size > 0 &&
      (propertyName === 'diagnostic' || propertyName === 'reason')
    ) {
      return PUBLIC_ISSUE_DIAGNOSTIC;
    }
    if (
      (propertyName === 'path' || propertyName === 'ref') &&
      [...unsafeIssueLocators].some(locator => value.includes(locator))
    ) {
      return '(internal Issue storage)';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(entry =>
      redactIssueDiagnosticValue(entry, unsafeIssueLocators)
    );
  }
  if (typeof value !== 'object' || value === null) return value;
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'storageKey') continue;
    projected[key] = redactIssueDiagnosticValue(entry, unsafeIssueLocators, key);
  }
  return projected;
}

/** Redacts nested status/review/attention diagnostics with the same summary authority. */
export function projectIssueDiagnosticPayloadForWire<T>(
  value: T,
  summaries: readonly IssueSummaryPage['issues'][number][]
): T {
  return redactIssueDiagnosticValue(
    value,
    unsafeIssueLocatorsForWire(summaries)
  ) as T;
}

export function projectStoreAttentionForWire(
  payload: StoreAttentionPayload
): StoreAttentionPayload {
  const unsafe = new Set(
    payload.scanned
      .filter(entry => entry.issueId === entry.issueKey)
      .flatMap(entry => [entry.issueId, entry.issueKey])
  );
  return redactIssueDiagnosticValue(payload, unsafe) as StoreAttentionPayload;
}

export function projectIssuePageForWire(page: IssueSummaryPage): StoreIssuesResponse {
  const safeIssueIds = safeIssueIdsForWire(page.issues);
  return {
    ...page,
    issues: page.issues.map(projectIssueSummaryForWire),
    problems: projectIssueProblemsForWire(page.problems, safeIssueIds),
  };
}

export function projectExecutionPlanForWire(
  plan: ResolvedExecutionPlan,
  summary: IssueSummaryPage['issues'][number]
): StoreExecutionPlanResponse {
  const identity = publicIdentityForSummary(summary);
  return projectIssueDiagnosticPayloadForWire({
    ...plan,
    issueId: identity?.uid ?? '(unavailable Issue identity)',
    problems: projectIssueProblemsForWire(
      plan.problems,
      identity === null ? new Set() : new Set([identity.uid, identity.key])
    ),
  }, [summary]);
}

export function projectIssueDetailForWire(detail: IssueDetail): StoreIssueDetailResponse {
  const safeIssueIds = safeIssueIdsForWire([detail.issue]);
  return {
    ...detail,
    issue: projectIssueSummaryForWire(detail.issue),
    plan:
      detail.plan === null
        ? null
        : projectExecutionPlanForWire(detail.plan, detail.issue),
    problems: projectIssueProblemsForWire(detail.problems, safeIssueIds),
  };
}

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

export function statusForIssueDiagnosticCode(code: string): number | undefined {
  switch (code) {
    case 'issue_scope_required':
    case 'issue_title_required':
    case 'issue_selector_required':
    case 'issue_selector_invalid':
    case 'store_query_scope_incomplete':
      return 400;
    case 'issue_not_found':
      return 404;
    case 'issue_resource_identity_mismatch':
      return 422;
    case 'store_query_ref_unreadable':
      return 502;
    case 'issue_identity_allocation_failed':
    case 'issue_publication_indeterminate':
      return 500;
    case 'issue_selector_ambiguous':
    case 'issue_identity_conflict':
    case 'issue_key_conflict':
    case 'issue_alias_conflict':
    case 'issue_storage_identity_mismatch':
    case 'issue_already_exists':
    case 'issue_record_divergent':
    case 'issue_state_transition_refused':
    case 'issue_reference_unresolved':
    case 'issue_reference_uncommitted':
    case 'issue_reference_ambiguous':
    case 'issue_reference_scope_conflict':
    case 'issue_reference_foreign_store':
    case 'execution_plan_revision_exists':
    case 'execution_plan_revision_conflict':
    case 'execution_plan_cycle':
    case 'execution_plan_node_duplicate':
    case 'execution_plan_digest_mismatch':
    case 'issue_write_requires_store_checkout':
      return 409;
    default:
      return undefined;
  }
}

export function statusForIssueCode(code: StoreIssueErrorCode): number {
  return statusForIssueDiagnosticCode(code) ?? 400;
}

const ISSUE_FAILURE_CODES_WITH_INTERNAL_LOCATORS = new Set([
  'store_query_ref_unreadable',
  'issue_storage_identity_mismatch',
]);

/** Read refusals may retain physical selectors internally, but never on HTTP. */
export function projectIssueFailureMessageForWire(code: string, message: string): string {
  return ISSUE_FAILURE_CODES_WITH_INTERNAL_LOCATORS.has(code)
    ? PUBLIC_ISSUE_DIAGNOSTIC
    : message;
}

export function isAbsentIssueSummary(
  summary: IssueSummaryPage['issues'][number]
): boolean {
  return (
    summary.identity === null &&
    summary.record === null &&
    summary.divergence === null &&
    summary.diagnostic === null &&
    summary.revisionIds.length === 0 &&
    summary.refs.length === 0
  );
}

function requirePresentIssue(
  selector: string,
  summary: IssueSummaryPage['issues'][number]
): void {
  if (isAbsentIssueSummary(summary)) {
    throw issueError('issue_not_found', `Issue selector '${selector}' matches no Issue.`);
  }
}

/**
 * Refusals the Issue read composition raises that are NOT `StoreIssueError`s,
 * mapped to their client-fault statuses.
 *
 * `issue_attention_unknown_issue` (the attention scan's unknown-narrowing
 * refusal) is a plain `StoreError`: the `StoreIssueErrorCode` union is closed
 * and this code was deliberately never added to it. Without this table the
 * code falls through to the generic arm below and a client naming an Issue the
 * Store does not have is told the SERVER failed — a 500 for a 404 fact. The
 * table stays separate from `statusForIssueCode` for exactly that reason: that
 * function's parameter type is the closed union, and widening it to keep one
 * outsider company would blur the boundary the union draws.
 */
const STATUS_FOR_STORE_ERROR_CODE: Readonly<Record<string, number>> = {
  issue_attention_unknown_issue: 404,
};

function mapThrown(error: unknown): {
  status: number;
  code: string;
  message: string;
  recovery?: IssuePublicationRecovery;
} {
  if (isStoreIssueError(error)) {
    return {
      status: statusForIssueCode(error.issueCode),
      code: error.issueCode,
      message: projectIssueFailureMessageForWire(error.issueCode, error.message),
      ...(error.recovery === undefined ? {} : { recovery: error.recovery }),
    };
  }
  if (error instanceof StoreError) {
    const code = error.diagnostic.code;
    const status = STATUS_FOR_STORE_ERROR_CODE[code];
    if (status !== undefined) {
      return { status, code, message: error.message };
    }
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
): Promise<StoreHandlerResult<StoreIssuesResponse>> {
  return run(async () =>
    projectIssuePageForWire(
      await storeQuery.listIssues({ ...baseQuery(space), ...(state ? { state } : {}) })
    )
  );
}

type IssueSelectorResult =
  | { readonly ok: true; readonly selector: string }
  | { readonly ok: false; readonly status: 400; readonly code: string; readonly message: string };

/**
 * The one HTTP-boundary contract for every Issue selector field/query value.
 * `issueId` remains the compatibility field name for this release, but its
 * value is a selector (UID, generated key, unique slug, or legacy alias), never
 * a path or storage id.
 */
function requireIssueSelector(value: unknown, action: string): IssueSelectorResult {
  if (value === undefined || value === null || value === '') {
    return {
      ok: false,
      status: 400,
      code: 'issue_selector_required',
      message: `${action} requires an Issue selector in issueId.`,
    };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'issue_selector_invalid',
      message: `${action} requires issueId to be a string selector.`,
    };
  }
  return { ok: true, selector: value };
}

export async function handleStoreIssue(
  space: ResolvedStoreSpace,
  issueId: string | undefined
): Promise<StoreHandlerResult<StoreIssueDetailResponse>> {
  const selected = requireIssueSelector(issueId, 'Reading an Issue');
  if (!selected.ok) return selected;
  return run(async () => {
    const detail = await storeQuery.showIssue({ ...baseQuery(space), issueId: selected.selector });
    requirePresentIssue(selected.selector, detail.issue);
    return projectIssueDetailForWire(detail);
  });
}

export async function handleStoreIssueReferences(
  space: ResolvedStoreSpace,
  changeInstanceId: string | undefined
): Promise<StoreHandlerResult<StoreIssueReferencesResponse>> {
  if (!changeInstanceId) {
    return {
      ok: false,
      status: 400,
      code: 'change_instance_id_required',
      message: 'changeInstanceId is required.',
    };
  }
  return run(async () =>
    projectIssuePageForWire(
      await storeQuery.issuesReferencing({ ...baseQuery(space), changeInstanceId })
    )
  );
}

// -----------------------------------------------------------------------------
// Projection reads — the SAME composition the command line prints
// (`issue-read-surface` design D1/D2)
// -----------------------------------------------------------------------------

/**
 * The Store scope the projection compositions read through. `startPath` is
 * inert for the uid-addressed query (`baseQuery`'s note), and inert again for
 * the acceptance and widening reads the composition performs: those resolve
 * the Store by the uid passed here and fall back to its canonical checkout
 * when no worktree contains the start path — which is the right answer for an
 * HTTP request, since a request has no working directory of its own.
 */
function projectionScope(space: ResolvedStoreSpace): { store: string; startPath: string } {
  return { store: space.storeUid, startPath: '' };
}

/**
 * Every Issue with its projected status. A passthrough of
 * `composeIssueProjectionList`: no derivation, no translation, and no cached
 * copy of any projected fact lives on this side of the call.
 */
export function handleStoreIssueProjections(
  space: ResolvedStoreSpace,
  runState: IssueRunStateContext,
  state?: IssueState
): Promise<StoreHandlerResult<StoreIssueProjectionsResponse>> {
  return run(async () => {
    const payload = await composeIssueProjectionList(
      storeQuery,
      projectionScope(space),
      runState,
      state
    );
    return {
      ...payload,
      issues: payload.issues.map(entry => ({
        ...projectIssueSummaryForWire(entry),
        status: projectIssueDiagnosticPayloadForWire(entry.status, [entry]),
      })),
      problems: projectIssueProblemsForWire(
        payload.problems,
        safeIssueIdsForWire(payload.issues)
      ),
    };
  });
}

/**
 * One Issue's whole read — status, delivery evidence, and review together,
 * exactly the body `store issue show --json` prints. A missing `issueId` is
 * refused with the same scope code `handleStoreIssue` refuses one with: the
 * single-Issue read names its Issue or it is not a request.
 */
export async function handleStoreIssueProjection(
  space: ResolvedStoreSpace,
  runState: IssueRunStateContext,
  issueId: string | undefined
): Promise<StoreHandlerResult<StoreIssueProjectionResponse>> {
  const selected = requireIssueSelector(issueId, 'Reading an Issue projection');
  if (!selected.ok) return selected;
  return run(async () => {
    const payload = await composeIssueProjectionDetail(
      storeQuery,
      projectionScope(space),
      runState,
      selected.selector
    );
    requirePresentIssue(selected.selector, payload.issue);
    return projectIssueDiagnosticPayloadForWire({
      ...payload,
      issue: projectIssueSummaryForWire(payload.issue),
      plan: payload.plan === null
        ? null
        : projectExecutionPlanForWire(payload.plan, payload.issue),
      problems: projectIssueProblemsForWire(
        payload.problems,
        safeIssueIdsForWire([payload.issue])
      ),
    }, [payload.issue]);
  });
}

/**
 * The Store-wide needs-attention scan, with the CLI's `--issue` narrowing
 * carried whole: an unknown narrowing id is REFUSED (404), never answered with
 * an empty scan, because the empty state is a claim about scanned Issues.
 */
export function handleStoreIssueAttention(
  space: ResolvedStoreSpace,
  runState: IssueRunStateContext,
  issueId?: string
): Promise<StoreHandlerResult<StoreAttentionPayload>> {
  if (issueId !== undefined) {
    const selected = requireIssueSelector(issueId, 'Narrowing Issue attention');
    if (!selected.ok) return Promise.resolve(selected);
    issueId = selected.selector;
  }
  return run(async () =>
    projectStoreAttentionForWire(
      await composeStoreAttention(storeQuery, projectionScope(space), runState, issueId)
    )
  );
}

/**
 * Fresh Store-wide Change-to-Issue association read. The handler is a direct
 * pass-through to the shared issue-read composition and keeps no index/cache.
 */
export function handleStoreChangeIssueLinks(
  space: ResolvedStoreSpace
): Promise<StoreHandlerResult<ChangeIssueLinksPayload>> {
  return run(async () => {
    const payload = await composeChangeIssueLinks(storeQuery, projectionScope(space));
    return { ...payload, problems: projectIssueProblemsForWire(payload.problems) };
  });
}

export async function handleStoreExecutionPlan(
  space: ResolvedStoreSpace,
  issueId: string | undefined,
  revisionId: string | undefined
): Promise<StoreHandlerResult<StoreExecutionPlanResponse>> {
  const selected = requireIssueSelector(issueId, 'Reading an execution plan');
  if (!selected.ok) return selected;
  return run(async () => {
    const detail = await storeQuery.showIssue({
      ...baseQuery(space),
      issueId: selected.selector,
    });
    requirePresentIssue(selected.selector, detail.issue);
    return projectExecutionPlanForWire(
      await storeQuery.resolveExecutionPlan({
        ...baseQuery(space),
        issueId: selected.selector,
        ...(revisionId ? { revisionId } : {}),
      }),
      detail.issue
    );
  });
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

function publicIssueRecordResult(result: IssueRecordResult): StoreIssueRecordResponse {
  return {
    identity: result.identity,
    issueId: result.issueId,
    record: result.record,
    storeId: result.storeId,
    storeUid: result.storeUid,
    ...(result.warnings === undefined ? {} : { warnings: publicIssueWarnings(result.warnings) }),
  };
}

function publicExecutionPlanResult(
  result: ExecutionPlanResult
): StoreExecutionPlanPublishResponse {
  return {
    identity: result.identity,
    issueId: result.issueId,
    revision: result.revision,
    storeId: result.storeId,
    storeUid: result.storeUid,
    ...(result.warnings === undefined ? {} : { warnings: publicIssueWarnings(result.warnings) }),
  };
}

function publicIssueWarnings(
  warnings: readonly IssueWriteWarning[]
): readonly Pick<IssueWriteWarning, 'code' | 'message'>[] {
  return warnings.map(({ code, message }) => ({ code, message }));
}

export async function handleStoreIssueCreate(
  space: ResolvedStoreSpace,
  body: { issueId?: unknown; title?: unknown; readme?: unknown },
  options: { readonly issues?: Pick<StoreIssues, 'create'> } = {}
): Promise<StoreHandlerResult<StoreIssueRecordResponse>> {
  if (typeof body.title !== 'string' || body.title.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'issue_title_required',
      message: 'Creating an Issue requires a non-empty title.',
    };
  }
  if (body.issueId !== undefined && typeof body.issueId !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'issue_selector_invalid',
      message: 'The deprecated compatibility issueId alias must be a string when provided.',
    };
  }
  const compatibilityAlias =
    typeof body.issueId === 'string' ? body.issueId : undefined;
  const issues = options.issues ?? StoreIssuesModuleInstance;
  return run(async () =>
    publicIssueRecordResult(await issues.create({
      ...writeScope(space),
      title: body.title as string,
      ...(compatibilityAlias === undefined ? {} : { issueId: compatibilityAlias }),
      ...(typeof body.readme === 'boolean' ? { readme: body.readme } : {}),
    }))
  );
}

const ISSUE_STATES: readonly IssueState[] = ['open', 'resolved', 'dropped'];

export async function handleStoreIssueSetState(
  space: ResolvedStoreSpace,
  body: { issueId?: unknown; state?: unknown; reason?: unknown }
): Promise<StoreHandlerResult<StoreIssueRecordResponse>> {
  const selected = requireIssueSelector(body.issueId, "Setting an Issue's state");
  if (!selected.ok) return selected;
  const state = typeof body.state === 'string' && (ISSUE_STATES as readonly string[]).includes(body.state)
    ? (body.state as IssueState)
    : undefined;
  const missing = [!state ? 'a valid state ("open", "resolved", or "dropped")' : null].filter(
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
  return run(async () =>
    publicIssueRecordResult(await StoreIssuesModuleInstance.setState({
      ...writeScope(space),
      issueId: selected.selector,
      state,
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    }))
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
  body: { issueId?: unknown; nodes?: unknown; expectedRevisionId?: unknown }
): Promise<StoreHandlerResult<StoreExecutionPlanPublishResponse>> {
  const selected = requireIssueSelector(body.issueId, 'Publishing an execution plan');
  if (!selected.ok) return selected;
  if (!Array.isArray(body.nodes)) {
    return {
      ok: false,
      status: 400,
      code: 'plan_nodes_required',
      message: 'Publishing an execution plan requires a "nodes" array.',
    };
  }
  let expectedRevisionId: ReturnType<typeof parseExecutionPlanRevisionId> | null | undefined;
  if (body.expectedRevisionId === null) {
    expectedRevisionId = null;
  } else if (body.expectedRevisionId === undefined) {
    expectedRevisionId = undefined;
  } else if (typeof body.expectedRevisionId === 'string') {
    try {
      expectedRevisionId = parseExecutionPlanRevisionId(body.expectedRevisionId);
    } catch {
      return {
        ok: false,
        status: 400,
        code: 'execution_plan_revision_invalid',
        message: `expectedRevisionId must be null or a canonical four-digit revision id; got ${JSON.stringify(body.expectedRevisionId)}.`,
      };
    }
  } else {
    return {
      ok: false,
      status: 400,
      code: 'execution_plan_revision_invalid',
      message: 'expectedRevisionId must be null or a canonical four-digit revision id.',
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
  return run(async () =>
    publicExecutionPlanResult(await StoreIssuesModuleInstance.publishPlan({
      ...writeScope(space),
      issueId: selected.selector,
      nodes: rawNodes as unknown as readonly ExecutionPlanNodeInput[],
      ...(expectedRevisionId === undefined ? {} : { expectedRevisionId }),
      pipelineKnown: (name: string) =>
        listPipelines(space.root).includes(name.replace(/\.ya?ml$/, '')),
    }))
  );
}
