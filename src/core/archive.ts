import { promises as fs } from 'fs';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import { Validator } from './validation/validator.js';
import { readProjectConfig, resolveArchiveTiming, type ArchiveDestination } from './project-config.js';
import { resolveChangeWorkDir, resolveArchiveDestination } from './change-work.js';
import chalk from 'chalk';
import {
  emitStoreRootBanner,
  isRootSelectionError,
  resolveOpenSpecRoot,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
  isStoreSelectedRoot,
} from './root-selection.js';
import {
  findSpecUpdates,
  buildUpdatedSpec,
  writeUpdatedSpec,
  type SpecUpdate,
} from './specs-apply.js';

const execFilePromise = promisify(execFile);
// Route every git spawn through here so `windowsHide` is always set — no
// console window flashes when the daemon (a console-less parent on Windows)
// runs an archive git probe (windows-process-launch spec; store/git.ts:24).
function execFileAsync(
  file: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFilePromise(file, args, { ...options, windowsHide: true });
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function listActiveChangeNames(changesDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return [];
  }
}

export interface ArchiveOptions {
  yes?: boolean;
  /**
   * Separate consent for a `prune` destination's permanent deletion
   * (review M3) — `--yes` alone (which the timing guard treats as "the
   * user confirmed the merge") must never authorize deleting the only
   * copy of a change with no archive fallback.
   */
  confirmPrune?: boolean;
  skipSpecs?: boolean;
  noValidate?: boolean;
  validate?: boolean;
  json?: boolean;
  store?: string;
  project?: string;
  storePath?: string;
}

interface ArchiveDiagnostic {
  severity: 'error';
  code: string;
  message: string;
  fix?: string;
}

interface ArchiveResult {
  change: string;
  destination: ArchiveDestination;
  /** Absent when destination is `prune` (nothing is created). */
  archivedAs?: string;
  /** Absent when destination is `prune`. */
  path?: string;
  /** Present and true only for a `prune` outcome. */
  pruned?: boolean;
  /** Present and true when `external` could not resolve and fell back to in-repo. */
  destinationFallback?: boolean;
  specsUpdated: boolean;
  totals?: { added: number; modified: number; removed: number; renamed: number };
}

/**
 * JSON mode is non-interactive: any point where the human flow would prompt or
 * print prose instead throws this error, which becomes a machine-readable
 * status entry with a non-zero exit code.
 */
class ArchiveBlockedError extends Error {
  readonly diagnostic: ArchiveDiagnostic;

  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = 'ArchiveBlockedError';
    this.diagnostic = {
      severity: 'error',
      code,
      message,
      ...(fix ? { fix } : {}),
    };
  }
}

function toArchiveDiagnostic(error: unknown): ArchiveDiagnostic {
  if (error instanceof ArchiveBlockedError) {
    return error.diagnostic;
  }
  if (isRootSelectionError(error)) {
    return error.diagnostic;
  }
  return {
    severity: 'error',
    code: 'archive_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Recursively copy a directory. Used when fs.rename fails (e.g. EPERM on Windows).
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Move a directory from src to dest. On Windows, fs.rename() often fails with
 * EPERM when the directory is non-empty or another process has it open (IDE,
 * file watcher, antivirus). Fall back to copy-then-remove when rename fails
 * with EPERM or EXDEV.
 */
async function moveDirectory(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'EPERM' || code === 'EXDEV') {
      await copyDirRecursive(src, dest);
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Appends the prune tombstone to `ship-log.md` in `workDir` (review M2):
 * the only recognizable record that a change was pruned, once its
 * directory is gone — a later archive invocation's step-1.5 scan greps for
 * this exact `Pruned:` token (unified across every prune writer: this CLI
 * path, the archive/bulk-archive skill templates, and ship.ts's in-ship
 * branch — a mismatched token silently defeats the tombstone). Creates the
 * file with a minimal header if absent; appends (never overwrites) when it
 * already holds a prior ship log for this change.
 */
async function appendPruneTombstone(workDir: string, changeName: string): Promise<void> {
  const shipLogPath = path.join(workDir, 'ship-log.md');
  await fs.mkdir(workDir, { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(shipLogPath, 'utf-8');
  } catch {
    existing = `# Ship Log: ${changeName}\n`;
  }

  const tombstone = `\n**Pruned:** true\n**Pruned at:** ${new Date().toISOString()}\n`;
  await fs.writeFile(shipLogPath, existing.replace(/\n*$/, '\n') + tombstone, 'utf-8');
}

/**
 * Extracts the ship log's recorded delivery mode from `ship-log.md`'s
 * `**Mode:**` line (design D4 — the minimal timing guard). Sticky-legacy
 * lookup (child 2's Q3 rule): the work directory first, the change
 * directory as fallback — a file already living in the change directory
 * keeps living there. Returns null when neither location has a parseable
 * ship log: no delivery has happened yet, or the `Mode:` line is
 * missing/unparseable (never guessed).
 */
async function readShipLogDeliveryMode(
  workDir: string | null,
  changeDir: string
): Promise<'pr' | 'push' | 'local' | null> {
  const candidates = workDir
    ? [path.join(workDir, 'ship-log.md'), path.join(changeDir, 'ship-log.md')]
    : [path.join(changeDir, 'ship-log.md')];

  for (const candidate of candidates) {
    let content: string;
    try {
      content = await fs.readFile(candidate, 'utf-8');
    } catch {
      continue;
    }
    const match = content.match(/\*\*Mode:\*\*\s*(pr|push|local)\b/);
    return match ? (match[1] as 'pr' | 'push' | 'local') : null;
  }
  return null;
}

/** Outcome of the destructive-destination git-safety check (design D5, review M1). */
type ChangeDirGitState = 'clean' | 'dirty' | 'untracked' | 'unknown';

/**
 * Clean/dirty check for the destructive-destination precondition (design
 * D5). A plain `git status --porcelain` (no `--ignored`) is NOT sufficient
 * on its own: ignored files are invisible to it, so a change directory
 * covered by `.gitignore` reads as "clean" even though its content was
 * never committed — `external`/`prune` would then destroy the only copy
 * with git history holding nothing (review finding M1). This check
 * requires BOTH: (1) `git status --porcelain --ignored` scoped to the
 * change directory is empty — catches uncommitted, untracked, AND
 * ignored-but-present content; (2) `git ls-files` scoped to the change
 * directory is non-empty — the directory must actually have committed
 * content, not just an absence of complaints. Returns `'unknown'` when git
 * itself cannot answer (no repository, git unavailable) — callers must
 * treat that as "cannot verify", never as clean.
 */
async function checkChangeDirGitState(repoRoot: string, changeDir: string): Promise<ChangeDirGitState> {
  try {
    const [statusResult, lsFilesResult] = await Promise.all([
      execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain', '--ignored', '--', changeDir]),
      execFileAsync('git', ['-C', repoRoot, 'ls-files', '--', changeDir]),
    ]);
    if (statusResult.stdout.trim().length > 0) return 'dirty';
    if (lsFilesResult.stdout.trim().length === 0) return 'untracked';
    return 'clean';
  } catch {
    return 'unknown';
  }
}

export class ArchiveCommand {
  async execute(changeName?: string, options: ArchiveOptions = {}): Promise<void> {
    const json = !!options.json;

    let root: ResolvedOpenSpecRoot;
    try {
      root = await resolveOpenSpecRoot({
        ...(options.store !== undefined ? { store: options.store } : {}),
        ...(options.project !== undefined ? { project: options.project } : {}),
        ...(options.storePath !== undefined ? { storePath: options.storePath } : {}),
      });
    } catch (error) {
      if (json && isRootSelectionError(error)) {
        this.printJsonFailure(undefined, toArchiveDiagnostic(error));
        return;
      }
      throw error;
    }

    if (json) {
      try {
        const result = await this.run(changeName, options, root, true);
        if (!result) {
          return;
        }
        console.log(JSON.stringify({ archive: result, root: toRootOutput(root) }, null, 2));
      } catch (error) {
        this.printJsonFailure(root, toArchiveDiagnostic(error));
      }
      return;
    }

    emitStoreRootBanner(root);
    await this.run(changeName, options, root, false);
  }

  private printJsonFailure(root: ResolvedOpenSpecRoot | undefined, diagnostic: ArchiveDiagnostic): void {
    console.log(
      JSON.stringify(
        {
          archive: null,
          ...(root ? { root: toRootOutput(root) } : {}),
          status: [diagnostic],
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }

  /**
   * Shared archive flow. In human mode (json=false) prompts and prose match
   * the historical behavior and cancellations return null. In JSON mode no
   * prose reaches stdout and every blocked path throws.
   */
  private async run(
    changeName: string | undefined,
    options: ArchiveOptions,
    root: ResolvedOpenSpecRoot,
    json: boolean
  ): Promise<ArchiveResult | null> {
    const changesDir = root.changesDir;
    const mainSpecsDir = root.specsDir;

    // Get change name interactively if not provided
    if (!changeName) {
      if (json) {
        throw new ArchiveBlockedError(
          'archive_change_name_required',
          'A change name is required: archive --json is non-interactive.',
          withStoreFlag(root, 'rasen archive <change-name> --json')
        );
      }
      const selectedChange = await this.selectChange(changesDir);
      if (!selectedChange) {
        console.log('No change selected. Aborting.');
        return null;
      }
      changeName = selectedChange;
    }

    const changeDir = path.join(changesDir, changeName);

    // Verify change exists
    try {
      const stat = await fs.stat(changeDir);
      if (!stat.isDirectory()) {
        throw new Error(`Change '${changeName}' not found.`);
      }
    } catch {
      const available = await listActiveChangeNames(changesDir);
      throw new ArchiveBlockedError(
        'archive_change_not_found',
        available.length > 0
          ? `Change '${changeName}' not found. Available changes: ${available.join(', ')}`
          : `Change '${changeName}' not found. No active changes exist in this root.`
      );
    }

    // Destination resolution (design D1/D4): at the top of run(), PROBE only
    // (review M6 — deferring the mint honors "ensure only at write time"
    // literally: an `external` archive later refused by a gate — timing
    // guard, validation, dirty tree — must not have already minted machine
    // identity and written the registry as a side effect of a failed run).
    // `destination` itself (in-repo/external/prune) is needed immediately
    // for every gate below, so only the identity-minting `ensure:true` is
    // deferred — re-resolved with `ensure:true` right before the actual
    // `external` move, once every gate has passed.
    const destinationResolution = await resolveArchiveDestination(root.path, { ensure: false });
    const destination = destinationResolution.destination;

    // Timing guard (design D4, closes child 3's `ArchiveCommand` bypass gap):
    // the CLI never shells to gh/git for workflow decisions, so it cannot
    // verify a PR merge itself. When on-merge timing applies and the
    // recorded ship log shows a pr-mode delivery, refuse without an
    // explicit --yes override — the override IS the user's merge
    // confirmation (cli-archive spec: "Explicit override archives anyway").
    if (!options.yes) {
      const archiveTiming = resolveArchiveTiming(readProjectConfig(root.path));
      if (archiveTiming === 'on-merge') {
        const workDirForShipLog = await resolveChangeWorkDir(root.path, changeName, { ensure: false });
        const deliveryMode = await readShipLogDeliveryMode(workDirForShipLog, changeDir);
        if (deliveryMode === 'pr') {
          const message = `Change '${changeName}' shipped via a pull request under on-merge archive timing; the CLI cannot verify the merge itself.`;
          // Review M3: this message must not read as "pass --yes and
          // everything proceeds" when destination is `prune` — --yes here
          // is ONLY the merge confirmation; the separate --confirm-prune
          // flag (or the interactive prompt) still gates the deletion.
          const pruneNote =
            destination === 'prune'
              ? ' Note: for destination \'prune\', --yes here only confirms the merge — the deletion itself still requires --confirm-prune (or the interactive prompt) separately.'
              : '';
          const fix = `Use the archive skill (/rasen-archive-change), which checks the PR's merge state, or rerun with --yes after confirming the merge yourself.${pruneNote}`;
          if (json) {
            throw new ArchiveBlockedError('archive_merge_confirmation_required', message, fix);
          }
          console.log(chalk.yellow(`\n⚠️  ${message}`));
          console.log(chalk.yellow(fix));
          process.exitCode = 1;
          return null;
        }
      }
    }

    const skipValidation = options.validate === false || options.noValidate === true;

    // Validate specs and change before archiving
    if (!skipValidation) {
      const validator = new Validator();
      let hasValidationErrors = false;

      // Validate proposal.md (informative only; human mode prints warnings)
      if (!json) {
        const changeFile = path.join(changeDir, 'proposal.md');
        try {
          await fs.access(changeFile);
          const changeReport = await validator.validateChange(changeFile);
          // Proposal validation is informative only (do not block archive)
          if (!changeReport.valid) {
            console.log(chalk.yellow(`\nProposal warnings in proposal.md (non-blocking):`));
            for (const issue of changeReport.issues) {
              const symbol = issue.level === 'ERROR' ? '⚠' : (issue.level === 'WARNING' ? '⚠' : 'ℹ');
              console.log(chalk.yellow(`  ${symbol} ${issue.message}`));
            }
          }
        } catch {
          // Change file doesn't exist, skip validation
        }
      }

      // Validate delta-formatted spec files under the change directory if present
      const changeSpecsDir = path.join(changeDir, 'specs');
      let hasDeltaSpecs = false;
      try {
        const candidates = await fs.readdir(changeSpecsDir, { withFileTypes: true });
        for (const c of candidates) {
          if (c.isDirectory()) {
            try {
              const candidatePath = path.join(changeSpecsDir, c.name, 'spec.md');
              await fs.access(candidatePath);
              const content = await fs.readFile(candidatePath, 'utf-8');
              if (/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/m.test(content)) {
                hasDeltaSpecs = true;
                break;
              }
            } catch {}
          }
        }
      } catch {}
      if (hasDeltaSpecs) {
        const deltaReport = await validator.validateChangeDeltaSpecs(changeDir);
        if (!deltaReport.valid) {
          hasValidationErrors = true;
          if (!json) {
            console.log(chalk.red(`\nValidation errors in change delta specs:`));
            for (const issue of deltaReport.issues) {
              if (issue.level === 'ERROR') {
                console.log(chalk.red(`  ✗ ${issue.message}`));
              } else if (issue.level === 'WARNING') {
                console.log(chalk.yellow(`  ⚠ ${issue.message}`));
              }
            }
          }
        }
      }

      if (hasValidationErrors) {
        if (json) {
          throw new ArchiveBlockedError(
            'archive_validation_failed',
            `Validation failed for change '${changeName}'.`,
            `Run ${withStoreFlag(root, `rasen validate ${changeName}`)} for details, fix the errors, or rerun with --no-validate.`
          );
        }
        console.log(chalk.red('\nValidation failed. Please fix the errors before archiving.'));
        console.log(chalk.yellow('To skip validation (not recommended), use --no-validate flag.'));
        process.exitCode = 1;
        return null;
      }
    } else if (json) {
      if (!options.yes) {
        throw new ArchiveBlockedError(
          'archive_confirmation_required',
          'Skipping validation requires confirmation: rerun with --yes.',
          withStoreFlag(root, 'rasen archive <change-name> --json --no-validate --yes')
        );
      }
    } else {
      // Log warning when validation is skipped
      const timestamp = new Date().toISOString();

      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: chalk.yellow('⚠️  WARNING: Skipping validation may archive invalid specs. Continue? (y/N)'),
          default: false
        });
        if (!proceed) {
          console.log('Archive cancelled.');
          return null;
        }
      } else {
        console.log(chalk.yellow(`\n⚠️  WARNING: Skipping validation may archive invalid specs.`));
      }

      console.log(chalk.yellow(`[${timestamp}] Validation skipped for change: ${changeName}`));
      console.log(chalk.yellow(`Affected files: ${changeDir}`));
    }

    // Show progress and check for incomplete tasks
    const progress = await getTaskProgressForChange(changesDir, changeName, path.resolve(changesDir, '..', '..'));
    if (!json) {
      const status = formatTaskStatus(progress);
      console.log(`Task status: ${status}`);
    }

    const incompleteTasks = Math.max(progress.total - progress.completed, 0);
    if (incompleteTasks > 0) {
      if (json) {
        if (!options.yes) {
          throw new ArchiveBlockedError(
            'archive_tasks_incomplete',
            `${incompleteTasks} incomplete task(s) found for change '${changeName}'.`,
            'Complete the tasks or rerun with --yes.'
          );
        }
      } else if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: `Warning: ${incompleteTasks} incomplete task(s) found. Continue?`,
          default: false
        });
        if (!proceed) {
          console.log('Archive cancelled.');
          return null;
        }
      } else {
        console.log(`Warning: ${incompleteTasks} incomplete task(s) found. Continuing due to --yes flag.`);
      }
    }

    // Handle spec updates unless skipSpecs flag is set
    let specsUpdated = false;
    let totals: ArchiveResult['totals'];
    if (options.skipSpecs) {
      if (!json) {
        console.log('Skipping spec updates (--skip-specs flag provided).');
      }
    } else {
      // Find specs to update
      const specUpdates = await findSpecUpdates(changeDir, mainSpecsDir);

      if (specUpdates.length > 0) {
        if (!json) {
          console.log('\nSpecs to update:');
          for (const update of specUpdates) {
            const status = update.exists ? 'update' : 'create';
            const capability = path.basename(path.dirname(update.target));
            console.log(`  ${capability}: ${status}`);
          }
        }

        let shouldUpdateSpecs = true;
        if (!options.yes) {
          if (json) {
            throw new ArchiveBlockedError(
              'archive_confirmation_required',
              `Updating ${specUpdates.length} spec(s) requires confirmation: rerun with --yes.`,
              withStoreFlag(root, 'rasen archive <change-name> --json --yes')
            );
          }
          const { confirm } = await import('@inquirer/prompts');
          shouldUpdateSpecs = await confirm({
            message: 'Proceed with spec updates?',
            default: true
          });
          if (!shouldUpdateSpecs) {
            console.log('Skipping spec updates. Proceeding with archive.');
          }
        }

        if (shouldUpdateSpecs) {
          // Prepare all updates first (validation pass, no writes)
          const prepared: Array<{ update: SpecUpdate; rebuilt: string; counts: { added: number; modified: number; removed: number; renamed: number }; emptied: boolean }> = [];
          try {
            for (const update of specUpdates) {
              const built = await buildUpdatedSpec(update, changeName!, { silent: json });
              prepared.push({ update, rebuilt: built.rebuilt, counts: built.counts, emptied: built.emptied });
            }
          } catch (err: any) {
            if (json) {
              throw new ArchiveBlockedError(
                'archive_spec_update_failed',
                String(err.message || err),
                'Fix the change delta specs and rerun. No files were changed.'
              );
            }
            console.log(String(err.message || err));
            console.log('Aborted. No files were changed.');
            process.exitCode = 1;
            return null;
          }

          // Validate every rebuilt spec before writing any of them, so a
          // late validation failure really does leave all targets unchanged.
          // An emptied existing spec (every requirement REMOVED) is deleted, not
          // written, so it has no content to validate — skip it.
          if (!skipValidation) {
            for (const p of prepared) {
              if (p.emptied) continue;
              const specName = path.basename(path.dirname(p.update.target));
              const report = await new Validator().validateSpecContent(specName, p.rebuilt);
              if (!report.valid) {
                if (json) {
                  throw new ArchiveBlockedError(
                    'archive_spec_validation_failed',
                    `Rebuilt spec for '${specName}' failed validation. No files were changed.`,
                    `Run ${withStoreFlag(root, `rasen validate ${specName}`)} after fixing the change deltas.`
                  );
                }
                console.log(chalk.red(`\nValidation errors in rebuilt spec for ${specName} (will not write changes):`));
                for (const issue of report.issues) {
                  if (issue.level === 'ERROR') console.log(chalk.red(`  ✗ ${issue.message}`));
                  else if (issue.level === 'WARNING') console.log(chalk.yellow(`  ⚠ ${issue.message}`));
                }
                console.log('Aborted. No files were changed.');
                process.exitCode = 1;
                return null;
              }
            }
          }

          // All validations passed; write files and display counts
          const writeTotals = { added: 0, modified: 0, removed: 0, renamed: 0 };
          for (const p of prepared) {
            const capability = path.basename(path.dirname(p.update.target));
            if (p.emptied) {
              // Existing spec fully emptied by this delta → delete its directory.
              await fs.rm(path.dirname(p.update.target), { recursive: true, force: true });
              if (!json) {
                console.log(`Deleting spec '${capability}' — all requirements removed by this change.`);
              }
            } else {
              await writeUpdatedSpec(p.update, p.rebuilt, p.counts, {
                silent: json,
                // Cross-root paths must be absolute when a store is selected.
                ...(isStoreSelectedRoot(root) ? { displayPath: p.update.target } : {}),
              });
            }
            writeTotals.added += p.counts.added;
            writeTotals.modified += p.counts.modified;
            writeTotals.removed += p.counts.removed;
            writeTotals.renamed += p.counts.renamed;
          }
          specsUpdated = true;
          totals = writeTotals;
          if (!json) {
            console.log(
              `Totals: + ${writeTotals.added}, ~ ${writeTotals.modified}, - ${writeTotals.removed}, → ${writeTotals.renamed}`
            );
            console.log('Specs updated successfully.');
          }
        }
      }
    }

    // Destructive-destination safety preconditions (design D5): `external`
    // and `prune` both remove the repo's only copy of the change's review
    // material, so both require the change directory to already be
    // committed (and, per review M1, actually TRACKED — see
    // checkChangeDirGitState's doc comment). Spec sync above never touches
    // `changeDir` itself, so this check is accurate whether it runs before
    // or after it.
    if (destination === 'external' || destination === 'prune') {
      const gitState = await checkChangeDirGitState(root.path, changeDir);
      if (gitState !== 'clean') {
        const reason =
          gitState === 'unknown'
            ? `could not verify git status for '${changeDir}' (no git repository, or git unavailable)`
            : gitState === 'untracked'
              ? `'${changeDir}' has no content committed to git history (nothing tracked there — possibly excluded by .gitignore)`
              : `'${changeDir}' has uncommitted or ignored-but-present content not yet in git history`;
        // Review M5: spec sync (above) already wrote to the main specs
        // tree by this point — a refusal here must say so, since the
        // working tree is not what it was before this command ran.
        const syncNote = specsUpdated
          ? ' Note: main specs were already synced by this run before this check failed — the working tree now includes those spec changes even though the archive itself did not proceed.'
          : '';
        throw new ArchiveBlockedError(
          'archive_dirty_change_dir',
          `Cannot archive to destination '${destination}': ${reason}.${syncNote}`,
          `Commit the change directory first, then rerun ${withStoreFlag(root, `rasen archive ${changeName}`)}.`
        );
      }
    }

    if (destination === 'prune') {
      // Review M3: the prune deletion is a SEPARATE consent from --yes
      // (which the timing guard above already treats as "the user
      // confirmed the merge"). --confirm-prune is required independently —
      // --yes alone must never authorize a permanent deletion.
      if (!options.confirmPrune) {
        // Review M5: same as the dirty-dir refusal above — spec sync may
        // already have run by this point.
        const syncNote = specsUpdated
          ? ' Note: main specs were already synced by this run before this confirmation was required.'
          : '';
        if (json) {
          throw new ArchiveBlockedError(
            'archive_prune_confirmation_required',
            `Destination 'prune' permanently deletes '${changeDir}' with no archive copy; archive --json requires --confirm-prune to confirm (--yes alone does not authorize deletion).${syncNote}`,
            withStoreFlag(root, `rasen archive ${changeName} --json --confirm-prune`)
          );
        }
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: chalk.red(
            `⚠️  This will PERMANENTLY DELETE '${changeDir}' (destination: prune — no archive copy is made; git history is the archive). Continue?`
          ),
          default: false,
        });
        if (!proceed) {
          console.log(specsUpdated ? 'Archive cancelled (main specs were already synced by this run).' : 'Archive cancelled.');
          return null;
        }
      }

      // Review M2: write the prune tombstone BEFORE deleting — it is the
      // ONLY way a later archive invocation can recognize this change once
      // its directory is gone (git history holds nothing for a pruned
      // change by design). `ensure: true` because this is the sole safety
      // net for prune, worth minting machine identity for if not already
      // registered; failures are swallowed (never block the deletion the
      // user already confirmed on a bookkeeping write).
      let tombstoneWritten = false;
      try {
        const workDirForTombstone = await resolveChangeWorkDir(root.path, changeName, { ensure: true });
        if (workDirForTombstone) {
          await appendPruneTombstone(workDirForTombstone, changeName);
          tombstoneWritten = true;
        }
      } catch {
        // Best-effort; see comment above.
      }

      await fs.rm(changeDir, { recursive: true, force: true });

      if (!json) {
        console.log(`Change '${changeName}' pruned (deleted; no archive copy — git history is the archive).`);
        console.log(chalk.cyan('Quality capture skipped: prune leaves no archived directory to stamp.'));
        if (!tombstoneWritten) {
          console.log(
            chalk.yellow(
              'Note: no prune tombstone could be recorded (no machine home available) — a later archive invocation for this name will report "not found" rather than "pruned".'
            )
          );
        }
      }

      return {
        change: changeName,
        destination,
        pruned: true,
        specsUpdated,
        ...(totals ? { totals } : {}),
      };
    }

    // in-repo or external: move the change directory. `destinationResolution`
    // always resolves `in-repo`. For `external` it was only PROBED above
    // (review M6) — every gate has now passed, so this IS the write this
    // command commits to; re-resolve with `ensure:true` here (archiving IS
    // the home-needing write, deferred to the point of actual need) rather
    // than trusting a stale probe. Only when even that mint fails — an
    // unregistered project the ensure path itself could not register, or a
    // resolution error — fall back to the in-repo location with a visible
    // note rather than ever escalating to deletion (design D6).
    let targetArchiveDir = destinationResolution.archiveDir;
    if (destination === 'external' && !targetArchiveDir) {
      const ensured = await resolveArchiveDestination(root.path, { ensure: true });
      targetArchiveDir = ensured.archiveDir;
    }
    let destinationFallback = false;
    if (!targetArchiveDir) {
      targetArchiveDir = root.archiveDir;
      destinationFallback = destination === 'external';
    }

    const archiveName = `${this.getArchiveDate()}-${changeName}`;
    const archivePath = path.join(targetArchiveDir, archiveName);

    // Check if archive already exists
    let archiveExists = false;
    try {
      await fs.access(archivePath);
      archiveExists = true;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (archiveExists) {
      throw new ArchiveBlockedError('archive_target_exists', `Archive '${archiveName}' already exists.`);
    }

    // Create archive directory if needed
    await fs.mkdir(targetArchiveDir, { recursive: true });

    // Move change to archive (uses copy+remove on EPERM/EXDEV, e.g. Windows
    // — required for `external`, which may cross filesystems/drives)
    await moveDirectory(changeDir, archivePath);

    // Quality capture: scan archived directory for quality artifact files
    // (path-agnostic — runs against wherever the directory landed)
    await this.captureQuality(archivePath, json);

    if (!json) {
      const destinationNote = destination === 'external' ? ' (external, machine home)' : '';
      console.log(`Change '${changeName}' archived as '${archiveName}'${destinationNote}.`);
      if (destinationFallback) {
        console.log(
          chalk.yellow(`Note: destination 'external' could not be resolved; fell back to an in-repo archive.`)
        );
      }
    }

    return {
      change: changeName,
      destination,
      archivedAs: archiveName,
      path: archivePath,
      specsUpdated,
      ...(destinationFallback ? { destinationFallback: true } : {}),
      ...(totals ? { totals } : {}),
    };
  }

  /**
   * Scan the archived change directory for quality artifact files and capture
   * their quality summary (scanned files + metric-line counts) into the
   * archive's `.openspec.yaml`. Quality files match *-review.md, *-report.md,
   * *-audit.md.
   *
   * Archive is NOT a codification step: it does not interpret `[RULE]` markers
   * as reusable guidance, never mutates the project's `quality-rules`, and
   * reports no extracted-rule count. Evidence-gated learned-skill creation is
   * the `codify` mode of `rasen-retain`. Existing `quality-rules` remain
   * untouched and continue normal instruction injection.
   */
  private async captureQuality(archivePath: string, quiet = false): Promise<void> {
    try {
      const entries = await fs.readdir(archivePath, { withFileTypes: true });
      const qualityFiles = entries
        .filter(e => !e.isDirectory())
        .filter(e => {
          const base = e.name.toLowerCase();
          return base.endsWith('-review.md') || base.endsWith('-report.md') || base.endsWith('-audit.md');
        });

      if (qualityFiles.length === 0) return;

      const qualityMetrics: Record<string, number> = {};

      for (const qf of qualityFiles) {
        const filePath = path.join(archivePath, qf.name);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          // Count lines matching metric patterns. `[RULE]` lines are ordinary
          // artifact content here — they are not extracted or interpreted.
          let findings = 0;
          let issues = 0;
          let scenarios = 0;

          for (const line of lines) {
            const trimmed = line.trim().toLowerCase();
            if (trimmed.match(/findings:/i)) findings++;
            if (trimmed.match(/issues:/i)) issues++;
            if (trimmed.match(/scenarios:/i)) scenarios++;
          }

          qualityMetrics[qf.name] = findings + issues + scenarios;
        } catch {
          // Skip unreadable files
        }
      }

      // Write quality summary to .openspec.yaml in the archive directory
      const metaPath = path.join(archivePath, '.openspec.yaml');
      let metaData: Record<string, unknown> = {};
      try {
        if (existsSync(metaPath)) {
          const existing = readFileSync(metaPath, 'utf-8');
          metaData = (parseYaml(existing) as Record<string, unknown>) || {};
        }
      } catch {
        // Start fresh if can't read
      }

      metaData.quality = {
        files: qualityFiles.map(f => f.name),
        metrics: qualityMetrics,
      };

      writeFileSync(metaPath, stringifyYaml(metaData), 'utf-8');

      // Display quality summary (suppressed in JSON mode: stdout carries one document)
      if (!quiet) {
        console.log(chalk.cyan(`\nQuality capture:`));
        console.log(chalk.cyan(`  Files scanned: ${qualityFiles.map(f => f.name).join(', ')}`));
        for (const [file, count] of Object.entries(qualityMetrics)) {
          if (count > 0) {
            console.log(chalk.cyan(`  ${file}: ${count} metric line(s)`));
          }
        }
      }
    } catch {
      // Quality capture is non-fatal - don't block archive
    }
  }

  private async selectChange(changesDir: string): Promise<string | null> {
    const { select } = await import('@inquirer/prompts');
    const changeDirs = await listActiveChangeNames(changesDir);

    if (changeDirs.length === 0) {
      console.log('No active changes found.');
      return null;
    }

    // Build choices with progress inline to avoid duplicate lists
    let choices: Array<{ name: string; value: string }> = changeDirs.map(name => ({ name, value: name }));
    try {
      const progressList: Array<{ id: string; status: string }> = [];
      for (const id of changeDirs) {
        const progress = await getTaskProgressForChange(changesDir, id, path.resolve(changesDir, '..', '..'));
        const status = formatTaskStatus(progress);
        progressList.push({ id, status });
      }
      const nameWidth = Math.max(...progressList.map(p => p.id.length));
      choices = progressList.map(p => ({
        name: `${p.id.padEnd(nameWidth)}     ${p.status}`,
        value: p.id
      }));
    } catch {
      // If anything fails, fall back to simple names
      choices = changeDirs.map(name => ({ name, value: name }));
    }

    try {
      const answer = await select({
        message: 'Select a change to archive',
        choices
      });
      return answer;
    } catch (error) {
      // User cancelled (Ctrl+C)
      return null;
    }
  }

  private getArchiveDate(): string {
    // Returns date in YYYY-MM-DD format
    return new Date().toISOString().split('T')[0];
  }
}
