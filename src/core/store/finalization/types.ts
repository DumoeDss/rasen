/**
 * `store-finalization-outcomes-v2` — the Interface types for the one Module
 * that decides, proves, plans, and applies a Change's terminal state.
 *
 * Everything a caller may see lives here: the outcome request, the immutable
 * plan and its token, the result, and the closed error taxonomy. Outcome
 * semantics, Git reachability, successor search across Store refs, layout
 * addressing, record serialization, association completion, the lock protocol,
 * and the underlying archive transaction all stay behind the Module.
 */
import type {
  ArchiveAssociationPlan,
  ArchiveFinalizationLockKey,
  ArchivePlan,
  ArchiveSidecarProjection,
  ArchiveBlocker,
  PreparedArchiveSpecAction,
  ArchiveApplyAssertions,
  ArchiveAbortResult,
} from '../../archive-engine.js';
import type {
  ArchiveV2IdentityPreimages,
  ArchiveV2RecordDraft,
} from '../../archive-accounting-v2.js';
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';

// -----------------------------------------------------------------------------
// Outcomes
// -----------------------------------------------------------------------------

export const FINALIZATION_OUTCOMES = [
  'landed',
  'superseded',
  'cancelled',
  'abandoned',
] as const;

export type FinalizationOutcomeName = (typeof FINALIZATION_OUTCOMES)[number];

/**
 * The raw request as a surface supplies it. Nothing here is trusted: the
 * outcome string is validated through the canonical finalization-record
 * validator, and every combination rule is checked before any access.
 */
export interface FinalizationOutcomeRequest {
  readonly outcome?: string;
  readonly reason?: string;
  /** The successor Change instance a `superseded` outcome names. */
  readonly by?: string;
  /** Narrows the successor search to one target line. Never a substitute for verification. */
  readonly byTargetLine?: string;
  /** A candidate commit for the landed proof. Never a bypass for it. */
  readonly commit?: string;
}

// -----------------------------------------------------------------------------
// Archive preparation handed in by the calling surface
// -----------------------------------------------------------------------------

/**
 * What the archive transaction needs, prepared by the surface that already
 * resolved it (validation, task progress, sidecar, cleaner inputs, ship log).
 * The Module owns the finalization decision; it does not re-implement archive
 * preparation, and the surface holds no outcome logic.
 *
 * `specActionCandidates` are the prepared spec actions the surface built. They
 * are consumed only by a landed outcome — the passive plan variants have no
 * field that could carry them.
 */
export interface FinalizationArchivePreparation {
  readonly planningRoot: string;
  readonly executionRoot: string;
  readonly activePath: string;
  readonly archiveParent: string;
  readonly ephemeraPath: string;
  readonly date: string;
  readonly keepEphemera: boolean;
  readonly validation: ArchivePlan['decisions']['validation'];
  readonly tasks: ArchivePlan['decisions']['tasks'];
  readonly timing: ArchivePlan['decisions']['timing'];
  readonly specActionCandidates: readonly PreparedArchiveSpecAction[];
  /** True when the change carries delta specs, whether or not they were prepared. */
  readonly hasDeltaSpecs: boolean;
  readonly sidecar: ArchiveSidecarProjection;
  readonly shipLog: ArchivePlan['shipLog'];
  readonly scope: ArchivePlan['scope'];
  readonly preparationBlockers?: readonly ArchiveBlocker[];
  readonly transactionId?: string;
  readonly createdAt?: string;
}

export interface FinalizeChangeInput {
  readonly changeId: string;
  readonly outcome: FinalizationOutcomeRequest;
  readonly skipSpecs?: boolean;
  /** Absolute command boundary the caller captured. */
  readonly startPath: string;
  readonly selection?: {
    readonly store?: string;
    readonly project?: string;
    readonly targetLine?: string;
  };
  readonly globalDataDir?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
  readonly archive: FinalizationArchivePreparation;
}

export type DescribeFinalizationInput = Omit<FinalizeChangeInput, 'archive'> & {
  readonly archive?: FinalizationArchivePreparation;
};

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

/** One unsatisfied precondition, reported with its values rather than thrown. */
export interface FinalizationBlocker {
  readonly code: FinalizationErrorCode;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly fix?: string;
  readonly archiveBlocker?: ArchiveBlocker;
}

export interface FinalizationApplyInspection {
  readonly applicable: boolean;
  readonly blockers: readonly FinalizationBlocker[];
}

export interface FinalizationScopeFacts {
  readonly storeUid: string;
  readonly storeId: string;
  readonly storeRoot: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly planningScopeId: string;
}

export interface FinalizationTargetLineFacts {
  readonly targetLineId: string;
  readonly storeRef: string;
  readonly storeRefOid: string;
  readonly codeRef: string | null;
  /** Frozen at proof time. A ref that moves makes the plan stale, never re-proven. */
  readonly codeRefOid: string | null;
  readonly catalogPath: string;
  readonly catalogDigest: string;
}

export interface FinalizationWorktreeFacts {
  readonly root: string;
  readonly worktreeInstanceId: string;
  readonly repositoryIdentity: string;
  readonly ref: string;
  readonly headOid: string;
}

/** How the landed proof's candidate commit was obtained, and what it proved. */
export interface FinalizationLandedProof {
  readonly source: 'flag' | 'ship-log' | 'execution-head';
  readonly commit: string;
  readonly codeRef: string;
  readonly codeRefOid: string;
  readonly reachable: true;
  /**
   * Rasen fetches nothing. The proof is stated against the ref as it stands in
   * the local repository at proof time.
   */
  readonly statedAgainst: 'local-ref';
  readonly repositoryRoot: string;
}

export interface FinalizationSuccessorEvidence {
  readonly changeInstanceId: string;
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeId: string;
  /** The Store ref the successor's committed metadata was read from. */
  readonly foundAtRef: string;
  readonly blobPath: string;
  readonly digest: string;
  readonly archived: boolean;
}

export interface FinalizationPlanToken {
  readonly planId: string;
  readonly archivePlanToken: string;
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeInstanceId: string;
  readonly workspacePairId: string;
  readonly planningHeadOid: string;
  readonly codeRefOid: string | null;
  readonly sourceFingerprint: string;
}

export interface FinalizationPlanBase {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly createdAt: string;
  readonly scope: FinalizationScopeFacts;
  readonly changeId: string;
  readonly changeInstanceId: string;
  readonly workspacePairId: string;
  readonly implementation: 'code' | 'none';
  readonly targetLine: FinalizationTargetLineFacts;
  readonly planning: FinalizationWorktreeFacts;
  readonly execution: FinalizationWorktreeFacts;
  /** The Foundation-computed entry address, derived from the FROZEN target line. */
  readonly destination: string;
  readonly recordDraft: ArchiveV2RecordDraft;
  /**
   * The evidence paths the published entry is expected to carry. Digests are
   * deliberately absent: the transaction appends an `## Archive` section to the
   * staged ship log, so any digest computed now would not be the published one.
   * The writer hashes the published tree.
   */
  readonly evidenceInventory: readonly string[];
  readonly association: ArchiveAssociationPlan;
  readonly lockKeys: readonly ArchiveFinalizationLockKey[];
  readonly archivePlan: ArchivePlan;
  readonly blockers: readonly FinalizationBlocker[];
  readonly applicable: boolean;
  /** True when this Change's entry is already published under a matching transaction. */
  readonly alreadyComplete: boolean;
  readonly token?: FinalizationPlanToken;
}

/**
 * The plan is a discriminated union on the outcome, and ONLY the landed variant
 * has a `specActions` field. A passive plan therefore has nothing to populate,
 * so "did we remember to skip spec synchronization?" is not a question any call
 * site can get wrong.
 */
export type ImmutableFinalizationPlan =
  | (FinalizationPlanBase & {
      readonly outcome: 'landed';
      readonly specActions: readonly PreparedArchiveSpecAction[];
      readonly landedProof: FinalizationLandedProof | null;
    })
  | (FinalizationPlanBase & {
      readonly outcome: 'superseded';
      readonly reason: string;
      readonly supersededBy: string;
      readonly successor: FinalizationSuccessorEvidence | null;
    })
  | (FinalizationPlanBase & {
      readonly outcome: 'cancelled' | 'abandoned';
      readonly reason: string;
    });

/** Every plan variant that is passive history and applies no delta. */
export type PassiveFinalizationPlan = Extract<
  ImmutableFinalizationPlan,
  { outcome: 'superseded' | 'cancelled' | 'abandoned' }
>;

export type LandedFinalizationPlan = Extract<
  ImmutableFinalizationPlan,
  { outcome: 'landed' }
>;

/**
 * Per-member. This conditional DISTRIBUTES over a naked union type parameter,
 * which is what makes it the right question to ask — the invariant is "does ANY
 * passive member carry `specActions`", not "do all of them".
 */
type CarriesSpecActions<T> = T extends { specActions: unknown } ? true : false;

/** Mutual assignability. Bracketed, so neither side distributes. */
type IsExactly<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

/**
 * `false` when `T` is EXACTLY `false`, and `never` otherwise — so a constant
 * declared with it and initialized to `false` stops compiling the moment `T`
 * widens.
 *
 * This indirection is the guard, and two SIMPLER spellings were both measured
 * and both rejected:
 *
 * - `const X: CarriesSpecActions<Passive> = false` — the original. When one of
 *   the three passive members gains `specActions`, distribution makes the alias
 *   `true | false`, i.e. `boolean`, and `false` is assignable to `boolean`. The
 *   proof compiled cleanly in exactly the case it existed to reject.
 * - `type CarriesSpecActions<T> = [T] extends [{ specActions: unknown }] ? …` —
 *   suppressing distribution instead. This is WORSE, not better: it asks
 *   whether EVERY member carries the field, so one offending member leaves the
 *   answer `false` and `= false` still compiles. Verified by mutation against
 *   this repository's own `tsc`: with the brackets and `specActions` added to
 *   the `superseded` variant, `tsc --noEmit` exits 0.
 *
 * Widening to `never` is what neither of those does. Mutation-verified in both
 * directions: `superseded` gaining the field fails the build, and `landed`
 * losing it fails the build.
 */
type ExactlyFalse<T> = IsExactly<T, false> extends true ? false : never;

/** The counterpart, for the one variant that MUST carry them. */
type ExactlyTrue<T> = IsExactly<T, true> extends true ? true : never;

/**
 * The structural proof, checked by `tsc` rather than by a reviewer's memory:
 * NO passive plan variant is assignable to any shape carrying `specActions`.
 * If a future edit adds the field to a passive variant — or widens the union so
 * one member gains it — this constant stops being assignable and the build
 * fails, which is the only place "did we remember to skip spec sync?" can be
 * caught before it is a defect.
 *
 * `test/core/store/finalization-plan-union.test.ts` reads both constants, so
 * the guard is also visible from the suite that owns the invariant.
 */
export const PASSIVE_PLAN_CARRIES_SPEC_ACTIONS: ExactlyFalse<
  CarriesSpecActions<PassiveFinalizationPlan>
> = false;

/** The counterpart: the landed variant is the ONLY one that carries them. */
export const LANDED_PLAN_CARRIES_SPEC_ACTIONS: ExactlyTrue<
  CarriesSpecActions<LandedFinalizationPlan>
> = true;

export interface FinalizationResult {
  readonly planId: string;
  readonly outcome: FinalizationOutcomeName;
  readonly changeId: string;
  readonly changeInstanceId: string;
  readonly workspacePairId: string;
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly publishedEntry: string;
  readonly specSyncApplied: boolean;
  readonly specSyncActionCount: number;
  readonly provenCommit: string | null;
  readonly codeRef: string | null;
  readonly codeRefOid: string | null;
  readonly associationPhase: 'applied' | 'no-op';
  readonly status: ArchivePlanApplyStatus;
  readonly transactionId: string;
  readonly journalPath: string;
  readonly blockers: readonly FinalizationBlocker[];
}

export type ArchivePlanApplyStatus =
  | 'complete'
  | 'blocked'
  | 'recoverable'
  | 'abort-required';

export interface ChangeFinalizationModule {
  plan(input: FinalizeChangeInput): Promise<ImmutableFinalizationPlan>;
  apply(
    token: FinalizationPlanToken,
    assertions?: ArchiveApplyAssertions
  ): Promise<FinalizationResult>;
  abortStoredPlan(
    archivePlan: ArchivePlan,
    globalDataDir: string
  ): Promise<ArchiveAbortResult>;
  describe(input: DescribeFinalizationInput): Promise<FinalizationDescription>;
}

export interface FinalizationDescription {
  readonly changeId: string;
  readonly scope: FinalizationScopeFacts | null;
  readonly changeInstanceId: string | null;
  readonly workspacePairId: string | null;
  readonly finalized: boolean;
  readonly recordedOutcome: FinalizationOutcomeName | null;
  readonly publishedEntry: string | null;
  readonly blockers: readonly FinalizationBlocker[];
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * The closed refusal taxonomy. Each code names the disagreeing values and
 * carries a repair hint; none of them has an override flag.
 */
export const FINALIZATION_ERROR_CODES = [
  'finalization_outcome_required',
  'finalization_outcome_invalid',
  'finalization_already_complete',
  'finalization_plan_stale',
  'finalization_spec_skip_conflict',
  'finalization_scope_unsupported',
  'landed_commit_unresolved',
  'landed_commit_unreachable',
  'landed_proof_unavailable',
  'landed_implementation_undeclared',
  'successor_scope_unverified',
  'successor_ambiguous',
  'workspace_pair_unavailable',
  'target_line_mismatch',
  'target_line_ref_unresolved',
  'planning_execution_binding_mismatch',
  'finalization_lock_unavailable',
  'finalization_record_invalid',
] as const;

export type FinalizationErrorCode = (typeof FINALIZATION_ERROR_CODES)[number];

export type { ArchiveV2IdentityPreimages, ArchiveV2RecordDraft };
