import { useRoute } from 'preact-iso';

/**
 * Placeholder routes for sections owned by later children of the
 * ui-space-redesign portfolio: the Archive page (child 5) and the Task detail
 * page (child 4). They exist so the nav's Archive slot and the header
 * running-run summary's task links resolve to a labeled panel — not a blank
 * page or a spinner — before those children replace them. Children 4/5 swap
 * the component behind the route without touching the route table's shape
 * (planner finding 9).
 */
export function ArchivePlaceholder() {
  return (
    <div class="placeholder-page" data-testid="archive-placeholder">
      <h2>Archive</h2>
      <p>The archive view arrives in a later step of this redesign.</p>
    </div>
  );
}

export function TaskDetailPlaceholder() {
  const { params } = useRoute();
  return (
    <div class="placeholder-page" data-testid="task-detail-placeholder">
      <h2>Task detail</h2>
      <p>
        Task detail for <code>{params.changeName}</code> arrives in a later step of this redesign.
      </p>
    </div>
  );
}
