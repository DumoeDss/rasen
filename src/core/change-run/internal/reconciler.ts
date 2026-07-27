import type {
  NodeId,
  WaitId,
} from '../contracts.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';
import type { RuntimePlan, RuntimePlanAtomicNode } from './runtime-plan.js';
import {
  createCanonicalWait,
  type CanonicalWait,
} from './waits.js';
import { deriveInvocationId } from './identity.js';

export type ReconcilerAdmissionKind = 'agent' | 'command' | 'host';

export type ReconcilerNextAction =
  | Readonly<{
      kind: 'admit';
      nodeId: NodeId;
      occurrence: number;
      admissionKind: ReconcilerAdmissionKind;
    }>
  | Readonly<{
      kind: 'await-gate';
      nodeId: NodeId;
      gateId: string;
      waitId: WaitId;
      decisionIds: readonly string[];
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
  const succeeded = new Set<NodeId>();
  for (const node of atomicNodes) {
    if (nodeSucceeded(record, node)) {
      succeeded.add(node.nodeId);
    }
  }

  // Pass 2: classify each node against the precomputed succeeded set and emit
  // candidates in the plan's stable topological order.
  const actions: ReconcilerNextAction[] = [];
  for (const node of atomicNodes) {
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
        actions.push({
          kind: 'admit',
          nodeId: node.nodeId,
          occurrence: occurrenceFor(record, node),
          admissionKind: node.admissionKind,
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

  const finish = finishCandidate(plan, record, succeeded);
  if (finish !== null) {
    actions.push(finish);
  }

  const classification: ReconcilerClassification =
    actions.length === 0 ? 'waiting' : 'running';

  return { ok: true, classification, actions: Object.freeze(actions) };
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
  succeeded: ReadonlySet<NodeId>
): ReconcilerNextAction | null {
  if (record.terminal !== undefined) {
    return null;
  }
  if (plan.finishNode !== undefined) {
    if (plan.finishNode.requires.every((required) => succeeded.has(required))) {
      return { kind: 'finish', outcome: plan.finishNode.outcome };
    }
    return null;
  }
  if (plan.implicitFinishOutcome !== undefined) {
    const atomicNodes = plan.nodes.filter(
      (node): node is RuntimePlanAtomicNode => node.kind === 'atomic'
    );
    if (atomicNodes.every((node) => succeeded.has(node.nodeId))) {
      return { kind: 'finish', outcome: plan.implicitFinishOutcome };
    }
  }
  return null;
}
