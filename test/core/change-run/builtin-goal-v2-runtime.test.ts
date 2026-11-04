import { beforeAll, describe, expect, it } from 'vitest';

import { lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { Digest, RunId } from '../../../src/core/change-run/index.js';
import {
  freezeProductionPreparedPipelineRegistry,
  type ProductionPreparedPipelineRegistry,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { startRecord } from './reconciler-fixture.js';

const names = [
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
] as const;
const runId = `run:${'8'.repeat(64)}` as RunId;
let registry: ProductionPreparedPipelineRegistry;

beforeAll(async () => {
  registry = await freezeProductionPreparedPipelineRegistry(process.cwd(), {
    reporter: false,
  });
});

function preparePlan(name: (typeof names)[number]) {
  const prepared = registry.load(name).prepared;
  const profile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    [],
    {
      layer: 'package',
      kind: 'pipeline-definition-v2',
      sourceId: prepared.definition.sourceId,
      authoredContentDigest: `sha256:${'9'.repeat(64)}` as Digest,
      semanticDigest: `sha256:${prepared.digests.source}` as Digest,
    },
    { maxAttempts: 3, maxActions: 128 }
  );
  const input = lowerRuntimePlanInput(prepared, profile, runId);
  return { prepared, profile, input, plan: createRuntimePlan(input) };
}

describe('native v2 GoalLoop built-in matrix', () => {
  for (const name of names) {
    it(`${name} freezes typed work/judge, lifecycle strategy, and tail meaning`, () => {
      const { prepared, profile, plan } = preparePlan(name);
      const variant = name.replace('goal-loop-', '');
      expect(prepared.authoredVersion).toBe(2);
      expect(prepared.warnings).toEqual([]);
      expect(JSON.stringify(prepared.authoredSource)).not.toContain('goal-run.json');
      expect(JSON.stringify(prepared.authoredSource)).not.toContain('legacy');

      const loop = plan.nodes.find((node) => node.hierarchicalPath === 'root:iterate');
      expect(loop).toMatchObject({
        kind: 'bounded-loop',
        body: {
          kind: 'goal-cycle',
          variant,
          phases: [
            { phase: 'work', workspace: { access: 'write' } },
            { phase: 'judge', workspace: { access: 'read' } },
          ],
        },
        lifecycle: {
          strategy: { maxAttempts: 1, requireMaterialChange: true },
        },
      });
      if (!loop || loop.kind !== 'bounded-loop') throw new Error('Expected GoalLoop.');
      expect(profile.policy.stages.find(
        (stage) => stage.nodeId === 'declaration:goal-cycle-body/node:work'
      )?.role).toBe('implementer');
      expect(profile.policy.stages.find(
        (stage) => stage.nodeId === 'declaration:goal-cycle-body/node:judge'
      )?.role).toBe('reviewer');

      if (name === 'goal-loop-research') {
        expect(loop.lifecycle.exits.iterationLimit).toEqual({
          action: 'exit', outcome: 'max-rounds-exhausted',
        });
        expect(loop.lifecycle.exits.strategyExhausted).toEqual({
          action: 'exit', outcome: 'strategy-exhausted',
        });
        const report = plan.nodes.find((node) => node.hierarchicalPath === 'root:report');
        expect(report?.requires).toEqual([loop.nodeId]);
        const reportConnections = prepared.definition.root.connections.filter(
          (connection) => connection.to.node === 'report'
        );
        expect(reportConnections.map((connection) => connection.from.port).sort()).toEqual([
          'goal-satisfied', 'max-rounds-exhausted', 'strategy-exhausted',
        ]);
        expect(profile.policy.stages.find(
          (stage) => stage.nodeId === 'declaration:goal-cycle-body/node:work'
        )?.handoffTokenLimit).toBe(10_000);
        const work = prepared.definition.declarations[0]!.graph.nodes.find(
          (node) => node.id === 'work'
        );
        expect(work).toMatchObject({ execution: { handoff: { threshold: 0.35 } } });
      } else {
        expect(loop.lifecycle.exits.iterationLimit).toEqual({ action: 'strategy' });
        expect(loop.lifecycle.exits.strategyExhausted).toMatchObject({ action: 'fail' });
        const ship = plan.nodes.find((node) => node.hierarchicalPath === 'root:ship');
        expect(ship?.requires).toEqual([loop.nodeId]);
        expect(ship).toMatchObject({ kind: 'atomic', gate: { gateId: 'gate:ship' } });
      }
    });

    it(`${name} survives JSON process boundaries with deterministic reconcile output`, () => {
      const { input, plan } = preparePlan(name);
      const replayedPlan = createRuntimePlan(JSON.parse(JSON.stringify(input)));
      const record = startRecord(plan);
      const replayedRecord = JSON.parse(JSON.stringify(record)) as CanonicalRunRecord;
      expect(replayedPlan).toEqual(plan);
      expect(reconcile(replayedPlan, replayedRecord)).toEqual(reconcile(plan, record));
    });
  }
});
