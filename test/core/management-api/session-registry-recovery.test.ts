import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  acquireDurableSessionWakeLease,
  createSessionHostCoordinator,
  durableSessionMessageIdDigest,
  MAX_DURABLE_IDEMPOTENCY_TOMBSTONES,
  nodeDurableRegistryFileSystem,
  resolveDurableSessionRegistryPaths,
  WINDOWS_DURABLE_WAKE_PERSISTENCE_BUDGET_MS,
  type ClaudeTranscriptFacts,
  type DurableRegistryFileSystem,
  type DurableTouchPolicy,
  type TrustedCanonicalRunRef,
} from '../../../src/core/management-api/session-registry.js';
import type {
  HostLifecycleEvent,
  HostSnapshot,
  SessionSupervisor,
} from '../../../src/core/management-api/supervisor.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

function createFakeSupervisor() {
  const hosts = new Map<string, HostSnapshot>();
  const listeners = new Set<(event: HostLifecycleEvent) => void>();
  let nextHost = 1;
  let nextWake:
    | { ok: true; result?: Record<string, unknown> }
    | { ok: false; code: 'delivery_uncertain' | 'write_failed' | 'turn_timeout' | 'no_output_timeout' }
    = { ok: true };
  let wakeGate: Promise<void> | undefined;
  let releaseWakeGate: (() => void) | undefined;
  let createGate: Promise<void> | undefined;
  let releaseCreateGate: (() => void) | undefined;
  let nextCreateFailure:
    | { code: 'agent_cli_unavailable'; message: string }
    | undefined;
  const calls = {
    create: [] as unknown[],
    wake: [] as unknown[],
    recover: [] as unknown[],
    retire: [] as string[],
    shutdown: 0,
  };

  function liveHost(cwd: string, sessionId: string): HostSnapshot {
    const id = `host-${nextHost++}`;
    const host: HostSnapshot = {
      id,
      state: 'idle',
      cwd,
      pid: 4000 + nextHost,
      sessionId,
      createdAt: Date.now(),
    };
    hosts.set(id, host);
    return host;
  }

  const supervisor = {
    async createHost(input: { cwd: string }) {
      calls.create.push(input);
      if (createGate) await createGate;
      createGate = undefined;
      releaseCreateGate = undefined;
      if (nextCreateFailure) {
        const failure = nextCreateFailure;
        nextCreateFailure = undefined;
        return {
          ok: false as const,
          status: 503 as const,
          code: failure.code,
          message: failure.message,
        };
      }
      const host = liveHost(input.cwd, `claude-session-${nextHost}`);
      return {
        ok: true as const,
        host,
        result: { type: 'result', result: 'bootstrap-secret-result' },
      };
    },
    async wakeHost(id: string, input: unknown) {
      calls.wake.push({ id, input });
      const host = hosts.get(id)!;
      hosts.set(id, { ...host, state: 'waking' });
      if (wakeGate) await wakeGate;
      wakeGate = undefined;
      releaseWakeGate = undefined;
      if (!nextWake.ok) {
        const failed = nextWake;
        nextWake = { ok: true };
        hosts.set(id, { ...host, state: 'lost', pid: undefined });
        return {
          ok: false as const,
          status: failed.code === 'write_failed' ? 500 as const : 409 as const,
          code: failed.code,
          message: failed.code,
          host: { ...host, state: 'lost' as const, pid: undefined },
        };
      }
      const idleHost = { ...host, state: 'idle' as const };
      hosts.set(id, idleHost);
      return {
        ok: true as const,
        host: idleHost,
        result: nextWake.result ?? {
          type: 'result',
          result: 'wake-secret-result',
          protocolBuffer: 'must-not-persist',
        },
      };
    },
    async recoverHost(input: { cwd: string; claudeSessionId: string }) {
      calls.recover.push(input);
      const host = liveHost(input.cwd, input.claudeSessionId);
      return {
        ok: true as const,
        host,
        result: { type: 'result', result: 'recovered-secret-result' },
      };
    },
    async retireHost(id: string) {
      calls.retire.push(id);
      const current = hosts.get(id);
      if (!current) {
        return {
          ok: false as const,
          status: 404 as const,
          code: 'host_not_found' as const,
          message: id,
        };
      }
      const host = { ...current, state: 'retired' as const, pid: undefined };
      hosts.set(id, host);
      return { ok: true as const, host };
    },
    getHost(id: string) {
      const host = hosts.get(id);
      return host ? { ...host } : undefined;
    },
    subscribeHostLifecycle(listener: (event: HostLifecycleEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async shutdownAll() {
      calls.shutdown += 1;
      for (const host of hosts.values()) {
        listeners.forEach((listener) => listener({
          type: 'lost',
          reason: 'owner-shutdown',
          host: { ...host, state: 'lost', pid: undefined },
        }));
      }
      hosts.clear();
    },
  } as unknown as SessionSupervisor;

  return {
    supervisor,
    calls,
    hosts,
    setNextWake(value: typeof nextWake) {
      nextWake = value;
    },
    pauseNextWake() {
      wakeGate = new Promise<void>((resolve) => {
        releaseWakeGate = resolve;
      });
      return () => releaseWakeGate?.();
    },
    pauseNextCreate() {
      createGate = new Promise<void>((resolve) => {
        releaseCreateGate = resolve;
      });
      return () => releaseCreateGate?.();
    },
    failNextCreate() {
      nextCreateFailure = {
        code: 'agent_cli_unavailable',
        message: 'injected bootstrap failure',
      };
    },
  };
}

describe('durable reusable-session coordinator and recovery', () => {
  const temporaryPaths: string[] = [];

  function makeRun(): TrustedCanonicalRunRef {
    const canonicalRunDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-recovery-'))
    );
    temporaryPaths.push(canonicalRunDir);
    return {
      kind: 'trusted-canonical-run',
      runId: 'run-recovery',
      canonicalRunDir,
    };
  }

  function makeWorkspace(): string {
    const cwd = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-session-cwd-'))
    );
    temporaryPaths.push(cwd);
    return cwd;
  }

  const touchPolicy: DurableTouchPolicy = {
    mode: 'auto',
    deadlineAt: '2026-07-30T11:00:00.000Z',
    maxTouches: 2,
    touchesUsed: 0,
    deadlineAction: 'stop',
  };
  const transcriptExists = (): ClaudeTranscriptFacts => ({
    exists: true,
    path: 'exact-transcript.jsonl',
    canonicalPath: 'exact-transcript.jsonl',
    size: 12,
    mtimeMs: 1000,
  });

  afterEach(async () => {
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  async function register(
    coordinator: ReturnType<typeof createSessionHostCoordinator>,
    cwd: string,
    sessionKey = 'reviewer@one',
    messageId = `bootstrap-${sessionKey}`
  ) {
    return coordinator.register({
      sessionKey,
      messageId,
      role: 'reviewer',
      nodeId: 'review',
      invocationId: 'one',
      message: 'bootstrap secret message',
      cwd,
      attachedRoots: [cwd],
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      touchPolicy,
      launcherSessionId: 'launcher-a',
    });
  }

  async function waitForWakeCall(fake: ReturnType<typeof createFakeSupervisor>): Promise<void> {
    const deadline = Date.now() + 5000;
    while (fake.calls.wake.length === 0) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for wake dispatch.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function waitForCreateCall(
    fake: ReturnType<typeof createFakeSupervisor>
  ): Promise<void> {
    const deadline = Date.now() + 5000;
    while (fake.calls.create.length === 0) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for host creation.');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  function makeTombstones(
    count: number,
    dispositions: ReadonlyMap<string, 'completed' | 'pre_delivery_failed' | 'delivery_uncertain'>
      = new Map()
  ) {
    const digests = new Set(dispositions.keys());
    for (let index = 0; digests.size < count; index += 1) {
      digests.add(durableSessionMessageIdDigest(`tombstone-${index}`));
    }
    return [...digests]
      .sort()
      .slice(0, count)
      .map((messageIdDigest) => ({
        messageIdDigest,
        disposition: dispositions.get(messageIdDigest) ?? ('completed' as const),
      }));
  }

  it('registers through bootstrap, exposes typed lookup, stores policy only, and retires terminally', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      ownerPid: 111,
      clock: () => '2026-07-30T09:00:00.000Z',
      transcriptProbe: transcriptExists,
    });

    const registered = await register(coordinator, cwd);
    expect(registered).toMatchObject({
      ok: true,
      session: {
        sessionKey: 'reviewer@one',
        status: 'idle',
        cwd,
        claudeSessionId: 'claude-session-1',
        owner: { ownerInstanceId: 'owner-a', ownerPid: 111 },
      },
      result: { type: 'result' },
    });
    expect(fake.calls.create).toHaveLength(1);
    expect(await coordinator.get('reviewer@one')).toMatchObject({
      ok: true,
      session: { status: 'idle' },
    });
    expect(await coordinator.list()).toMatchObject({
      ok: true,
      sessions: [{ sessionKey: 'reviewer@one' }],
    });

    const policy = await coordinator.updateTouchPolicy('reviewer@one', {
      mode: 'never',
      maxTouches: 0,
      touchesUsed: 0,
      deadlineAction: 'stop',
    });
    expect(policy).toMatchObject({
      ok: true,
      session: { touchPolicy: { mode: 'never' } },
    });
    expect(fake.calls.wake).toHaveLength(0);

    const retired = await coordinator.retire('reviewer@one', 'user-request');
    expect(retired).toMatchObject({
      ok: true,
      session: { status: 'retired' },
    });
    if (retired.ok) expect(retired.session).not.toHaveProperty('owner');
    expect(fake.calls.retire).toEqual(['host-1']);
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'after-retire',
      message: 'must not dispatch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'session_retired' });
  });

  it('fences bootstrap with the stable message id and deduplicates a lost first response', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });

    const first = await register(coordinator, cwd);
    expect(first).toMatchObject({
      ok: true,
      disposition: 'completed',
      wake: {
        outcome: 'completed',
        messageIdDigest: durableSessionMessageIdDigest(
          'bootstrap-reviewer@one'
        ),
      },
    });

    const retry = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'bootstrap-reviewer@one',
      message: 'must not become an ordinary wake',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'interactive',
    });
    expect(retry).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'completed',
    });
    expect(fake.calls.create).toHaveLength(1);
    expect(fake.calls.wake).toHaveLength(0);

    const persisted = fs.readFileSync(
      resolveDurableSessionRegistryPaths(run).registryPath,
      'utf-8'
    );
    expect(persisted).not.toContain('bootstrap-reviewer@one');
    expect(persisted).toContain(
      durableSessionMessageIdDigest('bootstrap-reviewer@one')
    );
  });

  it('deduplicates a same-message bootstrap that overlaps host creation', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const ownerB = createFakeSupervisor();
    const first = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    const raced = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: transcriptExists,
    });

    const releaseBootstrap = ownerA.pauseNextCreate();
    const bootstrap = register(first, cwd);
    await waitForCreateCall(ownerA);
    const sameMessageOverlap = register(raced, cwd);
    releaseBootstrap();
    expect(await bootstrap).toMatchObject({
      ok: true,
      disposition: 'completed',
    });
    expect(await sameMessageOverlap).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'completed',
    });
    expect(ownerA.calls.create).toHaveLength(1);
    expect(ownerA.calls.wake).toHaveLength(0);
    expect(ownerB.calls.create).toHaveLength(0);
  });

  it('returns contention when a distinct-message registration enters before bootstrap settles', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const ownerB = createFakeSupervisor();
    const first = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    const raced = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: transcriptExists,
    });

    const releaseBootstrap = ownerA.pauseNextCreate();
    let bootstrapSettled = false;
    const bootstrap = register(first, cwd).finally(() => {
      bootstrapSettled = true;
    });
    await waitForCreateCall(ownerA);
    const distinctMessageOverlap = register(
      raced,
      cwd,
      'reviewer@one',
      'distinct-overlapping-bootstrap'
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(bootstrapSettled).toBe(false);
    releaseBootstrap();

    expect(await bootstrap).toMatchObject({
      ok: true,
      disposition: 'completed',
    });
    expect(await distinctMessageOverlap).toMatchObject({
      ok: false,
      code: 'wake_busy',
    });
    expect(ownerA.calls.create).toHaveLength(1);
    expect(ownerA.calls.wake).toHaveLength(0);
    expect(ownerB.calls.create).toHaveLength(0);

    expect(
      await first.wake({
        sessionKey: 'reviewer@one',
        messageId: 'later-observed-existing',
        message: 'ordinary wake',
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
      })
    ).toMatchObject({ ok: true, disposition: 'completed' });
    expect(ownerA.calls.create).toHaveLength(1);
    expect(ownerA.calls.wake).toHaveLength(1);
    expect(ownerB.calls.create).toHaveLength(0);
  });

  it('admits conditional touch metadata and accounts completed, retryable, uncertain, and duplicate outcomes', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      clock: () => '2026-07-30T09:00:00.000Z',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);

    const stale = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'touch-stale',
      message: 'touch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'touch',
      expectedLastWakeAt: '2026-07-30T08:59:59.000Z',
      touchOrdinal: 1,
      touchAttempt: 1,
    });
    expect(stale).toMatchObject({
      ok: false,
      code: 'conditional_wake_stale',
    });
    expect(fake.calls.wake).toHaveLength(0);

    const completed = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'touch-1-attempt-1',
      message: 'touch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'touch',
      expectedLastWakeAt: '2026-07-30T09:00:00.000Z',
      touchOrdinal: 1,
      touchAttempt: 1,
    });
    expect(completed).toMatchObject({
      ok: true,
      disposition: 'completed',
      session: { touchPolicy: { touchesUsed: 1 } },
      wake: {
        kind: 'touch',
        touchOrdinal: 1,
        touchAttempt: 1,
      },
    });

    expect(await coordinator.updateTouchPolicy('reviewer@one', {
      ...touchPolicy,
      maxTouches: 3,
      touchesUsed: 1,
    })).toMatchObject({ ok: true });
    fake.setNextWake({ ok: false, code: 'write_failed' });
    const retryable = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'touch-2-attempt-1',
      message: 'retryable touch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'touch',
      expectedLastWakeAt: '2026-07-30T09:00:00.000Z',
      touchOrdinal: 2,
      touchAttempt: 1,
    });
    expect(retryable).toMatchObject({
      ok: false,
      code: 'write_failed',
      session: { touchPolicy: { touchesUsed: 1 } },
      wake: {
        outcome: 'pre_delivery_failed',
        touchOrdinal: 2,
        touchAttempt: 1,
      },
    });

    const retried = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'touch-2-attempt-2',
      message: 'retried touch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'touch',
      expectedLastWakeAt: '2026-07-30T09:00:00.000Z',
      touchOrdinal: 2,
      touchAttempt: 2,
    });
    expect(retried).toMatchObject({
      ok: true,
      session: { touchPolicy: { touchesUsed: 2 } },
      wake: { touchOrdinal: 2, touchAttempt: 2 },
    });

    fake.setNextWake({ ok: false, code: 'delivery_uncertain' });
    const uncertain = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'touch-3-attempt-1',
      message: 'uncertain touch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'touch',
      expectedLastWakeAt: '2026-07-30T09:00:00.000Z',
      touchOrdinal: 3,
      touchAttempt: 1,
    });
    expect(uncertain).toMatchObject({
      ok: false,
      code: 'delivery_uncertain',
      session: { touchPolicy: { touchesUsed: 3 } },
      wake: {
        outcome: 'delivery_uncertain',
        touchOrdinal: 3,
        touchAttempt: 1,
      },
    });
    const dispatches = fake.calls.wake.length + fake.calls.recover.length;
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'touch-3-attempt-1',
      message: 'must remain deduplicated',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
      kind: 'touch',
      expectedLastWakeAt: '2026-07-30T09:00:00.000Z',
      touchOrdinal: 3,
      touchAttempt: 1,
    })).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'delivery_uncertain',
      session: { touchPolicy: { touchesUsed: 3 } },
    });
    expect(fake.calls.wake.length + fake.calls.recover.length)
      .toBe(dispatches);
    expect(await coordinator.updateTouchPolicy('reviewer@one', {
      ...touchPolicy,
      maxTouches: 3,
      touchesUsed: 2,
    })).toMatchObject({
      ok: false,
      code: 'conditional_wake_stale',
      session: { touchPolicy: { touchesUsed: 3 } },
    });
  });

  it('rejects a stale touch-policy mutation after an interactive wake wins', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    let now = '2026-07-30T09:00:00.000Z';
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      clock: () => now,
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);
    const listed = await coordinator.list();
    if (!listed.ok) throw new Error(listed.message);
    const observedLastWakeAt = listed.sessions[0]!.lifecycle.lastWakeAt;
    if (observedLastWakeAt === undefined) {
      throw new Error('Expected the bootstrap wake timestamp.');
    }

    now = '2026-07-30T09:01:00.000Z';
    expect(
      await coordinator.wake({
        sessionKey: 'reviewer@one',
        messageId: 'interactive-wins',
        message: 'interactive wake',
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
        kind: 'interactive',
      })
    ).toMatchObject({
      ok: true,
      session: {
        lifecycle: { lastWakeAt: '2026-07-30T09:01:00.000Z' },
      },
    });

    expect(
      await coordinator.updateTouchPolicy(
        'reviewer@one',
        {
          mode: 'never',
          maxTouches: 0,
          touchesUsed: 0,
          deadlineAction: 'stop',
        },
        observedLastWakeAt
      )
    ).toMatchObject({
      ok: false,
      code: 'conditional_wake_stale',
      session: { touchPolicy: { mode: 'auto' } },
    });
  });

  it('durably reserves starting before host creation and never silently replaces an interrupted registration', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });

    const invalid = await coordinator.register({
      sessionKey: 'invalid-input',
      role: 'reviewer',
      message: 'invalid timeout',
      cwd,
      timeoutMs: 0,
      noOutputTimeoutMs: 1000,
      touchPolicy,
    });
    expect(invalid).toMatchObject({ ok: false, code: 'invalid_transition' });
    expect(fake.calls.create).toHaveLength(0);
    expect(fs.existsSync(resolveDurableSessionRegistryPaths(run).registryPath))
      .toBe(false);

    const releaseCreate = fake.pauseNextCreate();
    const registration = register(coordinator, cwd, 'reviewer@reserved');
    await waitForCreateCall(fake);
    expect(await coordinator.store.get('reviewer@reserved')).toMatchObject({
      ok: true,
      session: {
        status: 'starting',
        cwd,
      },
    });
    const reserved = await coordinator.store.get('reviewer@reserved');
    if (reserved.ok) {
      expect(reserved.session).not.toHaveProperty('owner');
      expect(reserved.session).not.toHaveProperty('claudeSessionId');
    }

    const contender = createSessionHostCoordinator({
      run,
      supervisor: createFakeSupervisor().supervisor,
      ownerInstanceId: 'owner-b',
      wakeLeaseDeadlineMs: 25,
      wakeLeasePollMs: 5,
      transcriptProbe: transcriptExists,
    });
    expect(await register(contender, cwd, 'reviewer@reserved'))
      .toMatchObject({ ok: false, code: 'wake_busy' });

    releaseCreate();
    expect(await registration).toMatchObject({
      ok: true,
      session: {
        sessionKey: 'reviewer@reserved',
        status: 'idle',
        claudeSessionId: 'claude-session-1',
      },
    });
    expect(fake.calls.create).toHaveLength(1);
  });

  it('startup observations do not invalidate a reservation or in-flight bootstrap', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });

    const releaseCreate = fake.pauseNextCreate();
    let releaseReserve!: () => void;
    const reserveGate = new Promise<void>((resolve) => {
      releaseReserve = resolve;
    });
    let markReservationVisible!: () => void;
    const reservationVisible = new Promise<void>((resolve) => {
      markReservationVisible = resolve;
    });
    const originalReserve = coordinator.store.reserve.bind(coordinator.store);
    coordinator.store.reserve = async (input) => {
      const result = await originalReserve(input);
      markReservationVisible();
      await reserveGate;
      return result;
    };

    const registration = register(coordinator, cwd, 'reviewer@startup');
    await reservationVisible;
    const beforeDispatchFence = await coordinator.list();
    releaseReserve();
    await waitForCreateCall(fake);

    const duringBootstrap = await coordinator.list();
    releaseCreate();
    const result = await registration;

    expect(result).toMatchObject({
      ok: true,
      session: { sessionKey: 'reviewer@startup', status: 'idle' },
    });
    expect(beforeDispatchFence).toMatchObject({
      ok: true,
      sessions: [
        { sessionKey: 'reviewer@startup', status: 'starting' },
      ],
    });
    expect(duringBootstrap).toMatchObject({
      ok: true,
      sessions: [
        { sessionKey: 'reviewer@startup', status: 'starting' },
      ],
    });
    expect(fake.calls.retire).toHaveLength(0);
  });

  it('does not protect an older crashed reservation during a conflicting registration', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect(await coordinator.store.reserve({
      sessionKey: 'reviewer@crashed',
      role: 'reviewer',
      nodeId: 'review',
      invocationId: 'one',
      cwd,
      attachedRoots: [cwd],
      touchPolicy,
      launcherSessionId: 'launcher-a',
    })).toMatchObject({
      ok: true,
      session: { status: 'starting' },
    });

    let releaseConflict!: () => void;
    const conflictGate = new Promise<void>((resolve) => {
      releaseConflict = resolve;
    });
    let markConflictVisible!: () => void;
    const conflictVisible = new Promise<void>((resolve) => {
      markConflictVisible = resolve;
    });
    const originalReserve = coordinator.store.reserve.bind(coordinator.store);
    coordinator.store.reserve = async (input) => {
      const result = await originalReserve(input);
      markConflictVisible();
      await conflictGate;
      return result;
    };

    const registration = register(
      coordinator,
      cwd,
      'reviewer@crashed',
      'replacement-bootstrap'
    );
    await conflictVisible;
    const listed = await coordinator.list();
    releaseConflict();
    const result = await registration;

    expect(listed).toMatchObject({
      ok: true,
      sessions: [
        {
          sessionKey: 'reviewer@crashed',
          status: 'stale',
          lifecycle: { reason: 'missing_claude_session_identity' },
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, code: 'wake_busy' });
    expect(fake.calls.create).toHaveLength(0);
  });

  it('keeps an explainable reservation across bootstrap and final-settlement failures', async () => {
    const bootstrapRun = makeRun();
    const cwd = makeWorkspace();
    const bootstrapFake = createFakeSupervisor();
    bootstrapFake.failNextCreate();
    const bootstrapCoordinator = createSessionHostCoordinator({
      run: bootstrapRun,
      supervisor: bootstrapFake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect(await register(bootstrapCoordinator, cwd, 'reviewer@bootstrap-fail'))
      .toMatchObject({ ok: false, code: 'agent_cli_unavailable' });
    expect(await bootstrapCoordinator.store.get('reviewer@bootstrap-fail'))
      .toMatchObject({
        ok: true,
        session: {
          status: 'stale',
          lifecycle: { reason: 'bootstrap_failed:agent_cli_unavailable' },
        },
      });

    const bindRun = makeRun();
    let replacements = 0;
    const bindFilesystem: DurableRegistryFileSystem = {
      ...nodeDurableRegistryFileSystem,
      replace: (sourcePath, targetPath) => {
        replacements += 1;
        if (replacements === 4) {
          throw Object.assign(new Error('injected final settlement crash'), {
            code: 'EIO',
          });
        }
        nodeDurableRegistryFileSystem.replace(sourcePath, targetPath);
      },
    };
    const bindFake = createFakeSupervisor();
    const bindCoordinator = createSessionHostCoordinator({
      run: bindRun,
      supervisor: bindFake.supervisor,
      ownerInstanceId: 'owner-a',
      filesystem: bindFilesystem,
      transcriptProbe: transcriptExists,
    });
    expect(await register(bindCoordinator, cwd, 'reviewer@bind-fail'))
      .toMatchObject({ ok: false, code: 'registry_write_failed' });
    expect(bindFake.calls.create).toHaveLength(1);
    expect(bindFake.calls.retire).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(
      resolveDurableSessionRegistryPaths(bindRun).registryPath,
      'utf-8'
    )).sessions[0]).toMatchObject({
      sessionKey: 'reviewer@bind-fail',
      status: 'starting',
    });
    expect(await bindCoordinator.list()).toMatchObject({
      ok: true,
      sessions: [
        {
          sessionKey: 'reviewer@bind-fail',
          status: 'stale',
          lifecycle: { reason: 'missing_claude_session_identity' },
        },
      ],
    });
  });

  it('serializes distinct registrations and keeps per-session wake admission independent', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      wakeLeaseDeadlineMs: 25,
      wakeLeasePollMs: 5,
      transcriptProbe: transcriptExists,
    });

    const [first, second] = await Promise.all([
      register(coordinator, cwd, 'reviewer@one'),
      register(coordinator, cwd, 'reviewer@two'),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await coordinator.list()).toMatchObject({
      ok: true,
      sessions: [
        { sessionKey: 'reviewer@one' },
        { sessionKey: 'reviewer@two' },
      ],
    });
    const registry = JSON.parse(fs.readFileSync(
      resolveDurableSessionRegistryPaths(run).registryPath,
      'utf-8'
    ));
    expect(registry.revision).toBe(8);

    const held = await acquireDurableSessionWakeLease({
      store: coordinator.store,
      sessionKey: 'reviewer@one',
      ownerInstanceId: 'contender',
      deadlineMs: 100,
      pollMs: 5,
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    try {
      expect(await coordinator.wake({
        sessionKey: 'reviewer@one',
        messageId: 'blocked-a',
        message: 'must not write',
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
      })).toMatchObject({ ok: false, code: 'wake_busy' });
      expect(fake.calls.wake).toHaveLength(0);
      expect(fake.calls.recover).toHaveLength(0);

      expect(await coordinator.wake({
        sessionKey: 'reviewer@two',
        messageId: 'allowed-b',
        message: 'independent wake',
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
      })).toMatchObject({ ok: true, disposition: 'completed' });
      expect(fake.calls.wake).toHaveLength(1);
    } finally {
      await held.lease.release();
    }
  });

  it('persists admission and terminal dispositions without message/result bytes and never redispatches duplicates', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    expect(durableSessionMessageIdDigest('message-1')).toBe(
      'b3469204d2ffdb0751a16be3bf1169fd2075c6b12d5166d643007acb9cfa844d'
    );
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      clock: () => '2026-07-30T09:00:00.000Z',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);

    const completed = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-1',
      message: 'wake secret body',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(completed).toMatchObject({
      ok: true,
      disposition: 'completed',
      wake: {
        outcome: 'completed',
        messageIdDigest: durableSessionMessageIdDigest('message-1'),
      },
    });
    const duplicateCompleted = await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-1',
      message: 'different body must not dispatch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(duplicateCompleted).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'completed',
      messageIdDigest: durableSessionMessageIdDigest('message-1'),
    });
    expect(fake.calls.wake).toHaveLength(1);

    fake.setNextWake({ ok: false, code: 'delivery_uncertain' });
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-2',
      message: 'ambiguous secret body',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: false,
      code: 'delivery_uncertain',
      wake: { outcome: 'delivery_uncertain' },
    });
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-2',
      message: 'must never replay',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'delivery_uncertain',
      messageIdDigest: durableSessionMessageIdDigest('message-2'),
    });
    expect(fake.calls.wake).toHaveLength(2);

    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-3',
      message: 'new explicit recovery',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: true, disposition: 'completed' });
    expect(fake.calls.recover).toHaveLength(1);

    const persisted = fs.readFileSync(
      resolveDurableSessionRegistryPaths(run).registryPath,
      'utf-8'
    );
    expect(persisted).not.toContain('wake secret body');
    expect(persisted).not.toContain('ambiguous secret body');
    expect(persisted).not.toContain('bootstrap-secret-result');
    expect(persisted).not.toContain('wake-secret-result');
    expect(persisted).not.toContain('protocolBuffer');
    expect(persisted).not.toContain('message-1');
    expect(persisted).not.toContain('message-2');
    expect(persisted).not.toContain('message-3');
    expect(persisted).toContain(durableSessionMessageIdDigest('message-1'));
    expect(JSON.parse(persisted).sessions[0].wakes).toHaveLength(4);
  });

  it('preserves a healthy current-owner fence while policy mutation contends with the wake', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      wakeLeaseDeadlineMs: 25,
      wakeLeasePollMs: 5,
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);

    const releaseWake = fake.pauseNextWake();
    const wakePromise = coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'healthy-in-flight',
      message: 'pause until observers finish',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    await waitForWakeCall(fake);
    const inFlightBytes = fs.readFileSync(
      resolveDurableSessionRegistryPaths(run).registryPath,
      'utf-8'
    );
    expect(inFlightBytes).not.toContain('healthy-in-flight');
    expect(inFlightBytes).toContain(
      durableSessionMessageIdDigest('healthy-in-flight')
    );

    expect(await coordinator.get('reviewer@one')).toMatchObject({
      ok: true,
      session: {
        status: 'waking',
        inFlight: {
          messageIdDigest: durableSessionMessageIdDigest('healthy-in-flight'),
          phase: 'dispatching',
        },
        wakes: [{
          messageIdDigest: durableSessionMessageIdDigest(
            'bootstrap-reviewer@one'
          ),
          outcome: 'completed',
        }],
      },
    });
    expect(await coordinator.list()).toMatchObject({
      ok: true,
      sessions: [{
        sessionKey: 'reviewer@one',
        status: 'waking',
        inFlight: {
          messageIdDigest: durableSessionMessageIdDigest('healthy-in-flight'),
        },
        wakes: [{
          messageIdDigest: durableSessionMessageIdDigest(
            'bootstrap-reviewer@one'
          ),
          outcome: 'completed',
        }],
      }],
    });
    expect(await coordinator.updateTouchPolicy('reviewer@one', {
      mode: 'never',
      maxTouches: 0,
      touchesUsed: 0,
      deadlineAction: 'stop',
    })).toMatchObject({
      ok: false,
      code: 'wake_busy',
    });

    releaseWake();
    expect(await wakePromise).toMatchObject({
      ok: true,
      disposition: 'completed',
      wake: {
        messageIdDigest: durableSessionMessageIdDigest('healthy-in-flight'),
        outcome: 'completed',
      },
    });
    const final = await coordinator.get('reviewer@one');
    expect(final).toMatchObject({
      ok: true,
      session: {
        status: 'idle',
        wakes: [
          {
            messageIdDigest: durableSessionMessageIdDigest(
              'bootstrap-reviewer@one'
            ),
            outcome: 'completed',
          },
          {
            messageIdDigest: durableSessionMessageIdDigest(
              'healthy-in-flight'
            ),
            outcome: 'completed',
          },
        ],
      },
    });
    if (final.ok) expect(final.session).not.toHaveProperty('inFlight');
    expect(await coordinator.updateTouchPolicy('reviewer@one', {
      mode: 'never',
      maxTouches: 0,
      touchesUsed: 0,
      deadlineAction: 'stop',
    })).toMatchObject({
      ok: true,
      session: { touchPolicy: { mode: 'never' } },
    });
    expect(fake.calls.wake).toHaveLength(1);
  });

  it('reconciles crash fences conservatively and lets a new owner resume only with exact transcript evidence', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const coordinatorA = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      ownerPid: 111,
      clock: () => '2026-07-30T09:00:00.000Z',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinatorA, cwd)).ok).toBe(true);

    const paths = resolveDurableSessionRegistryPaths(run);
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    registry.revision += 1;
    registry.sessions[0].status = 'waking';
    registry.sessions[0].inFlight = {
      messageIdDigest: durableSessionMessageIdDigest('admitted-before-crash'),
      admittedAt: '2026-07-30T09:01:00.000Z',
      phase: 'admitted',
    };
    fs.writeFileSync(paths.registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const ownerB = createFakeSupervisor();
    const coordinatorB = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      ownerPid: 222,
      clock: () => '2026-07-30T09:02:00.000Z',
      transcriptProbe: transcriptExists,
    });
    const reconciledAdmission = await coordinatorB.reconcile('reviewer@one');
    expect(reconciledAdmission).toMatchObject({
      ok: true,
      session: {
        status: 'lost',
        wakes: [
          {
            messageIdDigest: durableSessionMessageIdDigest(
              'bootstrap-reviewer@one'
            ),
            outcome: 'completed',
          },
          {
            messageIdDigest: durableSessionMessageIdDigest(
              'admitted-before-crash'
            ),
            outcome: 'pre_delivery_failed',
          },
        ],
      },
    });
    if (reconciledAdmission.ok) {
      expect(reconciledAdmission.session).not.toHaveProperty('owner');
      expect(reconciledAdmission.session).not.toHaveProperty('inFlight');
    }

    const afterAdmission = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    afterAdmission.revision += 1;
    afterAdmission.sessions[0].status = 'waking';
    afterAdmission.sessions[0].inFlight = {
      messageIdDigest: durableSessionMessageIdDigest('dispatching-before-crash'),
      admittedAt: '2026-07-30T09:03:00.000Z',
      phase: 'dispatching',
      dispatchFenceAt: '2026-07-30T09:03:01.000Z',
    };
    fs.writeFileSync(paths.registryPath, `${JSON.stringify(afterAdmission, null, 2)}\n`);
    expect(await coordinatorB.reconcile('reviewer@one')).toMatchObject({
      ok: true,
      session: {
        status: 'lost',
        wakes: [
          { outcome: 'completed' },
          { outcome: 'pre_delivery_failed' },
          { outcome: 'delivery_uncertain' },
        ],
      },
    });

    expect(await coordinatorB.wake({
      sessionKey: 'reviewer@one',
      messageId: 'new-owner-wake',
      message: 'resume exact session',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: true, disposition: 'completed' });
    expect(ownerB.calls.recover).toHaveLength(1);
    expect(ownerB.calls.recover[0]).toMatchObject({
      cwd,
      claudeSessionId: 'claude-session-1',
    });
  });

  it('marks missing transcript evidence stale and refuses recovery without spawning', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const coordinatorA = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinatorA, cwd)).ok).toBe(true);

    const ownerB = createFakeSupervisor();
    const coordinatorB = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: () => ({
        exists: false,
        path: 'missing-exact-transcript.jsonl',
        reason: 'missing',
      }),
    });
    expect(await coordinatorB.wake({
      sessionKey: 'reviewer@one',
      messageId: 'must-not-spawn',
      message: 'blocked',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'session_stale' });
    expect(ownerB.calls.recover).toHaveLength(0);
  });

  it('rejects ownerless live schema states before recovery can spawn or write', async () => {
    for (const status of ['idle', 'starting'] as const) {
      const run = makeRun();
      const cwd = makeWorkspace();
      const ownerA = createFakeSupervisor();
      const coordinatorA = createSessionHostCoordinator({
        run,
        supervisor: ownerA.supervisor,
        ownerInstanceId: 'owner-a',
        transcriptProbe: transcriptExists,
      });
      expect((await register(coordinatorA, cwd)).ok).toBe(true);
      const paths = resolveDurableSessionRegistryPaths(run);
      const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
      delete registry.sessions[0].owner;
      registry.sessions[0].status = status;
      fs.writeFileSync(paths.registryPath, `${JSON.stringify(registry, null, 2)}\n`);

      const ownerB = createFakeSupervisor();
      const coordinatorB = createSessionHostCoordinator({
        run,
        supervisor: ownerB.supervisor,
        ownerInstanceId: 'owner-b',
        transcriptProbe: () => ({
          exists: false,
          path: 'missing-exact-transcript.jsonl',
          reason: 'missing',
        }),
      });
      expect(await coordinatorB.wake({
        sessionKey: 'reviewer@one',
        messageId: `invalid-${status}`,
        message: 'must not spawn or write',
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
      })).toMatchObject({ ok: false, code: 'registry_corrupt' });
      expect(ownerB.calls.create).toHaveLength(0);
      expect(ownerB.calls.wake).toHaveLength(0);
      expect(ownerB.calls.recover).toHaveLength(0);
    }
  });

  it('normalizes an ownerless interrupted wake through exact transcript evidence before recovery', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const coordinatorA = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinatorA, cwd)).ok).toBe(true);
    const paths = resolveDurableSessionRegistryPaths(run);
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    delete registry.sessions[0].owner;
    registry.sessions[0].status = 'waking';
    registry.sessions[0].inFlight = {
      messageIdDigest: durableSessionMessageIdDigest('interrupted-ownerless'),
      admittedAt: '2026-07-30T09:01:00.000Z',
      phase: 'admitted',
    };
    fs.writeFileSync(paths.registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const ownerB = createFakeSupervisor();
    const coordinatorB = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: () => ({
        exists: false,
        path: 'missing-exact-transcript.jsonl',
        reason: 'missing',
      }),
    });
    expect(await coordinatorB.wake({
      sessionKey: 'reviewer@one',
      messageId: 'new-message',
      message: 'must fail closed',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: false,
      code: 'session_stale',
      session: {
        status: 'stale',
        wakes: [
          {
            messageIdDigest: durableSessionMessageIdDigest(
              'bootstrap-reviewer@one'
            ),
            outcome: 'completed',
          },
          {
            messageIdDigest: durableSessionMessageIdDigest(
              'interrupted-ownerless'
            ),
            outcome: 'pre_delivery_failed',
          },
        ],
      },
    });
    expect(ownerB.calls.wake).toHaveLength(0);
    expect(ownerB.calls.recover).toHaveLength(0);
  });

  it('refuses missing session identity and a changed canonical cwd without spawning', async () => {
    const missingIdentityRun = makeRun();
    const missingIdentityCwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const coordinatorA = createSessionHostCoordinator({
      run: missingIdentityRun,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinatorA, missingIdentityCwd)).ok).toBe(true);
    const missingIdentityPaths = resolveDurableSessionRegistryPaths(missingIdentityRun);
    const missingIdentityRegistry = JSON.parse(
      fs.readFileSync(missingIdentityPaths.registryPath, 'utf-8')
    );
    delete missingIdentityRegistry.sessions[0].claudeSessionId;
    delete missingIdentityRegistry.sessions[0].owner;
    missingIdentityRegistry.sessions[0].status = 'starting';
    fs.writeFileSync(
      missingIdentityPaths.registryPath,
      `${JSON.stringify(missingIdentityRegistry, null, 2)}\n`
    );
    const ownerB = createFakeSupervisor();
    const coordinatorB = createSessionHostCoordinator({
      run: missingIdentityRun,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: transcriptExists,
    });
    expect(await coordinatorB.wake({
      sessionKey: 'reviewer@one',
      messageId: 'missing-identity',
      message: 'must not spawn',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'session_stale' });
    expect(ownerB.calls.recover).toHaveLength(0);

    const changedCwdRun = makeRun();
    const changedCwd = makeWorkspace();
    const ownerC = createFakeSupervisor();
    const coordinatorC = createSessionHostCoordinator({
      run: changedCwdRun,
      supervisor: ownerC.supervisor,
      ownerInstanceId: 'owner-c',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinatorC, changedCwd)).ok).toBe(true);
    fs.rmSync(changedCwd, { recursive: true, force: true });
    const ownerD = createFakeSupervisor();
    const coordinatorD = createSessionHostCoordinator({
      run: changedCwdRun,
      supervisor: ownerD.supervisor,
      ownerInstanceId: 'owner-d',
      transcriptProbe: transcriptExists,
    });
    expect(await coordinatorD.wake({
      sessionKey: 'reviewer@one',
      messageId: 'changed-cwd',
      message: 'must not spawn',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'session_stale' });
    expect(ownerD.calls.recover).toHaveLength(0);
  });

  it('preserves corrupt restart state and performs no recovery spawn', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const ownerA = createFakeSupervisor();
    const coordinatorA = createSessionHostCoordinator({
      run,
      supervisor: ownerA.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinatorA, cwd)).ok).toBe(true);
    const paths = resolveDurableSessionRegistryPaths(run);
    fs.writeFileSync(paths.registryPath, '{"schema":');

    const ownerB = createFakeSupervisor();
    const coordinatorB = createSessionHostCoordinator({
      run,
      supervisor: ownerB.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: transcriptExists,
    });
    expect(await coordinatorB.wake({
      sessionKey: 'reviewer@one',
      messageId: 'corrupt-registry',
      message: 'must not spawn',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'registry_corrupt' });
    expect(ownerB.calls.create).toHaveLength(0);
    expect(ownerB.calls.wake).toHaveLength(0);
    expect(ownerB.calls.recover).toHaveLength(0);
    expect(fs.readFileSync(paths.registryPath, 'utf-8')).toBe('{"schema":');
  });

  it('fails a new digest closed at 4096 while returning an existing disposition without mutation', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);
    const paths = resolveDurableSessionRegistryPaths(run);
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    const existingDigest = durableSessionMessageIdDigest('capacity-existing');
    const bootstrapDigest = durableSessionMessageIdDigest(
      'bootstrap-reviewer@one'
    );
    registry.sessions[0].idempotencyTombstones = makeTombstones(
      MAX_DURABLE_IDEMPOTENCY_TOMBSTONES,
      new Map<string, 'completed' | 'delivery_uncertain'>([
        [bootstrapDigest, 'completed'],
        [existingDigest, 'delivery_uncertain'],
      ])
    );
    fs.writeFileSync(paths.registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    const priorBytes = fs.readFileSync(paths.registryPath, 'utf-8');
    const contenderFake = createFakeSupervisor();
    let transcriptProbes = 0;
    const capacityCoordinator = createSessionHostCoordinator({
      run,
      supervisor: contenderFake.supervisor,
      ownerInstanceId: 'owner-b',
      transcriptProbe: () => {
        transcriptProbes += 1;
        return transcriptExists();
      },
    });

    const existingStartedAt = performance.now();
    expect(await capacityCoordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'capacity-existing',
      message: 'must remain a duplicate without dispatch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'delivery_uncertain',
      messageIdDigest: existingDigest,
    });
    const existingLookupMs = performance.now() - existingStartedAt;

    const newStartedAt = performance.now();
    expect(await capacityCoordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'capacity-new',
      message: 'must fail before any side effect',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: false,
      code: 'idempotency_capacity_exhausted',
    });
    const newLookupMs = performance.now() - newStartedAt;

    expect(existingLookupMs).toBeLessThan(2000);
    expect(newLookupMs).toBeLessThan(2000);
    expect(fake.calls.wake).toHaveLength(0);
    expect(fake.calls.recover).toHaveLength(0);
    expect(contenderFake.calls.wake).toHaveLength(0);
    expect(contenderFake.calls.recover).toHaveLength(0);
    expect(transcriptProbes).toBe(0);
    expect(fs.readFileSync(paths.registryPath, 'utf-8')).toBe(priorBytes);
  });

  it('inserts the 4096th tombstone in digest order within the bounded mutation budget', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);
    const paths = resolveDurableSessionRegistryPaths(run);
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    const bootstrapDigest = durableSessionMessageIdDigest(
      'bootstrap-reviewer@one'
    );
    registry.sessions[0].idempotencyTombstones = makeTombstones(
      MAX_DURABLE_IDEMPOTENCY_TOMBSTONES - 1,
      new Map([[bootstrapDigest, 'completed']])
    );
    fs.writeFileSync(paths.registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const startedAt = performance.now();
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'capacity-final',
      message: 'one bounded full-file mutation',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: true, disposition: 'completed' });
    const mutationMs = performance.now() - startedAt;
    const current = await coordinator.store.get('reviewer@one');
    expect(current).toMatchObject({ ok: true });
    if (!current.ok) return;

    const tombstones = current.session.idempotencyTombstones;
    expect(tombstones).toHaveLength(MAX_DURABLE_IDEMPOTENCY_TOMBSTONES);
    expect(tombstones.map((entry) => entry.messageIdDigest))
      .toEqual(tombstones.map((entry) => entry.messageIdDigest).sort());
    expect(new Set(tombstones.map((entry) => entry.messageIdDigest)).size)
      .toBe(MAX_DURABLE_IDEMPOTENCY_TOMBSTONES);
    expect(tombstones).toContainEqual({
      messageIdDigest: durableSessionMessageIdDigest('capacity-final'),
      disposition: 'completed',
    });
    expect(Object.keys(tombstones[0]).sort())
      .toEqual(['disposition', 'messageIdDigest']);
    expect(mutationMs).toBeLessThan(10_000);
  }, 15_000);

  it('keeps prior tombstones and presentation history intact when atomic settlement replacement fails', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    let replacements = 0;
    const filesystem: DurableRegistryFileSystem = {
      ...nodeDurableRegistryFileSystem,
      replace: (sourcePath, targetPath) => {
        replacements += 1;
        if (replacements === 7) {
          throw Object.assign(new Error('injected settlement replacement failure'), {
            code: 'EIO',
          });
        }
        nodeDurableRegistryFileSystem.replace(sourcePath, targetPath);
      },
    };
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      filesystem,
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);
    const paths = resolveDurableSessionRegistryPaths(run);
    const registry = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    const priorDigest = durableSessionMessageIdDigest('prior-terminal');
    const priorWakes = registry.sessions[0].wakes;
    const priorTombstones = makeTombstones(
      2,
      new Map<string, 'completed' | 'delivery_uncertain'>([
        [
          durableSessionMessageIdDigest('bootstrap-reviewer@one'),
          'completed',
        ],
        [priorDigest, 'delivery_uncertain'],
      ])
    );
    registry.sessions[0].idempotencyTombstones = priorTombstones;
    fs.writeFileSync(paths.registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'settlement-fails',
      message: 'supervisor completes but registry replacement fails',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'registry_write_failed' });
    expect(replacements).toBe(7);
    const after = JSON.parse(fs.readFileSync(paths.registryPath, 'utf-8'));
    expect(after.sessions[0].idempotencyTombstones).toEqual(priorTombstones);
    expect(after.sessions[0].wakes).toEqual(priorWakes);
    expect(after.sessions[0].inFlight).toMatchObject({
      messageIdDigest: durableSessionMessageIdDigest('settlement-fails'),
      phase: 'dispatching',
    });
  });

  it('bounds presentation history while permanently rejecting pruned message identities within the Windows persistence budget', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    let tick = Date.parse('2026-07-30T09:00:00.000Z');
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      clock: () => new Date(tick++).toISOString(),
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);

    const startedAt = performance.now();
    for (let index = 0; index < 70; index += 1) {
      if (index === 0) {
        fake.setNextWake({ ok: false, code: 'delivery_uncertain' });
      }
      const result = await coordinator.wake({
        sessionKey: 'reviewer@one',
        messageId: `message-${index.toString().padStart(2, '0')}`,
        message: `body-${index}`,
        timeoutMs: 3000,
        noOutputTimeoutMs: 1000,
      });
      if (index === 0) {
        expect(result).toMatchObject({
          ok: false,
          code: 'delivery_uncertain',
        });
      } else {
        expect(result.ok).toBe(true);
      }
    }
    const elapsedMs = performance.now() - startedAt;
    const current = await coordinator.get('reviewer@one');
    expect(current).toMatchObject({
      ok: true,
      session: {
        wakes: expect.arrayContaining([
          expect.objectContaining({
            messageIdDigest: durableSessionMessageIdDigest('message-06'),
          }),
          expect.objectContaining({
            messageIdDigest: durableSessionMessageIdDigest('message-69'),
          }),
        ]),
      },
    });
    if (current.ok) {
      expect(current.session.wakes).toHaveLength(64);
      expect(current.session.wakes[0].messageIdDigest)
        .toBe(durableSessionMessageIdDigest('message-06'));
      expect(current.session.wakes[63].messageIdDigest)
        .toBe(durableSessionMessageIdDigest('message-69'));
      expect(current.session.idempotencyTombstones).toHaveLength(71);
    }
    const supervisorCalls =
      fake.calls.wake.length + fake.calls.recover.length;
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-00',
      message: 'must remain permanently uncertain and never dispatch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'delivery_uncertain',
      messageIdDigest: durableSessionMessageIdDigest('message-00'),
    });
    expect(fake.calls.wake.length + fake.calls.recover.length)
      .toBe(supervisorCalls);
    expect(await coordinator.wake({
      sessionKey: 'reviewer@one',
      messageId: 'message-01',
      message: 'must remain permanently completed and never dispatch',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'completed',
      messageIdDigest: durableSessionMessageIdDigest('message-01'),
    });
    expect(fake.calls.wake.length + fake.calls.recover.length)
      .toBe(supervisorCalls);
    if (process.platform === 'win32') {
      expect(
        elapsedMs / 70,
        `durable wake average ${Math.round(elapsedMs / 70)}ms exceeded the ${WINDOWS_DURABLE_WAKE_PERSISTENCE_BUDGET_MS}ms Windows budget`
      ).toBeLessThanOrEqual(WINDOWS_DURABLE_WAKE_PERSISTENCE_BUDGET_MS);
    }
  }, 60_000);

  it('marks clean owner shutdown as recoverable loss rather than user retirement', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      clock: () => '2026-07-30T09:00:00.000Z',
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);

    expect(await coordinator.ownerShutdown()).toMatchObject({
      ok: true,
      sessions: [{
        sessionKey: 'reviewer@one',
        status: 'lost',
      }],
    });
    expect(fake.calls.shutdown).toBe(1);
    const persisted = JSON.parse(fs.readFileSync(
      resolveDurableSessionRegistryPaths(run).registryPath,
      'utf-8'
    ));
    expect(persisted.sessions[0].status).toBe('lost');
    expect(persisted.sessions[0]).not.toHaveProperty('owner');
    expect(persisted.sessions[0].lifecycle).not.toHaveProperty('retiredAt');
  });

  it('returns a typed failure when owner shutdown cannot settle durable loss', async () => {
    const run = makeRun();
    const cwd = makeWorkspace();
    const fake = createFakeSupervisor();
    let failSettlement = false;
    const filesystem: DurableRegistryFileSystem = {
      ...nodeDurableRegistryFileSystem,
      replace(sourcePath, targetPath) {
        if (failSettlement) {
          throw Object.assign(new Error('injected shutdown settlement failure'), {
            code: 'EIO',
          });
        }
        nodeDurableRegistryFileSystem.replace(sourcePath, targetPath);
      },
    };
    const coordinator = createSessionHostCoordinator({
      run,
      supervisor: fake.supervisor,
      ownerInstanceId: 'owner-a',
      filesystem,
      transcriptProbe: transcriptExists,
    });
    expect((await register(coordinator, cwd)).ok).toBe(true);
    failSettlement = true;

    expect(await coordinator.ownerShutdown()).toMatchObject({
      ok: false,
      code: 'registry_write_failed',
    });
    expect(fake.calls.shutdown).toBe(1);
  });
});
