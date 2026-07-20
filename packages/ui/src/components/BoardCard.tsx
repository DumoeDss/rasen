import type { ChangeSummary } from '../api/types.js';

/** One change's card on the board (design.md D7/board-ui spec): name, schema, task progress, run indicator, escalation badge. */
export function BoardCard({ change, escalated }: { change: ChangeSummary; escalated: boolean }) {
  const { completed, total } = change.taskProgress;
  const progressLabel = total > 0 ? `${completed}/${total} tasks` : 'No tasks';

  return (
    <article class="board-card" data-testid="board-card">
      <div class="board-card__header">
        <h3 class="board-card__name">{change.name}</h3>
        {escalated && (
          <span class="board-card__badge board-card__badge--escalated" title="A run stage is escalated">
            Escalated
          </span>
        )}
      </div>
      <p class="board-card__schema">{change.schemaName}</p>
      <div class="board-card__footer">
        <span class="board-card__progress">{progressLabel}</span>
        {change.hasRunFiles && (
          <span class="board-card__run-indicator" title="A pipeline run has recorded state for this change">
            Run
          </span>
        )}
      </div>
    </article>
  );
}
