import { createHash } from 'node:crypto';
import * as http from 'node:http';

import { z } from 'zod';

export const REUSABLE_SESSION_API_SCHEMA = 'rasen-reusable-session-api/1' as const;

export const SESSION_TOUCH_CADENCE_MS = 50 * 60 * 1000;
export const SESSION_TOUCH_COLD_GAP_MS = 60 * 60 * 1000;
export const SESSION_TOUCH_SCAN_INTERVAL_MS = 60 * 1000;
export const SESSION_TOUCH_BACKOFF_BASE_MS = 60 * 1000;
export const SESSION_TOUCH_BACKOFF_MAX_MS = 10 * 60 * 1000;
export const SESSION_TOUCH_REQUEST_TIMEOUT_MS = 4 * 1000;
export const SESSION_TOUCH_STOP_DRAIN_MS = 5 * 1000;
export const SESSION_TOUCH_MAX_RESPONSE_BYTES = 1024 * 1024;
export const SESSION_TOUCH_MESSAGE =
  'Keepalive touch. Reply with exactly: OK. Do not use any tools.';

export type ReusableSessionStatus =
  | 'starting'
  | 'idle'
  | 'waking'
  | 'lost'
  | 'stale'
  | 'retiring'
  | 'retired';

export interface ReusableSessionTouchPolicy {
  mode: 'auto' | 'never';
  deadlineAt?: string;
  maxTouches: number;
  touchesUsed: number;
  deadlineAction: 'stop' | 'retire-silent';
}

export interface ReusableSessionLifecycleProjection {
  createdAt: string;
  updatedAt: string;
  lastWakeAt?: string;
  lostAt?: string;
  recoveredAt?: string;
  retirementRequestedAt?: string;
  retiredAt?: string;
  reason?: string;
}

export interface ReusableSessionTerminalProjection {
  admittedAt: string;
  dispatchFenceAt?: string;
  settledAt: string;
  outcome: 'completed' | 'pre_delivery_failed' | 'delivery_uncertain';
  code?: string;
  kind?: 'interactive' | 'touch';
  touchOrdinal?: number;
  touchAttempt?: number;
}

/**
 * The scheduler consumes only the public, secret-free projection frozen by
 * `rasen-reusable-session-api/1`. It deliberately has no durable-registry
 * import and no owner/PID fields.
 */
export interface ReusableSessionProjection {
  runId: string;
  sessionKey: string;
  role: string;
  status: ReusableSessionStatus;
  cwd: string;
  lifecycle: ReusableSessionLifecycleProjection;
  touchPolicy: ReusableSessionTouchPolicy;
  wakes: ReusableSessionTerminalProjection[];
}

export interface ConditionalTouchRequest {
  runId: string;
  sessionKey: string;
  message: string;
  messageId: string;
  expectedLastWakeAt: string;
  touchOrdinal: number;
  touchAttempt: number;
}

export interface PolicyUpdateRequest {
  runId: string;
  sessionKey: string;
  expectedLastWakeAt?: string;
  policy: ReusableSessionTouchPolicy;
}

export interface SilentRetireRequest {
  runId: string;
  sessionKey: string;
  reason: string;
}

export type ConditionalTouchCode =
  | 'completed'
  | 'duplicate'
  | 'pre_delivery_failed'
  | 'delivery_uncertain'
  | 'stale'
  | 'contended'
  | 'skipped';

export interface ConditionalTouchOutcome {
  code: ConditionalTouchCode;
  terminalDisposition?:
    | 'completed'
    | 'pre_delivery_failed'
    | 'delivery_uncertain';
  session?: ReusableSessionProjection;
}

export interface PolicyUpdateOutcome {
  code: 'updated' | 'stale';
  session?: ReusableSessionProjection;
}

export interface TouchClientCallOptions {
  signal?: AbortSignal;
}

export type TouchClientFailurePhase =
  | 'pre_delivery'
  | 'transport_uncertain'
  | 'service'
  | 'protocol';

export type TouchClientResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      phase: TouchClientFailurePhase;
      code: string;
      message: string;
      session?: ReusableSessionProjection;
    };

export interface ReusableSessionTouchClient {
  listAll(
    options?: TouchClientCallOptions
  ): Promise<TouchClientResult<ReusableSessionProjection[]>>;
  conditionalTouch(
    request: ConditionalTouchRequest,
    options?: TouchClientCallOptions
  ): Promise<TouchClientResult<ConditionalTouchOutcome>>;
  updateTouchPolicy(
    request: PolicyUpdateRequest,
    options?: TouchClientCallOptions
  ): Promise<TouchClientResult<PolicyUpdateOutcome>>;
  retireSilent(
    request: SilentRetireRequest,
    options?: TouchClientCallOptions
  ): Promise<TouchClientResult<ReusableSessionProjection>>;
}

export interface SessionTouchClock {
  now(): number;
}

export interface SessionTouchTimer {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SessionTouchLogger {
  debug?(message: string, details?: Record<string, unknown>): void;
  info?(message: string, details?: Record<string, unknown>): void;
  warn?(message: string, details?: Record<string, unknown>): void;
  error?(message: string, details?: Record<string, unknown>): void;
}

export interface SessionTouchSchedulerOptions {
  client: ReusableSessionTouchClient;
  clock?: SessionTouchClock;
  timer?: SessionTouchTimer;
  logger?: SessionTouchLogger;
  cadenceMs?: number;
  coldGapMs?: number;
  scanIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  stopDrainMs?: number;
  message?: string;
}

export interface SessionTouchScheduler {
  start(): void;
  scanNow(): Promise<void>;
  stop(): Promise<void>;
}

export type SessionTouchDecision =
  | { kind: 'deadline-stop' }
  | { kind: 'deadline-retire' }
  | { kind: 'cold'; gapMs: number }
  | {
      kind: 'eligible';
      gapMs: number;
      expectedLastWakeAt: string;
    }
  | {
      kind:
        | 'never'
        | 'exhausted'
        | 'not-idle'
        | 'recent'
        | 'clock-backward'
        | 'retired';
      gapMs?: number;
    }
  | { kind: 'invalid'; diagnostic: string };

export interface SessionTouchTiming {
  cadenceMs: number;
  coldGapMs: number;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Pure, fail-closed classifier. Authored deadline actions precede cold-gap
 * handling, while ordinary touches additionally require an idle session.
 */
export function classifySessionTouchCandidate(
  session: ReusableSessionProjection,
  now: number,
  timing: SessionTouchTiming = {
    cadenceMs: SESSION_TOUCH_CADENCE_MS,
    coldGapMs: SESSION_TOUCH_COLD_GAP_MS,
  }
): SessionTouchDecision {
  if (session.status === 'retired') return { kind: 'retired' };

  const policy = session.touchPolicy;
  if (policy.mode === 'never') return { kind: 'never' };
  if (
    !Number.isInteger(policy.maxTouches)
    || policy.maxTouches < 0
    || !Number.isInteger(policy.touchesUsed)
    || policy.touchesUsed < 0
    || policy.touchesUsed > policy.maxTouches
  ) {
    return {
      kind: 'invalid',
      diagnostic: 'auto touch policy has invalid touch counters',
    };
  }

  const deadline = parseTimestamp(policy.deadlineAt);
  if (deadline === undefined) {
    return {
      kind: 'invalid',
      diagnostic: 'auto touch policy has no valid deadline',
    };
  }
  if (now >= deadline) {
    return policy.deadlineAction === 'retire-silent'
      ? { kind: 'deadline-retire' }
      : { kind: 'deadline-stop' };
  }
  if (policy.touchesUsed >= policy.maxTouches) return { kind: 'exhausted' };
  if (session.status !== 'idle') return { kind: 'not-idle' };

  const lastWake = parseTimestamp(session.lifecycle.lastWakeAt);
  if (lastWake === undefined) {
    return {
      kind: 'invalid',
      diagnostic: 'auto touch policy has no valid last successful activity',
    };
  }
  const gapMs = now - lastWake;
  if (gapMs < 0) return { kind: 'clock-backward', gapMs };
  if (gapMs > timing.coldGapMs) return { kind: 'cold', gapMs };
  if (gapMs < timing.cadenceMs) return { kind: 'recent', gapMs };
  return {
    kind: 'eligible',
    gapMs,
    expectedLastWakeAt: session.lifecycle.lastWakeAt!,
  };
}

function canonicalTouchIdentity(
  runId: string,
  sessionKey: string,
  ordinal: number,
  attempt: number
): string {
  return JSON.stringify({ runId, sessionKey, ordinal, attempt });
}

export function sessionTouchMessageId(
  runId: string,
  sessionKey: string,
  ordinal: number,
  attempt: number
): string {
  const digest = createHash('sha256')
    .update(
      canonicalTouchIdentity(runId, sessionKey, ordinal, attempt),
      'utf-8'
    )
    .digest('hex');
  return `rasen-touch-v1-${digest}`;
}

function backoffDelay(
  failures: number,
  baseMs: number,
  maxMs: number
): number {
  const exponent = Math.max(0, Math.min(failures - 1, 30));
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

interface ReconstructedAttempt {
  ordinal: number;
  attempt: number;
  reconcileTerminal: boolean;
  terminalOutcome?:
    | 'completed'
    | 'pre_delivery_failed'
    | 'delivery_uncertain';
  retryNotBefore?: number;
}

/**
 * Rebuilds touch identity from the bounded durable terminal summaries.
 * Completed/uncertain entries retain the same attempt for duplicate
 * reconciliation; proven pre-delivery failures advance the attempt.
 */
export function reconstructSessionTouchAttempt(
  session: ReusableSessionProjection,
  backoffBaseMs = SESSION_TOUCH_BACKOFF_BASE_MS,
  backoffMaxMs = SESSION_TOUCH_BACKOFF_MAX_MS
): ReconstructedAttempt {
  const ordinal = session.touchPolicy.touchesUsed + 1;
  const terminals = session.wakes
    .filter(
      (wake) =>
        wake.kind === 'touch'
        && wake.touchOrdinal === ordinal
        && Number.isInteger(wake.touchAttempt)
        && (wake.touchAttempt ?? 0) > 0
    )
    .sort((left, right) => {
      const byAttempt = (left.touchAttempt ?? 0) - (right.touchAttempt ?? 0);
      return byAttempt !== 0
        ? byAttempt
        : Date.parse(left.settledAt) - Date.parse(right.settledAt);
    });

  const consuming = [...terminals]
    .reverse()
    .find(
      (wake) =>
        wake.outcome === 'completed'
        || wake.outcome === 'delivery_uncertain'
    );
  if (consuming) {
    return {
      ordinal,
      attempt: consuming.touchAttempt!,
      reconcileTerminal: true,
      terminalOutcome: consuming.outcome,
    };
  }

  const failed = terminals.filter(
    (wake) => wake.outcome === 'pre_delivery_failed'
  );
  if (failed.length === 0) {
    return { ordinal, attempt: 1, reconcileTerminal: false };
  }
  const lastFailure = failed[failed.length - 1]!;
  const settledAt = parseTimestamp(lastFailure.settledAt);
  return {
    ordinal,
    attempt: (lastFailure.touchAttempt ?? 0) + 1,
    reconcileTerminal: false,
    terminalOutcome: 'pre_delivery_failed',
    ...(settledAt === undefined
      ? {}
      : {
          retryNotBefore:
            settledAt
            + backoffDelay(failed.length, backoffBaseMs, backoffMaxMs),
        }),
  };
}

interface SessionFailureState {
  failures: number;
  retryAt: number;
  operation: 'touch' | 'mutation';
  observedLastWakeAt?: string;
  retryAttempt?: {
    ordinal: number;
    attempt: number;
    expectedLastWakeAt: string;
  };
}

function sessionIdentity(session: ReusableSessionProjection): string {
  return `${session.runId}\0${session.sessionKey}`;
}

const SYSTEM_CLOCK: SessionTouchClock = { now: () => Date.now() };
const SYSTEM_TIMER: SessionTouchTimer = {
  setInterval(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs);
    handle.unref?.();
    return handle;
  },
  clearInterval(handle) {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export function createSessionTouchScheduler(
  options: SessionTouchSchedulerOptions
): SessionTouchScheduler {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const timer = options.timer ?? SYSTEM_TIMER;
  const logger = options.logger ?? {};
  const cadenceMs = options.cadenceMs ?? SESSION_TOUCH_CADENCE_MS;
  const coldGapMs = options.coldGapMs ?? SESSION_TOUCH_COLD_GAP_MS;
  const scanIntervalMs =
    options.scanIntervalMs ?? SESSION_TOUCH_SCAN_INTERVAL_MS;
  const backoffBaseMs =
    options.backoffBaseMs ?? SESSION_TOUCH_BACKOFF_BASE_MS;
  const backoffMaxMs = options.backoffMaxMs ?? SESSION_TOUCH_BACKOFF_MAX_MS;
  const stopDrainMs = options.stopDrainMs ?? SESSION_TOUCH_STOP_DRAIN_MS;
  const message = options.message ?? SESSION_TOUCH_MESSAGE;

  const failures = new Map<string, SessionFailureState>();
  const diagnosticKeys = new Map<string, string>();
  const activeControllers = new Set<AbortController>();
  let started = false;
  let stopped = false;
  let intervalHandle: unknown;
  let currentScan: Promise<void> | undefined;
  let followUpRequested = false;
  let stopPromise: Promise<void> | undefined;

  const callClient = async <T>(
    invoke: (options: TouchClientCallOptions) => Promise<T>
  ): Promise<T> => {
    const controller = new AbortController();
    activeControllers.add(controller);
    if (stopped) controller.abort();
    try {
      return await invoke({ signal: controller.signal });
    } finally {
      activeControllers.delete(controller);
    }
  };

  const clearFailure = (key: string): void => {
    failures.delete(key);
  };

  const recordFailure = (
    key: string,
    session: ReusableSessionProjection | undefined,
    retryAttempt?: SessionFailureState['retryAttempt'],
    operation: SessionFailureState['operation'] = 'mutation'
  ): void => {
    const previous = failures.get(key);
    const nextCount =
      (previous?.operation === operation ? previous.failures : 0) + 1;
    failures.set(key, {
      failures: nextCount,
      retryAt:
        clock.now() + backoffDelay(nextCount, backoffBaseMs, backoffMaxMs),
      operation,
      observedLastWakeAt: session?.lifecycle.lastWakeAt,
      ...(retryAttempt !== undefined ? { retryAttempt } : {}),
    });
  };

  const logDiagnostic = (
    session: ReusableSessionProjection,
    code: string,
    messageText: string
  ): void => {
    const key = sessionIdentity(session);
    if (diagnosticKeys.get(key) === code) return;
    diagnosticKeys.set(key, code);
    logger.warn?.(messageText, {
      runId: session.runId,
      sessionKey: session.sessionKey,
      code,
    });
  };

  const actionAllowed = (
    session: ReusableSessionProjection,
    operation: SessionFailureState['operation']
  ): SessionFailureState | undefined => {
    const key = sessionIdentity(session);
    const state = failures.get(key);
    if (!state) return undefined;
    if (state.operation !== operation) return undefined;
    if (
      !state.retryAttempt
      && state.observedLastWakeAt !== undefined
      && state.observedLastWakeAt !== session.lifecycle.lastWakeAt
    ) {
      clearFailure(key);
      return undefined;
    }
    return state.retryAt > clock.now() ? state : undefined;
  };

  const handleMutationResult = (
    session: ReusableSessionProjection,
    result: TouchClientResult<unknown>,
    operation: string
  ): void => {
    const key = sessionIdentity(session);
    if (result.ok) {
      clearFailure(key);
      diagnosticKeys.delete(key);
      return;
    }
    recordFailure(key, session);
    logDiagnostic(
      session,
      `${operation}:${result.phase}:${result.code}`,
      `${operation} failed for reusable session: ${result.message}`
    );
  };

  const touch = async (
    session: ReusableSessionProjection,
    attempt: ReconstructedAttempt,
    expectedLastWakeAt: string
  ): Promise<void> => {
    if (stopped) return;
    const key = sessionIdentity(session);
    if (
      attempt.retryNotBefore !== undefined
      && attempt.retryNotBefore > clock.now()
    ) {
      return;
    }

    const failure = failures.get(key);
    const retryAttempt = failure?.retryAttempt;
    const selected =
      retryAttempt !== undefined
      && retryAttempt.ordinal === attempt.ordinal
      && retryAttempt.attempt >= attempt.attempt
      && !attempt.reconcileTerminal
        ? retryAttempt
        : {
            ordinal: attempt.ordinal,
            attempt: attempt.attempt,
            expectedLastWakeAt,
          };
    const request: ConditionalTouchRequest = {
      runId: session.runId,
      sessionKey: session.sessionKey,
      message,
      messageId: sessionTouchMessageId(
        session.runId,
        session.sessionKey,
        selected.ordinal,
        selected.attempt
      ),
      expectedLastWakeAt: selected.expectedLastWakeAt,
      touchOrdinal: selected.ordinal,
      touchAttempt: selected.attempt,
    };
    if (stopped) return;
    const result = await callClient((callOptions) =>
      options.client.conditionalTouch(request, callOptions)
    );
    if (!result.ok) {
      recordFailure(key, session, selected, 'touch');
      logDiagnostic(
        session,
        `touch:${result.phase}:${result.code}`,
        `Conditional session touch failed: ${result.message}`
      );
      return;
    }

    const disposition =
      result.value.code === 'duplicate'
        ? result.value.terminalDisposition
        : result.value.code;
    if (
      disposition === 'completed'
      || disposition === 'delivery_uncertain'
      || result.value.code === 'stale'
      || result.value.code === 'contended'
      || result.value.code === 'skipped'
    ) {
      clearFailure(key);
      diagnosticKeys.delete(key);
      return;
    }

    if (disposition === 'pre_delivery_failed') {
      recordFailure(
        key,
        result.value.session ?? session,
        {
          ordinal: selected.ordinal,
          attempt: selected.attempt + 1,
          expectedLastWakeAt: selected.expectedLastWakeAt,
        },
        'touch'
      );
      logDiagnostic(
        session,
        'touch:pre_delivery_failed',
        'Conditional session touch was proven to have failed before delivery.'
      );
    }
  };

  const processSession = async (
    session: ReusableSessionProjection
  ): Promise<void> => {
    if (stopped) return;
    const decision = classifySessionTouchCandidate(session, clock.now(), {
      cadenceMs,
      coldGapMs,
    });
    const key = sessionIdentity(session);

    if (decision.kind === 'invalid') {
      logDiagnostic(session, `invalid:${decision.diagnostic}`, decision.diagnostic);
      return;
    }

    if (decision.kind === 'deadline-retire') {
      if (actionAllowed(session, 'mutation')) return;
      if (stopped) return;
      const result = await callClient((callOptions) =>
        options.client.retireSilent(
          {
            runId: session.runId,
            sessionKey: session.sessionKey,
            reason: 'touch-deadline-expired',
          },
          callOptions
        )
      );
      handleMutationResult(session, result, 'Silent retirement');
      return;
    }
    if (decision.kind === 'deadline-stop' || decision.kind === 'cold') {
      if (actionAllowed(session, 'mutation')) return;
      if (stopped) return;
      const result = await callClient((callOptions) =>
        options.client.updateTouchPolicy(
          {
            runId: session.runId,
            sessionKey: session.sessionKey,
            ...(session.lifecycle.lastWakeAt !== undefined
              ? { expectedLastWakeAt: session.lifecycle.lastWakeAt }
              : {}),
            policy: {
              ...session.touchPolicy,
              mode: 'never',
            },
          },
          callOptions
        )
      );
      handleMutationResult(
        session,
        result,
        decision.kind === 'cold' ? 'Cold-session policy update' : 'Deadline policy update'
      );
      return;
    }
    if (actionAllowed(session, 'touch')) return;

    const attempt = reconstructSessionTouchAttempt(
      session,
      backoffBaseMs,
      backoffMaxMs
    );
    const pending = failures.get(key)?.retryAttempt;
    const mustReconcile =
      attempt.reconcileTerminal
      || (pending !== undefined
        && pending.ordinal === attempt.ordinal
        && decision.kind !== 'retired'
        && decision.kind !== 'never'
        && decision.kind !== 'exhausted');
    if (mustReconcile) {
      const expected =
        pending?.expectedLastWakeAt ?? session.lifecycle.lastWakeAt;
      if (expected === undefined) {
        logDiagnostic(
          session,
          'reconcile:missing-last-wake',
          'A durable touch terminal cannot be reconciled without its observed activity timestamp.'
        );
        return;
      }
      await touch(session, attempt, expected);
      return;
    }

    if (decision.kind !== 'eligible') return;
    await touch(session, attempt, decision.expectedLastWakeAt);
  };

  const scanOnce = async (): Promise<void> => {
    const listed = await callClient((callOptions) =>
      options.client.listAll(callOptions)
    );
    if (stopped) return;
    if (!listed.ok) {
      logger.warn?.('Reusable-session touch scan could not list sessions.', {
        phase: listed.phase,
        code: listed.code,
        message: listed.message,
      });
      return;
    }
    await Promise.allSettled(
      listed.value.map(async (session) => {
        try {
          await processSession(session);
        } catch (error) {
          const key = sessionIdentity(session);
          recordFailure(key, session, undefined, 'touch');
          logDiagnostic(
            session,
            'scheduler:unexpected',
            error instanceof Error ? error.message : String(error)
          );
        }
      })
    );
  };

  const queueScan = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (currentScan) {
      followUpRequested = true;
      return currentScan;
    }
    currentScan = (async () => {
      do {
        followUpRequested = false;
        await scanOnce();
      } while (followUpRequested && !stopped);
    })().finally(() => {
      currentScan = undefined;
    });
    return currentScan;
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      intervalHandle = timer.setInterval(() => {
        void queueScan();
      }, scanIntervalMs);
      void queueScan();
    },
    scanNow() {
      return queueScan();
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      followUpRequested = false;
      if (intervalHandle !== undefined) {
        timer.clearInterval(intervalHandle);
        intervalHandle = undefined;
      }
      for (const controller of activeControllers) controller.abort();
      const scanToDrain = currentScan;
      stopPromise = (async () => {
        if (!scanToDrain) return;
        let timeoutHandle: NodeJS.Timeout | undefined;
        const drained = await Promise.race([
          scanToDrain.then(
            () => true,
            (error) => {
              logger.warn?.('Reusable-session touch scan failed during shutdown.', {
                message: error instanceof Error ? error.message : String(error),
              });
              return true;
            }
          ),
          new Promise<false>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(false), stopDrainMs);
            timeoutHandle.unref?.();
          }),
        ]);
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (!drained) {
          logger.warn?.(
            'Reusable-session touch scheduler exceeded its stop drain budget.',
            { stopDrainMs }
          );
        }
      })();
      return stopPromise;
    },
  };
}

const TouchPolicySchema = z
  .object({
    mode: z.enum(['auto', 'never']),
    deadlineAt: z.string().optional(),
    maxTouches: z.number().int().nonnegative(),
    touchesUsed: z.number().int().nonnegative(),
    deadlineAction: z.enum(['stop', 'retire-silent']),
  })
  .strict();

const LifecycleSchema = z
  .object({
    createdAt: z.string(),
    updatedAt: z.string(),
    lastWakeAt: z.string().optional(),
    lostAt: z.string().optional(),
    recoveredAt: z.string().optional(),
    retirementRequestedAt: z.string().optional(),
    retiredAt: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const TerminalSchema = z
  .object({
    admittedAt: z.string(),
    dispatchFenceAt: z.string().optional(),
    settledAt: z.string(),
    outcome: z.enum([
      'completed',
      'pre_delivery_failed',
      'delivery_uncertain',
    ]),
    code: z.string().optional(),
    kind: z.enum(['interactive', 'touch']).optional(),
    touchOrdinal: z.number().int().positive().optional(),
    touchAttempt: z.number().int().positive().optional(),
  })
  .strict();

const ProjectionSchema: z.ZodType<ReusableSessionProjection> = z
  .object({
    runId: z.string(),
    sessionKey: z.string(),
    role: z.string(),
    status: z.enum([
      'starting',
      'idle',
      'waking',
      'lost',
      'stale',
      'retiring',
      'retired',
    ]),
    cwd: z.string(),
    lifecycle: LifecycleSchema,
    touchPolicy: TouchPolicySchema,
    wakes: z.array(TerminalSchema),
  })
  .strict();

const ListResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.literal('list'),
    code: z.string(),
    sessions: z.array(ProjectionSchema),
  })
  .strict();

const TouchResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.literal('wake'),
    code: z.string(),
    runId: z.string(),
    sessionKey: z.string(),
    disposition: z.enum(['completed', 'duplicate']),
    terminalDisposition: z.enum([
      'completed',
      'pre_delivery_failed',
      'delivery_uncertain',
    ]),
    session: ProjectionSchema,
  })
  .strict();

const RetireResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.literal('retire'),
    code: z.string(),
    runId: z.string(),
    sessionKey: z.string(),
    session: ProjectionSchema,
  })
  .strict();

const PolicyResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(true),
    operation: z.literal('touch-policy'),
    code: z.string(),
    runId: z.string(),
    sessionKey: z.string(),
    session: ProjectionSchema,
  })
  .strict();

const ErrorResponseSchema = z
  .object({
    schema: z.literal(REUSABLE_SESSION_API_SCHEMA),
    ok: z.literal(false),
    operation: z.enum(['wake', 'list', 'retire', 'touch-policy']),
    code: z.string(),
    message: z.string(),
    runId: z.string().optional(),
    sessionKey: z.string().optional(),
    session: ProjectionSchema.optional(),
  })
  .strict();

export interface LoopbackReusableSessionTouchClientOptions {
  port: number;
  token: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

function protocolRequestBody(operation: string, request: object): object {
  return {
    schema: REUSABLE_SESSION_API_SCHEMA,
    op: operation,
    ...request,
  };
}

export function createLoopbackReusableSessionTouchClient(
  options: LoopbackReusableSessionTouchClientOptions
): ReusableSessionTouchClient {
  const timeoutMs = options.requestTimeoutMs ?? SESSION_TOUCH_REQUEST_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? SESSION_TOUCH_MAX_RESPONSE_BYTES;

  const requestJson = <T>(
    method: 'GET' | 'POST',
    requestPath: string,
    body: object | undefined,
    schema: z.ZodType<T>,
    callOptions: TouchClientCallOptions = {}
  ): Promise<TouchClientResult<T>> =>
    new Promise((resolve) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const chunks: Buffer[] = [];
      let committed = false;
      let settled = false;
      let responseEnded = false;
      let responseBytes = 0;
      let responseRef: http.IncomingMessage | undefined;
      let deadlineHandle: NodeJS.Timeout | undefined;
      let request: http.ClientRequest;

      function onFinish(): void {
        committed = true;
      }
      function onRequestError(error: Error): void {
        settle({
          ok: false,
          phase: committed ? 'transport_uncertain' : 'pre_delivery',
          code:
            typeof (error as NodeJS.ErrnoException).code === 'string'
              ? (error as NodeJS.ErrnoException).code!
              : 'transport_error',
          message: error.message,
        });
      }
      function onAbort(): void {
        if (settled || committed) return;
        settle(
          {
            ok: false,
            phase: 'pre_delivery',
            code: 'request_cancelled_before_commit',
            message:
              'Reusable-session loopback request was cancelled before commit.',
          },
          true
        );
      }
      function cleanup(): void {
        if (deadlineHandle !== undefined) {
          clearTimeout(deadlineHandle);
          deadlineHandle = undefined;
        }
        callOptions.signal?.removeEventListener('abort', onAbort);
        request.removeListener('finish', onFinish);
        // Keep the once-only request error sink attached through transport
        // destruction. A response reset can emit a trailing ClientRequest
        // ECONNRESET after the IncomingMessage already settled this operation;
        // `settle()` is idempotent, so the listener safely absorbs that event.
        if (responseRef) {
          responseRef.removeListener('data', onResponseData);
          responseRef.removeListener('end', onResponseEnd);
          responseRef.removeListener('aborted', onResponseAborted);
          responseRef.removeListener('error', onResponseError);
          responseRef.removeListener('close', onResponseClose);
        }
      }
      function settle(
        result: TouchClientResult<T>,
        destroyTransport = false
      ): void {
        if (settled) return;
        settled = true;
        cleanup();
        if (destroyTransport) {
          responseRef?.destroy();
          request.destroy();
        }
        resolve(result);
      }
      function settleResponseUncertain(
        code: string,
        message: string
      ): void {
        settle(
          {
            ok: false,
            phase: 'transport_uncertain',
            code,
            message,
          },
          true
        );
      }
      function onResponseData(chunk: Buffer | string): void {
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, 'utf-8');
        if (responseBytes + buffer.length > maxResponseBytes) {
          settleResponseUncertain(
            'response_too_large',
            'Reusable-session service response exceeded its size limit.'
          );
          return;
        }
        responseBytes += buffer.length;
        chunks.push(buffer);
      }
      function onResponseEnd(): void {
        responseEnded = true;
        const text = Buffer.concat(chunks).toString('utf-8');
        let decoded: unknown;
        try {
          decoded = text === '' ? undefined : JSON.parse(text);
        } catch {
          settle({
            ok: false,
            phase: 'protocol',
            code: 'invalid_json',
            message: 'Reusable-session service returned invalid JSON.',
          });
          return;
        }
        if (
          responseRef?.statusCode === undefined
          || responseRef.statusCode < 200
          || responseRef.statusCode >= 300
        ) {
          const failure = ErrorResponseSchema.safeParse(decoded);
          if (failure.success) {
            settle({
              ok: false,
              phase: 'service',
              code: failure.data.code,
              message: failure.data.message,
              ...(failure.data.session === undefined
                ? {}
                : { session: failure.data.session }),
            });
          } else {
            settle({
              ok: false,
              phase: committed ? 'transport_uncertain' : 'protocol',
              code: `http_${responseRef?.statusCode ?? 0}`,
              message:
                'Reusable-session service returned an invalid error envelope.',
            });
          }
          return;
        }
        const parsed = schema.safeParse(decoded);
        if (!parsed.success) {
          settle({
            ok: false,
            phase: 'protocol',
            code: 'invalid_response',
            message:
              'Reusable-session service returned an invalid success envelope.',
          });
          return;
        }
        settle({ ok: true, value: parsed.data });
      }
      function onResponseAborted(): void {
        settleResponseUncertain(
          'response_aborted',
          'Reusable-session service aborted its response after commit.'
        );
      }
      function onResponseError(error: Error): void {
        settleResponseUncertain(
          typeof (error as NodeJS.ErrnoException).code === 'string'
            ? (error as NodeJS.ErrnoException).code!
            : 'response_error',
          error.message
        );
      }
      function onResponseClose(): void {
        if (responseEnded || responseRef?.complete) return;
        settleResponseUncertain(
          'response_premature_close',
          'Reusable-session service closed an incomplete response after commit.'
        );
      }

      request = http.request(
        {
          host: '127.0.0.1',
          port: options.port,
          method,
          path: requestPath,
          headers: {
            Authorization: `Bearer ${options.token}`,
            Accept: 'application/json',
            ...(payload === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': String(Buffer.byteLength(payload)),
                }),
          },
        },
        (response) => {
          responseRef = response;
          response.on('data', onResponseData);
          response.once('end', onResponseEnd);
          response.once('aborted', onResponseAborted);
          response.once('error', onResponseError);
          response.once('close', onResponseClose);
        }
      );
      request.once('finish', onFinish);
      request.once('error', onRequestError);
      callOptions.signal?.addEventListener('abort', onAbort, { once: true });
      deadlineHandle = setTimeout(() => {
        settle(
          {
            ok: false,
            phase: committed ? 'transport_uncertain' : 'pre_delivery',
            code: 'request_timeout',
            message: 'Reusable-session loopback request timed out.',
          },
          true
        );
      }, timeoutMs);
      deadlineHandle.unref?.();
      if (callOptions.signal?.aborted) {
        onAbort();
        return;
      }
      request.end(payload);
    });

  return {
    async listAll(callOptions) {
      const result = await requestJson(
        'GET',
        '/api/v1/reusable-sessions?scope=all',
        undefined,
        ListResponseSchema,
        callOptions
      );
      return result.ok
        ? { ok: true, value: result.value.sessions }
        : result;
    },
    async conditionalTouch(request, callOptions) {
      const result = await requestJson(
        'POST',
        '/api/v1/reusable-sessions/wake',
        protocolRequestBody('wake', {
          ...request,
          kind: 'touch',
        }),
        TouchResponseSchema,
        callOptions
      );
      if (result.ok) {
        return {
          ok: true,
          value: {
            code:
              result.value.disposition === 'duplicate'
                ? 'duplicate'
                : 'completed',
            terminalDisposition: result.value.terminalDisposition,
            session: result.value.session,
          },
        };
      }
      if (
        result.code === 'conditional_wake_stale'
        || result.code === 'session_stale'
      ) {
        return {
          ok: true,
          value: {
            code: 'stale',
            ...(result.session === undefined
              ? {}
              : { session: result.session }),
          },
        };
      }
      if (
        result.code === 'wake_busy'
        || result.code === 'host_busy'
        || result.code === 'busy'
      ) {
        return {
          ok: true,
          value: {
            code: 'contended',
            ...(result.session === undefined
              ? {}
              : { session: result.session }),
          },
        };
      }
      const terminal = result.session?.wakes
        .filter(
          (wake) =>
            wake.kind === 'touch'
            && wake.touchOrdinal === request.touchOrdinal
            && wake.touchAttempt === request.touchAttempt
        )
        .at(-1);
      if (terminal) {
        return {
          ok: true,
          value: {
            code: terminal.outcome,
            terminalDisposition: terminal.outcome,
            session: result.session!,
          },
        };
      }
      return result;
    },
    async updateTouchPolicy(request, callOptions) {
      const result = await requestJson(
        'POST',
        '/api/v1/reusable-sessions/touch-policy',
        protocolRequestBody('touch-policy', {
          runId: request.runId,
          sessionKey: request.sessionKey,
          ...(request.expectedLastWakeAt === undefined
            ? {}
            : { expectedLastWakeAt: request.expectedLastWakeAt }),
          policy: request.policy,
        }),
        PolicyResponseSchema,
        callOptions
      );
      if (result.ok) {
        return {
          ok: true,
          value: { code: 'updated', session: result.value.session },
        };
      }
      if (result.code === 'conditional_wake_stale') {
        return {
          ok: true,
          value: {
            code: 'stale',
            ...(result.session === undefined
              ? {}
              : { session: result.session }),
          },
        };
      }
      return result;
    },
    async retireSilent(request, callOptions) {
      const result = await requestJson(
        'POST',
        '/api/v1/reusable-sessions/retire',
        protocolRequestBody('retire', request),
        RetireResponseSchema,
        callOptions
      );
      return result.ok
        ? { ok: true, value: result.value.session }
        : result;
    },
  };
}
