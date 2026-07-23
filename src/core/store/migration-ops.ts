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
import { pathIsDirectory } from '../file-state.js';
import {
  classifyOpenSpecDir,
  ensureProjectIdInConfig,
  readProjectConfig,
  readStorePointer,
  updateProjectConfigKey,
  type ArchiveDestination,
} from '../project-config.js';
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
import { inspectOpenSpecRoot } from '../workspace-root.js';
import { StoreError, type StoreDiagnostic, makeStoreDiagnostic } from './errors.js';
import {
  listStoreRegistryEntries,
  readStoreRegistryState,
  type StorePathOptions,
} from './foundation.js';
import { resolveRegisteredStore } from './registry.js';
import { storeAddProject } from './operations.js';
import {
  caseInsensitiveCollisions,
  changesDir,
  detectUncommittedPaths,
  inRepoArchiveDir,
  listActiveChangeNames,
  listSpecNames,
  listSubdirectoryNames,
  moveTreeVerified,
  readAdoptionEntry,
  removeAdoptionEntry,
  renderSuggestedCommit,
  specsDir,
  upsertAdoptionEntry,
  type AdoptionEntry,
  type SuggestedGitCommand,
} from './migration.js';

const fs = nodeFs.promises;

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

export type ArchiveMode = 'move' | 'leave' | 'external';

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
  const sourcePath = path.resolve(FileSystemUtils.canonicalizeExistingPath(input.sourcePath));
  const archiveMode: ArchiveMode = input.archive ?? 'move';
  const storeOpts: StorePathOptions = input.globalDataDir ? { globalDataDir: input.globalDataDir } : {};

  const store = await resolveRegisteredStore({ id: input.storeId, ...storeOpts });
  const storeRoot = store.storeRoot;

  const projectId = await ensureProjectIdInConfig(sourcePath, storeOpts);
  const existingEntry = await readAdoptionEntry(storeRoot, projectId);
  const pointer = readStorePointer(sourcePath);
  const { hasPlanningShape } = classifyOpenSpecDir(sourcePath);

  // Resume: a manifest entry already exists for this project and the source
  // still carries planning shape → an interrupted adopt; complete it
  // idempotently rather than treating the residual state as a fresh adopt.
  const resumed = existingEntry !== null && hasPlanningShape;

  // --- Prechecks (aggregate every failure) ---
  const problems: string[] = [];
  if (!resumed) {
    await assertStoreHealthy(storeRoot, input.storeId);
    if (!hasPlanningShape) {
      problems.push(`Source ${sourcePath} has no planning shape (no rasen/specs or rasen/changes).`);
    }
    if (pointer.value !== undefined) {
      problems.push(
        `Source already declares store pointer '${pointer.value}'. Use 'rasen store eject' or 'rasen store doctor' instead.`
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
  const specNames = unionSorted(existingEntry?.specs ?? [], sourceSpecs);
  const changeNames = unionSorted(existingEntry?.changes ?? [], sourceChanges);

  // Uncommitted detection for the moved paths (warning only).
  const movedScopes = [
    path.join(WORKSPACE_DIR_NAME, 'specs'),
    path.join(WORKSPACE_DIR_NAME, 'changes'),
  ];
  const uncommitted = await detectUncommittedPaths(sourcePath, movedScopes);

  let archiveMoves: ArchiveMove[] = [];

  if (!input.dryRun) {
    // 1. add-project semantics (project namespace + store reference) while the
    //    source still has planning shape (register requires a healthy, non-
    //    pointer root). Idempotent; tolerate an already-present registration.
    try {
      await storeAddProject({ projectPath: sourcePath, targetStoreId: input.storeId });
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

    // 2. Manifest BEFORE any source deletion (Blocker/finding #1, design D2 /
    //    spec "Manifest written before source deletion"): a crash mid-move then
    //    leaves the entry already present, so a rerun takes the resume path and
    //    completes idempotently instead of failing the collision precheck on
    //    the names it already moved. Preserves the original timestamp/sourcePath
    //    on resume; records the full union name set.
    const entry: AdoptionEntry = {
      specs: specNames,
      changes: changeNames,
      sourcePath: existingEntry?.sourcePath ?? sourcePath,
      timestamp: existingEntry?.timestamp ?? nowIso(),
    };
    await upsertAdoptionEntry(storeRoot, projectId, entry);

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

    // 4. Archive handling per --archive.
    archiveMoves = await handleAdoptArchive(sourcePath, storeRoot, archiveMode, {
      ...storeOpts,
      ...(input.verifyHash ? { verifyHash: true } : {}),
    });

    // 5. Remove now-empty planning dirs and write the store pointer.
    await removeIfEmpty(specsDir(sourcePath));
    if (archiveMode !== 'leave') {
      await removeIfEmpty(inRepoArchiveDir(sourcePath));
    }
    await removeIfEmpty(changesDir(sourcePath));
    updateProjectConfigKey(sourcePath, 'store', input.storeId);

    // 6. Refresh the machine registry so mode flips to `store` now.
    await registerProject({ projectRoot: sourcePath, projectId, mode: 'store' }, storeOpts);
  }

  const suggestedCommits: SuggestedGitCommand[] = [];
  const sourceCommit = renderSuggestedCommit(
    sourcePath,
    [WORKSPACE_DIR_NAME],
    `chore: adopt planning into store ${input.storeId}`,
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
    storeId: input.storeId,
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
  const sourceArchive = inRepoArchiveDir(sourcePath);
  if (mode === 'leave') {
    return [];
  }
  if (mode === 'move') {
    return moveArchiveEntries([sourceArchive], inRepoArchiveDir(storeRoot), options);
  }
  // external: relocate to the machine home archive + set destination external.
  const home = await resolveProjectHome(sourcePath, {
    ensure: true,
    ...(options.globalDataDir ? { globalDataDir: options.globalDataDir } : {}),
  });
  if (!home) {
    throw new StoreError(
      'Could not resolve the machine home for --archive external.',
      'adopt_external_archive_unresolved',
      { target: 'project.registry', fix: 'Retry, or use --archive move.' }
    );
  }
  const moves = await moveArchiveEntries([sourceArchive], home.archiveDir, options);
  updateProjectConfigKey(sourcePath, 'archive.destination', 'external');
  return moves;
}

// -----------------------------------------------------------------------------
// store eject (design D4)
// -----------------------------------------------------------------------------

export interface EjectInput extends StorePathOptions, ProjectPathOptions {
  projectId: string;
  storeId: string;
  /** Manifest-less full copy back. */
  all?: boolean;
  /** Proceed past missing manifest-listed files, reporting the gaps. */
  force?: boolean;
  dryRun?: boolean;
  verifyHash?: boolean;
  /** The repo to restore into; defaults to the manifest's recorded sourcePath. */
  destinationPath?: string;
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
  const entry = await readAdoptionEntry(storeRoot, input.projectId);

  let specNames: string[];
  let changeNames: string[];
  let destinationPath: string;
  const usedAll = !entry;

  if (entry) {
    specNames = entry.specs;
    changeNames = entry.changes;
    destinationPath = input.destinationPath ?? entry.sourcePath;
  } else {
    if (!input.all) {
      throw new StoreError(
        `No adoption manifest entry for project '${input.projectId}' in store '${input.storeId}'.`,
        'eject_manifest_missing',
        {
          target: 'store.metadata',
          fix: 'Pass --all to copy the entire store planning content back (with confirmation).',
        }
      );
    }
    if (!input.destinationPath) {
      throw new StoreError(
        'A destination path is required for --all eject (no manifest source to infer it from).',
        'eject_destination_required',
        { target: 'store.root', fix: 'Pass the repo path to restore into.' }
      );
    }
    specNames = await listSpecNames(storeRoot);
    changeNames = await listActiveChangeNames(storeRoot);
    destinationPath = path.resolve(input.destinationPath);
  }

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
    if (readStorePointer(destinationPath).value !== undefined) {
      updateProjectConfigKey(destinationPath, 'store', undefined);
    }
    if (entry) {
      await removeAdoptionEntry(storeRoot, input.projectId);
    }
    const projectId = await ensureProjectIdInConfig(destinationPath, storeOpts);
    await registerProject({ projectRoot: destinationPath, projectId, mode: 'in-repo' }, storeOpts);
  }

  const suggestedCommits: SuggestedGitCommand[] = [];
  const destCommit = renderSuggestedCommit(
    destinationPath,
    ['rasen'],
    `chore: eject planning from store ${input.storeId}`,
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
    storeId: input.storeId,
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

export type RelocateTarget = 'in-repo' | 'external' | 'store';

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
  destinationValue: ArchiveDestination;
  dryRun: boolean;
}

/**
 * Moves existing archived changes to `--to` and flips `archive.destination`
 * in the same operation (spec archive-relocate). Enumerates from every current
 * location (repo, machine home, store archive) so a split archive consolidates.
 */
export async function relocateArchive(input: RelocateInput): Promise<RelocateResult> {
  if ((input.to as string) === 'prune') {
    throw new StoreError(
      "`archive relocate --to prune` is not supported.",
      'relocate_prune_rejected',
      {
        target: 'archive.destination',
        fix: 'Use `rasen config set archive.destination prune` and its confirmation flow.',
      }
    );
  }

  const projectRoot = path.resolve(FileSystemUtils.canonicalizeExistingPath(input.projectRoot));
  const storeOpts: StorePathOptions = input.globalDataDir ? { globalDataDir: input.globalDataDir } : {};
  const pointer = readStorePointer(projectRoot);
  const isStoreMode = pointer.value !== undefined && !classifyOpenSpecDir(projectRoot).hasPlanningShape;

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
  if (pointer.value !== undefined) {
    try {
      const store = await resolveRegisteredStore({ id: pointer.value, ...storeOpts });
      storeRoot = store.storeRoot;
      sources.add(inRepoArchiveDir(storeRoot));
    } catch {
      /* pointer to unregistered store: doctor's problem, not relocate's */
    }
  }

  // Resolve the target dir.
  let targetDir: string;
  let destinationValue: ArchiveDestination;
  if (input.to === 'in-repo') {
    targetDir = inRepoArchiveDir(projectRoot);
    destinationValue = 'in-repo';
  } else if (input.to === 'external') {
    // A dry run must be fully inert (finding #6): never mint/register a machine
    // home. Probe only; when the project has no home yet, report a symbolic
    // target rather than creating the home directory tree.
    const ensuredHome = await resolveProjectHome(projectRoot, {
      ensure: !input.dryRun,
      ...(input.globalDataDir ? { globalDataDir: input.globalDataDir } : {}),
    });
    if (!ensuredHome && !input.dryRun) {
      throw new StoreError('Could not resolve the machine home for --to external.', 'relocate_home_unresolved', {
        target: 'project.registry',
        fix: 'Retry the command.',
      });
    }
    targetDir =
      ensuredHome?.archiveDir ??
      home?.archiveDir ??
      path.join(getProjectsDir(storeOpts), '<project-home>', 'archive');
    destinationValue = 'external';
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
    // 'store' is not a config enum value; store-mode archives resolve in-repo
    // (to the store's own tree), so the config records `in-repo`.
    destinationValue = 'in-repo';
  }

  const moves = await moveArchiveEntries([...sources], targetDir, {
    ...storeOpts,
    ...(input.verifyHash ? { verifyHash: true } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
  });

  if (!input.dryRun) {
    updateProjectConfigKey(projectRoot, 'archive.destination', destinationValue);
  }

  return { to: input.to, targetDir, moves, destinationValue, dryRun: !!input.dryRun };
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

  if (pointer.value !== undefined) {
    const registry = await readStoreRegistryState(options);
    const registered = registry
      ? listStoreRegistryEntries(registry).some(
          (entry) => entry.type === 'store' && entry.id === pointer.value
        )
      : false;
    if (!registered) {
      diagnostics.push(
        makeStoreDiagnostic(
          'error',
          'drift_pointer_unregistered',
          `Config declares store pointer '${pointer.value}', but no store with that id is registered.`,
          {
            target: 'store.pointer',
            fix: `Run 'rasen store register' for '${pointer.value}', or correct the store: pointer.`,
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

    // Manifest drift, when the pointer targets a registered store.
    if (registered) {
      try {
        const store = await resolveRegisteredStore({ id: pointer.value, ...options });
        const config = readProjectConfig(projectRoot);
        const projectId = config?.projectId;
        if (projectId) {
          const entry = await readAdoptionEntry(store.storeRoot, projectId);
          if (entry) {
            const [storeSpecs, storeChanges] = await Promise.all([
              listSpecNames(store.storeRoot),
              listActiveChangeNames(store.storeRoot),
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
