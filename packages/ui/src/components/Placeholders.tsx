/**
 * Placeholder route for the Archive page (child 5), owned by a later child of
 * the ui-space-redesign portfolio. It exists so the nav's Archive slot
 * resolves to a labeled panel — not a blank page or a spinner — before child 5
 * replaces it. Child 5 swaps the component behind the route without touching
 * the route table's shape (planner finding 9). The Task detail placeholder was
 * retired by child 4, which shipped the real `TaskDetailPage`.
 */
export function ArchivePlaceholder() {
  return (
    <div class="placeholder-page" data-testid="archive-placeholder">
      <h2>Archive</h2>
      <p>The archive view arrives in a later step of this redesign.</p>
    </div>
  );
}
