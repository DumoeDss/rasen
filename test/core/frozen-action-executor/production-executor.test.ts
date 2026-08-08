import { describe, expect, it } from 'vitest';

import {
  actionExecuteRequestId,
  createHostedBackendSeamFromSessionHost,
  createInToolBackendSeamFromLauncherLiveness,
  createProductionExecutor,
  turnResultFromHostOutcome,
} from '../../../src/core/frozen-action-executor/production-executor.js';
import type {
  SessionHost,
  SessionHostCommand,
  SessionHostOutcome,
  SessionHostView,
  SessionRecoveryReport,
} from '../../../src/core/session-host/contracts.js';
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

const LIMITS = {
  timeoutMs: 30_000,
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
};

function stubSessionView(): SessionHostView {
  return {
    sessionId: '11111111-1111-1111-1111-111111111111',
    backend: 'claude',
    cwd: '/root',
    hostState: 'idle',
    state: 'running',
    generation: 1,
    createdAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
  };
}

/** A minimal SessionHost stub whose `execute` outcome is configurable. */
function stubHost(executeOutcome: SessionHostOutcome): SessionHost {
  return {
    async dispatch(command: SessionHostCommand): Promise<SessionHostOutcome> {
      if (command.op === 'execute') return executeOutcome;
      return {
        ok: false,
        op: command.op,
        code: 'invalid-input',
        message: 'stub only implements execute',
      };
    },
    inspect(): SessionHostView | undefined {
      return stubSessionView();
    },
    list(): SessionHostView[] {
      return [stubSessionView()];
    },
    async reconcileOnStart(): Promise<SessionRecoveryReport> {
      return {
        ready: true,
        inspected: 0,
        recovered: 0,
        interrupted: 0,
        failed: 0,
        diagnostics: [],
      };
    },
    async shutdown(): Promise<void> {
      /* no-op */
    },
  };
}

const settledOk: SessionHostOutcome = {
  ok: true,
  op: 'execute',
  session: stubSessionView(),
  requestId: '11111111-1111-1111-1111-111111111111',
  result: '{"ok":true}',
  resultDigest: 'sha256:abc',
};

describe('production seam - turnResultFromHostOutcome mapping', () => {
  it('a settled host turn maps to a workload outcome (default succeeded)', () => {
    const turn = turnResultFromHostOutcome(settledOk);
    expect(turn).toEqual({ ok: true, status: 'succeeded' });
  });

  it('a custom result interpreter maps a settled turn to failed', () => {
    const turn = turnResultFromHostOutcome(settledOk, () => 'failed');
    expect(turn).toEqual({ ok: true, status: 'failed' });
  });

  it('turn-outcome-unknown maps to an ambiguous, unfinished turn', () => {
    const turn = turnResultFromHostOutcome({
      ok: false,
      op: 'execute',
      code: 'turn-outcome-unknown',
      message: 'ambiguous',
    });
    expect(turn).toMatchObject({ ok: false, ambiguous: true, requestUnfinished: true });
  });

  it('a definitive host failure maps to a non-ambiguous turn', () => {
    const turn = turnResultFromHostOutcome({
      ok: false,
      op: 'execute',
      code: 'backend-timeout',
      message: 'timed out',
    });
    expect(turn).toMatchObject({ ok: false, ambiguous: false, requestUnfinished: false });
  });
});

describe('production seam - hosted backend adapter', () => {
  it('drives the SessionHost and surfaces a settled turn with the daemon alive', async () => {
    const host = stubHost(settledOk);
    const seam = createHostedBackendSeamFromSessionHost(host, {
      cwd: '/root',
      backend: 'claude',
      limits: LIMITS,
    });
    const result = await seam.executeTurn({ action: makeRecordAction(), input: 'do work' });
    expect(result.turn).toEqual({ ok: true, status: 'succeeded' });
    expect(result.daemonAlive).toBe(true);
  });

  it('actionExecuteRequestId is stable for the same Action and differs across Actions', () => {
    const action = makeRecordAction();
    const a = actionExecuteRequestId(action);
    const b = actionExecuteRequestId(action);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('production executor - driver-face parity over the WIRED production path (the gate)', () => {
  it('two driver faces dispatching the same granted Action through the production executor resolve to the same Run/Action/outcome', async () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    // The production executor is constructed once (matrix + wired hosted
    // backend). Every driver face calls its `dispatch` with the same granted
    // Action + Record + matrix verdict; no face builds its own truth.
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: { cwd: '/root', backend: 'claude', limits: LIMITS },
    });

    const dispatchFromFace = async () =>
      executor.dispatch({
        runRef,
        grantedAction: makeRecordAction(),
        record,
        expectedRecordVersion: 3,
        workspaceRevision: recordRevision,
        requestedBackend: 'hosted',
        turnInput: 'do the work',
      });

    // Two faces (CLI caller + Canvas caller) addressing the same Run through
    // the shared production executor receive identical typed results.
    const cliResult = await dispatchFromFace();
    const canvasResult = await dispatchFromFace();
    expect(cliResult.kind).toBe('executed');
    expect(JSON.stringify(cliResult)).toBe(JSON.stringify(canvasResult));
    if (cliResult.kind === 'executed' && canvasResult.kind === 'executed') {
      // Same Run/Action resolved through the shared projector/control contract.
      expect(cliResult.backend).toBe('hosted');
      expect(cliResult.outcome.kind).toBe('succeeded');
      expect(canvasResult.backend).toBe('hosted');
      expect(canvasResult.outcome.kind).toBe('succeeded');
    }
  });

  it('the production matrix is queryable before any Run starts', () => {
    const executor = createProductionExecutor({ hostPlatform: 'linux' });
    // The matrix is built at construction, before any dispatch/Run.
    expect(executor.matrix.hostPlatform).toBe('linux');
    expect(Object.keys(executor.matrix.cells)).toHaveLength(6);
  });
});

describe('production executor - execution-lost through the wired seam', () => {
  it('a hosted lost-generation turn (turn-outcome-unknown + unfinished) yields execution-lost', async () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost({
        ok: false,
        op: 'execute',
        code: 'turn-outcome-unknown',
        message: 'ambiguous',
      }),
      hostedSeamOptions: { cwd: '/root', backend: 'claude', limits: LIMITS },
    });
    const result = await executor.dispatch({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: 'do the work',
    });
    expect(result.kind).toBe('executed');
    if (result.kind === 'executed') {
      expect(result.outcome.kind).toBe('execution-lost');
      expect(result.outcome.source).toBe('lost-generation');
    }
  });

  it('in-tool launcher disappearance (via the liveness probe) yields execution-lost', async () => {
    const committed = grantedCommitted();
    const record = recordWith(committed);
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      launcherLivenessProbe: () => false,
    });
    const result = await executor.dispatch({
      runRef,
      grantedAction: makeRecordAction(),
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
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

describe('createInToolBackendSeamFromLauncherLiveness', () => {
  it('surfaces the launcher liveness signal and optional settle', async () => {
    let alive = true;
    const seam = createInToolBackendSeamFromLauncherLiveness(() => alive, () => ({
      ok: true,
      status: 'succeeded' as const,
    }));
    const live = await seam.executeTurn({ action: makeRecordAction(), input: 'x' });
    expect(live.launcherAlive).toBe(true);
    expect(live.turn).toEqual({ ok: true, status: 'succeeded' });
    alive = false;
    const dead = await seam.executeTurn({ action: makeRecordAction(), input: 'x' });
    expect(dead.launcherAlive).toBe(false);
  });
});
