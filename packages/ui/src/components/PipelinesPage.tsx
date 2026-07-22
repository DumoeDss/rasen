import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  StoreLayerRef,
  ThresholdValue,
  WireConfigEntry,
  WirePipeline,
  WirePipelineStage,
} from '../api/types.js';
import { useSpace } from '../store/use-space.js';
import { KNOWN_MODEL_IDS, modeScope, type ConfigMode, type SpaceType } from '../config/controls.js';
import { ConfigEntryRow } from './ConfigEntryRow.js';

/**
 * The Pipelines page (pipelines-ui spec). A space-PREFIXED route
 * (`/p/:id/pipelines`, `/s/:id/pipelines`) where a pipeline's shape is
 * inspected and its per-stage gate / model / handoff and per-role runtime are
 * tuned — every override riding the ordinary config scope chain, never a YAML
 * fork. The page opens with the Defaults table (the role-matrix config keys,
 * edited through the shared `ConfigEntryRow` under a page-level Global / Local
 * scope mode — W2's exact pattern), then one section per pipeline: the
 * build-order stage lane (read-only), per-stage override rows, per-role runtime
 * controls, and library actions (init / import / export / delete) via the
 * CLI-backed bridge. Effective per-stage values are computed server-side and
 * rendered verbatim (design D1) — the UI never re-derives resolution.
 */

/** The role matrix (design D5): the twelve default keys plus the two autopilot controls. */
const ROLES = ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'] as const;
const MODEL_KEYS = ['models.default', ...ROLES.map((r) => `models.roles.${r}`)];
const HANDOFF_KEYS = ['handoff.threshold', ...ROLES.map((r) => `handoff.roles.${r}`)];
const AUTOPILOT_KEYS = ['autopilot.gates', 'autopilot.selection'];

/** A per-stage/per-role override is set when the effective source came from a family instance. */
function isOverridden(source: string): boolean {
  return source.startsWith('stage-override');
}

function formatThreshold(value: ThresholdValue): string {
  return typeof value === 'number' ? String(value) : `${value.remainingTokens} tokens`;
}

export function PipelinesPage() {
  const space = useSpace();
  const selector = space?.selector;
  const spaceType: SpaceType = space?.type ?? 'project';

  const [entries, setEntries] = useState<WireConfigEntry[] | null>(null);
  const [storeRef, setStoreRef] = useState<StoreLayerRef | null>(null);
  const [pipelines, setPipelines] = useState<WirePipeline[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [mode, setMode] = useState<ConfigMode>('local');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  useEffect(() => {
    if (!selector) {
      setEntries(null);
      setPipelines(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    Promise.all([client.listConfig(selector), client.listPipelines(selector)])
      .then(([config, pipes]) => {
        if (cancelled) return;
        setEntries(config.entries);
        setStoreRef(config.store);
        setPipelines(pipes.pipelines);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) setPageError({ message: err.message, fix: err.fix });
        else setPageError({ message: 'Failed to load pipelines.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selector]);

  /** Refetch only the pipelines listing after a per-stage override write — the effective values re-resolve server-side. */
  async function refreshPipelines() {
    if (!selector) return;
    const res = await client.listPipelines(selector);
    setPipelines(res.pipelines);
  }

  /**
   * Background refresh after a library mutation or the Refresh button — refetch
   * both surfaces WITHOUT flipping the page back to the full-load spinner, which
   * would tear down an open dialog and its success result before the user reads
   * it (the WorkflowsPage precedent).
   */
  async function refreshAll() {
    if (!selector) return;
    try {
      const [config, pipes] = await Promise.all([client.listConfig(selector), client.listPipelines(selector)]);
      setEntries(config.entries);
      setStoreRef(config.store);
      setPipelines(pipes.pipelines);
    } catch (err) {
      if (err instanceof ApiError) setPageError({ message: err.message, fix: err.fix });
    }
  }

  function updateEntry(updated: WireConfigEntry) {
    setEntries((current) =>
      current ? current.map((e) => (e.definition.key === updated.definition.key ? updated : e)) : current
    );
  }

  if (!selector) {
    return (
      <p class="pipelines-page__no-space" data-testid="pipelines-no-space">
        Pick a planning space to inspect its pipelines.
      </p>
    );
  }

  if (loading) {
    return <p data-testid="pipelines-loading">Loading pipelines…</p>;
  }

  const writeScope = modeScope(mode, spaceType);
  const byKey = (key: string): WireConfigEntry | undefined => entries?.find((e) => e.definition.key === key);

  return (
    <div class="pipelines-page" data-testid="pipelines-page">
      {pageError && (
        <p class="pipelines-page__error" data-testid="pipelines-error">
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''}
        </p>
      )}

      <div class="pipelines-page__toolbar">
        <h2 class="pipelines-page__title">Pipelines</h2>
        <div class="pipelines-page__actions">
          <button type="button" data-testid="pipeline-new" onClick={() => setDialog({ kind: 'init' })}>
            New pipeline
          </button>
          <button type="button" data-testid="pipeline-import" onClick={() => setDialog({ kind: 'import' })}>
            Import…
          </button>
          <button type="button" data-testid="pipeline-refresh" onClick={refreshAll}>
            Refresh
          </button>
        </div>
      </div>

      <div class="pipelines-page__mode" role="group" aria-label="Configuration scope" data-testid="pipelines-mode">
        <button
          type="button"
          class={`member-chip${mode === 'global' ? ' member-chip--selected' : ''}`}
          aria-pressed={mode === 'global'}
          onClick={() => setMode('global')}
        >
          Global
        </button>
        <button
          type="button"
          class={`member-chip${mode === 'local' ? ' member-chip--selected' : ''}`}
          aria-pressed={mode === 'local'}
          onClick={() => setMode('local')}
        >
          Local
        </button>
      </div>

      <section class="pipelines-defaults" data-testid="pipelines-defaults">
        <h3>Defaults</h3>
        <DefaultsGroup
          heading="Models"
          keys={MODEL_KEYS}
          entryFor={byKey}
          mode={mode}
          spaceType={spaceType}
          selector={selector}
          storeRef={storeRef}
          onPageError={(message, fix) => setPageError({ message, fix })}
          onEntryUpdated={updateEntry}
        />
        <DefaultsGroup
          heading="Handoff"
          keys={HANDOFF_KEYS}
          entryFor={byKey}
          mode={mode}
          spaceType={spaceType}
          selector={selector}
          storeRef={storeRef}
          onPageError={(message, fix) => setPageError({ message, fix })}
          onEntryUpdated={updateEntry}
        />
        <DefaultsGroup
          heading="Autopilot"
          keys={AUTOPILOT_KEYS}
          entryFor={byKey}
          mode={mode}
          spaceType={spaceType}
          selector={selector}
          storeRef={storeRef}
          onPageError={(message, fix) => setPageError({ message, fix })}
          onEntryUpdated={updateEntry}
        />
      </section>

      <section class="pipelines-list" data-testid="pipelines-list">
        {(pipelines ?? []).map((pipeline) => (
          <PipelineSection
            key={pipeline.name}
            pipeline={pipeline}
            scope={writeScope}
            selector={selector}
            onWrite={refreshPipelines}
            onExport={(name) => setDialog({ kind: 'export', name })}
            onDelete={(name) => setDialog({ kind: 'delete', name })}
          />
        ))}
      </section>

      {dialog?.kind === 'init' && <InitDialog onClose={() => setDialog(null)} onDone={refreshAll} />}
      {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={refreshAll} />}
      {dialog?.kind === 'export' && <ExportDialog name={dialog.name} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <DeleteDialog name={dialog.name} onClose={() => setDialog(null)} onDone={refreshAll} />
      )}
    </div>
  );
}

type Dialog =
  | { kind: 'init' }
  | { kind: 'import' }
  | { kind: 'export'; name: string }
  | { kind: 'delete'; name: string };

// ── Defaults table ───────────────────────────────────────────────────────────

function DefaultsGroup({
  heading,
  keys,
  entryFor,
  mode,
  spaceType,
  selector,
  storeRef,
  onPageError,
  onEntryUpdated,
}: {
  heading: string;
  keys: string[];
  entryFor: (key: string) => WireConfigEntry | undefined;
  mode: ConfigMode;
  spaceType: SpaceType;
  selector: string;
  storeRef: StoreLayerRef | null;
  onPageError: (message: string, fix?: string) => void;
  onEntryUpdated: (entry: WireConfigEntry) => void;
}) {
  const rows = keys.map(entryFor).filter((e): e is WireConfigEntry => e !== undefined);
  if (rows.length === 0) return null;
  return (
    <div class="pipelines-defaults__group" data-testid={`pipelines-defaults-${heading.toLowerCase()}`}>
      <h4>{heading}</h4>
      {rows.map((entry) => (
        <ConfigEntryRow
          key={entry.definition.key}
          entry={entry}
          mode={mode}
          spaceType={spaceType}
          spaceSelector={selector}
          storeRef={storeRef}
          onPageError={onPageError}
          onEntryUpdated={onEntryUpdated}
        />
      ))}
    </div>
  );
}

// ── Per-pipeline section ─────────────────────────────────────────────────────

function PipelineSection({
  pipeline,
  scope,
  selector,
  onWrite,
  onExport,
  onDelete,
}: {
  pipeline: WirePipeline;
  scope: 'global' | 'store' | 'project';
  selector: string;
  onWrite: () => Promise<void>;
  onExport: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  // Export AND delete are user-library-only in the CLI (`exportPipeline` /
  // `deletePipeline` both refuse `source !== 'user'`), so the affordances gate on
  // the resolved SOURCE LAYER, not provenance: a project-layer copy (provenance
  // 'user' but sourceLayer 'project') is refused just like a built-in package.
  const isUserLibrary = pipeline.sourceLayer === 'user';
  const lockTitle =
    pipeline.sourceLayer === 'package' ? 'Built-in — locked' : 'Project layer — locked (read-only here)';
  // Per-role runtime: a role's stages share one runtime, so read the effective
  // runtime off the first stage carrying each role (design D4).
  const roleStages = new Map<string, WirePipelineStage>();
  for (const stage of pipeline.stages) {
    if (stage.role && !roleStages.has(stage.role)) roleStages.set(stage.role, stage);
  }

  return (
    <div class="pipeline-section" data-testid="pipeline-section" data-pipeline={pipeline.name}>
      <div class="pipeline-section__header">
        <h3 class="pipeline-section__name">{pipeline.name}</h3>
        <span class={`pipeline-section__provenance pipeline-section__provenance--${pipeline.provenance}`} data-testid="pipeline-provenance">
          {pipeline.provenance}
        </span>
        <span class="pipeline-section__source" data-testid="pipeline-source-layer">
          {pipeline.sourceLayer}
        </span>
        <div class="pipeline-section__actions">
          {/* Only user-library pipelines expose export/delete; built-in (package)
              and project-layer pipelines are locked — the CLI refuses both ops on
              them, so surfacing either would be a dead 422. */}
          {isUserLibrary ? (
            <>
              <button type="button" data-testid="pipeline-export" onClick={() => onExport(pipeline.name)}>
                Export
              </button>
              <button type="button" data-testid="pipeline-delete" onClick={() => onDelete(pipeline.name)}>
                Delete
              </button>
            </>
          ) : (
            <span class="pipeline-section__lock" data-testid="pipeline-lock" title={lockTitle}>
              locked
            </span>
          )}
        </div>
      </div>
      {pipeline.description && <p class="pipeline-section__description">{pipeline.description}</p>}

      {/* Build-order stage lane (read-only). */}
      <ol class="pipeline-lane" data-testid="pipeline-lane">
        {pipeline.stages.map((stage) => (
          <li key={stage.id} class="pipeline-lane__stage" data-stage={stage.id}>
            <span class="pipeline-lane__stage-id">{stage.id}</span>
            {stage.role && <span class="pipeline-lane__stage-role">{stage.role}</span>}
          </li>
        ))}
      </ol>

      {/* Per-role runtime controls. */}
      {roleStages.size > 0 && (
        <div class="pipeline-runtimes" data-testid="pipeline-runtimes">
          <h4>Runtimes</h4>
          {[...roleStages.entries()].map(([role, stage]) => (
            <RoleRuntimeControl
              key={role}
              pipeline={pipeline.name}
              role={role}
              stage={stage}
              scope={scope}
              selector={selector}
              onWrite={onWrite}
            />
          ))}
        </div>
      )}

      {/* Per-stage gate / model / handoff overrides. */}
      <div class="pipeline-stages" data-testid="pipeline-stages">
        {pipeline.stages.map((stage) => (
          <StageOverrideRow
            key={stage.id}
            pipeline={pipeline.name}
            stage={stage}
            scope={scope}
            selector={selector}
            onWrite={onWrite}
          />
        ))}
      </div>
    </div>
  );
}

// ── Per-stage override row ───────────────────────────────────────────────────

function StageOverrideRow({
  pipeline,
  stage,
  scope,
  selector,
  onWrite,
}: {
  pipeline: string;
  stage: WirePipelineStage;
  scope: 'global' | 'store' | 'project';
  selector: string;
  onWrite: () => Promise<void>;
}) {
  return (
    <div class="stage-row" data-testid="stage-row" data-stage={stage.id}>
      <div class="stage-row__id">
        <span>{stage.id}</span>
        {stage.role && <span class="stage-row__role">{stage.role}</span>}
      </div>
      <StageGateControl pipeline={pipeline} stage={stage} scope={scope} selector={selector} onWrite={onWrite} />
      <StageModelControl pipeline={pipeline} stage={stage} scope={scope} selector={selector} onWrite={onWrite} />
      <StageHandoffControl pipeline={pipeline} stage={stage} scope={scope} selector={selector} onWrite={onWrite} />
    </div>
  );
}

/** Shared write helpers for a per-stage/per-role config family instance. */
function useInstanceWriter(
  instanceKey: string,
  scope: 'global' | 'store' | 'project',
  selector: string,
  onWrite: () => Promise<void>
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
      await onWrite();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof ApiError ? err.message : 'Write failed.');
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    error,
    set: (value: unknown) => run(() => client.putKey(instanceKey, { scope, value }, selector)),
    clear: () => run(() => client.deleteKey(instanceKey, scope, selector)),
  };
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      class={`stage-row__source${isOverridden(source) ? ' stage-row__source--override' : ''}`}
      data-testid="stage-source"
    >
      {source}
    </span>
  );
}

function StageGateControl({
  pipeline,
  stage,
  scope,
  selector,
  onWrite,
}: {
  pipeline: string;
  stage: WirePipelineStage;
  scope: 'global' | 'store' | 'project';
  selector: string;
  onWrite: () => Promise<void>;
}) {
  const key = `pipelines.${pipeline}.gates.${stage.id}`;
  const w = useInstanceWriter(key, scope, selector, onWrite);
  const eff = stage.effectiveGate;

  const selectValue = isOverridden(eff.source) ? (eff.value === true ? 'on' : 'off') : 'inherit';
  return (
    <div class="stage-control stage-control--gate" data-testid="stage-gate" data-pipeline={pipeline} data-stage={stage.id}>
      <span class="stage-control__label">Gate</span>
      <select
        data-testid="stage-gate-select"
        value={selectValue}
        disabled={w.pending}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === 'inherit') w.clear();
          else w.set(v);
        }}
      >
        <option value="inherit">Inherit</option>
        <option value="on">On (pause)</option>
        <option value="off">Off (auto)</option>
      </select>
      <SourceBadge source={eff.source} />
      {w.error && <span class="stage-control__error" role="alert">{w.error}</span>}
    </div>
  );
}

function StageModelControl({
  pipeline,
  stage,
  scope,
  selector,
  onWrite,
}: {
  pipeline: string;
  stage: WirePipelineStage;
  scope: 'global' | 'store' | 'project';
  selector: string;
  onWrite: () => Promise<void>;
}) {
  const key = `pipelines.${pipeline}.models.${stage.id}`;
  const w = useInstanceWriter(key, scope, selector, onWrite);
  const eff = stage.effectiveModel;
  const overridden = isOverridden(eff.source);
  const listId = `${key}-suggestions`;

  return (
    <div class="stage-control stage-control--model" data-testid="stage-model" data-pipeline={pipeline} data-stage={stage.id}>
      <span class="stage-control__label">Model</span>
      <input
        type="text"
        list={listId}
        data-testid="stage-model-input"
        value={eff.value ?? ''}
        disabled={w.pending}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          // An empty value is not a valid model id; clear the override instead.
          if (v.length === 0) w.clear();
          else w.set(v);
        }}
      />
      <datalist id={listId}>
        {KNOWN_MODEL_IDS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <SourceBadge source={eff.source} />
      {overridden && (
        <button type="button" data-testid="stage-model-inherit" disabled={w.pending} onClick={() => w.clear()}>
          Inherit
        </button>
      )}
      {w.error && <span class="stage-control__error" role="alert">{w.error}</span>}
    </div>
  );
}

function StageHandoffControl({
  pipeline,
  stage,
  scope,
  selector,
  onWrite,
}: {
  pipeline: string;
  stage: WirePipelineStage;
  scope: 'global' | 'store' | 'project';
  selector: string;
  onWrite: () => Promise<void>;
}) {
  const key = `pipelines.${pipeline}.handoff.${stage.id}`;
  const w = useInstanceWriter(key, scope, selector, onWrite);
  const eff = stage.effectiveHandoff;
  const overridden = isOverridden(eff.source);
  const isAbsolute = typeof eff.value === 'object' && eff.value !== null && 'remainingTokens' in eff.value;

  return (
    <div class="stage-control stage-control--handoff" data-testid="stage-handoff" data-pipeline={pipeline} data-stage={stage.id}>
      <span class="stage-control__label">Handoff</span>
      <div class="stage-control__handoff-forms">
        <label>
          <input
            type="radio"
            name={`${key}-form`}
            checked={!isAbsolute}
            disabled={w.pending}
            onChange={() => w.set(0.5)}
          />
          Fraction
        </label>
        <label>
          <input
            type="radio"
            name={`${key}-form`}
            checked={isAbsolute}
            disabled={w.pending}
            onChange={() => w.set({ remainingTokens: 50_000 })}
          />
          Remaining tokens
        </label>
      </div>
      {!isAbsolute ? (
        <input
          type="number"
          step="any"
          data-testid="stage-handoff-fraction"
          value={typeof eff.value === 'number' ? String(eff.value) : '0.5'}
          disabled={w.pending}
          onChange={(e) => {
            const raw = Number((e.target as HTMLInputElement).value);
            if (!Number.isNaN(raw)) w.set(raw);
          }}
        />
      ) : (
        <input
          type="number"
          step="1"
          data-testid="stage-handoff-remaining"
          value={String((eff.value as { remainingTokens: number }).remainingTokens)}
          disabled={w.pending}
          onChange={(e) => {
            const raw = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(raw)) w.set({ remainingTokens: raw });
          }}
        />
      )}
      <span class="stage-control__effective" data-testid="stage-handoff-effective">
        {formatThreshold(eff.value)}
      </span>
      <SourceBadge source={eff.source} />
      {overridden && (
        <button type="button" data-testid="stage-handoff-inherit" disabled={w.pending} onClick={() => w.clear()}>
          Inherit
        </button>
      )}
      {w.error && <span class="stage-control__error" role="alert">{w.error}</span>}
    </div>
  );
}

function RoleRuntimeControl({
  pipeline,
  role,
  stage,
  scope,
  selector,
  onWrite,
}: {
  pipeline: string;
  role: string;
  stage: WirePipelineStage;
  scope: 'global' | 'store' | 'project';
  selector: string;
  onWrite: () => Promise<void>;
}) {
  const key = `pipelines.${pipeline}.runtimes.${role}`;
  const w = useInstanceWriter(key, scope, selector, onWrite);
  const eff = stage.effectiveRuntime;
  const selectValue = isOverridden(eff.source) ? eff.value : 'inherit';

  return (
    <div class="role-runtime" data-testid="role-runtime" data-pipeline={pipeline} data-role={role}>
      <span class="role-runtime__role">{role}</span>
      <select
        data-testid="role-runtime-select"
        value={selectValue}
        disabled={w.pending}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === 'inherit') w.clear();
          else w.set(v);
        }}
      >
        <option value="inherit">Inherit</option>
        <option value="claude">claude</option>
        <option value="codex">codex</option>
      </select>
      <SourceBadge source={eff.source} />
      {w.error && <span class="role-runtime__error" role="alert">{w.error}</span>}
    </div>
  );
}

// ── Library dialogs (pipeline-http-api design D6) ─────────────────────────────
// Transplanted from the Workflows page flows: verbatim CLI errors, overwrite /
// force retries, in-flight submit guard, post-success refresh. Every mutation
// goes through `client.mutatePipeline` — the browser never touches the
// filesystem. Built-in pipelines expose no delete / export affordance.

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="pipeline-dialog__overlay" data-testid="pipeline-dialog">
      <div class="pipeline-dialog" role="dialog" aria-label={title}>
        <h3 class="pipeline-dialog__title">{title}</h3>
        {children}
        <div class="pipeline-dialog__dismiss">
          <button type="button" data-testid="pipeline-dialog-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function PathField({
  label,
  value,
  onInput,
  disabled,
  testid,
}: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  disabled?: boolean;
  testid: string;
}) {
  return (
    <label class="pipeline-dialog__field">
      <span>{label} (absolute path on this machine)</span>
      <input
        type="text"
        data-testid={testid}
        value={value}
        disabled={disabled}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}

function cliMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function InitDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [output, setOutput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = (await client.mutatePipeline({ op: 'init', name, output })) as { pipeline: { output: string } };
      setCreatedPath(result.pipeline.output);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(cliMessage(err, 'Failed to scaffold the pipeline.'));
    }
  }

  return (
    <DialogShell title="New pipeline" onClose={onClose}>
      {createdPath ? (
        <div class="pipeline-dialog__result" data-testid="pipeline-init-result">
          <p>Pipeline scaffolded at:</p>
          <p class="pipeline-dialog__mono">{createdPath}</p>
          <p class="pipeline-dialog__hint">Edit the draft, then import it to install.</p>
        </div>
      ) : (
        <form class="pipeline-dialog__form" onSubmit={submit}>
          <label class="pipeline-dialog__field">
            <span>Pipeline name</span>
            <input
              type="text"
              data-testid="pipeline-init-name"
              value={name}
              disabled={submitting}
              required
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <PathField label="Output directory" testid="pipeline-init-output" value={output} onInput={setOutput} disabled={submitting} />
          {error && <p class="pipeline-dialog__error" role="alert" data-testid="pipeline-dialog-error">{error}</p>}
          <div class="pipeline-dialog__actions">
            <button type="submit" data-testid="pipeline-init-submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create pipeline'}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [path, setPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: string[] } | null>(null);
  const [refused, setRefused] = useState(false);

  async function run(force: boolean, event?: Event) {
    event?.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await client.mutatePipeline({ op: 'import', path, force })) as { imported: string[] };
      setResult({ imported: res.imported });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(cliMessage(err, 'Failed to import.'));
      if (!force) setRefused(true);
    }
  }

  return (
    <DialogShell title="Import pipeline" onClose={onClose}>
      {result ? (
        <div class="pipeline-dialog__result" data-testid="pipeline-import-result">
          <p>Imported: {result.imported.length > 0 ? result.imported.join(', ') : 'none'}</p>
        </div>
      ) : (
        <form class="pipeline-dialog__form" onSubmit={(e) => run(false, e)}>
          <PathField label="Pipeline directory or package" testid="pipeline-import-path" value={path} onInput={setPath} disabled={submitting} />
          {error && <p class="pipeline-dialog__error" role="alert" data-testid="pipeline-dialog-error">{error}</p>}
          <div class="pipeline-dialog__actions">
            <button type="submit" data-testid="pipeline-import-submit" disabled={submitting}>
              {submitting ? 'Importing…' : 'Import'}
            </button>
            {refused && (
              <button type="button" data-testid="pipeline-import-overwrite" disabled={submitting} onClick={() => run(true)}>
                Overwrite and retry
              </button>
            )}
          </div>
        </form>
      )}
    </DialogShell>
  );
}

function ExportDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [dir, setDir] = useState('');
  const [filename, setFilename] = useState(`${name}.rasenpkg`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  function destination(): string {
    const trimmed = dir.replace(/[/\\]+$/, '');
    return `${trimmed}/${filename}`;
  }

  async function run(force: boolean, event?: Event) {
    event?.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await client.mutatePipeline({ op: 'export', name, path: destination(), force })) as {
        pipeline: { path: string };
      };
      setDone(res.pipeline.path);
      setRefused(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(cliMessage(err, 'Export failed.'));
      if (!force) setRefused(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell title={`Export ${name}`} onClose={onClose}>
      {done ? (
        <div class="pipeline-dialog__result" data-testid="pipeline-export-result">
          <p>Exported to:</p>
          <p class="pipeline-dialog__mono">{done}</p>
        </div>
      ) : (
        <form class="pipeline-dialog__form" onSubmit={(e) => run(false, e)}>
          <PathField label="Destination directory" testid="pipeline-export-dir" value={dir} onInput={setDir} disabled={submitting} />
          <label class="pipeline-dialog__field">
            <span>Filename</span>
            <input
              type="text"
              data-testid="pipeline-export-filename"
              value={filename}
              disabled={submitting}
              onInput={(e) => setFilename((e.target as HTMLInputElement).value)}
            />
          </label>
          {error && <p class="pipeline-dialog__error" role="alert" data-testid="pipeline-dialog-error">{error}</p>}
          <div class="pipeline-dialog__actions">
            <button type="submit" data-testid="pipeline-export-submit" disabled={submitting}>
              {submitting ? 'Exporting…' : 'Export'}
            </button>
            {refused && (
              <button type="button" data-testid="pipeline-export-overwrite" disabled={submitting} onClick={() => run(true)}>
                Overwrite and retry
              </button>
            )}
          </div>
        </form>
      )}
    </DialogShell>
  );
}

function DeleteDialog({ name, onClose, onDone }: { name: string; onClose: () => void; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [forceConfirming, setForceConfirming] = useState(false);

  async function run(force: boolean) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await client.mutatePipeline({ op: 'delete', name, force });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(cliMessage(err, 'Delete failed.'));
      if (!force) setRefused(true);
    }
  }

  return (
    <DialogShell title={`Delete ${name}`} onClose={onClose}>
      {!refused ? (
        <div class="pipeline-dialog__form">
          <p>
            Delete pipeline <strong>{name}</strong>? This removes it from the user library.
          </p>
          {error && <p class="pipeline-dialog__error" role="alert" data-testid="pipeline-dialog-error">{error}</p>}
          <div class="pipeline-dialog__actions">
            <button type="button" data-testid="pipeline-delete-confirm" disabled={submitting} onClick={() => run(false)}>
              {submitting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      ) : (
        <div class="pipeline-dialog__form">
          <p class="pipeline-dialog__error" role="alert" data-testid="pipeline-delete-refusal">
            {error}
          </p>
          {!forceConfirming ? (
            <div class="pipeline-dialog__actions">
              <button type="button" data-testid="pipeline-delete-force" onClick={() => setForceConfirming(true)}>
                Force delete anyway…
              </button>
            </div>
          ) : (
            <div class="pipeline-dialog__form">
              <p>Force-deleting leaves its referrers dangling. Are you sure?</p>
              <div class="pipeline-dialog__actions">
                <button type="button" data-testid="pipeline-delete-force-confirm" disabled={submitting} onClick={() => run(true)}>
                  {submitting ? 'Deleting…' : 'Force delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}
