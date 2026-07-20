/**
 * `rasen daemon` command group (design D1/D3/D4, tasks 2.3-2.5): the
 * resident daemon that owns session supervision across terminal exits.
 * `run` is the daemon itself (foreground, debugging form); `start` spawns
 * it detached via this installation's own `dist/cli/index.js` entry (never
 * PATH — mirrors `management-api/submit.ts`'s `resolveCliEntry`); `stop`
 * and `status` probe-and-classify per `daemon-probe.ts`, acting only on a
 * positively-identified rasen daemon.
 */
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { Command } from 'commander';

import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { resolveLaunchProjectRef } from '../core/config-api/project-addressing.js';
import { resolveUiPackageDir } from '../core/config-api/ui-package.js';
import { startManagementServer } from '../core/management-api/server.js';
import { killProcessTree, isProcessAlive } from '../core/management-api/kill-tree.js';
import {
  deleteDaemonState,
  getDaemonLogPath,
  readDaemonState,
  writeDaemonState,
} from '../core/management-api/daemon-state.js';
import {
  probeDaemon,
  probeDaemonPort,
  resolveDefaultDaemonPort,
  type DaemonProbeResult,
} from '../core/management-api/daemon-probe.js';

const require = createRequire(import.meta.url);
const IS_WINDOWS = process.platform === 'win32';

const READINESS_POLL_ATTEMPTS = 20;
const READINESS_POLL_INTERVAL_MS = 250;
const STOP_POLL_ATTEMPTS = 20;
const STOP_POLL_INTERVAL_MS = 250;

export function ownVersion(): string {
  const { version } = require('../../package.json') as { version: string };
  return version;
}

/** This server process's own installation entry (never PATH) — mirrors `management-api/submit.ts`'s `resolveCliEntry`. */
function resolveOwnCliEntry(): string {
  const pkgPath = require.resolve('../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePortOption(raw: string | undefined, fallback: number): number | { error: string } {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return { error: `--port must be an integer between 0 and 65535 (got "${raw}").` };
  }
  return port;
}

// ---------------------------------------------------------------------------
// `daemon run` — the resident daemon itself (task 2.3)
// ---------------------------------------------------------------------------

async function runDaemonRun(options: { port?: string }): Promise<void> {
  const port = parsePortOption(options.port, resolveDefaultDaemonPort());
  if (typeof port === 'object') {
    console.error(`Error: ${port.error}`);
    process.exitCode = 1;
    return;
  }

  const launchProjectRoot = findRepoPlanningRootSync(process.cwd());
  const launchProjectRef = await resolveLaunchProjectRef(launchProjectRoot);
  const uiAssetsDir = resolveUiPackageDir();
  const token = crypto.randomBytes(32).toString('hex');
  const version = ownVersion();

  let handle: Awaited<ReturnType<typeof startManagementServer>>;
  try {
    handle = await startManagementServer({
      port,
      context: { token, launchProjectRoot, launchProjectRef, version, uiAssetsDir },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`Error: port ${port} is already in use. Another process (possibly another rasen daemon) is bound there.`);
    } else {
      console.error(`Error: could not start the daemon (${error instanceof Error ? error.message : String(error)}).`);
    }
    process.exitCode = 1;
    return;
  }

  writeDaemonState({ version, pid: process.pid, port: handle.port, token, startedAt: Date.now() });
  console.log(`Rasen daemon listening on http://127.0.0.1:${handle.port} (pid ${process.pid}).`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // `stopServer` already reaps every live supervised session via
    // `supervisor.shutdownAll('server-shutdown')` before resolving (server.ts)
    // — the daemon's clean-shutdown reap requirement is inherited for free.
    await handle.stopServer();
    deleteDaemonState();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// ---------------------------------------------------------------------------
// `daemon start` — detached self-spawn + bounded readiness wait (task 2.4)
// ---------------------------------------------------------------------------

export interface SpawnDaemonResult {
  ok: true;
  port: number;
  version: string;
  pid: number;
}

export interface SpawnDaemonFailure {
  ok: false;
  reason: 'timeout' | 'foreign';
  message: string;
}

/**
 * Spawns the daemon detached on `port` and waits, bounded, for it to answer
 * with matching rasen identity. Shared by the `daemon start` command and
 * `ui-launch.ts`'s no-listener spawn branch. On a `foreign` classification
 * appearing mid-wait, fails immediately (continuing to poll is pointless —
 * something else already owns the port and this call's own spawn will have
 * failed EADDRINUSE on its own). On timeout, tree-kills the half-started
 * child (ours to reap — it never reached adoptable state) and reports the
 * log path. If, mid-wait, a same-version rasen daemon answers (a concurrent
 * spawner won the race), that converges to success without treating it as
 * a failure — "task 3.3 concurrent-launch convergence".
 */
export async function spawnDaemonDetached(port: number): Promise<SpawnDaemonResult | SpawnDaemonFailure> {
  const cliEntry = resolveOwnCliEntry();
  const logPath = getDaemonLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'w');

  const argv = [cliEntry, 'daemon', 'run', '--port', String(port)];
  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    shell: false,
    windowsHide: IS_WINDOWS,
  });
  fs.closeSync(logFd);
  child.unref();

  for (let attempt = 0; attempt < READINESS_POLL_ATTEMPTS; attempt++) {
    await sleep(READINESS_POLL_INTERVAL_MS);
    const probe: DaemonProbeResult = await probeDaemonPort(port);
    if (probe.kind === 'rasen-daemon') {
      return { ok: true, port, version: probe.version, pid: probe.pid };
    }
    if (probe.kind === 'foreign') {
      if (typeof child.pid === 'number') killProcessTree(child.pid);
      return {
        ok: false,
        reason: 'foreign',
        message: `Port ${port} is held by a non-rasen process. Set RASEN_DAEMON_PORT/--port to a free port, or use --no-daemon.`,
      };
    }
  }

  if (typeof child.pid === 'number') killProcessTree(child.pid);
  return {
    ok: false,
    reason: 'timeout',
    message: `Timed out waiting for the daemon to become ready on port ${port}. See the log: ${logPath}`,
  };
}

async function runDaemonStart(options: { port?: string }): Promise<void> {
  const defaultPort = resolveDefaultDaemonPort();
  const port = parsePortOption(options.port, defaultPort);
  if (typeof port === 'object') {
    console.error(`Error: ${port.error}`);
    process.exitCode = 1;
    return;
  }

  const existing = await probeDaemonPort(port);
  if (existing.kind === 'rasen-daemon') {
    console.log(`Rasen daemon already running on http://127.0.0.1:${port} (version ${existing.version}, pid ${existing.pid}).`);
    return;
  }
  if (existing.kind === 'foreign') {
    console.error(`Error: port ${port} is held by a non-rasen process. Set RASEN_DAEMON_PORT/--port to a free port.`);
    process.exitCode = 1;
    return;
  }

  const result = await spawnDaemonDetached(port);
  if (!result.ok) {
    console.error(`Error: ${result.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Rasen daemon started on http://127.0.0.1:${result.port} (pid ${result.pid}).`);
}

// ---------------------------------------------------------------------------
// `daemon status` / `daemon stop` (task 2.5)
// ---------------------------------------------------------------------------

async function classify(): Promise<{ port: number; result: DaemonProbeResult }> {
  const defaultPort = resolveDefaultDaemonPort();
  const state = readDaemonState();
  return probeDaemon(defaultPort, state?.port);
}

async function runDaemonStatus(): Promise<void> {
  const { port, result } = await classify();
  if (result.kind === 'rasen-daemon') {
    console.log(`Running: rasen daemon version ${result.version}, pid ${result.pid}, port ${port}.`);
  } else if (result.kind === 'foreign') {
    console.log(`Foreign listener on port ${port} — not a rasen daemon; not touched.`);
  } else {
    console.log(`No daemon running (checked port ${port}).`);
  }
}

async function waitForPortFree(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < STOP_POLL_ATTEMPTS; attempt++) {
    const probe = await probeDaemonPort(port);
    if (probe.kind === 'no-listener') return true;
    await sleep(STOP_POLL_INTERVAL_MS);
  }
  return false;
}

async function runDaemonStop(): Promise<void> {
  const { port, result } = await classify();
  if (result.kind === 'no-listener') {
    console.log(`No daemon running (checked port ${port}).`);
    deleteDaemonState();
    return;
  }
  if (result.kind === 'foreign') {
    console.error(`Error: port ${port} is held by a non-rasen process. Refusing to send any signal — only identified rasen daemons are ever terminated.`);
    process.exitCode = 1;
    return;
  }

  // Positively identified (any version) — terminate by its reported pid,
  // via SIGTERM-then-SIGKILL tree termination (kill-tree.ts). Its own
  // SIGTERM handler runs `stopServer` -> `shutdownAll('server-shutdown')`
  // when it can catch the signal; the forced escalation is the honest
  // fallback for a wedged process.
  killProcessTree(result.pid);
  const freed = await waitForPortFree(port);
  if (!freed && isProcessAlive(result.pid)) {
    console.error(`Error: daemon (pid ${result.pid}) did not stop within the wait window.`);
    process.exitCode = 1;
    return;
  }
  deleteDaemonState();
  console.log(`Stopped rasen daemon (version ${result.version}, pid ${result.pid}).`);
}

export function registerDaemonCommand(program: Command): void {
  const daemon = program.command('daemon').description('Manage the resident Rasen daemon (sessions survive terminal exits)');

  daemon
    .command('run')
    .description('Run the resident daemon in the foreground (debugging/advanced form)')
    .option('--port <n>', 'Pin the listen port (default: 8791, or RASEN_DAEMON_PORT)')
    .action(async (options: { port?: string }) => {
      await runDaemonRun(options);
    });

  daemon
    .command('start')
    .description('Start the resident daemon as a detached background process')
    .option('--port <n>', 'Pin the listen port (default: 8791, or RASEN_DAEMON_PORT)')
    .action(async (options: { port?: string }) => {
      await runDaemonStart(options);
    });

  daemon
    .command('stop')
    .description('Stop the resident daemon, reaping its live sessions')
    .action(async () => {
      await runDaemonStop();
    });

  daemon
    .command('status')
    .description('Report whether the resident daemon is running')
    .action(async () => {
      await runDaemonStatus();
    });
}
