import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionListEntry, SessionRecordWire, StageStatus } from '../api/types.js';
import { useT } from '../i18n/store.js';

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
  const t = useT();
  const reason = session.terminationReason ?? 'unknown';
  return (
    <span
      class={`session-row__reason session-row__reason--${reason}`}
      data-testid="session-termination-reason"
    >
      {reason}
      {typeof session.exitCode === 'number' ? t('session.exit_code', { code: session.exitCode }) : ''}
      {session.exitSignal ? t('session.exit_signal', { signal: session.exitSignal }) : ''}
    </span>
  );
}

function RunProgress({ runState }: { runState: SessionListEntry['runState'] }) {
  const t = useT();
  if (runState.kind === 'absent') {
    return (
      <p class="session-row__run-note" data-testid="session-run-absent">
        {t('session.run_absent')}
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
        {t('session.run_no_state', { name: runState.name })}
      </p>
    );
  }

  const stages = runState.autoRun.state.stages ?? {};
  const stageIds = Object.keys(stages);
  if (stageIds.length === 0) {
    return (
      <p class="session-row__run-note" data-testid="session-run-no-stages">
        {t('session.run_no_stages', { pipeline: runState.autoRun.state.pipeline })}
      </p>
    );
  }

  return (
    <ul class="session-row__stages" data-testid="session-run-stages" aria-label={t('session.stages_label')}>
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

/**
 * The outcome of a confirmed kill: either the patched record from the
 * 202/200 response, or `gone` when the DELETE 404s — the session vanished
 * from the server's registry between poll and click (design D3: "treat as
 * already-gone and refresh", never pin a phantom record locally).
 */
export type KillOutcome = { kind: 'patched'; session: SessionRecordWire } | { kind: 'gone' };

export function SessionRow({
  entry,
  onKilled,
}: {
  entry: SessionListEntry;
  onKilled: (id: string, outcome: KillOutcome) => void;
}) {
  const { session, runState } = entry;
  const t = useT();
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
          setTailsError(err instanceof ApiError ? err.message : 'status.error.session_output');
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
      onKilled(session.id, { kind: 'patched', session: result.session });
      setConfirmingKill(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The session is no longer known to the server (pruned between poll
        // and click) — resolve gracefully, no error noise, and let the
        // parent drop any local override and refetch (never pin the
        // now-stale live record as a "patch").
        setConfirmingKill(false);
        onKilled(session.id, { kind: 'gone' });
        return;
      }
      setKillError(err instanceof ApiError ? err.message : 'status.error.session_kill');
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
        <span>{t('session.started', { time: formatTime(session.startedAt) })}</span>
        <span>{t('session.last_output', { time: formatTime(session.lastOutputAt) })}</span>
        {isEnded && <TerminationBadge session={session} />}
        {session.changeName && <span class="session-row__change">{session.changeName}</span>}
      </div>
      <RunProgress runState={runState} />
      {canKill && (
        <div class="session-row__kill">
          {!confirmingKill ? (
            <button type="button" class="btn--ghost" onClick={() => setConfirmingKill(true)}>
              {t('session.kill')}
            </button>
          ) : (
            <div class="session-row__kill-confirm" role="group" aria-label={t('session.kill_confirm_label')}>
              <span>{t('session.kill_question')}</span>
              <button type="button" class="btn--danger" onClick={handleConfirmKill} disabled={killing}>
                {killing ? t('session.killing') : t('session.confirm_kill')}
              </button>
              <button type="button" class="btn--ghost" onClick={() => setConfirmingKill(false)} disabled={killing}>
                {t('session.cancel')}
              </button>
            </div>
          )}
          {killError && (
            <p class="session-row__kill-error" role="alert">
              {t(killError)}
            </p>
          )}
        </div>
      )}
      {expanded && (
        <div class="session-row__detail" data-testid="session-detail">
          {tailsError && <p class="session-row__tail-error">{t(tailsError)}</p>}
          {tails && (
            <>
              <pre class="session-row__tail" aria-label={t('session.stdout_tail')}>
                {tails.stdout || t('session.no_output')}
              </pre>
              {tails.stderr && (
                <pre class="session-row__tail session-row__tail--stderr" aria-label={t('session.stderr_tail')}>
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
