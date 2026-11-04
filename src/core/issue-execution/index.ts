/**
 * `src/core/issue-execution/` — resolving an Issue node's bound execution
 * context, emitting the launch contract, and composing the confirm report.
 *
 * Composes — never rebuilds — the L6 `resolveSessionLaunchContext` machinery
 * (through an injectable seam), the machine workspace index, and the
 * `issue-status` projection's observations. Read-only by construction:
 * starting an Issue's node is resolution and verification; the pipeline is
 * driven by the operator or agent session that receives the contract. Confirm
 * (`confirm.ts`) is the same discipline at plan scope: it composes the
 * verified contract set and pending-Change report for one revision and writes
 * nothing.
 */
export { resolveIssueLaunchBinding, refusalFix } from './binding.js';
export { composeIssueConfirm } from './confirm.js';
export type {
  ComposeIssueConfirmInput,
  ComposeIssueConfirmResult,
  IssueConfirmPendingChange,
  IssueConfirmRefusal,
  IssueConfirmRefusalCode,
  IssueConfirmReport,
  IssueConfirmUnpreparedNode,
  IssueConfirmWaitingNode,
  IssueLaunchBinding,
  IssueLaunchContext,
  IssueLaunchContextFor,
  IssueLaunchForm,
  IssueLaunchMode,
  IssuePipelineKnown,
  IssueStartRefusal,
  IssueStartRefusalCode,
  ResolveIssueLaunchBindingInput,
  ResolveIssueLaunchBindingResult,
} from './types.js';
