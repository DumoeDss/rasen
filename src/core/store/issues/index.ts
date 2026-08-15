/**
 * `store-issue-resources` — the single public entry point.
 *
 * Consumers import the Module, its Interface types, and its diagnostics from
 * here. The schemas, the graph checker, reference verification, the write
 * location rule, and the lock protocol are internal.
 */
export * from './types.js';
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
  serializeIssueRecord,
  validateIssueRecord,
  validateIssueRecordLocation,
} from './records.js';
export {
  checkExecutionPlanGraph,
  executionPlanDigest,
  findPlanNodeSchemaProblems,
  normalizePlanNodes,
  parseExecutionPlanRevision,
  serializeExecutionPlanRevision,
  validateExecutionPlanRevision,
  type GraphViolation,
  type PlanNodeSchemaProblem,
} from './plans.js';
export {
  STORE_LOCK_ORDER,
  assertIssueAcquisitionOrder,
  assertStoreLockOrderAgreesWithWorkspace,
  heldStoreLockKinds,
  issueLockFileName,
  issueLockHeld,
  issueLockKey,
  issueLockPath,
  withIssueLock,
  type IssueLockKey,
  type StoreLockKind,
} from './locks.js';
export {
  issueAddresses,
  issuePathspec,
  resolveIssueScope,
  revisionAddress,
  type ResolvedIssueScope,
} from './scope.js';
