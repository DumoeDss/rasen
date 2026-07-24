import { useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionRecordWire } from '../api/types.js';

/**
 * Launch flow (design.md D4 of `slice3-sessions-ui`): kind + task + optional
 * changeName, submitted through the single `client.launchSession` seam
 * (NewChangeDialog's conventions: overlay, disabled-while-submitting,
 * verbatim server error). Client-side validation is minimal — non-empty
 * task — the server is the authoritative validator (400/409/503 envelopes
 * surface verbatim, including `agent_cli_unavailable`/`busy`). The board's
 * own new-change dialog is untouched: creating a change and launching a
 * supervised run are different speech acts on different endpoints.
 */
export function LaunchSessionDialog({
  onCancel,
  onLaunched,
  space,
  changeName: changeNamePrefill,
}: {
  onCancel: () => void;
  onLaunched: (session: SessionRecordWire) => void;
  /** Optional planning-space selector; the launched run is attributed to it (design D4). */
  space?: string;
  /** Optional change-name prefill — a single Task's change (blank for a portfolio container). */
  changeName?: string;
}) {
  const [kind, setKind] = useState<'auto' | 'goal'>('auto');
  const [task, setTask] = useState('');
  const [changeName, setChangeName] = useState(changeNamePrefill ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    if (task.trim().length === 0) {
      setErrorMessage('Task is required.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await client.launchSession({
        kind,
        task,
        changeName: changeName.trim().length > 0 ? changeName.trim() : undefined,
        ...(space !== undefined ? { space } : {}),
      });
      onLaunched(result.session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'Failed to launch the session.');
    }
  }

  return (
    <div class="launch-session-dialog__overlay">
      <form class="launch-session-dialog" onSubmit={handleSubmit} aria-label="Launch session">
        <h2 class="launch-session-dialog__title">Launch session</h2>
        <fieldset class="launch-session-dialog__field launch-session-dialog__kind" disabled={submitting}>
          <legend>Kind</legend>
          <label>
            <input
              type="radio"
              name="kind"
              value="auto"
              checked={kind === 'auto'}
              onChange={() => setKind('auto')}
            />
            auto
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              value="goal"
              checked={kind === 'goal'}
              onChange={() => setKind('goal')}
            />
            goal
          </label>
        </fieldset>
        <label class="launch-session-dialog__field">
          <span>Task</span>
          <textarea
            name="task"
            value={task}
            disabled={submitting}
            required
            rows={4}
            onInput={(e) => setTask((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <label class="launch-session-dialog__field">
          <span>Change name (optional)</span>
          <input
            type="text"
            name="changeName"
            value={changeName}
            disabled={submitting}
            onInput={(e) => setChangeName((e.target as HTMLInputElement).value)}
          />
          <small class="launch-session-dialog__hint">
            Links to an existing change for live progress.
          </small>
        </label>
        {errorMessage && (
          <p class="launch-session-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
        <div class="launch-session-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" class="btn--primary" disabled={submitting}>
            {submitting ? 'Launching…' : 'Launch'}
          </button>
        </div>
      </form>
    </div>
  );
}
