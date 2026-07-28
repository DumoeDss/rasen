import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { serializeConfigEntry } from '../../../src/core/config-api/serialize.js';
import { findConfigKeyDefinition } from '../../../src/core/config-keys.js';
import { saveNamedProfile } from '../../../src/core/named-profiles.js';
import type { EffectiveConfigEntry } from '../../../src/core/effective-config.js';
import { SUPPORTED_CLI_LOCALES } from '../../../src/utils/locale.js';

function entryFor(key: string, scope: 'global' | 'store' | 'project', overrides: Partial<EffectiveConfigEntry> = {}): EffectiveConfigEntry {
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

  it('a scope-invariant enum carries no enumValuesByScope', () => {
    const entry = entryFor('repoMode', 'global');
    const wire = serializeConfigEntry(entry);
    expect(wire.definition.constraints.enumValuesByScope).toBeUndefined();
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

  it('surfaces a warning for an invalid on-disk store value', () => {
    const entry = entryFor('handoff.threshold', 'store', {
      value: 5,
      source: 'store',
      scopeValues: { store: 5 },
    });
    const wire = serializeConfigEntry(entry);
    expect(wire.value).toBe(5); // never clamped or rewritten
    expect(wire.warnings).toEqual([expect.stringContaining('Invalid store value on disk for "handoff.threshold"')]);
  });

  describe('profile per-scope enum domains (config-http-api spec)', () => {
    let tempDir: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-serialize-profile-'));
      originalEnv = { ...process.env };
      process.env.RASEN_HOME = tempDir;
    });

    afterEach(() => {
      process.env = originalEnv;
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('profile entry serves both scope domains, saved names included', () => {
      saveNamedProfile('my-set', { version: 1, workflows: ['propose'] });
      const entry = entryFor('profile', 'global', { value: 'full', source: 'default' });
      const wire = serializeConfigEntry(entry);
      const byScope = wire.definition.constraints.enumValuesByScope;
      expect(byScope).toBeDefined();
      expect(byScope!.global).toEqual(['full', 'core', 'custom', 'my-set']);
      expect(byScope!.project).toEqual(['full', 'core', 'my-set']);
      // The static list stays for backward compatibility.
      expect(wire.definition.constraints.enumValues).toEqual(['full', 'core', 'custom']);
    });
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
