import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { CreateSpaceResponse } from '../api/types.js';
import { spaceHref, type Space } from '../store/use-space.js';
import { LocalPathPicker } from './LocalPathPicker.js';

/**
 * Create-space flow (spaces-ui design D3/D4). A kind toggle (project | store),
 * a directory picker driven entirely by the shared local-path browser
 * (`LocalPathPicker` — starting at home, with parent navigation, git
 * repositories visibly marked, and a free path input as the sole escape above
 * home), an optional store id, and submit → the space-creation endpoint. On
 * success the UI routes straight into the new space's board (SPA nav — a hard
 * navigation would drop the token). On failure the CLI's own error message is
 * shown verbatim.
 *
 * The browser never touches the filesystem itself: every directory fact on
 * screen comes from `listLocalPaths`, and the creation is performed entirely by
 * the server-spawned CLI.
 */
export function CreateSpaceDialog({ onCancel }: { onCancel: () => void }) {
  const { route } = useLocation();

  const [kind, setKind] = useState<'project' | 'store'>('project');
  const [storeId, setStoreId] = useState('');
  // The picker's current directory — the space's target root. Null until the
  // home listing loads (submit stays disabled until then, exactly as before).
  const [target, setTarget] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting || !target) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result: CreateSpaceResponse = await client.createSpace({
        kind,
        path: target,
        ...(kind === 'store' && storeId ? { id: storeId } : {}),
      });
      // Route straight into the new space's board (SPA nav).
      const space: Space = {
        type: result.space.type,
        id: result.space.id,
        selector: `${result.space.type}:${result.space.id}`,
      };
      route(spaceHref(space, 'board'));
    } catch (err) {
      // A 401 already triggered the shared re-launch notice; the app is about
      // to unmount this dialog.
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to create the space.');
    }
  }

  return (
    <div class="create-space-dialog__overlay">
      <form class="create-space-dialog" onSubmit={handleSubmit} aria-label="Create space">
        <h2 class="create-space-dialog__title">New space</h2>

        <div class="create-space-dialog__kind" role="group" aria-label="Space kind">
          <button
            type="button"
            class={`create-space-dialog__kind-btn${kind === 'project' ? ' create-space-dialog__kind-btn--selected' : ''}`}
            aria-pressed={kind === 'project'}
            disabled={submitting}
            onClick={() => setKind('project')}
          >
            Project
          </button>
          <button
            type="button"
            class={`create-space-dialog__kind-btn${kind === 'store' ? ' create-space-dialog__kind-btn--selected' : ''}`}
            aria-pressed={kind === 'store'}
            disabled={submitting}
            onClick={() => setKind('store')}
          >
            Store
          </button>
        </div>

        <LocalPathPicker
          classPrefix="create-space-dialog"
          disabled={submitting}
          onDirChange={(path) => setTarget(path)}
        />

        {kind === 'store' && (
          <label class="create-space-dialog__field">
            <span>Store id</span>
            <input
              type="text"
              name="storeId"
              value={storeId}
              disabled={submitting}
              placeholder="required for a fresh store"
              onInput={(e) => setStoreId((e.target as HTMLInputElement).value)}
            />
          </label>
        )}

        {submitError && (
          <p class="create-space-dialog__error" role="alert" data-testid="create-error">
            {submitError}
          </p>
        )}

        <div class="create-space-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" class="btn--primary" disabled={submitting || !target}>
            {submitting ? 'Creating…' : `Create ${kind}`}
          </button>
        </div>
      </form>
    </div>
  );
}
