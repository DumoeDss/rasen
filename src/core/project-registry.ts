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

// -----------------------------------------------------------------------------
// Registration (design D4 algorithm)
// -----------------------------------------------------------------------------

export interface RegisterProjectInput {
  /** Project root; canonicalized internally. */
  projectRoot: string;
  projectId: string;
  mode: ProjectMode;
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
  const canonicalPath = FileSystemUtils.canonicalizeExistingPath(input.projectRoot);
  const name = deriveProjectDisplayName(canonicalPath);
  const now = () => new Date().toISOString();

  let resolvedEntry: ProjectRegistryEntryState | undefined;

  await updateProjectRegistryState(async (current) => {
    const projects: Record<string, ProjectRegistryEntryState> = { ...(current?.projects ?? {}) };

    async function place(home: string, projectId: string): Promise<void> {
      resolvedEntry = { projectId, name, mode: input.mode, home, lastSeen: now() };
      projects[canonicalPath] = resolvedEntry;
      await FileSystemUtils.createDirectory(getProjectHomeDir(home, options));
    }

    // 1. Path-exact match: update in place. home/projectId never change.
    const existingAtPath = projects[canonicalPath];
    if (existingAtPath) {
      await place(existingAtPath.home, existingAtPath.projectId);
      return { version: 1, projects };
    }

    const sameIdEntries = Object.entries(projects).filter(
      ([, entry]) => entry.projectId === input.projectId
    );

    // 2a. Worktree share: an entry with the same projectId whose path still
    // exists and is a Git worktree of the same repository. Checked BEFORE
    // the moved-repo rebind below (MINOR-1): a dangling same-id entry left
    // by a deleted clone must not hijack a genuine worktree of a DIFFERENT,
    // still-live same-id entry onto the dead clone's home. Paths that no
    // longer exist on disk never match here (isGitWorktreeSibling shells to
    // git, which fails for a missing directory), so this loop cannot
    // accidentally consume a moved-repo candidate.
    for (const [otherPath, entry] of sameIdEntries) {
      if (await isGitWorktreeSibling(canonicalPath, otherPath)) {
        await place(entry.home, entry.projectId);
        return { version: 1, projects };
      }
    }

    // 2b. Moved repo: an entry with the same projectId whose path no longer
    // exists on disk. Rebind it to the new path, reusing its home.
    for (const [oldPath, entry] of sameIdEntries) {
      if (!(await pathIsDirectory(oldPath))) {
        delete projects[oldPath];
        await place(entry.home, entry.projectId);
        return { version: 1, projects };
      }
    }

    // 2c. Clone fork (also the fresh-projectId path): distinct home, first
    // free integer suffix when the base name collides.
    const baseHome = deriveHomeBaseName(canonicalPath, input.projectId);
    const usedHomes = new Set(Object.values(projects).map((entry) => entry.home));
    let home = baseHome;
    if (usedHomes.has(home)) {
      let suffix = 2;
      while (usedHomes.has(`${baseHome}-${suffix}`)) suffix++;
      home = `${baseHome}-${suffix}`;
    }
    await place(home, input.projectId);
    return { version: 1, projects };
  }, options);

  return { entry: resolvedEntry!, canonicalPath };
}

// -----------------------------------------------------------------------------
// Doctor: current-project lookup, dangling-entry reporting, GC
// -----------------------------------------------------------------------------

/** Read-only lookup of this project's own registry entry, for doctor/probe use. */
export async function findProjectRegistryEntry(
  projectRoot: string,
  options: ProjectPathOptions = {}
): Promise<{ canonicalPath: string; entry: ProjectRegistryEntryState } | null> {
  const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);
  const state = await readProjectRegistryState(options);
  const entry = state?.projects[canonicalPath];
  return entry ? { canonicalPath, entry } : null;
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
    const removedEntries: DanglingProjectEntry[] = [];

    for (const [entryPath, entry] of Object.entries(projects)) {
      if (!(await pathIsDirectory(entryPath))) {
        removedEntries.push({ path: entryPath, entry });
        delete projects[entryPath];
      }
    }

    if (removedEntries.length > 0) {
      await writeProjectRegistryState({ version: 1, projects }, options);
    }

    const referencedHomes = new Set(Object.values(projects).map((entry) => entry.home));
    const candidateHomes = new Set([
      ...removedEntries
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

    return { removedEntries, removedHomes };
  }, options);
}
