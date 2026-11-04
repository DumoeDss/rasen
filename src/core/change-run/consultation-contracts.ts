import { z } from 'zod';

import {
  decodeActorRef,
  decodeCompletion,
  decodeEvidenceRef,
  type ActionId,
  type ActorRef,
  type AttemptId,
  type CompleteRunAction,
  type Digest,
  type EvidenceRef,
  type InvocationId,
  type RecordVersion,
  type RunId,
} from './contracts.js';
import { domainDigest } from './internal/identity.js';
import type { HostedTurnReceipt } from '../session-host/contracts.js';

export type ConsultationId = string & { readonly __brand: 'ConsultationId' };
export type ContinuationRequestId = string & {
  readonly __brand: 'ContinuationRequestId';
};

export const CONSULTATION_SERVER_LIMITS = Object.freeze({
  maxQuestionBytes: 64 * 1024,
  maxAdviceBytes: 128 * 1024,
  maxAttemptedApproaches: 32,
  maxConstraints: 32,
  maxEvidencePointers: 64,
  maxAdviceSteps: 64,
  maxCautions: 32,
  maxEvidenceNotes: 64,
  maxConsultationsPerInvocation: 64,
  maxTeacherAttemptsPerConsultation: 16,
} as const);

export interface ConsultationContentLimits {
  readonly maxQuestionBytes: number;
  readonly maxAdviceBytes: number;
  readonly maxAttemptedApproaches: number;
  readonly maxConstraints: number;
  readonly maxEvidencePointers: number;
  readonly maxAdviceSteps: number;
  readonly maxCautions: number;
  readonly maxEvidenceNotes: number;
}

const HEX = '[0-9a-f]{64}';
const SESSION_ID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const identity = <Prefix extends string>(prefix: Prefix) =>
  z.string().regex(new RegExp(`^${prefix}:${HEX}$`));
const DigestSchema = z.string().regex(new RegExp(`^sha256:${HEX}$`));
const SafePositiveSchema = z.number().int().positive().safe();
const SessionIdSchema = z
  .string()
  .regex(new RegExp(SESSION_ID_PATTERN, 'i'));

const BoundedTextSchema = z.string().min(1).max(64 * 1024);
const BoundedItemSchema = z.string().min(1).max(16 * 1024);

export const ConsultationQuestionZodSchema = z.strictObject({
  problemSummary: BoundedTextSchema,
  question: BoundedTextSchema,
  attemptedApproaches: z
    .array(BoundedItemSchema)
    .max(CONSULTATION_SERVER_LIMITS.maxAttemptedApproaches),
  constraints: z
    .array(BoundedItemSchema)
    .max(CONSULTATION_SERVER_LIMITS.maxConstraints),
  evidencePointers: z
    .array(z.string().min(1).max(4096))
    .max(CONSULTATION_SERVER_LIMITS.maxEvidencePointers),
});

export type ConsultationQuestion = Readonly<
  z.infer<typeof ConsultationQuestionZodSchema>
>;

export const TeacherConsultationInvocationZodSchema = z.strictObject({
  contract: z.literal('teacher-consultation/invocation/1'),
  consultationId: identity('consultation'),
  consultationOrdinal: SafePositiveSchema,
  teacherAttempt: SafePositiveSchema,
  source: z.strictObject({
    runId: identity('run'),
    actionId: identity('action'),
    invocationId: identity('invocation'),
    attemptId: identity('attempt'),
    occurrence: z.number().int().nonnegative().safe(),
    stableSessionId: SessionIdSchema,
  }),
  question: ConsultationQuestionZodSchema,
  allowedDecisions: z.tuple([
    z.literal('plan'),
    z.literal('correction'),
    z.literal('stop'),
  ]),
});

export type TeacherConsultationInvocation = Readonly<
  z.infer<typeof TeacherConsultationInvocationZodSchema>
>;

export const TeacherConsultationAdviceZodSchema = z.strictObject({
  contract: z.literal('teacher-consultation/advice/1'),
  consultationId: identity('consultation'),
  teacherAttempt: SafePositiveSchema,
  decision: z.enum(['plan', 'correction', 'stop']),
  rationale: BoundedTextSchema,
  steps: z
    .array(BoundedItemSchema)
    .max(CONSULTATION_SERVER_LIMITS.maxAdviceSteps),
  cautions: z
    .array(BoundedItemSchema)
    .max(CONSULTATION_SERVER_LIMITS.maxCautions),
  evidenceNotes: z
    .array(BoundedItemSchema)
    .max(CONSULTATION_SERVER_LIMITS.maxEvidenceNotes),
});

export type TeacherConsultationAdvice = Readonly<
  z.infer<typeof TeacherConsultationAdviceZodSchema>
>;

export const TeacherConsultationResumeZodSchema = z.strictObject({
  contract: z.literal('teacher-consultation/resume/1'),
  consultationId: identity('consultation'),
  adviceDigest: DigestSchema,
  advice: TeacherConsultationAdviceZodSchema,
});

export type TeacherConsultationResume = Readonly<
  z.infer<typeof TeacherConsultationResumeZodSchema>
>;

export const TeacherConsultationUnavailableZodSchema = z.strictObject({
  contract: z.literal('teacher-consultation/unavailable/1'),
  consultationId: identity('consultation'),
  reason: z.enum([
    'consultation-limit-exhausted',
    'teacher-attempt-limit-exhausted',
    'teacher-unavailable',
  ]),
  consultations: z.strictObject({
    used: z.number().int().nonnegative().safe(),
    max: SafePositiveSchema,
  }),
  teacherAttempts: z.strictObject({
    used: z.number().int().nonnegative().safe(),
    max: SafePositiveSchema,
  }),
  detail: z.string().min(1).max(4096),
});

export const ConsultationStepSubmissionZodSchema = z.strictObject({
  format: z.literal('teacher-consultation/submission/1'),
  runId: identity('run'),
  actionId: identity('action'),
  invocationId: identity('invocation'),
  expectedRecordVersion: z.number().int().nonnegative().safe(),
  stableSessionId: SessionIdSchema,
  requestId: SessionIdSchema,
  resultDigest: DigestSchema,
  question: ConsultationQuestionZodSchema,
  actor: z.unknown(),
  actorAttestation: z.unknown(),
  evidence: z.array(z.unknown()).max(64),
});

export const AgentContinuationGrantZodSchema = z.strictObject({
  format: z.literal('teacher-consultation/continuation-grant/1'),
  runId: identity('run'),
  sourceActionId: identity('action'),
  sourceInvocationId: identity('invocation'),
  sourceAttemptId: identity('attempt'),
  consultationId: identity('consultation'),
  stableSessionId: SessionIdSchema,
  requestId: SessionIdSchema,
  expectedRecordVersion: z.number().int().nonnegative().safe(),
  backend: z.literal('hosted'),
  role: z.string().min(1).max(128),
  workspaceInstanceId: identity('workspace-instance'),
  inputDigest: DigestSchema,
  input: z.union([
    TeacherConsultationResumeZodSchema,
    TeacherConsultationUnavailableZodSchema,
  ]),
});

const HostedTurnReceiptZodSchema = z.strictObject({
  format: z.literal('rasen-session-host-turn-receipt/1'),
  stableSessionId: SessionIdSchema,
  backend: z.string().min(1).max(32),
  backendSessionId: z.string().min(1).max(1024).optional(),
  requestId: SessionIdSchema,
  requestState: z.enum(['prepared', 'sent', 'settled', 'cancelled', 'ambiguous']),
  cwd: z.string().min(1).max(32768),
  cwdDigest: z.string().regex(/^[0-9a-f]{64}$/),
  sandbox: z.enum(['read-only', 'workspace-write']),
  authority: z
    .strictObject({
      invocationId: z.string().min(1).max(256),
      role: z.string().min(1).max(128),
      workspaceInstanceId: z.string().min(1).max(256),
      backend: z.literal('hosted'),
      handoffTokensUsed: z.number().int().nonnegative().safe(),
      reuseRoundsServed: z.number().int().nonnegative().safe(),
    })
    .optional(),
  resultRef: z.string().regex(/^host-result:sha256:[0-9a-f]{64}$/).optional(),
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  result: z.string().max(CONSULTATION_SERVER_LIMITS.maxAdviceBytes).optional(),
  replayed: z.boolean(),
});

export const ConsultationContinuationSettlementZodSchema = z.strictObject({
  format: z.literal('teacher-consultation/continuation-settlement/1'),
  runId: identity('run'),
  sourceActionId: identity('action'),
  consultationId: identity('consultation'),
  requestId: SessionIdSchema,
  expectedRecordVersion: z.number().int().nonnegative().safe(),
  outcome: z.enum(['settled', 'ambiguous']),
  receipt: HostedTurnReceiptZodSchema,
  detail: z.string().min(1).max(4096).optional(),
});

export const ConsultationTeacherFailureSettlementZodSchema = z.strictObject({
  format: z.literal('teacher-consultation/teacher-failure-settlement/1'),
  runId: identity('run'),
  consultationId: identity('consultation'),
  teacherActionId: identity('action'),
  expectedRecordVersion: z.number().int().nonnegative().safe(),
  outcome: z.enum(['authority-unavailable', 'failed', 'uncertain', 'execution-lost']),
  detail: z.string().min(1).max(4096),
  receipt: HostedTurnReceiptZodSchema.optional(),
  recovery: z.unknown().optional(),
});

export type TeacherConsultationUnavailable = Readonly<
  z.infer<typeof TeacherConsultationUnavailableZodSchema>
>;

export type ConsultationContinuationInput =
  | TeacherConsultationResume
  | TeacherConsultationUnavailable;

export interface ConsultationStepSubmission {
  readonly format: 'teacher-consultation/submission/1';
  readonly runId: RunId;
  readonly actionId: ActionId;
  readonly invocationId: InvocationId;
  readonly expectedRecordVersion: RecordVersion;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly resultDigest: Digest;
  readonly question: ConsultationQuestion;
  readonly actor: ActorRef;
  readonly actorAttestation: EvidenceRef;
  readonly evidence: readonly EvidenceRef[];
}

export interface AgentContinuationGrant {
  readonly format: 'teacher-consultation/continuation-grant/1';
  readonly runId: RunId;
  readonly sourceActionId: ActionId;
  readonly sourceInvocationId: InvocationId;
  readonly sourceAttemptId: AttemptId;
  readonly consultationId: ConsultationId;
  readonly stableSessionId: string;
  readonly requestId: ContinuationRequestId;
  readonly expectedRecordVersion: RecordVersion;
  readonly backend: 'hosted';
  readonly role: string;
  readonly workspaceInstanceId: string;
  readonly inputDigest: Digest;
  readonly input: ConsultationContinuationInput;
}

export interface ConsultationContinuationSettlement {
  readonly format: 'teacher-consultation/continuation-settlement/1';
  readonly runId: RunId;
  readonly sourceActionId: ActionId;
  readonly consultationId: ConsultationId;
  readonly requestId: ContinuationRequestId;
  readonly expectedRecordVersion: RecordVersion;
  readonly outcome: 'settled' | 'ambiguous';
  readonly receipt: HostedTurnReceipt;
  readonly detail?: string;
}

export interface ConsultationTeacherFailureSettlement {
  readonly format: 'teacher-consultation/teacher-failure-settlement/1';
  readonly runId: RunId;
  readonly consultationId: ConsultationId;
  readonly teacherActionId: ActionId;
  readonly expectedRecordVersion: RecordVersion;
  readonly outcome: 'authority-unavailable' | 'failed' | 'uncertain' | 'execution-lost';
  readonly detail: string;
  readonly receipt?: HostedTurnReceipt;
  /**
   * Adapter-attested infrastructure observation used only when a dead hosted
   * generation cannot supply a SessionHost receipt. The facade verifies this
   * against the exact active Teacher Action before mutating the Record.
   */
  readonly recovery?: CompleteRunAction;
}

export const CONSULTATION_QUESTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    problemSummary: { type: 'string', minLength: 1, maxLength: 65536 },
    question: { type: 'string', minLength: 1, maxLength: 65536 },
    attemptedApproaches: {
      type: 'array',
      maxItems: CONSULTATION_SERVER_LIMITS.maxAttemptedApproaches,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
    constraints: {
      type: 'array',
      maxItems: CONSULTATION_SERVER_LIMITS.maxConstraints,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
    evidencePointers: {
      type: 'array',
      maxItems: CONSULTATION_SERVER_LIMITS.maxEvidencePointers,
      items: { type: 'string', minLength: 1, maxLength: 4096 },
    },
  },
  required: [
    'problemSummary',
    'question',
    'attemptedApproaches',
    'constraints',
    'evidencePointers',
  ],
  additionalProperties: false,
} as const;

export const TEACHER_INVOCATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    contract: { const: 'teacher-consultation/invocation/1' },
    consultationId: { type: 'string', pattern: `^consultation:${HEX}$` },
    consultationOrdinal: { type: 'integer', minimum: 1 },
    teacherAttempt: { type: 'integer', minimum: 1 },
    source: {
      type: 'object',
      properties: {
        runId: { type: 'string', pattern: `^run:${HEX}$` },
        actionId: { type: 'string', pattern: `^action:${HEX}$` },
        invocationId: { type: 'string', pattern: `^invocation:${HEX}$` },
        attemptId: { type: 'string', pattern: `^attempt:${HEX}$` },
        occurrence: { type: 'integer', minimum: 0 },
        stableSessionId: { type: 'string', pattern: SESSION_ID_PATTERN },
      },
      required: [
        'runId',
        'actionId',
        'invocationId',
        'attemptId',
        'occurrence',
        'stableSessionId',
      ],
      additionalProperties: false,
    },
    question: CONSULTATION_QUESTION_JSON_SCHEMA,
    allowedDecisions: {
      type: 'array',
      prefixItems: [
        { const: 'plan' },
        { const: 'correction' },
        { const: 'stop' },
      ],
      minItems: 3,
      maxItems: 3,
    },
  },
  required: [
    'contract',
    'consultationId',
    'consultationOrdinal',
    'teacherAttempt',
    'source',
    'question',
    'allowedDecisions',
  ],
  additionalProperties: false,
} as const;

export const TEACHER_ADVICE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    contract: { const: 'teacher-consultation/advice/1' },
    consultationId: { type: 'string', pattern: `^consultation:${HEX}$` },
    teacherAttempt: { type: 'integer', minimum: 1 },
    decision: { type: 'string', enum: ['plan', 'correction', 'stop'] },
    rationale: { type: 'string', minLength: 1, maxLength: 65536 },
    steps: {
      type: 'array',
      maxItems: CONSULTATION_SERVER_LIMITS.maxAdviceSteps,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
    cautions: {
      type: 'array',
      maxItems: CONSULTATION_SERVER_LIMITS.maxCautions,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
    evidenceNotes: {
      type: 'array',
      maxItems: CONSULTATION_SERVER_LIMITS.maxEvidenceNotes,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
  },
  required: [
    'contract',
    'consultationId',
    'teacherAttempt',
    'decision',
    'rationale',
    'steps',
    'cautions',
    'evidenceNotes',
  ],
  additionalProperties: false,
} as const;

export const TEACHER_RESUME_JSON_SCHEMA = {
  type: 'object',
  properties: {
    contract: { const: 'teacher-consultation/resume/1' },
    consultationId: { type: 'string', pattern: `^consultation:${HEX}$` },
    adviceDigest: { type: 'string', pattern: `^sha256:${HEX}$` },
    advice: TEACHER_ADVICE_JSON_SCHEMA,
  },
  required: ['contract', 'consultationId', 'adviceDigest', 'advice'],
  additionalProperties: false,
} as const;

export const TEACHER_UNAVAILABLE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    contract: { const: 'teacher-consultation/unavailable/1' },
    consultationId: { type: 'string', pattern: `^consultation:${HEX}$` },
    reason: {
      type: 'string',
      enum: [
        'consultation-limit-exhausted',
        'teacher-attempt-limit-exhausted',
        'teacher-unavailable',
      ],
    },
    consultations: {
      type: 'object',
      properties: {
        used: { type: 'integer', minimum: 0 },
        max: { type: 'integer', minimum: 1 },
      },
      required: ['used', 'max'],
      additionalProperties: false,
    },
    teacherAttempts: {
      type: 'object',
      properties: {
        used: { type: 'integer', minimum: 0 },
        max: { type: 'integer', minimum: 1 },
      },
      required: ['used', 'max'],
      additionalProperties: false,
    },
    detail: { type: 'string', minLength: 1, maxLength: 4096 },
  },
  required: [
    'contract',
    'consultationId',
    'reason',
    'consultations',
    'teacherAttempts',
    'detail',
  ],
  additionalProperties: false,
} as const;

export const CONSULTATION_STEP_SUBMISSION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    format: { const: 'teacher-consultation/submission/1' },
    runId: { type: 'string', pattern: `^run:${HEX}$` },
    actionId: { type: 'string', pattern: `^action:${HEX}$` },
    invocationId: { type: 'string', pattern: `^invocation:${HEX}$` },
    expectedRecordVersion: { type: 'integer', minimum: 0 },
    stableSessionId: { type: 'string', pattern: SESSION_ID_PATTERN },
    requestId: { type: 'string', pattern: SESSION_ID_PATTERN },
    resultDigest: { type: 'string', pattern: `^sha256:${HEX}$` },
    question: CONSULTATION_QUESTION_JSON_SCHEMA,
    actor: { type: 'object' },
    actorAttestation: { type: 'object' },
    evidence: { type: 'array', maxItems: 64, items: { type: 'object' } },
  },
  required: [
    'format',
    'runId',
    'actionId',
    'invocationId',
    'expectedRecordVersion',
    'stableSessionId',
    'requestId',
    'resultDigest',
    'question',
    'actor',
    'actorAttestation',
    'evidence',
  ],
  additionalProperties: false,
} as const;

export const AGENT_CONTINUATION_GRANT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    format: { const: 'teacher-consultation/continuation-grant/1' },
    runId: { type: 'string', pattern: `^run:${HEX}$` },
    sourceActionId: { type: 'string', pattern: `^action:${HEX}$` },
    sourceInvocationId: { type: 'string', pattern: `^invocation:${HEX}$` },
    sourceAttemptId: { type: 'string', pattern: `^attempt:${HEX}$` },
    consultationId: { type: 'string', pattern: `^consultation:${HEX}$` },
    stableSessionId: { type: 'string', pattern: SESSION_ID_PATTERN },
    requestId: { type: 'string', pattern: SESSION_ID_PATTERN },
    expectedRecordVersion: { type: 'integer', minimum: 0 },
    backend: { const: 'hosted' },
    role: { type: 'string', minLength: 1, maxLength: 128 },
    workspaceInstanceId: {
      type: 'string',
      pattern: `^workspace-instance:${HEX}$`,
    },
    inputDigest: { type: 'string', pattern: `^sha256:${HEX}$` },
    input: { oneOf: [TEACHER_RESUME_JSON_SCHEMA, TEACHER_UNAVAILABLE_JSON_SCHEMA] },
  },
  required: [
    'format',
    'runId',
    'sourceActionId',
    'sourceInvocationId',
    'sourceAttemptId',
    'consultationId',
    'stableSessionId',
    'requestId',
    'expectedRecordVersion',
    'backend',
    'role',
    'workspaceInstanceId',
    'inputDigest',
    'input',
  ],
  additionalProperties: false,
} as const;

export const CONSULTATION_CONTINUATION_SETTLEMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    format: { const: 'teacher-consultation/continuation-settlement/1' },
    runId: { type: 'string', pattern: `^run:${HEX}$` },
    sourceActionId: { type: 'string', pattern: `^action:${HEX}$` },
    consultationId: { type: 'string', pattern: `^consultation:${HEX}$` },
    requestId: { type: 'string', pattern: SESSION_ID_PATTERN },
    expectedRecordVersion: { type: 'integer', minimum: 0 },
    outcome: { type: 'string', enum: ['settled', 'ambiguous'] },
    receipt: {
      type: 'object',
      properties: {
        format: { const: 'rasen-session-host-turn-receipt/1' },
        stableSessionId: { type: 'string', pattern: SESSION_ID_PATTERN },
        backend: { type: 'string', minLength: 1, maxLength: 32 },
        backendSessionId: { type: 'string', minLength: 1, maxLength: 1024 },
        requestId: { type: 'string', pattern: SESSION_ID_PATTERN },
        requestState: {
          type: 'string',
          enum: ['prepared', 'sent', 'settled', 'cancelled', 'ambiguous'],
        },
        cwd: { type: 'string', minLength: 1, maxLength: 32768 },
        cwdDigest: { type: 'string', pattern: `^${HEX}$` },
        sandbox: { type: 'string', enum: ['read-only', 'workspace-write'] },
        authority: { type: 'object' },
        resultRef: { type: 'string', pattern: `^host-result:sha256:${HEX}$` },
        resultDigest: { type: 'string', pattern: `^${HEX}$` },
        result: { type: 'string', maxLength: CONSULTATION_SERVER_LIMITS.maxAdviceBytes },
        replayed: { type: 'boolean' },
      },
      required: [
        'format',
        'stableSessionId',
        'backend',
        'requestId',
        'requestState',
        'cwd',
        'cwdDigest',
        'sandbox',
        'replayed',
      ],
      additionalProperties: false,
    },
    detail: { type: 'string', minLength: 1, maxLength: 4096 },
  },
  required: [
    'format',
    'runId',
    'sourceActionId',
    'consultationId',
    'requestId',
    'expectedRecordVersion',
    'outcome',
    'receipt',
  ],
  additionalProperties: false,
} as const;

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function bounded<T>(
  value: unknown,
  schema: z.ZodType<T>,
  maxBytes: number,
  label: string
): Readonly<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${label} is invalid: ${parsed.error.issues
        .map((issue) => `/${issue.path.join('/')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  if (bytes(parsed.data) > maxBytes) {
    throw new Error(`${label} exceeds its frozen UTF-8 byte bound.`);
  }
  return Object.freeze(parsed.data as T);
}

export function decodeConsultationQuestion(
  value: unknown,
  limits: ConsultationContentLimits
): ConsultationQuestion {
  const question = bounded(
    value,
    ConsultationQuestionZodSchema,
    limits.maxQuestionBytes,
    'Consultation question'
  );
  if (
    question.attemptedApproaches.length > limits.maxAttemptedApproaches ||
    question.constraints.length > limits.maxConstraints ||
    question.evidencePointers.length > limits.maxEvidencePointers
  ) {
    throw new Error('Consultation question exceeds its frozen collection bounds.');
  }
  return question;
}

export function decodeTeacherConsultationInvocation(
  value: unknown,
  limits: ConsultationContentLimits
): TeacherConsultationInvocation {
  const invocation = TeacherConsultationInvocationZodSchema.parse(value);
  decodeConsultationQuestion(invocation.question, limits);
  return Object.freeze(invocation);
}

export function decodeTeacherConsultationAdvice(
  value: unknown,
  limits: ConsultationContentLimits
): TeacherConsultationAdvice {
  const advice = bounded(
    value,
    TeacherConsultationAdviceZodSchema,
    limits.maxAdviceBytes,
    'Teacher advice'
  );
  if (
    advice.steps.length > limits.maxAdviceSteps ||
    advice.cautions.length > limits.maxCautions ||
    advice.evidenceNotes.length > limits.maxEvidenceNotes
  ) {
    throw new Error('Teacher advice exceeds its frozen collection bounds.');
  }
  return advice;
}

export function decodeTeacherConsultationResume(
  value: unknown,
  limits: ConsultationContentLimits
): TeacherConsultationResume {
  const resume = TeacherConsultationResumeZodSchema.parse(value);
  const advice = decodeTeacherConsultationAdvice(resume.advice, limits);
  if (
    resume.consultationId !== advice.consultationId ||
    resume.adviceDigest !== digestTeacherConsultationAdvice(advice)
  ) {
    throw new Error('Teacher resume correlation or advice digest is invalid.');
  }
  return Object.freeze({ ...resume, advice });
}

export function decodeTeacherConsultationUnavailable(
  value: unknown
): TeacherConsultationUnavailable {
  return Object.freeze(TeacherConsultationUnavailableZodSchema.parse(value));
}

export function decodeConsultationStepSubmission(
  value: unknown,
  limits: ConsultationContentLimits
): ConsultationStepSubmission {
  const parsed = ConsultationStepSubmissionZodSchema.parse(value);
  const question = decodeConsultationQuestion(parsed.question, limits);
  return Object.freeze({
    ...parsed,
    runId: parsed.runId as RunId,
    actionId: parsed.actionId as ActionId,
    invocationId: parsed.invocationId as InvocationId,
    expectedRecordVersion: parsed.expectedRecordVersion as RecordVersion,
    resultDigest: parsed.resultDigest as Digest,
    question,
    actor: decodeActorRef(parsed.actor),
    actorAttestation: decodeEvidenceRef(parsed.actorAttestation),
    evidence: Object.freeze(parsed.evidence.map((item) => decodeEvidenceRef(item))),
  });
}

export function decodeAgentContinuationGrant(
  value: unknown,
  limits: ConsultationContentLimits
): AgentContinuationGrant {
  const parsed = AgentContinuationGrantZodSchema.parse(value);
  const input =
    parsed.input.contract === 'teacher-consultation/resume/1'
      ? decodeTeacherConsultationResume(parsed.input, limits)
      : decodeTeacherConsultationUnavailable(parsed.input);
  const inputDigest = digestContinuationInput(input);
  if (
    parsed.consultationId !== input.consultationId ||
    parsed.inputDigest !== inputDigest ||
    parsed.requestId !==
      deriveContinuationRequestId(
        parsed.consultationId as ConsultationId,
        inputDigest
      )
  ) {
    throw new Error(
      'Continuation grant correlation, input digest, or request identity is invalid.'
    );
  }
  return Object.freeze({
    ...parsed,
    runId: parsed.runId as RunId,
    sourceActionId: parsed.sourceActionId as ActionId,
    sourceInvocationId: parsed.sourceInvocationId as InvocationId,
    sourceAttemptId: parsed.sourceAttemptId as AttemptId,
    consultationId: parsed.consultationId as ConsultationId,
    requestId: parsed.requestId as ContinuationRequestId,
    expectedRecordVersion: parsed.expectedRecordVersion as RecordVersion,
    inputDigest,
    input,
  });
}

export function decodeConsultationContinuationSettlement(
  value: unknown
): ConsultationContinuationSettlement {
  const parsed = ConsultationContinuationSettlementZodSchema.parse(value);
  if (parsed.outcome === 'settled' && parsed.detail !== undefined) {
    throw new Error('Settled consultation continuation cannot claim ambiguous detail.');
  }
  if (
    parsed.outcome === 'settled' &&
    (parsed.receipt.requestState !== 'settled' ||
      parsed.receipt.result === undefined ||
      parsed.receipt.resultRef === undefined ||
      parsed.receipt.resultDigest === undefined)
  ) {
    throw new Error('Settled consultation continuation requires a complete settled hosted receipt.');
  }
  if (
    parsed.outcome === 'ambiguous' &&
    !['sent', 'ambiguous'].includes(parsed.receipt.requestState)
  ) {
    throw new Error('Ambiguous continuation requires a sent or ambiguous hosted receipt.');
  }
  return Object.freeze({
    ...parsed,
    runId: parsed.runId as RunId,
    sourceActionId: parsed.sourceActionId as ActionId,
    consultationId: parsed.consultationId as ConsultationId,
    requestId: parsed.requestId as ContinuationRequestId,
    expectedRecordVersion: parsed.expectedRecordVersion as RecordVersion,
    receipt: parsed.receipt as HostedTurnReceipt,
  });
}

export function decodeConsultationTeacherFailureSettlement(
  value: unknown
): ConsultationTeacherFailureSettlement {
  const parsed = ConsultationTeacherFailureSettlementZodSchema.parse(value);
  if (
    parsed.outcome === 'authority-unavailable' &&
    (parsed.receipt !== undefined || parsed.recovery !== undefined)
  ) {
    throw new Error(
      'Authority-unavailable is a pre-dispatch failure and cannot claim hosted execution evidence.'
    );
  }
  if (
    parsed.outcome !== 'authority-unavailable' &&
    parsed.receipt === undefined &&
    parsed.recovery === undefined
  ) {
    throw new Error(
      'A dispatched Teacher failure requires a hosted receipt or an adapter-attested recovery fact.'
    );
  }
  if (parsed.recovery !== undefined && parsed.outcome !== 'execution-lost') {
    throw new Error(
      'Only receiptless execution-lost may use an adapter-attested recovery fact.'
    );
  }
  if (parsed.recovery !== undefined && parsed.receipt !== undefined) {
    throw new Error(
      'Teacher failure settlement must use one execution proof, not both receipt and recovery.'
    );
  }
  const recovery =
    parsed.recovery === undefined ? undefined : decodeCompletion(parsed.recovery);
  if (
    recovery !== undefined &&
    (recovery.kind !== 'infrastructure-observation' ||
      recovery.status !== 'infrastructure_failed' ||
      recovery.error.code !== 'teacher-execution-lost')
  ) {
    throw new Error(
      'Receiptless execution-lost requires the canonical Teacher execution-loss observation.'
    );
  }
  const {
    recovery: _untrustedRecovery,
    receipt: _untrustedReceipt,
    ...settlement
  } = parsed;
  return Object.freeze({
    ...settlement,
    runId: parsed.runId as RunId,
    consultationId: parsed.consultationId as ConsultationId,
    teacherActionId: parsed.teacherActionId as ActionId,
    expectedRecordVersion: parsed.expectedRecordVersion as RecordVersion,
    ...(parsed.receipt === undefined
      ? {}
      : { receipt: parsed.receipt as HostedTurnReceipt }),
    ...(recovery === undefined ? {} : { recovery }),
  });
}

export function deriveConsultationId(
  runId: RunId,
  sourceActionId: ActionId,
  consultationOrdinal: number
): ConsultationId {
  if (!Number.isSafeInteger(consultationOrdinal) || consultationOrdinal <= 0) {
    throw new Error('Consultation ordinal must be a positive safe integer.');
  }
  return `consultation:${domainDigest(
    'teacher-consultation/id/1',
    runId,
    sourceActionId,
    consultationOrdinal
  ).slice('sha256:'.length)}` as ConsultationId;
}

function uuidFromDigest(digest: Digest): ContinuationRequestId {
  const hex = digest.slice('sha256:'.length);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as ContinuationRequestId;
}

export function deriveFreshStepRequestId(
  runId: RunId,
  actionId: ActionId,
  attemptId: AttemptId
): ContinuationRequestId {
  return uuidFromDigest(
    domainDigest('teacher-consultation/fresh-step-request/1', runId, actionId, attemptId)
  );
}

export function deriveContinuationRequestId(
  consultationId: ConsultationId,
  inputDigest: Digest
): ContinuationRequestId {
  return uuidFromDigest(
    domainDigest(
      'teacher-consultation/continuation-request/1',
      consultationId,
      inputDigest
    )
  );
}

export function digestTeacherConsultationAdvice(
  advice: TeacherConsultationAdvice
): Digest {
  return domainDigest('teacher-consultation/advice/1', advice);
}

export function digestContinuationInput(
  input: ConsultationContinuationInput
): Digest {
  return domainDigest('teacher-consultation/continuation-input/1', input);
}
