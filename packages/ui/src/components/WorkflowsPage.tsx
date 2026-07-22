import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import { LocalPathPicker } from './LocalPathPicker.js';
import type {
  WorkflowDetailResponse,
  WorkflowInvalidEntry,
  WorkflowListEntry,
  WorkflowListResponse,
  WorkflowValidationSummary,
} from '../api/types.js';

/**
 * The Workflows page (workflows-ui spec). A space-agnostic `/workflows` route
 * giving the user-wide installable workflow library a complete management
 * surface: inspect (listing grouped by provenance + per-workflow detail),
 * grow (init draft, validate, import), share (export), retire (delete). Every
 * mutation goes through the CLI-backed bridge (`client.mutateWorkflow`) — the
 * browser never touches the filesystem — and every CLI failure surfaces
 * verbatim. The page manages the library ONLY: no model, handoff, or gate
 * control appears anywhere (Fork 4B rejected; those bind to pipeline stages).
 *
 * Paths are picked through the shared `LocalPathPicker` (the same server-local
 * browser the create-space flow uses): init picks the parent folder (the draft
 * lands at parentFolder/<id>, satisfying the CLI's basename===id rule), import
 * picks a `.rasenpkg` file OR a draft directory, and export picks a destination
 * folder plus a filename. The browser is server-rooted (home start), so every
 * pickable path is server-local; a typed absolute path is the escape above home.
 */
export function WorkflowsPage() {
  const [data, setData] = useState<WorkflowListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The full-page spinner shows only on the first load (loading starts
    // true). A refresh after a mutation refetches in the BACKGROUND — it must
    // not flip the page back to the spinner, which would tear down an open
    // dialog and its success result before the user reads it.
    setPageError(null);
    client
      .listWorkflows()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) setPageError({ message: err.message, fix: err.fix });
        else setPageError({ message: 'Failed to load the workflow library.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p class="workflows-page__loading" data-testid="workflows-loading">Loading workflow library…</p>;
  }

  if (pageError) {
    return (
      <div class="workflows-page__error" data-testid="workflows-error">
        <p>
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <button type="button" onClick={refresh}>Retry</button>
      </div>
    );
  }

  const workflows = data?.workflows ?? [];
  const invalid = data?.invalid ?? [];
  const builtIns = workflows.filter((w) => w.source === 'built-in');
  const userWorkflows = workflows.filter((w) => w.source === 'user');

  return (
    <div class="workflows-page" data-testid="workflows-page">
      <div class="workflows-page__toolbar">
        <h2 class="workflows-page__title">Workflows</h2>
        <div class="workflows-page__actions">
          <button type="button" data-testid="workflow-new" onClick={() => setDialog({ kind: 'init' })}>
            New draft
          </button>
          <button type="button" data-testid="workflow-import" onClick={() => setDialog({ kind: 'import' })}>
            Import…
          </button>
          <button type="button" data-testid="workflow-validate-standalone" onClick={() => setDialog({ kind: 'validate' })}>
            Validate…
          </button>
          <button type="button" data-testid="workflow-refresh" onClick={refresh}>Refresh</button>
        </div>
      </div>

      <WorkflowGroup
        heading="Built-in"
        testid="workflows-group-built-in"
        entries={builtIns}
        onOpen={setSelectedId}
        onExport={undefined}
        onDelete={undefined}
      />
      <WorkflowGroup
        heading="User"
        testid="workflows-group-user"
        entries={userWorkflows}
        onOpen={setSelectedId}
        onExport={(id) => setDialog({ kind: 'export', id })}
        onDelete={(id) => setDialog({ kind: 'delete', id })}
      />
      {invalid.length > 0 && <InvalidGroup entries={invalid} />}

      {selectedId !== null && (
        <WorkflowDetailPanel id={selectedId} onClose={() => setSelectedId(null)} />
      )}

      {dialog?.kind === 'init' && (
        <InitDialog onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === 'validate' && (
        <ValidateDialog prefill={dialog.prefill} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog id={dialog.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog id={dialog.id} onClose={() => setDialog(null)} onDone={refresh} />
      )}
    </div>
  );
}

type Dialog =
  | { kind: 'init' }
  | { kind: 'import' }
  | { kind: 'validate'; prefill?: string }
  | { kind: 'export'; id: string }
  | { kind: 'delete'; id: string };

// ── Listing ────────────────────────────────────────────────────────────────

function WorkflowGroup({
  heading,
  testid,
  entries,
  onOpen,
  onExport,
  onDelete,
}: {
  heading: string;
  testid: string;
  entries: WorkflowListEntry[];
  onOpen: (id: string) => void;
  onExport?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section class="workflows-group" data-testid={testid}>
      <h3 class="workflows-group__heading">{heading}</h3>
      <ul class="workflows-group__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <WorkflowCard entry={entry} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkflowCard({
  entry,
  onOpen,
  onExport,
  onDelete,
}: {
  entry: WorkflowListEntry;
  onOpen: (id: string) => void;
  onExport?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const isBuiltIn = entry.source === 'built-in';
  return (
    <div class="workflow-card" data-testid="workflow-card" data-id={entry.id} data-source={entry.source}>
      <button
        type="button"
        class="workflow-card__open"
        data-testid="workflow-open"
        onClick={() => onOpen(entry.id)}
      >
        <span class="workflow-card__name">{entry.skillName}</span>
        <span class="workflow-card__id">{entry.id}</span>
      </button>
      <div class="workflow-card__meta">
        <span class="workflow-card__kind" data-testid="workflow-kind">{entry.kind}</span>
        <span class="workflow-card__source">{isBuiltIn ? 'built-in' : 'user'}</span>
        <span class="workflow-card__digest" title={entry.digest}>{abbreviate(entry.digest)}</span>
        {entry.commandId && <span class="workflow-card__command">/{entry.commandId}</span>}
        {entry.unused && (
          <span class="workflow-card__unused" data-testid="workflow-unused">unused</span>
        )}
        {isBuiltIn && (
          <span class="workflow-card__lock" data-testid="workflow-lock" title="Built-in — locked">
            locked
          </span>
        )}
      </div>
      {/* Built-ins are pre-validated and locked, so they carry no per-card
          actions — validation lives in the toolbar's Validate… dialog. Only
          user-library cards expose export / delete. */}
      {(onExport || onDelete) && (
        <div class="workflow-card__actions">
          {onExport && (
            <button type="button" data-testid="workflow-export" onClick={() => onExport(entry.id)}>
              Export
            </button>
          )}
          {onDelete && (
            <button type="button" data-testid="workflow-delete" onClick={() => onDelete(entry.id)}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InvalidGroup({ entries }: { entries: WorkflowInvalidEntry[] }) {
  return (
    <section class="workflows-group workflows-group--invalid" data-testid="workflows-group-invalid">
      <h3 class="workflows-group__heading">Invalid</h3>
      <ul class="workflows-group__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div class="workflow-card workflow-card--invalid" data-testid="workflow-invalid-card" data-id={entry.id}>
              <span class="workflow-card__id">{entry.id}</span>
              <span class="workflow-card__source">{entry.sourcePath}</span>
              <ul class="workflow-card__diagnostics">
                {entry.diagnostics.map((d, i) => (
                  <li key={i} class={`workflow-diagnostic workflow-diagnostic--${d.severity}`}>
                    {d.severity}: {d.code}
                    {d.message ? ` — ${d.message}` : ''}
                    {d.path ? ` (${d.path})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────

function WorkflowDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<WorkflowDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    client
      .getWorkflow(id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load the workflow.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div class="workflow-detail__overlay" data-testid="workflow-detail">
      <div class="workflow-detail" role="dialog" aria-label={`Workflow ${id}`}>
        <div class="workflow-detail__header">
          <h3>{id}</h3>
          <button type="button" data-testid="workflow-detail-close" onClick={onClose}>Close</button>
        </div>
        {error && <p class="workflow-detail__error" role="alert">{error}</p>}
        {!detail && !error && <p>Loading…</p>}
        {detail && (
          <div class="workflow-detail__body">
            <dl class="workflow-detail__facts">
              <dt>Kind</dt><dd>{detail.workflow.kind}</dd>
              <dt>Source</dt><dd>{detail.workflow.source}</dd>
              <dt>Skill</dt><dd>{detail.workflow.skill.name}</dd>
              <dt>Command</dt><dd>{detail.workflow.command ? `/${detail.workflow.command.id}` : 'none'}</dd>
              <dt>Digest</dt><dd class="workflow-detail__mono">{detail.workflow.digest}</dd>
            </dl>
            <Slots label="Requires workflows" items={detail.workflow.requires.workflows} />
            <Slots label="Requires skills" items={detail.workflow.requires.skills} />
            <Slots label="Requires pipelines" items={detail.workflow.requires.pipelines} />
            <Slots label="Requires schemas" items={detail.workflow.requires.schemas} />
            <Slots label="Recommends" items={detail.workflow.recommends.workflows} />
            <div class="workflow-detail__files" data-testid="workflow-detail-files">
              <h4>Files ({detail.workflow.files.length})</h4>
              <ul>
                {detail.workflow.files.map((f) => (
                  <li key={f.path} class="workflow-detail__mono">{f.path}</li>
                ))}
              </ul>
            </div>
            <div class="workflow-detail__usage" data-testid="workflow-detail-usage">
              <h4>Known usage ({detail.usage.length})</h4>
              {detail.usage.length === 0 ? (
                <p>No known consumers.</p>
              ) : (
                <ul>
                  {detail.usage.map((u, i) => (
                    <li key={i}>{u.kind}: {u.consumer}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Slots({ label, items }: { label: string; items: string[] }) {
  return (
    <div class="workflow-detail__slot">
      <span class="workflow-detail__slot-label">{label}:</span>{' '}
      <span>{items.length > 0 ? items.join(', ') : 'none'}</span>
    </div>
  );
}

// ── Dialog chrome ────────────────────────────────────────────────────────────

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class="workflow-dialog__overlay" data-testid="workflow-dialog">
      <div class="workflow-dialog" role="dialog" aria-label={title}>
        <h3 class="workflow-dialog__title">{title}</h3>
        {children}
        <div class="workflow-dialog__dismiss">
          <button type="button" data-testid="workflow-dialog-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Joins a child name onto a directory using the platform separator the picker reports. */
function joinChild(dir: string, sep: string, name: string): string {
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function cliMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// ── init ─────────────────────────────────────────────────────────────────────

function InitDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [id, setId] = useState('');
  // The picked PARENT folder + separator; the draft lands at parent/<id> so the
  // CLI's basename===id rule holds by construction.
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [sep, setSep] = useState('/');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  const output = id && parentDir ? joinChild(parentDir, sep, id) : '';

  async function submit(event: Event) {
    event.preventDefault();
    if (submitting || !id || !parentDir) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = (await client.mutateWorkflow({ op: 'init', id, output })) as { workflow: { output: string } };
      setCreatedPath(result.workflow.output);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(cliMessage(err, 'Failed to scaffold the draft.'));
    }
  }

  return (
    <DialogShell title="New draft" onClose={onClose}>
      {createdPath ? (
        <div class="workflow-dialog__result" data-testid="workflow-init-result">
          <p>Draft scaffolded at:</p>
          <p class="workflow-detail__mono">{createdPath}</p>
          <p class="workflow-dialog__hint">Edit the draft, then validate it, then import it to install.</p>
        </div>
      ) : (
        <form class="workflow-dialog__form" onSubmit={submit}>
          <label class="workflow-dialog__field">
            <span>Workflow id</span>
            <input
              type="text"
              data-testid="workflow-init-id"
              value={id}
              disabled={submitting}
              required
              onInput={(e) => setId((e.target as HTMLInputElement).value)}
            />
          </label>
          <span class="workflow-dialog__field-label">Parent folder (the draft is created at parentFolder/&lt;id&gt;)</span>
          <LocalPathPicker
            classPrefix="local-path-picker"
            currentLabel="Parent folder"
            disabled={submitting}
            onDirChange={(p, s) => {
              setParentDir(p);
              setSep(s);
            }}
          />
          {output && (
            <p class="workflow-dialog__hint" data-testid="workflow-init-output-preview">
              Will create: <code class="workflow-detail__mono">{output}</code>
            </p>
          )}
          {error && <p class="workflow-dialog__error" role="alert" data-testid="workflow-dialog-error">{error}</p>}
          <div class="workflow-dialog__actions">
            <button type="submit" data-testid="workflow-init-submit" disabled={submitting || !id || !parentDir}>
              {submitting ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

// ── import ───────────────────────────────────────────────────────────────────

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  // The chosen import source: a `.rasenpkg` FILE picked from the listing, or a
  // draft DIRECTORY (the currently-browsed folder). The local-paths listing
  // already includes files, so a package is directly selectable.
  const [source, setSource] = useState<string | null>(null);
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: string[]; reused: string[] } | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    if (submitting || !source) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await client.mutateWorkflow({ op: 'import', path: source })) as { imported: string[]; reused: string[] };
      setResult({ imported: res.imported, reused: res.reused });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(cliMessage(err, 'Failed to import.'));
    }
  }

  return (
    <DialogShell title="Import workflow" onClose={onClose}>
      {result ? (
        <div class="workflow-dialog__result" data-testid="workflow-import-result">
          <p>Imported: {result.imported.length > 0 ? result.imported.join(', ') : 'none'}</p>
          <p>Already installed: {result.reused.length > 0 ? result.reused.join(', ') : 'none'}</p>
        </div>
      ) : (
        <form class="workflow-dialog__form" onSubmit={submit}>
          <span class="workflow-dialog__field-label">Pick a .rasenpkg file, or browse to a draft folder and use it</span>
          <LocalPathPicker
            classPrefix="local-path-picker"
            mode="file-or-dir"
            currentLabel="In folder"
            disabled={submitting}
            onDirChange={(p) => setCurrentDir(p)}
            onFileSelect={(p) => setSource(p)}
          />
          <div class="workflow-dialog__actions">
            <button
              type="button"
              data-testid="workflow-import-use-dir"
              disabled={submitting || !currentDir}
              onClick={() => setSource(currentDir)}
            >
              Use this folder (draft directory)
            </button>
          </div>
          <p class="workflow-dialog__hint" data-testid="workflow-import-source">
            Selected: <code class="workflow-detail__mono">{source ?? 'nothing yet'}</code>
          </p>
          {error && <p class="workflow-dialog__error" role="alert" data-testid="workflow-dialog-error">{error}</p>}
          <div class="workflow-dialog__actions">
            <button type="submit" data-testid="workflow-import-submit" disabled={submitting || !source}>
              {submitting ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

// ── validate (standalone or per-card) ────────────────────────────────────────

function ValidateDialog({ prefill, onClose }: { prefill?: string; onClose: () => void }) {
  const [target, setTarget] = useState(prefill ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationSummary | null>(null);

  async function submit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setValidation(null);
    try {
      const res = await client.validateWorkflow(target);
      setValidation(res.validation);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(cliMessage(err, 'Validation failed.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell title="Validate workflow" onClose={onClose}>
      <form class="workflow-dialog__form" onSubmit={submit}>
        <label class="workflow-dialog__field">
          <span>Installed id, or an absolute draft / package path</span>
          <input
            type="text"
            data-testid="workflow-validate-target"
            value={target}
            disabled={submitting}
            required
            onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
          />
        </label>
        {error && <p class="workflow-dialog__error" role="alert" data-testid="workflow-dialog-error">{error}</p>}
        <div class="workflow-dialog__actions">
          <button type="submit" data-testid="workflow-validate-submit" disabled={submitting}>
            {submitting ? 'Validating…' : 'Validate'}
          </button>
        </div>
      </form>
      {validation && (
        <div class="workflow-dialog__result" data-testid="workflow-validation-result">
          <p class={validation.valid ? 'workflow-valid' : 'workflow-invalid'}>
            {validation.valid ? 'Valid' : 'Invalid'} ({validation.kind})
          </p>
          {validation.diagnostics.length > 0 && (
            <ul>
              {validation.diagnostics.map((d, i) => (
                <li key={i} class={`workflow-diagnostic workflow-diagnostic--${d.severity}`}>
                  {d.severity}: {d.code}{d.message ? ` — ${d.message}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </DialogShell>
  );
}

// ── export ───────────────────────────────────────────────────────────────────

function ExportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  // The picked destination FOLDER + separator; the package is written at
  // destinationFolder/<filename>.
  const [dir, setDir] = useState<string | null>(null);
  const [sep, setSep] = useState('/');
  const [filename, setFilename] = useState(`${id}.rasenpkg`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Set once a plain export was refused — offers an explicit overwrite retry.
  const [refused, setRefused] = useState(false);

  function destination(): string {
    return dir ? joinChild(dir, sep, filename) : '';
  }

  async function run(force: boolean, event?: Event) {
    event?.preventDefault();
    if (submitting || !dir || !filename) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = (await client.mutateWorkflow({ op: 'export', id, path: destination(), force })) as {
        workflow: { path: string };
      };
      setDone(res.workflow.path);
      setRefused(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      // The CLI's own message (verbatim) — for a destination-exists refusal it
      // says so; offer an explicit overwrite retry regardless of which
      // refusal it was (a benign extra affordance for any other failure).
      setError(cliMessage(err, 'Export failed.'));
      if (!force) setRefused(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell title={`Export ${id}`} onClose={onClose}>
      {done ? (
        <div class="workflow-dialog__result" data-testid="workflow-export-result">
          <p>Exported to:</p>
          <p class="workflow-detail__mono">{done}</p>
        </div>
      ) : (
        <form class="workflow-dialog__form" onSubmit={(e) => run(false, e)}>
          <span class="workflow-dialog__field-label">Destination folder</span>
          <LocalPathPicker
            classPrefix="local-path-picker"
            currentLabel="Destination folder"
            disabled={submitting}
            onDirChange={(p, s) => {
              setDir(p);
              setSep(s);
            }}
          />
          <label class="workflow-dialog__field">
            <span>Filename</span>
            <input
              type="text"
              data-testid="workflow-export-filename"
              value={filename}
              disabled={submitting}
              onInput={(e) => setFilename((e.target as HTMLInputElement).value)}
            />
          </label>
          {dir && filename && (
            <p class="workflow-dialog__hint" data-testid="workflow-export-destination">
              Export to: <code class="workflow-detail__mono">{destination()}</code>
            </p>
          )}
          {error && <p class="workflow-dialog__error" role="alert" data-testid="workflow-dialog-error">{error}</p>}
          <div class="workflow-dialog__actions">
            <button type="submit" data-testid="workflow-export-submit" disabled={submitting || !dir || !filename}>
              {submitting ? 'Exporting…' : 'Export'}
            </button>
            {refused && (
              <button
                type="button"
                data-testid="workflow-export-overwrite"
                disabled={submitting}
                onClick={() => run(true)}
              >
                Overwrite and retry
              </button>
            )}
          </div>
        </form>
      )}
    </DialogShell>
  );
}

// ── delete ───────────────────────────────────────────────────────────────────

function DeleteDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a guarded delete was refused (referrers) — reveals the force path,
  // which itself needs a second explicit confirmation.
  const [refused, setRefused] = useState(false);
  const [forceConfirming, setForceConfirming] = useState(false);

  async function run(force: boolean) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await client.mutateWorkflow({ op: 'delete', id, force });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      // The CLI's message names the referrers, verbatim.
      setError(cliMessage(err, 'Delete failed.'));
      if (!force) setRefused(true);
    }
  }

  return (
    <DialogShell title={`Delete ${id}`} onClose={onClose}>
      {!refused ? (
        <div class="workflow-dialog__form">
          <p>Delete workflow <strong>{id}</strong>? This removes it from the user library.</p>
          {error && <p class="workflow-dialog__error" role="alert" data-testid="workflow-dialog-error">{error}</p>}
          <div class="workflow-dialog__actions">
            <button type="button" data-testid="workflow-delete-confirm" disabled={submitting} onClick={() => run(false)}>
              {submitting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      ) : (
        <div class="workflow-dialog__form">
          <p class="workflow-dialog__error" role="alert" data-testid="workflow-delete-refusal">{error}</p>
          {!forceConfirming ? (
            <div class="workflow-dialog__actions">
              <button type="button" data-testid="workflow-delete-force" onClick={() => setForceConfirming(true)}>
                Force delete anyway…
              </button>
            </div>
          ) : (
            <div class="workflow-dialog__form">
              <p>Force-deleting leaves its referrers dangling. Are you sure?</p>
              <div class="workflow-dialog__actions">
                <button
                  type="button"
                  data-testid="workflow-delete-force-confirm"
                  disabled={submitting}
                  onClick={() => run(true)}
                >
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

function abbreviate(digest: string): string {
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest;
}
