import { FileSystemUtils } from '../utils/file-system.js';
import { classifyOpenSpecDir, ensureProjectIdInConfig, readProjectConfig } from './project-config.js';
import {
  deriveProjectDisplayName,
  getProjectHomeDir,
  readProjectRegistryState,
  registerProject,
  type ProjectMode,
  type ProjectPathOptions,
} from './project-registry.js';

const SELF_HEAL_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * The frozen resolver API (design child `externalize-artifacts-machine-
 * home`, D5): the single entry point later children (T3 workdir, external
 * archive) use to place machine-local project state. The home's internal
 * layout (`changes/<name>/work/`, `archive/`) is decided once, here.
 */
export interface ProjectHome {
  projectId: string;
  name: string;
  mode: ProjectMode;
  /** Absolute: <globalDataDir>/projects/<home> */
  homeDir: string;
  /** Absolute: <homeDir>/changes/<changeName>/work — T3 root for child 2. */
  workDir(changeName: string): string;
  /** Absolute: <homeDir>/archive — external archive destination for child 4. */
  archiveDir: string;
}

export interface ResolveProjectHomeOptions {
  /** Test/DI override; defaults to getGlobalDataDir() (store-code precedent). */
  globalDataDir?: string;
  /**
   * true (default): mint projectId + register + create the home dir if needed.
   * false: resolve only; returns null when the project has no identity yet.
   */
  ensure?: boolean;
}

function buildProjectHome(
  projectId: string,
  name: string,
  mode: ProjectMode,
  home: string,
  pathOptions: ProjectPathOptions
): ProjectHome {
  const homeDir = getProjectHomeDir(home, pathOptions);
  return {
    projectId,
    name,
    mode,
    homeDir,
    workDir: (changeName: string) => FileSystemUtils.joinPath(homeDir, 'changes', changeName, 'work'),
    archiveDir: FileSystemUtils.joinPath(homeDir, 'archive'),
  };
}

/**
 * A config-only pointer directory (no planning shape, declares a `store:`
 * pointer) registers as `store`; every other planning root (including a
 * store's own root) registers as `in-repo` (design D1).
 */
function deriveProjectMode(projectRoot: string): ProjectMode {
  const { hasPlanningShape, pointer } = classifyOpenSpecDir(projectRoot);
  return !hasPlanningShape && pointer.value !== undefined ? 'store' : 'in-repo';
}

/**
 * Resolves the machine-local home for `projectRoot` (a directory containing
 * `rasen/`, either a repo root or a store root). `ensure: true` (default)
 * mints identity and registers the project, creating `homeDir` if absent.
 * `ensure: false` is a non-mutating probe: it creates neither config
 * changes, registry entries, nor directories, and returns null when the
 * project has no identity or registry entry yet.
 */
export async function resolveProjectHome(
  projectRoot: string,
  options: ResolveProjectHomeOptions = {}
): Promise<ProjectHome | null> {
  const pathOptions: ProjectPathOptions =
    options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};
  const ensure = options.ensure ?? true;

  if (!ensure) {
    const config = readProjectConfig(projectRoot);
    if (!config?.projectId) {
      return null;
    }

    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);
    const state = await readProjectRegistryState(pathOptions);
    const entry = state?.projects[canonicalPath];
    if (!entry) {
      return null;
    }

    return buildProjectHome(entry.projectId, entry.name, entry.mode, entry.home, pathOptions);
  }

  const mode = deriveProjectMode(projectRoot);
  const projectId = await ensureProjectIdInConfig(projectRoot, pathOptions);
  const { entry } = await registerProject({ projectRoot, projectId, mode }, pathOptions);
  return buildProjectHome(entry.projectId, entry.name, entry.mode, entry.home, pathOptions);
}

export interface TouchProjectRegistryOptions {
  globalDataDir?: string;
}

/**
 * Registry self-healing (design D6): a best-effort, throttled touch invoked
 * from every root-resolving command. Skips entirely when the project's
 * config has no `projectId` (no minting here - that is `resolveProjectHome`'s
 * job). When the registry entry is already current (path/name/mode match
 * and `lastSeen` is under 24h old), this is a lock-free read and no write
 * happens. Otherwise the entry is refreshed under the registry lock. Every
 * failure is swallowed: a broken registry must never fail or visibly slow a
 * user command (same contract as `migrateLegacyBrandConfig`).
 */
export async function touchProjectRegistry(
  projectRoot: string,
  options: TouchProjectRegistryOptions = {}
): Promise<void> {
  try {
    const config = readProjectConfig(projectRoot);
    if (!config?.projectId) {
      return;
    }

    const pathOptions: ProjectPathOptions =
      options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {};
    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);
    const mode = deriveProjectMode(projectRoot);
    const name = deriveProjectDisplayName(canonicalPath);

    const state = await readProjectRegistryState(pathOptions);
    const entry = state?.projects[canonicalPath];
    const isCurrent =
      entry !== undefined &&
      entry.projectId === config.projectId &&
      entry.name === name &&
      entry.mode === mode;

    if (isCurrent) {
      const lastSeenMs = Date.parse(entry.lastSeen);
      const ageMs = Date.now() - lastSeenMs;
      if (Number.isFinite(ageMs) && ageMs < SELF_HEAL_STALE_THRESHOLD_MS) {
        return; // Current and recently seen: no write needed.
      }
    }

    await registerProject({ projectRoot, projectId: config.projectId, mode }, pathOptions);
  } catch {
    // Best-effort; registry problems must never break a user command.
  }
}
