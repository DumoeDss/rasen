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

import { ChangeMetadataSchema } from '../../change-metadata/schema.js';
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
import {
  buildMigrationReceipt,
  migrationReceiptPath,
  serializeMigrationReceipt,
  withMigrationReceiptPhase,
  type MigrationReceiptPhaseRecord,
} from './receipt.js';
import type {
  ImmutableMigrationPlan,
  MigrationPhase,
  MigrationResult,
  SuggestedMigrationCommit,
} from './types.js';

export const MIGRATION_STAGING_RELATIVE = '.rasen/migration/staging';
export const RECOVERY_MANIFEST_VERSION = 1;

export interface RecoveryManifest {
  readonly version: typeof RECOVERY_MANIFEST_VERSION;
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
  plan: ImmutableMigrationPlan
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
      if (metadata.layoutVersion === 2) {
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
    if (item.digest !== undefined) {
      const current = (await digestTree(dependencies.fs, item.source)).digest;
      if (current !== item.digest) problems.push(`${item.sourceRelative} changed on disk`);
    }
    if (
      item.destination !== undefined &&
      item.destination !== item.source &&
      item.kind !== 'membership-record' &&
      (await dependencies.fs.statKind(item.destination)) !== 'absent'
    ) {
      problems.push(`${item.destinationRelative} now exists`);
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
    if (current !== upgrade.sourceDigest) {
      problems.push(`${upgrade.recordRelative} changed on disk`);
    }
  }

  for (const catalog of plan.targetLineCatalogs) {
    if ((await dependencies.fs.statKind(catalog.destination)) !== 'absent') {
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
  readonly kind: 'item' | 'target-line-catalog' | 'receipt';
}

export interface StagedTree {
  readonly root: string;
  readonly entries: readonly StagedEntry[];
  readonly receiptContent: string;
  readonly receiptDestination: string;
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
    phases: [{ phase: 'staged', at: dependencies.now().toISOString() }],
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

const REPLACEMENT_CHARACTER = '�';

function decodesCleanly(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return false;
  }
  const text = bytes.toString('utf8');
  if (text.includes(REPLACEMENT_CHARACTER)) return false;
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
  readonly manifest: RecoveryManifest;
}

export async function publishPlan(
  dependencies: StoreLayoutMigrationDependencies,
  plan: ImmutableMigrationPlan,
  staged: StagedTree,
  writeManifest: (manifest: RecoveryManifest) => Promise<void>,
  initial: RecoveryManifest
): Promise<PublishOutcome> {
  const createdPaths: string[] = [];
  const replacedFiles: Record<string, string> = { ...initial.replacedFiles };
  const published: string[] = [];
  let manifest: RecoveryManifest = {
    ...initial,
    phase: 'publishing',
    updatedAt: dependencies.now().toISOString(),
  };
  await writeManifest(manifest);

  const update = async (patch: Partial<RecoveryManifest>): Promise<void> => {
    manifest = {
      ...manifest,
      ...patch,
      createdPaths: [...createdPaths],
      replacedFiles: { ...replacedFiles },
      updatedAt: dependencies.now().toISOString(),
    };
    await writeManifest(manifest);
  };

  // 1. Project catalogs — an in-place schema flip. The previous bytes go into
  //    the manifest first so rollback can restore them exactly.
  for (const upgrade of plan.catalogUpgrades) {
    const previous = await dependencies.fs.readText(upgrade.recordPath);
    if (previous !== null) replacedFiles[upgrade.recordPath] = previous;
    await update({});
    await dependencies.fs.writeText(upgrade.recordPath, upgrade.catalogYaml);
    published.push(upgrade.recordRelative);
  }

  // 2. Target-line catalogs, 3. project partitions, 4. receipt — in that order.
  const order: readonly StagedEntry['kind'][] = ['target-line-catalog', 'item', 'receipt'];
  for (const kind of order) {
    for (const entry of staged.entries) {
      if (entry.kind !== kind) continue;
      if (entry.kind === 'receipt') {
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
              dependencies.now().toISOString()
            )
          );
        }
      }
      await dependencies.fs.rename(entry.staged, entry.destination);
      createdPaths.push(entry.destination);
      published.push(entry.destinationRelative);
      await update({});
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
  replacedFiles[paths.storeMetadata] = metadataText;
  await update({});
  const metadata = parseStoreMetadataState(metadataText);
  const flipped: StoreMetadataState = { ...metadata, layoutVersion: 2 };
  await dependencies.fs.writeText(paths.storeMetadata, serializeStoreMetadataState(flipped));
  published.push(FLAT_RELATIVE.storeMetadata);

  await dependencies.fs.removeTree(staged.root);
  await update({
    phase: 'published',
    receiptPath: staged.receiptDestination,
    phases: [
      ...manifest.phases,
      { phase: 'published', at: dependencies.now().toISOString() },
    ],
  });

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
    await dependencies.fs.removeTree(target);
    removed.push(relative);
  }
  if ((await dependencies.fs.statKind(paths.adoptionsManifest)) === 'file') {
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
  manifest: RecoveryManifest
): Promise<readonly string[]> {
  const removed: string[] = [];
  for (const created of [...manifest.createdPaths].reverse()) {
    if ((await dependencies.fs.statKind(created)) === 'absent') continue;
    await dependencies.fs.removeTree(created);
    removed.push(storeRelative(manifest.storeRoot, created));
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
