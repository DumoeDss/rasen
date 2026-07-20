import type { ChangeSummary } from '../api/types.js';
import { BoardCard } from './BoardCard.js';

export interface BoardColumnEntry {
  change: ChangeSummary;
  escalated: boolean;
}

/** One lifecycle column of the board (design.md D7/D8): a header + its cards. */
export function BoardColumn({ label, entries }: { label: string; entries: BoardColumnEntry[] }) {
  return (
    <section class="board-column">
      <h2 class="board-column__title">
        {label}
        <span class="board-column__count">{entries.length}</span>
      </h2>
      <div class="board-column__cards">
        {entries.length === 0 ? (
          <p class="board-column__empty">—</p>
        ) : (
          entries.map(({ change, escalated }) => (
            <BoardCard key={change.name} change={change} escalated={escalated} />
          ))
        )}
      </div>
    </section>
  );
}
