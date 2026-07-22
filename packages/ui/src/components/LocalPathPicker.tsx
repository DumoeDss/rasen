import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { LocalPathsResponse } from '../api/types.js';

/**
 * Shared server-local path browser, extracted from `CreateSpaceDialog` so every
 * dialog that needs a server-side path (create-space, and the workflow
 * init/import/export flows) drives the same `GET /api/v1/local-paths` browser
 * instead of a raw text field. The browser never touches the filesystem itself:
 * every directory fact on screen comes from `listLocalPaths`, starting at home
 * with parent navigation, git repositories visibly marked, and a typed absolute
 * path as the sole escape above home (belt-and-braces with the server nulling
 * `parent` at the home floor).
 *
 * Class names are parametrized by `classPrefix` so a host dialog keeps its own
 * exact styling and DOM (e.g. `create-space-dialog`) while sharing this one
 * implementation; the data-testids (`path-picker`, `current-path`,
 * `dir-entries`, `git-badge`) are stable across hosts.
 *
 * `mode: 'dir'` (default) lists only directories — the selection is the CURRENT
 * directory, reported via `onDirChange`. `mode: 'file-or-dir'` also lists files:
 * clicking a directory still navigates into it, and clicking a file reports its
 * absolute path via `onFileSelect` (the local-paths listing already includes
 * files, so a `.rasenpkg` is directly pickable).
 *
 * The Pipelines page (W3) has structurally identical import/export/init path
 * pickers and would naturally adopt this component too; left unwired here to
 * avoid overlapping with the concurrent Pipelines work.
 */
export interface LocalPathPickerProps {
  classPrefix: string;
  disabled?: boolean;
  mode?: 'dir' | 'file-or-dir';
  /** Label shown before the current path (default 'Target'). */
  currentLabel?: string;
  /** Called with the canonical current directory (and the platform separator) whenever the listing changes. */
  onDirChange?: (path: string, separator: string) => void;
  /** Called with a file's absolute path when a file entry is clicked (`file-or-dir` mode only). */
  onFileSelect?: (path: string) => void;
}

export function LocalPathPicker({
  classPrefix,
  disabled,
  mode = 'dir',
  currentLabel = 'Target',
  onDirChange,
  onFileSelect,
}: LocalPathPickerProps) {
  const [listing, setListing] = useState<LocalPathsResponse | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [browseError, setBrowseError] = useState<string | null>(null);

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
        onDirChange?.(res.path, res.separator);
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

  const entries = (listing?.entries ?? []).filter((e) => mode === 'file-or-dir' || e.isDir);

  return (
    <div class={`${classPrefix}__picker`} data-testid="path-picker">
      <div class={`${classPrefix}__pathbar`}>
        <input
          type="text"
          class={`${classPrefix}__path-input`}
          aria-label="Directory path"
          placeholder="Type an absolute path…"
          value={pathInput}
          disabled={disabled}
          onInput={(e) => setPathInput((e.target as HTMLInputElement).value)}
        />
        <button type="button" disabled={disabled} onClick={() => browse(pathInput)}>
          Go
        </button>
        <button
          type="button"
          disabled={disabled || listing?.home || !listing?.parent}
          onClick={() => {
            // Never ascend from the home start point: home is the confinement
            // floor, and the sole escape above it is a typed absolute path
            // (belt-and-braces with the server nulling `parent` at home).
            if (!listing?.home && listing?.parent) browse(listing.parent);
          }}
        >
          Up
        </button>
      </div>

      {browseError && (
        <p class={`${classPrefix}__browse-error`} role="alert">
          {browseError}
        </p>
      )}

      <p class={`${classPrefix}__current`} data-testid="current-path">
        {currentLabel}: <code>{listing?.path ?? '…'}</code>
      </p>

      <ul class={`${classPrefix}__entries`} data-testid="dir-entries">
        {entries.map((entry) => (
          <li key={entry.name}>
            <button
              type="button"
              class={`${classPrefix}__entry`}
              data-git={entry.isGitRepo ? 'true' : undefined}
              data-file={!entry.isDir ? 'true' : undefined}
              disabled={disabled}
              onClick={() => {
                if (!listing) return;
                const full = joinChild(listing.path, listing.separator, entry.name);
                if (entry.isDir) browse(full);
                else onFileSelect?.(full);
              }}
            >
              <span class={`${classPrefix}__entry-name`}>{entry.name}</span>
              {entry.isGitRepo && (
                <span class={`${classPrefix}__git-badge`} data-testid="git-badge">
                  git
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
