/**
 * `src/core/issue-status/` — the Issue tri-axis status projection.
 *
 * Derives `phase × health × progress` for one Store Issue from its latest
 * immutable Execution Plan revision, committed Store evidence, and the real
 * run-state of the referenced Changes on the machine the read runs from.
 * Read-only, derived on demand, persisted nowhere. Imports — never modifies —
 * the pipeline-registry run-state readers and the store aggregate query.
 */
export { projectIssueStatus } from './projection.js';
export type {
  IssueHealth,
  IssueNodeObservation,
  IssueNodeStatus,
  IssuePhase,
  IssueProgress,
  IssueRunStateVisibility,
  IssueStatus,
  IssueStatusProblem,
  IssueStatusProblemKind,
  ProjectIssueStatusInput,
} from './types.js';
