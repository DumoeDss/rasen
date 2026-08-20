/**
 * `issue-acceptance-close` — the acceptance gate rule (design D3), pure.
 *
 * Eligible iff ALL hold, evaluated over the projection:
 *
 *   1. every required node's observation is `finalized | run-terminal` — the
 *      same work-complete rule execution binding uses, NOT the query's
 *      archive-based `blockedBy`;
 *   2. health is not `failed`;
 *   3. the read is complete and no status problem stands — an acceptance over
 *      unprovable facts is exactly the lie this capability exists to prevent.
 *
 * `waiting-human` health does NOT hold the gate: all-terminal work with an
 * escalated stage-record is impossible (escalation implies a non-terminal
 * stage), so the only reachable waiting-human at gate time is
 * review-awaiting-acceptance — which is the human accepting.
 *
 * Blockers are named TOGETHER: one evaluation lists every un-terminal node
 * with its observation, every node behind the failed health, and every open
 * problem. Structural states are distinct refusal codes, checked in the order
 * that answers the operator's next question: a dropped or already-accepted
 * Issue needs no gate, a planless Issue needs a plan before conditions can
 * matter, and a conditions-less Issue needs conditions before facts can
 * matter.
 *
 * Since issue-node-lifecycle, the blocker loops are required-scoped: an
 * optional node never contributes an un-terminal blocker, and every
 * cancelled/superseded node rides beside the gate as a named exclusion with
 * its recorded reason — on both the eligible and the blocked evaluation — so
 * a smaller required total is explained rather than silently absorbed.
 *
 * This file is imported BY the projection (for the `status.acceptance` block)
 * and must stay free of any runtime import back into `issue-status`, so the
 * projection-to-gate edge stays one-directional at load time.
 */
import type {
  IssueAcceptanceBlocker,
  IssueAcceptanceFacts,
  IssueAcceptanceGateEvaluation,
  IssueAcceptanceGateExclusion,
  IssueAcceptanceGateView,
  IssueAcceptanceRefusalCode,
} from './types.js';
import type { IssueNodeStatus } from '../issue-status/types.js';

function isTerminal(observation: string): boolean {
  return observation === 'finalized' || observation === 'run-terminal';
}

/**
 * The gate's lifecycle accounting, derived once from the view (design D3):
 * un-terminal blockers name required (and intent) nodes only; optional nodes
 * never block on terminality; cancelled/superseded nodes leave the required
 * total as named exclusions with their recorded reasons.
 */
function lifecycleAccounting(
  nodes: readonly IssueNodeStatus[]
): {
  exclusions: readonly IssueAcceptanceGateExclusion[];
  optionalNodes: readonly string[];
  required: readonly IssueNodeStatus[];
} {
  const exclusions: IssueAcceptanceGateExclusion[] = [];
  const optionalNodes: string[] = [];
  const required: IssueNodeStatus[] = [];
  for (const node of nodes) {
    if (node.kind !== 'change') continue; // intent nodes keep their occupant role below
    if (node.lifecycle === 'cancelled' || node.lifecycle === 'superseded') {
      exclusions.push({ nodeId: node.nodeId, lifecycle: node.lifecycle, reason: node.reason ?? '' });
      continue;
    }
    if (node.lifecycle === 'optional') {
      optionalNodes.push(node.nodeId);
      continue;
    }
    required.push(node);
  }
  return { exclusions, optionalNodes, required };
}

function blockerLines(blockers: readonly IssueAcceptanceBlocker[]): readonly string[] {
  return blockers.map(blocker => {
    switch (blocker.kind) {
      case 'un-terminal-node':
        return `node ${blocker.nodeId} is ${blocker.observation} (work not complete or finalized)`;
      case 'failing-node':
        return `node ${blocker.nodeId} is failed`;
      case 'status-problem':
        return blocker.node === null
          ? `status problem ${blocker.problemKind}: ${blocker.reason}`
          : `status problem ${blocker.problemKind} on ${blocker.node}: ${blocker.reason}`;
      case 'incomplete-read':
        return blocker.reason;
    }
  });
}

/**
 * The acceptance gate over one projection's facts. Same inputs, same result —
 * no filesystem, no Git, no clock.
 */
export function evaluateIssueAcceptanceGate(
  view: IssueAcceptanceGateView,
  facts: IssueAcceptanceFacts
): IssueAcceptanceGateEvaluation {
  const { exclusions, optionalNodes, required } = lifecycleAccounting(view.nodes);
  if (view.issueState === 'dropped') {
    return {
      eligible: false,
      refusalCode: 'issue_accept_dropped',
      blockers: [],
      message: 'the Issue is dropped — abandoned, not acceptable.',
      exclusions,
      optionalNodes,
    };
  }
  if (facts.acceptedRecord.present) {
    return {
      eligible: false,
      refusalCode: 'issue_accept_already_accepted',
      blockers: [],
      message:
        'the Issue already carries an acceptance record; an acceptance is never rewritten.',
      exclusions,
      optionalNodes,
    };
  }
  if (view.nodes.length === 0) {
    return {
      eligible: false,
      refusalCode: 'issue_accept_requires_plan',
      blockers: [],
      message:
        'the Issue has no readable Execution Plan revision with nodes to accept against.',
      exclusions,
      optionalNodes,
    };
  }
  if (facts.conditions.revision === null) {
    const unreadable =
      facts.conditions.revisionId === null
        ? 'no acceptance conditions revision exists for it.'
        : `its latest conditions revision '${facts.conditions.revisionId}' does not read back${
            facts.conditions.diagnostic === null
              ? '.'
              : `: ${facts.conditions.diagnostic}`
          }`;
    return {
      eligible: false,
      refusalCode: 'issue_accept_conditions_required',
      blockers: [],
      message: `the Issue has no readable acceptance conditions — ${unreadable}`,
      exclusions,
      optionalNodes,
    };
  }

  // The fact blockers, all together (design D3): un-terminal REQUIRED nodes
  // (optional nodes never block on completion; cancelled/superseded nodes are
  // excluded and named beside the gate instead), the failures behind a failed
  // health (wanted work only — a cancelled node's escalation is history), and
  // every open status problem.
  const blockers: IssueAcceptanceBlocker[] = [];
  for (const node of view.nodes) {
    if (node.kind === 'change' && node.lifecycle !== 'required') continue;
    if (!isTerminal(node.observation)) {
      blockers.push({
        kind: 'un-terminal-node',
        nodeId: node.nodeId,
        observation: node.observation,
      });
    }
  }
  if (view.health === 'failed') {
    for (const node of view.nodes) {
      if (node.kind === 'change' && (node.lifecycle === 'cancelled' || node.lifecycle === 'superseded')) {
        continue;
      }
      if (node.observation === 'failed') {
        blockers.push({ kind: 'failing-node', nodeId: node.nodeId });
      }
    }
  }
  for (const problem of view.problems) {
    blockers.push({
      kind: 'status-problem',
      problemKind: problem.kind,
      node: problem.node,
      ref: problem.ref,
      reason: problem.reason,
    });
  }
  if (!view.complete && blockers.length === 0) {
    // The read is incomplete for a reason no specific problem names (an
    // aggregate-level unreadable item). The gate still refuses — an
    // acceptance over unprovable facts is a lie — and says so plainly.
    blockers.push({
      kind: 'incomplete-read',
      reason: 'the status read could not prove its own facts complete',
    });
  }
  if (blockers.length > 0) {
    return {
      eligible: false,
      refusalCode: 'issue_accept_blocked',
      blockers,
      message: `not accepted yet — ${blockerLines(blockers).join('; ')}.`,
      exclusions,
      optionalNodes,
    };
  }

  return {
    eligible: true,
    conditionsRevisionId: facts.conditions.revision.revisionId,
    snapshot: {
      // Required-scoped counts: the same pair progress reports. Zero required
      // nodes is the stated answer 0/0 — eligible with nothing demanded, the
      // exclusions and optional nodes named beside it, never hidden by the
      // empty total (design D6).
      completed: required.filter(node => isTerminal(node.observation)).length,
      total: required.length,
      health: view.health,
      problemsStanding: 0,
    },
    exclusions,
    optionalNodes,
  };
}

/** The repair hint for one structural or fact-blocked refusal. */
export function acceptanceRefusalFix(code: IssueAcceptanceRefusalCode): string {
  switch (code) {
    case 'issue_accept_requires_plan':
      return 'Publish an Execution Plan revision first: rasen store issue plan <issue-id> --from-file <path>.';
    case 'issue_accept_conditions_required':
      return 'Author acceptance conditions first: rasen store issue acceptance <issue-id> --from-file <path>.';
    case 'issue_accept_already_accepted':
      return 'An acceptance record is never rewritten. Open a new Issue for follow-up work.';
    case 'issue_accept_dropped':
      return 'A dropped Issue records work that will not be done. Open a new Issue for any revived intent.';
    case 'issue_accept_blocked':
      return 'Address the named blockers — un-terminal nodes, failing nodes, open status problems — then accept again.';
  }
}
