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
  IDENTIFIED_DAEMON_KILL_GRACE_MS,
  probeDaemon,
  probeDaemonPort,
  resolveDefaultDaemonPort,
  waitForDaemonPortFree,
  type DaemonProbeResult,
} from '../core/management-api/daemon-probe.js';

const require = createRequire(import.meta.url);
const IS_WINDOWS = process.platform === 'win32';

const READINESS_POLL_ATTEMPTS = 20;
const READINESS_POLL_INTERVAL_MS = 250;

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

/**
 * Terminates a POSITIVELY-IDENTIFIED rasen daemon (by its reported pid —
 * never a guess) and waits, bounded, for its port to free. Shared by
 * `daemon stop`, `daemon start`'s stale-replace branch, and `rasen ui`'s
 * stale-replace branch (`ui-launch.ts`) — one call site for the
 * `IDENTIFIED_DAEMON_KILL_GRACE_MS` grace so the three can never drift out
 * of sync with each other (review m1: an outer grace shorter than the
 * daemon's own worst-case clean shutdown silently orphans a
 * silent-and-SIGTERM-resistant session).
 */
export async function killIdentifiedDaemonAndWaitFree(pid: number, port: number): Promise<boolean> {
  killProcessTree(pid, { graceMs: IDENTIFIED_DAEMON_KILL_GRACE_MS });
  return waitForDaemonPortFree(port);
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
  reason: 'timeout' | 'foreign' | 'version-mismatch';
  message: string;
}

/**
 * Spawns the daemon detached on `port` and waits, bounded, for it to answer
 * with MATCHING rasen identity (`expectedVersion` — always this
 * installation's own version; a required parameter, not defaulted, so a
 * caller can never silently skip the check that closed review finding m2).
 * Shared by the `daemon start` command and `ui-launch.ts`'s spawn branches.
 * On a `foreign` classification appearing mid-wait, fails immediately
 * (continuing to poll is pointless — something else already owns the port
 * and this call's own spawn will have failed EADDRINUSE on its own). On a
 * DIFFERENT-version rasen daemon appearing mid-wait (m2: this must not
 * green-exit as if it were "our" fresh spawn — it is stale code, and the
 * D1 contract is "answers with matching identity"), fails with a clear
 * remediation rather than converging on it. On timeout, tree-kills the
 * half-started child (ours to reap — it never reached adoptable state)
 * and reports the log path. If, mid-wait, a SAME-version rasen daemon
 * answers (a concurrent spawner won the race), that converges to success
 * without treating it as a failure — "task 3.3 concurrent-launch
 * convergence".
 */
export async function spawnDaemonDetached(port: number, expectedVersion: string): Promise<SpawnDaemonResult | SpawnDaemonFailure> {
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
      if (probe.version === expectedVersion) {
        return { ok: true, port, version: probe.version, pid: probe.pid };
      }
      if (typeof child.pid === 'number') killProcessTree(child.pid);
      return {
        ok: false,
        reason: 'version-mismatch',
        message: `A rasen daemon of a different version (${probe.version}, pid ${probe.pid}) is already on port ${port}. Run 'rasen daemon stop' then retry, or 'rasen ui' to replace it automatically.`,
      };
    }
    if (probe.kind === 'foreign') {
      if (typeof child.pid === 'number') killProcessTree(child.pid);
      return {
        ok: false,
        reason: 'foreign',
        message: `Port ${port} is held by a non-rasen process. Set RASEN_DAEMON_PORT to a free port, or use --no-daemon.`,
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

/**
 * `daemon start` (task 2.4 + review m2/m4 fixes): routed through the same
 * hint-first `classify()` stop/status use (m4 — skipping the state-file
 * hint let `start` spawn a SECOND daemon on the default port while an
 * existing one sat on a previously-hinted non-default port, stranding the
 * first from `stop`'s own discovery). A same-version daemon at the found
 * port is reported and left alone; a DIFFERENT-version one is replaced in
 * place (m2 — `daemon start` must not green-exit leaving the platform on
 * stale code; D1 pins success on "answer[ing] with matching identity", and
 * the daemon-residency classification requirement already makes stale
 * daemons replaceable, so `start` now does what `rasen ui` does); a
 * foreign listener refuses; no-listener spawns fresh.
 */
async function runDaemonStart(options: { port?: string }): Promise<void> {
  const defaultPort = resolveDefaultDaemonPort();
  const requestedPort = parsePortOption(options.port, defaultPort);
  if (typeof requestedPort === 'object') {
    console.error(`Error: ${requestedPort.error}`);
    process.exitCode = 1;
    return;
  }

  const { port: foundPort, result: existing } = await classify(requestedPort);

  if (existing.kind === 'foreign') {
    console.error(`Error: port ${foundPort} is held by a non-rasen process. Set RASEN_DAEMON_PORT/--port to a free port.`);
    process.exitCode = 1;
    return;
  }

  if (existing.kind === 'rasen-daemon' && existing.version === ownVersion()) {
    console.log(`Rasen daemon already running on http://127.0.0.1:${foundPort} (version ${existing.version}, pid ${existing.pid}).`);
    return;
  }

  if (existing.kind === 'rasen-daemon') {
    // Different version — replace in place (m2): never leave a stale
    // daemon behind with a green exit.
    console.log(`Replacing stale rasen daemon (version ${existing.version}, pid ${existing.pid}) on port ${foundPort}...`);
    const freed = await killIdentifiedDaemonAndWaitFree(existing.pid, foundPort);
    if (!freed) {
      console.error(`Error: could not free port ${foundPort} from the stale daemon (pid ${existing.pid}) in time.`);
      process.exitCode = 1;
      return;
    }
  }

  const result = await spawnDaemonDetached(foundPort, ownVersion());
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

/** Hint-first probe (design D2/D3): the state file's port hint, then `preferredPort` (an explicit target, e.g. `daemon start --port`) or else the env/default port. Shared by `status`, `stop`, and `start` (m4) so none of the three can strand another via a missed hint. */
async function classify(preferredPort?: number): Promise<{ port: number; result: DaemonProbeResult }> {
  const targetPort = preferredPort ?? resolveDefaultDaemonPort();
  const state = readDaemonState();
  return probeDaemon(targetPort, state?.port);
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
  // via SIGTERM-then-SIGKILL tree termination with the identified-daemon
  // grace (kill-tree.ts, daemon-probe.ts's IDENTIFIED_DAEMON_KILL_GRACE_MS;
  // review m1 — this must exceed the daemon's own worst-case clean
  // shutdown or a silent-and-SIGTERM-resistant session's process group
  // survives the daemon's SIGKILL and orphans). Its own SIGTERM handler
  // runs `stopServer` -> `shutdownAll('server-shutdown')` when it can
  // catch the signal; the forced escalation is the honest fallback for a
  // wedged process.
  const freed = await killIdentifiedDaemonAndWaitFree(result.pid, port);
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
