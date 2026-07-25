import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

import type { LocalPathSelectionKind } from '../api/types.js';
import {
  useLocalPathSelection,
  type LocalPathSelectionController,
} from '../store/use-local-path-selection.js';

export interface LocalPathPickerProps {
  classPrefix: string;
  disabled?: boolean;
  mode?: 'dir' | 'file-or-dir' | 'file';
  currentLabel?: string;
  controllerRef?: RefObject<LocalPathSelectionController | null>;
  onValueChange?: (value: string, separator: string) => void;
  onDirChange?: (path: string, separator: string) => void;
  onFileSelect?: (path: string) => void;
}

function selectionKind(mode: LocalPathPickerProps['mode']): LocalPathSelectionKind {
  if (mode === 'file') return 'file';
  if (mode === 'file-or-dir') return 'file-or-directory';
  return 'directory';
}

function joinChild(dir: string, separator: string, name: string): string {
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

/**
 * Shared chooser-first server-local path control. Its controller owns the
 * rendered value, resolved value, fallback listing, and submit resolution.
 */
export function LocalPathPicker({
  classPrefix,
  disabled,
  mode = 'dir',
  currentLabel = 'Target',
  controllerRef,
  onValueChange,
  onDirChange,
  onFileSelect,
}: LocalPathPickerProps) {
  const controller = useLocalPathSelection(selectionKind(mode));
  const valueChangeCallback = useRef(onValueChange);
  const directoryCallback = useRef(onDirChange);
  const fileCallback = useRef(onFileSelect);
  valueChangeCallback.current = onValueChange;
  directoryCallback.current = onDirChange;
  fileCallback.current = onFileSelect;
  if (controllerRef) controllerRef.current = controller;

  useLayoutEffect(() => {
    valueChangeCallback.current?.(controller.value, controller.separator);
  }, [controller.value, controller.separator]);

  useLayoutEffect(() => {
    void controller.browse();
    return () => {
      if (controllerRef) controllerRef.current = null;
    };
    // The controller is intentionally initialized once; its methods are
    // refreshed through controllerRef on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (controller.status !== 'resolved') return;
    if (controller.resolvedKind === 'directory') {
      directoryCallback.current?.(controller.value, controller.separator);
    } else if (controller.resolvedKind === 'file') {
      fileCallback.current?.(controller.value);
    }
  }, [
    controller.status,
    controller.value,
    controller.separator,
    controller.resolvedKind,
  ]);

  const entries = (controller.listing?.entries ?? []).filter((entry) => {
    if (mode === 'dir') return entry.isDir;
    return true;
  });

  return (
    <div class={`${classPrefix}__picker`} data-testid="path-picker">
      <div class={`${classPrefix}__chooser-actions`}>
        {(mode === 'dir' || mode === 'file-or-dir') && (
          <button
            type="button"
            disabled={disabled}
            data-testid="choose-directory"
            onClick={() => void controller.chooseNative('directory')}
          >
            Choose directory
          </button>
        )}
        {(mode === 'file' || mode === 'file-or-dir') && (
          <button
            type="button"
            disabled={disabled}
            data-testid="choose-file"
            onClick={() => void controller.chooseNative('file')}
          >
            Choose package file
          </button>
        )}
        {controller.nativeStatus !== 'idle' && (
          <span class={`${classPrefix}__chooser-status`} data-testid="chooser-fallback">
            {controller.nativeStatus === 'cancelled'
              ? 'Choice cancelled; current path preserved.'
              : 'Native choice unavailable; use the server browser below.'}
          </span>
        )}
      </div>

      <div class={`${classPrefix}__pathbar`}>
        <input
          type="text"
          class={`${classPrefix}__path-input`}
          aria-label="Server-local path"
          placeholder="Type an absolute server-local path"
          value={controller.value}
          disabled={disabled}
          data-status={controller.status}
          onInput={(event) =>
            controller.setValue((event.target as HTMLInputElement).value)
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void controller.resolveVisible();
            }
          }}
        />
        <button
          type="button"
          disabled={disabled || controller.status === 'resolving'}
          onClick={() => void controller.resolveVisible()}
        >
          Go
        </button>
        <button
          type="button"
          disabled={
            disabled ||
            controller.listing?.home ||
            !controller.listing?.parent
          }
          onClick={() => {
            const parent = controller.listing?.parent;
            if (!controller.listing?.home && parent) void controller.browse(parent);
          }}
        >
          Up
        </button>
      </div>

      {controller.error && (
        <p class={`${classPrefix}__browse-error`} role="alert">
          {controller.error}
        </p>
      )}

      <p class={`${classPrefix}__current`} data-testid="current-path">
        {currentLabel}: <code>{controller.value || '—'}</code>
        {controller.status === 'resolved' && (
          <span data-testid="path-resolved"> resolved</span>
        )}
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
              onClick={async () => {
                const listing = controller.listing;
                if (!listing) return;
                const full = joinChild(listing.path, listing.separator, entry.name);
                if (entry.isDir) {
                  await controller.browse(full);
                } else {
                  await controller.selectFile(full);
                }
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
