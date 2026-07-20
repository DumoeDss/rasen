// @vitest-environment jsdom
/**
 * Component-level coverage for SessionsPage (design.md D1-D4 of
 * `slice3-sessions-ui`): list rendering per fixture shape, the confirmed
 * kill flow with the 202-body instant patch, 404-on-kill graceful refresh,
 * launch success merged by id, and launch error surfaced verbatim.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listSessions: vi.fn(),
    getSession: vi.fn(),
    launchSession: vi.fn(),
    killSession: vi.fn(),
  };
});

import { SessionsPage } from '../../src/components/SessionsPage.js';
import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { sessionsListFixture } from '../fixtures/sessions-list.js';

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mount(container: HTMLElement) {
  await act(async () => {
    render(<SessionsPage />, container);
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('SessionsPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('renders live/exited/absent-join/invalid-join fixtures correctly', async () => {
    (client.listSessions as any).mockResolvedValue(sessionsListFixture);

    await mount(container);

    const rows = container.querySelectorAll('[data-testid="session-row"]');
    expect(rows).toHaveLength(sessionsListFixture.sessions.length);

    // Live session with pipeline progress.
    const liveRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
    expect(liveRow.querySelector('[data-testid="session-run-stages"]')).not.toBeNull();
    expect(liveRow.textContent).toContain('propose');

    // Ended session shows terminal facts.
    const exitedRow = container.querySelector('[data-session-id="sess-exited-killed"]')!;
    expect(exitedRow.querySelector('[data-testid="session-termination-reason"]')!.textContent).toContain(
      'killed'
    );

    // Absent join is stated honestly.
    const absentRow = container.querySelector('[data-session-id="sess-no-change"]')!;
    expect(absentRow.querySelector('[data-testid="session-run-absent"]')).not.toBeNull();

    // Invalid join shows its reason.
    const invalidRow = container.querySelector('[data-session-id="sess-invalid-run-state"]')!;
    const invalidNote = invalidRow.querySelector('[data-testid="session-run-invalid"]')!;
    expect(invalidNote.textContent).toContain('schema validation');
  });

  it('shows an explicit empty state when there are no sessions', async () => {
    (client.listSessions as any).mockResolvedValue({ sessions: [] });

    await mount(container);

    expect(container.textContent).toContain('No sessions yet');
  });

  it('kill requires confirmation, then patches the row to exiting from the 202 body', async () => {
    (client.listSessions as any).mockResolvedValue(sessionsListFixture);
    await mount(container);

    const liveRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
    const killButton = Array.from(liveRow.querySelectorAll('button')).find((b) => b.textContent === 'Kill')!;

    await act(async () => {
      killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // No delete call yet — confirmation required first.
    expect(client.killSession).not.toHaveBeenCalled();
    expect(liveRow.textContent).toContain('Kill this session?');

    (client.killSession as any).mockResolvedValueOnce({
      session: { ...sessionsListFixture.sessions[0]!.session, state: 'exiting' },
    });

    const confirmButton = Array.from(liveRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Confirm kill'
    )!;
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });

    expect(client.killSession).toHaveBeenCalledWith('sess-live-with-progress');
    const updatedRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
    expect(updatedRow.querySelector('.session-row__state')!.textContent).toBe('exiting');
    // Row is retained, never removed.
    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(
      sessionsListFixture.sessions.length
    );
  });

  it('does not kill when the user cancels the confirmation', async () => {
    (client.listSessions as any).mockResolvedValue(sessionsListFixture);
    await mount(container);

    const liveRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
    const killButton = Array.from(liveRow.querySelectorAll('button')).find((b) => b.textContent === 'Kill')!;
    await act(async () => {
      killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const cancelButton = Array.from(liveRow.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!;
    await act(async () => {
      cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(client.killSession).not.toHaveBeenCalled();
    expect(liveRow.querySelector('.session-row__state')!.textContent).toBe('running');
  });

  it('resolves a 404-on-kill gracefully: no error noise, and the list refreshes without pinning a phantom live row (review round 1 M1)', async () => {
    const otherEntries = sessionsListFixture.sessions.filter((e) => e.session.id !== 'sess-live-with-progress');
    (client.listSessions as any).mockResolvedValue(sessionsListFixture);
    await mount(container);

    const liveRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
    const killButton = Array.from(liveRow.querySelectorAll('button')).find((b) => b.textContent === 'Kill')!;
    await act(async () => {
      killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    (client.killSession as any).mockRejectedValueOnce(
      new ApiError(404, { error: { code: 'not_found', message: 'Session not found.' } })
    );
    // The server has pruned the session — this is exactly the case a 404
    // arises from, so the post-kill refetch omits it too.
    (client.listSessions as any).mockResolvedValue({ sessions: otherEntries });

    const confirmButton = Array.from(liveRow.querySelectorAll('button')).find(
      (b) => b.textContent === 'Confirm kill'
    )!;
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });
    // The 404 handler bumps refreshNonce, remounting the polling effect —
    // let its fetch settle too.
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    // No phantom "running" row for the vanished session — it must not
    // survive as a locally-pinned override with a live Kill button.
    expect(container.querySelector('[data-session-id="sess-live-with-progress"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(otherEntries.length);
  });

  it('drops an already-pending kill patch and any optimistic launch for the same id on a 404 (review round 1 M1)', async () => {
    // A launched-but-not-yet-polled session that immediately gets killed and
    // 404s must not linger as either an optimistic row or a stale patch.
    (client.listSessions as any).mockResolvedValue({ sessions: [] });
    await mount(container);

    const launchButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Launch session'
    )!;
    await act(async () => {
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const justLaunched = sessionsListFixture.sessions[2]!.session; // sess-no-change, running-eligible
    (client.launchSession as any).mockResolvedValueOnce({ session: { ...justLaunched, state: 'running' } });
    const taskInput = container.querySelector('textarea[name="task"]') as HTMLTextAreaElement;
    await act(async () => {
      taskInput.value = 'do a thing';
      taskInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('.launch-session-dialog') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(1);

    const row = container.querySelector(`[data-session-id="${justLaunched.id}"]`)!;
    const killButton = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Kill')!;
    await act(async () => {
      killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    (client.killSession as any).mockRejectedValueOnce(
      new ApiError(404, { error: { code: 'not_found', message: 'Session not found.' } })
    );
    (client.listSessions as any).mockResolvedValue({ sessions: [] });
    const confirmButton = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Confirm kill')!;
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(0);
    expect(container.textContent).toContain('No sessions yet');
  });

  it('launch success prepends the new session without duplication once the next poll includes it', async () => {
    (client.listSessions as any).mockResolvedValue({ sessions: [] });
    await mount(container);

    const launchButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Launch session'
    )!;
    await act(async () => {
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.launch-session-dialog')).not.toBeNull();

    const launchedSession = sessionsListFixture.sessions[2]!.session; // sess-no-change, state starting
    (client.launchSession as any).mockResolvedValueOnce({ session: launchedSession });

    const taskInput = container.querySelector('textarea[name="task"]') as HTMLTextAreaElement;
    await act(async () => {
      taskInput.value = 'do a thing';
      taskInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('.launch-session-dialog') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(container.querySelector('.launch-session-dialog')).toBeNull();
    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(1);
    expect(container.textContent).toContain(launchedSession.task);

    // Next poll includes the real record — no duplicate should appear.
    (client.listSessions as any).mockResolvedValue({
      sessions: [{ session: launchedSession, runState: { kind: 'absent' } }],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(1);
  });

  it('launch error shows the server message and no session is added', async () => {
    (client.listSessions as any).mockResolvedValue({ sessions: [] });
    await mount(container);

    const launchButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Launch session'
    )!;
    await act(async () => {
      launchButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    (client.launchSession as any).mockRejectedValueOnce(
      new ApiError(503, {
        error: { code: 'agent_cli_unavailable', message: 'No agent CLI could be resolved on this machine.' },
      })
    );

    const taskInput = container.querySelector('textarea[name="task"]') as HTMLTextAreaElement;
    await act(async () => {
      taskInput.value = 'do a thing';
      taskInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('.launch-session-dialog') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(container.querySelector('.launch-session-dialog')).not.toBeNull();
    expect(container.textContent).toContain('No agent CLI could be resolved');
    expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(0);
  });

  describe('polling (design D2, review round 5.3)', () => {
    it('polls listSessions every 3s while mounted and stops after unmount', async () => {
      (client.listSessions as any).mockResolvedValue({ sessions: [] });
      await mount(container);
      expect(client.listSessions).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(client.listSessions).toHaveBeenCalledTimes(2);

      await act(async () => {
        render(null, container);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      // No further calls after unmount.
      expect(client.listSessions).toHaveBeenCalledTimes(2);
    });

    it('polls session detail only while a row is expanded', async () => {
      (client.listSessions as any).mockResolvedValue(sessionsListFixture);
      (client.getSession as any).mockResolvedValue({
        session: sessionsListFixture.sessions[0]!.session,
        tails: { stdout: 'a', stderr: '' },
      });
      await mount(container);

      expect(client.getSession).not.toHaveBeenCalled();

      const liveRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
      const toggle = liveRow.querySelector('.session-row__toggle') as HTMLButtonElement;
      await act(async () => {
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushMicrotasks();
      });
      expect(client.getSession).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(client.getSession).toHaveBeenCalledTimes(2);

      await act(async () => {
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushMicrotasks();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      // No more calls once collapsed.
      expect(client.getSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('kill-reflection tail via polling (review round 1 m1: the acceptance state machine, not just its first tick)', () => {
    it('carries an instant exiting patch to the polled exited/killed terminal state, retaining the row', async () => {
      (client.listSessions as any).mockResolvedValue(sessionsListFixture);
      await mount(container);

      const liveRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
      const killButton = Array.from(liveRow.querySelectorAll('button')).find((b) => b.textContent === 'Kill')!;
      await act(async () => {
        killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      (client.killSession as any).mockResolvedValueOnce({
        session: { ...sessionsListFixture.sessions[0]!.session, state: 'exiting' },
      });
      const confirmButton = Array.from(liveRow.querySelectorAll('button')).find(
        (b) => b.textContent === 'Confirm kill'
      )!;
      await act(async () => {
        confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushMicrotasks();
      });

      const patchedRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
      expect(patchedRow.querySelector('.session-row__state')!.textContent).toBe('exiting');

      // The next poll reports the terminal state.
      (client.listSessions as any).mockResolvedValue({
        sessions: [
          {
            session: {
              ...sessionsListFixture.sessions[0]!.session,
              state: 'exited',
              endedAt: sessionsListFixture.sessions[0]!.session.lastOutputAt + 1000,
              exitCode: null,
              exitSignal: 'SIGTERM',
              terminationReason: 'killed',
            },
            runState: sessionsListFixture.sessions[0]!.runState,
          },
          ...sessionsListFixture.sessions.slice(1),
        ],
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      const finalRow = container.querySelector('[data-session-id="sess-live-with-progress"]')!;
      expect(finalRow.querySelector('.session-row__state')!.textContent).toBe('exited');
      expect(finalRow.querySelector('[data-testid="session-termination-reason"]')!.textContent).toContain('killed');
      // Retained, not removed — same total row count as before.
      expect(container.querySelectorAll('[data-testid="session-row"]')).toHaveLength(
        sessionsListFixture.sessions.length
      );

      // The pruned override no longer holds the row back on a further poll:
      // feed one more identical terminal response and confirm nothing regresses.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(
        container.querySelector('[data-session-id="sess-live-with-progress"]')!.querySelector('.session-row__state')!
          .textContent
      ).toBe('exited');
    });
  });
});
