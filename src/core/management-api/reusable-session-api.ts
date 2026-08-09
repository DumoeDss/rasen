import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import {
  decodeRunAction,
  type RunAction,
  type RunId,
} from '../change-run/index.js';
import { createFilesystemRunStore } from '../change-run/internal/run-store-fs.js';
import { RunStoreError } from '../change-run/internal/run-store.js';
import type { CanonicalRunRecord } from '../change-run/internal/record.js';
import { getGlobalDataDir } from '../global-config.js';
import type { RuntimeExecutionRef } from '../session-runtime-context.js';
import {
  createSessionHostCoordinator,
  durableSessionMessageIdDigest,
  type DurableSessionRecord,
  type DurableTouchPolicy,
  type SessionHostCoordinator,
  type SessionHostCoordinatorFailure,
  type TrustedCanonicalRunRef,
} from './durable-session-registry.js';
import type { SessionSpace } from './session-registry.js';
import type { SessionSupervisor } from './supervisor.js';
import {
  REUSABLE_SESSION_API_SCHEMA,
  type ReusableSessionApiFailure,
  type ReusableSessionApiResponse,
  type ReusableSessionApiSuccess,
  type ReusableSessionProjectionWire,
  type ReusableSessionRetireRequest,
  type ReusableSessionTerminalWire,
  type ReusableSessionTouchPolicyRequest,
  type ReusableSessionWakeRequest,
} from './wire-types.js';

export const DEFAULT_REUSABLE_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_REUSABLE_SESSION_NO_OUTPUT_TIMEOUT_MS = 5 * 60 * 1000;
export const REUSABLE_SESSION_OWNER_SHUTDOWN_TIMEOUT_MS = 7_500;

export type ReusableSessionCommandAction = RunAction;

/** Keep Run-action schema authority behind the reusable-session API boundary. */
export function decodeReusableSessionCommandAction(
  value: unknown
): ReusableSessionCommandAction {
  return decodeRunAction(value);
}

const RUN_ID_PATTERN = /^run:[0-9a-f]{64}$/u;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_MESSAGE_ID_LENGTH = 512;
const MAX_TOUCH_MESSAGE_LENGTH = 64 * 1024;

const TimestampSchema = z.string().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value;
}, 'Expected an ISO-8601 UTC timestamp');

const SessionKeySchema = z.string().regex(SESSION_KEY_PATTERN);
const MessageIdSchema = z.string().min(1).max(MAX_MESSAGE_ID_LENGTH);
const TouchPolicySchema = z
  .object({
    mode: z.enum(['auto', 'never']),
    deadlineAt: TimestampSchema.optional(),
    maxTouches: z.number().int().nonnegative(),
    deadlineAction: z.enum(['stop', 'retire-silent']),
  })
  .strict();

const InteractiveWakeRequestSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    op: z.literal('wake'),
    kind: z.literal('interactive'),
    runId: z.string().regex(RUN_ID_PATTERN),
    sessionKey: SessionKeySchema,
    action: z.unknown(),
    cwd: z.string().min(1).max(32 * 1024),
    messageId: MessageIdSchema.optional(),
    touchPolicy: TouchPolicySchema,
  })
  .strict();

const TouchWakeRequestSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    op: z.literal('wake'),
    kind: z.literal('touch'),
    runId: z.string().regex(RUN_ID_PATTERN),
    sessionKey: SessionKeySchema,
    messageId: MessageIdSchema,
    message: z.string().min(1).max(MAX_TOUCH_MESSAGE_LENGTH),
    expectedLastWakeAt: TimestampSchema,
    touchOrdinal: z.number().int().positive(),
    touchAttempt: z.number().int().positive(),
    timeoutMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
    noOutputTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1000)
      .optional(),
  })
  .strict();

const WakeRequestSchema = z.discriminatedUnion('kind', [
  InteractiveWakeRequestSchema,
  TouchWakeRequestSchema,
]);

const RetireRequestSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    op: z.literal('retire'),
    runId: z.string().regex(RUN_ID_PATTERN),
    sessionKey: SessionKeySchema,
    reason: z.string().min(1).max(512),
  })
  .strict();

const TouchPolicyRequestSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    op: z.literal('touch-policy'),
    runId: z.string().regex(RUN_ID_PATTERN),
    sessionKey: SessionKeySchema,
    expectedLastWakeAt: TimestampSchema.optional(),
    policy: z
      .object({
        mode: z.enum(['auto', 'never']),
        deadlineAt: TimestampSchema.optional(),
        maxTouches: z.number().int().nonnegative(),
        touchesUsed: z.number().int().nonnegative(),
        deadlineAction: z.enum(['stop', 'retire-silent']),
      })
      .strict(),
  })
  .strict();

type CoordinatorFactory = (
  run: TrustedCanonicalRunRef,
  supervisor: SessionSupervisor
) => SessionHostCoordinator;

export interface CreateReusableSessionServiceOptions {
  supervisor: SessionSupervisor;
  runsRoot?: string;
  clock?: () => Date;
  ownerInstanceId?: string;
  coordinatorFactory?: CoordinatorFactory;
  ownerShutdownTimeoutMs?: number;
}

export interface ReusableSessionService {
  wake(value: unknown): Promise<ReusableSessionApiResponse>;
  list(input: {
    runId?: string;
    scope?: 'all';
  }): Promise<ReusableSessionApiResponse>;
  retire(value: unknown): Promise<ReusableSessionApiResponse>;
  updateTouchPolicy(value: unknown): Promise<ReusableSessionApiResponse>;
  ownerShutdown(): Promise<ReusableSessionOwnerShutdownResult>;
}

export interface ReusableSessionOwnerShutdownDiagnostic {
  runId?: string;
  code: string;
  message: string;
}

const SAFE_OWNER_SHUTDOWN_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

function safeOwnerShutdownCode(code: string): string {
  return SAFE_OWNER_SHUTDOWN_CODE.test(code)
    ? code
    : 'owner_shutdown_failed';
}

export type ReusableSessionOwnerShutdownResult =
  | { ok: true }
  | {
      ok: false;
      code: 'owner_shutdown_failed';
      message: string;
      failures: ReusableSessionOwnerShutdownDiagnostic[];
    };

function failure(
  operation: ReusableSessionApiFailure['operation'],
  code: string,
  message: string,
  identity: {
    runId?: string;
    sessionKey?: string;
    session?: ReusableSessionProjectionWire;
  } = {}
): ReusableSessionApiFailure {
  return {
    schema: REUSABLE_SESSION_API_SCHEMA,
    ok: false,
    operation,
    code,
    message,
    ...identity,
  };
}

function success(
  operation: ReusableSessionApiSuccess['operation'],
  code: string,
  value: Omit<
    ReusableSessionApiSuccess,
    'schema' | 'ok' | 'operation' | 'code'
  > = {}
): ReusableSessionApiSuccess {
  return {
    schema: REUSABLE_SESSION_API_SCHEMA,
    ok: true,
    operation,
    code,
    ...value,
  };
}

function safeTerminal(
  wake: DurableSessionRecord['wakes'][number]
): ReusableSessionTerminalWire {
  return {
    admittedAt: wake.admittedAt,
    ...(wake.dispatchFenceAt !== undefined
      ? { dispatchFenceAt: wake.dispatchFenceAt }
      : {}),
    settledAt: wake.settledAt,
    outcome: wake.outcome,
    ...(wake.kind !== undefined ? { kind: wake.kind } : {}),
    ...(wake.touchOrdinal !== undefined
      ? { touchOrdinal: wake.touchOrdinal }
      : {}),
    ...(wake.touchAttempt !== undefined
      ? { touchAttempt: wake.touchAttempt }
      : {}),
    ...(wake.code !== undefined ? { code: wake.code } : {}),
  };
}

export function projectReusableSession(
  runId: string,
  session: DurableSessionRecord
): ReusableSessionProjectionWire {
  return {
    runId,
    sessionKey: session.sessionKey,
    role: session.role,
    status: session.status,
    cwd: session.cwd,
    lifecycle: { ...session.lifecycle },
    touchPolicy: { ...session.touchPolicy },
    wakes: session.wakes.map(safeTerminal),
  };
}

function coordinatorFailureResponse(
  operation: ReusableSessionApiFailure['operation'],
  runId: string,
  sessionKey: string | undefined,
  value: SessionHostCoordinatorFailure
): ReusableSessionApiFailure {
  return failure(operation, value.code, value.message, {
    runId,
    ...(sessionKey !== undefined ? { sessionKey } : {}),
    ...(value.session !== undefined
      ? { session: projectReusableSession(runId, value.session) }
      : {}),
  });
}

function serializedAgentInput(action: Extract<RunAction, { kind: 'agent' }>): string {
  return typeof action.agent.input === 'string'
    ? action.agent.input || '""'
    : JSON.stringify(action.agent.input) ?? 'null';
}

function normalizeTouchPolicy(
  request: z.infer<typeof InteractiveWakeRequestSchema>,
  action: Extract<RunAction, { kind: 'agent' }>,
  now: Date
): DurableTouchPolicy | { error: string } {
  if (action.agent.session.reuse === 'never') {
    return {
      mode: 'never',
      maxTouches: 0,
      touchesUsed: 0,
      deadlineAction: request.touchPolicy.deadlineAction,
    };
  }
  const policy = request.touchPolicy;
  if (policy.mode === 'never') {
    if (policy.deadlineAt !== undefined || policy.maxTouches !== 0) {
      return {
        error:
          'A never touch policy cannot carry a deadline or a positive touch limit.',
      };
    }
    return {
      mode: 'never',
      maxTouches: 0,
      touchesUsed: 0,
      deadlineAction: policy.deadlineAction,
    };
  }
  if (
    policy.deadlineAt === undefined
    || new Date(policy.deadlineAt).valueOf() <= now.valueOf()
    || policy.maxTouches <= 0
  ) {
    return {
      error:
        'An auto touch policy requires a future deadline and a positive touch limit.',
    };
  }
  return {
    mode: 'auto',
    deadlineAt: policy.deadlineAt,
    maxTouches: policy.maxTouches,
    touchesUsed: 0,
    deadlineAction: policy.deadlineAction,
  };
}

function canonicalExistingDirectory(value: string): string | { error: string } {
  try {
    const resolved = path.resolve(value);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { error: 'The execution directory must be a real directory.' };
    }
    return fs.realpathSync.native(resolved);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'The execution directory could not be resolved.',
    };
  }
}

function pathIdentity(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function immutableFactsMatch(
  session: DurableSessionRecord,
  action: Extract<RunAction, { kind: 'agent' }>,
  cwd: string,
  space: SessionSpace,
  execution: RuntimeExecutionRef
): boolean {
  return (
    session.role === action.agent.role
    && session.actionId === action.actionId
    && session.nodeId === action.nodeId
    && session.invocationId === action.invocationId
    && session.model === action.agent.model
    && session.effort === action.agent.reasoningEffort
    && pathIdentity(session.cwd) === pathIdentity(cwd)
    && isDeepStrictEqual(session.space, space)
    && isDeepStrictEqual(session.execution, execution)
    && session.attachedRoots.length === 0
  );
}

function trustedExecutionBinding(
  record: CanonicalRunRecord,
  cwd: string
): { space: SessionSpace; execution: RuntimeExecutionRef } {
  return {
    space: {
      type: 'project',
      id: record.change.projectId,
      root: cwd,
    },
    execution: {
      kind: 'project',
      projectId: record.change.projectId,
      root: cwd,
    },
  };
}

function responseForWake(
  runId: string,
  sessionKey: string,
  result:
    | Awaited<ReturnType<SessionHostCoordinator['register']>>
    | Awaited<ReturnType<SessionHostCoordinator['wake']>>
): ReusableSessionApiResponse {
  if (!result.ok) {
    return coordinatorFailureResponse('wake', runId, sessionKey, result);
  }
  if (result.disposition === 'duplicate') {
    return success('wake', `duplicate_${result.terminalDisposition}`, {
      runId,
      sessionKey,
      disposition: 'duplicate',
      terminalDisposition: result.terminalDisposition,
      session: projectReusableSession(runId, result.session),
    });
  }
  return success('wake', 'completed', {
    runId,
    sessionKey,
    disposition: 'completed',
    terminalDisposition: 'completed',
    session: projectReusableSession(runId, result.session),
  });
}

export function reusableSessionHttpStatus(
  response: ReusableSessionApiResponse
): number {
  if (response.ok) return 200;
  if (
    response.code === 'invalid_request'
    || response.code === 'invalid_action'
    || response.code === 'run_identity_mismatch'
    || response.code === 'session_conflict'
    || response.code === 'invalid_transition'
  ) {
    return 400;
  }
  if (
    response.code === 'run_not_found'
    || response.code === 'session_not_found'
  ) {
    return 404;
  }
  if (
    response.code === 'wake_busy'
    || response.code === 'host_busy'
    || response.code === 'busy'
    || response.code === 'conditional_wake_stale'
    || response.code === 'idempotency_capacity_exhausted'
  ) {
    return 409;
  }
  if (
    response.code === 'agent_cli_unavailable'
    || response.code === 'shutting_down'
  ) {
    return 503;
  }
  return 500;
}

export function createReusableSessionService(
  options: CreateReusableSessionServiceOptions
): ReusableSessionService {
  const runsRoot =
    options.runsRoot ?? path.join(getGlobalDataDir(), 'runs');
  const runStore = createFilesystemRunStore(runsRoot);
  const coordinators = new Map<
    string,
    { runId: string; coordinator: SessionHostCoordinator }
  >();
  const ownerInstanceId = options.ownerInstanceId ?? randomUUID();
  const clock = options.clock ?? (() => new Date());
  const ownerShutdownTimeoutMs =
    options.ownerShutdownTimeoutMs
    ?? REUSABLE_SESSION_OWNER_SHUTDOWN_TIMEOUT_MS;
  const coordinatorFactory =
    options.coordinatorFactory
    ?? ((run: TrustedCanonicalRunRef, supervisor: SessionSupervisor) =>
      createSessionHostCoordinator({ run, supervisor, ownerInstanceId }));
  let accepting = true;
  let shutdownPromise: Promise<ReusableSessionOwnerShutdownResult> | undefined;

  async function boundedOwnerShutdown<T>(
    operation: Promise<T>
  ): Promise<
    | { kind: 'settled'; value: T }
    | { kind: 'failed'; error: unknown }
    | { kind: 'timeout' }
  > {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: 'timeout' }),
        ownerShutdownTimeoutMs
      );
      timer.unref?.();
    });
    const settled = operation.then(
      (value) => ({ kind: 'settled' as const, value }),
      (error: unknown) => ({ kind: 'failed' as const, error })
    );
    const result = await Promise.race([settled, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return result;
  }

  function resolveRun(
    requestedRunId: string
  ):
    | {
        ok: true;
        run: TrustedCanonicalRunRef;
        record: CanonicalRunRecord;
      }
    | { ok: false; code: string; message: string } {
    if (!RUN_ID_PATTERN.test(requestedRunId)) {
      return {
        ok: false,
        code: 'invalid_request',
        message: 'The requested Run id is invalid.',
      };
    }
    let record: ReturnType<typeof runStore.load>;
    try {
      record = runStore.load(requestedRunId as RunId);
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof RunStoreError && error.code === 'run_not_found'
            ? 'run_not_found'
            : 'run_record_invalid',
        message:
          error instanceof RunStoreError && error.code === 'run_not_found'
            ? `No canonical Run exists for ${requestedRunId}.`
            : `The canonical Run record for ${requestedRunId} is invalid.`,
      };
    }
    if (record.runId !== requestedRunId) {
      return {
        ok: false,
        code: 'run_identity_mismatch',
        message:
          'The selected Run directory contains a different exact Run identity.',
      };
    }
    const candidate = path.join(
      runsRoot,
      requestedRunId.replace(/[^a-z0-9]/giu, '_')
    );
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('The Run path is not a real directory.');
      }
      const canonicalRunDir = fs.realpathSync.native(candidate);
      return {
        ok: true,
        record,
        run: {
          kind: 'trusted-canonical-run',
          runId: requestedRunId,
          canonicalRunDir,
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: 'run_directory_invalid',
        message:
          error instanceof Error
            ? error.message
            : 'The canonical Run directory is unavailable.',
      };
    }
  }

  function coordinatorFor(run: TrustedCanonicalRunRef): SessionHostCoordinator {
    const key = pathIdentity(run.canonicalRunDir);
    const existing = coordinators.get(key);
    if (existing) return existing.coordinator;
    const created = coordinatorFactory(run, options.supervisor);
    coordinators.set(key, { runId: run.runId, coordinator: created });
    return created;
  }

  function inactive(
    operation: ReusableSessionApiFailure['operation']
  ): ReusableSessionApiFailure | undefined {
    return accepting
      ? undefined
      : failure(
          operation,
          'shutting_down',
          'The reusable-session owner is shutting down.'
        );
  }

  return {
    async wake(value) {
      const stopped = inactive('wake');
      if (stopped) return stopped;
      const decoded = WakeRequestSchema.safeParse(value);
      if (!decoded.success) {
        return failure(
          'wake',
          'invalid_request',
          'The reusable-session wake envelope is invalid.'
        );
      }
      const request = decoded.data as ReusableSessionWakeRequest;
      const resolved = resolveRun(request.runId);
      if (!resolved.ok) {
        return failure('wake', resolved.code, resolved.message, {
          runId: request.runId,
          sessionKey: request.sessionKey,
        });
      }
      if (request.kind === 'touch') {
        const coordinator = coordinatorFor(resolved.run);
        const result = await coordinator.wake({
          sessionKey: request.sessionKey,
          messageId: request.messageId,
          message: request.message,
          timeoutMs:
            request.timeoutMs ?? DEFAULT_REUSABLE_SESSION_TIMEOUT_MS,
          noOutputTimeoutMs:
            request.noOutputTimeoutMs
            ?? DEFAULT_REUSABLE_SESSION_NO_OUTPUT_TIMEOUT_MS,
          kind: 'touch',
          expectedLastWakeAt: request.expectedLastWakeAt,
          touchOrdinal: request.touchOrdinal,
          touchAttempt: request.touchAttempt,
        });
        return responseForWake(request.runId, request.sessionKey, result);
      }

      let action: RunAction;
      try {
        action = decodeRunAction(request.action);
      } catch (error) {
        return failure(
          'wake',
          'invalid_action',
          error instanceof Error ? error.message : 'The Run action is invalid.',
          { runId: request.runId, sessionKey: request.sessionKey }
        );
      }
      if (
        action.kind !== 'agent'
        || action.runId !== request.runId
        || action.agent.runtime.toLowerCase() !== 'claude'
      ) {
        return failure(
          'wake',
          'invalid_action',
          'The action must be a Claude agent action for the selected exact Run.',
          { runId: request.runId, sessionKey: request.sessionKey }
        );
      }
      const committed = resolved.record.actions[action.actionId];
      if (
        committed === undefined
        || !isDeepStrictEqual(committed.action, action)
      ) {
        return failure(
          'wake',
          'invalid_action',
          committed === undefined
            ? 'The action was not admitted by the selected canonical Run.'
            : 'The action differs from the frozen action admitted by the selected canonical Run.',
          { runId: request.runId, sessionKey: request.sessionKey }
        );
      }
      const cwd = canonicalExistingDirectory(request.cwd);
      if (typeof cwd !== 'string') {
        return failure('wake', 'invalid_action', cwd.error, {
          runId: request.runId,
          sessionKey: request.sessionKey,
        });
      }
      const touchPolicy = normalizeTouchPolicy(request, action, clock());
      if ('error' in touchPolicy) {
        return failure('wake', 'invalid_action', touchPolicy.error, {
          runId: request.runId,
          sessionKey: request.sessionKey,
        });
      }
      const messageId = request.messageId ?? action.actionId;
      const binding = trustedExecutionBinding(resolved.record, cwd);
      const deliverable =
        committed.state === 'active'
        && committed.deliveryState === 'granted';
      const coordinator = coordinatorFor(resolved.run);
      const existing = await coordinator.store.get(request.sessionKey);
      if (!existing.ok) {
        if (
          existing.diagnostic.code !== 'registry_absent'
          && existing.diagnostic.code !== 'session_not_found'
        ) {
          return failure(
            'wake',
            existing.diagnostic.code,
            existing.diagnostic.message,
            { runId: request.runId, sessionKey: request.sessionKey }
          );
        }
        if (!deliverable) {
          return failure(
            'wake',
            'invalid_action',
            'The committed action is not active and granted for a new dispatch.',
            { runId: request.runId, sessionKey: request.sessionKey }
          );
        }
        const registered = await coordinator.register({
          sessionKey: request.sessionKey,
          messageId,
          role: action.agent.role,
          actionId: action.actionId,
          nodeId: action.nodeId,
          invocationId: action.invocationId,
          message: serializedAgentInput(action),
          cwd,
          timeoutMs: DEFAULT_REUSABLE_SESSION_TIMEOUT_MS,
          noOutputTimeoutMs:
            DEFAULT_REUSABLE_SESSION_NO_OUTPUT_TIMEOUT_MS,
          model: action.agent.model,
          effort: action.agent.reasoningEffort,
          space: binding.space,
          execution: binding.execution,
          touchPolicy,
        });
        return responseForWake(request.runId, request.sessionKey, registered);
      }
      if (
        !immutableFactsMatch(
          existing.session,
          action,
          cwd,
          binding.space,
          binding.execution
        )
      ) {
        return failure(
          'wake',
          'session_conflict',
          'The action identity, complete execution binding, role, model, effort, or canonical cwd conflicts with the durable session.',
          {
            runId: request.runId,
            sessionKey: request.sessionKey,
            session: projectReusableSession(request.runId, existing.session),
          }
        );
      }
      if (!deliverable) {
        const messageIdDigest = durableSessionMessageIdDigest(messageId);
        const terminal = existing.session.idempotencyTombstones.find(
          (entry) => entry.messageIdDigest === messageIdDigest
        );
        if (terminal === undefined) {
          return failure(
            'wake',
            'invalid_action',
            'The committed action is closed or otherwise unavailable for a new dispatch.',
            {
              runId: request.runId,
              sessionKey: request.sessionKey,
              session: projectReusableSession(request.runId, existing.session),
            }
          );
        }
        return success('wake', `duplicate_${terminal.disposition}`, {
          runId: request.runId,
          sessionKey: request.sessionKey,
          disposition: 'duplicate',
          terminalDisposition: terminal.disposition,
          session: projectReusableSession(request.runId, existing.session),
        });
      }
      const woken = await coordinator.wake({
        sessionKey: request.sessionKey,
        messageId,
        message: serializedAgentInput(action),
        timeoutMs: DEFAULT_REUSABLE_SESSION_TIMEOUT_MS,
        noOutputTimeoutMs: DEFAULT_REUSABLE_SESSION_NO_OUTPUT_TIMEOUT_MS,
        kind: 'interactive',
      });
      return responseForWake(request.runId, request.sessionKey, woken);
    },

    async list(input) {
      const stopped = inactive('list');
      if (stopped) return stopped;
      if (
        (input.scope === 'all') === (input.runId !== undefined)
        || (input.runId !== undefined && !RUN_ID_PATTERN.test(input.runId))
      ) {
        return failure(
          'list',
          'invalid_request',
          'List requires exactly one exact runId or scope=all.'
        );
      }
      const runIds =
        input.scope === 'all'
          ? runStore
              .list()
              .map((entry) => entry.runId as string)
              .sort()
          : [input.runId!];
      const sessions: ReusableSessionProjectionWire[] = [];
      for (const runId of runIds) {
        const resolved = resolveRun(runId);
        if (!resolved.ok) {
          return failure('list', resolved.code, resolved.message, { runId });
        }
        const listed = await coordinatorFor(resolved.run).list();
        if (!listed.ok) {
          if (listed.code === 'registry_absent') continue;
          return coordinatorFailureResponse('list', runId, undefined, listed);
        }
        sessions.push(
          ...listed.sessions.map((session) =>
            projectReusableSession(runId, session)
          )
        );
      }
      return success('list', 'listed', {
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        sessions,
      });
    },

    async retire(value) {
      const stopped = inactive('retire');
      if (stopped) return stopped;
      const decoded = RetireRequestSchema.safeParse(value);
      if (!decoded.success) {
        return failure(
          'retire',
          'invalid_request',
          'The reusable-session retire envelope is invalid.'
        );
      }
      const request = decoded.data as ReusableSessionRetireRequest;
      const resolved = resolveRun(request.runId);
      if (!resolved.ok) {
        return failure('retire', resolved.code, resolved.message, {
          runId: request.runId,
          sessionKey: request.sessionKey,
        });
      }
      const retired = await coordinatorFor(resolved.run).retire(
        request.sessionKey,
        request.reason
      );
      if (!retired.ok) {
        return coordinatorFailureResponse(
          'retire',
          request.runId,
          request.sessionKey,
          retired
        );
      }
      return success('retire', 'retired', {
        runId: request.runId,
        sessionKey: request.sessionKey,
        session: projectReusableSession(request.runId, retired.session),
      });
    },

    async updateTouchPolicy(value) {
      const stopped = inactive('touch-policy');
      if (stopped) return stopped;
      const decoded = TouchPolicyRequestSchema.safeParse(value);
      if (!decoded.success) {
        return failure(
          'touch-policy',
          'invalid_request',
          'The reusable-session touch-policy envelope is invalid.'
        );
      }
      const request = decoded.data as ReusableSessionTouchPolicyRequest;
      const resolved = resolveRun(request.runId);
      if (!resolved.ok) {
        return failure('touch-policy', resolved.code, resolved.message, {
          runId: request.runId,
          sessionKey: request.sessionKey,
        });
      }
      const updated = await coordinatorFor(resolved.run).updateTouchPolicy(
        request.sessionKey,
        request.policy,
        request.expectedLastWakeAt
      );
      if (!updated.ok) {
        return coordinatorFailureResponse(
          'touch-policy',
          request.runId,
          request.sessionKey,
          updated
        );
      }
      return success('touch-policy', 'touch_policy_updated', {
        runId: request.runId,
        sessionKey: request.sessionKey,
        session: projectReusableSession(request.runId, updated.session),
      });
    },

    async ownerShutdown() {
      if (shutdownPromise) return shutdownPromise;
      accepting = false;
      shutdownPromise = (async () => {
        const cached = [...coordinators.values()];
        const failures: ReusableSessionOwnerShutdownDiagnostic[] = [];
        if (cached.length === 0) {
          const outcome = await boundedOwnerShutdown(
            options.supervisor.shutdownAll('server-shutdown')
          );
          if (outcome.kind !== 'settled') {
            failures.push({
              code: 'owner_shutdown_failed',
              message:
                outcome.kind === 'timeout'
                  ? 'The shared session supervisor exceeded the owner shutdown deadline.'
                  : 'The shared session supervisor failed to shut down.',
            });
          }
        } else {
          const outcomes = await Promise.all(
            cached.map(async (entry) => {
              const outcome = await boundedOwnerShutdown(
                entry.coordinator.ownerShutdown()
              );
              if (outcome.kind === 'settled') {
                return outcome.value.ok
                  ? undefined
                  : {
                      runId: entry.runId,
                      code: safeOwnerShutdownCode(outcome.value.code),
                      message:
                        'The reusable-session coordinator failed to shut down cleanly.',
                    };
              }
              return {
                runId: entry.runId,
                code: 'owner_shutdown_failed',
                message:
                  outcome.kind === 'timeout'
                    ? 'The reusable-session coordinator exceeded the owner shutdown deadline.'
                    : 'The reusable-session coordinator failed to shut down.',
              };
            })
          );
          for (const outcome of outcomes) {
            if (outcome !== undefined) {
              failures.push(outcome);
            }
          }
        }
        return failures.length === 0
          ? { ok: true as const }
          : {
              ok: false as const,
              code: 'owner_shutdown_failed' as const,
              message:
                'One or more reusable-session owners failed to shut down cleanly.',
              failures,
            };
      })();
      return shutdownPromise;
    },
  };
}
