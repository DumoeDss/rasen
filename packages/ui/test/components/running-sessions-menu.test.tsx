// @vitest-environment jsdom
/**
 * RunningSessionsMenu (management-ui-shell design D4): the header's
 * running-run summary for the current space — a `⦿ N running` control hidden
 * when nothing is live, scoped to the route's space selector, opening to a
 * list whose change-associated entries link to task detail within the space.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', () => ({
  listSessions: vi.fn(),
}));

import { RunningSessionsMenu } from '../../src/components/RunningSessionsMenu.js';
import * as client from '../../src/api/client.js';

function liveEntry(id: string, changeName?: string) {
  return {
    session: {
      id,
      kind: 'auto',
      task: `task ${id}`,
      cwd: '/p',
      state: 'running',
      startedAt: Date.now() - 65_000,
      lastOutputAt: Date.now(),
      ...(changeName ? { changeName } : {}),
    },
    runState: changeName
      ? {
          name: changeName,
          kind: 'ok',
          autoRun: {
            kind: 'ok',
            state: { pipeline: 'small-feature', stages: { apply: { status: 'in_progress' } } },
          },
          portfolio: { kind: 'absent' },
          goalRun: { kind: 'absent' },
        }
      : { kind: 'absent' },
  };
}

const exitedEntry = {
  session: { id: 'done', kind: 'auto', task: 't', cwd: '/p', state: 'exited', startedAt: 1, lastOutputAt: 1 },
  runState: { kind: 'absent' },
};

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mountAt(container: HTMLElement, path: string) {
  window.history.replaceState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <RunningSessionsMenu />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('RunningSessionsMenu', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('is not shown when the current space has no live runs', async () => {
    (client.listSessions as any).mockResolvedValue({ sessions: [exitedEntry] });
    await mountAt(container, '/p/proj_x/board');
    expect(container.querySelector('[data-testid="running-sessions-menu"]')).toBeNull();
  });

  it('counts only live runs and scopes the fetch to the route space', async () => {
    (client.listSessions as any).mockResolvedValue({
      sessions: [liveEntry('a', 'change-a'), liveEntry('b'), exitedEntry],
    });
    await mountAt(container, '/p/proj_x/board');

    expect(client.listSessions).toHaveBeenCalledWith('project:proj_x');
    const toggle = container.querySelector('.running-sessions-menu__toggle')!;
    expect(toggle.textContent).toContain('2 running');
  });

  it('opens to list each live run and links a change-associated entry to task detail within the space', async () => {
    (client.listSessions as any).mockResolvedValue({ sessions: [liveEntry('a', 'change-a')] });
    await mountAt(container, '/p/proj_x/board');

    const toggle = container.querySelector('.running-sessions-menu__toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const link = container.querySelector('.running-sessions-menu__list a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/p/proj_x/task/change-a');
    expect(link.textContent).toContain('task a');
    expect(link.textContent).toContain('small-feature');
  });
});
