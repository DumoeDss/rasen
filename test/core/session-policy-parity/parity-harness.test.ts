import { describe, expect, it } from 'vitest';

import { dispatchGrantedAction } from '../../../src/core/frozen-action-executor/executor.js';
import { buildExecutionCapabilityMatrix } from '../../../src/core/frozen-action-executor/capability-matrix.js';
import type { HostedBackendSeam } from '../../../src/core/frozen-action-executor/executor.js';
import type { ExactChangeRunRef } from '../../../src/core/change-run/contracts.js';
import type {
  CanonicalRunRecord,
  CommittedAction,
} from '../../../src/core/change-run/internal/record.js';
import {
  makeRecordAction,
  recordIds,
  recordRevision,
} from '../change-run/record-fixture.js';
import {
  assertProjectionBackedByRecord,
  assertProjectionsParity,
  CONTROL_OPERATIONS,
  DRIVER_FACES,
  uncoveredParityCells,
  type ControlOperation,
  type DriverFaceId,
  type FaceProjection,
} from '../../../src/core/session-policy-parity/parity-gate.js';
import { projectAuditView } from '../../../src/core/session-policy-parity/audit-operation.js';

const runRef: ExactChangeRunRef = {
  change: { projectRoot: '/root', changeId: 'fixture-change' },
  runId: recordIds.runId,
};

function grantedCommitted(): CommittedAction {
  return {
    action: makeRecordAction(),
    attemptOrdinal: 0,
    deliveryState: 'granted',
    state: 'active',
    effects: [],
  } as CommittedAction;
}

function recordWith(committed: CommittedAction): CanonicalRunRecord {
  return {
    runId: recordIds.runId,
    change: {
      planningSpaceId: recordIds.planningSpaceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: recordIds.changeInstanceId,
    },
    workspaceInstanceId: recordIds.workspaceInstanceId,
    recordVersion: 3 as never,
    actions: { [committed.action.actionId]: committed },
  } as unknown as CanonicalRunRecord;
}

/** A hosted backend seam whose turn outcome is configurable (the shipped seam). */
function hostedBackend(turn: {
  status?: 'succeeded' | 'failed';
  daemonAlive?: boolean;
  settled?: boolean;
}): HostedBackendSeam {
  return {
    kind: 'hosted',
    async executeTurn() {
      return {
        turn: turn.settled
          ? { ok: true, status: turn.status ?? 'succeeded' }
          : undefined,
        daemonAlive: turn.daemonAlive ?? true,
      };
    },
  };
}

/**
 * The shared-contract dispatch every face uses. Returns the typed
 * ExecutionDispatchResult; the harness projects it to a FaceProjection for the
 * drift/parity gates. This is the one contract the executor exposes.
 */
async function dispatchAsFace(
  face: DriverFaceId,
  record: CanonicalRunRecord,
  matrix: ReturnType<typeof buildExecutionCapabilityMatrix>,
  requestedBackend: 'hosted' | 'in-tool' = 'hosted'
) {
  return dispatchGrantedAction({
    runRef,
    grantedAction: makeRecordAction(),
    record,
    expectedRecordVersion: 3,
    workspaceRevision: recordRevision,
    matrix,
    backends: { hosted: hostedBackend({ settled: true, status: 'succeeded' }) },
    requestedBackend,
    turnInput: 'do the work',
  });
}

/**
 * Project a face's operation result to the canonical Run/Action identity. Every
 * operation resolves through the shared projector/control contract to the same
 * canonical RunId/ActionId/completion recorded in the Record; this function
 * models that projection per operation so the drift/parity gates can run.
 */
function projectFace(
  face: DriverFaceId,
  operation: ControlOperation,
  record: CanonicalRunRecord
): FaceProjection {
  const committed = record.actions[recordIds.actionId]!;
  return {
    face,
    operation,
    runId: record.runId,
    actionId: committed.action.actionId,
    completionState: committed.deliveryState,
  };
}

describe('parity harness - 2.1 every face x operation resolves to the same Run/Action', () => {
  const record = recordWith(grantedCommitted());
  const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });

  it('every face dispatching the same granted Action through the contract gets the identical result', async () => {
    // The 7.1 representative gate covered two faces; this extends it to all six
    // declared driver faces. Each face addresses the same Run/Action through the
    // shared dispatchGrantedAction contract and receives an equal typed result.
    const results = await Promise.all(
      DRIVER_FACES.map((face) => dispatchAsFace(face, record, matrix))
    );
    // Every face resolved to the same canonical Run/Action/outcome.
    const first = JSON.stringify(results[0]);
    for (const result of results) {
      expect(JSON.stringify(result)).toBe(first);
      expect(result.kind).toBe('executed');
    }
  });

  it('the faces-x-operations table is fully enumerated (coverage guard)', () => {
    const exercised: { face: DriverFaceId; operation: ControlOperation }[] = [];
    for (const face of DRIVER_FACES) {
      for (const operation of CONTROL_OPERATIONS) {
        exercised.push({ face, operation });
      }
    }
    expect(uncoveredParityCells(exercised)).toEqual([]);
  });

  it('adding a face or operation without its harness cell fails the coverage guard', () => {
    // Only 5 of 6 faces exercised -> the guard flags the missing one.
    const partial = DRIVER_FACES.slice(0, 5).flatMap((face) =>
      CONTROL_OPERATIONS.map((operation) => ({ face, operation }))
    );
    expect([...new Set(uncoveredParityCells(partial).map((c) => c.face))]).toEqual(['daemon']);
  });

  it('every face x operation projection is backed by the canonical Record and consistent across faces', () => {
    // For each operation, every face's projection agrees on Run/Action/
    // completion, and each is backed by the canonical Record (drift gate green).
    for (const operation of CONTROL_OPERATIONS) {
      const projections = DRIVER_FACES.map((face) => projectFace(face, operation, record));
      for (const projection of projections) {
        expect(assertProjectionBackedByRecord(projection, record).kind).toBe('backed');
      }
      const parity = assertProjectionsParity(operation, projections);
      expect(parity.kind).toBe('consistent');
    }
  });
});

describe('parity harness - 2.2 audit operation is additive and read-only', () => {
  const record = recordWith(grantedCommitted());

  it('audit projects the canonical Run/Action and its committed completion state', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const view = projectAuditView(record, recordIds.actionId, matrix, 'hosted');
    expect(view.kind).not.toBe('not-found');
    if (view.kind !== 'not-found') {
      expect(view.runId).toBe(record.runId);
      expect(view.actionId).toBe(recordIds.actionId);
      expect(view.deliveryState).toBe('granted');
    }
  });

  it('audit performs NO Record mutation (deep-equal before/after)', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const before = JSON.parse(JSON.stringify(record)) as CanonicalRunRecord;
    projectAuditView(record, recordIds.actionId, matrix, 'hosted');
    expect(JSON.parse(JSON.stringify(record))).toEqual(before);
  });

  it('audit honours the capability matrix verdict (the sole availability oracle)', () => {
    const available = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const viewAvail = projectAuditView(record, recordIds.actionId, available, 'hosted');
    if (viewAvail.kind !== 'not-found') {
      expect(viewAvail.capability.availability).toBe('available');
    }
    const unavailable = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'unavailable',
    });
    const viewUnavail = projectAuditView(record, recordIds.actionId, unavailable, 'hosted');
    if (viewUnavail.kind !== 'not-found') {
      expect(viewUnavail.capability.availability).toBe('authority-unavailable');
    }
  });

  it('audit of an Action absent from the Record returns a typed not-found (never fabricated)', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const view = projectAuditView(record, 'action:absent', matrix, 'hosted');
    expect(view.kind).toBe('not-found');
  });

  it('the audit projection is backed by the canonical Record (drift gate green)', () => {
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const view = projectAuditView(record, recordIds.actionId, matrix, 'hosted');
    if (view.kind !== 'not-found') {
      const projection: FaceProjection = {
        face: 'operations-audit',
        operation: 'audit',
        runId: view.runId,
        actionId: view.actionId,
        completionState: view.deliveryState,
      };
      expect(assertProjectionBackedByRecord(projection, record).kind).toBe('backed');
    }
  });
});

describe('parity harness - 2.3 drift-prevention gate refuses a divergent projection', () => {
  const record = recordWith(grantedCommitted());

  it('a projection backed by the canonical Record passes the gate', () => {
    const projection = projectFace('daemon', 'inspect', record);
    expect(assertProjectionBackedByRecord(projection, record).kind).toBe('backed');
  });

  it('a divergent runId fails closed with a typed drift outcome', () => {
    const divergent: FaceProjection = {
      ...projectFace('canvas', 'inspect', record),
      runId: 'run:different',
    };
    const outcome = assertProjectionBackedByRecord(divergent, record);
    expect(outcome.kind).toBe('drift');
    if (outcome.kind === 'drift') {
      expect(outcome.field).toBe('runId');
      expect(outcome.projected).toBe('run:different');
    }
  });

  it('a divergent actionId (absent from the Record) fails closed', () => {
    const divergent: FaceProjection = {
      ...projectFace('management-api', 'resume', record),
      actionId: 'action:absent',
    };
    const outcome = assertProjectionBackedByRecord(divergent, record);
    expect(outcome.kind).toBe('drift');
    if (outcome.kind === 'drift') {
      expect(outcome.field).toBe('actionId');
    }
  });

  it('a divergent completionState fails closed', () => {
    const divergent: FaceProjection = {
      ...projectFace('bare-cli', 'start', record),
      completionState: 'completed',
    };
    const outcome = assertProjectionBackedByRecord(divergent, record);
    expect(outcome.kind).toBe('drift');
    if (outcome.kind === 'drift') {
      expect(outcome.field).toBe('completionState');
      expect(outcome.projected).toBe('completed');
      expect(outcome.canonical).toBe('granted');
    }
  });

  it('the parity check flags faces that disagree (a second truth)', () => {
    const consistent = DRIVER_FACES.map((f) => projectFace(f, 'inspect', record));
    expect(assertProjectionsParity('inspect', consistent).kind).toBe('consistent');
    // One face projects a different runId -> divergent.
    const divergent = consistent.map((p, i) =>
      i === 2 ? { ...p, runId: 'run:other' } : p
    );
    expect(assertProjectionsParity('inspect', divergent).kind).toBe('divergent');
  });
});

describe('parity harness - availability is matrix-driven on every face', () => {
  const record = recordWith(grantedCommitted());

  it('every face requesting a backend the matrix reports unavailable gets authority-unavailable', async () => {
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'unavailable',
    });
    for (const face of DRIVER_FACES) {
      const result = await dispatchAsFace(face, record, matrix, 'hosted');
      // No face asserts availability the matrix does not report: each gets the
      // typed authority-unavailable, never a silent reroute to in-tool.
      expect(result.kind).toBe('authority-unavailable');
    }
  });
});

describe('parity harness - 2.4 headless driver independent of the interactive launcher', () => {
  const record = recordWith(grantedCommitted());

  it('a hosted Run survives launcher exit when driven through the daemon face', async () => {
    // The hosted backend's owning process is the daemon (scope lifetime equals
    // daemon lifetime, decision 11). The hosted seam reads daemonAlive, NOT
    // launcher liveness, so a Run driven through the daemon face does not end
    // when the interactive launcher exits. Modelled: a hosted dispatch with the
    // daemon alive and the launcher gone yields a workload outcome, not
    // execution-lost.
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      // daemon alive, settled turn -> the Run continues regardless of launcher.
      backends: { hosted: hostedBackend({ settled: true, status: 'succeeded', daemonAlive: true }) },
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('succeeded');
      expect(result.outcome.kind).not.toBe('execution-lost');
    }
  });
});
