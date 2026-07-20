import { describe, expect, it } from 'vitest';
import {
  selectControl,
  validateRangedNumber,
  validateThresholdValue,
  writableScopes,
  defaultWriteScope,
  KNOWN_MODEL_IDS,
} from '../../src/config/controls.js';
import { configListFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const entries: WireConfigEntry[] = configListFixture.entries;
const byKey = (key: string) => entries.find((e) => e.definition.key === key)!;

/** Synthesizes a `models.*`-shaped entry (config-page-coherence) — not in the recorded fixture, since it predates this change. */
function modelEntry(key: string, overrides: Partial<WireConfigEntry> = {}): WireConfigEntry {
  return {
    definition: {
      key,
      scopes: ['global', 'project'],
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

describe('selectControl', () => {
  it('renders boolean constraints as a toggle', () => {
    expect(selectControl(byKey('proactive'), true).kind).toBe('toggle');
  });

  it('renders enum constraints as a select', () => {
    const spec = selectControl(byKey('delivery'), true);
    expect(spec.kind).toBe('select');
    expect(spec.enumValues).toEqual(['both', 'skills']);
  });

  it('renders a dual-form threshold with its fraction bounds and remainingTokens floor', () => {
    const spec = selectControl(byKey('handoff.threshold'), true);
    expect(spec.kind).toBe('threshold');
    expect(spec.range).toEqual({ gt: 0, lte: 1 });
    expect(spec.remainingTokensGt).toBe(0);
  });

  it('treats env-override entries as read-only regardless of type', () => {
    const spec = selectControl(byKey('telemetry.enabled'), true);
    expect(spec.kind).toBe('readonly');
    expect(spec.readonly).toBe(true);
  });

  it('treats a project-only key as read-only when no project is selected (B1)', () => {
    const spec = selectControl(byKey('autopilot.gates'), false);
    expect(spec.kind).toBe('readonly');
    expect(spec.readonly).toBe(true);
  });

  it('keeps a project-only key editable once a project is selected', () => {
    const spec = selectControl(byKey('autopilot.gates'), true);
    expect(spec.kind).toBe('select');
    expect(spec.readonly).toBe(false);
  });

  it('keeps a dual-scope key editable (global-only) when no project is selected', () => {
    const spec = selectControl(byKey('handoff.threshold'), false);
    expect(spec.kind).toBe('threshold');
    expect(spec.readonly).toBe(false);
  });

  it('renders models.default as a model control with known-id suggestions (config-page-coherence)', () => {
    const spec = selectControl(modelEntry('models.default'), true);
    expect(spec.kind).toBe('model');
    expect(spec.readonly).toBe(false);
    expect(spec.modelSuggestions).toEqual(KNOWN_MODEL_IDS);
  });

  it('renders models.roles.<role> as a model control too', () => {
    const spec = selectControl(modelEntry('models.roles.reviewer'), true);
    expect(spec.kind).toBe('model');
    expect(spec.modelSuggestions).toEqual(KNOWN_MODEL_IDS);
  });

  it('does not treat an ordinary string key as a model control', () => {
    const spec = selectControl(modelEntry('schema', { definition: { ...modelEntry('schema').definition, scopes: ['project'] } }), true);
    expect(spec.kind).toBe('text');
    expect(spec.modelSuggestions).toBeUndefined();
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

describe('writableScopes / defaultWriteScope', () => {
  it('lists both scopes for a dual-scope key when a project is selected', () => {
    expect(writableScopes(byKey('handoff.threshold'), true)).toEqual(['global', 'project']);
  });

  it('defaults to the currently-effective scope when it is writable', () => {
    expect(defaultWriteScope(byKey('handoff.threshold'), true)).toBe('project');
  });

  it('returns no writable scopes for an env-override entry', () => {
    expect(writableScopes(byKey('telemetry.enabled'), true)).toEqual([]);
    expect(defaultWriteScope(byKey('telemetry.enabled'), true)).toBeUndefined();
  });

  it('falls back to the first allowed scope when the effective source is not itself writable (default)', () => {
    expect(defaultWriteScope(byKey('delivery'), true)).toBe('global');
  });

  it('filters out "project" when no project is selected (B1: dual-scope key)', () => {
    expect(writableScopes(byKey('handoff.threshold'), false)).toEqual(['global']);
    expect(defaultWriteScope(byKey('handoff.threshold'), false)).toBe('global');
  });

  it('returns no writable scopes for a project-only key when no project is selected (B1)', () => {
    expect(writableScopes(byKey('autopilot.gates'), false)).toEqual([]);
    expect(defaultWriteScope(byKey('autopilot.gates'), false)).toBeUndefined();
  });

  it('offers "project" once a project is selected for a project-only key', () => {
    expect(writableScopes(byKey('autopilot.gates'), true)).toEqual(['project']);
  });
});
