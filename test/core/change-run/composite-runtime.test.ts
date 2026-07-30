import { describe, expect, it } from 'vitest';

import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { projectCompositeBodyProgress } from '../../../src/core/change-run/internal/composite-runtime.js';
import { compositeBodyStagePath } from '../../../src/core/change-run/internal/composite-runtime.js';
import {
  deriveNodeId,
  deriveInvocationId,
  deriveAttemptId,
  deriveEffectId,
  deriveActionId,
} from '../../../src/core/change-run/internal/identity.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { startRecord, nodeIdFor, agentAction, fixtureDigests } from './reconciler-fixture.js';
import {
  reduceCanonicalRunRecord,
} from '../../../src/core/change-run/internal/reducer.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RunId, Digest } from '../../../src/core/change-run/contracts.js';

const branded = <T>(value: string): T => value as T;
const sha = (char: string) => branded<Digest>(`sha256:${char.repeat(64)}`);

function compositeLoopPlan(maxIterations = 2): RuntimePlan {
  return createRuntimePlan({
    runId: fixtureDigests.runId,
    pipeline: 'composite-test',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'done',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/loop',
        requires: [],
        maxIterations,
        body: {
          kind: 'composite',
          declarationId: 'decl',
          stages: [
            {
              hierarchicalPath: 'root/loop/a',
              profilePath: 'declaration:decl/node:a',
              admissionKind: 'agent',
              workspace: { access: 'write' },
              requires: [],
            },
            {
              hierarchicalPath: 'root/loop/b',
              profilePath: 'declaration:decl/node:b',
              admissionKind: 'agent',
              workspace: { access: 'write' },
              requires: ['root/loop/a'],
            },
          ],
          outcomes: { done: 'success' },
        },
        outcomes: { clean: 'success', exhausted: 'exhausted' },
      },
    ],
  });
}

/**
 * Simulate a succeeded body stage by creating an agent action for the per-round
 * nodeId and committing it as succeeded. Uses the same pattern as the
 * reconciler-fixture's agentAction + reduceCanonicalRunRecord.
 */
function commitStageSucceed(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  loopPath: string,
  round: number,
  stageHierarchicalPath: string
): CanonicalRunRecord {
  const perRoundPath = compositeBodyStagePath(loopPath, round, stageHierarchicalPath);
  const nodeId = deriveNodeId(plan.runId, perRoundPath);
  const invocationId = deriveInvocationId(plan.runId, nodeId, 0);
  const attemptId = deriveAttemptId(invocationId, 0);
  const effectId = deriveEffectId(invocationId, 'workspace');
  const actionId = deriveActionId(attemptId, 'agent', [{ slot: 'workspace', effectId }]);

  // Build a valid agent action using the same shape as the fixture.
  const action = {
    format: 'change-run-action/1' as const,
    kind: 'agent' as const,
    runId: plan.runId,
    nodeId,
    invocationId,
    attemptId,
    actionId,
    effects: [{
      slot: 'workspace',
      effectId,
      kind: 'workspace' as const,
      resource: 'worktree',
      recovery: 'suspend-if-ambiguous' as const,
      operation: {
        operationKey: 'workspace-effect',
        ownershipMarkerContract: 'effect-owner/1',
        conflictPolicy: 'uncertain',
      },
    }],
    executionProfileDigest: plan.profileDigest,
    capability: {
      id: 'skill:test',
      authoredVersion: '1',
      contractId: 'test',
      contractVersion: '1',
      contractDigest: fixtureDigests.capabilityDigest,
      artifact: { id: 'test', version: '1', contentDigest: fixtureDigests.capabilityDigest },
    },
    resultContractDigest: fixtureDigests.workspaceDigest,
    evidenceContractDigest: fixtureDigests.workspaceDigest,
    policyDigest: plan.policyDigest,
    workspace: { access: 'write' as const, resources: ['worktree'] },
    expectedBeforeWorkspace: record.currentWorkspaceRevision,
    agent: {
      role: 'implementer',
      model: 'sonnet',
      reasoningEffort: 'medium',
      runtime: 'codex',
      sandbox: 'workspace-write',
      input: { change: 'test' },
      session: { reuse: 'never', handoffTokenLimit: 10_000, reuseRoundLimit: 1 },
    },
  };

  // First admit the action.
  const admitResult = reduceCanonicalRunRecord(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  if (!admitResult.ok) throw new Error(`Admit failed: ${admitResult.failure.message}`);

  // Observe the workspace effect as succeeded.
  const observeResult = reduceCanonicalRunRecord(admitResult.record, {
    kind: 'observe-effect',
    actionId,
    effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence: [],
  });
  if (!observeResult.ok) throw new Error(`Observe failed: ${observeResult.failure.message}`);

  // Then commit it as succeeded.
  const commitResult = reduceCanonicalRunRecord(observeResult.record, {
    kind: 'commit-action-result',
    actionId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    result: { route: 'simple' },
    evidence: [],
  });
  if (!commitResult.ok) throw new Error(`Commit failed: ${commitResult.failure.message}`);
  return commitResult.record;
}

describe('projectCompositeBodyProgress', () => {
  it('first stage is ready on start', () => {
    const plan = compositeLoopPlan();
    const record = startRecord(plan);
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;
    const progress = projectCompositeBodyProgress(plan, loop, record);
    expect(progress.kind).toBe('ready');
    if (progress.kind !== 'ready') return;
    expect(progress.next.round).toBe(1);
    expect(progress.next.stage.hierarchicalPath).toBe('root/loop/a');
  });

  it('clean when exit outcome produced', () => {
    const plan = compositeLoopPlan(1);
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;
    let record = startRecord(plan);
    // Commit stage A succeeded.
    record = commitStageSucceed(plan, record, loop.hierarchicalPath, 1, 'root/loop/a');
    // Commit stage B succeeded.
    record = commitStageSucceed(plan, record, loop.hierarchicalPath, 1, 'root/loop/b');
    const progress = projectCompositeBodyProgress(plan, loop, record);
    expect(progress.kind).toBe('clean');
    if (progress.kind !== 'clean') return;
    expect(progress.outcome).toBe('success');
  });

  it('exhausted at maxIterations when outcome maps to continue', () => {
    // Use a plan where the body outcome maps to 'continue'.
    const plan = createRuntimePlan({
      runId: fixtureDigests.runId,
      pipeline: 'exhausted-test',
      planDigest: fixtureDigests.planDigest,
      profileDigest: fixtureDigests.profileDigest,
      sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
      capabilityDigest: fixtureDigests.capabilityDigest,
      policyDigest: fixtureDigests.policyDigest,
      implicitFinishOutcome: 'done',
      nodes: [
        {
          kind: 'bounded-loop',
          hierarchicalPath: 'root/loop',
          requires: [],
          maxIterations: 1,
          body: {
            kind: 'composite',
            declarationId: 'decl',
            stages: [
              {
                hierarchicalPath: 'root/loop/a',
                profilePath: 'declaration:decl/node:a',
                admissionKind: 'agent',
                workspace: { access: 'write' },
                requires: [],
              },
            ],
            outcomes: { retry: 'continue' },
          },
          outcomes: { clean: 'success', exhausted: 'exhausted' },
        },
      ],
    });
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;
    let record = startRecord(plan);
    record = commitStageSucceed(plan, record, loop.hierarchicalPath, 1, 'root/loop/a');
    const progress = projectCompositeBodyProgress(plan, loop, record);
    expect(progress.kind).toBe('exhausted');
  });
});

describe('reconcile — composite-body bounded-loop', () => {
  it('admits first body stage on start', () => {
    const plan = compositeLoopPlan();
    const record = startRecord(plan);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admits = result.actions.filter((a) => a.kind === 'admit');
    expect(admits).toHaveLength(1);
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;
    const stageAPath = compositeBodyStagePath(loop.hierarchicalPath, 1, 'root/loop/a');
    const expectedNodeId = deriveNodeId(plan.runId, stageAPath);
    expect(admits[0]!.nodeId).toBe(expectedNodeId);
  });

  it('classifies as running with one admit', () => {
    const plan = compositeLoopPlan();
    const record = startRecord(plan);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.classification).toBe('running');
  });

  it('emits escalate when exhausted', () => {
    const plan = createRuntimePlan({
      runId: fixtureDigests.runId,
      pipeline: 'exhausted-test',
      planDigest: fixtureDigests.planDigest,
      profileDigest: fixtureDigests.profileDigest,
      sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
      capabilityDigest: fixtureDigests.capabilityDigest,
      policyDigest: fixtureDigests.policyDigest,
      implicitFinishOutcome: 'done',
      nodes: [
        {
          kind: 'bounded-loop',
          hierarchicalPath: 'root/loop',
          requires: [],
          maxIterations: 1,
          body: {
            kind: 'composite',
            declarationId: 'decl',
            stages: [
              {
                hierarchicalPath: 'root/loop/a',
                profilePath: 'declaration:decl/node:a',
                admissionKind: 'agent',
                workspace: { access: 'write' },
                requires: [],
              },
            ],
            outcomes: { retry: 'continue' },
          },
          outcomes: { clean: 'success', exhausted: 'exhausted' },
        },
      ],
    });
    let record = startRecord(plan);
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;
    record = commitStageSucceed(plan, record, loop.hierarchicalPath, 1, 'root/loop/a');
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const escalates = result.actions.filter((a) => a.kind === 'escalate');
    expect(escalates).toHaveLength(1);
    expect(escalates[0]!.kind).toBe('escalate');
    if (escalates[0]!.kind === 'escalate') {
      expect(escalates[0]!.code).toBe('exhausted');
    }
  });
});
