/**
 * Route-derived planning space (management-ui-shell design D2/D5). The URL is
 * the single source of truth for the selected space, replacing the retired
 * in-memory pub-sub project store: `/p/<projectId>/…` is a project space,
 * `/s/<storeId>/…` a store space. The id after the namespace prefix is an
 * OPAQUE canonical token (design D5) — parsed out verbatim, never normalized,
 * re-cased, or path-canonicalized — so it round-trips unchanged from the
 * launch query into the route and back into every API selector.
 *
 * These helpers are pure so both the components and their tests can exercise
 * the opaque-token round-trip without mounting a router. `useSpace()` derives
 * the space from `useLocation()` (which works anywhere under a
 * `LocationProvider`, including the header — outside `<Router>` — where
 * `useRoute()` params are not available).
 */
import { useLocation } from 'preact-iso';
import type { SpaceEntry } from '../api/types.js';

export type SpaceType = 'project' | 'store';

export interface Space {
  type: SpaceType;
  /** The opaque canonical id, decoded from the route param (design D5). */
  id: string;
  /** The `<type>:<id>` selector every space-scoped API call is built from. */
  selector: string;
}

// Mirrors the core Store identity boundary: any RFC 4122 textual UUID shape
// is an identity selector and must never fall through to the alias index.
const STORE_UID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** True when a route token is shaped as a permanent Store identity. */
export function isStoreUid(value: string): boolean {
  return STORE_UID_PATTERN.test(value.trim());
}

/** Canonical route/API id for a listing entry: Store uid when available. */
export function spaceIdOfEntry(entry: SpaceEntry): string {
  return entry.type === 'store' ? entry.uid ?? entry.id : entry.id;
}

/** Canonical `<type>:<id>` selector for a listing entry. */
export function spaceSelectorOfEntry(entry: SpaceEntry): string {
  return `${entry.type}:${spaceIdOfEntry(entry)}`;
}

/** Converts one catalog entry into the route-derived Space shape. */
export function spaceFromEntry(entry: SpaceEntry): Space {
  const id = spaceIdOfEntry(entry);
  return { type: entry.type, id, selector: `${entry.type}:${id}` };
}

/** Builds a Store Space from any wire reference carrying alias + optional uid. */
export function storeSpaceFromRef(ref: { id: string; uid?: string }): Space {
  const id = ref.uid ?? ref.id;
  return { type: 'store', id, selector: `store:${id}` };
}

/**
 * Matches both the canonical selector and a legacy Store-alias selector.
 * Alias comparison stays exact; permanent identities are case-insensitive.
 */
export function spaceEntryMatchesSelector(
  entry: SpaceEntry,
  selector: string | Space | null | undefined
): boolean {
  const selected = typeof selector === 'string' ? parseSelector(selector) : selector;
  if (!selected || selected.type !== entry.type) return false;
  if (entry.type === 'project') return selected.id === entry.id;
  if (isStoreUid(selected.id)) {
    return entry.uid !== undefined
      && selected.id.trim().toLowerCase() === entry.uid.trim().toLowerCase();
  }
  return selected.id === entry.id;
}

/**
 * Resolves a catalog selector without guessing between Stores that share an
 * alias. Project worktree rows may share one canonical selector and are safe.
 */
export function spaceEntryForSelector(
  entries: SpaceEntry[],
  selector: string | Space | null | undefined
): SpaceEntry | null {
  const matches = entries.filter((entry) => spaceEntryMatchesSelector(entry, selector));
  if (matches.length === 0) return null;
  return new Set(matches.map(spaceSelectorOfEntry)).size === 1 ? matches[0]! : null;
}

/**
 * Migrates selectors for known entries to their canonical uid form while
 * retaining dead or ambiguous legacy selectors byte-for-byte.
 */
export function canonicalizeSpaceSelectors(
  selectors: string[],
  entries: SpaceEntry[]
): string[] {
  const output: string[] = [];
  for (const selector of selectors) {
    const entry = spaceEntryForSelector(entries, selector);
    const canonical = entry ? spaceSelectorOfEntry(entry) : selector;
    if (!output.includes(canonical)) output.push(canonical);
  }
  return output;
}

/** Common sections that remain valid across either planning-space namespace. */
const SWITCHABLE_SECTIONS = new Set(['config', 'archive', 'pipelines']);

/** Store-owned sections that survive only a Store-to-Store switch. */
const STORE_ONLY_SECTIONS = new Set(['issues', 'operations', 'unlinked-changes']);

const URL_PREFIX: Record<SpaceType, string> = { project: 'p', store: 's' };

function segmentsOf(path: string | undefined): string[] {
  return path ? path.split('/').filter(Boolean) : [];
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Parses a `/p/<id>/…` or `/s/<id>/…` path into a {@link Space}, or `null`
 * when the path is not space-prefixed (only `/` and the bootstrap empty
 * state). The id segment is decoded once (the inverse of the bootstrap's
 * `encodeURIComponent`) and used verbatim — no other transformation.
 */
export function parseSpacePath(path: string | undefined): Space | null {
  const segments = segmentsOf(path);
  const prefix = segments[0];
  const type: SpaceType | null = prefix === 'p' ? 'project' : prefix === 's' ? 'store' : null;
  if (!type) return null;
  const rawId = segments[1];
  if (!rawId) return null;
  const id = decode(rawId);
  return { type, id, selector: `${type}:${id}` };
}

/** The current common section from a space path, defaulting to `board`. */
export function spaceSection(path: string | undefined): string {
  const section = segmentsOf(path)[2];
  return section && (section === 'board' || SWITCHABLE_SECTIONS.has(section)) ? section : 'board';
}

/**
 * Whether the path addresses a single pipeline's canvas route — a space-prefixed
 * `pipelines/<name>` (view or edit), NOT the `pipelines` list page. The canvas
 * route is viewport-locked (pipelines-ui spec); every other route scrolls
 * normally, so this is the single predicate the shell uses to apply the lock.
 * Pure cross-platform string logic (route segments only, never a filesystem
 * path) so it is unit-testable without a router.
 */
export function isPipelineCanvasPath(path: string | undefined): boolean {
  const segments = segmentsOf(path);
  const prefix = segments[0];
  if (prefix !== 'p' && prefix !== 's') return false;
  return segments[2] === 'pipelines' && Boolean(segments[3]);
}

/**
 * Builds a space-scoped route: `/p/<id>/<section>` or `/s/<id>/<section>`,
 * with an optional trailing sub-segment (e.g. a task's change name). The id
 * and sub-segment are `encodeURIComponent`-guarded for path safety only —
 * the opaque token is preserved, just percent-escaped where a route segment
 * requires it (design D5).
 */
export function spaceHref(space: Space, section: string, sub?: string): string {
  const base = `/${URL_PREFIX[space.type]}/${encodeURIComponent(space.id)}/${section}`;
  return sub === undefined ? base : `${base}/${encodeURIComponent(sub)}`;
}

/** The namespace-aware canonical home for a planning space. */
export function spaceHomeHref(space: Space): string {
  return spaceHref(space, space.type === 'store' ? 'issues' : 'board');
}

/**
 * Re-scopes a route to a destination space without manufacturing invalid
 * cross-namespace mirrors. Common sections survive every switch; Store-only
 * sections survive Store-to-Store; every other path falls back to the
 * destination's canonical home.
 */
export function spaceSwitchHref(path: string | undefined, destination: Space): string {
  const section = segmentsOf(path)[2];
  if (section && SWITCHABLE_SECTIONS.has(section)) {
    return spaceHref(destination, section);
  }
  if (destination.type === 'store' && section && STORE_ONLY_SECTIONS.has(section)) {
    return spaceHref(destination, section);
  }
  return spaceHomeHref(destination);
}

/** Parses a `<type>:<id>` selector back into a {@link Space}, splitting on the first colon only (the id may itself contain colons). */
export function parseSelector(selector: string): Space | null {
  const idx = selector.indexOf(':');
  if (idx < 0) return null;
  const prefix = selector.slice(0, idx);
  const id = selector.slice(idx + 1);
  if (!id) return null;
  if (prefix === 'project' || prefix === 'store') {
    return { type: prefix, id, selector };
  }
  return null;
}

/** The canonical home route for a launch `?space=<selector>`, or `null` when the selector is malformed. */
export function spaceRouteFromSelector(selector: string): string | null {
  const space = parseSelector(selector);
  return space ? spaceHomeHref(space) : null;
}

/** The active planning space, derived from the current URL. `null` on `/` and the empty state. */
export function useSpace(): Space | null {
  const { path } = useLocation();
  return parseSpacePath(path);
}
