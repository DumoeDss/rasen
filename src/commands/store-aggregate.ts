/**
 * `rasen store changes` and `rasen store projects` — the consumer adapters for
 * `StoreQueryModule`.
 *
 * Both print the query's OWN grouping. `changes` renders groups keyed by
 * project and target line rather than a flat table, because a flat table is a
 * grouping the reader has to reconstruct from a path — which is the algorithm
 * layout v2 exists to delete. Neither command takes a lock, writes a file, or
 * runs a Git verb that changes anything.
 *
 * `--project`, `--target-line`, `--outcome`, and `--state` NARROW a result.
 * They are filters and never a scope: nothing here mutates, so there is nothing
 * for a filter to be mistaken for.
 */
import { Command } from 'commander';

import { StoreError } from '../core/store/errors.js';
import { StoreAggregateQuery } from '../core/store/query/index.js';
import type {
  FinalizationOutcomeName,
  GroupedChanges,
  ProjectRollup,
  TargetLineRollup,
  UnsearchedRef,
} from '../core/store/query/index.js';
import { asErrorMessage, printJson } from './shared-output.js';

export interface StoreAggregateOptions {
  store?: string;
  project?: string[];
  targetLine?: string[];
  outcome?: string[];
  state?: string;
  json?: boolean;
}

function fail(json: boolean | undefined, error: unknown, code: string): void {
  const diagnostic =
    error instanceof StoreError
      ? error.diagnostic
      : { severity: 'error' as const, code, message: asErrorMessage(error) };
  if (json) {
    printJson({ store: null, status: [diagnostic] });
  } else {
    console.error(asErrorMessage(diagnostic.message));
    if (diagnostic.fix) console.error(`  fix: ${diagnostic.fix}`);
  }
  process.exitCode = 1;
}

function renderIncomplete(refs: readonly UnsearchedRef[], complete: boolean): void {
  if (complete) return;
  console.log('');
  console.log(`  INCOMPLETE: ${refs.length} store ref(s) could not be searched`);
  for (const ref of refs) {
    console.log(`    ${ref.storeRef} (${ref.targetLineId}): ${ref.reason}`);
  }
}

function renderGroups(result: GroupedChanges): void {
  if (result.groups.length === 0) console.log('  no changes');
  for (const group of result.groups) {
    console.log(`  ${group.projectId} / ${group.targetLineId}`);
    for (const entry of group.active) {
      console.log(`    active   ${entry.changeId}  ${entry.changeInstanceId ?? '(no instance)'}`);
      if (entry.localLocator !== null) {
        console.log(`      local planning worktree (non-portable): ${entry.localLocator.root}`);
      }
    }
    for (const entry of group.archived) {
      console.log(
        `    archived ${entry.entryName}  ${
          entry.outcome ?? (entry.legacyRecord ? 'no outcome (legacy record)' : 'no outcome')
        }`
      );
    }
    if (group.active.length === 0 && group.archived.length === 0) {
      console.log('    (empty)');
    }
  }
}

function renderProjects(projects: ProjectRollup, lines: TargetLineRollup): void {
  console.log(`Store ${projects.storeId} (${projects.storeUid})`);
  console.log('  projects:');
  if (projects.projects.length === 0) console.log('    (none)');
  for (const entry of projects.projects) {
    if (entry.diagnostic !== null) {
      console.log(`    ${entry.projectId}  INVALID CATALOG: ${entry.diagnostic.message}`);
      continue;
    }
    console.log(
      `    ${entry.projectId}  lines: ${entry.targetLines.join(', ') || '(none)'}  active: ${
        entry.activeChangeCount
      }  archived: ${entry.archivedChangeCount}`
    );
  }
  console.log('  target lines:');
  if (lines.targetLines.length === 0) console.log('    (none)');
  for (const entry of lines.targetLines) {
    if (entry.diagnostic !== null) {
      console.log(`    ${entry.targetLineId}  INVALID CATALOG: ${entry.diagnostic.message}`);
      continue;
    }
    console.log(
      `    ${entry.targetLineId}  ref: ${entry.storeRef ?? '(unknown)'}  projects: ${
        entry.projects.join(', ') || '(none)'
      }  active: ${entry.activeChangeCount}  archived: ${entry.archivedChangeCount}`
    );
  }
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerStoreAggregateCommands(store: Command): void {
  store
    .command('changes')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '', collect, [])
    .option('--target-line <id>', '', collect, [])
    .option('--outcome <outcome>', '', collect, [])
    .option('--state <state>', '')
    .option('--json', '')
    .action(async (options: StoreAggregateOptions) => {
      try {
        const result = await StoreAggregateQuery.listChanges({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          ...((options.project ?? []).length === 0 ? {} : { projects: options.project }),
          ...((options.targetLine ?? []).length === 0
            ? {}
            : { targetLines: options.targetLine }),
          ...((options.outcome ?? []).length === 0
            ? {}
            : { outcomes: options.outcome as FinalizationOutcomeName[] }),
          ...(options.state === undefined
            ? {}
            : { state: options.state as 'active' | 'archived' }),
        });
        if (options.json) printJson(result);
        else {
          renderGroups(result);
          renderIncomplete(result.unsearchedRefs, result.complete);
        }
      } catch (error) {
        fail(options.json, error, 'store_changes_failed');
      }
    });

  store
    .command('projects')
    .description('')
    .option('--store <id>', '')
    .option('--json', '')
    .action(async (options: StoreAggregateOptions) => {
      try {
        const scope = {
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
        };
        const projects = await StoreAggregateQuery.listProjects(scope);
        const lines = await StoreAggregateQuery.listTargetLines(scope);
        if (options.json) {
          printJson({
            storeId: projects.storeId,
            storeUid: projects.storeUid,
            projects: projects.projects,
            targetLines: lines.targetLines,
            unsearchedRefs: projects.unsearchedRefs,
            complete: projects.complete && lines.complete,
          });
          return;
        }
        renderProjects(projects, lines);
        renderIncomplete(projects.unsearchedRefs, projects.complete && lines.complete);
      } catch (error) {
        fail(options.json, error, 'store_projects_failed');
      }
    });
}
