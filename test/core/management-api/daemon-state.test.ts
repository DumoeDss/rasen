import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  deleteDaemonState,
  getDaemonLogPath,
  getDaemonStatePath,
  readDaemonState,
  writeDaemonState,
} from '../../../src/core/management-api/daemon-state.js';

describe('daemon-state (design D2, task 2.1)', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-daemon-state-'));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const opts = () => ({ homedir: tempHome, env: {} });

  it('round-trips write/read/delete', () => {
    expect(readDaemonState(opts())).toBeNull();

    const state = { version: '0.1.5', pid: 1234, port: 8791, token: 'tok-abc', startedAt: Date.now() };
    writeDaemonState(state, opts());

    expect(readDaemonState(opts())).toEqual(state);

    deleteDaemonState(opts());
    expect(readDaemonState(opts())).toBeNull();
  });

  it('deleting an absent state file is silent success', () => {
    expect(() => deleteDaemonState(opts())).not.toThrow();
  });

  it('writes owner-only permissions (posix)', () => {
    if (process.platform === 'win32') return;
    writeDaemonState({ version: '0.1.5', pid: 1, port: 8791, token: 't', startedAt: 1 }, opts());
    const mode = fs.statSync(getDaemonStatePath(opts())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('tolerates invalid JSON as absent, not a throw', () => {
    const statePath = getDaemonStatePath(opts());
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{not valid json');
    expect(readDaemonState(opts())).toBeNull();
  });

  it('tolerates a wrong-shaped JSON object as absent', () => {
    const statePath = getDaemonStatePath(opts());
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ version: '0.1.5' }));
    expect(readDaemonState(opts())).toBeNull();
  });

  it('a stale file naming a dead pid/port is only ever a hint — read still returns its (stale) contents, never throws', () => {
    const stale = { version: '0.1.4', pid: 999999, port: 19999, token: 'stale', startedAt: 1 };
    writeDaemonState(stale, opts());
    expect(readDaemonState(opts())).toEqual(stale);
  });

  it('getDaemonLogPath sits alongside the state file', () => {
    const logPath = getDaemonLogPath(opts());
    const statePath = getDaemonStatePath(opts());
    expect(path.dirname(logPath)).toBe(path.dirname(statePath));
    expect(path.basename(logPath)).toBe('daemon.log');
  });
});
