// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, listSpaces: vi.fn() };
});

import * as client from '../../src/api/client.js';
import {
  publishSpace,
  refreshSpaceCatalog,
  resetSpaceCatalogForTests,
  useSpaceCatalog,
} from '../../src/store/space-catalog.js';
import type { SpaceEntry } from '../../src/api/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let latestSpaces: SpaceEntry[] | null = null;
let latestError: string | null = null;

function Probe() {
  const catalog = useSpaceCatalog();
  latestSpaces = catalog.spaces;
  latestError = catalog.error?.message ?? null;
  return <output>{catalog.spaces?.map((space) => space.root).join('|') ?? 'none'}</output>;
}

describe('shared space catalog', () => {
  beforeEach(async () => {
    resetSpaceCatalogForTests();
    latestSpaces = null;
    latestError = null;
    const container = document.createElement('div');
    document.body.replaceChildren(container);
    await act(async () => {
      render(<Probe />, container);
    });
  });

  it('publishes by type plus root and preserves same-selector worktree rows', async () => {
    await act(async () => {
      publishSpace({ type: 'project', id: 'shared', name: 'One', root: '/repo/one' });
      publishSpace({ type: 'project', id: 'shared', name: 'Two', root: '/repo/two' });
    });
    expect(latestSpaces?.map((space) => space.root)).toEqual([
      '/repo/one',
      '/repo/two',
    ]);
  });

  it('suppresses a list started before publication', async () => {
    const old = deferred<{ spaces: SpaceEntry[] }>();
    (client.listSpaces as any).mockReturnValueOnce(old.promise);
    const refresh = refreshSpaceCatalog();
    await act(async () => {
      publishSpace({ type: 'store', id: 'new', name: 'New', root: '/new', members: [] });
    });
    old.resolve({ spaces: [] });
    await act(async () => refresh);
    expect(latestSpaces?.map((space) => space.root)).toEqual(['/new']);
  });

  it('allows post-publication authoritative reconciliation', async () => {
    await act(async () => {
      publishSpace({ type: 'store', id: 'new', name: 'New', root: '/new', members: [] });
    });
    (client.listSpaces as any).mockResolvedValueOnce({
      spaces: [{ type: 'project', id: 'authoritative', name: 'A', root: '/a' }],
    });
    await act(async () => refreshSpaceCatalog());
    expect(latestSpaces?.map((space) => space.root)).toEqual(['/a']);
  });

  it('retains a published entry when revalidation fails and later reconciles', async () => {
    await act(async () => {
      publishSpace({ type: 'store', id: 'new', name: 'New', root: '/new', members: [] });
    });
    (client.listSpaces as any).mockRejectedValueOnce(new Error('offline'));
    await act(async () => refreshSpaceCatalog());
    expect(latestSpaces?.map((space) => space.root)).toEqual(['/new']);
    expect(latestError).toBe('status.error.spaces_load');

    (client.listSpaces as any).mockResolvedValueOnce({ spaces: [] });
    await act(async () => refreshSpaceCatalog());
    expect(latestSpaces).toEqual([]);
    expect(latestError).toBeNull();
  });
});
