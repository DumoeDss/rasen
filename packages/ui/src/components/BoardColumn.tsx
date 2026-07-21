import type { Task } from '../board/columns.js';
import type { Space } from '../store/use-space.js';
import { TaskCard } from './TaskCard.js';

export interface BoardColumnEntry {
  task: Task;
  highlighted?: boolean;
}

/**
 * One lifecycle column of the board (ui-space-redesign-task-board design D6):
 * a header + its Task cards. Cards are Tasks, not raw changes, and are not
 * draggable — the column is derived from each Task's changes, not set by
 * direct manipulation.
 */
export function BoardColumn({
  label,
  entries,
  space,
}: {
  label: string;
  entries: BoardColumnEntry[];
  space: Space | null;
}) {
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
          entries.map(({ task, highlighted }) => (
            <TaskCard key={task.id} task={task} space={space} highlighted={highlighted} />
          ))
        )}
      </div>
    </section>
  );
}
