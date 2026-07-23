import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AgentCommand } from '../../src/commands/agent.js';
import { writeSignalAtomic, signalFilePath } from '../../src/core/keepalive/index.js';

const CHANGE = 'wait-test-change';

let repoRoot: string;
let rasenHome: string;
let changeRoot: string;
let originalCwd: string;
let logs: string[];
let logSpy: ReturnType<typeof vi.spyOn>;
const savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = ['RASEN_HOME', 'RASEN_AGENT_RUNTIME', 'CLAUDECODE', 'CODEX_SANDBOX', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];

function lastOutcome(): Record<string, unknown> {
  expect(logs.length).toBeGreaterThan(0);
  return JSON.parse(logs[logs.length - 1]) as Record<string, unknown>;
}

async function wait(options: Partial<Parameters<AgentCommand['wait']>[0]> = {}): Promise<void> {
  const command = new AgentCommand();
  await command.wait({ change: CHANGE, role: 'reviewer', beatSeconds: 1, ...options });
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wait-repo-'));
  rasenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wait-home-'));
  changeRoot = path.join(repoRoot, 'rasen', 'changes', CHANGE);
  fs.mkdirSync(changeRoot, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(repoRoot);
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.RASEN_HOME = rasenHome;
  process.env.CLAUDECODE = '1';
  logs = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
    logs.push(String(line));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(rasenHome, { recursive: true, force: true });
});

describe('rasen agent wait', () => {
  it('a timed-out beat reports progress and persists the count', async () => {
    await wait();
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
    await wait();
    expect(lastOutcome()).toEqual({ beat: 2, remaining: 10 });
  });

  it('returns and consumes a pre-existing resume signal', async () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'resume', instruction: 'fix round 2' });
    await wait({ beatSeconds: 30 });
    expect(lastOutcome()).toMatchObject({ resumed: true, instruction: 'fix round 2' });
    expect(fs.existsSync(signalFilePath(changeRoot, 'reviewer'))).toBe(false);
  });

  it('a lead standDown signal stands the worker down and clears state', async () => {
    await wait(); // beat 1 recorded
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'standDown' });
    await wait({ beatSeconds: 30 });
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'lead-stand-down' });
    // counter reset: next park starts at beat 1
    await wait();
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
  });

  it('reaching the beat cap returns standDown without blocking', async () => {
    for (let i = 0; i < 3; i++) await wait({ role: 'impl-spaces', maxBeats: 3 });
    const before = Date.now();
    await wait({ role: 'impl-spaces', maxBeats: 3 });
    expect(Date.now() - before).toBeLessThan(900); // no beat wait
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'beat-cap' });
    // state cleared: the next invocation counts from 1 again
    await wait({ role: 'impl-spaces', maxBeats: 3 });
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 2 });
  });

  it('--max-beats overrides the role-family cap', async () => {
    await wait({ maxBeats: 1 });
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 0 });
    await wait({ maxBeats: 1 });
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'beat-cap' });
  });

  it('codex runtime is gated off and mutates no state', async () => {
    process.env.RASEN_AGENT_RUNTIME = 'codex';
    await wait();
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'runtime-not-gated' });
    delete process.env.RASEN_AGENT_RUNTIME;
    await wait();
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 }); // untouched counter
  });

  it('unknown runtime is gated off', async () => {
    delete process.env.CLAUDECODE;
    await wait();
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'runtime-not-gated' });
  });

  it('a global-config override opens the codex gate', async () => {
    fs.writeFileSync(
      path.join(rasenHome, 'config.json'),
      JSON.stringify({ keepalive: { runtimes: { codex: true } } }),
      'utf-8'
    );
    process.env.RASEN_AGENT_RUNTIME = 'codex';
    await wait();
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
  });

  it('context below the floor stands down immediately', async () => {
    await wait({ contextTokens: 60_000 });
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'context-below-floor' });
  });

  it('context at or above the floor proceeds', async () => {
    await wait({ contextTokens: 150_000 });
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
  });

  it('rejects a missing change and an invalid role key', async () => {
    await expect(wait({ change: 'no-such-change' })).rejects.toThrow(/not found/);
    await expect(wait({ role: '../escape' })).rejects.toThrow(/--role/);
  });

  it('clamps --beat-seconds to the hard cap without erroring', async () => {
    // A 9999s request must still return promptly because the clamp caps the
    // beat at MAX_BEAT_SECONDS; use a signal so the beat exits immediately.
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'resume', instruction: 'x' });
    await wait({ beatSeconds: 9999 });
    expect(lastOutcome()).toMatchObject({ resumed: true });
  });
});
