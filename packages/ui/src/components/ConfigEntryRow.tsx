import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { WireConfigEntry, ConfigScope } from '../api/types.js';
import { selectControl, validateRangedNumber, writableScopes, defaultWriteScope } from '../config/controls.js';
import { errorSurface } from '../config/errors.js';

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
          {String(entry.value)}
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
            Global value: {String(entry.scopeValues.global)} (shadowed by project)
          </p>
        )}
      {entry.source === 'env-override' && (
        <p class="config-entry__shadowed">
          Environment variable overrides every scope
          {entry.scopeValues.global !== undefined
            ? ` (global value: ${String(entry.scopeValues.global)})`
            : ''}
          {entry.scopeValues.project !== undefined
            ? ` (project value: ${String(entry.scopeValues.project)})`
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
