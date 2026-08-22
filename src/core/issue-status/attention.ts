/**
 * `issue-needs-attention` — the deterministic attention derivation (design
 * D1/D2/D4): a post-pass over the status projection's own facts, beside the
 * ready set and the lanes, consuming ONLY the projection output and persisted
 * nowhere. Attention answers "what needs a human NOW" — the complementary
 * question to the ready set's "what may run" — over the SAME one seam, so the
 * two reads can never disagree about a node's facts.
 *
 * The kind vocabulary is closed and derives from the projection's own values:
 * `failure` (a wanted node observing `failed`), `blocked-behind` (the blast
 * radius of trouble — a wanted not-started node with a DIRECT dependency
 * observing failed/waiting-human/unknown, one hop, deeper chains surfacing
 * because each hop is itself listed with its own named blockers),
 * `waiting-human` (a wanted node parked for a human), `acceptance-awaiting`
 * (a review-phase Issue — the acceptance is by definition the human's act),
 * and `problem` (every standing status problem, none dropped).
 *
 * The absence discipline is the requirement, not an accident: in-flight,
 * advanced, run-terminal, and finalized work contributes nothing; a ready node
 * contributes nothing; a serial wait behind ordinary progress contributes
 * nothing — a `blocked` kind over ordinary dependency waits was rejected
 * (design D1): it would flood the answer with sequencing the health axis
 * deliberately calls `healthy` and smuggle the reserved `blocked` health value
 * in through a side door.
 */
import { issueBlockerState } from './projection.js';
import type {
  IssueAttentionItem,
  IssueAttentionKind,
  IssueNodeStatus,
  IssueStatus,
} from './types.js';

/** The fail-first kind order (design D2): failure leads, always. */
export const ISSUE_ATTENTION_KIND_ORDER: readonly IssueAttentionKind[] = [
  'failure',
  'blocked-behind',
  'waiting-human',
  'acceptance-awaiting',
  'problem',
];

/**
 * The observations that make a dependency TROUBLE for its downstream: a
 * failed, human-parked, or unreadable dependency is why a downstream node is
 * stuck; a not-started or healthy in-flight dependency is ordinary sequencing.
 */
const TROUBLE_OBSERVATIONS: ReadonlySet<string> = new Set([
  'failed',
  'waiting-human',
  'unknown',
]);

/** Whether a change node's lifecycle still wants its work (the projection's rule). */
function isWanted(node: IssueNodeStatus): boolean {
  return node.kind === 'change' && (node.lifecycle === 'required' || node.lifecycle === 'optional');
}

/** Code-point comparator for the stable (issueId, nodeId) ordering. */
function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The kind's rank in the fail-first order; the vocabulary is closed, so total. */
export function issueAttentionKindRank(kind: IssueAttentionKind): number {
  const rank = ISSUE_ATTENTION_KIND_ORDER.indexOf(kind);
  // An exhaustiveness tripwire: a kind outside the order would sort as found
  // nowhere, so the ordering contract would silently rot. The type system
  // already refuses one at authoring time; this guards the runtime boundary.
  if (rank < 0) throw new Error(`unknown attention kind '${kind}'`);
  return rank;
}

/**
 * Derives the attention items of one Issue from its status projection alone —
 * pure over its input: the same (issueId, status) derives the same items,
 * twice. Unlike the ready set there is NO null case: an Issue with an
 * unreadable plan still derives (its `unreadable-plan` problem IS an item),
 * and an Issue with nothing needing attention derives an honestly empty list —
 * "nothing here needs a human" is a claim this derivation can stand behind,
 * never a read failure.
 */
export function deriveIssueAttention(
  issueId: string,
  status: IssueStatus
): readonly IssueAttentionItem[] {
  const context = { issueId, phase: status.phase, health: status.health };
  const items: IssueAttentionItem[] = [];
  const statusById = new Map(status.nodes.map(node => [node.nodeId, node] as const));

  for (const node of status.nodes) {
    if (!isWanted(node)) continue;
    switch (node.observation) {
      case 'failed':
        items.push({
          ...context,
          kind: 'failure',
          nodeId: node.nodeId,
          alias: node.alias,
          diagnostic: node.diagnostic,
        });
        break;
      case 'waiting-human':
        items.push({
          ...context,
          kind: 'waiting-human',
          nodeId: node.nodeId,
          alias: node.alias,
        });
        break;
      case 'not-started':
        // One hop (design D1): only a DIRECT dependency observing trouble
        // makes the wait attention-worthy. Every non-terminal direct
        // dependency is named — the work-complete gate list `withBlockerFacts`
        // already derived — each with the node line's refinement vocabulary,
        // so the chain reads through the listing without a graph walk.
        if (node.blockedBy.some(blocker => TROUBLE_OBSERVATIONS.has(blocker.observation))) {
          items.push({
            ...context,
            kind: 'blocked-behind',
            nodeId: node.nodeId,
            alias: node.alias,
            blockers: node.blockedBy.map(blocker => ({
              nodeId: blocker.nodeId,
              projectId: blocker.projectId,
              state: issueBlockerState(statusById.get(blocker.nodeId)),
            })),
          });
        }
        break;
      default:
        // in-flight / advanced / run-terminal / finalized: ordinary progress
        // is not attention. The excluded observations are enumerated here on
        // purpose — the spec pins them as the fence against scope creep.
        break;
    }
  }

  // The acceptance is by definition the human's act: every review-phase Issue
  // — open with its required work complete, or resolved without a verified
  // record (the legacy-close upgrade path) — carries one item, with the gate
  // evaluation the projection already derived (null only when this read
  // supplied no acceptance facts; the phase itself is derivable without them).
  if (status.phase === 'review') {
    items.push({
      ...context,
      kind: 'acceptance-awaiting',
      nodeId: null,
      alias: null,
      gate: status.acceptance?.gate ?? null,
    });
  }

  for (const problem of status.problems) {
    items.push({
      ...context,
      kind: 'problem',
      nodeId: problem.node,
      alias: problem.node === null ? null : (statusById.get(problem.node)?.alias ?? null),
      problem,
    });
  }

  // Kind order first (fail-first), then the stable (issueId, nodeId) order —
  // null-node items read as the empty string, so they order among their
  // siblings deterministically.
  return items.sort(
    (left, right) =>
      issueAttentionKindRank(left.kind) - issueAttentionKindRank(right.kind) ||
      codePointOrder(left.issueId, right.issueId) ||
      codePointOrder(left.nodeId ?? '', right.nodeId ?? '')
  );
}
