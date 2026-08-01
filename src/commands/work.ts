/**
 * `rasen work` — the legacy-state migration surface. One subcommand, `migrate`:
 * consolidates legacy machine-home state into the terminal file-placement
 * locations established by the `file-placement` capability. The direction is
 * INVERTED from the original migrator (in-repo → machine home) to the terminal
 * model (machine home → terminal locations).
 */
import { Command } from 'commander';

import {
  resolveRootForCommand,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import { resolveExecutionRoot } from '../core/file-placement.js';
import { NATIVE_PATH_IDENTITY_FLAVOR } from '../core/path-identity.js';
import {
  applyWorkMigration,
  freezeWorkMigrationRootContext,
  planWorkMigration,
  projectWorkMigrationReport,
  type PlanWorkMigrationOptions,
  type WorkMigrationApplyResult,
  type WorkMigrationPlan,
  type WorkMigrationReport,
  type WorkMigrationRootContext,
  type ChangeMigrationReport,
} from '../core/work-migration.js';
import { emitFailure, printJson } from './shared-output.js';

export interface WorkMigrateOptions {
  change?: string;
  dryRun?: boolean;
  /** Explicit opt-in to delete absorbed conclusion directories (M3 fix). */
  discardAbsorbedConclusions?: boolean;
  json?: boolean;
  yes?: boolean;
  store?: string;
  project?: string;
}

const FAILURE_PAYLOAD = { changes: [], summary: null };

type WorkMigrationPlanner = (
  rootContext: WorkMigrationRootContext,
  options: PlanWorkMigrationOptions
) => Promise<WorkMigrationPlan>;

type WorkMigrationApply = (
  plan: WorkMigrationPlan
) => Promise<WorkMigrationApplyResult>;

type WorkMigrationConfirm = (input: {
  message: string;
  default: boolean;
}) => Promise<boolean>;

/**
 * Narrow command-runtime seam. Production uses the real root resolver,
 * planner, apply engine, and prompt; focused in-process command tests can wrap
 * those same functions to observe the preview/confirmation/apply handoff.
 */
export interface WorkMigrateCommandDependencies {
  rootResolver?: typeof resolveRootForCommand;
  planner?: WorkMigrationPlanner;
  apply?: WorkMigrationApply;
  confirm?: WorkMigrationConfirm;
}

class WorkMigrateBlockedError extends Error {
  readonly diagnostic: { severity: 'error'; code: string; message: string; fix?: string };

  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = 'WorkMigrateBlockedError';
    this.diagnostic = { severity: 'error', code, message, ...(fix ? { fix } : {}) };
  }
}

function assertRequestedChangeExists(plan: WorkMigrationPlan, changeName?: string): void {
  if (changeName !== undefined && plan.discoveredChanges.length === 0) {
    throw new WorkMigrateBlockedError(
      'work_migrate_change_not_found',
      `No active or archived change matching '${changeName}' was found.`
    );
  }
}

/**
 * Freeze the root resolver's answer into migration's full owner context.
 * Only a Store planning root diverges: `--project` selects that project as
 * planning, execution, and legacy-home owner.
 */
export function workMigrationRootContext(
  root: ResolvedOpenSpecRoot,
  cwd = process.cwd()
): WorkMigrationRootContext {
  const storePlanning = root.storeId !== undefined && (root.storeType ?? 'store') === 'store';
  const executionRoot = storePlanning
    ? resolveExecutionRoot(root.path, { cwd, storeSelected: true })
    : root.path;
  return freezeWorkMigrationRootContext({
    planningRoot: root.path,
    changesDir: root.changesDir,
    executionRoot,
    legacyHomeOwnerRoot: executionRoot,
    pathIdentityFlavor: NATIVE_PATH_IDENTITY_FLAVOR,
  });
}

/**
 * Apply the exact plan object that produced the preview. The injectable apply
 * seam lets focused tests prove that cwd/filesystem changes cannot trigger a
 * replan or retarget the operation.
 */
export async function applyPlannedWorkMigration(
  plan: WorkMigrationPlan,
  apply: WorkMigrationApply = applyWorkMigration
): Promise<WorkMigrationReport> {
  const result = await apply(plan);
  return projectWorkMigrationReport(plan, result);
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
    blockers: report.blockers.map(blocker => ({
      phase: blocker.phase,
      operation: blocker.operation,
      path: blocker.path,
      ...(blocker.code ? { code: blocker.code } : {}),
      message: blocker.message,
    })),
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

  if (report.blockers.length > 0) {
    console.log('');
    console.log('Planning blockers:');
    for (const blocker of report.blockers) {
      const code = blocker.code ? ` [${blocker.code}]` : '';
      console.log(
        `  - ${blocker.operation} ${blocker.path}${code}: ${blocker.message}`
      );
    }
  }
}

function incompletePlanError(report: WorkMigrationReport): WorkMigrateBlockedError {
  const count = report.blockers.length;
  return new WorkMigrateBlockedError(
    'work_migrate_plan_incomplete',
    `Migration apply was blocked because planning reported ${count} filesystem ${count === 1 ? 'error' : 'errors'}.`,
    'Resolve the listed planning blockers, then rerun `rasen work migrate`.'
  );
}

export async function runWorkMigrateCommand(
  options: WorkMigrateOptions,
  dependencies: WorkMigrateCommandDependencies = {}
): Promise<void> {
  const json = !!options.json;
  const rootResolver = dependencies.rootResolver ?? resolveRootForCommand;
  const planner = dependencies.planner ?? planWorkMigration;
  const apply = dependencies.apply ?? applyWorkMigration;

  try {
    const root = await rootResolver(
      {
        ...(options.store !== undefined ? { store: options.store } : {}),
        ...(options.project !== undefined ? { project: options.project } : {}),
      },
      { json, failurePayload: FAILURE_PAYLOAD, allowImplicitRoot: false }
    );
    if (!root) return;
    const rootContext = workMigrationRootContext(root);

    const dryRun = !!options.dryRun;
    const yes = !!options.yes;
    const scanOptions = {
      discardAbsorbedConclusions: !!options.discardAbsorbedConclusions,
      ...(options.change !== undefined ? { changeName: options.change } : {}),
    };
    const plan = await planner(rootContext, scanOptions);
    assertRequestedChangeExists(plan, options.change);
    const preview = projectWorkMigrationReport(plan, null);
    const applyRequested = !dryRun && yes;

    if (dryRun || json) {
      if (applyRequested && !plan.complete) {
        emitFailure(
          json,
          toJsonPayload(preview, { executed: false, dryRun }),
          incompletePlanError(preview),
          'work_migrate_plan_incomplete'
        );
        return;
      }
      const execute = applyRequested;
      const report = execute
        ? await applyPlannedWorkMigration(plan, apply)
        : preview;
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
    printHumanReport(preview, { executed: false, title: 'Work migration (preview)' });

    const plannedCount =
      preview.summary.totalCandidates - preview.summary.conflicts - preview.summary.discarded;
    if (!plan.complete) {
      if (yes) {
        emitFailure(
          false,
          FAILURE_PAYLOAD,
          incompletePlanError(preview),
          'work_migrate_plan_incomplete'
        );
      }
      return;
    }
    if (plan.actions.length === 0) {
      return;
    }

    let proceed = yes;
    if (!proceed) {
      const confirm =
        dependencies.confirm ??
        (async input => {
          const prompt = await import('@inquirer/prompts');
          return prompt.confirm(input);
        });
      proceed = await confirm({
        message: `Migrate ${plannedCount} file(s) from the machine home to terminal locations?`,
        default: false,
      });
    }
    if (!proceed) {
      console.log('Migration cancelled.');
      return;
    }

    const result = await applyPlannedWorkMigration(plan, apply);
    console.log('');
    printHumanReport(result, { executed: true, title: 'Work migration (result)' });
  } catch (error) {
    emitFailure(json, FAILURE_PAYLOAD, error, 'work_migrate_failed');
  }
}

export function registerWorkCommand(
  program: Command,
  dependencies: WorkMigrateCommandDependencies = {}
): void {
  const workCmd = program.command('work').description('');

  workCmd
    .command('migrate')
    .description('')
    .option('--change <name>', '')
    .option('--dry-run', '')
    .option('--discard-absorbed-conclusions', '')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--json', '')
    .option('--yes', '')
    .action(async (options: WorkMigrateOptions) => {
      await runWorkMigrateCommand(options, dependencies);
    });
}
