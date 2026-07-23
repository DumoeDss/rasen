import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  ChangeLoadError,
  ChangeRunEntry,
  ChangeSummary,
  SessionListEntry,
  SpaceEntry,
  SpaceMember,
  SpaceWorktreeEntry,
} from '../api/types.js';
import {
  BOARD_COLUMNS,
  groupIntoTasks,
  tasksForMember,
  type BoardColumn as BoardColumnId,
} from '../board/columns.js';
import { BoardColumn, type BoardColumnEntry } from './BoardColumn.js';
import { MemberChips } from './MemberChips.js';
import { WorktreePanel } from './WorktreePanel.js';
import { NewChangeDialog } from './NewChangeDialog.js';
import { PageHeader } from './ui/PageHeader.js';
import { spaceHref, useSpace } from '../store/use-space.js';

/**
 * The Done column shows only the most recent N done Tasks, overflowing the rest
 * into the Archive page (ui-space-redesign-archive-page design D5 / archive-ui
 * spec). N is a UI tuning knob, not a contract — the spec says "a bounded
 * number", not a specific value.
 */
const DONE_COLUMN_LIMIT = 5;

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
  // `query`/`path`/`route` are absent when mounted outside a LocationProvider
  // (the launch-project fallback path some tests exercise); default them so the
  // board still renders its no-space state.
  const { path, query, route } = useLocation();
  // The selected worktree's root (worktree-aware-spaces D4), carried in the
  // board route's `?wt=` query so it survives a reload without changing the
  // space identity. `null` (no `?wt=`) means the default source: the main
  // checkout, which the project space selector already answers for.
  const selectedWorktree = query?.wt || null;
  // The data source for changes/runs: a selected worktree re-scopes to that
  // worktree's own root selector; otherwise the space's own selector (main
  // checkout). Sessions stay fetched space-wide (by `selector`) — attribution
  // to a worktree is client-side (below), never a separate fetch.
  const dataSelector = selectedWorktree ? `project:${selectedWorktree}` : selector;
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<ChangeLoadError[]>([]);
  const [runs, setRuns] = useState<ChangeRunEntry[]>([]);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [worktrees, setWorktrees] = useState<SpaceWorktreeEntry[]>([]);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  // True while re-fetching a board that is already showing data for THIS
  // space (a worktree switch or a manual refresh): the old board stays
  // visible, dimmed, instead of being wiped to the full-page loading state —
  // a sub-second refetch that blanks the whole board reads as a page reload.
  const [refreshing, setRefreshing] = useState(false);
  // The space selector the currently-displayed data was loaded for; a
  // different selector means a genuine space switch, which DOES take the
  // full loading state (stale data from another space must never linger).
  const loadedSelectorRef = useRef<string | undefined>(undefined);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  // The selected member chip (a member's projectId), or null for the "All"
  // rollup. Reset whenever the space changes so a stale member never carries
  // across a space switch.
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const backgroundRefresh = changes !== null && loadedSelectorRef.current === selector;
    if (backgroundRefresh) setRefreshing(true);
    else setLoading(true);
    setPageError(null);
    setSelectedMember(null);
    Promise.all([client.listChanges(dataSelector), client.listRuns(dataSelector), client.listSessions(selector)])
      .then(([changesRes, runsRes, sessionsRes]) => {
        if (cancelled) return;
        loadedSelectorRef.current = selector;
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
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, selector, dataSelector]);

  // The worktrees panel is project-space chrome (worktree-aware-spaces D4).
  // Fetch the live inventory best-effort — a failure (or a non-git / single-
  // worktree root) just leaves the panel unrendered, never fails the board.
  // Keyed on the space identity, not the data source, so switching worktrees
  // does not re-probe the inventory.
  useEffect(() => {
    if (space?.type !== 'project') {
      setWorktrees([]);
      return;
    }
    let cancelled = false;
    client
      .listSpaceWorktrees(selector)
      .then((res) => {
        if (!cancelled) setWorktrees(res.worktrees);
      })
      .catch(() => {
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [space?.type, space?.id, selector, refreshNonce]);

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

  // Switch the board's data source to a worktree, carried in the `?wt=` query
  // so it survives a reload while the space route prefix (and thus the space
  // identity, pins, switcher) stays put. Selecting the main checkout (`null`)
  // clears the query back to the default source.
  function selectWorktree(root: string | null) {
    route(root === null ? path : `${path}?wt=${encodeURIComponent(root)}`);
  }

  // The panel renders only for a project space whose repository has more than
  // one worktree (worktree-aware-spaces D4); a single-worktree / non-git / store
  // space shows the board exactly as before.
  const worktreePanel =
    space?.type === 'project' && worktrees.length >= 2 ? (
      <WorktreePanel
        worktrees={worktrees}
        sessions={sessions}
        selectedRoot={selectedWorktree}
        onSelect={selectWorktree}
      />
    ) : null;

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
      <div class="board-page">
        {/* The header stays outside `__empty` so it keeps the shared header
            contract (right-aligned actions, normal tone) instead of inheriting
            the empty state's muted, centered, padded-down presentation (m5). */}
        <PageHeader
          title="Board"
          actions={
            <>
              <button type="button" class="btn--primary" onClick={() => setDialogOpen(true)}>
                New change
              </button>
              <button type="button" class="btn--ghost" onClick={refresh}>
                Refresh
              </button>
            </>
          }
        />
        <div class="board-page__empty">
          {worktreePanel}
          <p>No active changes.</p>
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
    <div
      class={`board-page${refreshing ? ' board-page--refreshing' : ''}`}
      aria-busy={refreshing}
      data-refreshing={refreshing ? 'true' : undefined}
    >
      <PageHeader
        title="Board"
        actions={
          <>
            <button type="button" class="btn--primary" onClick={() => setDialogOpen(true)}>
              New change
            </button>
            <button type="button" class="btn--ghost" onClick={refresh}>
              Refresh
            </button>
          </>
        }
      />
      {space?.type === 'store' && (
        <MemberChips members={storeMembers} selected={selectedMember} onSelect={setSelectedMember} />
      )}
      {worktreePanel}
      {brokenChanges}
      {changes.length > 0 && (
        <div class="board">
          {BOARD_COLUMNS.map((col) => {
            const colEntries = grouped.get(col.id) ?? [];
            // The Done column is bounded (design D5): show only the most recent
            // N (the tail of the existing entry order — no new sort of live
            // data) with an overflow link into the Archive page. Other columns
            // are unaffected.
            if (col.id === 'done' && colEntries.length > DONE_COLUMN_LIMIT) {
              return (
                <BoardColumn
                  key={col.id}
                  label={col.label}
                  entries={colEntries.slice(-DONE_COLUMN_LIMIT)}
                  space={space}
                  footer={
                    space && (
                      <a
                        class="board-column__overflow"
                        data-testid="done-overflow"
                        href={spaceHref(space, 'archive')}
                      >
                        View all in Archive →
                      </a>
                    )
                  }
                />
              );
            }
            return <BoardColumn key={col.id} label={col.label} entries={colEntries} space={space} />;
          })}
        </div>
      )}
      {dialogOpen && (
        <NewChangeDialog space={selector} onCancel={() => setDialogOpen(false)} onCreated={handleChangeCreated} />
      )}
    </div>
  );
}
