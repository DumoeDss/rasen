/**
 * `rasen store target-line add|set-ref|list|show` — the consumer adapter for
 * `StoreTargetLines`.
 *
 * A target line is a stable release-line IDENTITY whose Git refs are mutable
 * locators. This command authors and re-points those locators; it never renames
 * an identity and never infers a line from a branch name. The catalog is
 * Git-tracked Store content, so every write prints a pathspec-scoped commit
 * suggestion and stages nothing.
 */
import { Command } from 'commander';

import { StoreError } from '../core/store/errors.js';
import {
  StoreTargetLinesModule,
  type TargetLineRecord,
} from '../core/store/target-lines.js';
import { asErrorMessage, printJson } from './shared-output.js';

export interface StoreTargetLineOptions {
  store?: string;
  storeRef?: string;
  project?: string;
  codeRef?: string;
  removeCodeRef?: boolean;
  json?: boolean;
}

function fail(json: boolean | undefined, error: unknown, code: string): void {
  const diagnostic =
    error instanceof StoreError
      ? error.diagnostic
      : { severity: 'error' as const, code, message: asErrorMessage(error) };
  if (json) {
    printJson({ targetLine: null, status: [diagnostic] });
  } else {
    console.error(asErrorMessage(diagnostic.message));
    if (diagnostic.fix) console.error(`  fix: ${diagnostic.fix}`);
  }
  process.exitCode = 1;
}

function recordPayload(record: TargetLineRecord): unknown {
  return {
    targetLineId: record.targetLineId,
    storeId: record.storeId,
    storeUid: record.storeUid,
    storeRef: record.storeRef,
    projects: record.projects,
    path: record.path,
    ...(record.suggestedCommits === undefined
      ? {}
      : { suggestedCommits: record.suggestedCommits }),
  };
}

function renderRecord(record: TargetLineRecord): void {
  console.log(`Target line ${record.targetLineId} (store ${record.storeId})`);
  console.log(`  store ref: ${record.storeRef}`);
  const projects = Object.entries(record.projects);
  if (projects.length === 0) {
    console.log('  no project code locators recorded');
  }
  for (const [projectId, locator] of projects) {
    console.log(`  ${projectId}: ${locator.codeRef}`);
  }
  console.log(`  catalog: ${record.path}`);
  for (const suggestion of record.suggestedCommits ?? []) {
    console.log('');
    console.log(`  ${suggestion.rationale}`);
    console.log(`    ${suggestion.command}`);
  }
}

export function registerStoreTargetLineCommand(store: Command): void {
  const targetLine = store.command('target-line').description('');

  targetLine
    .command('add <target-line-id>')
    .description('')
    .option('--store <id>', '')
    .option('--store-ref <ref>', '')
    .option('--project <id>', '')
    .option('--code-ref <ref>', '')
    .option('--json', '')
    .action(async (targetLineId: string, options: StoreTargetLineOptions) => {
      try {
        if (options.storeRef === undefined) {
          throw new StoreError(
            'Authoring a target line requires its Store ref locator; no ref is ever derived.',
            'target_line_ref_unresolved',
            { target: 'store-ref', fix: 'Add --store-ref refs/heads/<branch>.' }
          );
        }
        const record = await new StoreTargetLinesModule().add({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          targetLineId,
          storeRef: options.storeRef,
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.codeRef === undefined ? {} : { codeRef: options.codeRef }),
        });
        if (options.json) printJson(recordPayload(record));
        else renderRecord(record);
      } catch (error) {
        fail(options.json, error, 'store_target_line_add_failed');
      }
    });

  targetLine
    .command('set-ref <target-line-id>')
    .description('')
    .option('--store <id>', '')
    .option('--store-ref <ref>', '')
    .option('--project <id>', '')
    .option('--code-ref <ref>', '')
    .option('--remove-code-ref', '')
    .option('--json', '')
    .action(async (targetLineId: string, options: StoreTargetLineOptions) => {
      try {
        const record = await new StoreTargetLinesModule().setRef({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          targetLineId,
          ...(options.storeRef === undefined ? {} : { storeRef: options.storeRef }),
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.codeRef === undefined ? {} : { codeRef: options.codeRef }),
          ...(options.removeCodeRef === true ? { removeCodeRef: true } : {}),
        });
        if (options.json) printJson(recordPayload(record));
        else renderRecord(record);
      } catch (error) {
        fail(options.json, error, 'store_target_line_set_ref_failed');
      }
    });

  targetLine
    .command('list')
    .description('')
    .option('--store <id>', '')
    .option('--json', '')
    .action(async (options: StoreTargetLineOptions) => {
      try {
        const records = await new StoreTargetLinesModule().list({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
        });
        if (options.json) {
          printJson({ targetLines: records.map(recordPayload) });
          return;
        }
        if (records.length === 0) {
          console.log('No target lines are recorded in this Store.');
          return;
        }
        for (const record of records) renderRecord(record);
      } catch (error) {
        fail(options.json, error, 'store_target_line_list_failed');
      }
    });

  targetLine
    .command('show <target-line-id>')
    .description('')
    .option('--store <id>', '')
    .option('--project <id>', '')
    .option('--json', '')
    .action(async (targetLineId: string, options: StoreTargetLineOptions) => {
      try {
        const module = new StoreTargetLinesModule();
        const record = await module.show({
          ...(options.store === undefined ? {} : { store: options.store }),
          startPath: process.cwd(),
          targetLineId,
        });
        const resolved = await module
          .resolve({
            ...(options.store === undefined ? {} : { store: options.store }),
            startPath: process.cwd(),
            targetLineId,
            ...(options.project === undefined ? {} : { project: options.project }),
          })
          .catch(() => null);
        if (options.json) {
          printJson({ ...(recordPayload(record) as object), resolved });
          return;
        }
        renderRecord(record);
        if (resolved === null) {
          console.log('  resolution: unavailable (a locator names no commit in its repository)');
          return;
        }
        console.log(`  resolved store ref: ${resolved.storeRef}@${resolved.storeRefOid}`);
        if (resolved.codeRef !== undefined) {
          console.log(
            `  resolved code ref:  ${resolved.codeRef}@${resolved.codeRefOid ?? '(unresolved)'}`
          );
        }
      } catch (error) {
        fail(options.json, error, 'store_target_line_show_failed');
      }
    });
}
