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
    resolveLocalPath: vi.fn(),
    chooseLocalPath: vi.fn(),
    createSpace: vi.fn(),
  };
});

import { SpacesPage } from '../../src/components/SpacesPage.js';
import { CreateSpaceDialog } from '../../src/components/CreateSpaceDialog.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import {
  __resetLocaleForTesting,
  setLocale,
} from '../../src/i18n/store.js';
import {
  publishSpace,
  refreshSpaceCatalog,
  resetSpaceCatalogForTests,
} from '../../src/store/space-catalog.js';

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
    __resetLocaleForTesting();
    resetSpaceCatalogForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listSpaces as any).mockResolvedValue(SPACES);
    (client.getKey as any).mockResolvedValue({ entry: { value: [] } });
    (client.putKey as any).mockResolvedValue({ entry: {} });
    (client.listLocalPaths as any).mockResolvedValue(HOME_LISTING);
    (client.resolveLocalPath as any).mockImplementation(async (candidate: string, kind: string) => ({
      path: candidate,
      kind: kind === 'file' ? 'file' : 'directory',
      separator: '/',
    }));
    (client.chooseLocalPath as any).mockResolvedValue({ status: 'unavailable', reason: 'headless' });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    __resetLocaleForTesting();
    window.history.replaceState({}, '', '/');
  });

  it('lists both namespaces with store members inline', async () => {
    await mount(container);
    const rows = container.querySelectorAll('[data-testid="space-row"]');
    const selectors = Array.from(rows).map((r) => r.getAttribute('data-selector'));
    expect(selectors).toContain('project:proj_a');
    expect(selectors).toContain('store:store_x');
    expect(container.querySelector('[data-testid="space-members"]')?.textContent).toContain('Member One');
    expect(container.querySelector('[data-selector="project:proj_a"] .space-row__link')?.getAttribute('href')).toBe(
      '/p/proj_a/board'
    );
    expect(container.querySelector('[data-selector="store:store_x"] .space-row__link')?.getAttribute('href')).toBe(
      '/s/store_x/issues'
    );
  });

  it('shows a worktree badge on a multi-worktree project and none otherwise (spaces-ui spec)', async () => {
    (client.listSpaces as any).mockResolvedValue({
      spaces: [
        { type: 'project', id: 'multi', name: 'Multi', root: '/multi', worktreeCount: 3 },
        { type: 'project', id: 'single', name: 'Single', root: '/single', worktreeCount: 1 },
        { type: 'project', id: 'plain', name: 'Plain', root: '/plain' },
      ],
    });

    await mount(container);

    const badge = container.querySelector('[data-selector="project:multi"] [data-testid="worktree-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('3 worktrees');
    // A single-worktree count or an absent count shows no badge.
    expect(container.querySelector('[data-selector="project:single"] [data-testid="worktree-badge"]')).toBeNull();
    expect(container.querySelector('[data-selector="project:plain"] [data-testid="worktree-badge"]')).toBeNull();
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

    // The default English picker contract remains unchanged for Spaces.
    const picker = container.querySelector('[data-testid="path-picker"]') as HTMLElement;
    const pathInput = container.querySelector('.create-space-dialog__path-input') as HTMLInputElement;
    expect(picker.querySelector('[data-testid="choose-directory"]')?.textContent).toBe('Choose directory');
    expect(pathInput.getAttribute('aria-label')).toBe('Server-local path');
    expect(pathInput.getAttribute('placeholder')).toBe('Type an absolute server-local path');
    expect(picker.querySelector('[data-testid="path-resolved"]')?.textContent?.trim()).toBe('resolved');
    expect(container.querySelector('[data-testid="git-badge"]')?.textContent).toBe('git');

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
    await act(async () => {
      pathInput.value = '/some/abs/path';
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const goButton = Array.from(container.querySelectorAll('.create-space-dialog__pathbar button')).find(
      (b) => b.textContent === 'Go'
    )!;
    await click(goButton);
    expect(client.resolveLocalPath).toHaveBeenCalledWith('/some/abs/path', 'directory');
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

    expect(client.createSpace).toHaveBeenCalledWith({ op: 'create-project', path: '/home/user' });
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

  it('keeps a published row visible with a non-blocking retry when revalidation fails', async () => {
    publishSpace({
      type: 'store',
      id: 'just-created',
      name: 'Just Created',
      root: '/stores/just-created',
      members: [],
    });
    (client.listSpaces as any).mockRejectedValueOnce(
      new ApiError(503, {
        error: { code: 'temporarily_unavailable', message: 'refresh failed' },
      })
    );
    await refreshSpaceCatalog();

    await mount(container);

    const retained = container.querySelector('[data-selector="store:just-created"]');
    expect(retained).not.toBeNull();
    expect(retained?.textContent).toContain('Just Created');
    const banner = container.querySelector('[data-testid="spaces-refresh-error"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('refresh failed');
    expect(banner?.querySelector('button')?.textContent).toContain('Retry');
  });

  it('does not let a list request started before publication erase the new Store', async () => {
    let resolveOld!: (value: typeof SPACES) => void;
    (client.listSpaces as any).mockReturnValueOnce(
      new Promise<typeof SPACES>((resolve) => {
        resolveOld = resolve;
      })
    );
    await mount(container);

    await act(async () => {
      publishSpace({
        type: 'store',
        id: 'published-late',
        name: 'Published Late',
        root: '/stores/published-late',
        members: [],
      });
      resolveOld(SPACES);
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-selector="store:published-late"]')).not.toBeNull();
  });

  it('creates a Store explicitly from parent plus required id', async () => {
    (client.createSpace as any).mockResolvedValue({
      operation: 'store-setup',
      space: { type: 'store', id: 'team-store', name: 'Team', root: '/home/user/team-store', members: [] },
    });
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));
    const createMode = Array.from(
      container.querySelectorAll('.create-space-dialog__kind-btn')
    ).find((button) => button.textContent === 'Create new Store');
    await click(createMode ?? null);
    await act(async () => {
      const input = container.querySelector('input[name="storeId"]') as HTMLInputElement;
      input.value = 'team-store';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="derived-store-root"]')?.textContent).toContain(
      '/home/user/team-store'
    );
    await click(container.querySelector('.create-space-dialog__actions button[type="submit"]'));
    expect(client.createSpace).toHaveBeenCalledWith({
      op: 'create-store',
      parent: '/home/user',
      id: 'team-store',
    });
    expect(window.location.pathname).toBe('/s/team-store/issues');
  });

  it('keeps all three operations in the standalone Spaces-page dialog', async () => {
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));
    expect(container.querySelectorAll('.create-space-dialog__kind-btn')).toHaveLength(3);
    expect(container.querySelector('[data-testid="space-operation-chooser"]')).not.toBeNull();
  });

  it('fixes the controlled dialog to Store creation and hands fresh success back without navigation', async () => {
    const result = {
      operation: 'store-setup' as const,
      space: {
        type: 'store' as const,
        id: 'controlled-store',
        name: 'Controlled',
        root: '/home/user/controlled-store',
        members: [],
      },
    };
    (client.createSpace as any).mockResolvedValue(result);
    const onSuccess = vi.fn();
    window.history.replaceState({}, '', '/p/proj_a/issues');
    await act(async () => {
      render(
        <LocationProvider>
          <CreateSpaceDialog
            fixedOperation="create-store"
            onCancel={() => {}}
            onSuccess={onSuccess}
          />
        </LocationProvider>,
        container
      );
      await flushMicrotasks();
    });
    await act(async () => {
      const input = container.querySelector('input[name="storeId"]') as HTMLInputElement;
      input.value = 'controlled-store';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-testid="space-operation-chooser"]')).toBeNull();
    expect(container.querySelectorAll('.create-space-dialog__kind-btn')).toHaveLength(0);
    await click(container.querySelector('.create-space-dialog__actions button[type="submit"]'));

    expect(client.createSpace).toHaveBeenCalledWith({
      op: 'create-store',
      parent: '/home/user',
      id: 'controlled-store',
    });
    expect(onSuccess).toHaveBeenCalledWith(result);
    expect(window.location.pathname).toBe('/p/proj_a/issues');
    expect(client.listSpaces).toHaveBeenCalled();
  });

  it('localizes fixed Store creation and picker copy in Japanese, including Store-id validation', async () => {
    setLocale('ja');
    window.history.replaceState({}, '', '/p/proj_a/issues');
    await act(async () => {
      render(
        <LocationProvider>
          <CreateSpaceDialog
            fixedOperation="create-store"
            onCancel={() => {}}
            onSuccess={() => {}}
          />
        </LocationProvider>,
        container
      );
      await flushMicrotasks();
    });

    const dialog = container.querySelector('.create-space-dialog') as HTMLFormElement;
    expect(dialog.getAttribute('aria-label')).toBe('スペースを作成');
    expect(dialog.textContent).toContain('新しいStoreの親ディレクトリを選択してください。');
    expect(container.querySelector('[data-testid="current-path"]')?.textContent).toContain('親ディレクトリ');
    expect(container.querySelector('.create-space-dialog__field span')?.textContent).toBe('ストアID');
    expect(container.querySelector('.create-space-dialog__actions .btn--ghost')?.textContent).toBe('キャンセル');
    expect(container.querySelector('.create-space-dialog__actions .btn--primary')?.textContent).toBe('Storeを作成');

    const picker = container.querySelector('[data-testid="path-picker"]') as HTMLElement;
    const pathInput = picker.querySelector('input') as HTMLInputElement;
    const pickerButtons = Array.from(picker.querySelectorAll('.create-space-dialog__pathbar button'));
    expect(picker.querySelector('[data-testid="choose-directory"]')?.textContent).toBe('ディレクトリを選択');
    expect(pathInput.getAttribute('aria-label')).toBe('サーバー上のローカルパス');
    expect(pathInput.getAttribute('placeholder')).toBe('サーバー上の絶対ローカルパスを入力');
    expect(pickerButtons.map((button) => button.textContent)).toEqual(['移動', '上へ']);
    expect(picker.querySelector('[data-testid="path-resolved"]')?.textContent?.trim()).toBe('解決済み');
    expect(picker.textContent).not.toContain('Choose directory');
    expect(picker.textContent).not.toContain('Native choice unavailable');

    (client.chooseLocalPath as any).mockResolvedValueOnce({ status: 'cancelled' });
    await click(picker.querySelector('[data-testid="choose-directory"]'));
    expect(picker.querySelector('[data-testid="chooser-fallback"]')?.textContent).toBe(
      '選択をキャンセルしました。現在のパスは保持されています。'
    );
    await click(picker.querySelector('[data-testid="choose-directory"]'));
    expect(picker.querySelector('[data-testid="chooser-fallback"]')?.textContent).toBe(
      'ネイティブ選択を使用できません。下のサーバーブラウザーを使用してください。'
    );

    await act(async () => {
      dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="create-error"]')?.textContent).toBe('ストアIDは必須です。');
  });

  it('localizes fixed Store creation and picker copy in Simplified Chinese without English fallback', async () => {
    setLocale('zh-cn');
    window.history.replaceState({}, '', '/p/proj_a/issues');
    await act(async () => {
      render(
        <LocationProvider>
          <CreateSpaceDialog
            fixedOperation="create-store"
            onCancel={() => {}}
            onSuccess={() => {}}
          />
        </LocationProvider>,
        container
      );
      await flushMicrotasks();
    });

    const dialog = container.querySelector('.create-space-dialog') as HTMLFormElement;
    expect(dialog.getAttribute('aria-label')).toBe('创建空间');
    expect(dialog.textContent).toContain('请选择新 Store 的父目录。');
    expect(container.querySelector('[data-testid="current-path"]')?.textContent).toContain('父目录');
    expect(container.querySelector('.create-space-dialog__field span')?.textContent).toBe('Store ID');
    expect(container.querySelector('.create-space-dialog__actions .btn--ghost')?.textContent).toBe('取消');
    expect(container.querySelector('.create-space-dialog__actions .btn--primary')?.textContent).toBe('创建 Store');

    const picker = container.querySelector('[data-testid="path-picker"]') as HTMLElement;
    const pathInput = picker.querySelector('input') as HTMLInputElement;
    const pickerButtons = Array.from(picker.querySelectorAll('.create-space-dialog__pathbar button'));
    expect(picker.querySelector('[data-testid="choose-directory"]')?.textContent).toBe('选择目录');
    expect(pathInput.getAttribute('aria-label')).toBe('服务器本地路径');
    expect(pathInput.getAttribute('placeholder')).toBe('输入服务器上的绝对本地路径');
    expect(pickerButtons.map((button) => button.textContent)).toEqual(['前往', '上一级']);
    expect(picker.querySelector('[data-testid="path-resolved"]')?.textContent?.trim()).toBe('已解析');
    expect(picker.textContent).not.toContain('Choose directory');
    expect(picker.textContent).not.toContain('Native choice unavailable');

    await click(picker.querySelector('[data-testid="choose-directory"]'));
    expect(picker.querySelector('[data-testid="chooser-fallback"]')?.textContent).toBe(
      '无法使用系统选择器；请使用下方的服务器浏览器。'
    );
  });

  it('registers an existing Store and routes to its Issue Board', async () => {
    (client.createSpace as any).mockResolvedValue({
      operation: 'store-register',
      space: { type: 'store', id: 'registered-store', name: 'Registered', root: '/home/user', members: [] },
    });
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));
    const registerMode = Array.from(
      container.querySelectorAll('.create-space-dialog__kind-btn')
    ).find((button) => button.textContent === 'Register existing Store');
    await click(registerMode ?? null);
    await click(container.querySelector('.create-space-dialog__actions button[type="submit"]'));

    expect(client.createSpace).toHaveBeenCalledWith({ op: 'register-store', path: '/home/user' });
    expect(window.location.pathname).toBe('/s/registered-store/issues');
  });

  it('registers an existing Store explicitly and preserves a CLI refusal verbatim', async () => {
    (client.createSpace as any).mockRejectedValue(
      new ApiError(422, {
        error: { code: 'cli_error', message: 'existing Store is unhealthy' },
      })
    );
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));
    const registerMode = Array.from(
      container.querySelectorAll('.create-space-dialog__kind-btn')
    ).find((button) => button.textContent === 'Register existing Store');
    await click(registerMode ?? null);
    await click(container.querySelector('.create-space-dialog__actions button[type="submit"]'));
    expect(client.createSpace).toHaveBeenCalledWith({
      op: 'register-store',
      path: '/home/user',
    });
    expect(container.querySelector('[data-testid="create-error"]')?.textContent).toContain(
      'existing Store is unhealthy'
    );
  });

  it('presents a derived new-Store root with Windows-native separators', async () => {
    (client.listLocalPaths as any).mockResolvedValue({
      ...HOME_LISTING,
      path: 'D:\\stores',
      separator: '\\',
    });
    await mount(container);
    await click(container.querySelector('[data-testid="new-space"]'));
    const createMode = Array.from(
      container.querySelectorAll('.create-space-dialog__kind-btn')
    ).find((button) => button.textContent === 'Create new Store');
    await click(createMode ?? null);
    await act(async () => {
      const input = container.querySelector('input[name="storeId"]') as HTMLInputElement;
      input.value = 'team-store';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="derived-store-root"]')?.textContent).toContain(
      'D:\\stores\\team-store'
    );
  });

  it('keeps every worktree row when spaces share a selector — no collapse on re-render or search (MAJOR-1)', async () => {
    // Git worktrees of one repo share a projectId → one selector, many roots.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const DUP = {
      spaces: [
        { type: 'project', id: 'shared', name: 'Worktree Alpha', root: '/repo/alpha' },
        { type: 'project', id: 'shared', name: 'Worktree Beta', root: '/repo/beta' },
        { type: 'project', id: 'other', name: 'Other', root: '/other' },
      ],
    };
    (client.listSpaces as any).mockResolvedValue(DUP);
    await mount(container);

    const rowNames = () =>
      Array.from(container.querySelectorAll('[data-testid="space-row"] .space-row__name')).map(
        (n) => n.textContent
      );

    // All three rows present on mount (two share a selector).
    expect(container.querySelectorAll('[data-testid="space-row"]').length).toBe(3);

    // Re-render via PIN: pinning one worktree pins the shared selector (both
    // worktree rows light their star — acceptable), and BOTH rows must survive.
    const alphaRow = Array.from(container.querySelectorAll('[data-testid="space-row"]')).find((r) =>
      r.textContent?.includes('Worktree Alpha')
    )!;
    await click(alphaRow.querySelector('[data-testid="pin-toggle"]'));
    expect(container.querySelectorAll('[data-testid="space-row"]').length).toBe(3); // no collapse
    expect(rowNames()).toEqual(expect.arrayContaining(['Worktree Alpha', 'Worktree Beta', 'Other']));

    // Re-render via SEARCH: both worktree matches appear, not just one.
    const search = container.querySelector('[data-testid="spaces-search"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'worktree';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await flushMicrotasks();
    });
    const matches = rowNames();
    expect(matches.length).toBe(2);
    expect(matches).toEqual(expect.arrayContaining(['Worktree Alpha', 'Worktree Beta']));

    // No preact duplicate-key warning was emitted during the re-renders.
    const dupKeyWarning = consoleErrorSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && /same key/i.test(a))
    );
    expect(dupKeyWarning).toBe(false);
    consoleErrorSpy.mockRestore();
  });
});
