import type {
  ChangeRunView,
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
    const loop = plan.nodes.find(
      (node): node is RuntimePlanBoundedLoopNode => node.kind === 'bounded-loop'
    );
    if (loop !== undefined && loop.body.kind === 'review-cycle') {
      const progress = projectReviewCycleProgress(plan, loop, record);
      sections.push(buildReviewCycleSection(loop, progress));
    }
    // Emit goal/1 section for goal-cycle body bounded-loops.
    const goalLoop = plan.nodes.find(
      (node): node is RuntimePlanBoundedLoopNode =>
        node.kind === 'bounded-loop' && node.body.kind === 'goal-cycle'
    );
    if (goalLoop !== undefined && goalLoop.body.kind === 'goal-cycle') {
      const progress = projectGoalCycleProgress(plan, goalLoop, record);
      sections.push(buildGoalSection(goalLoop, progress));
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
        ? { round: progress.next.round, maxIterations: compositeLoop.maxIterations }
        : { round: 1, maxIterations: compositeLoop.maxIterations }),
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
    maxRounds: loop.maxIterations,
  });
}

/**
 * Build a `goal/1` section for a goal-cycle bounded-loop. Mirrors the
 * review-cycle section shape but carries goal-specific fields: variant,
 * score, gaps, stall streak, and budget.
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
    stallStreak: state.stallStreak,
    budget: {
      used: state.eventCount,
      max: loop.maxIterations * 2, // 2 phases per round
    },
    waitReason:
      progress.kind === 'waiting'
        ? 'action-active'
        : progress.kind === 'failed'
          ? 'committed-failure'
          : undefined,
  });
}

/**
 * ECP-4: Build a `parallel/1` section when the plan contains a fan-out node.
 * Iterates fan-out members, reads committed action states, derives member
 * statuses, computes join state, budget usage, and key blockers.
 */
function buildParallelSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): unknown | null {
  const fanOut = plan.nodes.find(
    (node): node is RuntimePlanFanOutNode => node.kind === 'fan-out'
  );
  if (fanOut === undefined) return null;
  const join = plan.nodes.find((node) => node.kind === 'join');
  // Read the fan-out condition result to determine active members.
  let activeMembers: Set<string>;
  let conditionCommitted = false;
  const conditionAction = Object.values(record.actions).find(
    (a) => a.action.nodeId === fanOut.nodeId && a.result !== undefined
  );
  if (conditionAction?.result?.result && typeof conditionAction.result.result === 'object' && !Array.isArray(conditionAction.result.result)) {
    const result = conditionAction.result.result as Readonly<{ activeMembers?: unknown }>;
    if (Array.isArray(result.activeMembers)) {
      activeMembers = new Set(result.activeMembers as readonly unknown[] as string[]);
      conditionCommitted = true;
    } else {
      activeMembers = new Set(fanOut.members.map((m) => m.hierarchicalPath));
    }
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
    let status: string;
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
  let joinState = 'not-reached';
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
  return Object.freeze({
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
  });
}

/**
 * ECP-4: Build a `choice/1` section when the plan contains a choice node.
 */
function buildChoiceSection(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): unknown | null {
  const choice = plan.nodes.find(
    (node): node is RuntimePlanChoiceNode => node.kind === 'choice'
  );
  if (choice === undefined) return null;
  // Read the committed choice result.
  const choiceAction = Object.values(record.actions).find(
    (a) => a.action.nodeId === choice.nodeId && a.result !== undefined
  );
  let outcome: string | undefined;
  if (choiceAction?.result?.result && typeof choiceAction.result.result === 'object' && !Array.isArray(choiceAction.result.result)) {
    const result = choiceAction.result.result as Readonly<{ outcome?: unknown }>;
    if (typeof result.outcome === 'string') {
      outcome = result.outcome;
    }
  }
  const branches = choice.outcomes.map((o) => ({
    outcome: o,
    path: choice.branches[o] ?? '',
    active: outcome === o,
  }));
  return Object.freeze({
    kind: 'choice',
    version: 1,
    choicePath: choice.hierarchicalPath,
    outcome,
    branches,
  });
}
