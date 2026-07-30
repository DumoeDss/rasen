/**
 * `rasen work` — the legacy-state migration surface. One subcommand, `migrate`:
 * consolidates legacy machine-home state into the terminal file-placement
 * locations established by the `file-placement` capability. The direction is
 * INVERTED from the original migrator (in-repo → machine home) to the terminal
 * model (machine home → terminal locations).
 */
import { Command } from 'commander';

import { resolveRootForCommand } from '../core/root-selection.js';
import {
  runWorkMigration,
  type RunWorkMigrationResult,
  type WorkMigrationReport,
  type ChangeMigrationReport,
} from '../core/work-migration.js';
import { emitFailure, printJson } from './shared-output.js';

interface WorkMigrateOptions {
  change?: string;
  dryRun?: boolean;
  /** Explicit opt-in to delete absorbed conclusion directories (M3 fix). */
  discardAbsorbedConclusions?: boolean;
  json?: boolean;
  yes?: boolean;
}

const FAILURE_PAYLOAD = { changes: [], summary: null };

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

  throw new WorkMigrateBlockedError(
    'work_migrate_home_unresolved',
    'Could not resolve or create the machine home for this project.',
    'Run `rasen init` first, then retry `rasen work migrate`.'
  );
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
    changes: report.changes.map((c: ChangeMigrationReport) => ({
      change: c.change,
      archived: c.archived,
      changeDir: c.changeDir,
      workDir: c.workDir,
      moved: c.files
        .filter((f) => f.status === 'moved' || f.status === 'planned')
        .map((f) => f.relativePath),
      discarded: c.files
        .filter((f) => f.status === 'discarded')
        .map((f) => f.relativePath),
      conflicts: c.files
        .filter((f) => f.status === 'conflict')
        .map((f) => ({ relativePath: f.relativePath, destination: f.destination })),
      failed: c.files
        .filter((f) => f.status === 'failed')
        .map((f) => ({ relativePath: f.relativePath, error: f.error })),
      notes: c.notes,
    })),
    probeDirs: report.probeDirs.map((p) => ({
      dirName: p.dirName,
      classification: p.classification,
      action: p.action,
      destination: p.destination,
      status: p.status,
    })),
    designDocs: report.designDocs.map((d) => ({
      source: d.source,
      destination: d.destination,
      status: d.status,
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

  if (report.summary.totalCandidates === 0 && report.probeDirs.length === 0 && report.designDocs.length === 0) {
    console.log('Nothing to migrate.');
  } else {
    for (const change of report.changes) {
      if (change.files.length === 0 && change.notes.length === 0) continue;

      console.log(`${change.archived ? 'Archived' : 'Active'}: ${change.change}`);
      console.log(`  Work dir: ${change.workDir ?? '(pending — identity not minted yet)'}`);

      const toMove = change.files.filter((f) => f.status === 'moved' || f.status === 'planned');
      const discarded = change.files.filter((f) => f.status === 'discarded');
      const conflicts = change.files.filter((f) => f.status === 'conflict');
      const failed = change.files.filter((f) => f.status === 'failed');

      if (toMove.length > 0) {
        console.log(`  ${opts.executed ? 'Moved' : 'Would move'} (${toMove.length}):`);
        for (const f of toMove) {
          console.log(`    - ${f.relativePath} → ${destinationLabel(f.destination)}`);
        }
      }
      if (discarded.length > 0) {
        console.log(`  Discarded run-state (${discarded.length}):`);
        for (const f of discarded) console.log(`    - ${f.relativePath}`);
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

    if (report.probeDirs.length > 0) {
      console.log('Probe directories:');
      for (const p of report.probeDirs) {
        const status = opts.executed ? p.status : 'planned';
        console.log(`  - ${p.dirName}: ${p.classification} → ${p.action} [${status}]`);
      }
      console.log('');
    }

    if (report.designDocs.length > 0) {
      console.log('Design docs:');
      for (const d of report.designDocs) {
        const status = opts.executed ? d.status : 'planned';
        console.log(`  - ${d.source} → ${d.destination} [${status}]`);
      }
      console.log('');
    }
  }

  const s = report.summary;
  console.log(
    opts.executed
      ? `Summary: ${s.totalCandidates} candidate(s) — moved ${s.moved}, discarded ${s.discarded}, conflicts ${s.conflicts}, failed ${s.failed}.`
      : `Summary: ${s.totalCandidates} candidate(s) — would move ${s.totalCandidates - s.conflicts - s.discarded}, discard ${s.discarded}, conflicts ${s.conflicts}.`
  );

  for (const note of report.notes) {
    console.log('');
    console.log(`Note: ${note}`);
  }
}

async function runMigrate(options: WorkMigrateOptions): Promise<void> {
  const json = !!options.json;

  try {
    const root = await resolveRootForCommand(
      {},
      { json, failurePayload: FAILURE_PAYLOAD, allowImplicitRoot: false }
    );
    if (!root) return;

    const dryRun = !!options.dryRun;
    const yes = !!options.yes;
    const scanOptions = {
      discardAbsorbedConclusions: !!options.discardAbsorbedConclusions,
      ...(options.change !== undefined ? { changeName: options.change } : {}),
    };

    if (dryRun || json) {
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
      preview.summary.totalCandidates - preview.summary.conflicts - preview.summary.discarded;
    if (plannedCount === 0 && preview.probeDirs.length === 0 && preview.designDocs.length === 0) {
      return;
    }

    let proceed = yes;
    if (!proceed) {
      const { confirm } = await import('@inquirer/prompts');
      proceed = await confirm({
        message: `Migrate ${plannedCount} file(s) from the machine home to terminal locations?`,
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
  const workCmd = program.command('work').description('');

  workCmd
    .command('migrate')
    .description('')
    .option('--change <name>', '')
    .option('--dry-run', '')
    .option('--discard-absorbed-conclusions', '')
    .option('--json', '')
    .option('--yes', '')
    .action(async (options: WorkMigrateOptions) => {
      await runMigrate(options);
    });
}
