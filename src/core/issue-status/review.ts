/**
 * `issue-unified-review-gate` — the Issue-level review view (design D1–D3): a
 * post-pass over the status projection's own facts, beside the ready set, the
 * lanes, the attention items, and the delivery rollup. It composes the two
 * post-passes the same read already derived — calling `deriveIssueDeliveryEvidence`
 * and `deriveIssueAttention` over the SAME status — so one status yields one
 * coherent triple: node facts, delivery rollup, review view. Zero ambient
 * reads, zero second derivations, nothing persisted.
 *
 * The determination is MAPPED from the acceptance gate's own evaluation, never
 * re-evaluated: the gate is the ONE blocking basis, and the mapping is total
 * over its closed refusal union (the switch below pins exhaustiveness at
 * compile time). No delivery state, lifecycle, thread, or count can flip the
 * determination the gate's evaluation maps to — those facts ride as named
 * threads BESIDE the conclusion, never under it.
 *
 * Threads are the gate's deliberate exclusions a reviewer must still see, and
 * they never block: a review-ready Issue with every thread kind standing still
 * reads `review-ready` (pinned). `not-archived` is expected progress, a
 * recorded missing-evidence name is a recorded fact, and an optional node's
 * incompleteness is the gate's own required-scope decision restated, not a
 * second ruling.
 */
import { deriveIssueAttention } from './attention.js';
import { deriveIssueDeliveryEvidence } from './delivery.js';
import type {
  IssueReview,
  IssueReviewDetermination,
  IssueReviewThread,
  IssueStatus,
} from './types.js';

/**
 * The gate-mapped determination (design D1): one branch per refusal code of
 * the gate's closed union, plus the eligible branch and the no-facts read.
 * The refusal vocabulary is a closed Zod union, so this switch is total — the
 * `IssueReviewDetermination` return type refuses a missing case at compile
 * time, which is the exhaustiveness pin the spec's "machine-checkable over one
 * blocking basis" requirement rests on.
 */
function mapDetermination(status: IssueStatus): IssueReviewDetermination {
  const acceptance = status.acceptance;
  if (acceptance === null) {
    return {
      kind: 'acceptance-unknown',
      reason: 'this read supplied no acceptance facts — the gate could not be evaluated on this read',
    };
  }
  const { gate, record } = acceptance;
  if (gate.eligible) {
    return { kind: 'review-ready', conditionsRevisionId: gate.conditionsRevisionId };
  }
  switch (gate.refusalCode) {
    case 'issue_accept_already_accepted':
      // The record rides the same acceptance block; null facts name the
      // present-but-unverifiable record (the standing unreadable-acceptance
      // problem is the answer the acceptance section above already printed).
      return {
        kind: 'accepted',
        acceptedAt: record?.acceptedAt ?? null,
        conditionsRevisionId: record?.conditionsRevisionId ?? null,
      };
    case 'issue_accept_blocked':
      // The blocker count alone: the blockers themselves stay in
      // `status.acceptance.gate.blockers`, already listed by the acceptance
      // section of this read. A copy would be a second basis.
      return { kind: 'not-ready', blockerCount: gate.blockers.length };
    case 'issue_accept_conditions_required':
      return { kind: 'conditions-missing', message: gate.message };
    case 'issue_accept_requires_plan':
      return { kind: 'no-plan' };
    case 'issue_accept_dropped':
      return { kind: 'dropped' };
  }
}

/** Whether an observation is terminal on the work-complete rule's vocabulary. */
function isTerminal(observation: string): boolean {
  return observation === 'finalized' || observation === 'run-terminal';
}

/**
 * The attention kinds that become threads (design D2). `acceptance-awaiting`
 * is excluded — it IS the review-ready conclusion — and `problem` is excluded
 * because every standing problem is a gate blocker the `not-ready`
 * determination already carries; a thread copy would read as if it did not
 * block.
 */
const THREAD_ATTENTION_KINDS: ReadonlySet<string> = new Set([
  'failure',
  'blocked-behind',
  'waiting-human',
]);

/** The listed kind order of the node-scanned threads (design D2). */
const NODE_THREAD_KIND_ORDER: readonly IssueReviewThread['kind'][] = [
  'optional-open',
  'archive-pending',
  'record-absent',
  'evidence-missing',
];

/** Code-point comparator for the stable nodeId ordering within one kind. */
function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Maps the attention items of the three thread kinds into review threads. */
function attentionThreads(
  issueId: string,
  status: IssueStatus
): readonly IssueReviewThread[] {
  return deriveIssueAttention(issueId, status)
    .filter(item => THREAD_ATTENTION_KINDS.has(item.kind))
    .map(item => {
      // The attention derivation already ordered its items fail-first with a
      // stable (issueId, nodeId) order within — the filter preserves it.
      switch (item.kind) {
        case 'failure':
          return {
            kind: 'failure' as const,
            nodeId: item.nodeId as string,
            alias: item.alias,
            diagnostic: item.diagnostic,
          };
        case 'blocked-behind':
          return {
            kind: 'blocked-behind' as const,
            nodeId: item.nodeId as string,
            alias: item.alias,
            blockers: item.blockers,
          };
        case 'waiting-human':
          return {
            kind: 'waiting-human' as const,
            nodeId: item.nodeId as string,
            alias: item.alias,
          };
        default:
          // The filter above admits only the three mapped kinds.
          throw new Error(`unmapped attention kind '${item.kind}'`);
      }
    });
}

/** Scans the projection's own node facts for the four node-scanned thread kinds. */
function nodeThreads(status: IssueStatus): readonly IssueReviewThread[] {
  const threads: IssueReviewThread[] = [];
  for (const node of status.nodes) {
    if (node.kind !== 'change') continue; // intent nodes name no delivery or execution fact
    if (node.lifecycle === 'optional' && !isTerminal(node.observation)) {
      threads.push({
        kind: 'optional-open',
        nodeId: node.nodeId,
        observation: node.observation,
      });
    }
    if (node.delivery !== null && node.delivery.state === 'not-archived') {
      // The spec's rule: observed work TERMINAL while the instance is not
      // archived — expected progress. A not-archived node still running is
      // ordinary progress, not a pending archive; its optional incompleteness
      // rides `optional-open`, its required incompleteness the gate's own
      // blockers.
      if (isTerminal(node.observation)) {
        threads.push({
          kind: 'archive-pending',
          nodeId: node.nodeId,
          observation: node.observation,
        });
      }
    }
    if (node.delivery !== null && node.delivery.state === 'no-record') {
      threads.push({ kind: 'record-absent', nodeId: node.nodeId });
    }
    if (
      node.delivery !== null &&
      node.delivery.state === 'record' &&
      node.delivery.missing !== null &&
      node.delivery.missing.length > 0
    ) {
      threads.push({
        kind: 'evidence-missing',
        nodeId: node.nodeId,
        names: node.delivery.missing,
      });
    }
  }
  const kindRank = (kind: IssueReviewThread['kind']): number =>
    NODE_THREAD_KIND_ORDER.indexOf(kind);
  return threads.sort(
    (left, right) => kindRank(left.kind) - kindRank(right.kind) || codePointOrder(left.nodeId, right.nodeId)
  );
}

/**
 * Derives one Issue's unified review view from its status projection alone —
 * pure over its inputs: the same (issueId, revisionId, status) derives the
 * identical view, twice. The identities are the plain-string facts the
 * caller's one read already resolved (the delivery rollup's signature
 * precedent). Never null: an Issue with no readable plan derives the
 * determination that says so — every Issue has a review answer.
 */
export function deriveIssueReview(
  issueId: string,
  revisionId: string | null,
  status: IssueStatus
): IssueReview {
  // Both compositions consume the SAME status, so the review view can never
  // disagree with the delivery section or the attention facts of the read.
  const delivery = deriveIssueDeliveryEvidence(revisionId, status);
  return {
    issueId,
    revisionId,
    determination: mapDetermination(status),
    threads: [...attentionThreads(issueId, status), ...nodeThreads(status)],
    verification: {
      progress: status.progress,
      delivery: delivery === null ? null : delivery.counts,
    },
  };
}
