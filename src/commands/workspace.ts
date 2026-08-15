/**
 * `rasen store workspace plan|apply|show|cleanup` — the consumer adapter for
 * `StoreWorkspaceModule`.
 *
 * A WORKSPACE here is the bound Store-planning / project-execution worktree
 * PAIR. It is unrelated to `rasen workset`, which is a personal editor view of
 * folders; the two names are one letter apart and mean different things, so
 * both command groups say so in their first description sentence.
 *
 * The group is a SUBCOMMAND of `store`, not a top-level one. `workspace` is a
 * retired top-level name that `test/commands/legacy-groups-removed.test.ts`
 * keeps dead, and re-issuing it for an unrelated concept would hand anyone with
 * the old muscle memory something semantically different. A workspace pair is a
 * Store concept in any case — a standalone project has no planning/execution
 * pair — so it belongs beside `store adopt`, `store eject`, and
 * `store migrate-layout`.
 *
 * This file formats and holds no resolution logic. The plan preview is the full
 * action and precondition table, and the JSON form carries the same content as
 * the human form. Nothing here stages, commits, fetches, or pushes.
 */
import { Command } from 'commander';

import { StoreError } from '../core/store/errors.js';
import {
  StoreWorkspace,
  reportsNoPreparedWorkspace,
  type CleanupResult,
  type ImmutableCleanupPlan,
  type ImmutableWorkspacePlan,
  type PreparedChangeWorkspace,
  type WorkspaceDescription,
} from '../core/store/workspace/index.js';
import { asErrorMessage, printJson } from './shared-output.js';

export interface WorkspaceCommandOptions {
  store?: string;
  project?: string;
  targetLine?: string;
  change?: string;
  planningWorktree?: string;
  executionWorktree?: string;
  existingChange?: boolean;
  includeUntracked?: boolean;
  applyPlan?: string;
  json?: boolean;
}

function fail(json: boolean | undefined, error: unknown, code: string): void {
  const diagnostic =
    error instanceof StoreError
      ? error.diagnostic
      : { severity: 'error' as const, code, message: asErrorMessage(error) };
  if (json) {
    printJson({ workspace: null, status: [diagnostic] });
  } else {
    console.error(asErrorMessage(diagnostic.message));
    if (diagnostic.fix) console.error(`  fix: ${diagnostic.fix}`);
  }
  process.exitCode = 1;
}

function requireChange(options: WorkspaceCommandOptions): string {
  if (options.change === undefined || options.change.length === 0) {
    throw new StoreError(
      'A workspace is prepared for exactly one Change alias.',
      'workspace_plan_not_applicable',
      { target: 'selection.change', fix: 'Add --change <change-id>.' }
    );
  }
  return options.change;
}

function planPayload(plan: ImmutableWorkspacePlan): unknown {
  return {
    planId: plan.planId,
    intent: plan.intent,
    applicable: plan.applicable,
    changeId: plan.changeId,
    // Present only under `intent: 'existing-change'`, where it is the identity
    // the plan VERIFIED rather than one it will mint. An agent reading the
    // preview needs to see which instance it is about to bind.
    ...(plan.changeInstanceId === undefined
      ? {}
      : { changeInstanceId: plan.changeInstanceId }),
    scope: plan.scope,
    targetLine: plan.targetLine,
    planning: plan.planning,
    execution: plan.execution,
    actions: plan.actions,
    preconditions: plan.preconditions,
    blockers: plan.blockers,
    token: plan.token,
  };
}

function renderPlan(plan: ImmutableWorkspacePlan): void {
  console.log(
    `Workspace plan for Change ${plan.changeId} — project ${plan.scope.projectId} on target line ${plan.scope.targetLineId}`
  );
  console.log(`  plan id: ${plan.planId}`);
  console.log(`  intent:  ${plan.intent}`);
  if (plan.changeInstanceId !== undefined) {
    console.log(`  instance: ${plan.changeInstanceId}`);
  }
  console.log(
    `  target line: ${plan.targetLine.storeRef}@${plan.targetLine.storeRefOid}${
      plan.targetLine.codeRef === undefined
        ? ''
        : ` / ${plan.targetLine.codeRef}@${plan.targetLine.codeRefOid ?? '(unresolved)'}`
    }`
  );
  console.log('');
  console.log('  Actions');
  for (const action of plan.actions) {
    console.log(`    ${action.kind}`);
    console.log(`        destination: ${action.destination}`);
    if (action.ref !== undefined) console.log(`        ref:         ${action.ref}`);
    if (action.fromOid !== undefined) {
      console.log(`        from commit: ${action.fromOid}`);
    }
    if (action.createsBranch === true) console.log('        creates the branch');
    if (action.digest !== undefined) console.log(`        digest:      ${action.digest}`);
    console.log(`        satisfied:   ${action.alreadySatisfied ? 'yes' : 'no'}`);
  }
  console.log('');
  console.log('  Preconditions');
  for (const entry of plan.preconditions) {
    console.log(`    [${entry.satisfied ? 'ok' : 'unsatisfied'}] ${entry.id}`);
    console.log(`        ${entry.detail}`);
    if (entry.expected !== undefined || entry.actual !== undefined) {
      console.log(
        `        expected: ${entry.expected ?? '(none)'}  actual: ${entry.actual ?? '(none)'}`
      );
    }
    if (entry.code !== undefined) console.log(`        code: ${entry.code}`);
  }
  console.log('');
  console.log(
    plan.applicable
      ? `  Ready to apply. Run: rasen store workspace apply --apply-plan ${plan.planId}`
      : `  Not applicable: ${plan.blockers.length} unsatisfied precondition(s). There is no --force; correct the disagreement or prepare a new pair.`
  );
  console.log('  Preparation adds worktrees. It never moves a ref, a HEAD, or a working tree.');
}

function renderPrepared(result: PreparedChangeWorkspace): void {
  console.log(`Workspace prepared for Change ${result.changeId} — ${result.bindingState}`);
  console.log(`  planning:  ${result.planning.root}`);
  console.log(`  execution: ${result.execution.root}`);
  for (const root of result.created) console.log(`  created:   ${root}`);
  for (const root of result.reused) console.log(`  reused:    ${root}`);
  if (result.workspacePairId) console.log(`  pair:      ${result.workspacePairId}`);
  console.log(
    '  Nothing was staged or committed in either repository; the marker and the association are machine-local run state.'
  );
}

function describePayload(description: WorkspaceDescription): unknown {
  return {
    bindingState: description.bindingState,
    prepared: description.prepared,
    scope: description.scope,
    targetLine: description.targetLine,
    changeId: description.changeId,
    changeInstanceId: description.changeInstanceId,
    workspacePairId: description.workspacePairId,
    planning: description.planning,
    execution: description.execution,
    findings: description.findings,
  };
}

function renderDescription(description: WorkspaceDescription): void {
  console.log(`Workspace — ${description.bindingState}`);
  // Same rule as `rasen context`: the sentence repeats what the Module said,
  // rather than being re-derived from `prepared === false`, which is also false
  // when several pairs exist and no `--change` names one.
  if (reportsNoPreparedWorkspace(description.findings)) {
    console.log(
      `  No workspace is prepared for project ${description.scope?.projectId ?? '(unknown)'} on target line ${description.scope?.targetLineId ?? '(unknown)'}.`
    );
  }
  if (description.changeId) console.log(`  change:    ${description.changeId}`);
  if (description.changeInstanceId) {
    console.log(`  instance:  ${description.changeInstanceId}`);
  }
  if (description.workspacePairId) console.log(`  pair:      ${description.workspacePairId}`);
  for (const [label, side] of [
    ['planning', description.planning],
    ['execution', description.execution],
  ] as const) {
    if (side === undefined) continue;
    console.log(`  ${label}:  ${side.root}${side.exists ? '' : ' (missing)'}`);
    if (side.worktreeInstanceId) console.log(`      instance: ${side.worktreeInstanceId}`);
    if (side.ref) console.log(`      ref:      ${side.ref}`);
    if (side.headOid) console.log(`      head:     ${side.headOid}`);
  }
  for (const finding of description.findings) {
    console.log(`  ${finding.severity}: ${finding.message}`);
    if (finding.expected !== undefined || finding.actual !== undefined) {
      console.log(
        `      expected: ${finding.expected ?? '(none)'}  actual: ${finding.actual ?? '(none)'}`
      );
    }
  }
}

function cleanupPayload(plan: ImmutableCleanupPlan): unknown {
  return {
    planId: plan.planId,
    applicable: plan.applicable,
    changeId: plan.changeId,
    scope: plan.scope,
    includeUntracked: plan.includeUntracked,
    targets: plan.targets,
    blockers: plan.blockers,
    token: plan.token,
  };
}

function renderCleanupPlan(plan: ImmutableCleanupPlan): void {
  console.log(`Cleanup plan for Change ${plan.changeId}`);
  console.log(`  plan id: ${plan.planId}`);
  for (const target of plan.targets) {
    console.log('');
    console.log(`  ${target.side}: ${target.root} (${target.ref})`);
    for (const entry of target.preconditions) {
      console.log(`    [${entry.satisfied ? 'ok' : 'unsatisfied'}] ${entry.id}`);
      console.log(`        ${entry.detail}`);
      if (entry.expected !== undefined || entry.actual !== undefined) {
        console.log(
          `        expected: ${entry.expected ?? '(none)'}  actual: ${entry.actual ?? '(none)'}`
        );
      }
    }
    if (target.untracked.length > 0) {
      console.log(`        untracked: ${target.untracked.join(', ')}`);
    }
  }
  console.log('');
  console.log(
    plan.applicable
      ? `  Safe to remove. Run: rasen store workspace cleanup --apply-plan ${plan.planId}`
      : `  Refused: ${plan.blockers.length} unsatisfied precondition(s). There is no --force and no partial removal.`
  );
}

function renderCleanupResult(result: CleanupResult): void {
  console.log(`Cleanup ${result.phase} for Change ${result.changeId}`);
  for (const root of result.removed) console.log(`  removed: ${root}`);
  console.log(`  index entry removed: ${result.indexEntryRemoved ? 'yes' : 'no'}`);
  console.log('  No branch, ref, Change directory, Archive, or other pair was touched.');
}

export function registerWorkspaceCommand(store: Command): void {
  const workspace = store.command('workspace').description('');

  workspace
    .command('plan')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--target-line <id>', '')
    .option('--change <change-id>', '')
    .option('--planning-worktree <path>', '')
    .option('--execution-worktree <path>', '')
    .option('--existing-change', '')
    .option('--json', '')
    .action(async (options: WorkspaceCommandOptions) => {
      try {
        const plan = await new StoreWorkspace().plan({
          ...(options.store === undefined ? {} : { store: options.store }),
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.targetLine === undefined ? {} : { targetLine: options.targetLine }),
          changeId: requireChange(options),
          ...(options.planningWorktree === undefined
            ? {}
            : { planningWorktree: options.planningWorktree }),
          ...(options.executionWorktree === undefined
            ? {}
            : { executionWorktree: options.executionWorktree }),
          ...(options.existingChange === true ? { intent: 'existing-change' as const } : {}),
          startPath: process.cwd(),
        });
        if (options.json) printJson(planPayload(plan));
        else renderPlan(plan);
        if (!plan.applicable) process.exitCode = 1;
      } catch (error) {
        fail(options.json, error, 'workspace_plan_failed');
      }
    });

  workspace
    .command('apply')
    .description('')
    .option('--apply-plan <plan-id>', '')
    .option('--json', '')
    .action(async (options: WorkspaceCommandOptions) => {
      try {
        if (options.applyPlan === undefined) {
          throw new StoreError(
            'Applying a workspace consumes a plan id, so that the applied result is the one the plan froze.',
            'workspace_plan_missing',
            {
              target: 'apply-plan',
              fix: 'Run `rasen store workspace plan` and pass --apply-plan <plan-id>.',
            }
          );
        }
        const result = await new StoreWorkspace().applyStoredPlan(options.applyPlan);
        if (options.json) printJson(result);
        else renderPrepared(result);
      } catch (error) {
        fail(options.json, error, 'workspace_apply_failed');
      }
    });

  workspace
    .command('show')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--target-line <id>', '')
    .option('--change <change-id>', '')
    .option('--json', '')
    .action(async (options: WorkspaceCommandOptions) => {
      try {
        const description = await new StoreWorkspace().describe({
          ...(options.store === undefined ? {} : { store: options.store }),
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.targetLine === undefined ? {} : { targetLine: options.targetLine }),
          ...(options.change === undefined ? {} : { changeId: options.change }),
          startPath: process.cwd(),
        });
        if (options.json) printJson(describePayload(description));
        else renderDescription(description);
      } catch (error) {
        fail(options.json, error, 'workspace_show_failed');
      }
    });

  workspace
    .command('cleanup')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--target-line <id>', '')
    .option('--change <change-id>', '')
    .option('--include-untracked', '')
    .option('--apply-plan <plan-id>', '')
    .option('--json', '')
    .action(async (options: WorkspaceCommandOptions) => {
      try {
        const module = new StoreWorkspace();
        if (options.applyPlan !== undefined) {
          const result = await module.applyStoredCleanupPlan(options.applyPlan);
          if (options.json) printJson(result);
          else renderCleanupResult(result);
          return;
        }
        const plan = await module.planCleanup({
          ...(options.store === undefined ? {} : { store: options.store }),
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.targetLine === undefined ? {} : { targetLine: options.targetLine }),
          changeId: requireChange(options),
          ...(options.includeUntracked === true ? { includeUntracked: true } : {}),
          startPath: process.cwd(),
        });
        if (options.json) printJson(cleanupPayload(plan));
        else renderCleanupPlan(plan);
        if (!plan.applicable) process.exitCode = 1;
      } catch (error) {
        fail(options.json, error, 'workspace_cleanup_failed');
      }
    });
}
