import type {
  ActionId,
  AttemptId,
  ChangeInstanceId,
  Digest,
  EffectId,
  InvocationId,
  NodeId,
  PlanningSpaceId,
  RunAction,
  RunId,
  WorkspaceInstanceId,
  WorkspaceRevision,
} from '../../../src/core/change-run/index.js';
import {
  deriveActionId,
  deriveAttemptId,
  deriveEffectId,
  deriveInvocationId,
  deriveNodeId,
} from '../../../src/core/change-run/internal/identity.js';

const branded = <T>(value: string): T => value as T;

const runId = branded<RunId>(`run:${'4'.repeat(64)}`);
const nodeId = deriveNodeId(runId, 'root/apply');
const invocationId = deriveInvocationId(runId, nodeId, 0);
const attemptId = deriveAttemptId(invocationId, 0);
const effectId = deriveEffectId(invocationId, 'workspace');
const actionId = deriveActionId(attemptId, 'agent', [
  { slot: 'workspace', effectId },
]);

export const recordIds = {
  planningSpaceId: branded<PlanningSpaceId>(
    `planning-space:${'1'.repeat(64)}`
  ),
  changeInstanceId: branded<ChangeInstanceId>(
    `change-instance:${'2'.repeat(64)}`
  ),
  workspaceInstanceId: branded<WorkspaceInstanceId>(
    `workspace-instance:${'3'.repeat(64)}`
  ),
  runId,
  nodeId,
  invocationId,
  attemptId,
  actionId,
  effectId,
  digest: branded<Digest>(`sha256:${'b'.repeat(64)}`),
} as const;

export const recordRevision: WorkspaceRevision = {
  format: 'workspace-revision/1',
  head: { kind: 'commit', digest: recordIds.digest, detached: false },
  treeDigest: recordIds.digest,
  dirtyWorktreeDigest: recordIds.digest,
};

export function makeRecordAction(
  overrides: Partial<RunAction> = {}
): RunAction {
  return {
    format: 'change-run-action/1',
    kind: 'agent',
    runId: recordIds.runId,
    nodeId: recordIds.nodeId,
    invocationId: recordIds.invocationId,
    attemptId: recordIds.attemptId,
    actionId: recordIds.actionId,
    effects: [
      {
        slot: 'workspace',
        effectId: recordIds.effectId,
        kind: 'workspace',
        resource: 'worktree',
        recovery: 'suspend-if-ambiguous',
        operation: {
          operationKey: 'effect-operation',
          ownershipMarkerContract: 'effect-owner/1',
          conflictPolicy: 'uncertain',
        },
      },
    ],
    executionProfileDigest: recordIds.digest,
    capability: {
      id: 'skill:rasen-apply-change',
      authoredVersion: 'legacy',
      contractId: 'apply-change',
      contractVersion: '1',
      contractDigest: recordIds.digest,
      artifact: {
        id: 'rasen-apply-change',
        version: '1',
        contentDigest: recordIds.digest,
      },
    },
    resultContractDigest: recordIds.digest,
    evidenceContractDigest: recordIds.digest,
    policyDigest: recordIds.digest,
    workspace: { access: 'write', resources: ['worktree'] },
    expectedBeforeWorkspace: recordRevision,
    agent: {
      role: 'implementer',
      model: 'gpt-5',
      reasoningEffort: 'high',
      runtime: 'codex',
      sandbox: 'workspace-write',
      input: { change: 'fixture-change' },
      session: {
        reuse: 'never',
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
      },
    },
    ...overrides,
  } as RunAction;
}

export function makeDerivedRecordAction(
  occurrence: number,
  attemptOrdinal: number
): RunAction {
  const nextInvocationId = deriveInvocationId(
    recordIds.runId,
    recordIds.nodeId,
    occurrence
  );
  const nextAttemptId = deriveAttemptId(nextInvocationId, attemptOrdinal);
  const nextEffectId = deriveEffectId(nextInvocationId, 'workspace');
  const nextActionId = deriveActionId(nextAttemptId, 'agent', [
    { slot: 'workspace', effectId: nextEffectId },
  ]);
  return makeRecordAction({
    invocationId: nextInvocationId,
    attemptId: nextAttemptId,
    actionId: nextActionId,
    effects: [
      {
        ...makeRecordAction().effects[0]!,
        effectId: nextEffectId,
      },
    ],
  });
}

export function makeRecordEvidence(action = makeRecordAction()) {
  return {
    format: 'change-run-evidence-ref/1',
    store: 'change-run',
    evidenceDigest: recordIds.digest,
    contentDigest: recordIds.digest,
    mediaType: 'application/json',
    size: 4,
    observationKind: 'record-test',
    producer: {
      id: 'fixture',
      version: '1',
      identityDigest: recordIds.digest,
    },
    binding: {
      planningSpaceId: recordIds.planningSpaceId,
      changeInstanceId: recordIds.changeInstanceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      runId: recordIds.runId,
      actionId: action.actionId,
      schema: 'fixture/1',
    },
  } as const;
}
