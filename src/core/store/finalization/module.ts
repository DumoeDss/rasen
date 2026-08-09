/**
 * `ChangeFinalizationModule` — one deep Module with `plan` / `apply` /
 * `describe`, wrapping the archive transaction engine rather than replacing it.
 *
 * `plan` is read-only and total: it resolves the scope, the frozen identity,
 * the outcome, the successor, the reachability proof, the destination, the spec
 * actions, the record draft, the evidence inventory, and the lock keys, and
 * reports every unsatisfied precondition it can reach rather than stopping at
 * the first. The refusals the accepted design requires to happen BEFORE any
 * access — a missing outcome, a contradictory combination, a target-line
 * mismatch — are thrown, because a blocker collected after the read would not
 * be the same guarantee.
 *
 * `apply` consumes only a token. It re-reads no working directory, no current
 * branch, and none of the selectors that produced the plan; it revalidates the
 * frozen facts under the locks and then hands the embedded engine plan to
 * `applyArchive`.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import {
  ARCHIVE_STORED_PLAN_APPLY_OPERATION,
  abortArchivePlan,
  applyArchive,
  inspectArchiveApplyPlan,
  createArchivePlan,
  defaultArchiveEngineAdapters,
  fingerprintArchiveTree,
  loadStoredArchivePlan,
  persistArchivePlan,
  withStoredArchivePlanOperation,
  type ArchiveApplyAssertions,
  type ArchiveAbortResult,
  type ArchiveAssociationPlan,
  type ArchivePlan,
  type ArchivePlanFinalization,
  type PreparedArchiveSpecAction,
} from '../../archive-engine.js';
import { canonicalBytes } from '../../canonical-json.js';
import { getGlobalDataDir } from '../../global-config.js';
import { StorePlanning } from '../../store-planning/index.js';
import type { ChangeFinalizationScope } from '../../store-planning/types.js';
import { parseArchiveV2 } from '../finalization-v2.js';
import {
  parseStoreTargetLineCatalogV1,
  type StoreTargetLineCatalogV1,
} from '../planning-catalogs.js';
import {
  derivePlanningScopeId,
  verifyWorkspacePairId,
  type VerifiedChangeInstanceId,
} from '../planning-identity.js';
import { readWorkspaceIndexEntry } from '../workspace/registry.js';
import {
  executionAssociationPath,
  type BindingFact,
} from '../workspace/binding.js';
import { targetLineCatalogPath } from '../workspace/scope.js';
import { completeFinalizationAssociation } from './association.js';
import {
  productionFinalizationDependencies,
  type FinalizationDependencies,
} from './dependencies.js';
import {
  ChangeFinalizationError,
  finalizationBlocker,
  finalizationError,
  finalizationRefusal,
  isChangeFinalizationError,
} from './diagnostics.js';
import { recordedLockKeys, withFinalizationLocks } from './locks.js';
import {
  resolveFinalizationOutcomeRequest,
  validateResolvedOutcome,
  type ResolvedOutcomeRequest,
} from './outcome.js';
import {
  proveLandedReachability,
  resolveCodeCommitCandidate,
  undeclaredImplementationRefusal,
} from './reachability.js';
import {
  archiveEntryAddress,
  assertFrozenTargetLine,
  buildArchiveV2RecordDraft,
  workspacePairUnavailable,
} from './record.js';
import { requireSingleSuccessor, searchSuccessor } from './successor.js';
import { archiveSpecActionsFor, specSkipConflict } from './spec-actions.js';
import type {
  ChangeFinalizationModule,
  DescribeFinalizationInput,
  FinalizationBlocker,
  FinalizationApplyInspection,
  FinalizationDescription,
  FinalizationLandedProof,
  FinalizationPlanToken,
  FinalizationResult,
  FinalizationScopeFacts,
  FinalizationSuccessorEvidence,
  FinalizationTargetLineFacts,
  FinalizationWorktreeFacts,
  FinalizeChangeInput,
  ImmutableFinalizationPlan,
} from './types.js';

const ARCHIVE_RECORD_FILENAME = 'archive.json';

export interface ChangeFinalizationOptions {
  readonly dependencies?: FinalizationDependencies;
  readonly lockDeadlineMs?: number;
  readonly lockPollMs?: number;
}

interface ResolvedFinalizationContext {
  readonly scope: FinalizationScopeFacts;
  readonly changeId: string;
  readonly changeInstanceId: VerifiedChangeInstanceId;
  readonly instanceSeed: string;
  readonly implementation: 'code' | 'none';
  readonly workspacePairId: string;
  readonly planning: FinalizationWorktreeFacts;
  readonly execution: FinalizationWorktreeFacts;
  readonly targetLine: FinalizationTargetLineFacts;
  readonly catalog: StoreTargetLineCatalogV1;
  readonly projectIds: readonly string[];
  readonly executionAssociationFile: string | null;
}
export function inspectFinalizationApplyPlan(
  plan: ImmutableFinalizationPlan,
  assertions: ArchiveApplyAssertions = {}
): FinalizationApplyInspection {
  const archiveInspection = inspectArchiveApplyPlan(
    plan.archivePlan,
    assertions
  );
  const blockers = plan.blockers.filter(blocker => {
    const source = blocker.archiveBlocker;
    if (source === undefined) return true;
    return archiveInspection.blockers.some(
      candidate =>
        candidate.operation === source.operation &&
        candidate.path === source.path &&
        candidate.code === source.code &&
        candidate.message === source.message
    );
  });
  return {
    applicable:
      !plan.alreadyComplete &&
      blockers.length === 0 &&
      archiveInspection.applicable,
    blockers,
  };
}


export class ChangeFinalization implements ChangeFinalizationModule {
  private readonly dependencies: FinalizationDependencies;

  constructor(private readonly options: ChangeFinalizationOptions = {}) {
    this.dependencies = options.dependencies ?? productionFinalizationDependencies;
  }

  async plan(input: FinalizeChangeInput): Promise<ImmutableFinalizationPlan> {
    // Refused with no filesystem or Git access whatsoever.
    const request = resolveFinalizationOutcomeRequest(input.outcome);
    const context = await this.resolveContext(input);
    const blockers: FinalizationBlocker[] = [];

    // Idempotence is decided from the published entry's own record, never from
    // "a directory with a similar name exists".
    const published = await this.findPublishedEntry(input, context);

    let successor: FinalizationSuccessorEvidence | null = null;
    let successorUnresolved = false;
    if (request.outcome === 'superseded') {
      successor = await this.resolveSuccessor(input, context, request, blockers);
      successorUnresolved = successor === null;
    }
    // The canonical validator's supersession rule is a comparison of two
    // scopes, so it cannot be evaluated without a successor scope. When the
    // search could not produce one, the blocker it already recorded names the
    // SPECIFIC reason — `successor_scope_unverified` with the searched and
    // unsearched refs, or `successor_ambiguous` with every claimant. Running
    // the validator anyway would throw a generic "a successor scope is
    // required" and discard that diagnostic, which is the opposite of what the
    // refusal is for.
    if (!successorUnresolved) {
      validateResolvedOutcome(
        request,
        {
          storeUid: context.scope.storeUid,
          projectId: context.scope.projectId,
          targetLineId: context.scope.targetLineId,
          changeInstanceId: context.changeInstanceId,
        },
        successor === null
          ? undefined
          : {
              storeUid: successor.storeUid,
              projectId: successor.projectId,
              targetLineId: successor.targetLineId,
              changeInstanceId: successor.changeInstanceId,
            }
      );
    }

    let landedProof: FinalizationLandedProof | null = null;
    let specActions: readonly PreparedArchiveSpecAction[] = [];
    if (request.outcome === 'landed') {
      if (input.skipSpecs === true && input.archive.hasDeltaSpecs) {
        throw specSkipConflict(context.changeId);
      }
      specActions = input.skipSpecs === true ? [] : input.archive.specActionCandidates;
      landedProof = await this.proveLanded(input, context, request, blockers);
      if (landedProof === null && context.implementation === 'code') {
        // The proof IS the precondition for a code-backed landed record, and
        // the blocker just collected names the commit, the ref, and the ref's
        // OID. Continuing would hand `buildArchiveV2RecordDraft` a landed
        // record with no code merge, whose own refusal can only say "a proven
        // code merge is required" — strictly less than what was already known.
        // The specific refusal is raised instead of being replaced.
        throw refusalFromBlocker(blockers[blockers.length - 1], context.changeId);
      }
    }

    const destination = archiveEntryAddress({
      storeRoot: context.scope.storeRoot,
      projectId: context.scope.projectId,
      frozenTargetLineId: context.scope.targetLineId,
      changeId: context.changeId,
      archiveDate: input.archive.date,
      changeInstanceId: context.changeInstanceId,
      ...(input.pathFlavor === undefined ? {} : { flavor: input.pathFlavor }),
    });

    const createdAt = input.archive.createdAt ?? this.dependencies.now().toISOString();
    const recordDraft = buildArchiveV2RecordDraft({
      outcome: request.outcome,
      reason: request.reason,
      supersededBy: request.supersededBy,
      implementation: context.implementation,
      scope: context.scope,
      changeId: context.changeId,
      changeInstanceId: context.changeInstanceId,
      workspacePairId: context.workspacePairId,
      planning: context.planning,
      execution: context.execution,
      planningTargetRef: context.targetLine.storeRef,
      landedProof,
      specActions: request.outcome === 'landed' ? archiveSpecActionsFor(specActions) : [],
      archivedAt: createdAt,
    });

    const association = this.planAssociation(input, context, destination);
    const lockKeys = recordedLockKeys({
      storeUid: context.scope.storeUid,
      projectId: context.scope.projectId,
      targetLineId: context.scope.targetLineId,
      changeInstanceId: context.changeInstanceId,
    });

    const finalizationBlock: ArchivePlanFinalization = {
      outcome: request.outcome,
      record: recordDraft,
      identity: {
        planningScopeId: context.scope.planningScopeId,
        instanceSeed: context.instanceSeed,
        planningWorktreeInstanceId: context.planning.worktreeInstanceId,
        executionWorktreeInstanceId: context.execution.worktreeInstanceId,
      },
      destination,
      association,
      revalidation: {
        targetLine: {
          catalogPath: context.targetLine.catalogPath,
          catalogDigest: context.targetLine.catalogDigest,
        },
        ...(successor === null
          ? {}
          : {
              successor: {
                changeInstanceId: successor.changeInstanceId,
                foundAtRef: successor.foundAtRef,
                blobPath: successor.blobPath,
                digest: successor.digest,
              },
            }),
      },
      lockKeys,
    };

    const archivePlan = await createArchivePlan({
      change: context.changeId,
      planningRoot: input.archive.planningRoot,
      executionRoot: input.archive.executionRoot,
      ...(input.archive.scope === undefined ? {} : { scope: input.archive.scope }),
      finalization: finalizationBlock,
      activePath: input.archive.activePath,
      archiveParent: input.archive.archiveParent,
      ephemeraPath: input.archive.ephemeraPath,
      date: input.archive.date,
      keepEphemera: input.archive.keepEphemera,
      validation: input.archive.validation,
      tasks: input.archive.tasks,
      timing: input.archive.timing,
      // The ONE call site that decides whether spec actions reach the engine.
      // A passive plan variant has no field that could supply them.
      specActions: request.outcome === 'landed' ? [...specActions] : [],
      sidecar: input.archive.sidecar,
      shipLog: input.archive.shipLog,
      ...(input.archive.preparationBlockers === undefined
        ? {}
        : { preparationBlockers: [...input.archive.preparationBlockers] }),
      ...(input.archive.transactionId === undefined
        ? {}
        : { transactionId: input.archive.transactionId }),
      createdAt,
    });

    for (const item of archivePlan.blockers) {
      blockers.push({
        ...finalizationBlocker(
          'finalization_record_invalid',
          `${item.operation}: ${item.message}`,
          { target: item.path }
        ),
        archiveBlocker: item,
      });
    }

    const base = {
      schemaVersion: 1 as const,
      createdAt,
      scope: context.scope,
      changeId: context.changeId,
      changeInstanceId: context.changeInstanceId as string,
      workspacePairId: context.workspacePairId,
      implementation: context.implementation,
      targetLine: context.targetLine,
      planning: context.planning,
      execution: context.execution,
      destination,
      recordDraft,
      evidenceInventory: archivePlan.evidenceInputs,
      association,
      lockKeys,
      archivePlan,
      blockers,
      applicable: blockers.length === 0 && archivePlan.complete && published === null,
      alreadyComplete: published !== null,
    };

    const withOutcome =
      request.outcome === 'landed'
        ? { ...base, outcome: 'landed' as const, specActions: [...specActions], landedProof }
        : request.outcome === 'superseded'
          ? {
              ...base,
              outcome: 'superseded' as const,
              reason: request.reason as string,
              supersededBy: request.supersededBy as string,
              successor,
            }
          : {
              ...base,
              outcome: request.outcome,
              reason: request.reason as string,
            };

    const planId = finalizationPlanId(withOutcome);
    const token: FinalizationPlanToken = {
      planId,
      archivePlanToken: `archive-v1:${archivePlan.transactionId}:${archivePlan.planHash}`,
      storeUid: context.scope.storeUid,
      projectId: context.scope.projectId,
      targetLineId: context.scope.targetLineId,
      changeInstanceId: context.changeInstanceId,
      workspacePairId: context.workspacePairId,
      planningHeadOid: context.planning.headOid,
      codeRefOid: context.targetLine.codeRefOid,
      sourceFingerprint: archivePlan.sourceFingerprint?.digest ?? '',
    };
    return Object.freeze({ ...withOutcome, planId, token }) as ImmutableFinalizationPlan;
  }

  async apply(
    token: FinalizationPlanToken,
    assertions: ArchiveApplyAssertions = {}
  ): Promise<FinalizationResult> {
    const globalDataDir = getGlobalDataDir();
    const archivePlan = await loadStoredArchivePlan(
      token.archivePlanToken,
      globalDataDir
    );
    return withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      ARCHIVE_STORED_PLAN_APPLY_OPERATION,
      () => this.applyStoredPlan(archivePlan, token, assertions)
    );
  }

  /**
   * Applies an already-loaded plan. This is the seam `rasen archive
   * --apply-plan` uses: the stored plan carries the finalization block, so the
   * invoking directory and selectors cannot influence the outcome.
   */
  async applyStoredPlan(
    archivePlan: ArchivePlan,
    token?: FinalizationPlanToken,
    assertions: ArchiveApplyAssertions = {}
  ): Promise<FinalizationResult> {
    const finalization = archivePlan.finalization;
    if (finalization === undefined) {
      throw finalizationError(
        'finalization_scope_unsupported',
        'This stored archive plan carries no finalization block, so it is not a Store v2 finalization.',
        { target: archivePlan.paths.final }
      );
    }
    const record = finalization.record as unknown as {
      storeUid: string;
      projectId: string;
      targetLineId: string;
      changeInstanceId: string;
      workspacePairId: string;
      outcome: FinalizationResult['outcome'];
      specSync: { applied: boolean; actions: readonly unknown[] };
      codeMerge: { commit: string; targetRef: string } | null;
    };

    const scope = {
      storeUid: record.storeUid,
      projectId: record.projectId,
      targetLineId: record.targetLineId,
      changeInstanceId: record.changeInstanceId,
    };
    const coordination = this.dependencies.coordination(
      finalization.association.globalDataDir
    );

    const result = await withFinalizationLocks(
      coordination,
      scope,
      async () => {
        await this.revalidate(archivePlan, token);
        return applyArchive(archivePlan, {
          adapters: {
            ...defaultArchiveEngineAdapters,
            finalizeArchiveAssociation: async ({ plan }) =>
              void (await completeFinalizationAssociation(this.dependencies, plan)),
          },
          assertions,
        });
      },
      {
        ...(this.options.lockDeadlineMs === undefined
          ? {}
          : { deadlineMs: this.options.lockDeadlineMs }),
        ...(this.options.lockPollMs === undefined ? {} : { pollMs: this.options.lockPollMs }),
      }
    );

    return {
      planId: token?.planId ?? archivePlan.planHash,
      outcome: record.outcome,
      changeId: archivePlan.change,
      changeInstanceId: record.changeInstanceId,
      workspacePairId: record.workspacePairId,
      storeUid: record.storeUid,
      projectId: record.projectId,
      targetLineId: record.targetLineId,
      publishedEntry: archivePlan.paths.final,
      specSyncApplied: record.specSync.applied,
      specSyncActionCount: record.specSync.actions.length,
      provenCommit: record.codeMerge?.commit ?? null,
      codeRef: record.codeMerge?.targetRef ?? null,
      codeRefOid: token?.codeRefOid ?? null,
      associationPhase: finalization.association.noop ? 'no-op' : 'applied',
      status: result.status,
      transactionId: result.transactionId,
      journalPath: result.journalPath,
      blockers: result.blockers.map(item => ({
        ...finalizationBlocker(
          'finalization_record_invalid',
          `${item.operation}: ${item.message}`,
          { target: item.path }
        ),
        archiveBlocker: item,
      })),
    };
  }

  async abortStoredPlan(
    archivePlan: ArchivePlan,
    globalDataDir: string
  ): Promise<ArchiveAbortResult> {
    const finalization = archivePlan.finalization;
    if (finalization === undefined) {
      throw finalizationError(
        'finalization_scope_unsupported',
        'This stored archive plan carries no finalization block, so it is not a Store v2 finalization.',
        { target: archivePlan.paths.final }
      );
    }
    const record = finalization.record as unknown as {
      storeUid: string;
      projectId: string;
      targetLineId: string;
      changeInstanceId: string;
    };
    const scope = {
      storeUid: record.storeUid,
      projectId: record.projectId,
      targetLineId: record.targetLineId,
      changeInstanceId: record.changeInstanceId,
    };
    const coordination = this.dependencies.coordination(
      finalization.association.globalDataDir
    );
    return withStoredArchivePlanOperation(
      archivePlan,
      globalDataDir,
      'abort',
      () =>
        withFinalizationLocks(
          coordination,
          scope,
          () => abortArchivePlan(archivePlan, globalDataDir),
          {
            ...(this.options.lockDeadlineMs === undefined
              ? {}
              : { deadlineMs: this.options.lockDeadlineMs }),
            ...(this.options.lockPollMs === undefined
              ? {}
              : { pollMs: this.options.lockPollMs }),
          }
        )
    );
  }

  async describe(input: DescribeFinalizationInput): Promise<FinalizationDescription> {
    try {
      const context = await this.resolveContext({
        ...input,
        archive: input.archive ?? emptyPreparation(input),
      } as FinalizeChangeInput);
      const published = await this.findPublishedEntry(
        { ...input, archive: input.archive ?? emptyPreparation(input) } as FinalizeChangeInput,
        context
      );
      return {
        changeId: context.changeId,
        scope: context.scope,
        changeInstanceId: context.changeInstanceId,
        workspacePairId: context.workspacePairId,
        finalized: published !== null,
        recordedOutcome: published?.outcome ?? null,
        publishedEntry: published?.path ?? null,
        blockers: [],
      };
    } catch (error) {
      if (!isChangeFinalizationError(error)) throw error;
      return {
        changeId: input.changeId,
        scope: null,
        changeInstanceId: null,
        workspacePairId: null,
        finalized: false,
        recordedOutcome: null,
        publishedEntry: null,
        blockers: [error.toBlocker()],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async resolveContext(
    input: FinalizeChangeInput
  ): Promise<ResolvedFinalizationContext> {
    const scopeCapability: ChangeFinalizationScope = await StorePlanning.open({
      intent: 'finalize-change',
      startPath: input.startPath,
      change: { changeId: input.changeId },
      ...(input.selection === undefined ? {} : { selection: input.selection }),
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
      ...(input.pathFlavor === undefined ? {} : { pathFlavor: input.pathFlavor }),
    });
    const ref = scopeCapability.ref;
    if (ref.mode !== 'store-project') {
      throw finalizationError(
        'finalization_scope_unsupported',
        'The outcome axis is reached only from a Store v2 project scope; a standalone project and a legacy flat Store archive exactly as before.',
        { target: input.changeId }
      );
    }
    const identity = scopeCapability.change.metadata?.identity;
    if (identity === undefined) {
      throw finalizationRefusal(
        'finalization_scope_unsupported',
        `Change '${input.changeId}' carries no Store v2 identity block, so it has no frozen target line or Change instance to finalize.`,
        {
          expected: 'a committed v2 identity block',
          actual: '(none)',
          target: scopeCapability.change.location.absolutePath,
          fix: 'Create the Change through a Store v2 project scope so its identity is minted and committed.',
        }
      );
    }
    const resolvedTargetLineId = ref.targetLineId;
    if (resolvedTargetLineId === undefined) {
      throw finalizationError(
        'target_line_mismatch',
        `Finalizing Change '${input.changeId}' requires a proven stable target line.`,
        { target: 'selection.targetLine', fix: 'Add --target-line <id>.' }
      );
    }
    // Fires before a destination is computed, a canonical spec is read, or the
    // transaction is entered.
    assertFrozenTargetLine({
      changeId: input.changeId,
      frozenTargetLineId: identity.targetLineId,
      resolvedTargetLineId,
    });

    const planningScopeId = derivePlanningScopeId({
      storeUid: identity.storeUid,
      projectId: identity.projectId,
      targetLineId: identity.targetLineId,
    });
    const scope: FinalizationScopeFacts = {
      storeUid: identity.storeUid,
      storeId: ref.storeId,
      storeRoot: ref.storeRoot,
      projectId: identity.projectId,
      targetLineId: identity.targetLineId,
      planningScopeId,
    };

    const catalog = await this.readTargetLineCatalog(scope, input.pathFlavor);
    const targetLine = await this.resolveTargetLineFacts(
      scope,
      catalog,
      input.archive.planningRoot,
      input.pathFlavor
    );

    const index = await readWorkspaceIndexEntry(
      this.dependencies.coordination(input.globalDataDir),
      planningScopeId,
      input.changeId
    );
    if (index === null) {
      throw workspacePairUnavailable(
        input.changeId,
        `no workspace binding is recorded for planning scope ${planningScopeId}`
      );
    }
    if (index.workspacePairId === undefined || index.workspacePairId.length === 0) {
      throw workspacePairUnavailable(
        input.changeId,
        'the recorded binding has no workspace pair identity'
      );
    }
    if (
      index.changeInstanceId !== undefined &&
      index.changeInstanceId !== identity.instanceId
    ) {
      throw finalizationRefusal(
        'planning_execution_binding_mismatch',
        `The recorded binding names Change instance '${index.changeInstanceId}', which is not the one committed in the Change.`,
        {
          expected: identity.instanceId,
          actual: index.changeInstanceId,
          target: input.changeId,
          fix: 'Repair the binding, or address the pair that actually holds this Change. Rasen picks no winner between disagreeing carriers.',
        }
      );
    }
    try {
      verifyWorkspacePairId(index.workspacePairId, {
        changeInstanceId: identity.instanceId,
        planningWorktreeInstanceId: index.planning.worktreeInstanceId,
        executionWorktreeInstanceId: index.execution.worktreeInstanceId,
      });
    } catch (error) {
      throw workspacePairUnavailable(
        input.changeId,
        error instanceof Error ? error.message : String(error)
      );
    }

    const planning: FinalizationWorktreeFacts = {
      root: index.planning.root,
      worktreeInstanceId: index.planning.worktreeInstanceId,
      repositoryIdentity: index.planning.repositoryIdentity,
      ref:
        (await this.dependencies.git.checkedOutRef(index.planning.root)) ??
        index.planning.ref,
      headOid:
        (await this.dependencies.git.headOid(index.planning.root)) ??
        index.planning.headOid,
    };
    const execution: FinalizationWorktreeFacts = {
      root: index.execution.root,
      worktreeInstanceId: index.execution.worktreeInstanceId,
      repositoryIdentity: index.execution.repositoryIdentity,
      ref:
        (await this.dependencies.git.checkedOutRef(index.execution.root)) ??
        index.execution.ref,
      headOid:
        (await this.dependencies.git.headOid(index.execution.root)) ??
        index.execution.headOid,
    };

    const associationFile = executionAssociationPath(
      index.execution.root,
      input.pathFlavor ?? 'native'
    );
    const associationExists =
      (await this.dependencies.fs.statKind(associationFile)) === 'file';

    return {
      scope,
      changeId: input.changeId,
      changeInstanceId: identity.instanceId,
      instanceSeed: identity.instanceSeed,
      implementation: scopeCapability.change.metadata?.implementation ?? 'code',
      workspacePairId: index.workspacePairId,
      planning,
      execution,
      targetLine,
      catalog,
      projectIds: await this.listProjectIds(scope, input.pathFlavor),
      executionAssociationFile: associationExists ? associationFile : null,
    };
  }

  private async readTargetLineCatalog(
    scope: FinalizationScopeFacts,
    flavor: FinalizeChangeInput['pathFlavor']
  ): Promise<StoreTargetLineCatalogV1> {
    const catalogPath = targetLineCatalogPath(
      scope.storeRoot,
      scope.targetLineId,
      flavor ?? 'native'
    );
    const text = await this.dependencies.fs.readText(catalogPath);
    if (text === null) {
      throw finalizationRefusal(
        'target_line_ref_unresolved',
        `Target line '${scope.targetLineId}' has no catalog in Store '${scope.storeId}'.`,
        {
          expected: catalogPath,
          actual: '(absent)',
          target: catalogPath,
          fix: `Author it with 'rasen store target-line add ${scope.targetLineId} --store ${scope.storeId} --store-ref refs/heads/<branch>'.`,
        }
      );
    }
    return parseStoreTargetLineCatalogV1(text, catalogPath);
  }

  /**
   * Resolves the line's refs to commits with this Module's own read-only Git
   * adapter, reading the catalog through the Foundation contract. This is the
   * fallback design §11 names, taken unconditionally so finalization does not
   * depend on the workspace Module's project-registry lookup for a repository
   * the archive plan already names.
   */
  private async resolveTargetLineFacts(
    scope: FinalizationScopeFacts,
    catalog: StoreTargetLineCatalogV1,
    planningRoot: string,
    flavor: FinalizeChangeInput['pathFlavor']
  ): Promise<FinalizationTargetLineFacts> {
    const catalogPath = targetLineCatalogPath(
      scope.storeRoot,
      scope.targetLineId,
      flavor ?? 'native'
    );
    const catalogText = (await this.dependencies.fs.readText(catalogPath)) ?? '';
    const storeRefOid = await this.dependencies.git.resolveCommit(
      planningRoot,
      catalog.storeRef
    );
    if (storeRefOid === null) {
      throw finalizationRefusal(
        'target_line_ref_unresolved',
        `Target-line Store ref '${catalog.storeRef}' names no commit in the Store checkout (${planningRoot}).`,
        {
          expected: catalog.storeRef,
          actual: '(unresolved)',
          target: planningRoot,
          fix: `Create '${catalog.storeRef}' locally, or re-point the locator with 'rasen store target-line set-ref'. Resolution never falls back to HEAD.`,
        }
      );
    }
    const locator = catalog.projects[scope.projectId];
    return {
      targetLineId: catalog.id,
      storeRef: catalog.storeRef,
      storeRefOid,
      codeRef: locator?.codeRef ?? null,
      codeRefOid: null,
      catalogPath,
      catalogDigest: createHash('sha256').update(catalogText, 'utf8').digest('hex'),
    };
  }

  private async listProjectIds(
    scope: FinalizationScopeFacts,
    flavor: FinalizeChangeInput['pathFlavor']
  ): Promise<readonly string[]> {
    // The catalog directory is the parent of one contract-computed path, never
    // a hand-joined `.rasen-store/projects`.
    const api = flavor === 'win32' ? path.win32 : flavor === 'posix' ? path.posix : path;
    const probe = targetLineCatalogPath(scope.storeRoot, 'probe', flavor ?? 'native');
    const projectsDir = api.join(api.dirname(api.dirname(probe)), 'projects');
    const names = await this.dependencies.fs.listNames(projectsDir);
    const ids = names
      .filter(name => name.endsWith('.yaml'))
      .map(name => name.slice(0, -'.yaml'.length));
    return ids.includes(scope.projectId) ? ids : [...ids, scope.projectId].sort();
  }

  private async resolveSuccessor(
    input: FinalizeChangeInput,
    context: ResolvedFinalizationContext,
    request: ResolvedOutcomeRequest,
    blockers: FinalizationBlocker[]
  ): Promise<FinalizationSuccessorEvidence | null> {
    const refs = await this.storeRefs(context, input.pathFlavor);
    try {
      const result = await searchSuccessor(this.dependencies, {
        storeRepositoryRoot: input.archive.planningRoot,
        supersededBy: request.supersededBy as string,
        refs,
        projectIds: context.projectIds,
        byTargetLine: request.byTargetLine,
        excludeChangeInstanceId: context.changeInstanceId,
      });
      return requireSingleSuccessor(result, request.supersededBy as string);
    } catch (error) {
      if (!isChangeFinalizationError(error)) throw error;
      blockers.push(error.toBlocker());
      return null;
    }
  }

  private async storeRefs(
    context: ResolvedFinalizationContext,
    flavor: FinalizeChangeInput['pathFlavor']
  ): Promise<Array<{ targetLineId: string; storeRef: string }>> {
    const api = flavor === 'win32' ? path.win32 : flavor === 'posix' ? path.posix : path;
    const probe = targetLineCatalogPath(context.scope.storeRoot, 'probe', flavor ?? 'native');
    const dir = api.dirname(probe);
    const refs: Array<{ targetLineId: string; storeRef: string }> = [];
    for (const name of await this.dependencies.fs.listNames(dir)) {
      if (!name.endsWith('.yaml')) continue;
      const text = await this.dependencies.fs.readText(api.join(dir, name));
      if (text === null) continue;
      const catalog = parseStoreTargetLineCatalogV1(text, api.join(dir, name));
      refs.push({ targetLineId: catalog.id, storeRef: catalog.storeRef });
    }
    if (refs.length === 0) {
      refs.push({
        targetLineId: context.targetLine.targetLineId,
        storeRef: context.targetLine.storeRef,
      });
    }
    return refs.sort((left, right) => left.targetLineId.localeCompare(right.targetLineId));
  }

  private async proveLanded(
    input: FinalizeChangeInput,
    context: ResolvedFinalizationContext,
    request: ResolvedOutcomeRequest,
    blockers: FinalizationBlocker[]
  ): Promise<FinalizationLandedProof | null> {
    if (context.implementation === 'none') {
      // The only route to a landed record with no code-merge facts, read
      // exclusively from committed metadata. No commit is resolved, fabricated,
      // or required.
      return null;
    }
    const candidate = resolveCodeCommitCandidate({
      flagCommit: request.commit,
      shipLogCommit: input.archive.shipLog.recordedCommit,
      executionHeadOid: await this.dependencies.git.headOid(input.archive.executionRoot),
    });
    if (candidate === null) {
      blockers.push(
        (undeclaredImplementationRefusal(context.changeId) as ChangeFinalizationError).toBlocker()
      );
      return null;
    }
    try {
      const proof = await proveLandedReachability(this.dependencies, {
        repositoryRoot: input.archive.executionRoot,
        candidate,
        codeRef: context.targetLine.codeRef,
        changeId: context.changeId,
        targetLineId: context.scope.targetLineId,
        projectId: context.scope.projectId,
      });
      (context.targetLine as { codeRefOid: string | null }).codeRefOid = proof.codeRefOid;
      return proof;
    } catch (error) {
      if (!isChangeFinalizationError(error)) throw error;
      blockers.push(error.toBlocker());
      return null;
    }
  }

  private planAssociation(
    input: FinalizeChangeInput,
    context: ResolvedFinalizationContext,
    destination: string
  ): ArchiveAssociationPlan {
    const hasPair = context.workspacePairId.length > 0;
    if (!hasPair) {
      return {
        noop: true,
        reason: 'this scope has no workspace pair, so there is no binding to complete',
      };
    }
    return {
      noop: false,
      planningScopeId: context.scope.planningScopeId,
      changeId: context.changeId,
      changeInstanceId: context.changeInstanceId,
      workspacePairId: context.workspacePairId,
      ...(context.executionAssociationFile === null
        ? {}
        : { executionAssociationPath: context.executionAssociationFile }),
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
      expected: {
        storeUid: context.scope.storeUid,
        storeId: context.scope.storeId,
        projectId: context.scope.projectId,
        targetLineId: context.scope.targetLineId,
        planning: {
          root: context.planning.root,
          repositoryIdentity: context.planning.repositoryIdentity,
          worktreeInstanceId: context.planning.worktreeInstanceId,
          ref: context.planning.ref,
          headOid: context.planning.headOid,
        },
        execution: {
          root: context.execution.root,
          repositoryIdentity: context.execution.repositoryIdentity,
          worktreeInstanceId: context.execution.worktreeInstanceId,
          ref: context.execution.ref,
          headOid: context.execution.headOid,
        },
      },
    };
  }

  /**
   * Reads the published entry for THIS Change instance, if there is one. The
   * archive line is listed only to FIND the candidate; whether it is this
   * Change's entry is decided from the record inside it.
   */
  private async findPublishedEntry(
    input: FinalizeChangeInput,
    context: ResolvedFinalizationContext
  ): Promise<{ path: string; outcome: FinalizationResult['outcome'] } | null> {
    const api =
      input.pathFlavor === 'win32'
        ? path.win32
        : input.pathFlavor === 'posix'
          ? path.posix
          : path;
    const archiveLine = api.dirname(
      archiveEntryAddress({
        storeRoot: context.scope.storeRoot,
        projectId: context.scope.projectId,
        frozenTargetLineId: context.scope.targetLineId,
        changeId: context.changeId,
        archiveDate: input.archive.date,
        changeInstanceId: context.changeInstanceId,
        ...(input.pathFlavor === undefined ? {} : { flavor: input.pathFlavor }),
      })
    );
    for (const name of await this.dependencies.fs.listNames(archiveLine)) {
      const candidate = api.join(archiveLine, name);
      const text = await this.dependencies.fs.readText(
        api.join(candidate, ARCHIVE_RECORD_FILENAME)
      );
      if (text === null) continue;
      let record;
      try {
        record = parseArchiveV2(text);
      } catch {
        // A v1 record inside a v2 partition is a relocated legacy entry. It is
        // a diagnostic for the compatibility sweep, never a variant tolerated
        // here, and it is never rewritten or upgraded.
        continue;
      }
      if (record.changeInstanceId === context.changeInstanceId) {
        return { path: candidate, outcome: record.outcome };
      }
    }
    return null;
  }

  /**
   * Revalidation, under the locks, before the first write. A mismatch
   * invalidates the plan; nothing is repaired into agreement.
   *
   * Every precondition here is driven by a fact frozen in the PLAN, never by
   * the plan token. `--apply-plan` is the only surface a saved plan is ever
   * applied through and the mutating half of the management-API bridge, and it
   * carries no token — so a check gated on `token !== undefined` is a check the
   * shipping surface does not have. The token contributes exactly one
   * assertion beyond these, and it is a STRICTER one, not a different one.
   */
  private async revalidate(
    archivePlan: ArchivePlan,
    token: FinalizationPlanToken | undefined
  ): Promise<void> {
    const finalization = archivePlan.finalization;
    if (finalization === undefined) return;
    const association = finalization.association;
    const expected = association.expected;
    const revalidation = finalization.revalidation;

    if (expected !== undefined) {
      // The frozen HEAD is read from the RECORD, which every surface carries,
      // rather than from the token, which only the direct command path has.
      // `record.planning.sourceHead` and `token.planningHeadOid` are the same
      // value — both are `context.planning.headOid` at plan time.
      const frozenHead = (finalization.record as unknown as { planning: { sourceHead: string } })
        .planning.sourceHead;
      const head = await this.dependencies.git.headOid(expected.planning.root);
      if (frozenHead.length > 0 && head !== null && head !== frozenHead) {
        throw staleRefusal(
          'the planning worktree HEAD',
          frozenHead,
          head,
          expected.planning.root
        );
      }
      const ref = await this.dependencies.git.checkedOutRef(expected.planning.root);
      if (ref !== null && ref !== expected.planning.ref) {
        throw staleRefusal(
          'the planning worktree checked-out ref',
          expected.planning.ref,
          ref,
          expected.planning.root
        );
      }
    }

    const record = finalization.record as unknown as {
      codeMerge: { commit: string; targetRef: string } | null;
    };
    if (record.codeMerge !== null) {
      const current = await this.dependencies.git.resolveCommit(
        archivePlan.roots.execution,
        record.codeMerge.targetRef
      );
      if (current === null) {
        throw staleRefusal(
          `the target line code ref ${record.codeMerge.targetRef}`,
          token?.codeRefOid ?? '(resolvable)',
          '(unresolved)',
          archivePlan.roots.execution
        );
      }
      // The stricter, token-only assertion: the ref must not have moved AT
      // ALL. It runs first so the direct path keeps naming the more specific
      // cause. It is not the safety property — the re-proof below is, and that
      // one runs on every surface.
      if (token?.codeRefOid != null && current !== token.codeRefOid) {
        throw staleRefusal(
          `the target line code ref ${record.codeMerge.targetRef}`,
          token.codeRefOid,
          current,
          archivePlan.roots.execution
        );
      }
      // Re-prove rather than trust the earlier answer. The record asserts
      // `reachable: true` for this commit from this ref, and that claim
      // survives a fast-forward but not a revert, a reset, or a force-push
      // landing between plan and apply. Publishing a `landed` record — and,
      // for a landed outcome, synchronizing the canonical specs — on the
      // strength of a proof that no longer holds is what this prevents, so it
      // is NOT gated on the token.
      const reachable = await this.dependencies.git.isAncestor(
        archivePlan.roots.execution,
        record.codeMerge.commit,
        current
      );
      if (reachable !== true) {
        throw staleRefusal(
          `reachability of ${record.codeMerge.commit} from ${record.codeMerge.targetRef}`,
          'reachable',
          reachable === null ? '(indeterminate)' : 'not reachable',
          archivePlan.roots.execution
        );
      }
    }

    // Every canonical-spec target digest the plan froze.
    for (const action of archivePlan.specActions) {
      const precondition = action.targetPrecondition;
      const text = await this.dependencies.fs.readText(action.target);
      if (precondition.state === 'absent') {
        if (text !== null) {
          throw staleRefusal(
            `the canonical spec ${action.target}`,
            '(absent)',
            '(present)',
            action.target
          );
        }
        continue;
      }
      if (text === null) {
        throw staleRefusal(
          `the canonical spec ${action.target}`,
          precondition.sha256,
          '(absent)',
          action.target
        );
      }
      const digest = createHash('sha256').update(text, 'utf8').digest('hex');
      if (digest !== precondition.sha256) {
        throw staleRefusal(
          `the canonical spec ${action.target}`,
          precondition.sha256,
          digest,
          action.target
        );
      }
    }

    // The Change source, compared BEFORE the transaction starts.
    //
    // The engine also fingerprints the active tree, but measurement says that
    // check does not refuse a source edited between plan and apply: a test that
    // rewrote a file in the Change directory and then applied the stored plan
    // published the entry and reported success. The engine's comparison exists
    // to protect a DELETION (may this tree be removed), which is a different
    // question from the one the spec asks here (is the plan still describing
    // the Change it was made for) — and the answer it gives is reached at
    // source removal, after publication, which is too late to invalidate a
    // plan.
    //
    // So the finalization Module asks its own question, in its own scope. Only
    // a Store v2 finalization reaches this; the standalone and legacy flat
    // archive paths keep the engine's semantics exactly as they were.
    const plannedSource = archivePlan.sourceFingerprint;
    if (plannedSource !== null) {
      const currentSource = await fingerprintArchiveTree(archivePlan.paths.active);
      if (currentSource.digest !== plannedSource.digest) {
        throw staleRefusal(
          `the Change source at ${archivePlan.paths.active}`,
          plannedSource.digest,
          currentSource.digest,
          archivePlan.paths.active
        );
      }
    }

    // The target-line catalog text. The plan's destination address, its
    // `planning.targetRef`, and the ref set the successor search ran over are
    // all derived from this file, so a `store target-line set-ref` between plan
    // and apply would publish a record naming a ref the line no longer uses.
    // The digest exists precisely to catch that; it is compared here rather
    // than merely carried.
    const catalogText =
      (await this.dependencies.fs.readText(revalidation.targetLine.catalogPath)) ?? '';
    const catalogDigest = createHash('sha256').update(catalogText, 'utf8').digest('hex');
    if (catalogDigest !== revalidation.targetLine.catalogDigest) {
      throw staleRefusal(
        `the target-line catalog ${revalidation.targetLine.catalogPath}`,
        revalidation.targetLine.catalogDigest,
        catalogText.length === 0 ? '(absent)' : catalogDigest,
        revalidation.targetLine.catalogPath
      );
    }

    // The successor evidence. A `superseded` record names another Change
    // INSTANCE, and the only thing that made that name true was a committed
    // blob at a Store ref. Re-read it: if the successor's Change directory was
    // deleted and the deletion committed between plan and apply, publishing
    // `supersededBy` would fabricate exactly the pointer the successor search
    // exists to prevent.
    const successor = revalidation.successor;
    if (successor !== undefined) {
      const text = await this.dependencies.git.showBlob(
        archivePlan.roots.planning,
        successor.foundAtRef,
        successor.blobPath
      );
      if (text === null) {
        throw staleRefusal(
          `the successor Change metadata at ${successor.foundAtRef}:${successor.blobPath}`,
          successor.digest,
          '(absent)',
          archivePlan.roots.planning
        );
      }
      const digest = createHash('sha256').update(text, 'utf8').digest('hex');
      if (digest !== successor.digest) {
        throw staleRefusal(
          `the successor Change metadata at ${successor.foundAtRef}:${successor.blobPath}`,
          successor.digest,
          digest,
          archivePlan.roots.planning
        );
      }
    }
  }
}

/**
 * Re-raises a collected blocker as the refusal it was, preserving its code and
 * both disagreeing values. Used where continuing would replace a precise
 * diagnostic with a vaguer one.
 */
function refusalFromBlocker(
  blocker: FinalizationBlocker | undefined,
  changeId: string
): ChangeFinalizationError {
  if (blocker === undefined) {
    return finalizationError(
      'landed_proof_unavailable',
      `Change '${changeId}' could not prove its landed outcome.`,
      { target: changeId }
    );
  }
  return finalizationError(blocker.code, blocker.message, {
    ...(blocker.expected === undefined ? {} : { expected: blocker.expected }),
    ...(blocker.actual === undefined ? {} : { actual: blocker.actual }),
    ...(blocker.fix === undefined ? {} : { fix: blocker.fix }),
    target: changeId,
  });
}

function staleRefusal(
  what: string,
  expected: string,
  actual: string,
  target: string
): ChangeFinalizationError {
  return finalizationRefusal(
    'finalization_plan_stale',
    `${what} changed between planning and applying, so the plan is stale.`,
    {
      expected,
      actual,
      target,
      fix: 'Re-plan the finalization. A stale plan is invalidated, never repaired into agreement.',
    }
  );
}

const TRANSACTION_ID_PLACEHOLDER = '<transaction-id>';

/**
 * The plan identifier covers both halves of the decision — the finalization
 * facts and the underlying archive transaction — so a change to either
 * invalidates it. The transaction's INSTANCE fields are excluded (its random
 * transaction id, its own hash, and the stage/journal paths derived from that
 * id) so that planning the same inputs twice under a fixed clock produces the
 * same identifier, which is the property the spec asks for.
 *
 * Deleting `paths.stage` and `paths.journal` is not sufficient on its own: the
 * ordered ACTION list embeds the same stage and journal paths, and each of
 * those carries the random transaction id. So the canonical bytes are
 * normalized by substituting that id — wherever it appears, at any depth —
 * before hashing. Removing the action list instead would drop real decisions
 * (which payload is copied, which spec target is written) from the identifier.
 */
export function finalizationPlanId(plan: {
  readonly archivePlan: ArchivePlan;
  readonly [key: string]: unknown;
}): string {
  const { archivePlan, createdAt: _createdAt, ...decision } = plan;
  const {
    transactionId,
    planHash: _planHash,
    createdAt: _archiveCreatedAt,
    paths,
    ...archiveDecision
  } = archivePlan;
  const { stage: _stage, journal: _journal, ...stablePaths } = paths;
  const canonical = canonicalBytes({
    domain: 'change-finalization-plan/v1',
    decision,
    archive: { ...archiveDecision, paths: stablePaths },
  }).toString('utf8');
  const normalized =
    transactionId.length === 0
      ? canonical
      : canonical.split(transactionId).join(TRANSACTION_ID_PLACEHOLDER);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function emptyPreparation(
  input: DescribeFinalizationInput
): FinalizeChangeInput['archive'] {
  return {
    planningRoot: input.startPath,
    executionRoot: input.startPath,
    activePath: input.startPath,
    archiveParent: input.startPath,
    ephemeraPath: input.startPath,
    date: new Date().toISOString().slice(0, 10),
    keepEphemera: false,
    validation: 'skipped',
    tasks: { total: 0, completed: 0, override: true },
    timing: { mode: 'on-merge', deliveryMode: null, override: true },
    specActionCandidates: [],
    hasDeltaSpecs: false,
    sidecar: {
      status: 'absent',
      schemaVersion: null,
      change: null,
      disposition: 'unjudged-preserve-all',
      handoff: { complete: null, decisions: [], inventory: [] },
      probes: [],
      blockers: [],
    },
    shipLog: {
      source: null,
      sha256: null,
      recordedCommit: null,
      reservedSection: false,
    },
    scope: { kind: 'store-project' },
  };
}

export const ChangeFinalizationModuleInstance = new ChangeFinalization();

export type { BindingFact };
export { persistArchivePlan };
