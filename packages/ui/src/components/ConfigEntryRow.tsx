import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { StoreLayerRef, WireConfigEntry } from '../api/types.js';
import {
  selectControl,
  validateRangedNumber,
  validateThresholdValue,
  modeScope,
  localScopeFor,
  isStoreInherited,
  type ConfigMode,
  type SpaceType,
} from '../config/controls.js';
import { errorSurface } from '../config/errors.js';
import { labelFor } from '../config/labels.js';
import { spaceHref } from '../store/use-space.js';
import { ValueDisplay, ValueSummary } from './ui/ValueDisplay.js';

/** An input's `value` attribute — an unset (null/undefined) draft renders as an empty field, never the literal "undefined". */
function inputValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

interface Props {
  entry: WireConfigEntry;
  /** The active page-level scope mode (design D1) — the write target and visibility filter. */
  mode: ConfigMode;
  /** The current space's type — decides what "Local" writes (project vs store scope). */
  spaceType: SpaceType;
  /** The `<type>:<id>` selector every config call is addressed with (design D7). */
  spaceSelector: string;
  /** The store layer contributing to this read (design D3); null when the space has no store inheritance. */
  storeRef: StoreLayerRef | null;
  /** Bubbles a page-level error (space-resolution) up to the page. */
  onPageError: (message: string, fix?: string) => void;
  /** Replaces this row's entry in place after a successful write/unset (design.md D6). */
  onEntryUpdated: (entry: WireConfigEntry) => void;
}

/** The wider layers below the effective source, narrow→wide, used to reveal shadowed values (design D3). */
function shadowedWiderScopes(entry: WireConfigEntry): Array<'store' | 'global'> {
  const chain = ['project', 'store', 'global'] as const;
  const idx = chain.indexOf(entry.source as 'project' | 'store' | 'global');
  if (idx < 0) return []; // default / env-override reveal nothing here
  return (['store', 'global'] as const).filter(
    (s) => chain.indexOf(s) > idx && entry.scopeValues[s] !== undefined
  );
}

/** One config key's row: label, value, source badge, inherited/shadowed lines, warnings, and its edit control. */
export function ConfigEntryRow({
  entry,
  mode,
  spaceType,
  spaceSelector,
  storeRef,
  onPageError,
  onEntryUpdated,
}: Props) {
  const key = entry.definition.key;
  const writeScope = modeScope(mode, spaceType);
  // A store-inherited key is read-only with an "edit in store" link (design
  // D3): the UI does not offer project-level overrides of store-set keys.
  const storeInherited = isStoreInherited(entry, mode, spaceType) && storeRef !== null;
  const control = storeInherited ? { kind: 'readonly' as const, readonly: true } : selectControl(entry, mode, spaceType);

  const [draft, setDraft] = useState<unknown>(entry.value);
  const [fieldError, setFieldError] = useState<{ message: string; fix?: string } | null>(null);
  const [pending, setPending] = useState(false);

  // Resync local edit state whenever the server hands back a fresh entry
  // (write, unset, a space switch re-fetch, or a mode change) — rows are keyed
  // by `definition.key`, which never changes, so preact reuses the component
  // instance and `draft` would otherwise keep showing the value from before.
  useEffect(() => {
    setDraft(entry.value);
    setFieldError(null);
  }, [entry, mode]);

  async function commit(value: unknown) {
    setPending(true);
    setFieldError(null);
    try {
      const result = await client.putKey(key, { scope: writeScope, value }, spaceSelector);
      onEntryUpdated(result.entry);
    } catch (err) {
      surfaceError(err);
    } finally {
      setPending(false);
    }
  }

  async function unset() {
    setPending(true);
    setFieldError(null);
    try {
      const result = await client.deleteKey(key, writeScope, spaceSelector);
      onEntryUpdated(result.entry);
    } catch (err) {
      surfaceError(err);
    } finally {
      setPending(false);
    }
  }

  function surfaceError(err: unknown) {
    if (err instanceof ApiError) {
      if (errorSurface(err.code) === 'page') {
        onPageError(err.message, err.fix);
      } else {
        setFieldError({ message: err.message, fix: err.fix });
      }
    } else {
      setFieldError({ message: 'Unexpected error' });
    }
  }

  function renderControl() {
    if (control.readonly) {
      return (
        <span class="control control--readonly">
          <ValueDisplay value={entry.value} testid="config-value" />
        </span>
      );
    }

    switch (control.kind) {
      case 'toggle':
        return (
          <input
            type="checkbox"
            checked={Boolean(draft)}
            disabled={pending}
            onChange={(e) => {
              const value = (e.target as HTMLInputElement).checked;
              setDraft(value);
              commit(value);
            }}
          />
        );
      case 'select': {
        // A current value outside the active scope's domain (e.g. a saved
        // profile deleted after being set, or a hand-edited value) stays
        // visible as an annotated, non-reselectable option rather than snapping
        // to a wrong value or vanishing (config-ui-package spec, design D3).
        const current = inputValue(draft);
        const options = control.enumValues ?? [];
        const missing = current !== '' && !options.includes(current);
        return (
          <select
            value={current}
            disabled={pending}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              setDraft(value);
              commit(value);
            }}
          >
            {missing && (
              <option key={current} value={current} disabled>
                {current} (not found)
              </option>
            )}
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      }
      case 'ranged-number':
        return (
          <input
            type="number"
            value={inputValue(draft)}
            disabled={pending}
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              setDraft(raw);
              const localError = validateRangedNumber(raw, control.range);
              if (localError) {
                setFieldError({ message: localError });
                return;
              }
              commit(raw);
            }}
          />
        );
      case 'threshold': {
        const isAbsolute =
          typeof draft === 'object' && draft !== null && 'remainingTokens' in (draft as object);
        const fractionValue = isAbsolute ? 0.5 : (draft as number);
        // A sensible, always-valid seed for switching TO the absolute form:
        // clearly above the floor (never the boundary-invalid `floor + 1`,
        // which reads as an arbitrary edge case rather than a real default).
        const remainingSeed = Math.max((control.remainingTokensGt ?? 0) + 1, 50_000);
        const remainingValue = isAbsolute
          ? (draft as { remainingTokens: number }).remainingTokens
          : remainingSeed;
        return (
          <div class="control control--threshold">
            <label>
              <input
                type="radio"
                name={`${key}-form`}
                checked={!isAbsolute}
                disabled={pending}
                onChange={() => {
                  // Radio selection commits immediately (same invariant as
                  // every other control here): the displayed form must never
                  // diverge from the stored value, so switching forms writes
                  // through with a sensible seed rather than waiting for the
                  // number input to be edited (MIN-M3).
                  const value = Number.isNaN(fractionValue) ? 0.5 : fractionValue;
                  setDraft(value);
                  commit(value);
                }}
              />
              Fraction
            </label>
            <label>
              <input
                type="radio"
                name={`${key}-form`}
                checked={isAbsolute}
                disabled={pending}
                onChange={() => {
                  const value = { remainingTokens: remainingSeed };
                  setDraft(value);
                  commit(value);
                }}
              />
              Remaining tokens
            </label>
            {!isAbsolute ? (
              <input
                type="number"
                step="any"
                value={String(fractionValue)}
                disabled={pending}
                onChange={(e) => {
                  const raw = Number((e.target as HTMLInputElement).value);
                  setDraft(raw);
                  const localError = validateThresholdValue(raw, control.range, control.remainingTokensGt);
                  if (localError) {
                    setFieldError({ message: localError });
                    return;
                  }
                  commit(raw);
                }}
              />
            ) : (
              <input
                type="number"
                step="1"
                value={String(remainingValue)}
                disabled={pending}
                onChange={(e) => {
                  const raw = Number((e.target as HTMLInputElement).value);
                  const value = { remainingTokens: raw };
                  setDraft(value);
                  const localError = validateThresholdValue(value, control.range, control.remainingTokensGt);
                  if (localError) {
                    setFieldError({ message: localError });
                    return;
                  }
                  commit(value);
                }}
              />
            )}
          </div>
        );
      }
      case 'model': {
        // A datalist offers known model-preset ids as non-binding suggestions
        // (design.md D6/D8) — the input never restricts the typed value to
        // the list; an id matching none of them is still accepted as-is.
        const listId = `${key}-model-suggestions`;
        return (
          <>
            <input
              type="text"
              list={listId}
              value={inputValue(draft)}
              disabled={pending}
              onChange={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setDraft(value);
                commit(value);
              }}
            />
            <datalist id={listId}>
              {control.modelSuggestions?.map((id) => <option key={id} value={id} />)}
            </datalist>
          </>
        );
      }
      case 'text':
      default:
        return (
          <input
            type="text"
            value={inputValue(draft)}
            disabled={pending}
            onChange={(e) => {
              const value = (e.target as HTMLInputElement).value;
              setDraft(value);
              commit(value);
            }}
          />
        );
    }
  }

  function renderAnnotations() {
    if (entry.source === 'env-override') {
      return (
        <p class="config-entry__shadowed">
          Environment variable overrides every scope
          {entry.scopeValues.global !== undefined && (
            <>
              {' '}(global value: <ValueSummary value={entry.scopeValues.global} />)
            </>
          )}
          {entry.scopeValues.store !== undefined && (
            <>
              {' '}(store value: <ValueSummary value={entry.scopeValues.store} />)
            </>
          )}
          {entry.scopeValues.project !== undefined && (
            <>
              {' '}(project value: <ValueSummary value={entry.scopeValues.project} />)
            </>
          )}
        </p>
      );
    }

    const localScope = localScopeFor(spaceType);
    const hasLocalValue = entry.scopeValues[localScope] !== undefined;
    const multiScope = entry.definition.scopes.length > 1;

    // Inherited-value line (design D3): in Local mode, a visible multi-scope
    // key with no value at the local scope shows where its value comes from —
    // the shadowed-value element inverted (the winning wider value shown under
    // an absent local one).
    if (mode === 'local' && multiScope && !hasLocalValue) {
      if (entry.scopeValues.store !== undefined && storeRef) {
        return (
          <p class="config-entry__shadowed">
            Inherited from store {storeRef.id}: <ValueSummary value={entry.scopeValues.store} />
            {storeInherited && (
              <>
                {' '}
                <a
                  class="config-entry__store-edit"
                  href={spaceHref(
                    { type: 'store', id: storeRef.id, selector: `store:${storeRef.id}` },
                    'config'
                  )}
                >
                  Edit in store {storeRef.id} →
                </a>
              </>
            )}
          </p>
        );
      }
      if (entry.scopeValues.global !== undefined) {
        return (
          <p class="config-entry__shadowed">
            Inherited from global: <ValueSummary value={entry.scopeValues.global} />
          </p>
        );
      }
      return (
        <p class="config-entry__shadowed">
          Inherited from default: <ValueDisplay value={entry.definition.defaultValue} />
        </p>
      );
    }

    // Shadowed reveal (design D3): a local value shadows wider layers — keep
    // those values visible, now including a shadowed store value.
    const shadowed = shadowedWiderScopes(entry);
    if (shadowed.length > 0) {
      return (
        <>
          {shadowed.map((s) => (
            <p key={s} class="config-entry__shadowed">
              {s === 'store' ? 'Store' : 'Global'} value: <ValueSummary value={entry.scopeValues[s]} /> (shadowed by{' '}
              {entry.source})
            </p>
          ))}
        </>
      );
    }

    return null;
  }

  return (
    <div class="config-entry" data-key={key}>
      <div class="config-entry__header">
        <span class="config-entry__label">{labelFor(key)}</span>
        <span class="config-entry__key">{key}</span>
        <span class={`config-entry__source config-entry__source--${entry.source}`}>{entry.source}</span>
      </div>
      <p class="config-entry__description">{entry.definition.description}</p>

      {entry.warnings && entry.warnings.length > 0 && (
        <ul class="config-entry__warnings">
          {entry.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {renderControl()}

      {renderAnnotations()}

      {fieldError && (
        <p class="config-entry__error">
          {fieldError.message}
          {fieldError.fix ? ` — ${fieldError.fix}` : ''}
        </p>
      )}

      {!control.readonly && entry.scopeValues[writeScope] !== undefined && (
        <button type="button" disabled={pending} onClick={() => unset()}>
          Unset {writeScope} value
        </button>
      )}
    </div>
  );
}
