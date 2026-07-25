import { describe, expect, it } from 'vitest';
import { GlobalConfigSchema } from '../../src/core/config-schema.js';
import {
  findConfigKeyDefinition,
  validateConfigKeyPath,
  validateConfigValue,
} from '../../src/core/config-keys.js';

describe('ui.theme global configuration', () => {
  it('defaults additively while preserving pinnedSpaces and unknown ui fields', () => {
    const parsed = GlobalConfigSchema.parse({
      ui: { pinnedSpaces: ['project:demo'], futurePreference: { enabled: true } },
    });
    expect(parsed.ui).toEqual({
      theme: 'editorial',
      pinnedSpaces: ['project:demo'],
      futurePreference: { enabled: true },
    });
  });

  it('registers a global-only Appearance string with portable id validation', () => {
    const definition = findConfigKeyDefinition('ui.theme', 'global');
    expect(definition).toMatchObject({
      scopes: ['global'],
      type: 'string',
      defaultValue: 'editorial',
      group: 'Appearance',
    });
    expect(validateConfigKeyPath('ui.theme', 'global').valid).toBe(true);
    expect(validateConfigKeyPath('ui.theme', 'project').valid).toBe(false);
    expect(validateConfigKeyPath('ui.theme', 'store').valid).toBe(false);
    expect(validateConfigValue(definition!, 'forest-paper')).toBeNull();
    for (const value of ['CRT', '../theme', 'two words', 'theme/child']) {
      expect(validateConfigValue(definition!, value)).not.toBeNull();
    }
  });
});
