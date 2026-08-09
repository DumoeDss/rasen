import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeSessionBackend } from '../../../src/core/session-host/claude-backend.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createNativeProcessScope } from '../../../src/core/session-host/process-capsule/native-process-scope.js';
import {
  asProcessRef,
  type BackendRootExit,
  type ProcessScope,
  type ScopeEmptyReceipt,
} from '../../../src/core/session-host/process-scope.js';
import { createSessionHostRegistry } from '../../../src/core/session-host/registry.js';

const roots: string[] = [];
const exactPids = new Set<number>();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('bounded scope-closure oracle timed out');
}

afterEach(async () => {
  for (const pid of [...exactPids]) {
    if (alive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* exact test-owned PID */ }
    }
    exactPids.delete(pid);
  }
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

describe('ProcessScope authority after backend-root exit', () => {
  it('emits one natural scope-empty receipt after the last backend member exits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-scope-natural-empty-'));
    roots.push(root);
    const marker = path.join(root, 'root-ran');
    const scope = createNativeProcessScope({
      onControllerSpawn(pid) { exactPids.add(pid); },
    });
    const prepared = await scope.prepare({
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'1');process.exit(0)`],
      cwd: root,
      env: Object.fromEntries(
        ['SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'HOME', 'USERPROFILE']
          .flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
      ),
    });
    exactPids.add(prepared.displayPid!);
    const live = await prepared.activate();
    await expect(live.rootExited).resolves.toMatchObject({ state: 'root-exited', code: 0 });
    await expect(live.closed).resolves.toEqual({ state: 'scope-empty' });
    await expect(scope.inspect(live.ref)).resolves.toEqual({
      state: 'closed', controllable: false,
    });
    expect(fs.existsSync(marker)).toBe(true);
    exactPids.delete(prepared.displayPid!);
  }, 30_000);

  it('retains a live controllable scope until the last descendant is empty', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-scope-root-exit-'));
    roots.push(root);
    const factsPath = path.join(root, 'facts.json');
    const descendantReady = path.join(root, 'descendant-ready');
    const script = [
      "const { spawn } = require('node:child_process');",
      "const fs = require('node:fs');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(descendantReady)}, '1');setInterval(() => {}, 1000)`)}], { detached: process.platform === 'win32', stdio: 'ignore', windowsHide: true });`,
      'child.unref();',
      `const ready = setInterval(() => { if (!fs.existsSync(${JSON.stringify(descendantReady)})) return; clearInterval(ready); fs.writeFileSync(${JSON.stringify(factsPath)}, JSON.stringify({ root: process.pid, descendant: child.pid })); process.exit(23); }, 5);`,
    ].join('');
    const scope = createNativeProcessScope({
      onControllerSpawn(pid) { exactPids.add(pid); },
    });
    const prepared = await scope.prepare({
      command: process.execPath,
      args: ['-e', script],
      cwd: root,
      env: Object.fromEntries(
        ['SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'HOME', 'USERPROFILE']
          .flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
      ),
    });
    exactPids.add(prepared.displayPid!);
    const live = await prepared.activate();
    await waitFor(() => fs.existsSync(factsPath));
    const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8')) as {
      root: number;
      descendant: number;
    };
    exactPids.add(facts.root);
    exactPids.add(facts.descendant);

    await expect(live.rootExited).resolves.toMatchObject({
      state: 'root-exited',
      code: 23,
    });
    await expect(Promise.race([
      live.closed.then(() => 'scope-empty'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still-live'), 150)),
    ])).resolves.toBe('still-live');
    await expect(scope.inspect(live.ref)).resolves.toEqual({
      state: 'root-exited',
      controllable: true,
    });
    expect(alive(facts.descendant)).toBe(true);

    await expect(scope.terminate(live.ref, {
      reason: 'root-exit closure oracle',
      graceMs: 50,
    })).resolves.toMatchObject({ state: 'closed' });
    await expect(live.closed).resolves.toMatchObject({ state: 'scope-empty' });
    await waitFor(() => !alive(facts.descendant));
    exactPids.delete(facts.root);
    exactPids.delete(facts.descendant);
    exactPids.delete(prepared.displayPid!);
  }, 30_000);

  it('keeps registry and writer authority until exact scope-empty is observed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-scope-host-authority-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const ref = asProcessRef(
      `rasen-process-scope/1:${Buffer.from('root-exit-host-authority').toString('base64url')}`,
    );
    let reportRootExit!: (value: BackendRootExit) => void;
    const rootExited = new Promise<BackendRootExit>((resolve) => { reportRootExit = resolve; });
    let reportScopeEmpty!: (value: ScopeEmptyReceipt) => void;
    const closed = new Promise<ScopeEmptyReceipt>((resolve) => { reportScopeEmpty = resolve; });
    let terminationStarted!: () => void;
    const terminating = new Promise<void>((resolve) => { terminationStarted = resolve; });
    let allowTermination!: () => void;
    const terminationGate = new Promise<void>((resolve) => { allowTermination = resolve; });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdin.once('data', () => queueMicrotask(() => reportRootExit({
      state: 'root-exited', code: 23, signal: null,
    })));
    const processScope: ProcessScope = {
      async prepare() {
        return {
          ref,
          displayPid: 4242,
          async activate() {
            return { ref, displayPid: 4242, stdin, stdout, stderr, rootExited, closed };
          },
          async abort() {
            return { state: 'uncertain', gracefulAttempted: false, forced: false };
          },
        };
      },
      async inspect() {
        return { state: 'root-exited', controllable: true };
      },
      async terminate() {
        terminationStarted();
        await terminationGate;
        reportScopeEmpty({ state: 'scope-empty' });
        return { state: 'closed', gracefulAttempted: true, forced: true };
      },
    };
    const ownershipState = { releases: 0 };
    const backend = createClaudeSessionBackend({
      resolveBinary: async () => process.execPath,
      verifyProtocol: async () => ({ ok: true, version: 'test' }),
      processScope,
    });
    const host = createSessionHost({
      registry,
      backends: [backend],
      ownership: {
        async claim() {
          return {
            ownerToken: 'root-exit-writer',
            async release() { ownershipState.releases += 1; },
          };
        },
        async isClaimed() { return false; },
        async reapStaleOwner() { return 'absent'; },
      },
    });
    await host.reconcileOnStart();
    const pending = host.dispatch({
      op: 'execute',
      requestId: crypto.randomUUID(),
      backend: 'claude',
      cwd,
      input: 'root-exit-before-scope-empty',
      limits: {
        timeoutMs: 2_000,
        maxInputBytes: 4_096,
        maxOutputBytes: 4_096,
        maxDiagnosticBytes: 256,
      },
    });
    await terminating;

    expect(registry.list()[0]?.process).toMatchObject({
      runtimeRef: ref,
      ownerToken: 'root-exit-writer',
    });
    expect(ownershipState.releases).toBe(0);

    allowTermination();
    await expect(pending).resolves.toMatchObject({ ok: false });
    for (let attempt = 0; attempt < 100 && registry.list()[0]?.process; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(registry.list()[0]?.process).toBeUndefined();
    expect(ownershipState.releases).toBe(1);
  });
});
