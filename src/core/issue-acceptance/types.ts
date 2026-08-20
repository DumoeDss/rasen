/**
 * `issue-acceptance-close` — the acceptance gate's contracts.
 *
 * The gate is DERIVED, never stored: eligibility is recomputed on every read
 * from the tri-axis status and the Issue's acceptance content. What is durable
 * is the conditions revision and (after an acceptance) the record that froze
 * the gate snapshot it was accepted under — both live in `store/issues`, which
 * this module composes but never imports upward into (design D2: the C2
 * composition pattern; an `issue-status` import inside `store/issues` would
 * close a package-level cycle through `query/issues-read`).
 *
 * Type-only imports below point at `issue-status` — the projection and this
 * module share types, not runtime edges. The one RUNTIME edge between them is
 * `projection.ts -> gate.js`, which imports no runtime symbol back, so no
 * module cycle exists at load time.
 */
import type {
  AcceptanceConditionsRevisionV1,
  AcceptanceGateSnapshot,
  IssueAcceptedRecordV1,
  IssueState,
} from '../store/issues/types.js';
import type {
  IssueHealth,
  IssueNodeObservation,
  IssueNodeStatus,
  IssueStatusProblem,
  IssueStatusProblemKind,
} from '../issue-status/types.js';
import type { ExecutionPlanRevisionId } from '../store/planning-validation.js';

// -----------------------------------------------------------------------------
// The acceptance facts (what a read learned about the Issue's acceptance content)
// -----------------------------------------------------------------------------

/** The latest acceptance-conditions revision read back, or why it could not be. */
export interface IssueAcceptanceConditionsRead {
  /** The parsed, digest-verified revision; null when none reads back. */
  readonly revision: AcceptanceConditionsRevisionV1 | null;
  /** The latest ordinal seen, even when its content did not read back. */
  readonly revisionId: ExecutionPlanRevisionId | null;
  readonly diagnostic: string | null;
  /** The absolute file the bytes came from, when one was reached. */
  readonly path: string | null;
}

/**
 * The acceptance record read back. `present` is the honest distinction the
 * done rule and the `already accepted` refusal both need: a record that
 * EXISTS but does not verify is present (never re-acceptable) while reading
 * back null (never done-from-unreadable-bytes).
 */
export interface IssueAcceptanceRecordRead {
  readonly present: boolean;
  /** The parsed, digest-verified record; null when absent or unverifiable. */
  readonly record: IssueAcceptedRecordV1 | null;
  readonly diagnostic: string | null;
  /** The absolute file the bytes came from, when one was reached. */
  readonly path: string | null;
}

/**
 * The Issue's recorded acceptance, as one read found it — the fourth input of
 * the status projection and the acceptance-side input of the gate.
 */
export interface IssueAcceptanceFacts {
  readonly conditions: IssueAcceptanceConditionsRead;
  readonly acceptedRecord: IssueAcceptanceRecordRead;
}

// -----------------------------------------------------------------------------
// The gate
// -----------------------------------------------------------------------------

/**
 * The projection facts the D3 gate rule reads. A subset view of `IssueStatus`
 * (plus the Issue's operator-declared state, which the status itself does not
 * carry) so the projection can evaluate the gate over the facts it just
 * derived without assembling a full recursive status.
 */
export interface IssueAcceptanceGateView {
  /** The Issue record's operator-declared state, as the read presented it. */
  readonly issueState: IssueState | null;
  readonly nodes: readonly IssueNodeStatus[];
  readonly problems: readonly IssueStatusProblem[];
  readonly health: IssueHealth;
  readonly complete: boolean;
}

/**
 * The closed blocker taxonomy (design D3). Fact blockers are named TOGETHER —
 * every un-terminal node, every failing node, every open status problem —
 * never first-only: a one-at-a-time refusal turns correction into a guessing
 * loop.
 */
export type IssueAcceptanceBlocker =
  | {
      readonly kind: 'un-terminal-node';
      readonly nodeId: string;
      readonly observation: IssueNodeObservation;
    }
  | {
      readonly kind: 'failing-node';
      readonly nodeId: string;
    }
  | {
      readonly kind: 'status-problem';
      readonly problemKind: IssueStatusProblemKind;
      readonly node: string | null;
      readonly ref: string | null;
      readonly reason: string;
    }
  | {
      /** The read could not prove its own completeness (no more specific fact). */
      readonly kind: 'incomplete-read';
      readonly reason: string;
    };

/** The structural refusals, plus the one code that names fact blockers. */
export type IssueAcceptanceRefusalCode =
  | 'issue_accept_requires_plan'
  | 'issue_accept_conditions_required'
  | 'issue_accept_already_accepted'
  | 'issue_accept_dropped'
  | 'issue_accept_blocked';

/**
 * One node excluded from the gate's required total: a `cancelled` or
 * `superseded` node, with the reason its revision records. Carried beside the
 * gate — on both the eligible and the blocked evaluation — so a smaller total
 * is EXPLAINED rather than silently absorbed.
 */
export interface IssueAcceptanceGateExclusion {
  readonly nodeId: string;
  readonly lifecycle: 'cancelled' | 'superseded';
  readonly reason: string;
}

/**
 * One gate evaluation. Eligible names the conditions revision it would accept
 * and carries the portable snapshot an acceptance would freeze; not eligible
 * names EVERY blocker together, or the one structural reason that applies.
 * Both branches carry the lifecycle accounting beside the gate: the
 * cancelled/superseded exclusions always, and the optional node ids — named
 * wherever a render shows them, and never hidden by an empty required total.
 */
export type IssueAcceptanceGateEvaluation =
  | {
      readonly eligible: true;
      readonly conditionsRevisionId: ExecutionPlanRevisionId;
      readonly snapshot: AcceptanceGateSnapshot;
      readonly exclusions: readonly IssueAcceptanceGateExclusion[];
      readonly optionalNodes: readonly string[];
    }
  | {
      readonly eligible: false;
      readonly refusalCode: IssueAcceptanceRefusalCode;
      readonly blockers: readonly IssueAcceptanceBlocker[];
      readonly message: string;
      readonly exclusions: readonly IssueAcceptanceGateExclusion[];
      readonly optionalNodes: readonly string[];
    };

// -----------------------------------------------------------------------------
// The IssueStatus acceptance block
// -----------------------------------------------------------------------------

/**
 * What the projection exposes for display (design D2): the latest conditions
 * revision, the gate evaluated over THIS status, and the verified acceptance
 * record when one reads back. Derived on read; persisted nowhere.
 */
export interface IssueAcceptanceStatusBlock {
  readonly conditions: IssueAcceptanceConditionsRead;
  readonly gate: IssueAcceptanceGateEvaluation;
  readonly record: IssueAcceptedRecordV1 | null;
}
