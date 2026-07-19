/**
 * Declarative registry of every CLI-settable Rasen configuration key.
 *
 * Single source of truth for key metadata (path, scope, type, constraints,
 * default, description, display group) consumed by:
 *  - `rasen config set/get/unset` validation (both global and project scope)
 *  - the interactive full-view editor (`rasen config` with no subcommand)
 *  - `resolveEffectiveConfig()` (src/core/effective-config.ts)
 *
 * Without one table, each of those surfaces would re-derive key knowledge
 * and drift — the scatter this module removes. A unit test
 * (test/core/config-keys.test.ts) asserts every registry entry round-trips
 * through its scope's zod schema so the registry and the schemas cannot
 * silently diverge.
 */

export type ConfigScope = 'global' | 'project';
/**
 * 'threshold' is the dual-form handoff/reuse shape (see `ThresholdValue` in
 * src/core/model-presets.ts): a bare number in (0, 1], or the strict object
 * `{ remainingTokens: <positive integer> }`. It has no built-in type check in
 * `validateConfigValue` (neither form matches a plain 'number' check) — the
 * registry entry's `validate` fn does the whole job.
 */
export type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum' | 'array' | 'threshold';

export interface ConfigKeyDefinition {
  /** Dot path, e.g. "handoff.threshold". For a wildcard entry, the family prefix (e.g. "featureFlags"). */
  key: string;
  /** Scopes this key may be SET in. */
  scopes: ConfigScope[];
  type: ConfigValueType;
  /** Allowed values, required when type is 'enum'. */
  enumValues?: readonly string[];
  /** Extra constraint beyond the type check, e.g. a numeric range. Returns an error message, or null when valid. */
  validate?: (value: unknown) => string | null;
  /** Built-in default (display + resolution). */
  defaultValue: unknown;
  /** One-liner for the editor and error messages. */
  description: string;
  /** Editor grouping, e.g. "Workflow", "Autopilot", "Telemetry". */
  group: string;
  /**
   * True for a key FAMILY matched by prefix rather than an exact path
   * (only `featureFlags`, matching `featureFlags.<name>`). Wildcard entries
   * are excluded from generic exact-path lookups and from
   * `resolveEffectiveConfig()` (there is no single "the" featureFlags value).
   */
  wildcard?: boolean;
}

/** Keys that live in the same config blocks as registry keys but are machine-managed, never CLI-settable. */
export const NOT_SETTABLE_KEYS: ReadonlySet<string> = new Set([
  'telemetry.anonymousId',
  'telemetry.noticeSeen',
]);

/**
 * Dual-form threshold validator: a bare number in (0, 1], or the strict
 * object `{ remainingTokens: <positive integer> }`. Mirrors the zod union
 * `thresholdSchema()` in src/core/pipeline-registry/types.ts (not imported
 * directly — that module's schema is internal, and this registry avoids a
 * zod dependency), so keep the two in sync if the shape ever changes.
 */
function validateThreshold(value: unknown): string | null {
  if (typeof value === 'number') {
    if (Number.isNaN(value) || value <= 0 || value > 1) {
      return 'threshold must be a number in (0, 1], or an object { remainingTokens: <positive integer> }';
    }
    return null;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.length === 1 &&
      keys[0] === 'remainingTokens' &&
      typeof obj.remainingTokens === 'number' &&
      Number.isInteger(obj.remainingTokens) &&
      obj.remainingTokens > 0
    ) {
      return null;
    }
    return 'threshold object must be exactly { remainingTokens: <positive integer> }';
  }
  return 'threshold must be a number in (0, 1], or an object { remainingTokens: <positive integer> }';
}

export const CONFIG_KEY_REGISTRY: ConfigKeyDefinition[] = [
  // ---- global scope ----
  {
    key: 'profile',
    scopes: ['global'],
    type: 'enum',
    enumValues: ['full', 'core', 'custom'],
    defaultValue: 'full',
    description: 'Workflow profile controlling which actions are available',
    group: 'Profile',
  },
  {
    key: 'delivery',
    scopes: ['global'],
    type: 'enum',
    enumValues: ['both', 'skills'],
    defaultValue: 'both',
    description: 'Whether commands are installed alongside skills (skills are always installed)',
    group: 'Profile',
  },
  {
    key: 'workflows',
    scopes: ['global'],
    type: 'array',
    defaultValue: [],
    description: 'Explicit workflow selection (edit via `rasen profile`)',
    group: 'Profile',
  },
  {
    key: 'featureFlags',
    scopes: ['global'],
    type: 'boolean',
    wildcard: true,
    defaultValue: false,
    description: 'Feature flag toggle (featureFlags.<name>)',
    group: 'Advanced',
  },
  {
    key: 'proactive',
    scopes: ['global'],
    type: 'boolean',
    defaultValue: true,
    description: 'Whether agents proactively suggest next steps',
    group: 'Behavior',
  },
  {
    key: 'repoMode',
    scopes: ['global'],
    type: 'enum',
    enumValues: ['solo', 'collaborative'],
    defaultValue: 'collaborative',
    description: 'Repository collaboration mode',
    group: 'Behavior',
  },
  {
    key: 'telemetry.enabled',
    scopes: ['global'],
    type: 'boolean',
    defaultValue: true,
    description: 'Send anonymous usage telemetry (environment opt-outs always win)',
    group: 'Telemetry',
  },
  // ---- project scope ----
  {
    key: 'schema',
    scopes: ['project'],
    type: 'string',
    defaultValue: '',
    description: 'The workflow schema this project uses (e.g. "spec-driven")',
    group: 'Project',
  },
  {
    key: 'autopilot.gates',
    scopes: ['project'],
    type: 'enum',
    enumValues: ['on', 'off'],
    defaultValue: 'on',
    description: 'Default autopilot gate policy',
    group: 'Autopilot',
  },
  {
    key: 'autopilot.selection',
    scopes: ['project'],
    type: 'enum',
    enumValues: ['classify', 'manual', 'compose'],
    defaultValue: 'manual',
    description: 'Default autopilot pipeline-selection policy',
    group: 'Autopilot',
  },
  {
    key: 'archive.timing',
    scopes: ['project'],
    type: 'enum',
    enumValues: ['on-merge', 'in-ship'],
    defaultValue: 'on-merge',
    description: 'When archive runs relative to shipping a change',
    group: 'Archive',
  },
  {
    key: 'archive.destination',
    scopes: ['project'],
    type: 'enum',
    enumValues: ['in-repo', 'external', 'prune'],
    defaultValue: 'in-repo',
    description: 'Where archive bookkeeping lands',
    group: 'Archive',
  },
  // ---- both scopes ----
  {
    key: 'handoff.threshold',
    scopes: ['global', 'project'],
    type: 'threshold',
    defaultValue: 0.5,
    validate: validateThreshold,
    description:
      'Context-handoff threshold at which agents should hand off (project wins over global): a fraction in (0, 1], or an absolute { remainingTokens: N } headroom',
    group: 'Workflow',
  },
];

/** Looks up the exact (non-wildcard) registry entry for a key path settable in the given scope. */
export function findConfigKeyDefinition(
  keyPath: string,
  scope: ConfigScope
): ConfigKeyDefinition | undefined {
  return CONFIG_KEY_REGISTRY.find(
    (def) => !def.wildcard && def.key === keyPath && def.scopes.includes(scope)
  );
}

/** The wildcard family definition matching `featureFlags.<name>`, if the scope supports it. */
export function findWildcardDefinition(
  rootKey: string,
  scope: ConfigScope
): ConfigKeyDefinition | undefined {
  return CONFIG_KEY_REGISTRY.find(
    (def) => def.wildcard && def.key === rootKey && def.scopes.includes(scope)
  );
}

/**
 * Validate a key path against the registry for the given scope. Delegates to
 * the registry for exact matches; preserves the `featureFlags.<name>`
 * wildcard special-case (global scope only, exactly two segments). Callers
 * that want the global `--allow-unknown` escape hatch apply it themselves —
 * this function always enforces registry membership.
 */
export function validateConfigKeyPath(
  keyPath: string,
  scope: ConfigScope = 'global'
): { valid: boolean; reason?: string } {
  const rawKeys = keyPath.split('.');

  if (rawKeys.length === 0 || rawKeys.some((key) => key.trim() === '')) {
    return { valid: false, reason: 'Key path must not be empty' };
  }

  if (NOT_SETTABLE_KEYS.has(keyPath)) {
    return { valid: false, reason: `"${keyPath}" is machine-managed and not settable` };
  }

  const rootKey = rawKeys[0];
  const wildcardDef = findWildcardDefinition(rootKey, scope);
  if (wildcardDef) {
    if (rawKeys.length !== 2) {
      return {
        valid: false,
        reason: `${rootKey} values are booleans and do not support nested keys`,
      };
    }
    return { valid: true };
  }

  const def = findConfigKeyDefinition(keyPath, scope);
  if (!def) {
    return { valid: false, reason: `Unknown configuration key "${keyPath}" for ${scope} scope` };
  }

  return { valid: true };
}

/**
 * Validate a coerced value against a registry entry's declared type and any
 * extra constraint. Returns an error message naming the constraint, or null
 * when the value is valid.
 */
export function validateConfigValue(definition: ConfigKeyDefinition, value: unknown): string | null {
  switch (definition.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `${definition.key} must be a boolean (true or false)`;
      }
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return `${definition.key} must be a number`;
      }
      break;
    case 'string':
      if (typeof value !== 'string') {
        return `${definition.key} must be a string`;
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        return `${definition.key} must be an array`;
      }
      break;
    case 'enum':
      if (typeof value !== 'string' || !definition.enumValues?.includes(value)) {
        return `${definition.key} must be one of: ${definition.enumValues?.join(', ') ?? ''}`;
      }
      break;
  }

  if (definition.validate) {
    const error = definition.validate(value);
    if (error) return error;
  }

  return null;
}
