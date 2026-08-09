import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeSessionBackend } from '../../../src/core/session-host/claude-backend.js';
import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createPosixBestEffortProcessScope } from '../../../src/core/session-host/process-capsule/posix-best-effort-scope.js';
import {
  createDeterministicProcessScope,
  type ProcessScope,
} from '../../../src/core/session-host/process-scope.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
  SessionHostRegistryError,
  type SessionHostRegistry,
} from '../../../src/core/session-host/registry.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 39) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
});

function workspace(prefix: string): { root: string; cwd: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const cwd = path.join(root, 'checkout');
  fs.mkdirSync(cwd);
  return { root, cwd: fs.realpathSync.native(cwd) };
}

/** Stands in for the workload leader; the group control below is the real seam. */
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  constructor(readonly pid: number) {
    super();
  }
  kill(): boolean {
    return true;
  }
}

/**
 * The real darwin best-effort provider over a fake spawn and a fake group
 * control. Everything between the provider and the durable Record - the backend
 * termination seam, the host's close routes, the flush - is production code.
 */
function darwinHarness(): { scope: ProcessScope; children: FakeChild[] } {
  const children: FakeChild[] = [];
  let nextPid = 8100;
  const spawn = (() => {
    nextPid += 1;
    const child = new FakeChild(nextPid);
    children.push(child);
    setImmediate(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;
  const scope = createPosixBestEffortProcessScope({
    spawn,
    control: { signalGroup() { /* noop */ }, groupPresent: () => false },
    pollIntervalMs: 1,
    finalObservationMs: 50,
  });
  return { scope, children };
}

function seedIdleRecord(
  registry: SessionHostRegistry,
  cwd: string
): Promise<HostedSessionRecord> {
  const stamp = new Date().toISOString();
  return registry.create({
    sessionId: crypto.randomUUID(),
    backend: 'claude',
    backendSessionId: 'resume-identity',
    cwd,
    cwdDigest: digestSessionHostText(cwd),
    hostState: 'idle',
    generation: 1,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
    requests: [],
  } as HostedSessionRecord);
}

function hostFor(registry: SessionHostRegistry, processScope: ProcessScope) {
  return createSessionHost({
    registry,
    processScope,
    backends: [
      createClaudeSessionBackend({
        resolveBinary: async () => process.execPath,
        verifyProtocol: async () => ({ ok: true, version: 'test' }),
        processScope,
        killGraceMs: 25,
      }),
    ],
    ownership: {
      async claim() {
        return { ownerToken: 'live-close-owner', async release() { /* noop */ } };
      },
      async isClaimed() {
        return false;
      },
      async reapStaleOwner() {
        return 'absent';
      },
    },
  });
}

/**
 * Brings a session to the state the production-normal cancel starts from: a
 * RUNNING hosted session with a live transport the host owns. `restart` is the
 * shortest production route to it that does not race a failing turn.
 */
async function liveSession(
  registry: SessionHostRegistry,
  cwd: string,
  processScope: ProcessScope
) {
  const host = hostFor(registry, processScope);
  await host.reconcileOnStart();
  const seeded = await seedIdleRecord(registry, cwd);
  const started = await host.dispatch({ op: 'restart', sessionId: seeded.sessionId });
  expect(started.ok, JSON.stringify(started)).toBe(true);
  expect(registry.get(seeded.sessionId)?.process?.declaration ?? null).toBeTypeOf('object');
  return { host, sessionId: seeded.sessionId };
}

async function until(predicate: () => boolean, budgetMs = 4_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('the live-close route persists the declared-unproven terminal', () => {
  it('records cancelled / emptiness-unproven when a RUNNING declared session is cancelled', async () => {
    const { root, cwd } = workspace('rasen-darwin-live-cancel-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const { scope } = darwinHarness();
    const { host, sessionId } = await liveSession(registry, cwd, scope);

    const cancelled = await host.dispatch({
      op: 'cancel',
      sessionId,
      reason: 'operator-cancel',
    });

    expect(cancelled.ok, JSON.stringify(cancelled)).toBe(true);
    const after = registry.get(sessionId)!;
    expect(after.process).toBeUndefined();
    // The whole point of the tier: the Record carries the unproven terminal.
    expect(after.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      label: 'cancelled / emptiness-unproven',
    });
    expect(host.inspect(sessionId)?.processTerminal?.label).toBe(
      'cancelled / emptiness-unproven'
    );
    await host.shutdown('daemon-stop');
  }, 30_000);

  it('records completed / emptiness-unproven when a declared session ends naturally', async () => {
    const { root, cwd } = workspace('rasen-darwin-live-complete-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const { scope, children } = darwinHarness();
    const { host, sessionId } = await liveSession(registry, cwd, scope);

    expect(children).toHaveLength(1);
    children[0]!.emit('exit', 0, null);
    await until(() => registry.get(sessionId)?.processTerminal !== undefined);

    const after = registry.get(sessionId)!;
    expect(after.process).toBeUndefined();
    expect(after.processTerminal).toMatchObject({
      outcome: 'completed',
      emptiness: 'unproven',
      label: 'completed / emptiness-unproven',
      groupObservedEmpty: true,
      forced: false,
    });
    await host.shutdown('daemon-stop');
  }, 30_000);

  it('records the terminal when the daemon shuts down over a live declared session', async () => {
    const { root, cwd } = workspace('rasen-darwin-live-shutdown-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const { scope } = darwinHarness();
    const { host, sessionId } = await liveSession(registry, cwd, scope);

    await host.shutdown('daemon-stop');

    expect(registry.get(sessionId)?.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      label: 'cancelled / emptiness-unproven',
    });
  }, 30_000);

  it('leaves an undeclared live scope byte-identical: released, with no terminal', async () => {
    const { root, cwd } = workspace('rasen-exact-live-cancel-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const scope = createDeterministicProcessScope();
    const host = hostFor(registry, scope);
    await host.reconcileOnStart();
    const seeded = await seedIdleRecord(registry, cwd);
    expect((await host.dispatch({ op: 'restart', sessionId: seeded.sessionId })).ok).toBe(true);
    expect(registry.get(seeded.sessionId)?.process?.declaration).toBeUndefined();

    const cancelled = await host.dispatch({
      op: 'cancel',
      sessionId: seeded.sessionId,
      reason: 'operator-cancel',
    });

    expect(cancelled.ok).toBe(true);
    expect(registry.get(seeded.sessionId)?.process).toBeUndefined();
    expect(registry.get(seeded.sessionId)?.processTerminal).toBeUndefined();
    await host.shutdown('daemon-stop');
  }, 30_000);
});

describe('a staged terminal survives a contended flush', () => {
  it('keeps the terminal pending on CAS exhaustion and persists it on a later flush', async () => {
    const { root, cwd } = workspace('rasen-darwin-flush-contended-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    let refuseTerminalWrites = false;
    /**
     * Contends exactly the flush's own write - the reviewer's falsifier: a
     * registry that exhausts every CAS attempt while the terminal is being
     * persisted. Every other lifecycle write proceeds, so the terminal really
     * is staged before the contention starts.
     */
    const writesTerminal = (
      sessionId: string,
      mutate: (current: HostedSessionRecord) => HostedSessionRecord
    ): boolean => {
      const probe = registry.get(sessionId);
      if (!probe || probe.processTerminal !== undefined) return false;
      try {
        const clone = JSON.parse(JSON.stringify(probe)) as HostedSessionRecord;
        return mutate(clone).processTerminal !== undefined;
      } catch {
        return false;
      }
    };
    const contended: SessionHostRegistry = {
      ...registry,
      paths: registry.paths,
      load: () => registry.load(),
      get: (sessionId: string) => registry.get(sessionId),
      list: () => registry.list(),
      create: (record: HostedSessionRecord) => registry.create(record),
      update: (sessionId, expectedGeneration, mutate) => {
        if (refuseTerminalWrites && writesTerminal(sessionId, mutate)) {
          return Promise.reject(
            new SessionHostRegistryError('stale-generation', 'contended by a sibling writer')
          );
        }
        return registry.update(sessionId, expectedGeneration, mutate);
      },
    };
    const { scope } = darwinHarness();
    const { host, sessionId } = await liveSession(contended, cwd, scope);

    refuseTerminalWrites = true;
    const cancelled = await host.dispatch({ op: 'cancel', sessionId, reason: 'operator-cancel' });
    expect(cancelled.ok, JSON.stringify(cancelled)).toBe(true);
    // The scope released and the session is clean, but the flush exhausted its
    // CAS attempts. Losing the terminal here is the failure this staging exists
    // to close, so it must still be pending rather than gone.
    expect(registry.get(sessionId)?.process).toBeUndefined();
    expect(registry.get(sessionId)?.processTerminal).toBeUndefined();

    refuseTerminalWrites = false;
    // Any later dispatch drains the staged terminal.
    await host.dispatch({ op: 'cancel', sessionId: crypto.randomUUID(), reason: 'drain' });

    expect(registry.get(sessionId)?.processTerminal).toMatchObject({
      outcome: 'cancelled',
      label: 'cancelled / emptiness-unproven',
    });
    await host.shutdown('daemon-stop').catch(() => undefined);
  }, 30_000);
});
