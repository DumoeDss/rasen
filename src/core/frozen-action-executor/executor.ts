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

/**
 * The hosted-backend seam. The executor drives one turn and reads the owning
 * daemon's liveness; the concrete session host (`createSessionHost`) is one
 * implementation, the deterministic replay backend is another.
 */
export interface HostedBackendSeam {
  readonly kind: 'hosted';
  executeTurn(input: Readonly<{
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
  }>): Promise<{
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
  executeTurn(input: Readonly<{ action: RunAction; input: string }>): Promise<{
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
  /**
   * The input the backend turn executes. The executor does not interpret it;
   * it forwards the frozen Action's authored input verbatim.
   */
  readonly turnInput: string;
}

export type ExecutionDispatchResult =
  | (AuthorityValidationResult & { readonly kind: 'rejected' | 'duplicate' })
  | {
      readonly kind: 'authority-unavailable';
      readonly selection: BackendSelection;
    }
  | {
      readonly kind: 'executed';
      readonly backend: ExecutionBackendId;
      readonly selection: BackendSelection;
      readonly outcome: ActionOutcome;
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

  const turn = await backend.executeTurn({
    action: options.grantedAction,
    input: options.turnInput,
    sandbox:
      options.grantedAction.kind === 'agent' &&
      options.grantedAction.agent.sandbox === 'read-only'
        ? 'read-only'
        : 'workspace-write',
    ...(options.grantedAction.kind === 'agent'
      ? {
          authority: {
            invocationId: options.grantedAction.invocationId,
            role: options.grantedAction.agent.role,
            workspaceInstanceId: options.record.workspaceInstanceId,
            backend: 'hosted' as const,
          },
        }
      : {}),
  });
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
