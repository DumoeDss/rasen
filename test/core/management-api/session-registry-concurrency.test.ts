import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  acquireDurableSessionWakeLease,
  createDurableSessionRegistryStore,
  durableSessionWakeLockPath,
  nodeDurableRegistryFileSystem,
  type DurableRegistryFileSystem,
  type TrustedCanonicalRunRef,
} from '../../../src/core/management-api/session-registry.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const LOCK_HOLDER_FIXTURE = path.resolve(
  'test/fixtures/management-api/session-registry-lock-holder.mjs'
);

describe('durable reusable-session wake leases', () => {
  const temporaryPaths: string[] = [];
  const children: ChildProcess[] = [];

  function makeRun(): TrustedCanonicalRunRef {
    const canonicalRunDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-lease-'))
    );
    temporaryPaths.push(canonicalRunDir);
    return {
      kind: 'trusted-canonical-run',
      runId: 'run-lease',
      canonicalRunDir,
    };
  }

  async function waitForFile(filePath: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(filePath)) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${filePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await Promise.all(children.splice(0).map((child) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once('close', () => resolve());
      })
    ));
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  it('hashes raw logical keys and keeps different sessions independently lockable', async () => {
    const store = createDurableSessionRegistryStore({ run: makeRun() });
    const keyA = 'reviewer/../../raw key with spaces';
    const lockA = durableSessionWakeLockPath(store.paths, keyA);
    const lockB = durableSessionWakeLockPath(store.paths, 'other-session');

    expect(path.basename(lockA)).toMatch(/^[a-f0-9]{64}\.lock$/u);
    expect(lockA).not.toContain(keyA);
    expect(lockB).not.toBe(lockA);
    const posixLock = durableSessionWakeLockPath({
      canonicalRunDir: '/var/lib/rasen/runs/run-a',
      registryPath: '/var/lib/rasen/runs/run-a/sessions.json',
      mutationLockPath: '/var/lib/rasen/runs/run-a/sessions.json.lock',
      wakeLockDirectory: '/var/lib/rasen/runs/run-a/session-wake-locks',
    }, keyA, 'linux');
    expect(posixLock).toMatch(
      /^\/var\/lib\/rasen\/runs\/run-a\/session-wake-locks\/[a-f0-9]{64}\.lock$/u
    );

    const leaseA = await acquireDurableSessionWakeLease({
      store,
      sessionKey: keyA,
      ownerInstanceId: 'owner-a',
    });
    const leaseB = await acquireDurableSessionWakeLease({
      store,
      sessionKey: 'other-session',
      ownerInstanceId: 'owner-b',
    });
    expect(leaseA.ok).toBe(true);
    expect(leaseB.ok).toBe(true);
    if (leaseA.ok) await leaseA.lease.release();
    if (leaseB.ok) await leaseB.lease.release();
  });

  it('fails closed for a live or malformed owner and safely reclaims a proven dead owner', async () => {
    const store = createDurableSessionRegistryStore({ run: makeRun() });
    const first = await acquireDurableSessionWakeLease({
      store,
      sessionKey: 'same-session',
      ownerInstanceId: 'owner-a',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const liveContender = await acquireDurableSessionWakeLease({
      store,
      sessionKey: 'same-session',
      ownerInstanceId: 'owner-b',
      deadlineMs: 75,
      pollMs: 5,
    });
    expect(liveContender).toMatchObject({
      ok: false,
      diagnostic: { code: 'wake_busy', ownerState: 'live' },
    });
    await first.lease.release();

    const malformedPath = durableSessionWakeLockPath(store.paths, 'malformed');
    fs.mkdirSync(path.dirname(malformedPath), { recursive: true });
    fs.writeFileSync(malformedPath, 'not an owner token\n', 'utf-8');
    expect(await acquireDurableSessionWakeLease({
      store,
      sessionKey: 'malformed',
      ownerInstanceId: 'owner-c',
      deadlineMs: 50,
      pollMs: 5,
    })).toMatchObject({
      ok: false,
      diagnostic: { code: 'wake_lock_malformed', ownerState: 'malformed' },
    });
    expect(fs.readFileSync(malformedPath, 'utf-8')).toBe('not an owner token\n');

    const deadPath = durableSessionWakeLockPath(store.paths, 'dead-owner');
    fs.writeFileSync(deadPath, [
      'pid: 2147483647',
      'bornAt: 2026-07-30T09:00:00.000Z',
      'holder: dead-test-owner',
      `nonce: ${'d'.repeat(32)}`,
      '',
    ].join('\n'));
    const reclaimed = await acquireDurableSessionWakeLease({
      store,
      sessionKey: 'dead-owner',
      ownerInstanceId: 'owner-d',
      deadlineMs: 1000,
      pollMs: 5,
    });
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) await reclaimed.lease.release();
  });

  it('observes a real spawned owner and rejects the contender without stealing', async () => {
    const run = makeRun();
    const store = createDurableSessionRegistryStore({ run });
    const lockPath = durableSessionWakeLockPath(store.paths, 'cross-process');
    const readyPath = path.join(run.canonicalRunDir, 'holder.ready');
    const child = spawn(process.execPath, [
      LOCK_HOLDER_FIXTURE,
      lockPath,
      readyPath,
      '10000',
    ], {
      cwd: run.canonicalRunDir,
      stdio: 'ignore',
      windowsHide: true,
    });
    children.push(child);
    await waitForFile(readyPath);

    const contender = await acquireDurableSessionWakeLease({
      store,
      sessionKey: 'cross-process',
      ownerInstanceId: 'parent-contender',
      deadlineMs: 100,
      pollMs: 10,
    });
    expect(contender).toMatchObject({
      ok: false,
      diagnostic: { code: 'wake_busy', ownerState: 'live' },
    });
    expect(fs.readFileSync(lockPath, 'utf-8')).toContain(
      fs.readFileSync(readyPath, 'utf-8').trim()
    );
  });

  it('maps an injected POSIX lock permission ambiguity without stealing state', async () => {
    const run = makeRun();
    const nativeStore = createDurableSessionRegistryStore({ run });
    const lockPath = durableSessionWakeLockPath(
      nativeStore.paths,
      'posix-permission'
    );
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, 'unreadable-owner\n', 'utf-8');
    const filesystem: DurableRegistryFileSystem = {
      ...nodeDurableRegistryFileSystem,
      readText: (targetPath) => {
        if (targetPath === lockPath) {
          throw Object.assign(new Error('injected POSIX EACCES'), {
            code: 'EACCES',
          });
        }
        return nodeDurableRegistryFileSystem.readText(targetPath);
      },
    };
    const injectedStore = createDurableSessionRegistryStore({
      run,
      platform: 'linux',
      filesystem,
    });
    expect(await acquireDurableSessionWakeLease({
      store: injectedStore,
      sessionKey: 'posix-permission',
      ownerInstanceId: 'posix-contender',
      deadlineMs: 50,
      pollMs: 5,
    })).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'wake_lock_permission',
        ownerState: 'permission',
        causeCode: 'EACCES',
      },
    });
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe('unreadable-owner\n');
  });
});
