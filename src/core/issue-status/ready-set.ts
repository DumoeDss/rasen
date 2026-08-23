/**
 * `issue-ready-set-scheduling` — the deterministic ready-set derivation
 * (design D1): a post-pass over the status projection's own node facts, beside
 * the lanes and the revision delta, consuming ONLY the projection output and
 * persisted nowhere.
 *
 * Membership is exactly: kind `change`, lifecycle the plan still wants
 * (`required`/`optional`), observation `not-started`, and `blockedBy` empty.
 * This is not a re-derivation: `withBlockerFacts` already computes the
 * work-complete gate list over the same observations `store issue start` gates
 * on, so `blockedBy` empty IS the dependency clause of runnable — the
 * projection is the seam, and the ready set is its scheduling view. One
 * derivation, three consumers (the `ready` read verb, `start`'s frontier,
 * `confirm`'s launchable scope), pinned by equivalence tests so the surfaces
 * cannot drift.
 *
 * Every non-member is named with a reason from the closed exit vocabulary —
 * nothing is silently dropped, and no reason names a state the projection did
 * not observe. Dependency gating is edge-wise and project-blind exactly as the
 * start gate gates: a cross-project dependency releases its downstream exactly
 * as a same-project one does, on completed work.
 */
import { issueBlockerState } from './projection.js';
import type {
  IssueNodeStatus,
  IssueReadyExit,
  IssueReadyExitEntry,
  IssueReadyMember,
  IssueReadySet,
  IssueStatus,
} from './types.js';

/**
 * Whether a change node's lifecycle still wants its work: `required` or
 * `optional`. `cancelled`/`superseded`/`deferred` are outside the execution
 * graph — abandoned, replaced, or postponed — and intent nodes have no work to
 * run. The check is POSITIVE, so a lifecycle value added to the vocabulary
 * falls out of membership rather than into it.
 */
function isWanted(node: IssueNodeStatus): boolean {
  return node.kind === 'change' && (node.lifecycle === 'required' || node.lifecycle === 'optional');
}

/**
 * The exit reason of one non-member node, from the node's own projection
 * facts. The lifecycle reads first (a cancelled/superseded/deferred node is
 * outside the graph whatever its recorded observation), then the kind, then the
 * observation — a running node's observation is its reason, never its
 * dependency facts; a complete node's diagnostic names its completion basis
 * when one explains it (a legacy archive record).
 */
function exitReasonFor(node: IssueNodeStatus, statusById: ReadonlyMap<string, IssueNodeStatus>): IssueReadyExit {
  if (node.kind === 'intent') {
    return { kind: 'pending-change-creation', projectId: node.projectId, targetLineId: node.targetLineId };
  }
  if (node.lifecycle === 'cancelled') return { kind: 'cancelled', reason: node.reason };
  if (node.lifecycle === 'superseded') return { kind: 'superseded', reason: node.reason };
  if (node.lifecycle === 'deferred') return { kind: 'deferred', reason: node.reason };
  switch (node.observation) {
    case 'unknown':
      return { kind: 'unknown', diagnostic: node.diagnostic };
    case 'failed':
      return { kind: 'failed' };
    case 'finalized':
    case 'run-terminal':
      return { kind: 'complete', basis: node.diagnostic };
    case 'in-flight':
    case 'advanced':
    case 'waiting-human':
      return { kind: 'running', observation: node.observation };
    case 'not-started':
      return {
        kind: 'blocked',
        // Each dependency whose observed work is not complete, named in the
        // same refinement vocabulary the node line renders — cross-project
        // blockers included, with their projects and states.
        blockers: node.blockedBy.map(blocker => ({
          nodeId: blocker.nodeId,
          projectId: blocker.projectId,
          state: issueBlockerState(statusById.get(blocker.nodeId)),
        })),
      };
  }
}

/**
 * Derives the ready set of an Issue's latest readable revision. Null when the
 * revision did not read back — recognized by the projection's own no-progress
 * marker (`progress: null`), the same absence the lanes report — because "no
 * readable plan" and "nothing runnable" are different truths. Pure over its
 * input: the same status derives the same set, twice.
 */
export function deriveIssueReadySet(status: IssueStatus): IssueReadySet | null {
  if (status.progress === null) return null;
  const statusById = new Map(status.nodes.map(node => [node.nodeId, node] as const));
  const members: IssueReadyMember[] = [];
  const exits: IssueReadyExitEntry[] = [];
  for (const node of status.nodes) {
    if (
      isWanted(node) &&
      node.observation === 'not-started' &&
      node.blockedBy.length === 0
    ) {
      members.push({
        nodeId: node.nodeId,
        projectId: node.projectId,
        targetLineId: node.targetLineId,
        alias: node.alias,
        suggestedPipeline: node.suggestedPipeline,
        lifecycle: node.lifecycle,
      });
      continue;
    }
    exits.push({ nodeId: node.nodeId, reason: exitReasonFor(node, statusById) });
  }
  return { members, exits };
}
