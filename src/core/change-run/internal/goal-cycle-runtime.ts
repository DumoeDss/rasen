import type {
  CompleteRunAction,
  NodeId,
} from '../contracts.js';
import { deriveNodeId } from './identity.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from './record.js';
import {
  applyGoalCycleEvent,
  initialGoalCycleState,
  reduceGoalCycleEvents,
  GoalCycleDomainError,
  type GoalCycleEvent,
  type GoalCyclePhase,
  type GoalCycleState,
  type GoalCycleVariant,
} from './goal-cycle.js';
import type {
  RuntimePlan,
  RuntimePlanBoundedLoopNode,
  RuntimePlanGoalCyclePhase,
} from './runtime-plan.js';

// ---------------------------------------------------------------------------
// Invocation descriptor + progress type
// ---------------------------------------------------------------------------

export interface GoalCycleInvocationDescriptor
  extends RuntimePlanGoalCyclePhase {
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly round: number;
  readonly hierarchicalPath: string;
  readonly nodeId: NodeId;
}

export type GoalCycleProgress =
  | Readonly<{
      kind: 'ready';
      state: GoalCycleState;
      next: GoalCycleInvocationDescriptor;
    }>
  | Readonly<{
      kind: 'waiting';
      state: GoalCycleState;
      next: GoalCycleInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{
      kind: 'failed';
      state: GoalCycleState;
      next: GoalCycleInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{
      kind: 'satisfied' | 'exhausted';
      state: GoalCycleState;
    }>;

// ---------------------------------------------------------------------------
// Path derivation (mirrors reviewCycleInvocationPath)
// ---------------------------------------------------------------------------

export function goalCycleInvocationPath(
  loopPath: string,
  round: number,
  phase: GoalCyclePhase
): string {
  return `${loopPath}/round:${round}/phase:${phase}`;
}

export function goalCycleInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  round: number,
  phase: RuntimePlanGoalCyclePhase
): GoalCycleInvocationDescriptor {
  const hierarchicalPath = goalCycleInvocationPath(
    loop.hierarchicalPath,
    round,
    phase.phase
  );
  return Object.freeze({
    ...phase,
    loop,
    round,
    hierarchicalPath,
    nodeId: deriveNodeId(plan.runId, hierarchicalPath),
  });
}

// ---------------------------------------------------------------------------
// Record → events extraction (mirrors eventsFromRecord)
// ---------------------------------------------------------------------------

function actionForNode(
  record: CanonicalRunRecord,
  nodeId: NodeId
): CommittedAction | undefined {
  return Object.values(record.actions).find(
    (action) => action.action.nodeId === nodeId
  );
}

function successfulEvent(
  round: number,
  phase: GoalCyclePhase,
  action: CommittedAction
): GoalCycleEvent | null {
  if (action.result === undefined || action.result.status !== 'succeeded') {
    return null;
  }
  if (
    action.result.actor === undefined ||
    action.result.actorAttestation === undefined
  ) {
    throw new GoalCycleDomainError(
      'malformed_goal_cycle_result',
      `GoalCycle round ${round} phase ${phase} is missing its committed actor or attestation.`
    );
  }
  return Object.freeze({
    round,
    phase,
    actor: action.result.actor,
    result: action.result.result,
    evidence: action.result.evidence,
  });
}

function eventsFromRecord(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): readonly GoalCycleEvent[] {
  if (loop.body.kind !== 'goal-cycle') return Object.freeze([]);
  const events: GoalCycleEvent[] = [];
  for (let round = 1; round <= loop.maxIterations; round += 1) {
    for (const phase of loop.body.phases) {
      const descriptor = goalCycleInvocation(plan, loop, round, phase);
      const action = actionForNode(record, descriptor.nodeId);
      if (action === undefined) continue;
      const event = successfulEvent(round, phase.phase, action);
      if (event !== null) events.push(event);
    }
  }
  return Object.freeze(events);
}

// ---------------------------------------------------------------------------
// Progress projection (mirrors projectReviewCycleProgress)
// ---------------------------------------------------------------------------

function phaseFor(
  loop: RuntimePlanBoundedLoopNode,
  phase: GoalCyclePhase
): RuntimePlanGoalCyclePhase {
  if (loop.body.kind !== 'goal-cycle') {
    throw new GoalCycleDomainError(
      'invalid_goal_cycle_transition',
      `Expected goal-cycle body but got ${loop.body.kind}.`
    );
  }
  const found = loop.body.phases.find((candidate) => candidate.phase === phase);
  if (found === undefined) {
    throw new GoalCycleDomainError(
      'invalid_goal_cycle_transition',
      `GoalCycle plan is missing phase ${phase}.`
    );
  }
  return found;
}

function loopVariant(
  loop: RuntimePlanBoundedLoopNode
): GoalCycleVariant {
  if (loop.body.kind !== 'goal-cycle') {
    throw new GoalCycleDomainError(
      'invalid_goal_cycle_transition',
      `Expected goal-cycle body but got ${loop.body.kind}.`
    );
  }
  return loop.body.variant;
}

export function projectGoalCycleProgress(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): GoalCycleProgress {
  const variant = loopVariant(loop);
  const events = eventsFromRecord(plan, loop, record);
  const state =
    events.length === 0
      ? initialGoalCycleState(variant)
      : reduceGoalCycleEvents(events, loop.maxIterations, variant);
  if (state.outcome === 'satisfied') {
    return Object.freeze({ kind: 'satisfied', state });
  }
  if (state.outcome === 'exhausted') {
    return Object.freeze({ kind: 'exhausted', state });
  }
  const next = goalCycleInvocation(
    plan,
    loop,
    state.round,
    phaseFor(loop, state.phase)
  );
  const action = actionForNode(record, next.nodeId);
  if (action === undefined) {
    return Object.freeze({ kind: 'ready', state, next });
  }
  if (action.result?.status === 'failed') {
    return Object.freeze({ kind: 'failed', state, next, action });
  }
  return Object.freeze({ kind: 'waiting', state, next, action });
}

// ---------------------------------------------------------------------------
// Locate (mirrors locateReviewCycleInvocation)
// ---------------------------------------------------------------------------

export function locateGoalCycleInvocation(
  plan: RuntimePlan,
  nodeId: NodeId
): GoalCycleInvocationDescriptor | null {
  for (const node of plan.nodes) {
    if (node.kind !== 'bounded-loop') continue;
    if (node.body.kind !== 'goal-cycle') continue;
    for (let round = 1; round <= node.maxIterations; round += 1) {
      for (const phase of node.body.phases) {
        const descriptor = goalCycleInvocation(plan, node, round, phase);
        if (descriptor.nodeId === nodeId) return descriptor;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pre-commit validation (mirrors validateReviewCycleCompletion)
// ---------------------------------------------------------------------------

/**
 * Validate one completion against the exact mechanically expected GoalCycle
 * phase before the canonical reducer commits it. Non-GoalCycle actions are
 * intentionally ignored.
 */
export function validateGoalCycleCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction
): void {
  const committed = record.actions[request.actionId];
  if (committed === undefined) return;
  const descriptor = locateGoalCycleInvocation(
    plan,
    committed.action.nodeId as NodeId
  );
  if (descriptor === null) return;
  if (request.kind !== 'domain-action-result') {
    throw new GoalCycleDomainError(
      'malformed_goal_cycle_result',
      'GoalCycle phases accept only domain-action-result completions.'
    );
  }
  const progress = projectGoalCycleProgress(plan, descriptor.loop, record);
  if (
    (progress.kind !== 'waiting' && progress.kind !== 'ready') ||
    progress.next.nodeId !== descriptor.nodeId ||
    progress.next.round !== descriptor.round ||
    progress.next.phase !== descriptor.phase
  ) {
    throw new GoalCycleDomainError(
      'invalid_goal_cycle_transition',
      'Completion does not address the currently expected GoalCycle phase.'
    );
  }
  if (request.status !== 'succeeded') {
    return;
  }
  applyGoalCycleEvent(
    progress.state,
    {
      round: descriptor.round,
      phase: descriptor.phase,
      actor: request.actor,
      result: request.result,
      evidence: request.evidence,
    },
    descriptor.loop.maxIterations
  );
}
