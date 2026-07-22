import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import type { ProjectSpaceEntry, SpaceEntry, StoreSpaceEntry } from '../api/types.js';
import { parseSelector, parseSpacePath, spaceHref, spaceSection } from '../store/use-space.js';
import { getRecentSpaces, recordSpaceVisit } from '../store/recent-spaces.js';

/** The header switcher shows at most this many space entries (spaces-ui design D2); "All spaces…" escapes to the full page. */
const SWITCHER_CAP = 8;

/** Sentinel option value routing to the full Spaces page instead of switching space. */
const ALL_SPACES = '__all__';

const PINNED_KEY = 'ui.pinnedSpaces';

/** The `<type>:<id>` selector for a listed space. */
function selectorOf(space: SpaceEntry): string {
  return `${space.type}:${space.id}`;
}

function coercePins(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Assembles the capped, ordered set of spaces the switcher renders (design D2):
 * pinned first (config order), then most-recently-visited, then alphabetical
 * fill — capped at {@link SWITCHER_CAP}. The current space is always included
 * even when it falls outside the cap, so the `<select>`'s selected value always
 * exists.
 */
function buildVisible(spaces: SpaceEntry[], pins: string[], recents: string[], currentSelector?: string): SpaceEntry[] {
  const bySelector = new Map(spaces.map((s) => [selectorOf(s), s]));
  const chosen = new Map<string, SpaceEntry>();

  const add = (sel: string) => {
    const space = bySelector.get(sel);
    if (space && !chosen.has(sel)) chosen.set(sel, space);
  };

  for (const sel of pins) {
    if (chosen.size >= SWITCHER_CAP) break;
    add(sel);
  }
  for (const sel of recents) {
    if (chosen.size >= SWITCHER_CAP) break;
    add(sel);
  }
  const alpha = [...spaces].sort((a, b) => a.name.localeCompare(b.name));
  for (const space of alpha) {
    if (chosen.size >= SWITCHER_CAP) break;
    add(selectorOf(space));
  }

  // The active space is always present, even beyond the cap (selected value must exist).
  if (currentSelector) add(currentSelector);

  return [...chosen.values()];
}

/**
 * Dual-namespace space switcher (spaces-ui design D2), capped for scale. One
 * `GET /api/v1/spaces` fetch plus the `ui.pinnedSpaces` config read feed a
 * bounded list — pinned first, then recent, then alphabetical fill, at most
 * {@link SWITCHER_CAP} — rendered as two type-tagged groups with the current
 * route's space selected, plus a trailing "All spaces…" item that routes to
 * `/spaces` instead of switching. Selecting a space's only effect is navigation
 * (the red line). Recency is recorded client-side on each space visit; it never
 * writes configuration.
 */
export function SpaceSwitcher() {
  const { path, route } = useLocation();
  const space = parseSpacePath(path);
  const section = spaceSection(path);

  const [spaces, setSpaces] = useState<SpaceEntry[] | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.listSpaces(),
      // The pins read is best-effort — deferred into a then so even a missing
      // client method or an older server degrades to "no pins" rather than
      // failing the switcher.
      Promise.resolve()
        .then(() => client.getKey(PINNED_KEY))
        .catch(() => null),
    ])
      .then(([spacesRes, pinsRes]) => {
        if (cancelled) return;
        setSpaces(spacesRes.spaces);
        setPins(coercePins(pinsRes?.entry.value));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Record the current space as a recent visit (design D2). Keyed on the
  // selector so a re-render on the same space does not re-record needlessly.
  useEffect(() => {
    if (space) recordSpaceVisit(space.selector);
  }, [space?.selector]);

  if (spaces === null && !failed) {
    return <div class="space-switcher space-switcher--loading">Loading spaces…</div>;
  }

  if (failed || (spaces && spaces.length === 0)) {
    return (
      <div class="space-switcher space-switcher--empty" data-testid="space-switcher-empty">
        No spaces — run <code>rasen ui</code> inside a Rasen project.
      </div>
    );
  }

  const visible = buildVisible(spaces!, pins, getRecentSpaces(), space?.selector);
  const projects = visible.filter((s): s is ProjectSpaceEntry => s.type === 'project');
  const stores = visible.filter((s): s is StoreSpaceEntry => s.type === 'store');

  function onChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === ALL_SPACES) {
      route('/spaces');
      return;
    }
    const selected = parseSelector(value);
    if (selected) route(spaceHref(selected, section));
  }

  return (
    <div class="space-switcher">
      <label>
        Space
        <select value={space?.selector ?? ''} onChange={onChange} data-testid="space-switcher-select">
          {!space && (
            <option value="" disabled>
              Select a space…
            </option>
          )}
          {projects.length > 0 && (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={`project:${p.id}`} value={`project:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {stores.length > 0 && (
            <optgroup label="Stores">
              {stores.map((s) => (
                <option key={`store:${s.id}`} value={`store:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value={ALL_SPACES} data-testid="space-switcher-all">
            All spaces…
          </option>
        </select>
      </label>
    </div>
  );
}
