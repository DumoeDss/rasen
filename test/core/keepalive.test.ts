import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DEFAULT_KEEPALIVE_CONFIG,
  STALE_STATE_MS,
  beatStatePath,
  clearBeatState,
  consumeSignal,
  detectAgentRuntime,
  isRuntimeGated,
  isValidRoleKey,
  loadBeatState,
  readSignal,
  resolveKeepaliveConfig,
  resolveRoleCap,
  saveBeatState,
  signalFilePath,
  writeSignalAtomic,
} from '../../src/core/keepalive/index.js';

let changeRoot: string;

beforeEach(() => {
  changeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-keepalive-'));
});

afterEach(() => {
  fs.rmSync(changeRoot, { recursive: true, force: true });
});

describe('signal protocol', () => {
  it('writes atomically and reads back a resume signal', () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'resume', instruction: 'round 2' });
    const signal = readSignal(changeRoot, 'reviewer');
    expect(signal?.kind).toBe('resume');
    expect(signal?.instruction).toBe('round 2');
    // no temp files left behind
    const leftovers = fs.readdirSync(path.dirname(signalFilePath(changeRoot, 'reviewer')))
      .filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('consume deletes the signal file and tolerates absence', async () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'standDown' });
    expect(await consumeSignal(changeRoot, 'reviewer')).toBe(true);
    expect(fs.existsSync(signalFilePath(changeRoot, 'reviewer'))).toBe(false);
    // consuming again (ENOENT) is still success
    expect(await consumeSignal(changeRoot, 'reviewer')).toBe(true);
  });

  it('a malformed signal file is consumed as a poison pill and reported absent', () => {
    fs.mkdirSync(path.dirname(signalFilePath(changeRoot, 'fixer')), { recursive: true });
    fs.writeFileSync(signalFilePath(changeRoot, 'fixer'), '{not json', 'utf-8');
    expect(readSignal(changeRoot, 'fixer')).toBeNull();
    expect(fs.existsSync(signalFilePath(changeRoot, 'fixer'))).toBe(false);
  });

  it('a signal with an unknown kind is treated as malformed', () => {
    fs.mkdirSync(path.dirname(signalFilePath(changeRoot, 'fixer')), { recursive: true });
    fs.writeFileSync(signalFilePath(changeRoot, 'fixer'), JSON.stringify({ kind: 'nudge' }), 'utf-8');
    expect(readSignal(changeRoot, 'fixer')).toBeNull();
  });

  it('retries consume on transient Windows unlink errors (EBUSY) and succeeds', async () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'resume', instruction: 'x' });
    let failures = 2;
    const flakyUnlink = (target: string): void => {
      if (failures > 0) {
        failures--;
        const err = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      }
      fs.unlinkSync(target);
    };
    expect(await consumeSignal(changeRoot, 'reviewer', flakyUnlink)).toBe(true);
    expect(fs.existsSync(signalFilePath(changeRoot, 'reviewer'))).toBe(false);
  });

  it('reports failure when unlink never succeeds', async () => {
    writeSignalAtomic(changeRoot, 'reviewer', { kind: 'resume', instruction: 'x' });
    const alwaysFail = (): void => {
      const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    };
    expect(await consumeSignal(changeRoot, 'reviewer', alwaysFail)).toBe(false);
  });

  it('validates role keys as conservative identifiers', () => {
    expect(isValidRoleKey('impl-spaces')).toBe(true);
    expect(isValidRoleKey('planner_1')).toBe(true);
    expect(isValidRoleKey('../escape')).toBe(false);
    expect(isValidRoleKey('a b')).toBe(false);
    expect(isValidRoleKey('')).toBe(false);
  });
});

describe('beat state', () => {
  it('starts fresh when no state exists', () => {
    const state = loadBeatState(changeRoot, 'reviewer', 5);
    expect(state.beats).toBe(0);
    expect(state.maxBeats).toBe(5);
  });

  it('round-trips saved state', () => {
    saveBeatState(changeRoot, 'reviewer', { beats: 2, startedAt: new Date().toISOString(), maxBeats: 5 });
    expect(loadBeatState(changeRoot, 'reviewer', 5).beats).toBe(2);
  });

  it('resets when the cap changes', () => {
    saveBeatState(changeRoot, 'reviewer', { beats: 4, startedAt: new Date().toISOString(), maxBeats: 5 });
    expect(loadBeatState(changeRoot, 'reviewer', 8).beats).toBe(0);
  });

  it('resets stale state older than the staleness window', () => {
    const stale = new Date(Date.now() - STALE_STATE_MS - 60_000).toISOString();
    saveBeatState(changeRoot, 'reviewer', { beats: 4, startedAt: stale, maxBeats: 5 });
    expect(loadBeatState(changeRoot, 'reviewer', 5).beats).toBe(0);
  });

  it('clearBeatState removes the file and tolerates absence', () => {
    saveBeatState(changeRoot, 'reviewer', { beats: 1, startedAt: new Date().toISOString(), maxBeats: 5 });
    clearBeatState(changeRoot, 'reviewer');
    expect(fs.existsSync(beatStatePath(changeRoot, 'reviewer'))).toBe(false);
    clearBeatState(changeRoot, 'reviewer'); // no throw
  });
});

describe('role caps', () => {
  it('applies the uniform 12-beat cap to every role key', () => {
    expect(resolveRoleCap('impl-spaces')).toBe(12);
    expect(resolveRoleCap('implementer')).toBe(12);
    expect(resolveRoleCap('reviewer')).toBe(12);
    expect(resolveRoleCap('rev-pipelines')).toBe(12);
    expect(resolveRoleCap('planner')).toBe(12);
    expect(resolveRoleCap('planner-2')).toBe(12);
    expect(resolveRoleCap('archiver')).toBe(12);
  });
});

describe('runtime detection and gate', () => {
  it('detects claude from CLAUDECODE', () => {
    expect(detectAgentRuntime({ CLAUDECODE: '1' })).toBe('claude');
  });

  it('codex fingerprint wins over an inherited CLAUDECODE', () => {
    expect(detectAgentRuntime({ CLAUDECODE: '1', CODEX_SANDBOX: 'seatbelt' })).toBe('codex');
  });

  it('explicit RASEN_AGENT_RUNTIME override wins over fingerprints', () => {
    expect(detectAgentRuntime({ CLAUDECODE: '1', RASEN_AGENT_RUNTIME: 'codex' })).toBe('codex');
    expect(detectAgentRuntime({ CODEX_SANDBOX: 'x', RASEN_AGENT_RUNTIME: 'claude' })).toBe('claude');
  });

  it('is unknown with no fingerprint', () => {
    expect(detectAgentRuntime({})).toBe('unknown');
  });

  it('gates claude on and codex/unknown off by default', () => {
    expect(isRuntimeGated('claude', DEFAULT_KEEPALIVE_CONFIG)).toBe(true);
    expect(isRuntimeGated('codex', DEFAULT_KEEPALIVE_CONFIG)).toBe(false);
    expect(isRuntimeGated('unknown', DEFAULT_KEEPALIVE_CONFIG)).toBe(false);
  });

  it('config overrides enable codex and disable claude', () => {
    const config = resolveKeepaliveConfig({ runtimes: { claude: false, codex: true } });
    expect(isRuntimeGated('claude', config)).toBe(false);
    expect(isRuntimeGated('codex', config)).toBe(true);
  });

  it('resolves defaults for absent or partial config', () => {
    expect(resolveKeepaliveConfig(undefined)).toEqual(DEFAULT_KEEPALIVE_CONFIG);
    expect(resolveKeepaliveConfig({ contextFloor: 50000 }).contextFloor).toBe(50000);
    expect(resolveKeepaliveConfig({ contextFloor: -1 }).contextFloor).toBe(
      DEFAULT_KEEPALIVE_CONFIG.contextFloor
    );
  });
});
