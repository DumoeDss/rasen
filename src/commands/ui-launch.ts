/**
 * Shared launch flow for the management platform (design.md D3/D4 of
 * `slice3-daemon-residency`, superseding the child-1/prior-batch
 * self-hosted-only flow): by default, `rasen ui` (and the `rasen config ui`
 * alias) is an adopt-or-spawn CONSUMER of the resident daemon — it probes
 * the daemon port, classifies what answers via the rasen identity headers,
 * adopts a same-version daemon, replaces a stale one, spawns a fresh one
 * when nothing listens, and fails (touching nothing) on a foreign listener.
 * `--no-daemon` preserves the pre-residency self-hosted foreground form
 * verbatim: this process itself starts the management server, owns the
 * supervisor, and reaps its sessions on SIGINT/SIGTERM.
 */
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { deriveSpaceFromCwd, findQualifyingRootSync } from '../core/root-selection.js';
import { classifyOpenSpecDir } from '../core/project-config.js';
import { resolveProjectHome } from '../core/project-home.js';
import { resolveLaunchProjectRef } from '../core/config-api/project-addressing.js';
import { resolveUiPackageDir, UI_PACKAGE_NAME } from '../core/config-api/ui-package.js';
import { startManagementServer } from '../core/management-api/server.js';
import { readDaemonState } from '../core/management-api/daemon-state.js';
import { probeDaemon, resolveDefaultDaemonPort } from '../core/management-api/daemon-probe.js';
import { killIdentifiedDaemonAndWaitFree, spawnDaemonDetached } from './daemon.js';

const require = createRequire(import.meta.url);

export interface UiLaunchOptions {
  open?: boolean;
  port?: string;
  /**
   * Commander's `--no-daemon` negatable-flag mapping: `true` (the default,
   * whether or not the caller sets it explicitly) unless `--no-daemon` was
   * passed, in which case `false`. `false` selects the pre-residency
   * self-hosted foreground form; anything else selects adopt-or-spawn.
   */
  daemon?: boolean;
}

export interface UiLaunchConfig {
  /** Route to land on, e.g. `/` or `/config`. Combined with the token fragment. */
  entryPath: string;
  /** Printed before the URL, e.g. `Rasen UI` or `Config UI`. */
  label: string;
  /** Optional one-line notice printed before the URL (e.g. a deprecation pointer). */
  notice?: string;
  /** Label used in the "could not start" error message, e.g. "management server". */
  serverLabel: string;
}

/**
 * Best-effort default-browser launch via the platform opener (`open` /
 * `cmd /c start` / `xdg-open`), spawned detached with stdio ignored and
 * unref'd so it never holds the CLI process's event loop open.
 */
function openInBrowser(url: string): void {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {
      // Best-effort: the URL is already printed for manual opening.
    });
    child.unref();
  } catch {
    // Best-effort: the URL is already printed for manual opening.
  }
}

/**
 * Resolves the `?space=` query for the launch URL from the cwd's planning
 * space (management-ui-command spec / design D5): a project space is
 * ensure-registered first (CLI-side write, the same registration any
 * root-resolving command performs) so its emitted `project:<id>` selector
 * resolves against the daemon; a pointer repo emits `store:<id>`. Returns the
 * empty string (no parameter, launch unchanged) when the cwd yields no
 * derivable space, or on any failure — a bad space resolution must never
 * block the launch. Exported for direct launch-URL tests.
 */
export async function resolveLaunchSpaceQuery(cwd: string): Promise<string> {
  try {
    const root = findQualifyingRootSync(cwd);
    if (root) {
      const { hasPlanningShape } = classifyOpenSpecDir(root);
      if (hasPlanningShape) {
        // Ensure the project is registered with a usable id before deriving,
        // so the emitted `project:<id>` always resolves. Best-effort: a
        // config-less or unwritable root simply yields no space below.
        try {
          await resolveProjectHome(root, { ensure: true });
        } catch {
          // Fall through — derivation degrades to no space if identity is absent.
        }
      }
    }
    const space = await deriveSpaceFromCwd(cwd);
    if (!space || space.id.length === 0) {
      return '';
    }
    return `?space=${space.type}:${encodeURIComponent(space.id)}`;
  } catch {
    return '';
  }
}

function validatePort(rawPort: string | undefined): number | undefined | { error: string } {
  if (rawPort === undefined) return undefined;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return { error: `--port must be an integer between 0 and 65535 (got "${rawPort}").` };
  }
  return port;
}

function printUrlAndOpen(url: string, config: UiLaunchConfig, uiAssetsDir: string | null, open: boolean | undefined): void {
  if (config.notice) {
    console.log(config.notice);
  }
  console.log(`${config.label}: ${url}`);
  if (!uiAssetsDir) {
    console.log(`UI package not installed. Run: npm install -g ${UI_PACKAGE_NAME}`);
  }
  if (open !== false) {
    openInBrowser(url);
  }
}

/**
 * Runs the full launch flow. By default, adopts or spawns the resident
 * daemon and exits promptly once the URL is delivered (design D4 of
 * `slice3-daemon-residency`: exiting `rasen ui` never reaps the daemon or
 * its sessions — there is nothing here for this process to shut down).
 * `options.noDaemon` runs the pre-residency self-hosted foreground form
 * verbatim, including its SIGINT/SIGTERM shutdown-and-reap posture. Sets
 * `process.exitCode = 1` and returns without starting anything on a
 * validation or startup failure.
 */
export async function runUiLaunch(options: UiLaunchOptions, config: UiLaunchConfig): Promise<void> {
  const port = validatePort(options.port);
  if (port !== undefined && typeof port === 'object') {
    console.error(`Error: ${port.error}`);
    process.exitCode = 1;
    return;
  }

  const { version } = require('../../package.json') as { version: string };
  const uiAssetsDir = resolveUiPackageDir();

  // Resolve the cwd's planning space once, before either launch form emits a
  // URL (design D5). Placed after port validation so a bad `--port` never
  // triggers the ensure-registration write.
  const spaceQuery = await resolveLaunchSpaceQuery(process.cwd());

  if (options.daemon === false) {
    await runSelfHosted(options, config, port, version, uiAssetsDir, spaceQuery);
    return;
  }

  await runAdoptOrSpawn(options, config, version, uiAssetsDir, spaceQuery);
}

/**
 * Adopt-or-spawn consumer path (design D3): probe -> classify -> adopt /
 * replace-stale / spawn / fail-on-foreign. Prints the URL and returns; no
 * server is started or owned by this process on the adopt/spawn paths.
 */
async function runAdoptOrSpawn(
  options: UiLaunchOptions,
  config: UiLaunchConfig,
  version: string,
  uiAssetsDir: string | null,
  spaceQuery: string
): Promise<void> {
  const defaultPort = resolveDefaultDaemonPort();
  const stateHint = readDaemonState()?.port;
  const probed = await probeDaemon(defaultPort, stateHint);

  if (probed.result.kind === 'foreign') {
    // m3: `--port` is NOT read on this branch (design: it applies only to
    // the self-hosted `--no-daemon` form) — naming it here would send a
    // user who follows the advice with `rasen ui --port <n>` straight back
    // into this same error. Only the escapes that actually change what
    // this branch probes are named.
    console.error(
      `Error: port ${probed.port} is held by a non-rasen process. Set RASEN_DAEMON_PORT to reroute the daemon, or run with --no-daemon to use a self-hosted server instead.`
    );
    process.exitCode = 1;
    return;
  }

  if (probed.result.kind === 'rasen-daemon' && probed.result.version === version) {
    // Same-version daemon — adopt without spawning.
    const state = readDaemonState();
    if (!state?.token) {
      console.error(`Error: a running rasen daemon was found but its runtime state (token) could not be read. Run 'rasen daemon stop' then retry.`);
      process.exitCode = 1;
      return;
    }
    const url = `http://127.0.0.1:${probed.port}${config.entryPath}${spaceQuery}#token=${state.token}`;
    printUrlAndOpen(url, config, uiAssetsDir, options.open);
    return;
  }

  if (probed.result.kind === 'rasen-daemon') {
    // Stale rasen daemon, identified by its own reported pid — terminate
    // and replace with a freshly spawned same-version daemon (design D3:
    // "never kill what you didn't spawn" forbids touching what we cannot
    // *identify*; a version-mismatched rasen daemon IS identified). Uses
    // the identified-daemon grace shared with `daemon stop` (review m1) —
    // an equal, shorter grace here would let this outer kill's SIGKILL
    // land before the stale daemon's own internal session reap finishes,
    // orphaning a silent-and-SIGTERM-resistant session.
    const freed = await killIdentifiedDaemonAndWaitFree(probed.result.pid, probed.port);
    if (!freed) {
      console.error(`Error: could not free port ${probed.port} from the stale daemon (pid ${probed.result.pid}) in time.`);
      process.exitCode = 1;
      return;
    }
  }

  // No listener (or the stale daemon just freed its port) — spawn a fresh
  // daemon and wait for verified readiness.
  const spawned = await spawnDaemonDetached(probed.port, version);
  if (!spawned.ok) {
    console.error(`Error: ${spawned.message}`);
    process.exitCode = 1;
    return;
  }
  const state = readDaemonState();
  if (!state?.token) {
    console.error(`Error: the daemon started but its runtime state (token) could not be read. Run 'rasen daemon stop' then retry.`);
    process.exitCode = 1;
    return;
  }
  const url = `http://127.0.0.1:${spawned.port}${config.entryPath}${spaceQuery}#token=${state.token}`;
  printUrlAndOpen(url, config, uiAssetsDir, options.open);
}

/** Pre-residency self-hosted foreground form, preserved verbatim under `--no-daemon` (design D4). */
async function runSelfHosted(
  options: UiLaunchOptions,
  config: UiLaunchConfig,
  port: number | undefined,
  version: string,
  uiAssetsDir: string | null,
  spaceQuery: string
): Promise<void> {
  const launchProjectRoot = findRepoPlanningRootSync(process.cwd());
  const launchProjectRef = await resolveLaunchProjectRef(launchProjectRoot);
  const token = crypto.randomBytes(32).toString('hex');

  let handle: Awaited<ReturnType<typeof startManagementServer>>;
  try {
    handle = await startManagementServer({
      port,
      context: { token, launchProjectRoot, launchProjectRef, version, uiAssetsDir },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`Error: port ${port} is already in use. Try a different --port, or omit it for an ephemeral one.`);
    } else {
      console.error(`Error: could not start the ${config.serverLabel} (${error instanceof Error ? error.message : String(error)}).`);
    }
    process.exitCode = 1;
    return;
  }

  const url = `http://127.0.0.1:${handle.port}${config.entryPath}${spaceQuery}#token=${token}`;
  printUrlAndOpen(url, config, uiAssetsDir, options.open);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await handle.stopServer();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
