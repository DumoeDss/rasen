import { describe, it, expect } from 'vitest';

import { serializeConfigEntry } from '../../../src/core/config-api/serialize.js';
import { findConfigKeyDefinition } from '../../../src/core/config-keys.js';
import type { EffectiveConfigEntry } from '../../../src/core/effective-config.js';
import { SUPPORTED_CLI_LOCALES } from '../../../src/utils/locale.js';

function entryFor(key: string, scope: 'global' | 'project', overrides: Partial<EffectiveConfigEntry> = {}): EffectiveConfigEntry {
  const definition = findConfigKeyDefinition(key, scope)!;
  return {
    definition,
    value: definition.defaultValue,
    source: 'default',
    scopeValues: {},
    ...overrides,
  };
}

describe('serializeConfigEntry', () => {
  it('drops the validate function and derives constraints for a dual-form threshold key', () => {
    const entry = entryFor('handoff.threshold', 'global', { value: 0.5, source: 'default' });
    const wire = serializeConfigEntry(entry);
    expect(wire.definition).not.toHaveProperty('validate');
    expect(wire.definition.constraints).toEqual({
      type: 'threshold',
      enumValues: undefined,
      range: { gt: 0, lte: 1 },
      remainingTokensGt: 0,
    });
  });

  it('flags an on-disk absolute-form { remainingTokens } value as valid (no warning)', () => {
    const entry = entryFor('handoff.threshold', 'global', {
      value: { remainingTokens: 60_000 },
      source: 'global',
      scopeValues: { global: { remainingTokens: 60_000 } },
    });
    const wire = serializeConfigEntry(entry);
    expect(wire.warnings).toBeUndefined();
  });

  it('derives enum constraints for an enum key', () => {
    const entry = entryFor('repoMode', 'global', { value: 'collaborative', source: 'default' });
    const wire = serializeConfigEntry(entry);
    expect(wire.definition.constraints).toEqual({
      type: 'enum',
      enumValues: ['solo', 'collaborative'],
      range: undefined,
    });
  });

  it('exposes every canonical language through config API metadata', () => {
    const entry = entryFor('language', 'global');
    const wire = serializeConfigEntry(entry);
    expect(wire.definition.enumValues).toEqual(['auto', ...SUPPORTED_CLI_LOCALES]);
    expect(wire.definition.constraints.enumValues).toEqual([
      'auto',
      ...SUPPORTED_CLI_LOCALES,
    ]);
  });

  it('carries no warnings when scope values are valid', () => {
    const entry = entryFor('handoff.threshold', 'global', {
      value: 0.4,
      source: 'global',
      scopeValues: { global: 0.4 },
    });
    const wire = serializeConfigEntry(entry);
    expect(wire.warnings).toBeUndefined();
  });

  it('surfaces a warning for an invalid on-disk global value without altering the reported value', () => {
    const entry = entryFor('handoff.threshold', 'global', {
      value: 5, // resolveEffectiveConfig() propagates hand-edited invalid values as-is
      source: 'global',
      scopeValues: { global: 5 },
    });
    const wire = serializeConfigEntry(entry);
    expect(wire.value).toBe(5); // never clamped or rewritten
    expect(wire.warnings).toEqual([expect.stringContaining('Invalid global value on disk for "handoff.threshold"')]);
  });

  it('surfaces a warning for an invalid on-disk project value', () => {
    const entry = entryFor('handoff.threshold', 'project', {
      value: -1,
      source: 'project',
      scopeValues: { project: -1 },
    });
    const wire = serializeConfigEntry(entry);
    expect(wire.warnings).toEqual([expect.stringContaining('Invalid project value on disk for "handoff.threshold"')]);
  });

  it('ignores a scope value the definition does not support', () => {
    // schema is project-only; a stray global scopeValue (never produced by
    // resolveEffectiveConfig, but defensive) must not be validated/warned on.
    const definition = findConfigKeyDefinition('schema', 'project')!;
    const entry: EffectiveConfigEntry = {
      definition,
      value: '',
      source: 'default',
      scopeValues: { global: 123 },
    };
    const wire = serializeConfigEntry(entry);
    expect(wire.warnings).toBeUndefined();
  });
});
