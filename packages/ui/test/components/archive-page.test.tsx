// @vitest-environment jsdom
/**
 * Component-level coverage for ArchivePage (ui-space-redesign-archive-page
 * spec): reverse-chronological grouped listing, client-side name search, the
 * store-only member-chip filter (session provenance), the explicit empty
 * state, and Task-detail links built from the opaque space token. The
 * `satisfies ArchiveResponse` fixture it imports is the `tsc` drift tripwire.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listArchive: vi.fn(),
    listSessions: vi.fn(),
    listSpaces: vi.fn(),
  };
});

import { LocationProvider } from 'preact-iso';
import { ArchivePage } from '../../src/components/ArchivePage.js';
import * as client from '../../src/api/client.js';
import { archiveFixture } from '../fixtures/archive.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAtSpace(container: HTMLElement, path: string): Promise<void> {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <ArchivePage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function setSearch(container: HTMLElement, value: string) {
  const input = container.querySelector('[data-testid="archive-search"]') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ArchivePage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listSessions as any).mockResolvedValue({ sessions: [] });
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    window.history.pushState({}, '', '/');
    vi.resetAllMocks();
  });

  it('lists grouped archived Tasks most-recently-archived first', async () => {
    (client.listArchive as any).mockResolvedValue(archiveFixture);
    await mountAtSpace(container, '/p/proj_x/archive');

    const rows = Array.from(container.querySelectorAll('[data-testid="archive-task"]'));
    // ui-redesign-api + ui-redesign-shell collapse into one `ui-redesign` Task
    // (max date 2026-02-15); sorted time-reverse against tidy-logs (03-10) and
    // fix-login (01-20).
    expect(rows.map((r) => r.getAttribute('data-task'))).toEqual(['tidy-logs', 'ui-redesign', 'fix-login']);
    // The archive read carried the route's opaque space selector.
    expect(client.listArchive).toHaveBeenCalledWith('project:proj_x');
  });

  it('filters the list by name via the search control', async () => {
    (client.listArchive as any).mockResolvedValue(archiveFixture);
    await mountAtSpace(container, '/p/proj_x/archive');

    await act(async () => {
      setSearch(container, 'fix');
      await flushMicrotasks();
    });

    const rows = Array.from(container.querySelectorAll('[data-testid="archive-task"]'));
    expect(rows.map((r) => r.getAttribute('data-task'))).toEqual(['fix-login']);
  });

  it('links each archived Task to its detail route, built from the opaque space token', async () => {
    (client.listArchive as any).mockResolvedValue(archiveFixture);
    await mountAtSpace(container, '/p/proj_x/archive');

    const portfolio = Array.from(container.querySelectorAll('[data-testid="archive-task"]')).find(
      (r) => r.getAttribute('data-task') === 'ui-redesign'
    )!;
    expect(portfolio.getAttribute('href')).toBe('/p/proj_x/task/ui-redesign');
  });

  it('shows an explicit empty state when the space has no archived changes', async () => {
    (client.listArchive as any).mockResolvedValue({ changes: [] });
    await mountAtSpace(container, '/p/proj_x/archive');

    expect(container.querySelector('[data-testid="archive-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="archive-list"]')).toBeNull();
  });

  it('renders no member chips in a project space', async () => {
    (client.listArchive as any).mockResolvedValue(archiveFixture);
    await mountAtSpace(container, '/p/proj_x/archive');

    expect(container.querySelector('[data-testid="member-chips"]')).toBeNull();
    expect(client.listSpaces).not.toHaveBeenCalled();
  });

  it('filters by member via session provenance in a store space', async () => {
    (client.listArchive as any).mockResolvedValue(archiveFixture);
    (client.listSessions as any).mockResolvedValue({
      sessions: [
        {
          session: {
            id: 's1',
            kind: 'auto',
            task: 'work',
            cwd: '/a/repo/sub',
            state: 'exited',
            startedAt: 0,
            lastOutputAt: 0,
            changeName: 'ui-redesign-api', // a child of the ui-redesign archived Task
          },
          runState: { kind: 'absent' },
        },
      ],
    });
    (client.listSpaces as any).mockResolvedValue({
      spaces: [
        {
          type: 'store',
          id: 'store_x',
          name: 'Store X',
          root: '/x',
          members: [
            { projectId: 'proj_a', name: 'Repo A', root: '/a/repo' },
            { projectId: 'proj_b', name: 'Repo B', root: '/b/repo' },
          ],
        },
      ],
    });

    await mountAtSpace(container, '/s/store_x/archive');

    // All chip + one per member.
    const chips = Array.from(container.querySelectorAll('.member-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['All', 'Repo A', 'Repo B']);

    // Select Repo A → only the ui-redesign Task (its child ran under /a/repo) survives.
    const repoA = chips.find((c) => c.textContent === 'Repo A') as HTMLButtonElement;
    await act(async () => {
      repoA.click();
      await flushMicrotasks();
    });
    const rows = Array.from(container.querySelectorAll('[data-testid="archive-task"]'));
    expect(rows.map((r) => r.getAttribute('data-task'))).toEqual(['ui-redesign']);
  });
});
