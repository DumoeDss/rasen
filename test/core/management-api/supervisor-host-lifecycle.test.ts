import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createSessionSupervisor,
  type SessionSupervisor,
} from '../../../src/core/management-api/supervisor.js';
import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';
import { isProcessAlive } from '../../../src/core/management-api/kill-tree.js';
import * as killTreeModule from '../../../src/core/management-api/kill-tree.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const STARTUP_LATENCY_BUFFER_MS = process.platform === 'win32' ? 2000 : 0;
const EVENTS_FILE = 'host-fixture-events.ndjson';

interface FixtureEvent {
  type: 'spawn' | 'delivery';
  pid: number;
  cwd?: string;
  argv?: string[];
  message?: string;
}

describe('reusable session host lifecycle', () => {
  let cwd: string;
  let supervisor: SessionSupervisor | undefined;

  beforeEach(() => {
    cwd = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-')));
    supervisor = makeSupervisor();
  });

  function makeSupervisor(maxConcurrent = 3): SessionSupervisor {
    return createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: async () => fakeClaudeBin,
      maxConcurrent,
      killGraceMs: 100,
    });
  }

  function fixtureEvents(): FixtureEvent[] {
    const eventPath = path.join(cwd, EVENTS_FILE);
    if (!fs.existsSync(eventPath)) return [];
    return fs.readFileSync(eventPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FixtureEvent);
  }

  async function waitFor(
    description: string,
    predicate: () => boolean,
    timeoutMs = 7000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async function createHost(message = 'bootstrap') {
    return supervisor!.createHost({
      message,
      cwd,
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    });
  }

  afterEach(async () => {
    await supervisor?.shutdownAll('server-shutdown');
    await cleanupTempPathAsync(cwd);
  });

  it('creates a live host from a bootstrap turn and leaves it idle', async () => {
    const created = await supervisor!.createHost({
      message: 'bootstrap CHUNKED MALFORMED UNKNOWN',
      cwd,
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.result).toMatchObject({
      type: 'result',
      subtype: 'success',
      result: 'result:bootstrap CHUNKED MALFORMED UNKNOWN',
    });
    expect(created.host).toMatchObject({
      state: 'idle',
      cwd: fs.realpathSync.native(cwd),
      sessionId: 'fake-host-session',
    });
    expect(typeof created.host.id).toBe('string');
    expect(typeof created.host.pid).toBe('number');
    expect(supervisor!.getHost(created.host.id)).toEqual(created.host);

    const initialPid = created.host.pid;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(supervisor!.getHost(created.host.id)).toMatchObject({
      state: 'idle',
      pid: initialPid,
    });
  }, 10_000);

  it('reuses one pid and session identity for sequential wakes', async () => {
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await supervisor!.wakeHost(created.host.id, {
      message: 'wake A',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    const second = await supervisor!.wakeHost(created.host.id, {
      message: 'wake B CHUNKED',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.host.pid).toBe(created.host.pid);
    expect(second.host.pid).toBe(created.host.pid);
    expect(first.host.sessionId).toBe(created.host.sessionId);
    expect(second.host.sessionId).toBe(created.host.sessionId);
    expect(second.host.state).toBe('idle');
    expect(fixtureEvents().filter((event) => event.type === 'delivery').map((event) => event.message))
      .toEqual(['bootstrap', 'wake A', 'wake B CHUNKED']);
  }, 12_000);

  it('disarms turn watchdogs while a healthy host is idle', async () => {
    const created = await supervisor!.createHost({
      message: 'bootstrap',
      cwd,
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 250 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 400 + STARTUP_LATENCY_BUFFER_MS));
    expect(supervisor!.getHost(created.host.id)).toMatchObject({
      state: 'idle',
      pid: created.host.pid,
    });
  }, 12_000);

  it('retains bounded diagnostic tails without losing the newest bytes', async () => {
    const created = await createHost('bootstrap LONG_TAIL');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const tails = supervisor!.getTails(created.host.id)!;
    expect(tails.stderr.length).toBeLessThanOrEqual(64 * 1024);
    expect(tails.stderr).toContain('-suffix');
  }, 10_000);

  it('parses a chunked result larger than the bounded diagnostic tail', async () => {
    const created = await createHost('bootstrap LARGE_RESULT CHUNKED');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.result.result).toMatch(/^large-start:r+/);
    expect(created.result.result).toMatch(/:large-end$/);
    expect((created.result.result as string).length).toBeGreaterThan(128 * 1024);
    expect(supervisor!.getTails(created.host.id)!.stdout.length).toBeLessThanOrEqual(64 * 1024);
  }, 10_000);

  it('waits for both bootstrap identity and result in either order', async () => {
    const initFirst = await createHost('bootstrap INIT_BEFORE_RESULT DELAY_RESULT=50');
    expect(initFirst.ok).toBe(true);
    if (!initFirst.ok) return;
    expect(initFirst.host.sessionId).toBe('fake-host-session');
    const initFirstStdout = supervisor!.getTails(initFirst.host.id)!.stdout;
    expect(initFirstStdout.indexOf('"subtype":"init"'))
      .toBeLessThan(initFirstStdout.indexOf('"type":"result"'));

    const resultFirst = await createHost('bootstrap RESULT_BEFORE_INIT CHUNKED');
    expect(resultFirst.ok).toBe(true);
    if (!resultFirst.ok) return;
    expect(resultFirst.host.sessionId).toBe('fake-host-session');
    const resultFirstStdout = supervisor!.getTails(resultFirst.host.id)!.stdout;
    expect(resultFirstStdout.indexOf('"type":"result"'))
      .toBeLessThan(resultFirstStdout.indexOf('"subtype":"init"'));
  }, 15_000);

  it('bounds silent and active turns independently, then allows explicit recovery', async () => {
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const silent = await supervisor!.wakeHost(created.host.id, {
      message: 'silent NO_RESULT',
      timeoutMs: 3000,
      noOutputTimeoutMs: 100,
    });
    expect(silent).toMatchObject({ ok: false, code: 'no_output_timeout' });
    expect(supervisor!.getHost(created.host.id)?.state).toBe('lost');

    const active = await supervisor!.wakeHost(created.host.id, {
      message: 'active NO_RESULT_WITH_OUTPUT',
      timeoutMs: 600 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(active).toMatchObject({ ok: false, code: 'turn_timeout' });
    expect(supervisor!.getHost(created.host.id)?.state).toBe('lost');

    const healthy = await supervisor!.wakeHost(created.host.id, {
      message: 'healthy after bounded failures',
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(healthy.ok).toBe(true);
  }, 15_000);

  it('cleans every pre-live resource when bootstrap never produces a result', async () => {
    await supervisor!.shutdownAll('server-shutdown');
    supervisor = makeSupervisor(1);
    const failed = await supervisor.createHost({
      message: 'bootstrap NO_RESULT',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 500 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(failed).toMatchObject({ ok: false, code: 'no_output_timeout' });
    expect(failed).not.toHaveProperty('host.id');

    const replacement = await createHost('replacement after failed bootstrap');
    expect(replacement.ok).toBe(true);
  }, 15_000);

  it('shares capacity and the synchronous drain gate with one-shot sessions', async () => {
    await supervisor!.shutdownAll('server-shutdown');
    supervisor = makeSupervisor(1);
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const oneShot = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen-auto',
      task: 'MODE=fast-exit capacity',
      cwd,
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    const secondHost = await createHost('second bootstrap');
    expect(oneShot).toMatchObject({ ok: false, code: 'busy' });
    expect(secondHost).toMatchObject({ ok: false, code: 'busy' });

    const draining = supervisor.shutdownAll('server-shutdown');
    const rejectedDuringDrain = await createHost('during drain');
    expect(rejectedDuringDrain).toMatchObject({ ok: false, code: 'shutting_down' });
    await draining;
  }, 15_000);

  it('rejects an overlapping wake before delivery and admits a later wake', async () => {
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wakeA = supervisor!.wakeHost(created.host.id, {
      message: 'wake A DELAY_RESULT=200',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    const wakeB = await supervisor!.wakeHost(created.host.id, {
      message: 'wake B rejected',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(wakeB).toMatchObject({ ok: false, code: 'host_busy' });
    expect((await wakeA).ok).toBe(true);

    const wakeC = await supervisor!.wakeHost(created.host.id, {
      message: 'wake C admitted',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(wakeC.ok).toBe(true);
    expect(fixtureEvents().filter((event) => event.type === 'delivery').map((event) => event.message))
      .toEqual(['bootstrap', 'wake A DELAY_RESULT=200', 'wake C admitted']);
  }, 12_000);

  it('keeps wake admission independent across different hosts', async () => {
    const hostA = await createHost('bootstrap A');
    const hostB = await createHost('bootstrap B');
    expect(hostA.ok).toBe(true);
    expect(hostB.ok).toBe(true);
    if (!hostA.ok || !hostB.ok) return;

    const delayedA = supervisor!.wakeHost(hostA.host.id, {
      message: 'host A DELAY_RESULT=200',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    const promptB = await supervisor!.wakeHost(hostB.host.id, {
      message: 'host B immediate',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(promptB.ok).toBe(true);
    expect((await delayedA).ok).toBe(true);
  }, 12_000);

  it('recovers an idle loss with the stable host id, original cwd, and resume identity', async () => {
    const created = await createHost('bootstrap IDLE_LOSS');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const originalPid = created.host.pid;

    await waitFor('idle host loss', () => supervisor!.getHost(created.host.id)?.state === 'lost');
    const recovered = await supervisor!.wakeHost(created.host.id, {
      message: 'after idle loss',
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    });

    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.host.id).toBe(created.host.id);
    expect(recovered.host.pid).not.toBe(originalPid);
    expect(recovered.host.sessionId).toBe('fake-host-session');
    const spawns = fixtureEvents().filter((event) => event.type === 'spawn');
    expect(spawns).toHaveLength(2);
    expect(spawns[1].cwd).toBe(fs.realpathSync.native(cwd));
    expect(spawns[1].argv).toContain('--resume');
    expect(spawns[1].argv).toContain('fake-host-session');
  }, 15_000);

  it('bounded-fails and cleans bootstrap when the session identity never arrives', async () => {
    await supervisor!.shutdownAll('server-shutdown');
    supervisor = makeSupervisor(1);
    const failed = await supervisor.createHost({
      message: 'bootstrap MISSING_INIT',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 250 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(failed).toMatchObject({ ok: false, code: 'no_output_timeout' });
    expect(failed).not.toHaveProperty('host.id');
    expect(fixtureEvents().filter((event) => event.type === 'spawn')).toHaveLength(1);

    const replacement = await createHost('replacement after missing identity');
    expect(replacement.ok).toBe(true);
  }, 15_000);

  it('reports ambiguous mid-turn loss once and never replays the accepted message', async () => {
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const uncertain = await supervisor!.wakeHost(created.host.id, {
      message: 'side effect MIDTURN_LOSS',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    expect(uncertain).toMatchObject({ ok: false, code: 'delivery_uncertain' });
    expect(supervisor!.getHost(created.host.id)?.state).toBe('lost');

    const recovered = await supervisor!.wakeHost(created.host.id, {
      message: 'explicit recovery wake',
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(recovered.ok).toBe(true);
    const deliveries = fixtureEvents()
      .filter((event) => event.type === 'delivery')
      .map((event) => event.message);
    expect(deliveries.filter((message) => message === 'side effect MIDTURN_LOSS')).toHaveLength(1);
    expect(deliveries).toEqual(['bootstrap', 'side effect MIDTURN_LOSS', 'explicit recovery wake']);
  }, 15_000);

  it('settles a backpressured stdin close exactly once and remains safe to retire', async () => {
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect((await supervisor!.wakeHost(created.host.id, {
      message: 'arm ARM_CLOSE_DURING_WRITE',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).ok).toBe(true);

    const uncertainWake = supervisor!.wakeHost(created.host.id, {
      message: `large accepted input ${'x'.repeat(2 * 1024 * 1024)}`,
      timeoutMs: 5000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 2000 + STARTUP_LATENCY_BUFFER_MS,
    });
    const retirement = supervisor!.retireHost(created.host.id);
    const uncertain = await uncertainWake;
    expect(uncertain).toMatchObject({ ok: false, code: 'delivery_uncertain' });
    expect(await retirement)
      .toMatchObject({ ok: true, host: { state: 'retired' } });
  }, 20_000);

  it('makes retirement terminal while allowing an accepted wake to settle', async () => {
    const created = await createHost();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const accepted = supervisor!.wakeHost(created.host.id, {
      message: 'accepted DELAY_RESULT=150',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });
    const retirement = supervisor!.retireHost(created.host.id);
    const rejected = await supervisor!.wakeHost(created.host.id, {
      message: 'too late',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    });

    expect(rejected).toMatchObject({ ok: false, code: 'host_busy', host: { state: 'retiring' } });
    expect((await accepted).ok).toBe(true);
    const retired = await retirement;
    expect(retired).toMatchObject({ ok: true, host: { state: 'retired' } });
    expect(await supervisor!.retireHost(created.host.id)).toEqual(retired);
    expect(await supervisor!.wakeHost(created.host.id, {
      message: 'after retirement',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'host_retired' });
  }, 15_000);

  it('retires a lost host without recovery and escalates a resistant live host', async () => {
    const lost = await createHost('bootstrap IDLE_LOSS');
    expect(lost.ok).toBe(true);
    if (!lost.ok) return;
    await waitFor('host to become lost', () => supervisor!.getHost(lost.host.id)?.state === 'lost');
    const spawnCount = fixtureEvents().filter((event) => event.type === 'spawn').length;
    expect(await supervisor!.retireHost(lost.host.id)).toMatchObject({ ok: true, host: { state: 'retired' } });
    expect(fixtureEvents().filter((event) => event.type === 'spawn')).toHaveLength(spawnCount);

    const resistant = await createHost('bootstrap SIGTERM_RESISTANT');
    expect(resistant.ok).toBe(true);
    if (!resistant.ok || resistant.host.pid === undefined) return;
    const resistantPid = resistant.host.pid;
    const killSpy = vi.spyOn(killTreeModule, 'killProcessTree');
    const retired = await supervisor!.retireHost(resistant.host.id);
    expect(retired).toMatchObject({ ok: true, host: { state: 'retired' } });
    expect(killSpy).toHaveBeenCalledWith(resistantPid, { graceMs: 100 });
    await waitFor('resistant process-tree cleanup', () => !isProcessAlive(resistantPid));
    killSpy.mockRestore();
  }, 20_000);

  it('releases a lost slot exactly once and reacquires it only for recovery', async () => {
    await supervisor!.shutdownAll('server-shutdown');
    supervisor = makeSupervisor(1);
    const lost = await createHost('bootstrap IDLE_LOSS');
    expect(lost.ok).toBe(true);
    if (!lost.ok) return;
    await waitFor('capacity host loss', () => supervisor!.getHost(lost.host.id)?.state === 'lost');

    const occupant = await createHost('occupant');
    expect(occupant.ok).toBe(true);
    if (!occupant.ok) return;
    expect(await supervisor!.wakeHost(lost.host.id, {
      message: 'blocked recovery',
      timeoutMs: 3000,
      noOutputTimeoutMs: 1000,
    })).toMatchObject({ ok: false, code: 'busy' });

    await supervisor!.retireHost(occupant.host.id);
    expect((await supervisor!.wakeHost(lost.host.id, {
      message: 'recovery after release',
      timeoutMs: 3000 + STARTUP_LATENCY_BUFFER_MS,
      noOutputTimeoutMs: 1000 + STARTUP_LATENCY_BUFFER_MS,
    })).ok).toBe(true);
  }, 20_000);

  it('shutdownAll reaps mixed one-shot and reusable processes without retiring hosts', async () => {
    const host = await createHost();
    expect(host.ok).toBe(true);
    if (!host.ok) return;
    const oneShot = await supervisor!.launch({
      kind: 'auto',
      skill: '/rasen-auto',
      task: 'MODE=never-exits-ignores-nothing mixed shutdown',
      cwd,
      timeoutMs: 10_000,
      noOutputTimeoutMs: 10_000,
    });
    expect(oneShot.ok).toBe(true);
    if (!oneShot.ok) return;

    await supervisor!.shutdownAll('server-shutdown');
    expect(supervisor!.getHost(host.host.id)?.state).toBe('lost');
    expect(supervisor!.getRecord(oneShot.record.id)).toMatchObject({
      state: 'exited',
      terminationReason: 'server-shutdown',
    });
  }, 15_000);
});
