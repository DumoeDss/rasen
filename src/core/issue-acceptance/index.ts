/**
 * `issue-acceptance-close` — the single public entry point.
 *
 * The gate and its contracts are pure; the orchestration composes the store
 * query, the status projection's one seam, and the mutation Module without
 * giving `store/issues` any upward dependency (design D2).
 */
export type {
  IssueAcceptanceBlocker,
  IssueAcceptanceConditionsRead,
  IssueAcceptanceFacts,
  IssueAcceptanceGateEvaluation,
  IssueAcceptanceGateExclusion,
  IssueAcceptanceGateView,
  IssueAcceptanceRecordRead,
  IssueAcceptanceRefusalCode,
  IssueAcceptanceStatusBlock,
} from './types.js';
export {
  acceptanceRefusalFix,
  evaluateIssueAcceptanceGate,
} from './gate.js';
export {
  acceptIssue,
  readIssueAcceptanceFacts,
  type AcceptIssueOrchestrationInput,
  type AcceptIssueProjectionContext,
  type ReadAcceptanceFactsInput,
  type ReadAcceptanceFactsOptions,
} from './orchestration.js';
