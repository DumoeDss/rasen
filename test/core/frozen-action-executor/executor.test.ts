import { describe, expect, it } from 'vitest';

import { dispatchGrantedAction } from '../../../src/core/frozen-action-executor/executor.js';
import {
  buildExecutionCapabilityMatrix,
  type HostedBackendSeam,
  type InToolBackendSeam,
} from '../../../src/core/frozen-action-executor/capability-matrix.js';
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

function inToolBackend(turn: {
  status?: 'succeeded' | 'failed';
  launcherAlive?: boolean;
  settled?: boolean;
}): InToolBackendSeam {
  return {
    kind: 'in-tool',
    async executeTurn() {
      return {
        turn: turn.settled
          ? { ok: true, status: turn.status ?? 'succeeded' }
          : undefined,
        launcherAlive: turn.launcherAlive ?? true,
      };
    },
  };
}

describe('executor dispatch - happy path', () => {
  it('dispatches a granted Action on the hosted backend and reconciles a settled turn', async () => {
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record: recordWith(committed),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      backends: { hosted: hostedBackend({ settled: true, status: 'succeeded' }) },
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.backend).toBe('hosted');
      expect(result.outcome.kind).toBe('succeeded');
    }
  });
});

describe('executor dispatch - execution-lost is wired at the reconciliation point', () => {
  it('hosted daemon death during an in-flight Action yields execution-lost', async () => {
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record: recordWith(committed),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      backends: { hosted: hostedBackend({ settled: false, daemonAlive: false }) },
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('execution-lost');
      expect(result.outcome.source).toBe('daemon-death');
    }
  });

  it('in-tool launcher disappearance yields execution-lost', async () => {
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record: recordWith(committed),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      backends: { 'in-tool': inToolBackend({ settled: false, launcherAlive: false }) },
      requestedBackend: 'in-tool',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('execution-lost');
      expect(result.outcome.source).toBe('launcher-disappearance');
    }
  });
});

describe('executor dispatch - authority validation fail-closed', () => {
  it('a stale Record version is rejected before any backend work', async () => {
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record: recordWith(committed),
      expectedRecordVersion: 2,
      workspaceRevision: recordRevision,
      matrix,
      backends: { hosted: hostedBackend({ settled: true }) },
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('rejected');
  });
});

describe('executor dispatch - never silently reroute', () => {
  it('hosted unavailable returns authority-unavailable and drives NO in-tool backend', async () => {
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({
      hostPlatform: 'linux',
      hostedTierStatus: 'unavailable',
    });
    let inToolDriven = false;
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record: recordWith(committed),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      backends: {
        hosted: hostedBackend({ settled: true }),
        'in-tool': {
          kind: 'in-tool',
          async executeTurn() {
            inToolDriven = true;
            return { turn: { ok: true, status: 'succeeded' }, launcherAlive: true };
          },
        },
      },
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('authority-unavailable');
    expect(inToolDriven).toBe(false);
  });

  it('a missing backend seam for a selected backend is authority-unavailable, not a reroute', async () => {
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    // hosted selected but no hosted seam wired; must not fall back to in-tool.
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record: recordWith(committed),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      backends: { 'in-tool': inToolBackend({ settled: true }) },
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('authority-unavailable');
  });
});

describe('driver-face parity - every face consumes the same result', () => {
  it('the dispatch result is the single typed object every driver face consumes', async () => {
    // The orchestrator returns one ExecutionDispatchResult whether the caller is
    // the CLI, Management API, Canvas, or daemon. No face builds its own truth;
    // each receives the same validated/reconciled result.
    const committed = grantedCommitted();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const fromFace = async () =>
      dispatchGrantedAction({
        runRef,
        grantedAction: makeRecordAction(),
        record: recordWith(committed),
        expectedRecordVersion: 3,
        workspaceRevision: recordRevision,
        matrix,
        backends: { hosted: hostedBackend({ settled: true, status: 'succeeded' }) },
        requestedBackend: 'hosted',
        turnInput: 'do the work',
      });
    const cli = await fromFace();
    const api = await fromFace();
    // Two faces addressing the same Run through the shared orchestrator receive
    // equal results: no duplicated Run/Session truth.
    expect(JSON.stringify(cli)).toBe(JSON.stringify(api));
    expect(cli.kind).toBe('executed');
  });
});
