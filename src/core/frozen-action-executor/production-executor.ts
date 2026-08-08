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

import type {
  SessionHost,
  SessionHostOutcome,
  TurnLimits,
} from '../session-host/contracts.js';
import type { RunAction } from '../change-run/contracts.js';
import {
  buildExecutionCapabilityMatrix,
  type ExecutionCapabilityMatrix,
  type HostedTierStatus,
} from './capability-matrix.js';
import type { TurnResult } from './action-outcome.js';
import {
  dispatchGrantedAction,
  type ExecutionDispatchResult,
  type ExecutorBackends,
  type HostedBackendSeam,
  type InToolBackendSeam,
} from './executor.js';
import type { DispatchGrantedActionOptions } from './executor.js';

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
    return { ok: true, status };
  }
  const ambiguous = outcome.code === 'turn-outcome-unknown';
  return {
    ok: false,
    code: outcome.code,
    ambiguous,
    // turn-outcome-unknown means the request's outcome is unknown -> its
    // commitment is unfinished; a definitive host failure is not unfinished.
    requestUnfinished: ambiguous,
  };
}

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
    async executeTurn(input: Readonly<{ action: RunAction; input: string }>) {
      // The requestId binds this turn in the host registry. It is derived from
      // the frozen Action identity so a replay re-derives the same id and the
      // host's idempotent-settled path applies.
      const requestId = actionExecuteRequestId(input.action);
      const outcome = await host.dispatch({
        op: 'execute',
        requestId,
        backend: options.backend,
        cwd: options.cwd,
        input: input.input,
        limits: options.limits,
      });
      return {
        turn: turnResultFromHostOutcome(outcome, options.interpretResultStatus),
        daemonAlive,
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

/**
 * Wrap a launcher-liveness probe as the executor's `InToolBackendSeam`. The
 * in-tool backend's turn is whatever the launcher settled (the host tool owns
 * the worker); launcher disappearance mints `execution-lost`.
 */
export function createInToolBackendSeamFromLauncherLiveness(
  probe: LauncherLivenessProbe,
  settle?: () => TurnResult | undefined
) {
  return {
    kind: 'in-tool' as const,
    async executeTurn() {
      return {
        turn: settle?.(),
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
  const seed = `${action.runId}:${action.actionId}:${action.attemptId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface ProductionExecutorOptions {
  readonly hostPlatform: string;
  readonly hostedTierStatus?: HostedTierStatus;
  readonly host?: SessionHost;
  readonly hostedSeamOptions?: HostedBackendSeamOptions;
  readonly launcherLivenessProbe?: LauncherLivenessProbe;
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
      options.launcherLivenessProbe
    );
  }
  const frozenBackends: ExecutorBackends = Object.freeze(backends);
  return Object.freeze({
    matrix,
    backends: frozenBackends,
    dispatch: (dispatchOptions: Omit<DispatchGrantedActionOptions, 'matrix' | 'backends'>) =>
      dispatchGrantedAction({
        ...dispatchOptions,
        matrix,
        backends: frozenBackends,
      }),
  });
}
