import * as fs from 'node:fs';

export function cleanupTempPath(target: string | undefined): void {
  if (!target) {
    return;
  }

  fs.rmSync(target, {
    recursive: true,
    force: true,
    // Bounded retries with a short backoff (design D3): a still-dying child
    // holding this directory as its cwd (or its Windows `taskkill /F`
    // escalation still in flight) can outlive a shorter budget, but a
    // genuinely stuck handle must still surface rather than hang forever.
    maxRetries: 15,
    retryDelay: 200,
  });
}

/**
 * Async sibling of `cleanupTempPath` (design D3): `fs.rmSync`'s own
 * `maxRetries`/`retryDelay` option does not reliably retry the specific
 * "directory is a still-live child process's cwd" EPERM on Windows (empirically
 * confirmed — it surfaces immediately rather than backing off), so this
 * drives the retry loop itself with real awaited delays between attempts.
 * Use this (over the sync `cleanupTempPath`) whenever the afterEach can be
 * async and the test does not itself wait for its own spawned child to
 * exit before teardown. Still bounded — a genuinely stuck handle surfaces
 * as a thrown error rather than hanging forever.
 */
export async function cleanupTempPathAsync(
  target: string | undefined,
  options: { maxRetries?: number; retryDelayMs?: number } = {}
): Promise<void> {
  if (!target) {
    return;
  }
  const maxRetries = options.maxRetries ?? 15;
  const retryDelayMs = options.retryDelayMs ?? 200;

  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY';
      if (!retryable || attempt >= maxRetries) throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
