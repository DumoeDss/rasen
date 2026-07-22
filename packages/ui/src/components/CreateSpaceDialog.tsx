import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { CreateSpaceResponse, LocalPathsResponse } from '../api/types.js';
import { spaceHref, type Space } from '../store/use-space.js';

/**
 * Create-space flow (spaces-ui design D3/D4). A kind toggle (project | store),
 * a directory picker driven entirely by the local-path browsing endpoint
 * (starting at home, with parent navigation, git repositories visibly marked,
 * and a free path input as the sole escape above home), an optional store id,
 * and submit → the space-creation endpoint. On success the UI routes straight
 * into the new space's board (SPA nav — a hard navigation would drop the
 * token). On failure the CLI's own error message is shown verbatim.
 *
 * The browser never touches the filesystem itself: every directory fact on
 * screen comes from `listLocalPaths`, and the creation is performed entirely by
 * the server-spawned CLI.
 */
export function CreateSpaceDialog({ onCancel }: { onCancel: () => void }) {
  const { route } = useLocation();

  const [kind, setKind] = useState<'project' | 'store'>('project');
  const [storeId, setStoreId] = useState('');
  const [listing, setListing] = useState<LocalPathsResponse | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load a directory listing. An absolute `path` enumerates it; omitting it
  // starts at home. A browse error (bad path, permissions) is shown inline and
  // leaves the previous listing in place.
  function browse(path?: string) {
    setBrowseError(null);
    client
      .listLocalPaths(path)
      .then((res) => {
        setListing(res);
        setPathInput(res.path);
      })
      .catch((err) => {
        setBrowseError(err instanceof ApiError ? err.message : 'Failed to read that directory.');
      });
  }

  // Start at home on mount.
  useEffect(() => {
    browse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinChild(dir: string, sep: string, name: string): string {
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting || !listing) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result: CreateSpaceResponse = await client.createSpace({
        kind,
        path: listing.path,
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

  const dirEntries = listing?.entries.filter((e) => e.isDir) ?? [];

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

        <div class="create-space-dialog__picker" data-testid="path-picker">
          <div class="create-space-dialog__pathbar">
            <input
              type="text"
              class="create-space-dialog__path-input"
              aria-label="Directory path"
              placeholder="Type an absolute path…"
              value={pathInput}
              disabled={submitting}
              onInput={(e) => setPathInput((e.target as HTMLInputElement).value)}
            />
            <button type="button" disabled={submitting} onClick={() => browse(pathInput)}>
              Go
            </button>
            <button
              type="button"
              disabled={submitting || listing?.home || !listing?.parent}
              onClick={() => {
                // Never ascend from the home start point: home is the
                // confinement floor, and the sole escape above it is a typed
                // absolute path (belt-and-braces with the server nulling
                // `parent` at home). Elsewhere, "Up" follows the parent.
                if (!listing?.home && listing?.parent) browse(listing.parent);
              }}
            >
              Up
            </button>
          </div>

          {browseError && (
            <p class="create-space-dialog__browse-error" role="alert">
              {browseError}
            </p>
          )}

          <p class="create-space-dialog__current" data-testid="current-path">
            Target: <code>{listing?.path ?? '…'}</code>
          </p>

          <ul class="create-space-dialog__entries" data-testid="dir-entries">
            {dirEntries.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  class="create-space-dialog__entry"
                  data-git={entry.isGitRepo ? 'true' : undefined}
                  disabled={submitting}
                  onClick={() => listing && browse(joinChild(listing.path, listing.separator, entry.name))}
                >
                  <span class="create-space-dialog__entry-name">{entry.name}</span>
                  {entry.isGitRepo && (
                    <span class="create-space-dialog__git-badge" data-testid="git-badge">
                      git
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

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
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || !listing}>
            {submitting ? 'Creating…' : `Create ${kind}`}
          </button>
        </div>
      </form>
    </div>
  );
}
