import { createHash } from 'node:crypto';

import type { RunAction } from '../change-run/contracts.js';
import { sanitizeAgentDiagnostic } from '../agent-diagnostics.js';
import {
  createOmniCrossRouteLeaseClient,
  OmniCrossRouteError,
  resolveOmniCrossControlAuthority,
  withOmniCrossRoute,
  type OmniCrossFailure,
  type OmniCrossRouteLeaseClient,
  type RouteExecutionResult,
  type RuntimeRouteBinding,
} from '../omnicross/index.js';

export interface RoutedActionTurnInput<T> {
  readonly action: Extract<RunAction, { kind: 'agent' }>;
  readonly run: (
    binding: RuntimeRouteBinding,
    signal: AbortSignal
  ) => Promise<T>;
  readonly signal?: AbortSignal;
}

/** Shared production seam used by every frozen-Action driver face. */
export interface RoutedActionLifecycle {
  execute<T>(input: RoutedActionTurnInput<T>): Promise<RouteExecutionResult<T>>;
}

export interface RoutedActionLifecycleOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly createClient?: (
    authority: ReturnType<typeof resolveOmniCrossControlAuthority>
  ) => OmniCrossRouteLeaseClient;
}

function attemptOrdinal(action: RunAction): number {
  const bytes = createHash('sha256').update(String(action.attemptId)).digest();
  return bytes.readUInt32BE(0) % 1_000_000 + 1;
}

function setupFailure(error: unknown, secrets: readonly string[] = []): OmniCrossFailure {
  if (error instanceof OmniCrossRouteError) {
    return {
      ...error.failure,
      message: sanitizeAgentDiagnostic(error.failure.message, 4096, secrets),
    };
  }
  return {
    kind: 'invalid-config',
    message: sanitizeAgentDiagnostic(
      error instanceof Error ? error.message : String(error),
      4096,
      secrets
    ),
    retryable: false,
  };
}

/**
 * Recreate only ephemeral authority from the Action's frozen logical route.
 * The current Pipeline/config model is intentionally absent from this API.
 */
export function createRoutedActionLifecycle(
  options: RoutedActionLifecycleOptions = {}
): RoutedActionLifecycle {
  return Object.freeze({
    async execute<T>(input: RoutedActionTurnInput<T>): Promise<RouteExecutionResult<T>> {
      const route = input.action.agent.inference;
      if (route === undefined) {
        return {
          ok: false,
          failure: {
            kind: 'invalid-input',
            message: 'A routed Action lifecycle requires frozen inference authority.',
            retryable: false,
          },
        };
      }
      let authority: ReturnType<typeof resolveOmniCrossControlAuthority>;
      try {
        authority = resolveOmniCrossControlAuthority(
          route.connection,
          options.env ?? process.env
        );
      } catch (error) {
        return { ok: false, failure: setupFailure(error) };
      }
      let client: OmniCrossRouteLeaseClient;
      try {
        client = options.createClient?.(authority)
          ?? createOmniCrossRouteLeaseClient({ authority });
      } catch (error) {
        return {
          ok: false,
          failure: setupFailure(error, [authority.controlToken]),
        };
      }
      return withOmniCrossRoute({
        route,
        attempt: {
          runId: String(input.action.runId),
          stageId: String(input.action.nodeId),
          attempt: attemptOrdinal(input.action),
        },
        client,
        secretValues: [authority.controlToken],
        run: input.run,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  });
}
