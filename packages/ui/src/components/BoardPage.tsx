import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { ChangeRunEntry, ChangeSummary } from '../api/types.js';
import { BOARD_COLUMNS, deriveColumn, type BoardColumn as BoardColumnId } from '../board/columns.js';
import { BoardColumn, type BoardColumnEntry } from './BoardColumn.js';

/**
 * The board page (design.md D7/D8 of `rasen-ui-slice1-readonly-api`): one
 * `listChanges` + `listRuns` call renders the whole board, grouped into
 * lifecycle columns by the pure `deriveColumn` function. Never shows
 * placeholder/fabricated changes (board-ui spec) — loading/error/empty are
 * distinct explicit states.
 */
export function BoardPage() {
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null);
  const [runs, setRuns] = useState<ChangeRunEntry[]>([]);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    Promise.all([client.listChanges(), client.listRuns()])
      .then(([changesRes, runsRes]) => {
        if (cancelled) return;
        setChanges(changesRes.changes);
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
  }, [refreshNonce]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p>Loading board…</p>;
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

  if (!changes || changes.length === 0) {
    return (
      <div class="board-page__empty">
        <p>No active changes.</p>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
    );
  }

  const runsByName = new Map(runs.map((r) => [r.name, r]));
  const grouped = new Map<BoardColumnId, BoardColumnEntry[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
  for (const change of changes) {
    const { column, escalated } = deriveColumn(change, runsByName.get(change.name));
    grouped.get(column)!.push({ change, escalated });
  }

  return (
    <div class="board-page">
      <div class="board-page__toolbar">
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      <div class="board">
        {BOARD_COLUMNS.map((col) => (
          <BoardColumn key={col.id} label={col.label} entries={grouped.get(col.id) ?? []} />
        ))}
      </div>
    </div>
  );
}
