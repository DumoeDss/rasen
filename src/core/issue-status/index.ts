/**
 * `src/core/issue-status/` — the Issue tri-axis status projection.
 *
 * Derives `phase × health × progress` for one Store Issue from its latest
 * immutable Execution Plan revision, committed Store evidence, the real
 * run-state of the referenced Changes on the machine the read runs from, and
 * the Issue's recorded acceptance. Read-only, derived on demand, persisted
 * nowhere. Imports — never modifies — the pipeline-registry run-state readers
 * and the store aggregate query.
 */
export { deriveRevisionDelta, issueBlockerState, projectIssueStatus } from './projection.js';
export { deriveIssueReadySet } from './ready-set.js';
export {
  deriveIssueAttention,
  ISSUE_ATTENTION_KIND_ORDER,
  issueAttentionKindRank,
} from './attention.js';
export { deriveIssueDeliveryEvidence } from './delivery.js';
export type {
  IssueAttentionBlocker,
  IssueAttentionItem,
  IssueAttentionKind,
  IssueDeliveryCounts,
  IssueDeliveryEntry,
  IssueDeliveryEvidence,
  IssueHealth,
  IssueNodeAttribution,
  IssueNodeBlocker,
  IssueNodeDelivery,
  IssueNodeObservation,
  IssueNodeSession,
  IssueNodeStatus,
  IssuePhase,
  IssueProgress,
  IssueProjectLane,
  IssueReadyBlocker,
  IssueReadyExit,
  IssueReadyExitEntry,
  IssueReadyMember,
  IssueReadySet,
  IssueRevisionDelta,
  IssueRevisionEdgeChange,
  IssueRevisionLifecycleChange,
  IssueRevisionRetarget,
  IssueRevisionSuggestionChange,
  IssueRunStateLocator,
  IssueRunStateVisibility,
  IssueStatus,
  IssueStatusProblem,
  IssueStatusProblemKind,
  ProjectIssueStatusInput,
} from './types.js';
