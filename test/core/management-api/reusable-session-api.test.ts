import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  createReusableSessionService,
  projectReusableSession,
} from '../../../src/core/management-api/reusable-session-api.js';
import type {
  DurableSessionRecord,
  SessionHostCoordinator,
} from '../../../src/core/management-api/durable-session-registry.js';
import { durableSessionMessageIdDigest } from '../../../src/core/management-api/durable-session-registry.js';
import type { SessionSupervisor } from '../../../src/core/management-api/supervisor.js';
import { REUSABLE_SESSION_API_SCHEMA } from '../../../src/core/management-api/wire-types.js';
import {
  agentAction,
  bugFixPlan,
  bugFixPlanInput,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from '../change-run/reconciler-fixture.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

function sessionRecord(
  cwd: string,
  overrides: Partial<DurableSessionRecord> = {}
): DurableSessionRecord {
  return {
    sessionKey: 'reviewer',
    role: 'implementer',
    nodeId: 'node',
    invocationId: 'invocation',
    hostKind: 'stream-json',
    cwd,
    attachedRoots: [],
    model: 'sonnet',
    effort: 'medium',
    claudeSessionId: 'claude-session',
    status: 'idle',
    owner: {
      ownerInstanceId: 'owner',
      ownerPid: 100,
      hostId: 'host',
      childPid: 200,
      boundAt: '2026-07-30T09:00:00.000Z',
    },
    lifecycle: {
      createdAt: '2026-07-30T09:00:00.000Z',
      updatedAt: '2026-07-30T09:00:00.000Z',
      lastWakeAt: '2026-07-30T09:00:00.000Z',
    },
    touchPolicy: {
      mode: 'never',
      maxTouches: 0,
      touchesUsed: 0,
      deadlineAction: 'stop',
    },
    idempotencyTombstones: [],
    wakes: [],
    ...overrides,
  };
}

describe('rasen-reusable-session-api/1 service', () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  function fixture(options: { closed?: boolean; deferred?: boolean } = {}) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-reusable-api-runs-')
    );
    const cwd = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-reusable-api-cwd-'))
    );
    temporaryPaths.push(root, cwd);
    const plan = bugFixPlan();
    const action = agentAction(plan, 'root/apply');
    const claudeAction = {
      ...action,
      agent: {
        ...action.agent,
        runtime: 'claude',
        session: {
          ...action.agent.session,
          reuse: 'same-invocation' as const,
        },
      },
    };
    const admitted = reduceCanonicalRunRecord(startRecord(plan), {
      kind: 'admit-action',
      action: claudeAction,
      attemptOrdinal: 0,
      deliveryMode: options.deferred ? 'defer' : 'grant',
    });
    if (!admitted.ok) throw new Error(admitted.failure.message);
    let head = admitted.record;
    if (options.closed) {
      const observed = reduceCanonicalRunRecord(head, {
        kind: 'observe-effect',
        actionId: claudeAction.actionId,
        effectId: claudeAction.effects[0]!.effectId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        observation: { ok: true },
        evidence: evidenceFor(plan, claudeAction.actionId),
      });
      if (!observed.ok) throw new Error(observed.failure.message);
      const committed = reduceCanonicalRunRecord(observed.record, {
        kind: 'commit-action-result',
        actionId: claudeAction.actionId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        result: { ok: true },
        evidence: evidenceFor(plan, claudeAction.actionId),
      });
      if (!committed.ok) throw new Error(committed.failure.message);
      head = committed.record;
    }
    createFilesystemRunStore(root).create(plan.runId, head);
    const binding = {
      space: {
        type: 'project' as const,
        id: head.change.projectId,
        root: cwd,
      },
      execution: {
        kind: 'project' as const,
        projectId: head.change.projectId,
        root: cwd,
      },
    };
    const registered = sessionRecord(cwd, {
      actionId: action.actionId,
      nodeId: action.nodeId,
      invocationId: action.invocationId,
      ...binding,
    });
    const register = vi.fn(async () => ({
      ok: true as const,
      disposition: 'completed' as const,
      session: registered,
      wake: {
        messageIdDigest: 'a'.repeat(64),
        admittedAt: '2026-07-30T09:00:00.000Z',
        dispatchFenceAt: '2026-07-30T09:00:00.000Z',
        settledAt: '2026-07-30T09:00:00.000Z',
        outcome: 'completed' as const,
      },
      result: { type: 'result' },
    }));
    const get = vi.fn(async (): Promise<unknown> => ({
      ok: false as const,
      diagnostic: {
        code: 'registry_absent' as const,
        message: 'absent',
      },
    }));
    const wake = vi.fn(async () => ({
      ok: true as const,
      disposition: 'completed' as const,
      session: registered,
      wake: {
        messageIdDigest: 'b'.repeat(64),
        admittedAt: '2026-07-30T09:00:00.000Z',
        dispatchFenceAt: '2026-07-30T09:00:00.000Z',
        settledAt: '2026-07-30T09:00:00.000Z',
        outcome: 'completed' as const,
      },
      result: { type: 'result' },
    }));
    const coordinator = {
      ownerInstanceId: 'owner',
      store: { get },
      register,
      wake,
      get: vi.fn(),
      list: vi.fn(async () => ({ ok: true as const, sessions: [registered] })),
      reconcile: vi.fn(),
      retire: vi.fn(async () => ({
        ok: true as const,
        session: { ...registered, status: 'retired' as const },
      })),
      updateTouchPolicy: vi.fn(),
      ownerShutdown: vi.fn(async () => ({
        ok: true as const,
        sessions: [],
      })),
    } as unknown as SessionHostCoordinator;
    const supervisor = {
      shutdownAll: vi.fn(async () => undefined),
    } as unknown as SessionSupervisor;
    const coordinatorFactory = vi.fn(() => coordinator);
    const service = createReusableSessionService({
      supervisor,
      runsRoot: root,
      coordinatorFactory,
      clock: () => new Date('2026-07-30T09:00:00.000Z'),
    });
    return {
      root,
      cwd,
      plan,
      action: claudeAction,
      head,
      binding,
      registered,
      coordinator,
      register,
      get,
      wake,
      coordinatorFactory,
      service,
    };
  }

  it('decodes one exact Claude agent action and defaults bootstrap identity to actionId', async () => {
    const value = fixture();
    const response = await value.service.wake({
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake',
      kind: 'interactive',
      runId: value.plan.runId,
      sessionKey: 'reviewer',
      action: value.action,
      cwd: value.cwd,
      touchPolicy: {
        mode: 'auto',
        deadlineAt: '2026-07-30T10:00:00.000Z',
        maxTouches: 2,
        deadlineAction: 'stop',
      },
    });

    expect(response).toMatchObject({
      ok: true,
      operation: 'wake',
      code: 'completed',
      session: {
        runId: value.plan.runId,
        sessionKey: 'reviewer',
      },
    });
    expect(value.register).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: value.action.actionId,
        role: value.action.agent.role,
        actionId: value.action.actionId,
        nodeId: value.action.nodeId,
        invocationId: value.action.invocationId,
        cwd: value.cwd,
        space: value.binding.space,
        execution: value.binding.execution,
        touchPolicy: {
          mode: 'auto',
          deadlineAt: '2026-07-30T10:00:00.000Z',
          maxTouches: 2,
          touchesUsed: 0,
          deadlineAction: 'stop',
        },
      })
    );
  });

  it('fails closed when a sanitized Run directory decodes to a different exact identity', async () => {
    const value = fixture();
    const requested = `run:${'b'.repeat(64)}`;
    const requestedDir = path.join(
      value.root,
      requested.replace(/[^a-z0-9]/giu, '_')
    );
    const actualDir = path.join(
      value.root,
      value.plan.runId.replace(/[^a-z0-9]/giu, '_')
    );
    fs.renameSync(actualDir, requestedDir);

    const response = await value.service.list({ runId: requested });
    expect(response).toMatchObject({
      ok: false,
      code: 'run_identity_mismatch',
    });
  });

  it('projects no owner, raw message identity, prompt, result, lock path, or bearer token', () => {
    const value = fixture();
    const projection = projectReusableSession(
      value.plan.runId,
      value.registered
    );
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('ownerInstanceId');
    expect(serialized).not.toContain('messageIdDigest');
    expect(serialized).not.toContain('resultDigest');
    expect(serialized).not.toContain('token');
    expect(projection).toMatchObject({
      role: 'implementer',
      status: 'idle',
      cwd: value.cwd,
    });
  });

  it('rejects non-agent, wrong-Run, and non-Claude actions before coordinator admission', async () => {
    const value = fixture();
    const wrongRuntime = {
      ...value.action,
      agent: { ...value.action.agent, runtime: 'codex' },
    };
    const response = await value.service.wake({
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake',
      kind: 'interactive',
      runId: value.plan.runId,
      sessionKey: 'reviewer',
      action: wrongRuntime,
      cwd: value.cwd,
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        deadlineAction: 'stop',
      },
    });
    expect(response).toMatchObject({ ok: false, code: 'invalid_action' });
    expect(value.register).not.toHaveBeenCalled();
  });

  it('rejects absent and same-id modified actions before coordinator access', async () => {
    const value = fixture();
    const uncommittedBase = agentAction(value.plan, 'root/verify');
    const uncommitted = {
      ...uncommittedBase,
      agent: { ...uncommittedBase.agent, runtime: 'claude' },
    };
    const request = (action: unknown) => ({
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake',
      kind: 'interactive',
      runId: value.plan.runId,
      sessionKey: 'reviewer',
      action,
      cwd: value.cwd,
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        deadlineAction: 'stop',
      },
    });

    expect(await value.service.wake(request(uncommitted))).toMatchObject({
      ok: false,
      code: 'invalid_action',
    });
    expect(
      await value.service.wake(
        request({
          ...value.action,
          agent: {
            ...value.action.agent,
            input: { drifted: true },
          },
        })
      )
    ).toMatchObject({ ok: false, code: 'invalid_action' });
    expect(value.coordinatorFactory).not.toHaveBeenCalled();
  });

  it('permits only same-message terminal lookup for a closed action', async () => {
    const value = fixture({ closed: true });
    const messageId = 'closed-action-message';
    value.get.mockResolvedValue({
      ok: true as const,
      session: {
        ...value.registered,
        idempotencyTombstones: [
          {
            messageIdDigest: durableSessionMessageIdDigest(messageId),
            disposition: 'completed' as const,
          },
        ],
      },
    });
    const request = {
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake',
      kind: 'interactive',
      runId: value.plan.runId,
      sessionKey: 'reviewer',
      action: value.action,
      cwd: value.cwd,
      messageId,
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        deadlineAction: 'stop',
      },
    };

    expect(await value.service.wake(request)).toMatchObject({
      ok: true,
      disposition: 'duplicate',
      terminalDisposition: 'completed',
    });
    expect(
      await value.service.wake({ ...request, messageId: 'new-message' })
    ).toMatchObject({ ok: false, code: 'invalid_action' });
    expect(value.wake).not.toHaveBeenCalled();
    expect(value.register).not.toHaveBeenCalled();
  });

  it('rejects an admitted-but-not-granted action before bootstrap', async () => {
    const value = fixture({ deferred: true });
    expect(
      await value.service.wake({
        schema: REUSABLE_SESSION_API_SCHEMA,
        op: 'wake',
        kind: 'interactive',
        runId: value.plan.runId,
        sessionKey: 'reviewer',
        action: value.action,
        cwd: value.cwd,
        touchPolicy: {
          mode: 'never',
          maxTouches: 0,
          deadlineAction: 'stop',
        },
      })
    ).toMatchObject({ ok: false, code: 'invalid_action' });
    expect(value.register).not.toHaveBeenCalled();
  });

  it('uses an explicit stable identity for an existing session and rejects immutable drift', async () => {
    const value = fixture();
    value.get.mockResolvedValue({
      ok: true as const,
      session: value.registered,
    });
    const request = {
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake' as const,
      kind: 'interactive' as const,
      runId: value.plan.runId,
      sessionKey: 'reviewer',
      action: value.action,
      cwd: value.cwd,
      messageId: 'caller-stable-message',
      touchPolicy: {
        mode: 'never' as const,
        maxTouches: 0,
        deadlineAction: 'stop' as const,
      },
    };
    expect(await value.service.wake(request)).toMatchObject({
      ok: true,
      code: 'completed',
    });
    expect(value.wake).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'caller-stable-message' })
    );

    value.get.mockResolvedValue({
      ok: true as const,
      session: { ...value.registered, role: 'different-role' },
    });
    expect(await value.service.wake(request)).toMatchObject({
      ok: false,
      code: 'session_conflict',
    });
    expect(value.wake).toHaveBeenCalledOnce();

    value.get.mockResolvedValue({
      ok: true as const,
      session: {
        ...value.registered,
        execution: {
          kind: 'project' as const,
          projectId: 'different-project',
          root: value.cwd,
        },
      },
    });
    expect(await value.service.wake(request)).toMatchObject({
      ok: false,
      code: 'session_conflict',
    });
    expect(value.wake).toHaveBeenCalledOnce();
  });

  it('forwards the touch-policy snapshot precondition', async () => {
    const value = fixture();
    value.coordinator.updateTouchPolicy = vi.fn(async () => ({
      ok: false as const,
      code: 'conditional_wake_stale' as const,
      message: 'stale',
      session: value.registered,
    }));
    const response = await value.service.updateTouchPolicy({
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'touch-policy',
      runId: value.plan.runId,
      sessionKey: 'reviewer',
      expectedLastWakeAt: '2026-07-30T08:59:00.000Z',
      policy: value.registered.touchPolicy,
    });
    expect(value.coordinator.updateTouchPolicy).toHaveBeenCalledWith(
      'reviewer',
      value.registered.touchPolicy,
      '2026-07-30T08:59:00.000Z'
    );
    expect(response).toMatchObject({
      ok: false,
      code: 'conditional_wake_stale',
    });
  });

  it('reuses one resident coordinator and drains it through owner shutdown', async () => {
    const value = fixture();
    expect(await value.service.list({ runId: value.plan.runId }))
      .toMatchObject({ ok: true, code: 'listed' });
    expect(await value.service.list({ runId: value.plan.runId }))
      .toMatchObject({ ok: true, code: 'listed' });
    expect(value.coordinatorFactory).toHaveBeenCalledOnce();
    expect(await value.service.ownerShutdown()).toEqual({ ok: true });
    expect(value.coordinator.ownerShutdown).toHaveBeenCalledOnce();
    expect(await value.service.list({ runId: value.plan.runId }))
      .toMatchObject({ ok: false, code: 'shutting_down' });
  });

  it('returns one bounded redacted diagnostic for every failed run', async () => {
    const value = fixture();
    const secondPlan = createRuntimePlan({
      ...bugFixPlanInput(),
      runId: `run:${'b'.repeat(64)}` as typeof value.plan.runId,
    });
    const secondAction = agentAction(secondPlan, 'root/apply');
    const secondClaudeAction = {
      ...secondAction,
      agent: {
        ...secondAction.agent,
        runtime: 'claude' as const,
        session: {
          ...secondAction.agent.session,
          reuse: 'same-invocation' as const,
        },
      },
    };
    const secondAdmitted = reduceCanonicalRunRecord(startRecord(secondPlan), {
      kind: 'admit-action',
      action: secondClaudeAction,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    if (!secondAdmitted.ok) {
      throw new Error(secondAdmitted.failure.message);
    }
    createFilesystemRunStore(value.root).create(
      secondPlan.runId,
      secondAdmitted.record
    );

    value.coordinator.ownerShutdown = vi.fn(async () => ({
      ok: false as const,
      code: 'registry_write_failed' as const,
      message:
        'C:\\secret\\sessions.json token=owner-secret prompt=raw-message-id',
    }));
    const secondCoordinator = {
      ...value.coordinator,
      list: vi.fn(async () => ({ ok: true as const, sessions: [] })),
      ownerShutdown: vi.fn(async () => ({
        ok: false as const,
        code: 'unsafe code with token',
        message: '/secret/path bearer-token prompt raw-message-id',
      })),
    } as unknown as SessionHostCoordinator;
    value.coordinatorFactory.mockImplementation((run) =>
      run.runId === secondPlan.runId
        ? secondCoordinator
        : value.coordinator
    );
    expect(await value.service.list({ runId: value.plan.runId }))
      .toMatchObject({ ok: true });
    expect(await value.service.list({ runId: secondPlan.runId }))
      .toMatchObject({ ok: true });

    const shutdown = await value.service.ownerShutdown();
    expect(shutdown).toEqual({
      ok: false,
      code: 'owner_shutdown_failed',
      message: 'One or more reusable-session owners failed to shut down cleanly.',
      failures: [
        {
          runId: value.plan.runId,
          code: 'registry_write_failed',
          message:
            'The reusable-session coordinator failed to shut down cleanly.',
        },
        {
          runId: secondPlan.runId,
          code: 'owner_shutdown_failed',
          message:
            'The reusable-session coordinator failed to shut down cleanly.',
        },
      ],
    });
    expect(JSON.stringify(shutdown)).not.toMatch(
      /sessions\.json|owner-secret|bearer-token|prompt|raw-message-id|secret.path/u
    );
  });
});
