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

export type SpaceType = 'project' | 'store';

export interface Space {
  type: SpaceType;
  /** The opaque canonical id, decoded from the route param (design D5). */
  id: string;
  /** The `<type>:<id>` selector every space-scoped API call is built from. */
  selector: string;
}

/** Sections a space switch preserves; anything else (e.g. task detail) falls back to the board. */
const SWITCHABLE_SECTIONS = new Set(['board', 'config', 'archive', 'pipelines']);

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

/** The current section (`board` | `config` | `archive`) from a space path, defaulting to `board`. */
export function spaceSection(path: string | undefined): string {
  const section = segmentsOf(path)[2];
  return section && SWITCHABLE_SECTIONS.has(section) ? section : 'board';
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

/** The canonical board route for a launch `?space=<selector>`, or `null` when the selector is malformed. */
export function spaceRouteFromSelector(selector: string): string | null {
  const space = parseSelector(selector);
  return space ? spaceHref(space, 'board') : null;
}

/** The active planning space, derived from the current URL. `null` on `/` and the empty state. */
export function useSpace(): Space | null {
  const { path } = useLocation();
  return parseSpacePath(path);
}
