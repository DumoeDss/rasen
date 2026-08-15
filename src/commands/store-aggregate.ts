/**
 * `rasen store changes` and `rasen store projects` — the CLI for the Store
 * aggregate query surface: Changes grouped by (project, target line), and the
 * per-project rollup. Every method reads; none takes a lock and none can
 * refuse for one bad item — an unreadable ref lowers `complete` and is
 * reported in `unsearchedRefs`, never silently dropped.
 *
 * There is deliberately no `rasen store aggregate` group: the accepted
 * design's grouped-Changes and project-rollup reads are two independent
 * top-level commands, not subcommands of a shared noun.
 */
import { Command } from 'commander';

import type {
  AggregateProblem,
  GroupedChanges,
  ProjectRollup,
} from '../core/store/query/index.js';
import { StoreAggregateQuery } from '../core/store/query/index.js';
import { emitFailure, printJson } from './shared-output.js';

export interface StoreAggregateOptions {
  store?: string;
  project?: readonly string[];
  targetLine?: readonly string[];
  json?: boolean;
}

/** Commander's collect pattern: repeatable `--project`/`--target-line` flags. */
function collect(value: string, previous: readonly string[]): string[] {
  return [...previous, value];
}

/**
 * The items that were read and could not be understood, in the HUMAN form.
 *
 * A problem the JSON form carries and the human form does not would be a fact
 * available to a program and hidden from a person — the exact asymmetry "both
 * forms agree" forbids. Each line names the item, where it was read from, and
 * why, because "one Change is unreadable" without the why is not a report.
 */
function renderProblems(problems: readonly AggregateProblem[]): void {
  if (problems.length === 0) return;
  console.log('');
  console.log(`UNREADABLE: ${problems.length} item(s) were found and could not be read.`);
  for (const problem of problems) {
    console.log(
      `  ${problem.kind} ${problem.itemId} (${problem.storeRef ?? '(local checkout)'}: ${
        problem.path
      }): ${problem.reason}`
    );
  }
}

function renderGroupedChanges(result: GroupedChanges): void {
  if (result.groups.length === 0) {
    console.log('No Changes found.');
  }
  for (const group of result.groups) {
    console.log(`${group.projectId} / ${group.targetLineId}`);
    if (group.active.length === 0 && group.archived.length === 0) {
      // A declared pair that holds nothing is PRESENT and empty. Printing the
      // header alone would leave a reader unable to tell it apart from a group
      // whose entries the renderer dropped.
      console.log('  (no Changes)');
    }
    for (const entry of group.active) {
      console.log(`  ${entry.changeId}  (active, ${entry.foundAtRef})`);
    }
    for (const entry of group.archived) {
      const outcome = entry.legacyRecord ? '(legacy record)' : entry.outcome ?? '(unknown outcome)';
      console.log(`  ${entry.changeId}  (archived ${entry.archiveDate ?? '(no date)'}, ${outcome})`);
    }
  }
  if (result.unsearchedRefs.length > 0) {
    console.log('');
    console.log(`INCOMPLETE: ${result.unsearchedRefs.length} ref(s) could not be read.`);
    for (const ref of result.unsearchedRefs) {
      console.log(`  ${ref.targetLineId} (${ref.storeRef}): ${ref.reason}`);
    }
  }
  renderProblems(result.problems);
}

function renderProjectRollup(result: ProjectRollup): void {
  console.log(`Store ${result.storeId} (${result.storeUid})`);
  if (result.projects.length === 0) {
    console.log('  no projects recorded');
  }
  for (const entry of result.projects) {
    if (entry.diagnostic) {
      console.log(`  ${entry.projectId}: (unreadable — ${entry.diagnostic.message})`);
      continue;
    }
    const roles = entry.roles
      ? [entry.roles.planning ? 'planning' : null, entry.roles.knowledge ? 'knowledge' : null]
          .filter((role): role is string => role !== null)
          .join(', ') || '(no roles)'
      : '(unknown roles)';
    console.log(
      `  ${entry.projectId}: ${roles}; ${entry.activeChangeCount} active, ${entry.archivedChangeCount} archived; lines: ${
        entry.targetLines.join(', ') || '(none)'
      }`
    );
  }
  if (result.unsearchedRefs.length > 0) {
    console.log('');
    console.log(`INCOMPLETE: ${result.unsearchedRefs.length} ref(s) could not be read.`);
  }
  renderProblems(result.problems);
}

export function registerStoreAggregateCommand(store: Command): void {
  store
    .command('changes')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '', collect, [] as string[])
    .option('--target-line <id>', '', collect, [] as string[])
    .option('--json', '')
    .action(async (options: StoreAggregateOptions) => {
      try {
        const result = await StoreAggregateQuery.listChanges({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          ...(options.project && options.project.length > 0 ? { projects: options.project } : {}),
          ...(options.targetLine && options.targetLine.length > 0
            ? { targetLines: options.targetLine }
            : {}),
        });
        if (options.json) {
          printJson({
            groups: result.groups,
            complete: result.complete,
            unsearchedRefs: result.unsearchedRefs,
            problems: result.problems,
          });
          return;
        }
        renderGroupedChanges(result);
      } catch (error) {
        emitFailure(options.json, { groups: [] }, error, 'store_changes_failed');
      }
    });

  store
    .command('projects')
    .description('')
    .option('--store <id>', '')
    .option('--json', '')
    .action(async (options: StoreAggregateOptions) => {
      try {
        const result = await StoreAggregateQuery.listProjects({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
        });
        if (options.json) {
          printJson({
            storeId: result.storeId,
            storeUid: result.storeUid,
            projects: result.projects,
            complete: result.complete,
            unsearchedRefs: result.unsearchedRefs,
            problems: result.problems,
          });
          return;
        }
        renderProjectRollup(result);
      } catch (error) {
        emitFailure(options.json, { projects: [] }, error, 'store_projects_failed');
      }
    });
}
