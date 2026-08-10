import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LEAF_EFFORTS,
  PipelineYamlSchema,
  bucketPipelineStageOverrides,
  resolveStageRuntimeConfig,
  stageConfigOverridesFor,
  type PipelineYaml,
} from '../../../src/core/pipeline-registry/index.js';
import { readProjectConfig } from '../../../src/core/project-config.js';

function pipeline(values: Record<string, unknown> = {}): PipelineYaml {
  return PipelineYamlSchema.parse({
    name: 'generic-codex',
    agents: { reviewer: { runtime: 'codex', model: 'gpt-5.6-terra', effort: 'high' } },
    stages: [{ id: 'review', skill: 'rasen-review', role: 'reviewer', ...values }],
  });
}

describe('generic leaf reasoning-effort resolution', () => {
  it('exports exactly the supported first-class vocabulary', () => {
    expect(LEAF_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('resolves every precedence edge with independent model/effort provenance', () => {
    const authored = pipeline();
    const stage = authored.stages[0]!;
    const layers = {
      projectRoles: { reviewer: 'max' as const },
      projectDefault: 'xhigh' as const,
      storeRoles: { reviewer: 'medium' as const },
      storeDefault: 'low' as const,
      globalRoles: { reviewer: 'medium' as const },
      globalDefault: 'low' as const,
    };
    expect(resolveStageRuntimeConfig(stage, authored, undefined, undefined, undefined, layers))
      .toMatchObject({ model: 'gpt-5.6-terra', modelSource: 'agent', effort: 'high', effortSource: 'agent' });

    const noAgentEffort = pipeline();
    noAgentEffort.agents!.reviewer = { runtime: 'codex', model: 'vendor/custom-model' };
    expect(resolveStageRuntimeConfig(noAgentEffort.stages[0]!, noAgentEffort, undefined, undefined, undefined, layers))
      .toMatchObject({ model: 'vendor/custom-model', modelSource: 'agent', effort: 'max', effortSource: 'project-role' });

    expect(resolveStageRuntimeConfig(
      noAgentEffort.stages[0]!,
      noAgentEffort,
      undefined,
      { effort: { value: 'xhigh', scope: 'store' } },
      undefined,
      layers
    )).toMatchObject({ effort: 'xhigh', effortSource: 'stage-override-store' });

    const stageAuthored = pipeline({ model: 'gpt-5.6-luna', effort: 'max' });
    expect(resolveStageRuntimeConfig(stageAuthored.stages[0]!, stageAuthored, undefined, undefined, undefined, layers))
      .toMatchObject({ model: 'gpt-5.6-luna', modelSource: 'stage', effort: 'max', effortSource: 'stage' });
  });

  it('falls through project, store, global, then absent runtime default', () => {
    const authored = pipeline();
    authored.agents!.reviewer = { runtime: 'codex' };
    const stage = authored.stages[0]!;
    const resolve = (layers?: Parameters<typeof resolveStageRuntimeConfig>[5]) =>
      resolveStageRuntimeConfig(stage, authored, undefined, undefined, undefined, layers);
    expect(resolve({ projectDefault: 'high', storeDefault: 'medium', globalDefault: 'low' }))
      .toMatchObject({ effort: 'high', effortSource: 'project-default' });
    expect(resolve({ storeRoles: { reviewer: 'medium' }, globalDefault: 'low' }))
      .toMatchObject({ effort: 'medium', effortSource: 'store-role' });
    expect(resolve({ storeDefault: 'medium', globalRoles: { reviewer: 'low' } }))
      .toMatchObject({ effort: 'medium', effortSource: 'store-default' });
    expect(resolve({ globalRoles: { reviewer: 'medium' }, globalDefault: 'low' }))
      .toMatchObject({ effort: 'medium', effortSource: 'global-role' });
    expect(resolve({ globalDefault: 'low' }))
      .toMatchObject({ effort: 'low', effortSource: 'global-default' });
    expect(resolve()).toMatchObject({ effortSource: 'default' });
    expect(resolve().effort).toBeUndefined();
  });

  it('uses exact per-stage effort lookup and ignores a similarly named stage', () => {
    const entries = [
      {
        definition: { key: 'pipelines.<name>.efforts.<stage>' },
        instanceKey: 'pipelines.generic-codex.efforts.review-extra',
        value: 'low',
        source: 'project',
        scopeValues: {},
      },
      {
        definition: { key: 'pipelines.<name>.efforts.<stage>' },
        instanceKey: 'pipelines.generic-codex.efforts.review',
        value: 'max',
        source: 'project',
        scopeValues: {},
      },
    ] as any;
    const overrides = bucketPipelineStageOverrides(entries, 'generic-codex');
    expect(stageConfigOverridesFor(pipeline().stages[0]!, overrides).effort).toEqual({
      value: 'max', scope: 'project',
    });
  });

  it('rejects unsupported authored effort and resiliently drops invalid config leaves', () => {
    expect(() => pipeline({ effort: 'ultra' })).toThrow(/low|medium|high|xhigh|max/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-effort-config-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'rasen', 'config.yaml'),
        'schema: spec-driven\nefforts:\n  default: ultra\n  roles:\n    reviewer: max\n    planner: invalid\n',
        'utf8'
      );
      const parsed = readProjectConfig(root);
      expect(parsed?.efforts).toEqual({ roles: { reviewer: 'max' } });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('efforts.default'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('efforts.roles.planner'));
    } finally {
      warn.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
