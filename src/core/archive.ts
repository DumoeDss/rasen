import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import {
  applyArchive,
  createArchiveIntentTemplate,
  createArchivePlan,
  defaultArchiveEngineAdapters,
  loadStoredArchivePlan,
  persistArchivePlan,
  resolveArchiveSidecar,
  type ApplyArchiveOptions,
  type ArchiveApplyResult,
  type ArchiveIntentV1,
  type ArchivePlan,
  type PreparedArchiveSpecAction,
} from './archive-engine.js';
import { getGlobalDataDir } from './global-config.js';
import { resolveArchiveDestination, resolveChangeWorkDir } from './change-work.js';
import { ephemeraDir, evidenceDir, resolveExecutionRoot } from './file-placement.js';
import {
  formatWhitespaceViolations,
  scanDirectoryForWhitespaceViolations,
} from './whitespace-hygiene.js';
import { classifyOpenSpecDir, readProjectConfig, resolveArchiveTiming } from './project-config.js';
import { storeBindingDeclarationFrom } from './effective-config.js';
import { resolveStoreBinding } from './store/identity.js';
import { classifyStoreRootLayout } from './store/layout-write-guard.js';
import { productionStoreLayoutMigrationDependencies } from './store/layout-migration/dependencies.js';
import { queryLegacyCoordinatorConversion } from './store/layout-migration/receipt.js';
import {
  emitStoreRootBanner,
  isRootSelectionError,
  isStoreSelectedRoot,
  resolveOpenSpecRoot,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
} from './root-selection.js';
import { buildUpdatedSpec, findSpecUpdates } from './specs-apply.js';
import { Validator } from './validation/validator.js';
import { resolveProjectHome } from './project-home.js';
import { derivePlanningSpaceId, readPhysicalIdentity } from './change-run/internal/identity.js';
import { createAssociationLedgerStore } from './change-run/internal/association-ledger-store.js';

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

async function listActiveChangeNames(changesDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && entry.name !== 'archive')
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return [];
  }
}

export interface ArchiveOptions {
  yes?: boolean;
  skipSpecs?: boolean;
  noValidate?: boolean;
  validate?: boolean;
  json?: boolean;
  store?: string;
  project?: string;
  storePath?: string;
  keepEphemera?: boolean;
  /** `--no-whitespace-check` sets this to false; the preflight is on by default. */
  whitespaceCheck?: boolean;
  dryRun?: boolean;
  savePlan?: boolean;
  applyPlan?: string;
  intentTemplate?: boolean;
  intentFile?: string;
}

interface ArchiveDiagnostic {
  severity: 'error';
  code: string;
  message: string;
  fix?: string;
  issueId?: string;
  storeId?: string;
  forwarded?: false;
  continuations?: readonly string[];
}

function legacyFlatStoreArchiveRefusal(storeId: string): ArchiveDiagnostic {
  return {
    severity: 'error',
    code: 'legacy_flat_store_requires_migration',
    message:
      'This Store still uses the legacy flat planning layout, which is read-only; archiving requires layout v2.',
    fix: `Run 'rasen store migrate-layout ${storeId}' to migrate this Store, then retry.`,
  };
}

/**
 * The Store a project-scoped archive target plans in, or null when the root
 * has nothing to do with a Store. This line's root selection carries no
 * planning-scope description yet (that surface is the L6 slice), so the store
 * binding is re-derived from the root's own declaration here.
 */
async function archiveStoreBindingTarget(
  root: ResolvedOpenSpecRoot
): Promise<{ storeId: string; storeUid?: string; storeRoot: string } | null> {
  const { pointer } = classifyOpenSpecDir(root.path);
  const declaration = storeBindingDeclarationFrom(pointer);
  if (declaration.form === 'absent') return null;
  const binding = await resolveStoreBinding({ declaration, projectRoot: root.path }).catch(
    () => null
  );
  if (binding?.kind !== 'resolved') return null;
  return {
    storeId: binding.store.id,
    ...(binding.store.uid === undefined ? {} : { storeUid: binding.store.uid }),
    storeRoot: binding.store.root,
  };
}

/**
 * A legacy flat Store's planning tree is READ-ONLY until it is migrated:
 * archiving writes into `rasen/changes/archive`, a namespace layout v2
 * retires, and the entry would then have to be relocated a second time by the
 * migration. The refusal ships together with the migration that makes it
 * survivable (`store-layout-v2-migration`, tasks 10b.1-10b.3). Without a
 * planning-scope description the root's own Store declaration is classified
 * directly, which is the same fact the resolver would have reported.
 */
async function storeFinalizationDiagnostic(
  root: ResolvedOpenSpecRoot
): Promise<ArchiveDiagnostic | null> {
  const classification = await classifyStoreRootLayout(root.path);
  return classification.kind === 'legacy-flat'
    ? legacyFlatStoreArchiveRefusal(root.storeId ?? classification.storeId ?? '<store-id>')
    : null;
}

async function exactActiveChangeExists(
  changesDir: string,
  changeName: string,
  lstat: typeof fs.lstat
): Promise<boolean> {
  try {
    const stat = await lstat(path.join(changesDir, changeName));
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function legacyCoordinatorDiagnostic(
  root: ResolvedOpenSpecRoot,
  changeName: string | undefined,
  options: ArchiveOptions,
  lstat: typeof fs.lstat
): Promise<ArchiveDiagnostic | null> {
  if (changeName === undefined || options.intentTemplate === true) {
    return null;
  }
  // A real active Change always wins and remains subject to finalization.
  if (await exactActiveChangeExists(root.changesDir, changeName, lstat)) return null;
  const target = await archiveStoreBindingTarget(root);
  // The conversion receipt is keyed by the Store's permanent identity; a
  // Store without one cannot have recorded a coordinator conversion.
  if (target === null || target.storeUid === undefined) return null;
  const checkedOutRef = await productionStoreLayoutMigrationDependencies.git.currentRef(
    target.storeRoot
  );
  if (checkedOutRef === null) return null;
  const result = await queryLegacyCoordinatorConversion(
    productionStoreLayoutMigrationDependencies,
    {
      storeRoot: target.storeRoot,
      storeUid: target.storeUid,
      ref: checkedOutRef,
      alias: changeName,
    }
  );
  if (result.status !== 'found') return null;
  const show = `rasen store issue show ${result.issueId} --store ${target.storeId}`;
  const state = `rasen store issue state ${result.issueId} --store ${target.storeId} --state <resolved|dropped>`;
  return {
    severity: 'error',
    code: 'legacy_coordinator_became_issue',
    message:
      `Legacy Change alias '${changeName}' was converted to Store Issue '${result.issueId}'. ` +
      `This archive invocation executed no finalization option and changed neither resource.`,
    fix: `Inspect it with '${show}'. If appropriate, declare Issue state separately with '${state}'; that is an independent operator action, not archive forwarding.`,
    issueId: result.issueId,
    storeId: target.storeId,
    forwarded: false,
    continuations: [show, state],
  };
}

interface ArchiveResult {
  change: string;
  archivedAs: string;
  path: string;
  specsUpdated: boolean;
  totals?: { added: number; modified: number; removed: number; renamed: number };
  ephemeraDiscarded?: string[];
  ephemeraPreserved?: string[];
  ephemeraAborted?: boolean;
  ephemeraAbortReason?: string;
  /** Present only when `--no-whitespace-check` disabled the preflight. */
  whitespaceCheckSkipped?: boolean;
  dryRun?: boolean;
  specSyncPlan?: Array<{ capability: string; status: string }>;
  plan?: ArchivePlan;
  transactionId?: string;
  planHash?: string;
  journalPath?: string;
  blockers?: ArchivePlan['blockers'];
  planToken?: string;
  status?: ArchiveApplyResult['status'];
  result?: ArchiveApplyResult;
  mode?: 'intent-template' | 'plan' | 'apply';
  intent?: ArchiveIntentV1;
  compatibilityDiagnostic?: ArchiveDiagnostic;
}

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
  if (error instanceof ArchiveBlockedError) return error.diagnostic;
  if (isRootSelectionError(error)) return error.diagnostic;
  return {
    severity: 'error',
    code: 'archive_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function readShipLogDeliveryMode(
  workDir: string | null,
  changeDir: string
): Promise<'pr' | 'push' | 'local' | null> {
  const candidates = [
    path.join(evidenceDir(changeDir), 'ship-log.md'),
    ...(workDir ? [path.join(workDir, 'ship-log.md')] : []),
    path.join(changeDir, 'ship-log.md'),
  ];
  for (const candidate of candidates) {
    let content: string;
    try {
      content = await fs.readFile(candidate, 'utf8');
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw new ArchiveBlockedError(
        'archive_ship_log_read_failed',
        `Unable to read ship log at ${candidate}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    const match = content.match(/\*\*Mode:\*\*\s*(pr|push|local)\b/);
    return match ? (match[1] as 'pr' | 'push' | 'local') : null;
  }
  return null;
}

async function resolveShipLogPlan(
  workDir: string | null,
  changeDir: string
): Promise<ArchivePlan['shipLog']> {
  const candidates = [
    path.join(evidenceDir(changeDir), 'ship-log.md'),
    ...(workDir ? [path.join(workDir, 'ship-log.md')] : []),
    path.join(changeDir, 'ship-log.md'),
  ];
  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate);
      return {
        source: candidate,
        sha256: createHash('sha256').update(content).digest('hex'),
        recordedCommit:
          content
            .toString('utf8')
            .match(/^\*\*Commit:\*\*\s*([0-9a-f]{7,64})\s*$/im)?.[1] ?? null,
      };
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw new ArchiveBlockedError(
        'archive_ship_log_read_failed',
        `Unable to read ship log at ${candidate}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  return { source: null, sha256: null, recordedCommit: null };
}

export interface ArchiveCommandDependencies {
  readonly lstat: typeof fs.lstat;
}

export class ArchiveCommand {
  constructor(
    private readonly dependencies: ArchiveCommandDependencies = { lstat: fs.lstat }
  ) {}

  async execute(changeName?: string, options: ArchiveOptions = {}): Promise<void> {
    const json = !!options.json;
    if (options.applyPlan !== undefined) {
      await this.applyStoredPlan(changeName, options, json);
      return;
    }
    if (options.savePlan && !options.dryRun) {
      const error = new ArchiveBlockedError(
        'archive_option_conflict',
        '--save-plan is valid only with --dry-run.'
      );
      if (json) {
        this.printJsonFailure(undefined, error.diagnostic);
        return;
      }
      throw error;
    }
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

    const conversionDiagnostic = await legacyCoordinatorDiagnostic(
      root,
      changeName,
      options,
      this.dependencies.lstat
    );
    if (conversionDiagnostic !== null) {
      if (json) {
        this.printJsonFailure(root, conversionDiagnostic);
        return;
      }
      throw new ArchiveBlockedError(
        conversionDiagnostic.code,
        `[${conversionDiagnostic.code}] ${conversionDiagnostic.message}`,
        conversionDiagnostic.fix
      );
    }

    const flatStoreDiagnostic = await storeFinalizationDiagnostic(root);
    if (flatStoreDiagnostic !== null) {
      if (json) {
        this.printJsonFailure(root, flatStoreDiagnostic);
        return;
      }
      throw new ArchiveBlockedError(
        flatStoreDiagnostic.code,
        flatStoreDiagnostic.message,
        flatStoreDiagnostic.fix
      );
    }

    if (json) {
      try {
        const result = await this.run(changeName, options, root, true);
        if (result) {
          const { compatibilityDiagnostic, ...archive } = result;
          if (compatibilityDiagnostic && !options.dryRun) {
            this.printJsonFailure(root, compatibilityDiagnostic, result.plan);
            return;
          }
          const firstBlocker = result.blockers?.[0];
          const isMergeConfirmationBlocker =
            firstBlocker?.operation === 'timing' &&
            firstBlocker.message ===
              'A recorded PR delivery requires explicit merge confirmation.' &&
            result.plan?.decisions.timing.mode === 'on-merge' &&
            result.plan.decisions.timing.deliveryMode === 'pr' &&
            !result.plan.decisions.timing.override;
          const isExistingTargetBlocker =
            firstBlocker?.operation === 'target-lstat' &&
            firstBlocker.code === 'EEXIST';
          const diagnostic =
            result.status && result.status !== 'complete'
              ? {
                  severity: 'error' as const,
                  code:
                    isMergeConfirmationBlocker
                      ? 'archive_merge_confirmation_required'
                      : isExistingTargetBlocker
                        ? 'archive_target_exists'
                        : result.status === 'recoverable'
                          ? 'archive_recovery_required'
                          : 'archive_plan_blocked',
                  message: firstBlocker?.message ?? 'Archive plan is incomplete.',
                }
              : undefined;
          console.log(
            JSON.stringify(
              {
                archive,
                ...(diagnostic && result.plan ? { plan: result.plan } : {}),
                root: toRootOutput(root),
                ...(diagnostic ? { status: [diagnostic] } : {}),
              },
              null,
              2
            )
          );
        }
      } catch (error) {
        this.printJsonFailure(root, toArchiveDiagnostic(error));
      }
      return;
    }

    emitStoreRootBanner(root);
    await this.run(changeName, options, root, false);
  }

  private async applyStoredPlan(
    changeName: string | undefined,
    options: ArchiveOptions,
    json: boolean
  ): Promise<void> {
    const planningOptions = [
      changeName !== undefined,
      !!options.dryRun,
      !!options.savePlan,
      !!options.intentTemplate,
      options.intentFile !== undefined,
      !!options.skipSpecs,
      !!options.noValidate,
      options.validate === false,
      options.store !== undefined,
      options.project !== undefined,
      options.storePath !== undefined,
      !!options.keepEphemera,
    ];
    if (planningOptions.some(Boolean)) {
      const diagnostic = new ArchiveBlockedError(
        'archive_option_conflict',
        '--apply-plan cannot be combined with a change name or planning options.'
      ).diagnostic;
      if (json) {
        this.printJsonFailure(undefined, diagnostic);
        return;
      }
      throw new ArchiveBlockedError(diagnostic.code, diagnostic.message);
    }

    try {
      const plan = await loadStoredArchivePlan(
        options.applyPlan!,
        getGlobalDataDir()
      );
      const result = await this.applyPlannedArchive(plan, {
        mergeConfirmed: !!options.yes,
      });
      if (result.status !== 'complete') {
        if (!result.manualRecoveryAction) {
          result.recoveryCommand =
            `rasen archive --apply-plan ${options.applyPlan} --yes` +
            (json ? ' --json' : '');
        }
        process.exitCode = 1;
      }
      if (json) {
        console.log(
          JSON.stringify(
            { archive: { mode: 'apply', result } },
            null,
            2
          )
        );
        return;
      }
      if (result.status === 'complete') {
        console.log(`Change '${result.change}' archived as '${path.basename(result.path)}'.`);
      } else {
        for (const item of result.blockers) {
          console.log(`${item.operation}: ${item.message}`);
        }
        if (result.manualRecoveryAction) {
          console.log(`Manual recovery: ${result.manualRecoveryAction.guidance}`);
        } else {
          console.log(`Recovery: ${result.recoveryCommand}`);
        }
      }
    } catch (error) {
      const diagnostic = toArchiveDiagnostic(error);
      if (json) {
        this.printJsonFailure(undefined, diagnostic);
        return;
      }
      throw error;
    }
  }

  private printJsonFailure(
    root: ResolvedOpenSpecRoot | undefined,
    diagnostic: ArchiveDiagnostic,
    plan?: ArchivePlan
  ): void {
    console.log(
      JSON.stringify(
        {
          archive: null,
          ...(plan ? { plan } : {}),
          ...(root ? { root: toRootOutput(root) } : {}),
          status: [diagnostic],
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }

  protected applyPlannedArchive(
    plan: ArchivePlan,
    options?: ApplyArchiveOptions
  ): Promise<ArchiveApplyResult> {
    return applyArchive(plan, defaultArchiveEngineAdapters, options);
  }

  private async failHuman(message: string, abort = true): Promise<null> {
    console.log(message);
    if (abort) console.log('Aborted. No files were changed.');
    process.exitCode = 1;
    return null;
  }

  private async run(
    requestedChange: string | undefined,
    options: ArchiveOptions,
    root: ResolvedOpenSpecRoot,
    json: boolean
  ): Promise<ArchiveResult | null> {
    let changeName = requestedChange;
    const changesDir = root.changesDir;
    if (!changeName) {
      if (json) {
        throw new ArchiveBlockedError(
          'archive_change_name_required',
          'A change name is required: archive --json is non-interactive.',
          withStoreFlag(root, 'rasen archive <change-name> --json')
        );
      }
      const selected = await this.selectChange(changesDir);
      if (!selected) {
        console.log('No change selected. Aborting.');
        return null;
      }
      changeName = selected;
    }

    const changeDir = path.join(changesDir, changeName);
    let sourceAvailable = true;
    try {
      const stat = await fs.lstat(changeDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        sourceAvailable = false;
      }
    } catch {
      sourceAvailable = false;
    }

    let compatibilityDiagnostic: ArchiveDiagnostic | undefined;
    if (!sourceAvailable) {
      const available = await listActiveChangeNames(changesDir);
      compatibilityDiagnostic = new ArchiveBlockedError(
        'archive_change_not_found',
        available.length > 0
          ? `Change '${changeName}' not found. Available changes: ${available.join(', ')}`
          : `Change '${changeName}' not found. No active changes exist in this root.`
      ).diagnostic;
    }

    if (options.intentTemplate) {
      if (!sourceAvailable) {
        throw new ArchiveBlockedError(
          compatibilityDiagnostic!.code,
          compatibilityDiagnostic!.message,
          compatibilityDiagnostic!.fix
        );
      }
      const intent = await createArchiveIntentTemplate(changeDir, changeName);
      if (!json) {
        console.log(JSON.stringify(intent, null, 2));
        return null;
      }
      return {
        change: changeName,
        archivedAs: '',
        path: changeDir,
        specsUpdated: false,
        mode: 'intent-template',
        intent,
      };
    }

    // Whitespace preflight. Runs here — after the change is known, before any
    // staging, copy, or evidence hash — because the archive engine preserves
    // bytes on purpose and records a sha256 per evidence file. Once artifacts
    // are absorbed, fixing one means re-running the whole archive to keep the
    // accounting self-consistent. Report only; never rewrite.
    if (sourceAvailable && options.whitespaceCheck !== false) {
      const violations = await scanDirectoryForWhitespaceViolations(changeDir);
      if (violations.length > 0) {
        throw new ArchiveBlockedError(
          'archive_whitespace_errors',
          formatWhitespaceViolations(violations)
        );
      }
    }

    const archiveParent = resolveArchiveDestination(root.path).archiveDir;
    const planningBlockers: ArchivePlan['blockers'] = [];
    let workDir: string | null = null;
    try {
      workDir = await resolveChangeWorkDir(root.path, changeName, { ensure: false });
    } catch (error) {
      planningBlockers.push({
        operation: 'timing',
        path: changeDir,
        ...(errorCode(error) ? { code: errorCode(error) } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    let timing: ArchivePlan['decisions']['timing']['mode'] = 'on-merge';
    try {
      timing = resolveArchiveTiming(readProjectConfig(root.path));
    } catch (error) {
      planningBlockers.push({
        operation: 'timing',
        path: root.path,
        ...(errorCode(error) ? { code: errorCode(error) } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    let deliveryMode: ArchivePlan['decisions']['timing']['deliveryMode'] = null;
    try {
      deliveryMode = await readShipLogDeliveryMode(workDir, changeDir);
    } catch (error) {
      planningBlockers.push({
        operation: 'timing',
        path: changeDir,
        ...(errorCode(error) ? { code: errorCode(error) } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (
      !options.yes &&
      timing === 'on-merge' &&
      deliveryMode === 'pr'
    ) {
      const message = `Change '${changeName}' shipped via a pull request under on-merge archive timing; the CLI cannot verify the merge itself.`;
      const fix =
        'Use the archive skill (/rasen-archive-change), which checks the PR merge state, or apply the saved plan with --yes after confirming the merge yourself.';
      if (!json && !options.dryRun) {
        console.log(chalk.yellow(`\nWarning: ${message}`));
        console.log(chalk.yellow(fix));
      }
    }

    const skipValidation = options.validate === false || options.noValidate === true;
    let validationDecision: ArchivePlan['decisions']['validation'] =
      skipValidation ? 'skipped' : 'passed';
    if (!sourceAvailable) {
      validationDecision = 'blocked';
    } else if (!skipValidation) {
      try {
        const validationPassed = await this.validateActiveChange(changeDir, json);
        if (!validationPassed) {
          validationDecision = 'blocked';
          compatibilityDiagnostic ??= new ArchiveBlockedError(
            'archive_validation_failed',
            `Validation failed for change '${changeName}'.`,
            `Run ${withStoreFlag(root, `rasen validate ${changeName}`)} for details, fix the errors, or rerun with --no-validate.`
          ).diagnostic;
        }
      } catch (error) {
        validationDecision = 'blocked';
        planningBlockers.push({
          operation: 'validation',
          path: changeDir,
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (!options.yes && !json && !options.dryRun) {
      const { confirm } = await import('@inquirer/prompts');
      const proceed = await confirm({
        message: chalk.yellow(
          'Warning: Skipping validation may archive invalid specs. Continue? (y/N)'
        ),
        default: false,
      });
      if (!proceed) {
        console.log('Archive cancelled.');
        return null;
      }
    }
    if (skipValidation && !json) {
      console.log(
        chalk.yellow('\nWarning: Skipping validation may archive invalid specs.')
      );
      console.log(
        chalk.yellow(
          `[${new Date().toISOString()}] Validation skipped for change: ${changeName}`
        )
      );
      console.log(chalk.yellow(`Affected files: ${changeDir}`));
    }

    let progress = { total: 0, completed: 0 };
    try {
      progress = await getTaskProgressForChange(
        changesDir,
        changeName,
        path.resolve(changesDir, '..', '..')
      );
    } catch (error) {
      planningBlockers.push({
        operation: 'tasks',
        path: changeDir,
        ...(errorCode(error) ? { code: errorCode(error) } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!json) console.log(`Task status: ${formatTaskStatus(progress)}`);
    const incompleteTasks = Math.max(progress.total - progress.completed, 0);
    let tasksOverride = !!options.yes;
    if (incompleteTasks > 0 && !options.yes) {
      compatibilityDiagnostic ??= new ArchiveBlockedError(
        'archive_tasks_incomplete',
        `${incompleteTasks} incomplete task(s) found for change '${changeName}'.`,
        'Complete the tasks or rerun with --yes.'
      ).diagnostic;
    }
    if (incompleteTasks > 0 && !options.yes && !json && !options.dryRun) {
      const { confirm } = await import('@inquirer/prompts');
      const proceed = await confirm({
        message: `Warning: ${incompleteTasks} incomplete task(s) found. Continue?`,
        default: false,
      });
      if (!proceed) {
        console.log('Archive cancelled.');
        tasksOverride = false;
      } else {
        tasksOverride = true;
      }
    } else if (incompleteTasks > 0 && !json) {
      console.log(
        `Warning: ${incompleteTasks} incomplete task(s) found. Continuing due to --yes flag.`
      );
    }

    const preparationBlockers: ArchivePlan['blockers'] = [...planningBlockers];
    let specActions: PreparedArchiveSpecAction[] = [];
    try {
      if (!sourceAvailable) {
        specActions = [];
      } else {
        specActions = await this.prepareSpecActions(
          changeDir,
          root.specsDir,
          changeName,
          options,
          root,
          json,
          skipValidation
        );
      }
    } catch (error) {
      const diagnostic = toArchiveDiagnostic(error);
      preparationBlockers.push({
        operation: 'spec',
        path: changeDir,
        code: diagnostic.code,
        message:
          diagnostic.code === 'archive_spec_validation_failed'
            ? diagnostic.message.replace(/ No files were changed\.$/, '')
            : diagnostic.message,
      });
      if (error instanceof ArchiveBlockedError) {
        compatibilityDiagnostic ??= diagnostic;
      }
      specActions = [];
    }

    const executionRoot = resolveExecutionRoot(root.path, {
      storeSelected: isStoreSelectedRoot(root),
      cwd: process.cwd(),
    });
    const sidecar = sourceAvailable
      ? await resolveArchiveSidecar(
          changeDir,
          executionRoot,
          changeName,
          undefined,
          options.intentFile
        )
      : {
          status: 'absent' as const,
          schemaVersion: null,
          change: null,
          disposition: 'unjudged-preserve-all' as const,
          handoff: {
            complete: null,
            decisions: [],
            inventory: [],
          },
          probes: [],
          blockers: [],
        };
    let shipLog: ArchivePlan['shipLog'] = {
      source: null,
      sha256: null,
      recordedCommit: null,
    };
    if (sourceAvailable) {
      try {
        shipLog = await resolveShipLogPlan(workDir, changeDir);
      } catch (error) {
        preparationBlockers.push({
          operation: 'evidence',
          path: changeDir,
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const plan = await createArchivePlan({
      change: changeName,
      planningRoot: root.path,
      executionRoot,
      activePath: changeDir,
      archiveParent,
      ephemeraPath: ephemeraDir(executionRoot, changeName),
      date: this.getArchiveDate(),
      keepEphemera: !!options.keepEphemera,
      validation: validationDecision,
      tasks: {
        total: progress.total,
        completed: progress.completed,
        override: tasksOverride,
      },
      timing: {
        mode: timing,
        deliveryMode,
        override: !!options.yes,
      },
      specActions,
      preparationBlockers,
      sidecar,
      shipLog,
    });

    if (options.dryRun) {
      const planToken = options.savePlan
        ? await persistArchivePlan(plan, getGlobalDataDir())
        : undefined;
      return this.renderDryRun(plan, json, planToken);
    }
    if (!plan.complete || plan.blockers.length > 0) {
      const message = plan.blockers
        .map(item => `${item.operation}: ${item.message}`)
        .join('; ');
      if (!json) {
        const targetBlocker = plan.blockers.find(
          item => item.operation === 'target-lstat' && item.code === 'EEXIST'
        );
        if (targetBlocker) {
          throw new ArchiveBlockedError(
            'archive_target_exists',
            `Archive '${path.basename(plan.paths.final)}' already exists.`
          );
        }
        return this.failHuman(message);
      }
      process.exitCode = 1;
      return {
        change: changeName,
        archivedAs: path.basename(plan.paths.final),
        path: plan.paths.final,
        specsUpdated: false,
        totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
        ephemeraDiscarded: [],
        ephemeraPreserved: plan.cleaner.effectivePreserve,
        ephemeraAborted: plan.cleaner.classification.aborted,
        ...(plan.cleaner.classification.abortReason
          ? { ephemeraAbortReason: plan.cleaner.classification.abortReason }
          : {}),
        plan,
        transactionId: plan.transactionId,
        planHash: plan.planHash,
        journalPath: plan.paths.journal,
        blockers: plan.blockers,
        status: 'blocked',
        ...(compatibilityDiagnostic ? { compatibilityDiagnostic } : {}),
      };
    }

    // Capture the active Change identity before the archive transaction removes
    // its source. The association ledger uses this to distinguish a later
    // same-name recreation from the archived instance.
    let preArchivePhysical: ReturnType<typeof readPhysicalIdentity> | undefined;
    try {
      const activeStat = await fs.stat(changeDir, { bigint: true });
      preArchivePhysical = readPhysicalIdentity({
        device: activeStat.dev,
        ino: activeStat.ino,
        birthtimeMs: activeStat.birthtimeMs,
      });
    } catch {
      // Association bookkeeping is best-effort for pre-registry projects.
    }

    const result = await this.applyPlannedArchive(plan);
    if (result.status !== 'complete') {
      const message =
        result.blockers.map(item => `${item.operation}: ${item.message}`).join('; ') ||
        'Archive transaction did not complete.';
      if (json) {
        process.exitCode = 1;
        return {
          change: changeName,
          archivedAs: path.basename(result.path),
          path: result.path,
          specsUpdated: result.specsUpdated,
          totals: result.totals,
          ephemeraDiscarded: result.ephemeraDiscarded,
          ephemeraPreserved: result.ephemeraPreserved,
          transactionId: result.transactionId,
          planHash: result.planHash,
          journalPath: result.journalPath,
          blockers: result.blockers,
          status: result.status,
          result,
        };
      }
      console.log(message);
      console.log(`Recovery journal: ${result.journalPath}`);
      if (result.manualRecoveryAction) {
        console.log(`Manual recovery: ${result.manualRecoveryAction.guidance}`);
      }
      process.exitCode = 1;
      return null;
    }
    // The recoverable archive transaction is authoritative for filesystem
    // publication. Update 0.2.0's association ledger only after it completes.
    if (preArchivePhysical) {
      try {
        const projectHome = await resolveProjectHome(root.path, { ensure: false });
        if (projectHome) {
          const planningSpaceId = derivePlanningSpaceId(projectHome.name) as never;
          const ledgerStore = createAssociationLedgerStore({
            homeDir: projectHome.homeDir,
            planningSpaceId,
            projectId: projectHome.projectId,
          });
          const alias = `changes/${changeName}`;
          const archiveAlias = `changes/archive/${path.basename(result.path)}`;
          const active = ledgerStore.resolveActiveAssociation(changeName);
          if (active) {
            ledgerStore.archive({
              changeId: changeName,
              instanceId: active.instanceId,
              activeAlias: alias,
              archiveAlias,
              physicalIdentity: preArchivePhysical,
            });
          }
        }
      } catch {
        /* registry bookkeeping is best-effort; archive still succeeds */
      }
    }

    if (!json) {
      if (result.specsUpdated) {
        for (const action of plan.specActions) {
          if (action.action === 'delete') {
            console.log(
              `Deleting spec '${action.capability}' — all requirements removed by this change.`
            );
          }
        }
        console.log(
          `Totals: + ${result.totals.added}, ~ ${result.totals.modified}, - ${result.totals.removed}, → ${result.totals.renamed}`
        );
        console.log('Specs updated successfully.');
      }
      if (result.ephemeraDiscarded.length > 0) {
        console.log(
          `Ephemera cleaner: deleted ${result.ephemeraDiscarded.length} file(s).`
        );
      }
      console.log(
        `Change '${changeName}' archived as '${path.basename(result.path)}'.`
      );
    }
    return {
      change: changeName,
      archivedAs: path.basename(result.path),
      path: result.path,
      specsUpdated: result.specsUpdated,
      ...(options.whitespaceCheck === false ? { whitespaceCheckSkipped: true } : {}),
      totals: result.totals,
      ephemeraDiscarded: result.ephemeraDiscarded,
      ephemeraPreserved: result.ephemeraPreserved,
      ephemeraAborted: plan.cleaner.classification.aborted,
      ...(plan.cleaner.classification.abortReason
        ? { ephemeraAbortReason: plan.cleaner.classification.abortReason }
        : {}),
      transactionId: result.transactionId,
      planHash: result.planHash,
      journalPath: result.journalPath,
      blockers: [],
    };
  }

  private async validateActiveChange(changeDir: string, json: boolean): Promise<boolean> {
    const validator = new Validator();
    if (!json) {
      const proposal = path.join(changeDir, 'proposal.md');
      try {
        await fs.access(proposal);
        const report = await validator.validateChange(proposal);
        if (!report.valid) {
          console.log(chalk.yellow('\nProposal warnings in proposal.md (non-blocking):'));
          for (const issue of report.issues) {
            console.log(chalk.yellow(`  - ${issue.message}`));
          }
        }
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    }

    const specsRoot = path.join(changeDir, 'specs');
    let hasDeltaSpecs = false;
    try {
      const capabilities = await fs.readdir(specsRoot, { withFileTypes: true });
      for (const capability of capabilities) {
        if (!capability.isDirectory()) continue;
        try {
          const content = await fs.readFile(
            path.join(specsRoot, capability.name, 'spec.md'),
            'utf8'
          );
          if (
            /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/m.test(content)
          ) {
            hasDeltaSpecs = true;
            break;
          }
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    if (!hasDeltaSpecs) return true;
    const report = await validator.validateChangeDeltaSpecs(changeDir);
    if (report.valid) return true;
    if (!json) {
      console.log(chalk.red('\nValidation errors in change delta specs:'));
      for (const issue of report.issues) {
        console.log(
          issue.level === 'ERROR'
            ? chalk.red(`  - ${issue.message}`)
            : chalk.yellow(`  - ${issue.message}`)
        );
      }
    }
    return false;
  }

  private async prepareSpecActions(
    changeDir: string,
    mainSpecsDir: string,
    changeName: string,
    options: ArchiveOptions,
    root: ResolvedOpenSpecRoot,
    json: boolean,
    skipValidation: boolean
  ): Promise<PreparedArchiveSpecAction[]> {
    if (options.skipSpecs) {
      if (!json) console.log('Skipping spec updates (--skip-specs flag provided).');
      return [];
    }
    let updates: Awaited<ReturnType<typeof findSpecUpdates>>;
    try {
      updates = await findSpecUpdates(changeDir, mainSpecsDir);
    } catch (error) {
      throw new ArchiveBlockedError(
        'archive_spec_update_failed',
        error instanceof Error ? error.message : String(error),
        'Fix the change delta specs and rerun. No files were changed.'
      );
    }
    if (updates.length === 0) return [];
    if (!json) {
      console.log('\nSpecs to update:');
      for (const update of updates) {
        console.log(
          `  ${path.basename(path.dirname(update.target))}: ${
            update.exists ? 'update' : 'create'
          }`
        );
      }
    }

    if (!options.dryRun && !options.yes) {
      if (json) {
        throw new ArchiveBlockedError(
          'archive_confirmation_required',
          `Updating ${updates.length} spec(s) requires confirmation: rerun with --yes.`,
          withStoreFlag(root, 'rasen archive <change-name> --json --yes')
        );
      }
      const { confirm } = await import('@inquirer/prompts');
      const proceed = await confirm({
        message: 'Proceed with spec updates?',
        default: true,
      });
      if (!proceed) {
        console.log('Skipping spec updates. Proceeding with archive.');
        return [];
      }
    }

    const actions: PreparedArchiveSpecAction[] = [];
    try {
      for (const update of updates) {
        const built = await buildUpdatedSpec(update, changeName, { silent: json });
        const capability = path.basename(path.dirname(update.target));
        if (!skipValidation && !built.emptied) {
          const report = await new Validator().validateSpecContent(
            capability,
            built.rebuilt
          );
          if (!report.valid) {
            if (!json) {
              console.log(
                chalk.red(
                  `\nValidation errors in rebuilt spec for ${capability} (will not write changes):`
                )
              );
              for (const issue of report.issues) {
                console.log(
                  issue.level === 'ERROR'
                    ? chalk.red(`  - ${issue.message}`)
                    : chalk.yellow(`  - ${issue.message}`)
                );
              }
            }
            throw new ArchiveBlockedError(
              'archive_spec_validation_failed',
              `Rebuilt spec for '${capability}' failed validation. No files were changed.`,
              `Run ${withStoreFlag(root, `rasen validate ${capability}`)} after fixing the change deltas.`
            );
          }
        }
        const source = await fs.readFile(update.source);
        let targetPrecondition: PreparedArchiveSpecAction['targetPrecondition'] = {
          state: 'absent',
        };
        try {
          targetPrecondition = {
            state: 'file',
            sha256: createHash('sha256')
              .update(await fs.readFile(update.target))
              .digest('hex'),
          };
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
        actions.push({
          capability,
          action: built.emptied ? 'delete' : update.exists ? 'update' : 'create',
          source: update.source,
          target: update.target,
          sourceSha256: createHash('sha256').update(source).digest('hex'),
          targetPrecondition,
          rebuilt: built.rebuilt,
          counts: built.counts,
        });
      }
      return actions.sort((left, right) => left.target.localeCompare(right.target));
    } catch (error) {
      if (error instanceof ArchiveBlockedError) throw error;
      throw new ArchiveBlockedError(
        'archive_spec_update_failed',
        error instanceof Error ? error.message : String(error),
        'Fix the change delta specs and rerun. No files were changed.'
      );
    }
  }

  private renderDryRun(
    plan: ArchivePlan,
    json: boolean,
    planToken?: string
  ): ArchiveResult | null {
    const specSyncPlan = plan.specActions.map(action => ({
      capability: action.capability,
      status: action.action,
    }));
    if (!json) {
      console.log(chalk.cyan(`\n=== Archive dry-run for '${plan.change}' ===`));
      console.log(`Planned archive: ${path.basename(plan.paths.final)}`);
      console.log(`Transaction: ${plan.transactionId}`);
      console.log(`Plan hash: ${plan.planHash}`);
      if (planToken) console.log(`Plan token: ${planToken}`);
      console.log(
        `Spec sync plan: ${
          specSyncPlan.length === 0
            ? '(none)'
            : specSyncPlan
                .map(item => `${item.capability}: ${item.status}`)
                .join(', ')
        }`
      );
      console.log(`Sidecar: ${plan.sidecar.status}; ${plan.sidecar.disposition}`);
      console.log(
        `Ephemera pending-delete (${plan.cleaner.effectiveDelete.length}): ${
          plan.cleaner.effectiveDelete.join(', ') || '(none)'
        }`
      );
      console.log(
        `Ephemera preserved (${plan.cleaner.effectivePreserve.length}): ${
          plan.cleaner.effectivePreserve.join(', ') || '(none)'
        }`
      );
      if (plan.blockers.length > 0) {
        console.log(chalk.red('Blocking conditions:'));
        for (const item of plan.blockers) {
          console.log(chalk.red(`  - ${item.operation}: ${item.message}`));
        }
      }
      console.log(chalk.cyan('Authoritative serialized plan:'));
      console.log(JSON.stringify(plan, null, 2));
      console.log(
        chalk.cyan(
          planToken
            ? 'No project files were moved, deleted, or written; the immutable plan was saved in the machine transaction store.'
            : 'No files were moved, deleted, or written.'
        )
      );
      if (!plan.complete || plan.blockers.length > 0) process.exitCode = 1;
      return null;
    }
    if (!plan.complete || plan.blockers.length > 0) process.exitCode = 1;
    return {
      change: plan.change,
      archivedAs: path.basename(plan.paths.final),
      path: plan.paths.final,
      specsUpdated: false,
      dryRun: true,
      specSyncPlan,
      ephemeraDiscarded: plan.cleaner.effectiveDelete,
      ephemeraPreserved: plan.cleaner.effectivePreserve,
      ephemeraAborted: plan.cleaner.classification.aborted,
      ...(plan.cleaner.classification.abortReason
        ? { ephemeraAbortReason: plan.cleaner.classification.abortReason }
        : {}),
      plan,
      ...(planToken ? { planToken } : {}),
      transactionId: plan.transactionId,
      planHash: plan.planHash,
      journalPath: plan.paths.journal,
      blockers: plan.blockers,
    };
  }

  private async selectChange(changesDir: string): Promise<string | null> {
    const { select } = await import('@inquirer/prompts');
    const names = await listActiveChangeNames(changesDir);
    if (names.length === 0) {
      console.log('No active changes found.');
      return null;
    }
    let choices = names.map(name => ({ name, value: name }));
    try {
      const progress = await Promise.all(
        names.map(async id => ({
          id,
          status: formatTaskStatus(
            await getTaskProgressForChange(
              changesDir,
              id,
              path.resolve(changesDir, '..', '..')
            )
          ),
        }))
      );
      const width = Math.max(...progress.map(item => item.id.length));
      choices = progress.map(item => ({
        name: `${item.id.padEnd(width)}     ${item.status}`,
        value: item.id,
      }));
    } catch {
      // The simple name choices remain usable.
    }
    try {
      return await select({ message: 'Select a change to archive', choices });
    } catch {
      return null;
    }
  }

  private getArchiveDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
