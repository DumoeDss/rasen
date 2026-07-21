import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { ChangeLoadError, ChangeRunEntry, ChangeSummary } from '../api/types.js';
import { BOARD_COLUMNS, deriveColumn, type BoardColumn as BoardColumnId } from '../board/columns.js';
import { BoardColumn, type BoardColumnEntry } from './BoardColumn.js';
import { NewChangeDialog } from './NewChangeDialog.js';
import { useSpace } from '../store/use-space.js';

/**
 * The board page (design.md D7/D8 of `rasen-ui-slice1-readonly-api`;
 * management-ui-shell design D6): one `listChanges` + `listRuns` call renders
 * the whole board, scoped to the current route's planning space, grouped into
 * lifecycle columns by the pure `deriveColumn` function. Never shows
 * placeholder/fabricated changes (board-ui spec) — loading/error/empty are
 * distinct explicit states. The board's former live-sessions corner link has
 * moved to the header running-run summary (design D4).
 */
export function BoardPage() {
  const selector = useSpace()?.selector;
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<ChangeLoadError[]>([]);
  const [runs, setRuns] = useState<ChangeRunEntry[]>([]);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [highlightedName, setHighlightedName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    Promise.all([client.listChanges(selector), client.listRuns(selector)])
      .then(([changesRes, runsRes]) => {
        if (cancelled) return;
        setChanges(changesRes.changes);
        // `@atelierai/rasen-ui` is published/resolved independently of the
        // CLI (design.md D1 of `unified-config-ui-pkg`) — a UI build newer
        // than the serving CLI could be talking to a server that predates
        // the `errors[]` field (review round 2 N2). Fall back to `[]`
        // rather than crashing the whole board on `undefined.length`.
        setLoadErrors(changesRes.errors ?? []);
        setRuns(runsRes.runs);
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
          <NewChangeDialog onCancel={() => setDialogOpen(false)} onCreated={handleChangeCreated} />
        )}
      </div>
    );
  }

  const runsByName = new Map(runs.map((r) => [r.name, r]));
  const grouped = new Map<BoardColumnId, BoardColumnEntry[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
  for (const change of changes) {
    const { column, escalated } = deriveColumn(change, runsByName.get(change.name));
    grouped.get(column)!.push({ change, escalated, highlighted: change.name === highlightedName });
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
      {brokenChanges}
      {changes.length > 0 && (
        <div class="board">
          {BOARD_COLUMNS.map((col) => (
            <BoardColumn key={col.id} label={col.label} entries={grouped.get(col.id) ?? []} />
          ))}
        </div>
      )}
      {dialogOpen && (
        <NewChangeDialog onCancel={() => setDialogOpen(false)} onCreated={handleChangeCreated} />
      )}
    </div>
  );
}
