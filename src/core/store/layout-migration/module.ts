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
import { parseStoreTargetLineCatalogV1 } from '../planning-catalogs.js';
import { listTargetLineEntries } from '../query/refs.js';
import { productionStoreIssueDependencies } from '../issues/dependencies.js';
import {
  heldIssueLockKeys,
  issueAllocationLockHeld,
  issueAllocationLockKey,
  issueLockCanonicalBytes,
  issueLockKey,
  withIssueAllocationLock,
  withIssueLockBatch,
} from '../issues/locks.js';
import {
  deriveLegacyIssueUid,
  projectStoredIssueIdentity,
  resolveIssueSelector,
  type IssueIdentityCandidate,
} from '../issues/identity.js';
import { isStoreIssueError } from '../issues/diagnostics.js';
import { parseStoredIssueRecord } from '../issues/records.js';
import { resolveRegisteredStore } from '../registry.js';
import {
  consumeDestinationOwnedStagingCopies,
  emptyResult,
  manifestRelativePath,
  planRelativePath,
  publicationCommitSuggestion,
  publishPlan,
  reconcileLegacyCreatedPaths,
  retireFlatTree,
  retirementCommitSuggestion,
  revalidatePlan,
  rollbackRun,
  readRecoveryManifest,
  stagePlan,
  verifyStagedTree,
  verifyRecoveryOperationOwnership,
  type PreparedRecoveryManifest,
  type RecoveryManifest,
} from './apply.js';
import {
  productionStoreLayoutMigrationDependencies,
  type StoreLayoutMigrationDependencies,
} from './dependencies.js';
import { flatStorePaths, sha256Hex, storeRelative } from './flat-source.js';
import { inventoryStore } from './inventory.js';
import { loadMappingFile } from './mapping.js';
import { buildMigrationPlan, planGateError, readImmutableMigrationPlan } from './plan.js';
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
    return this.withPublicationLocks(plan, token, this.globalDataDir, async () =>
      this.applyLocked(plan, token, this.globalDataDir)
    );
  }

  private async withPublicationLocks<T>(
    plan: ImmutableMigrationPlan,
    token: Pick<MigrationPlanToken, 'storeUid' | 'ref'>,
    globalDataDir: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const issueIds = plan.items.flatMap((item) =>
      item.materialization?.kind === 'generated-tree' &&
      item.disposition?.kind === 'store-issue'
        ? [item.disposition.issueId]
        : []
    );
    const keys = issueIds.map(issueId =>
      issueLockKey({
        storeUid: token.storeUid,
        issueUid: deriveLegacyIssueUid(token.storeUid, issueId),
      })
    );
    const run = async (): Promise<T> => {
      if (keys.length > 0) {
        if (!issueAllocationLockHeld()) {
          throw new Error(
            'generated layout publication entered its Issue batch without the Store allocation lock'
          );
        }
        const expected = keys
          .map((key) => issueLockCanonicalBytes(key).toString('hex'))
          .filter((value, index, all) => all.indexOf(value) === index)
          .sort();
        const held = heldIssueLockKeys()
          .map((key) => issueLockCanonicalBytes(key).toString('hex'))
          .sort();
        if (expected.join(',') !== held.join(',')) {
          throw new Error('generated layout publication entered its run lock without the expected Issue batch');
        }
      }
      const lockPath = machineLockPath(
        path.resolve(
          plan.storeRoot,
          `.rasen-store-layout-${token.storeUid}-${token.ref.replace(/\W/gu, '_')}`
        )
      );
      return withOwnerAwareFileLock(
        {
          lockPath,
          holder: 'store-layout-migration',
          errorFor: layoutMigrationLockError,
        },
        async () => {
          await this.dependencies.checkpoint({
            kind: 'migration-run-acquired',
            storeUid: token.storeUid,
            ref: token.ref,
          });
          return fn();
        }
      );
    };
    if (keys.length === 0) return run();
    const coordination = productionStoreIssueDependencies.coordination(globalDataDir);
    return withIssueAllocationLock(
      coordination,
      issueAllocationLockKey({ storeUid: token.storeUid }),
      () =>
        withIssueLockBatch(coordination, keys, run, {
          onAcquired: async (key, index, total) => {
            await this.dependencies.checkpoint({
              kind: 'issue-lock-acquired',
              issueId: key.material.issueUid ?? key.label,
              index,
              total,
            });
          },
        })
    );
  }

  /**
   * Rebuild the complete declared-ref selector catalog while the Store
   * allocation lock is held. The immutable migration plan chose legacy aliases
   * before publication; a V2 create that acquired allocation first may now own
   * one of those aliases from a UID directory. Checking only the planned
   * physical destination would miss that semantic collision.
   *
   * A recovery-owned V1 destination is allowed: its projected UID and storage
   * key are exactly the values this migration is resuming. Every other match,
   * ambiguity, or unreadable durable record makes the frozen plan stale.
   */
  private async revalidateGeneratedIssueSelectors(
    plan: ImmutableMigrationPlan,
    storeUid: string
  ): Promise<void> {
    const issueIds = plan.items.flatMap((item) =>
      item.materialization?.kind === 'generated-tree' &&
      item.disposition?.kind === 'store-issue'
        ? [item.disposition.issueId]
        : []
    );
    if (issueIds.length === 0) return;
    if (!issueAllocationLockHeld()) {
      throw new Error(
        'generated Issue selector revalidation requires the Store allocation lock'
      );
    }

    const issuesRoot = path.join(plan.storeRoot, 'rasen', 'issues');
    const candidates: IssueIdentityCandidate[] = [];
    for (const entry of await this.dependencies.fs.listEntries(issuesRoot)) {
      if (entry.kind !== 'directory') continue;
      const recordPath = path.join(issuesRoot, entry.name, 'issue.yaml');
      const content = await this.dependencies.fs.readText(recordPath);
      if (content === null) continue;
      try {
        const record = parseStoredIssueRecord(content, recordPath);
        candidates.push({
          ...projectStoredIssueIdentity({
            storeUid,
            record,
            storageKey: entry.name,
          }),
          title: record.title,
        });
      } catch (error) {
        throw migrationError(
          'migration_plan_stale',
          `The generated Issue selector catalog is stale because ${recordPath} is no longer readable: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'Repair the Issue record, then re-run the migration plan; nothing was written, moved, or deleted.'
        );
      }
    }

    const declaredRefs = new Set<string>();
    for (const entry of await listTargetLineEntries(
      this.dependencies.referenceEvidence,
      plan.storeRoot
    )) {
      if (entry.catalog === null) {
        throw migrationError(
          'migration_plan_stale',
          `The generated Issue selector catalog is incomplete because target-line catalog ${entry.path} is unreadable.`,
          'Repair the target-line catalog, then re-run the migration plan; nothing was written, moved, or deleted.'
        );
      }
      declaredRefs.add(entry.catalog.storeRef);
    }
    for (const output of plan.targetLineCatalogs) {
      try {
        declaredRefs.add(
          parseStoreTargetLineCatalogV1(output.catalogYaml, output.destination).storeRef
        );
      } catch (error) {
        throw migrationError(
          'migration_plan_stale',
          `The frozen target-line catalog ${output.destinationRelative} no longer validates: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'Re-plan the migration; nothing was written, moved, or deleted.'
        );
      }
    }

    for (const storeRef of [...declaredRefs].sort()) {
      const oid = await this.dependencies.referenceEvidence.git.resolveCommit(
        plan.storeRoot,
        storeRef
      );
      if (oid === null) {
        throw migrationError(
          'migration_plan_stale',
          `The generated Issue selector catalog is incomplete because declared Store ref '${storeRef}' does not resolve to a commit.`,
          'Restore the declared ref or update the target-line catalog, then re-plan; nothing was written, moved, or deleted.'
        );
      }
      const entries =
        (await this.dependencies.referenceEvidence.git.showTree(
          plan.storeRoot,
          oid,
          'rasen/issues'
        )) ?? [];
      for (const entry of entries) {
        if (!entry.endsWith('/')) continue;
        const storageKey = entry.slice(0, -1);
        const recordPath = `rasen/issues/${storageKey}/issue.yaml`;
        const content = await this.dependencies.referenceEvidence.git.showBlob(
          plan.storeRoot,
          oid,
          recordPath
        );
        if (content === null) continue;
        try {
          const record = parseStoredIssueRecord(content, `${storeRef}:${recordPath}`);
          candidates.push({
            ...projectStoredIssueIdentity({ storeUid, record, storageKey }),
            title: record.title,
          });
        } catch (error) {
          throw migrationError(
            'migration_plan_stale',
            `The generated Issue selector catalog is incomplete because ${storeRef}:${recordPath} is unreadable: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'Repair the Issue record, then re-run the migration plan; nothing was written, moved, or deleted.'
          );
        }
      }
    }

    for (const issueId of issueIds) {
      const expectedUid = deriveLegacyIssueUid(storeUid, issueId);
      const conflictingUidOwner = candidates.find(
        candidate =>
          candidate.identity.uid === expectedUid &&
          !(
            candidate.sourceVersion === 1 &&
            String(candidate.storageKey) === issueId
          )
      );
      if (conflictingUidOwner !== undefined) {
        throw migrationError(
          'migration_plan_stale',
          `Generated Issue '${issueId}' projects to UID '${expectedUid}', but that UID already belongs to ${conflictingUidOwner.identity.key} at '${conflictingUidOwner.storageKey}'.`,
          'Resolve the UID collision, then re-run the migration plan; nothing was written, moved, or deleted.'
        );
      }
      try {
        const selected = resolveIssueSelector({
          selector: issueId,
          candidates,
          complete: true,
        });
        if (
          selected.identity.uid === expectedUid &&
          String(selected.storageKey) === issueId
        ) {
          continue;
        }
        throw migrationError(
          'migration_plan_stale',
          `Generated Issue selector '${issueId}' now identifies ${selected.identity.key} (${selected.identity.uid}) at '${selected.storageKey}', so the frozen migration destination is stale.`,
          'Choose a different legacy Issue alias or remove the conflict, then re-run the migration plan; nothing was written, moved, or deleted.'
        );
      } catch (error) {
        if (isStoreIssueError(error) && error.issueCode === 'issue_not_found') continue;
        if (error instanceof StoreError && error.diagnostic.code === 'migration_plan_stale') {
          throw error;
        }
        throw migrationError(
          'migration_plan_stale',
          `Generated Issue selector '${issueId}' is no longer unique: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'Resolve the selector conflict, then re-run the migration plan; nothing was written, moved, or deleted.'
        );
      }
    }
  }

  private async applyLocked(
    plan: ImmutableMigrationPlan,
    token: MigrationPlanToken,
    globalDataDir: string | undefined
  ): Promise<MigrationResult> {
    await revalidatePlan(this.dependencies, plan);
    await this.revalidateGeneratedIssueSelectors(plan, token.storeUid);
    const issueIds = plan.items.flatMap((item) =>
      item.materialization?.kind === 'generated-tree' &&
      item.disposition?.kind === 'store-issue'
        ? [item.disposition.issueId]
        : []
    );
    await this.dependencies.checkpoint({
      kind: 'generated-destination-precondition',
      issueIds,
    });

    const paths = flatStorePaths(plan.storeRoot);
    const legacyManifest = (await this.dependencies.fs.readText(paths.adoptionsManifest)) ?? undefined;
    const staged = await stagePlan(this.dependencies, plan, legacyManifest);
    await verifyStagedTree(this.dependencies, plan, staged);

    const coordination = this.dependencies.coordination(globalDataDir);
    const manifestRelative = manifestRelativePath(token.storeUid, token.ref);
    const startedAt = this.dependencies.now().toISOString();
    const initial: PreparedRecoveryManifest = {
      version: 2,
      runId: sha256Hex(
        `${plan.planId}\0${startedAt}\0${this.dependencies.mintInstanceSeed()}`
      ),
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
      operations: [],
      phases: [{ phase: 'verified', at: startedAt }],
    };

    // The failure path must record the LATEST manifest, not the initial one.
    // `publishPlan` accumulates `createdPaths` and `replacedFiles` as it
    // renames and overwrites, and that accumulation is the only thing
    // `--rollback` can act on. Marking the run failed by spreading `initial`
    // discarded it, so a mid-publication failure left orphaned partitions and
    // an upgraded catalog behind with a manifest that claimed the run had
    // created nothing (design decision 9; task 6.3).
    let latestManifest: PreparedRecoveryManifest = initial;
    const writeManifest = async (manifest: PreparedRecoveryManifest): Promise<void> => {
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
    const globalDataDir = input.globalDataDir ?? this.globalDataDir;
    const context = await this.resolveStore(input);
    const ref = (await this.dependencies.git.currentRef(context.storeRoot)) ?? undefined;
    const manifest = await this.readManifest(
      context,
      ref,
      globalDataDir
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
                    .coordination(globalDataDir)
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
    const globalDataDir = input.globalDataDir ?? this.globalDataDir;
    const context = await this.resolveStore(input);
    this.assertInvokedFromStoreWorktree(context, input.startPath);
    const ref = (await this.dependencies.git.currentRef(context.storeRoot)) ?? undefined;
    const manifest = await this.readManifest(
      context,
      ref,
      globalDataDir
    );
    if (manifest === null || manifest === undefined) {
      throw migrationError(
        'migration_run_missing',
        `No layout migration run is recorded for store '${context.storeId}' on ${String(ref)}.`,
        'Run `rasen store migrate-layout <store-id>` to produce a plan first.'
      );
    }

    const plan = await this.loadPlanById(manifest, globalDataDir);

    if (input.action === 'rollback') {
      if (manifest.phase === 'retired') {
        throw migrationError(
          'migration_rollback_after_retirement',
          'The flat tree has already been retired, so rollback can no longer restore it.',
          'Recover with Git: check out the commit before the retirement commit in the Store repository.'
        );
      }
      const removed = await this.withPublicationLocks(
        plan,
        { storeUid: manifest.storeUid, ref: manifest.ref },
        globalDataDir,
        async () => {
          if (manifest.version === 2) {
            await verifyRecoveryOperationOwnership(this.dependencies, manifest, plan);
          }
          const rolledBack = await rollbackRun(this.dependencies, manifest, plan);
          await this.dependencies
            .coordination(globalDataDir)
            .writeJson(manifestRelativePath(manifest.storeUid, manifest.ref), {
              ...manifest,
              phase: 'rolled-back',
              updatedAt: this.dependencies.now().toISOString(),
            });
          return rolledBack;
        }
      );
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
        .coordination(globalDataDir)
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
    return this.withPublicationLocks(plan, plan.token, globalDataDir, async () =>
      this.resumeLocked(
        plan,
        plan.token as MigrationPlanToken,
        manifest,
        globalDataDir
      )
    );
  }

  private async resumeLocked(
    plan: ImmutableMigrationPlan,
    token: MigrationPlanToken,
    manifest: RecoveryManifest,
    globalDataDir: string | undefined
  ): Promise<MigrationResult> {
    if (manifest.version === 2) {
      await verifyRecoveryOperationOwnership(this.dependencies, manifest, plan);
    }
    await revalidatePlan(this.dependencies, plan, manifest);
    await this.revalidateGeneratedIssueSelectors(plan, token.storeUid);
    const issueIds = plan.items.flatMap((item) =>
      item.materialization?.kind === 'generated-tree' &&
      item.disposition?.kind === 'store-issue'
        ? [item.disposition.issueId]
        : []
    );
    await this.dependencies.checkpoint({
      kind: 'generated-destination-precondition',
      issueIds,
    });
    const paths = flatStorePaths(plan.storeRoot);
    const legacyManifest =
      (await this.dependencies.fs.readText(paths.adoptionsManifest)) ?? undefined;
    const staged = await stagePlan(this.dependencies, plan, legacyManifest);
    await verifyStagedTree(this.dependencies, plan, staged);
    const coordination = this.dependencies.coordination(globalDataDir);
    const manifestRelative = manifestRelativePath(token.storeUid, token.ref);
    const resumedAt = this.dependencies.now().toISOString();
    let latest: PreparedRecoveryManifest;
    if (manifest.version === 1) {
      const runId = sha256Hex(
        `${plan.planId}\0${resumedAt}\0${this.dependencies.mintInstanceSeed()}`
      );
      const operations = await reconcileLegacyCreatedPaths(
        this.dependencies,
        manifest,
        staged,
        runId
      );
      latest = {
        ...manifest,
        version: 2,
        runId,
        operations,
        phase: 'verified',
        stagingDir: staged.root,
        updatedAt: resumedAt,
      };
    } else {
      await consumeDestinationOwnedStagingCopies(
        this.dependencies,
        staged,
        manifest.operations,
        manifest.startedAt
      );
      latest = {
        ...manifest,
        phase: 'verified',
        stagingDir: staged.root,
        updatedAt: resumedAt,
      };
    }
    const writeManifest = async (next: PreparedRecoveryManifest): Promise<void> => {
      latest = next;
      await coordination.writeJson(manifestRelative, next);
    };
    if (manifest.version === 1) {
      // The v2 upgrade must itself be a valid fresh-process boundary: every
      // adopted completed operation already has one digest-proved destination
      // copy and no staged copy before these ownership claims become durable.
      await verifyRecoveryOperationOwnership(this.dependencies, latest, plan);
    }
    await writeManifest(latest);
    if (manifest.version === 1) {
      await this.dependencies.checkpoint({ kind: 'legacy-recovery-upgrade', phase: 'after' });
    }
    try {
      const outcome = await publishPlan(
        this.dependencies,
        plan,
        staged,
        writeManifest,
        latest
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
        ...latest,
        phase: 'failed',
        updatedAt: this.dependencies.now().toISOString(),
        failure: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    return value === null ? null : readRecoveryManifest(value);
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
    const plan = readImmutableMigrationPlan(value);
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
    return readImmutableMigrationPlan(value);
  }
}

/** The production Module instance. */
export const StoreLayoutMigrationModuleInstance = new StoreLayoutMigration();
