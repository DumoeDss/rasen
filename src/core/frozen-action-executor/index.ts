/**
 * Frozen-action session executor: the authoritative layer that consumes
 * granted frozen Actions and runs them through real, recoverable, auditable
 * Sessions on a declared two-backend roster.
 *
 * See `rasen/specs/frozen-action-session-executor/` (once synced) and the
 * change `ecp-frozen-action-session-executor` for the governing decisions.
 */

export {
  BACKEND_DECLARATIONS,
  HOSTED_BEST_EFFORT_DECLARATION,
  IN_TOOL_DECLARATION,
  DECLARED_OPERATING_SYSTEMS,
  buildExecutionCapabilityMatrix,
  currentHostCells,
  queryCapabilityCell,
  resolveBackendSelection,
  type BackendDeclaration,
  type BackendSelection,
  type BackendSelectionOrigin,
  type BuildCapabilityMatrixOptions,
  type CapabilityAvailabilityVerdict,
  type AuthorityUnavailableReason,
  type DeclaredOperatingSystem,
  type ExecutionBackendId,
  type ExecutionCapabilityCell,
  type ExecutionCapabilityMatrix,
  type HostedTierStatus,
  type ResolveBackendSelectionOptions,
} from './capability-matrix.js';

export {
  isCommittedInvocation,
  partitionCommittedFrontier,
  reconcileActionOutcome,
  type ActionOutcome,
  type ActionOutcomeKind,
  type CommittedFrontierPartition,
  type InvocationCommitmentState,
  type OwnershipLiveness,
  type ReconcileActionOutcomeOptions,
  type TurnResult,
} from './action-outcome.js';

export {
  validateGrantedAction,
  type AuthorityRejectionCode,
  type AuthorityValidationResult,
  type InFlightDispatchLedger,
  type ValidateGrantedActionOptions,
} from './authority.js';

export {
  DEFAULT_EXECUTOR_POLICY_BLOCK,
  decideReuse,
  isPlaceholderLimit,
  resolveReusePolicy,
  type AuthoredSessionGuidance,
  type ExecutorPolicyBlock,
  type PolicyProvenance,
  type ProvenancedLimit,
  type ProvenancedReuseScope,
  type ReuseAuthorityContext,
  type ReuseDecision,
  type ResolvedReusePolicy,
  type SessionReuseAuthoredScope,
} from './reuse-policy.js';

export {
  publishCompletionTransactionally,
  rereadVerifyCompletion,
  storeHoldsCompleteSet,
  verifyCompleteEvidenceSet,
  TransactionalCompletionError,
  type CompletionEvidenceUpload,
  type PublishOutcome,
  type TransactionalCompletionErrorCode,
} from './transactional-completion.js';

export {
  SELF_HOSTING_PROOF_SEAM,
  dispatchGrantedAction,
  dispatchGrantedContinuation,
  type DispatchContinuationOptions,
  type DispatchGrantedActionOptions,
  type ExecutionDispatchResult,
  type ExecutorBackends,
  type ExecutorBackendSeam,
  type HostedBackendSeam,
  type InToolBackendSeam,
} from './executor.js';

export {
  REGISTRY_FORBIDDEN_COMPLETION_FIELDS,
  RegistryGuardError,
  assertRegistryHoldsLifecycleOnly,
  projectRegistryLifecycleFacts,
  type AttributionFactSet,
  type RegistryForbiddenField,
  type RegistryGuardErrorCode,
  type RegistryLifecycleFacts,
} from './attribution.js';

export {
  actionExecuteRequestId,
  createHostedBackendSeamFromSessionHost,
  createInToolBackendSeamFromLauncherLiveness,
  createProductionExecutor,
  turnResultFromHostOutcome,
  type HostedBackendSeamOptions,
  type LauncherLivenessProbe,
  type ProductionExecutor,
  type ProductionExecutorOptions,
} from './production-executor.js';

export {
  createProductionConsultationDriver,
  summarizeExactTeacherRetainedWait,
  type ExactTeacherRetainedWaitReason,
  type ExactTeacherRetainedWaitSummary,
  type ProductionConsultationContinuationDriveResult,
  type ProductionConsultationDriveResult,
  type ProductionConsultationDriverOptions,
  type TrustedCompletionProducerResolver,
} from './consultation-driver.js';
export {
  createExactTeacherAuthorityPolicyForTesting,
  createProductionExactTeacherAuthorityPolicy,
  type ExactTeacherAuthorityAvailability,
  type ExactTeacherAuthorityLane,
  type ExactTeacherAuthorityPolicy,
  type ExactTeacherHostPlatform,
  type ProductionExactTeacherAuthorityPolicyOptions,
} from './exact-teacher-authority.js';
export {
  EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA,
  EXACT_TEACHER_ATTEMPT_PHASES,
  createExactTeacherAttemptJournal,
  type ExactTeacherAttemptJournal,
  type ExactTeacherAttemptJournalAdvance,
  type ExactTeacherAttemptJournalOptions,
  type ExactTeacherAttemptJournalRecord,
  type ExactTeacherAttemptPhase,
  type ExactTeacherHostedReceiptIdentity,
} from './exact-teacher-attempt-journal.js';
export {
  classifyExactTeacherAuthorityRecovery,
  planExactTeacherAttemptRecovery,
  type ClassifyExactTeacherAuthorityRecoveryInput,
  type ExactTeacherAuthorityRecoveryDisposition,
  type ExactTeacherAuthorityRecoveryObservation,
  type ExactTeacherAttemptRecoveryPlan,
  type ExactTeacherAttemptRecoverySafety,
  type ExactTeacherCanonicalAttemptIdentity,
  type ExactTeacherPersistedAuthority,
  type ExactTeacherProviderPublicationFact,
  type ExactTeacherRecoveryOperation,
  type PlanExactTeacherAttemptRecoveryInput,
} from './exact-teacher-attempt-recovery.js';
export {
  createExactTeacherAttemptModule,
  type CanonicalTeacherAdviceSettlement,
  type CanonicalTeacherUnavailableSettlement,
  type ExactTeacherActivatedAuthority,
  type ExactTeacherAdviceValidation,
  type ExactTeacherAttemptLocator,
  type ExactTeacherAttemptModule,
  type ExactTeacherAttemptModuleOptions,
  type ExactTeacherAttemptPhaseFacts,
  type ExactTeacherAttemptRecoveryState,
  type ExactTeacherAttemptRecoveryStep,
  type ExactTeacherAttemptSettlement,
  type ExactTeacherAuthorityPreparation,
  type ExactTeacherAuthorityRetained,
  type ExactTeacherBaselineObservation,
  type ExactTeacherFinalObservation,
  type ExactTeacherPublishedAuthority,
  type ExactTeacherResolvedAttempt,
  type ExactTeacherResultQuarantine,
  type ExactTeacherSettledTurn,
  type ExactTeacherTurnOutcome,
} from './exact-teacher-attempt-module.js';
export {
  createExactTeacherAttemptPersistence,
  type ExactTeacherAttemptPersistenceOptions,
} from './exact-teacher-attempt-persistence.js';
