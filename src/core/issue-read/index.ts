/**
 * `issue-read-surface` — the Issue read composition, the one assembly both
 * the CLI and the management API compose their Issue reads through.
 *
 * Deliberately its own module rather than a folder inside `issue-status/`:
 * that module is I/O-free by charter (pure derivations plus the one
 * documented run-state probe), and these compositions do Store reads. The
 * `issue-execution/confirm.ts` read-compose-report precedent.
 */
export {
  attentionCounts,
  composeIssueProjectionDetail,
  composeIssueProjectionList,
  composeStoreAttention,
  resolvePredecessorPlan,
  resolveStoreWideningContext,
  statusInputFor,
  type IssueProjectionDetailPayload,
  type IssueProjectionListEntry,
  type IssueProjectionListPayload,
  type IssueReadScope,
  type StoreAttentionPayload,
  type StoreAttentionScanEntry,
} from './composition.js';
export { resolveRunStateContext, type IssueRunStateContext } from './run-context.js';
export {
  composeChangeIssueLinks,
  type ChangeIssueAssociation,
  type ChangeIssueEligibility,
  type ChangeIssueLink,
  type ChangeIssueLinkEntry,
  type ChangeIssueLinksPayload,
  type ChangeOccurrence,
} from './change-links.js';
