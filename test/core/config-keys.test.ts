import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CONFIG_KEY_REGISTRY,
  classifyWildcardPath,
  collectFamilyInstancePaths,
  findConfigKeyDefinition,
  findWildcardDefinition,
  validateConfigKeyPath,
  validateConfigValue,
} from '../../src/core/config-keys.js';
import { GlobalConfigSchema } from '../../src/core/config-schema.js';
import { saveNamedProfile } from '../../src/core/named-profiles.js';
import { ProjectConfigSchema } from '../../src/core/project-config.js';
import { SUPPORTED_CLI_LOCALES } from '../../src/utils/locale.js';

describe('config-keys registry', () => {
  describe('validateConfigKeyPath', () => {
    it('accepts known global keys', () => {
      expect(validateConfigKeyPath('profile', 'global').valid).toBe(true);
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

    it('accepts workflows at project scope and rejects it at store scope', () => {
      const projectResult = validateConfigValue(findConfigKeyDefinition('workflows', 'project')!, ['review']);
      expect(validateConfigKeyPath('workflows', 'project').valid).toBe(true);
      expect(projectResult).toBeNull();
      expect(validateConfigKeyPath('workflows', 'store').valid).toBe(false);
    });

    it('accepts profile at project scope and rejects it at store scope (init-profile-lock)', () => {
      expect(validateConfigKeyPath('profile', 'project').valid).toBe(true);
      expect(validateConfigKeyPath('profile', 'store').valid).toBe(false);
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

    it('rejects a non-array value for ui.pinnedSpaces (the array type)', () => {
      const def = findConfigKeyDefinition('ui.pinnedSpaces', 'global')!;
      expect(validateConfigValue(def, 'project:api')).toMatch(/array/);
      expect(validateConfigValue(def, { a: 1 })).toMatch(/array/);
      expect(validateConfigValue(def, ['project:api', 'store:team'])).toBeNull();
    });
  });

  describe('ui.pinnedSpaces (spaces-page pins key)', () => {
    it('is a global-only array key with an empty-array default', () => {
      expect(validateConfigKeyPath('ui.pinnedSpaces', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('ui.pinnedSpaces', 'project').valid).toBe(false);
      const def = findConfigKeyDefinition('ui.pinnedSpaces', 'global')!;
      expect(def.type).toBe('array');
      expect(def.defaultValue).toEqual([]);
    });

    it('round-trips a selector array through the global config schema', () => {
      const result = GlobalConfigSchema.safeParse({
        ui: { pinnedSpaces: ['store:team-store', 'project:api'] },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('keepalive.beatSeconds (keepalive-beat-config key)', () => {
    it('is a global-only number key defaulting to 270 in the Pipelines group', () => {
      expect(validateConfigKeyPath('keepalive.beatSeconds', 'global').valid).toBe(true);
      expect(validateConfigKeyPath('keepalive.beatSeconds', 'project').valid).toBe(false);
      expect(validateConfigKeyPath('keepalive.beatSeconds', 'store').valid).toBe(false);
      const def = findConfigKeyDefinition('keepalive.beatSeconds', 'global')!;
      expect(def.type).toBe('number');
      expect(def.defaultValue).toBe(270);
      expect(def.group).toBe('Pipelines');
    });

    it('accepts integers across the 90–280 range', () => {
      const def = findConfigKeyDefinition('keepalive.beatSeconds', 'global')!;
      for (const value of [90, 100, 180, 270, 280]) {
        expect(validateConfigValue(def, value)).toBeNull();
      }
    });

    it('rejects out-of-range and non-integer numbers naming the 90–280 constraint', () => {
      const def = findConfigKeyDefinition('keepalive.beatSeconds', 'global')!;
      for (const value of [85, 89, 281, 300, 180.5]) {
        expect(validateConfigValue(def, value)).toMatch(/90 and 280/);
      }
      // A non-number is rejected by the type gate before the range validator.
      expect(validateConfigValue(def, 'fast')).toMatch(/number/);
    });

    it('round-trips a valid beatSeconds through the global config schema and rejects out-of-range', () => {
      expect(GlobalConfigSchema.safeParse({ keepalive: { beatSeconds: 120 } }).success).toBe(true);
      expect(GlobalConfigSchema.safeParse({ keepalive: { beatSeconds: 300 } }).success).toBe(false);
    });
  });

  describe('profile key per-scope values (init-profile-lock)', () => {
    let tempDir: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-keys-profile-'));
      originalEnv = { ...process.env };
      process.env.RASEN_HOME = tempDir;
    });

    afterEach(() => {
      process.env = originalEnv;
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('global scope accepts full/core/custom AND a saved profile name', () => {
      saveNamedProfile('team-web', { version: 1, workflows: ['propose'] });
      const def = findConfigKeyDefinition('profile', 'global')!;
      for (const value of ['full', 'core', 'custom', 'team-web']) {
        expect(validateConfigValue(def, value, 'global')).toBeNull();
      }
    });

    it('global scope rejects an unknown name, naming the value and listing the available profiles', () => {
      saveNamedProfile('team-web', { version: 1, workflows: ['propose'] });
      const def = findConfigKeyDefinition('profile', 'global')!;
      const unknownError = validateConfigValue(def, 'no-such-profile', 'global');
      expect(unknownError).toContain('must be one of');
      expect(unknownError).toContain('"no-such-profile"');
      expect(unknownError).toContain('custom'); // custom IS a global value
      expect(unknownError).toContain('team-web');
    });

    it('project scope accepts full, core, and a saved profile name', () => {
      saveNamedProfile('team-web', { version: 1, workflows: ['propose'] });
      const def = findConfigKeyDefinition('profile', 'project')!;
      for (const value of ['full', 'core', 'team-web']) {
        expect(validateConfigValue(def, value, 'project')).toBeNull();
      }
    });

    it('project scope rejects custom and an unknown name, naming the value and listing the available profiles', () => {
      saveNamedProfile('team-web', { version: 1, workflows: ['propose'] });
      const def = findConfigKeyDefinition('profile', 'project')!;

      const customError = validateConfigValue(def, 'custom', 'project');
      expect(customError).toContain('must be one of');
      expect(customError).toContain('"custom"'); // names the rejected value
      expect(customError).toContain('team-web');
      expect(customError).not.toContain('custom,'); // custom is not an allowed project value

      // The unknown-name rejection names the offending value AND lists the
      // available profiles (config-key-registry spec).
      const unknownError = validateConfigValue(def, 'no-such-profile', 'project');
      expect(unknownError).toContain('must be one of');
      expect(unknownError).toContain('"no-such-profile"');
      expect(unknownError).toContain('team-web');
    });

    it('scope-less validation keeps the historical global enum', () => {
      const def = findConfigKeyDefinition('profile', 'global')!;
      expect(validateConfigValue(def, 'custom')).toBeNull();
    });
  });

  describe('scope assignment', () => {
    it('assigns exactly 9 global-only, 2 global+project, 3 store+project, and 14 all-three keys', () => {
      const nonWildcard = CONFIG_KEY_REGISTRY.filter((def) => !def.wildcard);
      const sorted = (def: (typeof nonWildcard)[number]) => [...def.scopes].sort().join(',');
      const globalOnly = nonWildcard.filter((def) => sorted(def) === 'global');
      const globalProject = nonWildcard.filter((def) => sorted(def) === 'global,project');
      const storeProject = nonWildcard.filter((def) => sorted(def) === 'project,store');
      const allThree = nonWildcard.filter((def) => sorted(def) === 'global,project,store');

      // Guards a future key from silently missing the store scope.
      // 9 = the machine-level keys from the store-scope re-scope plus
      // ui.pinnedSpaces (spaces-page pins, deliberately global-only) plus the
      // 4 keepalive keys (runtimes.claude/codex + contextFloor + beatSeconds —
      // machine-level gates/tuning for `rasen agent wait`, deliberately
      // global-only) — `delivery` was retired from this bucket, `workflows`
      // moved to global+project (space-workflow-enablement), and `profile`
      // moved to global+project (init-profile-lock: a project-scope value is the
      // locked profile).
      expect(globalOnly.length).toBe(9);
      expect(globalProject.length).toBe(2);
      expect(globalProject.map((def) => def.key).sort()).toEqual(['profile', 'workflows']);
      expect(storeProject.length).toBe(3);
      expect(allThree.length).toBe(14);
      // Five wildcard families: featureFlags (the sole global-only wildcard)
      // plus the four all-three-scope pipelines.* families
      // (gates/models/handoff per stage, runtimes per role).
      const wildcards = CONFIG_KEY_REGISTRY.filter((def) => def.wildcard);
      expect(wildcards.length).toBe(5);
      // featureFlags is the sole global-only wildcard; the pipelines families
      // are settable in all three scopes.
      expect(wildcards.filter((def) => def.scopes.join(',') === 'global').length).toBe(1);
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

    it('a set instance of each pipelines family round-trips through every declared scope schema', () => {
      const cases = [
        { instance: { pipelines: { p: { gates: { s: 'on' } } } } },
        { instance: { pipelines: { p: { models: { s: 'fable' } } } } },
        { instance: { pipelines: { p: { handoff: { s: 0.6 } } } } },
        { instance: { pipelines: { p: { handoff: { s: { remainingTokens: 60_000 } } } } } },
        { instance: { pipelines: { p: { runtimes: { reviewer: 'codex' } } } } },
      ];
      for (const { instance } of cases) {
        // global JSON schema
        expect(GlobalConfigSchema.safeParse(instance).success).toBe(true);
        // planning-root YAML schema (store + project layers share it), which
        // requires a `schema` field.
        expect(
          ProjectConfigSchema.safeParse({ schema: 'spec-driven', ...instance }).success
        ).toBe(true);
      }
    });
  });
});

describe('wildcard config key families', () => {
  const PIPELINE_FAMILIES = [
    { pattern: 'pipelines.<name>.gates.<stage>', instance: 'pipelines.small-feature.gates.propose', valid: 'on', invalid: 'maybe' },
    { pattern: 'pipelines.<name>.models.<stage>', instance: 'pipelines.bug-fix.models.review', valid: 'fable', invalid: '' },
    { pattern: 'pipelines.<name>.handoff.<stage>', instance: 'pipelines.goal-loop.handoff.measure', valid: 0.6, invalid: 1.5 },
    { pattern: 'pipelines.<name>.runtimes.<role>', instance: 'pipelines.small-feature.runtimes.reviewer', valid: 'codex', invalid: 'gpt' },
  ] as const;

  describe('valid instances validate in all three scopes', () => {
    for (const family of PIPELINE_FAMILIES) {
      it(`${family.pattern} accepts a well-formed instance at global/store/project`, () => {
        for (const scope of ['global', 'store', 'project'] as const) {
          expect(validateConfigKeyPath(family.instance, scope).valid).toBe(true);
          const def = findWildcardDefinition(family.instance, scope)!;
          expect(def).toBeDefined();
          expect(def.pattern).toBe(family.pattern);
          expect(validateConfigValue(def, family.valid)).toBeNull();
          expect(validateConfigValue(def, family.invalid)).not.toBeNull();
        }
      });
    }
  });

  it('rejects a wrong-shape family path naming the pattern', () => {
    const missingStage = validateConfigKeyPath('pipelines.small-feature.gates', 'global');
    expect(missingStage.valid).toBe(false);
    expect(missingStage.reason).toContain('pipelines.<name>.gates.<stage>');

    const extraSegment = validateConfigKeyPath('pipelines.small-feature.gates.propose.extra', 'project');
    expect(extraSegment.valid).toBe(false);
    expect(extraSegment.reason).toContain('pipelines.<name>.gates.<stage>');
  });

  it('rejects a bad placeholder charset naming the pattern', () => {
    const result = validateConfigKeyPath('pipelines.bad!name.gates.propose', 'global');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('pipelines.<name>.gates.<stage>');
  });

  it('accepts an unknown referent structurally (no pipeline/stage existence check)', () => {
    expect(validateConfigKeyPath('pipelines.no-such-pipeline.models.no-such-stage', 'global').valid).toBe(true);
  });

  it('rejects the dual-form threshold out of range but accepts both valid forms', () => {
    const def = findWildcardDefinition('pipelines.bug-fix.handoff.review', 'store')!;
    expect(validateConfigValue(def, 0.6)).toBeNull();
    expect(validateConfigValue(def, { remainingTokens: 60_000 })).toBeNull();
    expect(validateConfigValue(def, 1.5)).toMatch(/\(0, 1\]/);
  });

  it('classifies scope-independently for the API router', () => {
    expect(classifyWildcardPath('pipelines.x.gates.propose').kind).toBe('match');
    expect(classifyWildcardPath('pipelines.x.gates').kind).toBe('wrong_shape');
    expect(classifyWildcardPath('pipelines.x!.gates.propose').kind).toBe('bad_placeholder');
    expect(classifyWildcardPath('not.a.family').kind).toBe('none');
  });

  describe('featureFlags is unchanged through the general mechanism', () => {
    it('accepts a boolean at global scope and rejects a non-boolean', () => {
      expect(validateConfigKeyPath('featureFlags.someFlag', 'global').valid).toBe(true);
      const def = findWildcardDefinition('featureFlags.someFlag', 'global')!;
      expect(def.key).toBe('featureFlags');
      expect(validateConfigValue(def, true)).toBeNull();
      expect(validateConfigValue(def, 'yes')).toMatch(/boolean/);
    });

    it('rejects a third segment and rejects the store scope', () => {
      expect(validateConfigKeyPath('featureFlags.someFlag.extra', 'global').valid).toBe(false);
      expect(validateConfigKeyPath('featureFlags.someFlag', 'store').valid).toBe(false);
      expect(validateConfigKeyPath('featureFlags.someFlag', 'project').valid).toBe(false);
    });
  });

  describe('collectFamilyInstancePaths', () => {
    it('enumerates every set instance under the family literal structure', () => {
      const def = findWildcardDefinition('pipelines.x.gates.y', 'global')!;
      const record = {
        pipelines: {
          'small-feature': { gates: { propose: 'on', review: 'off' } },
          'bug-fix': { gates: { implement: 'on' }, models: { review: 'fable' } },
        },
      };
      expect(collectFamilyInstancePaths(def, record).sort()).toEqual([
        'pipelines.bug-fix.gates.implement',
        'pipelines.small-feature.gates.propose',
        'pipelines.small-feature.gates.review',
      ]);
    });

    it('returns [] for an absent block', () => {
      const def = findWildcardDefinition('pipelines.x.models.y', 'global')!;
      expect(collectFamilyInstancePaths(def, {})).toEqual([]);
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
