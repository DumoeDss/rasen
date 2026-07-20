/**
 * Fixture-loopback coverage for the stale-daemon replacement path (review
 * round 1 M1): `rasen ui`'s adopt-or-spawn flow finds a REAL rasen daemon
 * of a different version (a standalone fixture process, `x-rasen-daemon`
 * headers, its own pid), kills it by that REPORTED pid via the real
 * `killIdentifiedDaemonAndWaitFree` path (`ui-launch.ts`), waits for the
 * port to free, and spawns a fresh same-version daemon — all through the
 * real `dist/cli/index.js` CLI subprocess, nothing mocked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { probeDaemonPort } from '../../src/core/management-api/daemon-probe.js';

const require = createRequire(import.meta.url);
const { version: OWN_VERSION } = require('../../package.json') as { version: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const cliEntry = path.join(repoRoot, 'dist', 'cli', 'index.js');
const staleDaemonFixture = path.resolve(__dirname, '..', 'fixtures', 'management-api', 'fake-stale-daemon.mjs');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString('utf-8')));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf-8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilListening(port: number, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const probe = await probeDaemonPort(port);
    if (probe.kind !== 'no-listener') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`fixture never came up on port ${port}`);
}

describe('rasen ui stale-daemon replacement (review round 1 M1, fixture-loopback)', () => {
  let tempHome: string;
  let projectRoot: string;
  let daemonPort: number;
  let baseEnv: NodeJS.ProcessEnv;
  let staleDaemon: ChildProcessWithoutNullStreams | undefined;

  beforeEach(async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-stale-replace-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-stale-replace-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    daemonPort = await freePort();

    baseEnv = {
      ...process.env,
      RASEN_HOME: tempHome,
      RASEN_DAEMON_PORT: String(daemonPort),
    };
    delete baseEnv.XDG_CONFIG_HOME;
    delete baseEnv.XDG_DATA_HOME;
  });

  afterEach(async () => {
    await runCli(['daemon', 'stop'], baseEnv, projectRoot).catch(() => undefined);
    if (staleDaemon?.pid && isAlive(staleDaemon.pid)) {
      try {
        process.kill(staleDaemon.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it(
    'kills the stale fixture daemon by its reported pid, waits for the port to free, and adopts a freshly spawned same-version daemon',
    async () => {
      staleDaemon = spawn(process.execPath, [staleDaemonFixture, String(daemonPort), '0.0.1-stale'], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      staleDaemon.unref();
      const stalePid = staleDaemon.pid!;
      await waitUntilListening(daemonPort);

      const staleProbe = await probeDaemonPort(daemonPort);
      expect(staleProbe).toEqual({ kind: 'rasen-daemon', version: '0.0.1-stale', pid: stalePid });

      const result = await runCli(['ui', '--no-open'], baseEnv, projectRoot);

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`^Rasen UI: http://127\\.0\\.0\\.1:${daemonPort}/#token=[0-9a-f]{64}$`, 'm'));

      // The stale fixture is dead — really killed by its reported pid, not
      // merely superseded (its process, not just its port, is gone).
      expect(isAlive(stalePid)).toBe(false);

      // A fresh, same-version real daemon now answers in its place.
      const replaced = await probeDaemonPort(daemonPort);
      expect(replaced.kind).toBe('rasen-daemon');
      if (replaced.kind === 'rasen-daemon') {
        expect(replaced.version).toBe(OWN_VERSION);
        expect(replaced.pid).not.toBe(stalePid);
      }
    },
    20_000
  );

  it(
    'review m2: `daemon start` also replaces a stale-version daemon in place, rather than green-exiting on it',
    async () => {
      staleDaemon = spawn(process.execPath, [staleDaemonFixture, String(daemonPort), '0.0.1-stale'], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      staleDaemon.unref();
      const stalePid = staleDaemon.pid!;
      await waitUntilListening(daemonPort);

      const result = await runCli(['daemon', 'start'], baseEnv, projectRoot);

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/replacing stale/i);
      expect(isAlive(stalePid)).toBe(false);

      const replaced = await probeDaemonPort(daemonPort);
      expect(replaced.kind).toBe('rasen-daemon');
      if (replaced.kind === 'rasen-daemon') {
        expect(replaced.version).toBe(OWN_VERSION);
        expect(replaced.pid).not.toBe(stalePid);
      }
    },
    20_000
  );
});
