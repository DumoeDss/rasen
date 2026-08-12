import { FileSystemUtils } from '../utils/file-system.js';
import {
  classifyOpenSpecDir,
  ensureProjectIdInConfig,
  hasStoreDeclaration,
  readProjectConfig,
} from './project-config.js';
import {
  deriveProjectDisplayName,
  findProjectRegistryEntry,
  getProjectHomeDir,
  readProjectRegistryState,
  refreshRegisteredProject,
  registerProject,
  resolveRegistrationRoot,
  type ProjectMode,
  type ProjectPathOptions,
} from './project-registry.js';
import { SKILL_NAMES, extractGeneratedByVersion, getConfiguredTools } from './shared/tool-detection.js';
import { AI_TOOLS } from './config.js';
import { normalizeProjectIdentity } from './store/project-records.js';
import { resolveToolSkillsRoot } from './shared/tool-detection.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
  /**
   * Absolute: <homeDir>/changes/archive/<archivedDirName>/work — the
   * migration destination for ephemera found in an ARCHIVED change
   * directory (`migrate-legacy-ephemera` D3). Keyed by the on-disk
   * date-prefixed archived directory name (e.g. `2026-07-06-foo`), never
   * the bare change name, so a migrated archive can never collide with
   * `workDir` of a live change sharing that base name. Distinct from
   * `archiveDir` (the external archive-destination axis, child 4) — this
   * is a work-ephemera area, not a spec-sync/bookkeeping destination.
   */
  archivedWorkDir(archivedDirName: string): string;
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
    archivedWorkDir: (archivedDirName: string) =>
      FileSystemUtils.joinPath(homeDir, 'changes', 'archive', archivedDirName, 'work'),
  };
}

/**
 * A config-only pointer directory (no planning shape, declares a `store:`
 * pointer) registers as `store`; every other planning root (including a
 * store's own root) registers as `in-repo` (design D1).
 */
function deriveProjectMode(projectRoot: string): ProjectMode {
  const { hasPlanningShape, pointer } = classifyOpenSpecDir(projectRoot);
  // `hasStoreDeclaration`, never `pointer.value`: a durable declaration may
  // record only the permanent identity, and checking the display alias alone
  // would derive `in-repo` for it — a wrong value that then persists into the
  // machine project registry.
  return !hasPlanningShape && hasStoreDeclaration(pointer) ? 'store' : 'in-repo';
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

    const registered = await findProjectRegistryEntry(projectRoot, pathOptions);
    if (!registered) {
      return null;
    }
    const { entry } = registered;
    if (
      normalizeProjectIdentity(entry.projectId) !==
      normalizeProjectIdentity(config.projectId)
    ) {
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
  /**
   * Optional cache refresh inputs (project-install-manifest spec). When
   * supplied, the entry's `tools` and `installedVersion` cache fields are
   * updated alongside the regular self-heal. When absent, the self-heal
   * reads `generatedBy` from one surviving skill file as the ground truth
   * for `installedVersion` (when the cache is empty or stale), and mirrors
   * the project's `tools:` manifest when readable.
   */
  tools?: string[];
  installedVersion?: string;
}

/**
 * Registry self-healing (design D6): a best-effort, throttled touch invoked
 * from every root-resolving command. Skips entirely when the project's
 * config has no `projectId` (no minting here - that is `resolveProjectHome`'s
 * job). When the registry entry is already current (path/name/mode match
 * and `lastSeen` is under 24h old), this is a lock-free read and no write
 * happens. Otherwise the entry is refreshed under the registry lock. Every
 * failure is swallowed: a broken registry must never fail or visibly slow a
 * user command (same contract as `adoptLegacyMachineData`).
 *
 * The 24h staleness threshold that gates `lastSeen` refresh also gates the
 * version cache refresh: a cache written within 24h is not re-read. When
 * the caller supplies explicit `installedVersion`/`tools` (e.g. from
 * `rasen update`), the staleness check is bypassed and the cache is always
 * refreshed — the caller is the authoritative source.
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
    // Self-heal targets the canonical (pierced) root (D1): a run inside a linked
    // worktree refreshes the MAIN checkout's entry, deriving the entry key,
    // name, and mode from the main checkout — never from the worktree's
    // basename or a branch that happens to lack planning shape. The projectId
    // still comes from the run's actual root config (branch-local but committed,
    // so it is the shared identity).
    const canonicalInput = FileSystemUtils.canonicalizeExistingPath(projectRoot);
    const canonicalPath = await resolveRegistrationRoot(canonicalInput);
    const mode = deriveProjectMode(canonicalPath);
    const name = deriveProjectDisplayName(canonicalPath);

    const state = await readProjectRegistryState(pathOptions);
    const entry = state?.projects[canonicalPath];
    const isCurrent =
      entry !== undefined &&
      entry.projectId === config.projectId &&
      entry.name === name &&
      entry.mode === mode;

    const hasCallerCache =
      options.tools !== undefined || options.installedVersion !== undefined;

    if (isCurrent && !hasCallerCache) {
      const lastSeenMs = Date.parse(entry.lastSeen);
      const ageMs = Date.now() - lastSeenMs;
      if (Number.isFinite(ageMs) && ageMs < SELF_HEAL_STALE_THRESHOLD_MS) {
        return; // Current and recently seen: no write needed.
      }
    }

    // When the caller did not supply explicit cache fields, read
    // `generatedBy` from one surviving skill file as ground truth for
    // `installedVersion`, and mirror the project's `tools:` manifest.
    const cacheInputs: { tools?: string[]; installedVersion?: string } = {};
    if (hasCallerCache) {
      if (options.tools !== undefined) cacheInputs.tools = options.tools;
      if (options.installedVersion !== undefined) cacheInputs.installedVersion = options.installedVersion;
    } else {
      // Version: read one surviving skill file via the same iteration
      // getToolVersionStatus uses (SKILL_NAMES × configured tools).
      const toolsForVersion = config.tools ?? getConfiguredTools(projectRoot);
      let detectedVersion: string | null = null;
      outer: for (const toolId of toolsForVersion) {
        const tool = AI_TOOLS.find((t) => t.value === toolId);
        if (!tool?.skillsDir) continue;
        const skillsDir = resolveToolSkillsRoot(tool, projectRoot);
        for (const skillName of SKILL_NAMES) {
          const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            detectedVersion = extractGeneratedByVersion(skillFile);
            if (detectedVersion !== null) break outer;
            // Intentional divergence from getToolVersionStatus: that function
            // accepts the first existing SKILL.md and uses its version even
            // when null. The self-heal instead moves to the NEXT TOOL, because
            // a null `generatedBy` means the skill file predates version
            // stamping — another tool's file is a better signal, and falling
            // back to null here would set installedVersion to undefined when a
            // sibling tool has a real stamp. Safer for the cache.
            break;
          }
        }
      }
      if (detectedVersion !== null) {
        cacheInputs.installedVersion = detectedVersion;
      }
      // Tools mirror: when config is readable, mirror its `tools:` key.
      if (config.tools !== undefined) {
        cacheInputs.tools = config.tools;
      }
    }

    const cacheChanged = cacheInputs.tools !== undefined || cacheInputs.installedVersion !== undefined;
    await refreshRegisteredProject(
      {
        projectRoot,
        projectId: config.projectId,
        mode,
        ...(cacheInputs.tools !== undefined ? { tools: cacheInputs.tools } : {}),
        ...(cacheInputs.installedVersion !== undefined
          ? { installedVersion: cacheInputs.installedVersion }
          : {}),
        // `lastUpdated` tracks the version/tools cache write specifically, not
        // every self-heal touch (project-install-manifest spec). When no cache
        // fields were written/refreshed this touch, omit it so the semantic
        // matches the spec: the field records when the cache last advanced.
        ...(cacheChanged ? { lastUpdated: new Date().toISOString() } : {}),
      },
      pathOptions
    );
  } catch {
    // Best-effort; registry problems must never break a user command.
  }
}
