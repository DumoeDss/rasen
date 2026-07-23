import { useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';

/**
 * Board-embedded submission form (design D4 of
 * `platform-slice2-task-submission`): an inline dialog, not a `/new` route.
 * Submits through the single `client.createChange` seam. On success it
 * hands the created change's id to `onCreated` — the parent (BoardPage)
 * owns closing the dialog and refetching, so the card that appears is the
 * real one read back from disk, never an optimistic fabrication. On
 * failure the dialog stays open with the CLI's error message verbatim and
 * the form fields intact.
 */
export function NewChangeDialog({
  space,
  onCancel,
  onCreated,
}: {
  /** The board's current planning-space selector, forwarded so the new change lands in the viewed space (design D5). */
  space?: string;
  onCancel: () => void;
  onCreated: (changeId: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await client.createChange({ name, description, ...(space ? { space } : {}) });
      onCreated(result.change.id);
    } catch (err) {
      // A 401 here already triggered the shared re-launch notice (the
      // client's single fetch seam calls markUnauthorized() before
      // throwing) — the whole app is about to unmount this dialog, so
      // there is nothing useful to show locally.
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'Failed to submit the change.');
    }
  }

  return (
    <div class="new-change-dialog__overlay">
      <form class="new-change-dialog" onSubmit={handleSubmit} aria-label="New change">
        <h2 class="new-change-dialog__title">New change</h2>
        <label class="new-change-dialog__field">
          <span>Name</span>
          <input
            type="text"
            name="name"
            value={name}
            disabled={submitting}
            required
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="new-change-dialog__field">
          <span>Description</span>
          <textarea
            name="description"
            value={description}
            disabled={submitting}
            required
            rows={4}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        {errorMessage && (
          <p class="new-change-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
        <div class="new-change-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" class="btn--primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
