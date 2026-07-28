import { describe, expect, it } from 'vitest';

import {
  CanonicalRecordError,
  createCanonicalRunRecord,
  decodeCanonicalRunRecord,
  digestCanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import {
  createCanonicalWait,
  decodeCanonicalWait,
} from '../../../src/core/change-run/internal/waits.js';
import {
  makeRecordAction,
  recordIds,
  recordRevision,
} from './record-fixture.js';

describe('canonical Change Run Record', () => {
  it('closes, validates, and deeply freezes the sole runtime truth', () => {
    const record = createCanonicalRunRecord({
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
      inputs: { issue: '42' },
      limits: {
        maxAttempts: 3,
        maxActions: 8,
        maxRecordRevisions: 32,
        maxTransitions: 32,
        maxEvidenceRefsPerAction: 4,
        limitOutcome: 'escalated',
      },
    });

    expect(record.recordVersion).toBe(0);
    expect(record.previousRecordDigest).toBeNull();
    expect(record.transitions).toEqual([
      { kind: 'RunStarted', transitionOrdinal: 0 },
    ]);
    expect(record.counters).toEqual({
      attempts: 0,
      actions: 0,
      transitions: 1,
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.change)).toBe(true);
    expect(Object.isFrozen(record.transitions)).toBe(true);
    expect(Object.isFrozen(record.inputs)).toBe(true);
    expect(digestCanonicalRunRecord(record)).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(() =>
      decodeCanonicalRunRecord({ ...record, unknown: true })
    ).toThrowError(CanonicalRecordError);
    expect(() =>
      decodeCanonicalRunRecord({ ...record, format: 'change-run-record/2' })
    ).toThrowError(
      expect.objectContaining({ code: 'unsupported_record_version' })
    );
    expect(() =>
      decodeCanonicalRunRecord({
        ...record,
        recordVersion: 1,
        previousRecordDigest: null,
      })
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_record_invariant' })
    );
    expect(() =>
      decodeCanonicalRunRecord({
        ...record,
        counters: { ...record.counters, transitions: 2 },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_record_invariant' })
    );
  });

  it('binds every wait variant to exact context and stable-sorts reservations', () => {
    const gateA = createCanonicalWait(recordIds.runId, {
      kind: 'gate',
      nodeId: recordIds.nodeId,
      invocationId: recordIds.invocationId,
      occurrence: 0,
      gateId: 'approval-a',
      decisionIds: ['approve', 'reject'],
    });
    const gateB = createCanonicalWait(recordIds.runId, {
      kind: 'gate',
      nodeId: recordIds.nodeId,
      invocationId: recordIds.invocationId,
      occurrence: 1,
      gateId: 'approval-b',
      decisionIds: ['approve', 'reject'],
    });
    expect(gateA.waitId).not.toBe(gateB.waitId);

    const reservationA = createCanonicalWait(recordIds.runId, {
      kind: 'workspace-reservation',
      workspaceInstanceId: recordIds.workspaceInstanceId,
      intents: [
        {
          nodeId: recordIds.nodeId,
          invocationId: recordIds.invocationId,
          occurrence: 1,
          access: 'read',
        },
        {
          nodeId: recordIds.nodeId,
          invocationId: recordIds.invocationId,
          occurrence: 0,
          access: 'write',
        },
      ],
    });
    const reservationB = createCanonicalWait(recordIds.runId, {
      ...reservationA,
      waitId: undefined,
      intents: [...reservationA.intents].reverse(),
    });
    expect(reservationB).toEqual(reservationA);

    const drift = createCanonicalWait(recordIds.runId, {
      kind: 'workspace-drift',
      workspaceInstanceId: recordIds.workspaceInstanceId,
      expected: recordRevision,
      observed: {
        ...recordRevision,
        treeDigest: `sha256:${'c'.repeat(64)}`,
      },
    });
    expect(() =>
      decodeCanonicalWait({ ...drift, waitId: gateA.waitId }, recordIds.runId)
    ).toThrowError(
      expect.objectContaining({ code: 'wait_identity_mismatch' })
    );
    expect(() =>
      decodeCanonicalWait(
        { ...gateA, actionId: recordIds.actionId },
        recordIds.runId
      )
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_wait_contract' })
    );

    const actionBound = [
      createCanonicalWait(recordIds.runId, {
        kind: 'domain-blocked',
        nodeId: recordIds.nodeId,
        invocationId: recordIds.invocationId,
        occurrence: 0,
        attemptId: recordIds.attemptId,
        actionId: recordIds.actionId,
        effectIds: [recordIds.effectId],
        reasonCode: 'needs-input',
        evidence: [],
      }),
      createCanonicalWait(recordIds.runId, {
        kind: 'infrastructure',
        nodeId: recordIds.nodeId,
        invocationId: recordIds.invocationId,
        occurrence: 0,
        attemptId: recordIds.attemptId,
        actionId: recordIds.actionId,
        effectIds: [recordIds.effectId],
        code: 'spawn_failed',
        retryable: true,
        artifactDigest: recordIds.digest,
      }),
      createCanonicalWait(recordIds.runId, {
        kind: 'uncertain-effect',
        nodeId: recordIds.nodeId,
        invocationId: recordIds.invocationId,
        occurrence: 0,
        attemptId: recordIds.attemptId,
        actionId: recordIds.actionId,
        effectIds: [recordIds.effectId],
      }),
      createCanonicalWait(recordIds.runId, {
        kind: 'capability-unavailable',
        nodeId: recordIds.nodeId,
        invocationId: recordIds.invocationId,
        occurrence: 0,
        attemptId: recordIds.attemptId,
        actionId: recordIds.actionId,
        effectIds: [recordIds.effectId],
        code: 'artifact_missing',
        capabilityDigest: recordIds.digest,
      }),
    ];
    expect(new Set(actionBound.map((wait) => wait.waitId)).size).toBe(4);
    for (const wait of actionBound) {
      expect(decodeCanonicalWait(wait, recordIds.runId)).toEqual(wait);
    }
  });

  it('rejects terminal/wait/action contradictions and unclosed references', () => {
    const record = createCanonicalRunRecord({
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
        maxAttempts: 2,
        maxActions: 2,
        maxRecordRevisions: 8,
        maxTransitions: 8,
        maxEvidenceRefsPerAction: 2,
        limitOutcome: 'failed',
      },
    });
    const action = makeRecordAction();
    expect(() =>
      decodeCanonicalRunRecord({
        ...record,
        status: 'completed',
        terminal: { kind: 'completed', outcome: 'ok' },
        actions: {
          [action.actionId]: {
            action,
            attemptOrdinal: 0,
            deliveryState: 'granted',
            state: 'active',
            effects: action.effects.map((effect) => ({
              slot: effect.slot,
              effectId: effect.effectId,
              state: 'admitted',
            })),
          },
        },
        counters: { ...record.counters, attempts: 1, actions: 1 },
      })
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_record_invariant' })
    );
  });
});
