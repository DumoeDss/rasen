import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  ChangeLoadError,
  ChangeRunEntry,
  ChangeSummary,
  SessionListEntry,
  SpaceEntry,
  SpaceMember,
} from '../api/types.js';
import {
  BOARD_COLUMNS,
  groupIntoTasks,
  tasksForMember,
  type BoardColumn as BoardColumnId,
} from '../board/columns.js';
import { BoardColumn, type BoardColumnEntry } from './BoardColumn.js';
import { MemberChips } from './MemberChips.js';
import { NewChangeDialog } from './NewChangeDialog.js';
import { useSpace } from '../store/use-space.js';

/**
 * The board page (ui-space-redesign-task-board design D6): three space-scoped
 * calls — `listChanges` + `listRuns` + `listSessions` — render the whole
 * board, scoped to the current route's planning space, grouped into Tasks
 * (portfolio containers and implicit single-item bare changes) and placed into
 * lifecycle columns by the pure `groupIntoTasks` / `deriveTaskColumn`
 * functions. Live sessions drive the `⦿` indicator and, in a store space, the
 * member-chip filter (session-provenance attribution). Never shows
 * placeholder/fabricated changes (board-ui spec) — loading/error/empty are
 * distinct explicit states.
 */
export function BoardPage() {
  const space = useSpace();
  const selector = space?.selector;
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<ChangeLoadError[]>([]);
  const [runs, setRuns] = useState<ChangeRunEntry[]>([]);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  // The selected member chip (a member's projectId), or null for the "All"
  // rollup. Reset whenever the space changes so a stale member never carries
  // across a space switch.
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setSelectedMember(null);
    Promise.all([client.listChanges(selector), client.listRuns(selector), client.listSessions(selector)])
      .then(([changesRes, runsRes, sessionsRes]) => {
        if (cancelled) return;
        setChanges(changesRes.changes);
        // `@atelierai/rasen-ui` is published/resolved independently of the
        // CLI (design.md D1 of `unified-config-ui-pkg`) — a UI build newer
        // than the serving CLI could be talking to a server that predates
        // the `errors[]` field (review round 2 N2). Fall back to `[]`
        // rather than crashing the whole board on `undefined.length`.
        setLoadErrors(changesRes.errors ?? []);
        setRuns(runsRes.runs);
        setSessions(sessionsRes.sessions);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load the board.' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, selector]);

  // The member chip row is store-only chrome (design D4). Fetch the spaces
  // listing best-effort — a failure just leaves the chip row empty rather than
  // failing the board, and a project space never needs it.
  useEffect(() => {
    if (space?.type !== 'store') {
      setSpaces([]);
      return;
    }
    let cancelled = false;
    client
      .listSpaces()
      .then((res) => {
        if (!cancelled) setSpaces(res.spaces);
      })
      .catch(() => {
        if (!cancelled) setSpaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [space?.type, space?.id, refreshNonce]);

  function refresh() {
    setHighlightedName(null);
    setRefreshNonce((n) => n + 1);
  }

  function handleChangeCreated(changeId: string) {
    setDialogOpen(false);
    setHighlightedName(changeId);
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p class="board-page__loading">Loading board…</p>;
  }

  if (pageError) {
    return (
      <div class="board-page__error">
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

  // A change the server could enumerate but not read (review round 1 M2) is
  // something to show, not nothing — the empty state below is reserved for
  // "zero active changes AND zero load errors".
  const brokenChanges =
    loadErrors.length > 0 ? (
      <section class="board-page__broken" aria-label="Changes that failed to load">
        {loadErrors.map((e) => (
          <article key={e.name} class="board-card board-card--broken" data-testid="board-card-broken">
            <h3 class="board-card__name">{e.name}</h3>
            <p class="board-card__error-message">{e.message}</p>
          </article>
        ))}
      </section>
    ) : null;

  if (!changes || (changes.length === 0 && loadErrors.length === 0)) {
    return (
      <div class="board-page__empty">
        <p>No active changes.</p>
        <div class="board-page__toolbar">
          <button type="button" onClick={() => setDialogOpen(true)}>
            New change
          </button>
          <button type="button" onClick={refresh}>
            Refresh
          </button>
        </div>
        {dialogOpen && (
          <NewChangeDialog space={selector} onCancel={() => setDialogOpen(false)} onCreated={handleChangeCreated} />
        )}
      </div>
    );
  }

  const runsByName = new Map(runs.map((r) => [r.name, r]));
  const allTasks = groupIntoTasks(changes, runsByName, sessions);

  // Member chips render only for a store space (design D4). The current
  // store's members come from the spaces listing, matched by opaque id.
  const storeMembers: SpaceMember[] =
    space?.type === 'store'
      ? (spaces.find((s) => s.type === 'store' && s.id === space.id) as
          | { members: SpaceMember[] }
          | undefined)?.members ?? []
      : [];
  const memberRoot =
    selectedMember !== null
      ? storeMembers.find((m) => m.projectId === selectedMember)?.root ?? null
      : null;
  const tasks = tasksForMember(allTasks, sessions, memberRoot);

  const grouped = new Map<BoardColumnId, BoardColumnEntry[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
  for (const task of tasks) {
    grouped.get(task.column)!.push({ task, highlighted: task.id === highlightedName });
  }

  return (
    <div class="board-page">
      <div class="board-page__toolbar">
        <button type="button" onClick={() => setDialogOpen(true)}>
          New change
        </button>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {space?.type === 'store' && (
        <MemberChips members={storeMembers} selected={selectedMember} onSelect={setSelectedMember} />
      )}
      {brokenChanges}
      {changes.length > 0 && (
        <div class="board">
          {BOARD_COLUMNS.map((col) => (
            <BoardColumn key={col.id} label={col.label} entries={grouped.get(col.id) ?? []} space={space} />
          ))}
        </div>
      )}
      {dialogOpen && (
        <NewChangeDialog space={selector} onCancel={() => setDialogOpen(false)} onCreated={handleChangeCreated} />
      )}
    </div>
  );
}
