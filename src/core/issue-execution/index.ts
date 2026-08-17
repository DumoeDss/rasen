/**
 * `src/core/issue-execution/` — resolving an Issue node's bound execution
 * context and emitting the launch contract.
 *
 * Composes — never rebuilds — the L6 `resolveSessionLaunchContext` machinery
 * (through an injectable seam), the machine workspace index, and the
 * `issue-status` projection's observations. Read-only by construction:
 * starting an Issue's node is resolution and verification; the pipeline is
 * driven by the operator or agent session that receives the contract.
 */
export { resolveIssueLaunchBinding, refusalFix } from './binding.js';
export type {
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
