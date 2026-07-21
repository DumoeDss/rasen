// @vitest-environment jsdom
/**
 * Coverage for the app shell's space-scoped routing (management-ui-shell /
 * board-ui specs): the URL is the source of truth for the selected planning
 * space. `/p/:id/board` and `/s/:id/board` render the board; `/p/:id/config`
 * renders config; a bare space root redirects to the board; the nav offers
 * Board · Archive · Config within the current space (no Sessions); `/` and any
 * unknown path (e.g. the retired `/sessions`) bootstrap and redirect rather
 * than dead-ending.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/BoardPage.js', () => ({
  BoardPage: () => <div data-testid="board-page">board</div>,
}));
vi.mock('../src/components/ConfigPage.js', () => ({
  ConfigPage: () => <div data-testid="config-page">config</div>,
}));
vi.mock('../src/components/SpaceSwitcher.js', () => ({
  SpaceSwitcher: () => <div data-testid="space-switcher" />,
}));
vi.mock('../src/components/RunningSessionsMenu.js', () => ({
  RunningSessionsMenu: () => <div data-testid="running-sessions-menu" />,
}));
vi.mock('../src/api/token.js', () => ({
  hasToken: () => true,
  isUnauthorized: () => false,
  onUnauthorized: () => () => {},
}));
vi.mock('../src/api/client.js', () => ({
  health: vi.fn(),
  listSpaces: vi.fn(),
}));

import { App } from '../src/app.js';
import * as client from '../src/api/client.js';

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mountAt(container: HTMLElement, path: string) {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(<App />, container);
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('App routing', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.health as any).mockResolvedValue({ ok: true, version: '0', project: null });
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('renders the board at a project space board route', async () => {
    await mountAt(container, '/p/proj_x/board');
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
  });

  it('renders the board at a store space board route', async () => {
    await mountAt(container, '/s/store_y/board');
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
  });

  it('renders the config page at a project space config route', async () => {
    await mountAt(container, '/p/proj_x/config');
    expect(container.querySelector('[data-testid="config-page"]')).not.toBeNull();
  });

  it('redirects a bare space root to that space board', async () => {
    await mountAt(container, '/p/proj_x');
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/p/proj_x/board');
  });

  it('offers Board · Archive · Config nav within the space, with the active view indicated and no Sessions entry', async () => {
    await mountAt(container, '/p/proj_x/config');
    const boardLink = container.querySelector('nav a[href="/p/proj_x/board"]');
    const archiveLink = container.querySelector('nav a[href="/p/proj_x/archive"]');
    const configLink = container.querySelector('nav a[href="/p/proj_x/config"]');
    expect(boardLink).not.toBeNull();
    expect(archiveLink).not.toBeNull();
    expect(configLink).not.toBeNull();
    expect(configLink!.getAttribute('aria-current')).toBe('page');
    expect(boardLink!.getAttribute('aria-current')).toBeNull();
    // No top-level Sessions surface.
    const sessionsLink = Array.from(container.querySelectorAll('nav a')).find(
      (a) => a.textContent === 'Sessions'
    );
    expect(sessionsLink).toBeUndefined();
  });

  it('navigates from config to board via the nav link without a full reload', async () => {
    await mountAt(container, '/p/proj_x/config');
    expect(container.querySelector('[data-testid="config-page"]')).not.toBeNull();

    const boardLink = container.querySelector('nav a[href="/p/proj_x/board"]') as HTMLAnchorElement;
    await act(async () => {
      boardLink.click();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="config-page"]')).toBeNull();
  });

  it('renders the archive placeholder route', async () => {
    await mountAt(container, '/p/proj_x/archive');
    expect(container.querySelector('[data-testid="archive-placeholder"]')).not.toBeNull();
  });

  it('renders the task-detail placeholder route', async () => {
    await mountAt(container, '/p/proj_x/task/my-change');
    expect(container.querySelector('[data-testid="task-detail-placeholder"]')).not.toBeNull();
    expect(container.textContent).toContain('my-change');
  });

  it('the retired /sessions path is not a dead route — it bootstraps and redirects to a resolved space', async () => {
    (client.health as any).mockResolvedValue({
      ok: true,
      version: '0',
      project: { projectId: 'proj_x', name: 'x', root: '/x' },
    });
    await mountAt(container, '/sessions');
    // Falls through to the default SpaceBootstrap, which resolves the launch
    // project and lands on its board — never a SessionsPage.
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/p/proj_x/board');
  });
});
