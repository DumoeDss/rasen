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
});
