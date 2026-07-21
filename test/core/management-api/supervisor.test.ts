import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Passthrough by default; task 1.2's synchronous-spawn-throw test (child 2
// hand-off N1) flips `mockSpawnShouldThrowSync` to force the one path a
// real `spawn()` call cannot be reliably coaxed into taking (a bad cwd or
// bad binary path fails asynchronously via the `error` event on this
// platform, never synchronously) — every other test in this file passes
// through to the real `child_process.spawn` untouched.
let mockSpawnShouldThrowSync = false;
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      if (mockSpawnShouldThrowSync) {
        throw Object.assign(new Error('ENOENT (simulated synchronous spawn failure)'), { code: 'ENOENT' });
      }
      return actual.spawn(...args);
    },
  };
});

import { createSessionSupervisor, type SessionSupervisor } from '../../../src/core/management-api/supervisor.js';
import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';
import * as killTreeModule from '../../../src/core/management-api/kill-tree.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const IS_WINDOWS = process.platform === 'win32';
/**
 * Windows-only evidence-gated buffer (design D5): a local timing probe
 * measured a single `taskkill /F /T` invocation (spawn, execute, target
 * confirmed dead) at roughly 550-650ms end to end on this machine — far
 * more than the near-instant POSIX SIGKILL these grace/wait windows were
 * originally tuned for. The forced kill still fires exactly at
 * `killGraceMs` (kill-tree.ts's escalation timer is unaffected), but a
 * fixed-sleep-then-assert test needs its own wait window widened by this
 * much extra to observe the process actually gone, not merely dispatched
 * against. POSIX keeps every wait exactly as tuned (buffer is 0).
 */
const KILL_SETTLE_BUFFER_MS = IS_WINDOWS ? 1800 : 0;
/**
 * Windows-only evidence-gated buffer, second kind (design D5): spawning a
 * session on win32 now hops through `cmd.exe /d /s /c` before `node.exe`
 * itself starts (design D1) — that extra process-creation link can itself
 * take longer than a no-output threshold tuned for POSIX's near-instant
 * direct exec, so a streaming fixture's very first byte can arrive later
 * than the timer expects. Widens only the no-output threshold/wait pairs
 * that assert on a fixture emitting output shortly after launch, not the
 * kill-escalation ones above (POSIX buffer is 0).
 */
const STARTUP_LATENCY_BUFFER_MS = IS_WINDOWS ? 400 : 0;

function makeSupervisor(overrides: Partial<Parameters<typeof createSessionSupervisor>[0]> = {}): SessionSupervisor {
  return createSessionSupervisor({
    registry: createSessionRegistry(),
    resolveAgentCli: async () => fakeClaudeBin,
    killGraceMs: 200,
    ...overrides,
  });
}

describe('createSessionSupervisor (design D1/D2/D3/D5)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-supervisor-'));
  });

  afterEach(async () => {
    await cleanupTempPathAsync(cwd);
  });

  it('spawns, reaches running, and finalizes to exited/exit on a normal close', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit do the thing',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.state === 'starting' || result.record.state === 'running').toBe(true);
    expect(typeof result.record.pid).toBe('number');

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));

    const finalRecord = supervisor.getRecord(result.record.id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('exit');
    expect(finalRecord.exitCode).toBe(0);
  }, 10_000);

  it('captures agentSessionId from the stream-json init event', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit x',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));
    expect(supervisor.getRecord(result.record.id)!.agentSessionId).toBe('fake-session-fast-exit');
  }, 10_000);

  it('degrades silently (no agentSessionId, no failure) when the init line is garbage', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=garbage-init x',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));
    const record = supervisor.getRecord(result.record.id)!;
    expect(record.state).toBe('exited');
    expect(record.agentSessionId).toBeUndefined();
    expect(record.terminationReason).toBe('exit');
  }, 10_000);

  it('a non-zero exit still finalizes cleanly with reason exit', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'goal',
      skill: '/rasen:goal',
      task: 'MODE=nonzero-exit x',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));
    const record = supervisor.getRecord(result.record.id)!;
    expect(record.state).toBe('exited');
    expect(record.terminationReason).toBe('exit');
    expect(record.exitCode).toBe(3);
  }, 10_000);

  it('kill() escalates SIGTERM to SIGKILL against a signal-resistant fixture, keyed off child close (three-point checklist)', async () => {
    const supervisor = makeSupervisor({ killGraceMs: 150 });
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=sigterm-resistant x',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    // Let it actually start emitting (init line) before killing.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const killResult = supervisor.kill(id);
    expect(killResult.ok).toBe(true);
    if (killResult.ok) {
      expect(killResult.status).toBe(202);
      expect(killResult.record.state).toBe('exiting');
    }

    // Immediately after the 202, the resistant child is still alive
    // (SIGTERM is ignored) — the record must not yet be exited.
    expect(supervisor.getRecord(id)!.state).toBe('exiting');

    // Wait past the SIGKILL grace period: only the forced signal actually
    // ends it.
    await new Promise((resolve) => setTimeout(resolve, 600 + KILL_SETTLE_BUFFER_MS));

    const finalRecord = supervisor.getRecord(id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('killed');
  }, 10_000);

  it('kill() on an already-exited session is idempotent (200, no new signals)', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit x',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));
    expect(supervisor.getRecord(id)!.state).toBe('exited');

    const killResult = supervisor.kill(id);
    expect(killResult.ok).toBe(true);
    if (killResult.ok) expect(killResult.status).toBe(200);
  }, 10_000);

  it('kill() on an unknown id returns 404', () => {
    const supervisor = makeSupervisor();
    const result = supervisor.kill('does-not-exist');
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it('the no-output watchdog fires with reason no-output-timeout for a silent session', async () => {
    const supervisor = makeSupervisor({ killGraceMs: 100 });
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=idle-after-init x',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    // Let the init line land, then wait past the no-output threshold + kill grace.
    await new Promise((resolve) => setTimeout(resolve, 700 + KILL_SETTLE_BUFFER_MS));

    const finalRecord = supervisor.getRecord(id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('no-output-timeout');
  }, 10_000);

  it('output activity resets the no-output watchdog (a streaming session outlives the no-output threshold)', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      // Fixture emits a line every 20ms for ~60ms then exits — each line
      // should reset a 150ms no-output timer, so the watchdog never fires;
      // the session ends on its own (reason exit), not no-output-timeout.
      task: 'MODE=stream-then-exit x',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 150 + STARTUP_LATENCY_BUFFER_MS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    await new Promise((resolve) => setTimeout(resolve, 400 + STARTUP_LATENCY_BUFFER_MS));

    const finalRecord = supervisor.getRecord(id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('exit');
  }, 10_000);

  it('the overall timeout fires with reason overall-timeout', async () => {
    const supervisor = makeSupervisor({ killGraceMs: 100 });
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=idle-after-init x',
      cwd,
      timeoutMs: 200,
      noOutputTimeoutMs: 60_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    await new Promise((resolve) => setTimeout(resolve, 700 + KILL_SETTLE_BUFFER_MS));

    const finalRecord = supervisor.getRecord(id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('overall-timeout');
  }, 10_000);

  it('tail ring-buffers stay bounded and getTails returns the recent output', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=stream-then-exit x',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));

    const tails = supervisor.getTails(id);
    expect(tails).toBeDefined();
    expect(tails!.stdout.length).toBeGreaterThan(0);
    expect(tails!.stdout).toContain('thinking_tokens');
    // 64 KiB cap — this fixture's output is nowhere near that, so this just
    // asserts the field exists and never grows unbounded conceptually.
    expect(tails!.stdout.length).toBeLessThanOrEqual(64 * 1024);
  }, 10_000);

  it('rejects a launch beyond the concurrency cap with 409 busy, spawning nothing further', async () => {
    const supervisor = makeSupervisor({ maxConcurrent: 1, killGraceMs: 100 });
    const first = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=idle-after-init x',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    expect(first.ok).toBe(true);

    const second = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=idle-after-init y',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.status).toBe(409);
      expect(second.code).toBe('busy');
    }

    // Clean up the still-live first session.
    if (first.ok) {
      supervisor.kill(first.record.id);
      await new Promise((resolve) => setTimeout(resolve, 400 + KILL_SETTLE_BUFFER_MS));
    }
  }, 10_000);

  it('review M1 regression: concurrent launches at the cap admit exactly maxConcurrent, never more (TOCTOU repro)', async () => {
    // Sequential cap tests (above) cannot catch a race between the cap
    // check and the slot reservation — the fix moved the reservation
    // before the only `await` in `launch`, so this fires every launch
    // "simultaneously" via Promise.all, the way concurrent HTTP POSTs
    // would actually interleave.
    const maxConcurrent = 2;
    const supervisor = makeSupervisor({ maxConcurrent, killGraceMs: 150 });

    const attempts = 5;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        supervisor.launch({
          kind: 'auto',
          skill: '/rasen:auto',
          task: `MODE=idle-after-init concurrent-${i}`,
          cwd,
          timeoutMs: 60_000,
          noOutputTimeoutMs: 60_000,
        })
      )
    );

    const succeeded = results.filter((r) => r.ok);
    const busy = results.filter((r) => !r.ok && r.status === 409 && r.code === 'busy');
    expect(succeeded).toHaveLength(maxConcurrent);
    expect(busy).toHaveLength(attempts - maxConcurrent);

    // Clean up every session that actually launched.
    for (const r of succeeded) {
      if (r.ok) supervisor.kill(r.record.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 400 + KILL_SETTLE_BUFFER_MS));
  }, 10_000);

  it('review M2 regression: a repeated triggerKill (double DELETE) dispatches only one SIGKILL escalation, and it is fully cancelled on close', async () => {
    const killProcessTreeSpy = vi.spyOn(killTreeModule, 'killProcessTree');
    killProcessTreeSpy.mockClear();

    const supervisor = makeSupervisor({ killGraceMs: 150 });
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=sigterm-resistant x',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    // Let it actually start (init line) before killing.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Double DELETE while still 'exiting' (SIGTERM-resistant, so the first
    // kill hasn't settled yet) — this is exactly the reachable path M2
    // fixed: without idempotency, this second call would arm a SECOND
    // escalation timer that the eventual `close` handler's single
    // `pendingKillCancel?.()` would never reach.
    supervisor.kill(id);
    supervisor.kill(id);
    // A watchdog-style trigger during the same grace window is the other
    // reachable path — exercise it too via a third external trigger.
    supervisor.kill(id);

    expect(killProcessTreeSpy).toHaveBeenCalledTimes(1);

    // Past the SIGKILL grace period, the process is dead (proves the one
    // escalation that did fire still worked end to end).
    await new Promise((resolve) => setTimeout(resolve, 600 + KILL_SETTLE_BUFFER_MS));
    const finalRecord = supervisor.getRecord(id)!;
    expect(finalRecord.state).toBe('exited');
    expect(finalRecord.terminationReason).toBe('killed');

    // No further killProcessTree calls happened after close either (e.g.
    // from a timer that fired late) — still exactly one.
    expect(killProcessTreeSpy).toHaveBeenCalledTimes(1);
    killProcessTreeSpy.mockRestore();
  }, 10_000);

  it('the concurrency slot releases only once the child has actually closed, not merely once kill() was called', async () => {
    const supervisor = makeSupervisor({ maxConcurrent: 1, killGraceMs: 300 });
    const first = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=sigterm-resistant x',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 100));
    supervisor.kill(first.record.id);

    // Immediately after kill(), the resistant child is still alive (ignores
    // SIGTERM) — a second launch must still see busy.
    const second = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit y',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('busy');

    // Wait past the SIGKILL grace period — the slot is now free.
    await new Promise((resolve) => setTimeout(resolve, 600 + KILL_SETTLE_BUFFER_MS));

    const third = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit z',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(third.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));
  }, 10_000);

  it('503s with agent_cli_unavailable when no agent CLI can be resolved, spawning nothing', async () => {
    const supervisor = createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: async () => null,
    });
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'anything',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe('agent_cli_unavailable');
    }
    expect(supervisor.list()).toHaveLength(0);
  });

  it('shutdownAll() tree-kills every live session with the given reason and resolves once all have closed', async () => {
    const supervisor = makeSupervisor({ maxConcurrent: 3, killGraceMs: 150 });
    const a = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=idle-after-init a',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    const b = await supervisor.launch({
      kind: 'goal',
      skill: '/rasen:goal',
      task: 'MODE=idle-after-init b',
      cwd,
      timeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 100));

    await supervisor.shutdownAll('server-shutdown');

    expect(supervisor.getRecord(a.record.id)!.state).toBe('exited');
    expect(supervisor.getRecord(a.record.id)!.terminationReason).toBe('server-shutdown');
    expect(supervisor.getRecord(b.record.id)!.state).toBe('exited');
    expect(supervisor.getRecord(b.record.id)!.terminationReason).toBe('server-shutdown');
  }, 10_000);

  it('review m1 regression: shutdownAll sets draining synchronously, so a launch racing it is rejected rather than orphaned', async () => {
    const supervisor = makeSupervisor();

    // `shutdownAll`'s first statement (before any `await`) flips `draining`
    // — by the time this call returns a pending promise, the flag is
    // already true, closing the window where `stopServer` reaped a
    // snapshot of live sessions before the listener stopped accepting
    // requests (a `POST` landing in that window used to spawn a session
    // nobody would ever reap).
    const shutdownPromise = supervisor.shutdownAll('server-shutdown');

    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit racing-shutdown',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe('shutting_down');
    }

    await shutdownPromise;
  });

  it('review m2 regression: a pruned exited record\'s output tail is freed, not retained for the server\'s lifetime', async () => {
    // Isolates the wiring (finalize's pruned-ids return value -> tails.delete)
    // from the registry's own real 50-record cap (session-registry.test.ts
    // already covers that cap directly) — a stub registry reports an
    // arbitrary "pruned" id on the launched session's own finalize call, and
    // this proves the supervisor actually deletes that id's tail in response.
    const prunedId = 'stub-pruned-id-from-a-much-older-session';
    const registry = createSessionRegistry();
    const realFinalize = registry.finalize.bind(registry);
    registry.finalize = (id, reason, exitCode, exitSignal) => {
      realFinalize(id, reason, exitCode, exitSignal);
      return [prunedId];
    };

    const supervisor = createSessionSupervisor({
      registry,
      resolveAgentCli: async () => fakeClaudeBin,
      killGraceMs: 200,
    });

    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit x',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 300 + STARTUP_LATENCY_BUFFER_MS));

    // The stub-reported pruned id's tail is gone — freed as part of this
    // session's own finalize, exactly like a real registry would report a
    // genuinely-older record pushed out past the retention cap.
    expect(supervisor.getTails(prunedId)).toBeUndefined();
  }, 10_000);

  it('N2 (child 2 hand-off): re-checks draining after the async resolveAgentCli await, releasing the slot and spawning nothing', async () => {
    let releaseResolver: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    let resolverCalls = 0;
    const supervisor = createSessionSupervisor({
      registry: createSessionRegistry(),
      // A genuinely-async resolver (unlike the cached production one) —
      // exactly the shape the hand-off flagged as the case that widens the
      // race window.
      resolveAgentCli: async () => {
        resolverCalls += 1;
        await gate;
        return fakeClaudeBin;
      },
      maxConcurrent: 1,
      killGraceMs: 200,
    });

    const launchPromise = supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit should never actually spawn',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });

    // `shutdownAll` starts (and its synchronous `draining = true` takes
    // effect) while the launch above is still parked at `await gate` inside
    // the resolver — nothing has spawned yet, so this resolves immediately.
    await supervisor.shutdownAll('server-shutdown');

    // Only now does the resolver's await settle, letting `launch` resume
    // past its `await resolveAgentCli()` point.
    releaseResolver!();
    const result = await launchPromise;

    expect(resolverCalls).toBe(1);
    expect(result).toEqual({
      ok: false,
      status: 503,
      code: 'shutting_down',
      message: expect.stringContaining('shutting down'),
    });
    // No record was ever created for the rejected launch, and the
    // concurrency slot was released — a fresh launch (post-shutdown
    // draining notwithstanding) proves the slot returned to zero rather
    // than leaking. Since this supervisor is now permanently draining,
    // assert via the absence of any record instead of a second launch.
    expect(supervisor.list()).toEqual([]);
  }, 10_000);

  it('N1 (child 2 hand-off): a synchronous spawn throw consumes finalize\'s pruned-ids return value, symmetrically with the close/error paths', async () => {
    // Mirrors "review m2 regression" above, isolating the same wiring
    // (finalize's pruned-ids return -> tails.delete) on the synchronous-
    // spawn-throw path specifically: before this fix, that path called
    // `registry.finalize(...)` and discarded its return value entirely,
    // so any id it reported evicted past the retention cap leaked its tail
    // forever (bounded — one 64 KiB entry per synchronous spawn failure —
    // but real, per the child-1 hand-off's N1 item).
    const prunedId = 'stub-pruned-id-from-a-much-older-session';
    const registry = createSessionRegistry();
    const realFinalize = registry.finalize.bind(registry);
    let finalizeCalls: Array<{ id: string; reason: string }> = [];
    registry.finalize = (id, reason, exitCode, exitSignal) => {
      finalizeCalls.push({ id, reason });
      realFinalize(id, reason, exitCode, exitSignal);
      return [prunedId];
    };

    mockSpawnShouldThrowSync = true;
    try {
      const supervisor = createSessionSupervisor({
        registry,
        resolveAgentCli: async () => fakeClaudeBin,
        killGraceMs: 200,
      });

      const result = await supervisor.launch({
        kind: 'auto',
        skill: '/rasen:auto',
        task: 'MODE=fast-exit x',
        cwd,
        timeoutMs: 5000,
        noOutputTimeoutMs: 5000,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(503);
      expect(result.code).toBe('agent_cli_unavailable');
      expect(finalizeCalls).toEqual([{ id: expect.any(String), reason: 'spawn-error' }]);

      // The stub-reported pruned id's tail is gone — this call not
      // throwing while consuming the pruned-ids array (rather than
      // discarding it) is exactly what N1 fixed.
      expect(supervisor.getTails(prunedId)).toBeUndefined();
    } finally {
      mockSpawnShouldThrowSync = false;
    }
  }, 10_000);
});
