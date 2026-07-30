/**
 * REVIEWER-ADDED TEST: verify workspace-lock invariant for FanOut members.
 *
 * Two FanOut members with WRITE access must go through selectCompatibleAdmissions
 * → only ONE admits (the workspace lock prevents concurrent writers).
 * This is the ECP-1 Minor-2 lesson extended to FanOut members.
 */
import { describe, expect, it } from 'vitest';

import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { JsonValue, NodeId, RunAction, RunId } from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<never>(`sha256:${char.repeat(64)}`);
const RUN_ID = branded<RunId>(`run:${'0a'.repeat(32)}`);

function workspaceLockPlanInput(opts?: {
  cap?: number;
  memberAcess?: ('write' | 'read')[];
}): RuntimePlanInput {
  const cap = opts?.cap ?? 2;
  const access = opts?.memberAcess ?? ['write', 'write'];
  return {
    runId: RUN_ID,
    pipeline: 'workspace-lock-test',
    planDigest: digest('2') as never,
    profileDigest: digest('3') as never,
    sourceRevisionDigest: digest('4') as never,
    capabilityDigest: digest('5') as never,
    policyDigest: digest('6') as never,
    implicitFinishOutcome: 'done',
    nodes: [
      {
        kind: 'fan-out',
        hierarchicalPath: 'root:parallel',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'none' },
        fanOut: {
          members: [
            { hierarchicalPath: 'root:parallel/a', required: true, condition: 'always' },
            { hierarchicalPath: 'root:parallel/b', required: true, condition: 'always' },
          ],
          concurrencyCap: cap,
          budget: 2,
          joinNodeId: 'root:parallel-join',
        },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:parallel/a',
        requires: ['root:parallel'],
        admissionKind: 'agent',
        workspace: { access: access[0]! },
        fanOutTag: { nodeId: 'root:parallel', required: true },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:parallel/b',
        requires: ['root:parallel'],
        admissionKind: 'agent',
        workspace: { access: access[1]! },
        fanOutTag: { nodeId: 'root:parallel', required: true },
      },
      {
        kind: 'join',
        hierarchicalPath: 'root:parallel-join',
        requires: ['root:parallel/a', 'root:parallel/b'],
        join: {
          requiredMembers: ['root:parallel/a', 'root:parallel/b'],
          optionalMembers: [],
          outcomes: { proceed: 'done', failed: 'failed' },
        },
      },
    ],
  };
}

function apply(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`fixture reducer failed (${result.failure.code}): ${result.failure.message}`);
  }
  return result.record;
}

function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true },
  status: 'succeeded' | 'failed' = 'succeeded'
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  let next = apply(plan, record, {
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
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
  return next;
}

describe('REVIEWER: workspace-lock invariant for FanOut members', () => {
  it('two WRITE-access FanOut members → only ONE admitted (workspace lock)', () => {
    const plan = createRuntimePlan(workspaceLockPlanInput({ cap: 2, memberAcess: ['write', 'write'] }));
    let record = startRecord(plan);

    // Commit FanOut condition (both members active)
    record = commitNode(plan, record, 'root:parallel', {
      activeMembers: ['root:parallel/a', 'root:parallel/b'],
      inactiveMembers: [],
      rationale: {},
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admits = result.actions.filter((a) => a.kind === 'admit');
    const memberAdmits = admits.filter((a) =>
      plan.nodes.some(
        (n) => n.kind === 'atomic' && n.nodeId === a.nodeId && n.fanOut !== undefined
      )
    );
    // Workspace lock: only 1 writer admitted
    expect(memberAdmits.length).toBe(1);

    // The other should be blocked via await-workspace
    const workspaceWaits = result.actions.filter((a) => a.kind === 'await-workspace');
    expect(workspaceWaits.length).toBeGreaterThanOrEqual(1);
  });

  it('two READ-access FanOut members → BOTH admitted (readers coexist)', () => {
    const plan = createRuntimePlan(workspaceLockPlanInput({ cap: 2, memberAcess: ['read', 'read'] }));
    let record = startRecord(plan);

    record = commitNode(plan, record, 'root:parallel', {
      activeMembers: ['root:parallel/a', 'root:parallel/b'],
      inactiveMembers: [],
      rationale: {},
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const admits = result.actions.filter((a) => a.kind === 'admit');
    const memberAdmits = admits.filter((a) =>
      plan.nodes.some(
        (n) => n.kind === 'atomic' && n.nodeId === a.nodeId && n.fanOut !== undefined
      )
    );
    // Both read-access members should be admitted (readers coexist under the lock)
    expect(memberAdmits.length).toBe(2);
  });
});
