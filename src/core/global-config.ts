import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
export type Delivery = 'both' | 'skills';
type LegacyDelivery = 'commands' | 'skills-first' | 'commands-first';
export type RepoMode = 'solo' | 'collaborative';

const LEGACY_DELIVERY_MAP: Record<LegacyDelivery, Delivery> = {
  'skills-first': 'skills',
  'commands': 'both',
  'commands-first': 'both',
};

function isLegacyDelivery(value: unknown): value is LegacyDelivery {
  return value === 'commands' || value === 'skills-first' || value === 'commands-first';
}

/**
 * Normalizes a raw `delivery` value read from disk into the current 2-value
 * `Delivery` union. Recognized legacy values (`commands`, `skills-first`,
 * `commands-first`) map onto their consolidated equivalent; anything else
 * (unrecognized strings, undefined, garbage) falls back to the default
 * `'both'` without being treated as a legacy migration.
 */
export function normalizeDelivery(raw: unknown): { delivery: Delivery; legacy?: LegacyDelivery } {
  if (raw === 'both' || raw === 'skills') {
    return { delivery: raw };
  }
  if (isLegacyDelivery(raw)) {
    return { delivery: LEGACY_DELIVERY_MAP[raw], legacy: raw };
  }
  return { delivery: DEFAULT_CONFIG.delivery! };
}

// TypeScript interfaces
export interface GlobalConfig {
  featureFlags?: Record<string, boolean>;
  profile?: Profile;
  delivery?: Delivery;
  workflows?: string[];
  proactive?: boolean;
  repoMode?: RepoMode;
  /** Workset opener rows (slice 7.1); hand-edited, validated on use. */
  openers?: unknown;
}

const DEFAULT_CONFIG: GlobalConfig = {
  featureFlags: {},
  profile: 'full',
  delivery: 'both',
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
export function getGlobalConfig(): GlobalConfig {
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

    // Schema evolution: apply defaults for new fields if not present in loaded config
    if (parsed.profile === undefined) {
      merged.profile = DEFAULT_CONFIG.profile;
    }
    if (parsed.delivery === undefined) {
      merged.delivery = DEFAULT_CONFIG.delivery;
    }
    if (parsed.proactive === undefined) {
      merged.proactive = DEFAULT_CONFIG.proactive;
    }
    if (parsed.repoMode === undefined) {
      merged.repoMode = DEFAULT_CONFIG.repoMode;
    }

    // Legacy delivery values (commands / skills-first / commands-first) are
    // consolidated into the 2-value system: map, notify once, and persist so
    // subsequent reads see the new value directly (no notice repeats).
    if (parsed.delivery !== undefined) {
      const { delivery, legacy } = normalizeDelivery(parsed.delivery);
      merged.delivery = delivery;
      if (legacy) {
        console.error(
          `Note: delivery mode '${legacy}' has been consolidated into '${delivery}' (skills are always installed). Your config has been updated.`
        );
        try {
          saveGlobalConfig({ ...merged, delivery });
        } catch {
          // Best-effort: persistence failure must not fail the read.
        }
      }
    }

    return merged;
  } catch (error) {
    // Log warning for parse errors, but not for missing files
    if (error instanceof SyntaxError) {
      console.error(`Warning: Invalid JSON in ${configPath}, using defaults`);
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
 * True when every top-level child of `oldDir` is present at `target` — the
 * per-child evidence that `oldDir` was actually adopted into `target`, not
 * merely "target happens to be non-empty" (which could be unrelated content,
 * or a partially-failed adoption where only some children made it over). An
 * `oldDir` with zero children has nothing to check for, so an existing
 * target trivially counts as "adopted."
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
  return children.every((child) => fs.existsSync(path.join(target, child)));
}

/**
 * Copies each top-level child of `sourceDir` into `targetDir`, all-or-nothing
 * per child: a child is copied to a temp name inside the target and renamed
 * into place, so a mid-copy crash never leaves a partial child at its real
 * name. A child that already exists at the target is left untouched (never
 * overwritten). Failures are per-child (one bad child never blocks the
 * others) and are reported via `warn`, never thrown.
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
    if (fs.existsSync(destChild)) continue; // never overwrite existing target content

    const tempChild = path.join(targetDir, `.adopt-tmp-${child}-${process.pid}-${Date.now()}`);
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
