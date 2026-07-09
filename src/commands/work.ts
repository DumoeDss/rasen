/**
 * `rasen work` — the machine-home work-directory surface. Currently one
 * subcommand, `migrate` (`migrate-legacy-ephemera`): a one-shot, idempotent
 * migration of legacy in-repo T3 ephemera into the project's machine-home
 * work directories. Room for future `work path <change>` / `work sweep`
 * (design D1).
 */
import { Command } from 'commander';

import { resolveRootForCommand } from '../core/root-selection.js';
import {
  runWorkMigration,
  type MigrationFileReport,
  type RunWorkMigrationResult,
  type WorkMigrationReport,
} from '../core/work-migration.js';
import { COMMAND_REGISTRY } from '../core/completions/command-registry.js';
import { emitFailure, printJson } from './shared-output.js';

interface WorkMigrateOptions {
  change?: string;
  dryRun?: boolean;
  includeTracked?: boolean;
  json?: boolean;
  yes?: boolean;
}

const FAILURE_PAYLOAD = { changes: [], summary: null };

/**
 * Non-`RootSelectionError` failure modes `runWorkMigration` reports as a
 * discriminated result rather than a throw (`home_unresolved`,
 * `change_not_found`, `git_query_failed`) are converted to this shape at
 * the command boundary so the outer catch's `emitFailure` handles every
 * failure uniformly (same `.diagnostic` duck-type `archive.ts`'s
 * `ArchiveBlockedError` uses).
 */
class WorkMigrateBlockedError extends Error {
  readonly diagnostic: { severity: 'error'; code: string; message: string; fix?: string };

  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = 'WorkMigrateBlockedError';
    this.diagnostic = { severity: 'error', code, message, ...(fix ? { fix } : {}) };
  }
}

function unwrapOrThrow(result: RunWorkMigrationResult, changeName?: string): WorkMigrationReport {
  if (result.ok) return result.report;

  if (result.reason === 'change_not_found') {
    throw new WorkMigrateBlockedError(
      'work_migrate_change_not_found',
      `No active or archived change matching '${changeName}' was found.`
    );
  }

  if (result.reason === 'git_query_failed') {
    throw new WorkMigrateBlockedError(
      'work_migrate_git_query_failed',
      'Could not reliably determine which ephemera are git-tracked (the root is a git repository, but the tracked-files query failed) — refusing to guess, since guessing wrong could move committed content as if it were untracked noise.',
      'Check for git lock contention, a corrupt .git directory, or a broken git installation, then retry `rasen work migrate`.'
    );
  }

  throw new WorkMigrateBlockedError(
    'work_migrate_home_unresolved',
    'Could not resolve or create the machine home for this project.',
    'Run `rasen init` first, then retry `rasen work migrate`.'
  );
}

function quoteForShell(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

function destinationLabel(destination: string | null): string {
  return destination ?? '(pending — identity not minted yet)';
}

function toJsonPayload(
  report: WorkMigrationReport,
  meta: { executed: boolean; dryRun: boolean }
): Record<string, unknown> {
  return {
    dryRun: meta.dryRun,
    executed: meta.executed,
    gitRoot: report.gitRoot,
    identityPending: report.identityPending,
    changes: report.changes.map((c) => ({
      change: c.change,
      archived: c.archived,
      changeDir: c.changeDir,
      workDir: c.workDir,
      moved: c.files
        .filter((f) => f.status === 'moved' || f.status === 'planned')
        .map((f) => f.relativePath),
      skippedTracked: c.files
        .filter((f) => f.status === 'skipped-tracked')
        .map((f) => f.relativePath),
      conflicts: c.files
        .filter((f) => f.status === 'conflict')
        .map((f) => ({ relativePath: f.relativePath, destination: f.destination })),
      failed: c.files
        .filter((f) => f.status === 'failed')
        .map((f) => ({ relativePath: f.relativePath, error: f.error })),
      notes: c.notes,
    })),
    summary: report.summary,
    notes: report.notes,
  };
}

function printHumanReport(
  report: WorkMigrationReport,
  opts: { executed: boolean; title: string }
): void {
  console.log(opts.title);
  console.log('');

  if (report.summary.totalCandidates === 0) {
    console.log('Nothing to migrate.');
  } else {
    for (const change of report.changes) {
      if (change.files.length === 0 && change.notes.length === 0) continue;

      console.log(`${change.archived ? 'Archived' : 'Active'}: ${change.change}`);
      console.log(`  Work dir: ${change.workDir ?? '(pending — identity not minted yet)'}`);

      const toMove = change.files.filter((f) => f.status === 'moved' || f.status === 'planned');
      const skippedTracked = change.files.filter((f) => f.status === 'skipped-tracked');
      const conflicts = change.files.filter((f) => f.status === 'conflict');
      const failed = change.files.filter((f: MigrationFileReport) => f.status === 'failed');

      if (toMove.length > 0) {
        console.log(`  ${opts.executed ? 'Moved' : 'Would move'} (${toMove.length}):`);
        for (const f of toMove) {
          console.log(`    - ${f.relativePath}${f.tracked ? ' (tracked)' : ''}`);
        }
      }
      if (skippedTracked.length > 0) {
        console.log(`  Skipped, tracked — use --include-tracked to move (${skippedTracked.length}):`);
        for (const f of skippedTracked) console.log(`    - ${f.relativePath}`);
      }
      if (conflicts.length > 0) {
        console.log(`  Conflicts, left in place (${conflicts.length}):`);
        for (const f of conflicts) {
          console.log(`    - ${f.relativePath} (destination exists: ${destinationLabel(f.destination)})`);
        }
      }
      if (failed.length > 0) {
        console.log(`  Failed (${failed.length}):`);
        for (const f of failed) console.log(`    - ${f.relativePath}: ${f.error}`);
      }
      if (change.notes.length > 0) {
        console.log('  Notes:');
        for (const n of change.notes) console.log(`    - ${n}`);
      }
      console.log('');
    }
  }

  const s = report.summary;
  const plannedCount = s.totalCandidates - s.skippedTracked - s.conflicts;
  console.log(
    opts.executed
      ? `Summary: ${s.totalCandidates} candidate(s) — moved ${s.moved}, skipped-tracked ${s.skippedTracked}, conflicts ${s.conflicts}, failed ${s.failed}.`
      : `Summary: ${s.totalCandidates} candidate(s) — would move ${plannedCount}, skipped-tracked ${s.skippedTracked}, conflicts ${s.conflicts}.`
  );

  if (opts.executed) {
    const movedTracked = report.changes.flatMap((c) =>
      c.files.filter((f) => f.status === 'moved' && f.tracked)
    );
    if (movedTracked.length > 0) {
      console.log('');
      console.log('Tracked files were moved; the deletions are uncommitted. To commit them:');
      console.log(`  git commit -- ${movedTracked.map((f) => quoteForShell(f.source)).join(' ')}`);
    }
  }

  for (const note of report.notes) {
    console.log('');
    console.log(`Note: ${note}`);
  }
}

async function runMigrate(options: WorkMigrateOptions): Promise<void> {
  const json = !!options.json;

  try {
    // --store is deliberately not offered yet (task 2.1): the nearest root
    // wins, matching every other maintenance-shaped command's first cut.
    // Diagnostic-style resolution (allowImplicitRoot: false, doctor's
    // precedent): migration operates on an EXISTING root's change dirs —
    // there is nothing to migrate from a root that would otherwise be
    // silently scaffolded.
    const root = await resolveRootForCommand(
      {},
      { json, failurePayload: FAILURE_PAYLOAD, allowImplicitRoot: false }
    );
    if (!root) return;

    const dryRun = !!options.dryRun;
    const yes = !!options.yes;
    const scanOptions = {
      includeTracked: !!options.includeTracked,
      ...(options.change !== undefined ? { changeName: options.change } : {}),
    };

    if (dryRun || json) {
      // --dry-run always stops at preview in both modes; --json is
      // non-interactive and executes only with an explicit --yes.
      const execute = !dryRun && yes;
      const report = unwrapOrThrow(
        await runWorkMigration(root.path, root.changesDir, { ...scanOptions, execute }),
        options.change
      );
      if (json) {
        printJson(toJsonPayload(report, { executed: execute, dryRun }));
      } else {
        printHumanReport(report, {
          executed: execute,
          title: execute ? 'Work migration' : 'Work migration (preview)',
        });
      }
      return;
    }

    // Interactive human mode: preview -> confirm -> execute -> report.
    const preview = unwrapOrThrow(
      await runWorkMigration(root.path, root.changesDir, { ...scanOptions, execute: false }),
      options.change
    );
    printHumanReport(preview, { executed: false, title: 'Work migration (preview)' });

    const plannedCount =
      preview.summary.totalCandidates - preview.summary.skippedTracked - preview.summary.conflicts;
    if (plannedCount === 0) {
      return; // Nothing left to confirm — the preview already explained why.
    }

    let proceed = yes;
    if (!proceed) {
      const { confirm } = await import('@inquirer/prompts');
      proceed = await confirm({
        message: `Move ${plannedCount} file(s) into the machine home?`,
        default: false,
      });
    }
    if (!proceed) {
      console.log('Migration cancelled.');
      return;
    }

    const result = unwrapOrThrow(
      await runWorkMigration(root.path, root.changesDir, { ...scanOptions, execute: true }),
      options.change
    );
    console.log('');
    printHumanReport(result, { executed: true, title: 'Work migration (result)' });
  } catch (error) {
    emitFailure(json, FAILURE_PAYLOAD, error, 'work_migrate_failed');
  }
}

export function registerWorkCommand(program: Command): void {
  const groupDescription =
    COMMAND_REGISTRY.find((entry) => entry.name === 'work')?.description ??
    'Machine-home work-directory maintenance';
  const workCmd = program.command('work').description(groupDescription);

  const migrateDescription =
    COMMAND_REGISTRY.find((entry) => entry.name === 'work')?.subcommands?.find(
      (entry) => entry.name === 'migrate'
    )?.description ??
    'Migrate legacy in-repo process ephemera into the machine home';

  workCmd
    .command('migrate')
    .description(migrateDescription)
    .option('--change <name>', 'Scope to one active or archived change')
    .option('--dry-run', 'Preview only; never move files')
    .option('--include-tracked', 'Also move git-tracked ephemera, leaving the deletions uncommitted')
    .option('--json', 'Output as JSON (non-interactive; requires --yes to execute)')
    .option('--yes', 'Skip the confirmation prompt (required to execute in --json mode)')
    .action(async (options: WorkMigrateOptions) => {
      await runMigrate(options);
    });
}
