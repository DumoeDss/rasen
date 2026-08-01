import { z } from 'zod';

import type {
  JsonValue,
  NodeId,
  WaitId,
} from '../contracts.js';
import type {
  BoundedLoopLifecyclePolicyV1,
  LoopLifecycleBlockedExit,
  LoopLifecycleExit,
  LoopLifecycleTerminalExit,
} from '../../pipeline-registry/definition.js';
import { deriveNodeId } from './identity.js';
import { domainDigest } from './identity.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import type { RuntimePlan, RuntimePlanBoundedLoopNode } from './runtime-plan.js';
import { createCanonicalWait } from './waits.js';

export type LoopBodyKind = 'review-cycle' | 'goal-cycle' | 'composite';

export interface LoopDomainInvocation {
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly profilePath: string;
  readonly admissionKind: 'agent' | 'command' | 'host';
  readonly access: 'none' | 'read' | 'write';
  readonly iteration: number;
  readonly phase: string;
  readonly recoveryAttempt?: number;
}

export interface LoopProgressEntry {
  readonly iteration: number;
  readonly material: JsonValue;
}

/**
 * Closed adapter boundary between a domain reducer and the shared mechanical
 * lifecycle. ReviewCycle and GoalLoop remain owners of their own result
 * contracts; only stable domain facts cross this boundary.
 */
export interface LoopDomainSnapshot {
  readonly bodyKind: LoopBodyKind;
  readonly iteration: number;
  readonly phase: string;
  readonly completionOutcome?: string;
  readonly continueRequested: boolean;
  readonly progressHistory: readonly LoopProgressEntry[];
  readonly nextInvocation?: LoopDomainInvocation;
  readonly ownedNodeIds: ReadonlySet<NodeId>;
  readonly ownedInvocations: readonly LoopDomainInvocation[];
}

export type LoopLifecycleReason =
  | 'domain-complete'
  | 'iteration-limit'
  | 'action-limit'
  | 'budget-limit'
  | 'stalled'
  | 'blocked'
  | 'strategy-exhausted'
  | 'action-failed';

export type LoopLifecycleDecision =
  | Readonly<{ kind: 'ready'; invocation: LoopDomainInvocation }>
  | Readonly<{ kind: 'waiting'; waitId?: WaitId }>
  | Readonly<{
      kind: 'strategy-ready';
      attempt: number;
      trigger: Exclude<LoopLifecycleReason, 'domain-complete' | 'action-failed'>;
      invocation: LoopDomainInvocation;
      sourceBlockedWait?: Readonly<{
        waitId: WaitId;
        actionId: string;
      }>;
    }>
  | Readonly<{
      kind: 'human-required';
      outcome: string;
      action: CommittedAction;
      blocker: BoundedLoopBlockedResult;
      blockerFingerprint: string;
      blockedStreak: number;
    }>
  | Readonly<{
      kind: 'completed';
      outcome: string;
      reason: 'domain-complete' | Exclude<LoopLifecycleReason, 'domain-complete' | 'action-failed'>;
      disposition: 'domain' | 'exit';
    }>
  | Readonly<{
      kind: 'escalated';
      outcome: string;
      reason: Exclude<LoopLifecycleReason, 'domain-complete'>;
    }>
  | Readonly<{
      kind: 'failed';
      outcome: string;
      reason: Exclude<LoopLifecycleReason, 'domain-complete'>;
    }>
  | Readonly<{ kind: 'cancelled' }>;

export interface LoopLifecycleSnapshot {
  readonly decision: LoopLifecycleDecision;
  readonly progressFingerprint?: string;
  readonly stallStreak: number;
  readonly blockerFingerprint?: string;
  readonly blockedStreak: number;
  readonly actionsUsed: number;
  readonly budgetUsed: number;
  readonly strategyAttempts: number;
}

const BlockedResultSchema = z.strictObject({
  contract: z.literal('bounded-loop/blocked/1'),
  reasonCode: z.string().min(1).max(256),
  blockerKey: z.string().min(1).max(1024),
  detail: z.string().min(1).max(16_384).optional(),
});

export type BoundedLoopBlockedResult = Readonly<
  z.infer<typeof BlockedResultSchema>
>;

const StrategyResultSchema = z.strictObject({
  contract: z.literal('bounded-loop/strategy-result/1'),
  strategyKey: z.string().min(1).max(1024),
  rationale: z.string().min(1).max(16_384),
  intendedChangeSurface: z.array(z.string().min(1).max(2048)).min(1).max(256),
  evidence: z.array(z.unknown()).max(64),
});

export type BoundedLoopStrategyResult = Readonly<{
  contract: 'bounded-loop/strategy-result/1';
  strategyKey: string;
  rationale: string;
  intendedChangeSurface: readonly string[];
  evidence: readonly unknown[];
}>;

export function decodeBoundedLoopBlockedResult(value: unknown): BoundedLoopBlockedResult {
  const parsed = BlockedResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Blocked bounded-loop results must match bounded-loop/blocked/1: ${parsed.error.issues
        .map((issue) => `/${issue.path.join('/')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return Object.freeze(parsed.data);
}

export function decodeBoundedLoopStrategyResult(value: unknown): BoundedLoopStrategyResult {
  const parsed = StrategyResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Strategy results must match bounded-loop/strategy-result/1: ${parsed.error.issues
        .map((issue) => `/${issue.path.join('/')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return Object.freeze({
    ...parsed.data,
    intendedChangeSurface: Object.freeze([...parsed.data.intendedChangeSurface]),
    evidence: Object.freeze([...parsed.data.evidence]),
  });
}

/** Stable shared selector: latest attempt ordinal, then ActionId tie-breaker. */
export function selectLatestAttempt(
  actions: readonly CommittedAction[]
): CommittedAction | undefined {
  return [...actions].sort((left, right) =>
    left.attemptOrdinal - right.attemptOrdinal ||
    (left.action.actionId < right.action.actionId
      ? -1
      : left.action.actionId > right.action.actionId
        ? 1
        : 0)
  ).at(-1);
}

function actionAdmissionOrdinal(
  record: CanonicalRunRecord,
  action: CommittedAction
): number {
  return (
    record.transitions.find(
      (transition) =>
        transition.kind === 'ActionAdmitted' &&
        transition.actionId === action.action.actionId
    )?.transitionOrdinal ?? -1
  );
}

/**
 * Record-aware latest selection. A fresh domain retry uses a new invocation
 * occurrence, so its per-invocation attemptOrdinal starts at zero again. The
 * canonical ActionAdmitted transition is the stable chronology across those
 * occurrences; ordinal and ActionId remain deterministic tie-breakers.
 */
export function selectLatestCommittedAttempt(
  record: CanonicalRunRecord,
  actions: readonly CommittedAction[]
): CommittedAction | undefined {
  return [...actions]
    .sort((left, right) =>
      actionAdmissionOrdinal(record, left) -
        actionAdmissionOrdinal(record, right) ||
      left.attemptOrdinal - right.attemptOrdinal ||
      (left.action.actionId < right.action.actionId
        ? -1
        : left.action.actionId > right.action.actionId
          ? 1
          : 0)
    )
    .at(-1);
}

export function latestAttemptForNode(
  record: CanonicalRunRecord,
  nodeId: NodeId
): CommittedAction | undefined {
  return selectLatestCommittedAttempt(
    record,
    Object.values(record.actions).filter(
      (action) => action.action.nodeId === nodeId
    )
  );
}

/**
 * Return every committed attempt for one logical domain invocation. Recovery
 * paths are alternative executions of that invocation, not separate domain
 * progress. Keeping the alternatives together lets adapters select the true
 * latest attempt while preserving distinct canonical node identities.
 */
export function attemptsForDomainInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  nodeId: NodeId,
  hierarchicalPath: string
): readonly CommittedAction[] {
  const nodeIds = new Set<NodeId>([nodeId]);
  for (
    let attempt = 1;
    attempt <= loop.lifecycle.strategy.maxAttempts;
    attempt += 1
  ) {
    nodeIds.add(
      deriveNodeId(
        plan.runId,
        strategyRecoveryInvocationPath(
          loop.hierarchicalPath,
          attempt,
          hierarchicalPath
        )
      )
    );
  }
  return Object.freeze(
    Object.values(record.actions)
      .filter((action) => nodeIds.has(action.action.nodeId as NodeId))
      .sort((left, right) =>
        actionAdmissionOrdinal(record, left) -
          actionAdmissionOrdinal(record, right) ||
        left.attemptOrdinal - right.attemptOrdinal ||
        (left.action.actionId < right.action.actionId
          ? -1
          : left.action.actionId > right.action.actionId
            ? 1
            : 0)
      )
  );
}

export function latestAttemptForDomainInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  nodeId: NodeId,
  hierarchicalPath: string
): CommittedAction | undefined {
  return selectLatestCommittedAttempt(
    record,
    attemptsForDomainInvocation(
      plan,
      loop,
      record,
      nodeId,
      hierarchicalPath
    )
  );
}

export function progressFingerprint(material: JsonValue): string {
  return domainDigest('bounded-loop-progress/1', material);
}

export function blockerFingerprint(
  loopPath: string,
  phase: string,
  blocked: BoundedLoopBlockedResult
): string {
  return domainDigest('bounded-loop-blocker/1', {
    loopPath,
    phase,
    reasonCode: blocked.reasonCode,
    blockerKey: blocked.blockerKey,
  });
}

export function reconstructProgress(
  history: readonly LoopProgressEntry[]
): Readonly<{ fingerprint?: string; stallStreak: number }> {
  const byIteration = new Map<number, string>();
  for (const entry of history) {
    const fingerprint = progressFingerprint(entry.material);
    const previous = byIteration.get(entry.iteration);
    if (previous === undefined || fingerprint > previous) {
      byIteration.set(entry.iteration, fingerprint);
    }
  }
  let previous: string | undefined;
  let stallStreak = 0;
  for (const [, current] of [...byIteration].sort(
    ([left], [right]) => left - right
  )) {
    if (previous === undefined) {
      stallStreak = 0;
    } else if (current === previous) {
      stallStreak += 1;
    } else {
      stallStreak = 0;
    }
    previous = current;
  }
  return {
    ...(previous === undefined ? {} : { fingerprint: previous }),
    stallStreak,
  };
}

function blockedAttemptsForInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  invocation: LoopDomainInvocation
): readonly Readonly<{
  action: CommittedAction;
  blocked: BoundedLoopBlockedResult;
}>[] {
  return attemptsForDomainInvocation(
    plan,
    loop,
    record,
    invocation.nodeId,
    invocation.hierarchicalPath
  )
    .filter(
      (action) => action.result?.status === 'blocked'
    )
    .map((action) => ({
      action,
      blocked: decodeBoundedLoopBlockedResult(action.result!.result),
    }))
    .sort((left, right) =>
      actionAdmissionOrdinal(record, left.action) -
        actionAdmissionOrdinal(record, right.action) ||
      left.action.attemptOrdinal - right.action.attemptOrdinal ||
      (left.action.action.actionId < right.action.action.actionId
        ? -1
        : left.action.action.actionId > right.action.action.actionId
          ? 1
          : 0)
    );
}

function reconstructBlocker(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  loop: RuntimePlanBoundedLoopNode,
  snapshot: LoopDomainSnapshot
): Readonly<{
  action?: CommittedAction;
  blocked?: BoundedLoopBlockedResult;
  fingerprint?: string;
  streak: number;
}> {
  if (snapshot.nextInvocation === undefined) return { streak: 0 };
  const latest = latestAttemptForDomainInvocation(
    plan,
    loop,
    record,
    snapshot.nextInvocation.nodeId,
    snapshot.nextInvocation.hierarchicalPath
  );
  if (latest?.result?.status === 'succeeded') return { streak: 0 };
  let fingerprint: string | undefined;
  let streak = 0;
  let latestBlocked:
    | Readonly<{ action: CommittedAction; blocked: BoundedLoopBlockedResult }>
    | undefined;
  for (const entry of blockedAttemptsForInvocation(
    plan,
    loop,
    record,
    snapshot.nextInvocation
  )) {
    const current = blockerFingerprint(
      loop.hierarchicalPath,
      snapshot.nextInvocation.phase,
      entry.blocked
    );
    streak = current === fingerprint ? streak + 1 : 1;
    fingerprint = current;
    latestBlocked = entry;
  }
  return {
    ...(latestBlocked === undefined
      ? {}
      : { action: latestBlocked.action, blocked: latestBlocked.blocked }),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    streak,
  };
}

export function strategyInvocationPath(loopPath: string, attempt: number): string {
  return `${loopPath}/strategy:${attempt}/plan`;
}

export function strategyRecoveryInvocationPath(
  loopPath: string,
  attempt: number,
  domainPath: string
): string {
  const relative = domainPath.startsWith(`${loopPath}/`)
    ? domainPath.slice(loopPath.length + 1)
    : domainPath.replace(/^root:/, '');
  return `${loopPath}/strategy:${attempt}/recovery/${relative}`;
}

export function strategyActionsForLoop(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): readonly CommittedAction[] {
  const nodeIds = new Set<NodeId>();
  for (let attempt = 1; attempt <= loop.lifecycle.strategy.maxAttempts; attempt += 1) {
    nodeIds.add(deriveNodeId(plan.runId, strategyInvocationPath(loop.hierarchicalPath, attempt)));
  }
  return Object.values(record.actions)
    .filter((action) => nodeIds.has(action.action.nodeId as NodeId))
    .sort((left, right) =>
      actionAdmissionOrdinal(record, left) -
        actionAdmissionOrdinal(record, right) ||
      left.attemptOrdinal - right.attemptOrdinal ||
      (left.action.actionId < right.action.actionId ? -1 : 1)
    );
}

export function strategyTriggerForAction(
  action: CommittedAction
): string | undefined {
  if (action.action.kind !== 'agent') return undefined;
  const input = action.action.agent.input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const strategy = (input as Readonly<Record<string, JsonValue>>)
    .boundedLoopStrategy;
  if (
    strategy === null ||
    typeof strategy !== 'object' ||
    Array.isArray(strategy)
  ) {
    return undefined;
  }
  const trigger = (strategy as Readonly<Record<string, JsonValue>>).trigger;
  return typeof trigger === 'string' ? trigger : undefined;
}

export function strategyIterationLimitAllowance(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): number {
  return strategyActionsForLoop(plan, loop, record).filter(
    (action) =>
      action.result?.status === 'succeeded' &&
      strategyTriggerForAction(action) === 'iteration-limit'
  ).length;
}

function waitIdForAction(
  record: CanonicalRunRecord,
  action: CommittedAction | undefined
): WaitId | undefined {
  if (action === undefined) return undefined;
  return record.waits.find(
    (wait) =>
      'actionId' in wait && wait.actionId === action.action.actionId
  )?.waitId as WaitId | undefined;
}

function actionWasAdmittedAfter(
  record: CanonicalRunRecord,
  nodeId: NodeId,
  transitionOrdinal: number
): boolean {
  return record.transitions.some((transition) => {
    if (
      transition.transitionOrdinal <= transitionOrdinal ||
      transition.kind !== 'ActionAdmitted'
    ) {
      return false;
    }
    return record.actions[transition.actionId]?.action.nodeId === nodeId;
  });
}

/**
 * A retry/resume boundary is durable intent, not a writable retry flag. It is
 * pending exactly until the next ActionAdmitted transition for the same loop
 * phase. This lets replay derive one fresh attempt and consume it atomically
 * with admission.
 */
function hasPendingFreshAttempt(
  record: CanonicalRunRecord,
  action: CommittedAction
): boolean {
  const humanRetry = [...record.transitions]
    .reverse()
    .find(
      (transition) =>
        transition.kind === 'HumanDecisionCommitted' &&
        transition.actionId === action.action.actionId
    );
  if (
    humanRetry?.kind === 'HumanDecisionCommitted' &&
    humanRetry.decisionId === 'retry' &&
    !actionWasAdmittedAfter(
      record,
      action.action.nodeId as NodeId,
      humanRetry.transitionOrdinal
    )
  ) {
    return true;
  }

  const blockedWait = createCanonicalWait(record.runId, {
    kind: 'domain-blocked',
    nodeId: action.action.nodeId,
    invocationId: action.action.invocationId,
    occurrence: 0,
    attemptId: action.action.attemptId,
    actionId: action.action.actionId,
    effectIds: action.action.effects.map((effect) => effect.effectId),
    reasonCode:
      action.result?.result !== null &&
      typeof action.result?.result === 'object' &&
      !Array.isArray(action.result.result) &&
      typeof (action.result.result as Readonly<Record<string, JsonValue>>)
        .reasonCode === 'string'
        ? ((action.result.result as Readonly<Record<string, JsonValue>>)
            .reasonCode as string)
        : 'domain_blocked',
    evidence: [...(action.result?.evidence ?? [])],
  });
  const resumed = [...record.transitions]
    .reverse()
    .find(
      (transition) =>
        transition.kind === 'RunResumed' &&
        transition.waitId === blockedWait.waitId
    );
  return (
    resumed?.kind === 'RunResumed' &&
    !actionWasAdmittedAfter(
      record,
      action.action.nodeId as NodeId,
      resumed.transitionOrdinal
    )
  );
}

function recoveryInvocation(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  invocation: LoopDomainInvocation,
  attempt: number
): LoopDomainInvocation {
  const hierarchicalPath = strategyRecoveryInvocationPath(
    loop.hierarchicalPath,
    attempt,
    invocation.hierarchicalPath
  );
  return {
    ...invocation,
    nodeId: deriveNodeId(plan.runId, hierarchicalPath),
    hierarchicalPath,
    recoveryAttempt: attempt,
  };
}

function recoveryActionsForAttempt(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  snapshot: LoopDomainSnapshot,
  attempt: number
): readonly Readonly<{
  invocation: LoopDomainInvocation;
  action: CommittedAction;
}>[] {
  const actions: Array<{
    invocation: LoopDomainInvocation;
    action: CommittedAction;
  }> = [];
  for (const invocation of snapshot.ownedInvocations) {
    const recovery = recoveryInvocation(plan, loop, invocation, attempt);
    const action = latestAttemptForNode(record, recovery.nodeId);
    if (action !== undefined) actions.push({ invocation, action });
  }
  return actions;
}

function pendingStrategyRecovery(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  snapshot: LoopDomainSnapshot
): LoopLifecycleDecision | undefined {
  const strategies = strategyActionsForLoop(plan, loop, record);
  const latest = strategies.at(-1);
  if (latest?.result?.status !== 'succeeded') return undefined;
  const attempt = strategies.filter(
    (action) => action.result?.status === 'succeeded'
  ).length;
  const existing = recoveryActionsForAttempt(
    plan,
    loop,
    record,
    snapshot,
    attempt
  );
  const targetIteration = existing.at(0)?.invocation.iteration;
  if (
    snapshot.nextInvocation === undefined ||
    (targetIteration !== undefined &&
      snapshot.nextInvocation.iteration !== targetIteration)
  ) {
    return undefined;
  }
  const invocation = recoveryInvocation(
    plan,
    loop,
    snapshot.nextInvocation,
    attempt
  );
  const action = latestAttemptForNode(record, invocation.nodeId);
  if (action?.state === 'active') return { kind: 'waiting' };
  if (action?.result?.status === 'failed') {
    return {
      kind: 'failed',
      outcome: 'bounded_loop_strategy_recovery_failed',
      reason: 'action-failed',
    };
  }
  if (action?.result?.status === 'blocked') {
    if (hasPendingFreshAttempt(record, action)) {
      return { kind: 'ready', invocation };
    }
    return {
      kind: 'waiting',
      ...(waitIdForAction(record, action) === undefined
        ? {}
        : { waitId: waitIdForAction(record, action) }),
    };
  }
  if (action?.result?.status === 'succeeded') {
    return {
      kind: 'failed',
      outcome: 'invalid_strategy_recovery_projection',
      reason: 'action-failed',
    };
  }
  return { kind: 'ready', invocation };
}

function terminalDecision(
  reason: Exclude<LoopLifecycleReason, 'domain-complete' | 'action-failed'>,
  disposition: LoopLifecycleTerminalExit
): LoopLifecycleDecision {
  switch (disposition.action) {
    case 'exit':
      return {
        kind: 'completed',
        outcome: disposition.outcome,
        reason,
        disposition: 'exit',
      };
    case 'escalate':
      return { kind: 'escalated', outcome: disposition.outcome, reason };
    case 'fail':
      return { kind: 'failed', outcome: disposition.outcome, reason };
  }
}

function applyDisposition(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  snapshot: LoopDomainSnapshot,
  reason: Exclude<LoopLifecycleReason, 'domain-complete' | 'action-failed'>,
  disposition: LoopLifecycleExit | LoopLifecycleBlockedExit,
  blocker: ReturnType<typeof reconstructBlocker>
): LoopLifecycleDecision {
  if (disposition.action === 'human-required') {
    if (blocker.action === undefined || blocker.blocked === undefined || blocker.fingerprint === undefined) {
      return {
        kind: 'failed',
        outcome: 'invalid_human_required_state',
        reason: 'blocked',
      };
    }
    return {
      kind: 'human-required',
      outcome: disposition.outcome,
      action: blocker.action,
      blocker: blocker.blocked,
      blockerFingerprint: blocker.fingerprint,
      blockedStreak: blocker.streak,
    };
  }
  if (disposition.action !== 'strategy') {
    return terminalDecision(reason, disposition);
  }
  const attempts = strategyActionsForLoop(plan, loop, record);
  const latest = attempts.at(-1);
  if (latest?.state === 'active' || latest?.state === 'blocked') {
    return { kind: 'waiting', ...(waitIdForAction(record, latest) ? { waitId: waitIdForAction(record, latest) } : {}) };
  }
  const completedAttempts = attempts.filter(
    (action) => action.result?.status === 'succeeded'
  ).length;
  if (completedAttempts >= loop.lifecycle.strategy.maxAttempts) {
    return terminalDecision('strategy-exhausted', loop.lifecycle.exits.strategyExhausted);
  }
  const attempt = completedAttempts + 1;
  const hierarchicalPath = strategyInvocationPath(loop.hierarchicalPath, attempt);
  const sourceWaitId =
    reason === 'blocked' ? waitIdForAction(record, blocker.action) : undefined;
  return {
    kind: 'strategy-ready',
    attempt,
    trigger: reason,
    invocation: {
      nodeId: deriveNodeId(plan.runId, hierarchicalPath),
      hierarchicalPath,
      profilePath: loop.strategyProfilePath!,
      admissionKind: 'agent',
      access: 'write',
      iteration: snapshot.iteration,
      phase: 'strategy',
    },
    ...(sourceWaitId === undefined || blocker.action === undefined
      ? {}
      : {
          sourceBlockedWait: {
            waitId: sourceWaitId,
            actionId: blocker.action.action.actionId,
          },
        }),
  };
}

/**
 * Pure lifecycle interpretation over a frozen loop plan, canonical Record and
 * one domain-owned snapshot. No compatibility file or report participates.
 */
export function reduceBoundedLoopLifecycle(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  snapshot: LoopDomainSnapshot
): LoopLifecycleSnapshot {
  const progress = reconstructProgress(snapshot.progressHistory);
  const blocker = reconstructBlocker(plan, record, loop, snapshot);
  const strategies = strategyActionsForLoop(plan, loop, record);
  const recoveryActions = Array.from(
    { length: loop.lifecycle.strategy.maxAttempts },
    (_, index) => index + 1
  ).flatMap((attempt) =>
    recoveryActionsForAttempt(plan, loop, record, snapshot, attempt).map(
      (entry) => entry.action
    )
  );
  const actionsUsed = Object.values(record.actions).filter(
    (action) =>
      snapshot.ownedNodeIds.has(action.action.nodeId as NodeId) ||
      strategies.some((candidate) => candidate.action.actionId === action.action.actionId) ||
      recoveryActions.some(
        (candidate) => candidate.action.actionId === action.action.actionId
      )
  ).length;
  const base = {
    ...(progress.fingerprint === undefined
      ? {}
      : { progressFingerprint: progress.fingerprint }),
    stallStreak: progress.stallStreak,
    ...(blocker.fingerprint === undefined
      ? {}
      : { blockerFingerprint: blocker.fingerprint }),
    blockedStreak: blocker.streak,
    actionsUsed,
    budgetUsed: actionsUsed,
    strategyAttempts: strategies.filter(
      (action) => action.result?.status === 'succeeded'
    ).length,
  };
  const admissionLimitDecision =
    actionsUsed >= loop.limits.maxActions
      ? terminalDecision('action-limit', loop.lifecycle.exits.actionLimit)
      : actionsUsed >= loop.limits.budget
        ? terminalDecision('budget-limit', loop.lifecycle.exits.budgetLimit)
        : undefined;

  if (record.status === 'cancelled' || record.terminal?.kind === 'cancelled') {
    return { ...base, decision: { kind: 'cancelled' } };
  }
  if (snapshot.completionOutcome !== undefined) {
    return {
      ...base,
      decision: {
        kind: 'completed',
        outcome: snapshot.completionOutcome,
        reason: 'domain-complete',
        disposition: 'domain',
      },
    };
  }
  const nextAction =
    snapshot.nextInvocation === undefined
      ? undefined
      : latestAttemptForDomainInvocation(
          plan,
          loop,
          record,
          snapshot.nextInvocation.nodeId,
          snapshot.nextInvocation.hierarchicalPath
        );
  if (nextAction?.state === 'active') {
    return { ...base, decision: { kind: 'waiting' } };
  }
  if (nextAction?.state === 'blocked' && nextAction.result === undefined) {
    const waitId = waitIdForAction(record, nextAction);
    return {
      ...base,
      decision: {
        kind: 'waiting',
        ...(waitId === undefined ? {} : { waitId }),
      },
    };
  }
  if (nextAction?.result?.status === 'failed') {
    return {
      ...base,
      decision: {
        kind: 'failed',
        outcome: 'bounded_loop_action_failed',
        reason: 'action-failed',
      },
    };
  }
  const recoveryDecision = pendingStrategyRecovery(
    plan,
    loop,
    record,
    snapshot
  );
  const pendingFreshAttempt =
    nextAction?.result?.status === 'blocked' &&
    hasPendingFreshAttempt(record, nextAction);
  if (
    nextAction?.result?.status === 'blocked' &&
    !pendingFreshAttempt &&
    blocker.streak < loop.lifecycle.thresholds.sameBlockerAttempts
  ) {
    return {
      ...base,
      decision: {
        kind: 'waiting',
        ...(waitIdForAction(record, nextAction) === undefined
          ? {}
          : { waitId: waitIdForAction(record, nextAction) }),
      },
    };
  }
  if (
    nextAction?.result?.status === 'blocked' &&
    !pendingFreshAttempt &&
    blocker.streak >= loop.lifecycle.thresholds.sameBlockerAttempts
  ) {
    const activeHumanWait = record.waits.find(
      (wait) =>
        wait.kind === 'human-required' &&
        wait.actionId === nextAction.action.actionId
    );
    if (activeHumanWait !== undefined) {
      return {
        ...base,
        decision: {
          kind: 'waiting',
          waitId: activeHumanWait.waitId as WaitId,
        },
      };
    }
    if (
      loop.lifecycle.exits.blocked.action === 'strategy' &&
      admissionLimitDecision !== undefined
    ) {
      return { ...base, decision: admissionLimitDecision };
    }
    return {
      ...base,
      decision: applyDisposition(
        plan,
        loop,
        record,
        snapshot,
        'blocked',
        loop.lifecycle.exits.blocked,
        blocker
      ),
    };
  }
  if (admissionLimitDecision !== undefined) {
    return { ...base, decision: admissionLimitDecision };
  }
  if (recoveryDecision !== undefined) {
    return { ...base, decision: recoveryDecision };
  }
  if (
    snapshot.continueRequested &&
    progress.stallStreak >= loop.lifecycle.thresholds.stallIterations
  ) {
    return {
      ...base,
      decision: applyDisposition(
        plan,
        loop,
        record,
        snapshot,
        'stalled',
        loop.lifecycle.exits.stalled,
        blocker
      ),
    };
  }
  if (
    snapshot.continueRequested &&
    snapshot.nextInvocation === undefined &&
    snapshot.iteration >= loop.limits.maxIterations
  ) {
    return {
      ...base,
      decision: applyDisposition(
        plan,
        loop,
        record,
        snapshot,
        'iteration-limit',
        loop.lifecycle.exits.iterationLimit,
        blocker
      ),
    };
  }
  if (snapshot.nextInvocation !== undefined) {
    return { ...base, decision: { kind: 'ready', invocation: snapshot.nextInvocation } };
  }
  return { ...base, decision: { kind: 'waiting' } };
}

export function lifecyclePolicyFor(
  loop: RuntimePlanBoundedLoopNode
): BoundedLoopLifecyclePolicyV1 {
  return loop.lifecycle;
}
