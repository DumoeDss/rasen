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
  applyReviewCycleEvent,
  initialReviewCycleState,
  reduceReviewCycleEvents,
  ReviewCycleDomainError,
  type ReviewCycleEvent,
  type ReviewCyclePhase,
  type ReviewCycleState,
} from './review-cycle.js';
import type {
  RuntimePlan,
  RuntimePlanBoundedLoopNode,
  RuntimePlanReviewCyclePhase,
} from './runtime-plan.js';

export interface ReviewCycleInvocationDescriptor
  extends RuntimePlanReviewCyclePhase {
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly round: number;
  readonly hierarchicalPath: string;
  readonly nodeId: NodeId;
}

export type ReviewCycleProgress =
  | Readonly<{
      kind: 'ready';
      state: ReviewCycleState;
      next: ReviewCycleInvocationDescriptor;
    }>
  | Readonly<{
      kind: 'waiting';
      state: ReviewCycleState;
      next: ReviewCycleInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{
      kind: 'failed';
      state: ReviewCycleState;
      next: ReviewCycleInvocationDescriptor;
      action: CommittedAction;
    }>
  | Readonly<{
      kind: 'clean' | 'exhausted';
      state: ReviewCycleState;
    }>;

export function reviewCycleInvocationPath(
  loopPath: string,
  round: number,
  phase: ReviewCyclePhase
): string {
  return `${loopPath}/round:${round}/phase:${phase}`;
}

export function reviewCycleInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  round: number,
  phase: RuntimePlanReviewCyclePhase
): ReviewCycleInvocationDescriptor {
  const hierarchicalPath = reviewCycleInvocationPath(
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
  phase: ReviewCyclePhase,
  action: CommittedAction
): ReviewCycleEvent | null {
  if (action.result === undefined || action.result.status !== 'succeeded') {
    return null;
  }
  if (
    action.result.actor === undefined ||
    action.result.actorAttestation === undefined
  ) {
    throw new ReviewCycleDomainError(
      'malformed_review_cycle_result',
      `ReviewCycle round ${round} phase ${phase} is missing its committed actor or attestation.`
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
): readonly ReviewCycleEvent[] {
  if (loop.body.kind !== 'review-cycle') return Object.freeze([]);
  const events: ReviewCycleEvent[] = [];
  for (let round = 1; round <= loop.maxIterations; round += 1) {
    for (const phase of loop.body.phases) {
      const descriptor = reviewCycleInvocation(plan, loop, round, phase);
      const action = actionForNode(record, descriptor.nodeId);
      if (action === undefined) continue;
      const event = successfulEvent(round, phase.phase, action);
      if (event !== null) events.push(event);
    }
  }
  return Object.freeze(events);
}

function phaseFor(
  loop: RuntimePlanBoundedLoopNode,
  phase: ReviewCyclePhase
): RuntimePlanReviewCyclePhase {
  if (loop.body.kind !== 'review-cycle') {
    throw new ReviewCycleDomainError(
      'invalid_review_cycle_transition',
      `Expected review-cycle body but got ${loop.body.kind}.`
    );
  }
  const found = loop.body.phases.find((candidate) => candidate.phase === phase);
  if (found === undefined) {
    throw new ReviewCycleDomainError(
      'invalid_review_cycle_transition',
      `ReviewCycle plan is missing phase ${phase}.`
    );
  }
  return found;
}

export function projectReviewCycleProgress(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): ReviewCycleProgress {
  const events = eventsFromRecord(plan, loop, record);
  const state =
    events.length === 0
      ? initialReviewCycleState()
      : reduceReviewCycleEvents(events, loop.maxIterations);
  if (state.outcome === 'clean') {
    return Object.freeze({ kind: 'clean', state });
  }
  if (state.outcome === 'exhausted') {
    return Object.freeze({ kind: 'exhausted', state });
  }
  const next = reviewCycleInvocation(
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

export function locateReviewCycleInvocation(
  plan: RuntimePlan,
  nodeId: NodeId
): ReviewCycleInvocationDescriptor | null {
  for (const node of plan.nodes) {
    if (node.kind !== 'bounded-loop') continue;
    if (node.body.kind !== 'review-cycle') continue;
    for (let round = 1; round <= node.maxIterations; round += 1) {
      for (const phase of node.body.phases) {
        const descriptor = reviewCycleInvocation(plan, node, round, phase);
        if (descriptor.nodeId === nodeId) return descriptor;
      }
    }
  }
  return null;
}

/**
 * Validate one completion against the exact mechanically expected
 * ReviewCycle phase before the canonical reducer commits it. Non-ReviewCycle
 * actions are intentionally ignored.
 */
export function validateReviewCycleCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction
): void {
  const committed = record.actions[request.actionId];
  if (committed === undefined) return;
  const descriptor = locateReviewCycleInvocation(
    plan,
    committed.action.nodeId as NodeId
  );
  if (descriptor === null) return;
  if (request.kind !== 'domain-action-result') {
    throw new ReviewCycleDomainError(
      'malformed_review_cycle_result',
      'ReviewCycle phases accept only domain-action-result completions.'
    );
  }
  const progress = projectReviewCycleProgress(plan, descriptor.loop, record);
  if (
    (progress.kind !== 'waiting' && progress.kind !== 'ready') ||
    progress.next.nodeId !== descriptor.nodeId ||
    progress.next.round !== descriptor.round ||
    progress.next.phase !== descriptor.phase
  ) {
    throw new ReviewCycleDomainError(
      'invalid_review_cycle_transition',
      'Completion does not address the currently expected ReviewCycle phase.'
    );
  }
  if (request.status !== 'succeeded') {
    return;
  }
  applyReviewCycleEvent(
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
