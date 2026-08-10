import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createNativeProcessScope } from '../../../src/core/session-host/process-capsule/native-process-scope.js';
import { asProcessRef, type ProcessRef } from '../../../src/core/session-host/process-scope.js';

const roots: string[] = [];
const exactPids = new Set<number>();

function processProbe(pid: number): { alive: boolean; errorCode?: string } {
  try {
    process.kill(pid, 0);
    return { alive: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { alive: false, ...(code ? { errorCode: code } : {}) };
  }
}

function alive(pid: number): boolean {
  return processProbe(pid).alive;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('bounded process oracle timed out');
}

async function becomesTrue(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

function launch(root: string, descendant = false) {
  const facts = path.join(root, 'facts.json');
  const marker = path.join(root, 'activated');
  const script = descendant
    ? `const{spawn}=require('node:child_process'),fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'1');const d=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',windowsHide:true});d.unref();d.once('error',e=>{console.error('descendant spawn failed: '+(e&&e.code||'unknown'));process.exit(72)});d.once('spawn',()=>fs.writeFileSync(${JSON.stringify(facts)},JSON.stringify({root:process.pid,descendant:d.pid})));setInterval(()=>{},1000);`
    : `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'1');fs.writeFileSync(${JSON.stringify(facts)},JSON.stringify({root:process.pid}));process.stdin.pipe(process.stdout);setInterval(()=>{},1000);`;
  // Node 20.19 bundles libuv 1.46, whose Windows spawn path rejects an
  // absent PATH even when the executable is absolute (libuv c97017dd).
  const env = Object.fromEntries(
    ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'PATH']
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return { command: process.execPath, args: ['-e', script], cwd: root, env, facts, marker };
}

function legacyOpaqueRef(ref: ProcessRef): ProcessRef {
  const payload = Buffer.from(
    String(ref).slice('rasen-process-scope/1:'.length),
    'base64url',
  ).toString('utf8');
  const fields = payload.split('|');
  if (fields.length !== 8 || fields[0] !== 'v2') throw new Error('expected native ref v2');
  fields[0] = 'v1';
  return asProcessRef(
    `rasen-process-scope/1:${Buffer.from(fields.join('|'), 'utf8').toString('base64url')}`,
  );
}

afterEach(async () => {
  for (const pid of [...exactPids]) {
    if (alive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* exact test-owned PID */ }
    }
    exactPids.delete(pid);
  }
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
});

describe('source-built native ProcessCapsule', () => {
  it('keeps the backend inert until activation and proxies bounded stdio', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-native-capsule-inert-'));
    roots.push(root);
    const input = launch(root);
    const scope = createNativeProcessScope({ onControllerSpawn: (pid) => { exactPids.add(pid); } });
    const prepared = await scope.prepare(input);
    expect(fs.existsSync(input.marker)).toBe(false);

    const live = await prepared.activate();
    let diagnostic = '';
    live.stderr.on('data', (chunk) => { diagnostic += chunk.toString('utf8'); });
    await Promise.race([
      waitFor(() => fs.existsSync(input.facts)),
      live.closed.then((receipt) => { throw new Error(`scope closed before facts: ${JSON.stringify(receipt)} ${diagnostic}`); }),
    ]);
    const facts = JSON.parse(fs.readFileSync(input.facts, 'utf8')) as { root: number };
    exactPids.add(facts.root);
    const output = new Promise<string>((resolve) => live.stdout.once('data', (chunk) => resolve(chunk.toString('utf8'))));
    live.stdin.write('opaque-scope-echo');
    await expect(output).resolves.toBe('opaque-scope-echo');
    await expect(scope.terminate(live.ref, { reason: 'test', graceMs: 50 })).resolves.toMatchObject({ state: 'closed' });
    await waitFor(() => !alive(facts.root));
    exactPids.delete(facts.root);
  }, 30_000);

  it.runIf(process.platform === 'win32')('kills root and detached descendant when only the native controller dies', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-native-capsule-controller-death-'));
    roots.push(root);
    const input = launch(root, true);
    let controllerPid = 0;
    const scope = createNativeProcessScope({ onControllerSpawn: (pid) => { controllerPid = pid; exactPids.add(pid); } });
    const prepared = await scope.prepare(input);
    const live = await prepared.activate();
    let diagnostic = '';
    live.stderr.on('data', (chunk) => { diagnostic += chunk.toString('utf8'); });
    await Promise.race([
      waitFor(() => fs.existsSync(input.facts)),
      live.closed.then((receipt) => {
        throw new Error(
          `scope closed before facts: ${JSON.stringify(receipt)} ${diagnostic.slice(0, 512)}`,
        );
      }),
    ]);
    const facts = JSON.parse(fs.readFileSync(input.facts, 'utf8')) as { root: number; descendant: number };
    exactPids.add(facts.root); exactPids.add(facts.descendant);
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
    exactPids.add(unrelated.pid!);

    process.kill(controllerPid, 'SIGKILL');
    exactPids.delete(controllerPid);
    await waitFor(() => !alive(facts.root) && !alive(facts.descendant));
    expect(alive(unrelated.pid!)).toBe(true);
    await expect(live.closed).rejects.toMatchObject({
      code: 'process-control-lost',
      phase: 'scope-empty',
    });
    process.kill(unrelated.pid!, 'SIGKILL');
    exactPids.delete(facts.root);
    exactPids.delete(facts.descendant);
    exactPids.delete(unrelated.pid!);
  }, 30_000);

  it.runIf(process.platform === 'win32')('detects an inherited Job-handle mutation with the controller-death oracle', async () => {
    async function runOracle(
      mode: '--controller' | '--controller-test-duplicate-job-handle',
    ) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-native-capsule-job-mutation-'));
      roots.push(root);
      const input = launch(root, true);
      let controllerPid = 0;
      const scope = createNativeProcessScope({
        controllerMode: mode,
        onControllerSpawn: (pid) => { controllerPid = pid; exactPids.add(pid); },
      });
      const prepared = await scope.prepare(input);
      exactPids.add(prepared.displayPid);
      const live = await prepared.activate();
      let diagnostic = '';
      live.stderr.on('data', (chunk) => { diagnostic += chunk.toString('utf8'); });
      await Promise.race([
        waitFor(() => fs.existsSync(input.facts)),
        live.rootExited.then((exit) => {
          throw new Error(
            `backend root exited before descendant spawn: ${JSON.stringify(exit)} ${diagnostic.slice(0, 512)}`,
          );
        }),
      ]);
      const facts = JSON.parse(fs.readFileSync(input.facts, 'utf8')) as { root: number; descendant: number };
      exactPids.add(facts.root);
      exactPids.add(facts.descendant);
      process.kill(controllerPid, 'SIGKILL');
      exactPids.delete(controllerPid);
      await expect(live.closed).rejects.toMatchObject({
        code: 'process-control-lost',
        phase: 'scope-empty',
      });
      const contained = await becomesTrue(() => !alive(facts.root) && !alive(facts.descendant), 750);
      const observation = await scope.inspect(live.ref);
      const rootProbe = processProbe(facts.root);
      const descendantProbe = processProbe(facts.descendant);
      if (!contained && alive(prepared.displayPid)) {
        process.kill(prepared.displayPid, 'SIGKILL');
        await becomesTrue(() => !alive(facts.root) && !alive(facts.descendant), 2_000);
      }
      exactPids.delete(prepared.displayPid);
      exactPids.delete(facts.root);
      exactPids.delete(facts.descendant);
      return {
        contained,
        observation,
        rootProbe,
        descendantProbe,
        diagnostic: diagnostic.slice(0, 512),
      };
    }

    const control = await runOracle('--controller');
    expect(control.contained, JSON.stringify(control)).toBe(true);
    const mutation = await runOracle('--controller-test-duplicate-job-handle');
    expect(mutation.contained, JSON.stringify(mutation)).toBe(false);
  }, 30_000);

  it.runIf(process.platform === 'win32')('detects activation-before-publish with the inertness oracle', async () => {
    async function markerAppearsBeforeActivation(
      mode: '--controller' | '--controller-test-early-activation',
    ): Promise<boolean> {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-native-capsule-activation-mutation-'));
      roots.push(root);
      const input = launch(root);
      const scope = createNativeProcessScope({
        controllerMode: mode,
        onControllerSpawn: (pid) => { exactPids.add(pid); },
      });
      const prepared = await scope.prepare(input);
      exactPids.add(prepared.displayPid);
      const appeared = await becomesTrue(() => fs.existsSync(input.marker), 500);
      await prepared.abort('mutation oracle cleanup');
      exactPids.delete(prepared.displayPid);
      return appeared;
    }

    await expect(markerAppearsBeforeActivation('--controller')).resolves.toBe(false);
    await expect(markerAppearsBeforeActivation('--controller-test-early-activation')).resolves.toBe(true);
  }, 30_000);

  it('fails closed on an opaque-ref version rollback without mutating the live v2 authority', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-native-capsule-ref-rollback-'));
    roots.push(root);
    const input = launch(root);
    const scope = createNativeProcessScope({ onControllerSpawn: (pid) => { exactPids.add(pid); } });
    const prepared = await scope.prepare(input);
    exactPids.add(prepared.displayPid!);
    const live = await prepared.activate();
    await waitFor(() => fs.existsSync(input.facts));
    const facts = JSON.parse(fs.readFileSync(input.facts, 'utf8')) as { root: number };
    exactPids.add(facts.root);

    await expect(scope.terminate(legacyOpaqueRef(live.ref), {
      reason: 'old opaque-ref mutation', graceMs: 50,
    })).rejects.toMatchObject({ code: 'process-authority-uncertain' });
    await expect(scope.inspect(live.ref)).resolves.toMatchObject({ state: 'live', controllable: true });

    await expect(scope.terminate(live.ref, {
      reason: 'exact v2 cleanup', graceMs: 50,
    })).resolves.toMatchObject({ state: 'closed' });
    await waitFor(() => !alive(facts.root));
    exactPids.delete(prepared.displayPid!);
    exactPids.delete(facts.root);
  }, 30_000);
});
