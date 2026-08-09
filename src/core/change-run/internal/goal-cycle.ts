import { z } from 'zod';

import {
  ChangeRunContractError,
  decodeEvidenceRef,
  type ActorRef,
  type EvidenceRef,
  type JsonValue,
} from '../contracts.js';
import { verifyActorRef } from './actors.js';

// ---------------------------------------------------------------------------
// Variant + phase types
// ---------------------------------------------------------------------------

export type GoalCycleVariant = 'measure' | 'evaluate' | 'research';
export type GoalCyclePhase = 'work' | 'judge';
export type GoalCycleOutcome = 'satisfied' | 'exhausted';

// ---------------------------------------------------------------------------
// Result contracts (D2)
// ---------------------------------------------------------------------------

/**
 * Work-phase result for measure/evaluate variants: the worker produced a
 * material code change with before/after tree hashes and a delta evidence ref.
 */
export interface GoalWorkResult {
  readonly contract: 'goal-cycle/work-result/1';
  readonly workDescription: string;
  readonly beforeTree: string;
  readonly afterTree: string;
  readonly delta: EvidenceRef;
}

/**
 * Work-phase result for the research variant: the worker refined a document.
 */
export interface ResearchWorkResult {
  readonly contract: 'goal-cycle/research-work/1';
  readonly documentPath: string;
  readonly beforeTree: string;
  readonly afterTree: string;
  readonly delta: EvidenceRef;
}

/** Judge result for the measure variant. */
export interface MeasureJudgeResult {
  readonly contract: 'goal-cycle/measure-judge/1';
  readonly score: number;
  readonly threshold: number;
  readonly direction: 'gte' | 'lte';
  readonly passed: boolean;
  readonly detail?: string;
}

/** Judge result for the evaluate variant. */
export interface EvaluateJudgeResult {
  readonly contract: 'goal-cycle/evaluate-judge/1';
  readonly satisfied: boolean;
  readonly gaps: readonly string[];
  readonly criteria: readonly {
    readonly id: string;
    readonly satisfied: boolean;
    readonly evidence: string;
  }[];
}

/** Judge result for the research variant. */
export interface ResearchJudgeResult {
  readonly contract: 'goal-cycle/research-judge/1';
  readonly satisfied: boolean;
  readonly gaps: readonly string[];
  readonly qualityAssessment: string;
}

export type GoalCycleDomainResult =
  | GoalWorkResult
  | ResearchWorkResult
  | MeasureJudgeResult
  | EvaluateJudgeResult
  | ResearchJudgeResult;

// ---------------------------------------------------------------------------
// Events and state
// ---------------------------------------------------------------------------

export interface GoalCycleEvent {
  readonly round: number;
  readonly phase: GoalCyclePhase;
  readonly actor: ActorRef;
  readonly result: JsonValue;
  readonly evidence: readonly EvidenceRef[];
}

export interface GoalCycleState {
  readonly round: number;
  readonly phase: GoalCyclePhase;
  readonly outcome?: GoalCycleOutcome;
  readonly variant: GoalCycleVariant;
  readonly lastScore?: number;
  readonly lastSatisfied?: boolean;
  readonly lastGaps: readonly string[];
  readonly eventCount: number;
  readonly lastActor?: ActorRef;
  readonly judgeActor?: ActorRef;
  readonly workerActor?: ActorRef;
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export type GoalCycleDomainErrorCode =
  | 'malformed_goal_cycle_result'
  | 'invalid_goal_cycle_transition'
  | 'goal_cycle_actor_separation'
  | 'goal_cycle_ship_guard';

export class GoalCycleDomainError extends Error {
  constructor(
    readonly code: GoalCycleDomainErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'GoalCycleDomainError';
  }
}

// ---------------------------------------------------------------------------
// Zod schemas (D2)
// ---------------------------------------------------------------------------

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const GoalWorkResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/work-result/1'),
  workDescription: z.string().min(1).max(16_384),
  beforeTree: z.string().regex(DIGEST),
  afterTree: z.string().regex(DIGEST),
  delta: z.unknown(),
});

const ResearchWorkResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/research-work/1'),
  documentPath: z.string().min(1).max(4096),
  beforeTree: z.string().regex(DIGEST),
  afterTree: z.string().regex(DIGEST),
  delta: z.unknown(),
});

const MeasureJudgeResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/measure-judge/1'),
  score: z.number().finite(),
  threshold: z.number().finite(),
  direction: z.enum(['gte', 'lte']),
  passed: z.boolean(),
  detail: z.string().min(1).max(16_384).optional(),
});

const EvaluateJudgeResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/evaluate-judge/1'),
  satisfied: z.boolean(),
  gaps: z.array(z.string().min(1).max(4096)).max(256),
  criteria: z
    .array(
      z.strictObject({
        id: z.string().regex(SAFE_ID),
        satisfied: z.boolean(),
        evidence: z.string().min(1).max(16_384),
      })
    )
    .min(1)
    .max(256),
});

const ResearchJudgeResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/research-judge/1'),
  satisfied: z.boolean(),
  gaps: z.array(z.string().min(1).max(4096)).max(256),
  qualityAssessment: z.string().min(1).max(16_384),
});

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function schemaIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? '/' : `/${issue.path.join('/')}`;
    return `${path}: ${issue.message}`;
  });
}

function malformed(message: string, issues: readonly string[] = []): never {
  throw new GoalCycleDomainError(
    'malformed_goal_cycle_result',
    message,
    issues
  );
}

function parseEvidence(value: unknown, label: string): EvidenceRef {
  try {
    return decodeEvidenceRef(value);
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      malformed(`${label} is not a valid EvidenceRef.`, error.issues);
    }
    throw error;
  }
}

function assertUniqueCriteriaIds(
  criteria: readonly { id: string }[]
): void {
  const seen = new Set<string>();
  for (const criterion of criteria) {
    if (seen.has(criterion.id)) {
      malformed(`Evaluate criteria must not contain duplicate id ${criterion.id}.`);
    }
    seen.add(criterion.id);
  }
}

function parseGoalWorkResult(value: JsonValue): GoalWorkResult {
  const parsed = GoalWorkResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed(
      'Work result does not match goal-cycle/work-result/1.',
      schemaIssues(parsed.error)
    );
  }
  if (parsed.data.beforeTree === parsed.data.afterTree) {
    malformed('A work result must bind a material tree change.');
  }
  return Object.freeze({
    contract: parsed.data.contract,
    workDescription: parsed.data.workDescription,
    beforeTree: parsed.data.beforeTree,
    afterTree: parsed.data.afterTree,
    delta: parseEvidence(parsed.data.delta, 'Work delta'),
  });
}

function parseResearchWorkResult(value: JsonValue): ResearchWorkResult {
  const parsed = ResearchWorkResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed(
      'Research work result does not match goal-cycle/research-work/1.',
      schemaIssues(parsed.error)
    );
  }
  if (parsed.data.beforeTree === parsed.data.afterTree) {
    malformed('A research work result must bind a material document change.');
  }
  return Object.freeze({
    contract: parsed.data.contract,
    documentPath: parsed.data.documentPath,
    beforeTree: parsed.data.beforeTree,
    afterTree: parsed.data.afterTree,
    delta: parseEvidence(parsed.data.delta, 'Research work delta'),
  });
}

function parseMeasureJudgeResult(value: JsonValue): MeasureJudgeResult {
  const parsed = MeasureJudgeResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed(
      'Judge result does not match goal-cycle/measure-judge/1.',
      schemaIssues(parsed.error)
    );
  }
  // Cross-validate that the passed flag matches the direction.
  const actualPassed =
    parsed.data.direction === 'gte'
      ? parsed.data.score >= parsed.data.threshold
      : parsed.data.score <= parsed.data.threshold;
  if (actualPassed !== parsed.data.passed) {
    malformed(
      `Measure judge passed=${parsed.data.passed} is inconsistent with score=${parsed.data.score} ${parsed.data.direction} ${parsed.data.threshold}.`
    );
  }
  return Object.freeze({
    contract: parsed.data.contract,
    score: parsed.data.score,
    threshold: parsed.data.threshold,
    direction: parsed.data.direction,
    passed: parsed.data.passed,
    ...(parsed.data.detail !== undefined
      ? { detail: parsed.data.detail }
      : {}),
  });
}

function parseEvaluateJudgeResult(value: JsonValue): EvaluateJudgeResult {
  const parsed = EvaluateJudgeResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed(
      'Judge result does not match goal-cycle/evaluate-judge/1.',
      schemaIssues(parsed.error)
    );
  }
  assertUniqueCriteriaIds(parsed.data.criteria);
  return Object.freeze({
    contract: parsed.data.contract,
    satisfied: parsed.data.satisfied,
    gaps: Object.freeze([...parsed.data.gaps]),
    criteria: Object.freeze(
      parsed.data.criteria.map((criterion) => Object.freeze(criterion))
    ),
  });
}

function parseResearchJudgeResult(value: JsonValue): ResearchJudgeResult {
  const parsed = ResearchJudgeResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed(
      'Judge result does not match goal-cycle/research-judge/1.',
      schemaIssues(parsed.error)
    );
  }
  return Object.freeze({
    contract: parsed.data.contract,
    satisfied: parsed.data.satisfied,
    gaps: Object.freeze([...parsed.data.gaps]),
    qualityAssessment: parsed.data.qualityAssessment,
  });
}

/**
 * Decode a goal-cycle result by dispatching on phase + variant.
 */
export function decodeGoalCycleResult(
  phase: GoalCyclePhase,
  variant: GoalCycleVariant,
  value: JsonValue,
  mode: 'strict' | 'task-loop' = 'strict'
): GoalCycleDomainResult {
  if (phase === 'work') {
    if (variant === 'research') {
      return parseResearchWorkResult(value);
    }
    return parseGoalWorkResult(value);
  }
  // judge phase
  switch (variant) {
    case 'measure':
      return parseMeasureJudgeResult(value);
    case 'evaluate':
      if (
        mode === 'task-loop' &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const taskResult = value as Readonly<Record<string, JsonValue>>;
        const criteria = Array.isArray(taskResult.criteria)
          ? taskResult.criteria.map((criterion) => {
              if (
                criterion === null ||
                typeof criterion !== 'object' ||
                Array.isArray(criterion)
              ) return criterion;
              const item = criterion as Readonly<Record<string, JsonValue>>;
              return {
                id: item.id,
                satisfied: item.satisfied,
                evidence: item.evidence,
              };
            })
          : taskResult.criteria;
        return parseEvaluateJudgeResult({
          contract: taskResult.contract,
          satisfied: taskResult.satisfied,
          gaps: taskResult.gaps,
          criteria,
        } as JsonValue);
      }
      return parseEvaluateJudgeResult(value);
    case 'research':
      return parseResearchJudgeResult(value);
  }
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

function stateFrom(
  round: number,
  phase: GoalCyclePhase,
  variant: GoalCycleVariant,
  eventCount: number,
  extras: Readonly<{
    outcome?: GoalCycleOutcome;
    lastScore?: number;
    lastSatisfied?: boolean;
    lastGaps?: readonly string[];
    lastActor?: ActorRef;
    judgeActor?: ActorRef;
    workerActor?: ActorRef;
  }> = {}
): GoalCycleState {
  return Object.freeze({
    round,
    phase,
    variant,
    ...(extras.outcome === undefined ? {} : { outcome: extras.outcome }),
    ...(extras.lastScore === undefined ? {} : { lastScore: extras.lastScore }),
    ...(extras.lastSatisfied === undefined
      ? {}
      : { lastSatisfied: extras.lastSatisfied }),
    ...(extras.lastGaps === undefined
      ? { lastGaps: Object.freeze([] as readonly string[]) }
      : { lastGaps: Object.freeze([...extras.lastGaps]) }),
    ...(extras.lastActor === undefined ? {} : { lastActor: extras.lastActor }),
    ...(extras.judgeActor === undefined ? {} : { judgeActor: extras.judgeActor }),
    ...(extras.workerActor === undefined ? {} : { workerActor: extras.workerActor }),
    eventCount,
  });
}

// ---------------------------------------------------------------------------
// Transition logic
// ---------------------------------------------------------------------------

function invalidTransition(message: string): never {
  throw new GoalCycleDomainError(
    'invalid_goal_cycle_transition',
    message
  );
}

function assertEventEnvelope(
  state: GoalCycleState,
  event: GoalCycleEvent
): void {
  if (!Number.isSafeInteger(event.round) || event.round < 1) {
    invalidTransition('GoalCycle event round must be a positive safe integer.');
  }
  if (state.outcome !== undefined) {
    invalidTransition('A terminal GoalCycle cannot accept another event.');
  }
  if (event.round !== state.round || event.phase !== state.phase) {
    invalidTransition(
      `Expected round ${state.round} phase ${state.phase}, received round ${event.round} phase ${event.phase}.`
    );
  }
  if (event.phase !== 'work' && event.phase !== 'judge') {
    malformed(`GoalCycle event phase must be 'work' or 'judge', got ${JSON.stringify(event.phase)}.`);
  }
  try {
    verifyActorRef(event.actor);
  } catch (error) {
    malformed(
      error instanceof Error ? error.message : 'GoalCycle actor is invalid.'
    );
  }
  for (const [index, evidence] of event.evidence.entries()) {
    parseEvidence(evidence, `Event evidence ${index}`);
  }
}

/**
 * The pure transition function. Mirrors applyReviewCycleEvent: reads only
 * state + event, produces a new frozen state. Goal semantics and actor
 * separation remain here; shared stall mechanics live in the loop lifecycle.
 */
export function applyGoalCycleEvent(
  state: GoalCycleState,
  event: GoalCycleEvent,
  maxIterations: number,
  mode: 'strict' | 'task-loop' = 'strict'
): GoalCycleState {
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new GoalCycleDomainError(
      'invalid_goal_cycle_transition',
      'GoalCycle maxIterations must be a positive safe integer.'
    );
  }
  assertEventEnvelope(state, event);
  const result = decodeGoalCycleResult(event.phase, state.variant, event.result, mode);
  const eventCount = state.eventCount + 1;

  if (event.phase === 'work') {
    // Work phase: accept the variant-appropriate work result, advance to judge.
    return stateFrom(state.round, 'judge', state.variant, eventCount, {
      lastScore: state.lastScore,
      lastSatisfied: state.lastSatisfied,
      lastGaps: state.lastGaps,
      workerActor: event.actor,
      lastActor: event.actor,
    });
  }

  // Judge phase
  // Actor separation: the judge MUST differ from the worker (by identityDigest).
  if (
    state.workerActor !== undefined &&
    state.workerActor.identityDigest === event.actor.identityDigest
  ) {
    throw new GoalCycleDomainError(
      'goal_cycle_actor_separation',
      'The worker cannot judge their own GoalCycle work.'
    );
  }

  if (state.variant === 'measure') {
    const judge = result as MeasureJudgeResult;
    if (judge.passed) {
      return stateFrom(state.round, 'judge', state.variant, eventCount, {
        outcome: 'satisfied',
        lastScore: judge.score,
        lastSatisfied: true,
        lastGaps: [],
        judgeActor: event.actor,
        lastActor: event.actor,
      });
    }
    if (state.round >= maxIterations) {
      return stateFrom(state.round, 'judge', state.variant, eventCount, {
        outcome: 'exhausted',
        lastScore: judge.score,
        lastSatisfied: false,
        lastGaps: [],
        judgeActor: event.actor,
        lastActor: event.actor,
      });
    }
    return stateFrom(state.round + 1, 'work', state.variant, eventCount, {
      lastScore: judge.score,
      lastSatisfied: false,
      lastGaps: [],
      judgeActor: event.actor,
      lastActor: event.actor,
      workerActor: state.workerActor,
    });
  }

  // evaluate or research variant
  const judge = result as EvaluateJudgeResult | ResearchJudgeResult;
  const satisfied =
    state.variant === 'evaluate'
      ? (judge as EvaluateJudgeResult).satisfied
      : (judge as ResearchJudgeResult).satisfied;
  const gaps =
    state.variant === 'evaluate'
      ? (judge as EvaluateJudgeResult).gaps
      : (judge as ResearchJudgeResult).gaps;

  if (satisfied) {
    return stateFrom(state.round, 'judge', state.variant, eventCount, {
      outcome: 'satisfied',
      lastSatisfied: true,
      lastGaps: gaps,
      judgeActor: event.actor,
      lastActor: event.actor,
    });
  }
  if (state.round >= maxIterations) {
    return stateFrom(state.round, 'judge', state.variant, eventCount, {
      outcome: 'exhausted',
      lastSatisfied: false,
      lastGaps: gaps,
      judgeActor: event.actor,
      lastActor: event.actor,
    });
  }
  return stateFrom(state.round + 1, 'work', state.variant, eventCount, {
    lastSatisfied: false,
    lastGaps: gaps,
    judgeActor: event.actor,
    lastActor: event.actor,
    workerActor: state.workerActor,
  });
}

export function initialGoalCycleState(
  variant: GoalCycleVariant
): GoalCycleState {
  return stateFrom(1, 'work', variant, 0, { lastGaps: [] });
}

export function reduceGoalCycleEvents(
  events: readonly GoalCycleEvent[],
  maxIterations: number,
  variant: GoalCycleVariant,
  mode: 'strict' | 'task-loop' = 'strict'
): GoalCycleState {
  return events.reduce(
    (state, event) => applyGoalCycleEvent(state, event, maxIterations, mode),
    initialGoalCycleState(variant)
  );
}

/**
 * Completion guard for goal-cycle bounded-loops. A Run that reaches a
 * completed terminal MUST have a satisfied outcome. An exhausted outcome
 * produces an escalated terminal, not a completed one.
 */
export function assertGoalCycleMayShip(state: GoalCycleState): void {
  if (state.outcome !== 'satisfied') {
    throw new GoalCycleDomainError(
      'goal_cycle_ship_guard',
      'GoalCycle may ship only after the goal is satisfied.'
    );
  }
}
