/**
 * Shared launch flow for the management server (design.md D3 of
 * `rasen-ui-unify-management-surface`): port validation, launch-project +
 * UI-package resolution, token mint, `startManagementServer` with
 * EADDRINUSE/invalid-port handling, URL print (parameterized entry path and
 * label), install hint, `openInBrowser`, and SIGINT/SIGTERM shutdown. Both
 * `rasen ui` (`src/commands/ui.ts`) and the `rasen config ui` alias
 * (`src/commands/config.ts`) are thin wrappers over this module —
 * `openInBrowser` lives only here now.
 */
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { resolveLaunchProjectRef } from '../core/config-api/project-addressing.js';
import { resolveUiPackageDir, UI_PACKAGE_NAME } from '../core/config-api/ui-package.js';
import { startManagementServer } from '../core/management-api/server.js';

const require = createRequire(import.meta.url);

export interface UiLaunchOptions {
  open?: boolean;
  port?: string;
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
 * Runs the full launch flow: validates `--port`, starts the unified
 * management server, prints the URL (with the deprecation notice when
 * given), opens the browser unless `--no-open`, and wires SIGINT/SIGTERM to
 * a clean shutdown. Sets `process.exitCode = 1` and returns without starting
 * a server on a validation or startup failure.
 */
export async function runUiLaunch(options: UiLaunchOptions, config: UiLaunchConfig): Promise<void> {
  let port: number | undefined;
  if (options.port !== undefined) {
    port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      console.error(`Error: --port must be an integer between 0 and 65535 (got "${options.port}").`);
      process.exitCode = 1;
      return;
    }
  }

  const launchProjectRoot = findRepoPlanningRootSync(process.cwd());
  const launchProjectRef = await resolveLaunchProjectRef(launchProjectRoot);
  const uiAssetsDir = resolveUiPackageDir();
  const token = crypto.randomBytes(32).toString('hex');
  const { version } = require('../../package.json') as { version: string };

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

  const url = `http://127.0.0.1:${handle.port}${config.entryPath}#token=${token}`;
  if (config.notice) {
    console.log(config.notice);
  }
  console.log(`${config.label}: ${url}`);
  if (!uiAssetsDir) {
    console.log(`UI package not installed. Run: npm install -g ${UI_PACKAGE_NAME}`);
  }

  if (options.open !== false) {
    openInBrowser(url);
  }

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
