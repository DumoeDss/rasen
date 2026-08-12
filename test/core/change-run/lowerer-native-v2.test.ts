import { describe, expect, it } from 'vitest';

import { lowerRuntimePlan, lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { Digest, RunId } from '../../../src/core/change-run/index.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type CapabilityCatalogSnapshot,
  type DefinitionSourceV2,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';

const CAPABILITY_VERSION = `sha256:${'1'.repeat(64)}`;
const runId = `run:${'2'.repeat(64)}` as RunId;

const execution = (
  role: 'implementer' | 'reviewer' | 'fixer' | 'shipper',
  access: 'read' | 'write'
) => ({
  version: 1 as const,
  role,
  workspace: { access },
});

const strategyLifecycle = (
  iterationLimit:
    | Readonly<{ action: 'strategy' }>
    | Readonly<{ action: 'exit'; outcome: string }>
) => ({
  version: 1 as const,
  thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
  strategy: {
    maxAttempts: 1,
    requireMaterialChange: true as const,
    capability: { id: 'skill:loop-strategy', version: CAPABILITY_VERSION },
  },
  exits: {
    iterationLimit,
    actionLimit: { action: 'fail' as const, outcome: 'action-limit' },
    budgetLimit: { action: 'fail' as const, outcome: 'budget-limit' },
    stalled: { action: 'strategy' as const },
    blocked: { action: 'human-required' as const, outcome: 'human-required' },
    strategyExhausted: {
      action: 'fail' as const,
      outcome: 'strategy-exhausted',
    },
  },
});

const capabilityShapes = [
  ['skill:review', ['clean', 'findings']],
  ['skill:triage', ['ready']],
  ['skill:fix', ['fixed']],
  ['skill:re-review', ['clean', 'needs_fix']],
  ['skill:ship', ['shipped']],
  ['skill:goal-work', ['ready']],
  ['skill:goal-judge', ['clean', 'needs_fix']],
  ['skill:report', ['reported']],
  ['skill:left', ['done']],
  ['skill:right', ['done']],
  ['skill:bypass', ['bypassed']],
  ['skill:loop-strategy', ['completed']],
] as const;

const catalog: CapabilityCatalogSnapshot = createCapabilityCatalogSnapshot(
  capabilityShapes.map(([id, outcomes]) => ({
    id,
    version: CAPABILITY_VERSION,
    availability: 'enabled' as const,
    inputs: [],
    artifacts: [],
    outcomes,
    limits: { maxActions: 16 },
    ...(id === 'skill:review' ? { phaseContracts: ['review-cycle/review'] as const } : {}),
    ...(id === 'skill:triage' ? { phaseContracts: ['review-cycle/triage'] as const } : {}),
    ...(id === 'skill:fix' ? { phaseContracts: ['review-cycle/fix'] as const } : {}),
    ...(id === 'skill:re-review' ? { phaseContracts: ['review-cycle/re-review'] as const } : {}),
    ...(id === 'skill:goal-work' ? { phaseContracts: ['goal-cycle/work'] as const } : {}),
    ...(id === 'skill:goal-judge' ? { phaseContracts: ['goal-cycle/judge'] as const } : {}),
  }))
);

const REVIEW_SOURCE: DefinitionSourceV2 = {
  version: 2,
  id: 'native-review-contract',
  sourceId: 'fixture:native-review-contract',
  name: 'neutral-review-workflow',
  inputs: [],
  artifacts: [],
  outcomes: ['approved', 'rejected', 'shipped'],
  declarations: [
    {
      id: 'review-body',
      kind: 'Composite',
      provenance: 'built-in',
      inputs: [],
      artifacts: [],
      outcomes: ['clean', 'needs_fix'],
      graph: {
        nodes: [
          {
            id: 'review',
            kind: 'AtomicStage',
            capability: { id: 'skill:review', version: CAPABILITY_VERSION },
            execution: execution('reviewer', 'read'),
            reviewCyclePhase: 'review',
          },
          {
            id: 'triage',
            kind: 'AtomicStage',
            capability: { id: 'skill:triage', version: CAPABILITY_VERSION },
            execution: execution('reviewer', 'read'),
            reviewCyclePhase: 'triage',
          },
          {
            id: 'fix',
            kind: 'AtomicStage',
            capability: { id: 'skill:fix', version: CAPABILITY_VERSION },
            execution: execution('fixer', 'write'),
            reviewCyclePhase: 'fix',
          },
          {
            id: 're-review',
            kind: 'AtomicStage',
            capability: { id: 'skill:re-review', version: CAPABILITY_VERSION },
            execution: execution('reviewer', 'read'),
            reviewCyclePhase: 're-review',
          },
        ],
        connections: [
          { id: 'review-triage', from: { node: 'review', port: 'findings' }, to: { node: 'triage', port: 'start' } },
          { id: 'triage-fix', from: { node: 'triage', port: 'ready' }, to: { node: 'fix', port: 'start' } },
          { id: 'fix-re-review', from: { node: 'fix', port: 'fixed' }, to: { node: 're-review', port: 'start' } },
        ],
      },
    },
  ],
  root: {
    nodes: [
      {
        id: 'review-loop',
        kind: 'BoundedLoop',
        body: 'review-body',
        limits: { maxIterations: 3, maxActions: 16, budget: 8 },
        lifecycle: strategyLifecycle({ action: 'strategy' }),
        exits: {
          clean: { action: 'exit', outcome: 'review-clean' },
          needs_fix: { action: 'continue' },
        },
      },
      {
        id: 'ship',
        kind: 'AtomicStage',
        capability: { id: 'skill:ship', version: CAPABILITY_VERSION },
        execution: execution('shipper', 'write'),
      },
      { id: 'finish', kind: 'Finish', outcome: 'shipped' },
      {
        id: 'ship-gate',
        kind: 'Gate',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed', rejected: 'escalate' },
        target: 'ship',
      },
    ],
    connections: [
      { id: 'review-ship', from: { node: 'review-loop', port: 'review-clean' }, to: { node: 'ship', port: 'start' } },
      { id: 'ship-finish', from: { node: 'ship', port: 'shipped' }, to: { node: 'finish', port: 'start' } },
    ],
  },
};

const GOAL_SOURCE: DefinitionSourceV2 = {
  version: 2,
  id: 'native-goal-contract',
  sourceId: 'fixture:native-goal-contract',
  name: 'neutral-research-workflow',
  inputs: [],
  artifacts: [],
  outcomes: ['reported'],
  declarations: [
    {
      id: 'goal-body',
      kind: 'Composite',
      provenance: 'built-in',
      inputs: [],
      artifacts: [],
      outcomes: ['clean', 'needs_fix'],
      graph: {
        nodes: [
          {
            id: 'work',
            kind: 'AtomicStage',
            capability: { id: 'skill:goal-work', version: CAPABILITY_VERSION },
            execution: execution('implementer', 'write'),
            goalCyclePhase: 'work',
          },
          {
            id: 'judge',
            kind: 'AtomicStage',
            capability: { id: 'skill:goal-judge', version: CAPABILITY_VERSION },
            execution: execution('reviewer', 'read'),
            goalCyclePhase: 'judge',
          },
        ],
        connections: [
          { id: 'work-judge', from: { node: 'work', port: 'ready' }, to: { node: 'judge', port: 'start' } },
        ],
      },
    },
  ],
  root: {
    nodes: [
      {
        id: 'iterate',
        kind: 'BoundedLoop',
        body: 'goal-body',
        limits: { maxIterations: 4, maxActions: 16, budget: 8 },
        lifecycle: strategyLifecycle({ action: 'exit', outcome: 'max-rounds-exhausted' }),
        exits: {
          clean: { action: 'exit', outcome: 'goal-satisfied' },
          needs_fix: { action: 'continue' },
        },
        goalCycleVariant: 'research',
      },
      {
        id: 'report',
        kind: 'AtomicStage',
        capability: { id: 'skill:report', version: CAPABILITY_VERSION },
        execution: execution('shipper', 'write'),
      },
      { id: 'finish', kind: 'Finish', outcome: 'reported' },
    ],
    connections: [
      { id: 'satisfied-report', from: { node: 'iterate', port: 'goal-satisfied' }, to: { node: 'report', port: 'start' } },
      { id: 'exhausted-report', from: { node: 'iterate', port: 'max-rounds-exhausted' }, to: { node: 'report', port: 'start' } },
      { id: 'report-finish', from: { node: 'report', port: 'reported' }, to: { node: 'finish', port: 'start' } },
    ],
  },
};

const PARALLEL_SOURCE: DefinitionSourceV2 = {
  version: 2,
  id: 'native-parallel-contract',
  sourceId: 'fixture:native-parallel-contract',
  name: 'neutral-parallel-workflow',
  inputs: [],
  artifacts: [],
  outcomes: ['bypassed', 'completed', 'experts-failed'],
  declarations: [],
  root: {
    nodes: [
      { id: 'decision', kind: 'Choice', outcomes: ['dispatch', 'bypass'] },
      {
        id: 'fanout',
        kind: 'FanOut',
        branches: ['left', 'right'],
        concurrencyCap: 2,
        budget: 2,
        joinNodeId: 'join',
        members: [
          { id: 'left', hierarchicalPath: 'left', required: true, condition: 'always' },
          { id: 'right', hierarchicalPath: 'right', required: false, condition: 'security-relevant' },
        ],
      },
      {
        id: 'left',
        kind: 'AtomicStage',
        capability: { id: 'skill:left', version: CAPABILITY_VERSION },
        execution: execution('reviewer', 'read'),
      },
      {
        id: 'right',
        kind: 'AtomicStage',
        capability: { id: 'skill:right', version: CAPABILITY_VERSION },
        execution: execution('reviewer', 'read'),
      },
      {
        id: 'join',
        kind: 'Join',
        inputs: ['left', 'right'],
        requiredMembers: ['left'],
        optionalMembers: ['right'],
        outcomes: { proceed: 'experts-ready', failed: 'experts-failed' },
      },
      { id: 'success', kind: 'Finish', outcome: 'completed' },
      {
        id: 'bypass',
        kind: 'AtomicStage',
        capability: { id: 'skill:bypass', version: CAPABILITY_VERSION },
        execution: execution('implementer', 'write'),
      },
    ],
    connections: [
      { id: 'decision-dispatch', from: { node: 'decision', port: 'dispatch' }, to: { node: 'fanout', port: 'start' } },
      { id: 'decision-bypass', from: { node: 'decision', port: 'bypass' }, to: { node: 'bypass', port: 'start' } },
      { id: 'fanout-left', from: { node: 'fanout', port: 'left' }, to: { node: 'left', port: 'start' } },
      { id: 'fanout-right', from: { node: 'fanout', port: 'right' }, to: { node: 'right', port: 'start' } },
      { id: 'left-join', from: { node: 'left', port: 'done' }, to: { node: 'join', port: 'left' } },
      { id: 'right-join', from: { node: 'right', port: 'done' }, to: { node: 'join', port: 'right' } },
      { id: 'join-success', from: { node: 'join', port: 'experts-ready' }, to: { node: 'success', port: 'start' } },
    ],
  },
};

function prepare(source: DefinitionSourceV2): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(structuredClone(source), catalog);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error.diagnostics, null, 2));
  }
  return result.value;
}

function profileFor(prepared: PreparedDefinition) {
  return resolveRuntimeExecutionProfile(
    prepared,
    catalog,
    [],
    {
      layer: 'package',
      kind: 'pipeline-definition-v2',
      sourceId: prepared.definition.sourceId,
      authoredContentDigest: `sha256:${'3'.repeat(64)}` as Digest,
      semanticDigest: `sha256:${prepared.digests.source}` as Digest,
    },
    { maxAttempts: 3, maxActions: 64 }
  );
}

function stripTypedField(
  prepared: PreparedDefinition,
  mutate: (definition: DefinitionSourceV2) => void
): PreparedDefinition {
  const definition = structuredClone(prepared.definition);
  mutate(definition);
  return { ...prepared, definition };
}

function expectNoLegacy(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('legacy');
  expect(serialized).not.toContain('LEGACY_NORMALIZED');
}

describe('native-v2 lowerer typed contract closure', () => {
  it('rejects phase-incompatible ReviewCycle and GoalLoop policy before lowering', () => {
    const reviewSource = structuredClone(REVIEW_SOURCE);
    const reviewFix = reviewSource.declarations[0]!.graph.nodes.find(
      (node) => node.kind === 'AtomicStage' && node.reviewCyclePhase === 'fix'
    );
    if (!reviewFix || reviewFix.kind !== 'AtomicStage') throw new Error('missing fix');
    reviewFix.capability = { id: 'skill:review', version: CAPABILITY_VERSION };
    const reviewResult = EcpDefinitionModule.prepare(reviewSource, catalog);
    expect(reviewResult.ok).toBe(false);
    if (!reviewResult.ok) {
      expect(reviewResult.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_LOWERING_METADATA',
          path: '/declarations/0/graph/nodes/2/capability',
        })
      );
    }

    const goalSource = structuredClone(GOAL_SOURCE);
    const goalJudge = goalSource.declarations[0]!.graph.nodes.find(
      (node) => node.kind === 'AtomicStage' && node.goalCyclePhase === 'judge'
    );
    if (!goalJudge || goalJudge.kind !== 'AtomicStage') throw new Error('missing judge');
    goalJudge.execution = execution('implementer', 'write');
    const goalResult = EcpDefinitionModule.prepare(goalSource, catalog);
    expect(goalResult.ok).toBe(false);
    if (!goalResult.ok) {
      expect(goalResult.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '/declarations/0/graph/nodes/1/execution/role' }),
          expect.objectContaining({ path: '/declarations/0/graph/nodes/1/execution/workspace/access' }),
        ])
      );
    }
  });

  it('lowers neutral-name ReviewCycle, explicit gate, strategy path, ship tail, and Finish without legacy inference', () => {
    const prepared = prepare(REVIEW_SOURCE);
    const profile = profileFor(prepared);
    const plan = lowerRuntimePlan(prepared, profile, runId);

    expectNoLegacy(prepared.definition);
    expect(prepared.authoredVersion).toBe(2);
    const loop = plan.nodes.find((node) => node.hierarchicalPath === 'root:review-loop');
    expect(loop).toMatchObject({
      kind: 'bounded-loop',
      strategyProfilePath: 'root:review-loop/strategy',
      body: {
        kind: 'review-cycle',
        phases: [
          { phase: 'review', profilePath: 'declaration:review-body/node:review' },
          { phase: 'triage', profilePath: 'declaration:review-body/node:triage' },
          { phase: 'fix', profilePath: 'declaration:review-body/node:fix' },
          { phase: 're-review', profilePath: 'declaration:review-body/node:re-review' },
        ],
      },
    });
    expect(profile.capabilities.map(({ nodeId }) => nodeId)).toContain('root:review-loop/strategy');
    expect(plan.nodes.find((node) => node.hierarchicalPath === 'root:ship')).toMatchObject({
      kind: 'atomic',
      gate: { gateId: 'ship-gate' },
    });
    expect(plan.finishNode).toMatchObject({ hierarchicalPath: 'root:finish', outcome: 'shipped' });
  });

  it('uses the authored Gate id, target, decisions, and dispositions as the only runtime gate authority', () => {
    const baseline = prepare(REVIEW_SOURCE);
    const baselineShip = lowerRuntimePlanInput(baseline, profileFor(baseline), runId)
      .nodes.find((node) => node.hierarchicalPath === 'root:ship');
    expect(baselineShip?.gate).toEqual({
      gateId: 'ship-gate',
      decisionIds: ['approved', 'rejected'],
      outcomes: { approved: 'proceed', rejected: 'escalate' },
    });

    const mutatedSource = structuredClone(REVIEW_SOURCE);
    const gate = mutatedSource.root.nodes.find((node) => node.kind === 'Gate');
    if (!gate || gate.kind !== 'Gate') throw new Error('missing gate fixture');
    gate.id = 'release-decision';
    gate.outcomes = ['accept', 'deny'];
    gate.dispositions = { accept: 'proceed', deny: 'fail' };
    mutatedSource.outcomes = ['accept', 'deny', 'shipped'];
    const mutated = prepare(mutatedSource);
    expect(
      lowerRuntimePlanInput(mutated, profileFor(mutated), runId)
        .nodes.find((node) => node.hierarchicalPath === 'root:ship')?.gate
    ).toEqual({
      gateId: 'release-decision',
      decisionIds: ['accept', 'deny'],
      outcomes: { accept: 'proceed', deny: 'fail' },
    });

    const removedSource = structuredClone(REVIEW_SOURCE);
    removedSource.root.nodes = removedSource.root.nodes.filter((node) => node.kind !== 'Gate');
    removedSource.outcomes = ['shipped'];
    const removed = prepare(removedSource);
    expect(
      lowerRuntimePlanInput(removed, profileFor(removed), runId)
        .nodes.find((node) => node.hierarchicalPath === 'root:ship')?.gate
    ).toBeUndefined();
  });

  it('lowers an explicitly typed research GoalLoop and truthful two-outcome report tail under a neutral name', () => {
    const prepared = prepare(GOAL_SOURCE);
    const plan = lowerRuntimePlan(prepared, profileFor(prepared), runId);

    expectNoLegacy(prepared.definition);
    const loop = plan.nodes.find((node) => node.hierarchicalPath === 'root:iterate');
    expect(loop).toMatchObject({
      kind: 'bounded-loop',
      strategyProfilePath: 'root:iterate/strategy',
      body: {
        kind: 'goal-cycle',
        variant: 'research',
        phases: [
          { phase: 'work', profilePath: 'declaration:goal-body/node:work' },
          { phase: 'judge', profilePath: 'declaration:goal-body/node:judge' },
        ],
      },
    });
    expect(plan.nodes.find((node) => node.hierarchicalPath === 'root:report')?.requires).toHaveLength(1);
    expect(plan.finishNode).toMatchObject({ hierarchicalPath: 'root:finish', outcome: 'reported' });
  });

  it('freezes evaluate only for an evaluate GoalLoop judge from Definition authority', () => {
    const evaluateSource = structuredClone(GOAL_SOURCE);
    const loop = evaluateSource.root.nodes.find(
      (node) => node.kind === 'BoundedLoop'
    );
    if (loop?.kind !== 'BoundedLoop') throw new Error('missing GoalLoop');
    loop.goalCycleVariant = 'evaluate';

    const evaluateProfile = profileFor(prepare(evaluateSource));
    const researchProfile = profileFor(prepare(GOAL_SOURCE));
    const work = evaluateProfile.policy.stages.find(
      (stage) => stage.nodeId === 'declaration:goal-body/node:work'
    );
    const judge = evaluateProfile.policy.stages.find(
      (stage) => stage.nodeId === 'declaration:goal-body/node:judge'
    );

    expect(work?.workerContract).toBe('leaf');
    expect(judge?.workerContract).toBe('evaluate');
    expect(evaluateProfile.policyDigest).not.toBe(researchProfile.policyDigest);
    expect(evaluateProfile.profileDigest).not.toBe(researchProfile.profileDigest);
  });

  it('lowers typed Choice, FanOut members, Join partitions/outcomes, and Finish branch targets exactly', () => {
    const prepared = prepare(PARALLEL_SOURCE);
    const input = lowerRuntimePlanInput(prepared, profileFor(prepared), runId);

    expectNoLegacy(prepared.definition);
    expect(input.nodes.find((node) => node.hierarchicalPath === 'root:decision')).toMatchObject({
      kind: 'choice',
      choice: {
        branches: { dispatch: 'root:fanout', bypass: 'root:bypass' },
      },
    });
    expect(input.nodes.find((node) => node.hierarchicalPath === 'root:fanout')).toMatchObject({
      kind: 'fan-out',
      fanOut: {
        concurrencyCap: 2,
        budget: 2,
        joinNodeId: 'root:join',
        members: [
          { hierarchicalPath: 'root:left', required: true, condition: 'always' },
          { hierarchicalPath: 'root:right', required: false, condition: 'security-relevant' },
        ],
      },
    });
    expect(input.nodes.find((node) => node.hierarchicalPath === 'root:join')).toMatchObject({
      kind: 'join',
      join: {
        requiredMembers: ['root:left'],
        optionalMembers: ['root:right'],
        outcomes: { proceed: 'experts-ready', failed: 'experts-failed' },
      },
    });
    expect(input.nodes.filter((node) => node.kind === 'finish')).toHaveLength(1);
  });

  it('decodes JSON-round-tripped inputs with stable root, declaration, strategy, member, join, and finish identities', () => {
    const reviewPrepared = prepare(REVIEW_SOURCE);
    const parallelPrepared = prepare(PARALLEL_SOURCE);
    const reviewInput = lowerRuntimePlanInput(
      reviewPrepared,
      profileFor(reviewPrepared),
      runId
    );
    const parallelInput = lowerRuntimePlanInput(
      parallelPrepared,
      profileFor(parallelPrepared),
      runId
    );

    const reviewDecoded = createRuntimePlan(
      JSON.parse(JSON.stringify(reviewInput)) as typeof reviewInput
    );
    const parallelDecoded = createRuntimePlan(
      JSON.parse(JSON.stringify(parallelInput)) as typeof parallelInput
    );

    expect(reviewDecoded.nodes.find((node) => node.hierarchicalPath === 'root:review-loop')).toMatchObject({
      strategyProfilePath: 'root:review-loop/strategy',
      body: {
        phases: expect.arrayContaining([
          expect.objectContaining({ profilePath: 'declaration:review-body/node:review' }),
          expect.objectContaining({ profilePath: 'declaration:review-body/node:fix' }),
        ]),
      },
    });
    expect(reviewDecoded.nodes.map(({ hierarchicalPath }) => hierarchicalPath)).toEqual([
      'root:review-loop',
      'root:ship',
      'root:finish',
    ]);
    expect(parallelDecoded.nodes.find((node) => node.hierarchicalPath === 'root:left')).toMatchObject({
      kind: 'atomic',
      profilePath: 'root:left',
      fanOut: { required: true },
    });
    expect(parallelDecoded.nodes.find((node) => node.hierarchicalPath === 'root:join')).toMatchObject({
      kind: 'join',
      outcomes: { proceed: 'experts-ready', failed: 'experts-failed' },
    });
    expect(parallelDecoded.finishNode).toMatchObject({ hierarchicalPath: 'root:success' });

    expect(
      createRuntimePlan(JSON.parse(JSON.stringify(reviewInput)) as typeof reviewInput)
    ).toEqual(reviewDecoded);
    expect(
      createRuntimePlan(JSON.parse(JSON.stringify(parallelInput)) as typeof parallelInput)
    ).toEqual(parallelDecoded);
  });

  it('fails closed if the validated GoalLoop variant is absent instead of consulting the pipeline name or legacy payload', () => {
    const prepared = prepare(GOAL_SOURCE);
    const profile = profileFor(prepared);
    const corrupted = stripTypedField(prepared, (definition) => {
      const loop = definition.root.nodes.find((node) => node.kind === 'BoundedLoop');
      if (loop?.kind === 'BoundedLoop') delete loop.goalCycleVariant;
    });

    expect(() => lowerRuntimePlanInput(corrupted, profile, runId)).toThrow(/goalCycleVariant/);
  });

  it('fails closed if validated FanOut or Join metadata is absent instead of synthesizing defaults', () => {
    const prepared = prepare(PARALLEL_SOURCE);
    const profile = profileFor(prepared);
    const corrupted = stripTypedField(prepared, (definition) => {
      const fanOut = definition.root.nodes.find((node) => node.kind === 'FanOut');
      const join = definition.root.nodes.find((node) => node.kind === 'Join');
      if (fanOut?.kind === 'FanOut') delete (fanOut as { members?: unknown }).members;
      if (join?.kind === 'Join') delete (join as { outcomes?: unknown }).outcomes;
    });

    expect(() => lowerRuntimePlanInput(corrupted, profile, runId)).toThrow(/typed FanOut|typed Join/);
  });

  it('fails closed when a Choice outcome lacks a typed graph target instead of inventing a branch path', () => {
    const prepared = prepare(PARALLEL_SOURCE);
    const profile = profileFor(prepared);
    const corrupted = stripTypedField(prepared, (definition) => {
      definition.root.connections = definition.root.connections.filter(
        (connection) => connection.id !== 'decision-bypass'
      );
    });

    expect(() => lowerRuntimePlanInput(corrupted, profile, runId)).toThrow(/Choice.*bypass/);
  });
});
