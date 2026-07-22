import { describe, it, expect } from 'vitest';

import {
  CONFIG_KEY_REGISTRY,
  findConfigKeyDefinition,
  validateConfigKeyPath,
  validateConfigValue,
} from '../../src/core/config-keys.js';
import { GlobalConfigSchema } from '../../src/core/config-schema.js';
import { ProjectConfigSchema } from '../../src/core/project-config.js';
import { SUPPORTED_CLI_LOCALES } from '../../src/utils/locale.js';

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

    it('accepts the per-role handoff and model keys at all three scopes', () => {
      for (const scope of ['global', 'store', 'project'] as const) {
        for (const role of ['planner', 'implementer', 'reviewer', 'fixer', 'shipper']) {
          expect(validateConfigKeyPath(`handoff.roles.${role}`, scope).valid).toBe(true);
          expect(validateConfigKeyPath(`models.roles.${role}`, scope).valid).toBe(true);
        }
        expect(validateConfigKeyPath('models.default', scope).valid).toBe(true);
      }
    });

    it('accepts the store-capable keys at store scope', () => {
      expect(validateConfigKeyPath('handoff.threshold', 'store').valid).toBe(true);
      expect(validateConfigKeyPath('schema', 'store').valid).toBe(true);
      expect(validateConfigKeyPath('archive.timing', 'store').valid).toBe(true);
      expect(validateConfigKeyPath('archive.destination', 'store').valid).toBe(true);
      expect(validateConfigKeyPath('autopilot.gates', 'store').valid).toBe(true);
      expect(validateConfigKeyPath('autopilot.selection', 'store').valid).toBe(true);
      expect(validateConfigKeyPath('models.default', 'store').valid).toBe(true);
    });

    it('rejects global-only keys and the featureFlags wildcard at store scope', () => {
      expect(validateConfigKeyPath('profile', 'store').valid).toBe(false);
      expect(validateConfigKeyPath('telemetry.enabled', 'store').valid).toBe(false);
      expect(validateConfigKeyPath('featureFlags.someFlag', 'store').valid).toBe(false);
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

    it('limits language to auto or a canonical supported CLI locale', () => {
      const def = findConfigKeyDefinition('language', 'global')!;
      expect(def.enumValues).toEqual(['auto', ...SUPPORTED_CLI_LOCALES]);
      for (const language of ['auto', ...SUPPORTED_CLI_LOCALES]) {
        expect(validateConfigValue(def, language)).toBeNull();
      }
      for (const language of ['zh-CN', 'zh_CN', 'zh-SG', 'zh-Hans', 'zh', 'fr']) {
        expect(validateConfigValue(def, language)).toMatch(/auto/);
      }
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

  describe('scope assignment', () => {
    it('assigns exactly 8 global-only, 3 store+project, and 14 all-three keys', () => {
      const nonWildcard = CONFIG_KEY_REGISTRY.filter((def) => !def.wildcard);
      const sorted = (def: (typeof nonWildcard)[number]) => [...def.scopes].sort().join(',');
      const globalOnly = nonWildcard.filter((def) => sorted(def) === 'global');
      const storeProject = nonWildcard.filter((def) => sorted(def) === 'project,store');
      const allThree = nonWildcard.filter((def) => sorted(def) === 'global,project,store');

      // Guards a future key from silently missing the store scope.
      expect(globalOnly.length).toBe(7);
      expect(storeProject.length).toBe(3);
      expect(allThree.length).toBe(14);
      // Only featureFlags is a global-only wildcard; the 8th global-only key.
      expect(CONFIG_KEY_REGISTRY.filter((def) => def.wildcard).length).toBe(1);
    });
  });

  describe('registry/schema round-trip consistency', () => {
    it('every non-wildcard registry key is accepted by its scope schema', () => {
      for (const def of CONFIG_KEY_REGISTRY) {
        if (def.wildcard) continue;

        for (const scope of def.scopes) {
          // A store's config file is the same `rasen/config.yaml` shape a
          // planning root uses, so store-scoped entries validate against the
          // project config schema (design D4).
          const schema = scope === 'global' ? GlobalConfigSchema : ProjectConfigSchema;
          const skeleton: Record<string, unknown> = {};
          if (scope === 'project' || scope === 'store') {
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
