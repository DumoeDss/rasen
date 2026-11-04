import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createNativeProcessScope } from '../../../src/core/session-host/process-capsule/native-process-scope.js';

const roots: string[] = [];
const exactPids = new Set<number>();

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
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
      try { fs.rmSync(root, { recursive: true, force: true }); break; } catch (error) {
        if (attempt === 39) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
});

function launch(root: string) {
  const marker = path.join(root, 'activated');
  return {
    marker,
    input: {
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'1');setInterval(()=>{},1000)`],
      cwd: root,
      env: Object.fromEntries(
        ['SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'HOME', 'USERPROFILE']
          .flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
      ),
    },
  };
}

describe('ProcessCapsule post-PREPARED control deadlines', () => {
  it('keeps the test-only withheld acknowledgement modes out of production defaults', () => {
    const source = fs.readFileSync('native/process-capsule/src/main.rs', 'utf8');
    expect(source).toContain('--controller-test-withhold-activate');
    expect(source).toContain('--controller-test-withhold-first-terminate');
    expect(source).toMatch(/controller_main\(false, false, false, false, true, false\)/);
    expect(source).toMatch(/controller_main\(false, false, false, false, false, true\)/);
  });

  it('bounds ACTIVATE uncertainty, retains the ref, and never activates twice', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-capsule-activate-timeout-'));
    roots.push(root);
    const item = launch(root);
    const scope = createNativeProcessScope({
      controllerMode: '--controller-test-withhold-activate',
      controlTimeoutMs: 500,
      onControllerSpawn(pid) { exactPids.add(pid); },
    });
    const prepared = await scope.prepare(item.input);
    exactPids.add(prepared.displayPid!);
    await expect(prepared.activate()).rejects.toMatchObject({
      code: 'process-control-timeout',
      phase: 'activate',
    });
    expect(fs.existsSync(item.marker)).toBe(false);
    await expect(scope.inspect(prepared.ref)).resolves.toEqual({
      state: 'prepared', controllable: true,
    });
    await expect(prepared.activate()).rejects.toMatchObject({ code: 'activation-failed' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(item.marker)).toBe(false);
    await expect(scope.terminate(prepared.ref, {
      reason: 'activate timeout cleanup', graceMs: 25,
    })).resolves.toMatchObject({ state: 'closed' });
    exactPids.delete(prepared.displayPid!);
  }, 15_000);

  it('bounds prepared abort uncertainty and allows later exact reconciliation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-capsule-abort-timeout-'));
    roots.push(root);
    const item = launch(root);
    const scope = createNativeProcessScope({
      controllerMode: '--controller-test-withhold-first-terminate',
      controlTimeoutMs: 500,
      onControllerSpawn(pid) { exactPids.add(pid); },
    });
    const prepared = await scope.prepare(item.input);
    exactPids.add(prepared.displayPid!);
    await expect(prepared.abort('CAS publication failed')).resolves.toMatchObject({
      state: 'uncertain',
      failure: { code: 'process-control-timeout', phase: 'abort' },
    });
    await expect(scope.inspect(prepared.ref)).resolves.toEqual({
      state: 'prepared', controllable: true,
    });
    await expect(scope.terminate(prepared.ref, {
      reason: 'abort timeout reconciliation', graceMs: 25,
    })).resolves.toMatchObject({ state: 'closed' });
    expect(fs.existsSync(item.marker)).toBe(false);
    exactPids.delete(prepared.displayPid!);
  }, 15_000);
});
