/**
 * Constraint-driven control selection (design.md D6). Maps a wire entry's
 * `constraints` to the control the config page should render, plus the
 * client-side validation mirror (the server verdict remains authoritative).
 */
import type { ConfigScope, WireConfigEntry } from '../api/types.js';

/** The page-level scope mode (design D1): Global writes the machine-wide scope; Local writes the current space's own scope. */
export type ConfigMode = 'global' | 'local';

/** A planning space's type — kept local so this module stays DOM-free and testable (design D9). */
export type SpaceType = 'project' | 'store';

export type ControlKind = 'toggle' | 'select' | 'ranged-number' | 'threshold' | 'text' | 'model' | 'readonly';

export interface ControlSpec {
  kind: ControlKind;
  /** True when the entry cannot be edited at all (env-override, not_settable/wildcard display-only). */
  readonly: boolean;
  enumValues?: readonly string[];
  range?: { gt: number; lte: number };
  /** For `kind: 'threshold'`: the absolute form's `remainingTokens` floor. */
  remainingTokensGt?: number;
  /** For `kind: 'model'`: known model-preset ids offered as non-binding suggestions (a datalist) — any other value is still accepted. */
  modelSuggestions?: readonly string[];
}

/**
 * Model ids offered as non-binding datalist suggestions on a `models.*`
 * control — never an allow-list; a typed id matching none of these is still
 * accepted. Source of truth: the `match` substrings of `MODEL_PRESETS`
 * (src/core/model-presets.ts, matched by `id.includes(match)`) — every id
 * here MUST resolve to a preset, so the control never steers a user toward
 * an id (like bare `sonnet` or `opus`) that silently misses preset-derived
 * thresholds and context windows. Kept as a literal so the standalone UI
 * bundle imports nothing from the root package; drift is pinned by the
 * preset-parity test in test/config/controls.test.ts, which imports the
 * real `MODEL_PRESETS`.
 */
export const KNOWN_MODEL_IDS = [
  'sonnet-5',
  'sonnet-4-6',
  'opus-4',
  'fable',
  'mythos',
  'haiku',
  'gpt-5',
] as const;

/** True for the `models.default` / `models.roles.<role>` key family — the only `string`-typed keys that render as a model control instead of plain text. */
function isModelKey(key: string): boolean {
  return key === 'models.default' || key.startsWith('models.roles.');
}

/**
 * The concrete config scope the Local mode writes at, given the space type
 * (design D1): the project layer at a project space, the store layer at a
 * store space. The UI never asks the user to know this distinction — the space
 * already encodes it.
 */
export function localScopeFor(spaceType: SpaceType): ConfigScope {
  return spaceType === 'store' ? 'store' : 'project';
}

/** The concrete config scope the active mode writes at (design D1/D4): `global` in Global mode, the space's local scope in Local mode. */
export function modeScope(mode: ConfigMode, spaceType: SpaceType): ConfigScope {
  return mode === 'global' ? 'global' : localScopeFor(spaceType);
}

/**
 * Whether a key is visible in the active mode (design D1): Global mode shows
 * keys whose scopes include `global`; Local mode shows keys settable at the
 * space's local scope. A key not settable in the active mode is simply absent
 * (Fork 1A) — this predicate is the page's visibility filter.
 */
export function isVisibleInMode(
  entry: WireConfigEntry,
  mode: ConfigMode,
  spaceType: SpaceType
): boolean {
  return entry.definition.scopes.includes(modeScope(mode, spaceType));
}

/**
 * Env-override values are always read-only precedence (design.md D6): never
 * offered for editing regardless of type. Wildcard family entries (e.g.
 * featureFlags) are display-only in v1. Otherwise the control follows
 * `constraints.type`, provided the key is settable in the active mode's scope
 * (design D1/D4: a key not settable in the active mode is not editable there —
 * though the page filters such keys out before rendering, this keeps the
 * control honest if one is passed through).
 */
export function selectControl(
  entry: WireConfigEntry,
  mode: ConfigMode,
  spaceType: SpaceType
): ControlSpec {
  if (entry.source === 'env-override' || entry.definition.wildcard) {
    // env-override: always read-only precedence. wildcard (e.g. featureFlags):
    // the API returns not_supported for individual leaves in v1 (D6) — the
    // family entry itself is display-only.
    return { kind: 'readonly', readonly: true };
  }

  if (!isVisibleInMode(entry, mode, spaceType)) {
    return { kind: 'readonly', readonly: true };
  }

  const { constraints } = entry.definition;
  switch (constraints.type) {
    case 'boolean':
      return { kind: 'toggle', readonly: false };
    case 'enum': {
      // Scope-accurate domain: an enum whose values differ by scope (the
      // profile key) carries a per-scope map; render the list for the scope
      // the active mode writes to, falling back to the static list otherwise.
      const scope = modeScope(mode, spaceType);
      const enumValues = constraints.enumValuesByScope?.[scope] ?? constraints.enumValues;
      return { kind: 'select', readonly: false, enumValues };
    }
    case 'number':
      return { kind: 'ranged-number', readonly: false, range: constraints.range };
    case 'threshold':
      return {
        kind: 'threshold',
        readonly: false,
        range: constraints.range,
        remainingTokensGt: constraints.remainingTokensGt,
      };
    case 'string':
      if (isModelKey(entry.definition.key)) {
        return { kind: 'model', readonly: false, modelSuggestions: KNOWN_MODEL_IDS };
      }
      return { kind: 'text', readonly: false };
    case 'array':
    default:
      return { kind: 'readonly', readonly: true };
  }
}

/** Client-side mirror of the server's numeric range check — immediate feedback only, server is authoritative. */
export function validateRangedNumber(value: number, range?: { gt: number; lte: number }): string | null {
  if (Number.isNaN(value)) return 'Must be a number';
  if (!range) return null;
  if (value <= range.gt || value > range.lte) {
    return `Must be greater than ${range.gt} and at most ${range.lte}`;
  }
  return null;
}

/**
 * Client-side mirror of the dual-form threshold validator (see
 * `validateThreshold` in src/core/config-keys.ts): a bare fraction (checked
 * via `validateRangedNumber`), or the strict object
 * `{ remainingTokens: <integer greater than remainingTokensGt> }`.
 * Immediate feedback only — the server is authoritative.
 */
export function validateThresholdValue(
  value: number | { remainingTokens: number },
  range?: { gt: number; lte: number },
  remainingTokensGt?: number
): string | null {
  if (typeof value === 'number') {
    return validateRangedNumber(value, range);
  }
  const n = value.remainingTokens;
  const floor = remainingTokensGt ?? 0;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= floor) {
    return `remainingTokens must be an integer greater than ${floor}`;
  }
  return null;
}

/**
 * Whether a store layer provides this entry's effective value while addressing
 * a project space in Local mode (design D3): the row then renders read-only
 * with an "edit in store" affordance instead of a local editor, because the
 * UI does not offer project-level overrides of store-inherited keys. Only
 * meaningful for a project space in Local mode — Global mode edits the
 * machine-wide scope regardless, and a store space edits the store directly.
 */
export function isStoreInherited(
  entry: WireConfigEntry,
  mode: ConfigMode,
  spaceType: SpaceType
): boolean {
  return mode === 'local' && spaceType === 'project' && entry.source === 'store';
}
