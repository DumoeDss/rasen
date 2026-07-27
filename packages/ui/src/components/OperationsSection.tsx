import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  AllowedControl,
  ChangeRunView,
  ReconcilerRunSummary,
  RunsResponse,
  TerminalView,
  WaitView,
} from '../api/types.js';
import { getRootDagSection } from '../api/types.js';

/**
 * Operations section for Task detail (design.md §14 of `ecp-run-spine`).
 *
 * Lists reconciler-engine Runs for each child Change WITHOUT mixing planning
 * spaces; opens one Run detail fetched from the server's read-only `inspect`
 * route; renders the server-projected core and `root-dag/1` frontier, active
 * invocations, domain-blocked/infrastructure/workspace/uncertain wait reasons,
 * terminal reason, source state, and definition/capability/policy/workspace
 * drift.
 *
 * The UI CONSUMES server truth — it never re-derives frontier/status/waits/
 * terminal/drift client-side. Other-worktree Runs (`workspace.scope: 'other'`)
 * render read-only: the server already clears `allowedControls` and downgrades
 * `granted` → `admitted_undelivered` for those; the UI must not offer
 * controls or optimistic mutation for them.
 *
 * This component does NOT implement control submit (14.5/14.6) — that depends
 * on the POST control route built in a later wave. Controls are rendered as
 * a read-only list of what the server projects.
 */

/** Shortens an ID for display while preserving the full ID in a title attribute. */
function shortId(id: string, maxPrefix = 12): { label: string; full: string } {
  return { label: id.length > maxPrefix ? `${id.slice(0, maxPrefix)}…` : id, full: id };
}

/** Human-readable status label with a CSS modifier class. */
function statusClass(status: string): string {
  return `ops-run__status--${status}`;
}

/** Groups reconciler Run summaries by their changeId, preserving server order. */
function groupByChange(
  summaries: readonly ReconcilerRunSummary[]
): Map<string, ReconcilerRunSummary[]> {
  const map = new Map<string, ReconcilerRunSummary[]>();
  for (const s of summaries) {
    const list = map.get(s.changeId) ?? [];
    list.push(s);
    map.set(s.changeId, list);
  }
  return map;
}

/** Renders a wait reason from the server-projected wait variant. */
function WaitReason({ wait }: { wait: WaitView }) {
  const id = shortId(wait.waitId);
  let label: string;
  switch (wait.kind) {
    case 'gate':
      label = `Gate ${wait.gateId} awaiting decision (${wait.decisionIds.join(' | ')})`;
      break;
    case 'domain-blocked':
      label = `Domain blocked: ${wait.reasonCode}`;
      break;
    case 'infrastructure':
      label = `Infrastructure: ${wait.code}${wait.retryable ? ' (retryable)' : ''}`;
      break;
    case 'uncertain-effect':
      label = 'Uncertain effect — awaiting strong observation';
      break;
    case 'capability-unavailable':
      label = `Capability unavailable: ${wait.code}`;
      break;
    case 'workspace-drift':
      label = 'Workspace drift — observed revision differs from expected';
      break;
    case 'workspace-reservation':
      label = `Workspace reserved (${wait.intents.length} intent${wait.intents.length === 1 ? '' : 's'})`;
      break;
  }
  return (
    <li class="ops-wait" data-testid="ops-wait" data-wait-kind={wait.kind} title={`WaitId: ${id.full}`}>
      <span class="ops-wait__id">{id.label}</span>
      <span class="ops-wait__reason">{label}</span>
    </li>
  );
}

/** Renders a terminal outcome from the server projection. */
function TerminalReason({ terminal }: { terminal: TerminalView }) {
  let label: string;
  switch (terminal.kind) {
    case 'completed':
      label = `Completed — outcome: ${terminal.outcome}`;
      break;
    case 'escalated':
      label = `Escalated: ${terminal.code}${terminal.reason ? ` — ${terminal.reason}` : ''}`;
      break;
    case 'failed':
      label = `Failed: ${terminal.code}${terminal.reason ? ` — ${terminal.reason}` : ''}`;
      break;
    case 'cancelled':
      label = `Cancelled${terminal.reason ? ` — ${terminal.reason}` : ''}`;
      break;
  }
  return (
    <p class="ops-run__terminal" data-testid="ops-run-terminal" data-terminal-kind={terminal.kind}>
      {label}
    </p>
  );
}

/** Renders one allowed control as a read-only badge (submit UI is 14.5/14.6). */
function ControlBadge({ control }: { control: AllowedControl }) {
  let label: string;
  switch (control.kind) {
    case 'resume':
      label = `resume (${shortId(control.waitId).label})`;
      break;
    case 'decision':
      label = `decision ${control.decisionId} (${shortId(control.waitId).label})`;
      break;
    case 'accept-workspace-revision':
      label = `accept-workspace-revision (${shortId(control.waitId).label})`;
      break;
    case 'escalate':
      label = 'escalate';
      break;
    case 'cancel':
      label = 'cancel';
      break;
  }
  return (
    <span class="ops-control-badge" data-testid="ops-control-badge" data-control-kind={control.kind}>
      {label}
    </span>
  );
}

/** Renders the projected root-DAG detail: frontier, invocations, actions, waits, drift. */
function RunDetailBody({ view }: { view: ChangeRunView }) {
  const root = getRootDagSection(view);
  const isOther = view.workspace.scope === 'other';
  const runIdShort = shortId(view.runId);

  if (!root) {
    return <p class="ops-run__no-section">No root-dag section in this view.</p>;
  }

  return (
    <div class="ops-run__body" data-testid="ops-run-detail-body">
      {/* Core identity row — full IDs in title attributes for copy. */}
      <dl class="ops-run__meta">
        <dt>Run</dt>
        <dd title={view.runId} data-testid="ops-run-id">{runIdShort.label}</dd>
        <dt>Status</dt>
        <dd>
          <span class={`ops-run__status ${statusClass(view.status)}`} data-testid="ops-run-status">{view.status}</span>
        </dd>
        <dt>Record</dt>
        <dd>v{view.recordVersion}</dd>
        <dt>Source</dt>
        <dd data-testid="ops-run-source-state">{view.sourceState}</dd>
        <dt>Workspace</dt>
        <dd>
          <span
            class={`ops-run__scope ops-run__scope--${view.workspace.scope}`}
            data-testid="ops-run-scope"
          >
            {view.workspace.scope}
          </span>
          {isOther && (
            <span class="ops-run__readonly-notice" title="Other-worktree Run — read-only, no controls">
              read-only
            </span>
          )}
        </dd>
      </dl>

      {/* root-dag/1 frontier — the server-projected ready nodes. */}
      {root.frontier.length > 0 && (
        <div class="ops-run__frontier" data-testid="ops-run-frontier">
          <span class="ops-run__section-label">Frontier</span>
          <ul class="ops-run__frontier-list">
            {root.frontier.map((nodeId) => {
              const short = shortId(nodeId);
              return (
                <li key={nodeId} class="ops-run__frontier-node" title={nodeId}>
                  {short.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Active invocations — server-projected, with action/effect bindings. */}
      {root.activeInvocations.length > 0 && (
        <div class="ops-run__invocations" data-testid="ops-run-invocations">
          <span class="ops-run__section-label">Active invocations</span>
          <ul class="ops-run__invocation-list">
            {root.activeInvocations.map((inv) => {
              const invShort = shortId(inv.invocationId);
              return (
                <li
                  key={inv.invocationId}
                  class="ops-run__invocation"
                  title={`InvocationId: ${inv.invocationId}\nNodeId: ${inv.nodeId}\nAttemptId: ${inv.attemptId}`}
                  data-testid="ops-run-invocation"
                >
                  <span class="ops-run__invocation-id">{invShort.label}</span>
                  <span class="ops-run__invocation-actions">
                    {inv.actionIds.length} action{inv.actionIds.length === 1 ? '' : 's'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Actions — diagnostic delivery states from the projection. */}
      {root.actions.length > 0 && (
        <div class="ops-run__actions" data-testid="ops-run-actions">
          <span class="ops-run__section-label">Actions ({root.actions.length})</span>
          <ul class="ops-run__action-list">
            {root.actions.map((action) => {
              const actShort = shortId(action.actionId);
              return (
                <li
                  key={action.actionId}
                  class={`ops-run__action ops-run__action--${action.deliveryState}`}
                  title={`ActionId: ${action.actionId}\nKind: ${action.kind}\nInvocationId: ${action.invocationId}`}
                  data-testid="ops-run-action"
                  data-delivery={action.deliveryState}
                >
                  <span class="ops-run__action-kind">{action.kind}</span>
                  <span class="ops-run__action-id">{actShort.label}</span>
                  <span class="ops-run__delivery">{action.deliveryState}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Waits — the server-projected blocked reasons. */}
      {root.waits.length > 0 && (
        <div class="ops-run__waits" data-testid="ops-run-waits">
          <span class="ops-run__section-label">Waits ({root.waits.length})</span>
          <ul class="ops-run__wait-list">
            {root.waits.map((wait) => (
              <WaitReason key={wait.waitId} wait={wait} />
            ))}
          </ul>
        </div>
      )}

      {/* Terminal — only on terminal Runs (mutually exclusive with actions/waits). */}
      {root.terminal && <TerminalReason terminal={root.terminal} />}

      {/* Drift — definition/capability/policy/workspace/source comparison. */}
      <div class="ops-run__drift" data-testid="ops-run-drift">
        <span class="ops-run__section-label">Drift</span>
        <div class="ops-run__drift-grid">
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.definition}`}>
            definition: {view.drift.definition}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.capability}`}>
            capability: {view.drift.capability}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.policy}`}>
            policy: {view.drift.policy}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.workspace}`}>
            workspace: {view.drift.workspace}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.sourceRevision.semantic}`}>
            source: {view.drift.sourceRevision.semantic}
          </span>
        </div>
      </div>

      {/* Allowed controls — read-only projection (submit UI is 14.5/14.6, out of scope here). */}
      {root.allowedControls.length > 0 && (
        <div class="ops-run__controls" data-testid="ops-run-controls">
          <span class="ops-run__section-label">Allowed controls</span>
          <div class="ops-run__control-badges">
            {root.allowedControls.map((control, i) => (
              <ControlBadge key={i} control={control} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One Run summary row. Clicking opens its detail in the panel below. */
function RunSummaryRow({
  summary,
  isSelected,
  onSelect,
}: {
  summary: ReconcilerRunSummary;
  isSelected: boolean;
  onSelect: (runId: string) => void;
}) {
  const runIdShort = shortId(summary.runId);
  const hasError = !!summary.error;
  return (
    <li class="ops-summary-row" data-testid="ops-summary-row">
      <button
        type="button"
        class={`ops-summary-row__button${isSelected ? ' ops-summary-row__button--selected' : ''}`}
        data-testid="ops-summary-select"
        data-run-id={summary.runId}
        title={`RunId: ${summary.runId}`}
        disabled={hasError}
        onClick={() => onSelect(summary.runId)}
      >
        <span class="ops-summary-row__id">{runIdShort.label}</span>
        {hasError ? (
          <span class={`ops-run__status ops-run__status--error`} data-testid="ops-summary-error">
            error: {summary.error!.code}
          </span>
        ) : (
          <span class={`ops-run__status ${statusClass(summary.status)}`}>
            {summary.status}
          </span>
        )}
        <span class="ops-summary-row__source">{summary.sourceState}</span>
        {summary.waits !== undefined && summary.waits > 0 && (
          <span class="ops-summary-row__waits">{summary.waits} wait{summary.waits === 1 ? '' : 's'}</span>
        )}
        {summary.terminal !== undefined && (
          <span class="ops-summary-row__terminal" data-testid="ops-summary-terminal">terminal</span>
        )}
        <span class="ops-summary-row__version">v{summary.recordVersion}</span>
      </button>
    </li>
  );
}

/** Fetches and displays the Run detail for the currently selected Run. */
function RunDetailPanel({
  changeId,
  runId,
  selector,
  onClose,
}: {
  changeId: string;
  runId: string;
  selector?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<ChangeRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
    client
      .getRunDetail(changeId, runId, selector)
      .then((v) => {
        if (cancelled) return;
        setView(v);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load Run detail.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [changeId, runId, selector]);

  return (
    <div class="ops-run-detail" data-testid="ops-run-detail" data-run-id={runId}>
      <div class="ops-run-detail__header">
        <h4 class="ops-run-detail__title">
          Run detail — <code title={runId}>{shortId(runId).label}</code>
        </h4>
        <button type="button" class="btn--ghost" data-testid="ops-run-detail-close" onClick={onClose}>
          Close
        </button>
      </div>
      {loading && <p class="ops-run-detail__loading">Loading…</p>}
      {error && (
        <p class="ops-run-detail__error" role="alert" data-testid="ops-run-detail-error">
          {error}
        </p>
      )}
      {view && <RunDetailBody view={view} />}
    </div>
  );
}

/**
 * The Operations section itself. Receives the full `RunsResponse` from the
 * page (which already polls `/api/v1/runs` alongside `/api/v1/tasks/:id`),
 * filters reconciler Runs to the Task's child change names, and groups them
 * per child without mixing planning spaces.
 */
export function OperationsSection({
  runsResponse,
  selector,
  childNames,
}: {
  runsResponse: RunsResponse | null;
  selector?: string;
  /** The Task's child change names — used to group runs by child. */
  childNames: readonly string[];
}) {
  const [selectedRun, setSelectedRun] = useState<{ changeId: string; runId: string } | null>(null);

  const reconcilerRuns = runsResponse?.reconcilerRuns ?? [];
  // Group ALL reconciler runs by changeId — runs whose changeId matches a
  // child are shown under that child; any others (from other planning spaces
  // that happen to share the workspace) are grouped under "(other changes)".
  // The server already filters to the selected workspace, so this is a
  // safety net, not the primary filter.
  const byChange = groupByChange(reconcilerRuns);
  const childSet = new Set(childNames);
  const childGroups = Array.from(byChange.entries()).filter(([changeId]) =>
    childSet.has(changeId)
  );
  const otherGroups = Array.from(byChange.entries()).filter(
    ([changeId]) => !childSet.has(changeId)
  );

  if (reconcilerRuns.length === 0) {
    return null; // No reconciler runs — the section is absent, not empty.
  }

  return (
    <section class="task-detail__operations" aria-label="Operations" data-testid="operations-section">
      <h3 class="operations-section__title">Operations</h3>

      {childGroups.map(([changeId, summaries]) => (
        <div
          key={changeId}
          class="operations-section__group"
          data-testid="operations-group"
          data-change={changeId}
        >
          <h4 class="operations-section__group-title">{changeId}</h4>
          <ul class="operations-section__run-list">
            {summaries.map((s) => (
              <RunSummaryRow
                key={s.runId}
                summary={s}
                isSelected={
                  selectedRun?.runId === s.runId && selectedRun?.changeId === changeId
                }
                onSelect={(runId) =>
                  setSelectedRun({ changeId, runId })
                }
              />
            ))}
          </ul>
        </div>
      ))}

      {otherGroups.length > 0 && (
        <div class="operations-section__group operations-section__group--other" data-testid="operations-group-other">
          <h4 class="operations-section__group-title">Other changes</h4>
          <ul class="operations-section__run-list">
            {otherGroups.flatMap(([, summaries]) =>
              summaries.map((s) => (
                <RunSummaryRow
                  key={s.runId}
                  summary={s}
                  isSelected={selectedRun?.runId === s.runId}
                  onSelect={(runId) =>
                    setSelectedRun({ changeId: s.changeId, runId })
                  }
                />
              ))
            )}
          </ul>
        </div>
      )}

      {/* "Load more" pagination — uses the server's opaque cursor. */}
      {runsResponse?.hasMore && runsResponse.nextCursor && (
        <p class="operations-section__pagination" data-testid="operations-pagination">
          More Runs available (cursor: <code>{runsResponse.nextCursor.slice(0, 16)}…</code>)
        </p>
      )}

      {selectedRun && (
        <RunDetailPanel
          changeId={selectedRun.changeId}
          runId={selectedRun.runId}
          selector={selector}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </section>
  );
}
