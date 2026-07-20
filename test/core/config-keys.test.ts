import { describe, it, expect } from 'vitest';

import {
  CONFIG_KEY_REGISTRY,
  findConfigKeyDefinition,
  validateConfigKeyPath,
  validateConfigValue,
} from '../../src/core/config-keys.js';
import { GlobalConfigSchema } from '../../src/core/config-schema.js';
import { ProjectConfigSchema } from '../../src/core/project-config.js';

describe('config-keys registry', () => {
  describe('validateConfigKeyPath', () => {
    it('accepts known global keys', () => {
      expect(validateConfigKeyPath('profile', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('delivery', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('workflows', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('language', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('proactive', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('repoMode', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('telemetry.enabled', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('handoff.threshold', 'global').valid).toBe(true);
    });

    it('accepts featureFlags.<name> wildcard for global scope only', () => {
      expect(validateConfigKeyPath('featureFlags.someFlag', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('featureFlags.someFlag', 'project').valid).toBe(false);
    });

    it('rejects featureFlags with extra nesting', () => {
      const result = validateConfigKeyPath('featureFlags.someFlag.extra', 'global');
      expect(result.valid).toBe(false);
    });

    it('accepts known project keys', () => {
      expect(validateConfigKeyPath('schema', 'project').valid).toBe(true);
      expect(validateConfigKeyPath('autopilot.gates', 'project').valid).toBe(true);
      expect(validateConfigKeyPath('autopilot.selection', 'project').valid).toBe(true);
      expect(validateConfigKeyPath('archive.timing', 'project').valid).toBe(true);
      expect(validateConfigKeyPath('archive.destination', 'project').valid).toBe(true);
      expect(validateConfigKeyPath('handoff.threshold', 'project').valid).toBe(true);
    });

    it('rejects a global-only key at project scope', () => {
      expect(validateConfigKeyPath('proactive', 'project').valid).toBe(false);
    });

    it('rejects a project-only key at global scope', () => {
      expect(validateConfigKeyPath('archive.timing', 'global').valid).toBe(false);
    });

    it('accepts the promoted autopilot keys at global scope', () => {
      expect(validateConfigKeyPath('autopilot.gates', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('autopilot.selection', 'global').valid).toBe(true);
    });

    it('accepts the per-role handoff and model keys at both scopes', () => {
      for (const scope of ['global', 'project'] as const) {
        for (const role of ['planner', 'implementer', 'reviewer', 'fixer', 'shipper']) {
          expect(validateConfigKeyPath(`handoff.roles.${role}`, scope).valid).toBe(true);
          expect(validateConfigKeyPath(`models.roles.${role}`, scope).valid).toBe(true);
        }
        expect(validateConfigKeyPath('models.default', scope).valid).toBe(true);
      }
    });

    it('rejects unknown keys', () => {
      expect(validateConfigKeyPath('unknownKey', 'global').valid).toBe(false);
      expect(validateConfigKeyPath('unknownKey', 'project').valid).toBe(false);
    });

    it('rejects machine-managed telemetry fields as not settable', () => {
      const result = validateConfigKeyPath('telemetry.anonymousId', 'global');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not settable/);
    });

    it('defaults to global scope', () => {
      expect(validateConfigKeyPath('profile').valid).toBe(true);
    });
  });

  describe('validateConfigValue', () => {
    it('names the allowed values for an enum rejection', () => {
      const def = findConfigKeyDefinition('repoMode', 'global')!;
      const error = validateConfigValue(def, 'banana');
      expect(error).toMatch(/solo/);
      expect(error).toMatch(/collaborative/);
    });

    it('limits language to auto, English, or Japanese', () => {
      const def = findConfigKeyDefinition('language', 'global')!;
      expect(validateConfigValue(def, 'auto')).toBeNull();
      expect(validateConfigValue(def, 'en')).toBeNull();
      expect(validateConfigValue(def, 'ja')).toBeNull();
      expect(validateConfigValue(def, 'fr')).toMatch(/auto/);
    });

    it('names the allowed range for an out-of-range threshold', () => {
      const def = findConfigKeyDefinition('handoff.threshold', 'global')!;
      const error = validateConfigValue(def, 1.5);
      expect(error).toMatch(/\(0, 1\]/);
    });

    it('accepts a valid threshold', () => {
      const def = findConfigKeyDefinition('handoff.threshold', 'project')!;
      expect(validateConfigValue(def, 0.6)).toBeNull();
    });

    describe('the threshold key accepts its dual form', () => {
      const def = findConfigKeyDefinition('handoff.threshold', 'global')!;

      it('accepts a valid { remainingTokens } object', () => {
        expect(validateConfigValue(def, { remainingTokens: 60_000 })).toBeNull();
        expect(validateConfigValue(def, { remainingTokens: 1 })).toBeNull();
      });

      it('rejects remainingTokens: 0', () => {
        expect(validateConfigValue(def, { remainingTokens: 0 })).toMatch(/positive integer/);
      });

      it('rejects a negative remainingTokens', () => {
        expect(validateConfigValue(def, { remainingTokens: -5 })).toMatch(/positive integer/);
      });

      it('rejects a non-integer remainingTokens', () => {
        expect(validateConfigValue(def, { remainingTokens: 1.5 })).toMatch(/positive integer/);
      });

      it('rejects an object with an extra key', () => {
        expect(validateConfigValue(def, { remainingTokens: 60_000, bogus: 1 })).toMatch(
          /exactly \{ remainingTokens/
        );
      });

      it('rejects an object missing remainingTokens', () => {
        expect(validateConfigValue(def, {})).toMatch(/exactly \{ remainingTokens/);
      });

      it('rejects an array', () => {
        expect(validateConfigValue(def, [0.5])).toMatch(/must be a number in \(0, 1\]/);
      });

      it('rejects null and a bare string', () => {
        expect(validateConfigValue(def, null)).toMatch(/must be a number in \(0, 1\]/);
        expect(validateConfigValue(def, '0.5')).toMatch(/must be a number in \(0, 1\]/);
      });
    });

    it('rejects a non-boolean for a boolean key', () => {
      const def = findConfigKeyDefinition('proactive', 'global')!;
      expect(validateConfigValue(def, 'yes')).toMatch(/boolean/);
    });
  });

  describe('registry/schema round-trip consistency', () => {
    it('every non-wildcard registry key is accepted by its scope schema', () => {
      for (const def of CONFIG_KEY_REGISTRY) {
        if (def.wildcard) continue;

        for (const scope of def.scopes) {
          const schema = scope === 'global' ? GlobalConfigSchema : ProjectConfigSchema;
          const skeleton: Record<string, unknown> = {};
          if (scope === 'project') {
            skeleton.schema = 'spec-driven';
          }
          setPath(skeleton, def.key, def.defaultValue === '' ? 'placeholder' : def.defaultValue);

          const result = schema.safeParse(skeleton);
          expect(
            result.success,
            `registry key "${def.key}" (${scope}) failed its schema: ${
              result.success ? '' : JSON.stringify(result.error.issues)
            }`
          ).toBe(true);
        }
      }
    });
  });
});

function setPath(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
