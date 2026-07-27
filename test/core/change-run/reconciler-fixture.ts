import {
  createCanonicalRunRecord,
  type CanonicalRunRecord,
  type CanonicalRecordLimits,
} from '../../../src/core/change-run/internal/record.js';
import {
  reduceCanonicalRunRecord,
} from '../../../src/core/change-run/internal/reducer.js';
import {
  createCanonicalWait,
  type CanonicalWait,
} from '../../../src/core/change-run/internal/waits.js';
import {
  deriveActionId,
  deriveAttemptId,
  deriveEffectId,
  deriveInvocationId,
  deriveNodeId,
} from '../../../src/core/change-run/internal/identity.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import type {
  AttemptId,
  ActionId,
  Digest,
  EffectId,
  EvidenceRef,
  InvocationId,
  JsonValue,
  NodeId,
  RunAction,
  RunId,
  WaitId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;

export const fixtureDigests = {
  runId: branded<RunId>(`run:${'a'.repeat(64)}`),
  launchRequestDigest: branded<Digest>(`sha256:${'1'.repeat(64)}`),
  planDigest: branded<Digest>(`sha256:${'2'.repeat(64)}`),
  profileDigest: branded<Digest>(`sha256:${'3'.repeat(64)}`),
  sourceRevisionDigest: branded<Digest>(`sha256:${'4'.repeat(64)}`),
  capabilityDigest: branded<Digest>(`sha256:${'5'.repeat(64)}`),
  policyDigest: branded<Digest>(`sha256:${'6'.repeat(64)}`),
  receiptDigest: branded<Digest>(`sha256:${'d'.repeat(64)}`),
  workspaceDigest: branded<Digest>(`sha256:${'c'.repeat(64)}`),
} as const;

export const fixtureWorkspaceRevision = {
  format: 'workspace-revision/1',
  head: {
    kind: 'commit',
    digest: fixtureDigests.workspaceDigest,
    detached: false,
  },
  treeDigest: fixtureDigests.workspaceDigest,
  dirtyWorktreeDigest: fixtureDigests.workspaceDigest,
} as const;

export const fixtureLimits: CanonicalRecordLimits = {
  maxAttempts: 12,
  maxActions: 64,
  maxRecordRevisions: 256,
  maxTransitions: 4096,
  maxEvidenceRefsPerAction: 16,
  limitOutcome: 'escalated',
};

/**
 * The built-in bug-fix root DAG used to dogfood the pure reconciler:
 * propose[gate] -> apply[gate] -> verify[adaptive] -> ship[gate] -> archive,
 * with an implicit root finish once every atomic stage has succeeded.
 */
const BUG_FIX_PATHS = [
  'root/propose',
  'root/apply',
  'root/verify',
  'root/ship',
  'root/archive',
] as const;

const GATE_DECISIONS = ['approve', 'reject'] as const;
const GATE_OUTCOMES = { approve: 'proceed', reject: 'escalate' } as const;

export function bugFixPlanInput(): RuntimePlanInput {
  return {
    runId: fixtureDigests.runId,
    pipeline: 'bug-fix',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'bug-fix-completed',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: BUG_FIX_PATHS[0],
        requires: [],
        admissionKind: 'agent',
        gate: {
          gateId: 'propose-gate',
          decisionIds: [...GATE_DECISIONS],
          outcomes: { ...GATE_OUTCOMES },
        },
      },
      {
        kind: 'atomic',
        hierarchicalPath: BUG_FIX_PATHS[1],
        requires: [BUG_FIX_PATHS[0]],
        admissionKind: 'agent',
        gate: {
          gateId: 'apply-gate',
          decisionIds: [...GATE_DECISIONS],
          outcomes: { ...GATE_OUTCOMES },
        },
      },
      {
        kind: 'atomic',
        hierarchicalPath: BUG_FIX_PATHS[2],
        requires: [BUG_FIX_PATHS[1]],
        admissionKind: 'agent',
        adaptiveVerify: true,
      },
      {
        kind: 'atomic',
        hierarchicalPath: BUG_FIX_PATHS[3],
        requires: [BUG_FIX_PATHS[2]],
        admissionKind: 'agent',
        gate: {
          gateId: 'ship-gate',
          decisionIds: [...GATE_DECISIONS],
          outcomes: { ...GATE_OUTCOMES },
        },
      },
      {
        kind: 'atomic',
        hierarchicalPath: BUG_FIX_PATHS[4],
        requires: [BUG_FIX_PATHS[3]],
        admissionKind: 'agent',
      },
    ],
  };
}

export function bugFixPlan(): RuntimePlan {
  return createRuntimePlan(bugFixPlanInput());
}

export function nodeIdFor(plan: RuntimePlan, path: string): NodeId {
  return deriveNodeId(plan.runId, path);
}

/**
 * Build a valid agent RunAction for a root node. The reconciler only reads
 * identity/state from committed actions, so the capability/policy/input body
 * is fixture data; the identity equations must hold so the reducer admits it.
 */
export function agentAction(
  plan: RuntimePlan,
  path: string,
  occurrence = 0
): RunAction {
  const nodeId = nodeIdFor(plan, path);
  const invocationId = deriveInvocationId(plan.runId, nodeId, occurrence);
  const attemptId = deriveAttemptId(invocationId, 0);
  const effectId = deriveEffectId(invocationId, 'workspace');
  const actionId = deriveActionId(attemptId, 'agent', [
    { slot: 'workspace', effectId },
  ]);
  return {
    format: 'change-run-action/1',
    kind: 'agent',
    runId: plan.runId,
    nodeId,
    invocationId,
    attemptId,
    actionId,
    effects: [
      {
        slot: 'workspace',
        effectId,
        kind: 'workspace',
        resource: 'worktree',
        recovery: 'suspend-if-ambiguous',
        operation: {
          operationKey: 'workspace-effect',
          ownershipMarkerContract: 'effect-owner/1',
          conflictPolicy: 'uncertain',
        },
      },
    ],
    executionProfileDigest: plan.profileDigest,
    capability: {
      id: `skill:${path}`,
      authoredVersion: 'legacy',
      contractId: path,
      contractVersion: '1',
      contractDigest: fixtureDigests.capabilityDigest,
      artifact: {
        id: path,
        version: '1',
        contentDigest: fixtureDigests.capabilityDigest,
      },
    },
    resultContractDigest: fixtureDigests.workspaceDigest,
    evidenceContractDigest: fixtureDigests.workspaceDigest,
    policyDigest: plan.policyDigest,
    workspace: { access: 'write', resources: ['worktree'] },
    expectedBeforeWorkspace: fixtureWorkspaceRevision,
    agent: {
      role: 'implementer',
      model: 'sonnet',
      reasoningEffort: 'medium',
      runtime: 'codex',
      sandbox: 'workspace-write',
      input: { change: path } as JsonValue,
      session: {
        reuse: 'never',
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
      },
    },
  } as RunAction;
}

export function gateWait(plan: RuntimePlan, path: string): CanonicalWait {
  const nodeId = nodeIdFor(plan, path);
  const invocationId = deriveInvocationId(plan.runId, nodeId, 0);
  const node = plan.nodes.find((entry) => entry.nodeId === nodeId);
  if (node === undefined || node.kind !== 'atomic' || node.gate === undefined) {
    throw new Error(`fixture: ${path} is not a gated node`);
  }
  return createCanonicalWait(plan.runId, {
    kind: 'gate',
    nodeId,
    invocationId,
    occurrence: 0,
    gateId: node.gate.gateId,
    decisionIds: [...node.gate.decisionIds],
  });
}

export function evidenceFor(
  plan: RuntimePlan,
  actionId: ActionId | string
): readonly EvidenceRef[] {
  return [
    {
      format: 'change-run-evidence-ref/1',
      store: 'change-run',
      evidenceDigest: fixtureDigests.receiptDigest,
      contentDigest: fixtureDigests.receiptDigest,
      mediaType: 'application/json',
      size: 4,
      observationKind: 'reconciler-fixture',
      producer: {
        id: 'fixture',
        version: '1',
        identityDigest: fixtureDigests.receiptDigest,
      },
      binding: {
        planningSpaceId: branded('planning-space:' + '1'.repeat(64)),
        changeInstanceId: branded('change-instance:' + '2'.repeat(64)),
        projectId: 'project-fixture',
        changeId: 'fixture-change',
        runId: plan.runId,
        actionId: actionId as ActionId,
        schema: 'fixture/1',
      },
    },
  ];
}

export function startRecord(plan: RuntimePlan): CanonicalRunRecord {
  return createCanonicalRunRecord({
    runId: plan.runId,
    runOrdinal: 1,
    change: {
      planningSpaceId: branded('planning-space:' + '1'.repeat(64)),
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: branded('change-instance:' + '2'.repeat(64)),
    },
    workspaceInstanceId: branded('workspace-instance:' + '3'.repeat(64)),
    pipeline: plan.pipeline,
    launchRequestDigest: fixtureDigests.launchRequestDigest,
    planDigest: plan.planDigest,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    capabilityDigest: plan.capabilityDigest,
    policyDigest: plan.policyDigest,
    executionProfileDigest: plan.profileDigest,
    initialWorkspaceRevision: fixtureWorkspaceRevision,
    inputs: {},
    limits: fixtureLimits,
  });
}

type Stimulus = Parameters<typeof reduceCanonicalRunRecord>[1];

function apply(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  stimulus: Stimulus
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(
      `fixture reducer failed (${result.failure.code}): ${result.failure.message}`
    );
  }
  return result.record;
}

/** Resolve every prior gate + admit + succeed the named root node. */
export function succeedNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true }
): CanonicalRunRecord {
  let next = record;
  const node = plan.nodes.find((entry) => entry.hierarchicalPath === path);
  if (node === undefined || node.kind !== 'atomic') {
    throw new Error(`fixture: unknown atomic path ${path}`);
  }
  if (node.gate !== undefined) {
    const wait = gateWait(plan, path);
    next = apply(plan, next, { kind: 'await-gate', wait });
    next = apply(plan, next, {
      kind: 'decide-gate',
      waitId: wait.waitId,
      decisionId: 'approve',
      outcome: 'approve',
    });
  }
  const action = agentAction(plan, path);
  next = apply(plan, next, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(plan, next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true } as JsonValue,
    evidence: evidenceFor(plan, action.actionId),
  });
  next = apply(plan, next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
  return next;
}

/** Await (and optionally decide) a gate for the named root node. */
export function awaitGate(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string
): CanonicalRunRecord {
  return apply(plan, record, { kind: 'await-gate', wait: gateWait(plan, path) });
}

export function decideGate(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  decisionId: 'approve' | 'reject'
): CanonicalRunRecord {
  const wait = gateWait(plan, path);
  return apply(plan, record, {
    kind: 'decide-gate',
    waitId: wait.waitId,
    decisionId,
    outcome: decisionId,
  });
}

export function admitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  return apply(plan, record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
}

export {
  type AttemptId,
  type ActionId,
  type EffectId,
  type InvocationId,
  type WaitId,
};
