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

import { SUPPORTED_CLI_LOCALES } from '../utils/locale.js';

export type ConfigScope = 'global' | 'store' | 'project';
/**
 * 'threshold' is the dual-form handoff/reuse shape (see `ThresholdValue` in
 * src/core/model-presets.ts): a bare number in (0, 1], or the strict object
 * `{ remainingTokens: <positive integer> }`. It has no built-in type check in
 * `validateConfigValue` (neither form matches a plain 'number' check) — the
 * registry entry's `validate` fn does the whole job.
 */
export type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum' | 'array' | 'threshold';

export interface ConfigKeyDefinition {
  /**
   * Dot path, e.g. "handoff.threshold". For a wildcard entry this is the
   * family's identity as seen on the wire: `featureFlags` keeps its bare
   * `featureFlags` key for backward wire compatibility, while the newer
   * families use their full `pattern` string (no compatibility to preserve).
   */
  key: string;
  /** Scopes this key may be SET in (any subset of `global`, `store`, `project`). */
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
  /** Editor grouping, e.g. "Workflow", "Autopilot", "Telemetry", "Pipelines". */
  group: string;
  /**
   * True for a key FAMILY matched by a fixed-shape `pattern` rather than an
   * exact path (`featureFlags.<name>`, `pipelines.<name>.gates.<stage>`, …).
   * Wildcard entries are excluded from generic exact-path lookups; effective
   * resolution emits a template entry for the family plus one entry per set
   * instance (there is no single "the" value for a family).
   */
  wildcard?: boolean;
  /**
   * For a wildcard family: the canonical fixed-shape dot-path template with
   * literal and `<placeholder>` segments (e.g. `featureFlags.<name>`,
   * `pipelines.<name>.gates.<stage>`). A key path matches the family when its
   * segment count equals the pattern's and every literal segment matches
   * exactly; each `<placeholder>` segment accepts a conservative identifier
   * (letters, digits, hyphen, underscore) and is NOT checked against the
   * existence of any pipeline, stage, or other referent. Required on every
   * wildcard entry.
   */
  pattern?: string;
}

/** Keys that live in the same config blocks as registry keys but are machine-managed, never CLI-settable. */
export const NOT_SETTABLE_KEYS: ReadonlySet<string> = new Set([
  'telemetry.anonymousId',
  'telemetry.noticeSeen',
]);

/**
 * Retired top-level keys: no longer a live setting, but `config set`/`config
 * unset` recognize them by name and route to a friendly retirement notice
 * (no persistence, no crash) instead of the generic "unknown key" error a
 * bare registry removal would produce. `delivery` (the command/skills
 * install-surface dimension) was retired when the command-delivery surface
 * itself was removed — skills are the only delivery surface now.
 */
export const RETIRED_CONFIG_KEYS: ReadonlySet<string> = new Set(['delivery']);

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

/**
 * Model-id validator: any non-empty string is accepted. Mirrors the pipeline
 * stage `model: z.string().min(1)` — a known preset id and an unrecognized
 * id are both valid; only an empty string is rejected.
 */
function validateModelId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'a model id is required (any non-empty string, e.g. "sonnet" or "fable")';
  }
  return null;
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
    key: 'workflows',
    scopes: ['global'],
    type: 'array',
    defaultValue: [],
    description: 'Explicit workflow selection (edit via `rasen profile`)',
    group: 'Profile',
  },
  {
    key: 'language',
    scopes: ['global'],
    type: 'enum',
    enumValues: ['auto', ...SUPPORTED_CLI_LOCALES],
    defaultValue: 'auto',
    description: 'Language for interactive prompts and CLI help (`auto` detects the system locale)',
    group: 'Appearance',
  },
  {
    key: 'featureFlags',
    scopes: ['global'],
    type: 'boolean',
    wildcard: true,
    pattern: 'featureFlags.<name>',
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
    scopes: ['store', 'project'],
    type: 'string',
    defaultValue: '',
    description: 'The workflow schema this project uses (e.g. "spec-driven")',
    group: 'Project',
  },
  {
    key: 'autopilot.gates',
    scopes: ['global', 'store', 'project'],
    type: 'enum',
    enumValues: ['on', 'off'],
    defaultValue: 'on',
    description: 'Default autopilot gate policy (project wins over global)',
    group: 'Autopilot',
  },
  {
    key: 'autopilot.selection',
    scopes: ['global', 'store', 'project'],
    type: 'enum',
    enumValues: ['classify', 'manual', 'compose'],
    defaultValue: 'manual',
    description: 'Default autopilot pipeline-selection policy (project wins over global)',
    group: 'Autopilot',
  },
  {
    key: 'archive.timing',
    scopes: ['store', 'project'],
    type: 'enum',
    enumValues: ['on-merge', 'in-ship'],
    defaultValue: 'on-merge',
    description: 'When archive runs relative to shipping a change',
    group: 'Archive',
  },
  {
    key: 'archive.destination',
    scopes: ['store', 'project'],
    type: 'enum',
    enumValues: ['in-repo', 'external', 'prune'],
    defaultValue: 'in-repo',
    description: 'Where archive bookkeeping lands',
    group: 'Archive',
  },
  // ---- both scopes ----
  {
    key: 'handoff.threshold',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    defaultValue: 0.5,
    validate: validateThreshold,
    description:
      'Context-handoff threshold at which agents should hand off (project wins over global; a per-role handoff.roles.<role> value wins over this scalar at the same scope): a fraction in (0, 1], or an absolute { remainingTokens: N } headroom',
    group: 'Workflow',
  },
  {
    key: 'handoff.roles.planner',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    defaultValue: undefined,
    validate: validateThreshold,
    description: 'Per-role context-handoff threshold override for the planner role (wins over handoff.threshold at the same scope)',
    group: 'Workflow',
  },
  {
    key: 'handoff.roles.implementer',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    defaultValue: undefined,
    validate: validateThreshold,
    description: 'Per-role context-handoff threshold override for the implementer role (wins over handoff.threshold at the same scope)',
    group: 'Workflow',
  },
  {
    key: 'handoff.roles.reviewer',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    defaultValue: undefined,
    validate: validateThreshold,
    description: 'Per-role context-handoff threshold override for the reviewer role (wins over handoff.threshold at the same scope)',
    group: 'Workflow',
  },
  {
    key: 'handoff.roles.fixer',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    defaultValue: undefined,
    validate: validateThreshold,
    description: 'Per-role context-handoff threshold override for the fixer role (wins over handoff.threshold at the same scope)',
    group: 'Workflow',
  },
  {
    key: 'handoff.roles.shipper',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    defaultValue: undefined,
    validate: validateThreshold,
    description: 'Per-role context-handoff threshold override for the shipper role (wins over handoff.threshold at the same scope)',
    group: 'Workflow',
  },
  {
    key: 'models.default',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    defaultValue: undefined,
    validate: validateModelId,
    description: 'Base model for every agent role (project wins over global); any model id is accepted',
    group: 'Workflow',
  },
  {
    key: 'models.roles.planner',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    defaultValue: undefined,
    validate: validateModelId,
    description: 'Per-role model override for the planner role (wins over models.default at the same scope); any model id is accepted',
    group: 'Workflow',
  },
  {
    key: 'models.roles.implementer',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    defaultValue: undefined,
    validate: validateModelId,
    description: 'Per-role model override for the implementer role (wins over models.default at the same scope); any model id is accepted',
    group: 'Workflow',
  },
  {
    key: 'models.roles.reviewer',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    defaultValue: undefined,
    validate: validateModelId,
    description: 'Per-role model override for the reviewer role (wins over models.default at the same scope); any model id is accepted',
    group: 'Workflow',
  },
  {
    key: 'models.roles.fixer',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    defaultValue: undefined,
    validate: validateModelId,
    description: 'Per-role model override for the fixer role (wins over models.default at the same scope); any model id is accepted',
    group: 'Workflow',
  },
  {
    key: 'models.roles.shipper',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    defaultValue: undefined,
    validate: validateModelId,
    description: 'Per-role model override for the shipper role (wins over models.default at the same scope); any model id is accepted',
    group: 'Workflow',
  },
  // ---- global scope (UI-managed) ----
  {
    key: 'ui.pinnedSpaces',
    scopes: ['global'],
    type: 'array',
    defaultValue: [],
    description: 'Pinned planning spaces as <type>:<id> selectors (managed from the Spaces page)',
    group: 'Appearance',
  },
  // ---- Pipelines families (per-pipeline, per-stage overrides) ----
  // Wildcard families whose instances (e.g. `pipelines.small-feature.gates.propose`)
  // are settable at global/store/project scope with NO default: an unset
  // instance is absent, not defaulted, so a consumer can distinguish "no
  // override" from any concrete value. No consumer reads these yet — this
  // registry surface is the machinery a later Pipelines page consumes.
  {
    key: 'pipelines.<name>.gates.<stage>',
    scopes: ['global', 'store', 'project'],
    type: 'enum',
    enumValues: ['on', 'off'],
    wildcard: true,
    pattern: 'pipelines.<name>.gates.<stage>',
    defaultValue: undefined,
    description: 'Per-pipeline, per-stage gate override (on | off)',
    group: 'Pipelines',
  },
  {
    key: 'pipelines.<name>.models.<stage>',
    scopes: ['global', 'store', 'project'],
    type: 'string',
    wildcard: true,
    pattern: 'pipelines.<name>.models.<stage>',
    validate: validateModelId,
    defaultValue: undefined,
    description: 'Per-pipeline, per-stage model override (any non-empty model id)',
    group: 'Pipelines',
  },
  {
    key: 'pipelines.<name>.handoff.<stage>',
    scopes: ['global', 'store', 'project'],
    type: 'threshold',
    wildcard: true,
    pattern: 'pipelines.<name>.handoff.<stage>',
    validate: validateThreshold,
    defaultValue: undefined,
    description:
      'Per-pipeline, per-stage context-handoff threshold override: a fraction in (0, 1], or an absolute { remainingTokens: N }',
    group: 'Pipelines',
  },
  // The fourth `pipelines.*` family: per-ROLE (not per-stage) runtime override.
  // `rasen pipeline agents` writes instances here instead of freezing a full
  // pipeline YAML copy into the project — the effective runtime for a role
  // resolves this instance (project > store > global) above the pipeline's
  // declared `agents.<role>.runtime`. Enum claude | codex, no default.
  {
    key: 'pipelines.<name>.runtimes.<role>',
    scopes: ['global', 'store', 'project'],
    type: 'enum',
    enumValues: ['claude', 'codex'],
    wildcard: true,
    pattern: 'pipelines.<name>.runtimes.<role>',
    defaultValue: undefined,
    description: 'Per-pipeline, per-role agent runtime override (claude | codex)',
    group: 'Pipelines',
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

/** Conservative identifier charset every `<placeholder>` segment must satisfy. */
const PLACEHOLDER_VALUE_RE = /^[A-Za-z0-9_-]+$/;

interface PatternSegment {
  /** The literal text this segment must equal, or null when it is a placeholder. */
  literal: string | null;
}

/** Splits a family pattern into literal/placeholder segments (`<name>` → placeholder). */
function parseFamilyPattern(pattern: string): PatternSegment[] {
  return pattern.split('.').map((segment) =>
    /^<.+>$/.test(segment) ? { literal: null } : { literal: segment }
  );
}

/**
 * Classifies a key path against the wildcard families, optionally gated to
 * families settable in `scope` (omit `scope` to consider every family
 * regardless of scope — the config API routes by shape first, then checks
 * scope separately so it can name the settable scopes). Outcomes:
 *  - `match`: segment count and every literal segment match a family, and
 *    every placeholder is a valid identifier — a settable instance path.
 *  - `bad_placeholder`: shape matches a family but a placeholder segment
 *    contains a character outside the identifier charset.
 *  - `wrong_shape`: the path's literal segments identify a family (its root
 *    literal and every literal present at a shared index match) but the
 *    segment count or a trailing/missing segment does not fit the pattern.
 *  - `none`: the path belongs to no wildcard family.
 */
export type WildcardClassification =
  | { kind: 'match'; definition: ConfigKeyDefinition }
  | { kind: 'bad_placeholder'; definition: ConfigKeyDefinition; segment: string }
  | { kind: 'wrong_shape'; definition: ConfigKeyDefinition }
  | { kind: 'none' };

export function classifyWildcardPath(
  keyPath: string,
  scope?: ConfigScope
): WildcardClassification {
  const segments = keyPath.split('.');
  const families = CONFIG_KEY_REGISTRY.filter(
    (def) => def.wildcard && def.pattern && (scope === undefined || def.scopes.includes(scope))
  );

  // First pass: an exact-shape match (segment count + every literal equal).
  for (const def of families) {
    const patternSegs = parseFamilyPattern(def.pattern!);
    if (patternSegs.length !== segments.length) continue;
    const literalsMatch = patternSegs.every(
      (seg, i) => seg.literal === null || seg.literal === segments[i]
    );
    if (!literalsMatch) continue;
    const badPlaceholder = patternSegs.findIndex(
      (seg, i) => seg.literal === null && !PLACEHOLDER_VALUE_RE.test(segments[i]!)
    );
    if (badPlaceholder !== -1) {
      return { kind: 'bad_placeholder', definition: def, segment: segments[badPlaceholder]! };
    }
    return { kind: 'match', definition: def };
  }

  // Second pass: the path did not fit any pattern's shape, but its literal
  // segments may still identify the family it was reaching for — pick the
  // family with the most matching literals (its root literal must match, and
  // no literal present at a shared index may disagree).
  let bestDef: ConfigKeyDefinition | undefined;
  let bestScore = 0;
  for (const def of families) {
    const patternSegs = parseFamilyPattern(def.pattern!);
    if (patternSegs[0].literal === null || patternSegs[0].literal !== segments[0]) continue;
    let score = 0;
    let disqualified = false;
    const overlap = Math.min(patternSegs.length, segments.length);
    for (let i = 0; i < overlap; i++) {
      if (patternSegs[i].literal === null) continue;
      if (patternSegs[i].literal === segments[i]) score += 1;
      else {
        disqualified = true;
        break;
      }
    }
    if (!disqualified && score > bestScore) {
      bestScore = score;
      bestDef = def;
    }
  }
  if (bestDef) {
    return { kind: 'wrong_shape', definition: bestDef };
  }

  return { kind: 'none' };
}

/**
 * The wildcard family a fully-shaped, valid instance path matches in `scope`,
 * or undefined. Placeholder charset and value are validated by
 * `validateConfigKeyPath`/`validateConfigValue`, not here.
 */
export function findWildcardDefinition(
  keyPath: string,
  scope: ConfigScope
): ConfigKeyDefinition | undefined {
  const classification = classifyWildcardPath(keyPath, scope);
  return classification.kind === 'match' ? classification.definition : undefined;
}

/**
 * Enumerates the full dot-path of every instance of `def`'s family that is
 * SET in `record` — walking the fixed literal structure and treating each
 * `<placeholder>` segment as "every key present at this level". Only descends
 * through plain objects; a leaf reached at the end of the pattern yields its
 * path regardless of the leaf's value type (value validity is the caller's
 * concern). Returns `[]` for a non-wildcard entry, an absent block, or a
 * record whose shape does not reach the pattern's depth.
 */
export function collectFamilyInstancePaths(
  def: ConfigKeyDefinition,
  record: Record<string, unknown> | null | undefined
): string[] {
  if (!def.wildcard || !def.pattern || !record) return [];
  const patternSegs = parseFamilyPattern(def.pattern);

  const paths: string[] = [];
  const walk = (node: unknown, depth: number, prefix: string[]): void => {
    if (depth === patternSegs.length) {
      paths.push(prefix.join('.'));
      return;
    }
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    const seg = patternSegs[depth];
    const obj = node as Record<string, unknown>;
    if (seg.literal !== null) {
      if (seg.literal in obj) walk(obj[seg.literal], depth + 1, [...prefix, seg.literal]);
    } else {
      for (const key of Object.keys(obj)) {
        // A placeholder still has to be a well-formed identifier to count as a
        // real instance; a stray key with odd characters is not enumerated.
        if (!PLACEHOLDER_VALUE_RE.test(key)) continue;
        walk(obj[key], depth + 1, [...prefix, key]);
      }
    }
  };
  walk(record, 0, []);
  return paths;
}

/**
 * Validate a key path against the registry for the given scope. A wildcard
 * family instance validates structurally (segment shape + placeholder
 * charset) against its family; a fixed key must match a registry entry
 * settable in the scope. Callers that want the global `--allow-unknown`
 * escape hatch apply it themselves — this function always enforces registry
 * membership.
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

  const wildcard = classifyWildcardPath(keyPath, scope);
  if (wildcard.kind === 'match') {
    return { valid: true };
  }
  if (wildcard.kind === 'bad_placeholder') {
    return {
      valid: false,
      reason: `"${wildcard.segment}" is not a valid segment for ${wildcard.definition.pattern} (use letters, digits, hyphens, or underscores)`,
    };
  }
  if (wildcard.kind === 'wrong_shape') {
    return {
      valid: false,
      reason: `"${keyPath}" does not match the ${wildcard.definition.pattern} shape`,
    };
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
