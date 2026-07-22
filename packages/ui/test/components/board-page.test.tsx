// @vitest-environment jsdom
/**
 * Component-level coverage for BoardPage (design.md D7/board-ui spec):
 * column grouping renders per fixture data, and the loading / empty / error
 * states are each distinct (no placeholder/fabricated changes).
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listChanges: vi.fn(),
    listRuns: vi.fn(),
    listSessions: vi.fn(),
    listSpaces: vi.fn(),
    listSpaceWorktrees: vi.fn(),
    // createChange is intentionally left as the real implementation (it goes
    // through the single `request()` seam over `fetch`) so the 401 test
    // below exercises the actual markUnauthorized() wiring rather than a
    // hand-rolled stand-in.
  };
});

import { LocationProvider } from 'preact-iso';
import { BoardPage } from '../../src/components/BoardPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { onUnauthorized, resetTokenStateForTest } from '../../src/api/token.js';
import { changesListFixture, portfolioChangesFixture } from '../fixtures/changes-list.js';
import { runsListFixture } from '../fixtures/runs-list.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fillAndSubmitDialog(container: HTMLElement, name: string, description: string) {
  const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
  const descriptionInput = container.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
  nameInput.value = name;
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  descriptionInput.value = description;
  descriptionInput.dispatchEvent(new Event('input', { bubbles: true }));
  const form = container.querySelector('.new-change-dialog') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mount(container: HTMLElement) {
  await act(async () => {
    render(<BoardPage />, container);
  });
  // Flush the microtask queue so the mounted useEffect's Promise.all(...).then/.finally
  // chain settles, then let preact re-render with the resulting state update.
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('BoardPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Sessions and spaces are enrichment the board fetches on every load
    // (design D6/D4). Default them to empty so existing tests exercise the
    // change/run path unchanged; tests that care set their own values.
    (client.listSessions as any).mockResolvedValue({ sessions: [] });
    (client.listSpaces as any).mockResolvedValue({ spaces: [] });
    // The worktrees panel is project-space chrome the board fetches on load
    // (worktree-aware-spaces D4). Default to a single-worktree inventory so no
    // panel renders in existing tests; worktree tests set their own values.
    (client.listSpaceWorktrees as any).mockResolvedValue({ worktrees: [] });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
  });

  it('groups changes into lifecycle columns matching deriveColumn', async () => {
    (client.listChanges as any).mockResolvedValue(changesListFixture);
    (client.listRuns as any).mockResolvedValue(runsListFixture);

    await mount(container);

    const columns = container.querySelectorAll('.board-column');
    expect(columns).toHaveLength(4);

    const cardNames = (col: Element) =>
      Array.from(col.querySelectorAll('.board-card__name')).map((n) => n.textContent);

    expect(cardNames(columns[0]!)).toEqual(['planning-change']); // Planning
    expect(cardNames(columns[1]!)).toEqual(['ready-change']); // Ready
    expect(cardNames(columns[2]!)).toEqual(['in-progress-change']); // In Progress
    expect(cardNames(columns[3]!)).toEqual(['done-change']); // Done

    // The escalated run stage on in-progress-change renders as a badge, not a column.
    const escalatedBadge = columns[2]!.querySelector('.board-card__badge--escalated');
    expect(escalatedBadge).not.toBeNull();
  });

  it('shows an explicit empty state, not a blank page, when there are no active changes', async () => {
    (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__empty')).not.toBeNull();
    expect(container.querySelector('.board')).toBeNull();
    expect(container.textContent).toContain('No active changes');
  });

  it('renders a visibly broken card for a change the server could not read, instead of dropping it silently (review round 1 M2)', async () => {
    (client.listChanges as any).mockResolvedValue({
      changes: [changesListFixture.changes[1]!], // ready-change, still renders normally
      errors: [{ name: 'broken-change', message: "Schema 'does-not-exist' not found." }],
    });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    // Not the empty state — there is something to show, even though it's broken.
    expect(container.querySelector('.board-page__empty')).toBeNull();
    const broken = container.querySelector('.board-card--broken');
    expect(broken).not.toBeNull();
    expect(broken!.textContent).toContain('broken-change');
    expect(broken!.textContent).toContain('does-not-exist');
    // The healthy change still renders in its column alongside the broken card.
    expect(container.querySelector('.board')).not.toBeNull();
    expect(container.textContent).toContain('ready-change');
  });

  it('shows the broken-card list even when it is the only content (no successful changes at all)', async () => {
    (client.listChanges as any).mockResolvedValue({
      changes: [],
      errors: [{ name: 'broken-change', message: 'boom' }],
    });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__empty')).toBeNull();
    expect(container.querySelector('.board-card--broken')).not.toBeNull();
    expect(container.querySelector('.board')).toBeNull(); // no columns to show
  });

  it('tolerates a server response with no errors field, without crashing the board (review round 2 N2)', async () => {
    // A UI build newer than the serving CLI could talk to a server that
    // predates the `errors[]` field — `changesRes.errors` would be
    // `undefined` on the wire, not `[]`.
    (client.listChanges as any).mockResolvedValue({
      changes: [changesListFixture.changes[1]!], // ready-change
      errors: undefined,
    });
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__error')).toBeNull();
    expect(container.querySelector('.board-card--broken')).toBeNull();
    expect(container.querySelector('.board')).not.toBeNull();
    expect(container.textContent).toContain('ready-change');
  });

  it('shows an error state (not partial/stale content) on a non-auth fetch failure', async () => {
    (client.listChanges as any).mockRejectedValue(new ApiError(500, { error: { code: 'internal_error', message: 'boom' } }));
    (client.listRuns as any).mockResolvedValue({ runs: [] });

    await mount(container);

    expect(container.querySelector('.board-page__error')).not.toBeNull();
    expect(container.textContent).toContain('boom');
  });

  describe('New change submission (design D4 of platform-slice2-task-submission)', () => {
    beforeEach(() => {
      resetTokenStateForTest();
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('successful submit: form closes, board refetches, and the real new card is highlighted', async () => {
      (client.listChanges as any)
        .mockResolvedValueOnce({ changes: [], errors: [] })
        .mockResolvedValueOnce({
          changes: [
            {
              name: 'submitted-change',
              schemaName: 'spec-driven',
              artifacts: [
                { id: 'proposal', status: 'done' },
                { id: 'design', status: 'ready' },
                { id: 'specs', status: 'blocked' },
                { id: 'tasks', status: 'blocked' },
              ],
              applyReady: false,
              isComplete: false,
              taskProgress: { total: 0, completed: 0 },
              hasRunFiles: false,
            },
          ],
          errors: [],
        });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container);
      expect(container.querySelector('.board-page__empty')).not.toBeNull();

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(container.querySelector('.new-change-dialog')).not.toBeNull();

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, {
          change: { id: 'submitted-change', path: '/proj/rasen/changes/submitted-change', schema: 'spec-driven' },
        })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'submitted-change', 'A real submission');
        await flushMicrotasks();
      });
      await act(async () => {
        await flushMicrotasks();
      });

      expect(container.querySelector('.new-change-dialog')).toBeNull();
      expect(container.textContent).toContain('submitted-change');
      const card = Array.from(container.querySelectorAll('.board-card')).find((c) =>
        c.textContent?.includes('submitted-change')
      )!;
      expect(card.classList.contains('board-card--highlighted')).toBe(true);
      expect((client.listChanges as any).mock.calls.length).toBe(2); // initial + post-submit refetch
    });

    it('error path: dialog stays open with input intact and shows the envelope message verbatim', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [changesListFixture.changes[1]!], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container);

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(422, {
          error: {
            code: 'cli_error',
            message: "Change 'dup-change' already exists at /proj/rasen/changes/dup-change",
            cliExitCode: 1,
            stderr: '',
          },
        })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'dup-change', 'Duplicate attempt');
        await flushMicrotasks();
      });

      expect(container.querySelector('.new-change-dialog')).not.toBeNull();
      expect(container.textContent).toContain("Change 'dup-change' already exists");
      const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
      expect(nameInput.value).toBe('dup-change');
    });

    it('401 during submit triggers the shared re-launch notice mechanism (markUnauthorized)', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [changesListFixture.changes[1]!], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      const unauthorizedSpy = vi.fn();
      onUnauthorized(unauthorizedSpy);

      await mount(container);

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' } })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'some-change', 'desc');
        await flushMicrotasks();
      });

      expect(unauthorizedSpy).toHaveBeenCalled();
    });

    it('prevents double submission while a request is in flight', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [changesListFixture.changes[1]!], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container);

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      let resolveFetch!: (value: Response) => void;
      (fetch as any).mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFetch = resolve)));

      await act(async () => {
        fillAndSubmitDialog(container, 'in-flight-change', 'desc');
        await flushMicrotasks();
      });

      const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitButton.disabled).toBe(true);

      // A second submit attempt while in flight must not fire a second fetch.
      const form = container.querySelector('.new-change-dialog') as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushMicrotasks();
      });
      expect((fetch as any).mock.calls.length).toBe(1);

      await act(async () => {
        resolveFetch(
          jsonResponse(201, {
            change: { id: 'in-flight-change', path: '/proj/rasen/changes/in-flight-change', schema: 'spec-driven' },
          })
        );
        await flushMicrotasks();
      });
    });
  });

  describe('space scoping (management-ui-shell design D6)', () => {
    it('threads the route space selector into listChanges/listRuns when mounted under a space route', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      window.history.pushState({}, '', '/p/proj_x/board');
      await act(async () => {
        render(
          <LocationProvider>
            <BoardPage />
          </LocationProvider>,
          container
        );
      });
      await act(async () => {
        await flushMicrotasks();
      });

      expect(client.listChanges).toHaveBeenCalledWith('project:proj_x');
      expect(client.listRuns).toHaveBeenCalledWith('project:proj_x');

      window.history.pushState({}, '', '/');
    });

    it('sends no selector when mounted with no resolvable space (launch-project fallback)', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container); // bare, no LocationProvider → no space

      expect(client.listChanges).toHaveBeenCalledWith(undefined);
    });

    it('also fetches sessions scoped to the route space (design D6)', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      window.history.pushState({}, '', '/p/proj_x/board');
      await act(async () => {
        render(
          <LocationProvider>
            <BoardPage />
          </LocationProvider>,
          container
        );
      });
      await act(async () => {
        await flushMicrotasks();
      });

      expect(client.listSessions).toHaveBeenCalledWith('project:proj_x');
      window.history.pushState({}, '', '/');
    });
  });

  describe('Task grouping and store member chips (design D1/D3/D4)', () => {
    async function mountAtSpace(path: string) {
      window.history.pushState({}, '', path);
      await act(async () => {
        render(
          <LocationProvider>
            <BoardPage />
          </LocationProvider>,
          container
        );
      });
      await act(async () => {
        await flushMicrotasks();
      });
    }

    const columnNames = () => {
      const columns = container.querySelectorAll('.board-column');
      return Array.from(columns).map((col) =>
        Array.from(col.querySelectorAll('.board-card__name')).map((n) => n.textContent)
      );
    };

    afterEach(() => {
      window.history.pushState({}, '', '/');
    });

    it('groups a portfolio into one Task and a bare change into a single Task, in the right columns', async () => {
      (client.listChanges as any).mockResolvedValue(portfolioChangesFixture);
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mountAtSpace('/p/proj_x/board');

      // Portfolio `ui-redesign` (children span done/in-progress/planning) → In Progress;
      // bare `fix-login` (apply-ready, no tasks done, no run) → Ready.
      const [planning, ready, inProgress, done] = columnNames();
      expect(planning).toEqual([]);
      expect(ready).toEqual(['fix-login']);
      expect(inProgress).toEqual(['ui-redesign']);
      expect(done).toEqual([]);

      // Portfolio progress counts done child changes (only ui-redesign-api is Done).
      const portfolioCard = Array.from(container.querySelectorAll('[data-testid="task-card"]')).find((c) =>
        c.textContent?.includes('ui-redesign')
      )!;
      expect(portfolioCard.querySelector('.board-card__progress')!.textContent).toBe('1/3 changes');
    });

    it('shows a live indicator on a Task with a live session and none otherwise', async () => {
      (client.listChanges as any).mockResolvedValue(portfolioChangesFixture);
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      (client.listSessions as any).mockResolvedValue({
        sessions: [
          {
            session: {
              id: 's1',
              kind: 'auto',
              task: 'building',
              cwd: '/proj',
              state: 'running',
              startedAt: 0,
              lastOutputAt: 0,
              changeName: 'fix-login',
            },
            runState: { kind: 'absent' },
          },
        ],
      });

      await mountAtSpace('/p/proj_x/board');

      const liveCards = container.querySelectorAll('[data-testid="task-card-live"]');
      expect(liveCards).toHaveLength(1);
      const fixLogin = Array.from(container.querySelectorAll('[data-testid="task-card"]')).find((c) =>
        c.textContent?.includes('fix-login')
      )!;
      expect(fixLogin.querySelector('[data-testid="task-card-live"]')!.textContent).toContain('building');
    });

    it('renders no member chip row for a project space', async () => {
      (client.listChanges as any).mockResolvedValue(portfolioChangesFixture);
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mountAtSpace('/p/proj_x/board');

      expect(container.querySelector('[data-testid="member-chips"]')).toBeNull();
      expect(client.listSpaces).not.toHaveBeenCalled();
    });

    it('renders All + a chip per member for a store space and filters by session provenance', async () => {
      (client.listChanges as any).mockResolvedValue(portfolioChangesFixture);
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      (client.listSessions as any).mockResolvedValue({
        sessions: [
          {
            session: {
              id: 's1',
              kind: 'auto',
              task: 'work',
              cwd: '/a/repo/sub',
              state: 'running',
              startedAt: 0,
              lastOutputAt: 0,
              changeName: 'ui-redesign-api', // a child of the ui-redesign portfolio
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

      await mountAtSpace('/s/store_x/board');

      const chips = Array.from(container.querySelectorAll('.member-chip'));
      expect(chips.map((c) => c.textContent)).toEqual(['All', 'Repo A', 'Repo B']);

      // Under "All", both the portfolio and the bare change show.
      const allNames = columnNames().flat();
      expect(allNames).toContain('ui-redesign');
      expect(allNames).toContain('fix-login');

      // Select Repo A: only the ui-redesign portfolio (session cwd under /a/repo) survives.
      const repoA = chips.find((c) => c.textContent === 'Repo A') as HTMLButtonElement;
      await act(async () => {
        repoA.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushMicrotasks();
      });

      const filteredNames = columnNames().flat();
      expect(filteredNames).toContain('ui-redesign');
      expect(filteredNames).not.toContain('fix-login');
    });
  });

  describe('worktrees panel (worktree-aware-spaces D4 / board-ui spec)', () => {
    async function mountAtSpace(path: string) {
      window.history.pushState({}, '', path);
      await act(async () => {
        render(
          <LocationProvider>
            <BoardPage />
          </LocationProvider>,
          container
        );
      });
      await act(async () => {
        await flushMicrotasks();
      });
    }

    const twoWorktrees = {
      worktrees: [
        { root: '/repo/main', branch: 'main', isMain: true, activeChangeCount: 1 },
        { root: '/repo/feat-x', branch: 'feat/x', isMain: false, activeChangeCount: 2 },
      ],
    };

    afterEach(() => {
      window.history.pushState({}, '', '/');
    });

    it('renders a chip per worktree with facts and a live-session count, defaulting to the main checkout', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      (client.listSpaceWorktrees as any).mockResolvedValue(twoWorktrees);
      (client.listSessions as any).mockResolvedValue({
        sessions: [
          {
            session: { id: 's1', kind: 'auto', task: 'work', cwd: '/repo/feat-x/sub', state: 'running', startedAt: 0, lastOutputAt: 0 },
            runState: { kind: 'absent' },
          },
        ],
      });

      await mountAtSpace('/p/proj_x/board');

      const panel = container.querySelector('[data-testid="worktree-panel"]');
      expect(panel).not.toBeNull();
      const chips = Array.from(container.querySelectorAll('[data-testid="worktree-chip"]'));
      expect(chips).toHaveLength(2);
      // Facts: branch + active-change count on each chip.
      expect(chips[1]!.textContent).toContain('feat/x');
      expect(chips[1]!.textContent).toContain('2 changes');
      // Default source is the main checkout — its chip is selected.
      expect(chips[0]!.classList.contains('worktree-chip--selected')).toBe(true);
      expect(chips[1]!.classList.contains('worktree-chip--selected')).toBe(false);
      // The live session (cwd under /repo/feat-x) counts on the feat/x chip only.
      expect(chips[1]!.querySelector('[data-testid="worktree-sessions"]')!.textContent).toContain('1');
      expect(chips[0]!.querySelector('[data-testid="worktree-sessions"]')).toBeNull();
      // Default data source: no `?wt=`, so changes/runs use the space selector.
      expect(client.listChanges).toHaveBeenCalledWith('project:proj_x');
    });

    it('counts a live session under a worktree even when the session cwd and the worktree root use different path separators (Windows: canonical backslash cwd vs. raw git-porcelain forward-slash root)', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      // Worktree roots as raw `git worktree list --porcelain` emits them — forward
      // slash even on Windows — the real cross-source shape review finding M1
      // covers as defense-in-depth beyond the server-side canonicalization fix.
      (client.listSpaceWorktrees as any).mockResolvedValue({
        worktrees: [
          { root: 'E:/repo/main', branch: 'main', isMain: true, activeChangeCount: 1 },
          { root: 'E:/repo/feat-x', branch: 'feat/x', isMain: false, activeChangeCount: 2 },
        ],
      });
      (client.listSessions as any).mockResolvedValue({
        sessions: [
          {
            // Session cwd as `canonicalizeExistingPath` emits it on Windows: backslash.
            session: { id: 's1', kind: 'auto', task: 'work', cwd: 'E:\\repo\\feat-x\\sub', state: 'running', startedAt: 0, lastOutputAt: 0 },
            runState: { kind: 'absent' },
          },
        ],
      });

      await mountAtSpace('/p/proj_x/board');

      const chips = Array.from(container.querySelectorAll('[data-testid="worktree-chip"]'));
      expect(chips).toHaveLength(2);
      // The live session (cwd under E:\repo\feat-x, i.e. E:/repo/feat-x) counts on
      // the feat/x chip only, despite the separator mismatch between the two
      // sources — this is the exact shape review finding M1 found always
      // undercounts to 0 without separator-tolerant attribution.
      expect(chips[1]!.querySelector('[data-testid="worktree-sessions"]')!.textContent).toContain('1');
      expect(chips[0]!.querySelector('[data-testid="worktree-sessions"]')).toBeNull();
    });

    it('switching to a worktree re-scopes the board fetch via ?wt= without changing the space route prefix', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      (client.listSpaceWorktrees as any).mockResolvedValue(twoWorktrees);

      await mountAtSpace('/p/proj_x/board');
      (client.listChanges as any).mockClear();

      const chips = Array.from(container.querySelectorAll('[data-testid="worktree-chip"]'));
      await act(async () => {
        (chips[1] as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushMicrotasks();
      });

      // The route gained ?wt= but kept the project space prefix.
      expect(window.location.pathname).toBe('/p/proj_x/board');
      expect(decodeURIComponent(window.location.search)).toBe('?wt=/repo/feat-x');
      // Changes now fetched with the worktree's own root selector.
      expect(client.listChanges).toHaveBeenCalledWith('project:/repo/feat-x');
      // Sessions stay space-wide.
      expect(client.listSessions).toHaveBeenCalledWith('project:proj_x');
    });

    it('restores the selected worktree from ?wt= on reload', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      (client.listSpaceWorktrees as any).mockResolvedValue(twoWorktrees);

      await mountAtSpace('/p/proj_x/board?wt=%2Frepo%2Ffeat-x');

      const chips = Array.from(container.querySelectorAll('[data-testid="worktree-chip"]'));
      expect(chips[1]!.classList.contains('worktree-chip--selected')).toBe(true);
      expect(chips[0]!.classList.contains('worktree-chip--selected')).toBe(false);
      expect(client.listChanges).toHaveBeenCalledWith('project:/repo/feat-x');
    });

    it('renders no panel for a single-worktree project or a store space', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });
      (client.listSpaceWorktrees as any).mockResolvedValue({
        worktrees: [{ root: '/repo/main', branch: 'main', isMain: true, activeChangeCount: 0 }],
      });

      await mountAtSpace('/p/proj_x/board');
      expect(container.querySelector('[data-testid="worktree-panel"]')).toBeNull();

      window.history.pushState({}, '', '/');
      container.innerHTML = '';
      // A store space never fetches the worktree inventory.
      (client.listSpaceWorktrees as any).mockClear();
      await mountAtSpace('/s/store_x/board');
      expect(container.querySelector('[data-testid="worktree-panel"]')).toBeNull();
      expect(client.listSpaceWorktrees).not.toHaveBeenCalled();
    });
  });

  describe('space-scoped new-change submission (design D5 / carryover)', () => {
    beforeEach(() => {
      resetTokenStateForTest();
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      window.history.pushState({}, '', '/');
    });

    it('carries the viewed space selector in the createChange request body', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      window.history.pushState({}, '', '/s/store_x/board');
      await act(async () => {
        render(
          <LocationProvider>
            <BoardPage />
          </LocationProvider>,
          container
        );
      });
      await act(async () => {
        await flushMicrotasks();
      });

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, {
          change: { id: 'scoped-change', path: '/x/rasen/changes/scoped-change', schema: 'spec-driven' },
        })
      );

      // Fill the inputs and let their state settle, then submit — so the
      // submit handler's closure sees the entered name, not the initial ''.
      const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
      const descriptionInput = container.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
      await act(async () => {
        nameInput.value = 'scoped-change';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        descriptionInput.value = 'A scoped submission';
        descriptionInput.dispatchEvent(new Event('input', { bubbles: true }));
        await flushMicrotasks();
      });
      await act(async () => {
        (container.querySelector('.new-change-dialog') as HTMLFormElement).dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
        await flushMicrotasks();
      });

      const [, init] = (fetch as any).mock.calls[0];
      expect(JSON.parse(init.body)).toMatchObject({ name: 'scoped-change', space: 'store:store_x' });
    });

    it('omits space entirely in the launch-project fallback (no space route)', async () => {
      (client.listChanges as any).mockResolvedValue({ changes: [], errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mount(container); // bare, no space route

      const openButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'New change'
      )!;
      await act(async () => {
        openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (fetch as any).mockResolvedValueOnce(
        jsonResponse(201, {
          change: { id: 'fallback-change', path: '/proj/rasen/changes/fallback-change', schema: 'spec-driven' },
        })
      );

      await act(async () => {
        fillAndSubmitDialog(container, 'fallback-change', 'A fallback submission');
        await flushMicrotasks();
      });

      const [, init] = (fetch as any).mock.calls[0];
      expect(JSON.parse(init.body).space).toBeUndefined();
    });
  });

  describe('Done-column truncation (archive-ui spec / design D5)', () => {
    async function mountAtSpace(path: string) {
      window.history.pushState({}, '', path);
      await act(async () => {
        render(
          <LocationProvider>
            <BoardPage />
          </LocationProvider>,
          container
        );
      });
      await act(async () => {
        await flushMicrotasks();
      });
    }

    afterEach(() => {
      window.history.pushState({}, '', '/');
    });

    function doneChange(name: string) {
      return {
        name,
        schemaName: 'spec-driven',
        artifacts: [],
        applyReady: true,
        isComplete: true,
        taskProgress: { total: 1, completed: 1 },
        hasRunFiles: false,
      };
    }

    const doneColumn = () => container.querySelectorAll('.board-column')[3]!;

    it('caps the Done column at the bound and links the overflow into the Archive page', async () => {
      // Six done Tasks exceed the bound of 5.
      const names = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
      (client.listChanges as any).mockResolvedValue({ changes: names.map(doneChange), errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mountAtSpace('/p/proj_x/board');

      const cards = doneColumn().querySelectorAll('[data-testid="task-card"]');
      expect(cards).toHaveLength(5); // most recent 5 (the tail of the entry order)
      const shown = Array.from(doneColumn().querySelectorAll('.board-card__name')).map((n) => n.textContent);
      // The head (d1) is dropped; the tail (through d6) is kept.
      expect(shown).toEqual(['d2', 'd3', 'd4', 'd5', 'd6']);
      const overflow = container.querySelector('[data-testid="done-overflow"]') as HTMLAnchorElement;
      expect(overflow).not.toBeNull();
      expect(overflow.getAttribute('href')).toBe('/p/proj_x/archive');
    });

    it('shows all done Tasks and no overflow footer when under the bound', async () => {
      const names = ['d1', 'd2', 'd3'];
      (client.listChanges as any).mockResolvedValue({ changes: names.map(doneChange), errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mountAtSpace('/p/proj_x/board');

      expect(doneColumn().querySelectorAll('[data-testid="task-card"]')).toHaveLength(3);
      expect(container.querySelector('[data-testid="done-overflow"]')).toBeNull();
    });

    it('does not truncate the other columns', async () => {
      const changes = [
        ...['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map(doneChange),
        // Six planning Tasks (applyReady false) — must all still show.
        ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((name) => ({
          ...doneChange(name),
          applyReady: false,
          isComplete: false,
        })),
      ];
      (client.listChanges as any).mockResolvedValue({ changes, errors: [] });
      (client.listRuns as any).mockResolvedValue({ runs: [] });

      await mountAtSpace('/p/proj_x/board');

      const planningColumn = container.querySelectorAll('.board-column')[0]!;
      expect(planningColumn.querySelectorAll('[data-testid="task-card"]')).toHaveLength(6);
      expect(doneColumn().querySelectorAll('[data-testid="task-card"]')).toHaveLength(5);
    });
  });
});
