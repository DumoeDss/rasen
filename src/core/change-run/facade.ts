import type {
  AgentTurnInputCandidate,
  ChangeRef,
  ChangeRunControlRequest,
  ChangeRunReceipt,
  ChangeRunView,
  CompleteRunAction,
  ExactChangeRunRef,
  JsonValue,
  LaunchRequestId,
  Digest,
  RunId,
} from './contracts.js';
import type {
  ConsultationContinuationSettlement,
  ConsultationTeacherFailureSettlement,
  ConsultationStepSubmission,
} from './consultation-contracts.js';

export interface RuntimeMutationContext {
  readonly deliveryMode: 'grant' | 'defer';
}

export interface AdmitAgentCandidatesContext {
  /** Agent admission is one atomic admit-and-grant operation. */
  readonly deliveryMode: 'grant';
  /**
   * Trusted driver-owned base-prompt material for an exact quiescent candidate.
   * The callback supplies already-rendered bytes; Action construction computes
   * authority and never accepts a digest or byte length from this boundary.
   */
  readonly resolveAgentTurnInput: (
    candidate: Readonly<AgentTurnInputCandidate>
  ) => string;
  /** Called before mutation so the transport can reject unused manifest entries. */
  readonly finalizeAgentTurnInputs?: () => void;
}

export interface StartChangePipeline {
  readonly change: ChangeRef;
  readonly pipeline: string;
  readonly launchRequestId: LaunchRequestId;
  readonly launchRequestDigest?: Digest;
  readonly inputs?: Readonly<Record<string, JsonValue>>;
  readonly engine?: 'reconciler';
}

export type ResumeChangePipeline = ExactChangeRunRef;

export interface ChangePipelineRuntime {
  start(
    request: StartChangePipeline,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
  resume(
    request: ResumeChangePipeline,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
  admit(
    request: ResumeChangePipeline,
    context: AdmitAgentCandidatesContext
  ): Promise<ChangeRunReceipt>;
  complete(
    request: CompleteRunAction,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
  consult(
    request: ConsultationStepSubmission,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
  settleConsultationContinuation(
    request: ConsultationContinuationSettlement,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
  settleConsultationTeacherFailure(
    request: ConsultationTeacherFailureSettlement,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
  inspect(ref: ExactChangeRunRef): Promise<ChangeRunView>;
  control(
    request: ChangeRunControlRequest,
    context: RuntimeMutationContext
  ): Promise<ChangeRunReceipt>;
}

export type ChangeRunRuntimeErrorCode =
  | 'invalid_run_request'
  | 'input_too_large'
  | 'run_not_found'
  | 'run_store_unavailable'
  | 'run_store_corrupt'
  | 'run_store_too_large'
  | 'plan_integrity'
  | 'launch_request_conflict'
  | 'launch_instance_ambiguous'
  | 'record_version_conflict'
  | 'wait_identity_conflict'
  | 'receipt_conflict'
  | 'candidate_stale'
  | 'workspace-scope-mismatch'
  | 'change_instance_inactive'
  | 'engine_owner_conflict'
  | 'legacy_owner_unknown'
  | 'lock_unavailable';

export class ChangeRunRuntimeError extends Error {
  constructor(
    readonly code: ChangeRunRuntimeErrorCode,
    message: string,
    readonly currentView?: ChangeRunView
  ) {
    super(message);
    this.name = 'ChangeRunRuntimeError';
  }
}

export function exactChangeRunRef(
  change: ChangeRef,
  runId: RunId
): ExactChangeRunRef {
  return Object.freeze({ change: Object.freeze({ ...change }), runId });
}
