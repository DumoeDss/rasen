// @vitest-environment jsdom
/**
 * Coverage for the app shell's routing (design D4 of
 * `rasen-ui-unify-management-surface`, board-ui spec): the board is the
 * platform home at `/`, `/board` is a still-valid alias, `/config` renders
 * the config page, and the nav lets the user move between them without a
 * full reload.
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
vi.mock('../src/components/ProjectSwitcher.js', () => ({
  ProjectSwitcher: () => <div data-testid="project-switcher" />,
}));
vi.mock('../src/api/token.js', () => ({
  hasToken: () => true,
  isUnauthorized: () => false,
  onUnauthorized: () => () => {},
}));

import { App } from '../src/app.js';

async function flushMicrotasks(times = 4): Promise<void> {
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
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('renders the board at the root route (platform home)', async () => {
    await mountAt(container, '/');
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
  });

  it('renders the board at the /board alias', async () => {
    await mountAt(container, '/board');
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
  });

  it('renders the config page at /config', async () => {
    await mountAt(container, '/config');
    expect(container.querySelector('[data-testid="config-page"]')).not.toBeNull();
  });

  it('offers Board and Config nav entries with the active view indicated', async () => {
    await mountAt(container, '/config');
    const boardLink = container.querySelector('nav a[href="/"]');
    const configLink = container.querySelector('nav a[href="/config"]');
    expect(boardLink).not.toBeNull();
    expect(configLink).not.toBeNull();
    expect(configLink!.getAttribute('aria-current')).toBe('page');
    expect(boardLink!.getAttribute('aria-current')).toBeNull();
  });

  it('navigates from config to board via the nav link without a full reload', async () => {
    await mountAt(container, '/config');
    expect(container.querySelector('[data-testid="config-page"]')).not.toBeNull();

    const boardLink = container.querySelector('nav a[href="/"]') as HTMLAnchorElement;
    await act(async () => {
      boardLink.click();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="config-page"]')).toBeNull();
  });
});
