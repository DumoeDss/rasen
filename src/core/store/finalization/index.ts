/**
 * `store-finalization-outcomes-v2` — the single public entry point.
 *
 * Callers import the Module, its Interface types, and its diagnostics from
 * here. Outcome resolution, the reachability prover, successor search, the
 * record producer, association completion, and the lock protocol are internal.
 */
export * from './types.js';
export {
  ChangeFinalizationError,
  isChangeFinalizationError,
  finalizationBlocker,
  finalizationError,
  finalizationRefusal,
} from './diagnostics.js';
export {
  ChangeFinalization,
  ChangeFinalizationModuleInstance,
  finalizationPlanId,
  inspectFinalizationApplyPlan,
  type ChangeFinalizationOptions,
} from './module.js';
export {
  FINALIZATION_GIT_VERBS,
  nodeFinalizationGit,
  productionFinalizationDependencies,
  withDeterministicFinalizationClock,
  type FinalizationDependencies,
  type FinalizationGit,
} from './dependencies.js';
export {
  resolveFinalizationOutcomeRequest,
  validateResolvedOutcome,
  type ResolvedOutcomeRequest,
} from './outcome.js';
export {
  proveLandedReachability,
  resolveCodeCommitCandidate,
  undeclaredImplementationRefusal,
} from './reachability.js';
export {
  requireSingleSuccessor,
  searchSuccessor,
  type SuccessorSearchResult,
} from './successor.js';
export {
  archiveSpecActionFor,
  archiveSpecActionsFor,
  specSkipConflict,
} from './spec-actions.js';
export {
  archiveEntryAddress,
  assertFrozenTargetLine,
  buildArchiveV2RecordDraft,
  workspacePairUnavailable,
} from './record.js';
export { completeFinalizationAssociation } from './association.js';
export {
  finalizationLockKeys,
  recordedLockKeys,
  unheldIntegrationLockKey,
  withFinalizationLocks,
} from './locks.js';
