import type { StoreIssueAttentionItem, StoreIssueProjectionEntry } from '../api/types.js';
import { useT } from '../i18n/store.js';
import {
  ISSUE_ATTENTION_KIND_LABEL_KEYS,
  ISSUE_HEALTH_LABEL_KEYS,
  ISSUE_PHASE_LABEL_KEYS,
  attentionItemDetail,
} from './issue-vocabulary.js';
import { issueProvenanceHref } from './issue-provenance.js';

/**
 * One Issue's card on the Board (issue-board-ui spec, requirement 1).
 *
 * The card shows the Issue's title, its health as its OWN indicator, its
 * progress pair as its own fact, and at most ONE attention item — the first in
 * the scan's own fail-first ordering. Its phase is not printed on the card
 * because the lane it sits in IS the phase; showing it twice would invite the
 * blended "status" the three axes exist to prevent.
 *
 * It deliberately does NOT list the Issue's Changes, nodes, or threads (that is
 * the Detail's job, and the spec's), and it never fabricates a title: an Issue
 * whose record did not read back appears with its id and the reported reason,
 * which is the whole point of the "an unreadable Issue still appears" rule.
 */
export function IssueCard({
  entry,
  attentionItem,
  href,
}: {
  entry: StoreIssueProjectionEntry;
  /** The first item the attention scan ordered for this Issue, or null. */
  attentionItem: StoreIssueAttentionItem | null;
  href: string;
}) {
  const t = useT();
  const status = entry.status;
  const title = entry.record?.title ?? entry.issueId;
  const detail = attentionItem === null ? null : attentionItemDetail(attentionItem, t);

  return (
    <article
      class="issue-card"
      data-testid="issue-card"
      data-issue={entry.issueId}
      data-phase={status.phase}
      data-health={status.health}
    >
      <a class="issue-card__main" data-testid="issue-card-main" href={href}>
        <span class="issue-card__title">{title}</span>
        <span class="issue-card__id">{entry.issueId}</span>
      </a>
      <span class="issue-card__axes">
        <a
          class="issue-card__evidence-link"
          data-testid="issue-card-phase-evidence"
          href={issueProvenanceHref(href, 'plan-projection')}
        >
          {t('issues.evidence.phase', { value: t(ISSUE_PHASE_LABEL_KEYS[status.phase]) })}
        </a>
        <a
          class="issue-card__evidence-link"
          data-testid="issue-card-health-evidence"
          href={issueProvenanceHref(href, 'attention')}
        >
          <span
            class={`issue-card__health issue-card__health--${status.health}`}
            data-testid="issue-card-health"
          >
            {t(ISSUE_HEALTH_LABEL_KEYS[status.health])}
          </span>
        </a>
        <a
          class="issue-card__evidence-link"
          data-testid="issue-card-progress-evidence"
          href={issueProvenanceHref(href, 'plan-projection')}
        >
          <span class="issue-card__progress" data-testid="issue-card-progress">
            {status.progress === null
              ? t('issues.progress_none')
              : t('issues.progress', {
                  completed: status.progress.completed,
                  total: status.progress.total,
                })}
          </span>
        </a>
      </span>
      {/* The record's own incompleteness, never smoothed over. All three are
          independent facts, so each renders on its own line rather than as an
          either/or. */}
      {entry.record === null && entry.diagnostic === null && entry.divergence === null && (
        <span class="issue-card__notice" data-testid="issue-card-no-record">
          {t('issues.card.no_record')}
        </span>
      )}
      {entry.diagnostic !== null && (
        <span class="issue-card__notice" data-testid="issue-card-unreadable">
          {t('issues.card.unreadable_record', { reason: entry.diagnostic })}
        </span>
      )}
      {entry.divergence !== null && (
        <span class="issue-card__notice" data-testid="issue-card-divergent">
          {t('issues.card.divergent', { count: entry.divergence.copies.length })}
        </span>
      )}
      {entry.uncommitted && (
        <span class="issue-card__notice" data-testid="issue-card-uncommitted">
          {t('issues.card.uncommitted')}
        </span>
      )}
      {attentionItem !== null && (
        <a
          class="issue-card__attention issue-card__evidence-link"
          data-testid="issue-card-attention"
          href={issueProvenanceHref(href, 'attention')}
        >
          <span class="issue-card__attention-kind">
            {t(ISSUE_ATTENTION_KIND_LABEL_KEYS[attentionItem.kind])}
          </span>
          {attentionItem.nodeId !== null && (
            <span class="issue-card__attention-node">{attentionItem.nodeId}</span>
          )}
          {detail !== null && <span class="issue-card__attention-detail">{detail}</span>}
        </a>
      )}
    </article>
  );
}
