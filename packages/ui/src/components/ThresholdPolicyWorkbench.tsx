import { useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  ConfigScope,
  StoreLayerRef,
  ThresholdBindingRow,
  ThresholdDiagnostic,
  ThresholdPresetSeed,
  ThresholdRole,
  ThresholdScheme,
  ThresholdSchemeCatalogResponse,
  ThresholdSchemeListEntry,
  ThresholdValue,
  WireConfigEntry,
  WirePipeline,
} from '../api/types.js';
import {
  isStoreInherited,
  modeScope,
  type ConfigMode,
  type SpaceType,
} from '../config/controls.js';
import { useT } from '../i18n/store.js';
import { spaceHref, storeSpaceFromRef } from '../store/use-space.js';

const HANDOFF_ROLES = ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'] as const;
const REUSE_ROLES = ['planner', 'implementer'] as const;
const SCHEME_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface WorkbenchProps {
  catalog: ThresholdSchemeCatalogResponse;
  entries: WireConfigEntry[];
  pipelines: WirePipeline[];
  mode: ConfigMode;
  spaceType: SpaceType;
  selector: string;
  storeRef: StoreLayerRef | null;
  onRefresh: () => Promise<void>;
  onPageError: (message: string, fix?: string) => void;
}

function formatThreshold(value: ThresholdValue): string {
  return typeof value === 'number' ? String(value) : `${value.remainingTokens}`;
}

function sourceLabel(
  t: ReturnType<typeof useT>,
  source: 'preset' | 'default'
): string {
  return t(`pipelines.threshold.source.${source}`);
}

function roleLabel(t: ReturnType<typeof useT>, role: ThresholdRole): string {
  return t(`pipelines.threshold.role.${role}`);
}

function thresholdRoleEntries<R extends ThresholdRole>(
  values: Partial<Record<R, ThresholdValue>> | undefined
): Array<[R, ThresholdValue]> {
  return Object.entries(values ?? {}) as Array<[R, ThresholdValue]>;
}

function uniqueDiagnostics(pipelines: WirePipeline[]): ThresholdDiagnostic[] {
  const all = pipelines.flatMap((pipeline) => [
    ...pipeline.stages.flatMap((stage) => stage.effectiveHandoff.diagnostics ?? []),
    ...(pipeline.effectiveReuse?.diagnostics ?? []),
  ]);
  return all.filter(
    (diagnostic, index) =>
      all.findIndex(
        (candidate) =>
          candidate.code === diagnostic.code &&
          candidate.scope === diagnostic.scope &&
          candidate.row === diagnostic.row &&
          candidate.scheme === diagnostic.scheme
      ) === index
  );
}

export function ThresholdPolicyWorkbench(props: WorkbenchProps) {
  const t = useT();
  const [editor, setEditor] = useState<
    | { mode: 'create'; seed: ThresholdScheme; presetId?: string }
    | { mode: 'update'; name: string; seed: ThresholdScheme }
    | null
  >(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const validSchemes = props.catalog.schemes.filter(
    (entry): entry is Extract<ThresholdSchemeListEntry, { valid: true }> =>
      entry.valid
  );
  const diagnostics = uniqueDiagnostics(props.pipelines);
  const bindingEntries = props.entries.filter((entry) =>
    entry.instanceKey?.startsWith('thresholds.bindings.')
  );
  const hasBindings = bindingEntries.length > 0;

  const openCreate = (seed?: ThresholdScheme, presetId?: string) => {
    setFeedback(null);
    setEditor({
      mode: 'create',
      seed: seed ?? { handoff: 0.5, reuse: 0.25 },
      ...(presetId ? { presetId } : {}),
    });
  };

  return (
    <>
      <section class="threshold-library" data-testid="threshold-scheme-library">
        <div class="threshold-section__header">
          <div>
            <h3>{t('pipelines.threshold.schemes.title')}</h3>
            <p>{t('pipelines.threshold.schemes.description')}</p>
          </div>
          <button
            type="button"
            class="btn--primary"
            data-testid="threshold-scheme-new"
            onClick={() => openCreate()}
          >
            {t('pipelines.threshold.schemes.new')}
          </button>
        </div>

        {feedback && (
          <p class="threshold-feedback" role="status" data-testid="threshold-feedback">
            {feedback}
          </p>
        )}

        {props.catalog.schemes.length === 0 ? (
          <div class="threshold-empty" data-testid="threshold-schemes-empty">
            <strong>{t('pipelines.threshold.schemes.empty_title')}</strong>
            <span>{t('pipelines.threshold.schemes.empty_body')}</span>
            <button type="button" onClick={() => openCreate()}>
              {t('pipelines.threshold.schemes.empty_action')}
            </button>
          </div>
        ) : (
          <div class="threshold-scheme-grid">
            {props.catalog.schemes.map((entry) =>
              entry.valid ? (
                <SchemeCard
                  key={entry.name}
                  entry={entry}
                  onEdit={() =>
                    setEditor({ mode: 'update', name: entry.name, seed: entry.scheme })
                  }
                  onDelete={() => setDeleteName(entry.name)}
                />
              ) : (
                <InvalidSchemeCard key={entry.name} entry={entry} />
              )
            )}
          </div>
        )}

        <div class="threshold-presets" data-testid="threshold-presets">
          <div class="threshold-presets__intro">
            <h4>{t('pipelines.threshold.presets.title')}</h4>
            <p>{t('pipelines.threshold.presets.description')}</p>
          </div>
          <div class="threshold-preset-grid">
            {props.catalog.presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                onSeed={() => openCreate(preset.seed, preset.id)}
              />
            ))}
          </div>
        </div>
      </section>

      <section class="threshold-bindings" data-testid="threshold-bindings">
        <div class="threshold-section__header">
          <div>
            <h3>{t('pipelines.threshold.bindings.title')}</h3>
            <p>{t('pipelines.threshold.bindings.description')}</p>
          </div>
        </div>
        {!hasBindings && (
          <div class="threshold-empty" data-testid="threshold-bindings-empty">
            <strong>{t('pipelines.threshold.bindings.empty_title')}</strong>
            <span>{t('pipelines.threshold.bindings.empty_body')}</span>
          </div>
        )}
        <div class="binding-rail" role="list">
          {props.catalog.bindingRows.map((row) => (
            <BindingRailRow
              key={row}
              row={row}
              entry={bindingEntries.find(
                (entry) => entry.instanceKey === `thresholds.bindings.${row}`
              )}
              schemes={validSchemes}
              diagnostics={diagnostics.filter((diagnostic) => diagnostic.row === row)}
              {...props}
            />
          ))}
        </div>
      </section>

      {editor && (
        <ThresholdSchemeEditor
          key={`${editor.mode}-${editor.mode === 'update' ? editor.name : editor.presetId ?? 'blank'}`}
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={async (message) => {
            setFeedback(message);
            setEditor(null);
            await props.onRefresh();
          }}
        />
      )}
      {deleteName && (
        <ThresholdDeleteDialog
          name={deleteName}
          onClose={() => setDeleteName(null)}
          onDeleted={async () => {
            setFeedback(
              t('pipelines.threshold.feedback.deleted', { name: deleteName })
            );
            setDeleteName(null);
            await props.onRefresh();
          }}
        />
      )}
    </>
  );
}

function SchemeCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Extract<ThresholdSchemeListEntry, { valid: true }>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const handoffRoles = thresholdRoleEntries(entry.scheme.handoffRoles);
  const reuseRoles = thresholdRoleEntries(entry.scheme.reuseRoles);
  return (
    <article
      class="threshold-scheme-card"
      data-testid="threshold-scheme-card"
      data-scheme={entry.name}
    >
      <header>
        <code>{entry.name}</code>
        <span class="threshold-state threshold-state--valid">
          {t('pipelines.threshold.schemes.valid')}
        </span>
      </header>
      <dl class="threshold-summary">
        <div>
          <dt>{t('pipelines.threshold.family.handoff')}</dt>
          <dd>{formatThreshold(entry.scheme.handoff)}</dd>
        </div>
        <div>
          <dt>{t('pipelines.threshold.family.reuse')}</dt>
          <dd>{formatThreshold(entry.scheme.reuse)}</dd>
        </div>
      </dl>
      {(handoffRoles.length > 0 || reuseRoles.length > 0) && (
        <details class="threshold-role-details">
          <summary>{t('pipelines.threshold.schemes.role_overrides')}</summary>
          {handoffRoles.map(([role, value]) => (
            <div key={`handoff-${role}`}>
              <span>
                {t('pipelines.threshold.family.handoff')} · {roleLabel(t, role)}
              </span>
              <code>{formatThreshold(value)}</code>
            </div>
          ))}
          {reuseRoles.map(([role, value]) => (
            <div key={`reuse-${role}`}>
              <span>
                {t('pipelines.threshold.family.reuse')} · {roleLabel(t, role)}
              </span>
              <code>{formatThreshold(value)}</code>
            </div>
          ))}
        </details>
      )}
      <footer>
        <button type="button" data-testid="threshold-scheme-edit" onClick={onEdit}>
          {t('pipelines.threshold.schemes.edit')}
        </button>
        <button
          type="button"
          class="btn--ghost"
          data-testid="threshold-scheme-delete"
          onClick={onDelete}
        >
          {t('pipelines.threshold.schemes.delete')}
        </button>
      </footer>
    </article>
  );
}

function InvalidSchemeCard({
  entry,
}: {
  entry: Extract<ThresholdSchemeListEntry, { valid: false }>;
}) {
  const t = useT();
  return (
    <article
      class="threshold-scheme-card threshold-scheme-card--invalid"
      data-testid="threshold-scheme-invalid"
      data-scheme={entry.name}
    >
      <header>
        <code>{entry.name}</code>
        <span class="threshold-state threshold-state--invalid">
          {t('pipelines.threshold.schemes.invalid')}
        </span>
      </header>
      <p>{entry.error}</p>
      <small>{t('pipelines.threshold.schemes.invalid_action')}</small>
    </article>
  );
}

function PresetCard({
  preset,
  onSeed,
}: {
  preset: ThresholdPresetSeed;
  onSeed: () => void;
}) {
  const t = useT();
  return (
    <article
      class="threshold-preset-card"
      data-testid="threshold-preset-card"
      data-preset={preset.id}
    >
      <header>
        <code>{preset.id}</code>
        <span>{t('pipelines.threshold.presets.read_only')}</span>
      </header>
      <p>{preset.match.join(', ')}</p>
      <small>
        {t('pipelines.threshold.presets.context_window', {
          tokens: preset.contextWindow.toLocaleString(),
        })}
      </small>
      <dl class="threshold-summary">
        <div>
          <dt>{t('pipelines.threshold.family.handoff')}</dt>
          <dd>
            {formatThreshold(preset.seed.handoff)}
            <span>{sourceLabel(t, preset.sources.handoff)}</span>
          </dd>
        </div>
        <div>
          <dt>{t('pipelines.threshold.family.reuse')}</dt>
          <dd>
            {formatThreshold(preset.seed.reuse)}
            <span>{sourceLabel(t, preset.sources.reuse)}</span>
          </dd>
        </div>
      </dl>
      <button type="button" data-testid="threshold-preset-seed" onClick={onSeed}>
        {t('pipelines.threshold.presets.seed')}
      </button>
    </article>
  );
}

function BindingRailRow({
  row,
  entry,
  schemes,
  diagnostics,
  mode,
  spaceType,
  selector,
  storeRef,
  onRefresh,
  onPageError,
}: {
  row: ThresholdBindingRow;
  entry?: WireConfigEntry;
  schemes: Array<Extract<ThresholdSchemeListEntry, { valid: true }>>;
  diagnostics: ThresholdDiagnostic[];
} & WorkbenchProps) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = modeScope(mode, spaceType);
  const rawValue = entry?.scopeValues[scope];
  const selected = typeof rawValue === 'string' ? rawValue : '';
  const effective = typeof entry?.value === 'string' ? entry.value : '';
  const inherited =
    entry !== undefined && isStoreInherited(entry, mode, spaceType) && storeRef !== null;
  const known = new Set(schemes.map((scheme) => scheme.name));
  const dangling = effective.length > 0 && !known.has(effective);

  async function write(value: string) {
    setPending(true);
    setError(null);
    try {
      if (value === '') {
        await client.deleteKey(`thresholds.bindings.${row}`, scope, selector);
      } else {
        await client.putKey(
          `thresholds.bindings.${row}`,
          { scope, value },
          selector
        );
      }
      await onRefresh();
    } catch (reason) {
      if (reason instanceof ApiError) {
        if (reason.status === 401) return;
        setError(reason.message);
        onPageError(reason.message, reason.fix);
      } else {
        setError(t('pipelines.threshold.feedback.write_failed'));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      class={`binding-rail__row${dangling ? ' binding-rail__row--warning' : ''}`}
      role="listitem"
      data-testid="threshold-binding-row"
      data-row={row}
    >
      <div class="binding-rail__runtime">
        <code>{row}</code>
        <span>
          {row === 'default'
            ? t('pipelines.threshold.bindings.default_label')
            : t('pipelines.threshold.bindings.runtime_label')}
        </span>
      </div>
      <span class="binding-rail__arrow" aria-hidden="true">→</span>
      <div class="binding-rail__choice">
        <label>
          <span>{t('pipelines.threshold.bindings.scheme_label')}</span>
          <select
            value={inherited ? effective : selected}
            disabled={pending || inherited}
            data-testid="threshold-binding-select"
            onChange={(event) =>
              write((event.target as HTMLSelectElement).value)
            }
          >
            <option value="">
              {t('pipelines.threshold.bindings.not_set')}
            </option>
            {dangling && <option value={effective}>{effective}</option>}
            {schemes.map((scheme) => (
              <option key={scheme.name} value={scheme.name}>{scheme.name}</option>
            ))}
          </select>
        </label>
        {inherited && storeRef && (
          <a
            href={spaceHref(
              storeSpaceFromRef(storeRef),
              'pipelines'
            )}
          >
            {t('pipelines.threshold.bindings.edit_store', { store: storeRef.id })}
          </a>
        )}
      </div>
      <div class="binding-rail__evidence">
        {entry ? (
          <>
            <span class={`config-entry__source config-entry__source--${entry.source}`}>
              {entry.source}
            </span>
            <code>{effective || t('pipelines.threshold.bindings.not_set')}</code>
            <div class="binding-rail__scopes">
              {(['project', 'store', 'global'] as ConfigScope[]).map((candidate) =>
                entry.scopeValues[candidate] !== undefined ? (
                  <span key={candidate}>
                    {candidate}: {String(entry.scopeValues[candidate])}
                  </span>
                ) : null
              )}
            </div>
          </>
        ) : (
          <span>{t('pipelines.threshold.bindings.compatibility')}</span>
        )}
        {dangling && (
          <strong class="binding-rail__warning">
            {t('pipelines.threshold.bindings.dangling', { scheme: effective })}
          </strong>
        )}
        {diagnostics.map((diagnostic) => (
          <small key={`${diagnostic.scope}-${diagnostic.scheme}`}>
            {diagnostic.message}
          </small>
        ))}
        {error && <small class="binding-rail__warning" role="alert">{error}</small>}
      </div>
    </div>
  );
}

function ThresholdSchemeEditor({
  state,
  onClose,
  onSaved,
}: {
  state:
    | { mode: 'create'; seed: ThresholdScheme; presetId?: string }
    | { mode: 'update'; name: string; seed: ThresholdScheme };
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(state.mode === 'update' ? state.name : '');
  const [scheme, setScheme] = useState<ThresholdScheme>({
    ...state.seed,
    handoffRoles: { ...(state.seed.handoffRoles ?? {}) },
    reuseRoles: { ...(state.seed.reuseRoles ?? {}) },
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (
      !SCHEME_NAME.test(normalizedName) ||
      normalizedName === 'default'
    ) {
      setError(t('pipelines.threshold.editor.name_error'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const operation = state.mode === 'create' ? 'create' : 'update';
      await client.mutateThresholdScheme({
        op: operation,
        name: normalizedName,
        scheme,
      });
      await onSaved(
        t(
          operation === 'create'
            ? 'pipelines.threshold.feedback.created'
            : 'pipelines.threshold.feedback.updated',
          { name: normalizedName }
        )
      );
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      setError(
        reason instanceof ApiError
          ? reason.message
          : t('pipelines.threshold.feedback.write_failed')
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div class="pipeline-dialog__overlay" data-testid="threshold-editor">
      <form
        class="pipeline-dialog threshold-editor"
        role="dialog"
        aria-label={t(
          state.mode === 'create'
            ? 'pipelines.threshold.editor.create_title'
            : 'pipelines.threshold.editor.edit_title'
        )}
        onSubmit={submit}
      >
        <h3>
          {t(
            state.mode === 'create'
              ? 'pipelines.threshold.editor.create_title'
              : 'pipelines.threshold.editor.edit_title'
          )}
        </h3>
        {state.mode === 'create' ? (
          <label class="pipeline-dialog__field">
            <span>{t('pipelines.threshold.editor.name')}</span>
            <input
              type="text"
              value={name}
              required
              data-testid="threshold-editor-name"
              onInput={(event) => {
                setName((event.target as HTMLInputElement).value);
                setError(null);
              }}
            />
            <small>{t('pipelines.threshold.editor.name_hint')}</small>
          </label>
        ) : (
          <div class="threshold-editor__identity">
            <span>{t('pipelines.threshold.editor.name')}</span>
            <code>{name}</code>
            <small>{t('pipelines.threshold.editor.no_rename')}</small>
          </div>
        )}

        <ThresholdValueField
          id="scheme-handoff"
          label={t('pipelines.threshold.family.handoff')}
          value={scheme.handoff}
          disabled={pending}
          onChange={(handoff) => setScheme((current) => ({ ...current, handoff }))}
        />
        <ThresholdValueField
          id="scheme-reuse"
          label={t('pipelines.threshold.family.reuse')}
          value={scheme.reuse}
          disabled={pending}
          onChange={(reuse) => setScheme((current) => ({ ...current, reuse }))}
        />

        <RoleOverrides
          idPrefix="scheme-handoff-role"
          title={t('pipelines.threshold.editor.handoff_roles')}
          roles={HANDOFF_ROLES}
          values={scheme.handoffRoles ?? {}}
          defaultValue={0.5}
          disabled={pending}
          onChange={(handoffRoles) =>
            setScheme((current) => ({
              ...current,
              ...(Object.keys(handoffRoles).length > 0
                ? { handoffRoles }
                : { handoffRoles: undefined }),
            }))
          }
        />
        <RoleOverrides
          idPrefix="scheme-reuse-role"
          title={t('pipelines.threshold.editor.reuse_roles')}
          roles={REUSE_ROLES}
          values={scheme.reuseRoles ?? {}}
          defaultValue={0.25}
          disabled={pending}
          onChange={(reuseRoles) =>
            setScheme((current) => ({
              ...current,
              ...(Object.keys(reuseRoles).length > 0
                ? { reuseRoles }
                : { reuseRoles: undefined }),
            }))
          }
        />

        {error && (
          <p class="pipeline-dialog__error" role="alert" data-testid="threshold-editor-error">
            {error}
          </p>
        )}
        <div class="pipeline-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onClose}>
            {t('pipelines.threshold.action.cancel')}
          </button>
          <button
            type="submit"
            class="btn--primary"
            data-testid="threshold-editor-save"
            disabled={pending}
          >
            {pending
              ? t('pipelines.threshold.action.saving')
              : t('pipelines.threshold.action.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function ThresholdValueField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: ThresholdValue;
  disabled: boolean;
  onChange: (value: ThresholdValue) => void;
}) {
  const t = useT();
  const absolute = typeof value === 'object';
  return (
    <fieldset class="threshold-value-field">
      <legend>{label}</legend>
      <div class="threshold-value-field__forms">
        <label>
          <input
            type="radio"
            name={`${id}-form`}
            checked={!absolute}
            disabled={disabled}
            onChange={() => onChange(0.5)}
          />
          {t('pipelines.threshold.editor.fraction')}
        </label>
        <label>
          <input
            type="radio"
            name={`${id}-form`}
            checked={absolute}
            disabled={disabled}
            onChange={() => onChange({ remainingTokens: 50_000 })}
          />
          {t('pipelines.threshold.editor.remaining_tokens')}
        </label>
      </div>
      <input
        type="number"
        step={absolute ? '1' : 'any'}
        min={absolute ? '1' : '0'}
        max={absolute ? undefined : '1'}
        value={String(absolute ? value.remainingTokens : value)}
        disabled={disabled}
        data-testid={`${id}-value`}
        onInput={(event) => {
          const number = Number((event.target as HTMLInputElement).value);
          if (!Number.isFinite(number)) return;
          onChange(absolute ? { remainingTokens: number } : number);
        }}
      />
      <small>
        {absolute
          ? t('pipelines.threshold.editor.remaining_hint')
          : t('pipelines.threshold.editor.fraction_hint')}
      </small>
    </fieldset>
  );
}

function RoleOverrides<R extends ThresholdRole>({
  idPrefix,
  title,
  roles,
  values,
  defaultValue,
  disabled,
  onChange,
}: {
  idPrefix: string;
  title: string;
  roles: readonly R[];
  values: Partial<Record<R, ThresholdValue>>;
  defaultValue: number;
  disabled: boolean;
  onChange: (values: Partial<Record<R, ThresholdValue>>) => void;
}) {
  const t = useT();
  return (
    <details class="threshold-editor__roles">
      <summary>{title}</summary>
      {roles.map((role) => {
        const enabled = values[role] !== undefined;
        const label = roleLabel(t, role);
        return (
          <div class="threshold-editor__role" key={role}>
            <label>
              <input
                type="checkbox"
                checked={enabled}
                disabled={disabled}
                data-testid={`${idPrefix}-${role}`}
                onChange={() => {
                  const next = { ...values };
                  if (enabled) delete next[role];
                  else next[role] = defaultValue;
                  onChange(next);
                }}
              />
              {label}
            </label>
            {enabled && (
              <ThresholdValueField
                id={`${idPrefix}-${role}`}
                label={t('pipelines.threshold.editor.role_value', { role: label })}
                value={values[role]!}
                disabled={disabled}
                onChange={(value) => onChange({ ...values, [role]: value })}
              />
            )}
          </div>
        );
      })}
    </details>
  );
}

function ThresholdDeleteDialog({
  name,
  onClose,
  onDeleted,
}: {
  name: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await client.mutateThresholdScheme({ op: 'delete', name });
      await onDeleted();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) return;
      setError(
        reason instanceof ApiError
          ? reason.message
          : t('pipelines.threshold.feedback.write_failed')
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div class="pipeline-dialog__overlay" data-testid="threshold-delete-dialog">
      <div
        class="pipeline-dialog"
        role="dialog"
        aria-label={t('pipelines.threshold.delete.title')}
      >
        <h3>{t('pipelines.threshold.delete.title')}</h3>
        <p>{t('pipelines.threshold.delete.body', { name })}</p>
        <p class="pipeline-dialog__hint">
          {t('pipelines.threshold.delete.dangling_warning')}
        </p>
        {error && <p class="pipeline-dialog__error" role="alert">{error}</p>}
        <div class="pipeline-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onClose}>
            {t('pipelines.threshold.action.cancel')}
          </button>
          <button
            type="button"
            class="btn--danger"
            data-testid="threshold-delete-confirm"
            disabled={pending}
            onClick={remove}
          >
            {pending
              ? t('pipelines.threshold.action.deleting')
              : t('pipelines.threshold.action.confirm_delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
