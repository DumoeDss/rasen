import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { ProjectSpaceEntry, SpaceEntry, StoreSpaceEntry } from '../api/types.js';
import { parseSpacePath, spaceHref, type Space } from '../store/use-space.js';
import { useLocation } from 'preact-iso';
import { CreateSpaceDialog } from './CreateSpaceDialog.js';

const PINNED_KEY = 'ui.pinnedSpaces';

/** The `<type>:<id>` selector for a listed space. */
function selectorOf(space: SpaceEntry): string {
  return `${space.type}:${space.id}`;
}

/** Coerces the `ui.pinnedSpaces` config value into a string[]; anything else → []. */
function coercePins(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function matchesQuery(space: SpaceEntry, needle: string): boolean {
  if (!needle) return true;
  return (
    space.id.toLowerCase().includes(needle) ||
    space.name.toLowerCase().includes(needle) ||
    space.root.toLowerCase().includes(needle)
  );
}

/** A Space (for spaceHref) built from a listed entry — the opaque id used verbatim. */
function spaceOf(entry: SpaceEntry): Space {
  return { type: entry.type, id: entry.id, selector: selectorOf(entry) };
}

/**
 * The Spaces page (spaces-ui design D1/D2). A space-agnostic `/spaces` route
 * listing every addressable planning space from `GET /api/v1/spaces`, with
 * client-side search (id/name/root), pinning persisted in the `ui.pinnedSpaces`
 * global config key, pinned-first ordering, and a create-space flow that lands
 * in the new space. Any space is reachable in two interactions (search-and-click
 * or a pin). A pinned selector that matches no listed space is retained in
 * configuration but not rendered. Reuses the frozen warm-editorial classes; no
 * new visual language.
 */
export function SpacesPage() {
  const { path: currentPath } = useLocation();
  const [spaces, setSpaces] = useState<SpaceEntry[] | null>(null);
  // The FULL pinned-selector array as stored in config, including selectors
  // that match no listed space — those are preserved across writes (a pin to a
  // temporarily-unplugged store must survive), just not rendered.
  const [pins, setPins] = useState<string[]>([]);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    // The pins key read is best-effort: an older server without the key still
    // yields an empty/absent value, and the page must render the listing anyway.
    Promise.all([client.listSpaces(), client.getKey(PINNED_KEY).catch(() => null)])
      .then(([spacesRes, pinsRes]) => {
        if (cancelled) return;
        setSpaces(spacesRes.spaces);
        setPins(coercePins(pinsRes?.entry.value));
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load spaces.' });
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

  async function togglePin(selector: string) {
    const isPinned = pins.includes(selector);
    const next = isPinned ? pins.filter((s) => s !== selector) : [...pins, selector];
    const previous = pins;
    // Optimistic: reorder immediately, revert on write failure.
    setPins(next);
    setPinError(null);
    try {
      await client.putKey(PINNED_KEY, { scope: 'global', value: next });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setPins(previous);
      setPinError(err instanceof ApiError ? err.message : 'Failed to update pins.');
    }
  }

  if (loading) {
    return <p class="spaces-page__loading">Loading spaces…</p>;
  }

  if (pageError) {
    return (
      <div class="spaces-page__error">
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

  const needle = query.trim().toLowerCase();
  const all = spaces ?? [];
  const pinnedSet = new Set(pins);
  const pinRank = new Map(pins.map((sel, i) => [sel, i] as const));

  // Order: pinned first (config order), then non-pinned projects A-Z, then
  // non-pinned stores A-Z. Grouping is BY SELECTOR (for the pin flag and pin
  // order), but rows are never collapsed: several entries can share one
  // selector — git worktrees of one repo share a projectId — and each is kept
  // as its own row (MAJOR-1). The stable sort preserves listing order among
  // same-selector pinned rows. Rows are keyed by the row-unique `root` below,
  // never by the selector, so a re-render (pin/search) cannot merge them.
  const filtered = all.filter((s) => matchesQuery(s, needle));
  const pinnedRows = filtered
    .filter((s) => pinnedSet.has(selectorOf(s)))
    .sort((a, b) => (pinRank.get(selectorOf(a)) ?? 0) - (pinRank.get(selectorOf(b)) ?? 0));
  const projectsRest = filtered
    .filter((s): s is ProjectSpaceEntry => s.type === 'project' && !pinnedSet.has(selectorOf(s)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const storesRest = filtered
    .filter((s): s is StoreSpaceEntry => s.type === 'store' && !pinnedSet.has(selectorOf(s)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ordered: SpaceEntry[] = [...pinnedRows, ...projectsRest, ...storesRest];

  const activeSpace = parseSpacePath(currentPath);

  return (
    <div class="spaces-page" data-testid="spaces-page">
      <div class="spaces-page__toolbar">
        <input
          type="search"
          class="spaces-page__search"
          placeholder="Search by id, name, or path…"
          aria-label="Search spaces"
          data-testid="spaces-search"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button type="button" onClick={() => setCreating(true)} data-testid="new-space">
          New space
        </button>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>

      {pinError && (
        <p class="spaces-page__pin-error" role="alert">
          {pinError}
        </p>
      )}

      {all.length === 0 ? (
        <div class="spaces-page__empty" data-testid="spaces-empty">
          <p>No spaces yet — create one to get started.</p>
        </div>
      ) : ordered.length === 0 ? (
        <p class="spaces-page__no-matches" data-testid="spaces-no-matches">
          No spaces match the current search.
        </p>
      ) : (
        <ul class="spaces-page__list" data-testid="spaces-list">
          {ordered.map((space) => {
            const selector = selectorOf(space);
            const pinned = pinnedSet.has(selector);
            const isActive = activeSpace?.selector === selector;
            // Key by the row-unique root, NEVER the selector: git worktrees of
            // one repo share a selector, and a selector key collapses them into
            // one row on any re-render (MAJOR-1). Pin/active state stay
            // selector-derived (a shared pin lights every worktree row of that
            // project — acceptable, they share the pin).
            return (
              <li key={space.root} class="space-row" data-testid="space-row" data-selector={selector}>
                <a
                  class={`space-row__link${isActive ? ' space-row__link--active' : ''}`}
                  href={spaceHref(spaceOf(space), 'board')}
                >
                  <span class="space-row__name">{space.name}</span>
                  <span class="space-row__type">{space.type === 'store' ? 'Store' : 'Project'}</span>
                  <span class="space-row__root">{space.root}</span>
                  {space.type === 'store' && space.members.length > 0 && (
                    <span class="space-row__members" data-testid="space-members">
                      {space.members.map((m) => (
                        <span key={m.projectId} class="space-row__member-chip">
                          {m.name}
                        </span>
                      ))}
                    </span>
                  )}
                </a>
                <button
                  type="button"
                  class={`space-row__pin${pinned ? ' space-row__pin--pinned' : ''}`}
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${space.name}` : `Pin ${space.name}`}
                  data-testid="pin-toggle"
                  onClick={() => togglePin(selector)}
                >
                  {pinned ? '★' : '☆'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <CreateSpaceDialog onCancel={() => setCreating(false)} />}
    </div>
  );
}
