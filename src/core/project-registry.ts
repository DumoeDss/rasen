import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { getGlobalDataDir } from './global-config.js';
import { FileSystemUtils } from '../utils/file-system.js';
import { toKebabCase } from './id.js';
import { gitCommonDir, gitDir } from './store/git.js';
import {
  acquireFileLock,
  makeLockErrorFactory,
  pathIsDirectory,
  pathIsFile,
  releaseFileLock,
  writeFileAtomically,
} from './file-state.js';
import { formatZodIssues } from './zod-issues.js';
import { StoreError } from './store/errors.js';
import { normalizeProjectIdentity } from './store/project-records.js';

const fs = nodeFs.promises;

/**
 * The machine-wide project registry (design child `externalize-artifacts-
 * machine-home`): maps canonical absolute project paths to a stable
 * `projectId` and the project's per-project home directory under the
 * global data dir. Second consumer of the `stores/` registry's atomic
 * state machinery (`file-state.ts`), kept independent of `src/core/store/**`
 * so this change never touches the store registry.
 */

export const PROJECTS_DIR_NAME = 'projects';
export const PROJECT_REGISTRY_FILE_NAME = 'registry.json';

export interface ProjectPathOptions {
  /** Test/DI override; defaults to getGlobalDataDir(). */
  globalDataDir?: string;
}

export type ProjectMode = 'in-repo' | 'store';

export interface ProjectRegistryEntryState {
  projectId: string;
  /** Kebab-cased basename of the project root at (re-)registration. */
  name: string;
  mode: ProjectMode;
  /** Home directory name under <globalDataDir>/projects/. Never re-derived once set. */
  home: string;
  /** ISO-8601 timestamp, refreshed by self-healing. */
  lastSeen: string;
  /**
   * Optional cache of the project's authoritative `tools:` manifest from
   * `rasen/config.yaml` (project-install-manifest spec). Best-effort mirror;
   * never the source of truth. Readers prefer the project config when they
   * disagree.
   */
  tools?: string[];
  /**
   * Optional cache of the Rasen version this project's skills were last
   * refreshed to (project-install-manifest spec). Stamped by `rasen update`
   * and converged by the self-heal touch from `generatedBy` frontmatter.
   * Absent means "version unknown."
   */
  installedVersion?: string;
  /**
   * Optional ISO-8601 timestamp of the most recent cache refresh
   * (project-install-manifest spec). Distinct from `lastSeen`: `lastSeen`
   * tracks any self-heal refresh; `lastUpdated` tracks the version/tools
   * cache write specifically.
   */
  lastUpdated?: string;
}

export interface ProjectRegistryState {
  version: 1;
  /** Key: canonical absolute project root (FileSystemUtils.canonicalizeExistingPath). */
  projects: Record<string, ProjectRegistryEntryState>;
}

function joinProjectPath(basePath: string, ...segments: string[]): string {
  return FileSystemUtils.joinPath(basePath, ...segments);
}

export function getProjectsDir(options: ProjectPathOptions = {}): string {
  return joinProjectPath(options.globalDataDir ?? getGlobalDataDir(), PROJECTS_DIR_NAME);
}

export function getProjectRegistryPath(options: ProjectPathOptions = {}): string {
  return joinProjectPath(getProjectsDir(options), PROJECT_REGISTRY_FILE_NAME);
}

export function getProjectHomeDir(homeName: string, options: ProjectPathOptions = {}): string {
  return joinProjectPath(getProjectsDir(options), homeName);
}

// -----------------------------------------------------------------------------
// Schema, parse, serialize
// -----------------------------------------------------------------------------

const ProjectRegistryEntrySchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(['in-repo', 'store']),
  home: z.string().min(1),
  lastSeen: z.string().min(1),
  // Cache fields (project-install-manifest spec). Optional so older
  // registries parse, and `.strict()` still accepts them when present.
  tools: z.array(z.string()).optional(),
  installedVersion: z.string().optional(),
  lastUpdated: z.string().optional(),
}).strict();

const ProjectRegistryStateSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), ProjectRegistryEntrySchema),
}).strict();

function invalidProjectRegistryError(message: string): StoreError {
  return new StoreError(`Invalid project registry state: ${message}`, 'invalid_project_registry', {
    target: 'project.registry',
    fix: `Repair or remove ${getProjectRegistryPath({})}.`,
  });
}

export function parseProjectRegistryState(content: string): ProjectRegistryState {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw invalidProjectRegistryError(error instanceof Error ? error.message : String(error));
  }

  const result = ProjectRegistryStateSchema.safeParse(raw);
  if (!result.success) {
    throw invalidProjectRegistryError(formatZodIssues(result.error));
  }

  return { version: 1, projects: result.data.projects };
}

export function serializeProjectRegistryState(state: ProjectRegistryState): string {
  const result = ProjectRegistryStateSchema.safeParse(state);
  if (!result.success) {
    throw invalidProjectRegistryError(formatZodIssues(result.error));
  }

  return JSON.stringify({ version: 1, projects: result.data.projects }, null, 2) + '\n';
}

// -----------------------------------------------------------------------------
// IO: read / write / update-under-lock (mirrors store/foundation.ts)
// -----------------------------------------------------------------------------

export async function readProjectRegistryState(
  options: ProjectPathOptions = {}
): Promise<ProjectRegistryState | null> {
  const registryPath = getProjectRegistryPath(options);
  if (!(await pathIsFile(registryPath))) {
    return null;
  }
  return parseProjectRegistryState(await fs.readFile(registryPath, 'utf-8'));
}

export async function writeProjectRegistryState(
  state: ProjectRegistryState,
  options: ProjectPathOptions = {}
): Promise<void> {
  await writeFileAtomically(getProjectRegistryPath(options), serializeProjectRegistryState(state));
}

const projectRegistryLockError = makeLockErrorFactory({
  createSubject: 'the project registry lock file',
  busyMessage: 'Project registry is busy.',
  code: 'project_registry_busy',
  target: 'project.registry',
});

export async function updateProjectRegistryState(
  updater: (
    state: ProjectRegistryState | null
  ) => ProjectRegistryState | Promise<ProjectRegistryState>,
  options: ProjectPathOptions = {}
): Promise<ProjectRegistryState> {
  const registryPath = getProjectRegistryPath(options);
  const lockPath = `${registryPath}.lock`;
  const lock = await acquireFileLock({ lockPath, errorFor: projectRegistryLockError });

  try {
    const next = await updater(await readProjectRegistryState(options));
    await writeProjectRegistryState(next, options);
    return next;
  } finally {
    await releaseFileLock(lock, lockPath);
  }
}

/**
 * Runs `fn` while holding the project registry lock, without the
 * read-modify-write contract `updateProjectRegistryState` imposes. Exposed
 * for callers that must serialize a multi-step operation against registry
 * writers without necessarily writing the registry themselves — `gcProjectRegistry`
 * (home-directory deletion must happen before the lock is released, MAJOR-1)
 * and `ensureProjectIdInConfig` (projectId minting, MINOR-3).
 */
export async function withProjectRegistryLock<T>(
  fn: () => Promise<T>,
  options: ProjectPathOptions = {}
): Promise<T> {
  const registryPath = getProjectRegistryPath(options);
  const lockPath = `${registryPath}.lock`;
  const lock = await acquireFileLock({ lockPath, errorFor: projectRegistryLockError });

  try {
    return await fn();
  } finally {
    await releaseFileLock(lock, lockPath);
  }
}

// -----------------------------------------------------------------------------
// Home naming (design D4)
// -----------------------------------------------------------------------------

/** Kebab-cased display name derived from a project root's basename. */
export function deriveProjectDisplayName(canonicalProjectRoot: string): string {
  return toKebabCase(path.basename(canonicalProjectRoot)) || 'project';
}

/** `<name>-<first 8 hex chars of sha256(projectId)>` — readable, collision-free. */
export function deriveHomeBaseName(canonicalProjectRoot: string, projectId: string): string {
  const name = deriveProjectDisplayName(canonicalProjectRoot);
  const shortHash = createHash('sha256').update(projectId).digest('hex').slice(0, 8);
  return `${name}-${shortHash}`;
}

/**
 * True when both paths are Git worktrees of the same repository. A shared
 * `git rev-parse --git-common-dir` alone is NOT sufficient: it is identical
 * for any two directories inside one single working tree too (e.g. two
 * subdirectories, or a `cp -r` copy that carries no separate `.git`), which
 * would wrongly classify a same-tree copy as a worktree sibling. Requiring
 * the per-worktree `git rev-parse --git-dir` to also DIFFER closes that gap:
 * linked worktrees have distinct git-dirs sharing one common-dir, while any
 * two paths inside one working tree share both. False when either path is
 * not a Git working tree or Git is unavailable — the caller's contract is to
 * fork rather than share in that case.
 */
async function isGitWorktreeSibling(pathA: string, pathB: string): Promise<boolean> {
  const [commonA, commonB] = await Promise.all([gitCommonDir(pathA), gitCommonDir(pathB)]);
  if (!commonA || !commonB) return false;
  if (path.resolve(commonA) !== path.resolve(commonB)) return false;

  const [dirA, dirB] = await Promise.all([gitDir(pathA), gitDir(pathB)]);
  if (!dirA || !dirB) return false;
  return path.resolve(dirA) !== path.resolve(dirB);
}

/**
 * Resolves the MAIN repository's working-tree directory from any path inside
 * it (main repo or a linked worktree), so a freshly created shared home can
 * be named after the main repo rather than whichever worktree happens to
 * register first (D3). `git rev-parse --git-common-dir` is identical for
 * every worktree of one repository; when it resolves to a `.git` directory,
 * its parent is the main working tree. Returns `null` for a non-git path, an
 * unavailable Git, or a common-dir that does not look like a `.git` inside a
 * working tree (e.g. a bare repository) — callers fall back to the
 * registering path's basename in every one of those cases.
 */
async function resolveMainRepoDir(canonicalPath: string): Promise<string | null> {
  const commonDir = await gitCommonDir(canonicalPath);
  if (!commonDir) return null;
  if (path.basename(commonDir) !== '.git') return null;
  return path.dirname(commonDir);
}

/**
 * The canonical registration/lookup root for `canonicalPath` (worktree-aware-
 * spaces D1): the MAIN checkout's working-tree directory when `canonicalPath`
 * is inside a git repository whose main checkout exists on disk and differs
 * from the input, else `canonicalPath` unchanged. This single rule pierces a
 * linked worktree onto the one entry keyed at the main checkout, and folds the
 * "main gone / bare / non-git / git-unavailable" cases into the same fallback
 * (`resolveMainRepoDir` returns null for all of them, and a resolved-but-
 * deleted main fails the on-disk check) — so a surviving worktree registers
 * itself rather than being left homeless. Non-mutating (git rev-parse only).
 */
export async function resolveRegistrationRoot(canonicalPath: string): Promise<string> {
  const mainRepoDir = await resolveMainRepoDir(canonicalPath);
  if (!mainRepoDir) return canonicalPath;
  if (!(await pathIsDirectory(mainRepoDir))) return canonicalPath;
  const canonicalMain = FileSystemUtils.canonicalizeExistingPath(mainRepoDir);
  return canonicalMain === canonicalPath ? canonicalPath : canonicalMain;
}

// -----------------------------------------------------------------------------
// Registration (design D4 algorithm)
// -----------------------------------------------------------------------------

export interface RegisterProjectInput {
  /** Project root; canonicalized internally. */
  projectRoot: string;
  projectId: string;
  mode: ProjectMode;
  /**
   * Optional cache fields (project-install-manifest spec). When supplied on
   * a fresh entry, they are written. When omitted on a path-exact / worktree-
   * share / moved-repo disposition, the existing entry's cached values are
   * preserved (never reset to undefined). Cache fields never affect home
   * naming, the home-never-renamed invariant, or path-exact/worktree/move
   * dispositions.
   */
  tools?: string[];
  installedVersion?: string;
  lastUpdated?: string;
}

export interface RegisterProjectResult {
  entry: ProjectRegistryEntryState;
  canonicalPath: string;
}

/**
 * Registers (or refreshes) a project in the machine-wide registry under the
 * registry lock. Distinguishes path-exact update, moved-repo rebind,
 * worktree share, and clone fork (design D4 / spec "Clones fork, worktrees
 * share, moves rebind"). Creates the resolved home directory when it does
 * not yet exist.
 */
export async function registerProject(
  input: RegisterProjectInput,
  options: ProjectPathOptions = {}
): Promise<RegisterProjectResult> {
  const result = await registerProjectWithPolicy(input, options, true);
  if (result === null) {
    throw new Error('Project registration unexpectedly produced no entry.');
  }
  return result;
}

/**
 * Refreshes only an identity that the registry can already prove belongs to
 * this path: path-exact, linked-worktree, or one unambiguous moved entry.
 * Unknown live paths never become owners as a side effect of root resolution.
 */
export async function refreshRegisteredProject(
  input: RegisterProjectInput,
  options: ProjectPathOptions = {}
): Promise<RegisterProjectResult | null> {
  return registerProjectWithPolicy(input, options, false);
}

async function registerProjectWithPolicy(
  input: RegisterProjectInput,
  options: ProjectPathOptions,
  allowCreate: boolean
): Promise<RegisterProjectResult | null> {
  const canonicalInput = FileSystemUtils.canonicalizeExistingPath(input.projectRoot);
  const canonicalPath = await resolveRegistrationRoot(canonicalInput);
  const name = deriveProjectDisplayName(canonicalPath);
  const now = () => new Date().toISOString();
  let resolvedEntry: ProjectRegistryEntryState | undefined;

  await withProjectRegistryLock(async () => {
    const current = await readProjectRegistryState(options);
    const projects: Record<string, ProjectRegistryEntryState> = {
      ...(current?.projects ?? {}),
    };

    async function place(
      home: string,
      projectId: string,
      previousEntry?: ProjectRegistryEntryState
    ): Promise<void> {
      const base: Pick<
        ProjectRegistryEntryState,
        'projectId' | 'name' | 'mode' | 'home' | 'lastSeen'
      > = {
        projectId,
        name,
        mode: input.mode,
        home,
        lastSeen: now(),
      };
      resolvedEntry = {
        ...base,
        ...(previousEntry?.tools !== undefined
          ? { tools: previousEntry.tools }
          : {}),
        ...(previousEntry?.installedVersion !== undefined
          ? { installedVersion: previousEntry.installedVersion }
          : {}),
        ...(previousEntry?.lastUpdated !== undefined
          ? { lastUpdated: previousEntry.lastUpdated }
          : {}),
      };
      if (input.tools !== undefined) resolvedEntry.tools = input.tools;
      if (input.installedVersion !== undefined) {
        resolvedEntry.installedVersion = input.installedVersion;
      }
      if (input.lastUpdated !== undefined) {
        resolvedEntry.lastUpdated = input.lastUpdated;
      }
      projects[canonicalPath] = resolvedEntry;
      if (allowCreate) {
        await FileSystemUtils.createDirectory(getProjectHomeDir(home, options));
      }

      for (const otherPath of Object.keys(projects)) {
        if (otherPath === canonicalPath) continue;
        if (
          normalizeProjectIdentity(projects[otherPath].projectId) !==
          normalizeProjectIdentity(projectId)
        ) {
          continue;
        }
        const sameRoot =
          projectClaimPathKey(
            FileSystemUtils.canonicalizeExistingPath(otherPath)
          ) === projectClaimPathKey(canonicalPath);
        if (
          sameRoot ||
          (await isGitWorktreeSibling(canonicalPath, otherPath))
        ) {
          delete projects[otherPath];
        }
      }
    }

    const forgetClaimant = (
      claimant: CanonicalProjectIdentityClaimant
    ): void => {
      for (const registeredPath of claimant.registryPaths) {
        delete projects[registeredPath];
      }
    };

    const existingAtPath = projects[canonicalPath];
    if (existingAtPath) {
      const existingClaimants = await canonicalProjectIdentityClaimants(
        projects,
        existingAtPath.projectId
      );
      const existingClaim = existingClaimants.find(
        claimant =>
          projectClaimPathKey(claimant.path) ===
          projectClaimPathKey(canonicalPath)
      );
      if (existingClaim) forgetClaimant(existingClaim);
      await place(
        existingAtPath.home,
        existingAtPath.projectId,
        existingAtPath
      );
      await writeProjectRegistryState({ version: 1, projects }, options);
      return;
    }

    const sameIdClaimants = await canonicalProjectIdentityClaimants(
      projects,
      input.projectId
    );
    const canonicalClaim = sameIdClaimants.find(
      claimant =>
        projectClaimPathKey(claimant.path) ===
        projectClaimPathKey(canonicalPath)
    );
    if (canonicalClaim) {
      if (!allowCreate && canonicalClaim.fixedMetadataConflict) return;
      forgetClaimant(canonicalClaim);
      await place(
        canonicalClaim.entry.home,
        canonicalClaim.entry.projectId,
        canonicalClaim.entry
      );
      await writeProjectRegistryState({ version: 1, projects }, options);
      return;
    }

    for (const claimant of sameIdClaimants) {
      if (await isGitWorktreeSibling(canonicalPath, claimant.path)) {
        forgetClaimant(claimant);
        await place(
          claimant.entry.home,
          claimant.entry.projectId,
          claimant.entry
        );
        await writeProjectRegistryState({ version: 1, projects }, options);
        return;
      }
    }

    if (
      !allowCreate &&
      (sameIdClaimants.some(claimant => claimant.live) ||
        sameIdClaimants.length !== 1)
    ) {
      return;
    }

    for (const claimant of sameIdClaimants) {
      if (!claimant.live) {
        forgetClaimant(claimant);
        await place(
          claimant.entry.home,
          claimant.entry.projectId,
          claimant.entry
        );
        await writeProjectRegistryState({ version: 1, projects }, options);
        return;
      }
    }

    if (!allowCreate) return;

    const mainRepoDir = await resolveMainRepoDir(canonicalPath);
    const baseHome = deriveHomeBaseName(
      mainRepoDir ?? canonicalPath,
      input.projectId
    );
    const usedHomes = new Set(
      Object.values(projects).map(entry => entry.home)
    );
    let home = baseHome;
    if (usedHomes.has(home)) {
      let suffix = 2;
      while (usedHomes.has(`${baseHome}-${suffix}`)) suffix++;
      home = `${baseHome}-${suffix}`;
    }
    await place(home, input.projectId);
    await writeProjectRegistryState({ version: 1, projects }, options);
  }, options);

  return resolvedEntry === undefined
    ? null
    : { entry: resolvedEntry, canonicalPath };
}

export interface ProjectIdentityClaimant {
  path: string;
  entry: ProjectRegistryEntryState;
  live: boolean;
}

interface CanonicalProjectIdentityClaimant
  extends ProjectIdentityClaimant {
  registryPaths: string[];
  direct: boolean;
  entryLive: boolean;
  liveAliasHomes: Set<string>;
  fixedMetadataConflict: boolean;
}

function projectClaimPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
}

async function canonicalProjectIdentityClaimants(
  projects: Readonly<Record<string, ProjectRegistryEntryState>>,
  projectId: string
): Promise<CanonicalProjectIdentityClaimant[]> {
  const normalized = normalizeProjectIdentity(projectId);
  const matching = Object.entries(projects)
    .filter(
      ([, entry]) =>
        normalizeProjectIdentity(entry.projectId) === normalized
    )
    .sort(([left], [right]) => left.localeCompare(right));
  const byRoot = new Map<string, CanonicalProjectIdentityClaimant>();
  for (const [claimPath, entry] of matching) {
    const live = await pathIsDirectory(claimPath);
    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(claimPath);
    const root = live
      ? await resolveRegistrationRoot(canonicalPath)
      : canonicalPath;
    const key = projectClaimPathKey(root);
    const direct =
      projectClaimPathKey(claimPath) === projectClaimPathKey(root);
    const existing = byRoot.get(key);
    if (existing === undefined) {
      byRoot.set(key, {
        path: root,
        entry,
        live,
        registryPaths: [claimPath],
        direct,
        entryLive: live,
        liveAliasHomes: new Set(live && !direct ? [entry.home] : []),
        fixedMetadataConflict: false,
      });
      continue;
    }
    existing.registryPaths.push(claimPath);
    existing.live ||= live;
    if (live && !direct) existing.liveAliasHomes.add(entry.home);
    if (direct && !existing.direct) {
      existing.entry = entry;
      existing.direct = true;
      existing.entryLive = live;
    } else if (!existing.direct && live && !existing.entryLive) {
      existing.entry = entry;
      existing.entryLive = true;
    }
  }
  for (const claimant of byRoot.values()) {
    claimant.fixedMetadataConflict =
      !claimant.direct && claimant.liveAliasHomes.size > 1;
  }
  return [...byRoot.values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}


/**
 * Returns every machine-registry claim for one normalized project identity.
 * Claimants are path-sorted so every consumer reports the same ambiguity.
 */
export async function findProjectIdentityClaimants(
  projectId: string,
  options: ProjectPathOptions = {}
): Promise<ProjectIdentityClaimant[]> {
  const state = await readProjectRegistryState(options);
  if (state === null) return [];
  return (await canonicalProjectIdentityClaimants(state.projects, projectId)).map(
    claimant => ({
      path: claimant.path,
      entry: claimant.entry,
      live: claimant.live,
    })
  );
}

/**
 * Shared refusal text for a project identity claimed by multiple roots. Prune
 * is recommended only when it can help: at least one claimant is missing.
 */
export function formatProjectIdentityAmbiguity(
  projectId: string,
  claimants: readonly ProjectIdentityClaimant[]
): string {
  const ordered = [...claimants].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const inventory = ordered
    .map(claimant => `  - ${claimant.path} (${claimant.live ? 'live' : 'missing'})`)
    .join('\n');
  const hasMissing = ordered.some(claimant => !claimant.live);
  const repair = hasMissing
    ? 'Run `rasen home prune` to preview missing claims, then `rasen home prune --apply` to remove them and retry. If multiple live claims remain, repair their projectId metadata before retrying.'
    : 'All claimants are live. Assign distinct projectId metadata to independent copies or repair the registry before retrying; Rasen refuses to choose an owner.';
  return (
    `Project owner '${projectId}' resolves to more than one registered project root:\n` +
    `${inventory}\n${repair}`
  );
}

// -----------------------------------------------------------------------------
// Doctor: current-project lookup, dangling-entry reporting, GC
// -----------------------------------------------------------------------------

/**
 * Read-only lookup of this project's own registry entry, for doctor/probe use.
 * A linked worktree first pierces to the MAIN checkout entry so a legacy
 * worktree-keyed duplicate cannot shadow the canonical registration. If the
 * main checkout or its entry is gone, the direct worktree entry remains the
 * surviving-worktree fallback. Non-mutating.
 */
export async function findProjectRegistryEntry(
  projectRoot: string,
  options: ProjectPathOptions = {}
): Promise<{ canonicalPath: string; entry: ProjectRegistryEntryState } | null> {
  const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);
  const state = await readProjectRegistryState(options);
  if (!state) return null;

  const pierced = await resolveRegistrationRoot(canonicalPath);
  if (pierced !== canonicalPath) {
    const entry = state.projects[pierced];
    if (entry) return { canonicalPath: pierced, entry };
  }

  const direct = state.projects[canonicalPath];
  return direct ? { canonicalPath, entry: direct } : null;
}

export interface DanglingProjectEntry {
  path: string;
  entry: ProjectRegistryEntryState;
}

/** Registered paths that no longer exist on disk, machine-wide. Read-only. */
export async function findDanglingProjectEntries(
  options: ProjectPathOptions = {}
): Promise<DanglingProjectEntry[]> {
  const state = await readProjectRegistryState(options);
  if (!state) return [];

  const dangling: DanglingProjectEntry[] = [];
  for (const [entryPath, entry] of Object.entries(state.projects)) {
    if (!(await pathIsDirectory(entryPath))) {
      dangling.push({ path: entryPath, entry });
    }
  }
  return dangling;
}

export interface WorktreeDuplicateEntry {
  /** The worktree-keyed (duplicate) registry path. */
  path: string;
  entry: ProjectRegistryEntryState;
  /** The main checkout's canonical root this entry pierces to. */
  mainRoot: string;
}

/**
 * Worktree-duplicate registry entries (worktree-aware-spaces D5), machine-wide,
 * read-only: a live entry whose path is a linked worktree of a repository whose
 * MAIN checkout is itself registered under the same `projectId`. These are the
 * legacy per-worktree entries the new registration rule no longer creates;
 * `rasen doctor --gc` collapses them onto the main entry. Dangling entries
 * (path gone) are excluded here — they are `findDanglingProjectEntries`'s job.
 */
export async function findWorktreeDuplicateEntries(
  options: ProjectPathOptions = {}
): Promise<WorktreeDuplicateEntry[]> {
  const state = await readProjectRegistryState(options);
  if (!state) return [];

  const duplicates: WorktreeDuplicateEntry[] = [];
  for (const [entryPath, entry] of Object.entries(state.projects)) {
    if (!(await pathIsDirectory(entryPath))) continue;
    const pierced = await resolveRegistrationRoot(entryPath);
    if (pierced === entryPath) continue;
    const mainEntry = state.projects[pierced];
    if (
      mainEntry &&
      normalizeProjectIdentity(mainEntry.projectId) === normalizeProjectIdentity(entry.projectId)
    ) {
      duplicates.push({ path: entryPath, entry, mainRoot: pierced });
    }
  }
  return duplicates;
}

export interface GcProjectRegistryResult {
  removedEntries: DanglingProjectEntry[];
  /** Home directories actually deleted: no remaining entry (after removal)
   * references them, and the delete itself succeeded. */
  removedHomes: string[];
}

/**
 * Directory names under `<globalDataDir>/projects/` that no registry entry
 * (in `referencedHomes`) references at all — orphaned by a prior GC whose
 * `rm` failed, or a crash between the registry write and the `rm` (MINOR-4a).
 * Read-only; returns [] when the projects dir does not exist.
 */
async function listUnreferencedHomeDirs(
  referencedHomes: Set<string>,
  options: ProjectPathOptions
): Promise<string[]> {
  let entries: nodeFs.Dirent[];
  try {
    entries = await fs.readdir(getProjectsDir(options), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !referencedHomes.has(entry.name))
    .map((entry) => entry.name);
}

/**
 * `rasen doctor --gc`: removes dangling entries and deletes home directories
 * that no remaining entry references (reference-counted so a worktree-shared
 * home survives its sibling dangling entry), plus any home directory with NO
 * registry entry at all (MINOR-4a). The registry write and every deletion run
 * under ONE hold of the registry lock (MAJOR-1): a concurrent `registerProject`
 * cannot observe the post-removal registry and re-claim a home in the gap
 * before its directory is gone, because it cannot acquire the lock until this
 * entire function releases it. `removedHomes` reports only deletions that
 * actually succeeded (MINOR-4b). The registry is left untouched (no write) when
 * there are no dangling entries to remove (TRIVIAL-2). Doctor's default (no
 * `--gc`) path never calls this - doctor stays read-only unless the flag is
 * explicit.
 */
export async function gcProjectRegistry(
  options: ProjectPathOptions = {}
): Promise<GcProjectRegistryResult> {
  return withProjectRegistryLock(async () => {
    const current = await readProjectRegistryState(options);
    const projects: Record<string, ProjectRegistryEntryState> = { ...(current?.projects ?? {}) };

    // 1. Dangling entries (path gone): removed, and their homes become deletion
    //    candidates when no surviving entry references them (refcounted below).
    const danglingRemoved: DanglingProjectEntry[] = [];
    for (const [entryPath, entry] of Object.entries(projects)) {
      if (!(await pathIsDirectory(entryPath))) {
        danglingRemoved.push({ path: entryPath, entry });
        delete projects[entryPath];
      }
    }

    // 2. Worktree-duplicate collapse (D5), on entries that survived step 1:
    //    a live worktree entry whose pierced main root is registered under the
    //    same projectId is deleted (the main entry stays, sharing the home);
    //    when the main root exists on disk but is unregistered, the entry is
    //    rebound onto it (same entry data, same home). A collapsed home is
    //    always still referenced (shared with, or moved onto, the main entry),
    //    so it is NEVER a home-deletion candidate.
    const collapsedRemoved: DanglingProjectEntry[] = [];
    for (const [entryPath, entry] of Object.entries(projects)) {
      const pierced = await resolveRegistrationRoot(entryPath);
      if (pierced === entryPath) continue;
      const mainEntry = projects[pierced];
      if (mainEntry) {
        if (
          normalizeProjectIdentity(mainEntry.projectId) === normalizeProjectIdentity(entry.projectId)
        ) {
          collapsedRemoved.push({ path: entryPath, entry });
          delete projects[entryPath];
        }
        // A DIFFERENT project registered at the pierced root: leave both.
      } else if (await pathIsDirectory(pierced)) {
        collapsedRemoved.push({ path: entryPath, entry });
        delete projects[entryPath];
        projects[pierced] = entry;
      }
    }

    if (danglingRemoved.length > 0 || collapsedRemoved.length > 0) {
      await writeProjectRegistryState({ version: 1, projects }, options);
    }

    const referencedHomes = new Set(Object.values(projects).map((entry) => entry.home));
    const candidateHomes = new Set([
      ...danglingRemoved
        .map((removed) => removed.entry.home)
        .filter((home) => !referencedHomes.has(home)),
      ...(await listUnreferencedHomeDirs(referencedHomes, options)),
    ]);

    const removedHomes: string[] = [];
    for (const home of candidateHomes) {
      const deleted = await fs
        .rm(getProjectHomeDir(home, options), { recursive: true, force: true })
        .then(() => true)
        .catch(() => false);
      if (deleted) {
        removedHomes.push(home);
      }
    }

    return { removedEntries: [...danglingRemoved, ...collapsedRemoved], removedHomes };
  }, options);
}
