/**
 * CLI handlers for the store-migration commands (change
 * `store-migration-commands`): `store adopt`, `store eject`,
 * `archive relocate`, and `home prune`. Each resolves its arguments, calls the
 * migration-ops layer, and renders human or `--json` output. Every mutation is
 * copy → verify → delete in the ops layer; these handlers never touch git.
 */
import { Command } from 'commander';

import { asErrorMessage, printJson } from './shared-output.js';
import { StoreError } from '../core/store/index.js';
import {
  adoptProject,
  ejectProject,
  relocateArchive,
  homePrune,
  type AdoptResult,
  type EjectResult,
  type RelocateResult,
  type HomePruneResult,
  type ArchiveMode,
  type RelocateTarget,
} from '../core/store/migration-ops.js';
import { isInteractive } from '../utils/interactive.js';
import { findRepoPlanningRootSync } from '../core/planning-home.js';

interface AdoptOptions {
  to?: string;
  archive?: string;
  dryRun?: boolean;
  json?: boolean;
  verifyHash?: boolean;
}

interface EjectOptions {
  from?: string;
  all?: boolean;
  force?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
  verifyHash?: boolean;
  into?: string;
}

interface RelocateOptions {
  to?: string;
  dryRun?: boolean;
  json?: boolean;
  verifyHash?: boolean;
}

interface HomePruneOptions {
  apply?: boolean;
  json?: boolean;
}

function failJson(error: unknown, code: string): void {
  const diagnostic =
    error instanceof StoreError
      ? error.diagnostic
      : { severity: 'error' as const, code, message: asErrorMessage(error) };
  printJson({ status: [diagnostic] });
  process.exitCode = 1;
}

function reportSuggestedCommits(commits: AdoptResult['suggestedCommits']): void {
  if (commits.length === 0) return;
  console.log('');
  console.log('Suggested commits (not executed — Rasen never writes your git index):');
  for (const commit of commits) {
    console.log(`  # ${commit.purpose}`);
    console.log(`  ${commit.command}`);
  }
}

// -----------------------------------------------------------------------------
// store adopt
// -----------------------------------------------------------------------------

export async function runAdopt(sourcePath: string | undefined, options: AdoptOptions): Promise<void> {
  try {
    if (!options.to) {
      throw new StoreError('Pass --to <store-id> naming the target store.', 'adopt_to_required', {
        target: 'store.id',
        fix: 'rasen store adopt [path] --to <store-id>',
      });
    }
    const archiveMode = (options.archive ?? 'move') as ArchiveMode;
    if (!['move', 'leave', 'external'].includes(archiveMode)) {
      throw new StoreError(
        `Invalid --archive value '${options.archive}'.`,
        'adopt_invalid_archive',
        { target: 'archive.destination', fix: 'Use --archive move|leave|external.' }
      );
    }

    // Resolve the source root: an explicit path when given, else the nearest
    // enclosing planning root (finding #7 — run from a subdirectory resolves
    // upward instead of failing the planning-shape precheck).
    const resolvedSource =
      sourcePath ?? findRepoPlanningRootSync(process.cwd()) ?? process.cwd();
    const result = await adoptProject({
      sourcePath: resolvedSource,
      storeId: options.to,
      archive: archiveMode,
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.verifyHash ? { verifyHash: true } : {}),
    });

    if (options.json) {
      printJson(toAdoptJson(result));
      return;
    }
    printAdoptHuman(result);
  } catch (error) {
    if (options.json) {
      failJson(error, 'adopt_error');
      return;
    }
    throw error;
  }
}

function toAdoptJson(result: AdoptResult) {
  return {
    adopt: {
      project_id: result.projectId,
      store: result.storeId,
      store_root: result.storeRoot,
      source: result.sourcePath,
      specs: result.specs,
      changes: result.changes,
      archive_mode: result.archiveMode,
      archive_moves: result.archiveMoves.map((m) => ({ name: m.name, source: m.source, target: m.target })),
      uncommitted: result.uncommitted,
      suggested_commits: result.suggestedCommits,
      dry_run: result.dryRun,
      resumed: result.resumed,
    },
    status: [],
  };
}

function printAdoptHuman(result: AdoptResult): void {
  const verb = result.dryRun ? 'Would adopt' : result.resumed ? 'Resumed adopt of' : 'Adopted';
  console.log(`${verb} ${result.sourcePath} into store '${result.storeId}'.`);
  console.log(`  Specs:   ${result.specs.length > 0 ? result.specs.join(', ') : '(none)'}`);
  console.log(`  Changes: ${result.changes.length > 0 ? result.changes.join(', ') : '(none)'}`);
  console.log(`  Archive: ${result.archiveMode} (${result.archiveMoves.length} entr${result.archiveMoves.length === 1 ? 'y' : 'ies'})`);
  if (result.uncommitted.length > 0) {
    console.log('');
    console.log('Uncommitted files inside the moved paths (they move too, and become untracked in the store):');
    for (const file of result.uncommitted) {
      console.log(`  - ${file}`);
    }
  }
  if (result.dryRun) {
    console.log('');
    console.log('Dry run: nothing was moved and no config changed.');
    return;
  }
  console.log('');
  console.log(`The repo now resolves to store '${result.storeId}' (mode: store).`);
  reportSuggestedCommits(result.suggestedCommits);
}

// -----------------------------------------------------------------------------
// store eject
// -----------------------------------------------------------------------------

export async function runEject(projectId: string | undefined, options: EjectOptions): Promise<void> {
  try {
    if (!projectId) {
      throw new StoreError('Pass the project id to eject.', 'eject_project_required', {
        target: 'store.id',
        fix: 'rasen store eject <project-id> --from <store-id>',
      });
    }
    if (!options.from) {
      throw new StoreError('Pass --from <store-id> naming the source store.', 'eject_from_required', {
        target: 'store.id',
        fix: 'rasen store eject <project-id> --from <store-id>',
      });
    }

    // Manifest-less `--all` copies the store's ENTIRE planning content back and
    // requires explicit consent (spec store-eject). An inert dry-run preview
    // first reveals whether this is actually the manifest-less path (`usedAll`)
    // — only then is consent required. In interactive human mode that is a
    // confirmation prompt; in every non-interactive mode (including `--json`,
    // finding #3) `--yes` is the explicit consent and its absence hard-fails.
    if (options.all && !options.dryRun) {
      const preview = await ejectProject({
        projectId,
        storeId: options.from,
        all: true,
        ...(options.force ? { force: true } : {}),
        ...(options.into ? { destinationPath: options.into } : {}),
        dryRun: true,
      });
      if (preview.usedAll && !options.yes) {
        if (isInteractive() && !options.json) {
          console.log(`--all will copy the store's entire planning content back to ${preview.destinationPath}:`);
          console.log(`  Specs:   ${preview.specs.join(', ') || '(none)'}`);
          console.log(`  Changes: ${preview.changes.join(', ') || '(none)'}`);
          const { confirm } = await import('@inquirer/prompts');
          const proceed = await confirm({ message: 'Proceed with the full copy back?', default: false });
          if (!proceed) {
            console.log('Eject cancelled.');
            return;
          }
        } else {
          throw new StoreError(
            "Manifest-less '--all' eject needs explicit consent: pass --yes (or run interactively, or preview with --dry-run).",
            'eject_all_confirmation_required',
            { target: 'store.root', fix: `rasen store eject ${projectId} --from ${options.from} --all --yes` }
          );
        }
      }
    }

    const result = await ejectProject({
      projectId,
      storeId: options.from,
      ...(options.all ? { all: true } : {}),
      ...(options.force ? { force: true } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.verifyHash ? { verifyHash: true } : {}),
      ...(options.into ? { destinationPath: options.into } : {}),
    });

    if (options.json) {
      printJson(toEjectJson(result));
      return;
    }
    printEjectHuman(result);
  } catch (error) {
    if (options.json) {
      failJson(error, 'eject_error');
      return;
    }
    throw error;
  }
}

function toEjectJson(result: EjectResult) {
  return {
    eject: {
      project_id: result.projectId,
      store: result.storeId,
      store_root: result.storeRoot,
      destination: result.destinationPath,
      specs: result.specs,
      changes: result.changes,
      missing: result.missing,
      collisions: result.collisions,
      suggested_commits: result.suggestedCommits,
      dry_run: result.dryRun,
      used_all: result.usedAll,
    },
    status: [],
  };
}

function printEjectHuman(result: EjectResult): void {
  const verb = result.dryRun ? 'Would eject' : 'Ejected';
  console.log(`${verb} project '${result.projectId}' from store '${result.storeId}' into ${result.destinationPath}.`);
  console.log(`  Specs:   ${result.specs.join(', ') || '(none)'}`);
  console.log(`  Changes: ${result.changes.join(', ') || '(none)'}`);
  if (result.missing.length > 0) {
    console.log(`  Missing from store (skipped): ${result.missing.join(', ')}`);
  }
  if (result.collisions.length > 0) {
    console.log(`  Warning: overwrites existing content in the repo: ${result.collisions.join(', ')}`);
  }
  if (result.dryRun) {
    console.log('');
    console.log('Dry run: nothing was moved and no config changed.');
    return;
  }
  console.log('');
  console.log('The repo now resolves to its local planning root (mode: in-repo).');
  reportSuggestedCommits(result.suggestedCommits);
}

// -----------------------------------------------------------------------------
// archive relocate
// -----------------------------------------------------------------------------

export async function runRelocate(options: RelocateOptions): Promise<void> {
  try {
    if (!options.to) {
      throw new StoreError('Pass --to <in-repo|external|store>.', 'relocate_to_required', {
        target: 'archive.destination',
        fix: 'rasen archive relocate --to <in-repo|external|store>',
      });
    }
    const to = options.to as RelocateTarget | 'prune';
    if (!['in-repo', 'external', 'store', 'prune'].includes(to)) {
      throw new StoreError(`Invalid --to value '${options.to}'.`, 'relocate_invalid_to', {
        target: 'archive.destination',
        fix: 'Use --to in-repo|external|store.',
      });
    }

    const result = await relocateArchive({
      projectRoot: findRepoPlanningRootSync(process.cwd()) ?? process.cwd(),
      to: to as RelocateTarget,
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.verifyHash ? { verifyHash: true } : {}),
    });

    if (options.json) {
      printJson(toRelocateJson(result));
      return;
    }
    printRelocateHuman(result);
  } catch (error) {
    if (options.json) {
      failJson(error, 'relocate_error');
      return;
    }
    throw error;
  }
}

function toRelocateJson(result: RelocateResult) {
  return {
    relocate: {
      to: result.to,
      target_dir: result.targetDir,
      destination_value: result.destinationValue,
      moves: result.moves.map((m) => ({ name: m.name, source: m.source, target: m.target })),
      dry_run: result.dryRun,
    },
    status: [],
  };
}

function printRelocateHuman(result: RelocateResult): void {
  const verb = result.dryRun ? 'Would relocate' : 'Relocated';
  console.log(`${verb} ${result.moves.length} archived change(s) to '${result.to}' (${result.targetDir}).`);
  for (const move of result.moves) {
    console.log(`  ${move.name}: ${move.source} -> ${move.target}`);
  }
  if (result.dryRun) {
    console.log('');
    console.log('Dry run: nothing was moved and no config changed.');
    return;
  }
  console.log('');
  console.log(`archive.destination set to '${result.destinationValue}'.`);
}

// -----------------------------------------------------------------------------
// home prune
// -----------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runHomePrune(options: HomePruneOptions): Promise<void> {
  try {
    const result = await homePrune({ ...(options.apply ? { apply: true } : {}) });
    if (options.json) {
      printJson(toHomePruneJson(result));
      return;
    }
    printHomePruneHuman(result);
  } catch (error) {
    if (options.json) {
      failJson(error, 'home_prune_error');
      return;
    }
    throw error;
  }
}

function toHomePruneJson(result: HomePruneResult) {
  return {
    home_prune: {
      dangling_entries: result.danglingEntries.map((e) => ({ path: e.path, home: e.home, size: e.size })),
      unreferenced_homes: result.unreferencedHomes.map((e) => ({ path: e.path, size: e.size })),
      applied: result.applied,
      removed_homes: result.removedHomes,
    },
    status: [],
  };
}

function printHomePruneHuman(result: HomePruneResult): void {
  const total = result.danglingEntries.length + result.unreferencedHomes.length;
  if (total === 0) {
    console.log('No orphaned machine-home state found.');
    return;
  }

  if (result.danglingEntries.length > 0) {
    console.log('Registry entries whose project path no longer exists:');
    for (const entry of result.danglingEntries) {
      console.log(`  - ${entry.path} (home ${entry.home}, ${formatBytes(entry.size)})`);
    }
  }
  if (result.unreferencedHomes.length > 0) {
    console.log('Home directories referenced by no registry entry:');
    for (const home of result.unreferencedHomes) {
      console.log(`  - ${home.path} (${formatBytes(home.size)})`);
    }
  }

  if (!result.applied) {
    console.log('');
    console.log('Report only. Rerun with --apply to remove these.');
    return;
  }
  console.log('');
  console.log(`Removed ${result.removedHomes.length} home director${result.removedHomes.length === 1 ? 'y' : 'ies'}.`);
}

// -----------------------------------------------------------------------------
// Registration helpers
// -----------------------------------------------------------------------------

/** Attaches `relocate` as a subcommand of the top-level `archive` command. */
export function registerArchiveRelocateSubcommand(archiveCommand: Command): void {
  archiveCommand
    .command('relocate')
    .description('Move existing archived changes to a destination and flip archive.destination together')
    .requiredOption('--to <dest>', 'Target destination: in-repo, external, or store')
    .option('--dry-run', 'Print the move plan and change nothing')
    .option('--verify-hash', 'Verify moved files by content hash, not just size')
    .option('--json', 'Output as JSON')
    .action(async (options: RelocateOptions) => {
      await runRelocate(options);
    });
}

/** Registers the `home` command group (`home prune`). */
export function registerHomeCommand(program: Command): void {
  const home = program.command('home').description('Manage machine-local project home state');
  home
    .command('prune')
    .description('List (default) or remove orphaned machine-home directories and stale registry entries')
    .option('--apply', 'Delete the reported orphans (default is report-only)')
    .option('--json', 'Output as JSON')
    .action(async (options: HomePruneOptions) => {
      await runHomePrune(options);
    });
}
