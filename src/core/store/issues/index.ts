/**
 * `store-issue-resources` — the single public entry point.
 *
 * Consumers import the Module, its Interface types, and its diagnostics from
 * here. The schemas, the graph checker, reference verification, the write
 * location rule, and the lock protocol are internal.
 */
export * from './types.js';
export * from './identity.js';
export {
  StoreIssueError,
  isStoreIssueError,
  issueError,
  issueRefusal,
} from './diagnostics.js';
export { StoreIssuesModule, StoreIssuesModuleInstance, type StoreIssuesOptions } from './module.js';
export {
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type StoreIssueDependencies,
} from './dependencies.js';
export {
  ISSUE_STATES,
  TERMINAL_ISSUE_STATES,
  isPermittedIssueTransition,
  parseIssueRecord,
  parseStoredIssueRecord,
  serializeIssueRecord,
  serializeIssueRecordV2,
  serializeStoredIssueRecord,
  validateIssueRecord,
  validateIssueRecordV2,
  validateIssueRecordLocation,
} from './records.js';
export {
  assertPlanNodeSuggestions,
  checkExecutionPlanGraph,
  executionPlanDigest,
  normalizePlanNodes,
  parseExecutionPlanRevision,
  serializeExecutionPlanRevision,
  validateExecutionPlanRevision,
  type GraphViolation,
} from './plans.js';
export {
  acceptanceConditionsDigest,
  acceptedRecordDigest,
  acceptanceConditionsDigestBody,
  acceptedRecordDigestBody,
  assertCoherentGateSnapshot,
  normalizeAcceptanceConditions,
  parseAcceptanceConditionsRevision,
  parseAcceptedRecord,
  serializeAcceptanceConditionsRevision,
  serializeAcceptedRecord,
  validateAcceptanceConditionsRevision,
  validateAcceptedRecord,
} from './acceptance.js';
export {
  compileMigrationIssueTree,
  type CompiledMigrationIssueFile,
  type CompiledMigrationIssueTree,
  type MigrationIssueFileRole,
  type MigrationIssueInput,
} from './migration-compiler.js';
export {
  STORE_LOCK_ORDER,
  assertIssueAllocationAcquisitionOrder,
  assertIssueAcquisitionOrder,
  assertStoreLockOrderAgreesWithWorkspace,
  heldStoreLockKinds,
  issueAllocationLockHeld,
  issueAllocationLockKey,
  heldIssueLockKeys,
  issueLockCanonicalBytes,
  issueLockFileName,
  issueLockHeld,
  issueLockKey,
  issueLockPath,
  withIssueLock,
  withIssueAllocationLock,
  withIssueLockBatch,
  type IssueAllocationLockKey,
  type IssueAllocationLockOptions,
  type IssueLockKey,
  type StoreLockKind,
} from './locks.js';
export {
  acceptanceRevisionAddress,
  issueAddresses,
  issuePathspec,
  resolveIssueScope,
  revisionAddress,
  type ResolvedIssueScope,
} from './scope.js';
