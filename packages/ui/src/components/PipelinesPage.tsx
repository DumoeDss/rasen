import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  ConfigSource,
  StoreLayerRef,
  ThresholdValue,
  WireConfigEntry,
  WirePipeline,
  WirePipelineStage,
} from '../api/types.js';
import { useSpace, spaceHref } from '../store/use-space.js';
import { setPendingDraft } from '../canvas/pending-draft.js';
import { validatePipelineName } from '../canvas/pipeline-name.js';
import {
  KNOWN_MODEL_IDS,
  modeScope,
  isStoreInherited,
  type ConfigMode,
  type SpaceType,
} from '../config/controls.js';
import { errorSurface } from '../config/errors.js';
import { ConfigEntryRow } from './ConfigEntryRow.js';
import { PageHeader } from './ui/PageHeader.js';
import { ValueDisplay } from './ui/ValueDisplay.js';

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

/**
 * The role matrix (design D5): one row per role, each pairing that role's model
 * key with its handoff-threshold key. The `Default` row carries the base
 * `models.default` / `handoff.threshold` keys every other role inherits from.
 * Rendered as a compact table — role down the side, Model and Handoff across —
 * rather than one full-width config row per key.
 */
const MATRIX_ROLES: ReadonlyArray<{ label: string; modelKey: string; handoffKey: string }> = [
  { label: 'Default', modelKey: 'models.default', handoffKey: 'handoff.threshold' },
  { label: 'Planner', modelKey: 'models.roles.planner', handoffKey: 'handoff.roles.planner' },
  { label: 'Implementer', modelKey: 'models.roles.implementer', handoffKey: 'handoff.roles.implementer' },
  { label: 'Reviewer', modelKey: 'models.roles.reviewer', handoffKey: 'handoff.roles.reviewer' },
  { label: 'Fixer', modelKey: 'models.roles.fixer', handoffKey: 'handoff.roles.fixer' },
  { label: 'Shipper', modelKey: 'models.roles.shipper', handoffKey: 'handoff.roles.shipper' },
];
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
  const { route } = useLocation();

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

      <PageHeader
        title="Pipelines"
        actions={
          <>
            {/* Single creation entry (pipelines-ui spec): the name-first canvas
                assembly flow. The scaffold-to-disk init dialog is retired from
                the UI; `rasen pipeline init` remains the CLI path. */}
            <button
              type="button"
              class="btn--primary"
              data-testid="pipeline-new"
              onClick={() => setDialog({ kind: 'assemble' })}
            >
              New pipeline
            </button>
            <button type="button" data-testid="pipeline-import" onClick={() => setDialog({ kind: 'import' })}>
              Import…
            </button>
            <button type="button" class="btn--ghost" data-testid="pipeline-refresh" onClick={refreshAll}>
              Refresh
            </button>
          </>
        }
      />

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
        <h3 class="pipelines-defaults__title">Defaults</h3>
        <p class="pipelines-defaults__legend">
          The model and context-handoff threshold every pipeline stage inherits, per role. A blank
          field inherits the wider scope; the badge names where the effective value resolved from.
        </p>
        <DefaultsMatrix
          entryFor={byKey}
          mode={mode}
          spaceType={spaceType}
          selector={selector}
          storeRef={storeRef}
          onPageError={(message, fix) => setPageError({ message, fix })}
          onEntryUpdated={updateEntry}
        />
        <div class="pipelines-defaults__autopilot" data-testid="pipelines-defaults-autopilot">
          {AUTOPILOT_KEYS.map((key) => {
            const entry = byKey(key);
            return entry ? (
              <ConfigEntryRow
                key={key}
                entry={entry}
                mode={mode}
                spaceType={spaceType}
                spaceSelector={selector}
                storeRef={storeRef}
                onPageError={(message, fix) => setPageError({ message, fix })}
                onEntryUpdated={updateEntry}
              />
            ) : null;
          })}
        </div>
      </section>

      <section class="pipelines-list" data-testid="pipelines-list">
        {(pipelines ?? []).map((pipeline) => (
          <PipelineSection
            key={pipeline.name}
            pipeline={pipeline}
            scope={writeScope}
            selector={selector}
            graphHref={space ? spaceHref(space, 'pipelines', pipeline.name) : undefined}
            onWrite={refreshPipelines}
            onExport={(name) => setDialog({ kind: 'export', name })}
            onDelete={(name) => setDialog({ kind: 'delete', name })}
          />
        ))}
      </section>

      {dialog?.kind === 'assemble' && space && (
        <AssembleDialog
          onClose={() => setDialog(null)}
          onStart={(name) => {
            setPendingDraft({ name });
            setDialog(null);
            route(spaceHref(space, 'pipelines', name));
          }}
        />
      )}
      {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={refreshAll} />}
      {dialog?.kind === 'export' && <ExportDialog name={dialog.name} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <DeleteDialog name={dialog.name} onClose={() => setDialog(null)} onDone={refreshAll} />
      )}
    </div>
  );
}

type Dialog =
  | { kind: 'assemble' }
  | { kind: 'import' }
  | { kind: 'export'; name: string }
  | { kind: 'delete'; name: string };

/**
 * "New pipeline" — the single creation entry (pipelines-ui spec): a name-first
 * dialog that hands off to the canvas editor's new-draft flow
 * (pipeline-canvas-edit design D6). The name is grammar-checked client-side,
 * then the graph route opens with an empty draft via the in-memory
 * pending-draft hint. No reserved URL segment — a pipeline named `new` is never
 * shadowed.
 */
function AssembleDialog({ onClose, onStart }: { onClose: () => void; onStart: (name: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: Event) {
    event.preventDefault();
    const validationError = validatePipelineName(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    onStart(name.trim());
  }

  return (
    <DialogShell title="New pipeline" onClose={onClose}>
      <form class="pipeline-dialog__form" onSubmit={submit}>
        <label class="pipeline-dialog__field">
          <span>Pipeline name</span>
          <input
            type="text"
            data-testid="pipeline-assemble-name"
            value={name}
            required
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value);
              setError(null);
            }}
          />
        </label>
        <p class="pipeline-dialog__hint">Opens the canvas editor with an empty draft to assemble.</p>
        {error && <p class="pipeline-dialog__error" role="alert" data-testid="pipeline-dialog-error">{error}</p>}
        <div class="pipeline-dialog__actions">
          <button type="submit" class="btn--primary" data-testid="pipeline-assemble-submit">
            Start assembling
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// ── Defaults matrix ──────────────────────────────────────────────────────────
// A compact role-first table (design D5): one row per role, columns Model and
// Handoff threshold. Each cell is the bare control plus a source badge — the
// dot-path and description ride a title tooltip, not a per-row paragraph, so the
// whole section fits roughly one screen. Every write rides the ordinary config
// scope chain via `putKey` / `deleteKey`, exactly as the full ConfigEntryRow
// does, and hands the re-resolved entry back to the page.

interface DefaultsCellCtx {
  mode: ConfigMode;
  spaceType: SpaceType;
  selector: string;
  storeRef: StoreLayerRef | null;
  onPageError: (message: string, fix?: string) => void;
  onEntryUpdated: (entry: WireConfigEntry) => void;
}

function DefaultsMatrix({
  entryFor,
  ...ctx
}: { entryFor: (key: string) => WireConfigEntry | undefined } & DefaultsCellCtx) {
  const rows = MATRIX_ROLES.map((role) => ({
    role,
    model: entryFor(role.modelKey),
    handoff: entryFor(role.handoffKey),
  })).filter((r) => r.model !== undefined || r.handoff !== undefined);
  if (rows.length === 0) return null;

  return (
    <table class="defaults-matrix" data-testid="defaults-matrix">
      <thead>
        <tr>
          <th scope="col">Role</th>
          <th scope="col">Model</th>
          <th scope="col">Handoff threshold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ role, model, handoff }) => (
          <tr key={role.label} class="defaults-matrix__row" data-role={role.label.toLowerCase()}>
            <th scope="row" class="defaults-matrix__role">{role.label}</th>
            <td class="defaults-matrix__cell">
              {model ? <ModelCell entry={model} {...ctx} /> : <span class="defaults-matrix__empty">—</span>}
            </td>
            <td class="defaults-matrix__cell">
              {handoff ? <HandoffCell entry={handoff} {...ctx} /> : <span class="defaults-matrix__empty">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A config-source pill reusing the Config page's badge palette (default / global / store / project / env-override). */
function ConfigSourceBadge({ source }: { source: ConfigSource }) {
  return (
    <span class={`config-entry__source config-entry__source--${source}`} data-testid="defaults-source">
      {source}
    </span>
  );
}

/**
 * Per-cell write plumbing — a lean mirror of ConfigEntryRow's commit/unset that
 * targets the active mode's scope and surfaces page-level errors (project
 * resolution) up to the page, field-level errors inline.
 */
function useDefaultsCell(key: string, ctx: DefaultsCellCtx) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writeScope = modeScope(ctx.mode, ctx.spaceType);

  async function run(fn: () => Promise<{ entry: WireConfigEntry }>) {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      ctx.onEntryUpdated(result.entry);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) return;
        if (errorSurface(err.code) === 'page') ctx.onPageError(err.message, err.fix);
        else setError(err.message);
      } else {
        setError('Write failed.');
      }
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    error,
    writeScope,
    commit: (value: unknown) => run(() => client.putKey(key, { scope: writeScope, value }, ctx.selector)),
    unset: () => run(() => client.deleteKey(key, writeScope, ctx.selector)),
  };
}

/** True when a store layer supplies this key while addressing a project space in Local mode — read-only with an edit-in-store link, mirroring ConfigEntryRow (design D3). */
function cellStoreInherited(entry: WireConfigEntry, ctx: DefaultsCellCtx): boolean {
  return isStoreInherited(entry, ctx.mode, ctx.spaceType) && ctx.storeRef !== null;
}

function ModelCell({ entry, ...ctx }: { entry: WireConfigEntry } & DefaultsCellCtx) {
  const key = entry.definition.key;
  const w = useDefaultsCell(key, ctx);
  const listId = `${key}-defaults-suggestions`;

  if (cellStoreInherited(entry, ctx)) {
    return <StoreInheritedCell entry={entry} storeRef={ctx.storeRef!} />;
  }

  return (
    <div class="defaults-cell defaults-cell--model" data-key={key} title={entry.definition.description}>
      <input
        type="text"
        list={listId}
        class="defaults-cell__input"
        data-testid="defaults-model-input"
        value={entry.value == null ? '' : String(entry.value)}
        placeholder="inherit"
        disabled={w.pending}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          // An empty field is not a model id — clear the override so the wider scope shows through.
          if (v.length === 0) w.unset();
          else w.commit(v);
        }}
      />
      <datalist id={listId}>
        {KNOWN_MODEL_IDS.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <ConfigSourceBadge source={entry.source} />
      {w.error && <span class="defaults-cell__error" role="alert">{w.error}</span>}
    </div>
  );
}

function HandoffCell({ entry, ...ctx }: { entry: WireConfigEntry } & DefaultsCellCtx) {
  const key = entry.definition.key;
  const w = useDefaultsCell(key, ctx);
  const value = entry.value as ThresholdValue | null | undefined;
  const isAbsolute = typeof value === 'object' && value !== null && 'remainingTokens' in value;

  if (cellStoreInherited(entry, ctx)) {
    return <StoreInheritedCell entry={entry} storeRef={ctx.storeRef!} />;
  }

  return (
    <div class="defaults-cell defaults-cell--handoff" data-key={key} title={entry.definition.description}>
      <div class="defaults-cell__forms">
        <label>
          <input
            type="radio"
            name={`${key}-defaults-form`}
            checked={!isAbsolute}
            disabled={w.pending}
            onChange={() => w.commit(0.5)}
          />
          Fraction
        </label>
        <label>
          <input
            type="radio"
            name={`${key}-defaults-form`}
            checked={isAbsolute}
            disabled={w.pending}
            onChange={() => w.commit({ remainingTokens: 50_000 })}
          />
          Tokens
        </label>
      </div>
      {!isAbsolute ? (
        <input
          type="number"
          step="any"
          class="defaults-cell__num"
          data-testid="defaults-handoff-fraction"
          value={typeof value === 'number' ? String(value) : '0.5'}
          disabled={w.pending}
          onChange={(e) => {
            const raw = Number((e.target as HTMLInputElement).value);
            if (!Number.isNaN(raw)) w.commit(raw);
          }}
        />
      ) : (
        <input
          type="number"
          step="1"
          class="defaults-cell__num"
          data-testid="defaults-handoff-remaining"
          value={String((value as { remainingTokens: number }).remainingTokens)}
          disabled={w.pending}
          onChange={(e) => {
            const raw = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(raw)) w.commit({ remainingTokens: raw });
          }}
        />
      )}
      <ConfigSourceBadge source={entry.source} />
      {w.error && <span class="defaults-cell__error" role="alert">{w.error}</span>}
    </div>
  );
}

/** A store-inherited key: read-only value plus an edit-in-store link (design D3), the compact analogue of ConfigEntryRow's store handling. */
function StoreInheritedCell({ entry, storeRef }: { entry: WireConfigEntry; storeRef: StoreLayerRef }) {
  return (
    <div class="defaults-cell defaults-cell--readonly" title={entry.definition.description}>
      <span class="defaults-cell__value">
        <ValueDisplay value={entry.value} />
      </span>
      <a
        class="config-entry__store-edit"
        href={spaceHref({ type: 'store', id: storeRef.id, selector: `store:${storeRef.id}` }, 'config')}
      >
        Edit in store {storeRef.id} →
      </a>
    </div>
  );
}

// ── Per-pipeline section ─────────────────────────────────────────────────────

function PipelineSection({
  pipeline,
  scope,
  selector,
  graphHref,
  onWrite,
  onExport,
  onDelete,
}: {
  pipeline: WirePipeline;
  scope: 'global' | 'store' | 'project';
  selector: string;
  /** The pipeline's graph-view route (pipeline-canvas-view), or undefined when no space is resolved. */
  graphHref?: string;
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
  // Per-pipeline configuration (runtimes + per-stage overrides) is collapsed
  // behind an explicit disclosure so the list reads as a scannable library
  // rather than a wall of controls (pipelines-ui spec). Independent per
  // pipeline — expanding one never collapses another.
  const [configureOpen, setConfigureOpen] = useState(false);
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
          {graphHref && (
            <a class="pipeline-section__graph-link" data-testid="pipeline-view-graph" href={graphHref}>
              View graph
            </a>
          )}
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

      <button
        type="button"
        class="pipeline-section__configure btn--ghost"
        data-testid="pipeline-configure"
        aria-expanded={configureOpen}
        onClick={() => setConfigureOpen((o) => !o)}
      >
        <span class={`pipeline-section__chevron${configureOpen ? ' pipeline-section__chevron--open' : ''}`} aria-hidden="true">
          ›
        </span>
        {configureOpen ? 'Hide configuration' : 'Configure'}
      </button>

      {configureOpen && (
        <div class="pipeline-section__config" data-testid="pipeline-config">
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
      )}
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
          <button type="button" class="btn--ghost" data-testid="pipeline-dialog-close" onClick={onClose}>
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
            <button type="submit" class="btn--primary" data-testid="pipeline-import-submit" disabled={submitting}>
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
            <button type="submit" class="btn--primary" data-testid="pipeline-export-submit" disabled={submitting}>
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
            <button type="button" class="btn--danger" data-testid="pipeline-delete-confirm" disabled={submitting} onClick={() => run(false)}>
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
                <button type="button" class="btn--danger" data-testid="pipeline-delete-force-confirm" disabled={submitting} onClick={() => run(true)}>
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
