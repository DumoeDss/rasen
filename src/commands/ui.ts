/**
 * `rasen ui` — hidden experimental launch command for the management server
 * (design.md D6 of `rasen-ui-slice1-readonly-api`). Mirrors `config ui`'s
 * flow (src/commands/config.ts) almost exactly — token mint, launch-project
 * resolution, UI-package resolution, browser open, SIGINT/SIGTERM shutdown —
 * but starts the **management** server (management + config endpoints + UI
 * assets, one origin, one token) and opens `/board` instead of `/`.
 * `rasen config ui` itself is untouched by this file.
 */
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { resolveLaunchProjectRef } from '../core/config-api/project-addressing.js';
import { resolveUiPackageDir, UI_PACKAGE_NAME } from '../core/config-api/ui-package.js';
import { startManagementServer } from '../core/management-api/server.js';

const require = createRequire(import.meta.url);

export interface UiCommandOptions {
  open?: boolean;
  port?: string;
}

/**
 * Best-effort default-browser launch via the platform opener (`open` /
 * `cmd /c start` / `xdg-open`), spawned detached with stdio ignored and
 * unref'd so it never holds the CLI process's event loop open. Duplicated
 * from `config.ts`'s (unexported) `openInBrowser` rather than importing it —
 * that file is not touched by this change.
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

export function registerUiCommand(program: Command): void {
  program
    .command('ui', { hidden: true })
    .description('Start the localhost management API + board UI (experimental)')
    .option('--no-open', 'Do not open the default browser')
    .option('--port <n>', 'Pin the listen port (default: ephemeral)')
    .action(async (options: UiCommandOptions) => {
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
          console.error(`Error: could not start the management server (${error instanceof Error ? error.message : String(error)}).`);
        }
        process.exitCode = 1;
        return;
      }

      const url = `http://127.0.0.1:${handle.port}/board#token=${token}`;
      console.log(`Rasen UI: ${url}`);
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
    });
}
