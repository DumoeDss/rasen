import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AgentCommand } from '../../src/commands/agent.js';
import {
  DEFAULT_KEEPALIVE_CONFIG,
  resolveBeatDurationSeconds,
  resolveKeepaliveConfig,
  writeSignalAtomic,
  signalFilePath,
} from '../../src/core/keepalive/index.js';

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

  it('the context floor is disabled by default — small contexts still beat', async () => {
    await wait({ contextTokens: 60_000 });
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
  });

  it('a configured floor stands small contexts down and passes large ones', async () => {
    fs.writeFileSync(
      path.join(rasenHome, 'config.json'),
      JSON.stringify({ keepalive: { contextFloor: 100_000 } }),
      'utf-8'
    );
    await wait({ contextTokens: 60_000 });
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'context-below-floor' });
    await wait({ contextTokens: 150_000 });
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
  });

  it('a stale pre-existing signal is discarded on the first beat of an episode', async () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'standDown' });
    const file = signalFilePath(changeRoot, 'reviewer');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(file, old, old);
    await wait();
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 }); // not insta-killed
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a BOM-prefixed signal (PowerShell-written) is still parsed and delivered', async () => {
    fs.mkdirSync(path.dirname(signalFilePath(changeRoot, 'reviewer')), { recursive: true });
    fs.writeFileSync(
      signalFilePath(changeRoot, 'reviewer'),
      '\uFEFF{"kind":"resume","instruction":"bom ok"}',
      'utf-8'
    );
    await wait({ beatSeconds: 30 });
    expect(lastOutcome()).toMatchObject({ resumed: true, instruction: 'bom ok' });
  });

  it('a fresh pre-existing signal is still delivered on the first beat', async () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'resume', instruction: 'go' });
    await wait({ beatSeconds: 30 });
    expect(lastOutcome()).toMatchObject({ resumed: true, instruction: 'go' });
  });

  it('a stale signal mid-episode (beats > 0) is still delivered', async () => {
    await wait(); // beat 1 — episode live
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'standDown' });
    const file = signalFilePath(changeRoot, 'reviewer');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(file, old, old);
    await wait({ beatSeconds: 30 });
    expect(lastOutcome()).toEqual({ standDown: true, reason: 'lead-stand-down' });
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

  it('an explicit flag wins over a configured beatSeconds (returns promptly)', async () => {
    // keepalive.beatSeconds=250 would make an unflagged beat block for minutes;
    // the flag (1s) wins, so a timed-out beat returns within a second or two.
    fs.writeFileSync(
      path.join(rasenHome, 'config.json'),
      JSON.stringify({ keepalive: { beatSeconds: 250 } }),
      'utf-8'
    );
    const before = Date.now();
    await wait({ beatSeconds: 1 });
    expect(Date.now() - before).toBeLessThan(5_000);
    expect(lastOutcome()).toEqual({ beat: 1, remaining: 11 });
  });
});

describe('beat duration resolution priority', () => {
  it('an explicit flag wins over the configured and default beat', () => {
    const config = resolveKeepaliveConfig({ beatSeconds: 200 });
    expect(resolveBeatDurationSeconds(120, config)).toBe(120);
  });

  it('falls back to the configured beat when no flag is given', () => {
    expect(resolveBeatDurationSeconds(undefined, resolveKeepaliveConfig({ beatSeconds: 150 }))).toBe(150);
    expect(resolveBeatDurationSeconds(undefined, resolveKeepaliveConfig({ beatSeconds: 280 }))).toBe(280);
  });

  it('falls back to the registry default (270) when neither flag nor config is set', () => {
    expect(resolveBeatDurationSeconds(undefined, DEFAULT_KEEPALIVE_CONFIG)).toBe(270);
  });

  it('clamps a large flag to the 300s hard cap', () => {
    expect(resolveBeatDurationSeconds(9999, DEFAULT_KEEPALIVE_CONFIG)).toBe(300);
  });
});
