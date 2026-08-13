import { createHash } from 'node:crypto';

import { sanitizeAgentDiagnostic } from '../agent-diagnostics.js';
import {
  OMNICROSS_ROUTE_LOST_ABORT,
  OmniCrossRouteError,
  type CreateRouteLeaseRequest,
  type FrozenInferenceRoute,
  type OmniCrossFailure,
  type RouteAttemptIdentity,
} from './contracts.js';
import type { OmniCrossRouteLeaseClient } from './client.js';
import { reduceLaunchDescriptor, type RuntimeRouteBinding } from './launch-binding.js';

export interface OmniCrossClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_CLOCK: OmniCrossClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface SafeRouteLeaseMetadata {
  readonly leaseId: string;
  readonly broker: 'omnicross';
  readonly runtime: 'claude' | 'codex';
  readonly upstream: FrozenInferenceRoute['upstream'];
  readonly model: string;
  readonly expiresAt: string;
}

export type RouteExecutionResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly route: SafeRouteLeaseMetadata;
      readonly warnings?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly failure: OmniCrossFailure;
      readonly route?: SafeRouteLeaseMetadata;
      readonly warnings?: readonly string[];
    };

export interface WithOmniCrossRouteOptions<T> {
  readonly route: FrozenInferenceRoute;
  readonly attempt: RouteAttemptIdentity;
  readonly client: OmniCrossRouteLeaseClient;
  readonly run: (
    binding: RuntimeRouteBinding,
    signal: AbortSignal
  ) => Promise<T>;
  readonly signal?: AbortSignal;
  readonly clock?: OmniCrossClock;
  /** Additional live secrets (notably the Admin token) to redact on every path. */
  readonly secretValues?: Iterable<string>;
}

export function deriveRouteIdempotencyKey(
  attempt: RouteAttemptIdentity,
  operation: 'create' | 'renew' | 'release' = 'create'
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ operation, ...attempt }))
    .digest('hex')
    .slice(0, 40);
  return `rasen-${operation}-${digest}`;
}

function safeFailure(error: unknown, secrets: readonly string[]): OmniCrossFailure {
  if (error instanceof OmniCrossRouteError) {
    return {
      ...error.failure,
      message: sanitizeAgentDiagnostic(error.failure.message, 4096, secrets),
    };
  }
  return {
    kind: 'invalid-input',
    message: sanitizeAgentDiagnostic(
      error instanceof Error ? error.message : String(error),
      4096,
      secrets
    ),
    retryable: false,
  };
}

function metadata(
  route: FrozenInferenceRoute,
  leaseId: string,
  expiresAt: string
): SafeRouteLeaseMetadata {
  return Object.freeze({
    leaseId,
    broker: 'omnicross',
    runtime: route.runtime,
    upstream: route.upstream,
    model: route.model,
    expiresAt,
  });
}

function safetyMarginMs(expiresAtMs: number, nowMs: number): number {
  const lifetime = Math.max(0, expiresAtMs - nowMs);
  return Math.max(5_000, Math.min(30_000, Math.floor(lifetime / 3)));
}

/**
 * Acquire, validate, supervise, and finally release one ephemeral route around
 * exactly one agent attempt. The token never leaves the callback's binding.
 */
export async function withOmniCrossRoute<T>(
  options: WithOmniCrossRouteOptions<T>
): Promise<RouteExecutionResult<T>> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const authoritySecrets = [...(options.secretValues ?? [])];
  const controller = new AbortController();
  let externalAbort: (() => void) | undefined;
  if (options.signal) {
    externalAbort = () => controller.abort(options.signal?.reason ?? new Error('cancelled'));
    if (options.signal.aborted) externalAbort();
    else options.signal.addEventListener('abort', externalAbort, { once: true });
  }

  const request: CreateRouteLeaseRequest = {
    schemaVersion: 'omnicross.route-lease.request/1',
    consumer: 'rasen',
    runtime: options.route.runtime,
    upstream: options.route.upstream,
    model: options.route.model,
    execution: options.attempt,
    idempotencyKey: deriveRouteIdempotencyKey(options.attempt),
    ttlSeconds: options.route.connection.leaseTtlSeconds,
  };

  let created;
  try {
    created = await options.client.create(request, controller.signal);
  } catch (error) {
    options.signal?.removeEventListener('abort', externalAbort!);
    if (controller.signal.aborted) {
      return {
        ok: false,
        failure: {
          kind: 'cancelled',
          message: 'The routed agent attempt was cancelled before lease acquisition completed.',
          retryable: false,
        },
      };
    }
    return { ok: false, failure: safeFailure(error, authoritySecrets) };
  }

  let binding: RuntimeRouteBinding;
  try {
    binding = reduceLaunchDescriptor(request, created, clock.now());
  } catch (error) {
    try {
      await options.client.release(created.leaseId, {
        schemaVersion: 'omnicross.route-lease.release.request/1',
        consumer: 'rasen',
        idempotencyKey: deriveRouteIdempotencyKey(options.attempt, 'release'),
      });
    } catch {
      // The descriptor failure remains primary; daemon TTL is the cleanup backstop.
    }
    options.signal?.removeEventListener('abort', externalAbort!);
    return { ok: false, failure: safeFailure(error, authoritySecrets) };
  }

  const secrets = [...authoritySecrets, ...binding.secretValues];
  let expiresAt = created.expiresAt;
  let timer: unknown;
  let stopped = false;
  let routeFailure: OmniCrossFailure | undefined;
  let renewalInFlight: Promise<void> | undefined;
  let retryTimer: unknown;
  let resolveRetry: (() => void) | undefined;

  const schedule = (): void => {
    if (stopped || controller.signal.aborted) return;
    const expiryMs = Date.parse(expiresAt);
    const delay = Math.max(0, expiryMs - clock.now() - safetyMarginMs(expiryMs, clock.now()));
    timer = clock.setTimeout(() => {
      renewalInFlight = renew();
    }, delay);
  };

  const renew = async (): Promise<void> => {
    if (stopped || controller.signal.aborted) return;
    const expiryMs = Date.parse(expiresAt);
    const renewRequest = {
      schemaVersion: 'omnicross.route-lease.renew.request/1' as const,
      consumer: 'rasen' as const,
      idempotencyKey: deriveRouteIdempotencyKey(options.attempt, 'renew'),
      ttlSeconds: options.route.connection.leaseTtlSeconds,
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await options.client.renew(
          created.leaseId,
          renewRequest,
          controller.signal
        );
        if (
          response.status !== 'active' ||
          response.leaseId !== created.leaseId ||
          response.runtime !== options.route.runtime ||
          response.model !== options.route.model ||
          JSON.stringify(response.upstream) !== JSON.stringify(options.route.upstream) ||
          Date.parse(response.expiresAt) <= clock.now() + 1_000
        ) {
          throw new OmniCrossRouteError({
            kind: 'route-lost',
            message: 'OmniCross renewal no longer proves the frozen lease identity and validity.',
            retryable: false,
          });
        }
        expiresAt = response.expiresAt;
        schedule();
        return;
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        lastError = error;
        const remaining = expiryMs - clock.now();
        if (attempt === 1 || remaining <= 1_000) break;
        await new Promise<void>((resolve) => {
          resolveRetry = resolve;
          retryTimer = clock.setTimeout(
            resolve,
            Math.min(250, Math.max(0, remaining - 1_000))
          );
          if (stopped) {
            clock.clearTimeout(retryTimer);
            resolve();
          }
        });
        retryTimer = undefined;
        resolveRetry = undefined;
      }
    }
    routeFailure = {
      kind: 'route-lost',
      message: safeFailure(lastError, secrets).message,
      retryable: false,
    };
    controller.abort(OMNICROSS_ROUTE_LOST_ABORT);
  };

  schedule();
  let value: T | undefined;
  let runFailure: OmniCrossFailure | undefined;
  try {
    value = await options.run(binding, controller.signal);
    if (controller.signal.aborted && !routeFailure) {
      runFailure = {
        kind: 'cancelled',
        message: 'The routed agent attempt was cancelled.',
        retryable: false,
      };
    }
  } catch (error) {
    runFailure = controller.signal.aborted && !routeFailure
      ? { kind: 'cancelled', message: 'The routed agent attempt was cancelled.', retryable: false }
      : safeFailure(error, secrets);
  } finally {
    stopped = true;
    if (timer !== undefined) clock.clearTimeout(timer);
    if (retryTimer !== undefined) {
      clock.clearTimeout(retryTimer);
      retryTimer = undefined;
      resolveRetry?.();
      resolveRetry = undefined;
    }
    await renewalInFlight?.catch(() => undefined);
    options.signal?.removeEventListener('abort', externalAbort!);
  }

  const route = metadata(options.route, created.leaseId, expiresAt);
  const warnings: string[] = [];
  try {
    await options.client.release(created.leaseId, {
      schemaVersion: 'omnicross.route-lease.release.request/1',
      consumer: 'rasen',
      idempotencyKey: deriveRouteIdempotencyKey(options.attempt, 'release'),
    });
  } catch (error) {
    warnings.push(`OmniCross lease release was incomplete; TTL cleanup remains active (${safeFailure(error, secrets).kind}).`);
  }

  if (routeFailure) return { ok: false, failure: routeFailure, route, ...(warnings.length ? { warnings } : {}) };
  if (runFailure) return { ok: false, failure: runFailure, route, ...(warnings.length ? { warnings } : {}) };
  return { ok: true, value: value as T, route, ...(warnings.length ? { warnings } : {}) };
}
