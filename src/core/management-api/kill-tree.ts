/**
 * Cross-platform process-tree kill (design D5, adapted from omnicross
 * `packages/cli-launcher/src/kill-tree.ts`). POSIX: `detached: true` at
 * spawn time makes the supervised child the leader of its own process
 * group, so `-pid` reaches the whole tree; SIGTERM first, SIGKILL after a
 * grace period if the group hasn't gone. Windows: `taskkill /T` (tree) then
 * `/F /T` (forced tree) after the same grace period. `ESRCH` / already-dead
 * is silent success in both cases — killing something already gone is not
 * an error here.
 */
import { spawn as spawnProcess } from 'node:child_process';

const IS_WINDOWS = process.platform === 'win32';

export interface KillTreeOptions {
  /** Grace period between the graceful signal and the forced one (ms). */
  graceMs?: number;
}

const DEFAULT_GRACE_MS = 5_000;

/** Whether a process with `pid` is still alive, via the no-op signal-0 probe. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initiates a graceful-then-forced kill of the process tree rooted at
 * `pid`. Fire-and-forget: does not wait for the tree to actually die (the
 * supervisor keys escalation and finalization off the supervised child's
 * own `close` event, never off this function). The escalation timer is
 * `unref()`'d so it never keeps the server process alive on its own, and is
 * cancellable so the supervisor can cancel it once the child's `close`
 * fires before the grace period elapses.
 *
 * @returns a `cancel()` to stop the pending forced-kill escalation (e.g.
 * once the caller has observed the child actually close).
 */
export function killProcessTree(pid: number, options: KillTreeOptions = {}): { cancel: () => void } {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;

  if (IS_WINDOWS) {
    return killTreeWindows(pid, graceMs);
  }
  return killTreeUnix(pid, graceMs);
}

function killTreeUnix(pid: number, graceMs: number): { cancel: () => void } {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      // Best-effort: an unexpected error signalling the group is not fatal
      // to the caller — the escalation timer below is still armed in case
      // the group is in fact still there.
    }
  }

  const timer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        // Already gone or inaccessible — nothing further to do.
      }
    }
  }, graceMs);
  timer.unref?.();

  return { cancel: () => clearTimeout(timer) };
}

/**
 * Exported (rather than kept private) so the Windows branch can be unit-
 * tested via `taskkill` injection (task 3.5: "no real taskkill in CI") —
 * this repo's CI does not necessarily run on win32, and `killProcessTree`
 * itself only dispatches here when `process.platform === 'win32'`.
 */
export function killTreeWindows(pid: number, graceMs: number): { cancel: () => void } {
  try {
    spawnProcess('taskkill', ['/T', '/PID', String(pid)], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      shell: false,
    }).unref();
  } catch {
    // Best-effort graceful attempt; the forced escalation below still fires.
  }

  const timer = setTimeout(() => {
    if (!isProcessAlive(pid)) return;
    try {
      spawnProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      }).unref();
    } catch {
      // Nothing further we can do from here.
    }
  }, graceMs);
  timer.unref?.();

  return { cancel: () => clearTimeout(timer) };
}
