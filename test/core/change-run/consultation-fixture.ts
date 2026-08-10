import type {
  ActorRef,
  ActionId,
  AttemptId,
  InvocationId,
  RunAction,
} from '../../../src/core/change-run/contracts.js';
import type { AgentContinuationGrant } from '../../../src/core/change-run/consultation-contracts.js';
import {
  classifyConsultationRequest,
  commitTeacherAdvice,
  continuationGrantFromCommitted,
  teacherInvocationForRun,
} from '../../../src/core/change-run/internal/consultation-lifecycle.js';
import {
  createCanonicalRunRecord,
  type CanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import {
  reduceCanonicalRunRecord,
  type RunStimulus,
} from '../../../src/core/change-run/internal/reducer.js';
import {
  deriveActionId,
  deriveAttemptId,
  deriveInvocationId,
  deriveNodeId,
} from '../../../src/core/change-run/internal/identity.js';
import {
  makeRecordAction,
  makeRecordEvidence,
  recordIds,
  recordRevision,
} from './record-fixture.js';

export const CONSULTATION_SOURCE_SESSION_ID =
  '11111111-1111-1111-1111-111111111111';

export const consultationTestBinding = {
  sourceProfilePath: 'root/source',
  teacherProfilePath: 'sidecar/teacher',
  maxConsultationsPerInvocation: 2,
  maxTeacherAttemptsPerConsultation: 2,
  limits: {
    maxQuestionBytes: 4096,
    maxAdviceBytes: 8192,
    maxAttemptedApproaches: 4,
    maxConstraints: 4,
    maxEvidencePointers: 4,
    maxAdviceSteps: 8,
    maxCautions: 4,
    maxEvidenceNotes: 4,
  },
} as const;

export function consultationActor(role = 'implementer'): ActorRef {
  return {
    format: 'change-run-actor/1',
    kind: 'agent',
    identityDigest: recordIds.digest,
    role,
    provider: 'codex',
    runtime: 'codex',
    principalIdentityDigest: recordIds.digest,
    sessionIdentityDigest: recordIds.digest,
    adapter: {
      id: 'fixture-adapter',
      version: '1',
      artifactDigest: recordIds.digest,
    },
  };
}

export function authoritativeConsultationAction(
  action: RunAction,
  teacher = false
): RunAction {
  if (action.kind !== 'agent') throw new Error('fixture requires an agent Action');
  const actor = consultationActor(teacher ? 'teacher' : 'implementer');
  return {
    ...action,
    completionAuthority: {
      format: 'change-run-completion-authority/1',
      actor,
      actorAttestation: {
        producer: { id: 'fixture', version: '1', identityDigest: recordIds.digest },
        observationKind: 'actor-attestation',
        schema: 'fixture/actor/1',
        mediaType: 'application/json',
      },
      observations: {
        domainActionResult: {
          producer: { id: 'fixture', version: '1', identityDigest: recordIds.digest },
          observationKind: 'domain-action-result',
          schema: 'fixture/result/1',
          mediaType: 'application/json',
        },
        effectObservation: {
          producer: { id: 'fixture', version: '1', identityDigest: recordIds.digest },
          observationKind: 'effect-observation',
          schema: 'fixture/effect/1',
          mediaType: 'application/json',
        },
        infrastructureObservation: {
          producer: { id: 'fixture', version: '1', identityDigest: recordIds.digest },
          observationKind: 'infrastructure-observation',
          schema: 'fixture/infra/1',
          mediaType: 'application/json',
        },
      },
    },
    agent: {
      ...action.agent,
      role: teacher ? 'teacher' : 'implementer',
      sandbox: teacher ? 'read-only' : 'workspace-write',
      session: { ...action.agent.session, reuse: 'same-invocation' },
    },
  };
}

export function createConsultationRecord(): CanonicalRunRecord {
  return createCanonicalRunRecord({
    runId: recordIds.runId,
    runOrdinal: 0,
    change: {
      planningSpaceId: recordIds.planningSpaceId,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: recordIds.changeInstanceId,
    },
    workspaceInstanceId: recordIds.workspaceInstanceId,
    pipeline: 'consultable',
    launchRequestDigest: recordIds.digest,
    planDigest: recordIds.digest,
    sourceRevisionDigest: recordIds.digest,
    capabilityDigest: recordIds.digest,
    policyDigest: recordIds.digest,
    executionProfileDigest: recordIds.digest,
    initialWorkspaceRevision: recordRevision,
    inputs: {},
    limits: {
      maxAttempts: 16,
      maxActions: 16,
      maxRecordRevisions: 64,
      maxTransitions: 128,
      maxEvidenceRefsPerAction: 4,
      limitOutcome: 'failed',
    },
  });
}

function reduce(record: CanonicalRunRecord, stimulus: RunStimulus): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) throw new Error(result.failure.message);
  return result.record;
}

function teacherActionFor(consultationId: string, input: unknown): RunAction {
  const nodeId = deriveNodeId(
    recordIds.runId,
    `consultation/${consultationId}/teacher`
  );
  const invocationId = deriveInvocationId(recordIds.runId, nodeId, 0);
  const attemptId = deriveAttemptId(invocationId, 0);
  const actionId = deriveActionId(attemptId, 'agent', []);
  const base = authoritativeConsultationAction(makeRecordAction(), true);
  if (base.kind !== 'agent') throw new Error('fixture requires an agent Action');
  return {
    ...base,
    nodeId,
    invocationId,
    attemptId,
    actionId,
    effects: [],
    workspace: { access: 'read', resources: ['worktree'] },
    agent: { ...base.agent, input: input as never },
  };
}

export interface GrantedConsultationFixture {
  readonly record: CanonicalRunRecord;
  readonly sourceAction: RunAction;
  readonly teacherAction: RunAction;
  readonly grant: AgentContinuationGrant;
}

export interface ActiveTeacherConsultationFixture {
  readonly record: CanonicalRunRecord;
  readonly sourceAction: RunAction;
  readonly teacherAction: RunAction;
  readonly consultationId: string;
}

export function buildActiveTeacherConsultationFixture(options: Readonly<{
  stableSessionId?: string;
  sourceRequestId?: string;
}> = {}): ActiveTeacherConsultationFixture {
  const sourceAction = authoritativeConsultationAction(makeRecordAction());
  let record = reduce(createConsultationRecord(), {
    kind: 'admit-action',
    action: sourceAction,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  const submission = {
    format: 'teacher-consultation/submission/1' as const,
    runId: record.runId,
    actionId: sourceAction.actionId as ActionId,
    invocationId: sourceAction.invocationId as InvocationId,
    expectedRecordVersion: record.recordVersion,
    stableSessionId: options.stableSessionId ?? CONSULTATION_SOURCE_SESSION_ID,
    requestId:
      options.sourceRequestId ?? '22222222-2222-2222-2222-222222222222',
    resultDigest: recordIds.digest,
    question: {
      problemSummary: 'The reducer invariant is unclear.',
      question: 'Which state should own continuation delivery?',
      attemptedApproaches: ['read existing reducer'],
      constraints: ['preserve legacy records'],
      evidencePointers: ['src/core/change-run/internal/reducer.ts'],
    },
    actor: consultationActor(),
    actorAttestation: makeRecordEvidence(sourceAction),
    evidence: [makeRecordEvidence(sourceAction)],
  };
  const classified = classifyConsultationRequest({
    record,
    source: record.actions[sourceAction.actionId]!,
    binding: consultationTestBinding,
    submission,
  });
  if (classified.kind !== 'new') throw new Error(`expected new consultation, got ${classified.kind}`);
  record = reduce(record, {
    kind: 'request-consultation',
    consultation: classified.consultation,
  });
  const invocation = teacherInvocationForRun(record.runId, classified.consultation);
  const teacherAction = teacherActionFor(classified.consultation.consultationId, invocation);
  record = reduce(record, {
    kind: 'admit-action',
    action: teacherAction,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  record = reduce(record, {
    kind: 'link-consultation-teacher',
    consultationId: classified.consultation.consultationId,
    teacherActionId: teacherAction.actionId,
  });
  return {
    record,
    sourceAction,
    teacherAction,
    consultationId: classified.consultation.consultationId,
  };
}

export function buildGrantedConsultationFixture(options: Readonly<{
  stableSessionId?: string;
  sourceRequestId?: string;
}> = {}): GrantedConsultationFixture {
  const activeFixture = buildActiveTeacherConsultationFixture(options);
  let { record } = activeFixture;
  const { sourceAction, teacherAction } = activeFixture;
  const active = record.consultations![activeFixture.consultationId]!;
  const advice = {
    contract: 'teacher-consultation/advice/1' as const,
    consultationId: active.consultationId,
    teacherAttempt: 1,
    decision: 'plan' as const,
    rationale: 'Keep delivery canonical.',
    steps: ['Commit advice before wake.'],
    cautions: ['Never substitute Session identity.'],
    evidenceNotes: [],
  };
  record = reduce(record, {
    kind: 'commit-action-result',
    actionId: teacherAction.actionId,
    status: 'succeeded',
    receiptDigest: recordIds.digest,
    result: advice,
    evidence: [],
    actor: teacherAction.completionAuthority!.actor,
    actorAttestation: makeRecordEvidence(teacherAction),
  });
  record = reduce(record, {
    kind: 'commit-consultation-advice',
    consultation: commitTeacherAdvice({
      consultation: record.consultations![active.consultationId]!,
      teacherAction,
      result: advice,
      actor: teacherAction.completionAuthority!.actor,
      actorAttestation: makeRecordEvidence(teacherAction),
      evidence: [makeRecordEvidence(teacherAction)],
    }),
  });
  record = reduce(record, {
    kind: 'grant-consultation-continuation',
    consultationId: active.consultationId,
  });
  return {
    record,
    sourceAction,
    teacherAction,
    grant: continuationGrantFromCommitted(
      record,
      record.consultations![active.consultationId]!
    ),
  };
}
