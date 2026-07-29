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
  type GoalCycleDomainResult,
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

// ---------------------------------------------------------------------------
// goal-run.json compatibility projection (D10)
// ---------------------------------------------------------------------------

/**
 * Per-round record entry for the legacy goal-run.json format. This is a
 * compatibility projection — the authoritative spine is the canonical Record.
 */
export interface GoalRunRoundRecord {
  readonly round: number;
  readonly score?: number;
  readonly measurePassed?: boolean;
  readonly evaluateSatisfied?: boolean;
  readonly detail?: string;
  readonly gaps?: readonly string[];
  readonly gitTreeFingerprint?: string;
}

/**
 * Derive the legacy per-round record array from committed goal-cycle events.
 * This is a READ-ONLY projection — it cannot back-drive a new Run.
 * Reconciler-engine Runs reconstruct state entirely from plan + Record.
 */
export function projectGoalRunJson(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): readonly GoalRunRoundRecord[] {
  // Find the goal-cycle bounded-loop in the plan.
  const loop = plan.nodes.find(
    (node): node is RuntimePlanBoundedLoopNode =>
      node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
  );
  if (loop === undefined) return Object.freeze([]);

  // Iterate rounds, collecting work+judge results.
  const rounds: GoalRunRoundRecord[] = [];
  for (let round = 1; round <= loop.maxIterations; round += 1) {
    const roundRecord = projectGoalRunRound(plan, loop, record, round);
    if (roundRecord !== null) rounds.push(roundRecord);
  }
  return Object.freeze(rounds);
}

function projectGoalRunRound(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  round: number
): GoalRunRoundRecord | null {
  if (loop.body.kind !== 'goal-cycle') return null;
  let hasWork = false;
  let hasJudge = false;
  let score: number | undefined;
  let measurePassed: boolean | undefined;
  let evaluateSatisfied: boolean | undefined;
  let detail: string | undefined;
  let gaps: string[] | undefined;
  let gitTreeFingerprint: string | undefined;

  for (const phase of loop.body.phases) {
    const descriptor = goalCycleInvocation(plan, loop, round, phase);
    const action = actionForNode(record, descriptor.nodeId);
    if (action === undefined || action.result === undefined) continue;
    if (action.result.status !== 'succeeded') continue;

    if (phase.phase === 'work') {
      hasWork = true;
      // Extract tree fingerprint from the work result if present.
      const result = action.result.result as Readonly<Record<string, unknown>>;
      if (typeof result.afterTree === 'string') {
        gitTreeFingerprint = result.afterTree;
      }
    } else if (phase.phase === 'judge') {
      hasJudge = true;
      const result = action.result.result as Readonly<Record<string, unknown>>;
      if (typeof result.score === 'number') score = result.score;
      if (typeof result.passed === 'boolean') measurePassed = result.passed;
      if (typeof result.satisfied === 'boolean') evaluateSatisfied = result.satisfied;
      if (typeof result.detail === 'string') detail = result.detail;
      if (Array.isArray(result.gaps)) {
        gaps = (result.gaps as unknown[]).filter(
          (g): g is string => typeof g === 'string'
        );
      }
    }
  }

  if (!hasWork && !hasJudge) return null;

  return Object.freeze({
    round,
    ...(score !== undefined ? { score } : {}),
    ...(measurePassed !== undefined ? { measurePassed } : {}),
    ...(evaluateSatisfied !== undefined ? { evaluateSatisfied } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(gaps !== undefined ? { gaps: Object.freeze(gaps) } : {}),
    ...(gitTreeFingerprint !== undefined ? { gitTreeFingerprint } : {}),
  });
}
