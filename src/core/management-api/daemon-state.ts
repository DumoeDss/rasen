/**
 * Daemon runtime state file (design D2, task 2.1): `daemon/daemon.json`
 * under the per-user rasen home (`getGlobalDataDir`, the same root
 * `global-config.ts` resolves for the project registry and store data).
 * Runtime metadata only — version, pid, port, token, startedAt — never
 * workspace, change, or pipeline state (that stays in agent-written
 * run-state files). Classification never trusts this file's contents; it
 * is a port hint and a token source only, and a stale file (naming a dead
 * pid/port) is harmless — the next probe finds no listener and the next
 * `daemon start`/spawn overwrites it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getGlobalDataDir, type GlobalDataDirOptions } from '../global-config.js';

export interface DaemonState {
  version: string;
  pid: number;
  port: number;
  token: string;
  startedAt: number;
}

/** Directory (`<rasen-home>/daemon/`) holding the state file and the log file, resolved with the same overrides as `getGlobalDataDir`. */
export function getDaemonDir(options: GlobalDataDirOptions = {}): string {
  return path.join(getGlobalDataDir(options), 'daemon');
}

export function getDaemonStatePath(options: GlobalDataDirOptions = {}): string {
  return path.join(getDaemonDir(options), 'daemon.json');
}

export function getDaemonLogPath(options: GlobalDataDirOptions = {}): string {
  return path.join(getDaemonDir(options), 'daemon.log');
}

function isDaemonState(value: unknown): value is DaemonState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === 'string' &&
    typeof record.pid === 'number' &&
    typeof record.port === 'number' &&
    typeof record.token === 'string' &&
    typeof record.startedAt === 'number'
  );
}

/**
 * Writes the state file with owner-only permissions (`0600`, best-effort on
 * win32 — `chmod` there is a no-op for this bit pattern, which is fine: the
 * live-probe-only trust model does not depend on the OS enforcing it).
 * Creates the daemon directory if needed.
 */
export function writeDaemonState(state: DaemonState, options: GlobalDataDirOptions = {}): void {
  const dir = getDaemonDir(options);
  fs.mkdirSync(dir, { recursive: true });
  const statePath = getDaemonStatePath(options);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(statePath, 0o600);
  } catch {
    // Best-effort (win32 in particular) — the live probe is the real trust
    // boundary, not this permission bit.
  }
}

/**
 * Reads and validates the state file. Any failure to read or parse — file
 * absent, invalid JSON, wrong shape — is tolerated as "no state" (`null`),
 * never thrown: a stale or corrupt file is only ever a hint, and consumers
 * fall through to a live probe of the default port.
 */
export function readDaemonState(options: GlobalDataDirOptions = {}): DaemonState | null {
  try {
    const raw = fs.readFileSync(getDaemonStatePath(options), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return isDaemonState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Deletes the state file. Missing file is silent success (already the desired end state). */
export function deleteDaemonState(options: GlobalDataDirOptions = {}): void {
  try {
    fs.unlinkSync(getDaemonStatePath(options));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Best-effort: nothing more constructive to do from a state-file
      // deletion failure at shutdown time.
    }
  }
}
