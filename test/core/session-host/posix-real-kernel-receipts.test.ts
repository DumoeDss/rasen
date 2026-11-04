import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeSessionBackend } from '../../../src/core/session-host/claude-backend.js';
import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createHostedProcessScope } from '../../../src/core/session-host/process-capsule/hosted-process-scope.js';
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
 * Real-kernel receipts for the POSIX best-effort tier (tasks 6.2, 6.3, 6.4).
 *
 * Nothing is seamed: `createHostedProcessScope()` performs the production
 * platform selection, which on linux returns the POSIX tier, which really
 * `setsid()`s via a detached spawn, really signals the process group, and really
 * polls the kernel for group emptiness. Liveness is checked with `kill -0`
 * against the real pid.
 *
 * Gated on linux AND `RASEN_POSIX_REAL_KERNEL=1`; without the gate the suite
 * SKIPS silently, so any receipt taken from it must quote the asserted test
 * count rather than an exit code.
 *
 * These MUST run in an external ext4 run tree with its own node_modules, never
 * the Windows repo checkout.
 */

const GATE = process.platform === 'linux' && process.env.RASEN_POSIX_REAL_KERNEL === '1';

const roots: string[] = [];
const strays: number[] = [];

afterEach(() => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone, which is the expected case */
    }
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and is not ours; only ESRCH means gone.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function workspace(prefix: string): { root: string; cwd: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  const cwd = path.join(root, 'checkout');
  fs.mkdirSync(cwd);
  return { root, cwd: fs.realpathSync.native(cwd) };
}

function input(cwd: string, script: string, extraEnv: Record<string, string> = {}) {
  return {
    command: process.execPath,
    args: ['-e', script] as readonly string[],
    cwd,
    env: { HOME: os.homedir(), PATH: '/usr/bin:/bin', ...extraEnv },
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
      ownerToken: 'posix-real-owner',
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
        return { ownerToken: 'posix-real-owner', async release() { /* noop */ } };
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!GATE)('POSIX best-effort tier on a real Linux kernel', () => {
  it('6.2 cancels a real hosted session and records cancelled / emptiness-unproven', async () => {
    const { root, cwd } = workspace('rasen-posix-real-cancel-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    // Production platform selection: on linux this must be the POSIX tier.
    const scope = createHostedProcessScope();

    const prepared = await scope.prepare(input(cwd, 'setInterval(() => {}, 60000)'));
    // Declared before the workload exists.
    expect(prepared.declaration).toMatchObject({
      tier: 'best-effort',
      exactCancel: false,
      scopeEmptyProof: false,
    });

    const live = await prepared.activate();
    const leaderPid = live.displayPid!;
    strays.push(leaderPid);
    expect(alive(leaderPid)).toBe(true);
    // setsid(): the leader is its own process-group leader.
    const pgid = Number(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(leaderPid)], { encoding: 'utf8' }).trim()
    );
    expect(pgid).toBe(leaderPid);

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
    expect(alive(leaderPid)).toBe(false);
    expect(JSON.stringify(after.processTerminal)).not.toMatch(/scope-empty|"proven"/);
    // The Record's `emptiness` is hardcoded at host.ts:655, so asserting it
    // alone would pass even against a scope that claimed proof. The scope's own
    // receipt is the claim that matters, so assert that too.
    await expect(live.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      outcome: 'cancelled',
      emptiness: 'unproven',
    });
  }, 60_000);

  it('6.3 stays emptiness-unproven when a setsid descendant survives a completed cancel', async () => {
    const { root, cwd } = workspace('rasen-posix-real-setsid-');
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const escapeeFile = path.join(root, 'escapee.pid');
    const scope = createHostedProcessScope();

    // The workload spawns a DETACHED child: Node's detached:true is setsid(2),
    // so the descendant leaves the workload's process group entirely. This is
    // the declared limitation of the tier, exercised against the real kernel.
    const prepared = await scope.prepare(
      input(
        cwd,
        [
          "const { spawn } = require('node:child_process');",
          "const fs = require('node:fs');",
          'const child = spawn(process.execPath,',
          '  ["-e", "setInterval(() => {}, 60000)"],',
          '  { detached: true, stdio: "ignore" });',
          'child.unref();',
          'fs.writeFileSync(process.env.RASEN_ESCAPEE_FILE, String(child.pid));',
          'setInterval(() => {}, 60000);',
        ].join('\n'),
        { RASEN_ESCAPEE_FILE: escapeeFile }
      )
    );
    const live = await prepared.activate();
    const leaderPid = live.displayPid!;
    strays.push(leaderPid);

    for (let i = 0; i < 200 && !fs.existsSync(escapeeFile); i += 1) await sleep(25);
    const escapeePid = Number(fs.readFileSync(escapeeFile, 'utf8').trim());
    strays.push(escapeePid);
    expect(alive(escapeePid)).toBe(true);
    // Proof it really left the group, not merely that it survived.
    const escapeePgid = Number(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(escapeePid)], { encoding: 'utf8' }).trim()
    );
    expect(escapeePgid).not.toBe(leaderPid);

    const seeded = await seedRecord(registry, cwd, live.ref, true);
    const host = hostFor(registry, scope);

    const report = await host.reconcileOnStart();

    // The cancel completed and the group was observed empty...
    expect(report.recovered).toBe(1);
    expect(alive(leaderPid)).toBe(false);
    const after = registry.get(seeded.sessionId)!;
    expect(after.processTerminal).toMatchObject({
      outcome: 'cancelled',
      emptiness: 'unproven',
      groupObservedEmpty: true,
    });
    // ...and yet a process from that workload is still running. The Record is
    // honest about it: this is the tier's declared limitation, not a defect,
    // and nothing in the Record claims the scope is empty.
    expect(alive(escapeePid)).toBe(true);
    expect(JSON.stringify(after.processTerminal)).not.toMatch(/scope-empty|"proven"/);
    // Assert the scope's own claim, not just the host's projection: this is the
    // flagship honesty case, so it must fail if the tier ever claims proof.
    await expect(live.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      outcome: 'cancelled',
      emptiness: 'unproven',
      groupObservedEmpty: true,
    });
  }, 60_000);

  it('6.4 reports an exact root exit code and, separately, an exact terminating signal', async () => {
    const { cwd } = workspace('rasen-posix-real-exit-');
    const scope = createHostedProcessScope();

    // (a) exact exit code
    const byCode = await (await scope.prepare(input(cwd, 'process.exit(23)'))).activate();
    await expect(byCode.rootExited).resolves.toEqual({
      state: 'root-exited',
      code: 23,
      signal: null,
    });
    await expect(byCode.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      outcome: 'completed',
      emptiness: 'unproven',
      rootExit: { code: 23, signal: null },
    });

    // (b) exact terminating signal, reported distinctly from any emptiness claim
    const bySignal = await (
      await scope.prepare(input(cwd, 'setInterval(() => {}, 60000)'))
    ).activate();
    const signalledPid = bySignal.displayPid!;
    strays.push(signalledPid);
    process.kill(signalledPid, 'SIGTERM');
    await expect(bySignal.rootExited).resolves.toEqual({
      state: 'root-exited',
      code: null,
      signal: 'SIGTERM',
    });
    await expect(bySignal.closed).resolves.toMatchObject({
      state: 'declared-unproven',
      outcome: 'completed',
      emptiness: 'unproven',
      rootExit: { code: null, signal: 'SIGTERM' },
    });
  }, 60_000);
});
