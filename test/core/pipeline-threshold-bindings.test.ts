import { describe, expect, it } from 'vitest';

import { parsePipeline } from '../../src/core/pipeline-registry/pipeline.js';
import {
  resolvePipelineReuseConfig,
  resolveStageHandoffConfig,
} from '../../src/core/pipeline-registry/types.js';
import type { ThresholdSchemeSnapshot } from '../../src/core/threshold-resolver.js';

const schemes: ThresholdSchemeSnapshot = {
  'claude-policy': {
    valid: true,
    scheme: {
      handoff: 0.51,
      handoffRoles: { planner: 0.52 },
      reuse: 0.21,
      reuseRoles: { planner: 0.22 },
    },
  },
  'codex-policy': {
    valid: true,
    scheme: {
      handoff: 0.61,
      handoffRoles: { implementer: 0.62 },
      reuse: 0.31,
      reuseRoles: { implementer: 0.32 },
    },
  },
};

describe('pipeline threshold binding integration', () => {
  const pipeline = parsePipeline(`
name: bound
agents:
  planner: claude
  implementer: codex
handoff:
  threshold: 0.8
reuse:
  threshold: 0.4
stages:
  - id: plan
    skill: rasen-propose
    role: planner
  - id: apply
    skill: rasen-apply-change
    role: implementer
    requires: [plan]
`);

  const context = {
    bindings: {
      project: {
        claude: 'claude-policy',
        codex: 'codex-policy',
      },
    },
    schemes,
    runtimes: { planner: 'claude' as const, implementer: 'codex' as const },
  };

  it('uses each stage effective runtime while preserving stage overrides', () => {
    expect(
      resolveStageHandoffConfig(
        pipeline.stages[0]!,
        pipeline,
        undefined,
        undefined,
        undefined,
        context
      )
    ).toMatchObject({
      threshold: 0.52,
      source: 'project-scheme-role',
      binding: { row: 'claude', scheme: 'claude-policy' },
    });
    expect(
      resolveStageHandoffConfig(
        pipeline.stages[1]!,
        pipeline,
        undefined,
        undefined,
        undefined,
        context
      )
    ).toMatchObject({
      threshold: 0.62,
      source: 'project-scheme-role',
      binding: { row: 'codex', scheme: 'codex-policy' },
    });

    const stageOverride = {
      ...pipeline.stages[1]!,
      handoff: { threshold: 0.9 },
    };
    expect(
      resolveStageHandoffConfig(
        stageOverride,
        pipeline,
        undefined,
        undefined,
        undefined,
        context
      )
    ).toMatchObject({ threshold: 0.9, source: 'stage' });
  });

  it('resolves planner/implementer reuse independently and top-level from default only', () => {
    const resolved = resolvePipelineReuseConfig(pipeline, context);
    expect(resolved.roles).toEqual({ planner: 0.22, implementer: 0.32 });
    expect(resolved.threshold).toBe(0.4);
    expect(resolved.sources).toEqual({
      threshold: 'pipeline',
      roles: {
        planner: 'project-scheme-role',
        implementer: 'project-scheme-role',
      },
    });
  });

  it('keeps an explicit stage runtime separate from role-wide reuse runtime', () => {
    const conflicting = parsePipeline(`
name: stage-vs-role
agents:
  planner: claude
  reviewer: claude
stages:
  - id: plan
    skill: rasen-propose
    role: planner
  - id: review
    skill: rasen-review
    role: reviewer
    runtime: codex
    requires: [plan]
`);
    const conflictingContext = {
      bindings: {
        project: {
          claude: 'claude-policy',
          codex: 'codex-policy',
        },
      },
      schemes,
      runtimes: { planner: 'claude' as const, reviewer: 'claude' as const },
    };

    expect(
      resolveStageHandoffConfig(
        conflicting.stages[1]!,
        conflicting,
        undefined,
        undefined,
        undefined,
        conflictingContext
      )
    ).toMatchObject({
      threshold: 0.61,
      binding: { scope: 'project', row: 'codex', scheme: 'codex-policy' },
    });
    expect(resolvePipelineReuseConfig(conflicting, conflictingContext))
      .toMatchObject({
        roles: { planner: 0.22 },
        bindings: {
          roles: {
            planner: { scope: 'project', row: 'claude', scheme: 'claude-policy' },
          },
        },
      });
  });

  it('reports dangling bindings and falls back without throwing', () => {
    const resolved = resolvePipelineReuseConfig(pipeline, {
      bindings: { project: { codex: 'missing' } },
      schemes,
      runtimes: { implementer: 'codex' },
    });
    expect(resolved.roles.implementer).toBe(0.4);
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({ code: 'missing-scheme', scheme: 'missing' }),
    ]);
  });

  it('keeps no-binding results byte-compatible', () => {
    expect(resolvePipelineReuseConfig(pipeline)).toEqual({
      planner: 'auto',
      implementer: 'auto',
      threshold: 0.4,
      roles: { planner: 0.4, implementer: 0.4 },
    });
  });

  // `row` is stated per case rather than derived, so the table asserts the
  // expected runtime row instead of restating the production fallback rule.
  it.each([
    ['claude', 'claude-code', 'claude', 'claude-policy', 0.52],
    ['codex', 'codex-thread-id', 'codex', 'codex-policy', 0.61],
    ['unknown', 'unknown', 'claude', 'claude-policy', 0.52],
    ['omp', 'omp-code', 'claude', 'claude-policy', 0.52],
  ] as const)(
    'uses the %s host-derived runtime row for implicit stages and reuse roles',
    (runtime, source, row, scheme, threshold) => {
      const implicit = parsePipeline(`
name: host-bound
stages:
  - id: plan
    skill: rasen-propose
    role: planner
`);
      const hostContext = {
        bindings: {
          project: {
            claude: 'claude-policy',
            codex: 'codex-policy',
          },
        },
        schemes,
        host: { runtime, source },
      };
      expect(
        resolveStageHandoffConfig(
          implicit.stages[0]!,
          implicit,
          undefined,
          undefined,
          undefined,
          hostContext
        )
      ).toMatchObject({
        threshold,
        binding: { row, scheme },
      });
      expect(resolvePipelineReuseConfig(implicit, hostContext).bindings?.roles?.planner)
        .toMatchObject({ row, scheme });
    }
  );
});
