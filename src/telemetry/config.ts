/**
 * Global configuration for telemetry state.
 * Stores anonymous ID and notice-seen flag in the platform-appropriate config directory.
 */
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  GLOBAL_CONFIG_DIR_NAME,
  GLOBAL_CONFIG_FILE_NAME,
  getGlobalConfigDir,
  resolveRasenHome,
} from '../core/global-config.js';

// Constants
export const CONFIG_DIR_NAME = GLOBAL_CONFIG_DIR_NAME;
export const CONFIG_FILE_NAME = GLOBAL_CONFIG_FILE_NAME;

export interface TelemetryConfig {
  anonymousId?: string;
  noticeSeen?: boolean;
}

export interface GlobalConfig {
  telemetry?: TelemetryConfig;
  [key: string]: unknown; // Preserve other fields
}

type ConfigReadResult =
  | { status: 'missing' }
  | { status: 'ok'; config: GlobalConfig }
  | { status: 'invalid'; config: GlobalConfig };

function getConfigDir(): string {
  return getGlobalConfigDir();
}

function getLegacyConfigPath(): string {
  return path.join(os.homedir(), '.config', CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

async function readConfigFile(configPath: string): Promise<ConfigReadResult> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return { status: 'ok', config: JSON.parse(content) as GlobalConfig };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    // If parse fails or another read error occurs, ignore the file.
    return { status: 'invalid', config: {} };
  }
}

async function writeConfigFile(configPath: string, config: GlobalConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}

function hasMissingTelemetryFields(config: GlobalConfig): boolean {
  const telemetry = config.telemetry;
  return (
    !telemetry ||
    telemetry.anonymousId === undefined ||
    telemetry.noticeSeen === undefined
  );
}

function mergeLegacyTelemetry(config: GlobalConfig, legacyConfig: GlobalConfig): GlobalConfig | undefined {
  const legacyTelemetry = legacyConfig.telemetry;
  if (!legacyTelemetry) {
    return undefined;
  }

  const currentTelemetry = config.telemetry ?? {};
  const shouldMigrate =
    (currentTelemetry.anonymousId === undefined && legacyTelemetry.anonymousId !== undefined) ||
    (currentTelemetry.noticeSeen === undefined && legacyTelemetry.noticeSeen !== undefined);

  if (!shouldMigrate) {
    return undefined;
  }

  return {
    ...config,
    telemetry: {
      ...legacyTelemetry,
      ...currentTelemetry,
    },
  };
}

async function migrateLegacyTelemetryConfig(
  configPath: string,
  config: GlobalConfig,
  persist: boolean,
): Promise<GlobalConfig> {
  // relocate-machine-home M1 fix: RASEN_HOME is the highest-precedence,
  // single-knob override — "an explicit location is the user's choice;
  // nothing relocates" applies to this legacy-telemetry merge too, not just
  // to `adoptLegacyMachineData`. Without this guard, a stray legacy
  // ~/.config/rasen/config.json could silently leak its anonymousId/
  // noticeSeen into a RASEN_HOME-scoped config the user explicitly chose to
  // isolate. (XDG_CONFIG_HOME is deliberately NOT gated here: migrating from
  // the legacy `~/.config/rasen` into a newly-set XDG_CONFIG_HOME location is
  // this mechanism's original, still-intended use case.)
  if (resolveRasenHome(process.env) !== undefined) {
    return config;
  }

  const legacyConfigPath = getLegacyConfigPath();
  if (path.resolve(configPath) === path.resolve(legacyConfigPath) || !hasMissingTelemetryFields(config)) {
    return config;
  }

  const legacyRead = await readConfigFile(legacyConfigPath);
  if (legacyRead.status !== 'ok') {
    return config;
  }

  const migrated = mergeLegacyTelemetry(config, legacyRead.config);
  if (!migrated) {
    return config;
  }

  if (persist) {
    try {
      await writeConfigFile(configPath, migrated);
    } catch {
      // Preserve telemetry for this run even if the one-time migration cannot be persisted.
    }
  }

  return migrated;
}

/**
 * Get the path to the global config file.
 *
 * Delegates to `getGlobalConfigDir()` (see `core/global-config.ts`):
 * `RASEN_HOME` (highest) > `$XDG_CONFIG_HOME/rasen` (compatibility alias) >
 * `~/.rasen` (the default on every platform).
 */
export function getConfigPath(): string {
  const configDir = getConfigDir();
  return path.join(configDir, CONFIG_FILE_NAME);
}

/**
 * Read the global config file.
 * Returns an empty object if the file doesn't exist.
 */
export async function readConfig(): Promise<GlobalConfig> {
  const configPath = getConfigPath();
  const read = await readConfigFile(configPath);
  const config = read.status === 'ok' ? read.config : {};
  return migrateLegacyTelemetryConfig(configPath, config, read.status !== 'invalid');
}

/**
 * Write to the global config file.
 * Preserves existing fields and merges in new values.
 */
export async function writeConfig(updates: Partial<GlobalConfig>): Promise<void> {
  const configPath = getConfigPath();

  // Read existing config and merge
  const existing = await readConfig();
  const merged = { ...existing, ...updates };

  // Deep merge for telemetry object
  if (updates.telemetry && existing.telemetry) {
    merged.telemetry = { ...existing.telemetry, ...updates.telemetry };
  }

  await writeConfigFile(configPath, merged);
}

/**
 * Get the telemetry config section.
 */
export async function getTelemetryConfig(): Promise<TelemetryConfig> {
  const config = await readConfig();
  return config.telemetry ?? {};
}

/**
 * Update the telemetry config section.
 */
export async function updateTelemetryConfig(updates: Partial<TelemetryConfig>): Promise<void> {
  const existing = await getTelemetryConfig();
  await writeConfig({
    telemetry: { ...existing, ...updates },
  });
}
