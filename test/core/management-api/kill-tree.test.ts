import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { isProcessAlive, killProcessTree } from '../../../src/core/management-api/kill-tree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === 'win32';

describe('kill-tree (design D5)', () => {
  const spawned: ChildProcess[] = [];

  afterEach(() => {
    for (const child of spawned) {
      if (child.pid && isProcessAlive(child.pid)) {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    spawned.length = 0;
  });

  function spawnDetachedChild(script: string): ChildProcess {
    const child = spawn(process.execPath, ['-e', script], { detached: !IS_WINDOWS, stdio: 'ignore' });
    spawned.push(child);
    return child;
  }

  describe('isProcessAlive', () => {
    it('is true for the current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('is false for a pid that does not exist', () => {
      // A very high pid is exceedingly unlikely to be in use.
      expect(isProcessAlive(999_999)).toBe(false);
    });
  });

  it('terminates a normally-behaving detached child within the grace period', async () => {
    const child = spawnDetachedChild('setInterval(() => {}, 1000);');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(child.pid).toBeDefined();

    killProcessTree(child.pid!, { graceMs: 3000 });

    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect(isProcessAlive(child.pid!)).toBe(false);
  }, 10_000);

  it('is silent (no throw) when killing an already-dead pid', () => {
    expect(() => killProcessTree(999_999, { graceMs: 100 })).not.toThrow();
  });

  it('escalates to a forced kill when the child ignores the graceful signal', async () => {
    if (IS_WINDOWS) return; // SIGTERM ignoring is a POSIX-only behavior to fixture reliably.
    const child = spawnDetachedChild("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const before = Date.now();
    killProcessTree(child.pid!, { graceMs: 200 });

    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const elapsed = Date.now() - before;
    expect(isProcessAlive(child.pid!)).toBe(false);
    // Must not have died immediately from the (ignored) graceful signal —
    // the forced stage after the grace period is what actually ended it.
    expect(elapsed).toBeGreaterThanOrEqual(150);
  }, 10_000);

  it('the cancel handle disarms the pending forced kill', async () => {
    if (IS_WINDOWS) return;
    const child = spawnDetachedChild("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
    await new Promise((resolve) => setTimeout(resolve, 100));

    const handle = killProcessTree(child.pid!, { graceMs: 150 });
    handle.cancel();

    // Past the grace period, the forced stage never fired (it was
    // cancelled), so the SIGTERM-ignoring child is still alive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(isProcessAlive(child.pid!)).toBe(true);
  }, 10_000);
});
