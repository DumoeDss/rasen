import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import {
  applyArchive,
  createArchiveIntentTemplate,
  createArchivePlan,
  loadStoredArchivePlan,
  persistArchivePlan,
  resolveArchiveSidecar,
  type ArchiveApplyResult,
  type ArchiveIntentV1,
  type ArchivePlan,
  type PreparedArchiveSpecAction,
} from './archive-engine.js';
import { getGlobalDataDir } from './global-config.js';
import { resolveChangeWorkDir } from './change-work.js';
import { ephemeraDir, evidenceDir } from './file-placement.js';
import { resolveArchiveTiming } from './project-config.js';
import {
  emitStoreRootBanner,
  isRootSelectionError,
  readResolvedProjectConfig,
  resolvedExecutionProjectRoot,
  resolveOpenSpecRoot,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
} from './root-selection.js';
import { buildUpdatedSpec, findSpecUpdates } from './specs-apply.js';
import { classifyStoreRootLayout } from './store/layout-write-guard.js';
import {
  ChangeFinalizationModuleInstance,
  isChangeFinalizationError,
  resolveFinalizationOutcomeRequest,
  type FinalizationResult,
  type ImmutableFinalizationPlan,
} from './store/finalization/index.js';
import { Validator } from './validation/validator.js';

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
  /** Store v2 finalization: the one explicitly declared terminal state. */
  outcome?: string;
  reason?: string;
  by?: string;
  byTargetLine?: string;
  commit?: string;
  noValidate?: boolean;
  validate?: boolean;
  json?: boolean;
  store?: string;
  project?: string;
  targetLine?: string;
  storePath?: string;
  keepEphemera?: boolean;
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
 * The finalization options are meaningful only in a Store v2 project scope.
 * Outside one they are REJECTED rather than silently ignored — archiving while
 * discarding a declared outcome would be the worst possible reading of them.
 */
function inapplicableFinalizationOptions(
  root: ResolvedOpenSpecRoot,
  options: ArchiveOptions
): ArchiveDiagnostic | null {
  if (root.planningScope?.kind === 'store-project') return null;
  const supplied = (
    [
      ['--outcome', options.outcome],
      ['--reason', options.reason],
      ['--by', options.by],
      ['--by-target-line', options.byTargetLine],
      ['--commit', options.commit],
    ] as const
  )
    .filter(([, value]) => value !== undefined)
    .map(([flag]) => flag);
  if (supplied.length === 0) return null;
  return {
    severity: 'error',
    code: 'finalization_scope_unsupported',
    message: `${supplied.join(', ')} apply only when archiving a Change in a Store v2 project scope; this scope is '${root.planningScope?.kind ?? 'standalone'}'.`,
    fix: 'Drop the finalization options. A standalone project and a legacy flat Store archive exactly as before, with no outcome required or recorded.',
  };
}

/**
 * The outcome request is decided FIRST in a Store v2 scope, before every other
 * precondition, because it needs no filesystem or Git access at all and the
 * contract says so: a missing outcome, or a contradictory combination, refuses
 * before anything is read.
 *
 * The store-lifecycle journey found this ordering: archiving from a Store
 * planning checkout reached `execution_authority_required` first, so a user who
 * had also forgotten `--outcome` was told about the wrong thing and the spec's
 * refusal was unreachable from that surface. The check is pure, so hoisting it
 * costs nothing and makes the diagnostic deterministic.
 */
function declaredOutcomeDiagnostic(
  root: ResolvedOpenSpecRoot,
  options: ArchiveOptions
): ArchiveDiagnostic | null {
  if (root.planningScope?.kind !== 'store-project') return null;
  if (options.intentTemplate === true || options.applyPlan !== undefined) return null;
  try {
    resolveFinalizationOutcomeRequest({
      ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...(options.by === undefined ? {} : { by: options.by }),
      ...(options.byTargetLine === undefined ? {} : { byTargetLine: options.byTargetLine }),
      ...(options.commit === undefined ? {} : { commit: options.commit }),
    });
    return null;
  } catch (error) {
    if (!isChangeFinalizationError(error)) throw error;
    return toArchiveDiagnostic(error);
  }
}

async function storeFinalizationDiagnostic(
  root: ResolvedOpenSpecRoot
): Promise<ArchiveDiagnostic | null> {
  // A Store v2 project scope is no longer refused here: it routes to the
  // change-finalization Module, which requires one explicitly declared outcome.
  //
  // A legacy flat Store's planning tree is READ-ONLY until it is migrated:
  // archiving writes into `rasen/changes/archive`, a namespace layout v2
  // retires, and the entry would then have to be relocated a second time by the
  // migration. The refusal ships together with the migration that makes it
  // survivable (`store-layout-v2-migration`, tasks 10b.1-10b.3).
  if (root.planningScope?.kind === 'legacy-store') {
    const storeId =
      root.planningScope.ref.mode === 'legacy-store'
        ? root.planningScope.ref.storeId
        : '<store-id>';
    return legacyFlatStoreArchiveRefusal(storeId);
  }
  if (root.planningScope !== undefined) return null;

  // No scope description at all. That is not "not a Store": ONLY the authoring
  // resolution attaches one, and `resolveOpenSpecRoot` deliberately hands every
  // legacy flat Store back through the frozen compatibility adapter, which
  // attaches none — through `--store`, through a `store:` pointer, and from
  // inside the Store checkout alike. Keying the refusal on the scope alone left
  // it unreachable: `rasen new change` refused while `rasen archive` still
  // wrote into the flat tree. Classify the root's own Store declaration
  // instead, which is the same fact the resolver would have reported.
  const classification = await classifyStoreRootLayout(root.path);
  return classification.kind === 'legacy-flat'
    ? legacyFlatStoreArchiveRefusal(root.storeId ?? classification.storeId ?? '<store-id>')
    : null;
}

/** The planning scope facts recorded on every plan this build creates. */
function archivePlanScope(root: ResolvedOpenSpecRoot): ArchivePlan['scope'] {
  const ref = root.planningScope?.ref;
  if (root.planningScope === undefined || ref === undefined) {
    return { kind: 'standalone' };
  }
  return {
    kind: root.planningScope.kind,
    ...(ref.mode === 'standalone' || ref.storeUid === undefined
      ? {}
      : { storeUid: ref.storeUid }),
    ...('projectId' in ref && ref.projectId !== undefined
      ? { projectId: ref.projectId }
      : {}),
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
  dryRun?: boolean;
  specSyncPlan?: Array<{ capability: string; status: string }>;
  /** Store v2 only: the finalization facts a landed or passive archive reports. */
  finalization?: {
    outcome: string;
    changeInstanceId: string;
    workspacePairId: string;
    targetLineId: string;
    publishedEntry: string;
    specSyncApplied: boolean;
    specSyncActionCount: number;
    provenCommit: string | null;
    codeRef: string | null;
    codeRefOid: string | null;
    associationPhase?: 'applied' | 'no-op';
    alreadyComplete?: boolean;
  };
  finalizationPlan?: ImmutableFinalizationPlan;
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

/**
 * Does the change carry delta specs at all? Decided independently of whether
 * spec actions were prepared, because `--skip-specs` suppresses preparation and
 * the landed record's assertion depends on the deltas EXISTING, not on whether
 * this invocation chose to apply them.
 */
async function changeHasDeltaSpecs(changeDir: string): Promise<boolean> {
  const specsRoot = path.join(changeDir, 'specs');
  let capabilities: import('node:fs').Dirent[];
  try {
    capabilities = await fs.readdir(specsRoot, { withFileTypes: true });
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return false;
  }
  for (const capability of capabilities) {
    if (!capability.isDirectory()) continue;
    try {
      const content = await fs.readFile(
        path.join(specsRoot, capability.name, 'spec.md'),
        'utf8'
      );
      if (/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/m.test(content)) {
        return true;
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  return false;
}

function finalizationFacts(
  result: FinalizationResult
): NonNullable<ArchiveResult['finalization']> {
  return {
    outcome: result.outcome,
    changeInstanceId: result.changeInstanceId,
    workspacePairId: result.workspacePairId,
    targetLineId: result.targetLineId,
    publishedEntry: result.publishedEntry,
    specSyncApplied: result.specSyncApplied,
    specSyncActionCount: result.specSyncActionCount,
    provenCommit: result.provenCommit,
    codeRef: result.codeRef,
    codeRefOid: result.codeRefOid,
    associationPhase: result.associationPhase,
  };
}

function toArchiveDiagnostic(error: unknown): ArchiveDiagnostic {
  if (error instanceof ArchiveBlockedError) return error.diagnostic;
  if (isRootSelectionError(error)) return error.diagnostic;
  if (isChangeFinalizationError(error)) {
    return {
      severity: 'error',
      code: error.finalizationCode,
      message: error.message,
      ...(error.diagnostic.fix === undefined ? {} : { fix: error.diagnostic.fix }),
    };
  }
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

export class ArchiveCommand {
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
        ...(options.targetLine !== undefined ? { targetLine: options.targetLine } : {}),
        ...(options.storePath !== undefined ? { storePath: options.storePath } : {}),
      });
    } catch (error) {
      if (json && isRootSelectionError(error)) {
        this.printJsonFailure(undefined, toArchiveDiagnostic(error));
        return;
      }
      throw error;
    }

    const finalizationDiagnostic =
      inapplicableFinalizationOptions(root, options) ??
      declaredOutcomeDiagnostic(root, options) ??
      (await storeFinalizationDiagnostic(root));
    if (finalizationDiagnostic) {
      if (json) {
        this.printJsonFailure(root, finalizationDiagnostic);
        return;
      }
      throw new ArchiveBlockedError(
        finalizationDiagnostic.code,
        finalizationDiagnostic.message,
        finalizationDiagnostic.fix
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
      // A stored Store v2 plan is REVALIDATED and applied, not refused. The
      // plan carries the finalization block, so the invoking directory and the
      // selectors that produced it cannot influence the outcome.
      if (plan.finalization !== undefined) {
        const finalization = await ChangeFinalizationModuleInstance.applyStoredPlan(plan);
        if (finalization.status !== 'complete') process.exitCode = 1;
        if (json) {
          console.log(
            JSON.stringify({ archive: { mode: 'apply', finalization } }, null, 2)
          );
          return;
        }
        console.log(
          finalization.status === 'complete'
            ? `Change '${finalization.changeId}' finalized as '${finalization.outcome}' at ${finalization.publishedEntry}.`
            : `Finalization did not complete (${finalization.status}); journal: ${finalization.journalPath}`
        );
        for (const item of finalization.blockers) {
          console.log(`${item.code}: ${item.message}`);
        }
        return;
      }
      const result = await this.applyPlannedArchive(plan);
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

  protected applyPlannedArchive(plan: ArchivePlan): Promise<ArchiveApplyResult> {
    return applyArchive(plan);
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
      const selected = await this.selectChange(root);
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

    const archiveParent = root.archiveDir;
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
      timing = resolveArchiveTiming(readResolvedProjectConfig(root));
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
        'Use the archive skill (/rasen-archive-change), which checks the PR merge state, or rerun with --yes after confirming the merge yourself.';
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
        path.resolve(changesDir, '..', '..'),
        root.schemasDir
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

    const executionRoot = resolvedExecutionProjectRoot(root);
    if (executionRoot === undefined) {
      throw new ArchiveBlockedError(
        'execution_authority_required',
        'Archive requires a verified execution checkout; planning scope alone is not writable.',
        'Run from an associated execution worktree and retry.'
      );
    }
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
    const planInputs = {
      change: changeName,
      planningRoot: root.path,
      executionRoot,
      scope: archivePlanScope(root),
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
    } as const;

    if (root.planningScope?.kind === 'store-project') {
      return this.runStoreV2Finalization(
        changeName,
        options,
        root,
        json,
        planInputs,
        sourceAvailable ? await changeHasDeltaSpecs(changeDir) : false
      );
    }

    const plan = await createArchivePlan(planInputs);

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

  /**
   * The Store v2 arm. Everything above this point is archive PREPARATION, which
   * is scope-independent; the outcome, the proof, the record, the destination,
   * the locks, and the association all live in the finalization Module. This
   * method formats and forwards — it holds no outcome logic.
   */
  private async runStoreV2Finalization(
    changeName: string,
    options: ArchiveOptions,
    root: ResolvedOpenSpecRoot,
    json: boolean,
    planInputs: {
      readonly planningRoot: string;
      readonly executionRoot: string;
      readonly scope: ArchivePlan['scope'];
      readonly activePath: string;
      readonly archiveParent: string;
      readonly ephemeraPath: string;
      readonly date: string;
      readonly keepEphemera: boolean;
      readonly validation: ArchivePlan['decisions']['validation'];
      readonly tasks: ArchivePlan['decisions']['tasks'];
      readonly timing: ArchivePlan['decisions']['timing'];
      readonly specActions: PreparedArchiveSpecAction[];
      readonly preparationBlockers: ArchivePlan['blockers'];
      readonly sidecar: Awaited<ReturnType<typeof resolveArchiveSidecar>>;
      readonly shipLog: ArchivePlan['shipLog'];
    },
    hasDeltaSpecs: boolean
  ): Promise<ArchiveResult | null> {
    const selection = root.planningScope?.followupSelection;
    const finalizationPlan = await ChangeFinalizationModuleInstance.plan({
      changeId: changeName,
      outcome: {
        ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.by === undefined ? {} : { by: options.by }),
        ...(options.byTargetLine === undefined
          ? {}
          : { byTargetLine: options.byTargetLine }),
        ...(options.commit === undefined ? {} : { commit: options.commit }),
      },
      ...(options.skipSpecs === undefined ? {} : { skipSpecs: options.skipSpecs }),
      startPath: planInputs.executionRoot,
      ...(selection === undefined ? {} : { selection }),
      archive: {
        planningRoot: planInputs.planningRoot,
        executionRoot: planInputs.executionRoot,
        activePath: planInputs.activePath,
        archiveParent: planInputs.archiveParent,
        ephemeraPath: planInputs.ephemeraPath,
        date: planInputs.date,
        keepEphemera: planInputs.keepEphemera,
        validation: planInputs.validation,
        tasks: planInputs.tasks,
        timing: planInputs.timing,
        specActionCandidates: planInputs.specActions,
        hasDeltaSpecs,
        sidecar: planInputs.sidecar,
        shipLog: planInputs.shipLog,
        scope: planInputs.scope,
        preparationBlockers: planInputs.preparationBlockers,
      },
    });

    if (options.dryRun) {
      const planToken = options.savePlan
        ? await persistArchivePlan(finalizationPlan.archivePlan, getGlobalDataDir())
        : undefined;
      return this.renderFinalizationDryRun(finalizationPlan, json, planToken);
    }

    // Re-finalizing a finalized Change is not a second outcome: report the
    // recorded one and stop cleanly, writing nothing.
    if (finalizationPlan.alreadyComplete) {
      const facts = {
        outcome: finalizationPlan.outcome,
        changeInstanceId: finalizationPlan.changeInstanceId,
        workspacePairId: finalizationPlan.workspacePairId,
        targetLineId: finalizationPlan.scope.targetLineId,
        publishedEntry: finalizationPlan.destination,
        specSyncApplied: finalizationPlan.outcome === 'landed',
        specSyncActionCount:
          finalizationPlan.outcome === 'landed' ? finalizationPlan.specActions.length : 0,
        provenCommit: null,
        codeRef: finalizationPlan.targetLine.codeRef,
        codeRefOid: finalizationPlan.targetLine.codeRefOid,
        alreadyComplete: true,
      };
      if (!json) {
        console.log(
          `Change '${changeName}' is already finalized; nothing was recorded a second time.`
        );
      }
      return {
        change: changeName,
        archivedAs: path.basename(finalizationPlan.destination),
        path: finalizationPlan.destination,
        specsUpdated: false,
        finalization: facts,
      };
    }

    if (!finalizationPlan.applicable) {
      const first = finalizationPlan.blockers[0];
      const diagnostic: ArchiveDiagnostic = {
        severity: 'error',
        code: first?.code ?? 'archive_plan_blocked',
        message: first?.message ?? 'The finalization plan is incomplete.',
        ...(first?.fix === undefined ? {} : { fix: first.fix }),
      };
      if (json) {
        this.printJsonFailure(root, diagnostic, finalizationPlan.archivePlan);
        return null;
      }
      for (const blocker of finalizationPlan.blockers) {
        console.log(`${blocker.code}: ${blocker.message}`);
      }
      throw new ArchiveBlockedError(diagnostic.code, diagnostic.message, diagnostic.fix);
    }

    const result = await ChangeFinalizationModuleInstance.applyStoredPlan(
      finalizationPlan.archivePlan,
      finalizationPlan.token
    );
    if (result.status !== 'complete') process.exitCode = 1;
    const facts = finalizationFacts(result);
    if (!json) {
      if (result.status === 'complete') {
        console.log(
          `Change '${changeName}' finalized as '${result.outcome}' at ${result.publishedEntry}.`
        );
        console.log(
          `Change instance: ${result.changeInstanceId}; workspace pair: ${result.workspacePairId}; target line: ${result.targetLineId}.`
        );
        console.log(
          `Spec sync: ${result.specSyncApplied ? 'applied' : 'not applied'} (${result.specSyncActionCount} action(s)).`
        );
        if (result.provenCommit !== null) {
          console.log(
            `Proven commit ${result.provenCommit} reachable from ${result.codeRef} (${result.codeRefOid ?? 'local ref'}) as it stands locally; nothing was fetched.`
          );
        }
        console.log(`Association phase: ${result.associationPhase}.`);
      } else {
        console.log(`Finalization did not complete (${result.status}).`);
        console.log(`Recovery journal: ${result.journalPath}`);
      }
    }
    return {
      change: changeName,
      archivedAs: path.basename(result.publishedEntry),
      path: result.publishedEntry,
      specsUpdated: result.specSyncApplied,
      finalization: facts,
      transactionId: result.transactionId,
      journalPath: result.journalPath,
      status: result.status,
    };
  }

  private renderFinalizationDryRun(
    plan: ImmutableFinalizationPlan,
    json: boolean,
    planToken?: string
  ): ArchiveResult | null {
    if (!plan.applicable) process.exitCode = 1;
    if (!json) {
      console.log(chalk.cyan(`\n=== Finalization dry-run for '${plan.changeId}' ===`));
      console.log(`Outcome: ${plan.outcome}`);
      console.log(`Planned entry: ${plan.destination}`);
      console.log(`Change instance: ${plan.changeInstanceId}`);
      console.log(`Workspace pair: ${plan.workspacePairId}`);
      console.log(`Target line: ${plan.scope.targetLineId} (${plan.targetLine.storeRef})`);
      console.log(`Plan id: ${plan.planId}`);
      if (planToken) console.log(`Plan token: ${planToken}`);
      console.log(
        `Spec sync: ${
          plan.outcome === 'landed'
            ? `${plan.specActions.length} action(s)`
            : 'not applied (passive outcome)'
        }`
      );
      if (plan.blockers.length > 0) {
        console.log(chalk.red('Blocking conditions:'));
        for (const blocker of plan.blockers) {
          console.log(chalk.red(`  - ${blocker.code}: ${blocker.message}`));
        }
      }
      console.log(chalk.cyan('Immutable finalization plan:'));
      console.log(JSON.stringify(plan, null, 2));
      console.log(chalk.cyan('No files were moved, deleted, or written.'));
      return null;
    }
    return {
      change: plan.changeId,
      archivedAs: path.basename(plan.destination),
      path: plan.destination,
      specsUpdated: false,
      dryRun: true,
      finalizationPlan: plan,
      plan: plan.archivePlan,
      ...(planToken ? { planToken } : {}),
      transactionId: plan.archivePlan.transactionId,
      planHash: plan.archivePlan.planHash,
      journalPath: plan.archivePlan.paths.journal,
      blockers: plan.archivePlan.blockers,
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

  private async selectChange(root: ResolvedOpenSpecRoot): Promise<string | null> {
    const { select } = await import('@inquirer/prompts');
    const changesDir = root.changesDir;
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
              root.path,
              root.schemasDir
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
