/**
 * Route-derived space helpers (management-ui-shell design D2/D5): the pure
 * parse/build functions that carry the opaque-token discipline. The
 * round-trip test is the compiler-uncheckable invariant made executable —
 * an id with mixed case / separators must survive route → selector → API
 * query byte-for-byte, with no client-side canonicalization (D5).
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalizeSpaceSelectors,
  isPipelineCanvasPath,
  parseSelector,
  parseSpacePath,
  spaceEntryForSelector,
  spaceEntryMatchesSelector,
  spaceFromEntry,
  spaceHref,
  spaceHomeHref,
  spaceSelectorOfEntry,
  spaceRouteFromSelector,
  spaceSection,
  spaceSwitchHref,
} from '../../src/store/use-space.js';
import type { SpaceEntry } from '../../src/api/types.js';

const PROJECT = { type: 'project' as const, id: 'Proj:A b', selector: 'project:Proj:A b' };
const STORE = { type: 'store' as const, id: 'Store:B/c', selector: 'store:Store:B/c' };
const IDENTIFIED_STORE: SpaceEntry = {
  type: 'store',
  id: '研发计划.v2',
  uid: '11111111-2222-4333-8444-555555555555',
  name: '研发计划.v2',
  root: '/stores/研发计划.v2',
  members: [],
};

describe('catalog identity bridging', () => {
  it('uses a Store uid for new selectors and routes while retaining the alias as display data', () => {
    expect(spaceSelectorOfEntry(IDENTIFIED_STORE)).toBe(
      'store:11111111-2222-4333-8444-555555555555'
    );
    expect(spaceHomeHref(spaceFromEntry(IDENTIFIED_STORE))).toBe(
      '/s/11111111-2222-4333-8444-555555555555/issues'
    );
    expect(IDENTIFIED_STORE.id).toBe('研发计划.v2');
  });

  it('resolves legacy alias selectors and canonicalizes known pins to the uid', () => {
    expect(spaceEntryMatchesSelector(IDENTIFIED_STORE, 'store:研发计划.v2')).toBe(true);
    expect(spaceEntryForSelector([IDENTIFIED_STORE], 'store:研发计划.v2')).toBe(
      IDENTIFIED_STORE
    );
    expect(
      canonicalizeSpaceSelectors(
        ['store:研发计划.v2', 'project:dead'],
        [IDENTIFIED_STORE]
      )
    ).toEqual(['store:11111111-2222-4333-8444-555555555555', 'project:dead']);
  });

  it('does not guess when one legacy alias names multiple permanent Stores', () => {
    const duplicate: SpaceEntry = {
      ...IDENTIFIED_STORE,
      uid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      root: '/stores/other',
    };
    expect(
      spaceEntryForSelector([IDENTIFIED_STORE, duplicate], 'store:研发计划.v2')
    ).toBeNull();
    expect(
      canonicalizeSpaceSelectors(
        ['store:研发计划.v2'],
        [IDENTIFIED_STORE, duplicate]
      )
    ).toEqual(['store:研发计划.v2']);
  });

  it('treats a UUID-shaped Store selector as identity, never as a display alias', () => {
    const uid = IDENTIFIED_STORE.uid!;
    const aliasCollision: SpaceEntry = {
      type: 'store',
      id: uid,
      uid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      name: uid,
      root: '/stores/uuid-shaped-alias',
      members: [],
    };

    expect(spaceEntryForSelector([aliasCollision, IDENTIFIED_STORE], `store:${uid}`)).toBe(
      IDENTIFIED_STORE
    );
    expect(spaceEntryMatchesSelector(aliasCollision, `store:${uid}`)).toBe(false);
  });
});

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
  it('maps a launch selector to the namespace-aware home, encoding the id for path safety', () => {
    expect(spaceRouteFromSelector('project:proj_x')).toBe('/p/proj_x/board');
    expect(spaceRouteFromSelector('store:my-store')).toBe('/s/my-store/issues');
    expect(spaceRouteFromSelector('project:a b')).toBe('/p/a%20b/board');
    expect(spaceRouteFromSelector('store:a:b')).toBe('/s/a%3Ab/issues');
  });

  it('returns null for a malformed selector', () => {
    expect(spaceRouteFromSelector('no-prefix')).toBeNull();
    expect(spaceRouteFromSelector('unknown:x')).toBeNull();
  });
});

describe('canonical homes and switch matrix', () => {
  it('uses Board for projects and Issues for Stores while preserving opaque ids', () => {
    expect(spaceHomeHref(PROJECT)).toBe('/p/Proj%3AA%20b/board');
    expect(spaceHomeHref(STORE)).toBe('/s/Store%3AB%2Fc/issues');
  });

  it.each(['config', 'archive', 'pipelines'])('preserves common %s across namespaces', (section) => {
    expect(spaceSwitchHref(`/p/source/${section}`, STORE)).toBe(`/s/Store%3AB%2Fc/${section}`);
    expect(spaceSwitchHref(`/s/source/${section}`, PROJECT)).toBe(`/p/Proj%3AA%20b/${section}`);
  });

  it.each(['issues', 'operations', 'unlinked-changes'])(
    'preserves Store-only %s only for a Store destination',
    (section) => {
      expect(spaceSwitchHref(`/s/source/${section}`, STORE)).toBe(`/s/Store%3AB%2Fc/${section}`);
      expect(spaceSwitchHref(`/s/source/${section}`, PROJECT)).toBe('/p/Proj%3AA%20b/board');
    }
  );

  it('treats Project Issues as transitional when switching spaces', () => {
    expect(spaceSwitchHref('/p/source/issues', STORE)).toBe('/s/Store%3AB%2Fc/issues');
    expect(spaceSwitchHref('/p/source/issues', PROJECT)).toBe('/p/Proj%3AA%20b/board');
  });

  it('falls back to the destination home for Board, Task Detail, and unknown sections', () => {
    expect(spaceSwitchHref('/p/source/board', STORE)).toBe('/s/Store%3AB%2Fc/issues');
    expect(spaceSwitchHref('/s/source/task/change', PROJECT)).toBe('/p/Proj%3AA%20b/board');
    expect(spaceSwitchHref('/s/source/unknown', STORE)).toBe('/s/Store%3AB%2Fc/issues');
  });
});
