/**
 * `StoreLayoutMigrationModule` — the one deep Module behind
 * `rasen store migrate-layout` and the migration diagnostics.
 *
 * Callers see semantic items, states, and reasons. Ref enumeration and blob
 * reads, the evidence reducer and its precedence, the spec provenance graph,
 * layout/catalog/identity contract calls, staging and digest verification, the
 * ordered publication sequence, recovery-manifest bookkeeping, and receipt
 * serialization are all hidden here.
 */
import * as path from 'node:path';

import { FileSystemUtils } from '../../../utils/file-system.js';
import {
  machineLockPath,
  makeLockErrorFactory,
  withOwnerAwareFileLock,
} from '../../file-state.js';
import { StoreError } from '../errors.js';
import { resolveRegisteredStore } from '../registry.js';
import {
  emptyResult,
  manifestRelativePath,
  planRelativePath,
  publicationCommitSuggestion,
  publishPlan,
  retireFlatTree,
  retirementCommitSuggestion,
  revalidatePlan,
  rollbackRun,
  stagePlan,
  verifyStagedTree,
  type RecoveryManifest,
} from './apply.js';
import {
  productionStoreLayoutMigrationDependencies,
  type StoreLayoutMigrationDependencies,
} from './dependencies.js';
import { flatStorePaths, storeRelative } from './flat-source.js';
import { inventoryStore } from './inventory.js';
import { loadMappingFile } from './mapping.js';
import { buildMigrationPlan, planGateError } from './plan.js';
import { migrationReceiptPath } from './receipt.js';
import type {
  FlatStoreInventory,
  ImmutableMigrationPlan,
  InventoryInput,
  MigrationPlanInput,
  MigrationPlanToken,
  MigrationRecoveryInput,
  MigrationResult,
  MigrationRunStatus,
  MigrationStatusInput,
  StoreLayoutMigrationModule,
} from './types.js';

interface ResolvedStoreContext {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
}

/**
 * The Store-scoped, owner-aware lock every apply runs under, keyed by store UID
 * and ref so a second machine (or a second worktree) cannot publish the same
 * Store concurrently.
 */
const layoutMigrationLockError = makeLockErrorFactory({
  createSubject: 'the Store layout migration lock file',
  busyMessage: 'Another layout migration is running for this Store and ref.',
  code: 'migration_lock_unavailable',
  target: 'migration.apply',
});

function migrationError(code: string, message: string, fix: string): StoreError {
  return new StoreError(message, code, { target: 'migration.store', fix });
}

function canonical(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(canonical(root), canonical(candidate));
  if (relative.length === 0) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export interface StoreLayoutMigrationOptions {
  /**
   * Machine data root for the coordination store. Constructor-scoped rather
   * than per-call because `apply(token)` consumes ONLY a token, so there is no
   * other place a machine-local location could arrive from without turning the
   * Module into a stateful object.
   */
  readonly globalDataDir?: string;
}

export class StoreLayoutMigration implements StoreLayoutMigrationModule {
  private readonly globalDataDir: string | undefined;

  constructor(
    private readonly dependencies: StoreLayoutMigrationDependencies = productionStoreLayoutMigrationDependencies,
    options: StoreLayoutMigrationOptions = {}
  ) {
    this.globalDataDir = options.globalDataDir;
  }

  async inventory(input: InventoryInput): Promise<FlatStoreInventory> {
    const context = await this.resolveStore(input);
    return inventoryStore(this.dependencies, context, (ref) =>
      this.migrateCommandFor(context.storeId, ref)
    );
  }

  async plan(input: MigrationPlanInput): Promise<ImmutableMigrationPlan> {
    const context = await this.resolveStore(input);
    this.assertInvokedFromStoreWorktree(context, input.startPath);
    const inventory = await inventoryStore(this.dependencies, context, (ref) =>
      this.migrateCommandFor(context.storeId, ref)
    );

    const mapping =
      input.mappingPath === undefined
        ? undefined
        : await loadMappingFile(this.dependencies, context.storeRoot, input.mappingPath);

    const publicationRecorded = await this.hasCompletedPublication(context, inventory);

    const plan = await buildMigrationPlan(this.dependencies, {
      context,
      inventory,
      ...(mapping === undefined ? {} : { mapping }),
      ...(input.defaultTargetLine === undefined
        ? {}
        : { defaultTargetLine: input.defaultTargetLine }),
      includeUntracked: input.includeUntracked === true,
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
      ...(input.pathFlavor === undefined ? {} : { pathFlavor: input.pathFlavor }),
      publicationRecorded,
    });

    if (plan.token !== undefined) {
      const coordination = this.dependencies.coordination(
        input.globalDataDir ?? this.globalDataDir
      );
      await coordination.writeJson(
        planRelativePath(plan.token.storeUid, plan.token.ref, plan.planId),
        plan
      );
    }
    return plan;
  }

  async apply(token: MigrationPlanToken): Promise<MigrationResult> {
    const plan = await this.loadPlan(token);
    if (!plan.applicable) throw planGateError(plan);

    const lockPath = machineLockPath(
      path.resolve(plan.storeRoot, `.rasen-store-layout-${token.storeUid}-${token.ref.replace(/\W/gu, '_')}`)
    );
    return withOwnerAwareFileLock(
      {
        lockPath,
        holder: 'store-layout-migration',
        errorFor: layoutMigrationLockError,
      },
      async () => this.applyLocked(plan, token)
    );
  }

  private async applyLocked(
    plan: ImmutableMigrationPlan,
    token: MigrationPlanToken
  ): Promise<MigrationResult> {
    await revalidatePlan(this.dependencies, plan);

    const paths = flatStorePaths(plan.storeRoot);
    const legacyManifest = (await this.dependencies.fs.readText(paths.adoptionsManifest)) ?? undefined;
    const staged = await stagePlan(this.dependencies, plan, legacyManifest);
    await verifyStagedTree(this.dependencies, plan, staged);

    const coordination = this.dependencies.coordination(this.globalDataDir);
    const manifestRelative = manifestRelativePath(token.storeUid, token.ref);
    const startedAt = this.dependencies.now().toISOString();
    const initial: RecoveryManifest = {
      version: 1,
      planId: plan.planId,
      storeId: plan.storeId,
      storeUid: token.storeUid,
      storeRoot: plan.storeRoot,
      ref: token.ref,
      headOid: token.headOid,
      phase: 'verified',
      startedAt,
      updatedAt: startedAt,
      stagingDir: staged.root,
      createdPaths: [],
      replacedFiles: {},
      phases: [{ phase: 'verified', at: startedAt }],
    };

    // The failure path must record the LATEST manifest, not the initial one.
    // `publishPlan` accumulates `createdPaths` and `replacedFiles` as it
    // renames and overwrites, and that accumulation is the only thing
    // `--rollback` can act on. Marking the run failed by spreading `initial`
    // discarded it, so a mid-publication failure left orphaned partitions and
    // an upgraded catalog behind with a manifest that claimed the run had
    // created nothing (design decision 9; task 6.3).
    let latestManifest: RecoveryManifest = initial;
    const writeManifest = async (manifest: RecoveryManifest): Promise<void> => {
      latestManifest = manifest;
      await coordination.writeJson(manifestRelative, manifest);
    };
    await writeManifest(initial);

    try {
      const outcome = await publishPlan(
        this.dependencies,
        plan,
        staged,
        writeManifest,
        initial
      );
      return {
        planId: plan.planId,
        storeId: plan.storeId,
        storeRoot: plan.storeRoot,
        ref: plan.ref as string,
        phase: 'published',
        published: outcome.published,
        removed: [],
        receiptPath: staged.receiptDestination,
        suggestedCommits: [publicationCommitSuggestion(plan)],
      };
    } catch (error) {
      await writeManifest({
        ...latestManifest,
        phase: 'failed',
        updatedAt: this.dependencies.now().toISOString(),
        failure: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async status(input: MigrationStatusInput): Promise<MigrationRunStatus> {
    const context = await this.resolveStore(input);
    const ref = (await this.dependencies.git.currentRef(context.storeRoot)) ?? undefined;
    const manifest = await this.readManifest(
      context,
      ref,
      input.globalDataDir ?? this.globalDataDir
    );
    const publicationComplete = manifest?.phase === 'published' || manifest?.phase === 'retired';
    return {
      storeId: context.storeId,
      ...(context.storeUid === undefined ? {} : { storeUid: context.storeUid }),
      ...(ref === undefined ? {} : { ref }),
      ...(manifest === null || manifest === undefined
        ? { createdPaths: [], publicationComplete: false }
        : {
            planId: manifest.planId,
            phase: manifest.phase,
            startedAt: manifest.startedAt,
            updatedAt: manifest.updatedAt,
            createdPaths: manifest.createdPaths.map((created) =>
              storeRelative(context.storeRoot, created)
            ),
            manifestPath:
              context.storeUid === undefined || ref === undefined
                ? undefined
                : this.dependencies
                    .coordination(input.globalDataDir ?? this.globalDataDir)
                    .resolve(manifestRelativePath(context.storeUid, ref)),
            ...(manifest.receiptPath === undefined
              ? {}
              : { receiptPath: manifest.receiptPath }),
            publicationComplete,
            ...(manifest.failure === undefined ? {} : { failure: manifest.failure }),
          }),
    } as MigrationRunStatus;
  }

  async recover(input: MigrationRecoveryInput): Promise<MigrationResult> {
    const context = await this.resolveStore(input);
    this.assertInvokedFromStoreWorktree(context, input.startPath);
    const ref = (await this.dependencies.git.currentRef(context.storeRoot)) ?? undefined;
    const manifest = await this.readManifest(
      context,
      ref,
      input.globalDataDir ?? this.globalDataDir
    );
    if (manifest === null || manifest === undefined) {
      throw migrationError(
        'migration_run_missing',
        `No layout migration run is recorded for store '${context.storeId}' on ${String(ref)}.`,
        'Run `rasen store migrate-layout <store-id>` to produce a plan first.'
      );
    }

    const plan = await this.loadPlanById(manifest, input.globalDataDir ?? this.globalDataDir);

    if (input.action === 'rollback') {
      if (manifest.phase === 'retired') {
        throw migrationError(
          'migration_rollback_after_retirement',
          'The flat tree has already been retired, so rollback can no longer restore it.',
          'Recover with Git: check out the commit before the retirement commit in the Store repository.'
        );
      }
      const removed = await rollbackRun(this.dependencies, manifest);
      await this.dependencies
        .coordination(input.globalDataDir ?? this.globalDataDir)
        .writeJson(manifestRelativePath(manifest.storeUid, manifest.ref), {
          ...manifest,
          phase: 'rolled-back',
          updatedAt: this.dependencies.now().toISOString(),
        });
      return { ...emptyResult(plan, 'rolled-back'), removed };
    }

    if (input.action === 'retire-flat') {
      const receiptPresent =
        (await this.dependencies.fs.statKind(
          migrationReceiptPath(context.storeRoot, manifest.planId)
        )) === 'file';
      // `retired` is accepted alongside `published` because retirement is
      // IDEMPOTENT (task 6.6): the gate is "a completed publication exists for
      // this ref", not "this ref has never been retired". Refusing the second
      // run turned a re-run — the normal way to finish an interrupted
      // retirement — into an error naming a publication that had in fact
      // happened.
      const published = manifest.phase === 'published' || manifest.phase === 'retired';
      if (!published || !receiptPresent) {
        throw migrationError(
          'migration_retire_without_publication',
          `Retirement refuses to run: no completed publication is recorded for ${String(ref)}.`,
          'Publish first with `rasen store migrate-layout <store-id> --apply`, commit it, then retire.'
        );
      }
      const removed = await retireFlatTree(this.dependencies, plan);
      await this.dependencies
        .coordination(input.globalDataDir ?? this.globalDataDir)
        .writeJson(manifestRelativePath(manifest.storeUid, manifest.ref), {
          ...manifest,
          phase: 'retired',
          updatedAt: this.dependencies.now().toISOString(),
          phases: [
            ...manifest.phases,
            { phase: 'retired', at: this.dependencies.now().toISOString() },
          ],
        });
      return {
        ...emptyResult(plan, 'retired'),
        removed,
        suggestedCommits: [retirementCommitSuggestion(plan)],
      };
    }

    // resume
    if (manifest.phase === 'published' || manifest.phase === 'retired') {
      return { ...emptyResult(plan, manifest.phase), suggestedCommits: [] };
    }
    if (plan.token === undefined) throw planGateError(plan);
    return this.apply(plan.token);
  }

  // ---------------------------------------------------------------------------

  private migrateCommandFor(storeId: string, ref: string): string {
    return `rasen store migrate-layout ${storeId} --apply  # from a worktree with ${ref} checked out`;
  }

  private async resolveStore(input: InventoryInput): Promise<ResolvedStoreContext> {
    const dataDir = input.globalDataDir ?? this.globalDataDir;
    const store = await resolveRegisteredStore({
      id: input.storeSelector,
      ...(dataDir === undefined ? {} : { globalDataDir: dataDir }),
    });
    return {
      storeId: store.id,
      ...(store.uid === undefined ? {} : { storeUid: store.uid }),
      storeRoot: store.storeRoot,
    };
  }

  /**
   * Migration only ever touches the ref checked out in the INVOKING Store
   * worktree. Writing into another ref's tree would need a checkout or an index
   * write, and Rasen performs no Git mutation on the operator's behalf.
   */
  private assertInvokedFromStoreWorktree(
    context: ResolvedStoreContext,
    startPath: string
  ): void {
    if (isInside(context.storeRoot, startPath)) return;
    throw migrationError(
      'migration_not_checked_out',
      `Layout migration must run from the Store worktree itself; ${startPath} is outside ${context.storeRoot}.`,
      `Change directory to ${context.storeRoot} (or the linked worktree holding the ref you want to migrate) and re-run.`
    );
  }

  private async hasCompletedPublication(
    context: ResolvedStoreContext,
    inventory: FlatStoreInventory
  ): Promise<boolean> {
    const manifest = await this.readManifest(
      context,
      inventory.checkedOutRef,
      this.globalDataDir
    );
    return manifest?.phase === 'published' || manifest?.phase === 'retired';
  }

  private async readManifest(
    context: ResolvedStoreContext,
    ref: string | undefined,
    globalDataDir: string | undefined
  ): Promise<RecoveryManifest | null> {
    if (context.storeUid === undefined || ref === undefined) return null;
    const value = await this.dependencies
      .coordination(globalDataDir)
      .readJson(manifestRelativePath(context.storeUid, ref));
    return value === null ? null : (value as RecoveryManifest);
  }

  private async loadPlan(token: MigrationPlanToken): Promise<ImmutableMigrationPlan> {
    const value = await this.dependencies
      .coordination(this.globalDataDir)
      .readJson(planRelativePath(token.storeUid, token.ref, token.planId));
    if (value === null) {
      throw migrationError(
        'migration_plan_missing',
        `No stored plan matches token ${token.planId}.`,
        'Re-run the plan; a plan is machine-local coordination state and is never committed.'
      );
    }
    const plan = value as ImmutableMigrationPlan;
    if (
      plan.planId !== token.planId ||
      plan.inventoryFingerprint !== token.inventoryFingerprint
    ) {
      throw migrationError(
        'migration_plan_stale',
        'The stored plan does not match the supplied token.',
        'Re-run the plan.'
      );
    }
    return plan;
  }

  private async loadPlanById(
    manifest: RecoveryManifest,
    globalDataDir: string | undefined
  ): Promise<ImmutableMigrationPlan> {
    const value = await this.dependencies
      .coordination(globalDataDir)
      .readJson(planRelativePath(manifest.storeUid, manifest.ref, manifest.planId));
    if (value === null) {
      throw migrationError(
        'migration_plan_missing',
        `The recovery manifest references plan ${manifest.planId}, which is not stored on this machine.`,
        'Re-run the plan from this worktree; recovery state is machine-local.'
      );
    }
    return value as ImmutableMigrationPlan;
  }
}

/** The production Module instance. */
export const StoreLayoutMigrationModuleInstance = new StoreLayoutMigration();
