import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  acquireFileLock,
  acquireOwnerAwareFileLock,
  machineLockPath,
  releaseFileLock,
  releaseOwnerAwareFileLock,
  writeFileAtomically,
  withOwnerAwareFileLock,
} from '../../src/core/file-state.js';
import { updateStoreRegistryState } from '../../src/core/store/index.js';

describe('file-state', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-file-state-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function errorFor(
    kind: 'create-failed' | 'timeout',
    info: { lockPath: string; cause?: unknown }
  ): Error {
    return new Error(`${kind}:${info.lockPath}`);
  }

  // posix-only: these induce a lock-create failure via chmod(0o555), which
  // win32 ignores for directories, so the lock would succeed instead of
  // rejecting. The production error shapes are platform-agnostic.
  const itPosix = it.skipIf(process.platform === 'win32');

  describe('writeFileAtomically', () => {
    it('writes content and creates parent directories', async () => {
      const target = path.join(tempDir, 'nested', 'state.yaml');

      await writeFileAtomically(target, 'version: 1\n');

      expect(fs.readFileSync(target, 'utf-8')).toBe('version: 1\n');
    });

    it('leaves no temp file behind after a write', async () => {
      const target = path.join(tempDir, 'state.yaml');

      await writeFileAtomically(target, 'a\n');
      await writeFileAtomically(target, 'b\n');

      expect(fs.readFileSync(target, 'utf-8')).toBe('b\n');
      expect(fs.readdirSync(tempDir)).toEqual(['state.yaml']);
    });
  });

  describe('acquireFileLock', () => {
    it('acquires and releases the lock file', async () => {
      const lockPath = path.join(tempDir, 'state.yaml.lock');

      const lock = await acquireFileLock({ lockPath, errorFor });
      expect(fs.existsSync(lockPath)).toBe(true);

      await releaseFileLock(lock, lockPath);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('steals a stale lock', async () => {
      const lockPath = path.join(tempDir, 'state.yaml.lock');
      fs.writeFileSync(lockPath, '');
      const staleTime = new Date(Date.now() - 60_000);
      fs.utimesSync(lockPath, staleTime, staleTime);

      const lock = await acquireFileLock({ lockPath, errorFor });

      expect(fs.existsSync(lockPath)).toBe(true);
      await releaseFileLock(lock, lockPath);
    });

    itPosix('reports lock-create failures through the injected factory', async () => {
      // A directory at the lock path makes open(wx) fail with a
      // non-EEXIST-style conflict on every platform... except that a
      // directory yields EEXIST too; use an unwritable parent instead.
      const parent = path.join(tempDir, 'no-write');
      fs.mkdirSync(parent);
      fs.chmodSync(parent, 0o555);
      const lockPath = path.join(parent, 'state.yaml.lock');

      try {
        await expect(
          acquireFileLock({ lockPath, errorFor })
        ).rejects.toThrowError(`create-failed:${lockPath}`);
      } finally {
        fs.chmodSync(parent, 0o755);
      }
    });
  });

  describe('store registry delegation (byte-identical error shapes)', () => {
    it('reports a fresh contended lock as busy after the deadline', async () => {
      const globalDataDir = path.join(tempDir, 'data');
      const registryPath = path.join(
        globalDataDir,
        'stores',
        'registry.yaml'
      );
      const lockPath = `${registryPath}.lock`;
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(lockPath, '');

      const started = Date.now();
      try {
        await expect(
          updateStoreRegistryState((state) => state ?? { version: 1, stores: {} }, {
            globalDataDir,
          })
        ).rejects.toMatchObject({
          message: 'Store registry is busy.',
          diagnostic: {
            severity: 'error',
            code: 'store_registry_busy',
            message: 'Store registry is busy.',
            target: 'store.registry',
            fix: `Retry shortly; if this persists, delete the stale lock file ${lockPath}.`,
          },
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
      } finally {
        fs.rmSync(lockPath, { force: true });
      }
    }, 15_000);

    itPosix('reports lock-create failure with the permissions fix', async () => {
      const globalDataDir = path.join(tempDir, 'data');
      const storesDir = path.join(globalDataDir, 'stores');
      const registryPath = path.join(storesDir, 'registry.yaml');
      const lockPath = `${registryPath}.lock`;
      fs.mkdirSync(storesDir, { recursive: true });
      fs.chmodSync(storesDir, 0o555);

      try {
        await expect(
          updateStoreRegistryState((state) => state ?? { version: 1, stores: {} }, {
            globalDataDir,
          })
        ).rejects.toMatchObject({
          message: `Cannot create the registry lock file ${lockPath} (EACCES).`,
          diagnostic: {
            code: 'store_registry_busy',
            target: 'store.registry',
            fix: `Check permissions on ${path.dirname(lockPath)}.`,
          },
        });
      } finally {
        fs.chmodSync(storesDir, 0o755);
      }
    });
  });
});

describe('owner-aware file lock', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-owner-lock-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function errorFor(
    kind: 'create-failed' | 'timeout',
    info: { lockPath: string; cause?: unknown }
  ): Error {
    return new Error(`${kind}:${info.lockPath}`);
  }

  it('acquires and releases with a populated token', async () => {
    const lockPath = path.join(tempDir, 'owner.lock');

    const handle = await acquireOwnerAwareFileLock({ lockPath, errorFor });

    const content = fs.readFileSync(lockPath, 'utf-8');
    expect(content).toMatch(/^pid: \d+$/m);
    expect(content).toMatch(/^bornAt: /m);
    expect(content).toMatch(/^holder: unnamed$/m);
    expect(content).toMatch(/^nonce: [0-9a-f]{32}$/m);

    await releaseOwnerAwareFileLock(handle);

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('uses the provided holder label in the token', async () => {
    const lockPath = path.join(tempDir, 'labeled.lock');

    const handle = await acquireOwnerAwareFileLock({
      lockPath,
      errorFor,
      holder: 'test-suite',
    });

    expect(fs.readFileSync(lockPath, 'utf-8')).toMatch(/^holder: test-suite$/m);
    await releaseOwnerAwareFileLock(handle);
  });

  it('steals a lock whose owner PID is provably dead (ESRCH)', async () => {
    const lockPath = path.join(tempDir, 'dead-pid.lock');
    // Spawn a child just to obtain a PID that immediately exits.
    const child = spawn(process.execPath, ['--eval', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child did not start');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    // Write a lock file that claims the now-dead PID.
    const deadToken = [
      `pid: ${deadPid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: dead-process',
      'nonce: deadbeefdeadbeefdeadbeefdeadbeef',
      '',
    ].join('\n');
    fs.writeFileSync(lockPath, deadToken, 'utf-8');

    // Acquire should steal quickly (within one poll interval).
    const started = Date.now();
    const handle = await acquireOwnerAwareFileLock({
      lockPath,
      errorFor,
      pollMs: 10,
      deadlineMs: 2000,
    });
    expect(Date.now() - started).toBeLessThan(1500);

    // New lock content differs from the dead token.
    expect(handle.token).not.toBe(deadToken);
    await releaseOwnerAwareFileLock(handle);
  });

  it('does NOT steal a lock whose owner PID is alive (times out)', async () => {
    const lockPath = path.join(tempDir, 'alive-pid.lock');
    // Write a lock claiming OUR OWN pid (definitely alive).
    const aliveToken = [
      `pid: ${process.pid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: self',
      'nonce: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '',
    ].join('\n');
    fs.writeFileSync(lockPath, aliveToken, 'utf-8');

    const started = Date.now();
    await expect(
      acquireOwnerAwareFileLock({
        lockPath,
        errorFor,
        deadlineMs: 300,
        pollMs: 50,
      })
    ).rejects.toThrow('timeout');
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);

    // Lock file is untouched (never stolen).
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(aliveToken);
  });

  it('does NOT steal an empty (unparseable) lock', async () => {
    const lockPath = path.join(tempDir, 'empty.lock');
    fs.writeFileSync(lockPath, '', 'utf-8');

    await expect(
      acquireOwnerAwareFileLock({
        lockPath,
        errorFor,
        deadlineMs: 200,
        pollMs: 40,
      })
    ).rejects.toThrow('timeout');

    // Empty lock survives — never deleted.
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe('');
  });

  it('does NOT steal an unparseable (no pid line) lock', async () => {
    const lockPath = path.join(tempDir, 'garbage.lock');
    fs.writeFileSync(lockPath, 'not a valid lock file\n', 'utf-8');

    await expect(
      acquireOwnerAwareFileLock({
        lockPath,
        errorFor,
        deadlineMs: 200,
        pollMs: 40,
      })
    ).rejects.toThrow('timeout');

    expect(fs.readFileSync(lockPath, 'utf-8')).toBe('not a valid lock file\n');
  });

  it('does not unlink on release when the token content changed', async () => {
    const lockPath = path.join(tempDir, 'replaced.lock');
    const handle = await acquireOwnerAwareFileLock({ lockPath, errorFor });

    // Simulate another owner stealing and rewriting the lock.
    const replacementToken = [
      `pid: ${process.pid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: other',
      'nonce: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '',
    ].join('\n');
    // Delete and rewrite to simulate the steal-and-recreate path.
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, replacementToken, 'utf-8');

    await releaseOwnerAwareFileLock(handle);

    // The replacement lock survives — our release detected the mismatch.
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(replacementToken);
  });

  it('does not unlink on release when the lock file is already gone', async () => {
    const lockPath = path.join(tempDir, 'gone.lock');
    const handle = await acquireOwnerAwareFileLock({ lockPath, errorFor });

    fs.unlinkSync(lockPath);

    // Should not throw.
    await releaseOwnerAwareFileLock(handle);

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('withOwnerAwareFileLock runs the action and releases the lock', async () => {
    const lockPath = path.join(tempDir, 'scoped.lock');

    const result = await withOwnerAwareFileLock({ lockPath, errorFor }, async () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      return 42;
    });

    expect(result).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('withOwnerAwareFileLock releases the lock even when the action throws', async () => {
    const lockPath = path.join(tempDir, 'throwing.lock');

    await expect(
      withOwnerAwareFileLock({ lockPath, errorFor }, async () => {
        throw new Error('action failed');
      })
    ).rejects.toThrow('action failed');

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('serializes two concurrent callers via the same lock path', async () => {
    const lockPath = path.join(tempDir, 'contended.lock');
    const log: string[] = [];

    const [a, b] = await Promise.all([
      withOwnerAwareFileLock(
        { lockPath, errorFor, deadlineMs: 5000, pollMs: 10 },
        async () => {
          log.push('A-start');
          await new Promise((r) => setTimeout(r, 100));
          log.push('A-end');
          return 'a';
        }
      ),
      // Small delay so A acquires first; otherwise B might win the race.
      (async () => {
        await new Promise((r) => setTimeout(r, 10));
        return withOwnerAwareFileLock(
          { lockPath, errorFor, deadlineMs: 5000, pollMs: 10 },
          async () => {
            log.push('B-start');
            log.push('B-end');
            return 'b';
          }
        );
      })(),
    ]);

    expect([a, b]).toEqual(['a', 'b']);
    // A fully completed before B started — serialized.
    expect(log).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  // --- B1 regression: rename-based atomic steal ---

  it('two concurrent stealers of a dead-owner lock: exactly one claims, the other waits', async () => {
    const lockPath = path.join(tempDir, 'dual-steal.lock');
    // Spawn a child just to obtain a PID that immediately exits.
    const child = spawn(process.execPath, ['--eval', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child did not start');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    const deadToken = [
      `pid: ${deadPid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: dead-process',
      'nonce: deadbeefdeadbeefdeadbeefdeadbeef',
      '',
    ].join('\n');
    fs.writeFileSync(lockPath, deadToken, 'utf-8');

    // Monkey-patch unlink to delay the FIRST call targeting lockPath by
    // 20ms. On pre-fix code (which uses unlink in the steal path), this
    // creates a deterministic race: the stealer whose unlink fires first
    // (undelayed, 2nd call) deletes the dead lock and creates its own
    // LIVE lock; then the delayed 1st call fires and deletes that LIVE
    // lock — both stealers enter the critical section. On post-fix code
    // the steal path uses rename, so unlink(lockPath) is never called in
    // the steal path and this patch is inert.
    const origUnlink = fs.promises.unlink;
    let firstLockPathUnlink = true;
    fs.promises.unlink = (async (p: string) => {
      if (firstLockPathUnlink && p === lockPath) {
        firstLockPathUnlink = false;
        await new Promise((r) => setTimeout(r, 20));
      }
      return origUnlink(p);
    }) as typeof fs.promises.unlink;

    try {
      const log: string[] = [];
      async function stealAndHold(label: string, holdMs: number): Promise<string> {
        const handle = await acquireOwnerAwareFileLock({
          lockPath,
          errorFor,
          pollMs: 0,
          deadlineMs: 5000,
          holder: label,
        });
        log.push(`${label}:enter`);
        try {
          await new Promise((r) => setTimeout(r, holdMs));
          return label;
        } finally {
          await releaseOwnerAwareFileLock(handle);
          log.push(`${label}:exit`);
        }
      }

      const [a, b] = await Promise.all([stealAndHold('A', 60), stealAndHold('B', 60)]);
      expect(new Set([a, b])).toEqual(new Set(['A', 'B']));

      // Verify serialized access: the second enter must come after the
      // first exit — no two simultaneous holders.
      expect(log.filter((e) => e.endsWith(':enter'))).toHaveLength(2);
      expect(log.filter((e) => e.endsWith(':exit'))).toHaveLength(2);
      const exits = log.map((e, i) => ({ e, i })).filter((x) => x.e.endsWith(':exit'));
      const enters = log.map((e, i) => ({ e, i })).filter((x) => x.e.endsWith(':enter'));
      expect(enters[1].i).toBeGreaterThan(exits[0].i);
    } finally {
      fs.promises.unlink = origUnlink;
    }
  }, 10_000);

  it('does NOT busy-loop when the rename claim consistently fails (respects deadline)', async () => {
    const lockPath = path.join(tempDir, 'eperm-steal.lock');
    const child = spawn(process.execPath, ['--eval', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child did not start');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    const deadToken = [
      `pid: ${deadPid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: dead-process',
      'nonce: deadbeefdeadbeefdeadbeefdeadbeef',
      '',
    ].join('\n');
    fs.writeFileSync(lockPath, deadToken, 'utf-8');

    // Monkey-patch rename to always reject with EPERM, simulating a
    // filesystem that refuses the atomic claim. On the pre-fix code
    // (which uses unlink, not rename), the steal succeeds and the acquire
    // resolves — making this test deterministically red on 728688ba.
    const origRename = fs.promises.rename;
    let renameAttempts = 0;
    fs.promises.rename = async () => {
      renameAttempts++;
      const err = new Error('synthetic EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    };
    try {
      const started = Date.now();
      await expect(
        acquireOwnerAwareFileLock({
          lockPath,
          errorFor,
          deadlineMs: 300,
          pollMs: 50,
        })
      ).rejects.toThrow('timeout');
      const elapsed = Date.now() - started;
      // Must have respected the deadline + sleep, not spun instantly.
      expect(elapsed).toBeGreaterThanOrEqual(250);
      // Must have attempted multiple times (looped with sleeps, not exited).
      expect(renameAttempts).toBeGreaterThan(1);
    } finally {
      fs.promises.rename = origRename;
    }
  });

  it('stealer that renames a replaced lock restores it and waits', async () => {
    const lockPath = path.join(tempDir, 'mismatch-restore.lock');
    const child = spawn(process.execPath, ['--eval', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child did not start');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    const deadToken = [
      `pid: ${deadPid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: dead-process',
      'nonce: deadbeefdeadbeefdeadbeefdeadbeef',
      '',
    ].join('\n');
    fs.writeFileSync(lockPath, deadToken, 'utf-8');

    // Intercept the first rename of lockPath: replace the lock content
    // just before the rename happens, simulating another stealer that won
    // the race between our read and our rename.
    const origRename = fs.promises.rename;
    let intercepted = false;
    fs.promises.rename = (async (src: string, dest: string) => {
      if (!intercepted && src === lockPath) {
        intercepted = true;
        const replacementToken = [
          `pid: ${process.pid}`,
          `bornAt: ${new Date().toISOString()}`,
          'holder: other-stealer',
          'nonce: cccccccccccccccccccccccccccccccc',
          '',
        ].join('\n');
        fs.writeFileSync(lockPath, replacementToken, 'utf-8');
      }
      return origRename(src, dest);
    }) as typeof fs.promises.rename;
    try {
      // The stealer detects the content mismatch after rename, restores
      // the moved file, and does NOT steal. Since the restored lock has a
      // live PID (ours), the stealer times out.
      const started = Date.now();
      await expect(
        acquireOwnerAwareFileLock({
          lockPath,
          errorFor,
          deadlineMs: 300,
          pollMs: 50,
          holder: 'test-stealer',
        })
      ).rejects.toThrow('timeout');
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);

      // The lock file survives with the replacement content (restored,
      // not deleted by the mismatched stealer).
      expect(fs.readFileSync(lockPath, 'utf-8')).toMatch(
        /^holder: other-stealer$/m
      );
    } finally {
      fs.promises.rename = origRename;
    }
  });

  it('restores the moved file when temp re-read fails after rename (m2)', async () => {
    const lockPath = path.join(tempDir, 'readfail-steal.lock');
    const child = spawn(process.execPath, ['--eval', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const deadPid = child.pid;
    if (deadPid === undefined) throw new Error('child did not start');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));

    const deadToken = [
      `pid: ${deadPid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: dead-process',
      'nonce: deadbeefdeadbeefdeadbeefdeadbeef',
      '',
    ].join('\n');
    fs.writeFileSync(lockPath, deadToken, 'utf-8');

    // Monkey-patch readFile to fail on any .steal-tmp path (the temp file
    // the rename-based claim moves the lock to). Without the m2 fix, the
    // readFile error is caught by the outer catch, lockPath is left empty
    // (the moved file is never restored), and the next loop iteration
    // succeeds at open(lockPath, 'wx') — creating a new lock on top of
    // the empty path. With the fix, the moved file is restored and the
    // caller times out.
    const origReadFile = fs.promises.readFile;
    fs.promises.readFile = (async (p: unknown, ...args: unknown[]) => {
      if (typeof p === 'string' && p.includes('.steal-tmp')) {
        const err = new Error('synthetic EIO') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      }
      return (origReadFile as (...a: unknown[]) => unknown)(p, ...args);
    }) as typeof fs.promises.readFile;

    try {
      const started = Date.now();
      await expect(
        acquireOwnerAwareFileLock({
          lockPath,
          errorFor,
          deadlineMs: 300,
          pollMs: 50,
        })
      ).rejects.toThrow('timeout');
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);

      // The moved file was restored — lockPath is not empty, and still
      // holds the dead-owner token (not a new lock created by this caller).
      const surviving = fs.readFileSync(lockPath, 'utf-8');
      expect(surviving).toBe(deadToken);
    } finally {
      fs.promises.readFile = origReadFile;
    }
  });

  it('machineLockPath returns a deterministic path under os.tmpdir()', () => {
    const abs = path.resolve(tempDir, 'some-file.yaml');
    const lockPath = machineLockPath(abs);

    // Always under tmpdir/rasen-locks.
    expect(lockPath.startsWith(path.join(os.tmpdir(), 'rasen-locks'))).toBe(true);
    expect(lockPath.endsWith('.lock')).toBe(true);

    // Deterministic for the same input.
    expect(machineLockPath(abs)).toBe(lockPath);

    // Different inputs produce different paths.
    const other = machineLockPath(path.resolve(tempDir, 'other-file.yaml'));
    expect(other).not.toBe(lockPath);
  });
});
