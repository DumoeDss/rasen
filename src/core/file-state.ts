import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSystemUtils } from '../utils/file-system.js';
import { StoreError } from './store/errors.js';

const fs = nodeFs.promises;

/**
 * Shared machine-local state-file mechanics (extracted from the store
 * registry in slice 7.1, its second consumer). Callers own the
 * diagnostic data (code, target, wording); the factory owns the
 * shared mechanics - the fix strings describe the lock's own
 * behavior (stale-steal, creation), so their templates live here.
 */

export type FileLockErrorKind = 'create-failed' | 'timeout';

export interface FileLockErrorInfo {
  lockPath: string;
  /** The original errno error for 'create-failed'. */
  cause?: unknown;
}

export interface FileLockOptions {
  lockPath: string;
  errorFor: (kind: FileLockErrorKind, info: FileLockErrorInfo) => Error;
}

export interface LockErrorData {
  /** Noun phrase for the create-failed message, e.g. "the registry lock file". */
  createSubject: string;
  /** The full timeout message, e.g. "Store registry is busy." */
  busyMessage: string;
  code: string;
  target: string;
}

/** One template for lock diagnostics; callers supply the data. */
export function makeLockErrorFactory(
  data: LockErrorData
): (kind: FileLockErrorKind, info: FileLockErrorInfo) => StoreError {
  return (kind, info) => {
    if (kind === 'create-failed') {
      // A permission or filesystem problem, not contention - say so.
      return new StoreError(
        `Cannot create ${data.createSubject} ${info.lockPath} (${(info.cause as NodeJS.ErrnoException)?.code ?? info.cause}).`,
        data.code,
        {
          target: data.target,
          fix: `Check permissions on ${path.dirname(info.lockPath)}.`,
        }
      );
    }

    return new StoreError(data.busyMessage, data.code, {
      target: data.target,
      fix: `Retry shortly; if this persists, delete the stale lock file ${info.lockPath}.`,
    });
  };
}

const STALE_LOCK_THRESHOLD_MS = 30_000;
const LOCK_DEADLINE_MS = 5000;
const LOCK_POLL_MS = 25;

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export async function pathIsFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

// Deliberately not FileSystemUtils.directoryExists: that variant
// debug-logs non-ENOENT failures, which is noise inside prompt
// validators, and pathIsFile has no FileSystemUtils equivalent - the
// silent symmetric pair lives here.
export async function pathIsDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function writeFileAtomically(
  filePath: string,
  content: string
): Promise<void> {
  const dirPath = path.dirname(filePath);
  await FileSystemUtils.createDirectory(dirPath);
  const tempPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );

  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function acquireFileLock(
  options: FileLockOptions
): Promise<nodeFs.promises.FileHandle> {
  const { lockPath, errorFor } = options;
  const lockDir = path.dirname(lockPath);
  await FileSystemUtils.createDirectory(lockDir);
  if (!(await FileSystemUtils.canWriteFile(lockDir))) {
    throw errorFor('create-failed', { lockPath, cause: 'EACCES' });
  }
  const deadline = Date.now() + LOCK_DEADLINE_MS;

  while (true) {
    try {
      return await fs.open(lockPath, 'wx');
    } catch (error) {
      if (!isNodeErrorCode(error, 'EEXIST')) {
        // A permission or filesystem problem, not contention - say so.
        throw errorFor('create-failed', { lockPath, cause: error });
      }

      // A crashed process leaves the lock behind forever; state-file
      // writes are sub-second, so an old lock is an orphan - steal it.
      let staleStolen = false;
      try {
        const lockStat = await fs.stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
          await fs.rm(lockPath, { force: true });
          staleStolen = true;
        }
      } catch {
        // The holder released between open and stat - retry, but stay
        // bounded: a persistently failing stat (EPERM, delete-pending)
        // must hit the deadline instead of spinning forever.
      }

      if (!staleStolen) {
        if (Date.now() >= deadline) {
          throw errorFor('timeout', { lockPath });
        }
        await sleep(LOCK_POLL_MS);
      }
    }
  }
}

export async function releaseFileLock(
  lock: nodeFs.promises.FileHandle,
  lockPath: string
): Promise<void> {
  await lock.close().catch(() => undefined);
  await fs.rm(lockPath, { force: true }).catch(() => undefined);
}

// -----------------------------------------------------------------------------
// Owner-aware lock primitive
//
// The legacy `acquireFileLock` above treats any lock older than 30 s as stale
// based on mtime alone. That is correct for sub-second callers (registry,
// project registry, pipeline library, workflows, worksets, named profiles,
// learned-skills mutate) but cannot protect read-modify-write transactions
// that legitimately exceed 30 s (e.g. importing a large knowledge bundle
// across a slow disk). The owner-aware primitive below NEVER relies on mtime:
// it determines "stale" exclusively from provable owner death (PID liveness),
// and on release it removes the lock file only when its content still matches
// the unique token this holder wrote. The shape mirrors
// `withSchemeLock`/`releaseSchemeLock` in `src/core/threshold-schemes.ts`,
// generalized and extended with PID-dead stale-stealing.
// -----------------------------------------------------------------------------

const OWNER_AWARE_LOCK_DEFAULT_DEADLINE_MS = 5_000;
const OWNER_AWARE_LOCK_DEFAULT_POLL_MS = 50;

export interface OwnerAwareFileLockOptions {
  lockPath: string;
  errorFor: (kind: FileLockErrorKind, info: FileLockErrorInfo) => Error;
  /** Maximum total wait before throwing `errorFor('timeout', ...)`. */
  deadlineMs?: number;
  /** Sleep between acquire retries when the existing holder is alive. */
  pollMs?: number;
  /** Human-readable label written into the lock content for operators. */
  holder?: string;
}

export interface OwnerAwareFileLockHandle {
  lockPath: string;
  fd: nodeFs.promises.FileHandle;
  /** The entire lock-file content this holder wrote. */
  token: string;
  /** `dev` from `fstat` at acquire time. `0n` on Windows NTFS. */
  dev: bigint;
  /** `ino` from `fstat` at acquire time. `0n` on Windows NTFS. */
  ino: bigint;
}

function buildOwnerAwareLockToken(holder: string): string {
  return [
    `pid: ${process.pid}`,
    `bornAt: ${new Date().toISOString()}`,
    `holder: ${holder}`,
    `nonce: ${randomBytes(16).toString('hex')}`,
    '',
  ].join('\n');
}

function parsePidFromLockContent(content: string): number | undefined {
  const match = content.match(/^pid:\s*(\d+)/m);
  if (!match) return undefined;
  const pid = Number(match[1]);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

/**
 * Returns true when the pid is alive OR we cannot prove it is dead. Returns
 * false ONLY on ESRCH (the kernel's affirmative "no such process"). EPERM
 * (PID exists but not signalable by this user) is treated as alive. Any
 * unexpected error code is also treated as alive — we never steal on
 * ambiguity.
 */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    return true;
  }
}

function isTransientWindowsLockOpenError(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  return ['EPERM', 'EACCES', 'EBUSY'].some((code) =>
    isNodeErrorCode(error, code)
  );
}

export async function acquireOwnerAwareFileLock(
  options: OwnerAwareFileLockOptions
): Promise<OwnerAwareFileLockHandle> {
  const {
    lockPath,
    errorFor,
    deadlineMs = OWNER_AWARE_LOCK_DEFAULT_DEADLINE_MS,
    pollMs = OWNER_AWARE_LOCK_DEFAULT_POLL_MS,
    holder = 'unnamed',
  } = options;
  const lockDir = path.dirname(lockPath);
  await FileSystemUtils.createDirectory(lockDir);
  if (!(await FileSystemUtils.canWriteFile(lockDir))) {
    throw errorFor('create-failed', { lockPath, cause: 'EACCES' });
  }

  const deadline = Date.now() + deadlineMs;
  // Loop: each iteration either acquires, decides wait-vs-steal on EEXIST, or
  // throws on timeout / unrecoverable create failure.
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      const token = buildOwnerAwareLockToken(holder);
      try {
        await handle.writeFile(token, 'utf-8');
        const stat = await handle.stat({ bigint: true });
        return { lockPath, fd: handle, token, dev: stat.dev, ino: stat.ino };
      } catch (error) {
        // We created the lock file but failed to populate it; remove our own
        // orphan so the next attempt does not see an empty lock and wait
        // forever against an unreadable holder.
        await handle.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (!isNodeErrorCode(error, 'EEXIST')) {
        // Windows can report sharing violations as EPERM/EACCES/EBUSY while
        // another contender is renaming, deleting, or still closing the lock.
        // The directory write preflight already ruled out the common
        // permission failure, so retry these transient codes within the same
        // bounded deadline instead of misreporting contention as
        // create-failed.
        if (isTransientWindowsLockOpenError(error)) {
          if (Date.now() >= deadline) {
            throw errorFor('timeout', { lockPath });
          }
          await sleep(Math.max(1, pollMs));
          continue;
        }
        throw errorFor('create-failed', { lockPath, cause: error });
      }

      // Lock exists. Decide wait vs. steal based on the OWNER's liveness,
      // never on mtime. A provably dead owner (ESRCH) lets us steal; anything
      // else (alive, EPERM, empty/unparseable content) means wait + retry.
      let stolen = false;
      try {
        const content = await fs.readFile(lockPath, 'utf-8');
        const ownerPid = parsePidFromLockContent(content);
        if (ownerPid !== undefined && !pidIsAlive(ownerPid)) {
          // Provable owner death (ESRCH). Claim the dead lock atomically
          // via rename: only one stealer can succeed (others get ENOENT),
          // and after the move we verify the content in private — no
          // further race on lockPath. (design D1)
          const tempPath = path.join(
            path.dirname(lockPath),
            `.${path.basename(lockPath)}.${process.pid}.${Date.now()}.${randomBytes(8).toString('hex')}.steal-tmp`
          );
          try {
            await fs.rename(lockPath, tempPath);
            // Rename succeeded — the file at lockPath is now gone (moved
            // to tempPath). We must either verify+claim it or restore it.
            let movedContent: string | undefined;
            try {
              movedContent = await fs.readFile(tempPath, 'utf-8');
            } catch {
              // Could not re-read the moved file. Treat identically to
              // a content mismatch: cannot prove this was the dead lock,
              // so restore the moved file and wait. (m2)
            }
            if (movedContent === content) {
              // Verified: this was the dead lock at claim time. Clean up
              // the temp; the next loop iteration will try to create our
              // own lock (or retry if contended).
              await fs.unlink(tempPath).catch(() => undefined);
              stolen = true;
            } else {
              // The file at lockPath was replaced between our content
              // read and the rename (another stealer won and created a
              // new live lock, which we just moved), OR we could not
              // re-read the moved file to verify it. Either way, restore
              // the moved file so a live owner is not orphaned.
              try {
                await fs.link(tempPath, lockPath);
              } catch {
                // EEXIST: a new lock already appeared at lockPath —
                // nothing to restore. Any other error is also handled
                // by cleanup below; stolen stays false.
              }
              await fs.unlink(tempPath).catch(() => undefined);
              // stolen stays false — wait and retry.
            }
          } catch {
            // ENOENT: another stealer claimed the dead lock first.
            // Any other rename error: cannot claim. Either way, stolen
            // stays false — fall through to deadline + sleep. (design D2)
          }
        }
        // Empty/unparseable lock, or owner alive → fall through to wait.
      } catch {
        // Read failed (file removed between open and read, EACCES, ...).
        // Loop again: next wx open will either succeed or hit EEXIST once
        // more. We never steal when we cannot prove ownership.
      }

      if (!stolen) {
        if (Date.now() >= deadline) {
          throw errorFor('timeout', { lockPath });
        }
        await sleep(pollMs);
      }
    }
  }
}

export async function releaseOwnerAwareFileLock(
  handle: OwnerAwareFileLockHandle
): Promise<void> {
  // 1. Close our fd regardless of what follows.
  await handle.fd.close().catch(() => undefined);

  // 2. Re-stat: if the lock file's identity changed, someone already removed
  //    ours and possibly re-created their own. Walk away.
  try {
    const current = await fs.lstat(handle.lockPath, { bigint: true });
    if (current.dev !== handle.dev || current.ino !== handle.ino) return;
  } catch {
    // ENOENT (or any other stat failure): the lock is already gone. Done.
    return;
  }

  // 3. Token-content check: on Windows NTFS `ino === 0n` for every file, so
  //    the dev/ino check is necessary-but-insufficient. The token re-read is
  //    the actual guard against deleting a lock that was stolen-and-recreated
  //    while we held a stale fd.
  try {
    const content = await fs.readFile(handle.lockPath, 'utf-8');
    if (content !== handle.token) return;
  } catch {
    // Cannot prove ownership. Do nothing — never risk removing another
    // owner's lock.
    return;
  }

  // 4. Proven ownership. Safe to unlink.
  await fs.unlink(handle.lockPath).catch(() => undefined);
}

export async function withOwnerAwareFileLock<T>(
  options: OwnerAwareFileLockOptions,
  fn: () => Promise<T>
): Promise<T> {
  const handle = await acquireOwnerAwareFileLock(options);
  try {
    return await fn();
  } finally {
    await releaseOwnerAwareFileLock(handle);
  }
}

/**
 * Maps an absolute locked-file path to a deterministic lock-file path under
 * `os.tmpdir()`. Use this when the locked FILE itself lives inside a Git
 * repository (e.g. a Store's `.rasen-store/projects/<projectId>.yaml` or a
 * project's `rasen/config.yaml`): a sibling `.lock` would either pollute
 * commits or require a new `.gitignore` entry, neither acceptable for a
 * transient machine-local mutex. `os.tmpdir()` is per-user on Windows and
 * Linux, self-cleans on reboot, and never committable.
 */
export function machineLockPath(lockedAbsolutePath: string): string {
  const digest = createHash('sha256')
    .update(lockedAbsolutePath, 'utf-8')
    .digest('hex')
    .slice(0, 32);
  return path.join(os.tmpdir(), 'rasen-locks', `${digest}.lock`);
}
