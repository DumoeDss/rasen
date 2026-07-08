import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Constants
export const GLOBAL_CONFIG_DIR_NAME = 'rasen';
export const GLOBAL_CONFIG_FILE_NAME = 'config.json';
export const GLOBAL_DATA_DIR_NAME = 'rasen';

// Pre-rename brand directory name, adopted once by migrateLegacyBrandConfig().
const LEGACY_BRAND_DIR_NAME = 'openspec';

// TypeScript types
export type Profile = 'full' | 'core' | 'custom';
export type Delivery = 'both' | 'skills' | 'commands' | 'skills-first' | 'commands-first';
export type RepoMode = 'solo' | 'collaborative';

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

/**
 * Gets the global configuration directory path following XDG Base Directory Specification.
 *
 * - All platforms: $XDG_CONFIG_HOME/rasen/ if XDG_CONFIG_HOME is set
 * - Unix/macOS fallback: ~/.config/rasen/
 * - Windows fallback: %APPDATA%/rasen/
 */
export function getGlobalConfigDir(): string {
  // XDG_CONFIG_HOME takes precedence on all platforms when explicitly set
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, GLOBAL_CONFIG_DIR_NAME);
  }

  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: use %APPDATA%
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, GLOBAL_CONFIG_DIR_NAME);
    }
    // Fallback for Windows if APPDATA is not set
    return path.join(os.homedir(), 'AppData', 'Roaming', GLOBAL_CONFIG_DIR_NAME);
  }

  // Unix/macOS fallback: ~/.config
  return path.join(os.homedir(), '.config', GLOBAL_CONFIG_DIR_NAME);
}

/**
 * Gets the global data directory path following XDG Base Directory Specification.
 * Used for user data like schema overrides.
 *
 * - All platforms: $XDG_DATA_HOME/rasen/ if XDG_DATA_HOME is set
 * - Unix/macOS fallback: ~/.local/share/rasen/
 * - Windows fallback: %LOCALAPPDATA%/rasen/
 */
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

export function getGlobalDataDir(options: GlobalDataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();

  // XDG_DATA_HOME takes precedence on all platforms when explicitly set
  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return joinGlobalDataPath(platform, xdgDataHome, GLOBAL_DATA_DIR_NAME);
  }

  const homedir = options.homedir ?? os.homedir();

  if (platform === 'win32') {
    // Windows: use %LOCALAPPDATA%
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
      return joinGlobalDataPath(platform, localAppData, GLOBAL_DATA_DIR_NAME);
    }
    // Fallback for Windows if LOCALAPPDATA is not set
    return joinGlobalDataPath(platform, homedir, 'AppData', 'Local', GLOBAL_DATA_DIR_NAME);
  }

  // Unix/macOS fallback: ~/.local/share
  return joinGlobalDataPath(platform, homedir, '.local', 'share', GLOBAL_DATA_DIR_NAME);
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

/**
 * One-time adoption of a pre-rename `openspec` brand directory.
 *
 * For each resolved new-brand directory (config and data, across every
 * XDG / APPDATA / LOCALAPPDATA / ~/.config / ~/.local/share variant), if the
 * new directory is absent but the sibling legacy `openspec` directory exists,
 * recursively copy it into the new location so `config.json` (with the
 * telemetry `anonymousId` / `noticeSeen`) carries over verbatim.
 *
 * Contract:
 * - Never overwrite an existing new-brand directory (copy only when absent).
 * - Never delete the legacy directory (copy-then-leave-original).
 * - Best-effort: all filesystem errors are swallowed so this can never break
 *   CLI startup. It must not silently drop data — hence copy, not move.
 */
export function migrateLegacyBrandConfig(): void {
  try {
    const targets = [getGlobalConfigDir(), getGlobalDataDir()];
    for (const newDir of targets) {
      try {
        // Never overwrite an already-adopted new-brand directory.
        if (fs.existsSync(newDir)) continue;

        const legacyDir = path.join(path.dirname(newDir), LEGACY_BRAND_DIR_NAME);
        // Nothing to adopt if the brand name did not actually change.
        if (legacyDir === newDir) continue;
        if (!fs.existsSync(legacyDir) || !fs.statSync(legacyDir).isDirectory()) continue;

        fs.mkdirSync(path.dirname(newDir), { recursive: true });
        fs.cpSync(legacyDir, newDir, { recursive: true });
      } catch {
        // Best-effort per target; a failure here must never break startup.
      }
    }
  } catch {
    // Best-effort; never break startup.
  }
}
