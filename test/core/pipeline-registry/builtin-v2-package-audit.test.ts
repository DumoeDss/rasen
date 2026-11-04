import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CHANGE_LEVEL_BUILTIN_PIPELINES,
  PIPELINE_V1_COMPATIBILITY_BOUNDARIES,
  PIPELINE_V1_COMPATIBILITY_FIXTURES,
  freezeProductionPreparedPipelineRegistry,
  parsePipelineSourceDocument,
} from '../../../src/core/pipeline-registry/index.js';
import { resolvePipelinePath } from '../../../src/core/pipeline-registry/resolver.js';

const EXPECTED_BUILTINS = [
  'bug-fix',
  'small-feature',
  'full-feature',
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
] as const;

const AUTO_DECOMPOSE_GIT_BLOB =
  '6f306544010a8950508f1223acfca5d62de407f5';

const EXACT_CAPABILITY_PINS = {
  'skill:rasen-apply-change': 'sha256:dd1b0845380d232d173d7c28873738aff2a798defc13b83bf1041a39d6a6a79f',
  'skill:rasen-archive-change': 'sha256:bf36a873d7af835e3622da50a45e391aecc70b908ce9b51b19567c847b9dfdd8',
  'skill:rasen-benchmark': 'sha256:34927b5d7713076287cad9cd71e03e0892efec7911080795d4294c9fe0e8ad1b',
  'skill:rasen-cso': 'sha256:1f89c4fadfd9ad155f5af3e5835799201d347b9dbe2a670c0b076193ce219808',
  'skill:rasen-design-review': 'sha256:588c9a8901527e1cfb9b0f814f8759a79d063536126c13eddb3240de5ef79c52',
  'skill:rasen-goal-iterate': 'sha256:1b1a8566322f14a02994b3274f4256def710a77c95ec7927e58daaf948520a87',
  'skill:rasen-goal-judge': 'sha256:2ae0f1918512979d732b3f1b881c85530cc1447ea53cabfd76811bf68e6f9b1e',
  'skill:rasen-goal-plan': 'sha256:610dd104f26d8b622fe42cb0e25ea08c4678427f1188d3fe1e6dc05a44192463',
  'skill:rasen-goal-report': 'sha256:92a97c8f454aedef85e7c7cb0a09271389417a7ecfe140416d70ecc0e205d70b',
  'skill:rasen-office-hours-command': 'sha256:ff0bd82ad3aafe527fee2ff20bc6854e0dd1812b1bc47ac8f38f9489af31c4ab',
  'skill:rasen-propose': 'sha256:950fbdbff5734ef2760fc9c04d60399e43caaf869a7f24ba11ddcbb2d6bb1907',
  'skill:rasen-qa': 'sha256:c7f0878f5a66889bf3da8ef6de125864bd71402fd0cd92817315f8a810acae87',
  'skill:rasen-retain': 'sha256:baa284d853a6153df7dcdca336b5d410bc987cd852c6aa2354f6218de8e3f66f',
  'skill:rasen-review': 'sha256:281717f5e3164dca91e21d9329ae812b8ee1263f656d605ef8b1d3d6bba0c7fc',
  'skill:rasen-review-fix': 'sha256:fa102c0d009739407f98afffff477d336966b5c58b0f76dd9d16b50bab19476b',
  'skill:rasen-review-cycle': 'sha256:2689d5c85df54bf702f34337db8a51c90faf321d6c18b9e829f79dca89ea6e05',
  'skill:rasen-ship': 'sha256:35615d0bfd09e3fadef419a6ba6f28fe15f278fa981ec3af45beaacc6be1d965',
} as const;

function authoredDefinition(name: string): Record<string, unknown> {
  const pipelinePath = resolvePipelinePath(name);
  if (!pipelinePath) throw new Error(`Missing built-in pipeline ${name}.`);
  return parsePipelineSourceDocument(fs.readFileSync(pipelinePath, 'utf8')) as Record<string, unknown>;
}

function collectCapabilityReferences(value: unknown): { id: string; version: string }[] {
  if (Array.isArray(value)) return value.flatMap(collectCapabilityReferences);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const own = record.capability;
  const refs =
    own && typeof own === 'object' && !Array.isArray(own)
      ? [own as { id: string; version: string }]
      : [];
  return refs.concat(Object.values(record).flatMap(collectCapabilityReferences));
}

describe('Change-level built-in v2 package audit', () => {
  it('defines exactly the six intended package pipelines and excludes auto-decompose', () => {
    expect(CHANGE_LEVEL_BUILTIN_PIPELINES).toEqual(EXPECTED_BUILTINS);
    expect(CHANGE_LEVEL_BUILTIN_PIPELINES).not.toContain('auto-decompose');

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { files: string[] };
    expect(packageJson.files).toContain('pipelines');
    for (const name of CHANGE_LEVEL_BUILTIN_PIPELINES) {
      expect(resolvePipelinePath(name)).not.toBeNull();
    }
  });

  it('pins auto-decompose as the only unchanged v1 compatibility fixture', async () => {
    expect(PIPELINE_V1_COMPATIBILITY_FIXTURES).toEqual(['auto-decompose']);
    expect(PIPELINE_V1_COMPATIBILITY_BOUNDARIES).toEqual({
      'auto-decompose': 'issue-dispatch-0.3.0',
    });
    expect(CHANGE_LEVEL_BUILTIN_PIPELINES).not.toContain('auto-decompose');

    const pipelinePath = resolvePipelinePath('auto-decompose');
    expect(pipelinePath).not.toBeNull();
    const checkoutBytes = fs.readFileSync(pipelinePath!);
    // Git stores the authored manifest with LF. A Windows checkout may apply
    // core.autocrlf, so reconstruct the repository blob bytes without making
    // the fixture platform-dependent.
    const bytes = Buffer.from(
      checkoutBytes.toString('utf8').replace(/\r\n/g, '\n'),
      'utf8'
    );
    const gitBlob = createHash('sha1')
      .update(Buffer.from(`blob ${bytes.length}\0`))
      .update(bytes)
      .digest('hex');
    expect(gitBlob).toBe(AUTO_DECOMPOSE_GIT_BLOB);
    expect(authoredDefinition('auto-decompose').version).toBe(1);

    const registry = await freezeProductionPreparedPipelineRegistry(
      process.cwd(),
      { reporter: false }
    );
    const bounded = registry
      .list()
      .filter((info) => info.compatibilityBoundary !== undefined);
    expect(bounded).toHaveLength(1);
    expect(bounded[0]).toMatchObject({
      name: 'auto-decompose',
      source: 'package',
      authoredVersion: 1,
      compatibilityBoundary: 'issue-dispatch-0.3.0',
    });
  });

  it('authors every intended built-in at v2 with no compatibility fields', () => {
    for (const name of CHANGE_LEVEL_BUILTIN_PIPELINES) {
      const definition = authoredDefinition(name);
      expect(definition.version, name).toBe(2);
      expect(definition.name, name).toBe(name);
      const source = JSON.stringify(definition);
      expect(source, name).not.toMatch(/"legacy(?:StageId|RuntimeOwner|Runtime)?"/);
      expect(source, name).not.toContain('goal-run.json');
    }
  });

  it('pins every referenced capability to the exact bundled catalog digest', async () => {
    const registry = await freezeProductionPreparedPipelineRegistry(process.cwd(), {
      reporter: false,
    });
    const catalogPins = new Map(
      registry.catalog.descriptors.map((descriptor) => [descriptor.id, descriptor.version])
    );

    for (const [id, version] of Object.entries(EXACT_CAPABILITY_PINS)) {
      expect(catalogPins.get(id), id).toBe(version);
    }
    for (const name of CHANGE_LEVEL_BUILTIN_PIPELINES) {
      const refs = collectCapabilityReferences(authoredDefinition(name));
      expect(refs.length, name).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref.version, `${name}:${ref.id}`).toBe(
          EXACT_CAPABILITY_PINS[ref.id as keyof typeof EXACT_CAPABILITY_PINS]
        );
      }
    }
  });

  it('binds write fixes and read-only goal judgments to phase-compatible capabilities', async () => {
    const registry = await freezeProductionPreparedPipelineRegistry(process.cwd(), {
      reporter: false,
    });
    const descriptorById = new Map(
      registry.catalog.descriptors.map((descriptor) => [descriptor.id, descriptor])
    );
    expect(descriptorById.get('skill:rasen-review-fix')?.phaseContracts).toEqual([
      'review-cycle/fix',
    ]);
    expect(descriptorById.get('skill:rasen-goal-judge')?.phaseContracts).toEqual([
      'goal-cycle/judge',
    ]);

    for (const name of ['bug-fix', 'small-feature', 'full-feature'] as const) {
      const definition = authoredDefinition(name) as any;
      const phases = definition.declarations[0].graph.nodes;
      expect(phases.find((node: any) => node.reviewCyclePhase === 'fix')).toMatchObject({
        capability: {
          id: 'skill:rasen-review-fix',
          version: EXACT_CAPABILITY_PINS['skill:rasen-review-fix'],
        },
        execution: { role: 'fixer', workspace: { access: 'write' } },
      });
      expect(phases.find((node: any) => node.reviewCyclePhase === 're-review')).toMatchObject({
        capability: { id: 'skill:rasen-review' },
        execution: { role: 'reviewer', workspace: { access: 'read' } },
      });
    }

    for (const name of ['goal-loop-measure', 'goal-loop-evaluate', 'goal-loop-research'] as const) {
      const definition = authoredDefinition(name) as any;
      const phases = definition.declarations[0].graph.nodes;
      expect(phases.find((node: any) => node.goalCyclePhase === 'work')?.capability.id)
        .toBe('skill:rasen-goal-iterate');
      expect(phases.find((node: any) => node.goalCyclePhase === 'judge')).toMatchObject({
        capability: {
          id: 'skill:rasen-goal-judge',
          version: EXACT_CAPABILITY_PINS['skill:rasen-goal-judge'],
        },
        execution: { role: 'reviewer', workspace: { access: 'read' } },
      });
    }
  });
});
