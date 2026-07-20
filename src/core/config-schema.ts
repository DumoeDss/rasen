import { z } from 'zod';

import { validateConfigKeyPath as registryValidateConfigKeyPath } from './config-keys.js';
import type { ConfigScope } from './config-keys.js';
import { thresholdSchema } from './pipeline-registry/types.js';

/**
 * Zod schema for global Rasen configuration.
 * Uses passthrough() to preserve unknown fields for forward compatibility.
 */
export const GlobalConfigSchema = z
  .object({
    featureFlags: z
      .record(z.string(), z.boolean())
      .optional()
      .default({}),
    profile: z
      .enum(['full', 'core', 'custom'])
      .optional()
      .default('full'),
    delivery: z
      .enum(['both', 'skills'])
      .or(
        z
          .enum(['commands', 'skills-first', 'commands-first'])
          .transform((legacy) =>
            legacy === 'skills-first' ? ('skills' as const) : ('both' as const)
          )
      )
      .optional()
      .default('both'),
    workflows: z
      .array(z.string())
      .optional(),
    language: z.enum(['auto', 'en', 'ja']).optional().default('auto'),
    proactive: z.boolean().optional(),
    repoMode: z.enum(['solo', 'collaborative']).optional(),
    telemetry: z
      .object({
        enabled: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    handoff: z
      .object({
        threshold: thresholdSchema('threshold').optional(),
        roles: z
          .object({
            planner: thresholdSchema('threshold').optional(),
            implementer: thresholdSchema('threshold').optional(),
            reviewer: thresholdSchema('threshold').optional(),
            fixer: thresholdSchema('threshold').optional(),
            shipper: thresholdSchema('threshold').optional(),
          })
          .optional(),
      })
      .optional(),
    autopilot: z
      .object({
        gates: z.enum(['on', 'off']).optional(),
        selection: z.enum(['classify', 'manual', 'compose']).optional(),
      })
      .optional(),
    models: z
      .object({
        default: z.string().min(1).optional(),
        roles: z
          .object({
            planner: z.string().min(1).optional(),
            implementer: z.string().min(1).optional(),
            reviewer: z.string().min(1).optional(),
            fixer: z.string().min(1).optional(),
            shipper: z.string().min(1).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type GlobalConfigType = z.infer<typeof GlobalConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: GlobalConfigType = {
  featureFlags: {},
  profile: 'full',
  delivery: 'both',
  language: 'auto',
};

/**
 * Validate a config key path for CLI set operations, scope-aware.
 * Delegates key knowledge to the config-key registry (src/core/config-keys.ts)
 * so validation, the interactive editor, and effective-config resolution
 * cannot drift. Unknown keys are rejected unless explicitly allowed by the
 * caller (global scope's `--allow-unknown` escape hatch; project scope has
 * no bypass).
 */
export function validateConfigKeyPath(
  path: string,
  scope: ConfigScope = 'global'
): { valid: boolean; reason?: string } {
  return registryValidateConfigKeyPath(path, scope);
}

/**
 * Get a nested value from an object using dot notation.
 *
 * @param obj - The object to access
 * @param path - Dot-separated path (e.g., "featureFlags.someFlag")
 * @returns The value at the path, or undefined if not found
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Set a nested value in an object using dot notation.
 * Creates intermediate objects as needed.
 *
 * @param obj - The object to modify (mutated in place)
 * @param path - Dot-separated path (e.g., "featureFlags.someFlag")
 * @param value - The value to set
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

/**
 * Delete a nested value from an object using dot notation.
 *
 * @param obj - The object to modify (mutated in place)
 * @param path - Dot-separated path (e.g., "featureFlags.someFlag")
 * @returns true if the key existed and was deleted, false otherwise
 */
export function deleteNestedValue(obj: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey in current) {
    delete current[lastKey];
    return true;
  }
  return false;
}

/**
 * Coerce a string value to its appropriate type.
 * - "true" / "false" -> boolean
 * - Numeric strings -> number
 * - JSON arrays/objects -> parsed containers
 * - Everything else -> string
 *
 * @param value - The string value to coerce
 * @param forceString - If true, always return the value as a string
 * @returns The coerced value
 */
export function coerceValue(
  value: string,
  forceString: boolean = false
): string | number | boolean | unknown[] | Record<string, unknown> {
  if (forceString) {
    return value;
  }

  // Boolean coercion
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  // Number coercion - must be a valid finite number
  const num = Number(value);
  if (!isNaN(num) && isFinite(num) && value.trim() !== '') {
    return num;
  }

  const jsonContainer = parseJsonContainer(value);
  if (jsonContainer !== undefined) {
    return jsonContainer;
  }

  return value;
}

function parseJsonContainer(value: string): unknown[] | Record<string, unknown> | undefined {
  const trimmed = value.trim();
  const looksLikeContainer =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'));

  if (!looksLikeContainer) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Format a value for YAML-like display.
 *
 * @param value - The value to format
 * @param indent - Current indentation level
 * @returns Formatted string
 */
export function formatValueYaml(value: unknown, indent: number = 0): string {
  const indentStr = '  '.repeat(indent);

  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return value.map((item) => `${indentStr}- ${formatValueYaml(item, indent + 1)}`).join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    return entries
      .map(([key, val]) => {
        const formattedVal = formatValueYaml(val, indent + 1);
        if (typeof val === 'object' && val !== null && Object.keys(val).length > 0) {
          return `${indentStr}${key}:\n${formattedVal}`;
        }
        return `${indentStr}${key}: ${formattedVal}`;
      })
      .join('\n');
  }

  return String(value);
}

/**
 * Validate a configuration object against the schema.
 *
 * @param config - The configuration to validate
 * @returns Validation result with success status and optional error message
 */
export function validateConfig(config: unknown): { success: boolean; error?: string } {
  try {
    GlobalConfigSchema.parse(config);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const zodError = error as z.ZodError;
      const messages = zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      return { success: false, error: messages.join('; ') };
    }
    return { success: false, error: 'Unknown validation error' };
  }
}
