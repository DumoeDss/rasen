// @vitest-environment jsdom
/**
 * SpacesPage (spaces-ui design D1/D2): the `/spaces` page lists every space with
 * client-side search and config-persisted pinning, and hosts the create-space
 * flow (kind toggle + local-path picker → CLI-backed creation → route into the
 * new space). Dead pins are retained in config but not rendered; the CLI's own
 * error is shown verbatim.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/client.js')>('../../src/api/client.js');
  return {
    ...actual,
    listSpaces: vi.fn(),
    getKey: vi.fn(),
    putKey: vi.fn(),
    listLocalPaths: vi.fn(),
    createSpace: vi.fn(),
  };
});

import { SpacesPage } from '../../src/components/SpacesPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';

const SPACES = {
  spaces: [
    { type: 'project', id: 'proj_a', name: 'Project A', root: '/a' },
    {
      type: 'store',
      id: 'store_x',
      name: 'Store X',
      root: '/x',
      members: [{ projectId: 'm1', name: 'Member One', root: '/m1' }],
    },
  ],
};

// Home advertises no ascent (parent: null) — the server never volunteers a
// location above home (local-path-browsing spec / design D3).
const HOME_LISTING = {
  path: '/home/user',
  parent: null as string | null,
  separator: '/',
  home: true,
  entries: [
    { name: 'a-repo', isDir: true, isGitRepo: true },
    { name: 'plain', isDir: true, isGitRepo: false },
    { name: 'readme.txt', isDir: false, isGitRepo: false },
  ],
};

// A non-home directory reached by navigating INTO a home subdirectory; it has a
// parent, so "Up" is live here (unlike at the home floor).
const SUBDIR_LISTING = {
  path: '/home/user/a-repo',
  parent: '/home/user',
  separator: '/',
  entries: [{ name: 'nested', isDir: true, isGitRepo: false }],
};

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mount(container: HTMLElement, path = '/spaces') {
  window.history.replaceState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <SpacesPage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

async function click(el: Element | null) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('SpacesPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listSpaces as any).mockResolvedValue(SPACES);
    (client.getKey as any).mockResolvedValue({ entry: { value: [] } });
    (client.putKey as any).mockResolvedValue({ entry: {} });
    (client.listLocalPaths as any).mockResolvedValue(HOME_LISTING);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('lists both namespaces with store members inline', async () => {
    await mount(container);
    const rows = container.querySelectorAll('[data-testid="space-row"]');
    const selectors = Array.from(rows).map((r) => r.getAttribute('data-selector'));
    expect(selectors).toContain('project:proj_a');
    expect(selectors).toContain('store:store_x');
    expect(container.querySelector('[data-testid="space-members"]')?.textContent).toContain('Member One');
  });

  it('filters the listing client-side by the search query', async () => {
    await mount(container);
    const search = container.querySelector('[data-testid="spaces-search"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'store';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await flushMicrotasks();
    });
    const selectors = Array.from(container.querySelectorAll('[data-testid="space-row"]')).map((r) =>
      r.getAttribute('data-selector')
    );
    expect(selectors).toEqual(['store:store_x']);
    // No extra network round-trip for search.
    expect((client.listSpaces as any).mock.calls.length).toBe(1);
  });

  it('pins a space, writing the full array and reordering it first', async () => {
    await mount(container);
    const storeRow = container.querySelector('[data-selector="store:store_x"]')!;
    await click(storeRow.querySelector('[data-testid="pin-toggle"]'));

    expect(client.putKey).toHaveBeenCalledWith('ui.pinnedSpaces', {
      scope: 'global',
      value: ['store:store_x'],
    });
    // Pinned rows sort first.
    const firstRow = container.querySelector('[data-testid="space-row"]');
    expect(firstRow?.getAttribute('data-selector')).toBe('store:store_x');
  });

  it('retains a dead pin in writes but does not render it', async () => {
    (client.getKey as any).mockResolvedValue({ entry: { value: ['project:ghost', 'project:proj_a'] } });
    await mount(container);

    const selectors = Array.from(container.querySelectorAll('[data-testid="space-row"]')).map((r) =>
      r.getAttribute('data-selector')
    );
    // The ghost pin matches no listed space — not rendered.
    expect(selectors).not.toContain('project:ghost');
    expect(selectors).toContain('project:proj_a');

    // Pinning another space preserves the dead selector in the written array.
    const storeRow = container.querySelector('[data-selector="store:store_x"]')!;
    await click(storeRow.querySelector('[data-testid="pin-toggle"]'));
    expect(client.putKey).toHaveBeenCalledWith('ui.pinnedSpaces', {
      scope: 'global',
      value: ['project:ghost', 'project:proj_a', 'store:store_x'],
    });
  });

  it('marks git repositories, keeps "Up" disabled at the home floor, and navigates by entry, parent, and typed path', async () => {
    // Distinct listings per path so navigation is observable.
    (client.listLocalPaths as any).mockImplementation((p?: string) => {
      if (!p) return Promise.resolve(HOME_LISTING);
      if (p === '/home/user/a-repo') return Promise.resolve(SUBDIR_LISTING);
      return Promise.resolve({ path: p, parent: '/parent', separator: '/', entries: [] });
    });

    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));

    // Git repos are visibly marked.
    expect(container.querySelector('[data-testid="git-badge"]')).not.toBeNull();

    const upButton = () =>
      Array.from(container.querySelectorAll('.create-space-dialog__pathbar button')).find(
        (b) => b.textContent === 'Up'
      ) as HTMLButtonElement;

    // At the home floor the server advertises no parent and "Up" is disabled —
    // the confinement floor holds; the only ascent is a typed absolute path.
    expect(upButton().disabled).toBe(true);

    // Navigate INTO a home subdirectory by clicking its entry.
    const entry = Array.from(container.querySelectorAll('[data-testid="dir-entries"] button')).find(
      (b) => b.textContent?.includes('a-repo')
    )!;
    await click(entry);
    expect(client.listLocalPaths).toHaveBeenCalledWith('/home/user/a-repo');

    // Now off the home floor, "Up" is live and follows the parent.
    expect(upButton().disabled).toBe(false);
    await click(upButton());
    expect(client.listLocalPaths).toHaveBeenCalledWith('/home/user');

    // A typed absolute path is honored (the sole escape above home).
    const pathInput = container.querySelector('.create-space-dialog__path-input') as HTMLInputElement;
    await act(async () => {
      pathInput.value = '/some/abs/path';
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const goButton = Array.from(container.querySelectorAll('.create-space-dialog__pathbar button')).find(
      (b) => b.textContent === 'Go'
    )!;
    await click(goButton);
    expect(client.listLocalPaths).toHaveBeenCalledWith('/some/abs/path');
  });

  it('creates a space and routes into the new space board', async () => {
    (client.createSpace as any).mockResolvedValue({
      operation: 'init',
      space: { type: 'project', id: 'newproj', name: 'New', root: '/new' },
    });
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));

    const submit = container.querySelector('.create-space-dialog__actions button[type="submit"]');
    await click(submit);

    expect(client.createSpace).toHaveBeenCalledWith({ kind: 'project', path: '/home/user' });
    expect(window.location.pathname).toBe('/p/newproj/board');
  });

  it('shows the CLI error verbatim on a failed creation', async () => {
    (client.createSpace as any).mockRejectedValue(
      new ApiError(422, { error: { code: 'cli_error', message: 'the CLI refused: pointer repo' } })
    );
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));

    const submit = container.querySelector('.create-space-dialog__actions button[type="submit"]');
    await click(submit);

    expect(container.querySelector('[data-testid="create-error"]')?.textContent).toContain(
      'the CLI refused: pointer repo'
    );
    // Stayed on the page — no navigation on failure.
    expect(window.location.pathname).toBe('/spaces');
  });
});
