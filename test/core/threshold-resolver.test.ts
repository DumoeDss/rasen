import { describe, expect, it } from 'vitest';

import {
  resolveThreshold,
  type ThresholdSchemeSnapshot,
} from '../../src/core/threshold-resolver.js';

const schemes: ThresholdSchemeSnapshot = {
  project: {
    valid: true,
    scheme: {
      handoff: 0.5,
      handoffRoles: { reviewer: 0.65 },
      reuse: 0.25,
      reuseRoles: { planner: 0.35 },
    },
  },
  store: {
    valid: true,
    scheme: { handoff: 0.55, reuse: { remainingTokens: 80_000 } },
  },
  invalid: { valid: false, error: 'bad YAML' },
};

const handoffNonBinding = {
  pipelineRole: { value: 0.61, source: 'role' },
  pipeline: { value: 0.62, source: 'pipeline' },
  projectRole: { value: 0.63, source: 'project-role' },
  project: { value: 0.64, source: 'project-config' },
  storeRole: { value: 0.65, source: 'store-role' },
  store: { value: 0.66, source: 'store-config' },
  globalRole: { value: 0.67, source: 'global-role' },
  global: { value: 0.68, source: 'global-config' },
  preset: { value: { remainingTokens: 60_000 }, source: 'preset' },
  default: { value: 0.5, source: 'default' },
} as const;

describe('resolveThreshold', () => {
  it('keeps configured-stage and stage YAML above schemes', () => {
    expect(
      resolveThreshold({
        family: 'handoff',
        runtime: 'codex',
        bindings: { project: { codex: 'project' } },
        schemes,
        nonBinding: {
          ...handoffNonBinding,
          configuredStage: { value: 0.71, source: 'stage-override-project' },
          stage: { value: 0.72, source: 'stage' },
        },
      })
    ).toMatchObject({ threshold: 0.71, source: 'stage-override-project' });
  });

  it('selects rows before scopes so store runtime beats project default', () => {
    const result = resolveThreshold({
      family: 'handoff',
      role: 'reviewer',
      runtime: 'codex',
      bindings: {
        project: { default: 'project' },
        store: { codex: 'store' },
      },
      schemes,
      nonBinding: handoffNonBinding,
    });
    expect(result).toMatchObject({
      threshold: 0.55,
      source: 'store-scheme',
      binding: { scope: 'store', row: 'codex', scheme: 'store' },
    });
  });

  it('keeps every runtime/default row and scope candidate in row-first order', () => {
    const ordered = [
      { scope: 'project', row: 'codex', scheme: 'runtime-project' },
      { scope: 'store', row: 'codex', scheme: 'runtime-store' },
      { scope: 'global', row: 'codex', scheme: 'runtime-global' },
      { scope: 'project', row: 'default', scheme: 'default-project' },
      { scope: 'store', row: 'default', scheme: 'default-store' },
      { scope: 'global', row: 'default', scheme: 'default-global' },
    ] as const;
    const orderedSchemes = Object.fromEntries(
      ordered.map((candidate, index) => [
        candidate.scheme,
        {
          valid: true as const,
          scheme: { handoff: (index + 1) / 10, reuse: 0.25 },
        },
      ])
    );

    for (let expectedIndex = 0; expectedIndex < ordered.length; expectedIndex++) {
      const bindings: {
        project: Record<string, string>;
        store: Record<string, string>;
        global: Record<string, string>;
      } = { project: {}, store: {}, global: {} };
      for (const candidate of ordered.slice(expectedIndex)) {
        bindings[candidate.scope][candidate.row] = candidate.scheme;
      }

      const result = resolveThreshold({
        family: 'handoff',
        runtime: 'codex',
        bindings,
        schemes: orderedSchemes,
        nonBinding: handoffNonBinding,
      });

      expect(result.binding).toEqual(ordered[expectedIndex]);
      expect(result.threshold).toBe((expectedIndex + 1) / 10);
    }
  });

  it('uses scheme role override and preserves dual forms', () => {
    const handoff = resolveThreshold({
      family: 'handoff',
      role: 'reviewer',
      runtime: 'claude',
      bindings: { project: { claude: 'project' } },
      schemes,
      nonBinding: handoffNonBinding,
    });
    expect(handoff).toMatchObject({ threshold: 0.65, source: 'project-scheme-role' });

    const reuse = resolveThreshold({
      family: 'reuse',
      runtime: 'codex',
      bindings: { store: { codex: 'store' } },
      schemes,
      nonBinding: {
        pipeline: { value: 0.3, source: 'pipeline' },
        default: { value: 0.25, source: 'default' },
      },
    });
    expect(reuse.threshold).toEqual({ remainingTokens: 80_000 });
  });

  it('uses only default rows for absent/unrecognized runtimes', () => {
    for (const runtime of [undefined, 'zed']) {
      const result = resolveThreshold({
        family: 'handoff',
        runtime,
        bindings: {
          project: { claude: 'store' },
          global: { default: 'project' },
        },
        schemes,
        nonBinding: handoffNonBinding,
      });
      expect(result.binding).toEqual({
        scope: 'global',
        row: 'default',
        scheme: 'project',
      });
    }
  });

  it('diagnoses dangling/invalid candidates and falls through deterministically', () => {
    const input = {
      family: 'handoff' as const,
      runtime: 'codex',
      bindings: {
        project: { codex: 'missing' },
        store: { codex: 'invalid' },
      },
      schemes,
      nonBinding: handoffNonBinding,
    };
    const first = resolveThreshold(input);
    const second = resolveThreshold(structuredClone(input));
    expect(first).toEqual(second);
    expect(first.threshold).toBe(0.61);
    expect(first.source).toBe('role');
    expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'missing-scheme',
      'invalid-scheme',
    ]);
  });

  it('treats inherited object properties as missing schemes', () => {
    const result = resolveThreshold({
      family: 'handoff',
      runtime: 'codex',
      bindings: { project: { codex: 'constructor' } },
      schemes: {},
      nonBinding: handoffNonBinding,
    });

    expect(result.threshold).toBe(0.61);
    expect(result.diagnostics).toMatchObject([
      { code: 'missing-scheme', scheme: 'constructor' },
    ]);
  });

  it.each([
    { row: 'codex', runtime: 'codex' },
    { row: 'default', runtime: undefined },
  ])('ignores inherited $row binding rows', ({ row, runtime }) => {
    const inheritedRows = Object.create({ [row]: 'project' }) as Record<
      string,
      string
    >;
    const result = resolveThreshold({
      family: 'handoff',
      runtime,
      bindings: { project: inheritedRows },
      schemes,
      nonBinding: handoffNonBinding,
    });

    expect(Object.keys(inheritedRows)).toEqual([]);
    expect(result).toMatchObject({ threshold: 0.61, source: 'role' });
    expect(result.binding).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves the complete no-binding precedence chain', () => {
    const candidates = [
      ['pipelineRole', 'role'],
      ['pipeline', 'pipeline'],
      ['projectRole', 'project-role'],
      ['project', 'project-config'],
      ['storeRole', 'store-role'],
      ['store', 'store-config'],
      ['globalRole', 'global-role'],
      ['global', 'global-config'],
      ['preset', 'preset'],
      ['default', 'default'],
    ] as const;
    for (let index = 0; index < candidates.length; index++) {
      const layers = structuredClone(handoffNonBinding) as Record<string, unknown>;
      for (const [key] of candidates.slice(0, index)) delete layers[key];
      const result = resolveThreshold({
        family: 'handoff',
        nonBinding: layers as never,
      });
      expect(result.source).toBe(candidates[index]![1]);
    }
  });

  it('preserves every reuse fallback edge below scheme selection', () => {
    const candidates = [
      ['pipelineRole', 'role'],
      ['pipeline', 'pipeline'],
      ['preset', 'preset'],
      ['default', 'default'],
    ] as const;
    const base = {
      pipelineRole: { value: 0.4, source: 'role' },
      pipeline: { value: 0.3, source: 'pipeline' },
      preset: { value: 0.2, source: 'preset' },
      default: { value: 0.1, source: 'default' },
    } as const;

    for (let index = 0; index < candidates.length; index++) {
      const layers = structuredClone(base) as Record<string, unknown>;
      for (const [key] of candidates.slice(0, index)) delete layers[key];
      const result = resolveThreshold({
        family: 'reuse',
        nonBinding: layers as never,
      });
      expect(result.source).toBe(candidates[index]![1]);
    }
  });
});
