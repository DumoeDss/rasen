// @vitest-environment jsdom
/**
 * Component-level coverage for TaskDetailPage (ui-space-redesign-task-detail
 * spec): portfolio vs single vs not-found rendering, the sessions column's
 * live-on-top ordering, and a Launch run that carries the page's space +
 * change context. The `satisfies TaskDetailResponse` fixtures it imports are
 * the `tsc` drift tripwire over the mirrored wire types.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getTaskDetail: vi.fn(),
    listSessions: vi.fn(),
    launchSession: vi.fn(),
    getSession: vi.fn(),
    killSession: vi.fn(),
  };
});

import { LocationProvider, Router, Route } from 'preact-iso';
import { TaskDetailPage } from '../../src/components/TaskDetailPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import type { SessionListEntry } from '../../src/api/types.js';
import { portfolioTaskDetailFixture, singleTaskDetailFixture } from '../fixtures/task-detail.js';

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountAt(container: HTMLElement, taskPath: string): Promise<void> {
  window.history.pushState({}, '', taskPath);
  await act(async () => {
    render(
      <LocationProvider>
        <Router>
          <Route path="/p/:projectId/task/:changeName" component={TaskDetailPage} />
          <Route default component={TaskDetailPage} />
        </Router>
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function liveSession(changeName: string, overrides: Partial<SessionListEntry['session']> = {}): SessionListEntry {
  return {
    session: {
      id: `sess-${changeName}`,
      kind: 'auto',
      task: `Working on ${changeName}`,
      cwd: '/proj',
      state: 'running',
      startedAt: 0,
      lastOutputAt: 0,
      changeName,
      ...overrides,
    },
    runState: { kind: 'absent' },
  };
}

describe('TaskDetailPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.listSessions).mockResolvedValue({ sessions: [] });
  });

  afterEach(() => {
    render(null, container); // unmount to clear the polling interval
    document.body.removeChild(container);
    window.history.replaceState({}, '', '/');
    vi.clearAllMocks();
  });

  it('renders a portfolio Task with N/M-change progress and one row per child', async () => {
    vi.mocked(client.getTaskDetail).mockResolvedValue(portfolioTaskDetailFixture);
    await mountAt(container, '/p/proj_x/task/ui-redesign');

    expect(container.querySelector('[data-testid="task-detail-page"]')).not.toBeNull();
    // 3 children (api in-progress, shell planning, groundwork archived-done) → 1/3 done.
    expect(container.querySelector('[data-testid="task-detail-progress"]')!.textContent).toBe('1/3 changes');
    expect(container.querySelectorAll('[data-testid="task-detail-child"]')).toHaveLength(3);
    // shell declares a dependency, so a deps hint renders and the "no deps" note does not.
    expect(container.querySelector('[data-testid="task-detail-child-deps"]')!.textContent).toContain('ui-redesign-api');
    expect(container.querySelector('[data-testid="task-detail-no-deps"]')).toBeNull();

    // The Task detail read carried the route's space selector.
    expect(client.getTaskDetail).toHaveBeenCalledWith('ui-redesign', 'project:proj_x');
    expect(client.listSessions).toHaveBeenCalledWith('project:proj_x');
  });

  it('renders a single-item Task as a checklist card: progress summary, open items listed, completed collapsed', async () => {
    vi.mocked(client.getTaskDetail).mockResolvedValue(singleTaskDetailFixture);
    await mountAt(container, '/p/proj_x/task/fix-login');

    const checklist = container.querySelector('[data-testid="task-detail-checklist"]');
    expect(checklist).not.toBeNull();
    // Progress summary shows completed/total (1 of 2 done).
    expect(container.querySelector('[data-testid="task-checklist-count"]')!.textContent).toBe('1/2');
    // The open item is always listed; the completed one is behind the disclosure.
    const openList = container.querySelector('[data-testid="task-checklist-open"]')!;
    expect(openList.querySelectorAll('li')).toHaveLength(1);
    expect(openList.textContent).toContain('Patch the redirect');
    expect(container.querySelector('[data-testid="task-checklist-completed"]')).toBeNull();
    expect(container.textContent).not.toContain('Reproduce the failure');
    // No portfolio "N/M changes" header for a single Task.
    expect(container.querySelector('[data-testid="task-detail-progress"]')).toBeNull();

    // Expanding the disclosure reveals the completed item.
    const toggle = container.querySelector('[data-testid="task-checklist-toggle"]') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Show 1 completed');
    await act(async () => {
      toggle.click();
      await flushMicrotasks();
    });
    expect(container.querySelector('[data-testid="task-checklist-completed"]')).not.toBeNull();
    expect(container.textContent).toContain('Reproduce the failure');
  });

  it('renders backtick spans in task text as <code>, not literal backticks', async () => {
    vi.mocked(client.getTaskDetail).mockResolvedValue({
      ...singleTaskDetailFixture,
      children: [
        {
          ...singleTaskDetailFixture.children[0]!,
          taskProgress: { total: 1, completed: 0 },
          tasks: [{ text: 'Extend `parseCodexRolloutFile` to capture usage', done: false }],
        },
      ],
    });
    await mountAt(container, '/p/proj_x/task/fix-login');

    const code = container.querySelector('[data-testid="task-checklist-open"] code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('parseCodexRolloutFile');
    expect(container.querySelector('[data-testid="task-checklist-open"]')!.textContent).not.toContain('`');
  });

  it('shows a not-found state for an unknown Task id', async () => {
    vi.mocked(client.getTaskDetail).mockRejectedValue(
      new ApiError(404, { error: { code: 'task_not_found', message: 'No Task named ghost.' } })
    );
    await mountAt(container, '/p/proj_x/task/ghost');

    expect(container.querySelector('[data-testid="task-detail-not-found"]')).not.toBeNull();
  });

  it('orders live sessions before ended ones and shows the live stage', async () => {
    vi.mocked(client.getTaskDetail).mockResolvedValue(portfolioTaskDetailFixture);
    vi.mocked(client.listSessions).mockResolvedValue({
      sessions: [
        liveSession('ui-redesign-api', { id: 'ended-1', state: 'exited' }),
        liveSession('ui-redesign-shell', { id: 'live-1', state: 'running' }),
      ],
    });
    await mountAt(container, '/p/proj_x/task/ui-redesign');

    const rows = Array.from(container.querySelectorAll('[data-testid="session-row"]'));
    expect(rows.map((r) => r.getAttribute('data-session-id'))).toEqual(['live-1', 'ended-1']);
    expect(container.querySelector('[data-testid="task-detail-live"]')).not.toBeNull();
  });

  it('Launch run submits the page space and the single Task change as the linked change', async () => {
    vi.mocked(client.getTaskDetail).mockResolvedValue(singleTaskDetailFixture);
    vi.mocked(client.launchSession).mockResolvedValue({
      session: { ...liveSession('fix-login').session },
    });
    await mountAt(container, '/p/proj_x/task/fix-login');

    // Open the dialog.
    const launchBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Launch run')!;
    await act(async () => {
      launchBtn.click();
      await flushMicrotasks();
    });

    // The changeName field is pre-filled with the single Task's change.
    const changeInput = container.querySelector('input[name="changeName"]') as HTMLInputElement;
    expect(changeInput.value).toBe('fix-login');

    const taskArea = container.querySelector('textarea[name="task"]') as HTMLTextAreaElement;
    await act(async () => {
      taskArea.value = 'Re-run the fix';
      taskArea.dispatchEvent(new Event('input', { bubbles: true }));
      await flushMicrotasks();
    });

    const form = container.querySelector('.launch-session-dialog') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(client.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ space: 'project:proj_x', changeName: 'fix-login', task: 'Re-run the fix' })
    );
  });
});
