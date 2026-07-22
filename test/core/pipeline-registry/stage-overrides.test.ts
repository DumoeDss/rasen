import { describe, it, expect } from 'vitest';

import {
  bucketPipelineStageOverrides,
  resolveMaskedStageGate,
  resolveEffectiveStage,
  resolveStageRuntimeConfig,
  resolveStageHandoffConfig,
  parsePipeline,
  type PipelineStageOverrides,
} from '../../../src/core/pipeline-registry/index.js';
import type { EffectiveConfigEntry } from '../../../src/core/effective-config.js';
import type { ConfigKeyDefinition } from '../../../src/core/config-keys.js';
import type { ResolvedGatePolicy } from '../../../src/core/project-config.js';

/** A synthetic effective-config family-instance entry (only the fields the bucketer reads). */
function instanceEntry(
  instanceKey: string,
  value: unknown,
  source: EffectiveConfigEntry['source']
): EffectiveConfigEntry {
  const definition = { key: instanceKey, wildcard: true } as unknown as ConfigKeyDefinition;
  return { definition, value, source, scopeValues: {}, instanceKey };
}

const PIPELINE = parsePipeline(
  [
    'name: test-pipe',
    'description: fixture',
    'stages:',
    '  - id: propose',
    '    role: planner',
    '    skill: rasen-propose',
    '    gate: true',
    '  - id: apply',
    '    role: implementer',
    '    skill: rasen-apply',
    '    model: sonnet',
    '  - id: review-stage',
    '    role: reviewer',
    '    skill: rasen-review',
    '    gate: true',
  ].join('\n')
);

const stage = (id: string) => PIPELINE.stages.find((s) => s.id === id)!;

const emptyOverrides: PipelineStageOverrides = {
  gates: new Map(),
  models: new Map(),
  handoff: new Map(),
  runtimes: new Map(),
};

const ON: ResolvedGatePolicy = { effective: 'on', source: 'default' };
const OFF_GLOBAL: ResolvedGatePolicy = { effective: 'off', source: 'global' };
const OFF_FLAG: ResolvedGatePolicy = { effective: 'off', source: 'flag' };

describe('bucketPipelineStageOverrides', () => {
  it('buckets each family by axis for the named pipeline, keeping precedence source as scope', () => {
    const entries = [
      instanceEntry('pipelines.test-pipe.gates.propose', 'off', 'project'),
      instanceEntry('pipelines.test-pipe.models.apply', 'fable', 'store'),
      instanceEntry('pipelines.test-pipe.handoff.apply', 0.6, 'global'),
      instanceEntry('pipelines.test-pipe.runtimes.reviewer', 'codex', 'project'),
      // Another pipeline's instance must not leak in.
      instanceEntry('pipelines.other.gates.propose', 'on', 'project'),
    ];
    const overrides = bucketPipelineStageOverrides(entries, 'test-pipe');
    expect(overrides.gates.get('propose')).toEqual({ value: 'off', scope: 'project' });
    expect(overrides.models.get('apply')).toEqual({ value: 'fable', scope: 'store' });
    expect(overrides.handoff.get('apply')).toEqual({ value: 0.6, scope: 'global' });
    expect(overrides.runtimes.get('reviewer')).toEqual({ value: 'codex', scope: 'project' });
    expect(overrides.gates.has('other')).toBe(false);
  });

  it('ignores template entries and malformed keys', () => {
    const entries = [
      { definition: {} as ConfigKeyDefinition, value: undefined, source: 'default', scopeValues: {} },
      instanceEntry('pipelines.test-pipe.gates', 'off', 'project'), // wrong shape
    ] as EffectiveConfigEntry[];
    const overrides = bucketPipelineStageOverrides(entries, 'test-pipe');
    expect(overrides.gates.size).toBe(0);
  });
});

describe('resolveMaskedStageGate', () => {
  it('a per-stage on pierces an off base', () => {
    expect(resolveMaskedStageGate(true, { value: 'on', scope: 'project' }, OFF_GLOBAL)).toEqual({
      effective: true,
      source: 'stage-override-project',
    });
  });

  it('a per-stage off silences one stage under an on base', () => {
    expect(resolveMaskedStageGate(true, { value: 'off', scope: 'project' }, ON)).toEqual({
      effective: false,
      source: 'stage-override-project',
    });
  });

  it('an off base suppresses an ordinary gate, naming the base layer', () => {
    expect(resolveMaskedStageGate(true, undefined, OFF_FLAG)).toEqual({
      effective: false,
      source: 'autopilot-flag',
    });
  });

  it('an on base honours the stage definition', () => {
    expect(resolveMaskedStageGate(true, undefined, ON)).toEqual({ effective: true, source: 'stage' });
    expect(resolveMaskedStageGate(false, undefined, ON)).toEqual({ effective: false, source: 'stage' });
  });

  it('no gate type is exempt from the mask — a per-stage instance decides any stage', () => {
    // The vet type is retired: every gate resolves through the three tiers, so a
    // per-stage `on` pierces an off base and a per-stage `off` silences a gate.
    expect(resolveMaskedStageGate(true, { value: 'on', scope: 'project' }, OFF_FLAG)).toEqual({
      effective: true,
      source: 'stage-override-project',
    });
    expect(resolveMaskedStageGate(true, { value: 'off', scope: 'project' }, ON)).toEqual({
      effective: false,
      source: 'stage-override-project',
    });
  });
});

describe('stage resolver top layer', () => {
  it('a per-stage model instance tops the chain with a scope-qualified source', () => {
    const resolved = resolveStageRuntimeConfig(stage('apply'), PIPELINE, undefined, {
      model: { value: 'fable', scope: 'project' },
    });
    expect(resolved.model).toBe('fable');
    expect(resolved.modelSource).toBe('stage-override-project');
  });

  it('without a model override the chain is byte-identical (stage-level model wins)', () => {
    const resolved = resolveStageRuntimeConfig(stage('apply'), PIPELINE, undefined, {});
    expect(resolved.model).toBe('sonnet');
    expect(resolved.modelSource).toBe('stage');
  });

  it('a per-role runtime instance tops the runtime field', () => {
    const resolved = resolveStageRuntimeConfig(stage('propose'), PIPELINE, undefined, {
      runtime: { value: 'codex', scope: 'store' },
    });
    expect(resolved.runtime).toBe('codex');
    expect(resolved.runtimeSource).toBe('stage-override-store');
  });

  it('without a runtime override runtimeSource mirrors the bundle source', () => {
    const resolved = resolveStageRuntimeConfig(stage('propose'), PIPELINE, undefined, {});
    expect(resolved.runtime).toBe('claude');
    expect(resolved.runtimeSource).toBe('default');
  });

  it('a per-stage handoff instance tops the threshold chain', () => {
    const resolved = resolveStageHandoffConfig(stage('propose'), PIPELINE, undefined, undefined, {
      handoff: { value: 0.42, scope: 'global' },
    });
    expect(resolved.threshold).toBe(0.42);
    expect(resolved.source).toBe('stage-override-global');
  });
});

describe('resolveEffectiveStage', () => {
  it('reports declared and effective values together', () => {
    const overrides: PipelineStageOverrides = {
      gates: new Map([['propose', { value: 'off' as const, scope: 'project' as const }]]),
      models: new Map([['apply', { value: 'fable', scope: 'store' as const }]]),
      handoff: new Map(),
      runtimes: new Map([['reviewer', { value: 'codex' as const, scope: 'project' as const }]]),
    };
    const propose = resolveEffectiveStage(stage('propose'), PIPELINE, { overrides, basePolicy: ON });
    expect(propose.declaredGate).toBe(true);
    expect(propose.gate).toEqual({ effective: false, source: 'stage-override-project' });

    const apply = resolveEffectiveStage(stage('apply'), PIPELINE, { overrides, basePolicy: ON });
    expect(apply.model).toEqual({ value: 'fable', source: 'stage-override-store' });

    // The review stage carries no per-stage gate instance; under an off base its
    // gate is suppressed like any other (no stage is exempt from the mask).
    const review = resolveEffectiveStage(stage('review-stage'), PIPELINE, { overrides, basePolicy: OFF_FLAG });
    expect(review.gate).toEqual({ effective: false, source: 'autopilot-flag' });
    expect(review.runtime).toEqual({ value: 'codex', source: 'stage-override-project' });
  });

  it('with no overrides falls through cleanly (empty maps)', () => {
    const propose = resolveEffectiveStage(stage('propose'), PIPELINE, {
      overrides: emptyOverrides,
      basePolicy: ON,
    });
    expect(propose.gate).toEqual({ effective: true, source: 'stage' });
    expect(propose.runtime.value).toBe('claude');
  });
});
