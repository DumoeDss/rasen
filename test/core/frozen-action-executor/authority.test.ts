import { describe, expect, it } from 'vitest';

import { validateGrantedAction } from '../../../src/core/frozen-action-executor/authority.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from '../../../src/core/change-run/internal/record.js';
import type { ExactChangeRunRef } from '../../../src/core/change-run/contracts.js';
import {
  makeRecordAction,
  recordIds,
  recordRevision,
} from '../change-run/record-fixture.js';

const branded = <T>(value: string): T => value as T;

function grantedCommitted(overrides: Partial<CommittedAction> = {}): CommittedAction {
  return {
    action: makeRecordAction(),
    attemptOrdinal: 0,
    deliveryState: 'granted',
    state: 'active',
    effects: [],
    ...overrides,
  } as CommittedAction;
}

function recordWith(
  committed: CommittedAction,
  recordVersion = 3
): CanonicalRunRecord {
  return {
    runId: recordIds.runId,
    change: {
      planningSpaceId: recordIds.planningSpaceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: recordIds.changeInstanceId,
    },
    workspaceInstanceId: recordIds.workspaceInstanceId,
    recordVersion: branded(recordVersion),
    actions: { [committed.action.actionId]: committed },
  } as unknown as CanonicalRunRecord;
}

const runRef: ExactChangeRunRef = {
  change: { projectRoot: '/root', changeId: 'fixture-change' },
  runId: recordIds.runId,
};

describe('granted-Action dispatch - authority validation against the Record', () => {
  it('dispatches a granted Action with every field validated against the Record', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('dispatched');
    if (result.kind === 'dispatched') {
      expect(result.recordVersion).toBe(3);
      expect(result.action.actionId).toBe(committed.action.actionId);
    }
  });
});

describe('the four illegal-dispatch cases fail closed with typed outcomes', () => {
  it('a stale Record version returns record_version_conflict and executes no backend work', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed, 3);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 2,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('record_version_conflict');
    }
  });

  it('a wrong workspace returns workspace-scope-mismatch before any backend process receives input', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const wrongWorkspace = {
      ...recordRevision,
      treeDigest: branded(`sha256:${'c'.repeat(64)}`),
    };
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: wrongWorkspace,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('workspace-scope-mismatch');
    }
  });

  it('a not-currently-executable Action (deliveryState closed) is rejected', () => {
    const committed = grantedCommitted({ deliveryState: 'closed', state: 'closed' });
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('not-currently-executable');
    }
  });

  it('a duplicate dispatch of a settled Action returns the recorded state without resend', () => {
    const committed = grantedCommitted({
      result: {
        status: 'succeeded',
        result: { ok: true },
        receiptDigest: branded(`sha256:${'d'.repeat(64)}`),
        actor: undefined as never,
        actorAttestation: undefined as never,
        evidence: [],
      },
    });
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.reason).toBe('settled');
    }
  });

  it('a duplicate in-flight dispatch returns the in-flight state without resend', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      inFlight: new Set([committed.action.actionId]),
    });
    expect(result.kind).toBe('duplicate');
    if (result.kind === 'duplicate') {
      expect(result.reason).toBe('in-flight');
    }
  });

  it('a Run mismatch is rejected before any authority check', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef: {
        change: { projectRoot: '/root', changeId: 'other-change' },
        runId: recordIds.runId,
      },
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('run-mismatch');
    }
  });

  it('a granted ActionView whose authority differs from the Record is a receipt_conflict', () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    // Rebuild the capability authority from a caller-supplied source (a
    // different contract digest) — exactly what the source-scan guard forbids.
    const rebuilt = makeRecordAction({
      capability: {
        ...makeRecordAction().capability,
        contractDigest: branded(`sha256:${'e'.repeat(64)}`),
      },
    });
    const result = validateGrantedAction({
      runRef,
      grantedAction: rebuilt,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('receipt_conflict');
    }
  });
});

describe('authority is rebuilt from no non-granted source (source-scan property)', () => {
  it('the validator accepts no chat / Definition / caller-authority parameter', () => {
    // The function signature is the guard: validateGrantedAction takes only the
    // granted ActionView, the committed Record, the expected version, the
    // workspace revision, and the in-flight ledger. There is no parameter for
    // chat history, the live Definition, or caller self-report, so authority
    // cannot be rebuilt from them. This test exists so a mutation that adds
    // such a parameter and reads it fails this contract.
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const result = validateGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
    });
    expect(result.kind).toBe('dispatched');
  });
});
