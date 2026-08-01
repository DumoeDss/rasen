import { describe, expect, it } from 'vitest';

import type { JsonValue, NodeId } from '../../../src/core/change-run/contracts.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import {
  decodeBoundedLoopStrategyResult,
  reconstructProgress,
  reduceBoundedLoopLifecycle,
  selectLatestAttempt,
  strategyInvocationPath,
  strategyRecoveryInvocationPath,
  type LoopDomainSnapshot,
} from '../../../src/core/change-run/internal/bounded-loop-lifecycle.js';
import { projectCompositeBodyProgress } from '../../../src/core/change-run/internal/composite-runtime.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { deriveNodeId } from '../../../src/core/change-run/internal/identity.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from '../../../src/core/change-run/internal/record.js';
import {
  reduceCandidateBatch,
  reduceCanonicalRunRecord,
  type RunStimulus,
} from '../../../src/core/change-run/internal/reducer.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanBoundedLoopNode,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createCanonicalWait } from '../../../src/core/change-run/internal/waits.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';

function loopNode(
  path: string,
  maxActions = 4,
  maxIterations = 1,
  stallIterations = 2,
  strategyMaxAttempts = 2
) {
  return {
    kind: 'bounded-loop' as const,
    hierarchicalPath: path,
    requires: [],
    limits: { maxIterations, maxActions, budget: maxActions },
    lifecycle: {
      version: 1 as const,
      thresholds: { stallIterations, sameBlockerAttempts: 1 },
      strategy: {
        maxAttempts: strategyMaxAttempts,
        requireMaterialChange: true as const,
        capability: { id: 'skill:loop-strategy', version: '1' },
      },
      exits: {
        iterationLimit: { action: 'strategy' as const },
        actionLimit: { action: 'escalate' as const, outcome: 'action-limit' },
        budgetLimit: { action: 'escalate' as const, outcome: 'budget-limit' },
        stalled: { action: 'strategy' as const },
        blocked: { action: 'strategy' as const },
        strategyExhausted: {
          action: 'escalate' as const,
          outcome: 'strategy-exhausted',
        },
      },
    },
    strategyProfilePath: `${path}/strategy`,
    body: {
      kind: 'composite' as const,
      declarationId: `${path}:body`,
      stages: [
        {
          hierarchicalPath: `${path}/stage`,
          profilePath: `${path}/stage-profile`,
          admissionKind: 'agent' as const,
          workspace: { access: 'write' as const },
          requires: [],
        },
      ],
      outcomes: { repeat: 'continue' },
    },
    outcomes: { clean: 'done', exhausted: 'exhausted' },
  };
}

function plan(
  maxActions = 4,
  twoLoops = false,
  maxIterations = 1,
  stallIterations = 2,
  strategyMaxAttempts = 2
): RuntimePlan {
  return createRuntimePlan({
    runId: fixtureDigests.runId,
    pipeline: 'bounded-loop-lifecycle-test',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'done',
    nodes: [
      loopNode(
        'root/loop-a',
        maxActions,
        maxIterations,
        stallIterations,
        strategyMaxAttempts
      ),
      ...(twoLoops ? [loopNode('root/loop-b', 4)] : []),
    ],
  });
}

function apply(
  record: CanonicalRunRecord,
  stimulus: RunStimulus
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`${result.failure.code}: ${result.failure.message}`);
  }
  return result.record;
}

function blockInvocation(
  runtimePlan: RuntimePlan,
  record: CanonicalRunRecord,
  invocationPath: string,
  occurrence = 0,
  blocker: Readonly<{
    reasonCode: string;
    blockerKey: string;
    detail: string;
  }> = {
    reasonCode: 'dependency_unavailable',
    blockerKey: 'service:fixture',
    detail: 'The prose is deliberately not part of blocker identity.',
  }
): Readonly<{ record: CanonicalRunRecord; action: CommittedAction }> {
  const action = agentAction(runtimePlan, invocationPath, occurrence);
  let next = apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status: 'blocked',
    receiptDigest: fixtureDigests.receiptDigest,
    result: {
      contract: 'bounded-loop/blocked/1',
      ...blocker,
    },
    evidence: [],
  });
  return { record: next, action: next.actions[action.actionId]! };
}

function succeedInvocation(
  runtimePlan: RuntimePlan,
  record: CanonicalRunRecord,
  invocationPath: string,
  result: JsonValue,
  input: JsonValue = { fixture: true },
  occurrence = 0
): Readonly<{ record: CanonicalRunRecord; action: CommittedAction }> {
  const base = agentAction(runtimePlan, invocationPath, occurrence);
  const action = {
    ...base,
    agent: { ...base.agent, input },
  };
  let next = apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence: [],
  });
  next = apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: [],
  });
  return { record: next, action: next.actions[action.actionId]! };
}

function failInvocation(
  runtimePlan: RuntimePlan,
  record: CanonicalRunRecord,
  invocationPath: string
): Readonly<{ record: CanonicalRunRecord; action: CommittedAction }> {
  const action = agentAction(runtimePlan, invocationPath);
  let next = apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status: 'failed',
    receiptDigest: fixtureDigests.receiptDigest,
    result: { code: 'fixture_failure' },
    evidence: [],
  });
  return { record: next, action: next.actions[action.actionId]! };
}

function snapshotFor(
  runtimePlan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode
): LoopDomainSnapshot {
  const hierarchicalPath = `${loop.hierarchicalPath}/round:1/stage`;
  const invocation = {
    nodeId: deriveNodeId(runtimePlan.runId, hierarchicalPath),
    hierarchicalPath,
    profilePath: `${loop.hierarchicalPath}/stage-profile`,
    admissionKind: 'agent' as const,
    access: 'write' as const,
    iteration: 1,
    phase: `${loop.hierarchicalPath}/stage`,
  };
  return {
    bodyKind: 'composite',
    iteration: 1,
    phase: invocation.phase,
    continueRequested: false,
    progressHistory: [],
    nextInvocation: invocation,
    ownedNodeIds: new Set<NodeId>([invocation.nodeId]),
    ownedInvocations: [invocation],
  };
}

describe('shared bounded-loop lifecycle primitives', () => {
  it('reconstructs baseline, equal progress, and material reset deterministically', () => {
    expect(reconstructProgress([])).toEqual({ stallStreak: 0 });
    const equal = reconstructProgress([
      { iteration: 2, material: { gaps: ['A'] } },
      { iteration: 1, material: { gaps: ['A'] } },
    ]);
    expect(equal.stallStreak).toBe(1);
    expect(equal.fingerprint).toMatch(/^sha256:/);
    expect(
      reconstructProgress([
        { iteration: 1, material: { gaps: ['A'] } },
        { iteration: 2, material: { gaps: ['B'] } },
      ]).stallStreak
    ).toBe(0);
    expect(
      reconstructProgress([
        { iteration: 2, material: { gaps: ['A'] } },
        { iteration: 1, material: { gaps: ['A'] } },
        { iteration: 2, material: { gaps: ['A'] } },
      ])
    ).toEqual(equal);
  });

  it('selects by attempt ordinal and then stable ActionId', () => {
    const attempt = (ordinal: number, char: string) =>
      ({
        attemptOrdinal: ordinal,
        action: { actionId: `action:${char.repeat(64)}` },
      }) as unknown as CommittedAction;
    expect(
      selectLatestAttempt([
        attempt(2, '1'),
        attempt(1, 'f'),
        attempt(2, '2'),
      ])?.action.actionId
    ).toBe(`action:${'2'.repeat(64)}`);
  });

  it('rejects successful strategy self-report outside the closed contract', () => {
    expect(() =>
      decodeBoundedLoopStrategyResult({ materialChange: true })
    ).toThrow(/bounded-loop\/strategy-result\/1/);
    expect(
      decodeBoundedLoopStrategyResult({
        contract: 'bounded-loop/strategy-result/1',
        strategyKey: 'retry-with-fixture',
        rationale: 'Exercise one recovered domain attempt.',
        intendedChangeSurface: ['fixture'],
        evidence: [],
      }).strategyKey
    ).toBe('retry-with-fixture');
  });
});

describe('closed shared lifecycle decision matrix', () => {
  it('covers domain completion, ready, waiting, action failure, and cancellation', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const base = snapshotFor(runtimePlan, loop);
    const fresh = startRecord(runtimePlan);

    expect(reduceBoundedLoopLifecycle(runtimePlan, loop, fresh, {
      ...base,
      completionOutcome: 'domain-clean',
      nextInvocation: undefined,
    }).decision).toEqual({
      kind: 'completed',
      outcome: 'domain-clean',
      reason: 'domain-complete',
      disposition: 'domain',
    });
    expect(reduceBoundedLoopLifecycle(runtimePlan, loop, fresh, base).decision.kind)
      .toBe('ready');
    expect(reduceBoundedLoopLifecycle(runtimePlan, loop, fresh, {
      ...base,
      nextInvocation: undefined,
    }).decision.kind).toBe('waiting');

    const failed = failInvocation(
      runtimePlan,
      fresh,
      base.nextInvocation!.hierarchicalPath
    ).record;
    expect(reduceBoundedLoopLifecycle(runtimePlan, loop, failed, base).decision)
      .toMatchObject({ kind: 'failed', reason: 'action-failed' });

    const cancelled = apply(fresh, { kind: 'cancel', reason: 'fixture cancel' });
    expect(reduceBoundedLoopLifecycle(runtimePlan, loop, cancelled, base).decision)
      .toEqual({ kind: 'cancelled' });
  });

  it.each([
    ['exit', 'completed'],
    ['escalate', 'escalated'],
    ['fail', 'failed'],
  ] as const)('maps iteration-limit %s to the closed %s decision', (action, expectedKind) => {
    const runtimePlan = plan(8);
    const original = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const loop = {
      ...original,
      lifecycle: {
        ...original.lifecycle,
        exits: {
          ...original.lifecycle.exits,
          iterationLimit: { action, outcome: `iteration-${action}` },
        },
      },
    } as RuntimePlanBoundedLoopNode;
    const decision = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      startRecord(runtimePlan),
      {
        ...snapshotFor(runtimePlan, loop),
        continueRequested: true,
        nextInvocation: undefined,
      }
    ).decision;
    expect(decision).toMatchObject({
      kind: expectedKind,
      outcome: `iteration-${action}`,
      reason: 'iteration-limit',
    });
  });

  it('selects action-limit, budget-limit, stall, strategy, and strategy exhaustion', () => {
    const runtimePlan = plan(8);
    const original = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const base = snapshotFor(runtimePlan, original);
    const oneAction = succeedInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      base.nextInvocation!.hierarchicalPath,
      { material: 'one' }
    ).record;

    const actionLimited = {
      ...original,
      limits: { ...original.limits, maxActions: 1, budget: 2 },
    } as RuntimePlanBoundedLoopNode;
    expect(reduceBoundedLoopLifecycle(runtimePlan, actionLimited, oneAction, {
      ...base,
      nextInvocation: undefined,
    }).decision).toMatchObject({ kind: 'escalated', reason: 'action-limit' });

    const budgetLimited = {
      ...original,
      limits: { ...original.limits, maxActions: 2, budget: 1 },
    } as RuntimePlanBoundedLoopNode;
    expect(reduceBoundedLoopLifecycle(runtimePlan, budgetLimited, oneAction, {
      ...base,
      nextInvocation: undefined,
    }).decision).toMatchObject({ kind: 'escalated', reason: 'budget-limit' });

    const stalled = {
      ...original,
      lifecycle: {
        ...original.lifecycle,
        thresholds: { ...original.lifecycle.thresholds, stallIterations: 1 },
        exits: {
          ...original.lifecycle.exits,
          stalled: { action: 'exit', outcome: 'stalled-exit' },
        },
      },
    } as RuntimePlanBoundedLoopNode;
    expect(reduceBoundedLoopLifecycle(runtimePlan, stalled, startRecord(runtimePlan), {
      ...base,
      continueRequested: true,
      progressHistory: [
        { iteration: 1, material: { gaps: ['same'] } },
        { iteration: 2, material: { gaps: ['same'] } },
      ],
      nextInvocation: undefined,
    }).decision).toMatchObject({ kind: 'completed', reason: 'stalled' });

    const atLimit = {
      ...base,
      continueRequested: true,
      nextInvocation: undefined,
    };
    expect(reduceBoundedLoopLifecycle(
      runtimePlan,
      original,
      startRecord(runtimePlan),
      atLimit
    ).decision).toMatchObject({ kind: 'strategy-ready', trigger: 'iteration-limit' });

    const afterStrategy = succeedInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      strategyInvocationPath(original.hierarchicalPath, 1),
      {
        contract: 'bounded-loop/strategy-result/1',
        strategyKey: 'fixture-strategy',
        rationale: 'Exercise strategy exhaustion.',
        intendedChangeSurface: ['fixture'],
        evidence: [],
      },
      {
        boundedLoopStrategy: {
          loopPath: original.hierarchicalPath,
          attempt: 1,
          trigger: 'iteration-limit',
        },
      }
    ).record;
    const exhaustedLoop = {
      ...original,
      lifecycle: {
        ...original.lifecycle,
        strategy: { ...original.lifecycle.strategy, maxAttempts: 1 },
      },
    } as RuntimePlanBoundedLoopNode;
    expect(reduceBoundedLoopLifecycle(
      runtimePlan,
      exhaustedLoop,
      afterStrategy,
      atLimit
    ).decision).toMatchObject({
      kind: 'escalated',
      reason: 'strategy-exhausted',
    });
  });

  it.each([
    ['human-required', 'human-required'],
    ['exit', 'completed'],
    ['escalate', 'escalated'],
    ['fail', 'failed'],
    ['strategy', 'strategy-ready'],
  ] as const)('maps blocked %s to %s without prose-derived identity', (action, expectedKind) => {
    const runtimePlan = plan(8);
    const original = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const blocked = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      snapshotFor(runtimePlan, original).nextInvocation!.hierarchicalPath
    );
    const blockedExit = action === 'human-required'
      ? { action, outcome: 'human-outcome' }
      : action === 'strategy'
        ? { action }
        : { action, outcome: `blocked-${action}` };
    const loop = {
      ...original,
      lifecycle: {
        ...original.lifecycle,
        exits: { ...original.lifecycle.exits, blocked: blockedExit },
      },
    } as RuntimePlanBoundedLoopNode;
    const decision = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      blocked.record,
      snapshotFor(runtimePlan, loop)
    ).decision;
    expect(decision.kind).toBe(expectedKind);
    if (decision.kind !== 'strategy-ready') {
      expect('trigger' in decision ? decision.trigger : undefined).toBeUndefined();
    }
  });

  it('reconstructs semantic blocker streaks and resets them after success', () => {
    const runtimePlan = plan(12);
    const original = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const loop = {
      ...original,
      lifecycle: {
        ...original.lifecycle,
        thresholds: {
          ...original.lifecycle.thresholds,
          sameBlockerAttempts: 4,
        },
      },
    } as RuntimePlanBoundedLoopNode;
    const snapshot = snapshotFor(runtimePlan, loop);
    const invocationPath = snapshot.nextInvocation!.hierarchicalPath;
    const first = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      invocationPath,
      0,
      {
        reasonCode: 'dependency_unavailable',
        blockerKey: 'service:fixture',
        detail: 'first prose and evidence description',
      }
    );
    const firstWait = first.record.waits.find(
      (wait) => wait.kind === 'domain-blocked'
    )!;
    const afterFirst = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      first.record,
      snapshot
    );
    expect(afterFirst.blockedStreak).toBe(1);

    const resumedFirst = apply(first.record, {
      kind: 'resume-wait',
      waitId: firstWait.waitId,
    });
    const sameSemantic = blockInvocation(
      runtimePlan,
      resumedFirst,
      invocationPath,
      1,
      {
        reasonCode: 'dependency_unavailable',
        blockerKey: 'service:fixture',
        detail: 'different prose does not change semantic identity',
      }
    );
    const sameSnapshot = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      sameSemantic.record,
      snapshot
    );
    expect(sameSnapshot).toMatchObject({
      blockerFingerprint: afterFirst.blockerFingerprint,
      blockedStreak: 2,
    });

    const secondWait = sameSemantic.record.waits.find(
      (wait) => wait.kind === 'domain-blocked'
    )!;
    const resumedSecond = apply(sameSemantic.record, {
      kind: 'resume-wait',
      waitId: secondWait.waitId,
    });
    const differentSemantic = blockInvocation(
      runtimePlan,
      resumedSecond,
      invocationPath,
      2,
      {
        reasonCode: 'dependency_unavailable',
        blockerKey: 'service:other',
        detail: 'a different stable blocker key resets the streak',
      }
    );
    const differentSnapshot = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      differentSemantic.record,
      snapshot
    );
    expect(differentSnapshot.blockerFingerprint).not.toBe(
      afterFirst.blockerFingerprint
    );
    expect(differentSnapshot.blockedStreak).toBe(1);

    const thirdWait = differentSemantic.record.waits.find(
      (wait) => wait.kind === 'domain-blocked'
    )!;
    const resumedThird = apply(differentSemantic.record, {
      kind: 'resume-wait',
      waitId: thirdWait.waitId,
    });
    const succeeded = succeedInvocation(
      runtimePlan,
      resumedThird,
      invocationPath,
      { material: 'restored' },
      { fixture: true },
      3
    );
    const recovered = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      succeeded.record,
      snapshot
    );
    expect(recovered.blockedStreak).toBe(0);
    expect(recovered).not.toHaveProperty('blockerFingerprint');
  });
});

describe('paired ReviewCycle/GoalLoop mechanical parity', () => {
  it.each([
    ['ready', { continueRequested: false, progressHistory: [] }],
    ['stalled', {
      continueRequested: true,
      progressHistory: [
        { iteration: 1, material: { stable: true } },
        { iteration: 2, material: { stable: true } },
      ],
    }],
    ['iteration-limit', { continueRequested: true, progressHistory: [] }],
  ] as const)('%s inputs produce the same shared decision and counters', (_name, overrides) => {
    const runtimePlan = plan(8);
    const original = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const loop = {
      ...original,
      lifecycle: {
        ...original.lifecycle,
        thresholds: { ...original.lifecycle.thresholds, stallIterations: 1 },
      },
    } as RuntimePlanBoundedLoopNode;
    const base = snapshotFor(runtimePlan, loop);
    const mechanical = {
      ...base,
      ...overrides,
      nextInvocation: _name === 'ready' ? base.nextInvocation : undefined,
    };
    const review = reduceBoundedLoopLifecycle(runtimePlan, loop, startRecord(runtimePlan), {
      ...mechanical,
      bodyKind: 'review-cycle',
    });
    const goal = reduceBoundedLoopLifecycle(runtimePlan, loop, startRecord(runtimePlan), {
      ...mechanical,
      bodyKind: 'goal-cycle',
    });
    expect(review).toEqual(goal);
    expect(mechanical.bodyKind).toBe('composite');
  });
});

describe('blocked-to-strategy admission boundary', () => {
  it('applies the action limit before admitting the initial blocked strategy', () => {
    const runtimePlan = plan(1);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const blocked = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      `${loop.hierarchicalPath}/round:1/stage`
    );
    const lifecycle = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      blocked.record,
      snapshotFor(runtimePlan, loop)
    );
    expect(lifecycle.decision).toMatchObject({
      kind: 'escalated',
      reason: 'action-limit',
      outcome: 'action-limit',
    });
  });

  it('consumes the exact source wait with a strategy fact, never RunResumed', () => {
    const runtimePlan = plan();
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const blocked = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      `${loop.hierarchicalPath}/round:1/stage`
    );
    const lifecycle = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      blocked.record,
      snapshotFor(runtimePlan, loop)
    );
    expect(lifecycle.decision.kind).toBe('strategy-ready');
    if (lifecycle.decision.kind !== 'strategy-ready') return;
    const source = lifecycle.decision.sourceBlockedWait;
    expect(source).toBeDefined();
    const reconciled = reconcile(runtimePlan, blocked.record);
    expect(reconciled.ok).toBe(true);
    if (reconciled.ok) {
      expect(reconciled.actions).toContainEqual(
        expect.objectContaining({
          kind: 'admit',
          nodeId: lifecycle.decision.invocation.nodeId,
          consumesDomainBlockedWait: {
            waitId: source!.waitId,
            actionId: source!.actionId,
            trigger: 'blocked',
          },
        })
      );
    }

    const strategyPath = strategyInvocationPath(loop.hierarchicalPath, 1);
    const baseStrategy = agentAction(runtimePlan, strategyPath);
    const strategy = {
      ...baseStrategy,
      agent: {
        ...baseStrategy.agent,
        input: {
          boundedLoopStrategy: {
            loopPath: loop.hierarchicalPath,
            attempt: 1,
            trigger: 'blocked',
          },
        } as JsonValue,
      },
    };
    const settled = reduceCandidateBatch(blocked.record, [
      {
        kind: 'consume-domain-blocked-wait-for-strategy',
        waitId: source!.waitId,
        actionId: source!.actionId,
        strategyNodeId: strategy.nodeId,
        trigger: 'blocked',
      },
      {
        kind: 'admit-action',
        action: strategy,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      },
    ]);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.record.waits).toHaveLength(0);
    expect(settled.record.transitions).toContainEqual(
      expect.objectContaining({
        kind: 'DomainBlockedWaitConsumedByStrategy',
        waitId: source!.waitId,
        actionId: source!.actionId,
        strategyNodeId: strategy.nodeId,
      })
    );
    expect(
      settled.record.transitions.some(
        (transition) => transition.kind === 'RunResumed'
      )
    ).toBe(false);
  });

  it('projects a successful iteration-limit strategy into one recovery path', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const normalPath = `${loop.hierarchicalPath}/round:1/stage`;
    let record = succeedInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      normalPath,
      { material: 'before' }
    ).record;
    let next = reconcile(runtimePlan, record);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const strategyCandidate = next.actions.find(
      (candidate) =>
        candidate.kind === 'admit' &&
        candidate.input?.boundedLoopStrategy !== undefined
    );
    expect(strategyCandidate).toMatchObject({
      kind: 'admit',
      input: {
        boundedLoopStrategy: { attempt: 1, trigger: 'iteration-limit' },
      },
    });

    record = succeedInvocation(
      runtimePlan,
      record,
      strategyInvocationPath(loop.hierarchicalPath, 1),
      {
        contract: 'bounded-loop/strategy-result/1',
        strategyKey: 'recover-once',
        rationale: 'Run the frozen domain stage once more.',
        intendedChangeSurface: ['fixture'],
        evidence: [],
      },
      {
        boundedLoopStrategy: {
          loopPath: loop.hierarchicalPath,
          attempt: 1,
          trigger: 'iteration-limit',
        },
      }
    ).record;
    next = reconcile(runtimePlan, record);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const recoveryPath = strategyRecoveryInvocationPath(
      loop.hierarchicalPath,
      1,
      `${loop.hierarchicalPath}/round:2/stage`
    );
    expect(next.actions).toContainEqual(
      expect.objectContaining({
        kind: 'admit',
        nodeId: deriveNodeId(runtimePlan.runId, recoveryPath),
        input: {
          boundedLoopRecovery: {
            loopPath: loop.hierarchicalPath,
            strategyAttempt: 1,
            iteration: 2,
            phase: `${loop.hierarchicalPath}/stage`,
          },
        },
      })
    );

    record = succeedInvocation(
      runtimePlan,
      record,
      recoveryPath,
      { material: 'after' },
      {
        boundedLoopRecovery: {
          loopPath: loop.hierarchicalPath,
          strategyAttempt: 1,
          iteration: 2,
          phase: `${loop.hierarchicalPath}/stage`,
        },
      }
    ).record;
    expect(projectCompositeBodyProgress(runtimePlan, loop, record).kind).toBe(
      'exhausted'
    );
    const lifecycle = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      record,
      {
        ...snapshotFor(runtimePlan, loop),
        iteration: 2,
        phase: 'complete',
        continueRequested: true,
        progressHistory: [
          { iteration: 1, material: [{ stage: 'stage', result: { material: 'before' } }] },
          { iteration: 2, material: [{ stage: 'stage', result: { material: 'after' } }] },
        ],
        nextInvocation: undefined,
      }
    );
    expect(lifecycle.decision).toMatchObject({
      kind: 'strategy-ready',
      attempt: 2,
      trigger: 'iteration-limit',
    });
    const section = (
      projectRunView(record, 'active', runtimePlan).sections as readonly Readonly<
        Record<string, unknown>
      >[]
    ).find((candidate) => candidate.kind === 'bounded-loop-lifecycle');
    expect(section).toMatchObject({
      iteration: 2,
      limits: { iterations: { used: 1, max: 1 } },
    });
  });

  it('Composite stall strategy with material recovery returns to the remaining normal rounds', () => {
    const runtimePlan = plan(16, false, 4, 1, 1);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    let record = startRecord(runtimePlan);
    for (const round of [1, 2]) {
      record = succeedInvocation(
        runtimePlan,
        record,
        `${loop.hierarchicalPath}/round:${round}/stage`,
        { material: 'same' }
      ).record;
    }
    let next = reconcile(runtimePlan, record);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const strategyCandidate = next.actions.find(
      (candidate) => candidate.kind === 'admit' && candidate.input?.boundedLoopStrategy
    );
    expect(strategyCandidate).toMatchObject({
      kind: 'admit',
      input: { boundedLoopStrategy: { attempt: 1, trigger: 'stalled' } },
    });

    record = succeedInvocation(
      runtimePlan,
      record,
      strategyInvocationPath(loop.hierarchicalPath, 1),
      {
        contract: 'bounded-loop/strategy-result/1',
        strategyKey: 'composite-material-recovery',
        rationale: 'Change the structured stage result.',
        intendedChangeSurface: ['fixture-stage'],
        evidence: [],
      },
      {
        boundedLoopStrategy: {
          loopPath: loop.hierarchicalPath,
          attempt: 1,
          trigger: 'stalled',
        },
      }
    ).record;
    next = reconcile(runtimePlan, record);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const recoveryPath = strategyRecoveryInvocationPath(
      loop.hierarchicalPath,
      1,
      `${loop.hierarchicalPath}/round:3/stage`
    );
    expect(next.actions).toContainEqual(expect.objectContaining({
      kind: 'admit',
      nodeId: deriveNodeId(runtimePlan.runId, recoveryPath),
    }));

    record = succeedInvocation(
      runtimePlan,
      record,
      recoveryPath,
      { material: 'changed' },
      {
        boundedLoopRecovery: {
          loopPath: loop.hierarchicalPath,
          strategyAttempt: 1,
          iteration: 3,
          phase: `${loop.hierarchicalPath}/stage`,
        },
      }
    ).record;
    next = reconcile(runtimePlan, record);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const normalRound = next.actions.find(
      (candidate) =>
        candidate.kind === 'admit' &&
        candidate.nodeId === deriveNodeId(
          runtimePlan.runId,
          `${loop.hierarchicalPath}/round:4/stage`
        )
    );
    expect(normalRound).toBeDefined();
    expect(normalRound?.kind === 'admit' ? normalRound.input?.boundedLoopRecovery : undefined)
      .toBeUndefined();
  });

  it('Composite unchanged recovery closes at strategy-exhausted exactly once', () => {
    const runtimePlan = plan(16, false, 4, 1, 1);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    let record = startRecord(runtimePlan);
    for (const round of [1, 2]) {
      record = succeedInvocation(
        runtimePlan,
        record,
        `${loop.hierarchicalPath}/round:${round}/stage`,
        { material: 'same' }
      ).record;
    }
    record = succeedInvocation(
      runtimePlan,
      record,
      strategyInvocationPath(loop.hierarchicalPath, 1),
      {
        contract: 'bounded-loop/strategy-result/1',
        strategyKey: 'composite-unchanged-recovery',
        rationale: 'Exercise unchanged structured progress.',
        intendedChangeSurface: ['fixture-stage'],
        evidence: [],
      },
      {
        boundedLoopStrategy: {
          loopPath: loop.hierarchicalPath,
          attempt: 1,
          trigger: 'stalled',
        },
      }
    ).record;
    const recoveryPath = strategyRecoveryInvocationPath(
      loop.hierarchicalPath,
      1,
      `${loop.hierarchicalPath}/round:3/stage`
    );
    record = succeedInvocation(
      runtimePlan,
      record,
      recoveryPath,
      { material: 'same' },
      {
        boundedLoopRecovery: {
          loopPath: loop.hierarchicalPath,
          strategyAttempt: 1,
          iteration: 3,
          phase: `${loop.hierarchicalPath}/stage`,
        },
      }
    ).record;
    const first = reconcile(runtimePlan, record);
    const replay = reconcile(runtimePlan, record);
    expect(first).toEqual(replay);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.actions).toEqual([
      expect.objectContaining({
        kind: 'escalate',
        code: 'strategy-exhausted',
      }),
    ]);
  });

  it('rejects a malformed successful strategy result before facade mutation', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    let record = succeedInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      `${loop.hierarchicalPath}/round:1/stage`,
      { material: 'before' }
    ).record;
    const baseStrategy = agentAction(
      runtimePlan,
      strategyInvocationPath(loop.hierarchicalPath, 1)
    );
    const strategy = {
      ...baseStrategy,
      agent: {
        ...baseStrategy.agent,
        input: {
          boundedLoopStrategy: {
            loopPath: loop.hierarchicalPath,
            attempt: 1,
            trigger: 'iteration-limit',
          },
        } as JsonValue,
      },
    };
    record = apply(record, {
      kind: 'admit-action',
      action: strategy,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    const store = createInMemoryRunStore();
    store.create(runtimePlan.runId, record);
    const runtime = createChangePipelineRuntime({
      store,
      plan: runtimePlan,
      initialRecord: startRecord(runtimePlan),
      buildAction: () => {
        throw new Error('No action should be built while validating completion.');
      },
    });
    const attestation = evidenceFor(runtimePlan, strategy.actionId)[0]!;
    const actor = buildAgentActor({
      role: 'strategist',
      provider: 'fixture',
      runtime: 'vitest',
      principalIdentityDigest: fixtureDigests.receiptDigest,
      sessionIdentityDigest: fixtureDigests.workspaceDigest,
      adapter: {
        id: 'fixture-strategy',
        version: '1',
        artifactDigest: fixtureDigests.capabilityDigest,
      },
    });
    const completion = {
      format: 'change-run-completion/1' as const,
      kind: 'domain-action-result' as const,
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      runId: runtimePlan.runId,
      actionId: strategy.actionId,
      invocationId: strategy.invocationId,
      receiptDigest: fixtureDigests.receiptDigest,
      actor,
      actorAttestation: attestation,
      evidence: [],
      status: 'succeeded' as const,
      result: { materialChange: true },
    };
    const request = {
      ...completion,
      receiptDigest: computeCompletionReceiptDigest(completion),
    };
    const before = store.load(runtimePlan.runId);
    expect(() =>
      runtime.complete(request, { deliveryMode: 'grant' })
    ).toThrow(/bounded-loop\/strategy-result\/1/);
    expect(store.load(runtimePlan.runId)).toBe(before);
  });

  it('commits exact human retry evidence and consumes it with one fresh attempt', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const invocationPath = `${loop.hierarchicalPath}/round:1/stage`;
    const blocked = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      invocationPath
    );
    const domainWait = blocked.record.waits.find(
      (wait) => wait.kind === 'domain-blocked'
    )!;
    const source = blocked.action;
    const humanWait = createCanonicalWait(runtimePlan.runId, {
      kind: 'human-required',
      nodeId: source.action.nodeId,
      invocationId: source.action.invocationId,
      occurrence: source.attemptOrdinal,
      attemptId: source.action.attemptId,
      actionId: source.action.actionId,
      effectIds: source.effects.map((effect) => effect.effectId),
      loopPath: loop.hierarchicalPath,
      phase: `${loop.hierarchicalPath}/stage`,
      blockerFingerprint: 'sha256:' + '1'.repeat(64),
      reasonCode: 'dependency_unavailable',
      outcome: 'human-escalated',
      evidence: [],
      decisionIds: ['retry', 'escalate'],
    });
    if (humanWait.kind !== 'human-required') return;
    let record = apply(blocked.record, {
      kind: 'await-human-required',
      wait: humanWait,
    });
    expect(record.waits).not.toContainEqual(domainWait);
    const retryEvidence = evidenceFor(runtimePlan, source.action.actionId);
    record = apply(record, {
      kind: 'decide-human',
      waitId: humanWait.waitId,
      decisionId: 'retry',
      outcome: 'retry with dependency restored',
      evidence: retryEvidence,
    });
    expect(record.waits).toHaveLength(0);
    expect(record.transitions).toContainEqual(
      expect.objectContaining({
        kind: 'HumanDecisionCommitted',
        waitId: humanWait.waitId,
        actionId: source.action.actionId,
        decisionId: 'retry',
        evidence: retryEvidence.map((item) => item.evidenceDigest),
      })
    );
    expect(
      reduceBoundedLoopLifecycle(
        runtimePlan,
        loop,
        record,
        snapshotFor(runtimePlan, loop)
      ).decision.kind
    ).toBe('ready');

    const fresh = agentAction(runtimePlan, invocationPath, 1);
    record = apply(record, {
      kind: 'admit-action',
      action: fresh,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    expect(
      reduceBoundedLoopLifecycle(
        runtimePlan,
        loop,
        record,
        snapshotFor(runtimePlan, loop)
      ).decision.kind
    ).toBe('waiting');

    const stale = reduceCanonicalRunRecord(record, {
      kind: 'decide-human',
      waitId: humanWait.waitId,
      decisionId: 'retry',
      outcome: 'replay',
      evidence: [],
    });
    expect(stale).toMatchObject({
      ok: false,
      failure: { code: 'wait_identity_conflict' },
    });
  });

  it('commits exact human escalation evidence before terminalizing', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const invocationPath = `${loop.hierarchicalPath}/round:1/stage`;
    const blocked = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      invocationPath
    );
    const source = blocked.action;
    const evidence = evidenceFor(runtimePlan, source.action.actionId);
    const humanWait = createCanonicalWait(runtimePlan.runId, {
      kind: 'human-required',
      nodeId: source.action.nodeId,
      invocationId: source.action.invocationId,
      occurrence: source.attemptOrdinal,
      attemptId: source.action.attemptId,
      actionId: source.action.actionId,
      effectIds: source.effects.map((effect) => effect.effectId),
      loopPath: loop.hierarchicalPath,
      phase: `${loop.hierarchicalPath}/stage`,
      blockerFingerprint: 'sha256:' + '2'.repeat(64),
      reasonCode: 'dependency_unavailable',
      outcome: 'human-escalated',
      evidence,
      decisionIds: ['retry', 'escalate'],
    });
    if (humanWait.kind !== 'human-required') return;
    const waiting = apply(blocked.record, {
      kind: 'await-human-required',
      wait: humanWait,
    });
    const escalated = apply(waiting, {
      kind: 'decide-human',
      waitId: humanWait.waitId,
      decisionId: 'escalate',
      outcome: 'operator confirmed the dependency cannot be restored',
      evidence,
    });

    expect(escalated.transitions).toContainEqual(
      expect.objectContaining({
        kind: 'HumanDecisionCommitted',
        waitId: humanWait.waitId,
        actionId: source.action.actionId,
        decisionId: 'escalate',
        evidence: evidence.map((item) => item.evidenceDigest),
      })
    );
    expect(escalated).toMatchObject({
      status: 'escalated',
      waits: [],
      terminal: {
        kind: 'escalated',
        code: 'human-escalated',
        reason: 'operator confirmed the dependency cannot be restored',
      },
    });
  });

  it('keeps cancellation truthful while running, strategizing, or human-required', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const invocationPath = `${loop.hierarchicalPath}/round:1/stage`;
    const runningAction = agentAction(runtimePlan, invocationPath);
    const running = apply(startRecord(runtimePlan), {
      kind: 'admit-action',
      action: runningAction,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    const strategyAction = agentAction(
      runtimePlan,
      strategyInvocationPath(loop.hierarchicalPath, 1)
    );
    const strategizing = apply(startRecord(runtimePlan), {
      kind: 'admit-action',
      action: strategyAction,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    const blocked = blockInvocation(
      runtimePlan,
      startRecord(runtimePlan),
      invocationPath
    );
    const humanWait = createCanonicalWait(runtimePlan.runId, {
      kind: 'human-required',
      nodeId: blocked.action.action.nodeId,
      invocationId: blocked.action.action.invocationId,
      occurrence: blocked.action.attemptOrdinal,
      attemptId: blocked.action.action.attemptId,
      actionId: blocked.action.action.actionId,
      effectIds: blocked.action.effects.map((effect) => effect.effectId),
      loopPath: loop.hierarchicalPath,
      phase: `${loop.hierarchicalPath}/stage`,
      blockerFingerprint: 'sha256:' + '3'.repeat(64),
      reasonCode: 'dependency_unavailable',
      outcome: 'human-escalated',
      evidence: evidenceFor(runtimePlan, blocked.action.action.actionId),
      decisionIds: ['retry', 'escalate'],
    });
    if (humanWait.kind !== 'human-required') return;
    const humanRequired = apply(blocked.record, {
      kind: 'await-human-required',
      wait: humanWait,
    });

    for (const [state, record] of [
      ['running', running],
      ['strategizing', strategizing],
      ['human-required', humanRequired],
    ] as const) {
      const cancelled = apply(record, {
        kind: 'cancel',
        reason: `cancel from ${state}`,
      });
      expect(
        reduceBoundedLoopLifecycle(
          runtimePlan,
          loop,
          cancelled,
          snapshotFor(runtimePlan, loop)
        ).decision
      ).toEqual({ kind: 'cancelled' });
      expect(projectRunView(cancelled, 'active', runtimePlan)).toMatchObject({
        status: 'cancelled',
        sections: expect.arrayContaining([
          expect.objectContaining({
            kind: 'bounded-loop-lifecycle',
            state: 'terminal',
            outcome: {
              kind: 'cancelled',
              disposition: 'cancel',
            },
          }),
        ]),
      });
    }
  });

  it('keeps infrastructure waits out of domain blocker streaks and controls', () => {
    const runtimePlan = plan(8);
    const loop = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const invocationPath = `${loop.hierarchicalPath}/round:1/stage`;
    const action = agentAction(runtimePlan, invocationPath);
    let record = apply(startRecord(runtimePlan), {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    record = apply(record, {
      kind: 'observe-infrastructure',
      actionId: action.actionId,
      receiptDigest: fixtureDigests.receiptDigest,
      code: 'spawn_failed',
      retryable: true,
      artifactDigest: fixtureDigests.capabilityDigest,
      evidence: [],
    });
    const infrastructureWait = record.waits.find(
      (wait) => wait.kind === 'infrastructure'
    );
    expect(infrastructureWait).toBeDefined();
    const lifecycle = reduceBoundedLoopLifecycle(
      runtimePlan,
      loop,
      record,
      snapshotFor(runtimePlan, loop)
    );
    expect(lifecycle).toMatchObject({
      decision: { kind: 'waiting', waitId: infrastructureWait!.waitId },
      blockedStreak: 0,
    });
    expect(lifecycle).not.toHaveProperty('blockerFingerprint');

    const view = projectRunView(record, 'active', runtimePlan);
    const root = view.sections.find((section) => section.kind === 'root-dag');
    const lifecycleSection = view.sections.find(
      (section) => section.kind === 'bounded-loop-lifecycle'
    );
    expect(root?.allowedControls).toContainEqual({
      kind: 'resume',
      waitId: infrastructureWait!.waitId,
    });
    expect(lifecycleSection).toMatchObject({
      state: 'waiting',
      blockedStreak: 0,
      wait: {
        waitId: infrastructureWait!.waitId,
        kind: 'infrastructure',
      },
    });
  });
});

describe('lifecycle projector wait membership', () => {
  it('does not attach another loop wait merely because a strategy is active', () => {
    const runtimePlan = plan(8, true);
    const loopA = runtimePlan.nodes[0] as RuntimePlanBoundedLoopNode;
    const loopB = runtimePlan.nodes[1] as RuntimePlanBoundedLoopNode;
    const strategy = agentAction(
      runtimePlan,
      strategyInvocationPath(loopA.hierarchicalPath, 1)
    );
    let record = apply(startRecord(runtimePlan), {
      kind: 'admit-action',
      action: strategy,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    record = blockInvocation(
      runtimePlan,
      record,
      `${loopB.hierarchicalPath}/round:1/stage`
    ).record;

    const sections = projectRunView(record, 'active', runtimePlan)
      .sections as readonly Readonly<Record<string, unknown>>[];
    const sectionA = sections.find(
      (section) =>
        section.kind === 'bounded-loop-lifecycle' &&
        section.loopPath === loopA.hierarchicalPath
    );
    const sectionB = sections.find(
      (section) =>
        section.kind === 'bounded-loop-lifecycle' &&
        section.loopPath === loopB.hierarchicalPath
    );
    expect(sectionA).not.toHaveProperty('wait');
    expect(sectionA).toMatchObject({ state: 'strategizing' });
    expect(sectionB).toMatchObject({
      state: 'waiting',
      wait: { kind: 'domain-blocked' },
    });
  });
});
