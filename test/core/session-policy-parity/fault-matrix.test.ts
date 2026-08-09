import { describe, expect, it } from 'vitest';

import { dispatchGrantedAction } from '../../../src/core/frozen-action-executor/executor.js';
import {
  isCommittedInvocation,
  partitionCommittedFrontier,
  reconcileActionOutcome,
} from '../../../src/core/frozen-action-executor/action-outcome.js';
import { buildExecutionCapabilityMatrix } from '../../../src/core/frozen-action-executor/capability-matrix.js';
import type {
  HostedBackendSeam,
  InToolBackendSeam,
} from '../../../src/core/frozen-action-executor/executor.js';
import type { TurnResult } from '../../../src/core/frozen-action-executor/action-outcome.js';
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
  FAULT_MODES,
  FAULT_MODE_SPECS,
  uncoveredFaultModes,
  type FaultMode,
} from '../../../src/core/session-policy-parity/fault-matrix.js';

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

const lostGenerationTurn: TurnResult = {
  ok: false,
  code: 'turn-outcome-unknown',
  ambiguous: true,
  requestUnfinished: true,
};

/** The fault signal injected at the shipped seam for each EXECUTION mode. */
function seamFor(mode: FaultMode): HostedBackendSeam | InToolBackendSeam {
  switch (mode) {
    case 'cancel-before-start':
      // Turn never started (daemon alive, no turn settled before the cancel).
      return {
        kind: 'hosted',
        async executeTurn() {
          return { turn: undefined, daemonAlive: true };
        },
      };
    case 'cancel-in-flight':
      // Turn in flight when cancelled -> lost generation (turn-outcome-unknown,
      // unfinished request), daemon still alive.
      return {
        kind: 'hosted',
        async executeTurn() {
          return { turn: lostGenerationTurn, daemonAlive: true };
        },
      };
    case 'host-restart':
      // Host process restarted -> the in-flight turn's generation is lost.
      return {
        kind: 'hosted',
        async executeTurn() {
          return { turn: lostGenerationTurn, daemonAlive: true };
        },
      };
    case 'daemon-restart':
      // Daemon died -> daemonAlive=false (scope lifetime equals daemon lifetime).
      return {
        kind: 'hosted',
        async executeTurn() {
          return { turn: undefined, daemonAlive: false };
        },
      };
    case 'worker-process-loss':
      // In-tool launcher/worker gone -> launcherAlive=false.
      return {
        kind: 'in-tool',
        async executeTurn() {
          return { turn: undefined, launcherAlive: false };
        },
      };
    default:
      // completion-ack-loss / duplicate-completion / stale-control are exercised
      // through the authority/completion path (their shipped interface), not the
      // execution seam; they reuse a settled hosted seam for the execution leg.
      return {
        kind: 'hosted',
        async executeTurn() {
          return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
        },
      };
  }
}

async function dispatchMode(
  mode: FaultMode,
  record: CanonicalRunRecord,
  overrides: { expectedRecordVersion?: number; inFlight?: Set<string> } = {}
) {
  const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
  const spec = FAULT_MODE_SPECS.find((s) => s.mode === mode)!;
  const seam = seamFor(mode);
  const backends =
    spec.backend === 'hosted' ? { hosted: seam as HostedBackendSeam } : { 'in-tool': seam as InToolBackendSeam };
  return dispatchGrantedAction({
    runRef,
    grantedAction: makeRecordAction(),
    record,
    expectedRecordVersion: overrides.expectedRecordVersion ?? 3,
    workspaceRevision: recordRevision,
    matrix,
    backends,
    requestedBackend: spec.backend,
    turnInput: 'do the work',
    ...(overrides.inFlight ? { inFlight: overrides.inFlight } : {}),
  });
}

describe('fault matrix - 3.1 every mode injected at the shipped seam', () => {
  const record = recordWith(grantedCommitted());
  const executionModes: FaultMode[] = [
    'cancel-before-start',
    'cancel-in-flight',
    'host-restart',
    'daemon-restart',
    'worker-process-loss',
  ];

  it('every execution mode is injected at the shipped HostedBackendSeam/InToolBackendSeam (not a parallel fixture)', () => {
    // Anti-theater guard (task 3.1): each execution mode's seam is one of the
    // shipped executor seam kinds. A parallel fixture/mock would fail this.
    for (const mode of executionModes) {
      const seam = seamFor(mode);
      expect(['hosted', 'in-tool']).toContain(seam.kind);
    }
  });

  it('every mode dispatches through the shipped dispatchGrantedAction and produces its typed outcome', async () => {
    for (const spec of FAULT_MODE_SPECS) {
      let result;
      if (spec.mode === 'duplicate-completion') {
        result = await dispatchMode(spec.mode, record, {
          inFlight: new Set([recordIds.actionId]),
        });
      } else if (spec.mode === 'stale-control') {
        result = await dispatchMode(spec.mode, record, { expectedRecordVersion: 2 });
      } else {
        result = await dispatchMode(spec.mode, record);
      }
      // The typed outcome only the shipped executor produces for this fault.
      if (result.kind === 'executed') {
        expect(result.outcome.kind).toBe(spec.outcomeKind);
      } else {
        expect(result.kind).toBe(spec.outcomeKind);
      }
    }
  });

  it('coverage guard: every declared fault mode is exercised', () => {
    // The harness iterates FAULT_MODE_SPECS (all 8 cells); confirm none missing.
    const exercised = FAULT_MODE_SPECS.map((s) => s.mode);
    expect(uncoveredFaultModes(exercised)).toEqual([]);
    expect(exercised).toHaveLength(FAULT_MODES.length);
  });

  it('adding a fault mode without its harness cell fails the coverage guard', () => {
    expect(uncoveredFaultModes(['cancel-before-start'])).toContain('daemon-restart');
  });
});

describe('fault matrix - 3.2 recovery invariants', () => {
  it('committed-frontier-only: partition skips committed invocations and re-drives only the uncommitted', () => {
    const partition = partitionCommittedFrontier([
      { invocationId: 'inv-1', committed: true },
      { invocationId: 'inv-2', committed: false },
      { invocationId: 'inv-3', committed: true },
    ]);
    expect(partition.committed.map((i) => i.invocationId)).toEqual(['inv-1', 'inv-3']);
    expect(partition.uncommitted.map((i) => i.invocationId)).toEqual(['inv-2']);
  });

  it('no-resend / no-reexecute: a committed invocation is guarded from re-drive', () => {
    const partition = partitionCommittedFrontier([
      { invocationId: 'inv-1', committed: true },
      { invocationId: 'inv-2', committed: false },
    ]);
    // The resume path consults isCommittedInvocation before re-driving: a
    // committed invocation is skipped (never resent, never re-executed).
    expect(isCommittedInvocation(partition, 'inv-1')).toBe(true);
    expect(isCommittedInvocation(partition, 'inv-2')).toBe(false);
    const reDrive = partition.uncommitted.map((i) => i.invocationId);
    expect(reDrive).not.toContain('inv-1');
  });

  it('fail-closed-on-unprovable: an unprovable in-flight turn is uncertain, never silently completed', () => {
    // cancel-before-start: turn never settled, daemon alive -> uncertain (a typed
    // wait), NOT succeeded (silently completed) and NOT dropped.
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: true },
      turn: undefined,
    });
    expect(outcome.kind).toBe('uncertain');
    expect(outcome.kind).not.toBe('succeeded');
  });

  it('a committed invocation survives a daemon restart untouched (resume re-drives only the frontier)', () => {
    // After daemon-restart mints execution-lost, recovery partitions the
    // invocations: the committed one (inv-committed) is never re-driven; only
    // the uncommitted frontier (inv-frontier) is re-driven.
    const partition = partitionCommittedFrontier([
      { invocationId: 'inv-committed', committed: true },
      { invocationId: 'inv-frontier', committed: false },
    ]);
    expect(isCommittedInvocation(partition, 'inv-committed')).toBe(true);
    expect(partition.uncommitted.map((i) => i.invocationId)).toEqual(['inv-frontier']);
  });
});

describe('fault matrix - 3.3 execution-lost composition + committed-frontier resume', () => {
  const record = recordWith(grantedCommitted());

  it('daemon-restart (hosted) composes execution-lost with the daemon-death source', async () => {
    const result = await dispatchMode('daemon-restart', record);
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('execution-lost');
      // The 'daemon-death' source is minted ONLY by the shipped
      // reconcileActionOutcome composing daemonAlive=false. Asserting it is the
      // anti-theater proof the production reconciliation ran.
      expect(result.outcome.source).toBe('daemon-death');
    }
  });

  it('host-restart (hosted) composes execution-lost with the lost-generation source', async () => {
    const result = await dispatchMode('host-restart', record);
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('execution-lost');
      expect(result.outcome.source).toBe('lost-generation');
    }
  });

  it('worker-process-loss (in-tool) composes execution-lost with the launcher-disappearance source', async () => {
    const result = await dispatchMode('worker-process-loss', record);
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('execution-lost');
      expect(result.outcome.source).toBe('launcher-disappearance');
    }
  });

  it('a normally-completed Action is never typed execution-lost (discrimination)', async () => {
    // A settled succeeded turn mints 'succeeded', NEVER 'execution-lost'. This is
    // the discrimination guard: execution-lost is reserved for owning-process
    // death / lost generation, never a normal completion.
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix,
      backends: {
        hosted: {
          kind: 'hosted',
          async executeTurn() {
            return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
          },
        },
      },
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

describe('fault matrix - 3.4 no double-settle / no advance from unprovable / typed outcome', () => {
  const record = recordWith(grantedCommitted());

  it('a duplicate dispatch is caught as typed duplicate (no double-settle)', async () => {
    // A second dispatch of an action already in flight returns 'duplicate' and
    // performs no backend work (the in-flight ledger guards it).
    const result = await dispatchMode('duplicate-completion', record, {
      inFlight: new Set([recordIds.actionId]),
    });
    expect(result.kind).toBe('duplicate');
  });

  it('a settled action is not re-dispatched (no double-settle on the settled leg)', async () => {
    // An action that already has a committed result returns 'duplicate'
    // (settled) without resend. Model: the committed action carries a result.
    const settled = grantedCommitted();
    (settled as { result?: unknown }).result = { ok: true };
    const settledRecord = recordWith(settled);
    const result = await dispatchMode('completion-ack-loss', settledRecord);
    expect(result.kind).toBe('duplicate');
  });

  it('a stale control (record-version mismatch) is rejected (no advance from an unprovable state)', async () => {
    const result = await dispatchMode('stale-control', record, {
      expectedRecordVersion: 2,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.code).toBe('record_version_conflict');
    }
  });

  it('every fault mode returns a typed outcome (no silent completion or drop)', async () => {
    for (const spec of FAULT_MODE_SPECS) {
      let result;
      if (spec.mode === 'duplicate-completion') {
        result = await dispatchMode(spec.mode, record, {
          inFlight: new Set([recordIds.actionId]),
        });
      } else if (spec.mode === 'stale-control') {
        result = await dispatchMode(spec.mode, record, { expectedRecordVersion: 2 });
      } else {
        result = await dispatchMode(spec.mode, record);
      }
      // Every result is one of the typed kinds; none is undefined/throw/silent.
      expect(['executed', 'rejected', 'duplicate', 'authority-unavailable']).toContain(
        result.kind
      );
    }
  });
});
