/**
 * `issue-delivery-evidence-rollup` — the Issue-level delivery rollup (design
 * D4): a post-pass over the status projection's own facts, beside the ready
 * set, the lanes, and the attention items. It consumes ONLY the per-node
 * delivery facts the projection already carried — zero ambient reads, zero
 * second derivations — so the rollup, the node lines, and the attribution on
 * the same read can never disagree about a node's delivery evidence.
 *
 * The absence discipline mirrors `progress: null`: an Issue whose latest
 * revision did not read back reports NO rollup rather than an empty one, because
 * "no readable plan" and "no delivery evidence" are different truths. Counts
 * summarize the five named states; every entry stays listed in full — a count
 * that replaced its entries would be the "empty reads as failure" lie in
 * aggregate form.
 */
import type {
  IssueDeliveryEntry,
  IssueDeliveryEvidence,
  IssueStatus,
} from './types.js';

/** A writable copy of the counts shape — the accumulator behind the readonly result. */
type WritableCounts = { -readonly [K in keyof IssueDeliveryEvidence['counts']]: number };

/**
 * Derives one Issue's delivery-evidence rollup from its status projection
 * alone — pure over its inputs: the same (revisionId, status) derives the
 * identical rollup, twice. `revisionId` is the plain-string fact the caller's
 * one read already resolved (the projection's status carries no revision id of
 * its own — the same shape `deriveIssueAttention` takes its `issueId` in);
 * null, like an unreadable revision, reports no rollup.
 */
export function deriveIssueDeliveryEvidence(
  revisionId: string | null,
  status: IssueStatus
): IssueDeliveryEvidence | null {
  // The projection's own no-progress rule, read one level down: `progress`
  // is null exactly when no latest readable revision exists to roll up.
  if (revisionId === null || status.progress === null) return null;
  const entries: IssueDeliveryEntry[] = [];
  const counts: WritableCounts = {
    record: 0,
    'no-record': 0,
    'not-archived': 0,
    unreadable: 0,
    unattributed: 0,
  };
  for (const node of status.nodes) {
    // Intent nodes contribute no entry — nothing was delivered by construction.
    if (node.kind !== 'change') continue;
    entries.push({
      nodeId: node.nodeId,
      alias: node.alias,
      projectId: node.projectId,
      lifecycle: node.lifecycle,
      observation: node.observation,
      delivery: node.delivery,
    });
    // A change node's delivery is one of the five states whenever the
    // projection built it; a null (only possible in a hand-assembled status)
    // stays listed and counted nowhere rather than guessed into a state.
    if (node.delivery !== null) counts[node.delivery.state] += 1;
  }
  return { revisionId, entries, counts };
}
