/**
 * `rasen ui` — the public management-platform entry point (design.md D1/D4
 * of `rasen-ui-unify-management-surface`). Starts the unified management
 * server (management + config endpoints + UI assets, one origin, one token)
 * and lands on the board at `/`, the platform home. A thin wrapper over the
 * shared launch flow in `ui-launch.ts`, which both this command and the
 * `rasen config ui` alias (`src/commands/config.ts`) use.
 */
import { Command } from 'commander';

import { runUiLaunch, type UiLaunchOptions } from './ui-launch.js';

export type UiCommandOptions = UiLaunchOptions;

export function registerUiCommand(program: Command): void {
  program
    .command('ui')
    .description('Start the Rasen management platform (board + config) on a localhost server')
    .option('--no-open', 'Do not open the default browser')
    .option('--port <n>', 'Pin the listen port (default: ephemeral)')
    .action(async (options: UiCommandOptions) => {
      await runUiLaunch(options, {
        entryPath: '/',
        label: 'Rasen UI',
        serverLabel: 'management server',
      });
    });
}
