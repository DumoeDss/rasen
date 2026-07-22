// @vitest-environment jsdom
/**
 * SpaceBootstrap (management-ui-shell design D1): the `/` bootstrap resolves a
 * planning space and redirects to its canonical route. Covers the resolution
 * chain (launch `?space=` query → health launch project → first space → empty
 * state) and the load-bearing token-scrub / bootstrap ordering — `token.ts`
 * scrubs `#token=` but preserves `location.search`, so the launch URL's
 * `?space=` reaches the bootstrap, which then replaces it with a clean route.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', () => ({
  health: vi.fn(),
  listSpaces: vi.fn(),
}));

import { SpaceBootstrap } from '../../src/components/SpaceBootstrap.js';
import * as client from '../../src/api/client.js';
import { getToken, initTokenFromLocation, resetTokenStateForTest } from '../../src/api/token.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mountAt(container: HTMLElement, url: string) {
  window.history.replaceState({}, '', url);
  await act(async () => {
    render(
      <LocationProvider>
        <SpaceBootstrap />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('SpaceBootstrap', () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetTokenStateForTest();
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.health as any).mockResolvedValue({ ok: true, version: '0', project: null });
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('redirects a project launch query to the canonical project board route, dropping the query', async () => {
    await mountAt(container, '/?space=project:proj_x');
    expect(window.location.pathname).toBe('/p/proj_x/board');
    expect(window.location.search).toBe('');
    // Resolved from the query alone — no server round-trip needed.
    expect(client.health).not.toHaveBeenCalled();
  });

  it('redirects a store launch query to a store board route', async () => {
    await mountAt(container, '/?space=store:my-store');
    expect(window.location.pathname).toBe('/s/my-store/board');
  });

  it('lands on the space board with the token retained after token scrubbing (bootstrap ordering)', async () => {
    // The launch URL rasen ui prints: query before fragment.
    window.history.replaceState({}, '', '/?space=project:proj_x#token=abc123');
    // Token handling runs first (main.tsx order): scrubs the fragment but
    // preserves location.search.
    initTokenFromLocation();
    expect(getToken()).toBe('abc123');
    expect(window.location.search).toBe('?space=project:proj_x');
    expect(window.location.hash).toBe('');

    await act(async () => {
      render(
        <LocationProvider>
          <SpaceBootstrap />
        </LocationProvider>,
        container
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(window.location.pathname).toBe('/p/proj_x/board');
    expect(window.location.search).toBe('');
    expect(getToken()).toBe('abc123'); // still in memory
  });

  it('falls back to the health launch project when there is no space query', async () => {
    (client.health as any).mockResolvedValue({
      ok: true,
      version: '0',
      project: { projectId: 'proj_launch', name: 'launch', root: '/launch' },
    });
    await mountAt(container, '/');
    expect(window.location.pathname).toBe('/p/proj_launch/board');
  });

  it('falls back to the first space when health reports no launch project', async () => {
    (client.health as any).mockResolvedValue({ ok: true, version: '0', project: null });
    (client.listSpaces as any).mockResolvedValue({
      spaces: [{ type: 'store', id: 'store_first', name: 'store_first', root: '/s', members: [] }],
    });
    await mountAt(container, '/');
    expect(window.location.pathname).toBe('/s/store_first/board');
  });

  it('shows an explicit empty state when nothing resolves, not a blank page or spinner', async () => {
    (client.health as any).mockResolvedValue({ ok: true, version: '0', project: null });
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
    await mountAt(container, '/');
    expect(container.querySelector('[data-testid="no-space-empty-state"]')).not.toBeNull();
    expect(container.textContent).toContain('run');
    expect(container.textContent).toContain('rasen ui');
    expect(window.location.pathname).toBe('/'); // no redirect happened
  });
});
