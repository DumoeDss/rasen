/**
 * Frozen-action session executor: the orchestrator (design D1, D7; requirements
 * "The executor consumes only granted frozen Actions", "Every driver face
 * drives the same Run within the capability matrix").
 *
 * The executor is the single authoritative seam between the canonical Run
 * Facade and the session host. It consumes a granted frozen Action from the
 * Facade, validates it against the committed Record, selects a backend through
 * the capability matrix (never silently rerouting), drives one real turn through
 * an injectable backend seam, reconciles the host outcome into a typed Action
 * outcome (minting `execution-lost` on daemon/launcher death), and returns the
 * typed result every driver face consumes.
 *
 * The driver faces (interactive launcher, bare CLI, Management API, Canvas,
 * daemon) all call this same orchestrator and this same capability matrix, so
 * no face maintains a second Run or Session truth (design D7). The backend seam
 * is injectable so the deterministic protocol-replay counterparts (Section 9.1)
 * drive the same path the real backends do.
 */

import type {
  ExactChangeRunRef,
  RunAction,
  WorkspaceRevision,
} from '../change-run/contracts.js';
import type { CanonicalRunRecord } from '../change-run/internal/record.js';
import type { AgentContinuationGrant } from '../change-run/consultation-contracts.js';
import {
  deriveContinuationRequestId,
  digestContinuationInput,
} from '../change-run/consultation-contracts.js';
import { canonicalJson } from '../change-run/internal/identity.js';
import { validateTurnInputBytes } from '../session-host/contracts.js';
import { deriveAgentTurnInputBinding } from '../change-run/internal/actions.js';
import {
  type BackendSelection,
  type ExecutionBackendId,
  type ExecutionCapabilityMatrix,
  resolveBackendSelection,
} from './capability-matrix.js';
import {
  type ActionOutcome,
  type OwnershipLiveness,
  type TurnResult,
  reconcileActionOutcome,
} from './action-outcome.js';
import {
  type AuthorityValidationResult,
  validateGrantedAction,
  type InFlightDispatchLedger,
} from './authority.js';
import { decideReuse, resolveReusePolicy } from './reuse-policy.js';
import type {
  OmniCrossFailure,
  RuntimeRouteBinding,
  SafeRouteLeaseMetadata,
} from '../omnicross/index.js';
import type { RoutedActionLifecycle } from './omnicross-lifecycle.js';

export interface AgentBackendTurnInput {
  readonly action: RunAction;
  readonly input: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly sandbox: 'read-only' | 'workspace-write';
  readonly authority?: Readonly<{
    invocationId: string;
    role: string;
    workspaceInstanceId: string;
    backend: 'hosted';
  }>;
  readonly handoffTokens?: number;
  readonly routeBinding?: RuntimeRouteBinding;
  readonly signal?: AbortSignal;
}

type BackendTurnExecutionResult =
  | {
      readonly turn: TurnResult | undefined;
      readonly daemonAlive: boolean;
    }
  | {
      readonly turn: TurnResult | undefined;
      readonly launcherAlive: boolean;
    };

/**
 * The hosted-backend seam. The executor drives one turn and reads the owning
 * daemon's liveness; the concrete session host (`createSessionHost`) is one
 * implementation, the deterministic replay backend is another.
 */
export interface HostedBackendSeam {
  readonly kind: 'hosted';
  executeTurn(input: Readonly<AgentBackendTurnInput>): Promise<{
    readonly turn: TurnResult | undefined;
    readonly daemonAlive: boolean;
  }>;
  inspectSession?(sessionId: string): Readonly<{
    sandbox: 'read-only' | 'workspace-write';
    currentRequest?: Readonly<{
      requestId: string;
      state: 'prepared' | 'sent' | 'settled' | 'cancelled' | 'ambiguous';
    }>;
    authority?: Readonly<{
      invocationId: string;
      role: string;
      workspaceInstanceId: string;
      backend: 'hosted';
      handoffTokensUsed: number;
      reuseRoundsServed: number;
    }>;
  }> | undefined;
}

/**
 * The in-tool-backend seam. The host tool (Claude Code / Codex) owns the worker
 * process; the executor reads the launcher's liveness and the turn the launcher
 * settled. Launcher disappearance mints `execution-lost`.
 */
export interface InToolBackendSeam {
  readonly kind: 'in-tool';
  executeTurn(input: Readonly<AgentBackendTurnInput>): Promise<{
    readonly turn: TurnResult | undefined;
    readonly launcherAlive: boolean;
  }>;
}

export type ExecutorBackendSeam = HostedBackendSeam | InToolBackendSeam;

export interface ExecutorBackends {
  readonly hosted?: HostedBackendSeam;
  readonly 'in-tool'?: InToolBackendSeam;
}

export interface DispatchGrantedActionOptions {
  readonly runRef: ExactChangeRunRef;
  readonly grantedAction: RunAction;
  readonly record: CanonicalRunRecord;
  readonly expectedRecordVersion: number;
  readonly workspaceRevision: WorkspaceRevision;
  readonly matrix: ExecutionCapabilityMatrix;
  readonly backends: ExecutorBackends;
  readonly requestedBackend?: ExecutionBackendId;
  readonly explicitDefaultBackend?: ExecutionBackendId;
  /** True only for Actions whose frozen profile path is consultation-eligible. */
  readonly requiresContinuableTurns?: boolean;
  readonly inFlight?: InFlightDispatchLedger;
  readonly routedActionLifecycle?: RoutedActionLifecycle;
  /** Shared authenticated-turn UTF-8 bound, supplied by the production face. */
  readonly maxInputBytes?: number;
  /**
   * The input the backend turn executes. The executor does not interpret it;
   * it forwards the frozen Action's authored input verbatim.
   */
  readonly turnInput: string;
}

export type ExecutionInputRejectionCode =
  | 'execution_input_authority_missing'
  | 'execution_input_mismatch'
  | 'execution_input_too_large';

export interface ExecutionInputRejection {
  readonly kind: 'execution-input-rejected';
  readonly code: ExecutionInputRejectionCode;
  readonly message: string;
  readonly retryable: false;
}

export type ExecutionDispatchResult =
  | (AuthorityValidationResult & { readonly kind: 'rejected' | 'duplicate' })
  | ExecutionInputRejection
  | {
      readonly kind: 'authority-unavailable';
      readonly selection: BackendSelection;
    }
  | {
      readonly kind: 'executed';
      readonly backend: ExecutionBackendId;
      readonly selection: BackendSelection;
      readonly outcome: ActionOutcome;
    }
  | {
      readonly kind: 'route-failed';
      readonly backend: ExecutionBackendId;
      readonly selection: BackendSelection;
      readonly failure: OmniCrossFailure;
      readonly route?: SafeRouteLeaseMetadata;
      readonly warnings?: readonly string[];
    };

export interface DispatchContinuationOptions {
  readonly grant: AgentContinuationGrant;
  readonly record: CanonicalRunRecord;
  readonly matrix: ExecutionCapabilityMatrix;
  readonly backends: ExecutorBackends;
  readonly requestedBackend?: ExecutionBackendId;
  readonly explicitDefaultBackend?: ExecutionBackendId;
}

function livenessFor(
  backend: ExecutorBackendSeam,
  turnResult: { readonly daemonAlive?: boolean; readonly launcherAlive?: boolean }
): OwnershipLiveness {
  if (backend.kind === 'hosted') {
    return { backend: 'hosted', daemonAlive: turnResult.daemonAlive ?? true };
  }
  return { backend: 'in-tool', launcherAlive: turnResult.launcherAlive ?? true };
}

/**
 * Dispatch a granted frozen Action through the executor. Validates authority
 * against the committed Record, selects a backend through the matrix, drives one
 * turn through the backend seam, and reconciles the outcome. Returns a typed
 * result; no path silently reroutes hosted -> in-tool, and no path re-derives
 * authority from the turn input.
 */
export async function dispatchGrantedAction(
  options: DispatchGrantedActionOptions
): Promise<ExecutionDispatchResult> {
  const validation = validateGrantedAction({
    runRef: options.runRef,
    grantedAction: options.grantedAction,
    record: options.record,
    expectedRecordVersion: options.expectedRecordVersion,
    workspaceRevision: options.workspaceRevision,
    inFlight: options.inFlight,
  });
  if (validation.kind === 'rejected') {
    return { ...validation, kind: 'rejected' };
  }
  if (validation.kind === 'duplicate') {
    return { ...validation, kind: 'duplicate' };
  }

  // Complete Action equality above yields the Record-owned Action. Authenticate
  // the sibling transport bytes before backend selection or any lifecycle work.
  const action = validation.action;
  const routedAction =
    action.kind === 'agent'
    && action.agent.inference !== undefined;
  if (action.kind === 'agent') {
    const authority = action.agent.turnInput;
    if (authority === undefined) {
      if (routedAction) {
        return {
          kind: 'execution-input-rejected',
          code: 'execution_input_authority_missing',
          message:
            'The routed frozen Action predates executable turn-input authority and cannot be executed safely.',
          retryable: false,
        };
      }
      // Historical unrouted compatibility: preserve its prior request-rendered
      // behavior. No authority is inferred from agent.input or current content.
    } else {
      const transported = deriveAgentTurnInputBinding(options.turnInput);
      if (
        transported.utf8ByteLength !== authority.utf8ByteLength ||
        transported.contentDigest !== authority.contentDigest
      ) {
        return {
          kind: 'execution-input-rejected',
          code: 'execution_input_mismatch',
          message: 'Transported turnInput does not match the committed Action authority.',
          retryable: false,
        };
      }
      if (
        options.maxInputBytes !== undefined &&
        !validateTurnInputBytes(options.turnInput, options.maxInputBytes).ok
      ) {
        return {
          kind: 'execution-input-rejected',
          code: 'execution_input_too_large',
          message: 'Authenticated turnInput exceeds maxInputBytes.',
          retryable: false,
        };
      }
    }
  }

  const selection = resolveBackendSelection({
    matrix: options.matrix,
    requested: options.requestedBackend,
    explicitDefault: options.explicitDefaultBackend,
    requiresContinuableTurns:
      options.requiresContinuableTurns ??
      (options.grantedAction.kind === 'agent' &&
        options.grantedAction.agent.consultation?.eligible === true),
  });
  if (selection.kind !== 'selected') {
    return { kind: 'authority-unavailable', selection };
  }

  const backend = options.backends[selection.backend];
  if (backend === undefined) {
    // The matrix reported the cell available but no backend seam was wired for
    // it. This is a typed authority-unavailable (the backend is not live),
    // never a silent reroute to another backend.
    return {
      kind: 'authority-unavailable',
      selection: {
        kind: 'authority-unavailable',
        reason: 'hosted-tier-unavailable',
        message: `No backend seam is wired for ${selection.backend} on this executor.`,
        requested: selection.backend,
      },
    };
  }

  // Validation returns the Action owned by the canonical Record. Never dispatch
  // the caller's receipt object, even after complete equality validation: the
  // Record remains the sole object authority at the execution boundary. The
  // sandbox and authority facts below are therefore derived from `action`, not
  // from `options.grantedAction`.
  const sandbox =
    action.kind === 'agent' && action.agent.sandbox === 'read-only'
      ? ('read-only' as const)
      : ('workspace-write' as const);
  const authorityFields =
    action.kind === 'agent'
      ? {
          authority: {
            invocationId: action.invocationId,
            role: action.agent.role,
            workspaceInstanceId: options.record.workspaceInstanceId,
            backend: 'hosted' as const,
          },
        }
      : {};
  let turn: BackendTurnExecutionResult;
  if (routedAction) {
    if (options.routedActionLifecycle === undefined) {
      return {
        kind: 'route-failed',
        backend: selection.backend,
        selection,
        failure: {
          kind: 'invalid-config',
          message: 'No OmniCross Route Lease lifecycle is wired for this executor.',
          retryable: false,
        },
      };
    }
    if (action.agent.workerContract === undefined) {
      return {
        kind: 'route-failed',
        backend: selection.backend,
        selection,
        failure: {
          kind: 'invalid-input',
          message:
            'The routed frozen Action predates worker-contract authority and cannot be executed safely.',
          retryable: false,
        },
      };
    }
    const routed = await options.routedActionLifecycle.execute<BackendTurnExecutionResult>({
      action,
      run: (routeBinding, signal) => backend.executeTurn({
        action,
        input: options.turnInput,
        sandbox,
        ...authorityFields,
        routeBinding,
        signal,
      }),
    });
    if (!routed.ok) {
      return {
        kind: 'route-failed',
        backend: selection.backend,
        selection,
        failure: routed.failure,
        ...(routed.route ? { route: routed.route } : {}),
        ...(routed.warnings ? { warnings: routed.warnings } : {}),
      };
    }
    turn = routed.value;
  } else {
    turn = await backend.executeTurn({
      action,
      input: options.turnInput,
      sandbox,
      ...authorityFields,
    });
  }
  const liveness = livenessFor(backend, turn);
  const outcome = reconcileActionOutcome({ liveness, turn: turn.turn });

  return { kind: 'executed', backend: selection.backend, selection, outcome };
}

/** Wake the exact hosted source Session from one canonical continuation grant. */
export async function dispatchGrantedContinuation(
  options: DispatchContinuationOptions
): Promise<ExecutionDispatchResult> {
  const { grant, record } = options;
  const consultation = record.consultations?.[grant.consultationId];
  const source = record.actions[grant.sourceActionId];
  const sourceAction = source?.action;
  const inputDigest = digestContinuationInput(grant.input);
  if (
    grant.format !== 'teacher-consultation/continuation-grant/1' ||
    grant.runId !== record.runId ||
    grant.expectedRecordVersion !== record.recordVersion ||
    source === undefined ||
    sourceAction === undefined ||
    source.state !== 'consultation-paused' ||
    sourceAction.kind !== 'agent' ||
    sourceAction.invocationId !== grant.sourceInvocationId ||
    sourceAction.attemptId !== grant.sourceAttemptId ||
    consultation === undefined ||
    consultation.state !== 'continuation-granted' ||
    consultation.source.stableSessionId !== grant.stableSessionId ||
    consultation.continuation?.requestId !== grant.requestId ||
    grant.inputDigest !== inputDigest ||
    grant.requestId !==
      deriveContinuationRequestId(grant.consultationId, inputDigest) ||
    grant.role !== sourceAction.agent.role ||
    grant.workspaceInstanceId !== record.workspaceInstanceId
  ) {
    return {
      kind: 'rejected',
      code: 'receipt_conflict',
      message:
        'Continuation grant does not match the exact canonical source Action, Session, input, or Record revision.',
    };
  }
  const selection = resolveBackendSelection({
    matrix: options.matrix,
    requested: options.requestedBackend ?? 'hosted',
    explicitDefault: options.explicitDefaultBackend,
    requiresContinuableTurns: true,
  });
  if (selection.kind !== 'selected') {
    return { kind: 'authority-unavailable', selection };
  }
  if (selection.backend !== 'hosted') {
    return {
      kind: 'authority-unavailable',
      selection: {
        kind: 'authority-unavailable',
        reason: 'hosted-tier-unavailable',
        message:
          'consultation-continuation-unavailable: continuation requires hosted execution.',
        requested: selection.backend,
      },
    };
  }
  const authority = {
    invocationId: sourceAction.invocationId,
    role: sourceAction.agent.role,
    workspaceInstanceId: record.workspaceInstanceId,
    backend: 'hosted' as const,
  };
  const backend = options.backends.hosted;
  if (backend === undefined) {
    return {
      kind: 'authority-unavailable',
      selection: {
        kind: 'authority-unavailable',
        reason: 'hosted-tier-unavailable',
        message: 'No hosted Session backend is wired for continuation.',
        requested: 'hosted',
      },
    };
  }
  const established = backend.inspectSession?.(grant.stableSessionId);
  if (
    established?.authority === undefined ||
    established.sandbox !==
      (sourceAction.agent.sandbox === 'read-only' ? 'read-only' : 'workspace-write')
  ) {
    return {
      kind: 'rejected',
      code: 'receipt_conflict',
      message:
        'Continuation Session has no exact persisted sandbox/reuse authority facts.',
    };
  }
  const exactRequestReplay =
    established.currentRequest?.requestId === grant.requestId;
  if (!exactRequestReplay) {
    const reuse = decideReuse({
      policy: resolveReusePolicy({ authored: sourceAction.agent.session }),
      established: established.authority,
      requested: authority,
      handoffTokensUsed: established.authority.handoffTokensUsed,
      reuseRoundsServed: established.authority.reuseRoundsServed,
    });
    if (reuse.kind !== 'permitted') {
      return {
        kind: 'rejected',
        code: 'receipt_conflict',
        message: `Continuation Session reuse is not permitted: ${reuse.message}`,
      };
    }
  }
  const serializedInput = canonicalJson(grant.input);
  const turn = await backend.executeTurn({
    action: sourceAction,
    input: serializedInput,
    sessionId: grant.stableSessionId,
    requestId: grant.requestId,
    sandbox:
      sourceAction.agent.sandbox === 'read-only' ? 'read-only' : 'workspace-write',
    authority,
    handoffTokens: Math.ceil(Buffer.byteLength(serializedInput, 'utf8') / 4),
  });
  if (
    turn.turn?.ok === true &&
    (turn.turn.hostedTurn === undefined ||
      turn.turn.hostedTurn.stableSessionId !== grant.stableSessionId ||
      turn.turn.hostedTurn.requestId !== grant.requestId)
  ) {
    return {
      kind: 'rejected',
      code: 'receipt_conflict',
      message:
        'Hosted continuation settlement does not attest the exact granted Session and request identity.',
    };
  }
  const outcome = reconcileActionOutcome({
    liveness: { backend: 'hosted', daemonAlive: turn.daemonAlive },
    turn: turn.turn,
  });
  return {
    kind: 'executed',
    backend: 'hosted',
    selection,
    outcome,
  };
}

/**
 * Record the seam left for the operator-owned
 * `ecp-session-self-hosting-vertical-proof` child. The proof drives this
 * executor to take a non-ECP toy Change from start to delivery-ready; this
 * change does not select or design that toy Change (design D9; acceptance 7).
 */
export const SELF_HOSTING_PROOF_SEAM = Object.freeze({
  drivenBy: 'ecp-session-self-hosting-vertical-proof',
  operatorOwned: true,
  notDesignedHere: true,
} as const);
