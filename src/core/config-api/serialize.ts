/**
 * Maps in-process `EffectiveConfigEntry` values to the wire shape the config
 * API serves — the only translation layer between `resolveEffectiveConfig()`
 * and HTTP JSON (design.md D2/D3 of `unified-config-api`).
 */
import { validateConfigValue, type ConfigKeyDefinition } from '../config-keys.js';
import type { EffectiveConfigEntry } from '../effective-config.js';
import type { WireConfigEntry, WireConstraints } from './wire-types.js';

/**
 * Declared numeric ranges for registry keys whose `validate` function
 * enforces one beyond the type check — kept as a small side table (rather
 * than introspecting the function) so this module never needs to execute
 * registry code to describe it. Today only `handoff.threshold` has one.
 */
const RANGE_CONSTRAINTS: Record<string, { gt: number; lte: number }> = {
  'handoff.threshold': { gt: 0, lte: 1 },
};

/**
 * `remainingTokensGt` for `type: 'threshold'` keys — the absolute-form
 * companion to `RANGE_CONSTRAINTS` above. Today only `handoff.threshold`.
 */
const REMAINING_TOKENS_CONSTRAINTS: Record<string, number> = {
  'handoff.threshold': 0,
};

function deriveConstraints(definition: ConfigKeyDefinition): WireConstraints {
  return {
    type: definition.type,
    enumValues: definition.enumValues,
    range: RANGE_CONSTRAINTS[definition.key],
    remainingTokensGt:
      definition.type === 'threshold' ? REMAINING_TOKENS_CONSTRAINTS[definition.key] : undefined,
  };
}

/**
 * Serializes one effective-config entry for the wire: `definition.validate`
 * (unserializable) becomes derived `constraints`, and any raw scope value
 * that fails registry validation (a hand-edited invalid value on disk)
 * surfaces as a `warnings[]` entry instead of being silently dropped,
 * clamped, or rewritten (D3's "read-time invalidity" requirement).
 */
export function serializeConfigEntry(entry: EffectiveConfigEntry): WireConfigEntry {
  const { definition } = entry;
  const warnings: string[] = [];

  for (const scope of ['global', 'project'] as const) {
    const scopeValue = entry.scopeValues[scope];
    if (scopeValue === undefined || !definition.scopes.includes(scope)) continue;
    const error = validateConfigValue(definition, scopeValue);
    if (error) {
      warnings.push(`Invalid ${scope} value on disk for "${definition.key}": ${error}`);
    }
  }

  return {
    definition: {
      key: definition.key,
      scopes: definition.scopes,
      type: definition.type,
      enumValues: definition.enumValues,
      defaultValue: definition.defaultValue,
      description: definition.description,
      group: definition.group,
      wildcard: definition.wildcard,
      constraints: deriveConstraints(definition),
    },
    value: entry.value,
    source: entry.source,
    scopeValues: entry.scopeValues,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
