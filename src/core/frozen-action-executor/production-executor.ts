/**
 * Frozen-action session executor: the production seam that wires the executor
 * to real backends (task 7.1 — driver-face wiring).
 *
 * The executor's pure core (`dispatchGrantedAction`) talks to backends through
 * the abstract `HostedBackendSeam` / `InToolBackendSeam` interfaces. This module
 * is the bridge from those abstract seams to the real surfaces a production
 * driver face has on hand: a `SessionHost` (the daemon-owned hosted backend)
 * and a launcher-liveness probe (the in-tool backend). It constructs the
 * computed capability matrix and binds the backends, returning a single
 * `ProductionExecutor.dispatch` that every driver face (CLI / Management API /
 * Canvas / daemon) calls — so no face maintains a second Run or Session truth.
 *
 * Daemon-lifetime posture (decision 11): the hosted scope's owning daemon IS
 * the process running this executor, so `daemonAlive` is true in-process while
 * the daemon runs; the daemon-death `execution-lost` case is reached when a
 * fresh daemon process reconciles a stale scope after restart, not from this
 * in-process dispatch path. The in-process lost-generation case
 * (`turn-outcome-unknown` + unfinished request) IS reachable here and the seam
 * surfaces it for the reconciliation to mint `execution-lost`.
 */

import {
  validateTurnInputBytes,
  type SessionHost,
  type SessionHostOutcome,
  type TurnLimits,
} from '../session-host/contracts.js';
import type { RunAction } from '../change-run/contracts.js';
import { deriveFreshStepRequestId } from '../change-run/consultation-contracts.js';
import { sanitizeAgentDiagnosticValue } from '../agent-diagnostics.js';
import { resolveAgentCliBinary } from '../agent-cli-process.js';
import { buildClaudePrintInvocation, runClaudePrint } from '../claude/index.js';
import { runCodexExec } from '../codex/index.js';
import { LEAF_EFFORTS, type LeafEffort } from '../pipeline-registry/types.js';
import {
  buildExecutionCapabilityMatrix,
  type ExecutionCapabilityMatrix,
  type HostedTierStatus,
} from './capability-matrix.js';
import type { TurnResult } from './action-outcome.js';
import {
  dispatchGrantedAction,
  dispatchGrantedContinuation,
  type DispatchContinuationOptions,
  type ExecutionDispatchResult,
  type ExecutorBackends,
  type HostedBackendSeam,
  type InToolBackendSeam,
} from './executor.js';
import type { DispatchGrantedActionOptions } from './executor.js';
import {
  createRoutedActionLifecycle,
  type RoutedActionLifecycle,
} from './omnicross-lifecycle.js';
import {
  buildRoutedChildEnvironment,
  OmniCrossRouteError,
  type RuntimeRouteBinding,
} from '../omnicross/index.js';

/**
 * Map a `SessionHostOutcome` (from an `execute` dispatch) into the executor's
 * abstract `TurnResult`. A settled turn (`ok: true`) is a workload outcome; the
 * caller may supply `interpretResultStatus` to read succeeded/failed out of the
 * result body (default: a settled turn is `succeeded`). A `turn-outcome-unknown`
 * failure is an ambiguous turn whose request did not settle; any other failure
 * is a definitive (non-ambiguous) host failure.
 */
export function turnResultFromHostOutcome(
  outcome: SessionHostOutcome,
  interpretResultStatus?: (result: string | undefined) => 'succeeded' | 'failed'
): TurnResult {
  if (outcome.ok) {
    const status = interpretResultStatus?.(outcome.result) ?? 'succeeded';
    return {
      ok: true,
      status,
      ...(outcome.requestId === undefined
        ? {}
        : {
            hostedTurn: {
              stableSessionId: outcome.session.sessionId,
              ...(outcome.session.backendSessionId === undefined
                ? {}
                : { backendSessionId: outcome.session.backendSessionId }),
              requestId: outcome.requestId,
              requestState: outcome.session.currentRequest?.state,
              ...(outcome.result === undefined ? {} : { result: outcome.result }),
              ...(outcome.resultDigest === undefined
                ? {}
                : { resultDigest: outcome.resultDigest }),
              ...(outcome.resultRef === undefined ? {} : { resultRef: outcome.resultRef }),
              ...(outcome.receipt === undefined ? {} : { receipt: outcome.receipt }),
              replayed: outcome.replayed ?? false,
              cwd: outcome.session.cwd,
            },
          }),
    };
  }
  const ambiguous = outcome.code === 'turn-outcome-unknown';
  const hostedTurn = outcome.receipt === undefined
    ? undefined
    : {
        stableSessionId: outcome.receipt.stableSessionId,
        ...(outcome.receipt.backendSessionId === undefined
          ? {}
          : { backendSessionId: outcome.receipt.backendSessionId }),
        requestId: outcome.receipt.requestId,
        requestState: outcome.receipt.requestState,
        ...(outcome.receipt.result === undefined
          ? {}
          : { result: outcome.receipt.result }),
        ...(outcome.receipt.resultDigest === undefined
          ? {}
          : { resultDigest: outcome.receipt.resultDigest }),
        ...(outcome.receipt.resultRef === undefined
          ? {}
          : { resultRef: outcome.receipt.resultRef }),
        receipt: outcome.receipt,
        replayed: outcome.receipt.replayed,
        cwd: outcome.receipt.cwd,
      };
  return {
    ok: false,
    code: outcome.code,
    ambiguous,
    // turn-outcome-unknown means the request's outcome is unknown -> its
    // commitment is unfinished; a definitive host failure is not unfinished.
    requestUnfinished: ambiguous,
    ...(hostedTurn === undefined ? {} : { hostedTurn }),
  };
}

export type RoutedTurnExecutor = (input: Readonly<{
  action: RunAction;
  input: string;
  binding: RuntimeRouteBinding;
  signal: AbortSignal;
}>) => Promise<TurnResult>;

export interface HostedBackendSeamOptions {
  /**
   * The canonical cwd hosted Sessions execute in. Bound at seam construction so
   * the driver face cannot smuggle a per-dispatch cwd past the granted
   * ActionView's workspace authority (which `validateGrantedAction` checks).
   */
  readonly cwd: string;
  readonly backend: string;
  readonly limits: TurnLimits;
  /**
   * Optional interpreter for a settled turn's result body -> succeeded/failed.
   * Defaults to `succeeded` (a settled turn is a successful host turn; workload
   * failure is encoded in the result and interpreted by the completion path).
   */
  readonly interpretResultStatus?: (result: string | undefined) => 'succeeded' | 'failed';
  /**
   * The daemon-liveness signal. In-process (the daemon running this executor)
   * this is always true; a reconciliation pass after a daemon restart would
   * construct the seam with `false` for a scope whose owning daemon is gone.
   */
  readonly daemonAlive?: boolean;
  /** Route-aware process bridge owned by the hosted driver face. */
  readonly executeRoutedTurn?: RoutedTurnExecutor;
}

/**
 * Wrap a production `SessionHost` as the executor's `HostedBackendSeam`. The
 * seam issues an `execute` command for each turn and maps the outcome into the
 * abstract `TurnResult` + daemon-liveness signal the reconciliation composes.
 */
export function createHostedBackendSeamFromSessionHost(
  host: SessionHost,
  options: HostedBackendSeamOptions
) {
  const daemonAlive = options.daemonAlive ?? true;
  return {
    kind: 'hosted' as const,
    async executeTurn(input: Readonly<{
      action: RunAction;
      input: string;
      sessionId?: string;
      requestId?: string;
      sandbox: 'read-only' | 'workspace-write';
      authority?: Readonly<{
        invocationId: string;
        role: string;
        workspaceInstanceId: string;
        backend: 'hosted';
      }>;
      handoffTokens?: number;
      routeBinding?: RuntimeRouteBinding;
      signal?: AbortSignal;
    }>) {
      // The requestId binds this turn in the host registry. It is derived from
      // the frozen Action identity so a replay re-derives the same id and the
      // host's idempotent-settled path applies.
      const requestId = input.requestId ?? actionExecuteRequestId(input.action);
      if (input.routeBinding) {
        if (!input.signal || !options.executeRoutedTurn) {
          throw new OmniCrossRouteError({
            kind: 'invalid-config',
            message: 'The hosted executor has no route-aware child-process bridge.',
            retryable: false,
          });
        }
        return {
          turn: await options.executeRoutedTurn({
            action: input.action,
            input: input.input,
            binding: input.routeBinding,
            signal: input.signal,
          }),
          daemonAlive,
        };
      }
      const outcome = await host.dispatch({
        op: 'execute',
        requestId,
        ...(input.sessionId === undefined
          ? { newSessionId: requestId }
          : { sessionId: input.sessionId }),
        backend: options.backend,
        cwd: options.cwd,
        input: input.input,
        limits: options.limits,
        sandbox: input.sandbox,
        ...(input.authority ? { authority: input.authority } : {}),
        ...(input.handoffTokens === undefined
          ? {}
          : { handoffTokens: input.handoffTokens }),
      });
      return {
        turn: turnResultFromHostOutcome(outcome, options.interpretResultStatus),
        daemonAlive,
      };
    },
    inspectSession(sessionId: string) {
      const view = host.inspect(sessionId);
      return view === undefined
        ? undefined
        : {
            sandbox: view.sandbox,
            ...(view.currentRequest
              ? {
                  currentRequest: {
                    requestId: view.currentRequest.requestId,
                    state: view.currentRequest.state,
                  },
                }
              : {}),
            ...(view.authority ? { authority: view.authority } : {}),
          };
    },
  };
}

/**
 * A launcher-liveness probe: returns true while the in-tool launcher process is
 * still alive. The executor consults it to mint `execution-lost` when the
 * launcher disappears.
 */
export type LauncherLivenessProbe = () => boolean;

export type InToolRoutedTurnExecutor = (input: Readonly<{
  action: RunAction;
  input: string;
  binding: RuntimeRouteBinding;
  signal: AbortSignal;
}>) => Promise<TurnResult | undefined>;

export interface ProductionRoutedTurnExecutorOptions {
  readonly cwd: string;
  readonly limits: TurnLimits;
  readonly env?: NodeJS.ProcessEnv;
}

function routedTurnFailure(code: string): TurnResult {
  return { ok: false, code, ambiguous: false, requestUnfinished: false };
}

/**
 * Build the real route-aware Claude/Codex process bridge used by production
 * frozen-Action driver faces. The frozen Action supplies runtime/model/sandbox/
 * effort, while the validated one-attempt binding supplies only the closed
 * route environment/provider override. The Admin credential is removed from
 * the child environment and no user credential file is consulted or changed.
 */
export function createProductionRoutedTurnExecutor(
  options: ProductionRoutedTurnExecutorOptions
): RoutedTurnExecutor {
  return async ({ action, input, binding, signal }) => {
    if (action.kind !== 'agent' || action.agent.inference === undefined) {
      throw new OmniCrossRouteError({
        kind: 'invalid-input',
        message: 'The production route-aware process bridge requires a routed agent Action.',
        retryable: false,
      });
    }
    const workerContract = action.agent.workerContract;
    if (workerContract === undefined) {
      throw new OmniCrossRouteError({
        kind: 'invalid-input',
        message:
          'The routed frozen Action predates worker-contract authority and cannot be executed safely.',
        retryable: false,
      });
    }
    const inputValidation = validateTurnInputBytes(input, options.limits.maxInputBytes);
    if (!inputValidation.ok) {
      throw new OmniCrossRouteError({
        kind: 'invalid-input',
        message: inputValidation.message,
        retryable: false,
      });
    }
    const runtime = action.agent.runtime.toLowerCase();
    if (runtime !== binding.runtime || action.agent.inference.runtime !== binding.runtime) {
      throw new OmniCrossRouteError({
        kind: 'invalid-input',
        message: 'The validated route binding runtime does not match the frozen agent Action.',
        retryable: false,
      });
    }
    const binary = resolveAgentCliBinary({
      envVar: binding.runtime === 'codex' ? 'RASEN_CODEX_BIN' : 'RASEN_CLAUDE_BIN',
      binaryName: binding.runtime === 'codex' ? 'codex' : 'claude',
      env: options.env ?? process.env,
    });
    if (binary === null) {
      throw new OmniCrossRouteError({
        kind: 'invalid-config',
        message: `${binding.runtime === 'codex' ? 'Codex' : 'Claude Code'} CLI is unavailable for the routed frozen Action.`,
        retryable: false,
      });
    }
    const childEnv = buildRoutedChildEnvironment(
      options.env ?? process.env,
      action.agent.inference.connection.controlTokenEnv,
      binding.env
    );
    const sandbox = action.agent.sandbox;
    if (sandbox !== 'read-only' && sandbox !== 'workspace-write') {
      throw new OmniCrossRouteError({
        kind: 'invalid-input',
        message: `The frozen agent Action has unsupported sandbox ${sandbox}.`,
        retryable: false,
      });
    }
    const effort = action.agent.reasoningEffort;
    if (!LEAF_EFFORTS.includes(effort as LeafEffort)) {
      throw new OmniCrossRouteError({
        kind: 'invalid-input',
        message: `The frozen agent Action has unsupported reasoning effort ${effort}.`,
        retryable: false,
      });
    }

    if (binding.runtime === 'codex') {
      const receipt = await runCodexExec({
        binary,
        prompt: input,
        contract: workerContract,
        sandbox,
        cwd: options.cwd,
        model: action.agent.model,
        effort: effort as LeafEffort,
        timeoutMs: options.limits.timeoutMs,
        maxOutputBytes: options.limits.maxOutputBytes,
        env: childEnv,
        providerOverride: binding.providerOverride,
        signal,
        secretValues: binding.secretValues,
      });
      return receipt.ok
        ? {
            ok: true,
            status: 'succeeded',
            result: sanitizeAgentDiagnosticValue(
              receipt.result,
              binding.secretValues
            ),
          }
        : routedTurnFailure(receipt.failure.kind);
    }

    const receipt = await runClaudePrint({
      binary,
      invocation: buildClaudePrintInvocation({
        prompt: input,
        contract: workerContract,
        sandbox,
        model: action.agent.model,
        effort: effort as LeafEffort,
      }),
      cwd: options.cwd,
      timeoutMs: options.limits.timeoutMs,
      maxOutputBytes: options.limits.maxOutputBytes,
      env: childEnv,
      signal,
      secretValues: binding.secretValues,
    });
    return receipt.ok
      ? {
          ok: true,
          status: 'succeeded',
          result: sanitizeAgentDiagnosticValue(
            receipt.result,
            binding.secretValues
          ),
        }
      : routedTurnFailure(receipt.failure.kind);
  };
}

/**
 * Wrap a launcher-liveness probe as the executor's `InToolBackendSeam`. The
 * in-tool backend's turn is whatever the launcher settled (the host tool owns
 * the worker); launcher disappearance mints `execution-lost`.
 */
export function createInToolBackendSeamFromLauncherLiveness(
  probe: LauncherLivenessProbe,
  settle?: () => TurnResult | undefined,
  executeRoutedTurn?: InToolRoutedTurnExecutor
) {
  return {
    kind: 'in-tool' as const,
    async executeTurn(input: Readonly<{
      action: RunAction;
      input: string;
      routeBinding?: RuntimeRouteBinding;
      signal?: AbortSignal;
    }>) {
      let turn: TurnResult | undefined;
      if (input.routeBinding) {
        if (!input.signal || !executeRoutedTurn) {
          throw new OmniCrossRouteError({
            kind: 'invalid-config',
            message: 'The in-tool executor has no route-aware child-process bridge.',
            retryable: false,
          });
        }
        turn = await executeRoutedTurn({
          action: input.action,
          input: input.input,
          binding: input.routeBinding,
          signal: input.signal,
        });
      } else {
        turn = settle?.();
      }
      return {
        turn,
        launcherAlive: probe(),
      };
    },
  };
}

/**
 * Derive a stable UUID-shape requestId for a granted Action's execute turn.
 * The host registry requires a UUID; the executor derives one deterministically
 * from the frozen Action identity so a replay re-derives the same id and the
 * host's idempotent path applies. (The value is hex-filled into the UUID
 * canonical shape; it need not be an RFC-random, only stable + unique per
 * action within a Run.)
 */
export function actionExecuteRequestId(action: RunAction): string {
  return deriveFreshStepRequestId(
    action.runId as never,
    action.actionId as never,
    action.attemptId as never
  );
}

export interface ProductionExecutorOptions {
  readonly hostPlatform: string;
  readonly hostedTierStatus?: HostedTierStatus;
  /** Shared dispatch-time bound for faces that do not wire a SessionHost. */
  readonly maxInputBytes?: number;
  readonly host?: SessionHost;
  readonly hostedSeamOptions?: HostedBackendSeamOptions;
  readonly launcherLivenessProbe?: LauncherLivenessProbe;
  readonly executeInToolRoutedTurn?: InToolRoutedTurnExecutor;
  readonly routedActionLifecycle?: RoutedActionLifecycle;
}

/**
 * The production executor: the capability matrix + the wired backends, behind a
 * single `dispatch` every driver face calls. Constructing it computes the
 * matrix once (it is queryable before any Run starts) and binds whichever
 * backends the host has on hand (a `SessionHost` for the hosted backend, a
 * launcher-liveness probe for the in-tool backend).
 */
export interface ProductionExecutor {
  readonly matrix: ExecutionCapabilityMatrix;
  readonly backends: ExecutorBackends;
  readonly dispatch: (options: Omit<DispatchGrantedActionOptions, 'matrix' | 'backends'>) => Promise<ExecutionDispatchResult>;
  readonly dispatchContinuation: (
    options: Omit<DispatchContinuationOptions, 'matrix' | 'backends'>
  ) => Promise<ExecutionDispatchResult>;
}

export function createProductionExecutor(
  options: ProductionExecutorOptions
): ProductionExecutor {
  const matrix = buildExecutionCapabilityMatrix({
    hostPlatform: options.hostPlatform,
    hostedTierStatus: options.hostedTierStatus,
  });
  const backends: { hosted?: HostedBackendSeam; 'in-tool'?: InToolBackendSeam } = {};
  if (options.host !== undefined && options.hostedSeamOptions !== undefined) {
    backends.hosted = createHostedBackendSeamFromSessionHost(
      options.host,
      options.hostedSeamOptions
    );
  }
  if (options.launcherLivenessProbe !== undefined) {
    backends['in-tool'] = createInToolBackendSeamFromLauncherLiveness(
      options.launcherLivenessProbe,
      undefined,
      options.executeInToolRoutedTurn
    );
  }
  const frozenBackends: ExecutorBackends = Object.freeze(backends);
  const routedActionLifecycle = options.routedActionLifecycle
    ?? createRoutedActionLifecycle();
  return Object.freeze({
    matrix,
    backends: frozenBackends,
    dispatch: (dispatchOptions: Omit<DispatchGrantedActionOptions, 'matrix' | 'backends'>) =>
      dispatchGrantedAction({
        ...dispatchOptions,
        matrix,
        backends: frozenBackends,
        routedActionLifecycle,
        ...(options.maxInputBytes !== undefined
          ? { maxInputBytes: options.maxInputBytes }
          : options.hostedSeamOptions !== undefined
            ? { maxInputBytes: options.hostedSeamOptions.limits.maxInputBytes }
            : {}),
      }),
    dispatchContinuation: (
      dispatchOptions: Omit<DispatchContinuationOptions, 'matrix' | 'backends'>
    ) =>
      dispatchGrantedContinuation({
        ...dispatchOptions,
        matrix,
        backends: frozenBackends,
      }),
  });
}
