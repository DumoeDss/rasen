import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSessionSupervisor, type SessionSupervisor } from '../../../src/core/management-api/supervisor.js';
import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeClaudeBin = path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'session-fake-cli.mjs');

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

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
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

    await new Promise((resolve) => setTimeout(resolve, 300));

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

    await new Promise((resolve) => setTimeout(resolve, 300));
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

    await new Promise((resolve) => setTimeout(resolve, 300));
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

    await new Promise((resolve) => setTimeout(resolve, 300));
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
    await new Promise((resolve) => setTimeout(resolve, 600));

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

    await new Promise((resolve) => setTimeout(resolve, 300));
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
    await new Promise((resolve) => setTimeout(resolve, 700));

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
      noOutputTimeoutMs: 150,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = result.record.id;

    await new Promise((resolve) => setTimeout(resolve, 400));

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

    await new Promise((resolve) => setTimeout(resolve, 700));

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

    await new Promise((resolve) => setTimeout(resolve, 300));

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
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
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
    await new Promise((resolve) => setTimeout(resolve, 600));

    const third = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen:auto',
      task: 'MODE=fast-exit z',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });
    expect(third.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
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
});
