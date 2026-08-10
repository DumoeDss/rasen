import type {
  ChangeRef,
  ChangeRunControlRequest,
  ChangeRunReceipt,
  ChangeRunView,
  CompleteRunAction,
  ExactChangeRunRef,
  JsonValue,
  LaunchRequestId,
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

export interface StartChangePipeline {
  readonly change: ChangeRef;
  readonly pipeline: string;
  readonly launchRequestId: LaunchRequestId;
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
