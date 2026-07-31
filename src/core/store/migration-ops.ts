/**
 * Migration operations (change `store-migration-commands`): the business
 * logic for `store adopt`, `store eject`, `archive relocate`, and
 * `home prune`, plus the `store doctor` drift diagnostics. Command modules
 * format the results returned here; all filesystem/registry mutation lives in
 * this layer so the moves stay copy → verify → delete (never a git write) and
 * are unit-testable with a `globalDataDir` DI override.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { WORKSPACE_DIR_NAME } from '../config.js';
import { machineLockPath, pathIsDirectory, withOwnerAwareFileLock } from '../file-state.js';
import {
  classifyOpenSpecDir,
  describeStoreDeclaration,
  ensureProjectIdInConfig,
  hasStoreDeclaration,
  readProjectConfig,
  readStorePointer,
  resolveConfigFilePath,
  updateProjectConfigKey,
  type StorePointerRead,
} from '../project-config.js';
import { storeBindingDeclarationFrom } from '../effective-config.js';
import {
  registerProject,
  readProjectRegistryState,
  findDanglingProjectEntries,
  withProjectRegistryLock,
  writeProjectRegistryState,
  getProjectsDir,
  getProjectHomeDir,
  type ProjectPathOptions,
} from '../project-registry.js';
import { resolveProjectHome } from '../project-home.js';
import { findRepoPlanningRootSync } from '../planning-home.js';
import { inspectOpenSpecRoot } from '../workspace-root.js';
import { StoreError, type StoreDiagnostic, makeStoreDiagnostic } from './errors.js';
import { storeMembershipLegacyManifest } from './identity-diagnostics.js';
import {
  STORE_METADATA_DIR_NAME,
  listStoreRegistryEntries,
  readOptionalStoreMetadataState,
  readStoreRegistryState,
  type StorePathOptions,
} from './foundation.js';
import { resolveRegisteredStore } from './registry.js';
import {
  primaryRepair,
  resolveStoreBinding,
  type StoreBindingResolution,
} from './identity.js';
import type { ResolvedStoreRef } from './identity-types.js';
import {
  listStoreMembers,
  membershipHintFor,
  membershipRecordLockError,
  membershipStoreLabel,
  writeMembershipLocator,
  writeMembershipRecord,
} from './membership.js';
import {
  deleteStoreProjectRecord,
  getStoreProjectRecordPath,
  isRecordableProjectIdentity,
  listStoreProjectRecords,
  mergeStoreProjectRoles,
  projectIdentityDiagnostic,
  readStoreProjectRecord,
  writeStoreProjectRecord,
  type StoreProjectRecord,
  type StoreProjectRecordAdoption,
  type StoreProjectRoles,
} from './project-records.js';
import { storeAddProject } from './operations.js';
import { remoteCarriesCredentials } from './remote.js';
import { writeDurablePointer } from './upgrade-identity.js';
import {
  caseInsensitiveCollisions,
  changesDir,
  deleteAdoptionsManifest,
  detectUncommittedPaths,
  getAdoptionsManifestPath,
  inRepoArchiveDir,
  listActiveChangeNames,
  listSpecNames,
  listSubdirectoryNames,
  moveTreeVerified,
  readAdoptionEntry,
  removeAdoptionEntry,
  renderSuggestedCommit,
  specsDir,
  type SuggestedGitCommand,
} from './migration.js';

const fs = nodeFs.promises;

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

/**
 * Resolves a project's Store declaration through the ONE shared resolver.
 * Every migration surface goes through this rather than looking the pointer's
 * display alias up in the registry: an alias lookup ignores the permanent
 * identity the declaration travels with, and misses a declaration that records
 * only that identity.
 */
async function resolveDeclaredStore(
  pointer: StorePointerRead,
  projectRoot: string,
  options: StorePathOptions
): Promise<StoreBindingResolution> {
  return resolveStoreBinding({
    declaration: storeBindingDeclarationFrom(pointer),
    projectRoot,
    ...options,
  });
}

/**
 * Records the adopted project's Store declaration DURABLY.
 *
 * A bare string is a display ALIAS by definition (`readStorePointer` only
 * parses the object form as durable), so recording the resolved name is the
 * best that form can do — and when two Stores share that name, the best it can
 * do still cannot be resolved. This file is Git-tracked and adopt prints a
 * commit hint for it, so the wrong form here is committed and shared.
 *
 * Therefore: the object form whenever the Store carries a permanent identity,
 * through the SAME writer `store upgrade-identity --apply` uses. A Store that
 * predates identities has none to record and keeps the legacy string form,
 * which is exactly what `store_pointer_legacy` then offers to upgrade.
 */
async function writeAdoptedStoreDeclaration(
  sourcePath: string,
  store: { uid?: string; storeRoot: string },
  storeId: string
): Promise<void> {
  const configPath = resolveConfigFilePath(sourcePath);
  if (store.uid === undefined || configPath === null) {
    updateProjectConfigKey(sourcePath, 'store', storeId);
    return;
  }

  // The remote is a locator for a machine that has never seen this Store, so
  // it is recorded when the Store has one — but never when it embeds a
  // credential: `writeDurablePointer` would throw, and this runs AFTER the
  // planning content has already moved.
  const metadata = await readOptionalStoreMetadataState(store.storeRoot).catch(() => null);
  const remote =
    metadata?.remote !== undefined && !remoteCarriesCredentials(metadata.remote)
      ? metadata.remote
      : undefined;

  await writeDurablePointer(configPath, {
    uid: store.uid,
    id: storeId,
    ...(remote !== undefined ? { remote } : {}),
  });
}

/** Ownership of a project's planning content inside a store, and its source. */
export interface ProjectOwnership extends StoreProjectRecordAdoption {
  source: 'record' | 'legacy-manifest';
}

/**
 * What a project owns in this store: the membership record's `adoption` block,
 * falling back to the legacy adoption manifest while an un-migrated store
 * still carries one.
 *
 * The legacy entry's `sourcePath` is deliberately NOT carried through. It is
 * an absolute path from whichever machine ran the adoption, committed into a
 * shared repository; reading it for behavior is what let eject restore a
 * project into a directory belonging to another machine's layout.
 */
export async function readProjectOwnership(
  storeRoot: string,
  projectId: string
): Promise<ProjectOwnership | null> {
  if (isRecordableProjectIdentity(projectId)) {
    const read = await readStoreProjectRecord(storeRoot, projectId);
    const adoption = read.record?.adoption;
    if (adoption) {
      return { ...adoption, source: 'record' };
    }
  }

  const legacy = await readAdoptionEntry(storeRoot, projectId);
  if (!legacy) return null;
  return {
    specs: legacy.specs,
    changes: legacy.changes,
    adoptedAt: legacy.timestamp,
    source: 'legacy-manifest',
  };
}

/**
 * Drops the project's ownership after an eject: the record's `adoption` block
 * goes and its planning role with it, while any knowledge role survives —
 * ejecting removes where the project PLANS, not the roster it belongs to. A
 * record left expressing no role and owning nothing is removed rather than
 * kept as an empty file. Any legacy entry is removed too, so the two sources
 * cannot disagree afterwards.
 */
export async function clearProjectOwnership(
  storeRoot: string,
  projectId: string
): Promise<void> {
  if (isRecordableProjectIdentity(projectId)) {
    // B6: acquire the same per-record lock writeMembershipRecord uses, and
    // re-read inside it. Without this, a concurrent add-project that writes a
    // new role between the read above and the overwrite here would be silently
    // dropped.
    const lockPath = machineLockPath(
      path.resolve(getStoreProjectRecordPath(storeRoot, projectId))
    );
    await withOwnerAwareFileLock(
      {
        lockPath,
        errorFor: membershipRecordLockError,
        holder: 'store-membership-record',
      },
      async () => {
        const read = await readStoreProjectRecord(storeRoot, projectId);
        if (read.record) {
          const roles = { planning: false, knowledge: read.record.roles.knowledge };
          if (!roles.knowledge) {
            await deleteStoreProjectRecord(storeRoot, projectId);
          } else {
            const { adoption: _dropped, ...rest } = read.record;
            void _dropped;
            await writeStoreProjectRecord(storeRoot, { ...rest, roles });
          }
        }
      }
    );
  }
  await removeAdoptionEntry(storeRoot, projectId);
}

/** The store's own credential-free remote, for a locator hint. */
async function storeRemoteFor(storeRoot: string): Promise<string | undefined> {
  const metadata = await readOptionalStoreMetadataState(storeRoot).catch(() => null);
  const remote = metadata?.remote;
  return remote !== undefined && !remoteCarriesCredentials(remote) ? remote : undefined;
}

/**
 * What adopt does with the source repo's existing archive. `external` is
 * retired along with the destination axis (`archive-destination` capability):
 * archives always land in a planning root — the source repo's or the store's.
 */
export type ArchiveMode = 'move' | 'leave';

interface MoveOptions extends StorePathOptions, ProjectPathOptions {
  verifyHash?: boolean;
  dryRun?: boolean;
}

export interface ArchiveMove {
  name: string;
  source: string;
  target: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Sorted, de-duplicated union of two name lists. */
function unionSorted(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Recursive byte size of a directory; 0 when absent/unreadable. */
export async function directorySize(target: string): Promise<number> {
  let total = 0;
  async function walk(current: string): Promise<void> {
    let entries: nodeFs.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        try {
          total += (await fs.stat(abs)).size;
        } catch {
          /* skip unreadable */
        }
      }
    }
  }
  await walk(target);
  return total;
}

/**
 * Moves each immediate subdirectory of the `sources` dirs into `targetDir`
 * with copy → verify → delete, disambiguating a name already present at the
 * target with a timestamp suffix (design D5). Union-safe: a partial run
 * leaves every entry readable, and a rerun completes the remainder. Skips a
 * source dir that IS the target dir (no self-move).
 */
async function moveArchiveEntries(
  sources: string[],
  targetDir: string,
  options: MoveOptions
): Promise<ArchiveMove[]> {
  const moves: ArchiveMove[] = [];
  const canonicalTarget = path.resolve(targetDir);

  for (const sourceDir of sources) {
    if (path.resolve(sourceDir) === canonicalTarget) continue;
    if (!(await pathIsDirectory(sourceDir))) continue;

    const names = await listSubdirectoryNames(sourceDir);
    for (const name of names) {
      const source = path.join(sourceDir, name);
      let targetName = name;
      let target = path.join(targetDir, targetName);
      if (await pathExists(target)) {
        targetName = `${name}-${Date.now()}`;
        target = path.join(targetDir, targetName);
      }
      moves.push({ name, source, target });
      if (!options.dryRun) {
        await fs.mkdir(targetDir, { recursive: true });
        await moveTreeVerified(source, target, { verifyHash: options.verifyHash });
      }
    }
  }
  return moves;
}

/** Removes a directory only when it exists and is empty. */
async function removeIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) {
      await fs.rmdir(dir);
    }
  } catch {
    /* absent or non-empty: leave it */
  }
}

// -----------------------------------------------------------------------------
// store adopt (design D2)
// -----------------------------------------------------------------------------

export interface AdoptInput extends StorePathOptions, ProjectPathOptions {
  sourcePath: string;
  storeId: string;
  archive?: ArchiveMode;
  dryRun?: boolean;
  verifyHash?: boolean;
}

/**
 * Reported as the project id by a `--dry-run` adopt of a project that has not
 * been assigned one yet: the real id is minted by the actual adopt, and a dry
 * run may not write it (see `adoptProject`).
 */
export const UNASSIGNED_PROJECT_ID = '(unassigned)';

export interface AdoptResult {
  projectId: string;
  storeId: string;
  storeRoot: string;
  sourcePath: string;
  specs: string[];
  changes: string[];
  archiveMode: ArchiveMode;
  archiveMoves: ArchiveMove[];
  /** Paths that would move which git reports as uncommitted (source repo). */
  uncommitted: string[];
  suggestedCommits: SuggestedGitCommand[];
  dryRun: boolean;
  resumed: boolean;
}

async function assertStoreHealthy(storeRoot: string, storeId: string): Promise<void> {
  const inspection = await inspectOpenSpecRoot(storeRoot);
  if (!inspection.healthy) {
    const problems =
      inspection.diagnostics.map((d) => d.message).join(' ') || 'The store Rasen root is incomplete.';
    throw new StoreError(
      `Target store '${storeId}' is not healthy: ${problems}`,
      'adopt_store_unhealthy',
      { target: 'store.root', fix: `Run rasen store doctor ${storeId} and repair it first.` }
    );
  }
}

/**
 * Migrates an in-repo project's planning content into a store, converts the
 * repo to a config-only `store:` pointer, registers the project, and refreshes
 * the machine registry so its mode is `store` immediately (spec store-adopt).
 * Fails closed before any move on precheck failure, aggregating every problem.
 */
export async function adoptProject(input: AdoptInput): Promise<AdoptResult> {
  // Reject before touching the filesystem: the external archive destination is
  // retired, so this mode has no landing place left and must never half-run.
  if ((input.archive as string) === 'external') {
    throw new StoreError(
      "`store adopt --archive external` is retired: archives always land in a planning root, never the machine home.",
      'adopt_external_archive_retired',
      {
        target: 'archive.adopt',
        fix: 'Use --archive move to bring the archive into the store, or --archive leave to keep it in the source repo.',
      }
    );
  }

  const sourcePath = path.resolve(FileSystemUtils.canonicalizeExistingPath(input.sourcePath));
  const archiveMode: ArchiveMode = input.archive ?? 'move';
  const storeOpts: StorePathOptions = input.globalDataDir ? { globalDataDir: input.globalDataDir } : {};

  const store = await resolveRegisteredStore({ id: input.storeId, ...storeOpts });
  const storeRoot = store.storeRoot;
  // Everything below speaks the RESOLVED display name. `--to` accepts a
  // permanent identity, and echoing that back would name a store nothing else
  // recognises — worst of all in the `store:` declaration written at step 5,
  // where a bare identity string reads as a display alias that matches no
  // registered store, leaving a Git-tracked pointer that resolves to nothing.
  const storeId = store.id;

  // A dry run must not mint identity either: `ensureProjectIdInConfig` appends
  // `projectId:` to the TRACKED rasen/config.yaml, so a preview-only run left
  // the repo dirty while printing "no config changed". Read what is already
  // there; a project with no id yet cannot have a manifest entry, so the
  // resume probe below stays correct with the placeholder.
  const projectId = input.dryRun
    ? (readProjectConfig(sourcePath)?.projectId ?? UNASSIGNED_PROJECT_ID)
    : await ensureProjectIdInConfig(sourcePath, storeOpts);
  const existingOwnership = await readProjectOwnership(storeRoot, projectId);
  const pointer = readStorePointer(sourcePath);
  const { hasPlanningShape } = classifyOpenSpecDir(sourcePath);

  // Resume: ownership is already recorded for this project and the source
  // still carries planning shape → an interrupted adopt; complete it
  // idempotently rather than treating the residual state as a fresh adopt.
  // Ownership comes from the membership record, with the legacy manifest read
  // as a fallback while an un-migrated store still carries one, so a resume
  // works either side of `store migrate-membership`.
  const resumed = existingOwnership !== null && hasPlanningShape;

  // --- Prechecks (aggregate every failure) ---
  const problems: string[] = [];
  if (!resumed) {
    await assertStoreHealthy(storeRoot, storeId);
    if (!hasPlanningShape) {
      problems.push(`Source ${sourcePath} has no planning shape (no rasen/specs or rasen/changes).`);
    }
    if (hasStoreDeclaration(pointer)) {
      problems.push(
        `Source already declares store pointer '${describeStoreDeclaration(pointer)}'. Use 'rasen store eject' or 'rasen store doctor' instead.`
      );
    }
    // Collision precheck (case-insensitive, both axes).
    const [srcSpecs, srcChanges, storeSpecs, storeChanges] = await Promise.all([
      listSpecNames(sourcePath),
      listActiveChangeNames(sourcePath),
      listSpecNames(storeRoot),
      listActiveChangeNames(storeRoot),
    ]);
    const specCollisions = caseInsensitiveCollisions(srcSpecs, storeSpecs);
    const changeCollisions = caseInsensitiveCollisions(srcChanges, storeChanges);
    if (specCollisions.length > 0) {
      problems.push(`Spec name collisions in store: ${specCollisions.join(', ')}.`);
    }
    if (changeCollisions.length > 0) {
      problems.push(`Change name collisions in store: ${changeCollisions.join(', ')}.`);
    }
    if (problems.length > 0) {
      throw new StoreError(
        `Adopt cannot proceed:\n  - ${problems.join('\n  - ')}`,
        'adopt_precheck_failed',
        { target: 'store.root', fix: 'Resolve the listed problems, then rerun adopt.' }
      );
    }
  }

  // Names still physically present at the source (what THIS run must move).
  const sourceSpecs = await listSpecNames(sourcePath);
  const sourceChanges = await listActiveChangeNames(sourcePath);
  // The recorded ownership set is the UNION of any prior manifest entry and the
  // source names, so a resume never drops already-moved names from the manifest
  // (finding #2 — reversibility must survive an interrupted adopt).
  const specNames = unionSorted(existingOwnership?.specs ?? [], sourceSpecs);
  const changeNames = unionSorted(existingOwnership?.changes ?? [], sourceChanges);

  // Uncommitted detection for the moved paths (warning only).
  const movedScopes = [
    path.join(WORKSPACE_DIR_NAME, 'specs'),
    path.join(WORKSPACE_DIR_NAME, 'changes'),
  ];
  const uncommitted = await detectUncommittedPaths(sourcePath, movedScopes);

  let archiveMoves: ArchiveMove[] = [];
  const archiveOptions: MoveOptions = {
    ...storeOpts,
    ...(input.verifyHash ? { verifyHash: true } : {}),
  };

  if (input.dryRun) {
    // Preview the archive relocation too: enumeration is read-only when
    // `dryRun` is passed through, and archives run to hundreds of entries, so
    // leaving this inside the mutation guard made `--dry-run` report `0
    // entries` and hid the true scale of the operation (spec store-adopt,
    // "Adopt is git-safe and previewable"). Same shape as `archive relocate`.
    archiveMoves = await handleAdoptArchive(sourcePath, storeRoot, archiveMode, {
      ...archiveOptions,
      dryRun: true,
    });
  }

  if (!input.dryRun) {
    // 1. add-project semantics (project namespace + store reference + the
    //    membership record and locator hint) while the source still has
    //    planning shape (register requires a healthy, non-pointer root).
    //    Idempotent; tolerate an already-present registration.
    let addedProjectId: string | undefined;
    try {
      // Re-resolution, not display: this hands the store to another lookup,
      // and the display name is ambiguous exactly when two stores share it —
      // which is when the user named this one by identity to begin with.
      //
      // The roles are stated here rather than inherited: add-project derives
      // `knowledge: true` for its own semantics, roles OR-widen on write, and
      // an adoption that let that through would durably record a knowledge
      // membership nobody established (design D2).
      const added = await storeAddProject({
        projectPath: sourcePath,
        targetStoreId: store.uid ?? storeId,
        roles: { planning: true, knowledge: false },
      });
      addedProjectId = added.project.id;
    } catch (error) {
      // A self-reference or already-present reference is not fatal to adopt.
      if (
        !(error instanceof StoreError) ||
        !['store_add_project_self_reference', 'store_id_conflict', 'store_path_conflict'].includes(
          error.diagnostic.code
        )
      ) {
        throw error;
      }
    }

    // 2. Ownership BEFORE any source deletion (design D2 / spec "Manifest
    //    written before source deletion"): a crash mid-move then leaves the
    //    record already present, so a rerun takes the resume path and
    //    completes idempotently instead of failing the collision precheck on
    //    the names it already moved. Preserves the original timestamp on
    //    resume and records the full union name set.
    //
    //    Ownership now lives in the store's per-project membership record,
    //    which carries NO path: restoring the project later resolves its
    //    destination explicitly (see `ejectProject`) rather than following a
    //    path captured on whichever machine ran the adoption.
    const adoption: StoreProjectRecordAdoption = {
      specs: specNames,
      changes: changeNames,
      adoptedAt: existingOwnership?.adoptedAt ?? nowIso(),
    };
    const storeRef: ResolvedStoreRef = {
      type: 'store',
      id: storeId,
      root: storeRoot,
      ...(store.uid !== undefined ? { uid: store.uid } : {}),
    };
    await writeMembershipRecord({
      projectRoot: sourcePath,
      projectId,
      ...(addedProjectId !== undefined ? { projectDisplayId: addedProjectId } : {}),
      store: storeRef,
      // Adopt proves PLANNING membership and nothing else; roles only ever
      // widen, so a knowledge role another command recorded survives.
      roles: { planning: true, knowledge: false },
      adoption,
    });
    // The project-side locator, so a fresh clone of the repo can still find
    // the store its planning now lives in. `add-project` above normally wrote
    // it; this is the idempotent completion for the paths where it did not.
    await writeMembershipLocator(
      sourcePath,
      membershipHintFor(storeRef, await storeRemoteFor(storeRoot))
    ).catch(() => undefined);

    // 3. Copy → verify → delete specs and changes into the store's flat layout.
    //    Only names still present at the source are moved; a resume skips names
    //    already relocated by an interrupted prior run.
    for (const name of sourceSpecs) {
      await moveTreeVerified(path.join(specsDir(sourcePath), name), path.join(specsDir(storeRoot), name), {
        verifyHash: input.verifyHash,
      });
    }
    for (const name of sourceChanges) {
      await moveTreeVerified(
        path.join(changesDir(sourcePath), name),
        path.join(changesDir(storeRoot), name),
        { verifyHash: input.verifyHash }
      );
    }

    // 4. Archive handling per --archive. Stays here (not hoisted next to the
    //    dry-run preview above) because it deletes source content and so must
    //    run AFTER the manifest write of step 2.
    archiveMoves = await handleAdoptArchive(sourcePath, storeRoot, archiveMode, archiveOptions);

    // 5. Remove now-empty planning dirs and write the store pointer.
    await removeIfEmpty(specsDir(sourcePath));
    if (archiveMode !== 'leave') {
      await removeIfEmpty(inRepoArchiveDir(sourcePath));
    }
    await removeIfEmpty(changesDir(sourcePath));
    await writeAdoptedStoreDeclaration(sourcePath, store, storeId);

    // 6. Refresh the machine registry so mode flips to `store` now.
    await registerProject({ projectRoot: sourcePath, projectId, mode: 'store' }, storeOpts);
  }

  const suggestedCommits: SuggestedGitCommand[] = [];
  const sourceCommit = renderSuggestedCommit(
    sourcePath,
    [WORKSPACE_DIR_NAME],
    `chore: adopt planning into store ${storeId}`,
    'Source repo: record the removed planning dirs and the new store: pointer.'
  );
  if (sourceCommit) suggestedCommits.push(sourceCommit);
  const storeCommit = renderSuggestedCommit(
    storeRoot,
    [WORKSPACE_DIR_NAME, '.rasen-store'],
    `chore: adopt ${path.basename(sourcePath)} planning`,
    'Store repo: record the adopted specs/changes and the ownership manifest.'
  );
  if (storeCommit) suggestedCommits.push(storeCommit);

  return {
    projectId,
    storeId,
    storeRoot,
    sourcePath,
    specs: specNames,
    changes: changeNames,
    archiveMode,
    archiveMoves,
    uncommitted,
    suggestedCommits,
    dryRun: !!input.dryRun,
    resumed,
  };
}

async function handleAdoptArchive(
  sourcePath: string,
  storeRoot: string,
  mode: ArchiveMode,
  options: MoveOptions
): Promise<ArchiveMove[]> {
  if (mode === 'leave') {
    return [];
  }
  // `move` is the only destination left: archives land in a planning root, and
  // adopt writes no archive configuration (`archive-destination` capability).
  return moveArchiveEntries([inRepoArchiveDir(sourcePath)], inRepoArchiveDir(storeRoot), options);
}

// -----------------------------------------------------------------------------
// store eject (design D4)
// -----------------------------------------------------------------------------

export interface EjectInput extends StorePathOptions, ProjectPathOptions {
  projectId: string;
  storeId: string;
  /** Ownership-less full copy back. */
  all?: boolean;
  /** Proceed past missing recorded files, reporting the gaps. */
  force?: boolean;
  dryRun?: boolean;
  verifyHash?: boolean;
  /**
   * Explicit `--into` destination. When absent the destination is resolved by
   * the ordered rule in `resolveEjectDestination` — never from a path recorded
   * on the machine that ran the adoption.
   */
  destinationPath?: string;
  /**
   * Where the command was invoked, for destination rule 2. Defaults to the
   * process working directory; injectable so the rule is testable without
   * changing the process's own cwd.
   */
  currentDirectory?: string;
}

/** A checkout eject could restore into, for the ambiguity report. */
export interface EjectDestinationCandidate {
  path: string;
  /** How it was found: the current checkout, or the machine project registry. */
  source: 'current-checkout' | 'project-registry';
}

/**
 * Canonical form for comparing two checkouts. Falls back to `path.resolve` for
 * a path not on disk, so a registry entry for a deleted checkout still
 * normalizes rather than throwing — and drive-letter case and separator form
 * never create or hide a match on Windows.
 */
function canonicalCheckout(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

function sameCheckout(left: string, right: string): boolean {
  const a = canonicalCheckout(left);
  const b = canonicalCheckout(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Eject's destination, by an explicit ordered rule and nothing else
 * (design D7):
 *
 *   1. an explicit `--into <path>`;
 *   2. the current checkout, when its project identity IS the project being
 *      ejected;
 *   3. the machine project registry's single live checkout for that identity;
 *   4. otherwise fail, naming `--into` and listing every candidate found.
 *
 * Explicitly NOT consulted, in any order: a `sourcePath` recorded in legacy
 * shared data (it is the absolute path of whichever machine ran the adoption,
 * and following it on any other machine restores the project into a directory
 * that has nothing to do with it), a local path inferred from a remote, a
 * guess from a display name, and the first of several checkouts.
 */
export async function resolveEjectDestination(input: {
  projectId: string;
  explicit?: string;
  currentDirectory?: string;
  pathOptions?: ProjectPathOptions;
}): Promise<{ destinationPath: string; candidates: EjectDestinationCandidate[] }> {
  const candidates: EjectDestinationCandidate[] = [];

  if (input.explicit) {
    return { destinationPath: path.resolve(input.explicit), candidates };
  }

  const cwd = input.currentDirectory ?? process.cwd();
  const currentRoot = findRepoPlanningRootSync(cwd) ?? cwd;
  if (readProjectConfig(currentRoot)?.projectId === input.projectId) {
    return { destinationPath: canonicalCheckout(currentRoot), candidates };
  }

  const registry = await readProjectRegistryState(input.pathOptions ?? {});
  const seen = new Set<string>();
  for (const [root, entry] of Object.entries(registry?.projects ?? {})) {
    if (entry.projectId !== input.projectId) continue;
    if (!(await pathIsDirectory(root))) continue;
    const canonical = canonicalCheckout(root);
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ path: canonical, source: 'project-registry' });
  }

  if (candidates.length === 1) {
    return { destinationPath: (candidates[0] as EjectDestinationCandidate).path, candidates };
  }

  // `--into` is named in the MESSAGE, not only the fix: this is the one error
  // a user meets where the previous version silently guessed, so the first
  // line they read has to say what to do about it.
  throw new StoreError(
    candidates.length === 0
      ? `No live checkout of project '${input.projectId}' is registered on this machine, so eject cannot tell where to restore it. Pass --into <path>.`
      : `Project '${input.projectId}' has ${candidates.length} live checkouts on this machine: ${candidates
          .map((candidate) => candidate.path)
          .join(', ')}. Pass --into <path> to choose one.`,
    'eject_destination_required',
    {
      target: 'store.root',
      fix: `Pass --into <path> to name the repository to restore into.${
        candidates.length > 0
          ? ` Candidates: ${candidates.map((candidate) => candidate.path).join(', ')}.`
          : ''
      }`,
    }
  );
}

export interface EjectResult {
  projectId: string;
  storeId: string;
  storeRoot: string;
  destinationPath: string;
  specs: string[];
  changes: string[];
  missing: string[];
  /** Destination names this eject would overwrite (warning, not a block). */
  collisions: string[];
  suggestedCommits: SuggestedGitCommand[];
  dryRun: boolean;
  usedAll: boolean;
}

/**
 * Restores a store-hosted project back to in-repo planning (spec store-eject).
 * Manifest-driven by default; `--all` copies the whole store planning tree
 * back (the command layer enforces the interactive confirmation). Fails closed
 * on manifest drift unless `--force`.
 */
export async function ejectProject(input: EjectInput): Promise<EjectResult> {
  const storeOpts: StorePathOptions = input.globalDataDir ? { globalDataDir: input.globalDataDir } : {};
  const store = await resolveRegisteredStore({ id: input.storeId, ...storeOpts });
  const storeRoot = store.storeRoot;
  // The RESOLVED display name from here on: `--from` accepts a permanent
  // identity, and every message, commit hint, and result field below would
  // otherwise echo back a name nothing else recognises.
  const storeId = store.id;
  const projectOptions: ProjectPathOptions = input.globalDataDir
    ? { globalDataDir: input.globalDataDir }
    : {};
  // Ownership comes from the store's membership record for this project, with
  // the legacy adoption manifest read as a fallback while an un-migrated store
  // still carries one. Its recorded `sourcePath`, if any, is never consulted.
  const ownership = await readProjectOwnership(storeRoot, input.projectId);

  let specNames: string[];
  let changeNames: string[];
  const usedAll = !ownership;

  if (ownership) {
    specNames = ownership.specs;
    changeNames = ownership.changes;
  } else {
    if (!input.all) {
      throw new StoreError(
        `Store '${storeId}' holds no ownership record for project '${input.projectId}' — neither a membership record nor legacy adoption data.`,
        'eject_manifest_missing',
        {
          target: 'store.metadata',
          fix: 'Pass --all to copy the entire store planning content back (with confirmation).',
        }
      );
    }
    specNames = await listSpecNames(storeRoot);
    changeNames = await listActiveChangeNames(storeRoot);
  }

  // The destination is resolved by the explicit ordered rule for BOTH paths,
  // including `--all`: nothing about copying everything back makes a recorded
  // path any more trustworthy.
  const destination = await resolveEjectDestination({
    projectId: input.projectId,
    ...(input.destinationPath !== undefined ? { explicit: input.destinationPath } : {}),
    ...(input.currentDirectory !== undefined ? { currentDirectory: input.currentDirectory } : {}),
    pathOptions: projectOptions,
  });
  const destinationPath = destination.destinationPath;

  // Drift check: manifest-listed names absent from the store.
  const [storeSpecs, storeChanges] = await Promise.all([
    listSpecNames(storeRoot),
    listActiveChangeNames(storeRoot),
  ]);
  const missing = [
    ...specNames.filter((name) => !storeSpecs.includes(name)),
    ...changeNames.filter((name) => !storeChanges.includes(name)),
  ];
  if (missing.length > 0 && !input.force) {
    throw new StoreError(
      `Store is missing manifest-listed content: ${missing.join(', ')}.`,
      'eject_manifest_drift',
      {
        target: 'store.metadata',
        fix: 'Inspect the store git history, or rerun with --force to proceed with whatever exists.',
      }
    );
  }

  const presentSpecs = specNames.filter((name) => storeSpecs.includes(name));
  const presentChanges = changeNames.filter((name) => storeChanges.includes(name));

  // Destination collisions (finding #9): names already present in the repo that
  // this eject would overwrite. Surfaced as a warning (never silently
  // replaced); the copy still proceeds — the manifest names are authoritative.
  const [destSpecs, destChanges] = await Promise.all([
    listSpecNames(destinationPath),
    listActiveChangeNames(destinationPath),
  ]);
  const collisions = [
    ...presentSpecs.filter((name) => destSpecs.includes(name)),
    ...presentChanges.filter((name) => destChanges.includes(name)),
  ];

  if (!input.dryRun) {
    for (const name of presentSpecs) {
      await moveTreeVerified(
        path.join(specsDir(storeRoot), name),
        path.join(specsDir(destinationPath), name),
        { verifyHash: input.verifyHash }
      );
    }
    for (const name of presentChanges) {
      await moveTreeVerified(
        path.join(changesDir(storeRoot), name),
        path.join(changesDir(destinationPath), name),
        { verifyHash: input.verifyHash }
      );
    }

    // Remove the pointer, drop the manifest entry, refresh registry to in-repo.
    if (hasStoreDeclaration(readStorePointer(destinationPath))) {
      updateProjectConfigKey(destinationPath, 'store', undefined);
    }
    if (ownership) {
      await clearProjectOwnership(storeRoot, input.projectId);
    }
    const projectId = await ensureProjectIdInConfig(destinationPath, storeOpts);
    await registerProject({ projectRoot: destinationPath, projectId, mode: 'in-repo' }, storeOpts);
  }

  const suggestedCommits: SuggestedGitCommand[] = [];
  const destCommit = renderSuggestedCommit(
    destinationPath,
    ['rasen'],
    `chore: eject planning from store ${storeId}`,
    'Repo: record the restored specs/changes and the removed store: pointer.'
  );
  if (destCommit) suggestedCommits.push(destCommit);
  const storeCommit = renderSuggestedCommit(
    storeRoot,
    ['rasen', '.rasen-store'],
    `chore: eject ${path.basename(destinationPath)} planning`,
    'Store repo: record the removed specs/changes and manifest entry.'
  );
  if (storeCommit) suggestedCommits.push(storeCommit);

  return {
    projectId: input.projectId,
    storeId,
    storeRoot,
    destinationPath,
    specs: presentSpecs,
    changes: presentChanges,
    missing,
    collisions,
    suggestedCommits,
    dryRun: !!input.dryRun,
    usedAll,
  };
}

// -----------------------------------------------------------------------------
// archive relocate (design D5)
// -----------------------------------------------------------------------------

/**
 * Relocation consolidates archive DATA into the planning root (or the store's
 * root in store mode). `external` is retired (`archive-relocate` capability):
 * there is no destination axis left to flip, so relocation only ever moves
 * archives INTO a planning root, never out of one.
 */
export type RelocateTarget = 'in-repo' | 'store';

export interface RelocateInput extends StorePathOptions, ProjectPathOptions {
  projectRoot: string;
  to: RelocateTarget;
  dryRun?: boolean;
  verifyHash?: boolean;
}

export interface RelocateResult {
  to: RelocateTarget;
  targetDir: string;
  moves: ArchiveMove[];
  dryRun: boolean;
}

/**
 * Consolidates existing archived changes into `--to` (spec archive-relocate).
 * There is no destination configuration to flip any more — relocation moves
 * DATA only. Enumerates from every current location (repo, machine home, store
 * archive) so a split archive consolidates.
 */
export async function relocateArchive(input: RelocateInput): Promise<RelocateResult> {
  if ((input.to as string) === 'prune') {
    throw new StoreError(
      "`archive relocate --to prune` is not supported: destructive pruning is retired and no path deletes archives.",
      'relocate_prune_rejected',
      {
        target: 'archive.relocate',
        fix: 'Archives always live in the planning root. Use --to in-repo (or --to store in store mode).',
      }
    );
  }

  if ((input.to as string) === 'external') {
    throw new StoreError(
      "`archive relocate --to external` is retired: archive bookkeeping always lands in the planning root.",
      'relocate_external_retired',
      {
        target: 'archive.relocate',
        fix: 'Use --to in-repo to consolidate existing archives (including legacy machine-home ones) into the planning root, or --to store in store mode.',
      }
    );
  }

  const projectRoot = path.resolve(FileSystemUtils.canonicalizeExistingPath(input.projectRoot));
  const storeOpts: StorePathOptions = input.globalDataDir ? { globalDataDir: input.globalDataDir } : {};
  const pointer = readStorePointer(projectRoot);
  const isStoreMode =
    hasStoreDeclaration(pointer) && !classifyOpenSpecDir(projectRoot).hasPlanningShape;

  // Enumerate current locations (union): repo archive + machine home archive +
  // store archive when store-mode.
  const sources = new Set<string>();
  sources.add(inRepoArchiveDir(projectRoot));
  const home = await resolveProjectHome(projectRoot, {
    ensure: false,
    ...(input.globalDataDir ? { globalDataDir: input.globalDataDir } : {}),
  });
  if (home) sources.add(home.archiveDir);

  let storeRoot: string | undefined;
  if (hasStoreDeclaration(pointer)) {
    // Through the shared resolver, so a declaration that records only the
    // permanent identity resolves too, and an alias never overrides the uid
    // it travels with. An unusable declaration is doctor's problem, not
    // relocate's — it degrades to "no store archive to consolidate".
    const binding = await resolveDeclaredStore(pointer, projectRoot, storeOpts);
    if (binding.kind === 'resolved') {
      storeRoot = binding.store.root;
      sources.add(inRepoArchiveDir(storeRoot));
    }
  }

  // Resolve the target dir. Both targets are planning roots — the project's
  // own, or the store's when the project is store-mode.
  let targetDir: string;
  if (input.to === 'in-repo') {
    targetDir = inRepoArchiveDir(projectRoot);
  } else {
    // store
    if (!isStoreMode || !storeRoot) {
      throw new StoreError(
        'The project must be adopted into a store before `archive relocate --to store`.',
        'relocate_not_store_mode',
        { target: 'store.pointer', fix: 'Run `rasen store adopt . --to <store-id>` first.' }
      );
    }
    targetDir = inRepoArchiveDir(storeRoot);
  }

  const moves = await moveArchiveEntries([...sources], targetDir, {
    ...storeOpts,
    ...(input.verifyHash ? { verifyHash: true } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
  });

  // No config write: there is no destination axis left to record
  // (`archive-relocate` capability). Relocation moves DATA only.

  return { to: input.to, targetDir, moves, dryRun: !!input.dryRun };
}

// -----------------------------------------------------------------------------
// home prune (design D6)
// -----------------------------------------------------------------------------

export interface HomeOrphan {
  path: string;
  size: number;
}

export interface HomePruneResult {
  /** Class (a): registry entries whose project path no longer exists. */
  danglingEntries: Array<{ path: string; home: string; size: number }>;
  /** Class (b): home directories referenced by no registry entry. */
  unreferencedHomes: HomeOrphan[];
  applied: boolean;
  /** When applied: home directories actually removed. */
  removedHomes: string[];
}

/**
 * Reports (default) or removes (`apply`) orphaned machine-home state (spec
 * machine-home-prune): class (a) registry entries whose path is gone, class
 * (b) home dirs referenced by no entry. A home referenced by any live entry is
 * never eligible regardless of `lastSeen` age. Writes run under the registry
 * lock.
 */
export async function homePrune(
  options: { apply?: boolean } & ProjectPathOptions = {}
): Promise<HomePruneResult> {
  const pathOptions: ProjectPathOptions = options.globalDataDir
    ? { globalDataDir: options.globalDataDir }
    : {};

  const dangling = await findDanglingProjectEntries(pathOptions);
  const state = await readProjectRegistryState(pathOptions);
  const referencedHomes = new Set(Object.values(state?.projects ?? {}).map((entry) => entry.home));

  const danglingEntries = await Promise.all(
    dangling.map(async (d) => ({
      path: d.path,
      home: d.entry.home,
      size: await directorySize(getProjectHomeDir(d.entry.home, pathOptions)),
    }))
  );

  // Class (b): directories under projects/ that no entry references.
  const projectsDir = getProjectsDir(pathOptions);
  let homeDirs: nodeFs.Dirent[] = [];
  try {
    homeDirs = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    homeDirs = [];
  }
  const unreferencedHomes: HomeOrphan[] = [];
  for (const dir of homeDirs) {
    if (!dir.isDirectory()) continue;
    if (referencedHomes.has(dir.name)) continue;
    unreferencedHomes.push({
      path: path.join(projectsDir, dir.name),
      size: await directorySize(path.join(projectsDir, dir.name)),
    });
  }

  if (!options.apply) {
    return { danglingEntries, unreferencedHomes, applied: false, removedHomes: [] };
  }

  const removedHomes: string[] = [];
  await withProjectRegistryLock(async () => {
    const current = await readProjectRegistryState(pathOptions);
    const projects = { ...(current?.projects ?? {}) };
    for (const d of dangling) {
      delete projects[d.path];
    }
    if (dangling.length > 0) {
      await writeProjectRegistryState({ version: 1, projects }, pathOptions);
    }

    const stillReferenced = new Set(Object.values(projects).map((entry) => entry.home));
    // Class (a) homes now unreferenced + class (b) homes.
    const candidates = new Set<string>();
    for (const d of dangling) {
      if (!stillReferenced.has(d.entry.home)) {
        candidates.add(getProjectHomeDir(d.entry.home, pathOptions));
      }
    }
    // Re-check class (b) candidates against the freshly-read registry (finding
    // #8, TOCTOU): a home registered between the pre-lock scan and this locked
    // apply is now referenced and must never be deleted.
    for (const orphan of unreferencedHomes) {
      if (!stillReferenced.has(path.basename(orphan.path))) {
        candidates.add(orphan.path);
      }
    }
    for (const candidate of candidates) {
      const ok = await fs
        .rm(candidate, { recursive: true, force: true })
        .then(() => true)
        .catch(() => false);
      if (ok) removedHomes.push(candidate);
    }
  }, pathOptions);

  return { danglingEntries, unreferencedHomes, applied: true, removedHomes };
}

// -----------------------------------------------------------------------------
// store migrate-membership (design D8)
// -----------------------------------------------------------------------------

export interface MigrateMembershipInput extends StorePathOptions {
  storeId: string;
  apply?: boolean;
}

/** One project the migration converted, or could not. */
export interface MigrateMembershipEntry {
  projectId?: string;
  /** The display alias a legacy reference used, when that is all there was. */
  alias?: string;
  source: 'legacy-adoption' | 'legacy-reference' | 'both';
  roles: StoreProjectRoles;
  recordPath?: string;
  /** Why this entry could not be converted; absent when it was. */
  unresolved?: string;
}

export interface MigrateMembershipResult {
  storeId: string;
  storeRoot: string;
  applied: boolean;
  /** Projects converted (or, in a preview, that would be). */
  converted: MigrateMembershipEntry[];
  /** Legacy entries left untouched because they could not be resolved here. */
  unresolved: MigrateMembershipEntry[];
  /** Absolute paths written in the store repo, including the legacy removal. */
  storeWrites: string[];
  /** True when the legacy manifest was (or would be) removed. */
  legacyManifestRemoved: boolean;
  legacyManifestPath: string;
  diagnostics: StoreDiagnostic[];
  suggestedCommits: SuggestedGitCommand[];
}

/**
 * Converts a store's legacy membership data into per-project records
 * (design D8).
 *
 * Reads the legacy adoption manifest, the referenced-project entries, and the
 * machine's project namespace; writes one `projects/<projectId>.yaml` per
 * resolvable project; drops `sourcePath`; maps the adoption `timestamp` onto
 * `adoption.adoptedAt`.
 *
 * The legacy manifest is removed ONLY after every record it produced has been
 * written AND read back — and only under `--apply`. Removing rather than
 * renaming is deliberate: any archived copy would keep the machine-absolute
 * `sourcePath` in git, which is the thing being removed. Nothing is lost: the
 * facts move into the records, and the file itself stays recoverable from the
 * store's git history. The removal is reported for the user to commit; this
 * command never touches the git index.
 *
 * Idempotent and re-runnable. A project whose identity cannot be determined on
 * this machine is reported and LEFT ALONE — never guessed at, and never a
 * reason to remove the legacy data that still describes it.
 */
export async function migrateStoreMembership(
  input: MigrateMembershipInput
): Promise<MigrateMembershipResult> {
  const storeOpts: StorePathOptions = input.globalDataDir
    ? { globalDataDir: input.globalDataDir }
    : {};
  const store = await resolveRegisteredStore({ id: input.storeId, ...storeOpts });
  const storeRoot = store.storeRoot;
  const storeRef: ResolvedStoreRef = {
    type: 'store',
    id: store.id,
    root: storeRoot,
    ...(store.uid !== undefined ? { uid: store.uid } : {}),
  };

  const registry = await readStoreRegistryState(storeOpts);
  const entries = registry ? listStoreRegistryEntries(registry) : [];
  const label = membershipStoreLabel(storeRef, entries);

  // The provider already normalizes all three sources into one shape with its
  // provenance, so the migration converts exactly what every reader already
  // sees — it never re-derives membership a second way.
  const listing = await listStoreMembers(storeRef, storeOpts);
  const existing = await listStoreProjectRecords(storeRoot);
  const alreadyRecorded = new Set(existing.records.map((record) => record.projectId));

  const converted: MigrateMembershipEntry[] = [];
  const unresolved: MigrateMembershipEntry[] = [];
  const storeWrites: string[] = [];
  const diagnostics: StoreDiagnostic[] = [...existing.diagnostics];

  for (const diagnostic of listing.diagnostics) {
    if (diagnostic.code === 'store_legacy_reference_unresolved') {
      diagnostics.push(diagnostic);
      unresolved.push({
        source: 'legacy-reference',
        roles: { planning: false, knowledge: true },
        unresolved: diagnostic.message,
      });
    }
  }

  for (const member of listing.members) {
    if (member.provenance === 'v2-record') continue;
    if (alreadyRecorded.has(member.projectId)) continue;

    const problem = projectIdentityDiagnostic(member.projectId);
    if (problem !== null) {
      diagnostics.push(problem);
      unresolved.push({
        projectId: member.projectId,
        source: member.provenance === 'legacy-adoption' ? 'legacy-adoption' : 'legacy-reference',
        roles: member.roles,
        unresolved: problem.message,
      });
      continue;
    }

    const entry: MigrateMembershipEntry = {
      projectId: member.projectId,
      ...(member.id !== undefined ? { alias: member.id } : {}),
      source:
        member.provenance === 'legacy-adoption'
          ? member.roles.knowledge
            ? 'both'
            : 'legacy-adoption'
          : 'legacy-reference',
      roles: member.roles,
      recordPath: getStoreProjectRecordPath(storeRoot, member.projectId),
    };

    if (input.apply) {
      // B6: acquire the same per-record lock writeMembershipRecord uses, and
      // re-read inside it. A concurrent add-project may have already written a
      // role to this record; merge rather than blindly overwrite so the
      // concurrent role survives. Each record has its own lock path — acquire
      // and release per record, never hold all simultaneously (deadlock).
      const recordLockPath = machineLockPath(
        path.resolve(getStoreProjectRecordPath(storeRoot, member.projectId))
      );
      const written = await withOwnerAwareFileLock(
        {
          lockPath: recordLockPath,
          errorFor: membershipRecordLockError,
          holder: 'store-membership-record',
        },
        async () => {
          const current = await readStoreProjectRecord(storeRoot, member.projectId);
          const currentRecord = current.record;
          // Merge: prefer the live record's id/remote/knowledgeBundle (set by
          // a more recent add-project), widen roles from both sources, carry
          // the legacy adoption forward when not already set.
          const mergedId = currentRecord?.id ?? member.id;
          const mergedRemote = currentRecord?.remote ?? member.remote;
          const mergedAdoption = member.adoption ?? currentRecord?.adoption;
          const record: StoreProjectRecord = {
            version: 1,
            projectId: member.projectId,
            ...(mergedId !== undefined ? { id: mergedId } : {}),
            ...(mergedRemote !== undefined ? { remote: mergedRemote } : {}),
            ...(currentRecord?.knowledgeBundle !== undefined
              ? { knowledgeBundle: currentRecord.knowledgeBundle }
              : {}),
            roles: mergeStoreProjectRoles(currentRecord?.roles, member.roles),
            ...(mergedAdoption !== undefined ? { adoption: mergedAdoption } : {}),
          };
          const writePath = await writeStoreProjectRecord(storeRoot, record);
          // Read back before this record counts as converted: the legacy data
          // is only allowed to go once every record it produced is provably on
          // disk.
          const verified = await readStoreProjectRecord(storeRoot, member.projectId);
          if (!verified.record) {
            throw new StoreError(
              `The membership record for project ${member.projectId} did not read back after being written (${writePath}); the legacy data was left untouched.`,
              'migrate_membership_verify_failed',
              {
                target: 'store.membership',
                fix: `Inspect ${writePath} and rerun 'rasen store migrate-membership ${label.selector} --apply'.`,
              }
            );
          }
          return writePath;
        }
      );
      entry.recordPath = written;
    }

    storeWrites.push(entry.recordPath as string);
    converted.push(entry);
  }

  const legacyManifestPath = getAdoptionsManifestPath(storeRoot);
  const manifestPresent = await pathExists(legacyManifestPath);
  // The manifest goes only when nothing it holds is still unconverted. An
  // unresolvable project keeps its legacy data, because that data is the only
  // remaining record that the membership exists at all.
  const legacyManifestRemovable = manifestPresent && unresolved.length === 0;

  if (legacyManifestRemovable) {
    storeWrites.push(legacyManifestPath);
    if (input.apply) {
      await deleteAdoptionsManifest(storeRoot);
    }
  } else if (manifestPresent) {
    diagnostics.push(
      storeMembershipLegacyManifest({
        manifestPath: legacyManifestPath,
        storeSelector: label.selector,
      })
    );
  }

  const suggestedCommits: SuggestedGitCommand[] = [];
  const commit = renderSuggestedCommit(
    storeRoot,
    [STORE_METADATA_DIR_NAME],
    'chore: convert store membership to per-project records',
    'Store repo: record the new membership records and the removed legacy manifest.'
  );
  if (commit && storeWrites.length > 0) suggestedCommits.push(commit);

  return {
    storeId: store.id,
    storeRoot,
    applied: !!input.apply,
    converted,
    unresolved,
    storeWrites,
    legacyManifestRemoved: legacyManifestRemovable,
    legacyManifestPath,
    diagnostics,
    suggestedCommits,
  };
}

// -----------------------------------------------------------------------------
// store doctor drift diagnostics (design D7)
// -----------------------------------------------------------------------------

/**
 * Migration-drift diagnostics for a single planning root (spec
 * store-registration): pointer to an unregistered store (error), planning
 * shape + pointer both present (warning), and adoption-manifest entries
 * referencing content absent from the store (warning).
 */
export async function diagnoseMigrationDrift(
  projectRoot: string,
  options: StorePathOptions = {}
): Promise<StoreDiagnostic[]> {
  const diagnostics: StoreDiagnostic[] = [];
  const { hasPlanningShape, pointer } = classifyOpenSpecDir(projectRoot);

  if (hasStoreDeclaration(pointer)) {
    const declared = describeStoreDeclaration(pointer) ?? '(unnamed store)';
    // The shared resolver decides, so a declaration recording only the
    // permanent identity is checked like any other. `absent` here means the
    // no-transitivity rule applied (this root IS the store) — nothing drifted.
    const binding = await resolveDeclaredStore(pointer, projectRoot, options);
    const registered = binding.kind === 'resolved';
    if (binding.kind === 'unavailable') {
      diagnostics.push(
        makeStoreDiagnostic(
          'error',
          'drift_pointer_unregistered',
          binding.reason === 'not-registered'
            ? `Config declares store pointer '${declared}', but no store with that id is registered.`
            : `Config declares store pointer '${declared}', which cannot be used on this machine (${binding.reason}).`,
          {
            target: 'store.pointer',
            fix:
              binding.reason === 'not-registered'
                ? `Run 'rasen store register' for '${declared}', or correct the store: pointer.`
                : primaryRepair(binding),
          }
        )
      );
    }

    if (hasPlanningShape) {
      diagnostics.push(
        makeStoreDiagnostic(
          'warning',
          'drift_shape_and_pointer',
          'Both planning shape and a store: pointer are present; mode derivation resolves this project as in-repo.',
          {
            target: 'store.pointer',
            fix: "Resume 'rasen store adopt --resume', or remove the store: pointer.",
          }
        )
      );
    }

    // Membership findings deliberately do NOT come out of here. They used to,
    // and that made them reachable only for a project that declares a planning
    // Store and only under a "Migration drift:" heading — so the half-written
    // two-repository state D6 leaves behind (record present, locator absent,
    // no planning binding) reported nothing at all. Both doctors now read the
    // membership section's own `diagnostics`, which is present whether or not
    // a planning binding exists. Reporting them twice would also make the two
    // surfaces disagree on how many findings there are.

    // Ownership drift, when the pointer targets a resolvable store.
    if (registered && binding.kind === 'resolved') {
      try {
        const storeRoot = binding.store.root;
        const config = readProjectConfig(projectRoot);
        const projectId = config?.projectId;
        if (projectId) {
          const entry = await readProjectOwnership(storeRoot, projectId);
          if (entry) {
            const [storeSpecs, storeChanges] = await Promise.all([
              listSpecNames(storeRoot),
              listActiveChangeNames(storeRoot),
            ]);
            const missing = [
              ...entry.specs.filter((name) => !storeSpecs.includes(name)),
              ...entry.changes.filter((name) => !storeChanges.includes(name)),
            ];
            if (missing.length > 0) {
              diagnostics.push(
                makeStoreDiagnostic(
                  'warning',
                  'drift_manifest_missing_content',
                  `Adoption manifest references content missing from the store: ${missing.join(', ')}.`,
                  {
                    target: 'store.metadata',
                    fix: "Inspect the store's git history, or run 'rasen store eject --force'.",
                  }
                )
              );
            }
          }
        }
      } catch {
        /* resolution issues surface elsewhere in doctor */
      }
    }
  }

  return diagnostics;
}
