import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendEvent,
  BackendOpenInput,
  BackendTurn,
  BackendTurnStream,
  PreparedAgentSessionTransport,
} from '../../../src/core/session-host/backend.js';
import { asProcessRef } from '../../../src/core/session-host/process-scope.js';
import type { ProcessScope } from '../../../src/core/session-host/process-scope.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import {
  createSessionHostRegistry,
  type SessionHostRegistry,
} from '../../../src/core/session-host/registry.js';

const roots: string[] = [];

function tempRoot(): { root: string; cwd: string; stateDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-host-'));
  roots.push(root);
  const cwd = path.join(root, 'checkout');
  fs.mkdirSync(cwd);
  return { root, cwd, stateDir: path.join(root, 'state') };
}

// A bare `fs.rmSync` here failed CI with
// `ENOTEMPTY: directory not empty, rmdir '...\state\session-host'`: this suite
// starts real session hosts, and a still-dying child can hold or repopulate the
// tree for a moment after the test returns. `cleanupTempPathAsync` drives its own
// awaited backoff over exactly that transient set (EPERM/EBUSY/ENOTEMPTY/EMFILE/
// ENFILE) because `fs.rmSync`'s own maxRetries does not reliably back off on
// Windows. A genuinely stuck handle still throws rather than hanging.
afterEach(async () => {
  for (const root of roots.splice(0)) await cleanupTempPathAsync(root);
});

function prepareTestTransport(
  transport: AgentSessionTransport & { rootPid?: number },
): PreparedAgentSessionTransport {
  const runtimeRef = asProcessRef(
    `rasen-process-scope/1:${Buffer.from(randomUUID()).toString('base64url')}`
  );
  Object.assign(transport, {
    runtimeRef,
    ...(transport.rootPid ? { displayPid: transport.rootPid } : {}),
  });
  let closeObserved = false;
  void transport.closed.then(
    () => { closeObserved = true; },
    () => { closeObserved = true; },
  );
  return {
    runtimeRef,
    ...(transport.displayPid ? { displayPid: transport.displayPid } : {}),
    async activate() { return transport; },
    async abort() {
      if (closeObserved) {
        return { state: 'closed' as const, gracefulAttempted: false, forced: false };
      }
      const outcome = await transport.terminate('prepared-test-abort');
      return {
        state: outcome.closed ? 'closed' as const : 'retained' as const,
        gracefulAttempted: false,
        forced: outcome.closed,
      };
    },
  };
}

function observationScope(
  state: 'live' | 'closed' | 'uncertain',
  termination: 'closed' | 'retained' | 'uncertain' = state === 'live' ? 'retained' : 'closed',
): ProcessScope {
  return {
    async prepare() { throw new Error('not used'); },
    async inspect() {
      if (state === 'live') return { state: 'live' as const, controllable: true as const };
      if (state === 'closed') return { state: 'closed' as const, controllable: false as const };
      return { state: 'uncertain' as const, controllable: false as const, diagnostic: 'test uncertainty' };
    },
    async terminate() {
      return {
        state: termination,
        gracefulAttempted: true,
        forced: termination === 'closed',
      };
    },
  };
}

class ReplayTransport implements AgentSessionTransport {
  readonly rootPid = 4242;
  readonly closed = new Promise<void>(() => undefined);
  readonly inputs: string[] = [];
  terminated = false;

  constructor(
    private readonly backendSessionId: string,
    private readonly gate?: Promise<void>
  ) {}

  send(turn: BackendTurn): BackendTurnStream {
    this.inputs.push(turn.input);
    const gate = this.gate;
    const backendSessionId = this.backendSessionId;
    const events = (async function* () {
      if (gate) await gate;
      yield { type: 'init', sessionId: backendSessionId } as BackendEvent;
      yield { type: 'result', sessionId: backendSessionId, content: `result:${turn.input}` } as BackendEvent;
    })();
    return Object.assign(events, { accepted: Promise.resolve() });
  }

  async terminate(): Promise<{ closed: boolean; cancelledBeforeWork: boolean }> {
    this.terminated = true;
    return { closed: true, cancelledBeforeWork: false };
  }
}

class ReplayBackend implements AgentSessionBackend {
  readonly id = 'replay';
  readonly version = 'fixture/1';
  readonly opens: BackendOpenInput[] = [];
  readonly transports: ReplayTransport[] = [];

  constructor(private readonly gate?: Promise<void>) {}

  async prepare(input: BackendOpenInput): Promise<PreparedAgentSessionTransport> {
    this.opens.push(input);
    const transport = new ReplayTransport(input.resumeSessionId ?? 'backend-1', this.gate);
    this.transports.push(transport);
    return prepareTestTransport(transport);
  }
}

class ControlledTransport implements AgentSessionTransport {
  readonly rootPid = 5252;
  readonly closed = new Promise<void>(() => undefined);
  readonly inputs: string[] = [];
  readonly terminateReasons: string[] = [];

  constructor(
    private readonly options: {
      gate?: Promise<void>;
      failAfterGate?: boolean;
      termination?: { closed: boolean; cancelledBeforeWork: boolean };
      terminateError?: Error;
      onTerminate?: () => void;
    } = {}
  ) {}

  send(turn: BackendTurn): BackendTurnStream {
    this.inputs.push(turn.input);
    const options = this.options;
    const events = (async function* () {
      if (options.gate) await options.gate;
      if (options.failAfterGate) throw new Error('controlled turn stopped');
      yield { type: 'init', sessionId: 'backend-controlled-1' } as BackendEvent;
      yield { type: 'result', sessionId: 'backend-controlled-1', content: `result:${turn.input}` } as BackendEvent;
    })();
    return Object.assign(events, { accepted: Promise.resolve() });
  }

  async terminate(reason: string) {
    this.terminateReasons.push(reason);
    this.options.onTerminate?.();
    if (this.options.terminateError) throw this.options.terminateError;
    return this.options.termination ?? { closed: true, cancelledBeforeWork: false };
  }
}

class ControlledBackend implements AgentSessionBackend {
  readonly id = 'replay';
  readonly version = 'controlled/1';
  readonly opens: BackendOpenInput[] = [];

  constructor(readonly transport: ControlledTransport, private readonly openError?: Error) {}

  async prepare(input: BackendOpenInput): Promise<PreparedAgentSessionTransport> {
    this.opens.push(input);
    if (this.openError) throw this.openError;
    return prepareTestTransport(this.transport);
  }
}

class AcceptanceTransport implements AgentSessionTransport {
  readonly rootPid = 6262;
  readonly closed = new Promise<void>(() => undefined);
  readonly inputs: string[] = [];
  terminations = 0;

  constructor(readonly accepted: Promise<void>) {}

  send(turn: BackendTurn): AsyncIterable<BackendEvent> & { accepted: Promise<void> } {
    this.inputs.push(turn.input);
    const events = (async function* () {
      yield { type: 'init', sessionId: 'backend-accepted-1' } as BackendEvent;
      yield {
        type: 'result', sessionId: 'backend-accepted-1', content: `result:${turn.input}`,
      } as BackendEvent;
    })();
    return Object.assign(events, { accepted: this.accepted });
  }

  async terminate() {
    this.terminations += 1;
    return { closed: true, cancelledBeforeWork: false };
  }
}

class ClosableTransport implements AgentSessionTransport {
  readonly rootPid: number;
  readonly inputs: string[] = [];
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private isClosed = false;

  constructor(readonly backendSessionId: string, pid: number) {
    this.rootPid = pid;
    this.closed = new Promise<void>((resolve) => { this.resolveClosed = resolve; });
  }

  closeUnexpectedly(): void {
    this.isClosed = true;
    this.resolveClosed();
  }

  send(turn: BackendTurn): BackendTurnStream {
    this.inputs.push(turn.input);
    const backendSessionId = this.backendSessionId;
    const events = (async function* (transport: ClosableTransport) {
      if (transport.isClosed) throw new Error('transport already closed');
      yield { type: 'init', sessionId: backendSessionId } as BackendEvent;
      yield { type: 'result', sessionId: backendSessionId, content: `result:${turn.input}` } as BackendEvent;
    })(this);
    return Object.assign(events, { accepted: Promise.resolve() });
  }

  async terminate() {
    this.closeUnexpectedly();
    return { closed: true, cancelledBeforeWork: false };
  }
}

class ClosableBackend implements AgentSessionBackend {
  readonly id = 'replay';
  readonly opens: BackendOpenInput[] = [];
  readonly transports: ClosableTransport[] = [];

  async prepare(input: BackendOpenInput): Promise<PreparedAgentSessionTransport> {
    this.opens.push(input);
    const transport = new ClosableTransport(input.resumeSessionId ?? 'backend-close-1', 7000 + this.opens.length);
    this.transports.push(transport);
    return prepareTestTransport(transport);
  }
}

class SlowTerminateBackend implements AgentSessionBackend {
  readonly id = 'replay';
  readonly transports: AgentSessionTransport[] = [];
  started = 0;
  private releaseAll!: () => void;
  private readonly terminationGate = new Promise<void>((resolve) => { this.releaseAll = resolve; });

  release(): void { this.releaseAll(); }

  async prepare(input: BackendOpenInput): Promise<PreparedAgentSessionTransport> {
    const pid = 8000 + this.transports.length;
    const backendSessionId = input.resumeSessionId ?? `backend-slow-${this.transports.length + 1}`;
    const transport: AgentSessionTransport = {
      rootPid: pid,
      closed: new Promise<void>(() => undefined),
      send(turn) {
        const events = (async function* () {
          yield { type: 'init', sessionId: backendSessionId } as BackendEvent;
          yield { type: 'result', sessionId: backendSessionId, content: `result:${turn.input}` } as BackendEvent;
        })();
        return Object.assign(events, { accepted: Promise.resolve() });
      },
      terminate: async () => {
        this.started += 1;
        await this.terminationGate;
        return { closed: true, cancelledBeforeWork: false };
      },
    };
    this.transports.push(transport);
    return prepareTestTransport(transport);
  }
}

class ScheduledTransport implements AgentSessionTransport {
  readonly rootPid = 9090;
  readonly closed = new Promise<void>(() => undefined);

  constructor(private readonly schedule: Array<{ delayMs: number; event: BackendEvent }>) {}

  send(): AsyncIterable<BackendEvent> & { accepted: Promise<void> } {
    const schedule = this.schedule;
    const events = (async function* () {
      for (const item of schedule) {
        await new Promise((resolve) => setTimeout(resolve, item.delayMs));
        yield item.event;
      }
    })();
    return Object.assign(events, { accepted: Promise.resolve() });
  }

  async terminate() { return { closed: true, cancelledBeforeWork: false }; }
}

function trackingOwnership() {
  const state = { releases: 0 };
  return {
    state,
    ownership: {
      async claim() {
        return {
          ownerToken: 'tracked-owner-token',
          async release() {
            state.releases += 1;
          },
        };
      },
      async isClaimed() {
        return false;
      },
      async reapStaleOwner() {
        return 'absent' as const;
      },
    },
  };
}

const limits = {
  timeoutMs: 2_000,
  maxInputBytes: 4096,
  maxOutputBytes: 4096,
  maxDiagnosticBytes: 256,
};

describe('durable backend-neutral SessionHost', () => {
  it('uses independent init, inactivity, and overall clocks with exact reset semantics', async () => {
    const cases: Array<{
      name: string;
      schedule: Array<{ delayMs: number; event: BackendEvent }>;
      message: string;
      clocks: { initTimeoutMs: number; noOutputTimeoutMs: number; overallTimeoutMs: number };
    }> = [
      {
        name: 'initialization',
        schedule: [
          { delayMs: 10, event: { type: 'diagnostic', value: 1 } },
          { delayMs: 10, event: { type: 'diagnostic', value: 2 } },
          { delayMs: 30, event: { type: 'init', sessionId: 'late-init' } },
        ],
        message: 'initialization',
        clocks: { initTimeoutMs: 35, noOutputTimeoutMs: 100, overallTimeoutMs: 150 },
      },
      {
        name: 'no-output',
        schedule: [
          { delayMs: 5, event: { type: 'init', sessionId: 'idle-after-init' } },
          { delayMs: 50, event: { type: 'result', sessionId: 'idle-after-init', content: 'late' } },
        ],
        message: 'no output',
        clocks: { initTimeoutMs: 75, noOutputTimeoutMs: 25, overallTimeoutMs: 150 },
      },
      {
        name: 'overall',
        schedule: [
          { delayMs: 5, event: { type: 'init', sessionId: 'overall' } },
          { delayMs: 15, event: { type: 'diagnostic', value: 1 } },
          { delayMs: 15, event: { type: 'diagnostic', value: 2 } },
          { delayMs: 15, event: { type: 'diagnostic', value: 3 } },
          { delayMs: 15, event: { type: 'result', sessionId: 'overall', content: 'too-late' } },
        ],
        message: 'overall',
        clocks: { initTimeoutMs: 35, noOutputTimeoutMs: 30, overallTimeoutMs: 45 },
      },
    ];

    for (const scenario of cases) {
      const { cwd, stateDir } = tempRoot();
      const transport = new ScheduledTransport(scenario.schedule);
      const host = createSessionHost({
        registry: createSessionHostRegistry({ stateDir }),
        backends: [new ControlledBackend(transport as unknown as ControlledTransport)],
      });
      await host.reconcileOnStart();
      const outcome = await host.dispatch({
        op: 'execute', requestId: randomUUID(), backend: 'replay', cwd,
        input: scenario.name,
        limits: {
          ...limits,
          timeoutMs: 200,
          ...scenario.clocks,
        },
      });
      expect(outcome, scenario.name).toMatchObject({ ok: false, code: 'backend-timeout' });
      if (outcome.ok) throw new Error(`expected ${scenario.name} timeout`);
      expect(outcome.message.toLocaleLowerCase('en-US'), scenario.name).toContain(scenario.message);
    }
  });

  it('drains all hosted transports concurrently before shutdown resolves', async () => {
    const { cwd, stateDir } = tempRoot();
    const backend = new SlowTerminateBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }), backends: [backend],
      ownership: trackingOwnership().ownership,
    });
    await host.reconcileOnStart();
    for (const input of ['one', 'two']) {
      await expect(host.dispatch({
        op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input, limits,
      })).resolves.toMatchObject({ ok: true });
    }
    const shutdown = host.shutdown('server-shutdown');
    for (let attempt = 0; attempt < 100 && backend.started < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const startedBeforeRelease = backend.started;
    backend.release();
    await shutdown;
    expect(startedBeforeRelease).toBe(2);
    expect(host.list().every((session) => session.pid === undefined)).toBe(true);
  });

  it('closes admission and drains an execute held inside backend open before shutdown returns', async () => {
    const { cwd, stateDir } = tempRoot();
    let openStarted!: () => void;
    const started = new Promise<void>((resolve) => { openStarted = resolve; });
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const inputs: string[] = [];
    let terminations = 0;
    const transport: AgentSessionTransport = {
      rootPid: 8282,
      closed: new Promise<void>(() => undefined),
      send(turn) {
        inputs.push(turn.input);
        const events = (async function* () {
          yield { type: 'init', sessionId: 'backend-held-open-1' } as BackendEvent;
          yield { type: 'result', sessionId: 'backend-held-open-1', content: 'unexpected' } as BackendEvent;
        })();
        return Object.assign(events, { accepted: Promise.resolve() });
      },
      async terminate() {
        terminations += 1;
        return { closed: true, cancelledBeforeWork: false };
      },
    };
    const backend: AgentSessionBackend = {
      id: 'replay',
      async prepare() {
        openStarted();
        await openGate;
        return prepareTestTransport(transport);
      },
    };
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
      ownership: trackingOwnership().ownership,
    });
    await host.reconcileOnStart();
    const execution = host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'must-not-send', limits,
    });
    await started;
    const shutdown = host.shutdown('server-shutdown');
    const returnedBeforeOpen = await Promise.race([
      shutdown.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 40)),
    ]);
    releaseOpen();
    await shutdown;
    expect(returnedBeforeOpen).toBe(false);
    await expect(execution).resolves.toMatchObject({ ok: false, code: 'session-busy' });
    expect(inputs).toEqual([]);
    expect(terminations).toBe(1);
    expect(host.list().every((session) => session.pid === undefined)).toBe(true);
  });

  it.each(['closed-false', 'throw'] as const)(
    'retains late-open authority when shutdown cannot observe close (%s)',
    async (mode) => {
      const { cwd, stateDir } = tempRoot();
      const tracked = trackingOwnership();
      let openStarted!: () => void;
      const started = new Promise<void>((resolve) => { openStarted = resolve; });
      let releaseOpen!: () => void;
      const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
      let closeTransport!: () => void;
      const closed = new Promise<void>((resolve) => { closeTransport = resolve; });
      let terminations = 0;
      const transport: AgentSessionTransport = {
        rootPid: 8383,
        closed,
        send() {
          throw new Error('late-open transport must never receive input during shutdown');
        },
        async terminate() {
          terminations += 1;
          if (mode === 'throw') throw new Error('injected late-open termination failure');
          return { closed: false, cancelledBeforeWork: false };
        },
      };
      const backend: AgentSessionBackend = {
        id: 'replay',
        async prepare() {
          openStarted();
          await openGate;
          return prepareTestTransport(transport);
        },
      };
      const host = createSessionHost({
        registry: createSessionHostRegistry({ stateDir }), backends: [backend],
        ownership: tracked.ownership,
      });
      await host.reconcileOnStart();
      const execution = host.dispatch({
        op: 'execute', requestId: randomUUID(), backend: 'replay', cwd,
        input: 'must-not-send', limits,
      });
      await started;
      const shutdown = host.shutdown('server-shutdown');
      releaseOpen();
      await expect(shutdown).rejects.toThrow(/close|shutdown/i);
      await expect(execution).resolves.toMatchObject({ ok: false, code: 'session-busy' });
      expect(host.list()[0]).toMatchObject({ pid: 8383 });
      expect(tracked.state.releases).toBe(0);
      expect(terminations).toBe(1);

      closeTransport();
      await Promise.resolve();
      await expect(host.shutdown('server-shutdown')).resolves.toBeUndefined();
      for (
        let attempt = 0;
        attempt < 50 && (tracked.state.releases === 0 || host.list()[0]?.pid !== undefined);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(tracked.state.releases).toBe(1);
      expect(host.list()[0]?.pid).toBeUndefined();
      expect(terminations).toBe(1);
    }
  );

  it('retries an unobserved late-open close without losing authority or double settlement', async () => {
    const { cwd, stateDir } = tempRoot();
    const tracked = trackingOwnership();
    let openStarted!: () => void;
    const started = new Promise<void>((resolve) => { openStarted = resolve; });
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    let terminations = 0;
    const transport: AgentSessionTransport = {
      rootPid: 8484,
      closed: new Promise<void>(() => undefined),
      send() { throw new Error('late-open transport must never receive input during shutdown'); },
      async terminate() {
        terminations += 1;
        return { closed: terminations >= 2, cancelledBeforeWork: false };
      },
    };
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [{
        id: 'replay',
        async prepare() {
          openStarted();
          await openGate;
          return prepareTestTransport(transport);
        },
      }],
      ownership: tracked.ownership,
    });
    await host.reconcileOnStart();
    const execution = host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd,
      input: 'must-not-send', limits,
    });
    await started;
    const firstShutdown = host.shutdown('server-shutdown');
    releaseOpen();
    await expect(firstShutdown).rejects.toThrow(/close|shutdown/i);
    await expect(execution).resolves.toMatchObject({ ok: false, code: 'session-busy' });
    expect(host.list()[0]).toMatchObject({ pid: 8484 });
    expect(tracked.state.releases).toBe(0);

    await expect(host.shutdown('server-shutdown')).resolves.toBeUndefined();
    expect(terminations).toBe(2);
    expect(tracked.state.releases).toBe(1);
    expect(host.list()[0]?.pid).toBeUndefined();
  });

  it('publishes opaque process authority after preparation and before activation', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    const observed: Array<{ ownerToken?: string; runtimeRef?: string }> = [];
    const transport = new ControlledTransport();
    const backend: AgentSessionBackend = {
      id: 'replay',
      async prepare() {
        const processFacts = registry.list()[0]?.process;
        observed.push({
          ...(processFacts?.ownerToken ? { ownerToken: processFacts.ownerToken } : {}),
          ...(processFacts?.runtimeRef ? { runtimeRef: processFacts.runtimeRef } : {}),
        });
        const prepared = prepareTestTransport(transport);
        return {
          ...prepared,
          async activate() {
            expect(registry.list()[0].process).toMatchObject({
              ownerToken: 'tracked-owner-token',
              runtimeRef: prepared.runtimeRef,
              displayPid: 5252,
            });
            return prepared.activate();
          },
        };
      },
    };
    const host = createSessionHost({
      registry,
      backends: [backend],
      ownership: trackingOwnership().ownership,
    });
    await host.reconcileOnStart();
    const outcome = await host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'bind-authority', limits,
    });
    expect(outcome).toMatchObject({ ok: true, session: { pid: 5252 } });
    expect(observed).toEqual([{}]);
    expect(registry.list()[0].process).toMatchObject({
      ownerToken: 'tracked-owner-token', displayPid: 5252,
    });
  });

  it('finishes durable retiring intent during startup and never reopens the Session', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    const sessionId = randomUUID();
    const canonical = fs.realpathSync.native(cwd);
    await registry.create({
      sessionId,
      backend: 'replay',
      backendSessionId: 'backend-retiring-1',
      cwd: canonical,
      cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      hostState: 'retiring',
      generation: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:01.000Z',
      retirementReason: 'durable-terminal-intent',
      requests: [],
    });
    const backend = new ReplayBackend();
    const host = createSessionHost({ registry, backends: [backend] });
    await expect(host.reconcileOnStart()).resolves.toMatchObject({ ready: true });
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'retired', retirementReason: 'durable-terminal-intent',
    });
    await expect(host.dispatch({ op: 'restart', sessionId })).resolves.toMatchObject({
      ok: false, code: 'session-retired',
    });
    expect(backend.opens).toHaveLength(0);
  });

  it('observes idle transport closure and exact-resumes before accepting the next wake', async () => {
    const { cwd, stateDir } = tempRoot();
    const backend = new ClosableBackend();
    const tracked = trackingOwnership();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }), backends: [backend], ownership: tracked.ownership,
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'first', limits,
    });
    if (!created.ok) throw new Error('expected create success');
    backend.transports[0].closeUnexpectedly();
    for (let attempt = 0; attempt < 100 && host.inspect(created.session.sessionId)?.pid; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const wake = await host.dispatch({
      op: 'execute', requestId: randomUUID(), sessionId: created.session.sessionId,
      backend: 'replay', cwd, input: 'after-idle-close', limits,
    });
    expect(wake).toMatchObject({ ok: true, session: { generation: 2, hostState: 'idle' } });
    expect(backend.opens).toEqual([
      expect.not.objectContaining({ resumeSessionId: expect.anything() }),
      expect.objectContaining({ resumeSessionId: 'backend-close-1' }),
    ]);
    expect(backend.transports[0].inputs).toEqual(['first']);
    expect(backend.transports[1].inputs).toEqual(['after-idle-close']);
    expect(tracked.state.releases).toBe(1);
  });

  it('defers an immediate close observer until valid settlement and then clears process facts', async () => {
    const { cwd, stateDir } = tempRoot();
    const baseRegistry = createSessionHostRegistry({ stateDir });
    let observerRead!: () => void;
    const observerReadPromise = new Promise<void>((resolve) => { observerRead = resolve; });
    let releaseObserver!: () => void;
    const observerGate = new Promise<void>((resolve) => { releaseObserver = resolve; });
    let pausedObserver = false;
    const registry: SessionHostRegistry = {
      paths: baseRegistry.paths,
      load: () => baseRegistry.load(),
      get: (sessionId) => baseRegistry.get(sessionId),
      list: () => baseRegistry.list(),
      create: (record) => baseRegistry.create(record),
      putResult: (result) => baseRegistry.putResult(result),
      readResult: (resultRef, resultDigest) =>
        baseRegistry.readResult(resultRef, resultDigest),
      async update(sessionId, expectedRevision, mutate) {
        const before = baseRegistry.get(sessionId);
        const projected = before ? mutate(structuredClone(before)) : undefined;
        const isCloseObserver =
          !pausedObserver &&
          Boolean(before?.process) &&
          projected?.process === undefined &&
          projected.recoveryReason?.startsWith('resident-transport-closed') === true;
        if (isCloseObserver) {
          pausedObserver = true;
          observerRead();
          await observerGate;
        }
        return baseRegistry.update(sessionId, expectedRevision, mutate);
      },
    };
    let closeTransport!: () => void;
    const closed = new Promise<void>((resolve) => { closeTransport = resolve; });
    const transport: AgentSessionTransport = {
      rootPid: 7373,
      closed,
      send(turn) {
        const events = (async function* () {
          yield { type: 'init', sessionId: 'backend-close-cas-1' } as BackendEvent;
          yield {
            type: 'result', sessionId: 'backend-close-cas-1', content: `result:${turn.input}`,
          } as BackendEvent;
          closeTransport();
        })();
        return Object.assign(events, { accepted: Promise.resolve() });
      },
      async terminate() {
        closeTransport();
        return { closed: true, cancelledBeforeWork: false };
      },
    };
    const host = createSessionHost({
      registry,
      backends: [new ControlledBackend(transport as ControlledTransport)],
      ownership: trackingOwnership().ownership,
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'settles-before-close-cas', limits,
    });
    const settled = await pending;
    await observerReadPromise;
    expect(baseRegistry.list()[0]?.requests[0]?.state).toBe('settled');
    releaseObserver();
    expect(settled).toMatchObject({
      ok: true, session: { hostState: 'idle', currentRequest: { state: 'settled' } },
    });
    for (let attempt = 0; attempt < 100 && host.list()[0]?.pid !== undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(host.list()[0]).toMatchObject({
      hostState: 'idle', currentRequest: { state: 'settled' },
    });
    expect(host.list()[0]?.pid).toBeUndefined();
  });

  it('persists sent only after the exact stdin acceptance fence resolves', async () => {
    const { cwd, stateDir } = tempRoot();
    let accept!: () => void;
    const accepted = new Promise<void>((resolve) => { accept = resolve; });
    const transport = new AcceptanceTransport(accepted);
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport as unknown as ControlledTransport)],
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'accept-fenced', limits,
    });
    while (host.list().length === 0) await new Promise((resolve) => setTimeout(resolve, 2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.list()[0]).toMatchObject({ currentRequest: { state: 'prepared' } });
    accept();
    await expect(pending).resolves.toMatchObject({ ok: true, result: 'result:accept-fenced' });
    expect(host.list()[0]).toMatchObject({ currentRequest: { state: 'settled' } });
  });

  it('classifies a rejected stdin acceptance fence as pre-acceptance, never ambiguous', async () => {
    const { cwd, stateDir } = tempRoot();
    let rejectAcceptance!: (error: Error) => void;
    const acceptance = new Promise<void>((_resolve, reject) => { rejectAcceptance = reject; });
    const transport = new AcceptanceTransport(acceptance);
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport as unknown as ControlledTransport)],
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'never-accepted', limits,
    });
    while (transport.inputs.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));
    rejectAcceptance(new Error('stdin rejected'));
    await expect(pending).resolves.toMatchObject({
      ok: false,
      session: { hostState: 'failed', currentRequest: { state: 'cancelled' } },
    });
    expect(transport.inputs).toEqual(['never-accepted']);
  });

  it('fails closed when a backend adapter omits mandatory acceptance evidence', async () => {
    const { cwd, stateDir } = tempRoot();
    const transport = {
      rootPid: 6363,
      closed: new Promise<void>(() => undefined),
      send(turn: BackendTurn) {
        return (async function* () {
          yield { type: 'init', sessionId: 'backend-missing-acceptance-1' } as BackendEvent;
          yield {
            type: 'result', sessionId: 'backend-missing-acceptance-1', content: `result:${turn.input}`,
          } as BackendEvent;
        })();
      },
      async terminate() {
        return { closed: true, cancelledBeforeWork: false };
      },
    } as unknown as AgentSessionTransport;
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport as ControlledTransport)],
    });
    await host.reconcileOnStart();
    await expect(host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd,
      input: 'missing-acceptance', limits,
    })).resolves.toMatchObject({
      ok: false,
      code: 'backend-protocol-failed',
      session: { currentRequest: { state: 'cancelled' } },
    });
    expect(host.list()[0]?.currentRequest?.state).not.toBe('sent');
  });

  it('bounds the mandatory acceptance fence with the overall turn deadline', async () => {
    const { cwd, stateDir } = tempRoot();
    let rejectAcceptance!: (error: Error) => void;
    const accepted = new Promise<void>((_resolve, reject) => { rejectAcceptance = reject; });
    const transport = new AcceptanceTransport(accepted);
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport as unknown as ControlledTransport)],
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd,
      input: 'acceptance-never-settles',
      limits: { ...limits, timeoutMs: 200, overallTimeoutMs: 30 },
    });
    const observed = await Promise.race([
      pending,
      // The product deadline is asserted below. Leave enough test-only margin for
      // durable failure persistence and exact process-ownership cleanup on a busy
      // Windows runner after that deadline fires.
      new Promise<'unsettled'>((resolve) => setTimeout(() => resolve('unsettled'), 1_000)),
    ]);
    if (observed === 'unsettled') {
      rejectAcceptance(new Error('test cleanup'));
      await pending;
    }
    expect(observed).toMatchObject({
      ok: false,
      code: 'backend-timeout',
      session: { currentRequest: { state: 'cancelled' } },
    });
    expect(transport.terminations).toBe(1);
  });

  it('admits only one of two distinct concurrent wakes and reports the loser session-busy', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const backend = new ReplayBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'create', limits,
    });
    if (!created.ok) throw new Error(`expected create success: ${JSON.stringify(created)}`);

    const live = backend.transports[0] as ReplayTransport;
    Object.defineProperty(live, 'gate', { value: gate });
    const wakes = [
      host.dispatch({
        op: 'execute', requestId: randomUUID(), sessionId: created.session.sessionId,
        backend: 'replay', cwd, input: 'winner-or-loser-a', limits,
      }),
      host.dispatch({
        op: 'execute', requestId: randomUUID(), sessionId: created.session.sessionId,
        backend: 'replay', cwd, input: 'winner-or-loser-b', limits,
      }),
    ];
    while (host.inspect(created.session.sessionId)?.hostState !== 'active') {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    release();
    const outcomes = await Promise.all(wakes);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      expect.objectContaining({ ok: false, code: 'session-busy' }),
    ]);
    expect(live.inputs.filter((input) => input.startsWith('winner-or-loser'))).toHaveLength(1);
  });

  it('never lets a concurrent cancel overwrite terminal retirement', async () => {
    const { cwd, stateDir } = tempRoot();
    const transport = new ControlledTransport();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport)],
      ownership: trackingOwnership().ownership,
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'create', limits,
    });
    if (!created.ok) throw new Error(`expected create success: ${JSON.stringify(created)}`);

    const [retireOutcome] = await Promise.all([
      host.dispatch({ op: 'retire', sessionId: created.session.sessionId, reason: 'terminal' }),
      host.dispatch({ op: 'cancel', sessionId: created.session.sessionId, reason: 'racing-cancel' }),
    ]);
    expect(retireOutcome).toMatchObject({ ok: true, session: { hostState: 'retired' } });
    expect(host.inspect(created.session.sessionId)).toMatchObject({
      hostState: 'retired',
      retirementReason: 'terminal',
    });
  });

  it('keeps retirement intent monotonic while shutdown shares the exact terminator', async () => {
    const { cwd, stateDir } = tempRoot();
    const terminationResolvers: Array<() => void> = [];
    const transport: AgentSessionTransport = {
      rootPid: 5353,
      closed: new Promise<void>(() => undefined),
      send(turn) {
        const events = (async function* () {
          yield { type: 'init', sessionId: 'backend-retire-shutdown-1' } as BackendEvent;
          yield {
            type: 'result',
            sessionId: 'backend-retire-shutdown-1',
            content: `result:${turn.input}`,
          } as BackendEvent;
        })();
        return Object.assign(events, { accepted: Promise.resolve() });
      },
      async terminate() {
        await new Promise<void>((resolve) => terminationResolvers.push(resolve));
        return { closed: true, cancelledBeforeWork: false };
      },
    };
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport as ControlledTransport)],
      ownership: trackingOwnership().ownership,
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute', requestId: randomUUID(), backend: 'replay', cwd, input: 'create', limits,
    });
    if (!created.ok) throw new Error(`expected create success: ${JSON.stringify(created)}`);

    const retirement = host.dispatch({
      op: 'retire', sessionId: created.session.sessionId, reason: 'terminal-intent',
    });
    while (terminationResolvers.length < 1) await new Promise((resolve) => setTimeout(resolve, 2));
    expect(host.inspect(created.session.sessionId)?.hostState).toBe('retiring');

    const shutdown = host.shutdown('server-shutdown');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(terminationResolvers).toHaveLength(1);
    expect(host.inspect(created.session.sessionId)?.hostState).toBe('retiring');

    terminationResolvers[0]();
    await expect(retirement).resolves.toMatchObject({ ok: true, session: { hostState: 'retired' } });
    await shutdown;
    expect(host.inspect(created.session.sessionId)).toMatchObject({
      hostState: 'retired', retirementReason: 'terminal-intent',
    });
  });

  it('keeps one stable Rasen/backend identity across create and two live wakes', async () => {
    const { cwd, stateDir } = tempRoot();
    const backend = new ReplayBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();

    const first = await host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'one',
      limits,
    });
    expect(first).toMatchObject({ ok: true, result: 'result:one' });
    if (!first.ok) throw new Error('expected success');

    for (const input of ['two', 'three']) {
      const wake = await host.dispatch({
        op: 'execute',
        requestId: randomUUID(),
        sessionId: first.session.sessionId,
        backend: 'replay',
        cwd,
        input,
        limits,
      });
      expect(wake).toMatchObject({
        ok: true,
        session: {
          sessionId: first.session.sessionId,
          backendSessionId: 'backend-1',
          generation: 1,
          hostState: 'idle',
        },
        result: `result:${input}`,
      });
    }

    expect(backend.opens).toHaveLength(1);
    expect(backend.transports[0].inputs).toEqual(['one', 'two', 'three']);
  });

  it('rejects unsupported backends before launch', async () => {
    const { cwd, stateDir } = tempRoot();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [],
    });
    await host.reconcileOnStart();
    await expect(
      host.dispatch({
        op: 'execute',
        requestId: randomUUID(),
        backend: 'missing',
        cwd,
        input: 'never sent',
        limits,
      })
    ).resolves.toMatchObject({ ok: false, code: 'unsupported-backend' });
  });

  it('is single-flight and idempotent without writing duplicate input', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend = new ReplayBackend(gate);
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();
    const requestId = randomUUID();
    const pending = host.dispatch({
      op: 'execute',
      requestId,
      backend: 'replay',
      cwd,
      input: 'once',
      limits,
    });
    while (host.list().length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const sessionId = host.list()[0].sessionId;

    const duplicate = await host.dispatch({
      op: 'execute',
      requestId,
      sessionId,
      backend: 'replay',
      cwd,
      input: 'once',
      limits,
    });
    expect(duplicate).toMatchObject({ ok: false, code: 'session-busy' });
    release();
    const settled = await pending;
    expect(settled.ok).toBe(true);

    const replay = await host.dispatch({
      op: 'execute',
      requestId,
      sessionId,
      backend: 'replay',
      cwd,
      input: 'once',
      limits,
    });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(backend.transports[0].inputs).toEqual(['once']);
  });

  it('refuses a pruned terminal request id without a second stdin write', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    const sessionId = randomUUID();
    const prunedRequestId = randomUUID();
    const canonical = fs.realpathSync.native(cwd);
    const base = Date.parse('2026-08-04T00:00:00.000Z');
    await registry.create({
      sessionId,
      backend: 'replay',
      backendSessionId: 'backend-pruned-1',
      cwd: canonical,
      cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      hostState: 'idle',
      generation: 1,
      createdAt: new Date(base).toISOString(),
      updatedAt: new Date(base + 1000).toISOString(),
      requests: Array.from({ length: 65 }, (_, index) => ({
        requestId: index === 0 ? prunedRequestId : randomUUID(),
        inputDigest: createHash('sha256').update(index === 0 ? 'old' : `turn-${index}`, 'utf8').digest('hex'),
        generation: 1,
        state: 'settled' as const,
        preparedAt: new Date(base + index).toISOString(),
        settledAt: new Date(base + index + 1).toISOString(),
        resultDigest: createHash('sha256').update(`result-${index}`, 'utf8').digest('hex'),
      })),
    });
    const backend = new ReplayBackend();
    const host = createSessionHost({ registry, backends: [backend] });
    await expect(host.reconcileOnStart()).resolves.toMatchObject({ ready: true });
    expect(host.inspect(sessionId)?.hostState).toBe('idle');

    await expect(host.dispatch({
      op: 'execute',
      requestId: prunedRequestId,
      sessionId,
      backend: 'replay',
      cwd,
      input: 'old',
      limits,
    })).resolves.toMatchObject({
      ok: false,
      code: 'turn-outcome-unknown',
      requestId: prunedRequestId,
    });
    expect(backend.opens).toHaveLength(0);
  });

  it('binds immutable canonical cwd before any resumed input', async () => {
    const { root, cwd, stateDir } = tempRoot();
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    const backend = new ReplayBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'one',
      limits,
    });
    if (!created.ok) throw new Error('expected create success');

    const alias = path.join(root, 'checkout-alias');
    fs.symlinkSync(cwd, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      sessionId: created.session.sessionId,
      backend: 'replay',
      cwd: alias,
      input: 'through-canonical-alias',
      limits,
    })).resolves.toMatchObject({ ok: true });

    const mismatch = await host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      sessionId: created.session.sessionId,
      backend: 'replay',
      cwd: other,
      input: 'never',
      limits,
    });
    expect(mismatch).toMatchObject({ ok: false, code: 'cwd-mismatch' });
    expect(backend.transports[0].inputs).toEqual(['one', 'through-canonical-alias']);

    fs.rmSync(alias, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    await expect(host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      sessionId: created.session.sessionId,
      backend: 'replay',
      cwd,
      input: 'never-after-removal',
      limits,
    })).resolves.toMatchObject({ ok: false, code: 'cwd-unavailable' });
    expect(backend.transports[0].inputs).toEqual(['one', 'through-canonical-alias']);
  });

  it('recovers an idle record by exact backend identity and only sends the new input', async () => {
    const { cwd, stateDir } = tempRoot();
    const firstBackend = new ReplayBackend();
    const firstHost = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [firstBackend],
    });
    await firstHost.reconcileOnStart();
    const created = await firstHost.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'old',
      limits,
    });
    if (!created.ok) throw new Error('expected create success');
    await firstHost.shutdown('daemon-stop');

    const replacementBackend = new ReplayBackend();
    const replacement = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [replacementBackend],
    });
    await replacement.reconcileOnStart();
    const wake = await replacement.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      sessionId: created.session.sessionId,
      backend: 'replay',
      cwd,
      input: 'new',
      limits,
    });

    expect(wake).toMatchObject({
      ok: true,
      session: { sessionId: created.session.sessionId, generation: 2 },
    });
    expect(replacementBackend.opens).toEqual([
      expect.objectContaining({ resumeSessionId: 'backend-1', cwd: fs.realpathSync.native(cwd) }),
    ]);
    expect(replacementBackend.transports[0].inputs).toEqual(['new']);
  });

  it('makes retirement terminal', async () => {
    const { cwd, stateDir } = tempRoot();
    const backend = new ReplayBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'one',
      limits,
    });
    if (!created.ok) throw new Error('expected create success');
    await expect(
      host.dispatch({ op: 'retire', sessionId: created.session.sessionId, reason: 'done' })
    ).resolves.toMatchObject({ ok: true, session: { hostState: 'retired' } });
    await expect(
      host.dispatch({
        op: 'execute',
        requestId: randomUUID(),
        sessionId: created.session.sessionId,
        backend: 'replay',
        cwd,
        input: 'never',
        limits,
      })
    ).resolves.toMatchObject({ ok: false, code: 'session-retired' });
  });

  it('replays the same settled request after retirement without reopening or resending', async () => {
    const { cwd, stateDir } = tempRoot();
    const backend = new ReplayBackend();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();
    const requestId = randomUUID();
    const command = {
      op: 'execute' as const,
      requestId,
      backend: 'replay',
      cwd,
      input: 'durable-quarantine',
      limits,
    };
    const settled = await host.dispatch(command);
    if (!settled.ok) throw new Error('expected settled Session fixture');
    await expect(host.dispatch({
      op: 'retire',
      sessionId: settled.session.sessionId,
      reason: 'exact-result-quarantined',
    })).resolves.toMatchObject({ ok: true, session: { hostState: 'retired' } });

    await expect(host.dispatch({
      ...command,
      sessionId: settled.session.sessionId,
    })).resolves.toMatchObject({
      ok: true,
      requestId,
      result: 'result:durable-quarantine',
      replayed: true,
      receipt: { requestState: 'settled', replayed: true },
    });
    expect(backend.opens).toHaveLength(1);
    expect(backend.transports[0]?.inputs).toEqual(['durable-quarantine']);
  });

  it('classifies a durable sent turn ambiguous on startup and never replays it', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    await registry.load();
    const sessionId = randomUUID();
    const requestId = randomUUID();
    const canonical = fs.realpathSync.native(cwd);
    await registry.create({
      sessionId,
      backend: 'replay',
      backendSessionId: 'backend-recover-1',
      cwd: canonical,
      cwdDigest: createHash('sha256').update(canonical).digest('hex'),
      hostState: 'active',
      generation: 4,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:01.000Z',
      requests: [
        {
          requestId,
          inputDigest: createHash('sha256').update('possibly-completed').digest('hex'),
          generation: 4,
          state: 'sent',
          preparedAt: '2026-08-04T00:00:00.000Z',
          sentAt: '2026-08-04T00:00:01.000Z',
        },
      ],
    });
    const backend = new ReplayBackend();
    const host = createSessionHost({ registry, backends: [backend] });

    await expect(host.reconcileOnStart()).resolves.toMatchObject({
      ready: true,
      interrupted: 1,
    });
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      currentRequest: { requestId, state: 'ambiguous' },
    });
    expect(backend.opens).toHaveLength(0);
    await expect(
      host.dispatch({
        op: 'execute',
        requestId,
        sessionId,
        backend: 'replay',
        cwd,
        input: 'possibly-completed',
        limits,
      })
    ).resolves.toMatchObject({ ok: false, code: 'turn-outcome-unknown' });
    expect(backend.opens).toHaveLength(0);

    await expect(host.dispatch({ op: 'restart', sessionId })).resolves.toMatchObject({
      ok: true,
      session: { generation: 5, hostState: 'idle' },
    });
    expect(backend.opens).toEqual([
      expect.objectContaining({ resumeSessionId: 'backend-recover-1' }),
    ]);
  });

  it('fences a late terminal result after cancel and retains uncertainty', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend = new ReplayBackend(gate);
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [backend],
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'may-have-run',
      limits,
    });
    while (host.list()[0]?.hostState !== 'active') {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const sessionId = host.list()[0].sessionId;
    const cancelled = await host.dispatch({ op: 'cancel', sessionId, reason: 'operator-cancel' });
    expect(cancelled).toMatchObject({ ok: true, session: { hostState: 'interrupted' } });
    release();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'turn-outcome-unknown',
      session: { hostState: 'interrupted' },
    });
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      currentRequest: { state: 'ambiguous' },
    });
  });

  it('maps transport-close failure caused by active cancel to outcome unknown', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transport = new ControlledTransport({
      gate,
      failAfterGate: true,
      termination: { closed: true, cancelledBeforeWork: false },
      onTerminate: () => release(),
    });
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport)],
    });
    await host.reconcileOnStart();
    const requestId = randomUUID();
    const pending = host.dispatch({
      op: 'execute',
      requestId,
      backend: 'replay',
      cwd,
      input: 'cancel-closes-event-stream',
      limits,
    });
    while (host.list()[0]?.hostState !== 'active') {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const sessionId = host.list()[0].sessionId;

    await expect(host.dispatch({
      op: 'cancel',
      sessionId,
      reason: 'operator-cancel',
    })).resolves.toMatchObject({
      ok: true,
      session: { hostState: 'interrupted', currentRequest: { state: 'ambiguous' } },
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'turn-outcome-unknown',
      requestId,
      session: { hostState: 'interrupted', currentRequest: { state: 'ambiguous' } },
    });
    expect(transport.terminateReasons).toHaveLength(1);
  });

  it('keeps retirement terminal when an active transport reports a late result', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ReplayBackend(gate)],
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'late-after-retire',
      limits,
    });
    while (host.list()[0]?.hostState !== 'active') {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const sessionId = host.list()[0].sessionId;
    const retired = await host.dispatch({ op: 'retire', sessionId, reason: 'operator-retire' });
    expect(retired).toMatchObject({ ok: true, session: { hostState: 'retired' } });
    release();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'turn-outcome-unknown',
      session: { hostState: 'retired', currentRequest: { state: 'ambiguous' } },
    });
    expect(host.inspect(sessionId)).toMatchObject({ hostState: 'retired' });
  });

  it('closes an idle settled owner once and makes repeated cancel idempotent', async () => {
    const { cwd, stateDir } = tempRoot();
    const tracked = trackingOwnership();
    const transport = new ControlledTransport();
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport)],
      ownership: tracked.ownership,
    });
    await host.reconcileOnStart();
    const created = await host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'settled-before-cancel',
      limits,
    });
    if (!created.ok) throw new Error('expected create success');
    expect(created.session.hostState).toBe('idle');
    expect(tracked.state.releases).toBe(0);

    await expect(host.dispatch({
      op: 'cancel',
      sessionId: created.session.sessionId,
      reason: 'close-idle',
    })).resolves.toMatchObject({ ok: true, session: { hostState: 'idle' } });
    expect(host.inspect(created.session.sessionId)).not.toHaveProperty('pid');
    expect(tracked.state.releases).toBe(1);
    expect(transport.terminateReasons).toEqual(['close-idle']);

    await expect(host.dispatch({
      op: 'cancel',
      sessionId: created.session.sessionId,
      reason: 'double-cancel',
    })).resolves.toMatchObject({ ok: true, session: { hostState: 'idle' } });
    expect(tracked.state.releases).toBe(1);
    expect(transport.terminateReasons).toEqual(['close-idle']);
  });

  it('records backend-proven pre-work cancellation and fences the stopped turn', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tracked = trackingOwnership();
    const transport = new ControlledTransport({
      gate,
      failAfterGate: true,
      termination: { closed: true, cancelledBeforeWork: true },
      onTerminate: () => release(),
    });
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport)],
      ownership: tracked.ownership,
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'cancel-before-work',
      limits,
    });
    while (host.list()[0]?.hostState !== 'active') await new Promise((resolve) => setTimeout(resolve, 5));
    const sessionId = host.list()[0].sessionId;

    await expect(host.dispatch({
      op: 'cancel',
      sessionId,
      reason: 'pre-work-proof',
    })).resolves.toMatchObject({
      ok: true,
      session: { hostState: 'idle', currentRequest: { state: 'cancelled' } },
    });
    expect(tracked.state.releases).toBe(1);
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'idle',
      currentRequest: { state: 'cancelled' },
    });
  });

  it('retains exact ownership when cancellation cannot observe process close', async () => {
    for (const mode of ['unobserved', 'throw'] as const) {
      const { cwd, stateDir } = tempRoot();
      const tracked = trackingOwnership();
      const transport = new ControlledTransport(
        mode === 'unobserved'
          ? { termination: { closed: false, cancelledBeforeWork: false } }
          : { terminateError: new Error('injected termination failure') }
      );
      const host = createSessionHost({
        registry: createSessionHostRegistry({ stateDir }),
        backends: [new ControlledBackend(transport)],
        ownership: tracked.ownership,
      });
      await host.reconcileOnStart();
      const created = await host.dispatch({
        op: 'execute',
        requestId: randomUUID(),
        backend: 'replay',
        cwd,
        input: mode,
        limits,
      });
      if (!created.ok) throw new Error('expected create success');
      const result = await host.dispatch({
        op: 'cancel',
        sessionId: created.session.sessionId,
        reason: mode,
      });
      expect(result).toMatchObject({
        ok: false,
        code: mode === 'unobserved' ? 'session-busy' : 'backend-protocol-failed',
        session: { hostState: 'interrupted', pid: 5252 },
      });
      expect(tracked.state.releases, mode).toBe(0);
    }
  });

  it('bounds a no-output/lost-close turn and releases ownership only after forced close evidence', async () => {
    const { cwd, stateDir } = tempRoot();
    const never = new Promise<void>(() => undefined);
    const tracked = trackingOwnership();
    const transport = new ControlledTransport({
      gate: never,
      termination: { closed: true, cancelledBeforeWork: false },
    });
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ControlledBackend(transport)],
      ownership: tracked.ownership,
    });
    await host.reconcileOnStart();
    await expect(host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'never-produces-output',
      limits: { ...limits, timeoutMs: 25 },
    })).resolves.toMatchObject({
      ok: false,
      code: 'backend-timeout',
      session: { hostState: 'interrupted', currentRequest: { state: 'ambiguous' } },
    });
    expect(transport.terminateReasons).toEqual(['turn-failed']);
    expect(tracked.state.releases).toBe(1);
  });

  it('keeps failed restart recoverable and never replays prior input', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    const sessionId = randomUUID();
    const canonical = fs.realpathSync.native(cwd);
    await registry.create({
      sessionId,
      backend: 'replay',
      backendSessionId: 'backend-restart-failure-1',
      cwd: canonical,
      cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      hostState: 'interrupted',
      generation: 3,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:01.000Z',
      requests: [{
        requestId: randomUUID(),
        inputDigest: 'old-input-digest-only',
        generation: 3,
        state: 'ambiguous',
        preparedAt: '2026-08-04T00:00:00.000Z',
      }],
    });
    const backend = new ControlledBackend(
      new ControlledTransport(),
      Object.assign(new Error('restart spawn denied'), { code: 'backend-spawn-failed' })
    );
    const host = createSessionHost({ registry, backends: [backend] });
    await expect(host.reconcileOnStart()).resolves.toMatchObject({ ready: true, interrupted: 1 });
    await expect(host.dispatch({ op: 'restart', sessionId })).resolves.toMatchObject({
      ok: false,
      code: 'backend-spawn-failed',
      session: { hostState: 'interrupted', generation: 4 },
    });
    expect(backend.opens).toEqual([
      expect.objectContaining({ resumeSessionId: 'backend-restart-failure-1' }),
    ]);
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      currentRequest: { state: 'ambiguous' },
    });
  });

  it('retires idle, interrupted, and failed records idempotently and refuses restart/wake forever', async () => {
    for (const state of ['idle', 'interrupted', 'failed'] as const) {
      const { cwd, stateDir } = tempRoot();
      const registry = createSessionHostRegistry({ stateDir });
      const sessionId = randomUUID();
      const canonical = fs.realpathSync.native(cwd);
      await registry.create({
        sessionId,
        backend: 'replay',
        ...(state === 'failed' ? {} : { backendSessionId: `backend-${state}-1` }),
        cwd: canonical,
        cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
        hostState: state,
        generation: 1,
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:01.000Z',
        requests: state === 'interrupted' ? [{
          requestId: randomUUID(),
          inputDigest: 'ambiguous',
          generation: 1,
          state: 'ambiguous',
          preparedAt: '2026-08-04T00:00:00.000Z',
        }] : [],
      });
      const host = createSessionHost({ registry, backends: [new ReplayBackend()] });
      await host.reconcileOnStart();
      await expect(host.dispatch({ op: 'retire', sessionId, reason: `retire-${state}` })).resolves.toMatchObject({
        ok: true,
        session: { hostState: 'retired', retirementReason: `retire-${state}` },
      });
      await expect(host.dispatch({ op: 'retire', sessionId, reason: 'again' })).resolves.toMatchObject({
        ok: true,
        session: { hostState: 'retired', retirementReason: `retire-${state}` },
      });
      await expect(host.dispatch({ op: 'restart', sessionId })).resolves.toMatchObject({
        ok: false,
        code: 'session-retired',
      });
      await expect(host.dispatch({
        op: 'execute',
        requestId: randomUUID(),
        sessionId,
        backend: 'replay',
        cwd,
        input: 'never-after-retire',
        limits,
      })).resolves.toMatchObject({ ok: false, code: 'session-retired' });
    }
  });

  it('publishes shutdown intent before termination and retains uncertainty until close', async () => {
    const { cwd, stateDir } = tempRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const registry = createSessionHostRegistry({ stateDir });
    const tracked = trackingOwnership();
    let stateAtTerminate: string | undefined;
    const transport = new ControlledTransport({
      gate,
      termination: { closed: false, cancelledBeforeWork: false },
      onTerminate: () => {
        stateAtTerminate = registry.list()[0]?.hostState;
      },
    });
    const host = createSessionHost({
      registry,
      backends: [new ControlledBackend(transport)],
      ownership: tracked.ownership,
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'active-during-shutdown',
      limits,
    });
    while (host.list()[0]?.hostState !== 'active') await new Promise((resolve) => setTimeout(resolve, 5));
    const sessionId = host.list()[0].sessionId;
    await expect(host.shutdown('server-shutdown')).rejects.toThrow(/close|shutdown/i);
    expect(stateAtTerminate).toBe('cancelling');
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      pid: 5252,
      currentRequest: { state: 'ambiguous' },
      recoveryReason: 'shutdown-close-unobserved',
    });
    expect(tracked.state.releases).toBe(0);
    release();
    await expect(pending).resolves.toMatchObject({ ok: false, session: { hostState: 'interrupted' } });
    expect(tracked.state.releases).toBe(0);
  });

  it('retains a surviving opaque process scope and refuses unsafe control', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    const sessionId = randomUUID();
    const canonical = fs.realpathSync.native(cwd);
    await registry.create({
      sessionId,
      backend: 'replay',
      backendSessionId: 'backend-survivor-1',
      cwd: canonical,
      cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      hostState: 'idle',
      generation: 2,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:01.000Z',
      process: {
        generation: 2,
        runtimeRef: asProcessRef('rasen-process-scope/1:c3Vydml2aW5nLXNjb3BlLXJlZg'),
        displayPid: 4242,
        ownerToken: 'exact-owner-token',
        preparedAt: '2026-08-04T00:00:01.000Z',
      },
      requests: [],
    });
    const host = createSessionHost({
      registry,
      backends: [new ReplayBackend()],
      ownership: {
        async claim() {
          throw new Error('must not claim over survivor');
        },
        async isClaimed() {
          return true;
        },
        async reapStaleOwner() {
          return 'live-or-uncertain';
        },
      },
      processScope: observationScope('live', 'retained'),
    });

    await expect(host.reconcileOnStart()).resolves.toMatchObject({
      ready: true,
      interrupted: 1,
      diagnostics: [expect.stringContaining(sessionId)],
    });
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      pid: 4242,
      recoveryReason: 'surviving-process-owner-unattachable',
    });
    await expect(host.dispatch({ op: 'restart', sessionId })).resolves.toMatchObject({
      ok: false,
      code: 'session-busy',
      session: { generation: 2, pid: 4242 },
    });
    await expect(
      host.dispatch({ op: 'cancel', sessionId, reason: 'operator-stop' })
    ).resolves.toMatchObject({ ok: false, code: 'session-busy' });
    await expect(
      host.dispatch({ op: 'retire', sessionId, reason: 'operator-retire' })
    ).resolves.toMatchObject({ ok: false, code: 'session-busy' });
  });

  it('reaps only an exact stale owner before classifying its sent turn ambiguous', async () => {
    const { cwd, stateDir } = tempRoot();
    const registry = createSessionHostRegistry({ stateDir });
    const sessionId = randomUUID();
    const requestId = randomUUID();
    const canonical = fs.realpathSync.native(cwd);
    await registry.create({
      sessionId,
      backend: 'replay',
      backendSessionId: 'backend-stale-owner-1',
      cwd: canonical,
      cwdDigest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      hostState: 'active',
      generation: 4,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:01.000Z',
      process: {
        generation: 4,
        runtimeRef: asProcessRef('rasen-process-scope/1:c3RhbGUtc2NvcGUtcmVm'),
        displayPid: 5151,
        ownerToken: 'exact-stale-owner',
        preparedAt: '2026-08-04T00:00:01.000Z',
      },
      requests: [{
        requestId,
        inputDigest: 'sent-digest',
        generation: 4,
        state: 'sent',
        preparedAt: '2026-08-04T00:00:01.000Z',
        sentAt: '2026-08-04T00:00:01.000Z',
      }],
    });
    const reaped: Array<{ sessionId: string; ownerToken: string }> = [];
    const host = createSessionHost({
      registry,
      backends: [new ReplayBackend()],
      ownership: {
        async claim() {
          throw new Error('not used');
        },
        async isClaimed() {
          return false;
        },
        async reapStaleOwner(id, expected) {
          reaped.push({ sessionId: id, ...expected });
          return 'reaped';
        },
      },
      processScope: observationScope('closed'),
    });

    await expect(host.reconcileOnStart()).resolves.toMatchObject({
      ready: true,
      interrupted: 1,
      diagnostics: [expect.stringContaining('was reaped')],
    });
    expect(reaped).toEqual([{
      sessionId,
      ownerToken: 'exact-stale-owner',
    }]);
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      currentRequest: { requestId, state: 'ambiguous' },
    });
    expect(host.inspect(sessionId)?.pid).toBeUndefined();
  });
});
