import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Cross-platform audit (tasks.md 3.5): the Windows branch must be
// unit-tested via injection — no real `taskkill` process spawned in CI,
// which does not run on win32 for every job. Mocks `node:child_process`'s
// `spawn` so `killTreeWindows` can be exercised on any host OS while
// asserting the exact argv shape design D5 specifies, and that it never
// falls back to a bare `-pid` POSIX-style kill.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

describe('killTreeWindows (design D5, injected — no real taskkill)', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    // `.on('close', ...)` (design D5: the graceful attempt's own exit code
    // now drives early escalation) — a no-op registration by default; tests
    // that need to simulate the callback firing capture and invoke it
    // themselves.
    spawnMock.mockReturnValue({ unref: vi.fn(), on: vi.fn() });
    // Guards against the Windows branch ever falling back to a POSIX-style
    // negative-pid signal — it must go through `spawn('taskkill', ...)` only.
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as never);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('sends a graceful tree taskkill immediately', async () => {
    const { killTreeWindows } = await import('../../../src/core/management-api/kill-tree.js');
    killTreeWindows(4242, 5_000).cancel();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      'taskkill',
      ['/T', '/PID', '4242'],
      expect.objectContaining({ shell: false, stdio: 'ignore' })
    );
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('escalates to a forced tree taskkill after the grace period, keyed off the timer not a live check', async () => {
    vi.useFakeTimers();
    try {
      const { killTreeWindows } = await import('../../../src/core/management-api/kill-tree.js');
      killTreeWindows(4242, 1_000);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock).toHaveBeenNthCalledWith(
        2,
        'taskkill',
        ['/F', '/T', '/PID', '4242'],
        expect.objectContaining({ shell: false, stdio: 'ignore' })
      );
      // `isProcessAlive`'s signal-0 probe (`process.kill(pid, 0)`) is
      // expected and harmless; what must never happen on win32 is a
      // negative-pid POSIX-style process-group kill.
      for (const call of killSpy.mock.calls) {
        expect((call[0] as number) >= 0).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() disarms the pending forced taskkill', async () => {
    vi.useFakeTimers();
    try {
      const { killTreeWindows } = await import('../../../src/core/management-api/kill-tree.js');
      const handle = killTreeWindows(4242, 1_000);
      handle.cancel();

      await vi.advanceTimersByTimeAsync(2_000);

      // Only the initial graceful taskkill fired; the forced one never did.
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('design D5 (evidence-gated): escalates immediately when the graceful taskkill itself reports failure, rather than waiting out the grace period', async () => {
    vi.useFakeTimers();
    try {
      let gracefulCloseHandler: ((code: number) => void) | undefined;
      spawnMock.mockImplementationOnce(() => ({
        unref: vi.fn(),
        on: (event: string, handler: (code: number) => void) => {
          if (event === 'close') gracefulCloseHandler = handler;
        },
      }));
      spawnMock.mockReturnValueOnce({ unref: vi.fn(), on: vi.fn() }); // the forced call

      const { killTreeWindows } = await import('../../../src/core/management-api/kill-tree.js');
      killTreeWindows(4242, 15_000);

      expect(spawnMock).toHaveBeenCalledTimes(1);

      // A non-zero exit is taskkill's own report that it could not
      // terminate a headless target gracefully — empirically the common
      // case on Windows against a plain console process.
      gracefulCloseHandler?.(128);

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock).toHaveBeenNthCalledWith(
        2,
        'taskkill',
        ['/F', '/T', '/PID', '4242'],
        expect.objectContaining({ shell: false, stdio: 'ignore' })
      );

      // The full 15s grace timer never fires a second forced attempt.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(spawnMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('design D5: does not escalate early when the graceful taskkill reports success (exit 0) — the grace timer still governs the forced fallback', async () => {
    vi.useFakeTimers();
    try {
      let gracefulCloseHandler: ((code: number) => void) | undefined;
      spawnMock.mockImplementationOnce(() => ({
        unref: vi.fn(),
        on: (event: string, handler: (code: number) => void) => {
          if (event === 'close') gracefulCloseHandler = handler;
        },
      }));

      const { killTreeWindows } = await import('../../../src/core/management-api/kill-tree.js');
      killTreeWindows(4242, 1_000);
      gracefulCloseHandler?.(0);

      // No immediate second call on success.
      expect(spawnMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      // The normal grace-period timer still governs the forced fallback
      // (guarded by isProcessAlive in the real, unmocked path).
      expect(spawnMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
