/**
 * `rasen ui` — the public management-platform entry point (design.md D1/D4
 * of `rasen-ui-unify-management-surface`; adopt-or-spawn behavior added by
 * `slice3-daemon-residency` design D3/D4). By default, adopts or spawns the
 * resident daemon and lands on the board at `/`, the platform home;
 * `--no-daemon` preserves the pre-residency self-hosted foreground form. A
 * thin wrapper over the shared launch flow in `ui-launch.ts`, which both
 * this command and the `rasen config ui` alias (`src/commands/config.ts`)
 * use.
 */
import { Command } from 'commander';

import { runUiLaunch, type UiLaunchOptions } from './ui-launch.js';

export type UiCommandOptions = UiLaunchOptions;

export function registerUiCommand(program: Command): void {
  program
    .command('ui')
    .description('Start the Rasen management platform (board + config) on a localhost server')
    .option('--no-open', 'Do not open the default browser')
    .option('--port <n>', 'Pin the listen port (default: ephemeral; --no-daemon only)')
    .option('--no-daemon', 'Use a self-hosted foreground server instead of the resident daemon')
    .action(async (options: UiCommandOptions) => {
      await runUiLaunch(options, {
        entryPath: '/',
        label: 'Rasen UI',
        serverLabel: 'management server',
      });
    });
}
