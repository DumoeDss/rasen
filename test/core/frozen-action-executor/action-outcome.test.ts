import { describe, expect, it } from 'vitest';

import {
  isCommittedInvocation,
  partitionCommittedFrontier,
  reconcileActionOutcome,
} from '../../../src/core/frozen-action-executor/action-outcome.js';

describe('execution-lost reconciliation - hosted backend', () => {
  it('daemon death types the in-flight Action execution-lost', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: false },
      turn: { ok: true, status: 'succeeded' },
    });
    expect(outcome.kind).toBe('execution-lost');
    expect(outcome.source).toBe('daemon-death');
    expect(outcome.backend).toBe('hosted');
  });

  it('a lost generation with an unfinished request types execution-lost even with the daemon alive', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: true },
      turn: {
        ok: false,
        code: 'turn-outcome-unknown',
        ambiguous: true,
        requestUnfinished: true,
      },
    });
    expect(outcome.kind).toBe('execution-lost');
    // The daemon process may still be alive; the audit label is the lost
    // generation, not a literal daemon death (review round-1 Minor).
    expect(outcome.source).toBe('lost-generation');
  });

  it('a settled succeeded turn is succeeded, NOT execution-lost', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: true },
      turn: { ok: true, status: 'succeeded' },
    });
    expect(outcome.kind).toBe('succeeded');
    expect(outcome.kind).not.toBe('execution-lost');
  });

  it('a settled failed turn is failed, NOT execution-lost', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: true },
      turn: { ok: true, status: 'failed' },
    });
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind).not.toBe('execution-lost');
  });

  it('a generic host failure with the daemon alive is uncertain, NOT execution-lost', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: true },
      turn: {
        ok: false,
        code: 'backend-timeout',
        ambiguous: false,
        requestUnfinished: false,
      },
    });
    expect(outcome.kind).toBe('uncertain');
    expect(outcome.kind).not.toBe('execution-lost');
  });
});

describe('execution-lost reconciliation - in-tool backend', () => {
  it('launcher disappearance types the in-flight Action execution-lost', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'in-tool', launcherAlive: false },
      turn: undefined,
    });
    expect(outcome.kind).toBe('execution-lost');
    expect(outcome.source).toBe('launcher-disappearance');
    expect(outcome.backend).toBe('in-tool');
  });

  it('an ambiguous in-tool turn with the launcher alive is uncertain, NOT execution-lost', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'in-tool', launcherAlive: true },
      turn: {
        ok: false,
        code: 'turn-outcome-unknown',
        ambiguous: true,
        requestUnfinished: true,
      },
    });
    // The in-tool lost-generation equivalent is launcher disappearance (above);
    // an ambiguous turn while the launcher is still alive is generic uncertainty.
    expect(outcome.kind).toBe('uncertain');
    expect(outcome.kind).not.toBe('execution-lost');
  });
});

describe('execution-lost is distinct from generic uncertainty and workload failure', () => {
  it('a normally-completed Action is never labelled execution-lost (discrimination guard)', () => {
    for (const status of ['succeeded', 'failed'] as const) {
      const outcome = reconcileActionOutcome({
        liveness: { backend: 'hosted', daemonAlive: true },
        turn: { ok: true, status },
      });
      expect(outcome.kind).not.toBe('execution-lost');
    }
  });

  it('a generic uncertainty is never labelled execution-lost (discrimination guard)', () => {
    const outcome = reconcileActionOutcome({
      liveness: { backend: 'hosted', daemonAlive: true },
      turn: {
        ok: false,
        code: 'backend-protocol-failed',
        ambiguous: false,
        requestUnfinished: false,
      },
    });
    expect(outcome.kind).toBe('uncertain');
    expect(outcome.kind).not.toBe('execution-lost');
  });
});

describe('committed-frontier resume partition', () => {
  it('partitions invocations into committed (never re-executed) and uncommitted (re-driven)', () => {
    const partition = partitionCommittedFrontier([
      { invocationId: 'inv-1', committed: true },
      { invocationId: 'inv-2', committed: false },
      { invocationId: 'inv-3', committed: true },
      { invocationId: 'inv-4', committed: false },
    ]);
    expect(partition.committed.map((i) => i.invocationId)).toEqual(['inv-1', 'inv-3']);
    expect(partition.uncommitted.map((i) => i.invocationId)).toEqual(['inv-2', 'inv-4']);
  });

  it('a resend of a committed invocation is rejected (isCommittedInvocation guards re-drive)', () => {
    const partition = partitionCommittedFrontier([
      { invocationId: 'inv-1', committed: true },
      { invocationId: 'inv-2', committed: false },
    ]);
    expect(isCommittedInvocation(partition, 'inv-1')).toBe(true);
    expect(isCommittedInvocation(partition, 'inv-2')).toBe(false);
  });

  it('resume re-drives only the uncommitted frontier (committed stays put)', () => {
    const partition = partitionCommittedFrontier([
      { invocationId: 'inv-1', committed: true },
      { invocationId: 'inv-2', committed: false },
    ]);
    const reDrive = partition.uncommitted.map((i) => i.invocationId);
    expect(reDrive).toEqual(['inv-2']);
    expect(partition.committed.map((i) => i.invocationId)).toEqual(['inv-1']);
  });
});
