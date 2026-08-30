// @vitest-environment jsdom
/**
 * Coverage for the app shell's space-scoped routing (management-ui-shell /
 * board-ui specs): the URL is the source of truth for the selected planning
 * space. Project Board/Task routes remain project-owned, while Store roots and
 * legacy Board/Task routes replace-redirect to Issues/Operations. `/p/:id/config`
 * renders config; the nav is type-aware (no duplicate Sessions surface); `/` and any
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
vi.mock('../src/components/ArchivePage.js', () => ({
  ArchivePage: () => <div data-testid="archive-page">archive</div>,
}));
vi.mock('../src/components/TaskDetailPage.js', async () => {
  const { useRoute } = await import('preact-iso');
  return {
    TaskDetailPage: () => {
      const { params } = useRoute();
      return <div data-testid="task-detail-page">{params.changeName}</div>;
    },
  };
});
vi.mock('../src/components/SpacesPage.js', () => ({
  SpacesPage: () => <div data-testid="spaces-page">spaces</div>,
}));
vi.mock('../src/components/IssueBoardPage.js', () => ({
  IssueBoardPage: () => <div data-testid="issue-board-page">issues</div>,
}));
vi.mock('../src/components/IssueDetailPage.js', async () => {
  const { useRoute } = await import('preact-iso');
  return {
    IssueDetailPage: () => {
      const { params } = useRoute();
      return <div data-testid="issue-detail-page">{params.issueId}</div>;
    },
  };
});
vi.mock('../src/components/OperationsPage.js', () => ({
  OperationsPage: () => <div data-testid="operations-page">operations</div>,
}));
vi.mock('../src/components/UnlinkedChangesPage.js', () => ({
  UnlinkedChangesPage: () => <div data-testid="unlinked-changes-page">unlinked</div>,
}));
vi.mock('../src/components/AuditPage.js', () => ({
  AuditPage: () => <div data-testid="audit-page">audit</div>,
}));
vi.mock('../src/components/SpaceSwitcher.js', () => ({
  SpaceSwitcher: () => <div data-testid="space-switcher" />,
}));
const authState = vi.hoisted(() => ({ unauthorized: false }));
vi.mock('../src/api/token.js', () => ({
  isUnauthorized: () => authState.unauthorized,
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
    authState.unauthorized = false;
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

  it('renders the Rasen mark immediately before the navigation title', async () => {
    await mountAt(container, '/p/proj_x/board');
    const brand = container.querySelector('.app-brand');
    const mark = brand?.querySelector('.app-brand__mark');
    const title = brand?.querySelector('h1');
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(title?.textContent).toBe('Rasen');
    expect(mark?.nextElementSibling).toBe(title);
  });

  it('replace-redirects a legacy Store Board URL to Issues without mounting the project Board', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    await mountAt(container, '/s/store_y/board');
    expect(window.location.pathname).toBe('/s/store_y/issues');
    expect(container.querySelector('[data-testid="issue-board-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board-page"]')).toBeNull();
    expect(replaceSpy).toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('renders the config page at a project space config route', async () => {
    await mountAt(container, '/p/proj_x/config');
    expect(container.querySelector('[data-testid="config-page"]')).not.toBeNull();
  });

  it('renders through the cookie-authenticated browser session when no fragment token exists', async () => {
    await mountAt(container, '/p/proj_x/config');
    expect(container.querySelector('[data-testid="config-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="relaunch-notice"]')).toBeNull();
  });

  it('redirects a bare project root to its Board', async () => {
    await mountAt(container, '/p/proj_x');
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
    expect(window.location.pathname).toBe('/p/proj_x/board');
  });

  it('replace-redirects a bare Store root to its Issue Board', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    await mountAt(container, '/s/store_y');
    expect(window.location.pathname).toBe('/s/store_y/issues');
    expect(container.querySelector('[data-testid="issue-board-page"]')).not.toBeNull();
    expect(replaceSpy).toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('keeps the space-scoped nav on the space-agnostic /workflows route via the recent-space fallback', async () => {
    // Visiting a space records it as recent; the agnostic route then falls
    // back to it so the user is never stranded on /workflows.
    localStorage.setItem('rasen.recentSpaces', JSON.stringify(['project:proj_x']));
    try {
      await mountAt(container, '/workflows');
      expect(container.querySelector('nav a[href="/p/proj_x/board"]')).not.toBeNull();
      expect(container.querySelector('nav a[href="/p/proj_x/config"]')).not.toBeNull();
      expect(container.querySelector('nav a[href="/p/proj_x/pipelines"]')).not.toBeNull();
      const workflowsLink = container.querySelector('nav a[href="/workflows"]');
      expect(workflowsLink!.getAttribute('aria-current')).toBe('page');
      // The recent-space entries stay rendered/reachable but none is the
      // current route, so none carries active marking (nav active-state bug).
      for (const href of ['/p/proj_x/board', '/p/proj_x/archive', '/p/proj_x/config', '/p/proj_x/pipelines']) {
        expect(container.querySelector(`nav a[href="${href}"]`)!.getAttribute('aria-current')).toBeNull();
      }
    } finally {
      localStorage.removeItem('rasen.recentSpaces');
    }
  });

  it('highlights only Profiles on /profiles, with no space-scoped entry active', async () => {
    localStorage.setItem('rasen.recentSpaces', JSON.stringify(['project:proj_x']));
    try {
      await mountAt(container, '/profiles');
      const profilesLink = container.querySelector('nav a[href="/profiles"]');
      expect(profilesLink!.getAttribute('aria-current')).toBe('page');
      for (const href of ['/p/proj_x/board', '/p/proj_x/archive', '/p/proj_x/config', '/p/proj_x/pipelines']) {
        expect(container.querySelector(`nav a[href="${href}"]`)!.getAttribute('aria-current')).toBeNull();
      }
      // The Workflows entry (also space-agnostic) is not the current route either.
      expect(container.querySelector('nav a[href="/workflows"]')!.getAttribute('aria-current')).toBeNull();
    } finally {
      localStorage.removeItem('rasen.recentSpaces');
    }
  });

  it('omits the space-scoped nav on /workflows only when no space was ever visited', async () => {
    localStorage.removeItem('rasen.recentSpaces');
    await mountAt(container, '/workflows');
    expect(container.querySelector('nav a[href="/p/proj_x/board"]')).toBeNull();
    expect(container.querySelector('nav a[href="/workflows"]')).not.toBeNull();
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

  it('renders the real Archive page at the archive route (placeholder retired)', async () => {
    await mountAt(container, '/p/proj_x/archive');
    expect(container.querySelector('[data-testid="archive-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="archive-placeholder"]')).toBeNull();
  });

  it('renders the task-detail page route with the change-name param', async () => {
    await mountAt(container, '/p/proj_x/task/my-change');
    expect(container.querySelector('[data-testid="task-detail-page"]')).not.toBeNull();
    expect(container.textContent).toContain('my-change');
  });

  it('replace-redirects a legacy Store Task URL to Operations without mounting Task Detail', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    await mountAt(container, '/s/store_y/task/my-change');
    expect(window.location.pathname).toBe('/s/store_y/operations');
    expect(container.querySelector('[data-testid="operations-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="task-detail-page"]')).toBeNull();
    expect(replaceSpy).toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('renders the Issue Board at a store space issues route', async () => {
    await mountAt(container, '/s/store_y/issues');
    expect(container.querySelector('[data-testid="issue-board-page"]')).not.toBeNull();
  });

  it('lands a deep link straight on the Issue Detail, carrying the issue id', async () => {
    await mountAt(container, '/s/store_y/issues/my-issue');
    expect(container.querySelector('[data-testid="issue-detail-page"]')).not.toBeNull();
    expect(container.textContent).toContain('my-issue');
    // The Board was never mounted: the deep link is reachable on its own.
    expect(container.querySelector('[data-testid="issue-board-page"]')).toBeNull();
  });

  it('offers the Issues nav entry in a store space, marks it current there, and stands Board down', async () => {
    await mountAt(container, '/s/store_y/issues');
    const issuesLink = container.querySelector('nav a[href="/s/store_y/issues"]');
    expect(issuesLink).not.toBeNull();
    expect(issuesLink!.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('nav a[href="/s/store_y/board"]')).toBeNull();
  });

  it('offers no Issues section in a project space — Issues live in Stores', async () => {
    await mountAt(container, '/p/proj_x/board');
    expect(container.querySelector('[data-testid="nav-issues"]')).toBeNull();
    expect(container.querySelector('nav a[href="/p/proj_x/issues"]')).toBeNull();
    // The store-space nav DOES offer it, so the absence above is the space
    // type's doing rather than the entry being missing everywhere. Mounted into
    // its own container: `LocationProvider` reads the location once at mount,
    // so re-rendering into the same node would keep the first route.
    const storeContainer = document.createElement('div');
    document.body.appendChild(storeContainer);
    try {
      await mountAt(storeContainer, '/s/store_y/issues');
      expect(storeContainer.querySelector('[data-testid="nav-issues"]')).not.toBeNull();
    } finally {
      document.body.removeChild(storeContainer);
    }
  });

  it.each([
    ['/s/store_y/operations', 'operations-page', 'nav-operations'],
    ['/s/store_y/unlinked-changes', 'unlinked-changes-page', 'nav-unlinked-changes'],
  ])('opens the Store-only %s route directly and marks its nav entry current', async (path, pageTestId, navTestId) => {
    await mountAt(container, path);
    expect(container.querySelector(`[data-testid="${pageTestId}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="${navTestId}"]`)?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('nav a[href="/s/store_y/board"]')).toBeNull();
  });

  it('offers neither Operations nor Unlinked Changes in a project space', async () => {
    await mountAt(container, '/p/proj_x/board');
    expect(container.querySelector('[data-testid="nav-operations"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-unlinked-changes"]')).toBeNull();
    expect(container.querySelector('nav a[href="/p/proj_x/operations"]')).toBeNull();
    expect(container.querySelector('nav a[href="/p/proj_x/unlinked-changes"]')).toBeNull();
  });

  it.each(['/p/proj_x/issues', '/p/proj_x/operations', '/p/proj_x/unlinked-changes'])(
    'does not expose a project mirror at %s',
    async (path) => {
      (client.health as any).mockResolvedValue({
        ok: true,
        version: '0',
        project: { projectId: 'proj_x', name: 'x', root: '/x' },
      });
      await mountAt(container, path);
      expect(window.location.pathname).toBe('/p/proj_x/board');
      expect(container.querySelector('[data-testid="issue-board-page"]')).toBeNull();
      expect(container.querySelector('[data-testid="operations-page"]')).toBeNull();
      expect(container.querySelector('[data-testid="unlinked-changes-page"]')).toBeNull();
    }
  );

  it('renders no independently polling running-session menu in the shell', async () => {
    await mountAt(container, '/p/proj_x/board');
    expect(container.querySelector('[data-testid="running-sessions-menu"]')).toBeNull();
  });

  it('renders the space-agnostic Spaces page at /spaces (no space prefix)', async () => {
    await mountAt(container, '/spaces');
    expect(container.querySelector('[data-testid="spaces-page"]')).not.toBeNull();
    // A space-agnostic route: no board/config/archive space view is mounted.
    expect(container.querySelector('[data-testid="board-page"]')).toBeNull();
  });

  it('renders the installation-wide Audit page and marks its permanent nav entry active', async () => {
    await mountAt(container, '/audit');
    expect(container.querySelector('[data-testid="audit-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-audit"]')?.getAttribute('aria-current')).toBe('page');
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
