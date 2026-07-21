import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  ArchivedChangeSummary,
  SessionListEntry,
  SpaceEntry,
  SpaceMember,
} from '../api/types.js';
import { groupArchivedTasks, tasksForMember, type ArchivedTask } from '../board/columns.js';
import { MemberChips } from './MemberChips.js';
import { spaceHref, useSpace } from '../store/use-space.js';

/**
 * The Archive page (ui-space-redesign-archive-page design D4). Behind the
 * existing `/…/archive` routes, it lists the current space's archived changes
 * grouped into Tasks (portfolio containers collapse; a container-less change is
 * its own single-item Task) in reverse-chronological order, most recently
 * archived first. A name search filters the fetched list client-side (the
 * corpus is small); in a store space a member-chip filter narrows by the same
 * session-provenance model the board uses. Each row links to the Task's detail
 * page, which serves archived-only Tasks (child 4). Every read is scoped to the
 * URL's opaque-token space. Loading / error / empty are distinct explicit
 * states, mirroring BoardPage / TaskDetailPage.
 */
export function ArchivePage() {
  const space = useSpace();
  const selector = space?.selector;
  const [changes, setChanges] = useState<ArchivedChangeSummary[] | null>(null);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [query, setQuery] = useState('');
  // The selected member chip (a member's projectId), or null for the "All"
  // rollup. Reset on every space change so a stale member never carries across.
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setSelectedMember(null);
    setQuery('');
    // Sessions are fetched for member-provenance attribution (design D4); an
    // archived Task with no live session degrades to "All" — the documented
    // ceiling, not a bug.
    Promise.all([client.listArchive(selector), client.listSessions(selector)])
      .then(([archiveRes, sessionsRes]) => {
        if (cancelled) return;
        setChanges(archiveRes.changes);
        setSessions(sessionsRes.sessions);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load the archive.' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, selector]);

  // Member chips are store-only chrome (design D4). Fetch the spaces listing
  // best-effort — a failure just leaves the chip row empty rather than failing
  // the page, and a project space never needs it.
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
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p class="archive-page__loading">Loading archive…</p>;
  }

  if (pageError) {
    return (
      <div class="archive-page__error">
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
      <div class="archive-page__empty" data-testid="archive-empty">
        <h2>Archive</h2>
        <p>No archived changes in this space yet.</p>
      </div>
    );
  }

  // Group → time-reverse by archive date (design D4). Dates are `YYYY-MM-DD`,
  // so a string compare is a chronological compare.
  const allTasks = groupArchivedTasks(changes).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));

  // Member chips render only for a store space (design D4). The current store's
  // members come from the spaces listing, matched by opaque id.
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

  const memberFiltered = tasksForMember(allTasks, sessions, memberRoot);
  const needle = query.trim().toLowerCase();
  const tasks: ArchivedTask[] = needle
    ? memberFiltered.filter((t) => t.name.toLowerCase().includes(needle))
    : memberFiltered;

  return (
    <div class="archive-page" data-testid="archive-page">
      <div class="archive-page__toolbar">
        <input
          type="search"
          class="archive-page__search"
          placeholder="Search by name…"
          aria-label="Search archived Tasks by name"
          data-testid="archive-search"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {space?.type === 'store' && (
        <MemberChips members={storeMembers} selected={selectedMember} onSelect={setSelectedMember} />
      )}
      {tasks.length === 0 ? (
        <p class="archive-page__no-matches" data-testid="archive-no-matches">
          No archived Tasks match the current filter.
        </p>
      ) : (
        <ul class="archive-page__list" data-testid="archive-list">
          {tasks.map((task) => (
            <li key={task.id} class="archive-page__item">
              <a
                class="archive-task"
                data-testid="archive-task"
                data-task={task.id}
                href={space ? spaceHref(space, 'task', task.id) : '/'}
              >
                <span class="archive-task__name">{task.name}</span>
                <span class="archive-task__kind">{task.kind === 'portfolio' ? 'Portfolio' : 'Change'}</span>
                <span class="archive-task__date">archived {task.archivedAt}</span>
                {task.kind === 'portfolio' && (
                  <span class="archive-task__count">
                    {task.children.length} change{task.children.length === 1 ? '' : 's'}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
