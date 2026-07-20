/**
 * Real-process daemon lifecycle integration tests (tasks 5.3/5.4/6.3):
 * spawns the actual CLI (`dist/cli/index.js`, this installation's own
 * entry — the same one `daemon start` itself spawns) as a real child
 * process, on a fresh test port never 8890/8791, with an isolated
 * `RASEN_HOME` and the session-fake-cli fixture standing in for `claude`.
 * Exercises: adopt-without-second-spawn, a session surviving a `daemon
 * start` re-invocation, `daemon stop` reaping it, and foreign-listener
 * refusal for both `stop` and `status`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { probeDaemonPort } from '../../src/core/management-api/daemon-probe.js';
import { readDaemonState } from '../../src/core/management-api/daemon-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const cliEntry = path.join(repoRoot, 'dist', 'cli', 'index.js');
const fakeClaudeBin = path.resolve(__dirname, '..', 'fixtures', 'management-api', 'session-fake-cli.mjs');

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

function httpJson(
  port: number,
  options: { method: string; path: string; token?: string; body?: unknown }
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request(
      { host: '127.0.0.1', port, method: options.method, path: options.path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          let json: unknown;
          try {
            json = body ? JSON.parse(body) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
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

describe('daemon lifecycle (real subprocess, tasks 5.3/5.4/6.3)', () => {
  let tempHome: string;
  let projectRoot: string;
  let daemonPort: number;
  let baseEnv: NodeJS.ProcessEnv;
  let foreignServer: http.Server | undefined;

  beforeEach(async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-daemon-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-daemon-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    daemonPort = await freePort();

    baseEnv = {
      ...process.env,
      RASEN_HOME: tempHome,
      RASEN_DAEMON_PORT: String(daemonPort),
      RASEN_CLAUDE_BIN: fakeClaudeBin,
    };
    delete baseEnv.XDG_CONFIG_HOME;
    delete baseEnv.XDG_DATA_HOME;
  });

  afterEach(async () => {
    // Best-effort cleanup even on assertion failure mid-test.
    await runCli(['daemon', 'stop'], baseEnv, projectRoot).catch(() => undefined);
    if (foreignServer) await new Promise<void>((resolve) => foreignServer!.close(() => resolve()));
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it(
    'start -> adopt (no second spawn) -> session survives -> stop reaps it and removes state',
    async () => {
      const started = await runCli(['daemon', 'start'], baseEnv, projectRoot);
      expect(started.code, started.stderr).toBe(0);
      expect(started.stdout).toContain('started');

      const probeAfterStart = await probeDaemonPort(daemonPort);
      expect(probeAfterStart.kind).toBe('rasen-daemon');

      const state = readDaemonState({ homedir: tempHome, env: { RASEN_HOME: tempHome } });
      expect(state).not.toBeNull();
      expect(state!.port).toBe(daemonPort);

      // Launch a long-lived (idle-after-init) fixture session through the
      // daemon's own HTTP API.
      const launch = await httpJson(daemonPort, {
        method: 'POST',
        path: '/api/v1/sessions',
        token: state!.token,
        body: { kind: 'auto', task: 'MODE=idle-after-init keep this session alive' },
      });
      expect(launch.status).toBe(201);
      const sessionPid = (launch.json as { session: { pid: number; id: string } }).session.pid;
      const sessionId = (launch.json as { session: { pid: number; id: string } }).session.id;
      expect(isAlive(sessionPid)).toBe(true);

      // A second `daemon start` converges to adoption — no second daemon,
      // same pid.
      const startedAgain = await runCli(['daemon', 'start'], baseEnv, projectRoot);
      expect(startedAgain.code, startedAgain.stderr).toBe(0);
      expect(startedAgain.stdout).toMatch(/already running/i);
      const stateAfterSecondStart = readDaemonState({ homedir: tempHome, env: { RASEN_HOME: tempHome } });
      expect(stateAfterSecondStart!.pid).toBe(state!.pid);

      // The session is still live and listed — a consumer (this test's own
      // CLI invocations) exiting never touched it.
      const listed = await httpJson(daemonPort, { method: 'GET', path: '/api/v1/sessions', token: state!.token });
      expect(listed.status).toBe(200);
      const sessions = (listed.json as { sessions: Array<{ session: { id: string; state: string } }> }).sessions;
      expect(sessions.some((entry) => entry.session.id === sessionId && entry.session.state === 'running')).toBe(true);

      // `daemon stop` reaps the session and removes the state file.
      const stopped = await runCli(['daemon', 'stop'], baseEnv, projectRoot);
      expect(stopped.code, stopped.stderr).toBe(0);
      expect(stopped.stdout).toMatch(/stopped/i);

      const stateAfterStop = readDaemonState({ homedir: tempHome, env: { RASEN_HOME: tempHome } });
      expect(stateAfterStop).toBeNull();

      const probeAfterStop = await probeDaemonPort(daemonPort);
      expect(probeAfterStop.kind).toBe('no-listener');

      // No orphaned session process: the daemon's clean shutdown reaped it
      // via shutdownAll('server-shutdown') before exiting.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(isAlive(sessionPid)).toBe(false);
    },
    20_000
  );

  it(
    'status reports classification honestly without acting on it',
    async () => {
      const absent = await runCli(['daemon', 'status'], baseEnv, projectRoot);
      expect(absent.code).toBe(0);
      expect(absent.stdout).toMatch(/no daemon running/i);

      await runCli(['daemon', 'start'], baseEnv, projectRoot);
      const running = await runCli(['daemon', 'status'], baseEnv, projectRoot);
      expect(running.code).toBe(0);
      expect(running.stdout).toMatch(/running: rasen daemon/i);
    },
    20_000
  );

  it(
    'stop refuses a foreign listener without sending any signal',
    async () => {
      foreignServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not a rasen daemon');
      });
      await new Promise<void>((resolve) => foreignServer!.listen(daemonPort, '127.0.0.1', () => resolve()));

      const stopResult = await runCli(['daemon', 'stop'], baseEnv, projectRoot);
      expect(stopResult.code).not.toBe(0);
      expect(stopResult.stderr).toMatch(/foreign|never.*terminated|refus/i);

      // The foreign listener is still alive and answering — nothing was sent to it.
      const stillAlive = await httpJson(daemonPort, { method: 'GET', path: '/' });
      expect(stillAlive.status).toBe(200);
    },
    20_000
  );

  it(
    'status reports a foreign listener without acting on it',
    async () => {
      foreignServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not a rasen daemon');
      });
      await new Promise<void>((resolve) => foreignServer!.listen(daemonPort, '127.0.0.1', () => resolve()));

      const statusResult = await runCli(['daemon', 'status'], baseEnv, projectRoot);
      expect(statusResult.code).toBe(0);
      expect(statusResult.stdout).toMatch(/foreign/i);
    },
    20_000
  );
});
