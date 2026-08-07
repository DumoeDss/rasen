import type {
  ChangeRunView,
  NodeId,
  WorkspaceRevision,
} from '../contracts.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from './record.js';
import type { RuntimePlan, RuntimePlanBoundedLoopNode, RuntimePlanFanOutNode, RuntimePlanChoiceNode } from './runtime-plan.js';
import type { CanonicalWait } from './waits.js';
import { canonicalJson } from './identity.js';
import { projectReviewCycleProgress } from './review-cycle-runtime.js';
import { projectGoalCycleProgress, type GoalCycleProgress } from './goal-cycle-runtime.js';
import { projectCompositeBodyProgress, compositeBodyStagePath } from './composite-runtime.js';
import {
  projectCompositeBodyDomainSnapshot,
} from './composite-runtime.js';
import { projectReviewCycleDomainSnapshot } from './review-cycle-runtime.js';
import { projectGoalCycleDomainSnapshot } from './goal-cycle-runtime.js';
import {
  reduceBoundedLoopLifecycle,
  strategyAttemptAccounting,
  strategyInvocationPath,
  strategyRecoveryInvocationPath,
  type LoopDomainSnapshot,
  type LoopLifecycleDecision,
} from './bounded-loop-lifecycle.js';
import { deriveNodeId } from './identity.js';

function actionView(committed: CommittedAction) {
  const action = committed.action;
  return {
    format: 'change-run-action-view/1',
    kind: action.kind,
    actionId: action.actionId,
    invocationId: action.invocationId,
    attemptId: action.attemptId,
    nodeId: action.nodeId,
    deliveryState: committed.deliveryState,
    capability: {
      id: action.capability.id,
      contractVersion: action.capability.contractVersion,
      contractDigest: action.capability.contractDigest,
      artifactDigest: action.capability.artifact.contentDigest,
    },
    completionAuthority: action.completionAuthority,
    expectedBeforeWorkspace: action.expectedBeforeWorkspace,
    effects: [...committed.effects]
      .sort((left, right) => (left.slot < right.slot ? -1 : 1))
      .map((effect) => ({
        slot: effect.slot,
        effectId: effect.effectId,
        state: effect.state,
      })),
  };
}

type AllowedControl =
  | Readonly<{ kind: 'resume'; waitId: string }>
  | Readonly<{ kind: 'decision'; waitId: string; decisionId: string; outcomes: readonly string[] }>
  | Readonly<{ kind: 'accept-workspace-revision'; waitId: string; revision: WorkspaceRevision }>
  | Readonly<{ kind: 'escalate' }>
  | Readonly<{ kind: 'cancel' }>;

/**
 * Derive the safe controls a caller may submit for a wait (task 1.6/11.x). A
 * gate offers a decision control over its declared decisions; a resumable wait
 * (domain-blocked, capability-unavailable, workspace-reservation, retryable
 * infrastructure) offers resume; a workspace-drift wait offers an
 * accept-workspace-revision control carrying the exact observed revision;
 * escalate and cancel are always available on a non-terminal Run.
 */
function allowedControlsFor(
  waits: readonly CanonicalWait[],
  escalate: 'include' | 'omit'
): readonly AllowedControl[] {
  const controls: AllowedControl[] = [];
  for (const wait of waits) {
    switch (wait.kind) {
      case 'gate':
        for (const decisionId of wait.decisionIds) {
          controls.push({
            kind: 'decision',
            waitId: wait.waitId,
            decisionId,
            outcomes: [...wait.decisionIds],
          });
        }
        break;
      case 'human-required':
        for (const decisionId of wait.decisionIds) {
          controls.push({
            kind: 'decision',
            waitId: wait.waitId,
            decisionId,
            outcomes: [...wait.decisionIds],
          });
        }
        break;
      case 'domain-blocked':
      case 'capability-unavailable':
      case 'workspace-reservation':
        controls.push({ kind: 'resume', waitId: wait.waitId });
        break;
      case 'infrastructure':
        if (wait.retryable) {
          controls.push({ kind: 'resume', waitId: wait.waitId });
        }
        break;
      case 'workspace-drift':
        controls.push({
          kind: 'accept-workspace-revision',
          waitId: wait.waitId,
          revision: wait.observed,
        });
        break;
      case 'uncertain-effect':
        // Uncertain-effect waits resume only through strong observation, not an
        // ordinary resume control; no control is offered here.
        break;
    }
  }
  if (escalate === 'include') {
    controls.push({ kind: 'escalate' });
    controls.push({ kind: 'cancel' });
  }
  return [...controls].sort((left, right) => {
    const leftCanon = canonicalJson(left);
    const rightCanon = canonicalJson(right);
    return leftCanon < rightCanon ? -1 : leftCanon > rightCanon ? 1 : 0;
  });
}

/**
 * Project a canonical Record into a read-only `ChangeRunView` (tasks 11.1/11.2).
 * The projection is derived solely from committed Record truth: actions,
 * waits, terminal outcome, and the current workspace revision. The ready
 * frontier itself is produced by the reconciler; this projector reports the
 * committed state and the safe controls derivable from it.
 *
 * `sourceState` reflects the association registry's authoritative state for
 * this Run's ChangeInstance: 'active' (default when no registry is consulted),
 * 'archived' (the Change directory was archived), or 'missing' (registry has
 * no binding for the current physical directory). Callers that have the
 * registry resolved (e.g. the CLI `status` command) pass the real value;
 * callers without registry access get the safe default 'active'.
 */
export function projectRunView(
  record: CanonicalRunRecord,
  sourceState: 'active' | 'archived' | 'missing' = 'active',
  plan?: RuntimePlan
): ChangeRunView {
  const isTerminal = record.terminal !== undefined;
  const root = isTerminal
    ? {
        kind: 'root-dag' as const,
        version: 1 as const,
        frontier: [] as readonly never[],
        activeInvocations: [] as readonly never[],
        actions: [] as readonly never[],
        waits: [] as readonly never[],
        terminal: record.terminal,
        workspace: {
          current: record.currentWorkspaceRevision,
          expectedByActiveWriters: [] as readonly WorkspaceRevision[],
        },
        effectDiagnostics: [] as readonly never[],
        allowedControls: [] as readonly never[],
      }
    : {
        kind: 'root-dag' as const,
        version: 1 as const,
        frontier: [] as readonly string[],
        activeInvocations: [] as readonly never[],
        actions: Object.values(record.actions)
          .sort((left, right) =>
            left.action.actionId < right.action.actionId
              ? -1
              : 1
          )
          .map(actionView),
        waits: [...record.waits].sort((left, right) =>
          left.waitId < right.waitId ? -1 : 1
        ),
        workspace: {
          current: record.currentWorkspaceRevision,
          expectedByActiveWriters: [] as readonly WorkspaceRevision[],
        },
        effectDiagnostics: [] as readonly never[],
        allowedControls: allowedControlsFor(record.waits, 'include'),
      };

  return {
    format: 'change-run-view/1',
    engine: 'reconciler',
    runId: record.runId,
    change: record.change,
    recordVersion: record.recordVersion,
    status: record.status,
    sourceState,
    workspace: {
      instanceId: record.workspaceInstanceId,
      scope: 'current',
    },
    drift: {
      definition: 'unchanged',
      sourceRevision: {
        provenance: 'unchanged',
        content: 'unchanged',
        semantic: 'unchanged',
      },
      capability: 'unchanged',
      policy: 'unchanged',
      workspace: 'unchanged',
    },
    sections: buildSections(root, plan, record),
  } as ChangeRunView;
}

/**
 * Build the view sections: root-dag always, review-cycle when the plan
 * contains a bounded-loop. Both derive from the same canonical Record.
 */
function buildSections(
  root: unknown,
  plan: RuntimePlan | undefined,
  record: CanonicalRunRecord
): readonly unknown[] {
  const sections: unknown[] = [root];
  if (plan !== undefined) {
    const loops = plan.nodes.filter(
      (node): node is RuntimePlanBoundedLoopNode => node.kind === 'bounded-loop'
    );
    for (const loop of loops) {
      const domain = lifecycleDomainSnapshot(plan, loop, record);
      sections.push(buildBoundedLoopLifecycleSection(plan, loop, record, domain));
      if (loop.body.kind === 'review-cycle') {
        sections.push(
          buildReviewCycleSection(
            loop,
            projectReviewCycleProgress(plan, loop, record)
          )
        );
      }
      if (loop.body.kind === 'goal-cycle') {
        sections.push(
          buildGoalSection(loop, projectGoalCycleProgress(plan, loop, record))
        );
      }
    }
    // Emit composite drill-down for composite-body loops or inlined CompositeRef nodes.
    const compositeSection = buildCompositeSection(plan, record);
    if (compositeSection !== null) {
      sections.push(compositeSection);
    }
    // ECP-4: emit parallel/1 section when the plan contains a fan-out node.
    const parallelSection = buildParallelSection(plan, record);
    if (parallelSection !== null) {
      sections.push(parallelSection);
    }
    // ECP-4: emit choice/1 section when the plan contains a choice node.
    const choiceSection = buildChoiceSection(plan, record);
    if (choiceSection !== null) {
      sections.push(choiceSection);
    }
  }
  return Object.freeze(sections);
}

function lifecycleDomainSnapshot(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): LoopDomainSnapshot {
  if (loop.body.kind === 'review-cycle') {
    return projectReviewCycleDomainSnapshot(plan, loop, record);
  }
  if (loop.body.kind === 'goal-cycle') {
    return projectGoalCycleDomainSnapshot(plan, loop, record);
  }
  return projectCompositeBodyDomainSnapshot(plan, loop, record);
}

function lifecycleOutcome(decision: LoopLifecycleDecision):
  | Readonly<{
      kind:
        | 'completed'
        | 'iteration-limit'
        | 'action-limit'
        | 'budget-limit'
        | 'stalled'
        | 'blocked'
        | 'strategy-exhausted'
        | 'failed'
        | 'cancelled';
      disposition: 'exit' | 'escalate' | 'fail' | 'cancel';
      value?: string;
    }>
  | undefined {
  switch (decision.kind) {
    case 'completed':
      return {
        kind: decision.reason === 'domain-complete' ? 'completed' : decision.reason,
        disposition: 'exit',
        value: decision.outcome,
      };
    case 'escalated':
      return {
        kind: decision.reason === 'action-failed' ? 'failed' : decision.reason,
        disposition: 'escalate',
        value: decision.outcome,
      };
    case 'failed':
      return {
        kind: decision.reason === 'action-failed' ? 'failed' : decision.reason,
        disposition: 'fail',
        value: decision.outcome,
      };
    case 'cancelled':
      return { kind: 'cancelled', disposition: 'cancel' };
    default:
      return undefined;
  }
}

function buildBoundedLoopLifecycleSection(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord,
  domain: LoopDomainSnapshot
): unknown {
  const lifecycle = reduceBoundedLoopLifecycle(plan, loop, record, domain);
  const strategyAccounting = strategyAttemptAccounting(plan, loop, record);
  const activeStrategy = strategyAccounting.active;
  const loopActionNodeIds = new Set<NodeId>(domain.ownedNodeIds);
  for (
    let attempt = 1;
    attempt <= loop.lifecycle.strategy.maxAttempts;
    attempt += 1
  ) {
    loopActionNodeIds.add(
      deriveNodeId(
        plan.runId,
        strategyInvocationPath(loop.hierarchicalPath, attempt)
      )
    );
    for (const invocation of domain.ownedInvocations) {
      loopActionNodeIds.add(
        deriveNodeId(
          plan.runId,
          strategyRecoveryInvocationPath(
            loop.hierarchicalPath,
            attempt,
            invocation.hierarchicalPath
          )
        )
      );
    }
  }
  const selectedWait =
    record.waits.find(
      (wait) =>
        wait.kind === 'human-required' &&
        wait.loopPath === loop.hierarchicalPath
    ) ??
    record.waits.find((wait) => {
      if (!('actionId' in wait)) return false;
      const action = record.actions[wait.actionId];
      return (
        action !== undefined &&
        loopActionNodeIds.has(action.action.nodeId as NodeId)
      );
    });
  const outcome = lifecycleOutcome(lifecycle.decision);
  const terminal = record.terminal !== undefined || outcome !== undefined;
  const state = terminal
    ? 'terminal'
    : selectedWait?.kind === 'human-required'
      ? 'human-required'
      : selectedWait !== undefined
          ? 'waiting'
          : activeStrategy !== undefined || lifecycle.decision.kind === 'strategy-ready'
            ? 'strategizing'
            : lifecycle.decision.kind === 'waiting'
              ? 'waiting'
              : 'running';
  return Object.freeze({
    kind: 'bounded-loop-lifecycle',
    version: 1,
    loopPath: loop.hierarchicalPath,
    bodyKind: domain.bodyKind,
    state,
    iteration: domain.iteration,
    phase: domain.phase,
    limits: {
      iterations: {
        used: Math.min(
          domain.progressHistory.length,
          loop.limits.maxIterations
        ),
        max: loop.limits.maxIterations,
      },
      actions: { used: lifecycle.actionsUsed, max: loop.limits.maxActions },
      budget: { used: lifecycle.budgetUsed, max: loop.limits.budget },
    },
    ...(lifecycle.progressFingerprint === undefined
      ? {}
      : { progressFingerprint: lifecycle.progressFingerprint }),
    stallStreak: lifecycle.stallStreak,
    ...(lifecycle.blockerFingerprint === undefined
      ? {}
      : { blockerFingerprint: lifecycle.blockerFingerprint }),
    blockedStreak: lifecycle.blockedStreak,
    strategy: {
      attempts: lifecycle.strategyAttempts,
      maxAttempts: loop.lifecycle.strategy.maxAttempts,
      ...(activeStrategy === undefined ? {} : { active: activeStrategy }),
    },
    ...(selectedWait === undefined
      ? {}
      : {
          wait: {
            waitId: selectedWait.waitId,
            kind: selectedWait.kind,
            ...('reasonCode' in selectedWait
              ? { reasonCode: selectedWait.reasonCode }
              : {}),
          },
        }),
    ...(outcome === undefined ? {} : { outcome }),
  });
}

/**
 * Build a `composite/1` section when the plan contains inlined composite nodes.
 * For composite-body BoundedLoop nodes, iterate the body stages and derive
 * their per-round status from committed actions. For CompositeRef-inlined
 * atomic nodes, detect them by hierarchical paths containing a `/` after
 * `root:` (the inlined body stage separator).
 */
function buildCompositeSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): unknown | null {
  // Check for composite-body BoundedLoop.
  const compositeLoop = plan.nodes.find(
    (node): node is RuntimePlanBoundedLoopNode =>
      node.kind === 'bounded-loop' && node.body.kind === 'composite'
  );
  if (compositeLoop !== undefined && compositeLoop.body.kind === 'composite') {
    const progress = projectCompositeBodyProgress(plan, compositeLoop, record);
    const body = compositeLoop.body;
    const stages = body.stages.map((stage) => {
      const round = progress.kind === 'ready' || progress.kind === 'waiting' || progress.kind === 'failed'
        ? progress.next.round
        : 1;
      const perRoundPath = compositeBodyStagePath(
        compositeLoop.hierarchicalPath,
        round,
        stage.hierarchicalPath
      );
      const action = Object.values(record.actions).find(
        (a) => a.action.nodeId === stage.nodeId
      );
      return {
        path: stage.hierarchicalPath,
        status: action === undefined ? 'pending' : action.state === 'active' ? 'active' : action.result?.status ?? 'pending',
        capability: { id: stage.profilePath },
      };
    });
    return Object.freeze({
      kind: 'composite',
      version: 1,
      compositePath: compositeLoop.hierarchicalPath,
      declarationId: body.declarationId,
      stages,
      outcome: progress.kind === 'clean' ? progress.outcome : undefined,
      ...(progress.kind === 'ready' || progress.kind === 'waiting' || progress.kind === 'failed'
        ? { round: progress.next.round, maxIterations: compositeLoop.limits.maxIterations }
        : { round: 1, maxIterations: compositeLoop.limits.maxIterations }),
    });
  }

  // Check for CompositeRef-inlined atomic nodes (paths with root:<id>/<stage> pattern).
  const inlinedNodes = plan.nodes.filter(
    (node): node is typeof node =>
      node.kind === 'atomic' &&
      node.hierarchicalPath.startsWith('root:') &&
      node.hierarchicalPath.includes('/')
  );
  if (inlinedNodes.length === 0) return null;

  // Group inlined nodes by their CompositeRef prefix.
  const groups = new Map<string, typeof inlinedNodes>();
  for (const node of inlinedNodes) {
    const prefix = node.hierarchicalPath.split('/')[0]!;
    const existing = groups.get(prefix) ?? [];
    existing.push(node);
    groups.set(prefix, existing);
  }

  // Build sections for the first group (simple: one composite per section).
  const [compositePath, groupNodes] = [...groups.entries()][0]!;
  const stages = groupNodes.map((node) => {
    if (node.kind !== 'atomic') return null;
    const action = Object.values(record.actions).find(
      (a) => a.action.nodeId === node.nodeId
    );
    return {
      path: node.hierarchicalPath,
      status: action === undefined ? 'pending' : action.state === 'active' ? 'active' : action.result?.status ?? 'pending',
      capability: { id: node.profilePath ?? node.hierarchicalPath },
    };
  }).filter((s): s is NonNullable<typeof s> => s !== null);

  return Object.freeze({
    kind: 'composite',
    version: 1,
    compositePath,
    declarationId: 'custom',
    stages,
    outcome: undefined,
  });
}

function buildReviewCycleSection(
  loop: RuntimePlanBoundedLoopNode,
  progress: ReturnType<typeof projectReviewCycleProgress>
): unknown {
  const state = progress.state;
  const phase = 'next' in progress ? progress.next.phase : state.phase;
  const round = 'next' in progress ? progress.next.round : state.round;
  return Object.freeze({
    kind: 'review-cycle',
    version: 1,
    loopPath: loop.hierarchicalPath,
    round,
    phase,
    outcome: state.outcome,
    findings: state.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      status: f.status,
      claim: f.claim,
      ...(f.location !== undefined ? { location: f.location } : {}),
    })),
    actors: {
      ...(state.fixerActor !== undefined
        ? { fixer: state.fixerActor }
        : {}),
      ...(state.verifierActor !== undefined
        ? { verifier: state.verifierActor }
        : {}),
      ...(state.lastActor !== undefined ? { lastActor: state.lastActor } : {}),
    },
    waitReason:
      progress.kind === 'waiting'
        ? 'action-active'
        : progress.kind === 'failed'
          ? 'committed-failure'
          : undefined,
    maxRounds: loop.limits.maxIterations,
  });
}

/**
 * Build a `goal/1` section for a goal-cycle bounded-loop. Mirrors the
 * review-cycle section shape but carries only goal-specific fields. Shared
 * stall and budget mechanics live exclusively in bounded-loop-lifecycle/1.
 */
function buildGoalSection(
  loop: RuntimePlanBoundedLoopNode,
  progress: GoalCycleProgress
): unknown {
  const state = progress.state;
  const phase = 'next' in progress ? progress.next.phase : state.phase;
  const round = 'next' in progress ? progress.next.round : state.round;
  const variant =
    loop.body.kind === 'goal-cycle' ? loop.body.variant : 'measure';
  return Object.freeze({
    kind: 'goal',
    version: 1,
    loopPath: loop.hierarchicalPath,
    variant,
    round,
    phase,
    outcome: state.outcome,
    ...(state.lastScore !== undefined ? { lastScore: state.lastScore } : {}),
    lastGaps: state.lastGaps,
    waitReason:
      progress.kind === 'waiting'
        ? 'action-active'
        : progress.kind === 'failed'
          ? 'committed-failure'
          : undefined,
  });
}

/**
 * ECP-4: the SUCCEEDED evaluator result the projection should display, or
 * `undefined` when the evaluator has not resolved.
 *
 * Two defects lived here. The reader took the FIRST result-bearing attempt
 * while the kernel takes the LAST, and it ignored completion status entirely.
 * Both matter now that unresolved evaluators are RETRIED: after a
 * failed-then-retried-successfully evaluator — an ordinary path precisely
 * because the retry cap exists — the projection kept reading the failed first
 * attempt forever, showing members `waiting` and joinState `not-reached` while
 * the Run was actually executing. It also displayed a crashed evaluator's
 * partial output as a real selection.
 *
 * Mirrors `succeededResultForNode` in the reconciler on purpose: the display
 * plane must answer "what did this evaluator decide" exactly as the kernel
 * does. All three parity planes share this one reader, which is why a parity
 * suite alone can never catch a divergence here.
 */
function succeededEvaluatorResult(
  record: CanonicalRunRecord,
  nodeId: string
): Readonly<Record<string, unknown>> | undefined {
  const committed = Object.values(record.actions).filter(
    (action) =>
      action.action.nodeId === nodeId &&
      action.result !== undefined &&
      action.result.status === 'succeeded'
  );
  const last = committed[committed.length - 1];
  const value = last?.result?.result;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

/**
 * ECP-4: the `parallel/1` section a Run view exposes for a FanOut/Join pair.
 * Consumed by the CLI `pipeline status` renderer, the Management API, and the
 * Operations UI — all three read the SAME projection, so the shape is typed
 * here rather than left as `unknown`.
 */
export type ParallelMemberStatus =
  | 'waiting'
  | 'suppressed'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed';

export type ParallelJoinState =
  | 'not-reached'
  | 'waiting'
  | 'proceeding'
  | 'failed';

export interface ParallelMemberView {
  readonly path: string;
  readonly status: ParallelMemberStatus;
  readonly required: boolean;
  readonly condition: string;
}

export interface ParallelSectionView {
  readonly kind: 'parallel';
  readonly version: 1;
  readonly fanOutPath: string;
  readonly joinPath: string | undefined;
  readonly members: readonly ParallelMemberView[];
  readonly joinState: ParallelJoinState;
  readonly concurrencyCap: number;
  readonly budget: Readonly<{ used: number; max: number }>;
  readonly activeCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly keyBlockers: readonly string[];
}

/** ECP-4: the `choice/1` section a Run view exposes for a Choice node. */
export interface ChoiceBranchView {
  readonly outcome: string;
  readonly path: string;
  readonly active: boolean;
}

export interface ChoiceSectionView {
  readonly kind: 'choice';
  readonly version: 1;
  readonly choicePath: string;
  readonly outcome: string | undefined;
  readonly branches: readonly ChoiceBranchView[];
}

/**
 * ECP-4: Build a `parallel/1` section when the plan contains a fan-out node.
 * Iterates fan-out members, reads committed action states, derives member
 * statuses, computes join state, budget usage, and key blockers.
 */
function buildParallelSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): ParallelSectionView | null {
  const fanOut = plan.nodes.find(
    (node): node is RuntimePlanFanOutNode => node.kind === 'fan-out'
  );
  if (fanOut === undefined) return null;
  const join = plan.nodes.find((node) => node.kind === 'join');
  // Read the SUCCEEDED fan-out condition result to determine active members.
  let activeMembers: Set<string>;
  let conditionCommitted = false;
  const conditionResult = succeededEvaluatorResult(record, fanOut.nodeId);
  if (conditionResult !== undefined && Array.isArray(conditionResult.activeMembers)) {
    activeMembers = new Set(conditionResult.activeMembers as readonly string[]);
    conditionCommitted = true;
  } else {
    activeMembers = new Set(fanOut.members.map((m) => m.hierarchicalPath));
  }
  // Derive member statuses.
  const memberStatuses = fanOut.members.map((member) => {
    const memberNode = plan.nodes.find(
      (n) => n.kind === 'atomic' && n.nodeId === member.nodeId
    );
    const action = memberNode !== undefined
      ? Object.values(record.actions).find((a) => a.action.nodeId === member.nodeId)
      : undefined;
    let status: ParallelMemberStatus;
    if (!conditionCommitted) {
      status = 'waiting';
    } else if (!activeMembers.has(member.hierarchicalPath)) {
      status = 'suppressed';
    } else if (action === undefined) {
      status = 'ready';
    } else if (action.state === 'active') {
      status = 'running';
    } else if (action.result?.status === 'succeeded') {
      status = 'succeeded';
    } else if (action.result?.status === 'failed') {
      status = 'failed';
    } else {
      status = 'ready';
    }
    return {
      path: member.hierarchicalPath,
      status,
      required: member.required,
      condition: member.condition,
    };
  });
  // Determine join state.
  let joinState: ParallelJoinState = 'not-reached';
  if (join !== undefined && conditionCommitted) {
    const succeeded = memberStatuses.filter((m) => m.status === 'succeeded');
    const failed = memberStatuses.filter((m) => m.status === 'failed');
    const requiredFailed = failed.some((m) => m.required);
    const allRequiredSucceeded = memberStatuses
      .filter((m) => m.required && m.status !== 'suppressed')
      .every((m) => m.status === 'succeeded');
    if (requiredFailed) {
      joinState = 'failed';
    } else if (allRequiredSucceeded) {
      joinState = 'proceeding';
    } else {
      joinState = 'waiting';
    }
  }
  // Compute budget usage.
  const committedCount = memberStatuses.filter(
    (m) => m.status === 'succeeded' || m.status === 'failed'
  ).length;
  const keyBlockers: string[] = [];
  for (const m of memberStatuses) {
    if (m.status === 'failed' && m.required) {
      keyBlockers.push(`required member '${m.path}' failed`);
    }
  }
  const section: ParallelSectionView = {
    kind: 'parallel',
    version: 1,
    fanOutPath: fanOut.hierarchicalPath,
    joinPath: join?.hierarchicalPath,
    members: memberStatuses,
    joinState,
    concurrencyCap: fanOut.concurrencyCap,
    budget: { used: committedCount, max: fanOut.budget },
    activeCount: memberStatuses.filter((m) => m.status === 'running' || m.status === 'ready').length,
    succeededCount: memberStatuses.filter((m) => m.status === 'succeeded').length,
    failedCount: memberStatuses.filter((m) => m.status === 'failed').length,
    keyBlockers,
  };
  return Object.freeze(section);
}

/**
 * ECP-4: Build a `choice/1` section when the plan contains a choice node.
 */
function buildChoiceSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): ChoiceSectionView | null {
  const choice = plan.nodes.find(
    (node): node is RuntimePlanChoiceNode => node.kind === 'choice'
  );
  if (choice === undefined) return null;
  // Read the SUCCEEDED choice result.
  const choiceResult = succeededEvaluatorResult(record, choice.nodeId);
  const selected = choiceResult?.outcome;
  const outcome = typeof selected === 'string' ? selected : undefined;
  const branches = choice.outcomes.map((o) => ({
    outcome: o,
    path: choice.branches[o] ?? '',
    active: outcome === o,
  }));
  const section: ChoiceSectionView = {
    kind: 'choice',
    version: 1,
    choicePath: choice.hierarchicalPath,
    outcome,
    branches,
  };
  return Object.freeze(section);
}
