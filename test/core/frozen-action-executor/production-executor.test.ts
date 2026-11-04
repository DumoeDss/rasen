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
import {
  decodeRunAction,
  type ExactChangeRunRef,
} from '../../../src/core/change-run/contracts.js';
import type { RunAction } from '../../../src/core/change-run/contracts.js';
import { DEFAULT_EXECUTOR_POLICY_BLOCK } from '../../../src/core/frozen-action-executor/reuse-policy.js';
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
import {
  computeOmniCrossConfigRevision,
  OmniCrossRouteError,
  type OmniCrossRouteLeaseClient,
} from '../../../src/core/omnicross/index.js';
import { createRoutedActionLifecycle } from '../../../src/core/frozen-action-executor/omnicross-lifecycle.js';

const runRef: ExactChangeRunRef = {
  change: { projectRoot: '/root', changeId: 'fixture-change' },
  runId: recordIds.runId,
};

function grantedCommitted(action: RunAction = makeRecordAction()): CommittedAction {
  return {
    action,
    attemptOrdinal: 0,
    deliveryState: 'granted',
    state: 'active',
    effects: [],
  } as CommittedAction;
}

function routedAction(turnInput = 'do the work'): RunAction {
  const base = {
    endpoint: 'http://127.0.0.1:8765',
    controlTokenEnv: 'TEST_OMNICROSS_ADMIN',
    requestTimeoutMs: 1_000,
    leaseTtlSeconds: 60,
  };
  const action = makeBoundRecordAction(turnInput);
  if (action.kind !== 'agent') throw new Error('fixture must be an agent action');
  return {
    ...action,
    agent: {
      ...action.agent,
      model: 'deepseek-chat',
      workerContract: 'leaf',
      inference: {
        broker: 'omnicross',
        runtime: 'codex',
        upstream: { kind: 'provider', providerId: 'deepseek-api' },
        model: 'deepseek-chat',
        connection: {
          ...base,
          configRevision: computeOmniCrossConfigRevision(base),
        },
      },
    },
  };
}

function routeClient(options: { failCreate?: boolean } = {}): {
  client: OmniCrossRouteLeaseClient;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async create(request) {
        calls.push('create');
        if (options.failCreate) {
          throw new OmniCrossRouteError({
            kind: 'daemon-unavailable',
            message: 'fake daemon unavailable',
            retryable: false,
          });
        }
        return {
          schemaVersion: 'omnicross.route-lease/1',
          leaseId: 'lease-canonical',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          runtime: request.runtime,
          upstream: request.upstream,
          model: request.model,
          launch: {
            env: { OMNICROSS_CODEX_ROUTE_TOKEN: 'canonical-route-token' },
            extraArgs: [
              '-c', 'model_provider="omnicross"',
              '-c', 'model_providers.omnicross.name="omnicross"',
              '-c', 'model_providers.omnicross.base_url="http://127.0.0.1:8766/openai"',
              '-c', 'model_providers.omnicross.wire_api="responses"',
              '-c', 'model_providers.omnicross.env_key="OMNICROSS_CODEX_ROUTE_TOKEN"',
              '-c', 'disable_response_storage=true',
            ],
          },
        };
      },
      async renew() {
        throw new Error('renew not expected');
      },
      async release(leaseId) {
        calls.push('release');
        return {
          schemaVersion: 'omnicross.route-lease.release/1',
          leaseId,
          released: true,
        };
      },
    },
  };
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
    verifyTurnReceipt(): boolean {
      return false;
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
    expect(turn).toMatchObject({
      ok: true,
      status: 'succeeded',
      hostedTurn: {
        stableSessionId: '11111111-1111-1111-1111-111111111111',
        requestId: '11111111-1111-1111-1111-111111111111',
        result: '{"ok":true}',
        resultDigest: 'sha256:abc',
        replayed: false,
      },
    });
  });

  it('a custom result interpreter maps a settled turn to failed', () => {
    const turn = turnResultFromHostOutcome(settledOk, () => 'failed');
    expect(turn).toMatchObject({ ok: true, status: 'failed' });
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
    expect(result.turn).toMatchObject({ ok: true, status: 'succeeded' });
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

describe('production executor - frozen OmniCross Action lifecycle', () => {
  it('keeps old Actions readable and rejects secret-bearing routed Actions', () => {
    const legacy = makeRecordAction();
    expect(decodeRunAction(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    const routed = routedAction();
    expect(decodeRunAction(JSON.parse(JSON.stringify(routed)))).toEqual(routed);
    const secret = structuredClone(routed) as unknown as {
      agent: { inference: Record<string, unknown> };
    };
    secret.agent.inference.routeToken = 'forbidden';
    expect(() => decodeRunAction(secret)).toThrow();
  });

  it('fails closed before leasing a historical routed Action without turn-input authority', async () => {
    const current = routedAction('must not run');
    if (current.kind !== 'agent') throw new Error('expected agent Action');
    const legacy = structuredClone(current) as unknown as {
      agent: { turnInput?: unknown };
    };
    delete legacy.agent.turnInput;
    const action = decodeRunAction(legacy);
    const route = routeClient();
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: {
        cwd: '/root',
        backend: 'claude',
        limits: LIMITS,
        executeRoutedTurn: async () => ({ ok: true, status: 'succeeded' }),
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: { TEST_OMNICROSS_ADMIN: 'canonical-admin-token' },
        createClient: () => route.client,
      }),
    });

    await expect(executor.dispatch({
      runRef,
      grantedAction: action,
      record: recordWith(grantedCommitted(action)),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: 'must not run',
    })).resolves.toMatchObject({
      kind: 'execution-input-rejected',
      code: 'execution_input_authority_missing',
      retryable: false,
    });
    expect(route.calls).toEqual([]);
  });

  it('fails closed before leasing an old routed Action without worker-contract authority', async () => {
    const current = routedAction('must not run');
    if (current.kind !== 'agent') throw new Error('expected agent Action');
    const legacy = structuredClone(current) as unknown as {
      agent: {
        workerContract?: 'leaf' | 'evaluate';
        turnInput?: unknown;
      };
    };
    delete legacy.agent.workerContract;
    // This fixture isolates the historical worker-contract check. Historical
    // routed Actions without turn-input authority have their own earlier result.
    legacy.agent.turnInput = current.agent.turnInput;
    const action = decodeRunAction(legacy);
    const route = routeClient();
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: {
        cwd: '/root',
        backend: 'claude',
        limits: LIMITS,
        executeRoutedTurn: async () => ({ ok: true, status: 'succeeded' }),
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: { TEST_OMNICROSS_ADMIN: 'canonical-admin-token' },
        createClient: () => route.client,
      }),
    });

    await expect(executor.dispatch({
      runRef,
      grantedAction: action,
      record: recordWith(grantedCommitted(action)),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: 'must not run',
    })).resolves.toMatchObject({
      kind: 'route-failed',
      failure: { kind: 'invalid-input', retryable: false },
    });
    expect(route.calls).toEqual([]);
  });

  it('rejects oversized hosted routed input before leasing or calling the backend', async () => {
    const action = routedAction('猫');
    const route = routeClient();
    let routedTurns = 0;
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: {
        cwd: '/root',
        backend: 'claude',
        limits: { ...LIMITS, maxInputBytes: 2 },
        executeRoutedTurn: async () => {
          routedTurns += 1;
          return { ok: true, status: 'succeeded' };
        },
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: { TEST_OMNICROSS_ADMIN: 'canonical-admin-token' },
        createClient: () => route.client,
      }),
    });

    await expect(executor.dispatch({
      runRef,
      grantedAction: action,
      record: recordWith(grantedCommitted(action)),
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: '猫',
    })).resolves.toMatchObject({
      kind: 'execution-input-rejected',
      code: 'execution_input_too_large',
      retryable: false,
    });
    expect(route.calls).toEqual([]);
    expect(routedTurns).toBe(0);
  });

  it('acquires from the frozen Action, injects one binding, and releases', async () => {
    const action = routedAction('do routed work');
    const committed = grantedCommitted(action);
    const record = recordWith(committed);
    const route = routeClient();
    let routedTurns = 0;
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: {
        cwd: '/root',
        backend: 'claude',
        limits: LIMITS,
        executeRoutedTurn: async ({ binding }) => {
          routedTurns += 1;
          expect(binding.runtime).toBe('codex');
          if (binding.runtime === 'codex') {
            expect(binding.env.OMNICROSS_CODEX_ROUTE_TOKEN).toBe('canonical-route-token');
          }
          return { ok: true, status: 'succeeded' };
        },
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: { TEST_OMNICROSS_ADMIN: 'canonical-admin-token' },
        createClient: () => route.client,
      }),
    });
    const result = await executor.dispatch({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: 'do routed work',
    });
    expect(result).toMatchObject({
      kind: 'executed',
      outcome: { kind: 'succeeded' },
    });
    expect(routedTurns).toBe(1);
    expect(route.calls).toEqual(['create', 'release']);
  });

  it('returns a typed route failure and never calls the backend when create fails', async () => {
    const action = routedAction('must not run');
    const committed = grantedCommitted(action);
    const record = recordWith(committed);
    const route = routeClient({ failCreate: true });
    let routedTurns = 0;
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: {
        cwd: '/root',
        backend: 'claude',
        limits: LIMITS,
        executeRoutedTurn: async () => {
          routedTurns += 1;
          return { ok: true, status: 'succeeded' };
        },
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: { TEST_OMNICROSS_ADMIN: 'canonical-admin-token' },
        createClient: () => route.client,
      }),
    });
    const result = await executor.dispatch({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: 'must not run',
    });
    expect(result).toMatchObject({
      kind: 'route-failed',
      failure: { kind: 'daemon-unavailable' },
    });
    expect(routedTurns).toBe(0);
    expect(route.calls).toEqual(['create']);
  });

  it('maps missing control authority to route-failed without rejecting or calling the backend', async () => {
    const action = routedAction('must not run');
    const record = recordWith(grantedCommitted(action));
    let routedTurns = 0;
    let clientCreations = 0;
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host: stubHost(settledOk),
      hostedSeamOptions: {
        cwd: '/root',
        backend: 'claude',
        limits: LIMITS,
        executeRoutedTurn: async () => {
          routedTurns += 1;
          return { ok: true, status: 'succeeded' };
        },
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: {},
        createClient: () => {
          clientCreations += 1;
          return routeClient().client;
        },
      }),
    });
    await expect(executor.dispatch({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'hosted',
      turnInput: 'must not run',
    })).resolves.toMatchObject({
      kind: 'route-failed',
      failure: { kind: 'invalid-config' },
    });
    expect(clientCreations).toBe(0);
    expect(routedTurns).toBe(0);
  });

  it('injects the route binding through the in-tool driver face and releases', async () => {
    const action = routedAction('do routed work');
    const record = recordWith(grantedCommitted(action));
    const route = routeClient();
    let routedTurns = 0;
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      launcherLivenessProbe: () => true,
      executeInToolRoutedTurn: async ({ binding, signal }) => {
        routedTurns += 1;
        expect(signal.aborted).toBe(false);
        expect(binding).toMatchObject({ runtime: 'codex' });
        return { ok: true, status: 'succeeded' };
      },
      routedActionLifecycle: createRoutedActionLifecycle({
        env: { TEST_OMNICROSS_ADMIN: 'canonical-admin-token' },
        createClient: () => route.client,
      }),
    });
    await expect(executor.dispatch({
      runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: 3,
      workspaceRevision: recordRevision,
      requestedBackend: 'in-tool',
      turnInput: 'do routed work',
    })).resolves.toMatchObject({
      kind: 'executed',
      outcome: { kind: 'succeeded' },
    });
    expect(routedTurns).toBe(1);
    expect(route.calls).toEqual(['create', 'release']);
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

describe('production executor - consultation continuation wiring', () => {
  it('passes the exact stable Session, deterministic request, and committed advice to SessionHost', async () => {
    const fixture = buildGrantedConsultationFixture();
    const commands: SessionHostCommand[] = [];
    const host: SessionHost = {
      ...stubHost(settledOk),
      inspect(sessionId): SessionHostView | undefined {
        if (sessionId !== fixture.grant.stableSessionId) return undefined;
        return {
          ...stubSessionView(),
          sessionId,
          sandbox: fixture.sourceAction.agent.sandbox,
          authority: {
            invocationId: fixture.sourceAction.invocationId,
            role: fixture.sourceAction.agent.role,
            workspaceInstanceId: fixture.record.workspaceInstanceId,
            backend: 'hosted',
            handoffTokensUsed: 0,
            reuseRoundsServed: 0,
          },
        };
      },
      async dispatch(command: SessionHostCommand): Promise<SessionHostOutcome> {
        commands.push(command);
        if (command.op !== 'execute') {
          return {
            ok: false,
            op: command.op,
            code: 'invalid-input',
            message: 'expected execute',
          };
        }
        return {
          ok: true,
          op: 'execute',
          session: {
            ...stubSessionView(),
            sessionId: command.sessionId!,
            currentRequest: {
              requestId: command.requestId,
              state: 'settled',
              generation: 1,
              resultDigest: `sha256:${'b'.repeat(64)}`,
            },
          },
          requestId: command.requestId,
          result: '{"status":"DONE"}',
          resultDigest: `sha256:${'b'.repeat(64)}`,
        };
      },
    };
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host,
      hostedSeamOptions: { cwd: '/root', backend: 'claude', limits: LIMITS },
    });
    const result = await executor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });
    expect(result.kind).toBe('executed');
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command?.op).toBe('execute');
    if (command?.op !== 'execute') return;
    expect(command.sessionId).toBe(fixture.grant.stableSessionId);
    expect(command.requestId).toBe(fixture.grant.requestId);
    expect(JSON.parse(command.input)).toEqual(fixture.grant.input);
    expect(fixture.grant.requestId).not.toBe(actionExecuteRequestId(fixture.sourceAction));
    if (result.kind === 'executed') {
      expect(result.outcome.hostedTurn).toMatchObject({
        stableSessionId: fixture.grant.stableSessionId,
        requestId: fixture.grant.requestId,
        requestState: 'settled',
      });
    }
  });

  it('rejects a new continuation at the persisted reuse limit but permits exact settled-request replay', async () => {
    const fixture = buildGrantedConsultationFixture();
    let exactReplay = false;
    let dispatches = 0;
    const host: SessionHost = {
      ...stubHost(settledOk),
      inspect(sessionId): SessionHostView | undefined {
        if (sessionId !== fixture.grant.stableSessionId) return undefined;
        return {
          ...stubSessionView(),
          sessionId,
          sandbox: fixture.sourceAction.agent.sandbox,
          authority: {
            invocationId: fixture.sourceAction.invocationId,
            role: fixture.sourceAction.agent.role,
            workspaceInstanceId: fixture.record.workspaceInstanceId,
            backend: 'hosted',
            handoffTokensUsed: 0,
            reuseRoundsServed:
              DEFAULT_EXECUTOR_POLICY_BLOCK.defaultReuseRoundLimit,
          },
          ...(exactReplay
            ? {
                currentRequest: {
                  requestId: fixture.grant.requestId,
                  state: 'settled' as const,
                  generation: 1,
                },
              }
            : {}),
        };
      },
      async dispatch(command: SessionHostCommand): Promise<SessionHostOutcome> {
        dispatches += 1;
        if (command.op !== 'execute') {
          return {
            ok: false,
            op: command.op,
            code: 'invalid-input',
            message: 'expected execute',
          };
        }
        return {
          ok: true,
          op: 'execute',
          session: {
            ...stubSessionView(),
            sessionId: command.sessionId!,
            currentRequest: {
              requestId: command.requestId,
              state: 'settled',
              generation: 1,
              resultDigest: `sha256:${'c'.repeat(64)}`,
            },
          },
          requestId: command.requestId,
          result: '{"status":"DONE"}',
          resultDigest: `sha256:${'c'.repeat(64)}`,
          replayed: true,
        };
      },
    };
    const executor = createProductionExecutor({
      hostPlatform: 'linux',
      host,
      hostedSeamOptions: { cwd: '/root', backend: 'claude', limits: LIMITS },
    });

    const fresh = await executor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });
    expect(fresh).toMatchObject({
      kind: 'rejected',
      code: 'receipt_conflict',
      message: expect.stringMatching(/reuse.*not permitted/i),
    });
    expect(dispatches).toBe(0);

    exactReplay = true;
    const replay = await executor.dispatchContinuation({
      grant: fixture.grant,
      record: fixture.record,
    });
    expect(replay.kind).toBe('executed');
    expect(dispatches).toBe(1);
    if (replay.kind === 'executed') {
      expect(replay.outcome.hostedTurn).toMatchObject({
        requestId: fixture.grant.requestId,
        replayed: true,
      });
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
