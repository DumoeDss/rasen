import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { CreateSpaceRequest, CreateSpaceResponse } from '../api/types.js';
import {
  publishSpace,
  refreshSpaceCatalog,
} from '../store/space-catalog.js';
import type { LocalPathSelectionController } from '../store/use-local-path-selection.js';
import { spaceFromEntry, spaceHomeHref } from '../store/use-space.js';
import { LocalPathPicker } from './LocalPathPicker.js';
import { useT } from '../i18n/store.js';

type SpaceOperation = 'create-project' | 'create-store' | 'register-store';

interface CreateSpaceDialogProps {
  onCancel: () => void;
  fixedOperation?: 'create-store';
  onSuccess?: (result: CreateSpaceResponse) => void;
}

function joinPreview(parent: string, separator: string, id: string): string {
  if (!parent || !id) return '';
  return parent.endsWith(separator)
    ? `${parent}${id}`
    : `${parent}${separator}${id}`;
}

/** Explicit project creation, Store setup, and Store registration flow. */
export function CreateSpaceDialog({
  onCancel,
  fixedOperation,
  onSuccess,
}: CreateSpaceDialogProps) {
  const t = useT();
  const { route } = useLocation();
  const [selectedOperation, setSelectedOperation] = useState<SpaceOperation>('create-project');
  const [storeName, setStoreName] = useState('');
  const [visiblePath, setVisiblePath] = useState('');
  const [separator, setSeparator] = useState('/');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pathController = useRef<LocalPathSelectionController | null>(null);
  const mountedRef = useRef(true);
  const submitAttemptRef = useRef(0);
  const operation = fixedOperation ?? selectedOperation;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submitAttemptRef.current += 1;
    };
  }, []);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    const hasStoreName = storeName.trim().length > 0;
    if (operation === 'create-store' && !hasStoreName) {
      setSubmitError('spaces.create.store_id_required');
      return;
    }
    const attempt = ++submitAttemptRef.current;
    setSubmitting(true);
    setSubmitError(null);
    const selected = await pathController.current?.resolveForSubmit();
    if (!mountedRef.current || attempt !== submitAttemptRef.current) return;
    if (!selected) {
      setSubmitting(false);
      return;
    }

    const request: CreateSpaceRequest =
      operation === 'create-project'
        ? { op: 'create-project', path: selected }
        : operation === 'create-store'
          ? { op: 'create-store', parent: selected, id: storeName }
          : {
              op: 'register-store',
              path: selected,
              ...(hasStoreName ? { id: storeName } : {}),
            };
    try {
      const result: CreateSpaceResponse = await client.createSpace(request);
      if (!mountedRef.current || attempt !== submitAttemptRef.current) return;
      // Publish before routing so both mounted consumers can render it in the
      // same SPA turn; this refresh started after publication is authoritative.
      publishSpace(result.space);
      void refreshSpaceCatalog();
      if (onSuccess) {
        onSuccess(result);
        return;
      }
      route(spaceHomeHref(spaceFromEntry(result.space)));
    } catch (caught) {
      if (!mountedRef.current || attempt !== submitAttemptRef.current) return;
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
      ? joinPreview(visiblePath, separator, storeName)
      : '';

  return (
    <div class="create-space-dialog__overlay">
      <form
        class="create-space-dialog"
        onSubmit={handleSubmit}
        aria-label={t('spaces.create.aria')}
      >
        <h2 class="create-space-dialog__title">{t('spaces.create.title')}</h2>

        {!fixedOperation && (
          <div
            class="create-space-dialog__kind"
            role="group"
            aria-label={t('spaces.create.operation_aria')}
            data-testid="space-operation-chooser"
          >
            {(
              [
                ['create-project', t('spaces.create.project')],
                ['create-store', t('spaces.create.create_store_operation')],
                ['register-store', t('spaces.create.register_store_operation')],
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
                  setSelectedOperation(value);
                  setSubmitError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <p class="create-space-dialog__current">
          {operation === 'create-store'
            ? t('spaces.create.instructions.create_store')
            : operation === 'register-store'
              ? t('spaces.create.instructions.register_store')
              : t('spaces.create.instructions.project')}
        </p>

        <LocalPathPicker
          classPrefix="create-space-dialog"
          disabled={submitting}
          controllerRef={pathController}
          currentLabel={
            operation === 'create-store'
              ? t('spaces.create.path_label.parent_directory')
              : operation === 'register-store'
                ? t('spaces.create.path_label.existing_store_root')
                : t('spaces.create.path_label.project_root')
          }
          onValueChange={(value, nextSeparator) => {
            setVisiblePath(value);
            setSeparator(nextSeparator);
          }}
        />

        {isStore && (
          <label class="create-space-dialog__field">
            <span>
              {operation === 'register-store'
                ? t('spaces.create.store_id_optional')
                : t('spaces.create.store_id')}
            </span>
            <input
              type="text"
              name="storeName"
              value={storeName}
              disabled={submitting}
              required={operation === 'create-store'}
              placeholder={t('spaces.create.store_id_placeholder')}
              onInput={(event) => {
                setStoreName((event.target as HTMLInputElement).value);
                setSubmitError(null);
              }}
            />
            <small>{t('spaces.create.store_identity_hint')}</small>
          </label>
        )}

        {preview && (
          <p class="create-space-dialog__current" data-testid="derived-store-root">
            {t('spaces.create.new_store_root')}: <code>{preview}</code>
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
              submitting || (operation === 'create-store' && !storeName.trim())
            }
          >
            {submitting
              ? t('spaces.create.creating')
              : operation === 'create-project'
                ? t('spaces.create.action.create_project')
                : operation === 'create-store'
                  ? t('spaces.create.action.create_store')
                  : t('spaces.create.action.register_store')}
          </button>
        </div>
      </form>
    </div>
  );
}
