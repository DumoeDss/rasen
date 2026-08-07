import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  createDarwinBestEffortProcessScope,
  createNativeProcessGroupControl,
  DARWIN_BEST_EFFORT_DECLARATION,
  type ProcessGroupControl,
} from '../../../src/core/session-host/process-capsule/darwin-best-effort-scope.js';
import { createHostedProcessScope } from '../../../src/core/session-host/process-capsule/hosted-process-scope.js';
import {
  asProcessRef,
  ProcessScopeError,
  type ProcessPrepareInput,
  type ProcessScope,
} from '../../../src/core/session-host/process-scope.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const ABSOLUTE_COMMAND = process.platform === 'win32' ? 'C:\\bin\\workload' : '/bin/workload';

/**
 * Modelled POSIX kill(2). Only the kernel is modelled: the group-addressing
 * logic under test is the production createNativeProcessGroupControl.
 */
interface KernelProcess {
  pid: number;
  group: number;
  survivesSigterm: boolean;
}

class Kernel {
  readonly processes = new Map<number, KernelProcess>();
  readonly deliveries: Array<{ target: number; signal: string }> = [];
  readonly probes: number[] = [];
  private nextPid = 4100;
  private readonly exitHandlers = new Map<number, () => void>();

  readonly kill = (pid: number, signal: NodeJS.Signals | 0): void => {
    if (signal === 0) this.probes.push(pid);
    else this.deliveries.push({ target: pid, signal });
    const targets = pid < 0
      ? [...this.processes.values()].filter((entry) => entry.group === -pid)
      : [...this.processes.values()].filter((entry) => entry.pid === pid);
    if (targets.length === 0) {
      const error: NodeJS.ErrnoException = new Error('no such process');
      error.code = 'ESRCH';
      throw error;
    }
    if (signal === 0) return;
    for (const target of targets) {
      if (signal === 'SIGKILL' || !target.survivesSigterm) this.reap(target.pid);
    }
  };

  startLeader(): KernelProcess {
    const pid = this.nextPid;
    this.nextPid += 1;
    const leader: KernelProcess = { pid, group: pid, survivesSigterm: false };
    this.processes.set(pid, leader);
    return leader;
  }

  fork(group: number, survivesSigterm: boolean): KernelProcess {
    const pid = this.nextPid;
    this.nextPid += 1;
    const child: KernelProcess = { pid, group, survivesSigterm };
    this.processes.set(pid, child);
    return child;
  }

  /** POSIX setsid(): the caller leaves its process group for a brand new one. */
  escape(pid: number): void {
    const target = this.processes.get(pid);
    if (!target) throw new Error(`no process ${pid}`);
    target.group = this.nextPid;
    this.nextPid += 1;
  }

  onExit(pid: number, handler: () => void): void {
    this.exitHandlers.set(pid, handler);
  }

  alive(pid: number): boolean {
    return this.processes.has(pid);
  }

  private reap(pid: number): void {
    this.processes.delete(pid);
    const handler = this.exitHandlers.get(pid);
    this.exitHandlers.delete(pid);
    handler?.();
  }
}

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

interface SpawnRecord {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

function kernelSpawn(kernel: Kernel, calls: SpawnRecord[]): {
  spawn: typeof nodeSpawn;
  children: FakeChild[];
} {
  const children: FakeChild[] = [];
  const fake = (command: string, args: readonly string[], options: Record<string, unknown>) => {
    const leader = kernel.startLeader();
    calls.push({ command, args, options });
    const child = new FakeChild(leader.pid);
    children.push(child);
    kernel.onExit(leader.pid, () => child.emit('exit', null, 'SIGTERM'));
    setImmediate(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  };
  return { spawn: fake as unknown as typeof nodeSpawn, children };
}

/** Virtual clock so grace windows are exercised without real waiting. */
function virtualClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += Math.max(1, ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
    advanced: () => current,
  };
}

function prepareInput(overrides: Partial<ProcessPrepareInput> = {}): ProcessPrepareInput {
  return {
    command: ABSOLUTE_COMMAND,
    args: ['--resident'],
    cwd: repoRoot,
    env: { HOME: '/tmp/home' },
    ...overrides,
  };
}

async function liveScope(options: {
  kernel: Kernel;
  clock: ReturnType<typeof virtualClock>;
  control?: ProcessGroupControl;
  finalObservationMs?: number;
  pollIntervalMs?: number;
  calls?: SpawnRecord[];
}) {
  const calls = options.calls ?? [];
  const { spawn, children } = kernelSpawn(options.kernel, calls);
  const scope = createDarwinBestEffortProcessScope({
    spawn,
    control: options.control ?? createNativeProcessGroupControl(options.kernel.kill),
    now: options.clock.now,
    sleep: options.clock.sleep,
    pollIntervalMs: options.pollIntervalMs ?? 10,
    finalObservationMs: options.finalObservationMs ?? 100,
  });
  const prepared = await scope.prepare(prepareInput());
  const live = await prepared.activate();
  return { scope, prepared, live, children, calls };
}

describe('macOS best-effort scope declares its limits before anything starts', () => {
  it('exposes exactCancel:false and scopeEmptyProof:false on the prepared scope', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const calls: SpawnRecord[] = [];
    const { spawn } = kernelSpawn(kernel, calls);
    const scope = createDarwinBestEffortProcessScope({
      spawn,
      control: createNativeProcessGroupControl(kernel.kill),
      now: clock.now,
      sleep: clock.sleep,
    });
    const prepared = await scope.prepare(prepareInput());

    expect(prepared.declaration).toEqual({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
      semantics: [
        'own-process-group',
        'group-signal-cancel',
        'emptiness-keyed-escalation',
        'exact-root-exit',
        'bounded-controls',
        'honest-unproven-terminal',
      ],
    });
    expect(DARWIN_BEST_EFFORT_DECLARATION.exactCancel).toBe(false);
    expect(DARWIN_BEST_EFFORT_DECLARATION.scopeEmptyProof).toBe(false);
    // Prepare is inert: no workload process exists yet.
    expect(calls).toHaveLength(0);
    expect(kernel.processes.size).toBe(0);
  });

  it('refuses a non-absolute command before any process is created', async () => {
    const kernel = new Kernel();
    const calls: SpawnRecord[] = [];
    const { spawn } = kernelSpawn(kernel, calls);
    const scope = createDarwinBestEffortProcessScope({
      spawn,
      control: createNativeProcessGroupControl(kernel.kill),
    });
    await expect(scope.prepare(prepareInput({ command: 'workload' }))).rejects.toMatchObject({
      name: 'ProcessScopeError',
      code: 'containment-prepare-failed',
    });
    expect(calls).toHaveLength(0);
    expect(kernel.processes.size).toBe(0);
  });

  it('aborts a prepared scope without signalling anything and reports no workload ran', async () => {
    const kernel = new Kernel();
    const calls: SpawnRecord[] = [];
    const { spawn } = kernelSpawn(kernel, calls);
    const scope = createDarwinBestEffortProcessScope({
      spawn,
      control: createNativeProcessGroupControl(kernel.kill),
    });
    const prepared = await scope.prepare(prepareInput());
    const receipt = await prepared.abort('never-needed');

    expect(receipt.state).toBe('declared-unproven');
    expect(receipt.unproven).toMatchObject({
      outcome: 'never-activated',
      emptiness: 'unproven',
      diagnostic: 'no workload ran',
    });
    expect(kernel.deliveries).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('launches exactly the server-resolved command in its own session and group', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const { live, calls, children } = await liveScope({ kernel, clock });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(ABSOLUTE_COMMAND);
    expect(calls[0].args).toEqual(['--resident']);
    // setsid(): detached spawn, no shell, and only the allowlisted environment.
    expect(calls[0].options).toMatchObject({ detached: true, shell: false });
    expect(calls[0].options.env).toEqual({ HOME: '/tmp/home' });
    // Group id equals the leader pid.
    expect(live.displayPid).toBe(children[0].pid);
    expect(kernel.processes.get(children[0].pid)?.group).toBe(children[0].pid);
  });
});

describe('cancel escalation is keyed off whole-group emptiness, never leader exit', () => {
  it('keeps the grace running and forces at expiry when the leader exits instantly', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const { scope, live, children } = await liveScope({ kernel, clock });
    const leaderPid = children[0].pid;
    // A descendant that traps SIGTERM survives the graceful phase.
    const survivor = kernel.fork(leaderPid, true);

    const receipt = await scope.terminate(live.ref, {
      reason: 'leader-exit-oracle',
      graceMs: 60,
    });

    // Leader died on the first group SIGTERM; the survivor kept the group alive.
    expect(kernel.alive(leaderPid)).toBe(false);
    expect(kernel.deliveries).toEqual([
      { target: -leaderPid, signal: 'SIGTERM' },
      { target: -leaderPid, signal: 'SIGKILL' },
    ]);
    expect(clock.advanced()).toBeGreaterThanOrEqual(60);
    expect(kernel.alive(survivor.pid)).toBe(false);
    expect(receipt.state).toBe('declared-unproven');
    expect(receipt.unproven).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      forced: true,
      groupObservedEmpty: true,
    });
  });

  it('does not force when the whole group is gone before grace expiry', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const { scope, live, children } = await liveScope({ kernel, clock });
    const leaderPid = children[0].pid;
    kernel.fork(leaderPid, false);

    const receipt = await scope.terminate(live.ref, { reason: 'graceful', graceMs: 60 });

    expect(kernel.deliveries).toEqual([{ target: -leaderPid, signal: 'SIGTERM' }]);
    expect(receipt.unproven).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      forced: false,
      groupObservedEmpty: true,
    });
  });

  it('addresses the whole group, never the leader alone', () => {
    const kernel = new Kernel();
    const control = createNativeProcessGroupControl(kernel.kill);
    const leader = kernel.startLeader();
    kernel.fork(leader.pid, true);

    control.signalGroup(leader.pid, 'SIGTERM');
    control.groupPresent(leader.pid);

    expect(kernel.deliveries).toEqual([{ target: -leader.pid, signal: 'SIGTERM' }]);
    expect(kernel.probes).toEqual([-leader.pid]);
    expect(kernel.deliveries.every((entry) => entry.target < 0)).toBe(true);
  });

  it('settles once with a typed timeout when a control phase cannot complete', async () => {
    const kernel = new Kernel();
    const stuck: ProcessGroupControl = {
      signalGroup() {
        /* accepted, but nothing ever leaves the group */
      },
      groupPresent() {
        return true;
      },
    };
    const calls: SpawnRecord[] = [];
    const { spawn } = kernelSpawn(kernel, calls);
    const scope = createDarwinBestEffortProcessScope({
      spawn,
      control: stuck,
      controlTimeoutMs: 20,
      finalObservationMs: 0,
      pollIntervalMs: 5,
      sleep: () => new Promise<void>(() => undefined),
    });
    const prepared = await scope.prepare(prepareInput());
    const live = await prepared.activate();

    const receipt = await scope.terminate(live.ref, { reason: 'stuck', graceMs: 30 });

    expect(receipt.state).toBe('uncertain');
    expect(receipt.failure).toEqual({ code: 'process-control-timeout', phase: 'terminate' });
    expect(receipt.unproven).toBeUndefined();
  });
});

describe('the tier never reports a clean cancel or a proven-empty scope', () => {
  it('reports emptiness-unproven even when the group is observed empty', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const { scope, live, children } = await liveScope({ kernel, clock });
    const leaderPid = children[0].pid;
    // The flagship dishonesty risk: a descendant leaves the group via setsid()
    // and survives, while the group itself observes empty.
    const escapee = kernel.fork(leaderPid, false);
    kernel.escape(escapee.pid);

    const receipt = await scope.terminate(live.ref, { reason: 'escape-demo', graceMs: 40 });

    expect(kernel.alive(escapee.pid)).toBe(true);
    expect(receipt.unproven).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      groupObservedEmpty: true,
    });
    expect(receipt.state).not.toBe('closed');
    const observation = await scope.inspect(live.ref);
    expect(observation.state).toBe('declared-unproven');
    expect(observation.controllable).toBe(false);
    await expect(live.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      emptiness: 'unproven',
    });
  });

  it('has no source path that emits closed or scope-empty on this tier', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src/core/session-host/process-capsule/darwin-best-effort-scope.ts'),
      'utf8'
    );
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/state:\s*'closed'/);
    expect(code).not.toMatch(/'scope-empty'/);
    expect(code).not.toMatch(/emptiness:\s*'proven/);
  });

  it('reports the exact root exit distinctly from any emptiness statement', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const { scope, live, children } = await liveScope({ kernel, clock });
    const leaderPid = children[0].pid;
    const survivor = kernel.fork(leaderPid, true);

    children[0].emit('exit', 23, null);
    await expect(live.rootExited).resolves.toEqual({
      state: 'root-exited',
      code: 23,
      signal: null,
    });
    // Root exited while the group is not empty: still controllable.
    await expect(scope.inspect(live.ref)).resolves.toEqual({
      state: 'root-exited',
      controllable: true,
    });

    const receipt = await scope.terminate(live.ref, { reason: 'after-root-exit', graceMs: 30 });
    expect(kernel.deliveries).toEqual([
      { target: -leaderPid, signal: 'SIGTERM' },
      { target: -leaderPid, signal: 'SIGKILL' },
    ]);
    expect(kernel.alive(survivor.pid)).toBe(false);
    expect(receipt.unproven).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      rootExit: { code: 23, signal: null },
    });
  });

  it('records natural completion with the same unproven honesty', async () => {
    const kernel = new Kernel();
    const clock = virtualClock();
    const { live, children } = await liveScope({ kernel, clock });

    kernel.kill(children[0].pid, 'SIGTERM');

    await expect(live.rootExited).resolves.toEqual({
      state: 'root-exited',
      code: null,
      signal: 'SIGTERM',
    });
    await expect(live.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      outcome: 'completed',
      emptiness: 'unproven',
      groupObservedEmpty: true,
      forced: false,
      rootExit: { code: null, signal: 'SIGTERM' },
    });
  });
});

describe('daemon death is honest loss, never reattach', () => {
  it('reports a ref from a previous daemon lifetime as foreign and signals nothing', async () => {
    const kernel = new Kernel();
    const stale = asProcessRef(
      `rasen-process-scope/1:${Buffer.from('previous-daemon-lifetime').toString('base64url')}`
    );
    const calls: SpawnRecord[] = [];
    const { spawn } = kernelSpawn(kernel, calls);
    const scope = createDarwinBestEffortProcessScope({
      spawn,
      control: createNativeProcessGroupControl(kernel.kill),
    });

    await expect(scope.inspect(stale)).resolves.toEqual({
      state: 'foreign',
      controllable: false,
    });
    const receipt = await scope.terminate(stale, { reason: 'stale', graceMs: 10 });
    expect(receipt.state).toBe('uncertain');
    expect(kernel.deliveries).toHaveLength(0);
    expect(kernel.probes).toHaveLength(0);
  });

  it('contains no reattach or identity revalidation anywhere in the module', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src/core/session-host/process-capsule/darwin-best-effort-scope.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/reattach/i);
    expect(source).not.toMatch(/revalidat/i);
  });
});

describe('darwin selection at hosted-session ProcessScope construction', () => {
  const sentinel = new ProcessScopeError('containment-unsupported', 'exact-tier-sentinel');

  it('selects the best-effort tier only on darwin', async () => {
    const darwin: ProcessScope = createHostedProcessScope({
      platform: 'darwin',
      resolve: () => {
        throw sentinel;
      },
    });
    const prepared = await darwin.prepare(prepareInput());
    expect(prepared.declaration).toEqual(DARWIN_BEST_EFFORT_DECLARATION);

    for (const platform of ['linux', 'win32'] as const) {
      const exact = createHostedProcessScope({
        platform,
        resolve: () => {
          throw sentinel;
        },
      });
      await expect(exact.prepare(prepareInput())).rejects.toBe(sentinel);
    }
  });

  it('routes every hosted-session construction site through the selection helper', () => {
    const sites = [
      'src/core/management-api/router.ts',
      'src/core/session-host/host.ts',
      'src/core/session-host/claude-backend.ts',
    ];
    for (const site of sites) {
      const source = fs.readFileSync(path.join(repoRoot, site), 'utf8');
      expect(source, `${site} must construct via createHostedProcessScope`).toMatch(
        /createHostedProcessScope\(/
      );
      expect(source, `${site} must not bypass the darwin selection`).not.toMatch(
        /createNativeProcessScope\(/
      );
    }
  });
});
