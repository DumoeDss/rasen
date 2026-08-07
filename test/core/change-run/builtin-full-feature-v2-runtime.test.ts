import { beforeAll, describe, expect, it } from 'vitest';

import { lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { Digest, JsonValue, RunId } from '../../../src/core/change-run/index.js';
import { analyzeReconcilerSupport } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import {
  freezeProductionPreparedPipelineRegistry,
  type ProductionPreparedPipelineRegistry,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
  succeedNode,
} from './reconciler-fixture.js';

const runId = `run:${'a'.repeat(64)}` as RunId;
const memberPaths = [
  'root:review',
  'root:cso',
  'root:benchmark',
  'root:design-review',
  'root:qa',
  'root:qa-report-only',
] as const;
let registry: ProductionPreparedPipelineRegistry;

beforeAll(async () => {
  registry = await freezeProductionPreparedPipelineRegistry(process.cwd(), {
    reporter: false,
  });
});

function preparePlan() {
  const prepared = registry.load('full-feature').prepared;
  const profile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    [],
    {
      layer: 'package',
      kind: 'pipeline-definition-v2',
      sourceId: prepared.definition.sourceId,
      authoredContentDigest: `sha256:${'b'.repeat(64)}` as Digest,
      semanticDigest: `sha256:${prepared.digests.source}` as Digest,
    },
    { maxAttempts: 3, maxActions: 256 }
  );
  const input = lowerRuntimePlanInput(prepared, profile, runId);
  return { prepared, profile, input, plan: createRuntimePlan(input) };
}

function apply(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`fixture reducer failed (${result.failure.code}): ${result.failure.message}`);
  }
  return result.record;
}

function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue,
  status: 'succeeded' | 'failed' = 'succeeded'
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  let next = apply(plan, record, {
    kind: 'admit-action', action, attemptOrdinal: 0, deliveryMode: 'grant',
  });
  next = apply(plan, next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence: evidenceFor(plan, action.actionId),
  });
  return apply(plan, next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
}

function advanceToExperts(plan: RuntimePlan): CanonicalRunRecord {
  let record = startRecord(plan);
  for (const path of ['root:office-hours', 'root:propose', 'root:apply']) {
    record = succeedNode(plan, record, path);
  }
  return record;
}

describe('native v2 full-feature runtime', () => {
  it('freezes the conditional expert frontier, collect-all Join, ReviewCycle, and guarded tail', () => {
    const { prepared, profile, plan } = preparePlan();
    expect(prepared.authoredVersion).toBe(2);
    expect(prepared.warnings).toEqual([]);
    expect(JSON.stringify(prepared.authoredSource)).not.toContain('legacy');

    const fanOut = plan.nodes.find((node) => node.hierarchicalPath === 'root:experts');
    expect(fanOut).toMatchObject({ kind: 'fan-out', concurrencyCap: 3, budget: 6 });
    if (!fanOut || fanOut.kind !== 'fan-out') throw new Error('Expected expert FanOut.');
    expect(fanOut.members.map((member) => member.hierarchicalPath).sort()).toEqual(
      [...memberPaths].sort()
    );
    expect(fanOut.members.find((member) => member.hierarchicalPath === 'root:review')).toMatchObject({
      required: true,
      condition: 'always',
    });
    expect(fanOut.members.filter((member) => !member.required)).toHaveLength(5);

    const join = plan.nodes.find((node) => node.hierarchicalPath === 'root:experts-join');
    expect(join).toMatchObject({
      kind: 'join',
      outcomes: { proceed: 'experts-ready', failed: 'experts-failed' },
    });
    if (!join || join.kind !== 'join') throw new Error('Expected expert Join.');
    expect(join.requiredMembers).toEqual([
      plan.nodes.find((node) => node.hierarchicalPath === 'root:review')!.nodeId,
    ]);
    expect(join.optionalMembers).toHaveLength(5);

    const loop = plan.nodes.find((node) => node.hierarchicalPath === 'root:review-loop');
    expect(loop?.requires).toEqual([join.nodeId]);
    expect(loop).toMatchObject({
      kind: 'bounded-loop',
      body: { kind: 'review-cycle' },
      lifecycle: { strategy: { maxAttempts: 1, requireMaterialChange: true } },
    });
    if (!loop || loop.kind !== 'bounded-loop') throw new Error('Expected ReviewCycle.');
    const ship = plan.nodes.find((node) => node.hierarchicalPath === 'root:ship');
    expect(ship?.requires).toEqual([loop.nodeId]);
    expect(ship).toMatchObject({ kind: 'atomic', gate: { gateId: 'gate:ship' } });
    expect(prepared.definition.root.connections.filter(
      (connection) => connection.to.node === 'ship'
    )).toEqual([
      expect.objectContaining({
        from: { node: 'review-loop', port: 'review-clean' },
        to: { node: 'ship', port: 'start' },
      }),
    ]);

    for (const path of memberPaths) {
      expect(profile.capabilities.find((binding) => binding.nodeId === path)?.workspace.access).toBe('read');
    }
    expect(profile.capabilities.find(
      (binding) => binding.nodeId === 'declaration:review-cycle-body/node:fix'
    )?.workspace.access).toBe('write');
    expect(analyzeReconcilerSupport(prepared, profile)).toMatchObject({
      availableEngines: ['reconciler'],
      reconcilerSupport: { supported: true, reason: 'supported_v2_executable' },
    });
  });

  it('round-trips the immutable plan and replays the same ready frontier after restart', () => {
    const { input, plan } = preparePlan();
    const replayedPlan = createRuntimePlan(JSON.parse(JSON.stringify(input)));
    const record = startRecord(plan);
    const replayedRecord = JSON.parse(JSON.stringify(record)) as CanonicalRunRecord;
    expect(replayedPlan).toEqual(plan);
    expect(reconcile(replayedPlan, replayedRecord)).toEqual(reconcile(plan, record));
  });

  it('drives an all-success expert frontier into the ReviewCycle', () => {
    const { plan } = preparePlan();
    let record = advanceToExperts(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: [...memberPaths], inactiveMembers: [], rationale: {},
    });
    for (const path of memberPaths) record = commitNode(plan, record, path, { ok: true });

    expect(reconcile(plan, record).actions).toContainEqual(expect.objectContaining({
      kind: 'admit',
      input: { reviewCycle: expect.objectContaining({ loopPath: 'root:review-loop', phase: 'review' }) },
    }));
  });

  it('drives required success plus optional failure into the ReviewCycle frontier', () => {
    const { plan } = preparePlan();
    let record = advanceToExperts(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:review', 'root:cso'],
      inactiveMembers: memberPaths.filter((path) => path !== 'root:review' && path !== 'root:cso'),
      rationale: {},
    });
    record = commitNode(plan, record, 'root:review', { ok: true });
    record = commitNode(plan, record, 'root:cso', { error: 'optional failure' }, 'failed');
    const next = reconcile(plan, record);
    expect(next.actions.some((action) => action.kind === 'escalate')).toBe(false);
    expect(next.actions).toContainEqual(expect.objectContaining({
      kind: 'admit',
      input: { reviewCycle: expect.objectContaining({ loopPath: 'root:review-loop', phase: 'review' }) },
    }));
  });

  it('fails closed when the required expert fails', () => {
    const { plan } = preparePlan();
    let record = advanceToExperts(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:review'],
      inactiveMembers: memberPaths.filter((path) => path !== 'root:review'),
      rationale: {},
    });
    record = commitNode(plan, record, 'root:review', { error: 'required failure' }, 'failed');
    expect(reconcile(plan, record).actions).toContainEqual(expect.objectContaining({
      kind: 'escalate', code: 'experts-failed',
    }));
  });

  it('applies budget suppression deterministically on the native expert topology', () => {
    const { input } = preparePlan();
    const budgeted = createRuntimePlan({
      ...input,
      nodes: input.nodes.map((node) =>
        node.kind === 'fan-out'
          ? { ...node, fanOut: { ...node.fanOut, budget: 1 } }
          : node
      ),
    });
    let record = advanceToExperts(budgeted);
    record = commitNode(budgeted, record, 'root:experts', {
      activeMembers: [...memberPaths], inactiveMembers: [], rationale: {},
    });
    const admits = reconcile(budgeted, record).actions.filter((action) =>
      action.kind === 'admit' && memberPaths.some((path) =>
        budgeted.nodes.find((node) => node.hierarchicalPath === path)?.nodeId === action.nodeId
      )
    );
    expect(admits).toHaveLength(1);
    const firstMemberPath = [...memberPaths].sort()[0]!;
    expect(admits[0]).toMatchObject({ nodeId: budgeted.nodes.find(
      (node) => node.hierarchicalPath === firstMemberPath
    )!.nodeId });
  });

  it('keeps cancellation terminal while the native expert frontier is active', () => {
    const { plan } = preparePlan();
    let record = advanceToExperts(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: [...memberPaths], inactiveMembers: [], rationale: {},
    });
    record = apply(plan, record, { kind: 'cancel', reason: 'operator stopped full-feature' });
    expect(record.terminal).toMatchObject({ kind: 'cancelled' });
    expect(reconcile(plan, record).actions).toEqual([]);
  });
});
