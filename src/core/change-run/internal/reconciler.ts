import type {
  JsonValue,
  NodeId,
  WaitId,
} from '../contracts.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import type {
  RuntimePlan,
  RuntimePlanAtomicNode,
  RuntimePlanBoundedLoopNode,
  RuntimePlanChoiceNode,
  RuntimePlanFanOutNode,
  RuntimePlanJoinNode,
} from './runtime-plan.js';
import {
  projectReviewCycleProgress,
  type ReviewCycleProgress,
} from './review-cycle-runtime.js';
import {
  projectCompositeBodyProgress,
  type CompositeBodyProgress,
} from './composite-runtime.js';
import {
  projectGoalCycleProgress,
  type GoalCycleProgress,
} from './goal-cycle-runtime.js';
import {
  createCanonicalWait,
  type CanonicalWait,
} from './waits.js';
import { deriveInvocationId } from './identity.js';
import { taskLoopActionInput } from './task-loop.js';

export type ReconcilerAdmissionKind = 'agent' | 'command' | 'host';

export type ReconcilerNextAction =
  | Readonly<{
      kind: 'admit';
      nodeId: NodeId;
      occurrence: number;
      admissionKind: ReconcilerAdmissionKind;
      /**
       * The candidate's workspace access. The facade consults the
       * cross-Run reservation registry only for `read`/`write` admits;
       * `none` admits never touch the registry.
       */
      access: 'none' | 'read' | 'write';
      /**
       * Optional structured input for the action. For ReviewCycle
       * bounded-loop admits this carries `{ round, phase, openFindingIds }`
       * so the facade can build an action with the correct capability
       * binding and agent brief context.
       */
      input?: Readonly<{
        reviewCycle?: Readonly<{ loopPath: string; round: number; phase: string; openFindingIds: readonly string[] }>;
        goalCycle?: Readonly<{ loopPath: string; round: number; phase: string }>;
        taskLoop?: JsonValue;
        fanOutCondition?: Readonly<{ fanOutPath: string }>;
      }>;
      /**
       * The profile path for this admit's capability binding. Set for
       * bounded-loop phase admits so the facade can build the correct
       * action without a separate plan lookup.
       */
      readonly profilePath?: string;
    }>
  | Readonly<{
      kind: 'await-gate';
      nodeId: NodeId;
      gateId: string;
      waitId: WaitId;
      decisionIds: readonly string[];
    }>
  | Readonly<{
      kind: 'await-workspace';
      workspaceInstanceId: string;
      intents: readonly Readonly<{
        nodeId: NodeId;
        occurrence: number;
        access: 'read' | 'write';
      }>[];
    }>
  | Readonly<{
      kind: 'suspend-unsupported';
      nodeId: NodeId;
      code: string;
    }>
  | Readonly<{ kind: 'finish'; outcome: string }>
  | Readonly<{ kind: 'escalate'; code: string; reason?: string }>
  | Readonly<{ kind: 'cancel'; reason?: string }>;

export type ReconcilerClassification = 'running' | 'waiting' | 'terminal';

export type ReconcilerFailureCode =
  | 'plan_record_identity_mismatch'
  | 'unsupported_runtime_plan';

export interface ReconcilerFailure {
  readonly code: ReconcilerFailureCode;
  readonly message: string;
}

export type ReconcilerResult =
  | Readonly<{
      ok: true;
      classification: ReconcilerClassification;
      actions: readonly ReconcilerNextAction[];
    }>
  | Readonly<{ ok: false; failure: ReconcilerFailure }>;

type NodeDisposition =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'ready' }>
  | Readonly<{ status: 'gate-pending' }>
  | Readonly<{ status: 'gate-awaiting' }>
  | Readonly<{ status: 'gate-decided-proceed' }>
  | Readonly<{ status: 'gate-decided-blocked'; gateId: string }>
  | Readonly<{ status: 'active' }>
  | Readonly<{ status: 'blocked' }>
  | Readonly<{ status: 'succeeded' }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'suspended-unsupported' }>
  | Readonly<{ status: 'suspending-unsupported'; code: string }>;

/**
 * ECP-4: how many times an orchestration evaluator (Choice condition, FanOut
 * condition) may be dispatched before the Run escalates.
 *
 * An unresolved evaluator — one that failed, or committed a result naming no
 * declared outcome — is re-admitted so a transient failure can recover. Without
 * a cap that retry loop runs until the sealed attempt budget dies, spending up
 * to ~2x plan-size PAID agent dispatches and reporting a generic
 * `execution_budget_exhausted` that names neither the node nor the cause.
 * Atomic nodes are not retried at all; a small cap keeps evaluators close to
 * that discipline while tolerating one bad dispatch.
 */
const MAX_EVALUATOR_ATTEMPTS = 3;

/**
 * Pure deterministic control kernel for an Executable Composite Pipeline Run.
 *
 * `reconcile(plan, record)` reads only the frozen plan and the committed
 * canonical Record. It never touches files, catalogs, clocks, environment,
 * processes, network, or Adapters, and it mutates neither input. For identical
 * plan/Record values it emits the same typed candidate actions in the same
 * stable hierarchical NodeId order.
 *
 * The installed runtime subset is deliberately small: root DAG dependency
 * readiness, typed AtomicStage admission, human Gate, the explicit
 * simple/complex adaptive verification route, durable suspend, and implicit or
 * explicit root Finish. Composite/BoundedLoop/GoalLoop/FanOut/Join are never
 * interpreted here.
 */
export function reconcile(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): ReconcilerResult {
  const mismatch = identityMismatch(plan, record);
  if (mismatch !== null) {
    return { ok: false, failure: mismatch };
  }

  if (record.terminal !== undefined) {
    return { ok: true, classification: 'terminal', actions: [] };
  }

  // Pass 1: every node's terminal action state is determined solely by the
  // committed Record, never by iteration order. A node counts as "succeeded"
  // for dependency purposes when its committed result succeeded (and an
  // adaptive verify chose the simple route).
  const atomicNodes = plan.nodes.filter(
    (node): node is RuntimePlanAtomicNode => node.kind === 'atomic'
  );
  const boundedLoopNodes = plan.nodes.filter(
    (node): node is RuntimePlanBoundedLoopNode => node.kind === 'bounded-loop'
  );
  const choiceNodes = plan.nodes.filter(
    (node): node is RuntimePlanChoiceNode => node.kind === 'choice'
  );
  const fanOutNodes = plan.nodes.filter(
    (node): node is RuntimePlanFanOutNode => node.kind === 'fan-out'
  );
  const joinNodes = plan.nodes.filter(
    (node): node is RuntimePlanJoinNode => node.kind === 'join'
  );
  const succeeded = new Set<NodeId>();
  for (const node of atomicNodes) {
    if (nodeSucceeded(record, node)) {
      succeeded.add(node.nodeId);
    }
  }

  // ECP-4: nodes on a branch the choice rejected are permanently ineligible.
  // Computed once from committed Record truth (the selection never changes),
  // then honoured by every pass below and by `finishCandidate`.
  const excludedByChoice = choiceBranchExclusions(plan, record, choiceNodes);

  // ECP-4: derive the transitive succeeded-set closure over the NON-atomic node
  // kinds before any candidate pass runs. The candidate passes below execute in
  // a fixed order (bounded-loop, choice, fan-out, join), so a node whose
  // `requires` is satisfied only by a LATER pass would never become ready:
  // full-feature's `review-loop` BoundedLoop requires the Join, but the Join
  // only enters the succeeded set in pass 1e — after the bounded-loop pass has
  // already skipped it. That is a permanent stall, not a one-tick delay,
  // because `reconcile` is pure and recomputes the same order every call.
  // Iterating to a fixed point makes readiness independent of pass order; the
  // `succeeded.add` calls in the passes below then become idempotent no-ops.
  for (let round = 0; round <= plan.nodes.length; round += 1) {
    const sizeBefore = succeeded.size;
    for (const loop of boundedLoopNodes) {
      if (succeeded.has(loop.nodeId) || excludedByChoice.has(loop.nodeId)) continue;
      if (!loop.requires.every((required) => succeeded.has(required))) continue;
      if (boundedLoopIsClean(plan, loop, record)) succeeded.add(loop.nodeId);
    }
    for (const choice of choiceNodes) {
      if (succeeded.has(choice.nodeId) || excludedByChoice.has(choice.nodeId)) continue;
      if (!choice.requires.every((req) => succeeded.has(req))) continue;
      if (committedChoiceOutcome(record, choice) === null) continue;
      // Only the choice node itself succeeds here. The SELECTED branch node is
      // deliberately NOT added: it is an ordinary plan node that earns its
      // succeeded status by committing its own Action. Marking it succeeded on
      // selection let everything downstream of it run before the branch had
      // executed at all.
      succeeded.add(choice.nodeId);
    }
    for (const fanOut of fanOutNodes) {
      if (succeeded.has(fanOut.nodeId) || excludedByChoice.has(fanOut.nodeId)) continue;
      if (!fanOut.requires.every((req) => succeeded.has(req))) continue;
      if (succeededResultForNode(record, fanOut.nodeId) !== null) {
        succeeded.add(fanOut.nodeId);
      }
    }
    for (const join of joinNodes) {
      if (succeeded.has(join.nodeId) || excludedByChoice.has(join.nodeId)) continue;
      const fanOut = fanOutNodes.find((fo) => fo.joinNodeId === join.nodeId);
      if (fanOut === undefined) continue;
      if (!joinNonMemberRequiresSatisfied(join, succeeded)) continue;
      if (evaluateJoin(record, join, fanOut, atomicNodes) === 'proceed') {
        succeeded.add(join.nodeId);
      }
    }
    if (succeeded.size === sizeBefore) break;
  }

  // Pass 1b: bounded-loop outcomes → succeeded set update. A clean
  // bounded-loop contributes its nodeId to the succeeded set so that
  // downstream atomic nodes (ship, archive) whose requires includes the
  // bounded-loop can proceed. An exhausted bounded-loop emits an escalate
  // candidate. This pass runs BEFORE the atomic classification pass so
  // downstream nodes see the updated succeeded set.
  const actions: ReconcilerNextAction[] = [];
  const boundedLoopAdmitCandidates: BoundedLoopAdmitCandidate[] = [];
  for (const loop of boundedLoopNodes) {
    if (excludedByChoice.has(loop.nodeId)) continue;
    if (!loop.requires.every((required) => succeeded.has(required))) {
      continue;
    }
    if (loop.body.kind === 'review-cycle') {
      const progress = projectReviewCycleProgress(plan, loop, record);
      switch (progress.kind) {
        case 'clean':
          succeeded.add(loop.nodeId);
          break;
        case 'exhausted':
          actions.push({
            kind: 'escalate',
            code: loop.outcomes.exhausted,
          });
          break;
        case 'ready':
          boundedLoopAdmitCandidates.push({
            nodeId: progress.next.nodeId,
            occurrence: occurrenceForBoundedLoop(record, progress.next.nodeId),
            admissionKind: progress.next.admissionKind,
            access: progress.next.workspace.access,
            loop,
            bodyKind: 'review-cycle',
            descriptor: progress.next,
            openFindingIds: progress.state.openFindingIds,
            loopPath: loop.hierarchicalPath,
          });
          break;
        case 'waiting':
        case 'failed':
          // An action is already active (waiting) or committed-failed (failed);
          // no fresh candidate — surface via projection.
          break;
      }
    } else if (loop.body.kind === 'goal-cycle') {
      const progress = projectGoalCycleProgress(plan, loop, record);
      switch (progress.kind) {
        case 'satisfied':
          succeeded.add(loop.nodeId);
          break;
        case 'exhausted':
          actions.push({
            kind: 'escalate',
            code: loop.outcomes.exhausted,
          });
          break;
        case 'ready':
          boundedLoopAdmitCandidates.push({
            nodeId: progress.next.nodeId,
            occurrence: occurrenceForBoundedLoop(record, progress.next.nodeId),
            admissionKind: progress.next.admissionKind,
            access: progress.next.workspace.access,
            loop,
            bodyKind: 'goal-cycle',
            descriptor: {
              round: progress.next.round,
              phase: progress.next.phase,
              nodeId: progress.next.nodeId,
              profilePath: progress.next.profilePath,
            },
            openFindingIds: [],
            loopPath: loop.hierarchicalPath,
          });
          break;
        case 'waiting':
          if (
            record.pipeline === 'task-loop' &&
            progress.action.result?.status === 'blocked'
          ) {
            actions.push({
              kind: 'escalate',
              code: 'task_loop_blocked',
              reason: 'A task-loop phase reported a blocking condition.',
            });
          }
          break;
        case 'failed':
          if (record.pipeline === 'task-loop') {
            actions.push({
              kind: 'escalate',
              code: 'task_loop_blocked',
              reason: 'A task-loop phase failed before satisfaction.',
            });
          }
          break;
      }
    } else {
      // Composite body kind (ECP-2).
      const progress = projectCompositeBodyProgress(plan, loop, record);
      switch (progress.kind) {
        case 'clean':
          succeeded.add(loop.nodeId);
          break;
        case 'exhausted':
          actions.push({
            kind: 'escalate',
            code: loop.outcomes.exhausted,
          });
          break;
        case 'ready':
          boundedLoopAdmitCandidates.push({
            nodeId: progress.next.nodeId,
            occurrence: occurrenceForBoundedLoop(record, progress.next.nodeId),
            admissionKind: progress.next.stage.admissionKind,
            access: progress.next.stage.workspace.access,
            loop,
            bodyKind: 'composite',
            descriptor: {
              round: progress.next.round,
              phase: progress.next.stage.hierarchicalPath,
              nodeId: progress.next.nodeId,
              profilePath: progress.next.stage.profilePath,
            },
            openFindingIds: [],
            loopPath: loop.hierarchicalPath,
          });
          break;
        case 'waiting':
        case 'failed':
          break;
      }
    }
  }

  // Pass 1c (ECP-4 Choice): evaluate choice nodes. A committed result puts the
  // choice itself in the succeeded set, which unblocks the SELECTED branch node
  // for admission (its `requires` names the choice). Rejected branches are in
  // `excludedByChoice` and are skipped by every pass below. If no committed
  // result exists, the choice emits an admit for its condition evaluator.
  const fanOutMemberCandidates: FanOutMemberCandidate[] = [];
  for (const choice of choiceNodes) {
    if (excludedByChoice.has(choice.nodeId)) continue;
    if (!choice.requires.every((req) => succeeded.has(req))) continue;
    if (committedChoiceOutcome(record, choice) !== null) {
      succeeded.add(choice.nodeId);
    } else {
      const attempts = evaluatorAttempts(record, choice.nodeId);
      // An attempt is still in flight — it may yet resolve. No verdict is due.
      if (attempts.active) continue;
      if (attempts.committed >= MAX_EVALUATOR_ATTEMPTS) {
        // Escalate with a code that names the node and the cause, instead of
        // retrying into a generic budget-exhausted terminal.
        actions.push({
          kind: 'escalate',
          code: 'choice_evaluator_unresolved',
          reason: `Choice evaluator ${choice.hierarchicalPath} did not commit a declared outcome in ${attempts.committed} attempts.`,
        });
        continue;
      }
      // Emit admit for the choice condition evaluator.
      actions.push({
        kind: 'admit',
        nodeId: choice.nodeId,
        occurrence: occurrenceForNodeId(record, choice.nodeId),
        admissionKind: choice.admissionKind,
        access: choice.workspace.access,
        profilePath: choice.profilePath,
      });
    }
  }

  // Pass 1d (ECP-4 FanOut): evaluate fan-out nodes. If the condition is
  // committed, add the fan-out to the succeeded set and collect active
  // member candidates (respecting concurrency cap and budget).
  for (const fanOut of fanOutNodes) {
    if (excludedByChoice.has(fanOut.nodeId)) continue;
    if (!fanOut.requires.every((req) => succeeded.has(req))) continue;
    const conditionResult = succeededResultForNode(record, fanOut.nodeId);
    if (conditionResult === null) {
      const attempts = evaluatorAttempts(record, fanOut.nodeId);
      // An attempt is still in flight — it may yet resolve. No verdict is due.
      if (attempts.active) continue;
      if (attempts.committed >= MAX_EVALUATOR_ATTEMPTS) {
        actions.push({
          kind: 'escalate',
          code: 'fan_out_condition_unresolved',
          reason: `FanOut condition evaluator ${fanOut.hierarchicalPath} did not commit a member decision in ${attempts.committed} attempts.`,
        });
        continue;
      }
      // Emit admit for the condition evaluator.
      actions.push({
        kind: 'admit',
        nodeId: fanOut.nodeId,
        occurrence: occurrenceForNodeId(record, fanOut.nodeId),
        admissionKind: fanOut.admissionKind,
        access: fanOut.workspace.access,
        profilePath: fanOut.profilePath,
        input: { fanOutCondition: { fanOutPath: fanOut.hierarchicalPath } },
      });
      continue;
    }
    // Condition committed — add fan-out to succeeded set.
    succeeded.add(fanOut.nodeId);
    // Read active members from the condition result.
    const activeMembers = readActiveMembers(conditionResult, fanOut);
    // Check for required members suppressed by the condition (plan violation).
    for (const member of fanOut.members) {
      if (member.required && !activeMembers.has(member.hierarchicalPath)) {
        actions.push({
          kind: 'escalate',
          code: 'fan_out_required_member_suppressed',
          reason: `Required member ${member.hierarchicalPath} was suppressed by the FanOut condition evaluator.`,
        });
      }
    }
    // Collect non-terminal active member candidates.
    const candidates: FanOutMemberCandidate[] = [];
    for (const member of fanOut.members) {
      if (!activeMembers.has(member.hierarchicalPath)) continue;
      // Find the atomic node for this member.
      const memberNode = atomicNodes.find(
        (n) => n.nodeId === member.nodeId
      );
      if (memberNode === undefined) continue;
      // Skip if already terminal (committed succeeded/failed).
      const state = effectiveActionResult(record, memberNode);
      if (state !== null) continue; // terminal or active — skip
      candidates.push({
        nodeId: member.nodeId,
        hierarchicalPath: member.hierarchicalPath,
        required: member.required,
        condition: member.condition,
        fanOutNodeId: fanOut.nodeId,
      });
    }
    // Sort by hierarchical path for stable ordering.
    candidates.sort((a, b) =>
      a.hierarchicalPath < b.hierarchicalPath ? -1 : a.hierarchicalPath > b.hierarchicalPath ? 1 : 0
    );
    // Apply budget: count committed member actions.
    let committedCount = 0;
    for (const member of fanOut.members) {
      const memberNode = atomicNodes.find((n) => n.nodeId === member.nodeId);
      if (memberNode === undefined) continue;
      const state = effectiveActionResult(record, memberNode);
      if (state !== null) committedCount++;
    }
    const availableSlots = Math.max(0, fanOut.budget - committedCount);
    const cap = Math.min(fanOut.concurrencyCap, availableSlots, candidates.length);
    for (let i = 0; i < cap; i++) {
      fanOutMemberCandidates.push(candidates[i]!);
    }
  }

  // Pass 1e (ECP-4 Join): evaluate join nodes after FanOut pass so the
  // fan-out is in the succeeded set. The Join reads committed member
  // results and derives its state purely from the Record.
  for (const join of joinNodes) {
    if (excludedByChoice.has(join.nodeId)) continue;
    // Only check non-member requires (upstream deps like the FanOut node).
    // Member status is checked inside evaluateJoin.
    if (!joinNonMemberRequiresSatisfied(join, succeeded)) continue;
    // Find the FanOut that feeds this Join.
    const fanOut = fanOutNodes.find(
      (fo) => fo.joinNodeId === join.nodeId
    );
    if (fanOut === undefined) continue;
    const verdict = evaluateJoin(record, join, fanOut, atomicNodes);
    if (verdict === 'failed') {
      actions.push({ kind: 'escalate', code: join.outcomes.failed });
      continue;
    }
    if (verdict === 'proceed') {
      succeeded.add(join.nodeId);
    }
  }

  // Pass 2: classify each atomic node against the precomputed succeeded set.
  // Admit candidates are collected and then passed through workspace-compatible
  // selection (Step settle); non-admit candidates (Gate, suspend, escalate)
  // are emitted directly in the plan's stable topological order.
  // ECP-4: fan-out member atomic nodes are handled by the FanOut pass, not here.
  const admitCandidates: AdmissionCandidate[] = [];
  for (const node of atomicNodes) {
    // ECP-4: a node on a rejected choice branch is never eligible.
    if (excludedByChoice.has(node.nodeId)) continue;
    // Skip fan-out members — they are admitted via the FanOut pass.
    if (node.fanOut !== undefined) {
      // Check if this member should be admitted via FanOut pass.
      const isCandidate = fanOutMemberCandidates.some((c) => c.nodeId === node.nodeId);
      if (isCandidate) {
        admitCandidates.push({
          nodeId: node.nodeId,
          occurrence: occurrenceFor(record, node),
          admissionKind: node.admissionKind,
          access: node.workspace.access,
          ...(node.profilePath !== undefined ? { profilePath: node.profilePath } : {}),
        });
      }
      continue;
    }
    const disposition = dispositionFor(plan, record, node, succeeded);
    switch (disposition.status) {
      case 'pending':
      case 'gate-awaiting':
      case 'active':
      case 'blocked':
      case 'suspended-unsupported':
        // Not ready to emit a fresh candidate; it waits on a dependency, a
        // human, an active invocation, or an already-recorded suspend wait.
        break;
      case 'ready':
      case 'gate-decided-proceed':
        admitCandidates.push({
          nodeId: node.nodeId,
          occurrence: occurrenceFor(record, node),
          admissionKind: node.admissionKind,
          access: node.workspace.access,
          ...(node.profilePath !== undefined
            ? { profilePath: node.profilePath }
            : {}),
        });
        break;
      case 'gate-pending':
        actions.push(awaitGateFor(plan, node));
        break;
      case 'suspending-unsupported':
        actions.push({
          kind: 'suspend-unsupported',
          nodeId: node.nodeId,
          code: disposition.code,
        });
        break;
      case 'gate-decided-blocked':
        actions.push({
          kind: 'escalate',
          code: `gate_rejected_${disposition.gateId}`,
        });
        break;
      case 'failed':
      case 'succeeded':
        // Terminal per-node states produce no fresh candidate here. A failed
        // root node does not by itself terminate the Run; the facade or a
        // later failure/retry policy decides escalation.
        break;
    }
  }

  // Workspace-compatible admission selection. Atomic and bounded-loop
  // candidates are merged into a SINGLE selection call so the workspace lock
  // invariant is enforced across both — preventing two concurrent writers
  // from being admitted simultaneously in a mixed plan (Minor-2 fix).
  const lock = activeWorkspaceLock(record);
  const mergedCandidates: AdmissionCandidate[] = [
    ...admitCandidates,
    ...boundedLoopAdmitCandidates.map((c) => ({
      nodeId: c.nodeId,
      occurrence: c.occurrence,
      admissionKind: c.admissionKind,
      access: c.access,
    })),
  ];
  const selection = selectCompatibleAdmissions(mergedCandidates, lock);
  for (const candidate of selection.admitted) {
    // Check if this is a bounded-loop candidate (needs the reviewCycle payload).
    const boundedLoopOriginal = boundedLoopAdmitCandidates.find(
      (c) => c.nodeId === candidate.nodeId
    );
    if (boundedLoopOriginal !== undefined) {
      if (boundedLoopOriginal.bodyKind === 'review-cycle') {
        actions.push({
          kind: 'admit',
          nodeId: candidate.nodeId,
          occurrence: candidate.occurrence,
          admissionKind: candidate.admissionKind,
          access: candidate.access,
          profilePath: boundedLoopOriginal.descriptor.profilePath,
          input: {
            reviewCycle: {
              loopPath: boundedLoopOriginal.loopPath,
              round: boundedLoopOriginal.descriptor.round,
              phase: boundedLoopOriginal.descriptor.phase,
              openFindingIds: [...boundedLoopOriginal.openFindingIds],
            },
          },
        });
      } else if (boundedLoopOriginal.bodyKind === 'goal-cycle') {
        const goalInput = record.pipeline === 'task-loop'
          ? taskLoopActionInput({
              plan,
              record,
              loop: boundedLoopOriginal.loop,
              round: boundedLoopOriginal.descriptor.round,
              phase: boundedLoopOriginal.descriptor.phase as 'work' | 'judge',
            })
          : {
              goalCycle: {
                loopPath: boundedLoopOriginal.loopPath,
                round: boundedLoopOriginal.descriptor.round,
                phase: boundedLoopOriginal.descriptor.phase,
              },
            };
        actions.push({
          kind: 'admit',
          nodeId: candidate.nodeId,
          occurrence: candidate.occurrence,
          admissionKind: candidate.admissionKind,
          access: candidate.access,
          profilePath: boundedLoopOriginal.descriptor.profilePath,
          input: goalInput,
        });
      } else {
        // Composite-body admit: carry the profile path and composite payload.
        actions.push({
          kind: 'admit',
          nodeId: candidate.nodeId,
          occurrence: candidate.occurrence,
          admissionKind: candidate.admissionKind,
          access: candidate.access,
          profilePath: boundedLoopOriginal.descriptor.profilePath,
        });
      }
    } else {
      actions.push({
        kind: 'admit',
        nodeId: candidate.nodeId,
        occurrence: candidate.occurrence,
        admissionKind: candidate.admissionKind,
        access: candidate.access,
        ...(candidate.profilePath !== undefined
          ? { profilePath: candidate.profilePath }
          : {}),
      });
    }
  }
  if (selection.blocked.length > 0) {
    actions.push({
      kind: 'await-workspace',
      workspaceInstanceId: record.workspaceInstanceId,
      // Blocked candidates are provably never access:'none' (the selection
      // always admits access-none work), so the access narrows to read|write.
      intents: selection.blocked.map((candidate) => ({
        nodeId: candidate.nodeId,
        occurrence: candidate.occurrence,
        access: candidate.access as 'read' | 'write',
      })),
    });
  }

  const finish = finishCandidate(plan, record, succeeded, excludedByChoice);
  if (finish !== null) {
    actions.push(finish);
  }

  const classification: ReconcilerClassification =
    actions.length === 0 ? 'waiting' : 'running';

  return { ok: true, classification, actions: Object.freeze(actions) };
}

interface AdmissionCandidate {
  readonly nodeId: NodeId;
  readonly occurrence: number;
  readonly admissionKind: ReconcilerAdmissionKind;
  readonly access: 'none' | 'read' | 'write';
  readonly profilePath?: string;
}

interface BoundedLoopAdmitCandidate {
  readonly nodeId: NodeId;
  readonly occurrence: number;
  readonly admissionKind: ReconcilerAdmissionKind;
  readonly access: 'none' | 'read' | 'write';
  readonly loop: RuntimePlanBoundedLoopNode;
  readonly bodyKind: 'review-cycle' | 'composite' | 'goal-cycle';
  readonly descriptor: Readonly<{
    readonly round: number;
    readonly phase: string;
    readonly nodeId: NodeId;
    readonly profilePath: string;
  }>;
  readonly openFindingIds: readonly string[];
  readonly loopPath: string;
}

interface FanOutMemberCandidate {
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly required: boolean;
  readonly condition: string;
  readonly fanOutNodeId: NodeId;
}

/**
 * ECP-4: read the SUCCEEDED domain result for an evaluator nodeId.
 *
 * Status matters. A failed evaluator can still carry partial output — a choice
 * that crashed mid-analysis may leave `{ outcome: 'simple', error: ... }`, and
 * a fan-out condition that crashed leaves no member decision at all. Reading
 * those status-blind meant a FAILED choice selected a branch, and a FAILED
 * fan-out dispatched every member through `readActiveMembers`' all-active
 * fallback. Only a succeeded completion is a decision; anything else leaves the
 * evaluator unresolved.
 */
function succeededResultForNode(
  record: CanonicalRunRecord,
  nodeId: NodeId
): JsonValue | null {
  const actions = Object.values(record.actions).filter(
    (committed) =>
      committed.action.nodeId === nodeId &&
      committed.result !== undefined &&
      committed.result.status === 'succeeded'
  );
  if (actions.length === 0) return null;
  const withResult = actions[actions.length - 1];
  return withResult?.result?.result ?? null;
}

/**
 * ECP-4: the outcome a choice has actually committed, or `null` when it has
 * not resolved.
 *
 * A committed result only counts as a selection when it names one of the
 * choice's DECLARED outcomes. The facade rejects malformed evaluator results
 * (`validateChoiceCompletion`), but the kernel must not depend on that: an
 * unrecognised result previously still marked the choice succeeded, which
 * unblocked EVERY branch at once. Treating it as unresolved instead re-admits
 * the evaluator (bounded by the sealed attempt limit).
 */
function committedChoiceOutcome(
  record: CanonicalRunRecord,
  choice: RuntimePlanChoiceNode
): string | null {
  const committed = succeededResultForNode(record, choice.nodeId);
  if (committed === null) return null;
  const outcome = (committed as Readonly<{ outcome?: unknown }>).outcome;
  return typeof outcome === 'string' && choice.outcomes.includes(outcome)
    ? outcome
    : null;
}

/**
 * ECP-4: the nodes that belong to a choice branch the choice did NOT select.
 *
 * `choice.branches` maps each outcome to the hierarchical path of that
 * branch's entry node; a branch is that entry node plus everything
 * transitively downstream of it. Once the choice commits an outcome, every
 * node reachable ONLY from a rejected entry is permanently ineligible — it
 * must never be admitted, and it must not hold the implicit finish hostage.
 *
 * Without this, `finishCandidate` waits forever on the rejected branch, so a
 * choice Run can only "complete" by ALSO executing the branch it rejected.
 *
 * Nodes reachable from BOTH the selected and a rejected entry (a convergence
 * point authored after the branches rejoin) are NOT excluded: they stay gated
 * by their own `requires` like any other node.
 */
function choiceBranchExclusions(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  choiceNodes: readonly RuntimePlanChoiceNode[]
): ReadonlySet<NodeId> {
  const excluded = new Set<NodeId>();
  if (choiceNodes.length === 0) return excluded;
  const nodeIdByPath = new Map(
    plan.nodes.map((node) => [node.hierarchicalPath, node.nodeId] as const)
  );
  const dependents = new Map<NodeId, NodeId[]>();
  for (const node of plan.nodes) {
    for (const required of node.requires) {
      const existing = dependents.get(required);
      if (existing === undefined) dependents.set(required, [node.nodeId]);
      else existing.push(node.nodeId);
    }
  }
  const reachableFrom = (entries: readonly NodeId[]): Set<NodeId> => {
    const seen = new Set<NodeId>();
    const queue = [...entries];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of dependents.get(current) ?? []) queue.push(next);
    }
    return seen;
  };

  for (const choice of choiceNodes) {
    // Nothing is rejected until the evaluator commits a declared outcome;
    // before that every branch is blocked by its `requires` on the choice.
    const outcome = committedChoiceOutcome(record, choice);
    if (outcome === null) continue;
    const rejectedEntries: NodeId[] = [];
    for (const [branchOutcome, branchPath] of Object.entries(choice.branches)) {
      if (branchOutcome === outcome) continue;
      const rejectedId = nodeIdByPath.get(branchPath);
      if (rejectedId !== undefined) rejectedEntries.push(rejectedId);
    }
    if (rejectedEntries.length === 0) continue;
    const selectedPath = choice.branches[outcome];
    const selectedId =
      selectedPath === undefined ? undefined : nodeIdByPath.get(selectedPath);
    const selectedSubtree =
      selectedId === undefined ? new Set<NodeId>() : reachableFrom([selectedId]);
    for (const nodeId of reachableFrom(rejectedEntries)) {
      if (!selectedSubtree.has(nodeId)) excluded.add(nodeId);
    }
  }
  return excluded;
}

/**
 * ECP-4: a Join's non-member `requires` (upstream deps such as the FanOut node)
 * must be in the succeeded set before the Join is evaluated. Member readiness
 * is derived separately by {@link evaluateJoin}.
 */
function joinNonMemberRequiresSatisfied(
  join: RuntimePlanJoinNode,
  succeeded: ReadonlySet<NodeId>
): boolean {
  const memberNodeIds = new Set<NodeId>([
    ...join.requiredMembers,
    ...join.optionalMembers,
  ]);
  return join.requires
    .filter((req) => !memberNodeIds.has(req))
    .every((req) => succeeded.has(req));
}

/**
 * ECP-4: derive a Join's verdict purely from the Record.
 *
 * - `failed`   — an ACTIVE required member committed a failed result.
 * - `waiting`  — the FanOut condition is not committed yet, or some active
 *                member has no terminal result.
 * - `proceed`  — every active required member succeeded and every active
 *                optional member is terminal (a failed optional is suppressed).
 *
 * Shared by the succeeded-set closure and the Join candidate pass so the two
 * can never disagree about when the barrier opens.
 */
function evaluateJoin(
  record: CanonicalRunRecord,
  join: RuntimePlanJoinNode,
  fanOut: RuntimePlanFanOutNode,
  atomicNodes: readonly RuntimePlanAtomicNode[]
): 'failed' | 'waiting' | 'proceed' {
  const conditionResult = succeededResultForNode(record, fanOut.nodeId);
  if (conditionResult === null) return 'waiting';
  const activeMembers = readActiveMembers(conditionResult, fanOut);
  const memberState = (memberNodeId: NodeId) => {
    const memberPath = fanOut.members.find(
      (m) => m.nodeId === memberNodeId
    )?.hierarchicalPath;
    if (memberPath === undefined || !activeMembers.has(memberPath)) {
      return 'inactive' as const;
    }
    const memberNode = atomicNodes.find((n) => n.nodeId === memberNodeId);
    if (memberNode === undefined) return 'inactive' as const;
    const state = effectiveActionResult(record, memberNode);
    if (state === null) return 'non-terminal' as const;
    if (state.status === 'succeeded') return 'succeeded' as const;
    if (state.status === 'failed') return 'failed' as const;
    return 'non-terminal' as const; // active or blocked
  };

  let anyNonTerminal = false;
  for (const memberNodeId of join.requiredMembers) {
    const state = memberState(memberNodeId);
    if (state === 'failed') return 'failed';
    if (state === 'non-terminal') anyNonTerminal = true;
  }
  for (const memberNodeId of join.optionalMembers) {
    // A failed optional member is suppressed, not fatal.
    if (memberState(memberNodeId) === 'non-terminal') anyNonTerminal = true;
  }
  return anyNonTerminal ? 'waiting' : 'proceed';
}

/**
 * ECP-4: whether a bounded loop has reached its clean/satisfied terminal.
 * Mirrors the bounded-loop candidate pass so the succeeded-set closure and the
 * pass agree.
 */
function boundedLoopIsClean(
  plan: RuntimePlan,
  loop: RuntimePlanBoundedLoopNode,
  record: CanonicalRunRecord
): boolean {
  if (loop.body.kind === 'review-cycle') {
    return projectReviewCycleProgress(plan, loop, record).kind === 'clean';
  }
  if (loop.body.kind === 'goal-cycle') {
    return projectGoalCycleProgress(plan, loop, record).kind === 'satisfied';
  }
  return projectCompositeBodyProgress(plan, loop, record).kind === 'clean';
}

/**
 * Read the active member hierarchical paths from a FanOut condition result.
 */
function readActiveMembers(
  conditionResult: JsonValue,
  fanOut: RuntimePlanFanOutNode
): Set<string> {
  const result = new Set<string>();
  if (
    conditionResult !== null &&
    typeof conditionResult === 'object' &&
    !Array.isArray(conditionResult) &&
    'activeMembers' in conditionResult
  ) {
    const activeMembers = (conditionResult as Readonly<{ activeMembers?: unknown }>).activeMembers;
    if (Array.isArray(activeMembers)) {
      for (const member of activeMembers) {
        if (typeof member === 'string') result.add(member);
      }
    }
  } else {
    // If the condition result doesn't have activeMembers (e.g. simple result),
    // assume ALL members are active (the condition evaluator approved all).
    for (const member of fanOut.members) {
      result.add(member.hierarchicalPath);
    }
  }
  return result;
}

/**
 * ECP-4: an orchestration evaluator's attempt state, for the retry cap.
 *
 * `occurrenceForNodeId` counts EVERY invocation including one still in flight,
 * so using it as the cap counter escalated while the final permitted attempt
 * was still running — terminating a Run that was about to resolve and throwing
 * away live paid work. The cap must count only attempts that have actually
 * come back, and no verdict at all is due while one is active.
 */
function evaluatorAttempts(
  record: CanonicalRunRecord,
  nodeId: NodeId
): Readonly<{ active: boolean; committed: number }> {
  const actions = actionsForNode(record, nodeId);
  const committed = new Set(
    actions
      .filter((action) => action.result !== undefined)
      .map((action) => action.action.invocationId)
  );
  return {
    active: actions.some((action) => action.state === 'active'),
    committed: committed.size,
  };
}

/**
 * Count prior invocations for a nodeId (for choice/fan-out condition evaluators).
 */
function occurrenceForNodeId(
  record: CanonicalRunRecord,
  nodeId: NodeId
): number {
  const invocations = new Set(
    actionsForNode(record, nodeId).map(
      (committed) => committed.action.invocationId
    )
  );
  return invocations.size;
}

interface WorkspaceLock {
  readonly writerActive: boolean;
  readonly readerActive: boolean;
}

/**
 * Derive the current workspace lease state from the Record's active actions.
 * A writer excludes every other workspace touch; readers coexist. The pure
 * reconciler sees only this single-Run snapshot; the cross-Run registry that
 * also feeds this lock arrives in a later group.
 */
function activeWorkspaceLock(record: CanonicalRunRecord): WorkspaceLock {
  let writerActive = false;
  let readerActive = false;
  for (const committed of Object.values(record.actions)) {
    if (committed.state !== 'active') continue;
    const access = committed.action.workspace.access;
    if (access === 'write') writerActive = true;
    else if (access === 'read') readerActive = true;
  }
  return { writerActive, readerActive };
}

/**
 * Pure stable-NodeId compatible admission selection (design section 6).
 *
 * - `access:none` candidates join every batch and never block or be blocked.
 * - With an active writer, every ready reader/writer is blocked.
 * - With active readers (no writer), ready readers join and writers block.
 * - With no active workspace access, the first sorted workspace candidate sets
 *   the batch: a writer admits only itself; a reader admits all ready readers
 *   and leaves writers on the frontier.
 *
 * Blocked candidates are returned so the caller can persist one local
 * `workspace-reservation` wait. The result is identical for any insertion
 * order of the input — candidates are sorted by NodeId first.
 */
export function selectCompatibleAdmissions(
  candidates: readonly AdmissionCandidate[],
  lock: WorkspaceLock
): Readonly<{ admitted: readonly AdmissionCandidate[]; blocked: readonly AdmissionCandidate[] }> {
  const sorted = [...candidates].sort((left, right) =>
    left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0
  );
  const admitted: AdmissionCandidate[] = [];
  const blocked: AdmissionCandidate[] = [];
  const workspaceCandidates = sorted.filter(
    (candidate) => candidate.access !== 'none'
  );

  for (const candidate of sorted) {
    if (candidate.access === 'none') {
      admitted.push(candidate);
    }
  }

  if (lock.writerActive) {
    for (const candidate of workspaceCandidates) {
      blocked.push(candidate);
    }
    return Object.freeze({ admitted: Object.freeze(admitted), blocked: Object.freeze(blocked) });
  }

  if (lock.readerActive) {
    for (const candidate of workspaceCandidates) {
      if (candidate.access === 'read') admitted.push(candidate);
      else blocked.push(candidate);
    }
    return Object.freeze({ admitted: Object.freeze(admitted), blocked: Object.freeze(blocked) });
  }

  // No active workspace access: the first sorted workspace candidate sets the batch.
  if (workspaceCandidates.length === 0) {
    return Object.freeze({ admitted: Object.freeze(admitted), blocked: Object.freeze(blocked) });
  }
  const first = workspaceCandidates[0]!;
  if (first.access === 'write') {
    admitted.push(first);
    for (let index = 1; index < workspaceCandidates.length; index += 1) {
      blocked.push(workspaceCandidates[index]!);
    }
  } else {
    for (const candidate of workspaceCandidates) {
      if (candidate.access === 'read') admitted.push(candidate);
      else blocked.push(candidate);
    }
  }
  return Object.freeze({ admitted: Object.freeze(admitted), blocked: Object.freeze(blocked) });
}

function nodeSucceeded(
  record: CanonicalRunRecord,
  node: RuntimePlanAtomicNode
): boolean {
  const state = effectiveActionResult(record, node);
  if (state === null || state.status !== 'succeeded') {
    return false;
  }
  if (node.adaptiveVerify) {
    return state.route === 'simple';
  }
  return true;
}

function identityMismatch(
  plan: RuntimePlan,
  record: CanonicalRunRecord
): ReconcilerFailure | null {
  if (
    record.engine !== 'reconciler' ||
    record.runId !== plan.runId ||
    record.planDigest !== plan.planDigest ||
    record.executionProfileDigest !== plan.profileDigest ||
    record.sourceRevisionDigest !== plan.sourceRevisionDigest ||
    record.capabilityDigest !== plan.capabilityDigest ||
    record.policyDigest !== plan.policyDigest
  ) {
    return {
      code: 'plan_record_identity_mismatch',
      message:
        'The frozen runtime plan and canonical Record do not share one identity.',
    };
  }
  return null;
}

function actionsForNode(
  record: CanonicalRunRecord,
  nodeId: NodeId
): readonly CommittedAction[] {
  return Object.values(record.actions).filter(
    (committed) => committed.action.nodeId === nodeId
  );
}

function occurrenceFor(
  record: CanonicalRunRecord,
  node: RuntimePlanAtomicNode
): number {
  const invocations = new Set(
    actionsForNode(record, node.nodeId).map(
      (committed) => committed.action.invocationId
    )
  );
  return invocations.size;
}

/**
 * Count prior invocations for a bounded-loop phase nodeId. Each ReviewCycle
 * phase invocation gets its own nodeId (derived from the hierarchical path),
 * so the occurrence is typically 0 for the first admit of that exact phase
 * in that exact round.
 */
function occurrenceForBoundedLoop(
  record: CanonicalRunRecord,
  nodeId: NodeId
): number {
  const invocations = new Set(
    actionsForNode(record, nodeId).map(
      (committed) => committed.action.invocationId
    )
  );
  return invocations.size;
}

function effectiveActionResult(
  record: CanonicalRunRecord,
  node: RuntimePlanAtomicNode
):
  | Readonly<{
      status: 'active' | 'blocked' | 'succeeded' | 'failed';
      route?: unknown;
    }>
  | null {
  const actions = actionsForNode(record, node.nodeId);
  const active = actions.find((committed) => committed.state === 'active');
  if (active !== undefined) {
    return { status: 'active' };
  }
  const blocked = actions.find((committed) => committed.state === 'blocked');
  if (blocked !== undefined) {
    return { status: 'blocked' };
  }
  const withResult = actions.find((committed) => committed.result !== undefined);
  if (withResult?.result !== undefined) {
    return {
      status: withResult.result.status,
      route: adaptiveRoute(withResult.result.result),
    };
  }
  return null;
}

function adaptiveRoute(result: unknown): unknown {
  if (
    result !== null &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'route' in result
  ) {
    return (result as Readonly<{ route?: unknown }>).route;
  }
  return undefined;
}

function hasCapabilityUnavailableWait(
  record: CanonicalRunRecord,
  node: RuntimePlanAtomicNode
): boolean {
  return record.waits.some(
    (wait) => wait.kind === 'capability-unavailable' && 'nodeId' in wait && wait.nodeId === node.nodeId
  );
}

function dispositionFor(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  node: RuntimePlanAtomicNode,
  succeeded: ReadonlySet<NodeId>
): NodeDisposition {
  const actionState = effectiveActionResult(record, node);
  if (actionState !== null) {
    if (actionState.status === 'active') return { status: 'active' };
    if (actionState.status === 'blocked') return { status: 'blocked' };
    if (actionState.status === 'failed') return { status: 'failed' };
    if (actionState.status === 'succeeded') {
      if (node.adaptiveVerify && actionState.route !== 'simple') {
        if (hasCapabilityUnavailableWait(record, node)) {
          return { status: 'suspended-unsupported' };
        }
        return {
          status: 'suspending-unsupported',
          code:
            actionState.route === 'complex'
              ? 'review_cycle_capability_unavailable'
              : 'invalid_adaptive_route',
        };
      }
      return { status: 'succeeded' };
    }
  }

  if (!node.requires.every((required) => succeeded.has(required))) {
    return { status: 'pending' };
  }

  if (node.gate === undefined) {
    return { status: 'ready' };
  }
  return gateDisposition(plan, record, node);
}

function expectedGateWait(
  plan: RuntimePlan,
  node: RuntimePlanAtomicNode
): CanonicalWait {
  const invocationId = deriveInvocationId(plan.runId, node.nodeId, 0);
  return createCanonicalWait(plan.runId, {
    kind: 'gate',
    nodeId: node.nodeId,
    invocationId,
    occurrence: 0,
    gateId: node.gate!.gateId,
    decisionIds: [...node.gate!.decisionIds],
  });
}

function gateDisposition(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  node: RuntimePlanAtomicNode
): NodeDisposition {
  const expected = expectedGateWait(plan, node);
  const decided = record.transitions.find(
    (transition) =>
      transition.kind === 'GateDecided' && transition.waitId === expected.waitId
  );
  if (decided !== undefined && decided.kind === 'GateDecided') {
    const outcome = node.gate!.outcomes[decided.decisionId] ?? 'fail';
    return outcome === 'proceed'
      ? { status: 'gate-decided-proceed' }
      : { status: 'gate-decided-blocked', gateId: node.gate!.gateId };
  }
  const awaited = record.transitions.some(
    (transition) =>
      transition.kind === 'GateAwaiting' && transition.waitId === expected.waitId
  );
  if (awaited) {
    return { status: 'gate-awaiting' };
  }
  return { status: 'gate-pending' };
}

function awaitGateFor(
  plan: RuntimePlan,
  node: RuntimePlanAtomicNode
): ReconcilerNextAction {
  const wait = expectedGateWait(plan, node);
  return {
    kind: 'await-gate',
    nodeId: node.nodeId,
    gateId: node.gate!.gateId,
    waitId: wait.waitId as WaitId,
    decisionIds: [...node.gate!.decisionIds],
  };
}

function finishCandidate(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  succeeded: ReadonlySet<NodeId>,
  excludedByChoice: ReadonlySet<NodeId>
): ReconcilerNextAction | null {
  if (record.terminal !== undefined) {
    return null;
  }
  // Collect all non-finish node IDs that must be in the succeeded set before
  // the Run can finish. ECP-4: FanOut member atomic nodes (with `fanOut` tag)
  // are excluded — their gate is the Join node, not individual atomic success.
  // ECP-4: nodes on a rejected choice branch are excluded too — otherwise the
  // Run can only finish by ALSO executing the branch the choice rejected.
  const requiredNodes = plan.nodes.filter(
    (node) =>
      !excludedByChoice.has(node.nodeId) &&
      ((node.kind === 'atomic' && node.fanOut === undefined) ||
        node.kind === 'bounded-loop' ||
        node.kind === 'choice' ||
        node.kind === 'fan-out' ||
        node.kind === 'join')
  );
  if (plan.finishNode !== undefined) {
    if (plan.finishNode.requires.every((required) => succeeded.has(required))) {
      return { kind: 'finish', outcome: plan.finishNode.outcome };
    }
    return null;
  }
  if (plan.implicitFinishOutcome !== undefined) {
    if (requiredNodes.every((node) => succeeded.has(node.nodeId))) {
      return { kind: 'finish', outcome: plan.implicitFinishOutcome };
    }
  }
  return null;
}
