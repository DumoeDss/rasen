import { z } from 'zod';

import type {
  ActionId,
  ActorRef,
  AttemptId,
  Digest,
  EvidenceRef,
  InvocationId,
  JsonValue,
  RecordVersion,
  RunAction,
  RunId,
} from '../contracts.js';
import {
  decodeConsultationStepSubmission,
  decodeTeacherConsultationAdvice,
  deriveConsultationId,
  deriveContinuationRequestId,
  digestContinuationInput,
  digestTeacherConsultationAdvice,
  type AgentContinuationGrant,
  type ConsultationContentLimits,
  type ConsultationId,
  type ConsultationQuestion,
  type ConsultationStepSubmission,
  type TeacherConsultationAdvice,
  type TeacherConsultationInvocation,
  type TeacherConsultationResume,
  type TeacherConsultationUnavailable,
} from '../consultation-contracts.js';
import type { RuntimeConsultationBinding } from '../../pipeline-registry/execution-plan-internal.js';
import { canonicalJson, domainDigest } from './identity.js';
import type { CanonicalRunRecord, CommittedAction } from './record.js';

export type ConsultationLifecycleState =
  | 'requested'
  | 'teacher-active'
  | 'advice-committed'
  | 'continuation-granted'
  | 'continued'
  | 'unavailable'
  | 'continuation-outcome-unknown'
  | 'closed';

export interface CommittedConsultationSource {
  readonly actionId: ActionId;
  readonly invocationId: InvocationId;
  readonly attemptId: AttemptId;
  readonly occurrence: number;
  readonly actor: ActorRef;
  readonly model: string;
  readonly runtime: string;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly expectedRecordVersion: RecordVersion;
  readonly resultDigest: Digest;
  readonly question: ConsultationQuestion;
  readonly questionDigest: Digest;
  readonly actorAttestation: EvidenceRef;
  readonly evidence: readonly EvidenceRef[];
}

export interface CommittedConsultationTeacher {
  readonly profilePath: string;
  readonly attemptOrdinal: number;
  readonly actionId?: ActionId;
  readonly invocationId?: InvocationId;
  readonly attemptId?: AttemptId;
  readonly actor?: ActorRef;
  readonly model?: string;
  readonly runtime?: string;
  readonly advice?: TeacherConsultationAdvice;
  readonly adviceDigest?: Digest;
  readonly actorAttestation?: EvidenceRef;
  readonly evidence?: readonly EvidenceRef[];
}

export interface CommittedConsultationContinuation {
  readonly requestId: string;
  readonly expectedRecordVersion: RecordVersion;
  readonly input: TeacherConsultationResume | TeacherConsultationUnavailable;
  readonly inputDigest: Digest;
  readonly state: 'granted' | 'settled' | 'ambiguous';
  readonly resultDigest?: Digest;
}

export interface CommittedConsultation {
  readonly format: 'teacher-consultation/state/1';
  readonly consultationId: ConsultationId;
  readonly ordinal: number;
  readonly state: ConsultationLifecycleState;
  readonly binding: RuntimeConsultationBinding;
  readonly source: CommittedConsultationSource;
  readonly teacher: CommittedConsultationTeacher;
  readonly counters: Readonly<{
    consultations: Readonly<{ used: number; max: number }>;
    teacherAttempts: Readonly<{ used: number; max: number }>;
  }>;
  readonly continuation?: CommittedConsultationContinuation;
  readonly failure?: Readonly<{
    code:
      | 'consultation-limit-exhausted'
      | 'teacher-attempt-limit-exhausted'
      | 'teacher-unavailable'
      | 'continuation-outcome-unknown'
      | 'source-terminal';
    detail?: string;
  }>;
}

const HEX = '[0-9a-f]{64}';
const identity = <Prefix extends string>(prefix: Prefix) =>
  z.string().regex(new RegExp(`^${prefix}:${HEX}$`));
const DigestSchema = z.string().regex(new RegExp(`^sha256:${HEX}$`));
const Positive = z.number().int().positive().safe();
const UuidShape = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const CommittedConsultationZodSchema = z.strictObject({
  format: z.literal('teacher-consultation/state/1'),
  consultationId: identity('consultation'),
  ordinal: Positive,
  state: z.enum([
    'requested',
    'teacher-active',
    'advice-committed',
    'continuation-granted',
    'continued',
    'unavailable',
    'continuation-outcome-unknown',
    'closed',
  ]),
  binding: z.unknown(),
  source: z.strictObject({
    actionId: identity('action'),
    invocationId: identity('invocation'),
    attemptId: identity('attempt'),
    occurrence: z.number().int().nonnegative().safe(),
    actor: z.unknown(),
    model: z.string().min(1).max(256),
    runtime: z.string().min(1).max(128),
    stableSessionId: UuidShape,
    requestId: UuidShape,
    expectedRecordVersion: z.number().int().nonnegative().safe(),
    resultDigest: DigestSchema,
    question: z.unknown(),
    questionDigest: DigestSchema,
    actorAttestation: z.unknown(),
    evidence: z.array(z.unknown()).max(64),
  }),
  teacher: z.strictObject({
    profilePath: z.string().min(1).max(1024),
    attemptOrdinal: z.number().int().nonnegative().safe(),
    actionId: identity('action').optional(),
    invocationId: identity('invocation').optional(),
    attemptId: identity('attempt').optional(),
    actor: z.unknown().optional(),
    model: z.string().min(1).max(256).optional(),
    runtime: z.string().min(1).max(128).optional(),
    advice: z.unknown().optional(),
    adviceDigest: DigestSchema.optional(),
    actorAttestation: z.unknown().optional(),
    evidence: z.array(z.unknown()).max(64).optional(),
  }),
  counters: z.strictObject({
    consultations: z.strictObject({ used: z.number().int().nonnegative().safe(), max: Positive }),
    teacherAttempts: z.strictObject({ used: z.number().int().nonnegative().safe(), max: Positive }),
  }),
  continuation: z
    .strictObject({
      requestId: UuidShape,
      expectedRecordVersion: z.number().int().nonnegative().safe(),
      input: z.unknown(),
      inputDigest: DigestSchema,
      state: z.enum(['granted', 'settled', 'ambiguous']),
      resultDigest: DigestSchema.optional(),
    })
    .optional(),
  failure: z
    .strictObject({
      code: z.enum([
        'consultation-limit-exhausted',
        'teacher-attempt-limit-exhausted',
        'teacher-unavailable',
        'continuation-outcome-unknown',
        'source-terminal',
      ]),
      detail: z.string().min(1).max(4096).optional(),
    })
    .optional(),
});

export type ConsultationRequestClassification =
  | Readonly<{ kind: 'new'; consultation: CommittedConsultation }>
  | Readonly<{ kind: 'duplicate'; consultation: CommittedConsultation }>
  | Readonly<{ kind: 'conflict'; message: string }>
  | Readonly<{ kind: 'budget-exhausted'; consultation: CommittedConsultation }>;

function sourceOccurrence(record: CanonicalRunRecord, action: CommittedAction): number {
  const seen: string[] = [];
  for (const transition of record.transitions) {
    if (transition.kind !== 'ActionAdmitted') continue;
    const candidate = record.actions[transition.actionId];
    if (
      candidate !== undefined &&
      candidate.action.nodeId === action.action.nodeId &&
      !seen.includes(candidate.action.invocationId)
    ) {
      seen.push(candidate.action.invocationId);
    }
  }
  return Math.max(0, seen.indexOf(action.action.invocationId));
}

function sourceConsultations(
  record: CanonicalRunRecord,
  action: RunAction
): readonly CommittedConsultation[] {
  return Object.values(record.consultations ?? {}).filter(
    (entry) => entry.source.invocationId === action.invocationId
  );
}

function unavailableInput(
  consultationId: ConsultationId,
  reason: TeacherConsultationUnavailable['reason'],
  consultations: { used: number; max: number },
  teacherAttempts: { used: number; max: number },
  detail: string
): TeacherConsultationUnavailable {
  return Object.freeze({
    contract: 'teacher-consultation/unavailable/1',
    consultationId,
    reason,
    consultations,
    teacherAttempts,
    detail,
  });
}

export function classifyConsultationRequest(options: {
  readonly record: CanonicalRunRecord;
  readonly source: CommittedAction;
  readonly binding: RuntimeConsultationBinding;
  readonly submission: ConsultationStepSubmission;
}): ConsultationRequestClassification {
  const { record, source, binding } = options;
  const submission = decodeConsultationStepSubmission(
    options.submission,
    binding.limits
  );
  if (
    submission.runId !== record.runId ||
    submission.actionId !== source.action.actionId ||
    submission.invocationId !== source.action.invocationId
  ) {
    return { kind: 'conflict', message: 'Consultation source authority does not match the canonical Action.' };
  }
  const existingByRequest = Object.values(record.consultations ?? {}).find(
    (entry) => entry.source.requestId === submission.requestId
  );
  const questionDigest = domainDigest('teacher-consultation/question/1', submission.question);
  if (existingByRequest !== undefined) {
    return existingByRequest.source.expectedRecordVersion ===
      submission.expectedRecordVersion &&
      existingByRequest.source.resultDigest === submission.resultDigest &&
      existingByRequest.source.questionDigest === questionDigest &&
      existingByRequest.source.stableSessionId === submission.stableSessionId &&
      canonicalJson(existingByRequest.source.actor) ===
        canonicalJson(submission.actor) &&
      canonicalJson(existingByRequest.source.actorAttestation) ===
        canonicalJson(submission.actorAttestation) &&
      canonicalJson(existingByRequest.source.evidence) ===
        canonicalJson(submission.evidence)
      ? { kind: 'duplicate', consultation: existingByRequest }
      : { kind: 'conflict', message: 'Consultation request identity was reused with different signed evidence, Record version, bytes, or Session attribution.' };
  }
  if (
    source.action.kind !== 'agent' ||
    source.state !== 'active' ||
    source.action.completionAuthority === undefined
  ) {
    return { kind: 'conflict', message: 'Only an active authoritative agent Action may consult.' };
  }

  const prior = sourceConsultations(record, source.action);
  const used = Math.min(prior.length, binding.maxConsultationsPerInvocation);
  const ordinal = used + 1;
  const consultationId = deriveConsultationId(
    record.runId,
    source.action.actionId as ActionId,
    ordinal
  );
  const exhausted = used >= binding.maxConsultationsPerInvocation;
  const actor = source.action.completionAuthority.actor;
  if (JSON.stringify(actor) !== JSON.stringify(submission.actor)) {
    return { kind: 'conflict', message: 'Consultation actor does not match frozen source completion authority.' };
  }
  const base: CommittedConsultation = {
    format: 'teacher-consultation/state/1',
    consultationId,
    ordinal,
    state: exhausted ? 'unavailable' : 'requested',
    binding,
    source: {
      actionId: source.action.actionId as ActionId,
      invocationId: source.action.invocationId as InvocationId,
      attemptId: source.action.attemptId as AttemptId,
      occurrence: sourceOccurrence(record, source),
      actor,
      model: source.action.agent.model,
      runtime: source.action.agent.runtime,
      stableSessionId: submission.stableSessionId,
      requestId: submission.requestId,
      expectedRecordVersion: submission.expectedRecordVersion,
      resultDigest: submission.resultDigest,
      question: submission.question,
      questionDigest,
      actorAttestation: submission.actorAttestation,
      evidence: submission.evidence,
    },
    teacher: {
      profilePath: binding.teacherProfilePath,
      attemptOrdinal: 0,
    },
    counters: {
      consultations: {
        used: exhausted ? binding.maxConsultationsPerInvocation : ordinal,
        max: binding.maxConsultationsPerInvocation,
      },
      teacherAttempts: {
        used: 0,
        max: binding.maxTeacherAttemptsPerConsultation,
      },
    },
    ...(exhausted
      ? {
          failure: {
            code: 'consultation-limit-exhausted' as const,
            detail: 'The frozen per-Invocation consultation limit is exhausted.',
          },
        }
      : {}),
  };
  return exhausted
    ? { kind: 'budget-exhausted', consultation: Object.freeze(base) }
    : { kind: 'new', consultation: Object.freeze(base) };
}

export function teacherInvocationForRun(
  runId: RunId,
  consultation: CommittedConsultation
): TeacherConsultationInvocation {
  return Object.freeze({
    contract: 'teacher-consultation/invocation/1',
    consultationId: consultation.consultationId,
    consultationOrdinal: consultation.ordinal,
    teacherAttempt: consultation.teacher.attemptOrdinal + 1,
    source: {
      runId,
      actionId: consultation.source.actionId,
      invocationId: consultation.source.invocationId,
      attemptId: consultation.source.attemptId,
      occurrence: consultation.source.occurrence,
      stableSessionId: consultation.source.stableSessionId,
    },
    question: consultation.source.question,
    allowedDecisions: ['plan', 'correction', 'stop'] as [
      'plan',
      'correction',
      'stop',
    ],
  });
}

export function linkTeacherAction(
  consultation: CommittedConsultation,
  action: RunAction
): CommittedConsultation {
  if (
    consultation.state !== 'requested' ||
    action.kind !== 'agent' ||
    action.workspace.access === 'write' ||
    action.effects.length !== 0 ||
    action.agent.sandbox !== 'read-only'
  ) {
    throw new Error('Teacher Action violates the frozen read-only consultation authority.');
  }
  return Object.freeze({
    ...consultation,
    state: 'teacher-active',
    teacher: {
      ...consultation.teacher,
      attemptOrdinal: consultation.teacher.attemptOrdinal + 1,
      actionId: action.actionId as ActionId,
      invocationId: action.invocationId as InvocationId,
      attemptId: action.attemptId as AttemptId,
      actor: action.completionAuthority?.actor,
      model: action.agent.model,
      runtime: action.agent.runtime,
    },
    counters: {
      ...consultation.counters,
      teacherAttempts: {
        used: consultation.teacher.attemptOrdinal + 1,
        max: consultation.binding.maxTeacherAttemptsPerConsultation,
      },
    },
  });
}

export function commitTeacherAdvice(options: {
  readonly consultation: CommittedConsultation;
  readonly teacherAction: RunAction;
  readonly result: JsonValue;
  readonly actor: ActorRef;
  readonly actorAttestation: EvidenceRef;
  readonly evidence: readonly EvidenceRef[];
}): CommittedConsultation {
  const { consultation, teacherAction } = options;
  if (
    consultation.state !== 'teacher-active' ||
    consultation.teacher.actionId !== teacherAction.actionId ||
    consultation.teacher.attemptId !== teacherAction.attemptId ||
    teacherAction.completionAuthority === undefined ||
    JSON.stringify(options.actor) !== JSON.stringify(teacherAction.completionAuthority.actor)
  ) {
    throw new Error('Teacher advice authority does not match the active consultation attempt.');
  }
  const advice = decodeTeacherConsultationAdvice(
    options.result,
    consultation.binding.limits
  );
  if (
    advice.consultationId !== consultation.consultationId ||
    advice.teacherAttempt !== consultation.teacher.attemptOrdinal
  ) {
    throw new Error('Teacher advice correlation does not match consultation id and attempt.');
  }
  return Object.freeze({
    ...consultation,
    state: 'advice-committed',
    teacher: {
      ...consultation.teacher,
      advice,
      adviceDigest: digestTeacherConsultationAdvice(advice),
      actorAttestation: options.actorAttestation,
      evidence: options.evidence,
    },
  });
}

export function failTeacherAttempt(
  consultation: CommittedConsultation,
  detail: string
): CommittedConsultation {
  if (consultation.state !== 'teacher-active') {
    throw new Error('Only an active Teacher attempt can fail or retry.');
  }
  const exhausted =
    consultation.counters.teacherAttempts.used >=
    consultation.counters.teacherAttempts.max;
  return Object.freeze({
    ...consultation,
    state: exhausted ? ('unavailable' as const) : ('requested' as const),
    ...(exhausted
      ? {
          failure: {
            code: 'teacher-attempt-limit-exhausted' as const,
            detail,
          },
        }
      : {}),
  });
}

function continuationInputFor(
  consultation: CommittedConsultation
): TeacherConsultationResume | TeacherConsultationUnavailable {
  if (consultation.teacher.advice !== undefined && consultation.teacher.adviceDigest !== undefined) {
    return Object.freeze({
      contract: 'teacher-consultation/resume/1',
      consultationId: consultation.consultationId,
      adviceDigest: consultation.teacher.adviceDigest,
      advice: consultation.teacher.advice,
    });
  }
  return unavailableInput(
    consultation.consultationId,
    consultation.failure?.code === 'teacher-attempt-limit-exhausted'
      ? 'teacher-attempt-limit-exhausted'
      : consultation.failure?.code === 'consultation-limit-exhausted'
        ? 'consultation-limit-exhausted'
        : 'teacher-unavailable',
    consultation.counters.consultations,
    consultation.counters.teacherAttempts,
    consultation.failure?.detail ?? 'Teacher advice is unavailable.'
  );
}

export function grantContinuation(options: {
  readonly record: CanonicalRunRecord;
  readonly consultation: CommittedConsultation;
}): Readonly<{ consultation: CommittedConsultation; grant: AgentContinuationGrant }> {
  const source = options.record.actions[options.consultation.source.actionId];
  if (
    source === undefined ||
    source.state !== 'consultation-paused' ||
    source.action.kind !== 'agent'
  ) {
    throw new Error('Continuation requires the exact canonically paused source Action.');
  }
  const input = continuationInputFor(options.consultation);
  const inputDigest = digestContinuationInput(input);
  const requestId = deriveContinuationRequestId(
    options.consultation.consultationId,
    inputDigest
  );
  const expectedRecordVersion = (options.record.recordVersion + 1) as RecordVersion;
  const continuation: CommittedConsultationContinuation = {
    requestId,
    expectedRecordVersion,
    input,
    inputDigest,
    state: 'granted',
  };
  const consultation = Object.freeze({
    ...options.consultation,
    state: 'continuation-granted' as const,
    continuation,
  });
  const grant: AgentContinuationGrant = Object.freeze({
    format: 'teacher-consultation/continuation-grant/1',
    runId: options.record.runId,
    sourceActionId: source.action.actionId as ActionId,
    sourceInvocationId: source.action.invocationId as InvocationId,
    sourceAttemptId: source.action.attemptId as AttemptId,
    consultationId: consultation.consultationId,
    stableSessionId: consultation.source.stableSessionId,
    requestId,
    expectedRecordVersion,
    backend: 'hosted',
    role: source.action.agent.role,
    workspaceInstanceId: options.record.workspaceInstanceId,
    inputDigest,
    input,
  });
  return Object.freeze({ consultation, grant });
}

export function continuationGrantFromCommitted(
  record: CanonicalRunRecord,
  consultation: CommittedConsultation
): AgentContinuationGrant {
  const source = record.actions[consultation.source.actionId];
  const continuation = consultation.continuation;
  if (
    source === undefined ||
    source.action.kind !== 'agent' ||
    continuation === undefined ||
    (consultation.state !== 'continuation-granted' &&
      consultation.state !== 'continuation-outcome-unknown')
  ) {
    throw new Error('Canonical consultation has no source continuation grant.');
  }
  return Object.freeze({
    format: 'teacher-consultation/continuation-grant/1',
    runId: record.runId,
    sourceActionId: source.action.actionId as ActionId,
    sourceInvocationId: source.action.invocationId as InvocationId,
    sourceAttemptId: source.action.attemptId as AttemptId,
    consultationId: consultation.consultationId,
    stableSessionId: consultation.source.stableSessionId,
    requestId: continuation.requestId as AgentContinuationGrant['requestId'],
    expectedRecordVersion: continuation.expectedRecordVersion,
    backend: 'hosted',
    role: source.action.agent.role,
    workspaceInstanceId: record.workspaceInstanceId,
    inputDigest: continuation.inputDigest,
    input: continuation.input,
  });
}

export function settleContinuation(
  consultation: CommittedConsultation,
  resultDigest: Digest
): CommittedConsultation {
  if (consultation.state !== 'continuation-granted' || consultation.continuation === undefined) {
    throw new Error('Only a granted consultation continuation can settle.');
  }
  return Object.freeze({
    ...consultation,
    state: 'continued',
    continuation: {
      ...consultation.continuation,
      state: 'settled' as const,
      resultDigest,
    },
  });
}

export function markContinuationAmbiguous(
  consultation: CommittedConsultation,
  detail: string
): CommittedConsultation {
  if (consultation.state !== 'continuation-granted' || consultation.continuation === undefined) {
    throw new Error('Only a granted continuation can become ambiguous.');
  }
  return Object.freeze({
    ...consultation,
    state: 'continuation-outcome-unknown',
    continuation: {
      ...consultation.continuation,
      state: 'ambiguous' as const,
    },
    failure: { code: 'continuation-outcome-unknown' as const, detail },
  });
}

export function closeConsultationsForSource(
  consultations: Readonly<Record<string, CommittedConsultation>> | undefined,
  sourceActionId: string,
  detail = 'The source Action reached a terminal state.'
): Readonly<Record<string, CommittedConsultation>> | undefined {
  if (consultations === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(consultations).map(([key, consultation]) => [
      key,
      consultation.source.actionId === sourceActionId &&
      consultation.state !== 'continued' &&
      consultation.state !== 'closed'
        ? {
            ...consultation,
            state: 'closed' as const,
            failure: { code: 'source-terminal' as const, detail },
          }
        : consultation,
    ])
  );
}
