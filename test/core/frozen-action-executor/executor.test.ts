import { describe, expect, it } from 'vitest';

import {
  dispatchGrantedAction,
  dispatchGrantedContinuation,
} from '../../../src/core/frozen-action-executor/executor.js';
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
  makeBoundRecordAction,
  makeRecordAction,
  recordIds,
  recordRevision,
} from '../change-run/record-fixture.js';
import { buildGrantedConsultationFixture } from '../change-run/consultation-fixture.js';

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

describe('executor dispatch - authenticated turn input', () => {
  it('forwards exact authenticated bytes on a new unrouted hosted Action', async () => {
    const turnInput = 'line one\r\n猫';
    const action = makeBoundRecordAction(turnInput);
    const committed = grantedCommitted();
    const record = recordWith({ ...committed, action } as CommittedAction);
    let received: string | undefined;
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix: buildExecutionCapabilityMatrix({ hostPlatform: 'linux' }),
      backends: {
        hosted: {
          kind: 'hosted',
          async executeTurn(input) {
            received = input.input;
            return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
          },
        },
      },
      requestedBackend: 'hosted',
      maxInputBytes: 1024,
      turnInput,
    });
    expect(result.kind).toBe('executed');
    expect(received).toBe(turnInput);
  });

  it.each([
    ['newline normalization', 'line one\r\nline two', 'line one\nline two'],
    ['equal-JS-length multibyte mutation', '猫', 'a'],
  ])('rejects a changed-only %s request before hosted execution', async (_case, trusted, changed) => {
    const action = makeBoundRecordAction(trusted);
    const committed = grantedCommitted();
    const record = recordWith({ ...committed, action } as CommittedAction);
    let calls = 0;
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix: buildExecutionCapabilityMatrix({ hostPlatform: 'linux' }),
      backends: {
        hosted: {
          kind: 'hosted',
          async executeTurn() {
            calls += 1;
            return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
          },
        },
      },
      requestedBackend: 'hosted',
      maxInputBytes: 1024,
      turnInput: changed,
    });
    expect(result).toMatchObject({
      kind: 'execution-input-rejected',
      code: 'execution_input_mismatch',
      retryable: false,
    });
    expect(calls).toBe(0);
  });

  it('checks mismatch before the effective byte limit and before in-tool execution', async () => {
    const action = makeBoundRecordAction('猫');
    const committed = grantedCommitted();
    const record = recordWith({ ...committed, action } as CommittedAction);
    let calls = 0;
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix: buildExecutionCapabilityMatrix({ hostPlatform: 'linux' }),
      backends: {
        'in-tool': {
          kind: 'in-tool',
          async executeTurn() {
            calls += 1;
            return { turn: { ok: true, status: 'succeeded' }, launcherAlive: true };
          },
        },
      },
      requestedBackend: 'in-tool',
      maxInputBytes: 1,
      turnInput: '犬',
    });
    expect(result).toMatchObject({
      kind: 'execution-input-rejected',
      code: 'execution_input_mismatch',
    });
    expect(calls).toBe(0);
  });

  it('rejects matching multibyte bytes over the effective limit before execution', async () => {
    const action = makeBoundRecordAction('猫');
    const committed = grantedCommitted();
    const record = recordWith({ ...committed, action } as CommittedAction);
    let calls = 0;
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix: buildExecutionCapabilityMatrix({ hostPlatform: 'linux' }),
      backends: {
        'in-tool': {
          kind: 'in-tool',
          async executeTurn() {
            calls += 1;
            return { turn: { ok: true, status: 'succeeded' }, launcherAlive: true };
          },
        },
      },
      requestedBackend: 'in-tool',
      maxInputBytes: 2,
      turnInput: '猫',
    });
    expect(result).toMatchObject({
      kind: 'execution-input-rejected',
      code: 'execution_input_too_large',
    });
    expect(calls).toBe(0);
  });

  it('preserves historical unrouted request-rendered behavior', async () => {
    const committed = grantedCommitted();
    let received: string | undefined;
    const result = await dispatchGrantedAction({
      runRef,
      grantedAction: committed.action,
      record: recordWith(committed),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      matrix: buildExecutionCapabilityMatrix({ hostPlatform: 'linux' }),
      backends: {
        hosted: {
          kind: 'hosted',
          async executeTurn(input) {
            received = input.input;
            return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
          },
        },
      },
      requestedBackend: 'hosted',
      turnInput: 'historical caller-rendered prompt',
    });
    expect(result.kind).toBe('executed');
    expect(received).toBe('historical caller-rendered prompt');
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

describe('executor dispatch - exact consultation continuation', () => {
  it('wakes only the exact hosted source Session with runtime-owned advice input', async () => {
    const fixture = buildGrantedConsultationFixture();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    const calls: Array<{
      sessionId?: string;
      requestId?: string;
      input: string;
    }> = [];
    const backend: HostedBackendSeam = {
      kind: 'hosted',
      inspectSession(sessionId) {
        return sessionId === fixture.grant.stableSessionId
          ? {
              sandbox: fixture.sourceAction.agent.sandbox,
              authority: {
                invocationId: fixture.sourceAction.invocationId,
                role: fixture.sourceAction.agent.role,
                workspaceInstanceId: fixture.record.workspaceInstanceId,
                backend: 'hosted',
                handoffTokensUsed: 0,
                reuseRoundsServed: 0,
              },
            }
          : undefined;
      },
      async executeTurn(input) {
        calls.push({
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          input: input.input,
        });
        return {
          turn: {
            ok: true,
            status: 'succeeded',
            hostedTurn: {
              stableSessionId: input.sessionId!,
              requestId: input.requestId!,
              result: '{"status":"DONE"}',
              resultDigest: `sha256:${'a'.repeat(64)}`,
              replayed: false,
              cwd: '/root',
            },
          },
          daemonAlive: true,
        };
      },
    };
    const result = await dispatchGrantedContinuation({
      grant: fixture.grant,
      record: fixture.record,
      matrix,
      backends: { hosted: backend },
    });
    expect(result.kind).toBe('executed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toBe(fixture.grant.stableSessionId);
    expect(calls[0]?.requestId).toBe(fixture.grant.requestId);
    expect(JSON.parse(calls[0]!.input)).toEqual(fixture.grant.input);
  });

  it('rejects stale, cross-Session, and caller-substituted grants before backend work', async () => {
    const fixture = buildGrantedConsultationFixture();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    let calls = 0;
    const backend: HostedBackendSeam = {
      kind: 'hosted',
      async executeTurn() {
        calls += 1;
        return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
      },
    };
    const variants = [
      { ...fixture.grant, expectedRecordVersion: 0 as never },
      {
        ...fixture.grant,
        stableSessionId: '99999999-9999-9999-9999-999999999999',
      },
      {
        ...fixture.grant,
        input: {
          ...fixture.grant.input,
          detail: 'caller-substituted notification text',
        } as never,
      },
    ];
    for (const grant of variants) {
      const result = await dispatchGrantedContinuation({
        grant,
        record: fixture.record,
        matrix,
        backends: { hosted: backend },
      });
      expect(result.kind).toBe('rejected');
    }
    expect(calls).toBe(0);
  });

  it('refuses an in-tool continuation without silently driving either backend', async () => {
    const fixture = buildGrantedConsultationFixture();
    const matrix = buildExecutionCapabilityMatrix({ hostPlatform: 'linux' });
    let hostedCalls = 0;
    let inToolCalls = 0;
    const result = await dispatchGrantedContinuation({
      grant: fixture.grant,
      record: fixture.record,
      matrix,
      requestedBackend: 'in-tool',
      backends: {
        hosted: {
          kind: 'hosted',
          async executeTurn() {
            hostedCalls += 1;
            return { turn: { ok: true, status: 'succeeded' }, daemonAlive: true };
          },
        },
        'in-tool': {
          kind: 'in-tool',
          async executeTurn() {
            inToolCalls += 1;
            return { turn: { ok: true, status: 'succeeded' }, launcherAlive: true };
          },
        },
      },
    });
    expect(result.kind).toBe('authority-unavailable');
    expect(hostedCalls).toBe(0);
    expect(inToolCalls).toBe(0);
  });
});
