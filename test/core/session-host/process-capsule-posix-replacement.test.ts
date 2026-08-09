import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createNativeProcessScope } from '../../../src/core/session-host/process-capsule/native-process-scope.js';
import { asProcessRef, type ProcessRef } from '../../../src/core/session-host/process-scope.js';

const roots: string[] = [];
const exactPids = new Set<number>();

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('bounded POSIX replacement oracle timed out');
}

function mutateRef(
  ref: ProcessRef,
  mutate: (fields: string[]) => void,
): ProcessRef {
  const payload = Buffer.from(
    String(ref).slice('rasen-process-scope/1:'.length),
    'base64url',
  ).toString('utf8');
  const fields = payload.split('|');
  if (fields.length !== 8 || fields[0] !== 'v2') throw new Error('expected native ref v2');
  mutate(fields);
  return asProcessRef(
    `rasen-process-scope/1:${Buffer.from(fields.join('|'), 'utf8').toString('base64url')}`,
  );
}

function foreignControllerBirth(ref: ProcessRef): ProcessRef {
  return mutateRef(ref, (fields) => { fields[3] = `${fields[3]}-foreign`; });
}

function foreignSupervisorBirth(ref: ProcessRef): ProcessRef {
  return mutateRef(ref, (fields) => { fields[5] = `${fields[5]}-foreign`; });
}

function reusedSupervisorGroup(ref: ProcessRef, reusedPid: number): ProcessRef {
  return mutateRef(ref, (fields) => {
    fields[4] = String(reusedPid);
    fields[6] = String(reusedPid);
  });
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

describe('POSIX ProcessCapsule replacement authority', () => {
  it('pins controller, supervisor, reserved group and v2 protocol inside the opaque ref', () => {
    const source = fs.readFileSync('native/process-capsule/src/main.rs', 'utf8');
    expect(source).toContain('v2|{platform_name}|{pid}|{birth}|{supervisor_pid}|{supervisor_birth}|{reserved_pgid}|{nonce}');
    expect(source).toContain('inspect_reserved_group');
    expect(source).toContain('terminate_reserved_group');
    expect(source).toMatch(/actual_pgid\s+as\s+u32\s+!=\s+reserved_pgid/);
    expect(source).toContain('kill(-(reserved_pgid as i32), SIGKILL)');
  });

  it.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'rejects controller/supervisor reuse and closes a resistant leaderless group after daemon force-death',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-posix-replacement-'));
      roots.push(root);
      const factsPath = path.join(root, 'facts.json');
      const script = [
        "const { spawn } = require('node:child_process');",
        "const fs = require('node:fs');",
        "process.on('SIGTERM', () => {});",
        "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' });",
        'child.unref();',
        `fs.writeFileSync(${JSON.stringify(factsPath)}, JSON.stringify({ root: process.pid, descendant: child.pid }));`,
        'setInterval(() => {}, 1000);',
      ].join('');
      let controllerPid = 0;
      const scope = createNativeProcessScope({
        controllerMode: '--controller-test-posix-orphan-group',
        onControllerSpawn(pid) { controllerPid = pid; exactPids.add(pid); },
      });
      const prepared = await scope.prepare({
        command: process.execPath,
        args: ['-e', script],
        cwd: root,
        env: Object.fromEntries(
          ['TMP', 'TEMP', 'HOME'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
        ),
      });
      exactPids.add(prepared.displayPid!);
      const live = await prepared.activate();
      await waitFor(() => fs.existsSync(factsPath));
      const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8')) as {
        root: number; descendant: number;
      };
      exactPids.add(facts.root);
      exactPids.add(facts.descendant);
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      });
      exactPids.add(unrelated.pid!);

      process.kill(controllerPid, 'SIGKILL');
      exactPids.delete(controllerPid);
      await waitFor(() => !alive(controllerPid));
      await expect(scope.inspect(live.ref)).resolves.toEqual({
        state: 'live', controllable: true,
      });
      await expect(scope.terminate(foreignControllerBirth(live.ref), {
        reason: 'foreign controller mutation', graceMs: 50,
      })).resolves.toMatchObject({ state: 'uncertain', gracefulAttempted: false });
      await expect(scope.terminate(foreignSupervisorBirth(live.ref), {
        reason: 'foreign supervisor mutation', graceMs: 50,
      })).resolves.toMatchObject({ state: 'uncertain', gracefulAttempted: false });
      await expect(scope.terminate(reusedSupervisorGroup(live.ref, unrelated.pid!), {
        reason: 'reused supervisor pid and pgid mutation', graceMs: 50,
      })).resolves.toMatchObject({ state: 'uncertain', gracefulAttempted: false });
      expect(alive(facts.root)).toBe(true);
      expect(alive(facts.descendant)).toBe(true);
      expect(alive(unrelated.pid!)).toBe(true);

      process.kill(prepared.displayPid!, 'SIGKILL');
      await waitFor(() => !alive(prepared.displayPid!));
      exactPids.delete(prepared.displayPid!);
      await expect(scope.inspect(live.ref)).resolves.toEqual({
        state: 'live', controllable: true,
      });
      expect(alive(facts.root)).toBe(true);
      expect(alive(facts.descendant)).toBe(true);

      await expect(scope.terminate(live.ref, {
        reason: 'replacement group cleanup', graceMs: 50,
      })).resolves.toMatchObject({ state: 'closed' });
      await waitFor(() => !alive(prepared.displayPid!) && !alive(facts.root) && !alive(facts.descendant));
      await expect(scope.terminate(live.ref, {
        reason: 'repeated exact termination', graceMs: 50,
      })).resolves.toMatchObject({ state: 'closed' });
      expect(alive(unrelated.pid!)).toBe(true);
      process.kill(unrelated.pid!, 'SIGKILL');
      exactPids.delete(prepared.displayPid!);
      exactPids.delete(facts.root);
      exactPids.delete(facts.descendant);
      exactPids.delete(unrelated.pid!);
    },
    30_000,
  );

  it.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'reports closed without signalling when the exact group emptied before replacement control',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-posix-empty-before-signal-'));
      roots.push(root);
      let controllerPid = 0;
      const scope = createNativeProcessScope({
        onControllerSpawn(pid) { controllerPid = pid; exactPids.add(pid); },
      });
      const prepared = await scope.prepare({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 25)'],
        cwd: root,
        env: Object.fromEntries(
          ['TMP', 'TEMP', 'HOME'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
        ),
      });
      exactPids.add(prepared.displayPid!);
      const live = await prepared.activate();
      await expect(live.closed).resolves.toEqual({ state: 'scope-empty' });
      await waitFor(() => !alive(controllerPid) && !alive(prepared.displayPid!));
      exactPids.delete(controllerPid);
      exactPids.delete(prepared.displayPid!);

      await expect(scope.terminate(live.ref, {
        reason: 'group already empty', graceMs: 50,
      })).resolves.toMatchObject({ state: 'closed', gracefulAttempted: false });
      await expect(scope.terminate(live.ref, {
        reason: 'repeated group already empty', graceMs: 50,
      })).resolves.toMatchObject({ state: 'closed', gracefulAttempted: false });
    },
    30_000,
  );
});
