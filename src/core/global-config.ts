import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  PROJECTS_DIR_NAME,
  PROJECT_REGISTRY_FILE_NAME,
  parseProjectRegistryState,
  type ProjectRegistryState,
} from './project-registry.js';
import type { ThresholdValue } from './model-presets.js';
import {
  SUPPORTED_CLI_LOCALES,
  resolveCliLocale,
  type CliLanguage,
  type CliLocale,
} from '../utils/locale.js';
import {
  reportConfigDiagnostic,
  type ConfigDiagnosticReporter,
} from './config-diagnostics.js';
import { createConfigDiagnosticReporter } from './config-diagnostic-locale.js';
import { isRetentionMode, type RetentionMode } from './retention.js';

// Constants
export const GLOBAL_CONFIG_DIR_NAME = 'rasen';
export const GLOBAL_CONFIG_FILE_NAME = 'config.json';
export const GLOBAL_DATA_DIR_NAME = 'rasen';

/** Literal default machine-home directory name, joined onto os.homedir() on every platform. */
const RASEN_HOME_DIR_NAME = '.rasen';

// Pre-relocation brand directory name, adopted (with the pre-relocation `rasen`
// scheme) once by adoptLegacyMachineData().
const LEGACY_BRAND_DIR_NAME = 'openspec';

// TypeScript types
export type Profile = 'full' | 'core' | 'custom';
export type Language = CliLanguage;
export type RepoMode = 'solo' | 'collaborative';

function isLanguage(value: unknown): value is Language {
  return value === 'auto' || SUPPORTED_CLI_LOCALES.some((locale) => locale === value);
}

/**
 * Builds a locale-aware diagnostic reporter for `getGlobalConfig()`'s own
 * internal diagnostics, given a locale already resolved from data in scope
 * (never via `getCliLocale()`, which reads global config and would recreate
 * the `global-config.ts` <-> `cli-locale.ts` recursion this function exists
 * to avoid). Any failure constructing the reporter falls back to `undefined`
 * so `reportConfigDiagnostic`'s existing English-fallback path takes over —
 * a diagnostic must never be dropped because locale/catalog resolution
 * failed.
 */
function safeDefaultReporter(locale: CliLocale): ConfigDiagnosticReporter | undefined {
  try {
    return createConfigDiagnosticReporter(locale);
  } catch {
    return undefined;
  }
}

/**
 * Detects a retired `delivery` config value. The `delivery` setting itself
 * has been retired (skills are the only delivery surface now) — this is no
 * longer value normalization, just presence detection: ANY stored `delivery`
 * key, current (`both`/`skills`) or legacy (`commands`/`skills-first`/
 * `commands-first`), is retired the same way. Reading one must never error.
 */
export function isRetiredDeliveryValue(raw: unknown): raw is unknown {
  return raw !== undefined;
}

// TypeScript interfaces
export interface GlobalConfig {
  featureFlags?: Record<string, boolean>;
  /**
   * The user-wide profile. Widened from the {@link Profile} union to accept a
   * saved profile name (resolved by `resolveUserWideProfileBase`); the three
   * reserved literals still carry their special meaning. The YAML/JSON parser
   * already stores whatever string is on disk.
   */
  profile?: Profile | string;
  workflows?: string[];
  /**
   * The single retention mode the `rasen-retain` stage resolves to
   * (`off` | `report` | `codify`) — the version-2 profile dimension. Absent on
   * a v1 config; the effective value is then migrated from the workflow
   * selection (a former `retro-command` selection maps to `report`). Written
   * only by explicit profile writes, never fabricated on read.
   */
  retention?: RetentionMode;
  language?: Language;
  proactive?: boolean;
  repoMode?: RepoMode;
  /** Workset opener rows (slice 7.1); hand-edited, validated on use. */
  openers?: unknown;
  /**
   * Telemetry state, shared with `src/telemetry/config.ts`'s async accessor
   * (same file, same `telemetry` block). `enabled` is the CLI-settable
   * toggle; `anonymousId`/`noticeSeen` are machine-managed.
   */
  telemetry?: {
    enabled?: boolean;
    anonymousId?: string;
    noticeSeen?: boolean;
  };
  /**
   * Machine-managed migration marker for the expert install-semantics flip
   * (concept-coherence 6b). Absent/`false` = legacy: every built-in expert
   * continues to install regardless of profile, preserving pre-flip
   * behavior exactly (design.md D4). Set to `true` only by explicit
   * expert-aware write paths (the profile picker's `applyProfileState`,
   * `profile use`, `profile new`/`import`, and fresh `init`) — `update`
   * never sets it, so a project that is merely re-`update`d keeps every
   * expert forever until the user opens the picker.
   */
  expertSelectionExplicit?: boolean;
  /**
   * Baseline of built-in *workflow* ids (catalog `kind !== 'expert'`,
   * `source === 'built-in'`) known when the workflow selection was last
   * saved. Written by the selection-persisting paths (`applyProfileState`,
   * `profile use`/`import`, `init`, existing-user migration) and seeded
   * silently by `update` on first read for legacy configs. `update` uses it
   * to tell a workflow genuinely new to the catalog from one the user
   * deliberately deselected: a frozen (`custom`/override) selection surfaces
   * only built-ins absent from this baseline. Optional and additive — an
   * older binary that lacks it reads without error.
   */
  knownBuiltInWorkflows?: string[];
  /**
   * Context-handoff threshold; project config of the same name wins over
   * this. `roles` carries per-role overrides (planner/implementer/
   * reviewer/fixer/shipper) mirroring the pipeline registry's
   * `handoff.roles.<role>` shape — a role-specific value wins over the
   * scalar `threshold` at this same (global) scope tier.
   */
  handoff?: {
    threshold?: ThresholdValue;
    roles?: {
      planner?: ThresholdValue;
      implementer?: ThresholdValue;
      reviewer?: ThresholdValue;
      fixer?: ThresholdValue;
      shipper?: ThresholdValue;
    };
  };
  /**
   * Machine-wide autopilot defaults; project config of the same name wins
   * over this (see `resolveAutopilotGatePolicy`/`resolveAutopilotSelectionPolicy`
   * in project-config.ts, which take this block as their `globalConfig` layer).
   */
  autopilot?: {
    gates?: 'on' | 'off';
    selection?: 'classify' | 'manual' | 'compose';
  };
  /**
   * Machine-wide per-agent model defaults; project config of the same name
   * wins over this. `default` is the base model for every role; `roles`
   * overrides it per role (planner/implementer/reviewer/fixer/shipper).
   * Model ids are free strings — never validated against an allow-list.
   */
  models?: {
    default?: string;
    roles?: {
      planner?: string;
      implementer?: string;
      reviewer?: string;
      fixer?: string;
      shipper?: string;
    };
  };
  /**
   * UI-managed preferences. `pinnedSpaces` is the user's pinned planning
   * spaces as `<type>:<id>` selectors, written from the web Spaces page (or
   * `rasen config set`) — surviving a browser change and visible to the CLI.
   */
  ui?: {
    pinnedSpaces?: string[];
  };
  /**
   * Per-pipeline configuration overrides, keyed by pipeline name. The inner
   * records mirror the `pipelines.<name>.{gates,models,handoff}.<stage>` and
   * `pipelines.<name>.runtimes.<role>` config-key families (an unset instance
   * is absent, never defaulted). `gates`/`models`/`handoff` are keyed by stage;
   * `runtimes` is keyed by role. This `pipelines` block shares nothing with the
   * `rasen/pipelines/` directory namespace — it is config data keyed by pipeline
   * name, not stored pipeline definitions.
   */
  pipelines?: Record<
    string,
    {
      gates?: Record<string, 'on' | 'off'>;
      models?: Record<string, string>;
      handoff?: Record<string, ThresholdValue>;
      runtimes?: Record<string, 'claude' | 'codex'>;
    }
  >;
}

const DEFAULT_CONFIG: GlobalConfig = {
  featureFlags: {},
  profile: 'full',
  language: 'auto',
  proactive: true,
  repoMode: 'collaborative',
};

export interface GlobalDataDirOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
}

function joinGlobalDataPath(platform: NodeJS.Platform, ...segments: string[]): string {
  return platform === 'win32'
    ? path.win32.join(...segments)
    : path.posix.join(...segments);
}

/**
 * Resolves `RASEN_HOME` to an absolute path, or `undefined` when it is
 * unset/blank or points at something that already exists but is not a
 * directory (a genuinely unusable value — the caller falls back to the
 * default rather than failing). A relative value is resolved against the
 * current working directory rather than treated as unusable.
 *
 * Exported so other legacy-adoption-adjacent code (e.g.
 * `telemetry/config.ts`'s own legacy-telemetry merge) can honor the same
 * "an explicit RASEN_HOME is the user's choice; nothing else relocates"
 * contract `adoptLegacyMachineData` enforces, instead of re-deriving it.
 */
export function resolveRasenHome(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.RASEN_HOME;
  if (!raw || raw.trim() === '') return undefined;

  const resolved = path.resolve(raw);
  try {
    if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
      console.error(
        `Warning: RASEN_HOME ("${raw}") does not point to a directory; ignoring it and using the default machine home instead.`
      );
      return undefined;
    }
  } catch {
    // Cannot stat it (e.g. a permission error) — treat as usable; a genuine
    // problem surfaces from whatever operation tries to use it next.
  }
  return resolved;
}

/**
 * Gets the global configuration directory path.
 *
 * Precedence: `RASEN_HOME` (highest, resolved to an absolute path) >
 * `$XDG_CONFIG_HOME/rasen` (compatibility alias, kept for explicit-XDG
 * installs and test isolation) > `~/.rasen` (the default on every
 * platform). Platform application-data locations (`%APPDATA%`) are not
 * consulted.
 */
export function getGlobalConfigDir(options: GlobalDataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();
  const homedir = options.homedir ?? os.homedir();

  const rasenHome = resolveRasenHome(env);
  if (rasenHome) {
    return rasenHome;
  }

  // XDG_CONFIG_HOME stays honored as a compatibility alias below RASEN_HOME.
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return joinGlobalDataPath(platform, xdgConfigHome, GLOBAL_CONFIG_DIR_NAME);
  }

  return joinGlobalDataPath(platform, homedir, RASEN_HOME_DIR_NAME);
}

/**
 * Gets the global data directory path. Used for machine data: the project
 * registry and homes, the store registry, user schema/pipeline overrides,
 * and workset state.
 *
 * Precedence: `RASEN_HOME` (highest, resolved to an absolute path) >
 * `$XDG_DATA_HOME/rasen` (compatibility alias, kept for explicit-XDG
 * installs and test isolation) > `~/.rasen` (the default on every
 * platform). Platform application-data locations (`%LOCALAPPDATA%`) are not
 * consulted.
 */
export function getGlobalDataDir(options: GlobalDataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();
  const homedir = options.homedir ?? os.homedir();

  const rasenHome = resolveRasenHome(env);
  if (rasenHome) {
    return rasenHome;
  }

  // XDG_DATA_HOME stays honored as a compatibility alias below RASEN_HOME.
  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return joinGlobalDataPath(platform, xdgDataHome, GLOBAL_DATA_DIR_NAME);
  }

  return joinGlobalDataPath(platform, homedir, RASEN_HOME_DIR_NAME);
}

/**
 * Gets the path to the global config file.
 */
export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), GLOBAL_CONFIG_FILE_NAME);
}

/**
 * Loads the global configuration from disk.
 * Returns default configuration if file doesn't exist or is invalid.
 * Merges loaded config with defaults to ensure new fields are available.
 */
export interface GetGlobalConfigOptions {
  /** Receives locale-neutral diagnostics instead of writing legacy English output. */
  reporter?: ConfigDiagnosticReporter;
  /** Locale probing must not rewrite the file before the command can report a migration. */
  persistMigrations?: boolean;
}

export function getGlobalConfig(options: GetGlobalConfigOptions = {}): GlobalConfig {
  const configPath = getGlobalConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Merge with defaults (loaded values take precedence)
    const merged: GlobalConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      // Deep merge featureFlags
      featureFlags: {
        ...DEFAULT_CONFIG.featureFlags,
        ...(parsed.featureFlags || {})
      }
    };
    // The `delivery` setting is retired; never surface it, current or legacy.
    delete (merged as Record<string, unknown>).delivery;

    // Schema evolution: apply defaults for new fields if not present in loaded config
    if (parsed.profile === undefined) {
      merged.profile = DEFAULT_CONFIG.profile;
    }
    // Retention is never fabricated on read: an absent value stays absent so
    // the effective-retention resolver can migrate it from the workflow
    // selection; only an explicitly-stored invalid value is dropped.
    if (parsed.retention !== undefined && !isRetentionMode(parsed.retention)) {
      delete (merged as Record<string, unknown>).retention;
    }
    if (!isLanguage(parsed.language)) {
      merged.language = DEFAULT_CONFIG.language;
    }
    if (parsed.proactive === undefined) {
      merged.proactive = DEFAULT_CONFIG.proactive;
    }
    if (parsed.repoMode === undefined) {
      merged.repoMode = DEFAULT_CONFIG.repoMode;
    }

    // Retired `delivery` key: any stored value (current or legacy) is read
    // without error, reported once, and stripped on next write — it is never
    // treated as a live setting again.
    if (isRetiredDeliveryValue(parsed.delivery)) {
      reportConfigDiagnostic(
        {
          key: 'deliveryRetired',
          values: { legacy: String(parsed.delivery) },
          fallback: `Note: the 'delivery' setting has been retired (skills are the only delivery surface now). Removing '${String(parsed.delivery)}' from your config.`,
          output: 'error',
        },
        options.reporter ?? safeDefaultReporter(resolveCliLocale({ language: merged.language }))
      );
      if (options.persistMigrations !== false) {
        try {
          const { delivery: _delivery, ...rest } = parsed as Record<string, unknown>;
          saveGlobalConfig(rest as GlobalConfig);
        } catch {
          // Best-effort: persistence failure must not fail the read.
        }
      }
    }

    return merged;
  } catch (error) {
    // Log warning for parse errors, but not for missing files
    if (error instanceof SyntaxError) {
      reportConfigDiagnostic(
        {
          key: 'invalidGlobalJson',
          values: { path: configPath },
          fallback: `Warning: Invalid JSON in ${configPath}, using defaults`,
          output: 'error',
        },
        options.reporter ?? safeDefaultReporter(resolveCliLocale({}))
      );
    }
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Saves the global configuration to disk.
 * Creates the config directory if it doesn't exist.
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  const configDir = getGlobalConfigDir();
  const configPath = getGlobalConfigPath();

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Old-scheme (pre-relocation) data directory, computed explicitly — never derived from the new getter. */
function oldSchemeDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homedir: string): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    return localAppData
      ? joinGlobalDataPath(platform, localAppData, GLOBAL_DATA_DIR_NAME)
      : joinGlobalDataPath(platform, homedir, 'AppData', 'Local', GLOBAL_DATA_DIR_NAME);
  }
  return joinGlobalDataPath(platform, homedir, '.local', 'share', GLOBAL_DATA_DIR_NAME);
}

/** Old-scheme (pre-relocation) config directory, computed explicitly — never derived from the new getter. */
function oldSchemeConfigDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homedir: string): string {
  if (platform === 'win32') {
    const appData = env.APPDATA;
    return appData
      ? joinGlobalDataPath(platform, appData, GLOBAL_CONFIG_DIR_NAME)
      : joinGlobalDataPath(platform, homedir, 'AppData', 'Roaming', GLOBAL_CONFIG_DIR_NAME);
  }
  return joinGlobalDataPath(platform, homedir, '.config', GLOBAL_CONFIG_DIR_NAME);
}

function isExistingDirectory(target: string): boolean {
  try {
    return fs.existsSync(target) && fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Best-effort read of a `projects/registry.json` for D2 home-name mapping.
 * Never throws: a missing file, unreadable file, or invalid content all
 * resolve to `null` so adoption/presence-checking falls back to a
 * name-based comparison instead of failing.
 */
function readProjectsRegistryBestEffort(projectsDir: string): ProjectRegistryState | null {
  try {
    const registryPath = path.join(projectsDir, PROJECT_REGISTRY_FILE_NAME);
    if (!fs.existsSync(registryPath)) return null;
    return parseProjectRegistryState(fs.readFileSync(registryPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Resolves the destination home NAME for adopting an old `projects/<oldHome>/`
 * directory (D2): maps the old home's `projectId` (read from the OLD
 * registry) to the CURRENT registry's home for that same `projectId`, so
 * content merges into the referenced home rather than landing under a stale
 * name that `doctor --gc` would treat as unreferenced. Falls back to the old
 * home name — still lossless — when either registry is missing/unreadable or
 * no current entry shares the `projectId`; the GC sweep is a backstop, not a
 * silent deleter of referenced data.
 *
 * The schema does not enforce `home`/`projectId` uniqueness across OLD
 * registry entries (it's an unconstrained `Record<string, Entry>`), and
 * legacy/pre-relocation registries are exactly the data most likely to carry
 * that anomaly. Trusting an ambiguous mapping would let two DIFFERENT old
 * homes resolve to the SAME destination name: the second would be silently
 * dropped by the caller's never-overwrite guard, and this same function
 * (shared with the presence check) would then misreport it as "adopted" —
 * the false-positive "safe to delete" signal `rasen doctor` surfaces. Any
 * ambiguity (an old home with more than one registry entry disagreeing on
 * `projectId`, or a `projectId` claimed by more than one old home) falls
 * back to the old home's own name for every home in the ambiguous group
 * instead of picking an arbitrary "winner" — that name is guaranteed
 * collision-free (it is a real, unique directory name on disk), so no
 * destination collision can occur even when the registry lies.
 */
function resolveAdoptedHomeName(
  oldHome: string,
  oldRegistry: ProjectRegistryState | null,
  currentRegistry: ProjectRegistryState | null,
  warn: (message: string) => void = () => {}
): string {
  if (!oldRegistry || !currentRegistry) return oldHome;

  const oldEntries = Object.values(oldRegistry.projects).filter((entry) => entry.home === oldHome);
  if (oldEntries.length === 0) return oldHome;

  const distinctProjectIds = new Set(oldEntries.map((entry) => entry.projectId));
  if (distinctProjectIds.size > 1) {
    warn(
      `Warning: old registry has ambiguous entries for home "${oldHome}" (multiple projectIds); adopting it under its own name instead of mapping to the current registry.`
    );
    return oldHome;
  }

  const projectId = oldEntries[0].projectId;
  const homesSharingProjectId = new Set(
    Object.values(oldRegistry.projects)
      .filter((entry) => entry.projectId === projectId)
      .map((entry) => entry.home)
  );
  if (homesSharingProjectId.size > 1) {
    warn(
      `Warning: old registry maps projectId "${projectId}" to multiple homes (${[...homesSharingProjectId].sort().join(', ')}); adopting "${oldHome}" under its own name to avoid a destination collision.`
    );
    return oldHome;
  }

  const currentEntry = Object.values(currentRegistry.projects).find(
    (entry) => entry.projectId === projectId
  );
  return currentEntry ? currentEntry.home : oldHome;
}

/**
 * True when every top-level child of `oldDir` is present at `target` — the
 * per-child evidence that `oldDir` was actually adopted into `target`, not
 * merely "target happens to be non-empty" (which could be unrelated content,
 * or a partially-failed adoption where only some children made it over). An
 * `oldDir` with zero children has nothing to check for, so an existing
 * target trivially counts as "adopted." The `projects/` child is checked at
 * the finer D1 grain (below) rather than as one atomic presence check, so a
 * top-level `projects/` that exists but still has pending per-home content
 * correctly reads as NOT fully adopted.
 */
function oldDirFullyPresentIn(oldDir: string, target: string): boolean {
  if (!isExistingDirectory(target)) return false;
  let children: string[];
  try {
    children = fs.readdirSync(oldDir);
  } catch {
    return false;
  }
  if (children.length === 0) return true;
  return children.every((child) => {
    if (child === PROJECTS_DIR_NAME) {
      return projectsSubtreeFullyPresentIn(path.join(oldDir, child), path.join(target, child));
    }
    return fs.existsSync(path.join(target, child));
  });
}

/**
 * `projects/`-specific presence check at the D1 grain: recurses one level
 * and maps each old home to its current name (D2) the same way adoption
 * does, so an already-fully-adopted `projects/` subtree reads as adopted and
 * a partially-adopted one does not.
 */
function projectsSubtreeFullyPresentIn(oldProjectsDir: string, targetProjectsDir: string): boolean {
  if (!isExistingDirectory(targetProjectsDir)) return false;
  let children: string[];
  try {
    children = fs.readdirSync(oldProjectsDir);
  } catch {
    return false;
  }
  if (children.length === 0) return true;

  const oldRegistry = readProjectsRegistryBestEffort(oldProjectsDir);
  const currentRegistry = readProjectsRegistryBestEffort(targetProjectsDir);

  return children.every((child) => {
    if (!isExistingDirectory(path.join(oldProjectsDir, child))) {
      return fs.existsSync(path.join(targetProjectsDir, child));
    }
    const destName = resolveAdoptedHomeName(child, oldRegistry, currentRegistry);
    return fs.existsSync(path.join(targetProjectsDir, destName));
  });
}

/**
 * Copies one source path into `destChild` inside `targetDir`, all-or-nothing:
 * copied to a temp name and renamed into place, so a mid-copy crash never
 * leaves a partial child at its real name. Failures are reported via `warn`,
 * never thrown, and the temp name is best-effort cleaned up.
 */
function adoptSingleChild(
  srcChild: string,
  destChild: string,
  targetDir: string,
  warn: (message: string) => void
): void {
  const tempChild = path.join(
    targetDir,
    `.adopt-tmp-${path.basename(destChild)}-${process.pid}-${Date.now()}`
  );
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(srcChild, tempChild, { recursive: true });
    fs.renameSync(tempChild, destChild);
  } catch (error) {
    try {
      fs.rmSync(tempChild, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only.
    }
    warn(
      `Warning: could not adopt "${srcChild}" into "${destChild}" (${
        error instanceof Error ? error.message : String(error)
      }). Finish manually, e.g.: cp -r "${srcChild}" "${destChild}"`
    );
  }
}

/**
 * Adopts the `projects/` subtree at a finer grain than `adoptChildrenInto`'s
 * top-level-child atom (D1): called only when the target `projects/` already
 * exists (the fast path — target absent — stays the atomic whole-child copy
 * in `adoptChildrenInto`). Recurses into each old `projects/<home>/`
 * individually, still per-home all-or-nothing and never-overwrite, and lands
 * each one under the CURRENT registry's home name for the same `projectId`
 * (D2) rather than its old name. `projects/registry.json` itself is copied
 * only when the target lacks one entirely — never overwritten, since it is
 * read-only input to the mapping above (the "recorded facts over
 * recomputation" invariant).
 *
 * Never-overwrite skips are reported, but as ONE summary line per call
 * rather than one line per skipped item: this runs on every CLI startup
 * (`adoptLegacyMachineData` is called before `program.parse`), and a machine
 * with many already-adopted legacy homes would otherwise print one line per
 * home on every single command — confirmed live as a real output-volume
 * regression. The count still makes every skip visible without the spam;
 * per-item detail is recoverable by comparing the old and new `projects/`
 * directories directly (no new CLI surface added for it).
 */
function adoptProjectsSubtree(
  sourceProjectsDir: string,
  targetProjectsDir: string,
  warn: (message: string) => void
): void {
  let children: string[];
  try {
    children = fs.readdirSync(sourceProjectsDir);
  } catch {
    return;
  }

  const oldRegistry = readProjectsRegistryBestEffort(sourceProjectsDir);
  const currentRegistry = readProjectsRegistryBestEffort(targetProjectsDir);

  let skippedCount = 0;

  for (const child of children) {
    const srcChild = path.join(sourceProjectsDir, child);

    if (child === PROJECT_REGISTRY_FILE_NAME) {
      const destChild = path.join(targetProjectsDir, child);
      if (fs.existsSync(destChild)) {
        // Never overwrite the current registry — read-only input to the
        // mapping above.
        skippedCount++;
        continue;
      }
      adoptSingleChild(srcChild, destChild, targetProjectsDir, warn);
      continue;
    }

    if (!isExistingDirectory(srcChild)) continue; // only home directories are per-child adoption units here

    const destName = resolveAdoptedHomeName(child, oldRegistry, currentRegistry, warn);
    const destChild = path.join(targetProjectsDir, destName);
    if (fs.existsSync(destChild)) {
      // Never overwrite existing target content (per-home grain) — including
      // one masking a registry anomaly (resolveAdoptedHomeName already
      // warned about that case specifically).
      skippedCount++;
      continue;
    }

    adoptSingleChild(srcChild, destChild, targetProjectsDir, warn);
  }

  if (skippedCount > 0) {
    warn(
      `Note: ${skippedCount} legacy project ${
        skippedCount === 1 ? 'directory was' : 'directories were'
      } left behind, unadopted, under "${sourceProjectsDir}" (targets already exist). Compare it against "${targetProjectsDir}" to finish merging any of them manually.`
    );
  }
}

/**
 * Copies each top-level child of `sourceDir` into `targetDir`, all-or-nothing
 * per child: a child is copied to a temp name inside the target and renamed
 * into place, so a mid-copy crash never leaves a partial child at its real
 * name. A child that already exists at the target is left untouched (never
 * overwritten) — EXCEPT `projects/`, which recurses one level via
 * `adoptProjectsSubtree` when the target already has a `projects/` dir (D1):
 * a pre-existing target `projects/` no longer skips the whole legacy
 * subtree. Failures are per-child (one bad child never blocks the others)
 * and are reported via `warn`, never thrown.
 */
function adoptChildrenInto(sourceDir: string, targetDir: string, warn: (message: string) => void): void {
  let children: string[];
  try {
    children = fs.readdirSync(sourceDir);
  } catch {
    return;
  }

  for (const child of children) {
    const srcChild = path.join(sourceDir, child);
    const destChild = path.join(targetDir, child);

    if (child === PROJECTS_DIR_NAME && fs.existsSync(destChild)) {
      if (isExistingDirectory(srcChild)) {
        adoptProjectsSubtree(srcChild, destChild, warn);
      }
      continue;
    }

    if (fs.existsSync(destChild)) continue; // never overwrite existing target content

    adoptSingleChild(srcChild, destChild, targetDir, warn);
  }
}

/**
 * Adopts one old-scheme location into `targetDir`: the old-scheme `rasen`
 * directory wins if present; otherwise its legacy `openspec` brand sibling
 * (ancient installs hop straight to the new root in one copy). Only one of
 * the two contributes — this is a chain, not a merge of both.
 */
function adoptOneScheme(oldRasenDir: string, oldOpenspecDir: string, targetDir: string, warn: (message: string) => void): void {
  const source = isExistingDirectory(oldRasenDir)
    ? oldRasenDir
    : isExistingDirectory(oldOpenspecDir)
      ? oldOpenspecDir
      : null;
  if (!source) return;
  adoptChildrenInto(source, targetDir, warn);
}

/**
 * One-time, lossless adoption of machine data into the resolved config/data
 * locations, covering both the historical brand rename (`openspec` →
 * `rasen`) and the root relocation (platform-specific dirs → `~/.rasen`) as
 * one chain. Absorbs the former `migrateLegacyBrandConfig`.
 *
 * For each of the config and data resolutions (the same `~/.rasen` directory
 * under defaults):
 * - Skipped entirely when its environment override (`RASEN_HOME`, or the
 *   resolution's own XDG variable) is set — an explicit location is the
 *   user's choice; nothing relocates.
 * - Otherwise the old-scheme `rasen` directory is preferred, else its
 *   `openspec` sibling, and its children are copied into the target
 *   (see `adoptChildrenInto` for the per-child all-or-nothing contract).
 *
 * Best-effort and synchronous: every failure is swallowed or reported via a
 * loud warning, never thrown — this must never break CLI startup. Idempotent:
 * a completed adoption leaves nothing left for the next run to copy.
 */
export function adoptLegacyMachineData(options: GlobalDataDirOptions = {}): void {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();
  const homedir = options.homedir ?? os.homedir();
  const warn = (message: string) => console.error(message);

  try {
    const rasenHomeSet = resolveRasenHome(env) !== undefined;

    if (!rasenHomeSet && !env.XDG_DATA_HOME) {
      const newDataDir = getGlobalDataDir({ env, platform, homedir });
      const oldDataDir = oldSchemeDataDir(env, platform, homedir);
      const oldDataOpenspecDir = path.join(path.dirname(oldDataDir), LEGACY_BRAND_DIR_NAME);
      try {
        adoptOneScheme(oldDataDir, oldDataOpenspecDir, newDataDir, warn);
      } catch {
        // Best-effort per resolution; a failure here must never break startup.
      }
    }

    if (!rasenHomeSet && !env.XDG_CONFIG_HOME) {
      const newConfigDir = getGlobalConfigDir({ env, platform, homedir });
      const oldConfigDir = oldSchemeConfigDir(env, platform, homedir);
      const oldConfigOpenspecDir = path.join(path.dirname(oldConfigDir), LEGACY_BRAND_DIR_NAME);
      try {
        adoptOneScheme(oldConfigDir, oldConfigOpenspecDir, newConfigDir, warn);
      } catch {
        // Best-effort per resolution; a failure here must never break startup.
      }
    }
  } catch {
    // Best-effort; never break startup.
  }
}

export interface MachineRootRelocationCheck {
  /** The old-scheme directory found on disk (a `rasen`-scheme dir, or its `openspec` sibling). */
  path: string;
  /** The resolved location this old directory adopts into. */
  target: string;
  /** True when every top-level child of this old dir is present at the target (relocation of THIS old dir succeeded; it is now a leftover). False means relocation of this old dir is pending, partially failed, or the target's content is unrelated to it. */
  targetHasContent: boolean;
}

/**
 * Read-only probe for `rasen doctor`'s relocation note (D4): reports which
 * old-scheme directories still exist on disk and whether their target
 * already has adopted content. Resolutions with an active environment
 * override are skipped (relocation does not apply to them). Returns an
 * empty array in the clean state — no old-scheme directory found.
 */
export function checkMachineRootRelocation(options: GlobalDataDirOptions = {}): MachineRootRelocationCheck[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();
  const homedir = options.homedir ?? os.homedir();
  const rasenHomeSet = resolveRasenHome(env) !== undefined;

  const results: MachineRootRelocationCheck[] = [];
  const seenOldPaths = new Set<string>();

  function checkScheme(oldDir: string, oldOpenspecDir: string, target: string, overrideActive: boolean): void {
    if (overrideActive) return;
    const foundOld = isExistingDirectory(oldDir) ? oldDir : isExistingDirectory(oldOpenspecDir) ? oldOpenspecDir : null;
    if (!foundOld || seenOldPaths.has(foundOld)) return;
    seenOldPaths.add(foundOld);
    const targetHasContent = oldDirFullyPresentIn(foundOld, target);
    results.push({ path: foundOld, target, targetHasContent });
  }

  const oldDataDir = oldSchemeDataDir(env, platform, homedir);
  checkScheme(
    oldDataDir,
    path.join(path.dirname(oldDataDir), LEGACY_BRAND_DIR_NAME),
    getGlobalDataDir({ env, platform, homedir }),
    rasenHomeSet || Boolean(env.XDG_DATA_HOME)
  );

  const oldConfigDir = oldSchemeConfigDir(env, platform, homedir);
  checkScheme(
    oldConfigDir,
    path.join(path.dirname(oldConfigDir), LEGACY_BRAND_DIR_NAME),
    getGlobalConfigDir({ env, platform, homedir }),
    rasenHomeSet || Boolean(env.XDG_CONFIG_HOME)
  );

  return results;
}
