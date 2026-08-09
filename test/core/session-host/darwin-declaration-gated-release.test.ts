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
  asProcessRef,
  createDeterministicProcessScope,
  type DeclaredUnprovenReceipt,
  type PreparedProcessScope,
  type ProcessObservation,
  type ProcessRef,
  type ProcessScope,
  type TerminationReceipt,
} from '../../../src/core/session-host/process-scope.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
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

const CANCELLED_UNPROVEN: DeclaredUnprovenReceipt = Object.freeze({
  state: 'declared-unproven',
  outcome: 'cancelled',
  emptiness: 'unproven',
  groupObservedEmpty: true,
  forced: true,
});

/**
 * Host-rule fixture. The unit under test here is the host's release decision,
 * so the scope is a stub; real-kernel behavior of the provider is covered by
 * the POSIX pre-flight oracles and the macOS acceptance gate.
 */
function terminalScope(options: {
  observation?: ProcessObservation;
  receipt?: TerminationReceipt;
  onTerminate?: () => void;
}): ProcessScope {
  return {
    async prepare(): Promise<PreparedProcessScope> {
      throw new Error('unused');
    },
    async inspect() {
      return options.observation ?? { state: 'live', controllable: true };
    },
    async terminate() {
      options.onTerminate?.();
      return (
        options.receipt ?? {
          state: 'declared-unproven',
          gracefulAttempted: true,
          forced: true,
          unproven: CANCELLED_UNPROVEN,
        }
      );
    },
  };
}

function seedRecord(
  registry: SessionHostRegistry,
  cwd: string,
  declared: boolean
): Promise<HostedSessionRecord> {
  const stamp = new Date().toISOString();
  const ref: ProcessRef = asProcessRef(
    `rasen-process-scope/1:${Buffer.from('declaration-gated-release-fixture').toString('base64url')}`
  );
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
    process: {
      generation: 1,
      ownerToken: 'declaration-gated-owner',
      runtimeRef: String(ref),
      preparedAt: stamp,
      ...(declared
        ? { declaration: { tier: 'best-effort', exactCancel: false, scopeEmptyProof: false } }
        : {}),
    },
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
      }),
    ],
    ownership: {
      async claim() {
        return { ownerToken: 'declaration-gated-owner', async release() { /* noop */ } };
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

describe('declaration-gated release from a declared-unproven terminal', () => {
  it('releases a declared best-effort session and keeps the unproven terminal', async () => {
    const { root, cwd } = workspace('rasen-darwin-release-declared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const seeded = await seedRecord(registry, cwd, true);
    const host = hostFor(registry, terminalScope({}));

    const report = await host.reconcileOnStart();

    expect(report.recovered).toBe(1);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeUndefined();
    expect(after.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      label: 'cancelled / emptiness-unproven',
      groupObservedEmpty: true,
      forced: true,
    });
    expect(host.inspect(seeded.sessionId)?.processTerminal?.label).toBe(
      'cancelled / emptiness-unproven'
    );
  });

  it('refuses release when the record carries no pre-start declaration', async () => {
    const { root, cwd } = workspace('rasen-darwin-release-undeclared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const seeded = await seedRecord(registry, cwd, false);
    const host = hostFor(registry, terminalScope({}));

    const report = await host.reconcileOnStart();

    expect(report.recovered).toBe(0);
    expect(report.interrupted + report.failed).toBe(1);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeDefined();
    expect(after.processTerminal).toBeUndefined();
    expect(after.recoveryReason).toBe('surviving-process-owner-unattachable');
  });

  it('releases from an already-terminal declared observation without re-signalling', async () => {
    const { root, cwd } = workspace('rasen-darwin-release-observed-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const seeded = await seedRecord(registry, cwd, true);
    let terminateCalls = 0;
    const host = hostFor(
      registry,
      terminalScope({
        observation: {
          state: 'declared-unproven',
          controllable: false,
          terminal: CANCELLED_UNPROVEN,
        },
        onTerminate: () => {
          terminateCalls += 1;
        },
      })
    );

    const report = await host.reconcileOnStart();

    expect(terminateCalls).toBe(0);
    expect(report.recovered).toBe(1);
    expect(registry.get(seeded.sessionId)?.processTerminal?.label).toBe(
      'cancelled / emptiness-unproven'
    );
  });

  it('refuses an unproven observation presented by an undeclared record', async () => {
    const { root, cwd } = workspace('rasen-darwin-release-observed-undeclared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const seeded = await seedRecord(registry, cwd, false);
    const host = hostFor(
      registry,
      terminalScope({
        observation: {
          state: 'declared-unproven',
          controllable: false,
          terminal: CANCELLED_UNPROVEN,
        },
      })
    );

    const report = await host.reconcileOnStart();

    expect(report.recovered).toBe(0);
    expect(registry.get(seeded.sessionId)?.process).toBeDefined();
    expect(registry.get(seeded.sessionId)?.processTerminal).toBeUndefined();
  });
});

describe('exact-tier release behavior is unchanged', () => {
  it('keeps releasing on a proven scope-empty receipt and retaining on anything else', async () => {
    for (const [terminationState, expectRelease] of [
      ['closed', true],
      ['uncertain', false],
      ['retained', false],
    ] as const) {
      const { root, cwd } = workspace(`rasen-darwin-exact-${terminationState}-`);
      const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
      const seeded = await seedRecord(registry, cwd, false);
      const host = hostFor(
        registry,
        terminalScope({
          receipt: { state: terminationState, gracefulAttempted: true, forced: false },
        })
      );

      const report = await host.reconcileOnStart();

      expect(report.recovered, terminationState).toBe(expectRelease ? 1 : 0);
      expect(registry.get(seeded.sessionId)?.process === undefined, terminationState).toBe(
        expectRelease
      );
      expect(registry.get(seeded.sessionId)?.processTerminal, terminationState).toBeUndefined();
    }
  });

  it('leaves the deterministic exact-tier scope with no declaration at all', async () => {
    const scope = createDeterministicProcessScope();
    const prepared = await scope.prepare({
      command: process.execPath,
      args: [],
      cwd: process.cwd(),
      env: {},
    });
    expect(prepared.declaration).toBeUndefined();
    await expect(prepared.abort('unused')).resolves.toMatchObject({ state: 'closed' });
  });
});

describe('the declaration is in the Record before any workload code runs', () => {
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

  function gatedDarwinScope(spawnCalls: string[], gate: Promise<void>) {
    let nextPid = 7100;
    const spawn = ((command: string) => {
      spawnCalls.push(command);
      nextPid += 1;
      const child = new FakeChild(nextPid);
      setImmediate(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }) as unknown as typeof nodeSpawn;
    const inner = createPosixBestEffortProcessScope({
      spawn,
      control: { signalGroup() { /* noop */ }, groupPresent: () => false },
    });
    const scope: ProcessScope = {
      async prepare(input) {
        const prepared = await inner.prepare(input);
        return {
          ref: prepared.ref,
          ...(prepared.displayPid ? { displayPid: prepared.displayPid } : {}),
          ...(prepared.declaration ? { declaration: prepared.declaration } : {}),
          async activate() {
            await gate;
            return prepared.activate();
          },
          abort: (reason: string) => prepared.abort(reason),
        };
      },
      inspect: (ref) => inner.inspect(ref),
      terminate: (ref, intent) => inner.terminate(ref, intent),
    };
    return scope;
  }

  it('records the limits at prepare time, before the workload is spawned', async () => {
    const { root, cwd } = workspace('rasen-darwin-declaration-before-start-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const spawnCalls: string[] = [];
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const host = hostFor(registry, gatedDarwinScope(spawnCalls, gate));
    await host.reconcileOnStart();

    const pending = host.dispatch({
      op: 'execute',
      requestId: crypto.randomUUID(),
      backend: 'claude',
      cwd,
      input: 'declaration-before-start',
      limits: {
        timeoutMs: 1_000,
        maxInputBytes: 4_096,
        maxOutputBytes: 4_096,
        maxDiagnosticBytes: 256,
      },
    });

    for (let attempt = 0; attempt < 400 && !registry.list()[0]?.process; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const beforeActivation = registry.list()[0];
    expect(beforeActivation?.process?.declaration).toEqual({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
    });
    // Acceptance, not decoration: the limits are readable before the workload
    // process exists at all.
    expect(spawnCalls).toEqual([]);

    openGate();
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(spawnCalls).toHaveLength(1);
    await host.shutdown('daemon-stop');
  }, 30_000);

  it('fails activation typed and runs no workload when the declaration cannot be recorded', async () => {
    const { root, cwd } = workspace('rasen-darwin-declaration-lost-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const stripped: SessionHostRegistry = {
      ...registry,
      paths: registry.paths,
      load: () => registry.load(),
      get: (sessionId: string) => registry.get(sessionId),
      list: () => registry.list(),
      create: (record: HostedSessionRecord) => registry.create(record),
      update: (sessionId, expectedGeneration, mutate) =>
        registry.update(sessionId, expectedGeneration, (current) => {
          const next = mutate(current);
          if (next.process?.declaration) delete next.process.declaration;
          return next;
        }),
    };
    const spawnCalls: string[] = [];
    const host = hostFor(stripped, gatedDarwinScope(spawnCalls, Promise.resolve()));
    await host.reconcileOnStart();

    const outcome = await host.dispatch({
      op: 'execute',
      requestId: crypto.randomUUID(),
      backend: 'claude',
      cwd,
      input: 'declaration-lost',
      limits: {
        timeoutMs: 1_000,
        maxInputBytes: 4_096,
        maxOutputBytes: 4_096,
        maxDiagnosticBytes: 256,
      },
    });

    expect(outcome.ok).toBe(false);
    expect(spawnCalls).toEqual([]);
    await host.shutdown('daemon-stop');
  }, 30_000);
});
