import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type {
  ActorRef,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  JsonValue,
  NodeId,
  RunAction,
  WorkspaceRevision,
} from '../contracts.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import { domainDigest } from './identity.js';
import {
  verifyEvidenceBinding,
  verifyEvidenceRefIdentity,
} from './evidence.js';
import { verifyActorRef } from './actors.js';
import {
  decodeGoalCycleResult,
  type GoalWorkResult,
} from './goal-cycle.js';
import {
  goalCycleInvocation,
  locateGoalCycleInvocation,
  projectGoalCycleProgress,
  type GoalCycleProgress,
} from './goal-cycle-runtime.js';
import type {
  RuntimePlan,
  RuntimePlanBoundedLoopNode,
} from './runtime-plan.js';
import {
  assertSafeRunPath,
  createNodeSafePathPlumbing,
  SafePathError,
} from './safe-path.js';

const SAFE_CRITERION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;

export const TASK_LOOP_WORK_EVIDENCE_SCHEMA = 'task-loop-work-delta/1';
export const TASK_LOOP_CRITERION_EVIDENCE_SCHEMA =
  'task-loop-criterion-evidence/1';
export const TASK_LOOP_ACTOR_ATTESTATION_SCHEMA =
  'task-loop-actor-attestation/1';

export type TaskLoopDomainErrorCode =
  | 'task_loop_input_missing'
  | 'task_loop_input_invalid'
  | 'task_loop_bar_unprovable'
  | 'task_loop_critic_reused'
  | 'task_loop_bar_mismatch'
  | 'task_loop_evidence_missing'
  | 'task_loop_worktree_mismatch'
  | 'task_loop_actor_invalid'
  | 'task_loop_pipeline_identity'
  | 'task_loop_report_unavailable'
  | 'task_loop_false_satisfaction'
  | 'task_loop_reconciler_required'
  | 'task_loop_delivery_guard';

export class TaskLoopDomainError extends Error {
  constructor(
    readonly code: TaskLoopDomainErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'TaskLoopDomainError';
  }
}

export interface TaskLoopCriterion {
  readonly id: string;
  readonly criterion: string;
  readonly evidenceHint: string;
}

export interface TaskLoopInput {
  readonly format: 'task-loop-input/1';
  readonly goal: string;
  readonly artifactTargets: readonly string[];
  readonly bar: readonly TaskLoopCriterion[];
  readonly constraints: readonly string[];
}

export interface DecodeTaskLoopInputOptions {
  readonly projectRoot?: string;
}

export interface TaskLoopJudgeResult {
  readonly contract: 'goal-cycle/evaluate-judge/1';
  readonly satisfied: boolean;
  readonly gaps: readonly string[];
  readonly criteria: readonly {
    readonly id: string;
    readonly satisfied: boolean;
    readonly evidence: string;
    readonly evidenceDigests: readonly Digest[];
  }[];
  readonly largestGap?: string;
  readonly passCondition?: string;
}

const TaskLoopInputSchema = z.strictObject({
  format: z.literal('task-loop-input/1'),
  goal: z.string().trim().min(1).max(16_384),
  artifactTargets: z.array(z.string().trim().min(1).max(4096)).max(64),
  bar: z
    .array(
      z.strictObject({
        id: z.string().regex(SAFE_CRITERION_ID),
        criterion: z.string().trim().min(1).max(4096),
        evidenceHint: z.string().trim().max(4096),
      })
    )
    .max(256),
  constraints: z.array(z.string().trim().min(1).max(4096)).max(64),
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function zodIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length === 0 ? '/' : `/${issue.path.join('/')}`;
    return `${at}: ${issue.message}`;
  });
}

function isOpaqueArtifactTarget(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^runtime:/i.test(target);
}

function validateLocalTarget(target: string, projectRoot: string): void {
  if (isOpaqueArtifactTarget(target)) return;
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, target);
  try {
    assertSafeRunPath(root, resolved, createNodeSafePathPlumbing());
  } catch (error) {
    throw new TaskLoopDomainError(
      'task_loop_input_invalid',
      `Task-loop artifact target is not physically authorized under the project root: ${target}.`,
      error instanceof SafePathError ? [error.code] : []
    );
  }
}

/** Decode, validate, and deeply freeze the canonical task-loop launch input. */
export function decodeTaskLoopInput(
  value: unknown,
  options: DecodeTaskLoopInputOptions
): TaskLoopInput {
  if (value === undefined || value === null) {
    throw new TaskLoopDomainError(
      'task_loop_input_missing',
      'Task-loop launch input is required before work can be admitted.'
    );
  }
  const parsed = TaskLoopInputSchema.safeParse(value);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error);
    throw new TaskLoopDomainError(
      'task_loop_input_invalid',
      issues.join('; '),
      issues
    );
  }
  if (parsed.data.artifactTargets.length === 0 || parsed.data.bar.length === 0) {
    throw new TaskLoopDomainError(
      'task_loop_bar_unprovable',
      'Task-loop requires at least one real artifact target and one quality criterion.'
    );
  }
  const criterionIds = new Set<string>();
  for (const criterion of parsed.data.bar) {
    if (criterionIds.has(criterion.id)) {
      throw new TaskLoopDomainError(
        'task_loop_input_invalid',
        `Task-loop criterion id ${criterion.id} is duplicated.`
      );
    }
    criterionIds.add(criterion.id);
    if (criterion.evidenceHint.length === 0) {
      throw new TaskLoopDomainError(
        'task_loop_bar_unprovable',
        `Task-loop criterion ${criterion.id} has no concrete evidence hint.`
      );
    }
  }
  if (options.projectRoot !== undefined) {
    for (const target of parsed.data.artifactTargets) {
      validateLocalTarget(target, options.projectRoot);
    }
  }
  return deepFreeze({
    format: parsed.data.format,
    goal: parsed.data.goal,
    artifactTargets: [...parsed.data.artifactTargets],
    bar: parsed.data.bar.map((criterion) => ({ ...criterion })),
    constraints: [...parsed.data.constraints],
  });
}

const TaskLoopJudgeResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/evaluate-judge/1'),
  satisfied: z.boolean(),
  gaps: z.array(z.string().trim().min(1).max(4096)).max(1),
  criteria: z
    .array(
      z.strictObject({
        id: z.string().regex(SAFE_CRITERION_ID),
        satisfied: z.boolean(),
        evidence: z.string().trim().min(1).max(16_384),
        evidenceDigests: z
          .array(z.string().regex(/^sha256:[0-9a-f]{64}$/))
          .min(1)
          .max(64),
      })
    )
    .max(256),
  largestGap: z.string().trim().min(1).max(4096).optional(),
  passCondition: z.string().trim().min(1).max(4096).optional(),
});

export interface ValidateTaskLoopJudgmentInput {
  readonly contract: TaskLoopInput;
  readonly result: unknown;
  readonly rawEvidence: readonly EvidenceRef[];
  readonly criticSessionIdentity: string;
  readonly priorCriticSessionIdentities: readonly string[];
  readonly evidenceContext?: Readonly<{
    record: CanonicalRunRecord;
    actionId: string;
    treeDigest: Digest;
  }>;
}

function verifyTaskLoopEvidenceRef(
  ref: EvidenceRef,
  context: NonNullable<ValidateTaskLoopJudgmentInput['evidenceContext']>,
  schema: string
): void {
  try {
    verifyEvidenceRefIdentity(ref);
    verifyEvidenceBinding(ref, {
      planningSpaceId: context.record.change.planningSpaceId,
      changeInstanceId: context.record.change.instanceId,
      projectId: context.record.change.projectId,
      changeId: context.record.change.changeId,
      runId: context.record.runId,
      actionId: context.actionId as EvidenceRef['binding']['actionId'],
      schema,
      treeDigest: context.treeDigest,
    });
  } catch (error) {
    throw new TaskLoopDomainError(
      'task_loop_evidence_missing',
      `Task-loop evidence is not bound to the expected Run, Action, schema, and workspace tree: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Apply task-specific checks around the generic evaluate-judge wire result. */
export function validateTaskLoopJudgment(
  input: ValidateTaskLoopJudgmentInput
): TaskLoopJudgeResult {
  if (
    input.priorCriticSessionIdentities.includes(
      input.criticSessionIdentity
    )
  ) {
    throw new TaskLoopDomainError(
      'task_loop_critic_reused',
      'Every task-loop round requires a critic identity not used by an earlier round.'
    );
  }
  const parsed = TaskLoopJudgeResultSchema.safeParse(input.result);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error);
    throw new TaskLoopDomainError(
      'task_loop_input_invalid',
      `Task-loop judgment is malformed: ${issues.join('; ')}`,
      issues
    );
  }
  const expected = input.contract.bar.map((criterion) => criterion.id);
  const actual = parsed.data.criteria.map((criterion) => criterion.id);
  if (
    new Set(actual).size !== actual.length ||
    expected.length !== actual.length ||
    expected.some((id) => !actual.includes(id))
  ) {
    throw new TaskLoopDomainError(
      'task_loop_bar_mismatch',
      'Task-loop judgment must cover every frozen criterion exactly once.'
    );
  }
  const evidenceByDigest = new Map<string, EvidenceRef>();
  for (const ref of input.rawEvidence) {
    try {
      verifyEvidenceRefIdentity(ref);
    } catch (error) {
      throw new TaskLoopDomainError(
        'task_loop_evidence_missing',
        `Task-loop evidence identity is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (evidenceByDigest.has(ref.evidenceDigest)) {
      throw new TaskLoopDomainError(
        'task_loop_evidence_missing',
        `Task-loop evidence digest ${ref.evidenceDigest} is duplicated.`
      );
    }
    evidenceByDigest.set(ref.evidenceDigest, ref);
    if (input.evidenceContext !== undefined) {
      verifyTaskLoopEvidenceRef(
        ref,
        input.evidenceContext,
        TASK_LOOP_CRITERION_EVIDENCE_SCHEMA
      );
    }
  }
  const mappedDigests = new Set<string>();
  for (const criterion of parsed.data.criteria) {
    if (
      !input.contract.artifactTargets.some((target) =>
        criterion.evidence.includes(target)
      )
    ) {
      throw new TaskLoopDomainError(
        'task_loop_evidence_missing',
        `Task-loop criterion ${criterion.id} does not identify a frozen artifact target.`
      );
    }
    for (const digest of criterion.evidenceDigests) {
      if (!evidenceByDigest.has(digest)) {
        throw new TaskLoopDomainError(
          'task_loop_evidence_missing',
          `Task-loop criterion ${criterion.id} refers to evidence ${digest} that is not committed by this judge Action.`
        );
      }
      mappedDigests.add(digest);
    }
  }
  if (
    input.rawEvidence.length === 0 ||
    mappedDigests.size !== evidenceByDigest.size
  ) {
    throw new TaskLoopDomainError(
      'task_loop_evidence_missing',
      'Every committed judge evidence ref must map explicitly to at least one frozen criterion.'
    );
  }
  const allCriteriaSatisfied = parsed.data.criteria.every(
    (criterion) => criterion.satisfied
  );
  if (parsed.data.satisfied) {
    if (
      !allCriteriaSatisfied ||
      parsed.data.gaps.length !== 0 ||
      parsed.data.largestGap !== undefined ||
      parsed.data.passCondition !== undefined
    ) {
      throw new TaskLoopDomainError(
        'task_loop_false_satisfaction',
        'Task-loop satisfaction requires every criterion true and zero remaining gaps.'
      );
    }
  } else if (
    allCriteriaSatisfied ||
    parsed.data.gaps.length !== 1 ||
    parsed.data.largestGap !== parsed.data.gaps[0] ||
    parsed.data.passCondition === undefined
  ) {
    throw new TaskLoopDomainError(
      'task_loop_false_satisfaction',
      'An unsatisfied task-loop judgment requires one largest gap and one explicit pass condition.'
    );
  }
  return deepFreeze({
    ...parsed.data,
    gaps: [...parsed.data.gaps],
    criteria: parsed.data.criteria.map((criterion) => ({
      ...criterion,
      evidenceDigests: criterion.evidenceDigests.map(
        (digest) => digest as Digest
      ),
    })),
  });
}

export function isTaskLoopRun(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): boolean {
  if (plan.pipeline !== 'task-loop' || record.pipeline !== 'task-loop') {
    return false;
  }
  assertTaskLoopPlanIdentity(plan);
  return true;
}

/** Reserve the canonical bounded-loop -> ship -> archive semantic DAG. */
export function assertTaskLoopPlanIdentity(plan: RuntimePlan): void {
  if (plan.pipeline !== 'task-loop') return;
  const loops = plan.nodes.filter(
    (node): node is RuntimePlanBoundedLoopNode => node.kind === 'bounded-loop'
  );
  const atomics = plan.nodes.filter((node) => node.kind === 'atomic');
  const loop = loops[0];
  const ship = loop === undefined
    ? undefined
    : atomics.find(
        (node) =>
          node.requires.length === 1 && node.requires[0] === loop.nodeId
      );
  const archive = ship === undefined
    ? undefined
    : atomics.find(
        (node) =>
          node !== ship &&
          node.requires.length === 1 &&
          node.requires[0] === ship.nodeId
      );
  const phases = loop?.body.kind === 'goal-cycle' ? loop.body.phases : [];
  const pathIs = (actual: string | undefined, stage: string) =>
    actual === `root/${stage}` || actual === `root:stage:${stage}`;
  const profileIs = (
    actual: string | undefined,
    phase: 'work' | 'judge'
  ) =>
    actual === `declaration:task-loop/node:${phase}` ||
    actual === `declaration:goal-cycle-body:iterate/node:iterate:${phase}`;
  const valid =
    plan.nodes.length === 3 &&
    loops.length === 1 &&
    atomics.length === 2 &&
    loop !== undefined &&
    pathIs(loop.hierarchicalPath, 'iterate') &&
    loop.requires.length === 0 &&
    loop.body.kind === 'goal-cycle' &&
    loop.body.variant === 'evaluate' &&
    (loop.outcomes.clean === 'clean' || loop.outcomes.clean === 'satisfied') &&
    (loop.outcomes.exhausted === 'goal_cycle_exhausted' ||
      loop.outcomes.exhausted === 'task_loop_exhausted') &&
    phases.length === 2 &&
    phases[0]?.phase === 'work' &&
    profileIs(phases[0].profilePath, 'work') &&
    phases[0].admissionKind === 'agent' &&
    phases[0].workspace.access === 'write' &&
    phases[1]?.phase === 'judge' &&
    profileIs(phases[1].profilePath, 'judge') &&
    phases[1].admissionKind === 'agent' &&
    phases[1].workspace.access === 'read' &&
    ship !== undefined &&
    pathIs(ship.hierarchicalPath, 'ship') &&
    ship.admissionKind === 'agent' &&
    ship.workspace.access === 'write' &&
    ship.gate === undefined &&
    archive !== undefined &&
    pathIs(archive.hierarchicalPath, 'archive') &&
    archive.admissionKind === 'agent' &&
    archive.workspace.access === 'write' &&
    archive.gate === undefined &&
    plan.finishNode === undefined &&
    plan.implicitFinishOutcome === 'task-loop-completed';
  if (!valid) {
    throw new TaskLoopDomainError(
      'task_loop_pipeline_identity',
      'Task Loop requires the exact built-in evaluate-loop -> ship -> archive semantic DAG.'
    );
  }
}

function taskLoopContract(record: CanonicalRunRecord): TaskLoopInput {
  return decodeTaskLoopInput(record.inputs.taskLoop, {});
}

function actionForTaskLoopPhase(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  round: number,
  phase: 'work' | 'judge'
): CommittedAction | undefined {
  if (loop.body.kind !== 'goal-cycle') return undefined;
  const phasePlan = loop.body.phases.find((item) => item.phase === phase);
  if (phasePlan === undefined) return undefined;
  const nodeId = goalCycleInvocation(plan, loop, round, phasePlan).nodeId;
  return Object.values(record.actions).find(
    (committed) => committed.action.nodeId === nodeId
  );
}

function priorCriticSessions(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  excludeActionId?: string
): readonly string[] {
  return Object.values(record.actions)
    .filter((committed) => {
      const descriptor = locateGoalCycleInvocation(
        plan,
        committed.action.nodeId as NodeId
      );
      return (
        descriptor?.phase === 'judge' &&
        committed.action.actionId !== excludeActionId &&
        committed.result?.status === 'succeeded' &&
        committed.result.actor !== undefined
      );
    })
    .flatMap((committed) => {
      const actor = committed.result!.actor!;
      return actor.kind === 'agent' ? [actor.sessionIdentityDigest] : [];
    });
}

function latestAcceptedJudgment(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): TaskLoopJudgeResult | undefined {
  let latest: { round: number; result: TaskLoopJudgeResult } | undefined;
  for (const committed of Object.values(record.actions)) {
    const descriptor = locateGoalCycleInvocation(
      plan,
      committed.action.nodeId as NodeId
    );
    if (
      descriptor?.phase !== 'judge' ||
      committed.result?.status !== 'succeeded'
    ) {
      continue;
    }
    const parsed = TaskLoopJudgeResultSchema.safeParse(committed.result.result);
    if (parsed.success && (latest === undefined || descriptor.round > latest.round)) {
      latest = {
        round: descriptor.round,
        result: deepFreeze({
          ...parsed.data,
          gaps: [...parsed.data.gaps],
          criteria: parsed.data.criteria.map((criterion) => ({
            ...criterion,
            evidenceDigests: criterion.evidenceDigests.map(
              (digest) => digest as Digest
            ),
          })),
        }),
      };
    }
  }
  return latest?.result;
}

/** Build the phase input without leaking builder narrative into critic context. */
export function taskLoopActionInput(input: {
  readonly plan: RuntimePlan;
  readonly record: CanonicalRunRecord;
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly round: number;
  readonly phase: 'work' | 'judge';
}): Readonly<{ taskLoop: JsonValue }> {
  const contract = taskLoopContract(input.record);
  const base: Record<string, JsonValue> = {
    contract: contract as unknown as JsonValue,
    contractDigest: taskLoopContractDigest(contract),
    round: input.round,
    phase: input.phase,
  };
  if (input.phase === 'work') {
    const prior = latestAcceptedJudgment(input.plan, input.record);
    if (prior?.largestGap !== undefined && prior.passCondition !== undefined) {
      base.feedback = {
        largestGap: prior.largestGap,
        passCondition: prior.passCondition,
      };
    }
  } else {
    const work = actionForTaskLoopPhase(
      input.plan,
      input.loop,
      input.record,
      input.round,
      'work'
    );
    base.artifactTargets = [...contract.artifactTargets];
    base.rawEvidence = (work?.result?.evidence ?? []) as unknown as JsonValue;
    const workResult = work?.result?.result;
    if (
      workResult !== null &&
      typeof workResult === 'object' &&
      !Array.isArray(workResult) &&
      typeof (workResult as { afterTree?: unknown }).afterTree === 'string'
    ) {
      base.afterTree = (workResult as { afterTree: string }).afterTree;
    }
  }
  return deepFreeze({ taskLoop: base as JsonValue });
}

function assertAgentMatchesAction(
  actor: ActorRef | undefined,
  action: RunAction,
  expectedRole: 'implementer' | 'reviewer'
): asserts actor is Extract<ActorRef, { kind: 'agent' }> {
  if (
    actor === undefined ||
    actor.kind !== 'agent' ||
    action.kind !== 'agent' ||
    action.agent.role !== expectedRole ||
    actor.role !== action.agent.role ||
    actor.runtime !== action.agent.runtime
  ) {
    throw new TaskLoopDomainError(
      'task_loop_actor_invalid',
      `Task-loop ${expectedRole} completion must come from the admitted agent role and runtime.`
    );
  }
  try {
    verifyActorRef(actor);
  } catch (error) {
    throw new TaskLoopDomainError(
      'task_loop_actor_invalid',
      `Task-loop actor identity is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function verifyActorAttestation(
  record: CanonicalRunRecord,
  committed: CommittedAction,
  treeDigest: Digest
): void {
  const attestation = committed.result?.actorAttestation;
  if (attestation === undefined) {
    throw new TaskLoopDomainError(
      'task_loop_actor_invalid',
      'Task-loop agent completion is missing its actor attestation.'
    );
  }
  verifyTaskLoopEvidenceRef(
    attestation,
    {
      record,
      actionId: committed.action.actionId,
      treeDigest,
    },
    TASK_LOOP_ACTOR_ATTESTATION_SCHEMA
  );
}

function parseCommittedWork(committed: CommittedAction): GoalWorkResult {
  if (committed.result?.status !== 'succeeded') {
    throw new TaskLoopDomainError(
      'task_loop_delivery_guard',
      'Task-loop work must be successfully committed.'
    );
  }
  return decodeGoalCycleResult(
    'work',
    'evaluate',
    committed.result.result
  ) as GoalWorkResult;
}

function validateCommittedWork(
  record: CanonicalRunRecord,
  committed: CommittedAction,
  expectedBeforeTree: Digest,
  expectedAfterTree?: Digest
): GoalWorkResult {
  const work = parseCommittedWork(committed);
  assertAgentMatchesAction(
    committed.result?.actor,
    committed.action,
    'implementer'
  );
  if (
    committed.action.expectedBeforeWorkspace.treeDigest !== expectedBeforeTree ||
    work.beforeTree !== expectedBeforeTree ||
    (expectedAfterTree !== undefined && work.afterTree !== expectedAfterTree)
  ) {
    throw new TaskLoopDomainError(
      'task_loop_worktree_mismatch',
      'Task-loop work before/after trees do not match the admitted and observed workspace chain.'
    );
  }
  const delta = committed.result!.evidence.find(
    (ref) => ref.evidenceDigest === work.delta.evidenceDigest
  );
  if (delta === undefined) {
    throw new TaskLoopDomainError(
      'task_loop_evidence_missing',
      'Task-loop work delta is not one of the Action evidence refs.'
    );
  }
  verifyTaskLoopEvidenceRef(
    delta,
    {
      record,
      actionId: committed.action.actionId,
      treeDigest: work.afterTree as Digest,
    },
    TASK_LOOP_WORK_EVIDENCE_SCHEMA
  );
  verifyActorAttestation(record, committed, work.afterTree as Digest);
  return work;
}

function validateCommittedJudge(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  committed: CommittedAction,
  work: CommittedAction,
  roundTree: Digest
): TaskLoopJudgeResult {
  const critic = committed.result?.actor;
  const builder = work.result?.actor;
  assertAgentMatchesAction(critic, committed.action, 'reviewer');
  assertAgentMatchesAction(builder, work.action, 'implementer');
  if (critic.sessionIdentityDigest === builder.sessionIdentityDigest) {
    throw new TaskLoopDomainError(
      'task_loop_critic_reused',
      'The task-loop critic must use a session distinct from the current builder.'
    );
  }
  verifyActorAttestation(record, committed, roundTree);
  return validateTaskLoopJudgment({
    contract: taskLoopContract(record),
    result: committed.result!.result,
    rawEvidence: committed.result!.evidence,
    criticSessionIdentity: critic.sessionIdentityDigest,
    priorCriticSessionIdentities: priorCriticSessions(
      plan,
      record,
      committed.action.actionId
    ),
    evidenceContext: {
      record,
      actionId: committed.action.actionId,
      treeDigest: roundTree,
    },
  });
}

function expectedBeforeTreeForRound(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  round: number
): Digest {
  if (round === 1) return record.initialWorkspaceRevision.treeDigest as Digest;
  const prior = actionForTaskLoopPhase(
    plan,
    loop,
    record,
    round - 1,
    'work'
  );
  if (prior === undefined) {
    throw new TaskLoopDomainError(
      'task_loop_worktree_mismatch',
      'Task-loop workspace chain is missing the prior builder round.'
    );
  }
  return parseCommittedWork(prior).afterTree as Digest;
}

/** Validate a task-loop completion after generic GoalCycle envelope checks. */
export function validateTaskLoopCompletion(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  request: CompleteRunAction,
  observedWorkspace: WorkspaceRevision
): void {
  if (!isTaskLoopRun(plan, record) || request.kind !== 'domain-action-result') {
    return;
  }
  const committed = record.actions[request.actionId];
  if (committed === undefined) return;
  const descriptor = locateGoalCycleInvocation(
    plan,
    committed.action.nodeId as NodeId
  );
  if (descriptor === null || request.status !== 'succeeded') {
    return;
  }
  const expectedBefore = expectedBeforeTreeForRound(
    plan,
    descriptor.loop,
    record,
    descriptor.round
  );
  if (descriptor.phase === 'work') {
    const staged = {
      ...committed,
      result: {
        status: request.status,
        receiptDigest: request.receiptDigest,
        result: request.result,
        evidence: request.evidence,
        actor: request.actor,
        actorAttestation: request.actorAttestation,
      },
    } as unknown as CommittedAction;
    validateCommittedWork(
      record,
      staged,
      expectedBefore,
      observedWorkspace.treeDigest as Digest
    );
    return;
  }
  const work = actionForTaskLoopPhase(
    plan,
    descriptor.loop,
    record,
    descriptor.round,
    'work'
  );
  if (work === undefined) {
    throw new TaskLoopDomainError(
      'task_loop_worktree_mismatch',
      'Task-loop judge has no committed builder round.'
    );
  }
  const workResult = validateCommittedWork(
    record,
    work,
    expectedBefore,
    observedWorkspace.treeDigest as Digest
  );
  const staged = {
    ...committed,
    result: {
      status: request.status,
      receiptDigest: request.receiptDigest,
      result: request.result,
      evidence: request.evidence,
      actor: request.actor,
      actorAttestation: request.actorAttestation,
    },
  } as unknown as CommittedAction;
  validateCommittedJudge(
    plan,
    record,
    staged,
    work,
    workResult.afterTree as Digest
  );
}

export function assertTaskLoopMayDeliver(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  observedWorkspace?: WorkspaceRevision
): void {
  if (!isTaskLoopRun(plan, record)) return;
  const loop = plan.nodes.find(
    (node): node is RuntimePlanBoundedLoopNode =>
      node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
  );
  const progress = loop === undefined
    ? undefined
    : projectGoalCycleProgress(plan, loop, record);
  if (
    loop === undefined ||
    progress?.kind !== 'satisfied' ||
    record.terminal?.kind === 'cancelled' ||
    record.terminal?.kind === 'failed' ||
    record.terminal?.kind === 'escalated'
  ) {
    throw new TaskLoopDomainError(
      'task_loop_delivery_guard',
      'Task-loop delivery requires one mechanically valid satisfied outcome.'
    );
  }

  if (observedWorkspace === undefined) {
    throw new TaskLoopDomainError(
      'task_loop_delivery_guard',
      'Task-loop delivery requires a current trusted workspace observation.'
    );
  }
  let expectedBefore = record.initialWorkspaceRevision.treeDigest as Digest;
  let finalAfter: Digest | undefined;
  for (let round = 1; round <= progress.state.round; round += 1) {
    const work = actionForTaskLoopPhase(plan, loop, record, round, 'work');
    const judge = actionForTaskLoopPhase(plan, loop, record, round, 'judge');
    if (work === undefined || judge === undefined) {
      throw new TaskLoopDomainError(
        'task_loop_delivery_guard',
        'Task-loop delivery history is missing a builder or critic phase.'
      );
    }
    const workResult = validateCommittedWork(
      record,
      work,
      expectedBefore
    );
    validateCommittedJudge(
      plan,
      record,
      judge,
      work,
      workResult.afterTree as Digest
    );
    expectedBefore = workResult.afterTree as Digest;
    finalAfter = workResult.afterTree as Digest;
  }
  if (finalAfter !== (observedWorkspace.treeDigest as Digest)) {
    throw new TaskLoopDomainError(
      'task_loop_worktree_mismatch',
      'The current workspace no longer matches the final evidenced builder tree.'
    );
  }
}

export function projectTaskLoopSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  loop: RuntimePlanBoundedLoopNode,
  progress: GoalCycleProgress
): Readonly<Record<string, unknown>> {
  const contract = taskLoopContract(record);
  const judgment = latestAcceptedJudgment(plan, record);
  const actors = Array.from({ length: progress.state.round }, (_, index) => {
    const round = index + 1;
    const builder = actionForTaskLoopPhase(plan, loop, record, round, 'work')
      ?.result?.actor?.identityDigest;
    const critic = actionForTaskLoopPhase(plan, loop, record, round, 'judge')
      ?.result?.actor?.identityDigest;
    return {
      round,
      ...(builder === undefined ? {} : { builder }),
      ...(critic === undefined ? {} : { critic }),
    };
  }).filter((entry) => entry.builder !== undefined || entry.critic !== undefined);
  const phase = 'next' in progress ? progress.next.phase : progress.state.phase;
  const round = 'next' in progress ? progress.next.round : progress.state.round;
  const terminalOutcome = record.terminal?.kind === 'completed'
    ? record.terminal.outcome
    : record.terminal?.kind === 'escalated' || record.terminal?.kind === 'failed'
      ? record.terminal.code
      : record.terminal?.kind;
  const nextAction = record.terminal !== undefined
    ? 'none'
    : progress.kind === 'satisfied'
      ? 'ship'
      : progress.kind === 'exhausted' || progress.kind === 'failed'
        ? 'none'
        : phase === 'work'
          ? 'build'
          : 'critic';
  return deepFreeze({
    kind: 'task-loop',
    version: 1,
    contractDigest: taskLoopContractDigest(contract),
    contract,
    round,
    phase,
    budget: {
      used: progress.state.eventCount,
      max: loop.maxIterations * 2,
      remainingRounds: Math.max(0, loop.maxIterations - round + 1),
    },
    actors,
    criteria: judgment?.criteria ?? [],
    rawEvidence: Object.values(record.actions)
      .filter((entry) => entry.result !== undefined)
      .flatMap((entry) => entry.result!.evidence)
      .sort((left, right) =>
        left.evidenceDigest < right.evidenceDigest
          ? -1
          : left.evidenceDigest > right.evidenceDigest
            ? 1
            : left.binding.actionId < right.binding.actionId
              ? -1
              : left.binding.actionId > right.binding.actionId
                ? 1
                : 0
      ),
    ...(judgment?.largestGap === undefined
      ? {}
      : { largestGap: judgment.largestGap }),
    ...(judgment?.passCondition === undefined
      ? {}
      : { passCondition: judgment.passCondition }),
    stallStreak: progress.state.stallStreak,
    outcome: terminalOutcome ?? progress.state.outcome,
    nextAction,
    ...(record.inputs.gatePolicy === undefined
      ? {}
      : { gatePolicy: record.inputs.gatePolicy }),
  });
}

/** Write a digest-stamped, read-only projection from committed Record truth. */
export function writeTaskLoopReport(
  evidenceDir: string,
  plan: RuntimePlan,
  record: CanonicalRunRecord
): string | undefined {
  if (!isTaskLoopRun(plan, record)) return undefined;
  const loop = plan.nodes.find(
    (node): node is RuntimePlanBoundedLoopNode =>
      node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
  );
  if (loop === undefined) return undefined;
  const progress = projectGoalCycleProgress(plan, loop, record);
  const section = projectTaskLoopSection(plan, record, loop, progress);
  const reportPath = path.join(evidenceDir, 'task-loop-report.md');
  const contract = section.contract as TaskLoopInput;
  const criteria = section.criteria as TaskLoopJudgeResult['criteria'];
  const rawEvidence = section.rawEvidence as readonly EvidenceRef[];
  const lines = [
    '# Task Loop Report',
    '',
    `Contract digest: ${String(section.contractDigest)}`,
    `Outcome: ${String(section.outcome ?? 'in-progress')}`,
    `Round: ${String(section.round)}`,
    '',
    `Goal: ${contract.goal}`,
    '',
    ...(section.largestGap === undefined
      ? []
      : [`Largest gap: ${String(section.largestGap)}`]),
    ...(section.passCondition === undefined
      ? []
      : [`Pass condition: ${String(section.passCondition)}`]),
    ...(section.largestGap === undefined && section.passCondition === undefined
      ? []
      : ['']),
    '## Criteria',
    '',
    ...criteria.map(
      (criterion) =>
        `- [${criterion.satisfied ? 'x' : ' '}] ${criterion.id}: ${criterion.evidence} (evidence: ${criterion.evidenceDigests.join(', ')})`
    ),
    '',
    '## Raw evidence',
    '',
    ...rawEvidence.map(
      (ref) =>
        `- ${ref.evidenceDigest} | content ${ref.contentDigest} | action ${ref.binding.actionId} | tree ${ref.binding.treeDigest ?? 'none'}`
    ),
    '',
  ];
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return reportPath;
}

export function taskLoopContractDigest(contract: TaskLoopInput): Digest {
  return domainDigest('task-loop-input/1', contract);
}

export function readTaskLoopInput(
  inputs: Readonly<Record<string, JsonValue>>,
  options: DecodeTaskLoopInputOptions
): TaskLoopInput {
  return decodeTaskLoopInput(inputs.taskLoop, options);
}
