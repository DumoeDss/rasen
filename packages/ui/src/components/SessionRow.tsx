import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionListEntry, SessionRecordWire, StageStatus } from '../api/types.js';

/**
 * One session's row (design.md D3/D5 of `slice3-sessions-ui`): kind/task/
 * state/timing facts, terminal facts once ended, pipeline progress from the
 * run-state join, expandable output tails, and the confirmed kill flow.
 * Sessions are process-lifecycle objects, not kanban-column objects — this
 * component renders facts, deriving no board-style column policy.
 */

const STAGE_GLYPHS: Record<StageStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  skipped: '—',
  escalated: '⚠',
};

const LIVE_KILLABLE_STATES: SessionRecordWire['state'][] = ['starting', 'running'];

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function TerminationBadge({ session }: { session: SessionRecordWire }) {
  const reason = session.terminationReason ?? 'unknown';
  return (
    <span
      class={`session-row__reason session-row__reason--${reason}`}
      data-testid="session-termination-reason"
    >
      {reason}
      {typeof session.exitCode === 'number' ? ` (exit ${session.exitCode})` : ''}
      {session.exitSignal ? ` (signal ${session.exitSignal})` : ''}
    </span>
  );
}

function RunProgress({ runState }: { runState: SessionListEntry['runState'] }) {
  if (runState.kind === 'absent') {
    return (
      <p class="session-row__run-note" data-testid="session-run-absent">
        No change linked — progress will appear on the board once the run creates one.
      </p>
    );
  }

  if (runState.kind === 'error') {
    return (
      <p class="session-row__run-note session-row__run-note--error" data-testid="session-run-error">
        {runState.message}
      </p>
    );
  }

  if (runState.autoRun.kind === 'invalid') {
    return (
      <p class="session-row__run-note session-row__run-note--error" data-testid="session-run-invalid">
        {runState.autoRun.reason}
      </p>
    );
  }

  if (runState.autoRun.kind === 'absent') {
    return (
      <p class="session-row__run-note" data-testid="session-run-absent">
        No run state recorded yet for {runState.name}.
      </p>
    );
  }

  const stages = runState.autoRun.state.stages ?? {};
  const stageIds = Object.keys(stages);
  if (stageIds.length === 0) {
    return (
      <p class="session-row__run-note" data-testid="session-run-no-stages">
        {runState.autoRun.state.pipeline} — no stages reported yet.
      </p>
    );
  }

  return (
    <ul class="session-row__stages" data-testid="session-run-stages" aria-label="Pipeline progress">
      {stageIds.map((id) => {
        const status = stages[id]!.status;
        return (
          <li
            key={id}
            class={`session-row__stage session-row__stage--${status}`}
            title={`${id}: ${status}`}
          >
            <span aria-hidden="true">{STAGE_GLYPHS[status]}</span> {id}
          </li>
        );
      })}
    </ul>
  );
}

export function SessionRow({
  entry,
  onKilled,
}: {
  entry: SessionListEntry;
  /** Called with the patched record from the 202/200 kill response. */
  onKilled: (id: string, patched: SessionRecordWire) => void;
}) {
  const { session, runState } = entry;
  const [expanded, setExpanded] = useState(false);
  const [tails, setTails] = useState<{ stdout: string; stderr: string } | null>(null);
  const [tailsError, setTailsError] = useState<string | null>(null);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;

    function fetchDetail() {
      client
        .getSession(session.id)
        .then((detail) => {
          if (cancelled) return;
          setTails(detail.tails);
          setTailsError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setTailsError(err instanceof ApiError ? err.message : 'Failed to load session output.');
        });
    }

    fetchDetail();
    const interval = setInterval(fetchDetail, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [expanded, session.id]);

  async function handleConfirmKill() {
    setKilling(true);
    setKillError(null);
    try {
      const result = await client.killSession(session.id);
      onKilled(session.id, result.session);
      setConfirmingKill(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Session ended between poll and click — resolve gracefully, no error noise.
        setConfirmingKill(false);
        onKilled(session.id, session);
        return;
      }
      setKillError(err instanceof ApiError ? err.message : 'Failed to kill the session.');
    } finally {
      setKilling(false);
    }
  }

  const canKill = LIVE_KILLABLE_STATES.includes(session.state);
  const isEnded = session.state === 'exited';

  return (
    <article class="session-row" data-testid="session-row" data-session-id={session.id}>
      <div class="session-row__header">
        <button
          type="button"
          class="session-row__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? '▾' : '▸'} <span class="session-row__kind">{session.kind}</span>
        </button>
        <span class={`session-row__state session-row__state--${session.state}`}>{session.state}</span>
        <p class="session-row__task">{session.task}</p>
      </div>
      <div class="session-row__meta">
        <span>Started {formatTime(session.startedAt)}</span>
        <span>Last output {formatTime(session.lastOutputAt)}</span>
        {isEnded && <TerminationBadge session={session} />}
        {session.changeName && <span class="session-row__change">{session.changeName}</span>}
      </div>
      <RunProgress runState={runState} />
      {canKill && (
        <div class="session-row__kill">
          {!confirmingKill ? (
            <button type="button" onClick={() => setConfirmingKill(true)}>
              Kill
            </button>
          ) : (
            <div class="session-row__kill-confirm" role="group" aria-label="Confirm kill">
              <span>Kill this session?</span>
              <button type="button" onClick={handleConfirmKill} disabled={killing}>
                {killing ? 'Killing…' : 'Confirm kill'}
              </button>
              <button type="button" onClick={() => setConfirmingKill(false)} disabled={killing}>
                Cancel
              </button>
            </div>
          )}
          {killError && (
            <p class="session-row__kill-error" role="alert">
              {killError}
            </p>
          )}
        </div>
      )}
      {expanded && (
        <div class="session-row__detail" data-testid="session-detail">
          {tailsError && <p class="session-row__tail-error">{tailsError}</p>}
          {tails && (
            <>
              <pre class="session-row__tail" aria-label="stdout tail">
                {tails.stdout || '(no output yet)'}
              </pre>
              {tails.stderr && (
                <pre class="session-row__tail session-row__tail--stderr" aria-label="stderr tail">
                  {tails.stderr}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
