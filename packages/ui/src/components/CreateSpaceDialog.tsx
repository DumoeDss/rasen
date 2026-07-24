import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { CreateSpaceResponse } from '../api/types.js';
import { spaceHref, type Space } from '../store/use-space.js';
import { LocalPathPicker } from './LocalPathPicker.js';
import { useT } from '../i18n/store.js';

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
  const t = useT();
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
      setSubmitError(err instanceof ApiError ? err.message : 'status.error.space_create');
    }
  }

  return (
    <div class="create-space-dialog__overlay">
      <form class="create-space-dialog" onSubmit={handleSubmit} aria-label={t('spaces.create.aria')}>
        <h2 class="create-space-dialog__title">{t('spaces.create.title')}</h2>

        <div class="create-space-dialog__kind" role="group" aria-label={t('spaces.create.kind_label')}>
          <button
            type="button"
            class={`create-space-dialog__kind-btn${kind === 'project' ? ' create-space-dialog__kind-btn--selected' : ''}`}
            aria-pressed={kind === 'project'}
            disabled={submitting}
            onClick={() => setKind('project')}
          >
            {t('spaces.create.project')}
          </button>
          <button
            type="button"
            class={`create-space-dialog__kind-btn${kind === 'store' ? ' create-space-dialog__kind-btn--selected' : ''}`}
            aria-pressed={kind === 'store'}
            disabled={submitting}
            onClick={() => setKind('store')}
          >
            {t('spaces.create.store')}
          </button>
        </div>

        <LocalPathPicker
          classPrefix="create-space-dialog"
          disabled={submitting}
          onDirChange={(path) => setTarget(path)}
        />

        {kind === 'store' && (
          <label class="create-space-dialog__field">
            <span>{t('spaces.create.store_id')}</span>
            <input
              type="text"
              name="storeId"
              value={storeId}
              disabled={submitting}
              placeholder={t('spaces.create.store_id_placeholder')}
              onInput={(e) => setStoreId((e.target as HTMLInputElement).value)}
            />
          </label>
        )}

        {submitError && (
          <p class="create-space-dialog__error" role="alert" data-testid="create-error">
            {t(submitError)}
          </p>
        )}

        <div class="create-space-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onCancel} disabled={submitting}>
            {t('spaces.create.cancel')}
          </button>
          <button type="submit" class="btn--primary" disabled={submitting || !target}>
            {submitting ? t('spaces.create.creating') : t('spaces.create.create', { kind })}
          </button>
        </div>
      </form>
    </div>
  );
}
