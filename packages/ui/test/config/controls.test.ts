import { describe, expect, it } from 'vitest';
import {
  selectControl,
  validateRangedNumber,
  validateThresholdValue,
  writableScopes,
  defaultWriteScope,
} from '../../src/config/controls.js';
import { configListFixture } from '../fixtures/config-list.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const entries: WireConfigEntry[] = configListFixture.entries;
const byKey = (key: string) => entries.find((e) => e.definition.key === key)!;

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
