import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  killProcessTree: vi.fn(),
  probeDaemonPort: vi.fn(async () => ({ kind: 'no-listener' as const })),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: () => ({ pid: 24680, unref() {} }),
  };
});

vi.mock('../../src/core/management-api/kill-tree.js', () => ({
  killProcessTree: mocks.killProcessTree,
  isProcessAlive: () => false,
}));

vi.mock('../../src/core/management-api/daemon-probe.js', () => ({
  IDENTIFIED_DAEMON_KILL_GRACE_MS: 10_000,
  probeDaemonPort: mocks.probeDaemonPort,
  probeDaemon: vi.fn(),
  resolveDefaultDaemonPort: () => 8791,
  waitForDaemonPortFree: vi.fn(async () => true),
}));

describe('half-started daemon readiness cleanup', () => {
  let root: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-half-started-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = root;
    mocks.killProcessTree.mockReset();
    mocks.probeDaemonPort.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    fs.rmSync(root, { recursive: true, force: true });
    vi.resetModules();
  });

  it('times out boundedly and reaps only the child it spawned when readiness never appears', async () => {
    const { spawnDaemonDetached } = await import('../../src/commands/daemon.js');
    const pending = spawnDaemonDetached(19091, '0.2.0-test');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
      message: expect.stringContaining('Timed out waiting for the daemon'),
    });
    expect(mocks.probeDaemonPort).toHaveBeenCalledTimes(60);
    expect(mocks.killProcessTree).toHaveBeenCalledTimes(1);
    expect(mocks.killProcessTree).toHaveBeenCalledWith(24680);
  });
});
