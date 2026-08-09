import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionHost } from '../../../src/core/session-host/host.js';
import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';
import { createHostedProcessScope } from '../../../src/core/session-host/process-capsule/hosted-process-scope.js';
import { createClaudeSessionBackend } from '../../../src/core/session-host/claude-backend.js';
import {
  type ProcessRef,
  type ProcessScope,
} from '../../../src/core/session-host/process-scope.js';
import {
  createSessionHostRegistry,
  digestSessionHostText,
  type SessionHostRegistry,
} from '../../../src/core/session-host/registry.js';

/**
 * Real-capsule receipts on a real Windows host (tasks 7.1, 7.3, and the
 * stale-record half of 7.2).
 *
 * Nothing is seamed here: `createHostedProcessScope()` performs the production
 * platform selection, which spawns the packaged `rasen-process-capsule.exe`,
 * creates a real Job object, and starts a real workload process. Liveness is
 * checked with `tasklist` - the OS's own answer - rather than inferred.
 *
 * Substituted (and labelled, because it matters to how far the receipt reaches):
 * the workload is a sleeping `node -e` instead of the Claude CLI. The
 * ProcessScope, the capsule, the Job mechanics, the host and its release rule
 * are all production code on the production path.
 *
 * Gated: these spawn real processes and are meaningless off win32. Running
 * without the gate SKIPS silently, so any receipt taken from this file must
 * quote the asserted test count.
 */

const GATE = process.platform === 'win32' && process.env.RASEN_WIN32_REAL_CAPSULE === '1';

const roots: string[] = [];
const strays: number[] = [];

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
    } catch {
      /* already gone, which is the expected case */
    }
  }
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* Windows may still hold a handle; the temp dir is disposable */
    }
  }
});

function alive(pid: number): boolean {
  const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
  return out.includes(String(pid));
}

function workspace(prefix: string): { root: string; cwd: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const cwd = path.join(root, 'checkout');
  fs.mkdirSync(cwd);
  return { root, cwd: fs.realpathSync.native(cwd) };
}

/** A workload that simply stays alive until something kills it. */
function residentInput(cwd: string) {
  return {
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 60000)'] as readonly string[],
    cwd,
    env: {
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
      TEMP: process.env.TEMP ?? 'C:\\Windows\\Temp',
      TMP: process.env.TMP ?? 'C:\\Windows\\Temp',
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
      ownerToken: 'win32-real-owner',
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
        return { ownerToken: 'win32-real-owner', async release() { /* noop */ } };
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

describe.skipIf(!GATE)('win32 real-capsule receipts on this host', () => {
  it('7.1 cancels a real Job-backed workload and records cancelled / emptiness-unproven', async () => {
    const { root, cwd } = workspace('rasen-win32-real-cancel-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const controllerPids: number[] = [];
    // Production platform selection; onControllerSpawn is observation only.
    const scope = createHostedProcessScope({
      onControllerSpawn: (pid) => controllerPids.push(pid),
    });

    const prepared = await scope.prepare(residentInput(cwd));
    // The declaration exists before the workload does.
    expect(prepared.declaration).toMatchObject({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
    });
    expect(controllerPids).toHaveLength(1);
    expect(alive(controllerPids[0])).toBe(true);

    const live = await prepared.activate();
    const workloadPid = live.displayPid!;
    strays.push(workloadPid, controllerPids[0]);
    expect(alive(workloadPid)).toBe(true);

    const seeded = await seedRecord(registry, cwd, live.ref, true);
    const host = hostFor(registry, scope);

    const report = await host.reconcileOnStart();

    expect(report.recovered).toBe(1);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeUndefined();
    expect(after.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      label: 'cancelled / emptiness-unproven',
    });
    // The capsule's Job kill mechanics really ran: the workload is gone.
    expect(alive(workloadPid)).toBe(false);
    // And the Record never claims the proof this tier does not have.
    expect(JSON.stringify(after.processTerminal)).not.toMatch(/scope-empty|"proven"/);
  }, 60_000);

  it('7.3 reports controller loss as retained uncertainty, not a clean detach', async () => {
    const { root, cwd } = workspace('rasen-win32-real-transport-loss-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const controllerPids: number[] = [];
    const scope = createHostedProcessScope({
      onControllerSpawn: (pid) => controllerPids.push(pid),
    });

    const prepared = await scope.prepare(residentInput(cwd));
    const live = await prepared.activate();
    const workloadPid = live.displayPid!;
    strays.push(workloadPid, controllerPids[0]);

    // Kill the CONTROLLER, not the workload: the control channel is lost while
    // the workload keeps running. This is the SEC-001 shape on a real host.
    execFileSync('taskkill', ['/F', '/PID', String(controllerPids[0])], { stdio: 'ignore' });
    for (let i = 0; i < 100 && alive(controllerPids[0]); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(alive(controllerPids[0])).toBe(false);

    const seeded = await seedRecord(registry, cwd, live.ref, true);
    const host = hostFor(registry, scope);

    const report = await host.reconcileOnStart();

    // Authority retained despite a valid pre-start declaration.
    expect(report.recovered).toBe(0);
    const after = registry.get(seeded.sessionId)!;
    expect(after.process).toBeDefined();
    expect(after.processTerminal).toBeUndefined();
  }, 60_000);

  it('7.2b reports a ref from a dead daemon honestly and never reattaches', async () => {
    const { root, cwd } = workspace('rasen-win32-real-stale-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const first = createHostedProcessScope();
    const prepared = await first.prepare(residentInput(cwd));
    const live = await prepared.activate();
    strays.push(live.displayPid!);
    const staleRef = live.ref;
    await first.terminate(staleRef, { reason: 'end-of-daemon-lifetime', graceMs: 1_000 });

    // A brand-new scope instance stands in for the next daemon lifetime: it has
    // no in-memory state for this ref and must reconcile it through the
    // capsule's one-shot probe.
    const next = createHostedProcessScope();
    const observation = await next.inspect(staleRef);

    expect(['foreign', 'uncertain', 'declared-unproven']).toContain(observation.state);
    expect(observation.controllable).toBe(false);
    if (observation.state === 'declared-unproven') {
      expect(observation.terminal.emptiness).toBe('unproven');
    }

    const seeded = await seedRecord(registry, cwd, staleRef, true);
    const host = hostFor(registry, next);
    await host.reconcileOnStart();
    const after = registry.get(seeded.sessionId)!;
    // Whatever the outcome, the Record must not carry a proven-emptiness claim.
    expect(JSON.stringify(after.processTerminal ?? {})).not.toMatch(/scope-empty|"proven"/);
  }, 60_000);
});
