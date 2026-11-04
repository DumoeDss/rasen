import { beforeAll, describe, expect, it } from 'vitest';

import { lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { Digest, RunId } from '../../../src/core/change-run/index.js';
import {
  freezeProductionPreparedPipelineRegistry,
  type ProductionPreparedPipelineRegistry,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { startRecord } from './reconciler-fixture.js';

const runId = `run:${'6'.repeat(64)}` as RunId;
let registry: ProductionPreparedPipelineRegistry;

beforeAll(async () => {
  registry = await freezeProductionPreparedPipelineRegistry(process.cwd(), {
    reporter: false,
  });
});

function preparePlan(name: 'bug-fix' | 'small-feature') {
  const resolution = registry.load(name);
  const prepared = resolution.prepared;
  const profile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    [],
    {
      layer: 'package',
      kind: 'pipeline-definition-v2',
      sourceId: prepared.definition.sourceId,
      authoredContentDigest: `sha256:${'7'.repeat(64)}` as Digest,
      semanticDigest: `sha256:${prepared.digests.source}` as Digest,
    },
    { maxAttempts: 3, maxActions: 128 }
  );
  const input = lowerRuntimePlanInput(prepared, profile, runId);
  return { prepared, profile, input, plan: createRuntimePlan(input) };
}

describe('native v2 ReviewCycle built-ins', () => {
  for (const name of ['bug-fix', 'small-feature'] as const) {
    it(`${name} prepares and lowers with typed phase isolation and a clean ship guard`, () => {
      const { prepared, profile, plan } = preparePlan(name);
      expect(prepared.authoredVersion).toBe(2);
      expect(prepared.warnings).toEqual([]);
      expect(JSON.stringify(prepared.authoredSource)).not.toContain('legacy');

      const loopPath = name === 'bug-fix' ? 'root:verify' : 'root:review-loop';
      const loop = plan.nodes.find((node) => node.hierarchicalPath === loopPath);
      expect(loop).toMatchObject({
        kind: 'bounded-loop',
        body: {
          kind: 'review-cycle',
          phases: [
            { phase: 'review', workspace: { access: 'read' } },
            { phase: 'triage', workspace: { access: 'read' } },
            { phase: 'fix', workspace: { access: 'write' } },
            { phase: 're-review', workspace: { access: 'read' } },
          ],
        },
      });
      if (!loop || loop.kind !== 'bounded-loop') throw new Error('Expected ReviewCycle loop.');

      const phasePolicies = new Map(
        profile.policy.stages
          .filter((stage) => stage.nodeId.startsWith('declaration:review-cycle-body/'))
          .map((stage) => [stage.nodeId.split(':').at(-1), stage])
      );
      expect(phasePolicies.get('review')?.role).toBe('reviewer');
      expect(phasePolicies.get('triage')?.role).toBe('reviewer');
      expect(phasePolicies.get('fix')?.role).toBe('fixer');
      expect(phasePolicies.get('re-review')?.role).toBe('reviewer');

      const ship = plan.nodes.find((node) => node.hierarchicalPath === 'root:ship');
      expect(ship?.requires).toEqual([loop.nodeId]);
      expect(ship).toMatchObject({ kind: 'atomic', gate: { gateId: 'gate:ship' } });

      const definitionLoop = prepared.definition.root.nodes.find(
        (node) => node.id === (name === 'bug-fix' ? 'verify' : 'review-loop')
      );
      expect(definitionLoop).toMatchObject({
        kind: 'BoundedLoop',
        lifecycle: { strategy: { maxAttempts: 1, requireMaterialChange: true } },
      });
      if (name === 'bug-fix') {
        const body = prepared.definition.declarations.find(
          (candidate) => candidate.id === 'review-cycle-body'
        )!;
        expect(body.graph.nodes.find((node) => node.id === 'review')).toMatchObject({
          execution: { verifyPolicy: 'adaptive' },
        });
      } else {
        expect(prepared.definition.root.nodes.find((node) => node.id === 'verify')).toMatchObject({
          execution: { verifyPolicy: 'standard' },
        });
      }
    });

    it(`${name} replays the immutable plan and initial reconciler decision deterministically`, () => {
      const { input, plan } = preparePlan(name);
      const decoded = createRuntimePlan(JSON.parse(JSON.stringify(input)));
      expect(decoded).toEqual(plan);
      const record = startRecord(plan);
      expect(reconcile(decoded, record)).toEqual(reconcile(plan, record));
      expect(reconcile(plan, record)).toEqual(reconcile(plan, record));
    });
  }
});
