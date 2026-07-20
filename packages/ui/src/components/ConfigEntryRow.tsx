import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { WireConfigEntry, ConfigScope } from '../api/types.js';
import {
  selectControl,
  validateRangedNumber,
  validateThresholdValue,
  writableScopes,
  defaultWriteScope,
} from '../config/controls.js';
import { errorSurface } from '../config/errors.js';

/** Renders a value for display — objects (e.g. a `{ remainingTokens: N }` threshold) as JSON, everything else via `String()`. */
function formatDisplayValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

interface Props {
  entry: WireConfigEntry;
  projectId?: string;
  /** Bubbles a page-level error (project_required / project_not_found) up to the page. */
  onPageError: (message: string, fix?: string) => void;
  /** Replaces this row's entry in place after a successful write/unset (design.md D6). */
  onEntryUpdated: (entry: WireConfigEntry) => void;
}

/** One config key's row: value, source badge, shadowed scope values, warnings, and its edit control. */
export function ConfigEntryRow({ entry, projectId, onPageError, onEntryUpdated }: Props) {
  const hasProject = projectId !== undefined;
  const control = selectControl(entry, hasProject);
  const scopes = writableScopes(entry, hasProject);
  // Only "project"-scoped keys become newly readonly for lack of a project
  // (design.md D6 "Launched outside a project") — env-override/wildcard
  // entries are readonly regardless and get no such hint.
  const disabledForNoProject =
    control.readonly &&
    entry.source !== 'env-override' &&
    !entry.definition.wildcard &&
    entry.definition.scopes.includes('project') &&
    !hasProject;
  const [scope, setScope] = useState<ConfigScope | undefined>(defaultWriteScope(entry, hasProject));
  const [draft, setDraft] = useState<unknown>(entry.value);
  const [fieldError, setFieldError] = useState<{ message: string; fix?: string } | null>(null);
  const [pending, setPending] = useState(false);

  const key = entry.definition.key;

  // Resync local edit state whenever the server hands back a fresh entry
  // (write, unset, or a project switch re-fetch) — rows are keyed by
  // `definition.key`, which never changes, so preact reuses the component
  // instance and `draft`/`scope` would otherwise keep showing the value from
  // before the write (design.md D6 "Unset returns a scope value to
  // inherited").
  useEffect(() => {
    setDraft(entry.value);
    setScope(defaultWriteScope(entry, hasProject));
    setFieldError(null);
  }, [entry, hasProject]);

  async function commit(value: unknown, writeScope: ConfigScope) {
    setPending(true);
    setFieldError(null);
    try {
      const result = await client.putKey(key, { scope: writeScope, value }, projectId);
      onEntryUpdated(result.entry);
    } catch (err) {
      if (err instanceof ApiError) {
        if (errorSurface(err.code) === 'page') {
          onPageError(err.message, err.fix);
        } else {
          setFieldError({ message: err.message, fix: err.fix });
        }
      } else {
        setFieldError({ message: 'Unexpected error' });
      }
    } finally {
      setPending(false);
    }
  }

  async function unset(writeScope: ConfigScope) {
    setPending(true);
    setFieldError(null);
    try {
      const result = await client.deleteKey(key, writeScope, projectId);
      onEntryUpdated(result.entry);
    } catch (err) {
      if (err instanceof ApiError) {
        if (errorSurface(err.code) === 'page') {
          onPageError(err.message, err.fix);
        } else {
          setFieldError({ message: err.message, fix: err.fix });
        }
      } else {
        setFieldError({ message: 'Unexpected error' });
      }
    } finally {
      setPending(false);
    }
  }

  function renderControl() {
    if (control.readonly) {
      return (
        <span class="control control--readonly">
          {formatDisplayValue(entry.value)}
          {disabledForNoProject && (
            <span class="config-entry__no-project-hint">
              {' '}
              — select a project above to edit
            </span>
          )}
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
              if (scope) commit(value, scope);
            }}
          />
        );
      case 'select':
        return (
          <select
            value={String(draft)}
            disabled={pending}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              setDraft(value);
              if (scope) commit(value, scope);
            }}
          >
            {control.enumValues?.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      case 'ranged-number':
        return (
          <input
            type="number"
            value={String(draft)}
            disabled={pending}
            onChange={(e) => {
              const raw = Number((e.target as HTMLInputElement).value);
              setDraft(raw);
              const localError = validateRangedNumber(raw, control.range);
              if (localError) {
                setFieldError({ message: localError });
                return;
              }
              if (scope) commit(raw, scope);
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
                  if (scope) commit(value, scope);
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
                  if (scope) commit(value, scope);
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
                  if (scope) commit(raw, scope);
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
                  if (scope) commit(value, scope);
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
              value={String(draft)}
              disabled={pending}
              onChange={(e) => {
                const value = (e.target as HTMLInputElement).value;
                setDraft(value);
                if (scope) commit(value, scope);
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
            value={String(draft)}
            disabled={pending}
            onChange={(e) => {
              const value = (e.target as HTMLInputElement).value;
              setDraft(value);
              if (scope) commit(value, scope);
            }}
          />
        );
    }
  }

  return (
    <div class="config-entry" data-key={key}>
      <div class="config-entry__header">
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

      {scopes.length > 1 && !control.readonly && (
        <label class="config-entry__scope-choice">
          Scope
          <select
            value={scope}
            onChange={(e) => setScope((e.target as HTMLSelectElement).value as ConfigScope)}
          >
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      {renderControl()}

      {entry.source === 'project' &&
        entry.scopeValues.global !== undefined &&
        entry.scopeValues.project !== undefined && (
          <p class="config-entry__shadowed">
            Global value: {formatDisplayValue(entry.scopeValues.global)} (shadowed by project)
          </p>
        )}
      {entry.source === 'env-override' && (
        <p class="config-entry__shadowed">
          Environment variable overrides every scope
          {entry.scopeValues.global !== undefined
            ? ` (global value: ${formatDisplayValue(entry.scopeValues.global)})`
            : ''}
          {entry.scopeValues.project !== undefined
            ? ` (project value: ${formatDisplayValue(entry.scopeValues.project)})`
            : ''}
        </p>
      )}

      {fieldError && (
        <p class="config-entry__error">
          {fieldError.message}
          {fieldError.fix ? ` — ${fieldError.fix}` : ''}
        </p>
      )}

      {!control.readonly &&
        scopes.map(
          (s) =>
            entry.scopeValues[s] !== undefined && (
              <button key={s} type="button" disabled={pending} onClick={() => unset(s)}>
                Unset {s} value
              </button>
            )
        )}
    </div>
  );
}
