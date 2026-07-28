/**
 * Route-derived space helpers (management-ui-shell design D2/D5): the pure
 * parse/build functions that carry the opaque-token discipline. The
 * round-trip test is the compiler-uncheckable invariant made executable —
 * an id with mixed case / separators must survive route → selector → API
 * query byte-for-byte, with no client-side canonicalization (D5).
 */
import { describe, expect, it } from 'vitest';
import {
  isPipelineCanvasPath,
  parseSelector,
  parseSpacePath,
  spaceHref,
  spaceRouteFromSelector,
  spaceSection,
} from '../../src/store/use-space.js';

describe('parseSpacePath', () => {
  it('parses a project space route', () => {
    expect(parseSpacePath('/p/proj_abc123/board')).toEqual({
      type: 'project',
      id: 'proj_abc123',
      selector: 'project:proj_abc123',
    });
  });

  it('parses a store space route', () => {
    expect(parseSpacePath('/s/my-store/config')).toEqual({
      type: 'store',
      id: 'my-store',
      selector: 'store:my-store',
    });
  });

  it('returns null for a non-space path', () => {
    expect(parseSpacePath('/')).toBeNull();
    expect(parseSpacePath(undefined)).toBeNull();
    expect(parseSpacePath('/p')).toBeNull(); // prefix without an id
  });

  it('decodes the id segment once (the inverse of the bootstrap encode) without further normalization', () => {
    // encodeURIComponent('a b/c') === 'a%20b%2Fc'
    const space = parseSpacePath('/p/a%20b%2Fc/board');
    expect(space?.id).toBe('a b/c');
  });
});

describe('spaceSection', () => {
  it('reads the section, defaulting to board', () => {
    expect(spaceSection('/p/x/config')).toBe('config');
    expect(spaceSection('/s/x/archive')).toBe('archive');
    expect(spaceSection('/p/x/board')).toBe('board');
    expect(spaceSection('/p/x')).toBe('board'); // space root
  });

  it('falls back to board for a non-switchable section (e.g. task detail)', () => {
    expect(spaceSection('/p/x/task/some-change')).toBe('board');
  });
});

describe('opaque-token round-trip (design D5)', () => {
  it('an id differing from a normalized form only by case/separators survives route → selector → query unchanged', () => {
    const rawId = 'Proj_Mixed-Case.v2';
    const route = spaceHref({ type: 'project', id: rawId, selector: `project:${rawId}` }, 'board');
    // The route segment is percent-safe but the token is otherwise verbatim.
    expect(route).toBe(`/p/${encodeURIComponent(rawId)}/board`);

    const parsed = parseSpacePath(route);
    expect(parsed?.id).toBe(rawId); // byte-for-byte, no lowercasing/canonicalization
    expect(parsed?.selector).toBe(`project:${rawId}`);

    // The selector re-derived from the route feeds the API query unchanged.
    const reparsed = parseSelector(parsed!.selector);
    expect(reparsed).toEqual({ type: 'project', id: rawId, selector: `project:${rawId}` });
  });

  it('parseSelector splits on the first colon only, preserving colons inside the id', () => {
    expect(parseSelector('store:a:b:c')).toEqual({
      type: 'store',
      id: 'a:b:c',
      selector: 'store:a:b:c',
    });
    expect(parseSelector('bogus')).toBeNull();
    expect(parseSelector('project:')).toBeNull();
  });
});

describe('isPipelineCanvasPath', () => {
  it('is true for a space-prefixed pipeline canvas route (with a name segment)', () => {
    expect(isPipelineCanvasPath('/p/proj_x/pipelines/small-feature')).toBe(true);
    expect(isPipelineCanvasPath('/s/my-store/pipelines/my-flow')).toBe(true);
  });

  it('is false for the pipelines list page (no name segment)', () => {
    expect(isPipelineCanvasPath('/p/proj_x/pipelines')).toBe(false);
    expect(isPipelineCanvasPath('/s/my-store/pipelines/')).toBe(false);
  });

  it('is false for any non-pipeline or non-space route', () => {
    expect(isPipelineCanvasPath('/p/proj_x/board')).toBe(false);
    expect(isPipelineCanvasPath('/p/proj_x/config')).toBe(false);
    expect(isPipelineCanvasPath('/workflows')).toBe(false);
    expect(isPipelineCanvasPath('/')).toBe(false);
    expect(isPipelineCanvasPath(undefined)).toBe(false);
  });

  it('tolerates an encoded name segment', () => {
    expect(isPipelineCanvasPath('/p/proj_x/pipelines/a%20b')).toBe(true);
  });
});

describe('spaceRouteFromSelector', () => {
  it('maps a launch selector to the canonical board route, encoding the id for path safety', () => {
    expect(spaceRouteFromSelector('project:proj_x')).toBe('/p/proj_x/board');
    expect(spaceRouteFromSelector('store:my-store')).toBe('/s/my-store/board');
    expect(spaceRouteFromSelector('project:a b')).toBe('/p/a%20b/board');
  });

  it('returns null for a malformed selector', () => {
    expect(spaceRouteFromSelector('no-prefix')).toBeNull();
    expect(spaceRouteFromSelector('unknown:x')).toBeNull();
  });
});
