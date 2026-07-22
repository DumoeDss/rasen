import { describe, expect, it } from 'vitest';
import {
  selectControl,
  validateRangedNumber,
  validateThresholdValue,
  localScopeFor,
  modeScope,
  isVisibleInMode,
  isStoreInherited,
  KNOWN_MODEL_IDS,
} from '../../src/config/controls.js';
import { configListFixture, configListInheritedFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const entries: WireConfigEntry[] = configListFixture.entries;
const byKey = (key: string) => entries.find((e) => e.definition.key === key)!;
const inheritedByKey = (key: string) =>
  configListInheritedFixture.entries.find((e) => e.definition.key === key)!;

/** Synthesizes a `models.*`-shaped entry (config-page-coherence) — not in the recorded fixture, since it predates this change. */
function modelEntry(key: string, overrides: Partial<WireConfigEntry> = {}): WireConfigEntry {
  return {
    definition: {
      key,
      scopes: ['global', 'store', 'project'],
      type: 'string',
      defaultValue: undefined,
      description: 'test model key',
      group: 'Workflow',
      constraints: { type: 'string' },
    },
    value: 'sonnet',
    source: 'default',
    scopeValues: {},
    ...overrides,
  };
}

describe('localScopeFor / modeScope', () => {
  it('Local mode writes the project scope at a project space, the store scope at a store space', () => {
    expect(localScopeFor('project')).toBe('project');
    expect(localScopeFor('store')).toBe('store');
    expect(modeScope('local', 'project')).toBe('project');
    expect(modeScope('local', 'store')).toBe('store');
  });

  it('Global mode always writes the global scope, regardless of space type', () => {
    expect(modeScope('global', 'project')).toBe('global');
    expect(modeScope('global', 'store')).toBe('global');
  });
});

describe('isVisibleInMode', () => {
  it('shows a global-only key in Global mode but not in Local mode', () => {
    const globalOnly = byKey('proactive'); // scopes: ['global']
    expect(isVisibleInMode(globalOnly, 'global', 'project')).toBe(true);
    expect(isVisibleInMode(globalOnly, 'local', 'project')).toBe(false);
    expect(isVisibleInMode(globalOnly, 'local', 'store')).toBe(false);
  });

  it('shows a multi-scope key in both modes at a project space', () => {
    const multi = byKey('handoff.threshold'); // scopes: ['global','store','project']
    expect(isVisibleInMode(multi, 'global', 'project')).toBe(true);
    expect(isVisibleInMode(multi, 'local', 'project')).toBe(true);
  });

  it('shows a store/project key locally but never globally', () => {
    const schema = inheritedByKey('schema'); // scopes: ['store','project']
    expect(isVisibleInMode(schema, 'global', 'project')).toBe(false);
    expect(isVisibleInMode(schema, 'local', 'project')).toBe(true);
    expect(isVisibleInMode(schema, 'local', 'store')).toBe(true);
  });
});

describe('selectControl', () => {
  it('renders boolean constraints as a toggle (in a mode where the key is visible)', () => {
    expect(selectControl(byKey('proactive'), 'global', 'project').kind).toBe('toggle');
  });

  it('renders enum constraints as a select', () => {
    const spec = selectControl(byKey('delivery'), 'global', 'project');
    expect(spec.kind).toBe('select');
    expect(spec.enumValues).toEqual(['both', 'skills']);
  });

  it('renders a dual-form threshold with its fraction bounds and remainingTokens floor', () => {
    const spec = selectControl(byKey('handoff.threshold'), 'local', 'project');
    expect(spec.kind).toBe('threshold');
    expect(spec.range).toEqual({ gt: 0, lte: 1 });
    expect(spec.remainingTokensGt).toBe(0);
  });

  it('treats env-override entries as read-only regardless of mode', () => {
    const spec = selectControl(byKey('telemetry.enabled'), 'global', 'project');
    expect(spec.kind).toBe('readonly');
    expect(spec.readonly).toBe(true);
  });

  it('treats a key not settable in the active mode as read-only (global-only key in Local mode)', () => {
    const spec = selectControl(byKey('proactive'), 'local', 'project');
    expect(spec.kind).toBe('readonly');
    expect(spec.readonly).toBe(true);
  });

  it('keeps a store/project key editable in Local mode at a store space', () => {
    const spec = selectControl(inheritedByKey('schema'), 'local', 'store');
    expect(spec.kind).toBe('text');
    expect(spec.readonly).toBe(false);
  });

  it('renders models.default as a model control with known-id suggestions (config-page-coherence)', () => {
    const spec = selectControl(modelEntry('models.default'), 'local', 'project');
    expect(spec.kind).toBe('model');
    expect(spec.readonly).toBe(false);
    expect(spec.modelSuggestions).toEqual(KNOWN_MODEL_IDS);
  });

  it('renders models.roles.<role> as a model control too', () => {
    const spec = selectControl(modelEntry('models.roles.reviewer'), 'local', 'project');
    expect(spec.kind).toBe('model');
    expect(spec.modelSuggestions).toEqual(KNOWN_MODEL_IDS);
  });

  it('does not treat an ordinary string key as a model control', () => {
    const spec = selectControl(
      modelEntry('schema', { definition: { ...modelEntry('schema').definition, scopes: ['store', 'project'] } }),
      'local',
      'project'
    );
    expect(spec.kind).toBe('text');
    expect(spec.modelSuggestions).toBeUndefined();
  });
});

describe('isStoreInherited', () => {
  it('is true for a store-sourced key in Local mode at a project space', () => {
    const storeInherited = inheritedByKey('autopilot.gates'); // source: 'store'
    expect(isStoreInherited(storeInherited, 'local', 'project')).toBe(true);
  });

  it('is false in Global mode (Global edits the machine-wide scope regardless of the effective source)', () => {
    const storeInherited = inheritedByKey('autopilot.gates');
    expect(isStoreInherited(storeInherited, 'global', 'project')).toBe(false);
  });

  it('is false at a store space (the store edits its own value directly)', () => {
    const storeInherited = inheritedByKey('autopilot.gates');
    expect(isStoreInherited(storeInherited, 'local', 'store')).toBe(false);
  });

  it('is false for a locally-set (project-sourced) key', () => {
    expect(isStoreInherited(inheritedByKey('schema'), 'local', 'project')).toBe(false);
  });
});

describe('KNOWN_MODEL_IDS preset parity', () => {
  // Drift guard for the hand-maintained suggestion list: every datalist
  // suggestion must resolve to a MODEL_PRESETS entry under the real
  // `id.includes(match)` matching, so the control never steers a user
  // toward an id that silently misses preset-derived thresholds/windows
  // (bare 'sonnet'/'opus' were exactly that trap). Imports the root
  // package's registry directly — test-only; the shipped bundle stays
  // self-contained.
  it('every suggested id resolves to a model preset', async () => {
    const { resolveModelPreset } = await import('../../../../src/core/model-presets');
    for (const id of KNOWN_MODEL_IDS) {
      expect(resolveModelPreset(id), `suggestion '${id}' must match a MODEL_PRESETS entry`).toBeDefined();
    }
  });
});

describe('validateThresholdValue', () => {
  it('validates the fraction branch like validateRangedNumber', () => {
    expect(validateThresholdValue(0.5, { gt: 0, lte: 1 })).toBeNull();
    expect(validateThresholdValue(1.5, { gt: 0, lte: 1 })).not.toBeNull();
  });

  it('validates the absolute { remainingTokens } branch against the floor', () => {
    expect(validateThresholdValue({ remainingTokens: 60_000 }, undefined, 0)).toBeNull();
    expect(validateThresholdValue({ remainingTokens: 0 }, undefined, 0)).not.toBeNull();
    expect(validateThresholdValue({ remainingTokens: 1.5 }, undefined, 0)).not.toBeNull();
  });
});

describe('validateRangedNumber', () => {
  it('rejects NaN', () => {
    expect(validateRangedNumber(NaN, { gt: 0, lte: 1 })).not.toBeNull();
  });

  it('rejects values outside (gt, lte]', () => {
    expect(validateRangedNumber(0, { gt: 0, lte: 1 })).not.toBeNull();
    expect(validateRangedNumber(1.5, { gt: 0, lte: 1 })).not.toBeNull();
  });

  it('accepts values within (gt, lte]', () => {
    expect(validateRangedNumber(1, { gt: 0, lte: 1 })).toBeNull();
    expect(validateRangedNumber(0.001, { gt: 0, lte: 1 })).toBeNull();
  });
});
