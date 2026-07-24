import type { ChangeSummary } from '../api/types.js';
import { useT } from '../i18n/store.js';

/**
 * One change's card on the board (design.md D7/board-ui spec): name, schema,
 * task progress, run indicator, escalation badge. `highlighted` marks the
 * real card matching a just-submitted change (design D4 of
 * `platform-slice2-task-submission`) — never a fabricated card, only a style
 * applied to one read back from the server.
 */
export function BoardCard({
  change,
  escalated,
  highlighted = false,
}: {
  change: ChangeSummary;
  escalated: boolean;
  highlighted?: boolean;
}) {
  const t = useT();
  const { completed, total } = change.taskProgress;
  const progressLabel =
    total > 0 ? t('task.progress.tasks', { done: completed, total }) : t('task.progress.no_tasks');

  return (
    <article
      class={`board-card${highlighted ? ' board-card--highlighted' : ''}`}
      data-testid="board-card"
    >
      <div class="board-card__header">
        <h3 class="board-card__name">{change.name}</h3>
        {escalated && (
          <span class="board-card__badge board-card__badge--escalated" title={t('task.badge.escalated_title')}>
            {t('task.badge.escalated')}
          </span>
        )}
      </div>
      <p class="board-card__schema">{change.schemaName}</p>
      <div class="board-card__footer">
        <span class="board-card__progress">{progressLabel}</span>
        {change.hasRunFiles && (
          <span class="board-card__run-indicator" title={t('taskcard.run_title')}>
            {t('taskcard.run')}
          </span>
        )}
      </div>
    </article>
  );
}
