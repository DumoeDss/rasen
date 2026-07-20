import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionListEntry, SessionRecordWire } from '../api/types.js';
import { SessionRow, type KillOutcome } from './SessionRow.js';
import { LaunchSessionDialog } from './LaunchSessionDialog.js';

const POLL_INTERVAL_MS = 3000;
const STATE_RANK: Record<SessionRecordWire['state'], number> = {
  starting: 0,
  running: 1,
  exiting: 2,
  exited: 3,
};

/** True when `patch` reflects a state at least as advanced as `server`'s. */
function patchStillAhead(server: SessionRecordWire | undefined, patch: SessionRecordWire): boolean {
  if (!server) return true;
  return STATE_RANK[patch.state] > STATE_RANK[server.state];
}

/**
 * Merges the last server-polled list with local overrides: kill-response
 * patches (design D3 — the 202 body's `exiting` shows instantly, and
 * polling only ever moves state forward so there is no flicker-back) and
 * optimistically-launched sessions not yet reflected by the server (design
 * D4/risk in design.md — merged by session id, never appended, so a launch
 * never double-shows once the next poll includes the real record).
 */
function buildDisplayList(
  serverEntries: SessionListEntry[],
  overrides: Map<string, SessionRecordWire>,
  pending: SessionRecordWire[]
): SessionListEntry[] {
  const byId = new Map<string, SessionListEntry>();
  for (const entry of serverEntries) byId.set(entry.session.id, entry);

  for (const [id, patch] of overrides) {
    const existing = byId.get(id);
    if (patchStillAhead(existing?.session, patch)) {
      byId.set(id, { session: patch, runState: existing?.runState ?? { kind: 'absent' } });
    }
  }

  for (const p of pending) {
    if (!byId.has(p.id)) byId.set(p.id, { session: p, runState: { kind: 'absent' } });
  }

  return Array.from(byId.values()).sort((a, b) => b.session.startedAt - a.session.startedAt);
}

/**
 * The Sessions view (design.md D1/D2 of `slice3-sessions-ui`): every session
 * the server knows, live and retained-exited, polled on a fixed 3s cadence
 * while mounted. Sessions are process-lifecycle objects, not board columns.
 */
export function SessionsPage() {
  const [serverEntries, setServerEntries] = useState<SessionListEntry[] | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Local overrides: id -> the record from a kill response or an
  // optimistic launch, applied on top of the last server poll.
  const [killPatches, setKillPatches] = useState<Map<string, SessionRecordWire>>(new Map());
  const [pendingLaunches, setPendingLaunches] = useState<SessionRecordWire[]>([]);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      client
        .listSessions()
        .then((res) => {
          if (cancelled) return;
          setServerEntries(res.sessions);
          setPageError(null);
          // Prune overrides the server has already caught up to.
          setKillPatches((prev) => {
            const next = new Map(prev);
            for (const [id, patch] of prev) {
              const server = res.sessions.find((e) => e.session.id === id)?.session;
              if (server && !patchStillAhead(server, patch)) next.delete(id);
            }
            return next;
          });
          setPendingLaunches((prev) => prev.filter((p) => !res.sessions.some((e) => e.session.id === p.id)));
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError) {
            setPageError({ message: err.message, fix: err.fix });
          } else {
            setPageError({ message: 'Failed to load sessions.' });
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    setLoading(true);
    setPageError(null);
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshNonce]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  function handleKilled(id: string, outcome: KillOutcome) {
    if (outcome.kind === 'gone') {
      // The server no longer knows this session (review round 1 M1): drop
      // any local override/pending entry rather than pinning the stale
      // live record, and force a clean refetch so the list reflects reality
      // (design D3: "treat as already-gone and refresh").
      setKillPatches((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setPendingLaunches((prev) => prev.filter((p) => p.id !== id));
      refresh();
      return;
    }
    setKillPatches((prev) => new Map(prev).set(id, outcome.session));
  }

  function handleLaunched(session: SessionRecordWire) {
    setDialogOpen(false);
    setPendingLaunches((prev) => [...prev, session]);
  }

  if (loading) {
    return <p class="sessions-page__loading">Loading sessions…</p>;
  }

  if (pageError) {
    return (
      <div class="sessions-page__error">
        <p>
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <button type="button" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  const entries = buildDisplayList(serverEntries ?? [], killPatches, pendingLaunches);

  return (
    <div class="sessions-page">
      <div class="sessions-page__toolbar">
        <button type="button" onClick={() => setDialogOpen(true)}>
          Launch session
        </button>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {entries.length === 0 ? (
        <p class="sessions-page__empty">No sessions yet.</p>
      ) : (
        <div class="sessions-page__list">
          {entries.map((entry) => (
            <SessionRow key={entry.session.id} entry={entry} onKilled={handleKilled} />
          ))}
        </div>
      )}
      {dialogOpen && (
        <LaunchSessionDialog onCancel={() => setDialogOpen(false)} onLaunched={handleLaunched} />
      )}
    </div>
  );
}
