import type { Task } from '../board/columns.js';
import { spaceHref, type Space } from '../store/use-space.js';
import { useT } from '../i18n/store.js';

/**
 * One Task's card on the board (ui-space-redesign-task-board design D6 /
 * board-ui spec). A Task is a portfolio container (its children are the
 * constituent changes) or an implicit single-item Task (one bare change).
 * The card shows the Task label, its progress ("N/M changes" for a portfolio,
 * "N/M tasks" for a single change), an escalation badge, and a `⦿` live-run
 * indicator with the running stage — the latter only when a live session
 * targets one of the Task's changes, never from stale run files.
 *
 * The whole card links to the Task detail route (child 4's page; a
 * placeholder route for now), built through `spaceHref` so the opaque space
 * token and the Task id round-trip unchanged (design D7 — no id re-derivation).
 * When no space is resolvable (the launch-project fallback with no space
 * route) the card renders without a link.
 */
export function TaskCard({
  task,
  space,
  highlighted = false,
}: {
  task: Task;
  space: Space | null;
  highlighted?: boolean;
}) {
  const t = useT();
  const progressLabel =
    task.kind === 'portfolio'
      ? t('task.progress.changes', { done: task.progress.done, total: task.progress.total })
      : task.progress.total > 0
        ? t('task.progress.tasks', { done: task.progress.done, total: task.progress.total })
        : t('task.progress.no_tasks');

  const body = (
    <article
      class={`board-card task-card${highlighted ? ' board-card--highlighted' : ''}`}
      data-testid="task-card"
    >
      <div class="board-card__header">
        <h3 class="board-card__name">{task.label}</h3>
        {task.escalated && (
          <span class="board-card__badge board-card__badge--escalated" title={t('task.badge.escalated_title')}>
            {t('task.badge.escalated')}
          </span>
        )}
      </div>
      <div class="board-card__footer">
        <span class="board-card__progress">{progressLabel}</span>
        {task.liveStage !== undefined && (
          <span class="task-card__live" data-testid="task-card-live" title={t('task.live_title')}>
            ⦿ {task.liveStage}
          </span>
        )}
      </div>
    </article>
  );

  if (!space) return body;
  return (
    <a class="task-card__link" href={spaceHref(space, 'task', task.id)}>
      {body}
    </a>
  );
}
