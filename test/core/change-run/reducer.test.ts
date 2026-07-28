import { describe, expect, it } from 'vitest';

import {
  createCanonicalRunRecord,
  digestCanonicalRunRecord,
  type CanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import {
  decodeRunStimulus,
  reduceCanonicalRunRecord,
  type RunStimulus,
} from '../../../src/core/change-run/internal/reducer.js';
import { createCanonicalWait } from '../../../src/core/change-run/internal/waits.js';
import {
  makeDerivedRecordAction,
  makeRecordAction,
  makeRecordEvidence,
  recordIds,
  recordRevision,
} from './record-fixture.js';

function initial(
  limitOverrides: Partial<CanonicalRunRecord['limits']> = {}
): CanonicalRunRecord {
  return createCanonicalRunRecord({
    runId: recordIds.runId,
    runOrdinal: 0,
    change: {
      planningSpaceId: recordIds.planningSpaceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: recordIds.changeInstanceId,
    },
    workspaceInstanceId: recordIds.workspaceInstanceId,
    pipeline: 'bug-fix',
    launchRequestDigest: recordIds.digest,
    planDigest: recordIds.digest,
    sourceRevisionDigest: recordIds.digest,
    capabilityDigest: recordIds.digest,
    policyDigest: recordIds.digest,
    executionProfileDigest: recordIds.digest,
    initialWorkspaceRevision: recordRevision,
    inputs: {},
    limits: {
      maxAttempts: 3,
      maxActions: 8,
      maxRecordRevisions: 32,
      maxTransitions: 32,
      maxEvidenceRefsPerAction: 4,
      limitOutcome: 'escalated',
      ...limitOverrides,
    },
  });
}

function reduce(record: CanonicalRunRecord, stimulus: RunStimulus) {
  const before = JSON.stringify(record);
  const result = reduceCanonicalRunRecord(record, stimulus);
  expect(JSON.stringify(record)).toBe(before);
  expect(Object.isFrozen(record)).toBe(true);
  return result;
}

describe('canonical Run reducer', () => {
  it('admits, grants, observes effects/results, and increments one immutable revision', () => {
    const action = makeRecordAction();
    const admitted = reduce(initial(), {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'defer',
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    expect(admitted.record.recordVersion).toBe(1);
    expect(admitted.record.actions[action.actionId]?.deliveryState).toBe(
      'admitted_undelivered'
    );
    expect(admitted.record.counters).toEqual({
      attempts: 1,
      actions: 1,
      transitions: 2,
    });

    const granted = reduce(admitted.record, {
      kind: 'grant-action',
      actionId: action.actionId,
    });
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    expect(granted.record.actions[action.actionId]?.deliveryState).toBe(
      'granted'
    );

    const effect = reduce(granted.record, {
      kind: 'observe-effect',
      actionId: action.actionId,
      effectId: recordIds.effectId,
      status: 'succeeded',
      receiptDigest: recordIds.digest,
      observation: { owned: true },
      evidence: [],
    });
    expect(effect.ok).toBe(true);
    if (!effect.ok) return;
    expect(effect.record.actions[action.actionId]?.effects[0]?.state).toBe(
      'succeeded'
    );

    const completed = reduce(effect.record, {
      kind: 'commit-action-result',
      actionId: action.actionId,
      status: 'succeeded',
      receiptDigest: recordIds.digest,
      result: { route: 'simple' },
      evidence: [],
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.record.actions[action.actionId]?.state).toBe('closed');
    expect(completed.record.actions[action.actionId]?.deliveryState).toBe(
      'closed'
    );
    expect(completed.record.previousRecordDigest).toBe(
      digestCanonicalRunRecord(effect.record)
    );
  });

  it('enforces illegal ordering without mutation', () => {
    const action = makeRecordAction();
    const original = initial();
    const result = reduce(original, {
      kind: 'grant-action',
      actionId: action.actionId,
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'action_not_active' },
    });
    expect(original.recordVersion).toBe(0);

    const admitted = reduce(original, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const duplicate = reduce(admitted.record, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    expect(duplicate).toMatchObject({
      ok: false,
      failure: { code: 'illegal_transition' },
    });
  });

  it('binds Gate decisions, wait resume, and workspace acceptance to the active WaitId', () => {
    const gate = createCanonicalWait(recordIds.runId, {
      kind: 'gate',
      nodeId: recordIds.nodeId,
      invocationId: recordIds.invocationId,
      occurrence: 0,
      gateId: 'approval',
      decisionIds: ['approve', 'reject'],
    });
    const awaiting = reduce(initial(), { kind: 'await-gate', wait: gate });
    expect(awaiting.ok).toBe(true);
    if (!awaiting.ok) return;

    const wrong = reduce(awaiting.record, {
      kind: 'decide-gate',
      waitId: `wait:${'f'.repeat(64)}`,
      decisionId: 'approve',
      outcome: 'continue',
    } as RunStimulus);
    expect(wrong).toMatchObject({
      ok: false,
      failure: { code: 'wait_identity_conflict' },
    });

    const decided = reduce(awaiting.record, {
      kind: 'decide-gate',
      waitId: gate.waitId,
      decisionId: 'approve',
      outcome: 'continue',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.record.waits).toEqual([]);
    const closedWait = reduce(decided.record, {
      kind: 'decide-gate',
      waitId: gate.waitId,
      decisionId: 'approve',
      outcome: 'continue',
    });
    expect(closedWait).toMatchObject({
      ok: false,
      failure: { code: 'wait_identity_conflict' },
    });

    const drift = createCanonicalWait(recordIds.runId, {
      kind: 'workspace-drift',
      workspaceInstanceId: recordIds.workspaceInstanceId,
      expected: recordRevision,
      observed: {
        ...recordRevision,
        treeDigest: `sha256:${'c'.repeat(64)}`,
      },
    });
    const suspended = reduce(decided.record, {
      kind: 'suspend',
      wait: drift,
    });
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) return;
    const ordinaryResume = reduce(suspended.record, {
      kind: 'resume-wait',
      waitId: drift.waitId,
    });
    expect(ordinaryResume).toMatchObject({
      ok: false,
      failure: { code: 'control_not_allowed' },
    });
    const accepted = reduce(suspended.record, {
      kind: 'accept-workspace-revision',
      waitId: drift.waitId,
      revision: drift.observed,
      evidence: [makeRecordEvidence()],
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.record.currentWorkspaceRevision).toEqual(drift.observed);
  });

  it('keeps concurrent waits branch-local and closes only the addressed wait', () => {
    const gateA = createCanonicalWait(recordIds.runId, {
      kind: 'gate',
      nodeId: recordIds.nodeId,
      invocationId: recordIds.invocationId,
      occurrence: 0,
      gateId: 'a',
      decisionIds: ['approve'],
    });
    const gateB = createCanonicalWait(recordIds.runId, {
      kind: 'gate',
      nodeId: recordIds.nodeId,
      invocationId: recordIds.invocationId,
      occurrence: 1,
      gateId: 'b',
      decisionIds: ['approve'],
    });
    const one = reduce(initial(), { kind: 'await-gate', wait: gateA });
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const two = reduce(one.record, { kind: 'await-gate', wait: gateB });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.record.waits.map((wait) => wait.waitId)).toEqual(
      [gateA.waitId, gateB.waitId].sort()
    );

    const decided = reduce(two.record, {
      kind: 'decide-gate',
      waitId: gateA.waitId,
      decisionId: 'approve',
      outcome: 'continue',
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.record.waits).toEqual([gateB]);
  });

  it('commits bounded terminal outcomes at action, attempt, or transition limits', () => {
    const action = makeRecordAction();
    const atActionLimit = initial({ maxAttempts: 1, maxActions: 0 });
    const actionLimited = reduce(atActionLimit, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    expect(actionLimited.ok).toBe(true);
    if (!actionLimited.ok) return;
    expect(actionLimited.record.status).toBe('escalated');
    expect(actionLimited.record.terminal).toMatchObject({
      kind: 'escalated',
      code: 'execution_budget_exhausted',
    });
    expect(actionLimited.record.actions).toEqual({});

    const first = reduce(
      initial({ maxAttempts: 1, maxActions: 4 }),
      {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      }
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const attemptLimited = reduce(first.record, {
      kind: 'admit-action',
      action: makeDerivedRecordAction(1, 0),
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    expect(attemptLimited.ok).toBe(true);
    if (!attemptLimited.ok) return;
    expect(attemptLimited.record.status).toBe('escalated');
    expect(attemptLimited.record.counters.attempts).toBe(1);

    const evidenceBase = reduce(
      initial({ maxEvidenceRefsPerAction: 0 }),
      {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      }
    );
    expect(evidenceBase.ok).toBe(true);
    if (!evidenceBase.ok) return;
    const evidenceLimited = reduce(evidenceBase.record, {
      kind: 'observe-effect',
      actionId: action.actionId,
      effectId: recordIds.effectId,
      status: 'succeeded',
      receiptDigest: recordIds.digest,
      observation: { owned: true },
      evidence: [makeRecordEvidence(action)],
    });
    expect(evidenceLimited.ok).toBe(true);
    if (!evidenceLimited.ok) return;
    expect(evidenceLimited.record.status).toBe('escalated');

    const revisionBase = reduce(
      initial({ maxRecordRevisions: 3 }),
      {
        kind: 'await-gate',
        wait: createCanonicalWait(recordIds.runId, {
          kind: 'gate',
          nodeId: recordIds.nodeId,
          invocationId: recordIds.invocationId,
          occurrence: 0,
          gateId: 'revision-budget',
          decisionIds: ['approve'],
        }),
      }
    );
    expect(revisionBase.ok).toBe(true);
    if (!revisionBase.ok) return;
    expect(revisionBase.record.recordVersion).toBe(1);
    const revisionLimited = reduce(revisionBase.record, {
      kind: 'await-gate',
      wait: createCanonicalWait(recordIds.runId, {
        kind: 'gate',
        nodeId: recordIds.nodeId,
        invocationId: recordIds.invocationId,
        occurrence: 1,
        gateId: 'revision-budget-final',
        decisionIds: ['approve'],
      }),
    });
    expect(revisionLimited.ok).toBe(true);
    if (!revisionLimited.ok) return;
    expect(revisionLimited.record.recordVersion).toBe(2);
    expect(revisionLimited.record.status).toBe('escalated');
    expect(revisionLimited.record.terminal).toMatchObject({
      code: 'execution_budget_exhausted',
    });

    const transitionLimited = initial({ maxTransitions: 2 });
    const once = reduce(transitionLimited, {
      kind: 'await-gate',
      wait: createCanonicalWait(recordIds.runId, {
        kind: 'gate',
        nodeId: recordIds.nodeId,
        invocationId: recordIds.invocationId,
        occurrence: 0,
        gateId: 'approval',
        decisionIds: ['approve'],
      }),
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(once.record.status).toBe('escalated');
    expect(once.record.transitions).toHaveLength(2);
  });

  it('supports infrastructure observation, cancellation, escalation, and finish as terminal transitions', () => {
    const cases: readonly RunStimulus[] = [
      { kind: 'escalate', code: 'operator', reason: 'needs review' },
      { kind: 'cancel', reason: 'operator request' },
      { kind: 'finish', outcome: 'success' },
    ];
    for (const stimulus of cases) {
      const result = reduce(initial(), stimulus);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(['escalated', 'cancelled', 'completed']).toContain(
        result.record.status
      );
      expect(result.record.waits).toEqual([]);
    }

    const action = makeRecordAction();
    const admitted = reduce(initial(), {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const infra = reduce(admitted.record, {
      kind: 'observe-infrastructure',
      actionId: action.actionId,
      receiptDigest: recordIds.digest,
      code: 'spawn_failed',
      retryable: true,
      artifactDigest: recordIds.digest,
      evidence: [],
    });
    expect(infra.ok).toBe(true);
    if (!infra.ok) return;
    expect(infra.record.actions[action.actionId]?.state).toBe('blocked');
    expect(infra.record.waits[0]?.kind).toBe('infrastructure');
  });

  it('strictly decodes stimuli before reduction', () => {
    const record = initial();
    expect(() =>
      decodeRunStimulus(
        { kind: 'cancel', reason: 'stop', unexpected: true },
        record
      )
    ).toThrow();
    const result = reduceCanonicalRunRecord(record, {
      kind: 'cancel',
      reason: 'stop',
      unexpected: true,
    } as RunStimulus);
    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'invalid_stimulus' },
    });
  });
});
