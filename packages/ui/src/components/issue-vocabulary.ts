import type {
  StoreIssueAttentionItem,
  StoreIssueAttentionKind,
  StoreIssueHealth,
  StoreIssueNodeDelivery,
  StoreIssueNodeLifecycle,
  StoreIssueNodeObservation,
  StoreIssuePhase,
  StoreIssueReviewDetermination,
  StoreIssueReviewThread,
  StoreIssueStatusProblemKind,
} from '../api/types.js';

/**
 * The Issue read surface's presentation-only mapping layer (issue-read-surface
 * design D5).
 *
 * The line this file draws: the UI maps the projection's CLOSED vocabularies to
 * labels, and does nothing else. It never computes a phase, a health, a
 * progress, a determination, or an attention fact from other facts — every one
 * of those arrives already derived, and re-deriving any of them here would be
 * the second truth the whole slice exists to avoid.
 *
 * Every table is total over its vocabulary and typed `Record<Vocabulary, ...>`,
 * so adding a value to a closed vocabulary upstream fails the UI build here
 * rather than rendering a raw enum value to a viewer. Keys are literal strings
 * so the three-locale catalog parity test can see them.
 */

/** Lane placement IS the phase — these are the five lanes, in their fixed order. */
export const ISSUE_PHASE_ORDER: readonly StoreIssuePhase[] = [
  'planning',
  'ready',
  'active',
  'review',
  'done',
];

export const ISSUE_PHASE_LABEL_KEYS: Record<StoreIssuePhase, string> = {
  planning: 'issues.phase.planning',
  ready: 'issues.phase.ready',
  active: 'issues.phase.active',
  review: 'issues.phase.review',
  done: 'issues.phase.done',
};

export const ISSUE_HEALTH_LABEL_KEYS: Record<StoreIssueHealth, string> = {
  healthy: 'issues.health.healthy',
  blocked: 'issues.health.blocked',
  failed: 'issues.health.failed',
  'waiting-human': 'issues.health.waiting_human',
  stale: 'issues.health.stale',
};

export const ISSUE_OBSERVATION_LABEL_KEYS: Record<StoreIssueNodeObservation, string> = {
  finalized: 'issues.observation.finalized',
  'run-terminal': 'issues.observation.run_terminal',
  'in-flight': 'issues.observation.in_flight',
  failed: 'issues.observation.failed',
  'waiting-human': 'issues.observation.waiting_human',
  advanced: 'issues.observation.advanced',
  'not-started': 'issues.observation.not_started',
  unknown: 'issues.observation.unknown',
};

export const ISSUE_LIFECYCLE_LABEL_KEYS: Record<StoreIssueNodeLifecycle, string> = {
  required: 'issues.lifecycle.required',
  optional: 'issues.lifecycle.optional',
  cancelled: 'issues.lifecycle.cancelled',
  superseded: 'issues.lifecycle.superseded',
  deferred: 'issues.lifecycle.deferred',
};

export const ISSUE_ATTENTION_KIND_LABEL_KEYS: Record<StoreIssueAttentionKind, string> = {
  failure: 'issues.attention.failure',
  'blocked-behind': 'issues.attention.blocked_behind',
  'waiting-human': 'issues.attention.waiting_human',
  'acceptance-awaiting': 'issues.attention.acceptance_awaiting',
  problem: 'issues.attention.problem',
};

export const ISSUE_PROBLEM_KIND_LABEL_KEYS: Record<StoreIssueStatusProblemKind, string> = {
  'unreadable-plan': 'issues.problem.unreadable_plan',
  'unresolved-reference': 'issues.problem.unresolved_reference',
  'ambiguous-reference': 'issues.problem.ambiguous_reference',
  'invalid-run-state': 'issues.problem.invalid_run_state',
  'invalid-archive-record': 'issues.problem.invalid_archive_record',
  'unreadable-acceptance': 'issues.problem.unreadable_acceptance',
  'unsearched-refs': 'issues.problem.unsearched_refs',
};

export const ISSUE_DELIVERY_STATE_LABEL_KEYS: Record<StoreIssueNodeDelivery['state'], string> = {
  record: 'issues.delivery.record',
  'no-record': 'issues.delivery.no_record',
  'not-archived': 'issues.delivery.not_archived',
  unreadable: 'issues.delivery.unreadable',
  unattributed: 'issues.delivery.unattributed',
};

export const ISSUE_DETERMINATION_LABEL_KEYS: Record<StoreIssueReviewDetermination['kind'], string> = {
  'review-ready': 'issues.determination.review_ready',
  accepted: 'issues.determination.accepted',
  'not-ready': 'issues.determination.not_ready',
  'conditions-missing': 'issues.determination.conditions_missing',
  'no-plan': 'issues.determination.no_plan',
  dropped: 'issues.determination.dropped',
  'acceptance-unknown': 'issues.determination.acceptance_unknown',
};

export const ISSUE_THREAD_KIND_LABEL_KEYS: Record<StoreIssueReviewThread['kind'], string> = {
  failure: 'issues.thread.failure',
  'blocked-behind': 'issues.thread.blocked_behind',
  'waiting-human': 'issues.thread.waiting_human',
  'optional-open': 'issues.thread.optional_open',
  'archive-pending': 'issues.thread.archive_pending',
  'record-absent': 'issues.thread.record_absent',
  'evidence-missing': 'issues.thread.evidence_missing',
};

/**
 * The blocker label the projection reported, in the projection's own spelling:
 * `<node>@<project>: <state>`. Both blocker shapes the payload carries reach
 * this — a plan node's `blockedBy` reports an observation, an attention item's
 * blockers report the refinement string the derivation already chose — and
 * neither is re-interpreted here.
 */
export function issueBlockerLabel(blocker: { nodeId: string; projectId: string; state: string }): string {
  return `${blocker.nodeId}@${blocker.projectId}: ${blocker.state}`;
}

/**
 * The one attention item a card shows, and every item the Detail lists, as one
 * line: the kind's label plus the facts THAT kind carries. No item's severity,
 * order, or membership is decided here — the scan already ordered them
 * fail-first and this only renders the one it was handed.
 */
export function attentionItemDetail(
  item: StoreIssueAttentionItem,
  t: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  switch (item.kind) {
    case 'failure':
      return item.diagnostic;
    case 'blocked-behind':
      return item.blockers
        .map(blocker => issueBlockerLabel(blocker))
        .join(', ');
    case 'waiting-human':
      return null;
    case 'acceptance-awaiting':
      if (item.gate === null) return t('issues.attention.gate_unknown');
      return item.gate.eligible
        ? t('issues.attention.gate_holds', { revision: item.gate.conditionsRevisionId })
        : item.gate.message;
    case 'problem':
      return `${t(ISSUE_PROBLEM_KIND_LABEL_KEYS[item.problem.kind])}: ${item.problem.reason}`;
  }
}
