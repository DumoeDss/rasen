/**
 * Effective-configuration resolution: merges the default, global, project,
 * and environment-override layers into per-key values with source metadata.
 *
 * This is the reusable seam (design D5 of the `unified-config-layer`
 * change): the interactive `rasen config` editor and the non-TTY effective
 * view render `EffectiveConfigEntry[]` from here — they compute nothing
 * themselves. The planned `unified-config-api` sibling wraps this same
 * module (plus `updateProjectConfigKey`/`saveGlobalConfig`) in HTTP
 * handlers, so no command-layer logic should need duplicating there.
 */
import * as fs from 'node:fs';

import { getNestedValue } from './config-schema.js';
import { CONFIG_KEY_REGISTRY, type ConfigKeyDefinition } from './config-keys.js';
import { getGlobalConfig, getGlobalConfigPath } from './global-config.js';
import { readProjectConfig, type ProjectConfig } from './project-config.js';
import { isTelemetryEnvDisabled } from '../telemetry/index.js';
import { thresholdSchema, type ThresholdValue } from './pipeline-registry/types.js';

export type ConfigSource = 'default' | 'global' | 'project' | 'env-override';

export interface EffectiveConfigEntry {
  definition: ConfigKeyDefinition;
  /** The effective value after merging all layers. */
  value: unknown;
  /** The highest-precedence layer that produced `value`. */
  source: ConfigSource;
  /** Raw per-layer values, before merge. */
  scopeValues: { global?: unknown; project?: unknown };
}

export interface ResolveEffectiveConfigOptions {
  /** Explicit project root; when omitted, only environment/global/default layers contribute. */
  projectRoot?: string;
}

/**
 * Resolves an environment-override value for a registry key, if any applies.
 * Today only `telemetry.enabled`'s environment kill-switches
 * (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) surface here — the single
 * source of truth for what counts as a kill-switch lives in
 * `src/telemetry/index.ts` so this module and `isTelemetryEnabled()` can
 * never disagree.
 */
function resolveEnvOverride(definition: ConfigKeyDefinition): { value: unknown } | undefined {
  if (definition.key === 'telemetry.enabled' && isTelemetryEnvDisabled()) {
    return { value: false };
  }
  return undefined;
}

/**
 * Reads the global config file exactly as written (no default-injection),
 * so `resolveEffectiveConfig` can tell "the user set this" apart from
 * "`getGlobalConfig()` filled in its own built-in default" — `getGlobalConfig()`
 * bakes defaults for a few fields (`profile`, `delivery`, `proactive`,
 * `repoMode`) directly into its return value, which would otherwise make
 * those keys report source `global` even when never explicitly set. Missing
 * or unparseable files resolve to `{}` (same as "nothing set").
 */
function readRawGlobalConfig(): Record<string, unknown> {
  try {
    const configPath = getGlobalConfigPath();
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Merges default + global + project + environment-override layers into
 * per-key effective values with source metadata, for every non-wildcard key
 * in the config-key registry. Precedence per key: env-override > project
 * (when project-scoped and a project root resolves) > global > default.
 * Pure and synchronous; safe to call with no project root (global-only
 * contexts resolve from environment, global, and default layers only).
 */
export function resolveEffectiveConfig(
  options: ResolveEffectiveConfigOptions = {}
): EffectiveConfigEntry[] {
  const globalConfig = getGlobalConfig() as unknown as Record<string, unknown>;
  const rawGlobalConfig = readRawGlobalConfig();
  const projectConfig: ProjectConfig | null = options.projectRoot
    ? readProjectConfig(options.projectRoot)
    : null;
  const projectConfigRecord = projectConfig as unknown as Record<string, unknown> | null;

  const entries: EffectiveConfigEntry[] = [];

  for (const definition of CONFIG_KEY_REGISTRY) {
    if (definition.wildcard) continue; // no single "the" value for a key family

    // `rawGlobalValue` decides whether the global layer contributed anything
    // (undefined = never set); `mergedGlobalValue` is the value to REPORT
    // once it has (normalized the same way every other consumer of
    // getGlobalConfig() sees it, e.g. legacy `delivery` value mapping).
    const rawGlobalValue = definition.scopes.includes('global')
      ? getNestedValue(rawGlobalConfig, definition.key)
      : undefined;
    const mergedGlobalValue = definition.scopes.includes('global')
      ? getNestedValue(globalConfig, definition.key)
      : undefined;
    const projectValue =
      definition.scopes.includes('project') && projectConfigRecord
        ? getNestedValue(projectConfigRecord, definition.key)
        : undefined;

    const envOverride = resolveEnvOverride(definition);

    let value: unknown;
    let source: ConfigSource;
    if (envOverride !== undefined) {
      value = envOverride.value;
      source = 'env-override';
    } else if (projectValue !== undefined) {
      value = projectValue;
      source = 'project';
    } else if (rawGlobalValue !== undefined) {
      value = mergedGlobalValue;
      source = 'global';
    } else {
      value = definition.defaultValue;
      source = 'default';
    }

    entries.push({
      definition,
      value,
      source,
      scopeValues: { global: rawGlobalValue, project: projectValue },
    });
  }

  return entries;
}

/** Threshold values from the project/global config layers, for `resolveStageHandoffConfig` and the `rasen agent context` probe. */
export interface HandoffThresholdLayers {
  projectThreshold?: ThresholdValue;
  globalThreshold?: ThresholdValue;
}

/**
 * Resolves the `handoff.threshold` project/global config layers, shared by
 * `resolveStageHandoffConfig` call sites (pipeline resolution) and
 * `rasen agent context`'s threshold reporting, so the two consumers can
 * never drift on what "the configured threshold" means. Dual-form: a bare
 * fraction in (0, 1], or the absolute `{ remainingTokens: N }` headroom form
 * (validated via the same `thresholdSchema()` builder pipeline-registry
 * uses, so the two never drift on what a valid threshold looks like).
 *
 * `readProjectConfig()` already drops an invalid project threshold
 * resiliently (with a warning) during parsing, so `projectConfig.handoff`
 * never carries an invalid value here. `getGlobalConfig()` has no such
 * schema gate on read (it's a raw JSON.parse + merge), so a hand-edited
 * invalid global value is re-validated here, dropped with a warning rather
 * than silently reaching resolution as an unusable threshold.
 */
export function resolveHandoffThresholdLayers(
  projectRoot?: string | null
): HandoffThresholdLayers {
  const globalConfig = getGlobalConfig();
  const projectConfig = projectRoot ? readProjectConfig(projectRoot) : null;

  const rawGlobalThreshold = globalConfig.handoff?.threshold;
  let globalThreshold: ThresholdValue | undefined;
  if (rawGlobalThreshold === undefined) {
    globalThreshold = undefined;
  } else {
    const parsed = thresholdSchema('threshold').safeParse(rawGlobalThreshold);
    if (parsed.success) {
      globalThreshold = parsed.data;
    } else {
      console.warn(
        `Invalid 'handoff.threshold' in the global config (must be a number in (0, 1], or an object { remainingTokens: <positive integer> }, got ${JSON.stringify(rawGlobalThreshold)}); ignoring it.`
      );
      globalThreshold = undefined;
    }
  }

  return {
    projectThreshold: projectConfig?.handoff?.threshold,
    globalThreshold,
  };
}
