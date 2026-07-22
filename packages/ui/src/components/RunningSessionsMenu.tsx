import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import type { SessionListEntry, SessionRecordWire } from '../api/types.js';
import { spaceHref, useSpace } from '../store/use-space.js';

const POLL_INTERVAL_MS = 3000;
const LIVE_SESSION_STATES: SessionRecordWire['state'][] = ['starting', 'running', 'exiting'];

/**
 * Header running-run summary (management-ui-shell design D4). It replaces both
 * the board's lone live-sessions link and the deleted top-level Sessions page:
 * a `⦿ N running` control (hidden when N=0) scoped to the current space's
 * live runs, opening to a list of each run's task, stage, and ticking
 * duration, with each change-associated entry linking to that change's task
 * detail route within the current space (child 4's page; a placeholder route
 * for now). It re-polls only while at least one run is live and re-subscribes
 * whenever the current space's selector changes.
 */

/** A short stage descriptor from the run-state join: the pipeline and its in-progress stage, when known. */
function describeStage(entry: SessionListEntry): string {
  const { runState } = entry;
  if (runState.kind !== 'ok' || runState.autoRun.kind !== 'ok') {
    return entry.session.changeName ?? 'no change yet';
  }
  const { pipeline, stages } = runState.autoRun.state;
  const active = stages
    ? Object.entries(stages).find(([, s]) => s.status === 'in_progress')?.[0]
    : undefined;
  return active ? `${pipeline} · ${active}` : pipeline;
}

/** Elapsed wall-clock since launch, coarse (`Xh Ym` / `Xm Ys` / `Xs`). */
function formatDuration(fromMs: number, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function RunningSessionsMenu() {
  const space = useSpace();
  const selector = space?.selector;

  const [live, setLive] = useState<SessionListEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Poll the current space's sessions; reset when the selector changes so the
  // summary never reflects the previous space.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLive([]);

    function poll() {
      client
        .listSessions(selector)
        .then((res) => {
          if (cancelled) return;
          const liveEntries = res.sessions.filter((e) => LIVE_SESSION_STATES.includes(e.session.state));
          setLive(liveEntries);
          if (liveEntries.length > 0) {
            timer = setTimeout(poll, POLL_INTERVAL_MS);
          }
        })
        .catch(() => {
          // The header summary is non-essential chrome — a failed sessions
          // fetch just shows nothing, silently.
        });
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selector]);

  // Tick the durations once a second only while something is live and open.
  useEffect(() => {
    if (live.length === 0 || !open) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live.length, open]);

  if (live.length === 0) return null;

  return (
    <div class="running-sessions-menu" data-testid="running-sessions-menu">
      <button
        type="button"
        class="running-sessions-menu__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⦿ {live.length} running
      </button>
      {open && (
        <ul class="running-sessions-menu__list" aria-label="Running sessions">
          {live.map((entry) => {
            const { session } = entry;
            const href =
              space && session.changeName
                ? spaceHref(space, 'task', session.changeName)
                : undefined;
            const body = (
              <>
                <span class="running-sessions-menu__task">{session.task}</span>
                <span class="running-sessions-menu__stage">{describeStage(entry)}</span>
                <span class="running-sessions-menu__duration">
                  {formatDuration(session.startedAt, now)}
                </span>
              </>
            );
            return (
              <li key={session.id} class="running-sessions-menu__item">
                {href ? <a href={href}>{body}</a> : <span>{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
