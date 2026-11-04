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
 * confirmed: it surfaces immediately rather than backing off), so this drives
 * the retry loop itself with real awaited delays between attempts.
 *
 * Resource owners must still be awaited before cleanup starts; retries only
 * cover the bounded OS/antivirus release tail after that owner closes. A
 * genuinely stuck handle surfaces as a thrown error rather than hanging
 * forever.
 */
export async function cleanupTempPathAsync(
  target: string | undefined,
  options: {
    maxRetries?: number;
    retryDelayMs?: number;
    /** Deterministic test seam for transient filesystem failures. */
    removePath?: (target: string) => void;
    /** Deterministic test seam for release/backoff ordering. */
    wait?: (delayMs: number) => Promise<void>;
  } = {}
): Promise<void> {
  if (!target) {
    return;
  }
  const maxRetries = options.maxRetries ?? 15;
  const retryDelayMs = options.retryDelayMs ?? 200;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError('maxRetries must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError('retryDelayMs must be a non-negative safe integer');
  }

  const removePath =
    options.removePath ??
    ((pathToRemove: string) => fs.rmSync(pathToRemove, { recursive: true, force: true }));
  const wait =
    options.wait ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; ; attempt++) {
    try {
      removePath(target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Match Node's documented recursive-rm transient set. EMFILE/ENFILE can
      // appear only under a long repository run, so treating them as permanent
      // makes focused tests misleadingly green.
      const retryable =
        code === 'EPERM' ||
        code === 'EBUSY' ||
        code === 'ENOTEMPTY' ||
        code === 'EMFILE' ||
        code === 'ENFILE';
      if (!retryable || attempt >= maxRetries) throw err;
      await wait(retryDelayMs);
    }
  }
}
