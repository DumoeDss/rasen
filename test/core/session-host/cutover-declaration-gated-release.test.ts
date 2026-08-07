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
import { createWin32BestEffortProcessScope } from '../../../src/core/session-host/process-capsule/win32-best-effort-scope.js';
import {
  type ProcessRef,
  type ProcessScope,
} from '../../../src/core/session-host/process-scope.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
  type SessionHostRegistry,
} from '../../../src/core/session-host/registry.js';
import {
  ACTIVATE,
  capsuleSeam,
  PREPARE,
  SCOPE_EMPTY,
  type CapsuleSeam,
} from '../../helpers/fake-process-capsule.js';

/**
 * Declaration-gated release across BOTH `closeDurableProcess` release paths, for
 * both tiers this cutover ships.
 *
 * `closeDurableProcess` can release a Session two different ways: the
 * OBSERVATION path (host.ts:711-714, inspect already reports a declared-unproven
 * terminal, so nothing is signalled) and the RECEIPT path (host.ts:715-720,
 * inspect reports a controllable scope, so terminate is called and its receipt
 * decides). A guard that only drives one of them stays green while the other
 * regresses, so every case below asserts WHICH path ran by counting the
 * terminate calls the host actually made: the observation path must make zero,
 * the receipt path exactly one.
 */

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

class FakeLeader extends EventEmitter {
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

/** POSIX tier with the kernel seamed out; the module itself is production code. */
function posixScope(): ProcessScope {
  let nextPid = 8100;
  const spawn = (() => {
    nextPid += 1;
    const child = new FakeLeader(nextPid);
    setImmediate(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;
  return createPosixBestEffortProcessScope({
    spawn,
    // The group is observed empty as soon as it is asked about, so a cancel
    // completes without forcing; the release rule under test is unaffected.
    control: { signalGroup() { /* noop */ }, groupPresent: () => false },
  });
}

interface CountingScope {
  scope: ProcessScope;
  counts: { inspect: number; terminate: number };
  reset(): void;
}

/**
 * Forwards every call to the real tier while recording which control verbs the
 * host reached for. This is the per-path discriminator, not a stub.
 */
function counting(inner: ProcessScope): CountingScope {
  const counts = { inspect: 0, terminate: 0 };
  return {
    counts,
    reset() {
      counts.inspect = 0;
      counts.terminate = 0;
    },
    scope: {
      prepare: (input) => inner.prepare(input),
      inspect: async (ref) => {
        counts.inspect += 1;
        return inner.inspect(ref);
      },
      terminate: async (ref, intent) => {
        counts.terminate += 1;
        return inner.terminate(ref, intent);
      },
    },
  };
}

function seedRecord(
  registry: SessionHostRegistry,
  cwd: string,
  ref: ProcessRef,
  declared: boolean
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
    process: {
      generation: 1,
      ownerToken: 'cutover-release-owner',
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
        return { ownerToken: 'cutover-release-owner', async release() { /* noop */ } };
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

const PREPARE_INPUT = {
  command: process.platform === 'win32' ? 'C:\\bin\\workload' : '/bin/workload',
  args: ['--resident'] as readonly string[],
  env: { SystemRoot: 'C:\\Windows' },
};

/**
 * Brings a tier to the state the named release path requires and returns the
 * ref the Record should carry.
 *
 * - 'observation': the scope is already terminal, so inspect answers
 *   declared-unproven and the host must release without signalling.
 * - 'receipt': the scope is still controllable, so the host must call terminate
 *   and judge its receipt.
 */
async function stageLinux(
  path_: 'observation' | 'receipt',
  cwd: string
): Promise<{ counting: CountingScope; ref: ProcessRef }> {
  const wrapped = counting(posixScope());
  const prepared = await wrapped.scope.prepare({ ...PREPARE_INPUT, cwd });
  const live = await prepared.activate();
  if (path_ === 'observation') {
    await wrapped.scope.terminate(live.ref, { reason: 'pre-cancelled', graceMs: 0 });
  }
  wrapped.reset();
  return { counting: wrapped, ref: live.ref };
}

async function stageWin32(
  path_: 'observation' | 'receipt',
  cwd: string
): Promise<{ counting: CountingScope; ref: ProcessRef }> {
  const seam = capsuleSeam();
  const wrapped = counting(
    createWin32BestEffortProcessScope({ spawn: seam.spawn, resolve: seam.resolve })
  );
  const prepared = await wrapped.scope.prepare({ ...PREPARE_INPUT, cwd });
  const live = await prepared.activate();
  if (path_ === 'observation') {
    // The Job empties on its own: a protocol outcome, so the tier mints its
    // terminal without anyone cancelling.
    seam.controllers[0].emitFrame(SCOPE_EMPTY);
    await live.closed;
  }
  wrapped.reset();
  return { counting: wrapped, ref: live.ref };
}

const TIERS = [
  { name: 'linux (POSIX tier)', stage: stageLinux },
  { name: 'win32 (Job tier)', stage: stageWin32 },
] as const;

describe.each(TIERS)('$name releases a declared scope on BOTH host release paths', ({ stage }) => {
  it('releases through the observation path without signalling anything', async () => {
    const { root, cwd } = workspace('rasen-cutover-observation-declared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const staged = await stage('observation', cwd);
    const seeded = await seedRecord(registry, cwd, staged.ref, true);
    const host = hostFor(registry, staged.counting.scope);

    const report = await host.reconcileOnStart();

    // Path discriminator: the observation path never reaches terminate.
    expect(staged.counting.counts.inspect).toBeGreaterThan(0);
    expect(staged.counting.counts.terminate).toBe(0);
    expect(report.recovered).toBe(1);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeUndefined();
    expect(after.processTerminal).toMatchObject({ emptiness: 'unproven' });
    expect(after.processTerminal?.label).toMatch(/emptiness-unproven$/);
  });

  it('releases through the receipt path by cancelling and judging the receipt', async () => {
    const { root, cwd } = workspace('rasen-cutover-receipt-declared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const staged = await stage('receipt', cwd);
    const seeded = await seedRecord(registry, cwd, staged.ref, true);
    const host = hostFor(registry, staged.counting.scope);

    const report = await host.reconcileOnStart();

    // Path discriminator: the receipt path must actually have cancelled.
    expect(staged.counting.counts.terminate).toBe(1);
    expect(report.recovered).toBe(1);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeUndefined();
    expect(after.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      label: 'cancelled / emptiness-unproven',
    });
  });

  it('refuses the observation path when the Record carries no pre-start declaration', async () => {
    const { root, cwd } = workspace('rasen-cutover-observation-undeclared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const staged = await stage('observation', cwd);
    const seeded = await seedRecord(registry, cwd, staged.ref, false);
    const host = hostFor(registry, staged.counting.scope);

    const report = await host.reconcileOnStart();

    expect(staged.counting.counts.terminate).toBe(0);
    expect(report.recovered).toBe(0);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeDefined();
    expect(after.processTerminal).toBeUndefined();
  });

  it('refuses the receipt path when the Record carries no pre-start declaration', async () => {
    const { root, cwd } = workspace('rasen-cutover-receipt-undeclared-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const staged = await stage('receipt', cwd);
    const seeded = await seedRecord(registry, cwd, staged.ref, false);
    const host = hostFor(registry, staged.counting.scope);

    const report = await host.reconcileOnStart();

    // The cancel is attempted, and the resulting honest terminal is still
    // refused: an undeclared scope keeps the exact rule and fails closed.
    expect(staged.counting.counts.terminate).toBe(1);
    expect(report.recovered).toBe(0);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeDefined();
    expect(after.processTerminal).toBeUndefined();
  });
});

/**
 * Task 3.6: the win32 declaration must traverse the EXISTING host, registry and
 * API-projection plumbing with no edit to any of them. Asserted end to end
 * rather than argued from the fact that the code reads `declaration !==
 * undefined`.
 */
describe('the win32 declaration is visible before the workload starts', () => {
  function gatedWin32Scope(seam: CapsuleSeam, gate: Promise<void>): ProcessScope {
    const inner = createWin32BestEffortProcessScope({
      spawn: seam.spawn,
      resolve: seam.resolve,
    });
    return {
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
  }

  const LIMITS = {
    timeoutMs: 1_000,
    maxInputBytes: 4_096,
    maxOutputBytes: 4_096,
    maxDiagnosticBytes: 256,
  };

  it('records the limits and projects them to the API before the workload is activated', async () => {
    const { root, cwd } = workspace('rasen-cutover-win32-declaration-before-start-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const seam = capsuleSeam();
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const host = hostFor(registry, gatedWin32Scope(seam, gate));
    await host.reconcileOnStart();

    const pending = host.dispatch({
      op: 'execute',
      requestId: crypto.randomUUID(),
      backend: 'claude',
      cwd,
      input: 'win32-declaration-before-start',
      limits: LIMITS,
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
    // The API projection carries it on the unmodified router/contracts path.
    expect(host.inspect(beforeActivation!.sessionId)?.processDeclaration).toEqual({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
    });
    // Acceptance, not decoration: the capsule was told to PREPARE the Job and
    // was never told to ACTIVATE, so no workload process exists yet.
    expect(seam.controllers).toHaveLength(1);
    expect(seam.controllers[0].received).toEqual([PREPARE]);

    openGate();
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(seam.controllers[0].received).toContain(ACTIVATE);
    await host.shutdown('daemon-stop');
  }, 30_000);

  it('fails activation typed and runs no workload when the declaration cannot be recorded', async () => {
    const { root, cwd } = workspace('rasen-cutover-win32-declaration-lost-');
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
    const seam = capsuleSeam();
    const host = hostFor(stripped, gatedWin32Scope(seam, Promise.resolve()));
    await host.reconcileOnStart();

    const outcome = await host.dispatch({
      op: 'execute',
      requestId: crypto.randomUUID(),
      backend: 'claude',
      cwd,
      input: 'win32-declaration-lost',
      limits: LIMITS,
    });

    expect(outcome.ok).toBe(false);
    // The Job was prepared, then aborted; the workload was never activated.
    expect(seam.controllers[0].received).not.toContain(ACTIVATE);
    await host.shutdown('daemon-stop');
  }, 30_000);
});
