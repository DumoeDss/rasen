import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENT_STDIN_LIMIT_BYTES } from '../../../src/core/agent-cli-process.js';
import { runCodexExec } from '../../../src/core/codex/runner.js';
import { getCodexThreadSandbox } from '../../../src/core/codex/thread-state.js';

const fixtureBinary = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'codex',
  process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.mjs'
);

let root: string;
let cwd: string;
let scratchParent: string;
const cleanupPids = new Set<number>();

beforeAll(() => {
  if (process.platform !== 'win32') fs.chmodSync(fixtureBinary, 0o755);
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-runner-'));
  cwd = path.join(root, 'cwd');
  scratchParent = path.join(root, 'scratch');
  fs.mkdirSync(cwd);
  fs.mkdirSync(scratchParent);
});

afterEach(() => {
  for (const pid of cleanupPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already reaped by the runner.
    }
  }
  cleanupPids.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (pidIsAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('runCodexExec bounded stdin lifecycle', () => {
  it('bounds the fully assembled prompt before spawning', async () => {
    const marker = path.join(root, 'unexpected-spawn.json');
    const result = await runCodexExec({
      binary: fixtureBinary,
      // Exact regression: the old CLI boundary accepted a raw 2 MiB prompt,
      // then the appended flat guard crossed the shared stdin limit.
      prompt: 'x'.repeat(DEFAULT_AGENT_STDIN_LIMIT_BYTES),
      contract: 'leaf',
      sandbox: 'read-only',
      cwd,
      scratchParent,
      threadStateDir: path.join(root, 'state'),
      env: {
        ...process.env,
        FAKE_CODEX_CLOSE_STDIN_EARLY: '1',
        FAKE_CODEX_EARLY_EOF_MARKER: marker,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-input' },
    });
    if (result.ok) throw new Error('expected assembled-prompt validation failure');
    expect(result.failure.message).toMatch(/stdin payload.*limit/i);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.readdirSync(scratchParent)).toEqual([]);
  });

  it('returns one bounded failure and reaps the child tree when stdin closes early', async () => {
    const marker = path.join(root, 'early-eof-tree.json');
    const result = await runCodexExec({
      binary: fixtureBinary,
      prompt: 'x'.repeat(1024 * 1024),
      contract: 'leaf',
      sandbox: 'read-only',
      cwd,
      timeoutMs: 5_000,
      scratchParent,
      threadStateDir: path.join(root, 'state'),
      env: {
        ...process.env,
        FAKE_CODEX_CLOSE_STDIN_EARLY: '1',
        FAKE_CODEX_EARLY_EOF_MARKER: marker,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'spawn-failed' },
    });
    expect(fs.existsSync(marker)).toBe(true);
    const pids = JSON.parse(fs.readFileSync(marker, 'utf8')) as {
      rootPid: number;
      descendantPid: number;
    };
    cleanupPids.add(pids.rootPid);
    cleanupPids.add(pids.descendantPid);
    await Promise.all([waitForPidExit(pids.rootPid), waitForPidExit(pids.descendantPid)]);
    expect(pidIsAlive(pids.rootPid)).toBe(false);
    expect(pidIsAlive(pids.descendantPid)).toBe(false);
    expect(fs.readdirSync(scratchParent)).toEqual([]);
  });

  it('persists fresh creation sandbox before classifying a later turn failure', async () => {
    const threadId = 'fresh-failure-thread';
    const stateDir = path.join(root, 'state');
    const result = await runCodexExec({
      binary: fixtureBinary,
      prompt: `MODE=nonzero\nTHREAD_ID=${threadId}\n`,
      contract: 'leaf',
      sandbox: 'workspace-write',
      cwd,
      scratchParent,
      threadStateDir: stateDir,
    });

    expect(result).toMatchObject({
      ok: false,
      threadId,
      sandbox: 'workspace-write',
      failure: { kind: 'nonzero-exit' },
    });
    expect(await getCodexThreadSandbox(threadId, { stateDir })).toBe('workspace-write');
    expect(fs.readdirSync(scratchParent)).toEqual([]);
  });
});
