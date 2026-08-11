/**
 * Staging, verification, ordered publication, separate retirement, and recovery
 * (design D9).
 *
 *   stage -> verify -> publish (rename + layout flip) -> [user commit]
 *         -> retire flat -> [user commit]
 *
 * Sources are COPIED, never moved, so the flat tree stays complete and readable
 * through the whole staging phase. Staging lives inside the Store worktree
 * under the already-ignored `.rasen/`, which guarantees every publication
 * rename is same-volume. The `layoutVersion: 2` flip is written LAST and is the
 * single linearization point: before it every reader sees an intact flat Store,
 * after it every reader sees complete partitions.
 */
import * as path from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { ChangeMetadataSchema } from '../../change-metadata/schema.js';
import { formatZodIssues } from '../../zod-issues.js';
import { StoreError } from '../errors.js';
import {
  parseStoreMetadataState,
  serializeStoreMetadataState,
  type StoreMetadataState,
} from '../foundation.js';
import {
  parseStoreProjectCatalogV2,
  parseStoreTargetLineCatalogV1,
} from '../planning-catalogs.js';
import { parseExecutionPlanRevision } from '../issues/plans.js';
import { parseIssueRecord } from '../issues/records.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
} from '../planning-identity.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import {
  FLAT_RELATIVE,
  digestTree,
  flatStorePaths,
  sha256Hex,
  storeRelative,
} from './flat-source.js';
import { hasTypicalMojibake } from './strict-text.js';
import {
  buildMigrationReceipt,
  migrationReceiptPath,
  serializeMigrationReceipt,
  withMigrationReceiptPhase,
  type MigrationReceiptPhaseRecord,
} from './receipt.js';
import { loadMigrationPlanInput } from './plan-input.js';
import type {
  ImmutableMigrationPlan,
  MigrationPhase,
  MigrationResult,
  SuggestedMigrationCommit,
} from './types.js';

export const MIGRATION_STAGING_RELATIVE = '.rasen/migration/staging';
export const LEGACY_RECOVERY_MANIFEST_VERSION = 1;
export const RECOVERY_MANIFEST_VERSION = 2;

interface RecoveryManifestBase {
  readonly planId: string;
  readonly storeId: string;
  readonly storeUid: string;
  readonly storeRoot: string;
  readonly ref: string;
  readonly headOid: string;
  readonly phase: MigrationPhase;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stagingDir: string;
  /** Absolute paths this run created. Rollback removes only these. */
  readonly createdPaths: readonly string[];
  /** Verbatim previous bytes of files this run overwrote, keyed by absolute path. */
  readonly replacedFiles: Readonly<Record<string, string>>;
  readonly receiptPath?: string;
  readonly phases: readonly MigrationReceiptPhaseRecord[];
  readonly failure?: string;
}

export interface RecoveryOperation {
  readonly runId: string;
  readonly operationId: string;
  readonly kind: 'target-line-catalog' | 'item' | 'issue-tree' | 'receipt';
  readonly staged: string;
  readonly destination: string;
  readonly destinationRelative: string;
  readonly expectedAbsence: true;
  readonly expectedDigest: string;
  readonly status: 'prepared' | 'completed';
}

export interface LegacyRecoveryManifest extends RecoveryManifestBase {
  readonly version: typeof LEGACY_RECOVERY_MANIFEST_VERSION;
  readonly runId?: never;
  readonly operations?: never;
}

export interface PreparedRecoveryManifest extends RecoveryManifestBase {
  readonly version: typeof RECOVERY_MANIFEST_VERSION;
  /** Distinct publication attempt identity; never the content-addressed plan id. */
  readonly runId: string;
  readonly operations: readonly RecoveryOperation[];
}

export type RecoveryManifest = LegacyRecoveryManifest | PreparedRecoveryManifest;

const RecoveryPhaseSchema = z.enum([
  'staged',
  'verified',
  'publishing',
  'published',
  'retired',
  'rolled-back',
  'failed',
]);
const RecoveryOperationSchema = z
  .object({
    runId: z.string().regex(/^[0-9a-f]{64}$/u),
    operationId: z.string().min(1),
    kind: z.enum(['target-line-catalog', 'item', 'issue-tree', 'receipt']),
    staged: z.string(),
    destination: z.string(),
    destinationRelative: z.string(),
    expectedAbsence: z.literal(true),
    expectedDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    status: z.enum(['prepared', 'completed']),
  })
  .strict();
const RecoveryManifestBaseShape = {
  planId: z.string().regex(/^[0-9a-f]{64}$/u),
  storeId: z.string(),
  storeUid: z.string(),
  storeRoot: z.string(),
  ref: z.string(),
  headOid: z.string(),
  phase: RecoveryPhaseSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  stagingDir: z.string(),
  createdPaths: z.array(z.string()),
  replacedFiles: z.record(z.string(), z.string()),
  receiptPath: z.string().optional(),
  phases: z.array(z.object({ phase: RecoveryPhaseSchema, at: z.string() }).strict()),
  failure: z.string().optional(),
};
const LegacyRecoveryManifestSchema = z
  .object({
    version: z.literal(LEGACY_RECOVERY_MANIFEST_VERSION),
    ...RecoveryManifestBaseShape,
  })
  .strict();
const RecoveryManifestSchema = z
  .object({
    version: z.literal(RECOVERY_MANIFEST_VERSION),
    ...RecoveryManifestBaseShape,
    runId: z.string().regex(/^[0-9a-f]{64}$/u),
    operations: z.array(RecoveryOperationSchema),
  })
  .strict();

export function readRecoveryManifest(value: unknown): RecoveryManifest {
  const version =
    typeof value === 'object' && value !== null && 'version' in value
      ? (value as { version?: unknown }).version
      : undefined;
  const schema =
    version === LEGACY_RECOVERY_MANIFEST_VERSION
      ? LegacyRecoveryManifestSchema
      : version === RECOVERY_MANIFEST_VERSION
        ? RecoveryManifestSchema
        : null;
  if (schema === null) {
    throw applyError(
      'migration_run_missing',
      `Recovery manifest has unknown version '${String(version)}'.`,
      'Leave it intact and use the Rasen version that created the run.'
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw applyError(
      'migration_run_missing',
      `Recovery manifest is incomplete, unknown, or invalid: ${formatZodIssues(parsed.error)}`,
      'Leave it intact and use the Rasen version that created the run.'
    );
  }
  const candidate = parsed.data;
  const inside = (root: string, target: string): boolean => {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };
  if (candidate.version === RECOVERY_MANIFEST_VERSION && candidate.runId === candidate.planId) {
    throw applyError(
      'migration_run_missing',
      'Recovery manifest reuses the immutable plan id as its publication run identity.',
      'Leave the manifest intact; path existence without a distinct run identity proves no ownership.'
    );
  }
  if (
    !inside(candidate.storeRoot, candidate.stagingDir) ||
    candidate.createdPaths.some(target => !inside(candidate.storeRoot, target)) ||
    Object.keys(candidate.replacedFiles).some(target => !inside(candidate.storeRoot, target))
  ) {
    throw applyError(
      'migration_run_missing',
      'Recovery manifest contains a path outside its Store or staging root.',
      'Leave every path untouched and inspect the foreign recovery evidence.'
    );
  }
  if (candidate.version === RECOVERY_MANIFEST_VERSION) {
    const operationIds = new Set<string>();
    const destinations = new Set<string>();
    for (const operation of candidate.operations) {
      if (
        operation.runId !== candidate.runId ||
        !inside(candidate.storeRoot, operation.destination) ||
        !inside(candidate.stagingDir, operation.staged) ||
        operationIds.has(operation.operationId) ||
        destinations.has(path.resolve(operation.destination))
      ) {
        throw applyError(
          'migration_run_missing',
          'Recovery manifest contains an invalid or foreign prepared operation.',
          'Do not infer ownership from a pathname; inspect the run identity and digest.'
        );
      }
      operationIds.add(operation.operationId);
      destinations.add(path.resolve(operation.destination));
    }
  }
  return candidate as RecoveryManifest;
}

export function manifestRelativePath(storeUid: string, ref: string): string {
  return path.join(storeUid, refSlug(ref), 'manifest.json');
}

export function planRelativePath(storeUid: string, ref: string, planId: string): string {
  return path.join(storeUid, refSlug(ref), `plan-${planId}.json`);
}

/** A ref name is not a filename; slug it without losing distinctness. */
export function refSlug(ref: string): string {
  return `${ref.replace(/[^A-Za-z0-9._-]/gu, '_')}-${sha256Hex(ref).slice(0, 12)}`;
}

function stagingRoot(storeRoot: string, planId: string): string {
  return path.join(storeRoot, '.rasen', 'migration', 'staging', planId);
}

function applyError(code: string, message: string, fix: string): StoreError {
  return new StoreError(message, code, { target: 'migration.apply', fix });
}

// -----------------------------------------------------------------------------
// Revalidation
// -----------------------------------------------------------------------------

/**
 * Everything the plan assumed, re-checked immediately before the first write.
 * A stale plan is INVALIDATED, not repaired: re-planning is cheap, and silently
 * re-resolving to a different destination set is not something an operator
 * previewed.
 */
export async function revalidatePlan(
  dependencies: StoreLayoutMigrationDependencies,
  plan: ImmutableMigrationPlan,
  recovery?: RecoveryManifest
): Promise<void> {
  const storeRoot = plan.storeRoot;
  const paths = flatStorePaths(storeRoot);
  const problems: string[] = [];

  const metadataText = await dependencies.fs.readText(paths.storeMetadata);
  if (metadataText === null) {
    problems.push('the Store metadata file is gone');
  } else {
    try {
      const metadata = parseStoreMetadataState(metadataText);
      if (metadata.layoutVersion === 2 && recovery === undefined) {
        problems.push('the Store already declares layoutVersion 2');
      }
    } catch (error) {
      problems.push(
        `the Store metadata no longer parses: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const ref = await dependencies.git.currentRef(storeRoot);
  if (plan.ref !== undefined && ref !== plan.ref) {
    problems.push(`the checked-out ref is ${String(ref)}, not ${plan.ref}`);
  }
  const headOid = await dependencies.git.headOid(storeRoot);
  if (plan.headOid !== undefined && headOid !== plan.headOid) {
    problems.push(`HEAD moved from ${plan.headOid} to ${String(headOid)}`);
  }

  for (const item of plan.items) {
    // Membership records have a deliberate two-state revalidation contract:
    // before publication they match sourceDigest, while a resumed run may
    // already have written the planned v2 catalog bytes. The dedicated
    // catalog-upgrade loop below validates both states; applying the generic
    // source digest check here would reject every crash after that upgrade.
    if (item.digest !== undefined && item.kind !== 'membership-record') {
      const current = (await digestTree(dependencies.fs, item.source)).digest;
      if (current !== item.digest) problems.push(`${item.sourceRelative} changed on disk`);
    }
    if (
      item.destination !== undefined &&
      item.destination !== item.source &&
      item.kind !== 'membership-record' &&
      (await dependencies.fs.statKind(item.destination)) !== 'absent' &&
      !recovery?.operations?.some(
        (operation) => operation.destination === item.destination
      ) &&
      !recovery?.createdPaths.includes(item.destination)
    ) {
      problems.push(`${item.destinationRelative} now exists`);
    }
  }

  for (const item of plan.items) {
    if (item.planInput === undefined) continue;
    try {
      const current = await loadMigrationPlanInput(
        dependencies,
        storeRoot,
        item.planInput.path
      );
      if (
        current.relative !== item.planInput.relative ||
        current.digest !== item.planInput.digest
      ) {
        problems.push(`${item.planInput.relative} changed or moved`);
      }
    } catch (error) {
      problems.push(
        `${item.planInput.relative} is no longer a valid plan input: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (plan.mappingPath !== undefined) {
    const text = await dependencies.fs.readText(plan.mappingPath);
    if (text === null || sha256Hex(text) !== plan.mappingDigest) {
      problems.push('the mapping file changed or was removed');
    }
  }

  for (const upgrade of plan.catalogUpgrades) {
    const current = (await digestTree(dependencies.fs, upgrade.recordPath)).digest;
    const currentText = await dependencies.fs.readText(upgrade.recordPath);
    if (current !== upgrade.sourceDigest && currentText !== upgrade.catalogYaml) {
      problems.push(`${upgrade.recordRelative} changed on disk`);
    }
  }

  for (const catalog of plan.targetLineCatalogs) {
    if (
      (await dependencies.fs.statKind(catalog.destination)) !== 'absent' &&
      !recovery?.operations?.some(
        (operation) => operation.destination === catalog.destination
      ) &&
      !recovery?.createdPaths.includes(catalog.destination)
    ) {
      problems.push(`${catalog.destinationRelative} now exists`);
    }
  }

  if (problems.length > 0) {
    throw applyError(
      'migration_plan_stale',
      `The migration plan no longer matches the Store:\n  - ${problems.join('\n  - ')}`,
      'Re-run the plan; nothing was written, moved, or deleted.'
    );
  }
}

// -----------------------------------------------------------------------------
// Staging
// -----------------------------------------------------------------------------

interface StagedEntry {
  readonly staged: string;
  readonly destination: string;
  readonly destinationRelative: string;
  readonly sourceDigest?: string;
  readonly kind: 'item' | 'issue-tree' | 'target-line-catalog' | 'receipt';
}

export interface StagedTree {
  readonly root: string;
  readonly entries: readonly StagedEntry[];
  readonly receiptContent: string;
  readonly receiptDestination: string;
}

/**
 * Convert the base-version pathname ledger into digest-backed completed
 * operations. A legacy pathname is evidence only after it matches exactly one
 * freshly staged plan entry and the destination still has those exact bytes.
 */
export async function reconcileLegacyCreatedPaths(
  dependencies: StoreLayoutMigrationDependencies,
  manifest: LegacyRecoveryManifest,
  staged: StagedTree,
  runId: string
): Promise<readonly RecoveryOperation[]> {
  const operations: RecoveryOperation[] = [];
  const seen = new Set<string>();
  for (const created of manifest.createdPaths) {
    const matches = staged.entries.filter(
      (entry) => entry.destination === created
    );
    if (seen.has(created) || matches.length !== 1) {
      throw applyError(
        'migration_recovery_ambiguous',
        `Legacy recovery path ${storeRelative(manifest.storeRoot, created)} does not identify exactly one planned publication destination.`,
        'Leave the destination untouched and inspect the legacy manifest and immutable plan.'
      );
    }
    seen.add(created);
    const entry = matches[0]!;
    const stagedKind = await dependencies.fs.statKind(entry.staged);
    const destinationKind = await dependencies.fs.statKind(entry.destination);
    if (
      stagedKind === 'absent' ||
      destinationKind === 'absent' ||
      stagedKind !== destinationKind
    ) {
      throw applyError(
        'migration_recovery_ambiguous',
        `Legacy recovery destination ${entry.destinationRelative} has kind '${destinationKind}', not its planned '${stagedKind}' kind.`,
        'Leave both paths untouched; missing or wrong-kind content cannot be adopted as this run\'s publication.'
      );
    }
    if (entry.kind === 'receipt') {
      const stagedText = await dependencies.fs.readText(entry.staged);
      if (stagedText === null) {
        throw applyError(
          'migration_recovery_ambiguous',
          `Legacy recovery receipt staging is missing for ${entry.destinationRelative}.`,
          'Leave the destination untouched and re-create no recovery evidence by hand.'
        );
      }
      await dependencies.fs.writeText(
        entry.staged,
        withMigrationReceiptPhase(stagedText, 'published', manifest.startedAt)
      );
    }
    const expectedDigest = (await digestTree(dependencies.fs, entry.staged)).digest;
    const actualDigest = (await digestTree(dependencies.fs, entry.destination)).digest;
    if (actualDigest !== expectedDigest) {
      throw applyError(
        'migration_recovery_digest_mismatch',
        `Legacy recovery destination ${entry.destinationRelative} has digest '${actualDigest}', expected planned '${expectedDigest}'.`,
        'Leave the destination untouched and inspect it before choosing manual recovery.'
      );
    }
    // A durable completed operation permits exactly one copy at its destination.
    // Consume the freshly proved staged copy before minting that state; if a
    // later legacy entry fails, the still-v1 manifest grants no new ownership
    // and a subsequent attempt regenerates staging from the immutable plan.
    await dependencies.fs.removeTree(entry.staged);
    operations.push({
      runId,
      operationId: `${entry.kind}:${entry.destinationRelative}`,
      kind: entry.kind,
      staged: entry.staged,
      destination: entry.destination,
      destinationRelative: entry.destinationRelative,
      expectedAbsence: true,
      expectedDigest,
      status: 'completed',
    });
  }
  return operations;
}

/**
 * Fresh staging regenerates every plan entry, including operations whose
 * owned copy is already at the destination (completed, or prepared after a
 * rename crash). Prove those regenerated bytes against the durable digest,
 * then consume them before any next manifest write so operation ownership
 * remains unambiguous at every boundary.
 */
export async function consumeDestinationOwnedStagingCopies(
  dependencies: StoreLayoutMigrationDependencies,
  staged: StagedTree,
  operations: readonly RecoveryOperation[],
  startedAt: string
): Promise<void> {
  for (const operation of operations) {
    if ((await dependencies.fs.statKind(operation.destination)) === 'absent') continue;
    const entry = staged.entries.find(
      (candidate) =>
        candidate.destination === operation.destination &&
        candidate.staged === operation.staged
    );
    if (entry === undefined) {
      throw applyError(
        'migration_recovery_ambiguous',
        `Recovery operation ${operation.destinationRelative} does not identify its freshly staged plan entry.`,
        'Leave the destination untouched and inspect the immutable plan and recovery manifest.'
      );
    }
    if ((await dependencies.fs.statKind(entry.staged)) === 'absent') continue;
    if (entry.kind === 'receipt') {
      const stagedText = await dependencies.fs.readText(entry.staged);
      if (stagedText === null) {
        throw applyError(
          'migration_recovery_ambiguous',
          `Completed recovery receipt staging is unreadable for ${entry.destinationRelative}.`,
          'Leave the destination untouched and inspect the recovery evidence.'
        );
      }
      await dependencies.fs.writeText(
        entry.staged,
        withMigrationReceiptPhase(stagedText, 'published', startedAt)
      );
    }
    const regeneratedDigest = (await digestTree(dependencies.fs, entry.staged)).digest;
    if (regeneratedDigest !== operation.expectedDigest) {
      throw applyError(
        'migration_recovery_digest_mismatch',
        `Regenerated staging for ${operation.destinationRelative} has digest '${regeneratedDigest}', expected '${operation.expectedDigest}'.`,
        'Leave the destination untouched and inspect the stored plan and recovery evidence.'
      );
    }
    await dependencies.fs.removeTree(entry.staged);
  }
}

/**
 * Proves that every durable operation still has exactly one owned copy before
 * resume or rollback mutates anything. A prepared rename may be on either
 * side, but never both or neither; a completed operation must exist only at
 * its destination. Exact digest equality is the ownership proof.
 */
export async function verifyRecoveryOperationOwnership(
  dependencies: StoreLayoutMigrationDependencies,
  manifest: RecoveryManifest,
  plan?: ImmutableMigrationPlan
): Promise<void> {
  const recordedDestinations = new Set(
    (manifest.operations ?? []).map((operation) => operation.destination)
  );
  if (plan !== undefined) {
    const expectedDestinations = [
      ...plan.items.flatMap((item) =>
        item.destination !== undefined &&
        item.destination !== item.source &&
        item.kind !== 'membership-record' &&
        item.materialization?.kind !== 'retain'
          ? [item.destination]
          : []
      ),
      ...plan.targetLineCatalogs.map((catalog) => catalog.destination),
      migrationReceiptPath(plan.storeRoot, plan.planId),
    ];
    for (const destination of expectedDestinations) {
      if (
        (await dependencies.fs.statKind(destination)) !== 'absent' &&
        !recordedDestinations.has(destination)
      ) {
        throw applyError(
          'migration_recovery_unrecorded_destination',
          `Recovery destination ${storeRelative(plan.storeRoot, destination)} exists without a prepared operation from this run.`,
          'Leave the destination untouched and inspect the recovery manifest; Rasen will not delete unrecorded content.'
        );
      }
    }
  }
  for (const operation of manifest.operations ?? []) {
    const stagedKind = await dependencies.fs.statKind(operation.staged);
    const destinationKind = await dependencies.fs.statKind(operation.destination);
    const stagedPresent = stagedKind !== 'absent';
    const destinationPresent = destinationKind !== 'absent';

    if (operation.status === 'prepared') {
      if (stagedPresent === destinationPresent) {
        throw applyError(
          'migration_recovery_ambiguous',
          `Prepared operation ${operation.destinationRelative} has ${
            stagedPresent ? 'both staged and destination copies' : 'neither staged nor destination copy'
          }; run ownership cannot be proven.`,
          'Leave both paths untouched and inspect the recovery manifest; Rasen will not delete or overwrite ambiguous content.'
        );
      }
    } else if (!destinationPresent || stagedPresent) {
      throw applyError(
        'migration_recovery_ambiguous',
        `Completed operation ${operation.destinationRelative} no longer has exactly one destination copy.`,
        'Leave the paths untouched and inspect the recovery manifest; Rasen will not reconstruct or delete unproven content.'
      );
    }

    const ownedPath = destinationPresent ? operation.destination : operation.staged;
    const actual = (await digestTree(dependencies.fs, ownedPath)).digest;
    if (actual !== operation.expectedDigest) {
      throw applyError(
        'migration_recovery_digest_mismatch',
        `Recovery path ${storeRelative(manifest.storeRoot, ownedPath)} has digest '${actual}', expected '${operation.expectedDigest}'.`,
        'Leave the path untouched and inspect it before choosing manual recovery.'
      );
    }
  }
}

/**
 * The schema a relocated Change declares when it never declared one.
 *
 * Change metadata REQUIRES `schema`, and a Change written by the flat layout
 * usually carries no metadata file at all — it was always read under the Store
 * root's declared schema. Recording that same value states what was already
 * true of the Change; it does not invent a new fact about it.
 */
async function storeDeclaredSchema(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string
): Promise<string | undefined> {
  const text = await dependencies.fs.readText(
    path.join(flatStorePaths(storeRoot).planning, 'config.yaml')
  );
  if (text === null) return undefined;
  const parsed = parseYaml(text) as { schema?: unknown } | null;
  return typeof parsed?.schema === 'string' && parsed.schema.length > 0
    ? parsed.schema
    : undefined;
}

function metadataWithIdentity(
  originalText: string,
  identity: {
    instanceSeed: string;
    instanceId: string;
    storeUid: string;
    projectId: string;
    targetLineId: string;
  },
  fallbackSchema: string | undefined
): string {
  const parsed = (parseYaml(originalText) ?? {}) as Record<string, unknown>;
  return stringifyYaml({
    ...(typeof parsed.schema === 'string' || fallbackSchema === undefined
      ? {}
      : { schema: fallbackSchema }),
    ...parsed,
    identity: {
      version: 2,
      instanceSeed: identity.instanceSeed,
      instanceId: identity.instanceId,
      storeUid: identity.storeUid,
      projectId: identity.projectId,
      targetLineId: identity.targetLineId,
    },
  });
}

export async function stagePlan(
  dependencies: StoreLayoutMigrationDependencies,
  plan: ImmutableMigrationPlan,
  legacyAdoptionsManifest: string | undefined
): Promise<StagedTree> {
  const root = stagingRoot(plan.storeRoot, plan.planId);
  await dependencies.fs.removeTree(root);
  await dependencies.fs.mkdirp(root);

  const entries: StagedEntry[] = [];
  const identityByChange = new Map(
    plan.mintedIdentities.map((identity) => [identity.changeId, identity])
  );
  const fallbackSchema = await storeDeclaredSchema(dependencies, plan.storeRoot);

  for (const item of plan.items) {
    if (item.destination === undefined) continue;
    if (item.kind === 'membership-record') continue;
    if (item.destination === item.source) continue;

    const destinationRelative =
      item.destinationRelative ?? storeRelative(plan.storeRoot, item.destination);
    const staged = path.join(root, 'tree', destinationRelative.split('/').join(path.sep));
    if (item.materialization?.kind === 'generated-tree') {
      await dependencies.fs.mkdirp(staged);
      for (const file of item.materialization.files) {
        const target = path.join(staged, file.relativePath.split('/').join(path.sep));
        const relativeToRoot = path.relative(path.resolve(staged), path.resolve(target));
        if (
          relativeToRoot.length === 0 ||
          relativeToRoot.startsWith('..') ||
          path.isAbsolute(relativeToRoot)
        ) {
          throw applyError(
            'migration_staging_verification_failed',
            `Generated file '${file.relativePath}' escapes or replaces its planned Issue root.`,
            'Do not edit stored plan bytes; re-plan from the committed mapping and plan input.'
          );
        }
        await dependencies.checkpoint({
          kind: 'generated-file-write',
          path: target,
          phase: 'before',
        });
        await dependencies.fs.writeText(target, file.content);
        await dependencies.checkpoint({
          kind: 'generated-file-write',
          path: target,
          phase: 'after',
        });
      }
      entries.push({
        staged,
        destination: item.destination,
        destinationRelative,
        kind: 'issue-tree',
      });
      continue;
    }
    if (item.materialization?.kind === 'retain') continue;
    await dependencies.fs.copyTree(item.source, staged);

    if (item.kind === 'change') {
      const identity = identityByChange.get(item.name);
      if (identity !== undefined && plan.storeUid !== undefined) {
        const metadataPath = path.join(staged, '.openspec.yaml');
        const original = await dependencies.fs.readText(metadataPath);
        // A Change written by the flat layout usually carries no
        // `.openspec.yaml` at all, and the v2 identity block still has to be
        // written for it (design decision 6 mints, verifies, and WRITES it).
        // Skipping the absent-file case dropped the identity silently, and
        // then failed the staging verification that requires the block the
        // plan already minted — so the file is created rather than skipped.
        await dependencies.fs.writeText(
          metadataPath,
          metadataWithIdentity(
            original ?? '',
            {
              instanceSeed: identity.instanceSeed,
              instanceId: identity.changeInstanceId,
              storeUid: plan.storeUid,
              projectId: identity.projectId,
              targetLineId: identity.targetLineId,
            },
            fallbackSchema
          )
        );
      }
    }

    entries.push({
      staged,
      destination: item.destination,
      destinationRelative,
      ...(item.digest === undefined ? {} : { sourceDigest: item.digest }),
      kind: 'item',
    });
  }

  for (const catalog of plan.targetLineCatalogs) {
    const staged = path.join(
      root,
      'tree',
      catalog.destinationRelative.split('/').join(path.sep)
    );
    await dependencies.fs.writeText(staged, catalog.catalogYaml);
    entries.push({
      staged,
      destination: catalog.destination,
      destinationRelative: catalog.destinationRelative,
      kind: 'target-line-catalog',
    });
  }

  const receipt = buildMigrationReceipt({
    plan,
    ...(legacyAdoptionsManifest === undefined
      ? {}
      : { legacyAdoptionsManifest }),
    phases: [{ phase: 'staged', at: plan.createdAt }],
  });
  const receiptContent = serializeMigrationReceipt(receipt);
  const receiptDestination = migrationReceiptPath(plan.storeRoot, plan.planId);
  const stagedReceipt = path.join(
    root,
    'tree',
    storeRelative(plan.storeRoot, receiptDestination).split('/').join(path.sep)
  );
  await dependencies.fs.writeText(stagedReceipt, receiptContent);
  entries.push({
    staged: stagedReceipt,
    destination: receiptDestination,
    destinationRelative: storeRelative(plan.storeRoot, receiptDestination),
    kind: 'receipt',
  });

  return { root, entries, receiptContent, receiptDestination };
}

const REPLACEMENT_CHARACTER = '\uFFFD';

function decodesCleanly(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return false;
  }
  const text = bytes.toString('utf8');
  if (text.includes(REPLACEMENT_CHARACTER)) return false;
  if (hasTypicalMojibake(text)) return false;
  return Buffer.from(text, 'utf8').equals(bytes);
}

/**
 * Verification is a comparison, not a policy. A staged file must be
 * byte-identical to its source, and a source that decoded as clean UTF-8 must
 * still decode as clean UTF-8 after staging. Legacy content that already
 * carried a BOM stays exactly as it was: rejecting it would refuse to migrate
 * a Store for a property migration did not introduce and must not change.
 */
export async function verifyStagedTree(
  dependencies: StoreLayoutMigrationDependencies,
  plan: ImmutableMigrationPlan,
  staged: StagedTree
): Promise<void> {
  const problems: string[] = [];
  const storeRootResolved = path.resolve(plan.storeRoot);

  for (const entry of staged.entries) {
    const relative = path.relative(storeRootResolved, path.resolve(entry.destination));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      problems.push(`${entry.destinationRelative} escapes the Store root`);
    }
  }

  const identityByChange = new Map(
    plan.mintedIdentities.map((identity) => [identity.changeId, identity])
  );

  for (const item of plan.items) {
    if (item.destination === undefined || item.kind === 'membership-record') continue;
    if (item.destination === item.source) continue;
    const entry = staged.entries.find((candidate) => candidate.destination === item.destination);
    if (entry === undefined) {
      problems.push(`${item.destinationRelative} was not staged`);
      continue;
    }


    if (item.materialization?.kind === 'generated-tree') {
      await dependencies.checkpoint({
        kind: 'generated-tree-digest-verification',
        destination: item.destination,
      });
      const stagedTree = await digestTree(dependencies.fs, entry.staged);
      const expected = new Map(
        item.materialization.files.map((file) => [file.relativePath, file])
      );
      const actual = new Map(stagedTree.files.map((file) => [file.relative, file]));
      for (const [relative, file] of expected) {
        const found = actual.get(relative);
        if (found?.digest !== file.digest) {
          problems.push(`${item.destinationRelative}/${relative} has the wrong digest`);
          continue;
        }
        const bytes = await dependencies.fs.readBytes(
          path.join(entry.staged, relative.split('/').join(path.sep))
        );
        if (bytes === null || !decodesCleanly(bytes)) {
          problems.push(`${item.destinationRelative}/${relative} is not strict UTF-8 without BOM`);
        }
      }
      for (const relative of actual.keys()) {
        if (!expected.has(relative)) {
          problems.push(`${item.destinationRelative}/${relative} was not planned`);
        }
      }
      const recordFile = item.materialization.files.find(
        (file) => file.role === 'issue-record'
      );
      if (recordFile === undefined) {
        problems.push(`${item.destinationRelative} has no planned Issue record`);
      } else {
        try {
          const stagedRecord = await dependencies.fs.readText(
            path.join(entry.staged, recordFile.relativePath.split('/').join(path.sep))
          );
          if (stagedRecord === null) throw new Error('the staged record is unreadable');
          parseIssueRecord(
            stagedRecord,
            path.join(item.destination, recordFile.relativePath)
          );
        } catch (error) {
          problems.push(
            `${item.destinationRelative}/${recordFile.relativePath} is invalid: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      for (const file of item.materialization.files.filter(
        (candidate) => candidate.role === 'execution-plan'
      )) {
        try {
          const stagedPlan = await dependencies.fs.readText(
            path.join(entry.staged, file.relativePath.split('/').join(path.sep))
          );
          if (stagedPlan === null) throw new Error('the staged revision is unreadable');
          parseExecutionPlanRevision(stagedPlan, { verifyDigest: true });
        } catch (error) {
          problems.push(
            `${item.destinationRelative}/${file.relativePath} is invalid: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      continue;
    }

    const sourceTree = await digestTree(dependencies.fs, item.source);
    const stagedTree = await digestTree(dependencies.fs, entry.staged);
    const rewritten = item.kind === 'change' && identityByChange.has(item.name) ? '.openspec.yaml' : null;

    const sourceFiles = new Map(sourceTree.files.map((file) => [file.relative, file.digest]));
    const stagedFiles = new Map(stagedTree.files.map((file) => [file.relative, file.digest]));
    for (const [relative, digest] of sourceFiles) {
      if (relative === rewritten) continue;
      if (stagedFiles.get(relative) !== digest) {
        problems.push(`${item.destinationRelative}/${relative} does not match its source`);
      }
    }
    for (const relative of stagedFiles.keys()) {
      // The identity metadata is the ONE file staging is allowed to author:
      // a flat Change that carried none gains it here, so its absence from
      // the source is expected rather than a stray file.
      if (relative === rewritten) continue;
      if (!sourceFiles.has(relative)) {
        problems.push(`${item.destinationRelative}/${relative} is not present in the source`);
      }
    }

    for (const file of stagedTree.files) {
      const stagedPath = file.relative.length === 0 ? entry.staged : path.join(entry.staged, file.relative);
      const sourcePath = file.relative.length === 0 ? item.source : path.join(item.source, file.relative);
      const stagedBytes = await dependencies.fs.readBytes(stagedPath);
      const sourceBytes = await dependencies.fs.readBytes(sourcePath);
      if (stagedBytes === null) {
        problems.push(`${entry.destinationRelative}/${file.relative} could not be read back`);
        continue;
      }
      if (
        sourceBytes !== null &&
        decodesCleanly(sourceBytes) &&
        !decodesCleanly(stagedBytes)
      ) {
        problems.push(
          `${entry.destinationRelative}/${file.relative} lost strict UTF-8 cleanliness while staging`
        );
      }
    }

    if (rewritten !== null && plan.storeUid !== undefined) {
      const identity = identityByChange.get(item.name);
      const text = await dependencies.fs.readText(path.join(entry.staged, rewritten));
      if (text === null || identity === undefined) {
        problems.push(`${item.destinationRelative}/${rewritten} is missing after staging`);
      } else {
        const parsed = ChangeMetadataSchema.safeParse(parseYaml(text));
        if (!parsed.success) {
          problems.push(`${item.destinationRelative}/${rewritten} is not valid Change metadata`);
        } else {
          const scope = derivePlanningScopeId({
            storeUid: plan.storeUid,
            projectId: identity.projectId,
            targetLineId: identity.targetLineId,
          });
          const derived = deriveChangeInstanceId({
            planningScopeId: scope,
            instanceSeed: identity.instanceSeed,
          });
          if (derived !== identity.changeInstanceId || scope !== identity.planningScopeId) {
            problems.push(`${item.destinationRelative} identity does not re-derive`);
          }
        }
      }
    }
  }

  for (const catalog of plan.targetLineCatalogs) {
    try {
      parseStoreTargetLineCatalogV1(catalog.catalogYaml, catalog.destination);
    } catch (error) {
      problems.push(
        `${catalog.destinationRelative} is not a valid target-line catalog: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  for (const upgrade of plan.catalogUpgrades) {
    try {
      parseStoreProjectCatalogV2(upgrade.catalogYaml, upgrade.recordPath);
    } catch (error) {
      problems.push(
        `${upgrade.recordRelative} is not a valid v2 project catalog: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (problems.length > 0) {
    throw applyError(
      'migration_staging_verification_failed',
      `Staging verification failed:\n  - ${problems.join('\n  - ')}`,
      'Nothing was published; remove the staging directory and re-plan.'
    );
  }
}

// -----------------------------------------------------------------------------
// Publication
// -----------------------------------------------------------------------------

export interface PublishOutcome {
  readonly published: readonly string[];
  readonly manifest: PreparedRecoveryManifest;
}

export async function publishPlan(
  dependencies: StoreLayoutMigrationDependencies,
  plan: ImmutableMigrationPlan,
  staged: StagedTree,
  writeManifest: (manifest: PreparedRecoveryManifest) => Promise<void>,
  initial: PreparedRecoveryManifest
): Promise<PublishOutcome> {
  const createdPaths: string[] = [...initial.createdPaths];
  const replacedFiles: Record<string, string> = { ...initial.replacedFiles };
  const operations: RecoveryOperation[] = [...(initial.operations ?? [])];
  const published: string[] = [];
  let manifest: PreparedRecoveryManifest = {
    ...initial,
    phase: 'publishing',
    updatedAt: dependencies.now().toISOString(),
  };
  await writeManifest(manifest);

  const update = async (patch: Partial<PreparedRecoveryManifest>): Promise<void> => {
    manifest = {
      ...manifest,
      ...patch,
      createdPaths: [...createdPaths],
      replacedFiles: { ...replacedFiles },
      operations: operations.map((operation) => ({ ...operation })),
      updatedAt: dependencies.now().toISOString(),
    };
    await writeManifest(manifest);
  };

  // 1. Project catalogs — an in-place schema flip. The previous bytes go into
  //    the manifest first so rollback can restore them exactly.
  for (const upgrade of plan.catalogUpgrades) {
    const previous = await dependencies.fs.readText(upgrade.recordPath);
    if (previous === upgrade.catalogYaml) {
      published.push(upgrade.recordRelative);
      continue;
    }
    if (previous !== null && replacedFiles[upgrade.recordPath] === undefined) {
      replacedFiles[upgrade.recordPath] = previous;
    }
    await update({});
    await dependencies.fs.writeText(upgrade.recordPath, upgrade.catalogYaml);
    published.push(upgrade.recordRelative);
  }

  // 2. Target-line catalogs, 3. project partitions, 4. receipt — in that order.
  const order: readonly StagedEntry['kind'][] = [
    'target-line-catalog',
    'item',
    'issue-tree',
    'receipt',
  ];
  for (const kind of order) {
    for (const entry of staged.entries) {
      if (entry.kind !== kind) continue;
      let operation = operations.find(
        (candidate) =>
          candidate.runId === initial.runId &&
          candidate.destination === entry.destination
      );
      const stagedKind = await dependencies.fs.statKind(entry.staged);
      if (entry.kind === 'receipt' && stagedKind !== 'absent') {
        // Stamp the publication phase into the bytes that are about to be
        // committed. Doing it here rather than after the layout flip keeps the
        // receipt inside the rollback set: if the flip then fails, `--rollback`
        // removes this file along with everything else the run created.
        const stagedText = await dependencies.fs.readText(entry.staged);
        if (stagedText !== null) {
          await dependencies.fs.writeText(
            entry.staged,
            withMigrationReceiptPhase(
              stagedText,
              'published',
              initial.startedAt
            )
          );
        }
      }
      const expectedDigest =
        stagedKind === 'absent' && operation !== undefined
          ? operation.expectedDigest
          : (await digestTree(dependencies.fs, entry.staged)).digest;
      const destinationKind = await dependencies.fs.statKind(entry.destination);
      if (destinationKind !== 'absent') {
        if (operation === undefined) {
          throw applyError(
            'migration_plan_stale',
            `Unrecorded destination ${entry.destinationRelative} exists during publication.`,
            'Do not remove it automatically; inspect the destination and recovery manifest.'
          );
        }
        const actual = (await digestTree(dependencies.fs, entry.destination)).digest;
        if (actual !== operation.expectedDigest || actual !== expectedDigest) {
          throw applyError(
            'migration_staging_verification_failed',
            `Recovery destination ${entry.destinationRelative} digest '${actual}' does not match planned '${operation.expectedDigest}'.`,
            'Leave the destination untouched and inspect it before choosing recovery.'
          );
        }
        operation = { ...operation, status: 'completed' };
        operations.splice(
          operations.findIndex((candidate) => candidate.operationId === operation?.operationId),
          1,
          operation
        );
        if (!createdPaths.includes(entry.destination)) createdPaths.push(entry.destination);
        published.push(entry.destinationRelative);
        await update({});
        continue;
      }
      if (operation === undefined) {
        operation = {
          runId: initial.runId,
          operationId: `${entry.kind}:${entry.destinationRelative}`,
          kind: entry.kind,
          staged: entry.staged,
          destination: entry.destination,
          destinationRelative: entry.destinationRelative,
          expectedAbsence: true,
          expectedDigest,
          status: 'prepared',
        };
        operations.push(operation);
      } else if (operation.expectedDigest !== expectedDigest) {
        throw applyError(
          'migration_staging_verification_failed',
          `Regenerated staging for ${entry.destinationRelative} does not match its prepared digest.`,
          'Leave recovery evidence intact and inspect the stored plan.'
        );
      }
      // Durable PREPARED intent precedes the rename.
      await dependencies.checkpoint({
        kind: 'operation-manifest-write',
        destination: entry.destination,
        operationKind: entry.kind,
        status: 'prepared',
        phase: 'before',
      });
      await update({});
      await dependencies.checkpoint({
        kind: 'operation-manifest-write',
        destination: entry.destination,
        operationKind: entry.kind,
        status: 'prepared',
        phase: 'after',
      });
      await dependencies.fs.rename(entry.staged, entry.destination);
      await dependencies.checkpoint({
        kind: 'operation-renamed',
        destination: entry.destination,
        operationKind: entry.kind,
      });
      const actual = (await digestTree(dependencies.fs, entry.destination)).digest;
      if (actual !== operation.expectedDigest) {
        throw applyError(
          'migration_staging_verification_failed',
          `Published destination ${entry.destinationRelative} has digest '${actual}', expected '${operation.expectedDigest}'.`,
          'Leave the destination untouched and use resume or rollback after inspection.'
        );
      }
      operation = { ...operation, status: 'completed' };
      operations.splice(
        operations.findIndex((candidate) => candidate.operationId === operation?.operationId),
        1,
        operation
      );
      if (!createdPaths.includes(entry.destination)) createdPaths.push(entry.destination);
      published.push(entry.destinationRelative);
      // Durable COMPLETED mark follows digest verification.
      await dependencies.checkpoint({
        kind: 'operation-manifest-write',
        destination: entry.destination,
        operationKind: entry.kind,
        status: 'completed',
        phase: 'before',
      });
      await update({});
      await dependencies.checkpoint({
        kind: 'operation-manifest-write',
        destination: entry.destination,
        operationKind: entry.kind,
        status: 'completed',
        phase: 'after',
      });
    }
  }

  // 5. The layout flip, LAST. Before this line every reader sees a legacy flat
  //    Store and reads the intact flat tree; after it every reader sees layout
  //    v2 and reads complete partitions.
  const paths = flatStorePaths(plan.storeRoot);
  const metadataText = await dependencies.fs.readText(paths.storeMetadata);
  if (metadataText === null) {
    throw applyError(
      'migration_plan_stale',
      'The Store metadata disappeared during publication.',
      'Run `--rollback` to restore the pre-publication state.'
    );
  }
  const metadata = parseStoreMetadataState(metadataText);
  if (metadata.layoutVersion !== 2) {
    if (replacedFiles[paths.storeMetadata] === undefined) {
      replacedFiles[paths.storeMetadata] = metadataText;
    }
    await update({});
    const flipped: StoreMetadataState = { ...metadata, layoutVersion: 2 };
    await dependencies.checkpoint({ kind: 'layout-flip', phase: 'before' });
    await dependencies.fs.writeText(paths.storeMetadata, serializeStoreMetadataState(flipped));
    await dependencies.checkpoint({ kind: 'layout-flip', phase: 'after' });
  }
  published.push(FLAT_RELATIVE.storeMetadata);

  await dependencies.fs.removeTree(staged.root);
  await dependencies.checkpoint({ kind: 'final-manifest-write', phase: 'before' });
  await update({
    phase: 'published',
    receiptPath: staged.receiptDestination,
    phases: [
      ...manifest.phases,
      { phase: 'published', at: dependencies.now().toISOString() },
    ],
  });
  await dependencies.checkpoint({ kind: 'final-manifest-write', phase: 'after' });

  return { published, manifest };
}

// -----------------------------------------------------------------------------
// Retirement and rollback
// -----------------------------------------------------------------------------

export async function retireFlatTree(
  dependencies: StoreLayoutMigrationDependencies,
  plan: ImmutableMigrationPlan
): Promise<readonly string[]> {
  const removed: string[] = [];
  const paths = flatStorePaths(plan.storeRoot);
  for (const relative of plan.retirementSet) {
    const target = path.join(plan.storeRoot, relative.split('/').join(path.sep));
    if ((await dependencies.fs.statKind(target)) === 'absent') continue;
    await dependencies.checkpoint({ kind: 'source-removal', path: target });
    await dependencies.fs.removeTree(target);
    removed.push(relative);
  }
  if ((await dependencies.fs.statKind(paths.adoptionsManifest)) === 'file') {
    await dependencies.checkpoint({ kind: 'source-removal', path: paths.adoptionsManifest });
    await dependencies.fs.removeFile(paths.adoptionsManifest);
    removed.push(FLAT_RELATIVE.adoptionsManifest);
  }
  // Retirement is its own commit, so the committed receipt records it here —
  // idempotently, because retirement is re-runnable.
  const receiptPath = migrationReceiptPath(plan.storeRoot, plan.planId);
  const receiptText = await dependencies.fs.readText(receiptPath);
  if (receiptText !== null) {
    await dependencies.fs.writeText(
      receiptPath,
      withMigrationReceiptPhase(receiptText, 'retired', dependencies.now().toISOString())
    );
  }
  return removed;
}

export async function rollbackRun(
  dependencies: StoreLayoutMigrationDependencies,
  manifest: RecoveryManifest,
  _plan?: ImmutableMigrationPlan
): Promise<readonly string[]> {
  const removed: string[] = [];
  if ((manifest.operations?.length ?? 0) > 0) {
    for (const operation of [...(manifest.operations ?? [])].reverse()) {
      const destinationKind = await dependencies.fs.statKind(operation.destination);
      if (destinationKind === 'absent') continue;
      if ((await dependencies.fs.statKind(operation.staged)) !== 'absent') {
        throw applyError(
          'migration_staging_verification_failed',
          `Rollback found both staged and destination content for ${operation.destinationRelative}.`,
          'Leave both paths untouched and inspect the prepared operation before manual recovery.'
        );
      }
      const actual = (await digestTree(dependencies.fs, operation.destination)).digest;
      if (actual !== operation.expectedDigest) {
        throw applyError(
          'migration_staging_verification_failed',
          `Rollback refuses ${operation.destinationRelative}: digest '${actual}' does not match this run's '${operation.expectedDigest}'.`,
          'Unknown or changed content is never deleted; inspect it and recover explicitly.'
        );
      }
      await dependencies.fs.removeTree(operation.destination);
      removed.push(storeRelative(manifest.storeRoot, operation.destination));
    }
  } else {
    // Legacy version-1 recovery manifests predate prepared operations.
    for (const created of [...manifest.createdPaths].reverse()) {
      if ((await dependencies.fs.statKind(created)) === 'absent') continue;
      await dependencies.fs.removeTree(created);
      removed.push(storeRelative(manifest.storeRoot, created));
    }
  }
  for (const [target, content] of Object.entries(manifest.replacedFiles)) {
    await dependencies.fs.writeText(target, content);
  }
  await dependencies.fs.removeTree(manifest.stagingDir);
  return removed;
}

// -----------------------------------------------------------------------------
// Commit suggestions
// -----------------------------------------------------------------------------

export function publicationCommitSuggestion(
  plan: ImmutableMigrationPlan
): SuggestedMigrationCommit {
  const pathspecs = ['rasen', '.rasen-store'];
  return {
    repoRoot: plan.storeRoot,
    pathspecs,
    message: `chore(store): migrate ${plan.storeId} planning to layout v2`,
    rationale:
      'Store repo: record the project partitions, catalogs, and the migration receipt. The flat tree is retired separately.',
    command: `git -C ${plan.storeRoot} add -- ${pathspecs.join(' ')} && git -C ${plan.storeRoot} commit -m "chore(store): migrate ${plan.storeId} planning to layout v2"`,
  };
}

export function retirementCommitSuggestion(
  plan: ImmutableMigrationPlan
): SuggestedMigrationCommit {
  const pathspecs = ['rasen', '.rasen-store'];
  return {
    repoRoot: plan.storeRoot,
    pathspecs,
    message: `chore(store): retire ${plan.storeId} flat planning tree`,
    rationale:
      'Store repo: record the removal of the flat rasen/specs and rasen/changes tree in its own commit.',
    command: `git -C ${plan.storeRoot} add -- ${pathspecs.join(' ')} && git -C ${plan.storeRoot} commit -m "chore(store): retire ${plan.storeId} flat planning tree"`,
  };
}

export function emptyResult(
  plan: ImmutableMigrationPlan,
  phase: MigrationPhase
): MigrationResult {
  return {
    planId: plan.planId,
    storeId: plan.storeId,
    storeRoot: plan.storeRoot,
    ...(plan.ref === undefined ? {} : { ref: plan.ref }),
    phase,
    published: [],
    removed: [],
    suggestedCommits: [],
  };
}
