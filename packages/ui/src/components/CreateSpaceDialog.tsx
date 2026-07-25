import { useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { CreateSpaceRequest, CreateSpaceResponse } from '../api/types.js';
import {
  publishSpace,
  refreshSpaceCatalog,
} from '../store/space-catalog.js';
import type { LocalPathSelectionController } from '../store/use-local-path-selection.js';
import { spaceHref, type Space } from '../store/use-space.js';
import { LocalPathPicker } from './LocalPathPicker.js';
import { useT } from '../i18n/store.js';

type SpaceOperation = 'create-project' | 'create-store' | 'register-store';

function joinPreview(parent: string, separator: string, id: string): string {
  if (!parent || !id) return '';
  return parent.endsWith(separator)
    ? `${parent}${id}`
    : `${parent}${separator}${id}`;
}

/** Explicit project creation, Store setup, and Store registration flow. */
export function CreateSpaceDialog({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  const { route } = useLocation();
  const [operation, setOperation] = useState<SpaceOperation>('create-project');
  const [storeId, setStoreId] = useState('');
  const [visiblePath, setVisiblePath] = useState('');
  const [separator, setSeparator] = useState('/');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pathController = useRef<LocalPathSelectionController | null>(null);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    if (operation === 'create-store' && !storeId) {
      setSubmitError('Store id is required.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const selected = await pathController.current?.resolveForSubmit();
    if (!selected) {
      setSubmitting(false);
      return;
    }

    const request: CreateSpaceRequest =
      operation === 'create-project'
        ? { op: 'create-project', path: selected }
        : operation === 'create-store'
          ? { op: 'create-store', parent: selected, id: storeId }
          : {
              op: 'register-store',
              path: selected,
              ...(storeId ? { id: storeId } : {}),
            };
    try {
      const result: CreateSpaceResponse = await client.createSpace(request);
      // Publish before routing so both mounted consumers can render it in the
      // same SPA turn; this refresh started after publication is authoritative.
      publishSpace(result.space);
      void refreshSpaceCatalog();
      const space: Space = {
        type: result.space.type,
        id: result.space.id,
        selector: `${result.space.type}:${result.space.id}`,
      };
      route(spaceHref(space, 'board'));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setSubmitting(false);
      setSubmitError(
        caught instanceof ApiError ? caught.message : 'status.error.space_create'
      );
    }
  }

  const isStore = operation !== 'create-project';
  const preview =
    operation === 'create-store'
      ? joinPreview(visiblePath, separator, storeId)
      : '';

  return (
    <div class="create-space-dialog__overlay">
      <form
        class="create-space-dialog"
        onSubmit={handleSubmit}
        aria-label={t('spaces.create.aria')}
      >
        <h2 class="create-space-dialog__title">{t('spaces.create.title')}</h2>

        <div
          class="create-space-dialog__kind"
          role="group"
          aria-label="Space operation"
        >
          {(
            [
              ['create-project', 'Project'],
              ['create-store', 'Create new Store'],
              ['register-store', 'Register existing Store'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              class={`create-space-dialog__kind-btn${
                operation === value
                  ? ' create-space-dialog__kind-btn--selected'
                  : ''
              }`}
              aria-pressed={operation === value}
              disabled={submitting}
              onClick={() => {
                setOperation(value);
                setSubmitError(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <p class="create-space-dialog__current">
          {operation === 'create-store'
            ? 'Select the parent directory for the new Store.'
            : operation === 'register-store'
              ? 'Select the existing Store root.'
              : 'Select the Project root.'}
        </p>

        <LocalPathPicker
          classPrefix="create-space-dialog"
          disabled={submitting}
          controllerRef={pathController}
          currentLabel={
            operation === 'create-store'
              ? 'Parent directory'
              : operation === 'register-store'
                ? 'Existing Store root'
                : 'Project root'
          }
          onValueChange={(value, nextSeparator) => {
            setVisiblePath(value);
            setSeparator(nextSeparator);
          }}
        />

        {isStore && (
          <label class="create-space-dialog__field">
            <span>
              Store id {operation === 'register-store' ? '(optional override)' : ''}
            </span>
            <input
              type="text"
              name="storeId"
              value={storeId}
              disabled={submitting}
              required={operation === 'create-store'}
              placeholder={t('spaces.create.store_id_placeholder')}
              onInput={(event) =>
                setStoreId((event.target as HTMLInputElement).value)
              }
            />
          </label>
        )}

        {preview && (
          <p class="create-space-dialog__current" data-testid="derived-store-root">
            New Store root: <code>{preview}</code>
          </p>
        )}

        {submitError && (
          <p
            class="create-space-dialog__error"
            role="alert"
            data-testid="create-error"
          >
            {t(submitError)}
          </p>
        )}

        <div class="create-space-dialog__actions">
          <button
            type="button"
            class="btn--ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            {t('spaces.create.cancel')}
          </button>
          <button
            type="submit"
            class="btn--primary"
            disabled={
              submitting || (operation === 'create-store' && !storeId)
            }
          >
            {submitting
              ? t('spaces.create.creating')
              : operation === 'create-project'
                ? 'Create Project'
                : operation === 'create-store'
                  ? 'Create Store'
                  : 'Register Store'}
          </button>
        </div>
      </form>
    </div>
  );
}
