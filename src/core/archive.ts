import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

import { getTaskProgressForChange, formatTaskStatus } from '../utils/task-progress.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import {
  applyArchive,
  abortArchivePlan,
  inspectArchiveApplyPlan,
  hasReservedArchiveShipLogSection,
  createArchiveIntentTemplate,
  createArchivePlan,
  loadStoredArchivePlan,
  loadCompletedArchiveAbort,
  persistArchivePlan,
  resolveArchiveSidecar,
  type ArchiveApplyOptions,
  type ArchiveApplyResult,
  type ArchiveAbortResult,
  withStoredArchivePlanOperation,
  type ArchiveIntentV1,
  type ArchivePlan,
  type PreparedArchiveSpecAction,
  type ArchiveSpecSyncPreparation,
} from './archive-engine.js';
import { getCliLocale } from './cli-locale.js';
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
import {
  analyzeSpecUpdates,
  discoverDeltaSpecFiles,
  findSpecUpdates,
  SpecReconciliationError,
} from './specs-apply.js';
import { classifyStoreRootLayout } from './store/layout-write-guard.js';
import {
  ChangeFinalizationModuleInstance,
  isChangeFinalizationError,
  inspectFinalizationApplyPlan,
  resolveFinalizationOutcomeRequest,
  type FinalizationResult,
  type ImmutableFinalizationPlan,
} from './store/finalization/index.js';
import { Validator } from './validation/validator.js';

interface PreparedSpecActions {
  readonly actions: PreparedArchiveSpecAction[];
  readonly specSync: ArchiveSpecSyncPreparation;
}

interface ArchiveDisposition {
  readonly manualRecoveryAction?: { readonly guidance: string };
  readonly abortCommand?: string;
  readonly recoveryCommand?: string;
}

export function formatArchiveDispositionLine(
  disposition: ArchiveDisposition,
  locale: Parameters<typeof getLocaleCatalog>[0] = getCliLocale()
): string | null {
  const messages = getLocaleCatalog(locale).archiveAbort;
  if (disposition.manualRecoveryAction !== undefined) {
    return formatLocaleMessage(messages.manualRecoveryAction, {
      action: disposition.manualRecoveryAction.guidance,
    });
  }
  if (disposition.abortCommand !== undefined) {
    return formatLocaleMessage(messages.abortAction, {
      action: disposition.abortCommand,
    });
  }
  if (disposition.recoveryCommand !== undefined) {
    return formatLocaleMessage(messages.recoveryAction, {
      action: disposition.recoveryCommand,
    });
  }
  return null;
}

export function formatArchiveAbortBlockedLines(
  result: Pick<
    ArchiveAbortResult,
    | 'blockers'
    | 'effectivePhase'
    | 'retainedPaths'
    | 'manualRecoveryAction'
    | 'recoveryCommand'
  >,
  locale: Parameters<typeof getLocaleCatalog>[0] = getCliLocale()
): string[] {
  const messages = getLocaleCatalog(locale).archiveAbort;
  const lines = result.blockers.map(blocker =>
    formatLocaleMessage(messages.blocker, {
      code: blocker.code ?? blocker.operation,
      message: blocker.message,
      path: blocker.path,
    })
  );
  lines.push(
    formatLocaleMessage(messages.effectivePhase, {
      phase: result.effectivePhase ?? messages.effectivePhaseUnknown,
    })
  );
  if (result.retainedPaths === undefined || result.retainedPaths.length === 0) {
    lines.push(messages.retainedPathsNone);
  } else {
    for (const retainedPath of result.retainedPaths) {
      lines.push(
        formatLocaleMessage(messages.retainedPath, {
          path: retainedPath,
        })
      );
    }
  }
  const disposition = formatArchiveDispositionLine(result, locale);
  if (disposition !== null) lines.push(disposition);
  return lines;
}

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
  abortPlan?: string;
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
    associationPhase?: 'applied' | 'no-op' | 'pending';
    effectivePhase?: FinalizationResult['effectivePhase'];
    retainedPaths?: readonly string[];
    recoveryCommand?: string;
    abortCommand?: string;
    manualRecoveryAction?: ArchiveApplyResult['manualRecoveryAction'];
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
  recoveryCommand?: string;
  abortCommand?: string;
  manualRecoveryAction?: ArchiveApplyResult['manualRecoveryAction'];
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
 * Does the change carry any currently discoverable delta specs? Discovery
 * issues are already retained as typed preparation blockers; this presence
 * probe must not replace that aggregate with a second top-level exception.
 * The engine's exhaustive fingerprint/manifest gate independently fail-closes
 * files that appear or become invalid after preparation.
 */
async function changeHasDeltaSpecs(changeDir: string): Promise<boolean> {
  const discovery = await discoverDeltaSpecFiles(changeDir);
  return discovery.files.length > 0;
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
    ...(result.effectivePhase === undefined
      ? {}
      : { effectivePhase: result.effectivePhase }),
    ...(result.retainedPaths === undefined
      ? {}
      : { retainedPaths: result.retainedPaths }),
    ...(result.recoveryCommand === undefined
      ? {}
      : { recoveryCommand: result.recoveryCommand }),
    ...(result.abortCommand === undefined
      ? {}
      : { abortCommand: result.abortCommand }),
    ...(result.manualRecoveryAction === undefined
      ? {}
      : { manualRecoveryAction: result.manualRecoveryAction }),
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
  const code = errorCode(error);
  return {
    severity: 'error',
    code: code?.startsWith('archive_') ? code : 'archive_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

interface ShipLogInspection {
  shipLog: ArchivePlan['shipLog'];
  deliveryMode: ArchivePlan['decisions']['timing']['deliveryMode'];
}

async function inspectShipLog(
  workDir: string | null,
  changeDir: string
): Promise<ShipLogInspection> {
  const candidates = [
    path.join(evidenceDir(changeDir), 'ship-log.md'),
    ...(workDir ? [path.join(workDir, 'ship-log.md')] : []),
    path.join(changeDir, 'ship-log.md'),
  ];
  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate);
      const text = content.toString('utf8');
      const modeMatch = text.match(/\*\*Mode:\*\*\s*(pr|push|local)\b/);
      return {
        shipLog: {
          source: candidate,
          sha256: createHash('sha256').update(content).digest('hex'),
          recordedCommit:
            text.match(/^\*\*Commit:\*\*\s*([0-9a-f]{7,64})\s*$/im)?.[1] ??
            null,
          reservedSection: hasReservedArchiveShipLogSection(text),
        },
        deliveryMode: modeMatch
          ? (modeMatch[1] as 'pr' | 'push' | 'local')
          : null,
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
  return {
    shipLog: {
      source: null,
      sha256: null,
      recordedCommit: null,
      reservedSection: false,
    },
    deliveryMode: null,
  };
}

export class ArchiveCommand {
  async execute(changeName?: string, options: ArchiveOptions = {}): Promise<void> {
    const json = !!options.json;
    if (options.abortPlan !== undefined) {
      await this.abortStoredPlan(changeName, options, json);
      return;
    }
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

  private async abortStoredPlan(
    changeName: string | undefined,
    options: ArchiveOptions,
    json: boolean
  ): Promise<void> {
    const messages = getLocaleCatalog(getCliLocale()).archiveAbort;
    const conflictingOptions = [
      changeName !== undefined,
      options.applyPlan !== undefined,
      !!options.dryRun,
      !!options.savePlan,
      !!options.intentTemplate,
      options.intentFile !== undefined,
      !!options.skipSpecs,
      !!options.noValidate,
      options.validate === false,
      options.outcome !== undefined,
      options.reason !== undefined,
      options.by !== undefined,
      options.byTargetLine !== undefined,
      options.commit !== undefined,
      options.store !== undefined,
      options.project !== undefined,
      options.targetLine !== undefined,
      options.storePath !== undefined,
      !!options.keepEphemera,
    ];
    if (conflictingOptions.some(Boolean)) {
      const diagnostic = new ArchiveBlockedError(
        'archive_option_conflict',
        messages.optionConflict
      ).diagnostic;
      if (json) {
        this.printJsonFailure(undefined, diagnostic);
        return;
      }
      throw new ArchiveBlockedError(diagnostic.code, diagnostic.message);
    }
    if (options.yes !== true) {
      const diagnostic = new ArchiveBlockedError(
        'archive_abort_confirmation_required',
        messages.confirmationRequired,
        formatLocaleMessage(messages.confirmationFix, {
          token: options.abortPlan!,
        })
      ).diagnostic;
      if (json) {
        this.printJsonFailure(undefined, diagnostic);
        return;
      }
      throw new ArchiveBlockedError(
        diagnostic.code,
        diagnostic.message,
        diagnostic.fix
      );
    }

    try {
      const globalDataDir = getGlobalDataDir();
      let result: ArchiveAbortResult;
      try {
        const plan = await loadStoredArchivePlan(
          options.abortPlan!,
          globalDataDir
        );
        result =
          plan.finalization === undefined
            ? await withStoredArchivePlanOperation(
                plan,
                globalDataDir,
                'abort',
                () => abortArchivePlan(plan, globalDataDir)
              )
            : await ChangeFinalizationModuleInstance.abortStoredPlan(
                plan,
                globalDataDir
              );
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        const completed = await loadCompletedArchiveAbort(
          options.abortPlan!,
          globalDataDir
        );
        if (completed === null) throw error;
        result = completed;
      }
      if (result.status === 'blocked') process.exitCode = 1;
      if (json) {
        console.log(
          JSON.stringify({ archive: { mode: 'abort', result } }, null, 2)
        );
        return;
      }
      if (result.status === 'aborted') {
        console.log(
          formatLocaleMessage(messages.aborted, {
            transactionId: result.transactionId,
          })
        );
      } else if (result.status === 'already-aborted') {
        console.log(
          formatLocaleMessage(messages.alreadyAborted, {
            transactionId: result.transactionId,
          })
        );
      } else {
        console.log(
          formatLocaleMessage(messages.blocked, {
            transactionId: result.transactionId,
          })
        );
        if (result.associationPhase === 'pending') {
          console.log(messages.associationPending);
        }
        for (const line of formatArchiveAbortBlockedLines(result)) {
          console.log(line);
        }
      }
      if (result.status !== 'blocked' && result.associationPhase === 'pending') {
        console.log(messages.associationPending);
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
      options.outcome !== undefined,
      options.reason !== undefined,
      options.by !== undefined,
      options.byTargetLine !== undefined,
      options.commit !== undefined,
      options.store !== undefined,
      options.project !== undefined,
      options.targetLine !== undefined,
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
      const globalDataDir = getGlobalDataDir();
      let plan: ArchivePlan;
      try {
        plan = await loadStoredArchivePlan(
          options.applyPlan!,
          globalDataDir
        );
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        const completedAbort = await loadCompletedArchiveAbort(
          options.applyPlan!,
          globalDataDir
        );
        if (completedAbort === null) throw error;
        const aborted = new Error(
          getLocaleCatalog(getCliLocale()).archiveAbort.applyAborted
        );
        (aborted as NodeJS.ErrnoException).code = 'archive_plan_aborted';
        throw aborted;
      }
      // Store finalization owns this same operation gate internally so direct
      // and saved-plan apply share one lock/tombstone path without nesting.
      if (plan.finalization !== undefined) {
        const finalization = await ChangeFinalizationModuleInstance.applyStoredPlan(
          plan,
          undefined,
          {
            mergeConfirmed: options.yes === true,
          }
        );
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
        const disposition = formatArchiveDispositionLine(finalization);
        if (disposition !== null) console.log(disposition);
        return;
      }

      const result = await withStoredArchivePlanOperation(
        plan,
        globalDataDir,
        'apply',
        () =>
          this.applyPlannedArchive(plan, {
            assertions: { mergeConfirmed: options.yes === true },
          })
      );
      if (result.status !== 'complete') {
        if (
          result.recoveryCommand === undefined &&
          result.status === 'blocked' &&
          inspectArchiveApplyPlan(plan, { mergeConfirmed: true }).applicable
        ) {
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
        const disposition = formatArchiveDispositionLine(result);
        if (disposition !== null) console.log(disposition);
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
    options: ArchiveApplyOptions = {}
  ): Promise<ArchiveApplyResult> {
    return applyArchive(plan, options);
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
    let shipLogInspection: ShipLogInspection = {
      shipLog: {
        source: null,
        sha256: null,
        recordedCommit: null,
        reservedSection: false,
      },
      deliveryMode: null,
    };
    if (sourceAvailable) {
      try {
        shipLogInspection = await inspectShipLog(workDir, changeDir);
      } catch (error) {
        planningBlockers.push({
          operation: 'evidence',
          path: changeDir,
          ...(errorCode(error) ? { code: errorCode(error) } : {}),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const deliveryMode = shipLogInspection.deliveryMode;
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
        const validationPassed = await this.validateActiveChange(
          changeDir,
          root.specsDir,
          json
        );
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
    let preparedSpecs: PreparedSpecActions = {
      actions: [],
      specSync: {
        mode: sourceAvailable ? 'no-deltas' : 'passive',
        deltaSources: [],
      },
    };
    try {
      if (sourceAvailable) {
        preparedSpecs = await this.prepareSpecActions(
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
      if (error instanceof SpecReconciliationError) {
        for (const issue of error.issues) {
          preparationBlockers.push({
            operation: 'spec',
            path: issue.source,
            code: issue.code,
            message: issue.message,
          });
        }
        const [firstIssue] = error.issues;
        compatibilityDiagnostic ??= {
          severity: 'error',
          code: 'archive_spec_update_failed',
          message: firstIssue?.message ?? error.message,
          fix: 'Fix the change delta specs and rerun. No files were changed.',
        };
      } else {
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
      }
      preparedSpecs = {
        actions: [],
        specSync: { mode: 'no-deltas', deltaSources: [] },
      };
    }
    const specActions = preparedSpecs.actions;

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
    const shipLog = shipLogInspection.shipLog;
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
        override: false,
      },
      specActions,
      specSync: preparedSpecs.specSync,
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
      const canSave = !plan.blockers.some(
        blocker => blocker.code === 'archive_ship_log_reserved_section'
      );
      const planToken =
        options.savePlan && canSave
          ? await persistArchivePlan(plan, getGlobalDataDir())
          : undefined;
      return this.renderDryRun(plan, json, planToken);
    }
    const applyOptions: ArchiveApplyOptions = {
      assertions: { mergeConfirmed: options.yes === true },
    };
    const applyInspection = inspectArchiveApplyPlan(
      plan,
      applyOptions.assertions
    );
    if (!applyInspection.applicable) {
      const message = applyInspection.blockers
        .map(item => `${item.operation}: ${item.message}`)
        .join('; ');
      if (!json) {
        const targetBlocker = applyInspection.blockers.find(
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
        blockers: applyInspection.blockers,
        status: 'blocked',
        ...(compatibilityDiagnostic ? { compatibilityDiagnostic } : {}),
      };
    }

    const globalDataDir = getGlobalDataDir();
    const persistedPlanToken = await persistArchivePlan(plan, globalDataDir);
    const result = await withStoredArchivePlanOperation(
      plan,
      globalDataDir,
      'apply',
      () => this.applyPlannedArchive(plan, applyOptions)
    );
    if (
      result.status === 'recoverable' &&
      result.manualRecoveryAction === undefined &&
      result.recoveryCommand === undefined
    ) {
      result.recoveryCommand =
        `rasen archive --apply-plan ${persistedPlanToken}` +
        (applyOptions.assertions?.mergeConfirmed === true ? ' --yes' : '');
    }
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
          ...(result.recoveryCommand === undefined
            ? {}
            : { recoveryCommand: result.recoveryCommand }),
          ...(result.abortCommand === undefined
            ? {}
            : { abortCommand: result.abortCommand }),
          ...(result.manualRecoveryAction === undefined
            ? {}
            : { manualRecoveryAction: result.manualRecoveryAction }),
        };
      }
      console.log(message);
      console.log(`Recovery journal: ${result.journalPath}`);
      const disposition = formatArchiveDispositionLine(result);
      if (disposition !== null) console.log(disposition);
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
      readonly specSync: ArchiveSpecSyncPreparation;
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
      skipSpecs:
        planInputs.specSync.mode === 'skip'
          ? true
          : options.skipSpecs,
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
        specSync: planInputs.specSync,
        hasDeltaSpecs,
        sidecar: planInputs.sidecar,
        shipLog: planInputs.shipLog,
        scope: planInputs.scope,
        preparationBlockers: planInputs.preparationBlockers,
      },
    });

    if (options.dryRun) {
      const canSave = !finalizationPlan.archivePlan.blockers.some(
        blocker => blocker.code === 'archive_ship_log_reserved_section'
      );
      const planToken =
        options.savePlan && canSave
          ? await persistArchivePlan(
              finalizationPlan.archivePlan,
              getGlobalDataDir()
            )
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

    const finalizationInspection = inspectFinalizationApplyPlan(
      finalizationPlan,
      { mergeConfirmed: options.yes === true }
    );

    if (!finalizationInspection.applicable) {
      const first = finalizationInspection.blockers[0];
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
      for (const blocker of finalizationInspection.blockers) {
        console.log(`${blocker.code}: ${blocker.message}`);
      }
      throw new ArchiveBlockedError(diagnostic.code, diagnostic.message, diagnostic.fix);
    }

    const finalizationToken = finalizationPlan.token;
    if (finalizationToken === undefined) {
      throw new ArchiveBlockedError(
        'archive_plan_blocked',
        'The incomplete finalization plan has no immutable apply token.'
      );
    }
    const result = await ChangeFinalizationModuleInstance.applyStoredPlan(
      finalizationPlan.archivePlan,
      finalizationToken,
      { mergeConfirmed: options.yes === true }
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
        const disposition = formatArchiveDispositionLine(result);
        if (disposition !== null) console.log(disposition);
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
      ...(result.recoveryCommand === undefined
        ? {}
        : { recoveryCommand: result.recoveryCommand }),
      ...(result.abortCommand === undefined
        ? {}
        : { abortCommand: result.abortCommand }),
      ...(result.manualRecoveryAction === undefined
        ? {}
        : { manualRecoveryAction: result.manualRecoveryAction }),
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

  private async validateActiveChange(
    changeDir: string,
    canonicalSpecsDir: string,
    json: boolean
  ): Promise<boolean> {
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

    const deltaDiscovery = await discoverDeltaSpecFiles(changeDir);
    if (
      deltaDiscovery.files.length === 0 &&
      deltaDiscovery.issues.length === 0
    ) {
      return true;
    }
    const report = await validator.validateChangeDeltaSpecs(
      changeDir,
      canonicalSpecsDir,
      deltaDiscovery
    );
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
  ): Promise<PreparedSpecActions> {
    let discovery: Awaited<ReturnType<typeof findSpecUpdates>>;
    try {
      discovery = await findSpecUpdates(changeDir, mainSpecsDir);
    } catch (error) {
      throw new ArchiveBlockedError(
        'archive_spec_update_failed',
        error instanceof Error ? error.message : String(error),
        'Fix the change delta specs and rerun. No files were changed.'
      );
    }
    const deltaSources = discovery.updates
      .map(update => path.resolve(update.source))
      .sort();
    if (options.skipSpecs) {
      if (discovery.issues.length > 0) {
        throw new SpecReconciliationError(discovery.issues);
      }
      if (!json) console.log('Skipping spec updates (--skip-specs flag provided).');
      return {
        actions: [],
        specSync: { mode: 'skip', deltaSources },
      };
    }
    const analysis = await analyzeSpecUpdates(discovery, changeName, {
      silent: json,
    });
    if (analysis.issues.length > 0) {
      throw new SpecReconciliationError(analysis.issues);
    }
    if (discovery.updates.length === 0) {
      return {
        actions: [],
        specSync: { mode: 'no-deltas', deltaSources: [] },
      };
    }
    if (!json) {
      console.log('\nSpecs to update:');
      for (const update of discovery.updates) {
        console.log(
          `  ${path.relative(mainSpecsDir, path.dirname(update.target)).split(path.sep).join('/')}: ${
            update.exists ? 'update' : 'create'
          }`
        );
      }
    }


    if (!options.dryRun && !options.yes) {
      if (json) {
        throw new ArchiveBlockedError(
          'archive_confirmation_required',
          `Updating ${discovery.updates.length} spec(s) requires confirmation: rerun with --yes.`,
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
        return {
          actions: [],
          specSync: { mode: 'skip', deltaSources },
        };
      }
    }

    const actions: PreparedArchiveSpecAction[] = [];
    try {
      for (const built of analysis.prepared) {
        const update = built.update;
        const capability = update.capability;
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
        actions.push({
          capability,
          action:
            built.emptied
              ? 'delete'
              : built.targetPrecondition.state === 'file'
                ? 'update'
                : 'create',
          source: update.source,
          target: update.target,
          sourceSha256: built.sourceSha256,
          targetPrecondition: built.targetPrecondition,
          rebuilt: built.rebuilt,
          counts: built.counts,
        });
      }
      return {
        actions: actions.sort((left, right) =>
          left.target.localeCompare(right.target)
        ),
        specSync: { mode: 'apply', deltaSources },
      };
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
