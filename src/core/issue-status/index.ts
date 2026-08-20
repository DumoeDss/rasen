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
export { issueBlockerState, projectIssueStatus } from './projection.js';
export type {
  IssueHealth,
  IssueNodeAttribution,
  IssueNodeBlocker,
  IssueNodeObservation,
  IssueNodeSession,
  IssueNodeStatus,
  IssuePhase,
  IssueProgress,
  IssueRunStateLocator,
  IssueRunStateVisibility,
  IssueStatus,
  IssueStatusProblem,
  IssueStatusProblemKind,
  ProjectIssueStatusInput,
} from './types.js';
