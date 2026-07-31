import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const ACCEPTANCE_V2_SCHEMA = 'rasen-session-cache-acceptance/2';
export const CI_EVIDENCE_SCHEMA = 'rasen-session-cache-ci-evidence/1';
export const OBSERVATION_RESULT_SCHEMA =
  'rasen-session-cache-observation-result/2';
export const OBSERVATION_CHECKPOINT_SCHEMA =
  'rasen-session-cache-observation-checkpoint/2';
export const ATTEMPT_INTENT_SCHEMA =
  'rasen-session-cache-observation-attempt-intent/1';
export const ATTEMPT_SUMMARY_SCHEMA =
  'rasen-session-cache-observation-attempt-summary/1';
export const OBSERVATION_REUSE_SCHEMA =
  'rasen-session-cache-observation-reuse/1';
export const LOCAL_EVIDENCE_SCHEMA =
  'rasen-session-cache-local-evidence/1';

export const SUPPORTED_PIPELINES = Object.freeze([
  'bug-fix',
  'small-feature',
  'full-feature',
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
]);
export const EXPECTED_FAIL_CLOSED_PIPELINES = Object.freeze([
  'auto-decompose',
]);
export const REQUIRED_CI_JOBS = Object.freeze([
  'Test (linux-bash)',
  'Test (linux-bash-node24)',
  'Test (windows-pwsh-shard-1)',
  'Test (windows-pwsh-shard-2)',
  'Test (windows-pwsh-shard-3)',
]);
export const OBSERVATION_ARMS = Object.freeze({
  'control-hit-55m': Object.freeze({
    armId: 'control-hit-55m',
    minimumElapsedMs: 55 * 60 * 1000,
    automaticTouch: false,
    expectedClassification: 'cache_hit',
  }),
  'control-miss-65m': Object.freeze({
    armId: 'control-miss-65m',
    minimumElapsedMs: 65 * 60 * 1000,
    automaticTouch: false,
    expectedClassification: 'cache_miss_or_rewrite',
  }),
  'scheduler-cadence-deadline': Object.freeze({
    armId: 'scheduler-cadence-deadline',
    minimumElapsedMs: 50 * 60 * 1000,
    expectedCadenceMs: 50 * 60 * 1000,
    cadenceToleranceMs: 5 * 60 * 1000,
    deadlineApplicationToleranceMs: 10 * 60 * 1000,
    automaticTouch: true,
    expectedClassification: 'one_touch_then_deadline',
  }),
});
export const ACCEPTANCE_FILENAMES = Object.freeze({
  legacyRun: 'acceptance-run.json',
  runV2: 'acceptance-run-v2.json',
  ci: 'ci-evidence.json',
  attempts: 'attempts',
  history: 'history',
});

const ARM_IDS = Object.freeze(Object.keys(OBSERVATION_ARMS));
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_ATTEMPT_FILES = 4096;
const MAX_LEGACY_ENTRIES = 256;
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{40,64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const RUN_ID = /^run:[a-f0-9]{64}$/u;
const SESSION_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const SCHEDULER_TOUCH_MESSAGE =
  'Keepalive touch. Reply with exactly: OK. Do not use any tools.';
const Timestamp = z.string().datetime({ offset: true });
const Fingerprint = z.string().regex(SHA256);
const SafeText = z.string().min(1).max(512);
const HttpsUrl = z.string().url().refine((value) => {
  const parsed = new URL(value);
  return (
    parsed.protocol === 'https:'
    && parsed.username === ''
    && parsed.password === ''
  );
});

const TouchPolicySchema = z
  .object({
    mode: z.enum(['auto', 'never']),
    deadlineAt: Timestamp.nullable(),
    maxTouches: z.number().int().nonnegative().max(1024),
    deadlineAction: z.enum(['stop', 'retire-silent']),
  })
  .strict();

const CandidateSchema = z
  .object({
    contentFingerprint: Fingerprint,
    binaryFingerprint: Fingerprint,
    repositoryRoot: z.string().min(1).max(32 * 1024),
    createdAt: Timestamp,
    baselineSha: z.string().regex(SHA).nullable().default(null),
    treeOid: z.string().regex(SHA).nullable().default(null),
    deliveryManifestFingerprint: Fingerprint.nullable().default(null),
  })
  .strict();

const ArmIdentitySchema = z
  .object({
    runId: z.string().regex(RUN_ID),
    sessionKey: z.string().regex(SESSION_KEY),
    cwd: z.string().min(1).max(32 * 1024),
    policy: TouchPolicySchema,
  })
  .strict();

const OwnedProcessBindingSchema = z
  .object({
    ownerInstanceId: SafeText,
    ownerPid: z.number().int().positive(),
    ownerProcessCreationIdentity: z.string().min(1).max(512),
    hostId: SafeText,
    childPid: z.number().int().positive(),
    childProcessCreationIdentity: z.string().min(1).max(512),
    boundAt: Timestamp,
  })
  .strict();

const SchedulerTranscriptBaselineSchema = z
  .object({
    claudeSessionId: z.string().min(1).max(512),
    transcriptPathFingerprint: Fingerprint,
    transcriptFileIdentityFingerprint: Fingerprint,
    transcriptSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    transcriptPrefixFingerprint: Fingerprint,
    capturedAt: Timestamp,
  })
  .strict();

const SchedulerPreterminalOwnerProofSchema = z
  .object({
    admissionBindingFingerprint: Fingerprint,
    ownerBindingFingerprint: Fingerprint,
    claudeSessionIdDigest: Fingerprint,
    touchMessageIdDigest: Fingerprint,
    touchOrdinal: z.literal(1),
    touchAttempt: z.number().int().positive().max(1024),
    touchSettledAt: Timestamp,
    observedAt: Timestamp,
  })
  .strict();

const UsageCountersSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cacheCreationInputTokens: z.number().int().nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    cacheReadInputTokens: z.number().int().nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const SchedulerEvidenceSchema = z
  .object({
    eligibilityAt: Timestamp,
    touchAt: Timestamp,
    expectedCadenceMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
    cadenceToleranceMs: z.number().int().positive().max(60 * 60 * 1000),
    deadlineApplicationToleranceMs: z.number().int().positive()
      .max(60 * 60 * 1000),
    transcriptPathFingerprint: Fingerprint,
    transcriptFileIdentityFingerprint: Fingerprint,
    transcriptSizeBefore: z.number().int().nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    transcriptSizeAfter: z.number().int().nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    transcriptAppendedBytes: z.number().int().positive().max(2 * 1024 * 1024),
    transcriptAppendFingerprint: Fingerprint,
    terminalAssistantRows: z.literal(1),
    completedWakeCountSinceBaseline: z.literal(1),
    touchOrdinal: z.literal(1),
    touchAttempt: z.number().int().positive().max(1024),
    touchesUsed: z.literal(1),
    touchMessageIdDigest: Fingerprint,
    touchResultDigest: Fingerprint,
    transcriptTouchTextDigest: Fingerprint,
    transcriptAssistantChainFingerprint: Fingerprint,
    transcriptResultDigest: Fingerprint,
    transcriptTouchAt: Timestamp,
    transcriptAssistantAt: Timestamp,
    transcriptResultAt: Timestamp,
    touchDispatchedAt: Timestamp,
    claudeSessionIdDigest: Fingerprint,
    preterminalOwnerProofFingerprint: Fingerprint,
    terminalLogicalSessionFingerprint: Fingerprint,
    touchTranscriptBindingFingerprint: Fingerprint,
    touchSettledAt: Timestamp,
    deadlineReason: z.literal('touch-deadline-expired'),
    deadlineAction: z.enum(['stop', 'retire-silent']),
    configuredDeadlineAt: Timestamp,
    deadlineAppliedAt: Timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const arm = OBSERVATION_ARMS['scheduler-cadence-deadline'];
    if (
      value.expectedCadenceMs !== arm.expectedCadenceMs
      || value.cadenceToleranceMs !== arm.cadenceToleranceMs
      || value.deadlineApplicationToleranceMs
        !== arm.deadlineApplicationToleranceMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scheduler evidence tolerances must equal OBSERVATION_ARMS',
      });
    }
  });

const ResultProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('observed') }).strict(),
  z
    .object({
      kind: z.literal('reused-copy'),
      sourceAttemptId: z.string().regex(UUID),
      sourceResultFingerprint: Fingerprint,
      copiedAt: Timestamp,
    })
    .strict(),
]);

const ObservationResultSchema = z
  .object({
    schema: z.literal(OBSERVATION_RESULT_SCHEMA),
    attemptId: z.string().regex(UUID),
    candidate: CandidateSchema,
    armId: z.enum(ARM_IDS),
    identity: ArmIdentitySchema,
    admissionBinding: OwnedProcessBindingSchema.nullable().default(null),
    startedAt: Timestamp,
    endedAt: Timestamp,
    elapsedMonotonicMs: z.number().nonnegative().max(24 * 60 * 60 * 1000),
    physicalElapsed: z.boolean(),
    usageCounters: UsageCountersSchema.nullable(),
    touchesObserved: z.number().int().nonnegative().max(16),
    deadlineApplied: z.boolean(),
    schedulerEvidence: SchedulerEvidenceSchema.nullable().default(null),
    classification: z.enum([
      'cache_hit',
      'cache_miss_or_rewrite',
      'one_touch_then_deadline',
      'ambiguous',
    ]),
    disposition: z.enum(['completed', 'inconclusive']),
    reasonCode: z.string().regex(SAFE_CODE).nullable(),
    provenance: ResultProvenanceSchema.default({ kind: 'observed' }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.disposition === 'completed' && !value.physicalElapsed) {
      context.addIssue({
        code: 'custom',
        message: 'Synthetic elapsed time cannot complete a physical observation',
      });
    }
    if (value.disposition === 'inconclusive' && value.reasonCode === null) {
      context.addIssue({
        code: 'custom',
        message: 'Inconclusive observations require a reasonCode',
      });
    }
    if (value.disposition === 'completed' && value.reasonCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Completed observations cannot carry a reasonCode',
      });
    }
    if (
      value.armId === 'scheduler-cadence-deadline'
      && value.disposition === 'completed'
      && value.schedulerEvidence === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completed scheduler observation requires scheduler evidence',
      });
    }
    if (
      value.armId === 'scheduler-cadence-deadline'
      && value.provenance.kind !== 'observed'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scheduler observations must be target-native',
      });
    }
    if (
      value.armId !== 'scheduler-cadence-deadline'
      && value.schedulerEvidence !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Control observations cannot carry scheduler evidence',
      });
    }
    if (value.disposition === 'completed' && value.admissionBinding === null) {
      context.addIssue({
        code: 'custom',
        message: 'Completed physical observations require an admission binding',
      });
    }
  });

const ObservationCheckpointSchema = z
  .object({
    schema: z.literal(OBSERVATION_CHECKPOINT_SCHEMA),
    attemptId: z.string().regex(UUID),
    sequence: z.number().int().positive().max(MAX_ATTEMPT_FILES),
    candidate: CandidateSchema,
    armId: z.enum(ARM_IDS),
    identity: ArmIdentitySchema,
    admissionBinding: OwnedProcessBindingSchema.nullable().default(null),
    schedulerBaseline: SchedulerTranscriptBaselineSchema.nullable().default(null),
    schedulerPreterminalOwnerProof:
      SchedulerPreterminalOwnerProofSchema.nullable().default(null),
    startedAt: Timestamp,
    cadenceToleranceMs: z.number().int().positive()
      .max(60 * 60 * 1000).nullable().default(null),
    deadlineApplicationToleranceMs: z.number().int().positive()
      .max(60 * 60 * 1000).nullable().default(null),
    targetElapsedMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
    elapsedMonotonicMs: z.number().nonnegative().max(24 * 60 * 60 * 1000),
    state: z.enum(['initializing', 'waiting', 'interrupted', 'ready']),
    updatedAt: Timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const scheduler = value.armId === 'scheduler-cadence-deadline';
    const definition = OBSERVATION_ARMS[value.armId];
    if (
      value.targetElapsedMs !== definition.minimumElapsedMs
      || (
        scheduler
        && (
          value.cadenceToleranceMs !== definition.cadenceToleranceMs
          || value.deadlineApplicationToleranceMs
            !== definition.deadlineApplicationToleranceMs
        )
      )
      || (
        !scheduler
        && (
          value.cadenceToleranceMs !== null
          || value.deadlineApplicationToleranceMs !== null
        )
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Checkpoint policy must equal OBSERVATION_ARMS',
      });
    }
    if (
      value.state === 'ready'
      && value.elapsedMonotonicMs < value.targetElapsedMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Ready checkpoint has not reached its target',
      });
    }
    if (
      scheduler
      && value.state !== 'initializing'
      && value.schedulerBaseline === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scheduler checkpoints require the original transcript baseline',
      });
    }
    if (
      !scheduler
      && (
        value.schedulerBaseline !== null
        || value.schedulerPreterminalOwnerProof !== null
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Control checkpoints cannot carry scheduler-only evidence',
      });
    }
    if (
      value.state === 'initializing'
      && (
        value.admissionBinding !== null
        || value.schedulerBaseline !== null
        || value.schedulerPreterminalOwnerProof !== null
        || value.elapsedMonotonicMs !== 0
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Initializing checkpoint must precede bootstrap',
      });
    }
  });

const ObservationPolicySchema = z
  .object({
    armId: z.enum(ARM_IDS),
    minimumElapsedMs: z.number().int().positive(),
    automaticTouch: z.boolean(),
    expectedClassification: z.enum([
      'cache_hit',
      'cache_miss_or_rewrite',
      'one_touch_then_deadline',
    ]),
    expectedCadenceMs: z.number().int().positive().nullable(),
    cadenceToleranceMs: z.number().int().positive().nullable(),
    deadlineApplicationToleranceMs: z.number().int().positive().nullable(),
  })
  .strict();

const LegacyEntrySchema = z
  .object({
    relativePath: z.string().min(1).max(1024),
    kind: z.enum(['file', 'directory']),
    bytes: z.number().int().nonnegative().max(MAX_JSON_BYTES),
  })
  .strict();

const AttemptIntentSchema = z
  .object({
    schema: z.literal(ATTEMPT_INTENT_SCHEMA),
    attemptId: z.string().regex(UUID),
    candidate: CandidateSchema,
    arms: z
      .object({
        'control-hit-55m': ArmIdentitySchema,
        'control-miss-65m': ArmIdentitySchema,
        'scheduler-cadence-deadline': ArmIdentitySchema,
      })
      .strict(),
    observationPolicies: z
      .object({
        'control-hit-55m': ObservationPolicySchema,
        'control-miss-65m': ObservationPolicySchema,
        'scheduler-cadence-deadline': ObservationPolicySchema,
      })
      .strict(),
    legacyHistory: z.array(LegacyEntrySchema).max(MAX_LEGACY_ENTRIES),
    launcher: z
      .object({
        pid: z.number().int().positive(),
        nonce: z.string().uuid(),
      })
      .strict(),
    createdAt: Timestamp,
  })
  .strict();

const AttemptArmSummarySchema = z
  .object({
    armId: z.enum(ARM_IDS),
    disposition: z.enum(['completed', 'inconclusive', 'missing']),
    resultPath: z.string().min(1).max(1024).nullable(),
    resultFingerprint: Fingerprint.nullable(),
  })
  .strict();

const AttemptSummarySchema = z
  .object({
    schema: z.literal(ATTEMPT_SUMMARY_SCHEMA),
    attemptId: z.string().regex(UUID),
    candidate: CandidateSchema,
    intentPath: z.literal('intent.json'),
    status: z.enum(['complete', 'inconclusive', 'incomplete']),
    arms: z
      .object({
        'control-hit-55m': AttemptArmSummarySchema,
        'control-miss-65m': AttemptArmSummarySchema,
        'scheduler-cadence-deadline': AttemptArmSummarySchema,
      })
      .strict(),
    launcherExits: z
      .array(
        z.object({
          armId: z.enum(ARM_IDS),
          code: z.number().int(),
        }).strict()
      )
      .max(ARM_IDS.length),
    settledAt: Timestamp,
  })
  .strict();

const ProductGapSchema = z
  .object({
    caseId: z.string().min(1).max(128),
    owner: z.enum([
      'host-lifecycle',
      'registry-recovery',
      'cli-surface',
      'touch-scheduler',
      'acceptance-evidence',
    ]),
    code: z.string().regex(SAFE_CODE),
    summary: SafeText,
    status: z.literal('open'),
  })
  .strict();

const ArmStateSchema = z
  .object({
    armId: z.enum(ARM_IDS),
    status: z.enum(['completed', 'inconclusive']),
    identity: ArmIdentitySchema,
    admissionBinding: OwnedProcessBindingSchema.nullable(),
    resultPath: z.string().min(1).max(1024),
  })
  .strict();

const AuthorizationSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('awaiting_parent_authorization'),
    remoteMutationAllowed: z.literal(false),
    authorizer: z.null(),
    authorizedAt: z.null(),
    deliveryMode: z.null(),
    frozenTreeFingerprint: z.null(),
  }).strict(),
  z.object({
    state: z.literal('authorized'),
    remoteMutationAllowed: z.literal(true),
    authorizer: SafeText,
    authorizedAt: Timestamp,
    deliveryMode: z.enum(['push', 'pr']),
    frozenTreeFingerprint: Fingerprint,
    frozenTreeOid: z.string().regex(SHA),
    repository: z.string().min(3).max(512),
    githubOrigin: HttpsUrl,
  }).strict(),
  z.object({
    state: z.literal('delivered'),
    remoteMutationAllowed: z.literal(false),
    authorizer: SafeText,
    authorizedAt: Timestamp,
    deliveryMode: z.enum(['push', 'pr']),
    frozenTreeFingerprint: Fingerprint,
    frozenTreeOid: z.string().regex(SHA),
    repository: z.string().min(3).max(512),
    githubOrigin: HttpsUrl,
    deliveredSha: z.string().regex(SHA),
    deliveredAt: Timestamp,
  }).strict(),
]);

const AcceptanceRunV2Schema = z
  .object({
    schema: z.literal(ACCEPTANCE_V2_SCHEMA),
    revision: z.number().int().nonnegative(),
    selectedAttemptId: z.string().regex(UUID),
    selectedAttemptSummaryPath: z.string().min(1).max(1024),
    candidate: CandidateSchema,
    supportedPipelines: z.tuple(SUPPORTED_PIPELINES.map((name) => z.literal(name))),
    expectedFailClosedPipelines: z.tuple(
      EXPECTED_FAIL_CLOSED_PIPELINES.map((name) => z.literal(name))
    ),
    requiredCiJobs: z.tuple(REQUIRED_CI_JOBS.map((name) => z.literal(name))),
    arms: z.object({
      'control-hit-55m': ArmStateSchema,
      'control-miss-65m': ArmStateSchema,
      'scheduler-cadence-deadline': ArmStateSchema,
    }).strict(),
    localEvidence: z.object({
      nativeWindows: z.boolean(),
      injectedPosix: z.boolean(),
      nativeLinux: z.literal(false),
      physicalRetention: z.boolean(),
      recordPath: z.string().min(1).max(1024).nullable(),
      note: z.string().min(1).max(1024),
    }).strict(),
    productGaps: z.array(ProductGapSchema).max(128),
    authorization: AuthorizationSchema,
    ciState: z.enum(['pending', 'successful', 'failed']),
    updatedAt: Timestamp,
  })
  .strict();

const PendingCiEvidenceSchema = z.object({
  schema: z.literal(CI_EVIDENCE_SCHEMA),
  state: z.literal('pending'),
  candidateFingerprint: Fingerprint,
  deliverySha: z.string().regex(SHA).nullable(),
  requiredJobs: z.tuple(REQUIRED_CI_JOBS.map((name) => z.literal(name))),
  workflow: z.null(),
  jobs: z.array(z.never()),
  updatedAt: Timestamp,
}).strict();

const FailedCiEvidenceSchema = z.object({
  schema: z.literal(CI_EVIDENCE_SCHEMA),
  state: z.literal('failed'),
  candidateFingerprint: Fingerprint,
  deliverySha: z.string().regex(SHA),
  requiredJobs: z.tuple(REQUIRED_CI_JOBS.map((name) => z.literal(name))),
  workflow: z.null(),
  jobs: z.array(z.never()),
  reasonCode: z.string().regex(SAFE_CODE),
  updatedAt: Timestamp,
}).strict();

const CiJobSchema = z.object({
  name: z.enum(REQUIRED_CI_JOBS),
  url: HttpsUrl,
  runId: z.string().min(1).max(128),
  runAttempt: z.number().int().positive(),
  runUrl: HttpsUrl,
  apiUrl: HttpsUrl,
  headSha: z.string().regex(SHA),
  repository: z.string().min(3).max(512),
  githubOrigin: HttpsUrl,
  conclusion: z.literal('success'),
}).strict();

const SuccessfulCiEvidenceSchema = z.object({
  schema: z.literal(CI_EVIDENCE_SCHEMA),
  state: z.literal('successful'),
  candidateFingerprint: Fingerprint,
  deliverySha: z.string().regex(SHA),
  requiredJobs: z.tuple(REQUIRED_CI_JOBS.map((name) => z.literal(name))),
  workflow: z.object({
    headSha: z.string().regex(SHA),
    runId: z.string().min(1).max(128),
    runAttempt: z.number().int().positive(),
    url: HttpsUrl,
    apiUrl: HttpsUrl,
    repository: z.string().min(3).max(512),
    githubOrigin: HttpsUrl,
  }).strict(),
  jobs: z.array(CiJobSchema).length(REQUIRED_CI_JOBS.length),
  updatedAt: Timestamp,
}).strict().superRefine((value, context) => {
  if (value.workflow.headSha !== value.deliverySha) {
    context.addIssue({ code: 'custom', message: 'Workflow SHA mismatch' });
  }
  if (value.jobs.some((job, index) => job.name !== REQUIRED_CI_JOBS[index])) {
    context.addIssue({ code: 'custom', message: 'CI job set mismatch' });
  }
  for (const job of value.jobs) {
    if (
      job.runId !== value.workflow.runId
      || job.runAttempt !== value.workflow.runAttempt
      || job.runUrl !== value.workflow.apiUrl
      || job.headSha !== value.workflow.headSha
      || job.repository !== value.workflow.repository
      || job.githubOrigin !== value.workflow.githubOrigin
    ) {
      context.addIssue({ code: 'custom', message: 'CI provenance mismatch' });
    }
  }
});

const CiEvidenceSchema = z.union([
  PendingCiEvidenceSchema,
  FailedCiEvidenceSchema,
  SuccessfulCiEvidenceSchema,
]);

const LocalGateTypeSchema = z.enum([
  'focused-vitest',
  'eslint',
  'node-check',
  'ownership-audit',
  'strict-validation',
]);
const PlatformClaimSchema = z.enum(['native-windows', 'injected-posix']);
const LocalEvidenceLogSchema = z.object({
  gateType: LocalGateTypeSchema,
  platformClaims: z.array(PlatformClaimSchema).max(2),
  allowsEmptyOutput: z.boolean(),
  outputPath: z.string().min(1).max(1024),
  exitCodePath: z.string().min(1).max(1024),
  outputFingerprint: Fingerprint,
  outputBytes: z.number().int().nonnegative().max(MAX_LOG_BYTES),
  exitCodeFingerprint: Fingerprint,
  exitCodeBytes: z.number().int().positive().max(32),
}).strict();
const LocalEvidenceReferenceSchema = z.object({
  gateType: LocalGateTypeSchema,
  platformClaims: z.array(PlatformClaimSchema).max(2),
  allowsEmptyOutput: z.boolean(),
  outputPath: z.string().min(1).max(1024),
  exitCodePath: z.string().min(1).max(1024),
}).strict();
const LocalEvidenceRecordSchema = z.object({
  schema: z.literal(LOCAL_EVIDENCE_SCHEMA),
  candidateFingerprint: Fingerprint,
  gates: z.object({
    focusedVitest: LocalEvidenceLogSchema,
    eslint: LocalEvidenceLogSchema,
    nodeCheck: LocalEvidenceLogSchema,
    ownership: LocalEvidenceLogSchema,
    strictValidation: LocalEvidenceLogSchema,
  }).strict(),
  nativeWindows: z.boolean(),
  injectedPosix: z.boolean(),
  recordedAt: Timestamp,
}).strict().superRefine((value, context) => {
  const claims = new Set(
    Object.values(value.gates).flatMap((gate) => gate.platformClaims)
  );
  if (
    value.nativeWindows !== claims.has('native-windows')
    || value.injectedPosix !== claims.has('injected-posix')
  ) {
    context.addIssue({ code: 'custom', message: 'Local evidence claim mismatch' });
  }
  const expected = {
    focusedVitest: 'focused-vitest',
    eslint: 'eslint',
    nodeCheck: 'node-check',
    ownership: 'ownership-audit',
    strictValidation: 'strict-validation',
  };
  for (const [name, gateType] of Object.entries(expected)) {
    if (value.gates[name].gateType !== gateType) {
      context.addIssue({ code: 'custom', message: `Wrong gate type: ${name}` });
    }
  }
});

function isoNow(clock = () => new Date()) {
  return clock().toISOString();
}

function normalizeCandidate(candidate) {
  return CandidateSchema.parse({
    ...candidate,
    repositoryRoot: path.resolve(candidate.repositoryRoot),
  });
}

function normalizeIdentity(identity) {
  return ArmIdentitySchema.parse({
    ...identity,
    cwd: path.resolve(identity.cwd),
  });
}

function digestJson(value) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function candidatesEqual(left, right) {
  return JSON.stringify(normalizeCandidate(left))
    === JSON.stringify(normalizeCandidate(right));
}

function boundedJson(value, maxBytes = MAX_JSON_BYTES) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    throw new Error(`Evidence document exceeds ${maxBytes} bytes`);
  }
  return body;
}

function assertCanonicalDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || fs.realpathSync.native(resolved) !== resolved
  ) {
    throw new Error('evidence_directory_invalid');
  }
  return resolved;
}

function atomicWriteText(filePath, body, createOnce) {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true });
  assertCanonicalDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, body, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    if (createOnce) {
      fs.linkSync(temporary, resolved);
      fs.unlinkSync(temporary);
    } else {
      fs.renameSync(temporary, resolved);
    }
    try {
      const directoryHandle = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryHandle);
      fs.closeSync(directoryHandle);
    } catch {
      // Windows commonly refuses directory fsync; the file itself is flushed.
    }
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function writeJsonAtomic(filePath, value, maxBytes = MAX_JSON_BYTES) {
  atomicWriteText(filePath, boundedJson(value, maxBytes), false);
}

export function writeJsonCreateOnce(
  filePath,
  value,
  maxBytes = MAX_JSON_BYTES
) {
  try {
    atomicWriteText(filePath, boundedJson(value, maxBytes), true);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`immutable_evidence_already_exists:${path.basename(filePath)}`);
    }
    throw error;
  }
}

function readRegularFileBounded(filePath, maxBytes) {
  const resolved = path.resolve(filePath);
  const flags = fs.constants.O_RDONLY
    | (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);
  let handle;
  try {
    const before = fs.lstatSync(resolved);
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.size > maxBytes
      || fs.realpathSync.native(resolved) !== resolved
    ) {
      throw new Error('bounded_regular_file_invalid');
    }
    handle = fs.openSync(resolved, flags);
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || stat.size !== before.size || stat.size > maxBytes) {
      throw new Error('bounded_regular_file_changed');
    }
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(handle, buffer, offset, buffer.length - offset, offset);
      if (read === 0) throw new Error('bounded_regular_file_changed');
      offset += read;
    }
    const after = fs.fstatSync(handle);
    if (
      after.size !== stat.size
      || after.mtimeMs !== stat.mtimeMs
      || after.ino !== stat.ino
    ) {
      throw new Error('bounded_regular_file_changed');
    }
    return buffer;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

export function readJsonBounded(filePath, maxBytes = MAX_JSON_BYTES) {
  return JSON.parse(readRegularFileBounded(filePath, maxBytes).toString('utf8'));
}

function normalizeAttemptId(attemptId) {
  if (typeof attemptId !== 'string' || !UUID.test(attemptId)) {
    throw new Error('attempt_id_invalid');
  }
  return attemptId;
}

function normalizeArmId(armId) {
  if (!Object.hasOwn(OBSERVATION_ARMS, armId)) {
    throw new Error(`Unknown observation arm: ${armId}`);
  }
  return armId;
}

export function attemptsDirectory(workDir) {
  return path.join(path.resolve(workDir), ACCEPTANCE_FILENAMES.attempts);
}

export function attemptDirectory(workDir, attemptId) {
  return path.join(attemptsDirectory(workDir), normalizeAttemptId(attemptId));
}

export function attemptIntentPath(workDir, attemptId) {
  return path.join(attemptDirectory(workDir, attemptId), 'intent.json');
}

export function attemptSummaryPath(workDir, attemptId) {
  return path.join(attemptDirectory(workDir, attemptId), 'summary.json');
}

export function acceptanceRunV2Path(workDir) {
  return path.join(path.resolve(workDir), ACCEPTANCE_FILENAMES.runV2);
}

export function ciEvidencePath(workDir) {
  return path.join(path.resolve(workDir), ACCEPTANCE_FILENAMES.ci);
}

export function observationDirectory(workDir, attemptId, armId) {
  return path.join(
    attemptDirectory(workDir, attemptId),
    'arms',
    normalizeArmId(armId)
  );
}

export function observationCheckpointDirectory(workDir, attemptId, armId) {
  return path.join(observationDirectory(workDir, attemptId, armId), 'checkpoints');
}

function observationResultPath(workDir, attemptId, armId) {
  return path.join(observationDirectory(workDir, attemptId, armId), 'result.json');
}

function observationPolicy(armId) {
  const definition = OBSERVATION_ARMS[armId];
  return ObservationPolicySchema.parse({
    armId,
    minimumElapsedMs: definition.minimumElapsedMs,
    automaticTouch: definition.automaticTouch,
    expectedClassification: definition.expectedClassification,
    expectedCadenceMs: definition.expectedCadenceMs ?? null,
    cadenceToleranceMs: definition.cadenceToleranceMs ?? null,
    deadlineApplicationToleranceMs:
      definition.deadlineApplicationToleranceMs ?? null,
  });
}

function assertAttemptPolicies(intent) {
  for (const armId of ARM_IDS) {
    if (
      JSON.stringify(intent.observationPolicies[armId])
      !== JSON.stringify(observationPolicy(armId))
    ) {
      throw new Error(`attempt_policy_mismatch:${armId}`);
    }
  }
}

function boundedLegacyWalk(root, relative, entries) {
  if (entries.length >= MAX_LEGACY_ENTRIES) {
    throw new Error('legacy_history_catalog_oversize');
  }
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error('legacy_history_symlink');
  if (stat.isFile()) {
    if (stat.size > MAX_JSON_BYTES) throw new Error('legacy_history_file_oversize');
    entries.push({
      relativePath: relative.replace(/\\/gu, '/'),
      kind: 'file',
      bytes: stat.size,
    });
    return;
  }
  if (!stat.isDirectory()) throw new Error('legacy_history_not_regular');
  entries.push({
    relativePath: relative.replace(/\\/gu, '/'),
    kind: 'directory',
    bytes: 0,
  });
  const children = fs.readdirSync(absolute, { withFileTypes: true });
  if (children.length > MAX_LEGACY_ENTRIES) {
    throw new Error('legacy_history_catalog_oversize');
  }
  for (const child of children) {
    boundedLegacyWalk(root, path.join(relative, child.name), entries);
  }
}

export function catalogLegacyHistory(workDir) {
  const root = path.resolve(workDir);
  fs.mkdirSync(root, { recursive: true });
  assertCanonicalDirectory(root);
  const entries = [];
  for (const name of [
    'observations',
    'history',
    'physical',
    'capacity-proof.json',
    'physical-launch.pid.json',
    ACCEPTANCE_FILENAMES.legacyRun,
  ]) {
    if (fs.existsSync(path.join(root, name))) {
      boundedLegacyWalk(root, name, entries);
    }
  }
  return entries.map((entry) => LegacyEntrySchema.parse(entry));
}

export function createObservationAttempt(workDir, input, clock) {
  const root = path.resolve(workDir);
  fs.mkdirSync(root, { recursive: true });
  assertCanonicalDirectory(root);
  const attemptsRoot = attemptsDirectory(root);
  fs.mkdirSync(attemptsRoot, { recursive: true });
  assertCanonicalDirectory(attemptsRoot);
  const attemptId = normalizeAttemptId(input.attemptId ?? randomUUID());
  const directory = attemptDirectory(root, attemptId);
  try {
    fs.mkdirSync(directory, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('attempt_id_already_exists');
    throw error;
  }
  assertCanonicalDirectory(directory);
  const arms = Object.fromEntries(
    ARM_IDS.map((armId) => [armId, normalizeIdentity(input.arms[armId])])
  );
  const intent = AttemptIntentSchema.parse({
    schema: ATTEMPT_INTENT_SCHEMA,
    attemptId,
    candidate: normalizeCandidate(input.candidate),
    arms,
    observationPolicies: Object.fromEntries(
      ARM_IDS.map((armId) => [armId, observationPolicy(armId)])
    ),
    legacyHistory: catalogLegacyHistory(root),
    launcher: {
      pid: process.pid,
      nonce: randomUUID(),
    },
    createdAt: isoNow(clock),
  });
  assertAttemptPolicies(intent);
  writeJsonCreateOnce(attemptIntentPath(root, attemptId), intent);
  return intent;
}

export function readAttemptIntent(workDir, attemptId) {
  const intent = AttemptIntentSchema.parse(
    readJsonBounded(attemptIntentPath(workDir, attemptId))
  );
  if (intent.attemptId !== attemptId) throw new Error('attempt_intent_id_mismatch');
  assertAttemptPolicies(intent);
  return intent;
}

export function validateObservationResult(value) {
  return ObservationResultSchema.parse(value);
}

export function validateObservationCheckpoint(value) {
  return ObservationCheckpointSchema.parse(value);
}

function checkpointFiles(workDir, attemptId, armId) {
  const directory = observationCheckpointDirectory(workDir, attemptId, armId);
  if (!fs.existsSync(directory)) return [];
  assertCanonicalDirectory(directory);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.length > MAX_ATTEMPT_FILES) {
    throw new Error('observation_checkpoint_count_oversize');
  }
  return entries.map((entry) => {
    if (
      !entry.isFile()
      || entry.isSymbolicLink()
      || !/^\d{8}\.json$/u.test(entry.name)
    ) {
      throw new Error('observation_checkpoint_path_invalid');
    }
    return entry.name;
  }).sort();
}

export function readObservationCheckpoint(workDir, attemptId, armId) {
  return readObservationCheckpointChain(workDir, attemptId, armId).at(-1) ?? null;
}

export function readObservationCheckpointChain(workDir, attemptId, armId) {
  const intent = readAttemptIntent(workDir, attemptId);
  const files = checkpointFiles(workDir, attemptId, armId);
  let prior = null;
  return files.map((file) => {
    const checkpoint = validateObservationCheckpoint(readJsonBounded(
      path.join(observationCheckpointDirectory(workDir, attemptId, armId), file)
    ));
    if (
      checkpoint.attemptId !== attemptId
      || checkpoint.armId !== armId
      || checkpoint.sequence !== Number.parseInt(file.slice(0, 8), 10)
      || !candidatesEqual(intent.candidate, checkpoint.candidate)
      || JSON.stringify(intent.arms[armId])
        !== JSON.stringify(checkpoint.identity)
      || (
        prior !== null
        && (
          checkpoint.sequence !== prior.sequence + 1
          || checkpoint.startedAt !== prior.startedAt
          || checkpoint.cadenceToleranceMs !== prior.cadenceToleranceMs
          || checkpoint.deadlineApplicationToleranceMs
            !== prior.deadlineApplicationToleranceMs
          || checkpoint.targetElapsedMs !== prior.targetElapsedMs
          || checkpoint.elapsedMonotonicMs < prior.elapsedMonotonicMs
          || new Date(checkpoint.updatedAt).valueOf()
            < new Date(prior.updatedAt).valueOf()
        )
      )
    ) {
      throw new Error('observation_checkpoint_identity_mismatch');
    }
    prior = checkpoint;
    return checkpoint;
  });
}

function readCompletedSchedulerCheckpointChain(workDir, attemptId) {
  const chain = readObservationCheckpointChain(
    workDir,
    attemptId,
    'scheduler-cadence-deadline'
  );
  const latest = chain.at(-1) ?? null;
  if (latest === null || latest.state !== 'ready') {
    throw new Error('physical_result_scheduler_checkpoint_invalid');
  }
  return { chain, latest };
}

export function writeObservationCheckpoint(
  workDir,
  attemptId,
  armId,
  value
) {
  const intent = readAttemptIntent(workDir, attemptId);
  normalizeArmId(armId);
  const files = checkpointFiles(workDir, attemptId, armId);
  if (files.length > 0) {
    readObservationCheckpointChain(workDir, attemptId, armId);
  }
  const sequence = files.length === 0
    ? 1
    : Number.parseInt(files.at(-1).slice(0, 8), 10) + 1;
  if (sequence > MAX_ATTEMPT_FILES) {
    throw new Error('observation_checkpoint_count_oversize');
  }
  const checkpoint = validateObservationCheckpoint({
    ...value,
    schema: OBSERVATION_CHECKPOINT_SCHEMA,
    attemptId,
    armId,
    sequence,
    candidate: normalizeCandidate(value.candidate),
    identity: normalizeIdentity(value.identity),
  });
  if (
    !candidatesEqual(intent.candidate, checkpoint.candidate)
    || JSON.stringify(intent.arms[armId]) !== JSON.stringify(checkpoint.identity)
  ) {
    throw new Error('observation_checkpoint_identity_mismatch');
  }
  const directory = observationCheckpointDirectory(workDir, attemptId, armId);
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${String(sequence).padStart(8, '0')}.json`);
  writeJsonCreateOnce(filePath, checkpoint);
  return checkpoint;
}

function stableOwnedProcessBindingFingerprint(binding) {
  return digestJson({
    ownerInstanceId: binding.ownerInstanceId,
    ownerPid: binding.ownerPid,
    ownerProcessCreationIdentity: binding.ownerProcessCreationIdentity,
    hostId: binding.hostId,
    childPid: binding.childPid,
    childProcessCreationIdentity: binding.childProcessCreationIdentity,
  });
}

function schedulerTouchTextDigest() {
  const byteLength = Buffer.byteLength(SCHEDULER_TOUCH_MESSAGE, 'utf8');
  return createHash('sha256')
    .update(`rasen-session-cache-touch-text/1\0${byteLength}:`, 'utf8')
    .update(SCHEDULER_TOUCH_MESSAGE, 'utf8')
    .digest('hex');
}

function schedulerTouchMessageIdDigest(identity, ordinal, attempt) {
  const messageIdHash = digestJson({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    ordinal,
    attempt,
  });
  const messageId = `rasen-touch-v1-${messageIdHash}`;
  const byteLength = Buffer.byteLength(messageId, 'utf8');
  return createHash('sha256')
    .update(`rasen-session-message-id/1\0${byteLength}:`, 'utf8')
    .update(messageId, 'utf8')
    .digest('hex');
}

function terminalLogicalSessionFingerprint(identity, claudeSessionId) {
  return digestJson({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    cwd: path.resolve(identity.cwd),
    claudeSessionId,
  });
}

function assertCompletedObservationSemantics(
  intent,
  armId,
  result,
  checkpoint
) {
  const definition = OBSERVATION_ARMS[armId];
  if (
    result.attemptId !== intent.attemptId
    || result.armId !== armId
    || result.disposition !== 'completed'
    || !candidatesEqual(intent.candidate, result.candidate)
    || JSON.stringify(intent.arms[armId]) !== JSON.stringify(result.identity)
    || result.admissionBinding === null
    || result.physicalElapsed !== true
    || result.elapsedMonotonicMs < definition.minimumElapsedMs
  ) {
    throw new Error(`physical_result_identity_or_elapsed_invalid:${armId}`);
  }
  const started = new Date(result.startedAt).valueOf();
  const ended = new Date(result.endedAt).valueOf();
  const wallElapsed = ended - started;
  const boundAt = new Date(result.admissionBinding.boundAt).valueOf();
  if (
    !Number.isFinite(wallElapsed)
    || wallElapsed < definition.minimumElapsedMs
    || Math.abs(wallElapsed - result.elapsedMonotonicMs) > 5 * 60 * 1000
    || !Number.isFinite(boundAt)
    || boundAt < started
    || boundAt > ended
  ) {
    throw new Error(`physical_result_wall_clock_invalid:${armId}`);
  }
  if (armId === 'control-hit-55m') {
    if (
      result.identity.policy.mode !== 'never'
      || result.identity.policy.maxTouches !== 0
      || result.identity.policy.deadlineAt !== null
      || result.classification !== 'cache_hit'
      || result.usageCounters === null
      || result.usageCounters.cacheReadInputTokens <= 0
      || result.touchesObserved !== 0
      || result.deadlineApplied
    ) {
      throw new Error('physical_result_hit_semantics_invalid');
    }
    return;
  }
  if (armId === 'control-miss-65m') {
    if (
      result.identity.policy.mode !== 'never'
      || result.identity.policy.maxTouches !== 0
      || result.identity.policy.deadlineAt !== null
      || result.classification !== 'cache_miss_or_rewrite'
      || result.usageCounters === null
      || result.usageCounters.cacheReadInputTokens !== 0
      || result.usageCounters.cacheCreationInputTokens <= 0
      || result.touchesObserved !== 0
      || result.deadlineApplied
    ) {
      throw new Error('physical_result_miss_semantics_invalid');
    }
    return;
  }
  const scheduler = result.schedulerEvidence;
  if (
    result.identity.policy.mode !== 'auto'
    || result.identity.policy.maxTouches !== 1
    || result.identity.policy.deadlineAt === null
    || result.classification !== 'one_touch_then_deadline'
    || result.usageCounters !== null
    || result.touchesObserved !== 1
    || !result.deadlineApplied
    || scheduler === null
    || scheduler.deadlineAction !== result.identity.policy.deadlineAction
    || scheduler.transcriptSizeAfter - scheduler.transcriptSizeBefore
      !== scheduler.transcriptAppendedBytes
    || scheduler.deadlineReason !== 'touch-deadline-expired'
    || scheduler.configuredDeadlineAt !== result.identity.policy.deadlineAt
  ) {
    throw new Error('physical_result_scheduler_semantics_invalid');
  }
  if (
    checkpoint === null
    || checkpoint.state !== 'ready'
    || checkpoint.startedAt !== result.startedAt
    || checkpoint.schedulerBaseline === null
    || checkpoint.schedulerPreterminalOwnerProof === null
    || checkpoint.cadenceToleranceMs !== definition.cadenceToleranceMs
    || checkpoint.deadlineApplicationToleranceMs
      !== definition.deadlineApplicationToleranceMs
    || scheduler.cadenceToleranceMs !== definition.cadenceToleranceMs
    || scheduler.deadlineApplicationToleranceMs
      !== definition.deadlineApplicationToleranceMs
    || checkpoint.schedulerBaseline.capturedAt !== scheduler.eligibilityAt
    || checkpoint.schedulerBaseline.transcriptPathFingerprint
      !== scheduler.transcriptPathFingerprint
    || checkpoint.schedulerBaseline.transcriptFileIdentityFingerprint
      !== scheduler.transcriptFileIdentityFingerprint
    || checkpoint.schedulerBaseline.transcriptSize
      !== scheduler.transcriptSizeBefore
  ) {
    throw new Error('physical_result_scheduler_checkpoint_invalid');
  }
  const preterminal = checkpoint.schedulerPreterminalOwnerProof;
  const eligibility = new Date(scheduler.eligibilityAt).valueOf();
  const touch = new Date(scheduler.touchAt).valueOf();
  const dispatched = new Date(scheduler.touchDispatchedAt).valueOf();
  const transcriptTouch = new Date(scheduler.transcriptTouchAt).valueOf();
  const transcriptAssistant = new Date(scheduler.transcriptAssistantAt).valueOf();
  const transcriptResult = new Date(scheduler.transcriptResultAt).valueOf();
  const touchSettled = new Date(scheduler.touchSettledAt).valueOf();
  const configuredDeadline = new Date(scheduler.configuredDeadlineAt).valueOf();
  const deadlineApplied = new Date(scheduler.deadlineAppliedAt).valueOf();
  const expectedAdmissionFingerprint =
    stableOwnedProcessBindingFingerprint(result.admissionBinding);
  const expectedClaudeSessionIdDigest = createHash('sha256')
    .update(checkpoint.schedulerBaseline.claudeSessionId, 'utf8')
    .digest('hex');
  const expectedPreterminalFingerprint = digestJson(preterminal);
  const expectedOwnerFingerprint = digestJson({
    ...result.admissionBinding,
    boundAt: scheduler.touchSettledAt,
  });
  const expectedTerminalFingerprint = terminalLogicalSessionFingerprint(
    result.identity,
    checkpoint.schedulerBaseline.claudeSessionId
  );
  const expectedMessageIdDigest = schedulerTouchMessageIdDigest(
    result.identity,
    scheduler.touchOrdinal,
    scheduler.touchAttempt
  );
  const expectedBindingFingerprint = digestJson({
    runId: result.identity.runId,
    sessionKey: result.identity.sessionKey,
    claudeSessionIdDigest: scheduler.claudeSessionIdDigest,
    touchOrdinal: scheduler.touchOrdinal,
    touchAttempt: scheduler.touchAttempt,
    touchMessageIdDigest: scheduler.touchMessageIdDigest,
    transcriptTouchTextDigest: scheduler.transcriptTouchTextDigest,
    touchAt: scheduler.touchAt,
    touchDispatchedAt: scheduler.touchDispatchedAt,
    transcriptTouchAt: scheduler.transcriptTouchAt,
    transcriptAssistantAt: scheduler.transcriptAssistantAt,
    transcriptResultAt: scheduler.transcriptResultAt,
    touchSettledAt: scheduler.touchSettledAt,
    touchResultDigest: scheduler.touchResultDigest,
    transcriptResultDigest: scheduler.transcriptResultDigest,
    transcriptAssistantChainFingerprint:
      scheduler.transcriptAssistantChainFingerprint,
    preterminalOwnerProofFingerprint:
      scheduler.preterminalOwnerProofFingerprint,
    terminalLogicalSessionFingerprint:
      scheduler.terminalLogicalSessionFingerprint,
  });
  const cadence = touch - eligibility;
  if (
    ![
      eligibility,
      touch,
      dispatched,
      transcriptTouch,
      transcriptAssistant,
      transcriptResult,
      touchSettled,
      configuredDeadline,
      deadlineApplied,
    ].every(Number.isFinite)
    || started > eligibility
    || eligibility > touch
    || touch > dispatched
    || dispatched > transcriptTouch
    || transcriptTouch > transcriptAssistant
    || transcriptAssistant > transcriptResult
    || transcriptResult > touchSettled
    || touchSettled > configuredDeadline
    || configuredDeadline > deadlineApplied
    || deadlineApplied > ended
    || Math.abs(cadence - definition.expectedCadenceMs)
      > definition.cadenceToleranceMs
    || deadlineApplied - configuredDeadline
      > definition.deadlineApplicationToleranceMs
    || deadlineApplied - touch >= definition.expectedCadenceMs
    || scheduler.touchMessageIdDigest !== expectedMessageIdDigest
    || scheduler.transcriptTouchTextDigest !== schedulerTouchTextDigest()
    || scheduler.touchResultDigest !== scheduler.transcriptResultDigest
    || scheduler.claudeSessionIdDigest !== expectedClaudeSessionIdDigest
    || preterminal.admissionBindingFingerprint !== expectedAdmissionFingerprint
    || preterminal.ownerBindingFingerprint !== expectedOwnerFingerprint
    || preterminal.claudeSessionIdDigest !== expectedClaudeSessionIdDigest
    || preterminal.touchMessageIdDigest !== scheduler.touchMessageIdDigest
    || preterminal.touchOrdinal !== scheduler.touchOrdinal
    || preterminal.touchAttempt !== scheduler.touchAttempt
    || preterminal.touchSettledAt !== scheduler.touchSettledAt
    || new Date(preterminal.observedAt).valueOf() < touchSettled
    || new Date(preterminal.observedAt).valueOf() > configuredDeadline
    || scheduler.preterminalOwnerProofFingerprint
      !== expectedPreterminalFingerprint
    || scheduler.terminalLogicalSessionFingerprint
      !== expectedTerminalFingerprint
    || scheduler.touchTranscriptBindingFingerprint
      !== expectedBindingFingerprint
  ) {
    throw new Error('physical_result_scheduler_timing_invalid');
  }
}

function resultRelativePath(attemptId, armId) {
  return [
    ACCEPTANCE_FILENAMES.attempts,
    attemptId,
    'arms',
    armId,
    'result.json',
  ].join('/');
}

export function recordObservationResult(workDir, attemptId, value) {
  const intent = readAttemptIntent(workDir, attemptId);
  const result = validateObservationResult({
    ...value,
    attemptId,
    candidate: normalizeCandidate(value.candidate),
    identity: normalizeIdentity(value.identity),
  });
  if (
    result.armId !== value.armId
    || !candidatesEqual(intent.candidate, result.candidate)
    || JSON.stringify(intent.arms[result.armId])
      !== JSON.stringify(result.identity)
  ) {
    throw new Error('observation_result_identity_mismatch');
  }
  const filePath = observationResultPath(workDir, attemptId, result.armId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonCreateOnce(filePath, result);
  return result;
}

export function validateCompletedObservation(workDir, attemptId, armId) {
  const intent = readAttemptIntent(workDir, attemptId);
  const result = validateObservationResult(
    readJsonBounded(observationResultPath(workDir, attemptId, armId))
  );
  const checkpoint = armId === 'scheduler-cadence-deadline'
    ? readCompletedSchedulerCheckpointChain(workDir, attemptId).latest
    : null;
  assertCompletedObservationSemantics(intent, armId, result, checkpoint);
  if (result.provenance.kind === 'reused-copy') {
    if (result.provenance.sourceAttemptId === attemptId) {
      throw new Error('observation_reuse_cycle');
    }
    const sourcePath = observationResultPath(
      workDir,
      result.provenance.sourceAttemptId,
      armId
    );
    const sourceBytes = readRegularFileBounded(sourcePath, MAX_JSON_BYTES);
    if (
      createHash('sha256').update(sourceBytes).digest('hex')
        !== result.provenance.sourceResultFingerprint
    ) {
      throw new Error('observation_reuse_source_changed');
    }
    const source = validateObservationResult(JSON.parse(sourceBytes.toString('utf8')));
    if (
      source.provenance.kind !== 'observed'
      || !candidatesEqual(source.candidate, result.candidate)
      || JSON.stringify(source.identity) !== JSON.stringify(result.identity)
    ) {
      throw new Error('observation_reuse_source_invalid');
    }
  }
  return result;
}

export function writeObservationLog(workDir, attemptId, armId, entries) {
  if (!fs.existsSync(observationResultPath(workDir, attemptId, armId))) {
    throw new Error('observation_result_required_before_log');
  }
  const safeEntries = z.array(z.object({
    at: Timestamp,
    event: z.string().regex(SAFE_CODE),
    code: z.string().regex(SAFE_CODE).nullable(),
  }).strict()).max(2048).parse(entries);
  const directory = path.join(
    observationDirectory(workDir, attemptId, armId),
    'events'
  );
  fs.mkdirSync(directory, { recursive: true });
  const existing = fs.readdirSync(directory, { withFileTypes: true });
  if (
    existing.length + safeEntries.length > MAX_ATTEMPT_FILES
    || existing.some(
      (entry) => !entry.isFile() || !/^\d{8}\.json$/u.test(entry.name)
    )
  ) {
    throw new Error('observation_event_path_invalid');
  }
  safeEntries.forEach((entry, index) => {
    const sequence = existing.length + index + 1;
    writeJsonCreateOnce(
      path.join(directory, `${String(sequence).padStart(8, '0')}.json`),
      entry,
      MAX_LOG_BYTES
    );
  });
}

export const PRODUCT_GAP_OWNERS = Object.freeze({
  host_lifecycle: 'host-lifecycle',
  host_capacity: 'host-lifecycle',
  process_recovery: 'host-lifecycle',
  registry_durability: 'registry-recovery',
  transcript_identity: 'registry-recovery',
  wake_fence: 'registry-recovery',
  cli_protocol: 'cli-surface',
  daemon_probe: 'cli-surface',
  foreground_shutdown: 'cli-surface',
  scheduler_cadence: 'touch-scheduler',
  scheduler_deadline: 'touch-scheduler',
  scheduler_backoff: 'touch-scheduler',
  evidence_protocol: 'acceptance-evidence',
  acceptance_fixture: 'acceptance-evidence',
  architecture_documentation: 'acceptance-evidence',
});

export function writeObservationProductGap(
  workDir,
  attemptId,
  armId,
  gap
) {
  const owner = PRODUCT_GAP_OWNERS[gap.area];
  if (owner === undefined) throw new Error(`Unknown product gap area: ${gap.area}`);
  const decoded = ProductGapSchema.parse({
    caseId: gap.caseId,
    owner,
    code: gap.code,
    summary: gap.summary,
    status: 'open',
  });
  const filePath = path.join(
    observationDirectory(workDir, attemptId, armId),
    'product-gap.json'
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonCreateOnce(filePath, decoded);
  return decoded;
}

export function reuseCompletedObservation(
  workDir,
  targetAttemptId,
  sourceAttemptId,
  armId,
  clock
) {
  normalizeArmId(armId);
  if (armId === 'scheduler-cadence-deadline') {
    throw new Error('scheduler_observation_reuse_prohibited');
  }
  if (targetAttemptId === sourceAttemptId) {
    throw new Error('observation_reuse_same_attempt');
  }
  const target = readAttemptIntent(workDir, targetAttemptId);
  const source = validateCompletedObservation(workDir, sourceAttemptId, armId);
  if (
    !candidatesEqual(target.candidate, source.candidate)
    || JSON.stringify(target.arms[armId]) !== JSON.stringify(source.identity)
    || source.provenance.kind !== 'observed'
  ) {
    throw new Error('observation_reuse_identity_mismatch');
  }
  const sourceBytes = readRegularFileBounded(
    observationResultPath(workDir, sourceAttemptId, armId),
    MAX_JSON_BYTES
  );
  const sourceResultFingerprint =
    createHash('sha256').update(sourceBytes).digest('hex');
  const copiedAt = isoNow(clock);
  const reuse = {
    schema: OBSERVATION_REUSE_SCHEMA,
    targetAttemptId,
    sourceAttemptId,
    armId,
    candidateFingerprint: target.candidate.contentFingerprint,
    sourceResultFingerprint,
    copiedAt,
  };
  const directory = observationDirectory(workDir, targetAttemptId, armId);
  fs.mkdirSync(directory, { recursive: true });
  writeJsonCreateOnce(path.join(directory, 'reuse.json'), reuse);
  return recordObservationResult(workDir, targetAttemptId, {
    ...source,
    attemptId: targetAttemptId,
    provenance: {
      kind: 'reused-copy',
      sourceAttemptId,
      sourceResultFingerprint,
      copiedAt,
    },
  });
}

export function writeAttemptSummary(workDir, attemptId, input = {}, clock) {
  const intent = readAttemptIntent(workDir, attemptId);
  const arms = {};
  for (const armId of ARM_IDS) {
    const filePath = observationResultPath(workDir, attemptId, armId);
    if (!fs.existsSync(filePath)) {
      arms[armId] = {
        armId,
        disposition: 'missing',
        resultPath: null,
        resultFingerprint: null,
      };
      continue;
    }
    const bytes = readRegularFileBounded(filePath, MAX_JSON_BYTES);
    const result = validateObservationResult(JSON.parse(bytes.toString('utf8')));
    if (
      result.attemptId !== attemptId
      || result.armId !== armId
      || !candidatesEqual(intent.candidate, result.candidate)
      || JSON.stringify(intent.arms[armId]) !== JSON.stringify(result.identity)
    ) {
      throw new Error(`attempt_summary_result_mismatch:${armId}`);
    }
    arms[armId] = {
      armId,
      disposition: result.disposition,
      resultPath: resultRelativePath(attemptId, armId),
      resultFingerprint: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const dispositions = Object.values(arms).map((arm) => arm.disposition);
  const status = dispositions.every((value) => value === 'completed')
    ? 'complete'
    : dispositions.some((value) => value === 'missing')
      ? 'incomplete'
      : 'inconclusive';
  const summary = AttemptSummarySchema.parse({
    schema: ATTEMPT_SUMMARY_SCHEMA,
    attemptId,
    candidate: intent.candidate,
    intentPath: 'intent.json',
    status,
    arms,
    launcherExits: input.launcherExits ?? [],
    settledAt: isoNow(clock),
  });
  writeJsonCreateOnce(attemptSummaryPath(workDir, attemptId), summary);
  return summary;
}

export function readAttemptSummary(workDir, attemptId) {
  const summary = AttemptSummarySchema.parse(
    readJsonBounded(attemptSummaryPath(workDir, attemptId))
  );
  if (summary.attemptId !== attemptId) {
    throw new Error('attempt_summary_id_mismatch');
  }
  return summary;
}

function createAcceptanceRunV2(
  candidate,
  attemptId,
  arms,
  productGaps,
  settledAt
) {
  return AcceptanceRunV2Schema.parse({
    schema: ACCEPTANCE_V2_SCHEMA,
    revision: 0,
    selectedAttemptId: attemptId,
    selectedAttemptSummaryPath: [
      ACCEPTANCE_FILENAMES.attempts,
      attemptId,
      'summary.json',
    ].join('/'),
    candidate: normalizeCandidate(candidate),
    supportedPipelines: [...SUPPORTED_PIPELINES],
    expectedFailClosedPipelines: [...EXPECTED_FAIL_CLOSED_PIPELINES],
    requiredCiJobs: [...REQUIRED_CI_JOBS],
    arms,
    localEvidence: {
      nativeWindows: false,
      injectedPosix: false,
      nativeLinux: false,
      physicalRetention: true,
      recordPath: null,
      note:
        'One explicitly selected immutable attempt passed all three physical arms; native CI remains separate.',
    },
    productGaps,
    authorization: {
      state: 'awaiting_parent_authorization',
      remoteMutationAllowed: false,
      authorizer: null,
      authorizedAt: null,
      deliveryMode: null,
      frozenTreeFingerprint: null,
    },
    ciState: 'pending',
    updatedAt: settledAt,
  });
}

export function validateAcceptanceRunV2(value) {
  return AcceptanceRunV2Schema.parse(value);
}

export function readAcceptanceRunV2(workDir) {
  return validateAcceptanceRunV2(
    readJsonBounded(acceptanceRunV2Path(workDir))
  );
}

function replaceAcceptanceRunV2(workDir, value) {
  const filePath = acceptanceRunV2Path(workDir);
  if (!fs.existsSync(filePath)) {
    throw new Error('canonical_v2_record_required');
  }
  readAcceptanceRunV2(workDir);
  writeJsonAtomic(filePath, validateAcceptanceRunV2(value));
}

function readArmProductGap(workDir, attemptId, armId) {
  const filePath = path.join(
    observationDirectory(workDir, attemptId, armId),
    'product-gap.json'
  );
  return fs.existsSync(filePath)
    ? ProductGapSchema.parse(readJsonBounded(filePath))
    : null;
}

export function finalizeAcceptanceAttempt(workDir, attemptId) {
  const intent = readAttemptIntent(workDir, attemptId);
  const summary = readAttemptSummary(workDir, attemptId);
  if (
    summary.status !== 'complete'
    || !candidatesEqual(intent.candidate, summary.candidate)
  ) {
    throw new Error('selected_attempt_incomplete');
  }
  const arms = {};
  const productGaps = [];
  for (const armId of ARM_IDS) {
    const declared = summary.arms[armId];
    const expectedRelative = resultRelativePath(attemptId, armId);
    if (
      declared.armId !== armId
      || declared.disposition !== 'completed'
      || declared.resultPath !== expectedRelative
      || declared.resultFingerprint === null
    ) {
      throw new Error(`selected_attempt_result_path_invalid:${armId}`);
    }
    const absolute = path.resolve(workDir, ...expectedRelative.split('/'));
    if (
      absolute !== observationResultPath(workDir, attemptId, armId)
      || !absolute.startsWith(`${attemptDirectory(workDir, attemptId)}${path.sep}`)
    ) {
      throw new Error(`selected_attempt_result_path_escape:${armId}`);
    }
    const bytes = readRegularFileBounded(absolute, MAX_JSON_BYTES);
    if (
      createHash('sha256').update(bytes).digest('hex')
      !== declared.resultFingerprint
    ) {
      throw new Error(`selected_attempt_result_changed:${armId}`);
    }
    const result = validateCompletedObservation(workDir, attemptId, armId);
    arms[armId] = {
      armId,
      status: result.disposition,
      identity: result.identity,
      admissionBinding: result.admissionBinding,
      resultPath: expectedRelative,
    };
    const gap = readArmProductGap(workDir, attemptId, armId);
    if (gap !== null) productGaps.push(gap);
  }
  const run = createAcceptanceRunV2(
    intent.candidate,
    attemptId,
    arms,
    productGaps,
    summary.settledAt
  );
  const filePath = acceptanceRunV2Path(workDir);
  const validateExactExisting = () => {
    let existing;
    try {
      existing = readAcceptanceRunV2(workDir);
    } catch {
      throw new Error('canonical_v2_record_incompatible');
    }
    if (JSON.stringify(existing) !== JSON.stringify(run)) {
      throw new Error('canonical_v2_record_conflict');
    }
    return existing;
  };
  if (fs.existsSync(filePath)) {
    return validateExactExisting();
  }
  try {
    writeJsonCreateOnce(filePath, run);
  } catch (error) {
    if (
      error instanceof Error
      && error.message ===
        `immutable_evidence_already_exists:${ACCEPTANCE_FILENAMES.runV2}`
    ) {
      return validateExactExisting();
    }
    throw error;
  }
  return run;
}

function nextRevision(run, value, clock) {
  return validateAcceptanceRunV2({
    ...value,
    revision: run.revision + 1,
    updatedAt: isoNow(clock),
  });
}

function evidenceLogReference(workDir, reference) {
  const decoded = LocalEvidenceReferenceSchema.parse(reference);
  const root = path.resolve(workDir);
  const logsRoot = path.join(root, 'logs');
  const outputPath = path.resolve(root, decoded.outputPath);
  const exitCodePath = path.resolve(root, decoded.exitCodePath);
  if (
    !outputPath.startsWith(`${logsRoot}${path.sep}`)
    || !exitCodePath.startsWith(`${logsRoot}${path.sep}`)
  ) {
    throw new Error('local_evidence_log_outside_canonical_root');
  }
  let output;
  let exitCode;
  try {
    output = readRegularFileBounded(outputPath, MAX_LOG_BYTES);
    exitCode = readRegularFileBounded(exitCodePath, 32);
  } catch {
    throw new Error('local_evidence_log_invalid');
  }
  if (exitCode.toString('utf8').trim() !== '0') {
    throw new Error('local_evidence_gate_failed');
  }
  if (output.byteLength === 0 && !decoded.allowsEmptyOutput) {
    throw new Error('local_evidence_unexpected_empty_output');
  }
  return LocalEvidenceLogSchema.parse({
    ...decoded,
    outputPath: path.relative(root, outputPath).replace(/\\/gu, '/'),
    exitCodePath: path.relative(root, exitCodePath).replace(/\\/gu, '/'),
    outputFingerprint: createHash('sha256').update(output).digest('hex'),
    outputBytes: output.byteLength,
    exitCodeFingerprint: createHash('sha256').update(exitCode).digest('hex'),
    exitCodeBytes: exitCode.byteLength,
  });
}

export function recordLocalEvidence(workDir, evidence, clock) {
  const run = readAcceptanceRunV2(workDir);
  const gates = Object.fromEntries(
    Object.entries(evidence.gates ?? {}).map(([name, reference]) => [
      name,
      evidenceLogReference(workDir, reference),
    ])
  );
  const claims = new Set(
    Object.values(gates).flatMap((gate) => gate.platformClaims)
  );
  const record = LocalEvidenceRecordSchema.parse({
    schema: LOCAL_EVIDENCE_SCHEMA,
    candidateFingerprint: run.candidate.contentFingerprint,
    gates,
    nativeWindows: claims.has('native-windows'),
    injectedPosix: claims.has('injected-posix'),
    recordedAt: isoNow(clock),
  });
  const relativeRecordPath = 'local-evidence.json';
  writeJsonAtomic(path.join(path.resolve(workDir), relativeRecordPath), record);
  const next = nextRevision(run, {
    ...run,
    localEvidence: {
      nativeWindows: record.nativeWindows,
      injectedPosix: record.injectedPosix,
      nativeLinux: false,
      physicalRetention: run.localEvidence.physicalRetention,
      recordPath: relativeRecordPath,
      note:
        'Focused native Windows and injected POSIX cases are local branch proof only; they do not substitute for native Linux CI.',
    },
  }, clock);
  replaceAcceptanceRunV2(workDir, next);
  return next;
}

function revalidateLocalEvidenceRecord(workDir, record) {
  const currentGates = Object.fromEntries(
    Object.entries(record.gates).map(([name, gate]) => [
      name,
      evidenceLogReference(workDir, {
        gateType: gate.gateType,
        platformClaims: gate.platformClaims,
        allowsEmptyOutput: gate.allowsEmptyOutput,
        outputPath: gate.outputPath,
        exitCodePath: gate.exitCodePath,
      }),
    ])
  );
  if (JSON.stringify(currentGates) !== JSON.stringify(record.gates)) {
    throw new Error('local_evidence_logs_changed');
  }
  return LocalEvidenceRecordSchema.parse({ ...record, gates: currentGates });
}

export function validateCurrentLocalEvidence(workDir, runInput) {
  const run = runInput ?? readAcceptanceRunV2(workDir);
  if (
    run.localEvidence.recordPath === null
    || !run.localEvidence.nativeWindows
    || !run.localEvidence.injectedPosix
  ) {
    throw new Error('local_evidence_incomplete');
  }
  const record = LocalEvidenceRecordSchema.parse(readJsonBounded(
    path.join(path.resolve(workDir), run.localEvidence.recordPath)
  ));
  if (record.candidateFingerprint !== run.candidate.contentFingerprint) {
    throw new Error('local_evidence_candidate_mismatch');
  }
  return revalidateLocalEvidenceRecord(workDir, record);
}

export function authorizeParentDelivery(workDir, authorization, clock) {
  const run = readAcceptanceRunV2(workDir);
  if (
    authorization.frozenTreeFingerprint !== run.candidate.contentFingerprint
    || authorization.frozenTreeOid !== run.candidate.treeOid
    || run.candidate.treeOid === null
  ) {
    throw new Error('frozen_tree_fingerprint_mismatch');
  }
  const next = nextRevision(run, {
    ...run,
    authorization: {
      state: 'authorized',
      remoteMutationAllowed: true,
      authorizer: authorization.authorizer,
      authorizedAt: authorization.authorizedAt ?? isoNow(clock),
      deliveryMode: authorization.deliveryMode,
      frozenTreeFingerprint: authorization.frozenTreeFingerprint,
      frozenTreeOid: authorization.frozenTreeOid,
      repository: authorization.repository,
      githubOrigin: authorization.githubOrigin,
    },
  }, clock);
  replaceAcceptanceRunV2(workDir, next);
  return next;
}

export function recordParentDelivery(workDir, delivery, clock) {
  const run = readAcceptanceRunV2(workDir);
  if (run.authorization.state !== 'authorized') {
    throw new Error('parent_authorization_required');
  }
  if (
    delivery.currentTreeFingerprint !== run.authorization.frozenTreeFingerprint
    || delivery.currentTreeOid !== run.authorization.frozenTreeOid
  ) {
    throw new Error('repository_changed_after_freeze');
  }
  const next = nextRevision(run, {
    ...run,
    authorization: {
      ...run.authorization,
      state: 'delivered',
      remoteMutationAllowed: false,
      deliveredSha: delivery.deliveredSha,
      deliveredAt: delivery.deliveredAt ?? isoNow(clock),
    },
  }, clock);
  replaceAcceptanceRunV2(workDir, next);
  return next;
}

export function validateCiEvidence(value) {
  return CiEvidenceSchema.parse(value);
}

export function seedPendingCiEvidence(workDir, clock) {
  const run = readAcceptanceRunV2(workDir);
  const pending = validateCiEvidence({
    schema: CI_EVIDENCE_SCHEMA,
    state: 'pending',
    candidateFingerprint: run.candidate.contentFingerprint,
    deliverySha: run.authorization.state === 'delivered'
      ? run.authorization.deliveredSha
      : null,
    requiredJobs: [...REQUIRED_CI_JOBS],
    workflow: null,
    jobs: [],
    updatedAt: isoNow(clock),
  });
  writeJsonAtomic(ciEvidencePath(workDir), pending);
  if (run.ciState !== 'pending') {
    replaceAcceptanceRunV2(
      workDir,
      nextRevision(run, { ...run, ciState: 'pending' }, clock)
    );
  }
  return pending;
}

function normalizedRunId(value) {
  const normalized = String(value);
  if (normalized.length === 0 || normalized.length > 128) {
    throw new Error('ci_run_id_invalid');
  }
  return normalized;
}

function normalizedRunAttempt(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('ci_run_attempt_invalid');
  }
  return value;
}

function exactHttpsUrl(value, expectedOrigin, expectedPath, code) {
  const parsed = new URL(value);
  const origin = new URL(expectedOrigin);
  if (
    parsed.protocol !== 'https:'
    || parsed.origin !== origin.origin
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.pathname !== expectedPath
  ) {
    throw new Error(code);
  }
  return parsed.href;
}

function githubApiLocation(githubOrigin, repository, suffix) {
  const web = new URL(githubOrigin);
  return web.hostname === 'github.com'
    ? { origin: 'https://api.github.com', path: `/repos/${repository}/${suffix}` }
    : { origin: web.origin, path: `/api/v3/repos/${repository}/${suffix}` };
}

export function collectSuccessfulCiEvidence(workDir, input, clock) {
  const run = readAcceptanceRunV2(workDir);
  if (run.authorization.state !== 'delivered') {
    throw new Error('parent_delivery_required');
  }
  if (input.deliveryScope !== 'portfolio') {
    throw new Error('partial_child_evidence_rejected');
  }
  if (input.platformEvidence !== 'native') {
    throw new Error('substitute_platform_evidence_rejected');
  }
  const exactRuns = input.workflowRuns.filter(
    (candidate) => candidate.head_sha === run.authorization.deliveredSha
      && candidate.repository?.full_name === run.authorization.repository
  );
  if (exactRuns.length !== 1) throw new Error('exact_sha_workflow_required');
  const workflow = exactRuns[0];
  if (workflow.status !== 'completed' || workflow.conclusion !== 'success') {
    throw new Error('workflow_not_successful');
  }
  const runId = normalizedRunId(workflow.id);
  const runAttempt = normalizedRunAttempt(workflow.run_attempt);
  const workflowUrl = exactHttpsUrl(
    workflow.html_url,
    run.authorization.githubOrigin,
    `/${run.authorization.repository}/actions/runs/${runId}`,
    'ci_workflow_url_provenance_mismatch'
  );
  const apiLocation = githubApiLocation(
    run.authorization.githubOrigin,
    run.authorization.repository,
    `actions/runs/${runId}`
  );
  const workflowApiUrl = exactHttpsUrl(
    workflow.url,
    apiLocation.origin,
    apiLocation.path,
    'ci_workflow_api_url_provenance_mismatch'
  );
  const jobsByName = new Map();
  for (const job of input.jobs) {
    if (REQUIRED_CI_JOBS.includes(job.name)) {
      if (jobsByName.has(job.name)) throw new Error('duplicate_required_ci_job');
      jobsByName.set(job.name, job);
    }
  }
  const jobs = REQUIRED_CI_JOBS.map((name) => {
    const job = jobsByName.get(name);
    if (
      job === undefined
      || job.status !== 'completed'
      || job.conclusion !== 'success'
    ) {
      throw new Error(`required_ci_job_not_successful:${name}`);
    }
    if (Object.hasOwn(job, 'repository') || Object.hasOwn(job, 'githubOrigin')) {
      throw new Error(`required_ci_job_enriched_substitute:${name}`);
    }
    if (
      normalizedRunId(job.run_id) !== runId
      || normalizedRunAttempt(job.run_attempt) !== runAttempt
      || job.head_sha !== run.authorization.deliveredSha
    ) {
      throw new Error(`required_ci_job_provenance_mismatch:${name}`);
    }
    const jobId = normalizedRunId(job.id);
    const jobApi = githubApiLocation(
      run.authorization.githubOrigin,
      run.authorization.repository,
      `actions/jobs/${jobId}`
    );
    return {
      name,
      url: exactHttpsUrl(
        job.html_url,
        run.authorization.githubOrigin,
        `/${run.authorization.repository}/actions/runs/${runId}/job/${jobId}`,
        `required_ci_job_url_provenance_mismatch:${name}`
      ),
      apiUrl: exactHttpsUrl(
        job.url,
        jobApi.origin,
        jobApi.path,
        `required_ci_job_api_url_provenance_mismatch:${name}`
      ),
      runId,
      runAttempt,
      runUrl: exactHttpsUrl(
        job.run_url,
        apiLocation.origin,
        apiLocation.path,
        `required_ci_job_run_url_provenance_mismatch:${name}`
      ),
      headSha: run.authorization.deliveredSha,
      repository: run.authorization.repository,
      githubOrigin: run.authorization.githubOrigin,
      conclusion: 'success',
    };
  });
  const evidence = validateCiEvidence({
    schema: CI_EVIDENCE_SCHEMA,
    state: 'successful',
    candidateFingerprint: run.candidate.contentFingerprint,
    deliverySha: run.authorization.deliveredSha,
    requiredJobs: [...REQUIRED_CI_JOBS],
    workflow: {
      headSha: workflow.head_sha,
      runId,
      runAttempt,
      url: workflowUrl,
      apiUrl: workflowApiUrl,
      repository: run.authorization.repository,
      githubOrigin: run.authorization.githubOrigin,
    },
    jobs,
    updatedAt: isoNow(clock),
  });
  writeJsonAtomic(ciEvidencePath(workDir), evidence);
  replaceAcceptanceRunV2(
    workDir,
    nextRevision(run, { ...run, ciState: 'successful' }, clock)
  );
  return evidence;
}

export function recordCiFailureHistory(workDir, input, reasonCode, clock) {
  const run = readAcceptanceRunV2(workDir);
  if (run.authorization.state !== 'delivered') {
    throw new Error('parent_delivery_required');
  }
  const safeReason = String(reasonCode)
    .replace(/[^a-z0-9_]/giu, '_')
    .toLowerCase()
    .slice(0, 64) || 'ci_evidence_rejected';
  const recordedAt = isoNow(clock);
  const history = {
    schema: 'rasen-session-cache-ci-failure/1',
    candidateFingerprint: run.candidate.contentFingerprint,
    deliverySha: run.authorization.deliveredSha,
    reasonCode: safeReason,
    observedWorkflowHeadShas: Array.isArray(input.workflowRuns)
      ? input.workflowRuns
        .map((workflow) => workflow?.head_sha)
        .filter((value) => typeof value === 'string' && SHA.test(value))
        .slice(0, 128)
      : [],
    requiredJobConclusions: Array.isArray(input.jobs)
      ? REQUIRED_CI_JOBS.flatMap((name) => {
        const job = input.jobs.find((candidate) => candidate?.name === name);
        return job === undefined ? [] : [{
          name,
          status: typeof job.status === 'string'
            ? job.status.slice(0, 64)
            : 'unknown',
          conclusion: typeof job.conclusion === 'string'
            ? job.conclusion.slice(0, 64)
            : null,
        }];
      })
      : [],
    recordedAt,
  };
  const historyPath = path.join(
    path.resolve(workDir),
    ACCEPTANCE_FILENAMES.history,
    run.candidate.contentFingerprint,
    run.authorization.deliveredSha,
    `ci-failure-${recordedAt.replace(/[:.]/gu, '-')}-${randomUUID()}.json`
  );
  writeJsonCreateOnce(historyPath, history);
  const failed = validateCiEvidence({
    schema: CI_EVIDENCE_SCHEMA,
    state: 'failed',
    candidateFingerprint: run.candidate.contentFingerprint,
    deliverySha: run.authorization.deliveredSha,
    requiredJobs: [...REQUIRED_CI_JOBS],
    workflow: null,
    jobs: [],
    reasonCode: safeReason,
    updatedAt: recordedAt,
  });
  writeJsonAtomic(ciEvidencePath(workDir), failed);
  replaceAcceptanceRunV2(
    workDir,
    nextRevision(run, { ...run, ciState: 'failed' }, clock)
  );
  return { history, historyPath, ci: failed };
}

const ALLOWED_REPOSITORY_PATHS = [
  /^scripts\/session-cache-acceptance\//u,
  /^test\/acceptance\/session-cache\//u,
  /^rasen\/changes\/session-cache-optimization-acceptance-evidence\//u,
  /^docs\/architecture\/executable-composite-pipelines\.md$/u,
];
const FORBIDDEN_REPOSITORY_PATHS = [
  /^src\/core\/management-api\/supervisor\.ts$/u,
  /^src\/core\/management-api\/durable-session-registry\.ts$/u,
  /^src\/core\/management-api\/reusable-session-api\.ts$/u,
  /^src\/core\/management-api\/session-touch-scheduler\.ts$/u,
  /^src\/commands\/session\.ts$/u,
  /^src\/commands\/daemon\.ts$/u,
  /^src\/core\/change-run\//u,
  /^src\/core\/pipeline-registry\//u,
  /^rasen\/directions\//u,
  /(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock)(?:\.json|\.yaml)?$/u,
];

export function isAcceptanceOwnedPath(candidate) {
  const normalized = candidate.replace(/\\/gu, '/').replace(/^\.\//u, '');
  return (
    ALLOWED_REPOSITORY_PATHS.some((pattern) => pattern.test(normalized))
    && !FORBIDDEN_REPOSITORY_PATHS.some((pattern) => pattern.test(normalized))
  );
}

export function auditAcceptanceOwnership(changedPaths) {
  const normalized = [...new Set(
    changedPaths.map((entry) => entry.replace(/\\/gu, '/').replace(/^\.\//u, ''))
  )].sort();
  const forbidden = normalized.filter(
    (entry) => FORBIDDEN_REPOSITORY_PATHS.some((pattern) => pattern.test(entry))
  );
  const unowned = normalized.filter((entry) => !isAcceptanceOwnedPath(entry));
  if (forbidden.length > 0 || unowned.length > 0) {
    throw new Error(
      `acceptance_ownership_violation:${[...new Set([...forbidden, ...unowned])].join(',')}`
    );
  }
  return { owned: normalized, forbidden: [], unowned: [] };
}

export function assertFinalAcceptanceComplete(workDir) {
  const run = readAcceptanceRunV2(workDir);
  if (
    run.selectedAttemptId === null
    || !run.localEvidence.nativeWindows
    || !run.localEvidence.injectedPosix
    || !run.localEvidence.nativeLinux
    || !run.localEvidence.physicalRetention
    || Object.values(run.arms).some((arm) => arm?.status !== 'completed')
    || run.productGaps.length > 0
    || run.authorization.state !== 'delivered'
    || run.ciState !== 'successful'
  ) {
    throw new Error('final_acceptance_incomplete');
  }
  validateCurrentLocalEvidence(workDir, run);
  const ci = validateCiEvidence(readJsonBounded(ciEvidencePath(workDir)));
  if (
    ci.state !== 'successful'
    || ci.candidateFingerprint !== run.candidate.contentFingerprint
    || ci.deliverySha !== run.authorization.deliveredSha
  ) {
    throw new Error('final_acceptance_ci_mismatch');
  }
  for (const armId of ARM_IDS) {
    validateCompletedObservation(workDir, run.selectedAttemptId, armId);
  }
  return run;
}
