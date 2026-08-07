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
  'skill:rasen-apply-change': 'sha256:a4559817d3de2f554890a24d53e4a26827086a0e0f51371213be1db4686c0e8f',
  'skill:rasen-archive-change': 'sha256:1bda9aaba614276d832d5cf50e422aa3e71292d05aee9f0e3c0a36a4942dcb67',
  'skill:rasen-benchmark': 'sha256:de4886394ef59b50e82cd36b85edbd6525359b8bd0f166f664836bf6c62c5844',
  'skill:rasen-cso': 'sha256:d0cd6e299998b3c4608bfad49d0c830ae6a7cbd62d15506b62741706430472bb',
  'skill:rasen-design-review': 'sha256:c754f0ce59670186ceab07c6ba648f330d5d28a1cc0ab40283b1fbb735a543f2',
  'skill:rasen-goal-iterate': 'sha256:9522e1108c941534a888d5a0230ba29f1b7719a75949411b36e05f664d95331b',
  'skill:rasen-goal-judge': 'sha256:944c21e977d795c1ee2c67f5a0ad0534e8b40a8c1f746ecd83ae89a4e51de40c',
  'skill:rasen-goal-plan': 'sha256:2c24bd2b0f8661f24bf94553aa15926ace8fa36c71900953e5a68c8c34606ce2',
  'skill:rasen-goal-report': 'sha256:f881d6f5379f1c8e1a4508eac7c25078a5fc69c0c3b1b2dee2fe9a72cf46bf35',
  'skill:rasen-office-hours-command': 'sha256:887b1f2c918539a1e087d257ad75458d38a38f5f83fbe66f584d54bf539c5ff3',
  'skill:rasen-propose': 'sha256:aa8454b78bfc16f9606f7c6db132e642d8189a743934583643b35ce5f74477d4',
  'skill:rasen-qa': 'sha256:5b5054c0e1626c2d0afb1c0a343567fa759d2c6a2bef869dbfad770521bf7081',
  'skill:rasen-retain': 'sha256:09cb7888f4d6240f4181b4e4bbaafa0c3d6d1c499004bc617395750a8d7721e7',
  'skill:rasen-review': 'sha256:be24b6d38f17e9068cd7dd114cf2239c464af01c4b3ad13f746371b6efe16ffd',
  'skill:rasen-review-fix': 'sha256:737e61418515fb67d0bdf46626f80b0e0c418a38d7b931b9bf69d320a520cad0',
  'skill:rasen-review-cycle': 'sha256:982739146524b2359637c37564890799aa700905baf67f4825fcfc93e2b73427',
  'skill:rasen-ship': 'sha256:9614107d356f7d4f9ecc5e3108638f249b1298861592ded8912d422627cc6529',
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
