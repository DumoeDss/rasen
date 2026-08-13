/**
 * Server-owned CONSULT -> Teacher -> exact source continuation driver.
 *
 * The driver consumes only canonical facade receipts. It never asks a LEAD or
 * HTTP caller to select a Teacher, relay advice, supply a source Action, or
 * assert a hosted result digest. Provider signing remains an injected trusted
 * Adapter capability because private attestation keys are deliberately not
 * persisted in the public execution profile.
 */
import type {
  ChangeRunReceipt,
  ExactChangeRunRef,
  RunAction,
} from '../change-run/contracts.js';
import type { RuntimeContext } from '../change-run/internal/runtime-context.js';
import type { TrustedCompletionProducer } from '../change-run/internal/trusted-completion-producer.js';
import { canonicalJson } from '../change-run/internal/identity.js';
import { parseConsultableLeafReturn } from '../worker-contracts.js';
import {
  deriveFreshStepRequestId,
  type AgentContinuationGrant,
} from '../change-run/consultation-contracts.js';
import type { ExecutionDispatchResult } from './executor.js';
import type { ProductionExecutor } from './production-executor.js';
import type { ExactTeacherAttemptModule } from './exact-teacher-attempt-module.js';

export type TrustedCompletionProducerResolver = (
  action: RunAction
) => TrustedCompletionProducer | Promise<TrustedCompletionProducer>;

export interface ProductionConsultationDriverOptions {
  readonly runRef: ExactChangeRunRef;
  readonly runtime: RuntimeContext;
  readonly executor: ProductionExecutor;
  readonly producerFor: TrustedCompletionProducerResolver;
  readonly exactTeacherAttemptModule?: ExactTeacherAttemptModule;
  readonly maxCanonicalSteps?: number;
}

export interface ProductionConsultationDriveResult {
  readonly initial: ExecutionDispatchResult;
  readonly finalReceipt?: ChangeRunReceipt;
  readonly dispatches: readonly ExecutionDispatchResult[];
  readonly retainedAuthority?: ExactTeacherRetainedWaitSummary;
}

export interface ProductionConsultationContinuationDriveResult {
  readonly finalReceipt?: ChangeRunReceipt;
  readonly dispatches: readonly ExecutionDispatchResult[];
  readonly retainedAuthority?: ExactTeacherRetainedWaitSummary;
}

export type ExactTeacherRetainedWaitReason =
  | 'authority-reconciliation-required'
  | 'authority-identity-mismatch'
  | 'durable-state-unavailable'
  | 'request-outcome-unknown';

/** Bounded operator hint only; it carries no process-control authority. */
export interface ExactTeacherRetainedWaitSummary {
  readonly state: 'authority-retained';
  readonly reason: ExactTeacherRetainedWaitReason;
}

export function summarizeExactTeacherRetainedWait(
  reason: string
): ExactTeacherRetainedWaitSummary {
  const category: ExactTeacherRetainedWaitReason =
    /identity|mismatch|foreign|stale|event-gap|journal-malformed|frontier|crossed/u.test(reason)
      ? 'authority-identity-mismatch'
      : /durable|session-unavailable|state-lost|step-bound/u.test(reason)
        ? 'durable-state-unavailable'
        : /request|turn-outcome|result-incomplete|quarantine/u.test(reason)
          ? 'request-outcome-unknown'
          : 'authority-reconciliation-required';
  return Object.freeze({ state: 'authority-retained', reason: category });
}

function jsonResult(result: string): unknown {
  const value = JSON.parse(result) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hosted worker result must be one structured JSON object.');
  }
  return value;
}

export function createProductionConsultationDriver(
  options: ProductionConsultationDriverOptions
) {
  const maxSteps = options.maxCanonicalSteps ?? 64;
  let steps = 0;
  const dispatches: ExecutionDispatchResult[] = [];
  let retainedAuthority: ExactTeacherRetainedWaitSummary | undefined;

  const nextStep = (): void => {
    steps += 1;
    if (steps > maxSteps) {
      throw new Error('Consultation driver exceeded its server-owned canonical step bound.');
    }
  };

  const loadRecord = () => options.runtime.store.load(options.runtime.plan.runId);

  const dispatchFailureDetail = (result: ExecutionDispatchResult): string => {
    if (result.kind === 'authority-unavailable') {
      return result.selection.kind === 'authority-unavailable'
        ? result.selection.message
        : 'The selected execution authority became unavailable.';
    }
    if (result.kind === 'executed') return result.outcome.message;
    // Routed dispatch carries its reason under `failure`; the input-rejection
    // variants carry a bare `message`. Narrow explicitly so a newly added
    // variant fails to compile here rather than silently losing its reason.
    if (result.kind === 'route-failed') return result.failure.message;
    if ('message' in result && typeof result.message === 'string') {
      return result.message;
    }
    return `Dispatch failed: ${result.kind}`;
  };

  const activeTeacherFor = (action: RunAction) => {
    const record = loadRecord();
    return Object.values(record.consultations ?? {}).find(
      (consultation) =>
        consultation.state === 'teacher-active' &&
        consultation.teacher.actionId === action.actionId
    );
  };

  const settleTeacherFailure = async (
    action: RunAction,
    result: ExecutionDispatchResult,
    detail: string
  ): Promise<ChangeRunReceipt | undefined> => {
    const consultation = activeTeacherFor(action);
    if (consultation === undefined) return undefined;
    const record = loadRecord();
    const outcome =
      result.kind === 'authority-unavailable'
        ? 'authority-unavailable'
        : result.kind === 'executed'
          ? result.outcome.kind === 'execution-lost'
            ? 'execution-lost'
            : result.outcome.kind === 'uncertain'
              ? 'uncertain'
              : 'failed'
          : 'failed';
    const hostedReceipt =
      result.kind === 'executed' ? result.outcome.hostedTurn?.receipt : undefined;
    const recovery =
      outcome === 'execution-lost' && hostedReceipt === undefined
        ? await (async () => {
            const producer = await options.producerFor(action);
            const fact = {
              format: 'teacher-consultation/execution-loss/1',
              runId: record.runId,
              consultationId: consultation.consultationId,
              teacherActionId: action.actionId,
              requestId: deriveFreshStepRequestId(
                record.runId,
                action.actionId as never,
                action.attemptId as never
              ),
              detail,
            } as const;
            const submission = producer.attestCompletion({
              change: options.runRef.change,
              record,
              action,
              completion: {
                kind: 'infrastructure-observation',
                status: 'infrastructure_failed',
                error: {
                  code: 'teacher-execution-lost',
                  retryable: true,
                  // The producer has already been resolved for this exact
                  // frozen Adapter and validates the Action match itself.
                  adapterArtifactDigest: producer.adapter.contentDigest,
                },
              },
              evidenceContent: Buffer.from(canonicalJson(fact), 'utf8'),
            });
            options.runtime.hostEvidenceWriter.publishCompletion(
              submission.completion,
              submission.uploads
            );
            return submission.completion;
          })()
        : undefined;
    return options.runtime.facade.settleConsultationTeacherFailure(
      {
        format: 'teacher-consultation/teacher-failure-settlement/1',
        runId: record.runId,
        consultationId: consultation.consultationId,
        teacherActionId: action.actionId as never,
        expectedRecordVersion: record.recordVersion,
        outcome,
        detail,
        ...(hostedReceipt === undefined ? {} : { receipt: hostedReceipt }),
        ...(recovery === undefined ? {} : { recovery }),
      },
      { deliveryMode: 'grant' }
    );
  };

  const publishCompletion = async (
    action: RunAction,
    status: 'succeeded' | 'failed' | 'blocked',
    result: unknown,
    raw: string
  ): Promise<ChangeRunReceipt> => {
    const record = loadRecord();
    const producer = await options.producerFor(action);
    const submission = producer.attestCompletion({
      change: options.runRef.change,
      record,
      action,
      completion: { kind: 'domain-action-result', status, result },
      evidenceContent: Buffer.from(raw, 'utf8'),
    });
    options.runtime.hostEvidenceWriter.publishCompletion(
      submission.completion,
      submission.uploads
    );
    return options.runtime.facade.complete(submission.completion, {
      deliveryMode: 'grant',
    });
  };

  let driveReceipt: (receipt: ChangeRunReceipt) => Promise<ChangeRunReceipt>;

  const processSettledAction = async (
    action: RunAction,
    dispatch: Extract<ExecutionDispatchResult, { kind: 'executed' }>
  ): Promise<ChangeRunReceipt | undefined> => {
    const hosted = dispatch.outcome.hostedTurn;
    if (
      dispatch.outcome.kind !== 'succeeded' ||
      hosted?.receipt === undefined ||
      hosted.result === undefined ||
      hosted.resultDigest === undefined
    ) {
      const failed = await settleTeacherFailure(
        action,
        dispatch,
        dispatch.outcome.message
      );
      return failed === undefined ? undefined : driveReceipt(failed);
    }

    const teacherConsultation = activeTeacherFor(action);
    if (teacherConsultation !== undefined) {
      let value: unknown;
      try {
        value = jsonResult(hosted.result);
      } catch (error) {
        const failedReceipt = await publishCompletion(
          action,
          'failed',
          { code: 'teacher-result-invalid', detail: String(error) },
          hosted.result
        );
        return driveReceipt(failedReceipt);
      }
      const completed = await publishCompletion(
        action,
        'succeeded',
        value,
        hosted.result
      );
      return driveReceipt(completed);
    }

    if (action.kind !== 'agent' || action.agent.consultation?.eligible !== true) {
      return undefined;
    }
    const parsed = parseConsultableLeafReturn(hosted.result);
    if (parsed.status === 'CONSULT') {
      const record = loadRecord();
      const consultation = record.consultations === undefined
        ? undefined
        : Object.values(record.consultations).find(
            (entry) => entry.source.actionId === action.actionId
          );
      const limits = consultation?.binding.limits ??
        options.runtime.plan.executionProfile?.consultations?.find(
          (binding) =>
            binding.sourceProfilePath === action.agent.consultation?.sourceProfilePath
        )?.limits;
      if (limits === undefined) {
        throw new Error('Frozen source Action has no persisted consultation limits.');
      }
      const producer = await options.producerFor(action);
      const submission = producer.attestConsultation({
        change: options.runRef.change,
        record,
        action,
        result: hosted.result,
        resultDigest: hosted.resultDigest,
        stableSessionId: hosted.stableSessionId,
        requestId: hosted.requestId,
        limits,
      });
      options.runtime.hostEvidenceWriter.publishConsultation(
        submission.consultation,
        submission.uploads
      );
      return driveReceipt(
        await options.runtime.facade.consult(submission.consultation, {
          deliveryMode: 'grant',
        })
      );
    }
    return driveReceipt(
      await publishCompletion(
        action,
        parsed.status === 'DONE' ? 'succeeded' : 'blocked',
        parsed,
        hosted.result
      )
    );
  };

  const dispatchAction = async (action: RunAction): Promise<ChangeRunReceipt | undefined> => {
    nextStep();
    const record = loadRecord();
    const teacherConsultation = activeTeacherFor(action);
    if (teacherConsultation !== undefined && options.exactTeacherAttemptModule !== undefined) {
      const settlement = await options.exactTeacherAttemptModule.executeAndSettle({
        runRef: options.runRef,
        teacherActionId: action.actionId,
        expectedRecordVersion: record.recordVersion,
      });
      if (settlement.state === 'authority-retained') {
        retainedAuthority = summarizeExactTeacherRetainedWait(settlement.reason);
        return undefined;
      }
      return driveReceipt(settlement.receipt);
    }
    const result = await options.executor.dispatch({
      runRef: options.runRef,
      grantedAction: action,
      record,
      expectedRecordVersion: record.recordVersion,
      workspaceRevision: action.expectedBeforeWorkspace,
      requestedBackend: 'hosted',
      turnInput:
        action.kind === 'agent' ? canonicalJson(action.agent.input) : canonicalJson({}),
    });
    dispatches.push(result);
    if (result.kind !== 'executed') {
      const failed = await settleTeacherFailure(
        action,
        result,
        dispatchFailureDetail(result)
      );
      return failed === undefined ? undefined : driveReceipt(failed);
    }
    return processSettledAction(action, result);
  };

  const dispatchContinuation = async (
    grant: AgentContinuationGrant
  ): Promise<ChangeRunReceipt | undefined> => {
    nextStep();
    const record = loadRecord();
    const result = await options.executor.dispatchContinuation({ grant, record });
    dispatches.push(result);
    if (result.kind !== 'executed') return undefined;
    const hosted = result.outcome.hostedTurn;
    if (hosted?.receipt === undefined) return undefined;
    const ambiguous =
      result.outcome.kind === 'execution-lost' ||
      result.outcome.kind === 'uncertain';
    if (
      (!ambiguous && hosted.receipt.requestState !== 'settled') ||
      (ambiguous &&
        hosted.receipt.requestState !== 'sent' &&
        hosted.receipt.requestState !== 'ambiguous')
    ) {
      // A cancelled/prepared continuation remains safely replayable under the
      // same canonical grant. It is neither a settled result nor proof that a
      // sent turn became ambiguous, so do not manufacture a settlement.
      return undefined;
    }
    const settlement = await options.runtime.facade.settleConsultationContinuation(
      {
        format: 'teacher-consultation/continuation-settlement/1',
        runId: record.runId,
        sourceActionId: grant.sourceActionId,
        consultationId: grant.consultationId,
        requestId: grant.requestId,
        expectedRecordVersion: grant.expectedRecordVersion,
        outcome: ambiguous ? 'ambiguous' : 'settled',
        receipt: hosted.receipt,
        ...(ambiguous
          ? { detail: result.outcome.message }
          : {}),
      },
      { deliveryMode: 'grant' }
    );
    if (result.outcome.kind !== 'succeeded') return settlement;
    const source = loadRecord().actions[grant.sourceActionId];
    if (source === undefined) return settlement;
    return (await processSettledAction(source.action, result)) ?? settlement;
  };

  driveReceipt = async (receipt: ChangeRunReceipt): Promise<ChangeRunReceipt> => {
    let latest = receipt;
    for (const action of receipt.actions) {
      latest = (await dispatchAction(action)) ?? latest;
    }
    for (const grant of receipt.continuationGrants ?? []) {
      latest = (await dispatchContinuation(grant)) ?? latest;
    }
    return latest;
  };

  return Object.freeze({
    async driveInitial(
      action: RunAction,
      initial: ExecutionDispatchResult
    ): Promise<ProductionConsultationDriveResult> {
      dispatches.push(initial);
      const finalReceipt =
        initial.kind === 'executed'
          ? await processSettledAction(action, initial)
          : await settleTeacherFailure(
              action,
              initial,
              dispatchFailureDetail(initial)
            );
      return Object.freeze({
        initial,
        ...(finalReceipt === undefined ? {} : { finalReceipt }),
        dispatches: Object.freeze([...dispatches]),
        ...(retainedAuthority === undefined ? {} : { retainedAuthority }),
      });
    },
    async driveContinuation(
      grant: AgentContinuationGrant
    ): Promise<ProductionConsultationContinuationDriveResult> {
      const start = dispatches.length;
      const finalReceipt = await dispatchContinuation(grant);
      return Object.freeze({
        ...(finalReceipt === undefined ? {} : { finalReceipt }),
        dispatches: Object.freeze(dispatches.slice(start)),
        ...(retainedAuthority === undefined ? {} : { retainedAuthority }),
      });
    },
    driveReceipt,
  });
}
