import type {
  CompleteRunAction,
  JsonValue,
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
import {
  latestAttemptForDomainInvocation,
  strategyIterationLimitAllowance,
  strategyRecoveryInvocationPath,
  type LoopDomainSnapshot,
  type LoopProgressEntry,
} from './bounded-loop-lifecycle.js';

export interface ReviewCycleInvocationDescriptor
  extends RuntimePlanReviewCyclePhase {
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly round: number;
  readonly hierarchicalPath: string;
  readonly nodeId: NodeId;
  readonly recoveryAttempt?: number;
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

function actionForInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  descriptor: ReviewCycleInvocationDescriptor
): CommittedAction | undefined {
  return latestAttemptForDomainInvocation(
    plan,
    loop,
    record,
    deriveNodeId(
      plan.runId,
      reviewCycleInvocationPath(
        loop.hierarchicalPath,
        descriptor.round,
        descriptor.phase
      )
    ),
    reviewCycleInvocationPath(
      loop.hierarchicalPath,
      descriptor.round,
      descriptor.phase
    )
  );
}

function effectiveIterationLimit(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): number {
  return (
    loop.limits.maxIterations +
    strategyIterationLimitAllowance(plan, loop, record)
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
  const iterationLimit = effectiveIterationLimit(plan, loop, record);
  for (let round = 1; round <= iterationLimit; round += 1) {
    for (const phase of loop.body.phases) {
      const descriptor = reviewCycleInvocation(plan, loop, round, phase);
      const action = actionForInvocation(plan, loop, record, descriptor);
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
  const iterationLimit = effectiveIterationLimit(plan, loop, record);
  const state =
    events.length === 0
      ? initialReviewCycleState()
      : reduceReviewCycleEvents(events, iterationLimit);
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
  const action = actionForInvocation(plan, loop, record, next);
  if (action === undefined) {
    return Object.freeze({ kind: 'ready', state, next });
  }
  if (action.result?.status === 'failed') {
    return Object.freeze({ kind: 'failed', state, next, action });
  }
  return Object.freeze({ kind: 'waiting', state, next, action });
}

function reviewProgressMaterial(state: ReviewCycleState): JsonValue {
  return {
    unresolved: state.findings
      .filter(
        (finding) =>
          finding.status === 'open' &&
          (finding.severity === 'blocker' || finding.severity === 'major')
      )
      .map((finding) => ({
        id: finding.id,
        severity: finding.severity,
        status: finding.status,
      })),
    acceptedKnown: state.findings
      .filter((finding) => finding.status === 'accepted_known')
      .map((finding) => ({ id: finding.id, severity: finding.severity })),
  };
}

/** Domain adapter for the shared bounded-loop lifecycle reducer. */
export function projectReviewCycleDomainSnapshot(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): LoopDomainSnapshot {
  if (loop.body.kind !== 'review-cycle') {
    throw new ReviewCycleDomainError(
      'invalid_review_cycle_transition',
      'Review lifecycle snapshot requires a review-cycle body.'
    );
  }
  const events = eventsFromRecord(plan, loop, record);
  const iterationLimit = effectiveIterationLimit(plan, loop, record);
  let state = initialReviewCycleState();
  const progressHistory: LoopProgressEntry[] = [];
  for (const event of events) {
    state = applyReviewCycleEvent(state, event, iterationLimit);
    if (event.phase === 're-review' || state.outcome === 'clean') {
      progressHistory.push({
        iteration: event.round,
        material: reviewProgressMaterial(state),
      });
    }
  }
  const progress = projectReviewCycleProgress(plan, loop, record);
  const ownedNodeIds = new Set<NodeId>();
  const ownedInvocations: LoopDomainSnapshot['ownedInvocations'][number][] = [];
  for (let round = 1; round <= iterationLimit; round += 1) {
    for (const phase of loop.body.phases) {
      const invocation = reviewCycleInvocation(plan, loop, round, phase);
      ownedNodeIds.add(invocation.nodeId);
      ownedInvocations.push({
        nodeId: invocation.nodeId,
        hierarchicalPath: invocation.hierarchicalPath,
        profilePath: invocation.profilePath,
        admissionKind: invocation.admissionKind,
        access: invocation.workspace.access,
        iteration: invocation.round,
        phase: invocation.phase,
      });
    }
  }
  const next = 'next' in progress ? progress.next : undefined;
  return Object.freeze({
    bodyKind: 'review-cycle',
    iteration: state.round,
    phase: next?.phase ?? state.phase,
    ...(state.outcome === 'clean' ? { completionOutcome: loop.outcomes.clean } : {}),
    continueRequested:
      state.outcome === 'exhausted' ||
      (events.at(-1)?.phase === 're-review' && state.outcome !== 'clean'),
    progressHistory: Object.freeze(progressHistory),
    ...(next === undefined
      ? {}
      : {
          nextInvocation: {
            nodeId: next.nodeId,
            hierarchicalPath: next.hierarchicalPath,
            profilePath: next.profilePath,
            admissionKind: next.admissionKind,
            access: next.workspace.access,
            iteration: next.round,
            phase: next.phase,
          },
        }),
    ownedNodeIds,
    ownedInvocations: Object.freeze(ownedInvocations),
  });
}

export function locateReviewCycleInvocation(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  nodeId: NodeId
): ReviewCycleInvocationDescriptor | null {
  for (const node of plan.nodes) {
    if (node.kind !== 'bounded-loop') continue;
    if (node.body.kind !== 'review-cycle') continue;
    const iterationLimit = effectiveIterationLimit(plan, node, record);
    for (let round = 1; round <= iterationLimit; round += 1) {
      for (const phase of node.body.phases) {
        const descriptor = reviewCycleInvocation(plan, node, round, phase);
        if (descriptor.nodeId === nodeId) return descriptor;
        for (
          let attempt = 1;
          attempt <= node.lifecycle.strategy.maxAttempts;
          attempt += 1
        ) {
          const hierarchicalPath = strategyRecoveryInvocationPath(
            node.hierarchicalPath,
            attempt,
            descriptor.hierarchicalPath
          );
          const recoveryDescriptor = Object.freeze({
            ...descriptor,
            hierarchicalPath,
            nodeId: deriveNodeId(plan.runId, hierarchicalPath),
            recoveryAttempt: attempt,
          });
          if (recoveryDescriptor.nodeId === nodeId) {
            return recoveryDescriptor;
          }
        }
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
    record,
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
  const addressesExpectedInvocation =
    (progress.kind === 'ready' || progress.kind === 'waiting') &&
    progress.next.round === descriptor.round &&
    progress.next.phase === descriptor.phase &&
    (progress.kind === 'ready'
      ? progress.next.nodeId === descriptor.nodeId
      : progress.action.action.nodeId === descriptor.nodeId);
  if (!addressesExpectedInvocation) {
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
    effectiveIterationLimit(plan, descriptor.loop, record)
  );
}
