import { execFile } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { FileSystemUtils } from '../../utils/file-system.js';
import { WORKSPACE_DIR_NAME } from '../config.js';
import {
  appendStoreReference,
  classifyOpenSpecDir,
  describeStoreDeclaration,
  ensureProjectIdInConfig,
  hasStoreDeclaration,
  readProjectConfig,
  readStorePointer,
  resolveConfigFilePath,
  storePointerProblem,
  updateProjectConfigKey,
} from '../project-config.js';
import { storeBindingDeclarationFrom } from '../effective-config.js';
import {
  ANCHORED_WORKSPACE_DIRS,
  DIRECTORY_ANCHOR_FILE_NAME,
  WORKSPACE_ROOT_DIR,
  ensureOpenSpecRoot,
  inspectOpenSpecRoot,
  rollbackCreatedPaths,
  type CreatedPathLedgerEntry,
  type OpenSpecRootInspection,
} from '../workspace-root.js';
import {
  STORE_METADATA_DIR_NAME,
  findRegistryEntryKeys,
  getStoreMetadataDir,
  getStoreMetadataPath,
  getStoreRegistryPath,
  listStoreRegistryEntries,
  readStoreRegistryState,
  readOptionalStoreMetadataState,
  resolveGitStoreBackendConfig,
  storeMetadataUid,
  validateStoreId,
  validateStoreSelector,
  writeStoreMetadataState,
  type RegistryEntryType,
  type StoreGitBackendConfig,
  type StorePathOptions,
  type StoreRegistryEntry,
  type StoreRegistryState,
} from './foundation.js';
import {
  isAllDigitAlias,
  isValidStoreUid,
  mintStoreUid,
  storeUidsMatch,
} from './identity-types.js';
import {
  describeStore,
  storeAliasAmbiguous,
  storeAliasNumeric,
  storeAliasRepeated,
  storeMetadataLegacy,
  storeRegistryRekeyBlocked,
  storeRemoteDivergence,
} from './identity-diagnostics.js';
import {
  assertCredentialFreeRemote,
  redactOptionalRemote,
  remoteCarriesCredentials,
} from './remote.js';
import { resolveStoreBinding } from './identity.js';
import type { ResolvedStoreRef } from './identity-types.js';
import {
  applyMembershipMutation,
  listStoreMembers,
  planMembershipMutation,
  unambiguousStoreSelector,
  type MembershipRepair,
} from './membership.js';
import {
  getStoreProjectRecordsDir,
  type StoreProjectRoles,
} from './project-records.js';
import type { SuggestedGitCommand } from './migration.js';
import { writeDurablePointer } from './upgrade-identity.js';
import { StoreError, type StoreDiagnostic, makeStoreDiagnostic } from './errors.js';
import {
  assertGitCommitIdentity,
  commitStoreFiles,
  gitDirectoryHasTrackedFiles,
  gitHasCommits,
  gitHasRemote,
  gitHasUncommittedChanges,
  gitOriginUrl,
  initGitRepository,
  isGitRepositoryAtRoot,
} from './git.js';
import {
  getStoreRootForBackend,
  assertNoRegisteredStoreConflict,
  commitStoreRegistration,
  getRegisteredStore,
  listRegisteredStores,
  resolveRegisteredStore,
  unregisterStoreRegistration,
} from './registry.js';

const fs = nodeFs.promises;
const execFilePromise = promisify(execFile);
// Route every git spawn through here so `windowsHide` is always set — no
// console window flashes when a console-less parent runs a git probe
// (windows-process-launch spec; mirrors store/git.ts:24).
function execFileAsync(
  file: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFilePromise(file, args, { ...options, windowsHide: true });
}

type PathKind = 'missing' | 'directory' | 'file' | 'other';

export interface StoreInfo {
  id: string;
  root: string;
  metadataPath?: string;
  /** The store's permanent identity; absent for legacy metadata. */
  uid?: string;
}

export interface StoreMutationResult {
  store: StoreInfo;
  /** Clone-source knowledge for human sharing guidance; never in JSON. */
  remotes?: {
    canonical?: string;
    observed?: string;
  };
  registryCommit: {
    path: string;
    registered: boolean;
    alreadyRegistered: boolean;
  };
  git: {
    isRepository: boolean;
    initialized: boolean;
    committed: boolean;
  };
  createdArtifacts: string[];
  diagnostics: StoreDiagnostic[];
}

export interface StoreCleanupResult {
  store: StoreInfo;
  registryCommit: {
    path: string;
    removed: boolean;
  };
  files: {
    deleted: boolean;
    deletedPath?: string;
    leftOnDisk?: string;
  };
  diagnostics: StoreDiagnostic[];
}

export interface StoreListEntry extends StoreInfo {
  type: RegistryEntryType;
}

/** Registry-entry shape shared by the list and doctor surfaces. */
export interface StoreRegistryRow {
  id: string;
  type: RegistryEntryType;
  uid?: string;
  backend: StoreGitBackendConfig;
}

export interface StoreListResult {
  stores: StoreListEntry[];
}

export interface StoreDoctorResult {
  stores: StoreInspection[];
  diagnostics: StoreDiagnostic[];
}

export interface StoreInspection extends StoreInfo {
  type: RegistryEntryType;
  openspecRoot: OpenSpecRootInspection;
  metadata: {
    present: boolean | null;
    valid: boolean | null;
    id?: string;
    /** The store's permanent identity; absent for legacy metadata. */
    uid?: string;
    /** True when the metadata predates permanent identities. */
    legacy?: boolean;
    /** Canonical clone source from store.yaml, redacted; null when absent. */
    remote: string | null;
  };
  git: {
    isRepository: boolean | null;
    hasCommits: boolean | null;
    hasUncommittedChanges: boolean | null;
    hasRemote: boolean | null;
    /** Observed origin URL, live-probed; null when none. */
    originUrl: string | null;
  };
  diagnostics: StoreDiagnostic[];
}

export interface SetupStoreInput {
  id?: string;
  path?: string;
  initGit?: boolean;
  allowInsideGitRepository?: boolean;
  /** Canonical clone source written into store.yaml (slice 3.3). */
  remote?: string;
}

export interface RegisterExistingStoreInput extends StorePathOptions {
  path?: string;
  id?: string;
  allowCreateIdentity?: boolean;
  /** Registry namespace to register into; absent means store. */
  type?: RegistryEntryType;
}

export interface StoreAddProjectInput {
  projectPath: string;
  targetStoreId: string;
  /** Explicit project store id override (design D2); ignored when the
   *  project already carries `.rasen-store/store.yaml`. */
  id?: string;
  /**
   * Record the target Store as the project's PLANNING store as well as adding
   * it to the roster.
   *
   * Opt-in and default-off, and never inferred — not from another flag, not
   * from the project's state, not from this being the project's only
   * membership. Membership and planning binding are different relations, and
   * silently rebinding where a project plans would re-merge the two this
   * change exists to separate. When a DIFFERENT Store is already bound the
   * command refuses rather than overwriting; the refusal is scoped to the
   * pointer, so the membership this invocation established still stands.
   */
  setPrimary?: boolean;
  /**
   * Roles this membership asserts, overriding the ones `add-project` derives
   * for itself. Exists for COMPOSING callers only — `store adopt` runs
   * add-project's registration and reference work, but an adoption proves
   * planning membership and proves nothing about knowledge (design D2).
   *
   * Without this, adopt inherited add-project's `knowledge: true`, roles were
   * OR-widened on write, and a plain adopt durably recorded a knowledge role
   * nobody established. The OR-widening rule is right — every command here
   * adds a role and none removes one — so the composition is what had to
   * change. The `add-project` CLI never passes it.
   */
  roles?: StoreProjectRoles;
  /** Report every file that would be written, in each repository, and write nothing. */
  dryRun?: boolean;
}

/** What the `--set-primary` opt-in did, reported separately from membership. */
export interface StoreAddProjectPlanningBinding {
  /** True when the user asked for the binding at all. */
  requested: boolean;
  /** True when this run wrote the project's planning Store. */
  changed: boolean;
  /** True when a different Store was already bound and the write was refused. */
  refused: boolean;
  /** True when the project already planned in the target Store. */
  alreadyBound: boolean;
  /** The Store the project plans in now (or still plans in, after a refusal). */
  boundTo?: string;
  /**
   * Permanent identity of `boundTo`, when it resolved. Two Stores are allowed
   * to share a display name, so a refusal that names only the name reads
   * "plans in 'team-store', not 'team-store'" — which tells the user nothing.
   * Both sides carry their identity so the message can tell them apart.
   */
  boundToUid?: string;
  /** The Store the user asked to bind. */
  requestedStore: string;
  /** Permanent identity of `requestedStore`, when it has one. */
  requestedStoreUid?: string;
  /** Printed on a refusal: the command that rebinds deliberately. */
  rebindCommand?: string;
}

/** The membership half of the result, reported per repository. */
export interface StoreAddProjectMembership {
  projectId: string | null;
  roles: StoreProjectRoles;
  projectBaseCommit: string | null;
  storeBaseCommit: string | null;
  /** Absolute paths written (or, in a preview, that would be written). */
  projectWrites: string[];
  storeWrites: string[];
  recordWritten: boolean;
  hintWritten: boolean;
  repairNeeded: MembershipRepair[];
  suggestedCommits: SuggestedGitCommand[];
}

export interface StoreAddProjectResult {
  project: {
    id: string;
    root: string;
    /** True when `.rasen-store/store.yaml` was created by this run. */
    metadataCreated: boolean;
    alreadyRegistered: boolean;
  };
  target: {
    id: string;
    root: string;
    configPath: string;
    referenceAdded: boolean;
    referenceAlreadyPresent: boolean;
  };
  membership: StoreAddProjectMembership;
  planningBinding: StoreAddProjectPlanningBinding;
  /** True when this run previewed only and wrote nothing. */
  dryRun: boolean;
  diagnostics: StoreDiagnostic[];
}

export interface CleanupStoreInput extends StorePathOptions {
  id: string;
  /** Registry namespace to clean up; absent means store (compat default). */
  type?: RegistryEntryType;
}

export interface PreparedStoreCleanup extends StoreInfo, StorePathOptions {
  backend: StoreGitBackendConfig;
  type: RegistryEntryType;
  /**
   * What the user named — a display alias or a permanent identity. Carried
   * through to the removal so it resolves the SAME entry: a display alias that
   * matches two Stores resolves here only because an identity was given, and
   * re-resolving by the entry's alias afterwards would be ambiguous again.
   */
  selector: string;
}

export interface PreparedStoreSetup {
  id: string;
  root: string;
  rootKind: Extract<PathKind, 'missing' | 'directory'>;
  backend?: StoreGitBackendConfig;
  registry: StoreRegistryState | null;
  remote?: string;
}

interface StoreSetupPlan {
  id: string;
  storeRoot: string;
  kind: Extract<PathKind, 'missing' | 'directory'>;
  backend?: StoreGitBackendConfig;
  registry: StoreRegistryState | null;
}

async function pathKind(targetPath: string): Promise<PathKind> {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
    return 'other';
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return 'missing';
    }
    throw error;
  }
}

async function isDirectoryEmpty(directory: string): Promise<boolean> {
  return (await fs.readdir(directory)).length === 0;
}

async function readStoreMetadataForOperation(storeRoot: string) {
  try {
    return await readOptionalStoreMetadataState(storeRoot);
  } catch (error) {
    throw new StoreError(
      error instanceof Error ? error.message : String(error),
      'invalid_store_metadata',
      {
        target: 'store.metadata',
        fix: `Repair ${getStoreMetadataPath(storeRoot)}.`,
      }
    );
  }
}

async function isGitOnlyDirectory(storeRoot: string): Promise<boolean> {
  const entries = await fs.readdir(storeRoot);
  return entries.length === 1 && entries[0] === '.git' && await isGitRepositoryAtRoot(storeRoot);
}

function alreadyRegisteredDiagnostic(
  id: string,
  type: RegistryEntryType = 'store'
): StoreDiagnostic {
  const noun = type === 'project' ? 'Project' : 'Store';
  return makeStoreDiagnostic(
    'info',
    'store_already_registered',
    `${noun} '${id}' is already registered at this path.`,
    {
      target: 'store.registry',
    }
  );
}

function assertNotConfigOnlyPointerRoot(storeRoot: string): void {
  const { hasPlanningShape, pointer } = classifyOpenSpecDir(storeRoot);
  if (hasPlanningShape || pointer.filePath === null) return;

  if (pointer.malformed) {
    throw new StoreError(
      `The store declaration in ${pointer.filePath} is invalid (${storePointerProblem(pointer.malformed)}).`,
      'invalid_store_pointer',
      {
        target: 'store.pointer',
        fix: `Fix or remove the store: line in ${pointer.filePath} before registering this path as a store.`,
      }
    );
  }

  if (hasStoreDeclaration(pointer)) {
    throw new StoreError(
      `This repo's planning is externalized to store '${describeStoreDeclaration(pointer)}' (${pointer.filePath}); it is not itself a store root.`,
      'store_root_pointer_declared',
      {
        target: 'store.pointer',
        fix: 'Register the checkout for the declared store, or remove the store: line first to convert this repo into a local store root.',
      }
    );
  }
}

function createdPath(relativePath: string, absolutePath: string, kind: CreatedPathLedgerEntry['kind']): CreatedPathLedgerEntry {
  return {
    relativePath,
    absolutePath,
    kind,
  };
}

async function nearestExistingDirectory(targetPath: string): Promise<string | null> {
  let current = path.resolve(targetPath);

  while (true) {
    const kind = await pathKind(current);
    if (kind === 'directory') return current;
    if (kind !== 'missing') return null;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function findContainingGitRepositoryRoot(storeRoot: string): Promise<string | null> {
  const resolvedStoreRoot = path.resolve(storeRoot);
  const nearestParent = await nearestExistingDirectory(path.dirname(resolvedStoreRoot));
  if (!nearestParent) return null;
  const comparableStoreRoot = path.resolve(
    FileSystemUtils.canonicalizeExistingPath(nearestParent),
    path.relative(nearestParent, resolvedStoreRoot)
  );

  const gitRootContainsStore = (gitRoot: string): string | null => {
    const normalizedGitRoot = FileSystemUtils.canonicalizeExistingPath(gitRoot);
    const relative = path.relative(normalizedGitRoot, comparableStoreRoot);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? normalizedGitRoot
      : null;
  };

  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      nearestParent,
      'rev-parse',
      '--show-toplevel',
    ]);
    return gitRootContainsStore(stdout.trim());
  } catch {
    let current = nearestParent;
    while (true) {
      if (await isGitRepositoryAtRoot(current)) {
        return gitRootContainsStore(current);
      }

      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function assertSetupPathIsNotNestedInGitRepo(
  storeRoot: string,
  options: { allowInsideGitRepository?: boolean }
): Promise<void> {
  if (options.allowInsideGitRepository) return;

  const containingGitRoot = await findContainingGitRepositoryRoot(storeRoot);
  if (!containingGitRoot) return;

  throw new StoreError(
    `Store setup path is inside another Git repository: ${containingGitRoot}`,
    'store_setup_inside_git_repo',
    {
      target: 'store.root',
      fix: 'Choose a path outside that Git repository.',
    }
  );
}

export function expandUserPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return trimmed;
}

function resolveSetupRoot(id: string, inputPath: string | undefined): string {
  // A store is a repo the user places; setup never silently picks app data.
  if (inputPath === undefined || inputPath.trim().length === 0) {
    throw new StoreError(
      'Pass --path with the folder where this store should live.',
      'store_setup_path_required',
      {
        target: 'store.root',
        fix: `rasen store setup ${id} --path ~/openspec/${id}`,
      }
    );
  }

  return path.resolve(expandUserPath(inputPath));
}

function resolveRegisterRoot(inputPath: string | undefined): string {
  if (inputPath === undefined || inputPath.trim().length === 0) {
    throw new StoreError('Pass a store path.', 'store_path_required', {
      target: 'store.root',
      fix: 'rasen store register /path/to/store',
    });
  }

  return path.resolve(expandUserPath(inputPath));
}

function inferStoreIdFromPath(storeRoot: string): string {
  return validateStoreId(path.basename(storeRoot));
}

function normalizeRegistryPathForComparison(targetPath: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isRegisteredAtPath(
  registry: StoreRegistryState | null,
  id: string,
  storeRoot: string,
  type: RegistryEntryType = 'store'
): boolean {
  return findRegistryEntryKeys(registry, type, id).some(
    (match) =>
      normalizeRegistryPathForComparison(getStoreRootForBackend(match.entry.backend)) ===
      normalizeRegistryPathForComparison(storeRoot)
  );
}

function mutationPayload(
  id: string,
  storeRoot: string,
  git: { isRepository: boolean; initialized: boolean; committed: boolean },
  createdFiles: string[],
  registry: { registered: boolean; alreadyRegistered: boolean },
  diagnostics: StoreDiagnostic[] = [],
  remotes?: { canonical?: string; observed?: string },
  pathOptions: StorePathOptions = {}
): StoreMutationResult {
  return {
    store: {
      id,
      root: storeRoot,
      metadataPath: getStoreMetadataPath(storeRoot),
    },
    ...(remotes && (remotes.canonical || remotes.observed) ? { remotes } : {}),
    registryCommit: {
      path: getStoreRegistryPath(pathOptions),
      registered: registry.registered,
      alreadyRegistered: registry.alreadyRegistered,
    },
    git: {
      isRepository: git.isRepository,
      initialized: git.initialized,
      committed: git.committed,
    },
    createdArtifacts: createdFiles,
    diagnostics,
  };
}



function remoteRequiresHandEditError(id: string, storeRoot: string): StoreError {
  return new StoreError(
    `Store '${id}' already has an identity file; --remote cannot change it.`,
    'store_remote_requires_hand_edit',
    {
      target: 'store.metadata',
      fix: `Edit ${getStoreMetadataPath(storeRoot)} and commit it.`,
    }
  );
}

/**
 * Backend config carrying the observed origin. Guarded by an at-root
 * repository check: `git -C` discovers repositories by walking UP the
 * tree, so probing a non-repo store folder nested inside another repo
 * would record the ENCLOSING repo's origin.
 */
async function resolveBackendWithObservedOrigin(
  storeRoot: string
): Promise<StoreGitBackendConfig> {
  const origin = (await isGitRepositoryAtRoot(storeRoot))
    ? await gitOriginUrl(storeRoot)
    : null;
  return resolveGitStoreBackendConfig({
    localPath: storeRoot,
    ...(origin ? { remote: origin } : {}),
  });
}

async function prepareSetupPlan(
  input: Pick<SetupStoreInput, 'id' | 'path' | 'allowInsideGitRepository' | 'remote'>
): Promise<StoreSetupPlan> {
  const id = validateStoreId(input.id ?? '');
  if (input.remote !== undefined && input.remote.length === 0) {
    throw new StoreError('Store remote must not be empty when provided.', 'store_remote_empty', {
      target: 'store.metadata',
      fix: 'Pass a clone URL: --remote <url>.',
    });
  }
  // Rejected before any directory is touched, and never echoed back in full.
  assertCredentialFreeRemote(input.remote);
  const storeRoot = resolveSetupRoot(id, input.path);
  const kind = await pathKind(storeRoot);

  if (kind === 'file' || kind === 'other') {
    throw new StoreError(
      `Store setup path is not a directory: ${storeRoot}`,
      'store_setup_path_not_directory',
      {
        target: 'store.root',
        fix: 'Choose an empty directory or an existing healthy Rasen root.',
      }
    );
  }

  // Stores may be Git-backed, but creating one inside an implementation
  // repo is almost always an accidental nested-repo setup.
  await assertSetupPathIsNotNestedInGitRepo(storeRoot, {
    allowInsideGitRepository: input.allowInsideGitRepository,
  });

  let metadata: Awaited<ReturnType<typeof readStoreMetadataForOperation>> = null;
  let backend: StoreGitBackendConfig | undefined;

  if (kind === 'directory') {
    assertNotConfigOnlyPointerRoot(storeRoot);
    metadata = await readStoreMetadataForOperation(storeRoot);

    if (metadata) {
      if (metadata.id !== id) {
        throw new StoreError(
          `Store metadata id '${metadata.id}' does not match requested id '${id}'.`,
          'store_metadata_id_mismatch',
          {
            target: 'store.metadata',
            fix: `Use id '${metadata.id}' or choose a different setup path.`,
          }
        );
      }
      if (input.remote !== undefined) {
        // Silent acceptance is the forbidden outcome: the identity file
        // already exists, so --remote cannot reach the committed shape.
        throw remoteRequiresHandEditError(id, storeRoot);
      }
    } else {
      const openspecRoot = await inspectOpenSpecRoot(storeRoot);
      const safeFreshDirectory = await isDirectoryEmpty(storeRoot) || await isGitOnlyDirectory(storeRoot);
      if (!openspecRoot.healthy && !safeFreshDirectory) {
        throw new StoreError(
          'Store setup does not support initializing a non-empty folder that is not a healthy Rasen root.',
          'store_setup_non_empty_directory',
          {
            target: 'store.root',
            fix: 'Choose an empty folder, a Git-only folder, or an existing healthy Rasen root.',
          }
        );
      }
    }

    backend = await resolveBackendWithObservedOrigin(storeRoot);
  }

  const registry = await readStoreRegistryState();
  const conflictBackend = backend ?? {
    type: 'git' as const,
    local_path: FileSystemUtils.canonicalizeExistingPath(storeRoot),
  };

  assertNoRegisteredStoreConflict(registry, 'store', id, conflictBackend);

  return {
    id,
    storeRoot,
    kind,
    registry,
    ...(backend ? { backend } : {}),
  };
}

/**
 * Resolves the effective Git mode for a prepared setup: on by default for new
 * stores, off for reruns of an already-registered store (which must stay
 * no-ops), and always honoring an explicit --init-git/--no-init-git.
 */
export function resolveSetupGitEnabled(
  prepared: PreparedStoreSetup,
  initGit?: boolean
): boolean {
  return initGit ?? !isRegisteredAtPath(prepared.registry, prepared.id, prepared.root);
}

export async function prepareStoreSetup(
  input: Pick<SetupStoreInput, 'id' | 'path' | 'allowInsideGitRepository' | 'remote'>
): Promise<PreparedStoreSetup> {
  const plan = await prepareSetupPlan(input);

  return {
    id: plan.id,
    root: plan.storeRoot,
    rootKind: plan.kind,
    registry: plan.registry,
    ...(plan.backend ? { backend: plan.backend } : {}),
    ...(input.remote !== undefined ? { remote: input.remote } : {}),
  };
}

export async function setupPreparedStore(
  prepared: PreparedStoreSetup,
  input: Pick<SetupStoreInput, 'initGit'> = {}
): Promise<StoreMutationResult> {
  const plan: StoreSetupPlan = {
    id: prepared.id,
    storeRoot: prepared.root,
    kind: prepared.rootKind,
    registry: prepared.registry,
    ...(prepared.backend ? { backend: prepared.backend } : {}),
  };
  const { id, storeRoot, kind, registry } = plan;
  let { backend } = plan;

  // The prepare/execute split can span an unbounded interactive
  // confirmation. Re-assert the prepare-time directory facts: if the
  // path appeared in the gap, the plan (and its rollback policy) no
  // longer describes reality - refuse and let a rerun re-prepare.
  if (kind === 'missing' && (await fs.access(storeRoot).then(() => true, () => false))) {
    throw new StoreError(
      `The path ${storeRoot} was created while setup was waiting for confirmation.`,
      'store_setup_path_changed',
      {
        target: 'store.root',
        fix: 'Rerun rasen store setup to re-evaluate the directory.',
      }
    );
  }

  const createdFiles: string[] = [];
  let createdPaths: CreatedPathLedgerEntry[] = [];
  let gitInitialized = false;
  let committed = false;
  let mintedUid: string | undefined;

  // Reruns for an already-registered store stay strict no-ops: no anchor
  // retrofit, no git init, no new commit, no identity requirement. Only an
  // explicit --init-git overrides that for the git side.
  const alreadyRegisteredHere = isRegisteredAtPath(registry, id, storeRoot);

  // --no-init-git opts out of every Git action: no preflight, no init, no
  // commit, even when the target is already a repository.
  const gitEnabled = input.initGit ?? !alreadyRegisteredHere;
  const repoExisted = await isGitRepositoryAtRoot(storeRoot);

  // Identity preflight runs before anything is created so a missing identity
  // never leaves half-made state behind.
  if (gitEnabled) {
    await assertGitCommitIdentity(
      (await nearestExistingDirectory(storeRoot)) ?? process.cwd()
    );
  }

  try {
    const root = await ensureOpenSpecRoot(storeRoot, {
      anchorEmptyDirectories: !alreadyRegisteredHere,
    });
    createdFiles.push(...root.createdArtifacts);
    createdPaths = root.createdPaths;
    backend ??= await resolveBackendWithObservedOrigin(storeRoot);
    assertNoRegisteredStoreConflict(registry, 'store', id, backend);

    // The identity file is written before the initial commit so clones carry
    // it; without it, register falls back to the conversion prompt.
    const existingMetadata = await readStoreMetadataForOperation(storeRoot);
    if (existingMetadata && prepared.remote !== undefined) {
      // Re-assert the prepare-phase refusal: metadata that materialized
      // between prepare and execute must not silently swallow --remote.
      throw remoteRequiresHandEditError(id, storeRoot);
    }
    if (!existingMetadata) {
      const metadataDir = getStoreMetadataDir(storeRoot);
      const metadataDirMissing = (await pathKind(metadataDir)) === 'missing';
      // Creating a store mints its permanent identity — once, automatically,
      // and never from user input (design D2's only v2 metadata writer).
      mintedUid = mintStoreUid();
      await writeStoreMetadataState(storeRoot, {
        version: 2,
        uid: mintedUid,
        id,
        ...(prepared.remote !== undefined ? { remote: prepared.remote } : {}),
      });
      if (metadataDirMissing) {
        createdPaths.push(createdPath('.rasen-store/', metadataDir, 'directory'));
      }
      createdPaths.push(createdPath(
        '.rasen-store/store.yaml',
        getStoreMetadataPath(storeRoot),
        'file'
      ));
      createdFiles.push('.rasen-store/store.yaml');
    }

    gitInitialized = gitEnabled ? await initGitRepository(storeRoot) : false;
    const isRepository = gitInitialized || repoExisted;
    // "Files created for rollback" and "files a clone needs" are different
    // sets: when setup initialized the repository itself, the initial commit
    // must contain the full store shape or clones of a converted root would
    // be unhealthy. In a pre-existing repo the user owns the history, so
    // setup commits only what it created.
    const commitPathspecs = gitInitialized
      ? [WORKSPACE_ROOT_DIR, STORE_METADATA_DIR_NAME]
      : createdPaths
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.relativePath);
    committed = gitEnabled && isRepository
      ? await commitStoreFiles(storeRoot, id, commitPathspecs)
      : false;

    // Identity creation is setup's job (done above, before the commit);
    // registration only verifies it and records the machine-local entry.
    const registered = await commitStoreRegistration({
      id,
      backend,
      writeMetadataIfMissing: false,
    });
    const diagnostics: StoreDiagnostic[] = [...registered.diagnostics];
    if (registered.alreadyRegistered && createdFiles.length === 0) {
      diagnostics.push(alreadyRegisteredDiagnostic(id));
    }
    // A newly assigned all-digit alias warns; aliases already on disk stay
    // quiet, because the resolution behavior is unchanged either way (D10).
    if (mintedUid !== undefined && isAllDigitAlias(id)) {
      diagnostics.push(storeAliasNumeric({ id }));
    }

    const canonical = prepared.remote ?? existingMetadata?.remote;
    return mutationPayload(id, registered.storeRoot, {
      isRepository,
      initialized: gitInitialized,
      committed,
    }, createdFiles, {
      registered: registered.registryUpdated,
      alreadyRegistered: registered.alreadyRegistered,
    }, diagnostics, {
      ...(canonical ? { canonical } : {}),
      ...(backend.remote ? { observed: backend.remote } : {}),
    });
  } catch (error) {
    // Once the initial commit landed in a (possibly user-owned) repository,
    // the files are durable state; deleting them would orphan the commit.
    // The only remaining failure is the registry write, which is retryable.
    if (committed) {
      throw error;
    }

    if (createdPaths.length > 0) {
      await rollbackCreatedPaths(createdPaths);
    }
    // G14: a half-made .git is never durable state pre-commit - clean it
    // up regardless of whether the ledger recorded other creations, or a
    // rerun registers a commitless store.
    if (gitInitialized) {
      await fs.rm(path.join(storeRoot, '.git'), { recursive: true, force: true }).catch(() => undefined);
    }
    if (kind === 'missing') {
      // Non-recursive both ways: never delete content this operation did
      // not create (the execute-time re-check guarantees kind is accurate,
      // but rmdir is the belt to that suspender).
      await fs.rmdir(storeRoot).catch(() => undefined);
    }

    throw error;
  }
}

export async function setupStore(
  input: SetupStoreInput
): Promise<StoreMutationResult> {
  return setupPreparedStore(await prepareStoreSetup(input), {
    initGit: input.initGit,
  });
}

export async function registerExistingStore(
  input: RegisterExistingStoreInput
): Promise<StoreMutationResult> {
  const pathOptions: StorePathOptions =
    input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {};
  const storeRoot = resolveRegisterRoot(input.path);
  const kind = await pathKind(storeRoot);

  if (kind === 'missing') {
    throw new StoreError(
      `Store path does not exist: ${storeRoot}`,
      'store_path_missing',
      {
        target: 'store.root',
        fix: 'Clone or create the store folder before registering it.',
      }
    );
  }

  if (kind !== 'directory') {
    throw new StoreError(
      `Store path is not a directory: ${storeRoot}`,
      'store_path_not_directory',
      {
        target: 'store.root',
        fix: 'Pass an existing store directory.',
      }
    );
  }

  assertNotConfigOnlyPointerRoot(storeRoot);
  const openspecRoot = await inspectOpenSpecRoot(storeRoot);
  if (!openspecRoot.healthy) {
    const problems =
      openspecRoot.diagnostics.map((diagnostic) => diagnostic.message).join(' ') ||
      'The Rasen root is missing or incomplete.';
    const isEmptyCloneSuspect =
      (await isGitRepositoryAtRoot(storeRoot)) &&
      (await gitHasCommits(storeRoot)) === false;
    const emptyCloneHint = isEmptyCloneSuspect
      ? ' This folder is a Git repository with no commits — if it is a clone, the origin store needs an initial commit before the clone has any files.'
      : '';

    throw new StoreError(
      `Store register requires an existing healthy Rasen root. ${problems}${emptyCloneHint}`,
      'store_register_root_unhealthy',
      {
        target: 'openspec.root',
        fix: isEmptyCloneSuspect
          ? 'If this is a store clone: commit and push the origin store, pull it into this clone, then rerun register.'
          : 'Run rasen store setup for a new store, or point register at a checkout whose openspec/ files are present.',
      }
    );
  }

  const type: RegistryEntryType = input.type ?? 'store';
  const metadata = await readStoreMetadataForOperation(storeRoot);
  const explicitId = input.id !== undefined ? validateStoreId(input.id) : undefined;

  if (metadata && explicitId !== undefined && metadata.id !== explicitId) {
    // The fix must account for whether the metadata id is already registered,
    // so following it never lands on the already-registered error.
    const currentRegistry = await readStoreRegistryState(pathOptions);
    const registeredElsewhere =
      findRegistryEntryKeys(currentRegistry, type, metadata.id).length > 0 &&
      !isRegisteredAtPath(currentRegistry, metadata.id, storeRoot, type);

    throw new StoreError(
      `Store metadata id '${metadata.id}' does not match --id '${explicitId}'. The id comes from the store's committed .rasen-store/store.yaml.`,
      'store_metadata_id_mismatch',
      {
        target: 'store.id',
        fix: registeredElsewhere
          ? `One checkout per store id is supported, and '${metadata.id}' is already registered. Run rasen store unregister ${metadata.id} first to register this checkout instead.`
          : `Use --id ${metadata.id} or register a different folder.`,
      }
    );
  }

  const id = metadata?.id ?? explicitId ?? inferStoreIdFromPath(storeRoot);
  if (!metadata && !input.allowCreateIdentity) {
    throw new StoreError(
      `Turn this Rasen root into store '${id}'?`,
      'store_register_identity_confirmation_required',
      {
        target: 'store.metadata',
        fix: `Run interactively or pass --yes to create ${getStoreMetadataPath(storeRoot)}.`,
      }
    );
  }

  const backend = await resolveBackendWithObservedOrigin(storeRoot);
  const registry = await readStoreRegistryState(pathOptions);
  // The checkout's own permanent identity decides what collides: with it, a
  // repeated display name is no longer a conflict (two stores may share one —
  // resolving it is what reports ambiguity), while a SECOND checkout of the
  // same identity still is. Without passing it, that whole rule was
  // unreachable and a repeated alias was refused outright.
  //
  // The bound on legacy data is by construction: `entry.uid` is populated only
  // from a v2 (identity-keyed) registry key, so in a v1 registry every
  // `entry.uid` is undefined, the carve-out cannot fire, and a repeated alias
  // stays refused — which it must, because a v1 registry keys by alias and
  // writing a second entry under that key would silently drop the incumbent.
  const checkoutUid = storeMetadataUid(metadata);
  assertNoRegisteredStoreConflict(registry, type, id, backend, checkoutUid);
  // The other half of that rule: a registration the identities made legal is
  // still a registration that made the display name ambiguous, and the user
  // learns it HERE rather than later from an unrelated command that refuses to
  // resolve the name (store-project-namespace: "SHALL succeed and SHALL warn").
  const aliasTwins =
    checkoutUid === undefined || registry === null
      ? []
      : listStoreRegistryEntries(registry).filter(
          (entry) =>
            entry.type === 'store' &&
            entry.id === id &&
            entry.uid !== undefined &&
            !storeUidsMatch(entry.uid, checkoutUid)
        );
  const createdFiles: string[] = [];
  const isRepository = await isGitRepositoryAtRoot(storeRoot);

  const registered = await commitStoreRegistration({
    id,
    backend,
    writeMetadataIfMissing: true,
    type,
    ...pathOptions,
  });
  if (registered.metadataCreated) {
    createdFiles.push('.rasen-store/store.yaml');
  }
  const diagnostics: StoreDiagnostic[] = [...registered.diagnostics];
  if (registered.alreadyRegistered && createdFiles.length === 0) {
    diagnostics.push(alreadyRegisteredDiagnostic(id, type));
  }
  // The newly-assigned-alias warning (design D10) fires from
  // `commitStoreRegistration`, which is the one place that knows whether this
  // run created the identity file — and it travels here in
  // `registered.diagnostics`. There is no second condition to check: when the
  // metadata is absent, registration writes it and `metadataCreated` is true.
  if (aliasTwins.length > 0 && checkoutUid !== undefined && registered.registryUpdated) {
    diagnostics.push(
      storeAliasRepeated({ id, uid: checkoutUid, matches: aliasTwins.length + 1 })
    );
  }

  // Register never commits; converted roots are the user's repo to commit.
  return mutationPayload(id, registered.storeRoot, {
    isRepository,
    initialized: false,
    committed: false,
  }, createdFiles, {
    registered: registered.registryUpdated,
    alreadyRegistered: registered.alreadyRegistered,
  }, diagnostics, {
    ...(metadata?.remote ? { canonical: metadata.remote } : {}),
    ...(backend.remote ? { observed: backend.remote } : {}),
  }, pathOptions);
}

/**
 * Composes `registerExistingStore` with the references-append helper
 * (design D1): registers the project at `input.projectPath` into the
 * PROJECT namespace on this machine if it is not already one, then appends
 * a `project:<id>` entry to `input.targetStoreId`'s `references:` list. An
 * inferred project id colliding with a store's id is not a conflict — the
 * two namespaces are disjoint. The only write inside the project repo is
 * `.rasen-store/store.yaml` (registerExistingStore's own guarantee); the
 * reference edit lands in the target store's config, never the project's.
 */
export async function storeAddProject(
  input: StoreAddProjectInput
): Promise<StoreAddProjectResult> {
  const projectRoot = resolveRegisterRoot(input.projectPath);
  const canonicalProjectRoot = normalizeRegistryPathForComparison(projectRoot);

  // Peek existing identity to resolve the id per D2 (existing metadata ->
  // explicit id -> folder basename) without writing anything yet; a
  // not-yet-existing or not-yet-a-project project path resolves via the
  // same inference registerExistingStore uses internally.
  const existingMetadata = await readStoreMetadataForOperation(projectRoot);
  const explicitId = input.id !== undefined ? validateStoreId(input.id) : undefined;
  const resolvedProjectId =
    existingMetadata?.id ?? explicitId ?? inferStoreIdFromPath(projectRoot);

  let targetStore;
  try {
    targetStore = await resolveRegisteredStore({ id: input.targetStoreId });
  } catch (error) {
    if (
      error instanceof StoreError &&
      (error.diagnostic.code === 'store_not_found' || error.diagnostic.code === 'no_store_registry')
    ) {
      throw new StoreError(
        // Nothing resolved, so naming what the user typed is the honest
        // report — but the repair must fit what they typed: a permanent
        // identity cannot be handed to `store setup`, which MINTS one.
        `Target store '${input.targetStoreId}' is not registered on this machine.`,
        'store_add_project_target_not_found',
        {
          target: 'store.id',
          fix: isValidStoreUid(input.targetStoreId)
            ? `Register the checkout that carries that identity: rasen store register <path>, then rerun.`
            : `Create it first: rasen store setup ${input.targetStoreId}, then rerun.`,
        }
      );
    }
    throw error;
  }

  // Self-reference is a directory identity question, not an id question
  // (design D6): a project sharing the target store's id at a DIFFERENT
  // path is legitimate (that is the whole point of the type split).
  const canonicalTargetRoot = normalizeRegistryPathForComparison(targetStore.storeRoot);
  if (canonicalProjectRoot === canonicalTargetRoot) {
    throw new StoreError(
      `'${resolvedProjectId}' cannot be added to itself: the project and the target store '${targetStore.id}' are the same directory.`,
      'store_add_project_self_reference',
      {
        target: 'store.references',
        fix: `Choose a different --to target, or add a different project to '${targetStore.id}'.`,
      }
    );
  }

  const storeRef: ResolvedStoreRef = {
    type: 'store',
    id: targetStore.id,
    root: targetStore.storeRoot,
    ...(targetStore.uid !== undefined ? { uid: targetStore.uid } : {}),
  };
  const storeRemote = await credentialFreeRemoteOf(targetStore.storeRoot);
  const registryEntries = listStoreRegistryEntries(
    (await readStoreRegistryState({})) ?? { version: 1, stores: {} }
  );

  // A preview resolves and reports; it registers nothing, mints no project
  // identity, and writes to neither repository.
  if (input.dryRun) {
    return previewAddProject({
      projectRoot,
      resolvedProjectId,
      storeRef,
      storeRemote,
      targetStore,
      setPrimary: input.setPrimary === true,
      ...(input.roles ? { roles: input.roles } : {}),
      registryEntries,
    });
  }

  const registration = await registerExistingStore({
    path: projectRoot,
    ...(input.id !== undefined ? { id: input.id } : {}),
    allowCreateIdentity: true,
    type: 'project',
  });

  const { configPath, changed } = appendStoreReference(targetStore.storeRoot, registration.store.id, {
    type: 'project',
  });

  // The membership record is keyed by the project's permanent identity, so the
  // identity has to exist before the record can. This is the established lazy
  // mint (append-only, re-read and validated, reverted on failure) — the same
  // one every command that needs a project identity already uses.
  const projectId = await ensureProjectIdInConfig(registration.store.root);

  // Planning membership is asserted only when it is TRUE: the user opted in,
  // or the project already plans in this Store. `add-project` alone never
  // makes a project plan anywhere, so it never claims that it does. A
  // composing caller states its own roles instead of inheriting these.
  const alreadyPlansHere = await declarationNamesStore(registration.store.root, storeRef);
  const roles: StoreProjectRoles = input.roles ?? {
    planning: input.setPrimary === true || alreadyPlansHere,
    knowledge: true,
  };

  const projectRemote = await credentialFreeRemoteOf(registration.store.root);
  const mutation = await applyMembershipMutation({
    projectRoot: registration.store.root,
    projectId,
    projectDisplayId: registration.store.id,
    ...(projectRemote !== undefined ? { projectRemote } : {}),
    store: storeRef,
    ...(storeRemote !== undefined ? { storeRemote } : {}),
    roles,
  });

  const planningBinding = await resolvePlanningBinding({
    projectRoot: registration.store.root,
    store: storeRef,
    requested: input.setPrimary === true,
    registryEntries,
  });

  const diagnostics: StoreDiagnostic[] = [...registration.diagnostics];
  if (planningBinding.refused) {
    diagnostics.push(
      makeStoreDiagnostic(
        'warning',
        'project_planning_binding_refused',
        // Both sides carry their permanent identity: two Stores may legitimately
        // share a display name, and a refusal naming only the name reads
        // "plans in 'team-store', not 'team-store'".
        `Project ${registration.store.id} already plans in store ${describeStore({
          id: planningBinding.boundTo,
          ...(planningBinding.boundToUid !== undefined ? { uid: planningBinding.boundToUid } : {}),
        })}; --set-primary refused to rebind it to ${describeStore({
          id: storeRef.id,
          ...(storeRef.uid !== undefined ? { uid: storeRef.uid } : {}),
        })}. Nothing was overwritten: the planning store is exactly as it was, and the membership record and locator hint this command wrote still stand — they are a different relation.`,
        {
          target: 'store.pointer',
          fix: planningBinding.rebindCommand ?? 'rasen store doctor',
        }
      )
    );
  }

  return {
    project: {
      id: registration.store.id,
      root: registration.store.root,
      metadataCreated: registration.createdArtifacts.includes('.rasen-store/store.yaml'),
      alreadyRegistered: registration.registryCommit.alreadyRegistered,
    },
    target: {
      id: targetStore.id,
      root: targetStore.storeRoot,
      configPath,
      referenceAdded: changed,
      referenceAlreadyPresent: !changed,
    },
    membership: {
      projectId,
      roles,
      projectBaseCommit: mutation.projectBaseCommit,
      storeBaseCommit: mutation.storeBaseCommit,
      projectWrites: mutation.projectWrites,
      storeWrites: mutation.storeWrites,
      recordWritten: mutation.storeRecordWritten,
      hintWritten: mutation.projectHintWritten,
      repairNeeded: mutation.repairNeeded,
      suggestedCommits: mutation.suggestedCommits,
    },
    planningBinding,
    dryRun: false,
    diagnostics,
  };
}

/** The Store's or the project's recorded origin, when it embeds no credential. */
async function credentialFreeRemoteOf(root: string): Promise<string | undefined> {
  const metadata = await readStoreMetadataForOperation(root).catch(() => null);
  const recorded = metadata?.remote;
  if (recorded !== undefined && !remoteCarriesCredentials(recorded)) return recorded;
  const origin = await gitOriginUrl(root);
  if (origin !== null && !remoteCarriesCredentials(origin)) return origin;
  return undefined;
}

/**
 * True when the project's CURRENT planning declaration already names this
 * Store. Goes through the shared resolver: the declared display alias is
 * undefined for a declaration that records only the permanent identity, so
 * comparing names would answer "no" for exactly the declarations this change
 * encourages.
 */
async function declarationNamesStore(
  projectRoot: string,
  store: ResolvedStoreRef
): Promise<boolean> {
  const pointer = readStorePointer(projectRoot);
  if (!hasStoreDeclaration(pointer)) return false;
  const binding = await resolveStoreBinding({
    declaration: storeBindingDeclarationFrom(pointer),
    projectRoot,
  });
  if (binding.kind !== 'resolved') return false;
  return sameStore(binding.store, store);
}

function sameStore(left: ResolvedStoreRef, right: ResolvedStoreRef): boolean {
  if (left.uid !== undefined && right.uid !== undefined) {
    return storeUidsMatch(left.uid, right.uid);
  }
  return (
    normalizeRegistryPathForComparison(left.root) ===
    normalizeRegistryPathForComparison(right.root)
  );
}

/**
 * The `--set-primary` write path (design D12), in three outcomes and no
 * fourth: no planning Store -> record it; the target already bound -> a no-op
 * that rewrites nothing; a DIFFERENT Store bound -> refuse, naming what is
 * bound, what was asked for, and the command that rebinds deliberately.
 *
 * A refusal never touches the pointer and never rolls back the membership the
 * same invocation established — they are different relations, and the
 * membership is correct regardless of where the project plans.
 */
async function resolvePlanningBinding(input: {
  projectRoot: string;
  store: ResolvedStoreRef;
  requested: boolean;
  registryEntries: readonly StoreRegistryEntry[];
}): Promise<StoreAddProjectPlanningBinding> {
  const requestedStore = input.store.id;
  const base: StoreAddProjectPlanningBinding = {
    requested: input.requested,
    changed: false,
    refused: false,
    alreadyBound: false,
    requestedStore,
    ...(input.store.uid !== undefined ? { requestedStoreUid: input.store.uid } : {}),
  };

  const pointer = readStorePointer(input.projectRoot);
  const declared = describeStoreDeclaration(pointer);

  if (!input.requested) {
    // Never inferred: with the flag absent no planning Store is written under
    // any circumstance, whatever the project's state.
    return { ...base, ...(declared !== undefined ? { boundTo: declared } : {}) };
  }

  if (!hasStoreDeclaration(pointer)) {
    await writePlanningBinding(input.projectRoot, input.store);
    return { ...base, changed: true, boundTo: requestedStore };
  }

  const binding = await resolveStoreBinding({
    declaration: storeBindingDeclarationFrom(pointer),
    projectRoot: input.projectRoot,
  });

  if (binding.kind === 'resolved' && sameStore(binding.store, input.store)) {
    return {
      ...base,
      alreadyBound: true,
      boundTo: binding.store.id,
      ...(binding.store.uid !== undefined ? { boundToUid: binding.store.uid } : {}),
    };
  }

  // Anything else — a different Store, or one that cannot be resolved here —
  // is refused. Overwriting a declaration whose target cannot be read would
  // discard a binding nobody has verified is wrong.
  const bound = binding.kind === 'resolved' ? binding.store.id : (declared ?? '(unresolvable)');
  const boundUid = binding.kind === 'resolved' ? binding.store.uid : undefined;
  const selector = unambiguousStoreSelector(input.store, input.registryEntries);
  return {
    ...base,
    refused: true,
    boundTo: bound,
    ...(boundUid !== undefined ? { boundToUid: boundUid } : {}),
    rebindCommand: `rasen store upgrade-identity ${selector} --apply`,
  };
}

/**
 * Records the planning Store through the SAME durable writer
 * `store upgrade-identity --apply` and `store adopt` use. A Store that
 * predates permanent identities has none to record and keeps the legacy
 * display-name form, which `store_pointer_legacy` then offers to upgrade.
 */
async function writePlanningBinding(
  projectRoot: string,
  store: ResolvedStoreRef
): Promise<void> {
  const configPath = resolveConfigFilePath(projectRoot);
  if (store.uid === undefined || configPath === null) {
    updateProjectConfigKey(projectRoot, 'store', store.id);
    return;
  }
  const remote = await credentialFreeRemoteOf(store.root);
  await writeDurablePointer(configPath, {
    uid: store.uid,
    id: store.id,
    ...(remote !== undefined ? { remote } : {}),
  });
}

/** The preview: every file each repository would gain, and nothing written. */
async function previewAddProject(input: {
  projectRoot: string;
  resolvedProjectId: string;
  storeRef: ResolvedStoreRef;
  storeRemote: string | undefined;
  targetStore: { id: string; storeRoot: string };
  setPrimary: boolean;
  roles?: StoreProjectRoles;
  registryEntries: readonly StoreRegistryEntry[];
}): Promise<StoreAddProjectResult> {
  const projectId = readProjectConfig(input.projectRoot)?.projectId ?? null;
  // The preview must report the roles the apply would write, override included.
  const roles: StoreProjectRoles = input.roles ?? { planning: input.setPrimary, knowledge: true };
  const configPath =
    resolveConfigFilePath(input.targetStore.storeRoot) ??
    path.join(input.targetStore.storeRoot, WORKSPACE_DIR_NAME, 'config.yaml');

  const plan =
    projectId === null
      ? null
      : await planMembershipMutation({
          projectRoot: input.projectRoot,
          projectId,
          projectDisplayId: input.resolvedProjectId,
          store: input.storeRef,
          ...(input.storeRemote !== undefined ? { storeRemote: input.storeRemote } : {}),
          roles,
        });

  // With no project identity yet the record's name is not knowable without
  // minting one, which a preview must not do. Report the shape instead of
  // inventing a filename.
  const storeWrites = plan?.storeWrites ?? [
    path.join(getStoreProjectRecordsDir(input.storeRef.root), '<projectId>.yaml'),
  ];
  const projectWrites = plan?.projectWrites ?? [
    path.join(input.projectRoot, WORKSPACE_DIR_NAME, 'config.yaml'),
  ];

  const planningBinding = await resolvePlanningBinding({
    projectRoot: input.projectRoot,
    store: input.storeRef,
    // A preview never writes, so it resolves the outcome without the flag's
    // write path; `requested` below still reports what the user asked for.
    requested: false,
    registryEntries: input.registryEntries,
  });

  return {
    project: {
      id: input.resolvedProjectId,
      root: input.projectRoot,
      metadataCreated: false,
      alreadyRegistered: false,
    },
    target: {
      id: input.targetStore.id,
      root: input.targetStore.storeRoot,
      configPath,
      referenceAdded: false,
      referenceAlreadyPresent: false,
    },
    membership: {
      projectId,
      roles,
      projectBaseCommit: plan?.projectBaseCommit ?? null,
      storeBaseCommit: plan?.storeBaseCommit ?? null,
      projectWrites,
      storeWrites,
      recordWritten: false,
      hintWritten: false,
      repairNeeded: plan?.repairNeeded ?? [],
      suggestedCommits: [],
    },
    planningBinding: { ...planningBinding, requested: input.setPrimary },
    dryRun: true,
    diagnostics: [],
  };
}

function cleanupStoreOutput(id: string, storeRoot: string): StoreInfo {
  return {
    id,
    root: storeRoot,
    metadataPath: getStoreMetadataPath(storeRoot),
  };
}

export async function prepareStoreCleanup(
  input: CleanupStoreInput
): Promise<PreparedStoreCleanup> {
  const selector = validateStoreSelector(input.id);
  const type = input.type ?? 'store';
  const entry = await getRegisteredStore({
    id: selector,
    type,
    globalDataDir: input.globalDataDir,
  });

  return {
    ...cleanupStoreOutput(entry.id, entry.storeRoot),
    backend: entry.backend,
    type,
    selector,
    ...(input.globalDataDir ? { globalDataDir: input.globalDataDir } : {}),
  };
}

export async function unregisterStore(
  input: CleanupStoreInput
): Promise<StoreCleanupResult> {
  const target = await prepareStoreCleanup(input);
  const removed = await unregisterStoreRegistration({
    // The selector, not the resolved alias: with two Stores sharing a display
    // name, re-resolving by the alias here would be ambiguous again.
    id: target.selector,
    type: target.type,
    expectedBackend: target.backend,
    globalDataDir: target.globalDataDir,
  });

  return {
    store: cleanupStoreOutput(removed.id, removed.storeRoot),
    registryCommit: {
      path: getStoreRegistryPath({ globalDataDir: target.globalDataDir }),
      removed: true,
    },
    files: {
      deleted: false,
      leftOnDisk: removed.storeRoot,
    },
    diagnostics: rekeyBlockedDiagnostics(removed.rekeyBlockedBy),
  };
}

/** The pending-identity-upgrade report every registry mutation shares (D7). */
function rekeyBlockedDiagnostics(blockedBy: string[]): StoreDiagnostic[] {
  return blockedBy.length > 0 ? [storeRegistryRekeyBlocked({ blockedBy })] : [];
}

async function assertSafeToDeleteStoreRoot(storeRoot: string, id: string): Promise<{
  exists: boolean;
}> {
  const kind = await pathKind(storeRoot);

  if (kind === 'missing') {
    return { exists: false };
  }

  if (kind !== 'directory') {
    throw new StoreError(
      `Store path is not a directory: ${storeRoot}`,
      'store_remove_path_not_directory',
      {
        target: 'store.root',
        fix: 'Run "rasen store unregister <id>" if you only want to forget this local registry entry.',
      }
    );
  }

  const metadata = await readStoreMetadataForOperation(storeRoot);
  if (!metadata) {
    throw new StoreError(
      'Store remove refuses to delete a folder without store metadata.',
      'store_remove_metadata_missing',
      {
        target: 'store.metadata',
        fix: 'Run "rasen store unregister <id>" if you only want to forget this local registry entry.',
      }
    );
  }

  if (metadata.id !== id) {
    throw new StoreError(
      `Store metadata id '${metadata.id}' does not match requested id '${id}'.`,
      'store_metadata_id_mismatch',
      {
        target: 'store.metadata',
        fix: 'Repair the registry or run store unregister instead of deleting this folder.',
      }
    );
  }

  return { exists: true };
}

export async function removeStore(
  target: PreparedStoreCleanup
): Promise<StoreCleanupResult> {
  const id = validateStoreId(target.id);
  const diagnostics: StoreDiagnostic[] = [];
  // Assigned from the unregistration below; declared here so the pending
  // identity upgrades join the same diagnostics list the file deletion uses.
  let deleted = false;

  // Order matters: the registry entry goes first, the files second. A
  // failed file deletion leaves recoverable orphan files; the reverse
  // order would leave a phantom registration pointing at nothing.
  let rootMissing = false;
  const removed = await unregisterStoreRegistration({
    // Resolved by whatever the user named (see `unregisterStore`); the
    // metadata-id safety check below still uses the resolved display name.
    id: target.selector,
    type: target.type,
    expectedBackend: target.backend,
    globalDataDir: target.globalDataDir,
    beforeCommit: async (entry) => {
      const safeTarget = await assertSafeToDeleteStoreRoot(entry.storeRoot, id);
      rootMissing = !safeTarget.exists;
    },
  });

  if (rootMissing) {
    diagnostics.push(makeStoreDiagnostic(
      'warning',
      'store_root_missing',
      'Store files were already missing.',
      {
        target: 'store.root',
      }
    ));
  } else {
    try {
      await fs.rm(removed.storeRoot, { recursive: true, force: true });
      deleted = true;
    } catch (error) {
      diagnostics.push(makeStoreDiagnostic(
        'warning',
        'store_files_left_on_disk',
        `The registration was removed, but deleting ${removed.storeRoot} failed (${(error as Error).message}).`,
        {
          target: 'store.root',
          fix: `Delete the folder manually: ${removed.storeRoot}`,
        }
      ));
    }
  }

  // Last, so an existing first finding (the missing root, a failed deletion)
  // stays first: this one is an advisory about the registry's key form.
  diagnostics.push(...rekeyBlockedDiagnostics(removed.rekeyBlockedBy));

  return {
    store: cleanupStoreOutput(removed.id, removed.storeRoot),
    registryCommit: {
      path: getStoreRegistryPath({ globalDataDir: target.globalDataDir }),
      removed: true,
    },
    files: {
      deleted,
      ...(deleted ? { deletedPath: removed.storeRoot } : {}),
    },
    diagnostics,
  };
}

export async function listStores(): Promise<StoreListResult> {
  const entries = await listRegisteredStores();

  return {
    stores: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      root: entry.storeRoot,
      ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
    })),
  };
}

function doctorStatusForError(
  error: unknown,
  code: string,
  target: string,
  fix?: string
): StoreDiagnostic {
  if (error instanceof StoreError) {
    return error.diagnostic;
  }

  return makeStoreDiagnostic(
    'error',
    code,
    error instanceof Error ? error.message : String(error),
    {
      target,
      ...(fix ? { fix } : {}),
    }
  );
}

async function inspectStore(entry: StoreRegistryRow): Promise<StoreInspection> {
  const root = getStoreRootForBackend(entry.backend);
  const metadataPath = getStoreMetadataPath(root);
  const diagnostics: StoreDiagnostic[] = [];
  const kind = await pathKind(root);
  let metadata: StoreInspection['metadata'] = {
    present: null,
    valid: null,
    remote: null,
  };
  let git: StoreInspection['git'] = {
    isRepository: null,
    hasCommits: null,
    hasUncommittedChanges: null,
    hasRemote: null,
    originUrl: null,
  };
  let openspecRoot: OpenSpecRootInspection = await inspectOpenSpecRoot(root);

  if (kind === 'missing') {
    diagnostics.push(makeStoreDiagnostic(
      'error',
      'store_root_missing',
      'Store location does not exist.',
      {
        target: 'store.root',
        fix: `Run rasen store register /path/to/${entry.id} --id ${entry.id}.`,
      }
    ));
  } else if (kind !== 'directory') {
    diagnostics.push(makeStoreDiagnostic(
      'error',
      'store_root_not_directory',
      'Store location is not a directory.',
      {
        target: 'store.root',
        fix: 'Register a directory path for this store.',
      }
    ));
  } else {
    openspecRoot = await inspectOpenSpecRoot(root);
    diagnostics.push(...openspecRoot.diagnostics);

    // The RAW recorded remote, kept beside the redacted one that is displayed:
    // two remotes differing only in an embedded credential redact to the same
    // string, so comparing the redacted forms would suppress a real divergence.
    let recordedRemote: string | undefined;
    try {
      const parsed = await readOptionalStoreMetadataState(root);
      if (!parsed) {
        metadata = { present: false, valid: false, remote: null };
        diagnostics.push(makeStoreDiagnostic(
          'error',
          'store_metadata_missing',
          'Store metadata is missing.',
          {
            target: 'store.metadata',
            fix: `Create ${metadataPath} or rerun store register.`,
          }
        ));
      } else if (parsed.id !== entry.id) {
        metadata = {
          present: true,
          valid: false,
          id: parsed.id,
          remote: null,
          ...(storeMetadataUid(parsed) !== undefined ? { uid: storeMetadataUid(parsed) } : {}),
        };
        diagnostics.push(makeStoreDiagnostic(
          'error',
          'store_metadata_id_mismatch',
          `Store metadata id '${parsed.id}' does not match registry id '${entry.id}'.`,
          {
            target: 'store.metadata',
            fix: 'Repair the local registry or store metadata so the ids match.',
          }
        ));
      } else {
        const parsedUid = storeMetadataUid(parsed);
        recordedRemote = parsed.remote;
        metadata = {
          present: true,
          valid: true,
          id: parsed.id,
          ...(parsedUid !== undefined ? { uid: parsedUid } : { legacy: true }),
          remote: redactOptionalRemote(parsed.remote) ?? null,
        };
        if (parsedUid === undefined) {
          diagnostics.push(
            storeMetadataLegacy({ id: parsed.id, metadataPath })
          );
        }
      }
    } catch (error) {
      metadata = { present: true, valid: false, remote: null };
      diagnostics.push(doctorStatusForError(
        error,
        'store_metadata_invalid',
        'store.metadata',
        `Repair ${metadataPath}.`
      ));
    }

    const isRepository = await isGitRepositoryAtRoot(root);
    git = {
      isRepository,
      hasCommits: null,
      hasUncommittedChanges: null,
      hasRemote: null,
      originUrl: null,
    };

    // Read-only Git facts; doctor reports and never repairs.
    if (isRepository) {
      git.hasCommits = await gitHasCommits(root);
      git.hasUncommittedChanges = await gitHasUncommittedChanges(root);
      git.hasRemote = await gitHasRemote(root);
      const observedRemote = await gitOriginUrl(root);
      git.originUrl = redactOptionalRemote(observedRemote) ?? null;

      // The recorded clone source and the checkout's actual origin disagreeing
      // is information, not a fault — reported here so `store doctor` and
      // `rasen doctor` say the same thing about the same store. Compared RAW,
      // rendered redacted: comparing the redacted forms would hide a real
      // divergence between two remotes that differ only in a credential.
      if (recordedRemote && observedRemote && recordedRemote !== observedRemote) {
        diagnostics.push(
          storeRemoteDivergence({ recorded: recordedRemote, observed: observedRemote })
        );
      }

      if (git.hasCommits === false) {
        diagnostics.push(makeStoreDiagnostic(
          'warning',
          'store_git_no_commits',
          'Git repository has no commits yet; clones of this store will be empty until an initial commit exists.',
          {
            target: 'store.git',
            fix: 'Commit the store files, then push to share them.',
          }
        ));
      } else if (git.hasCommits === true) {
        const fragileDirs: string[] = [];
        for (const relativeDir of ANCHORED_WORKSPACE_DIRS) {
          const dirKind = await pathKind(path.join(root, relativeDir));
          if (dirKind !== 'directory') continue;
          if ((await gitDirectoryHasTrackedFiles(root, relativeDir)) === false) {
            fragileDirs.push(`${relativeDir}/`);
          }
        }

        if (fragileDirs.length > 0) {
          diagnostics.push(makeStoreDiagnostic(
            'warning',
            'store_clone_fragile_directories',
            `These directories contain no tracked files and will be lost in clones: ${fragileDirs.join(', ')}.`,
            {
              target: 'store.git',
              fix: `Track a file in each directory (for example ${DIRECTORY_ANCHOR_FILE_NAME}) and commit it.`,
            }
          ));
        }
      }
    }
  }

  return {
    id: entry.id,
    type: entry.type,
    ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
    root,
    metadataPath,
    openspecRoot,
    metadata,
    git,
    diagnostics,
  };
}

/**
 * `type` is an opt-in narrowing filter (the `--project` flag): absent, an
 * id shared by a store and a project reports both rows (existing
 * behavior, disambiguated by the `type` field each row now carries);
 * passed, only that namespace's entry for the id is inspected, and a miss
 * that would have matched the OTHER namespace hints the flag to flip.
 */
export async function doctorStores(
  id?: string,
  type?: RegistryEntryType
): Promise<StoreDoctorResult> {
  const selectedId = id !== undefined ? validateStoreSelector(id) : undefined;
  // Diagnosing one of two Stores that share a display name is only possible by
  // naming its permanent identity, so this surface accepts one too.
  const selectsByUid = selectedId !== undefined && isValidStoreUid(selectedId);
  const registry = await readStoreRegistryState();

  if (!registry) {
    if (selectedId !== undefined) {
      throw new StoreError(`Unknown store '${selectedId}'.`, 'store_not_found', {
        target: 'store.id',
        fix: 'Run rasen store list to see registered stores.',
      });
    }

    return { stores: [], diagnostics: [] };
  }

  const entries = listStoreRegistryEntries(registry);
  const selected = entries.filter((entry) => {
    if (selectedId !== undefined) {
      const matches = selectsByUid
        ? entry.type === 'store' && storeUidsMatch(entry.uid, selectedId)
        : entry.id === selectedId;
      if (!matches) return false;
    }
    if (type !== undefined && entry.type !== type) return false;
    return true;
  });

  if (selectedId && selected.length === 0) {
    const noun = type === 'project' ? 'project' : 'store';
    const otherType: RegistryEntryType | undefined =
      type === undefined ? undefined : type === 'project' ? 'store' : 'project';
    const hasOtherType =
      otherType !== undefined &&
      entries.some((entry) => entry.id === selectedId && entry.type === otherType);

    throw new StoreError(`Unknown ${noun} '${selectedId}'.`, 'store_not_found', {
      target: 'store.id',
      fix: hasOtherType
        ? `'${selectedId}' is registered as a ${otherType}, not a ${noun}. ${otherType === 'project' ? 'Rerun with --project-namespace.' : 'Rerun without --project-namespace.'}`
        : 'Run rasen store list to see registered stores.',
    });
  }

  const inspected = await Promise.all(selected.map(inspectStore));

  // Two stores sharing a display alias is legitimate once identities can tell
  // them apart, but naming that alias is ambiguous — doctor says so.
  const aliasCounts = new Map<string, number>();
  for (const store of inspected) {
    if (store.type !== 'store') continue;
    aliasCounts.set(store.id, (aliasCounts.get(store.id) ?? 0) + 1);
  }
  const diagnostics: StoreDiagnostic[] = [];
  for (const [alias, count] of aliasCounts) {
    if (count < 2) continue;
    diagnostics.push(
      storeAliasAmbiguous({
        id: alias,
        candidates: inspected
          .filter((store) => store.type === 'store' && store.id === alias)
          .map((store) => ({
            ...(store.uid !== undefined ? { uid: store.uid } : {}),
            id: store.id,
            root: store.root,
          })),
      })
    );
  }

  // Store-side membership health: a record whose filename and identity
  // disagree, a legacy reference that cannot be mapped here, and legacy
  // adoption data still awaiting conversion. Read-only — the provider writes
  // nothing on any path, including for a store carrying only legacy data.
  for (const store of inspected) {
    if (store.type !== 'store') continue;
    if (!store.openspecRoot.healthy) continue;
    const listing = await listStoreMembers(
      {
        type: 'store',
        id: store.id,
        root: store.root,
        ...(store.uid !== undefined ? { uid: store.uid } : {}),
      },
      {}
    ).catch(() => null);
    if (listing) {
      diagnostics.push(...listing.diagnostics);
      for (const member of listing.members) {
        for (const diagnostic of member.diagnostics) {
          if (diagnostic.code === 'shared_metadata_contains_local_path') {
            diagnostics.push(diagnostic);
          }
        }
      }
    }
  }

  return { stores: inspected, diagnostics };
}

export function normalizeStorePathForComparison(targetPath: string): string {
  return FileSystemUtils.canonicalizeExistingPath(targetPath);
}
