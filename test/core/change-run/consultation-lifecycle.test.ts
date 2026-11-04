import { describe, expect, it } from 'vitest';

import type {
  ActorRef,
  ActionId,
  AttemptId,
  Digest,
  InvocationId,
  NodeId,
  RunAction,
} from '../../../src/core/change-run/contracts.js';
import {
  continuationGrantFromCommitted,
  classifyConsultationRequest,
  commitTeacherAdvice,
  teacherInvocationForRun,
} from '../../../src/core/change-run/internal/consultation-lifecycle.js';
import {
  createCanonicalRunRecord,
  decodeCanonicalRunRecord,
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

const UUID_A = '11111111-1111-1111-1111-111111111111';

const actor: ActorRef = {
  format: 'change-run-actor/1',
  kind: 'agent',
  identityDigest: recordIds.digest,
  role: 'implementer',
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

function authoritative(action: RunAction, teacher = false): RunAction {
  if (action.kind !== 'agent') throw new Error('fixture requires agent');
  const nextActor: ActorRef = teacher
    ? { ...actor, role: 'teacher' }
    : actor;
  return {
    ...action,
    completionAuthority: {
      format: 'change-run-completion-authority/1',
      actor: nextActor,
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

function teacherAction(consultationId: string, input: unknown): RunAction {
  const nodeId = deriveNodeId(recordIds.runId, `consultation/${consultationId}/teacher`);
  const invocationId = deriveInvocationId(recordIds.runId, nodeId, 0);
  const attemptId = deriveAttemptId(invocationId, 0);
  const actionId = deriveActionId(attemptId, 'agent', []);
  const base = authoritative(makeRecordAction(), true);
  if (base.kind !== 'agent') throw new Error('fixture requires agent');
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

function initial() {
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

function mustReduce(record: ReturnType<typeof initial>, stimulus: RunStimulus) {
  const result = reduceCanonicalRunRecord(record, stimulus);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.failure.message);
  return result.record;
}

const binding = {
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

describe('canonical consultation lifecycle', () => {
  it('pauses without completing, links exact Teacher advice, and grants one exact continuation', () => {
    const sourceAction = authoritative(makeRecordAction());
    let record = mustReduce(initial(), {
      kind: 'admit-action',
      action: sourceAction,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    const question = {
      problemSummary: 'The reducer invariant is unclear.',
      question: 'Which state should own continuation delivery?',
      attemptedApproaches: ['read existing reducer'],
      constraints: ['preserve legacy records'],
      evidencePointers: ['src/core/change-run/internal/reducer.ts'],
    };
    const submission = {
      format: 'teacher-consultation/submission/1' as const,
      runId: recordIds.runId,
      actionId: sourceAction.actionId as ActionId,
      invocationId: sourceAction.invocationId as InvocationId,
      expectedRecordVersion: record.recordVersion,
      stableSessionId: UUID_A,
      requestId: UUID_A,
      resultDigest: recordIds.digest,
      question,
      actor,
      actorAttestation: makeRecordEvidence(sourceAction),
      evidence: [makeRecordEvidence(sourceAction)],
    };
    const classified = classifyConsultationRequest({
      record,
      source: record.actions[sourceAction.actionId]!,
      binding,
      submission,
    });
    expect(classified.kind).toBe('new');
    if (classified.kind !== 'new') return;
    record = mustReduce(record, {
      kind: 'request-consultation',
      consultation: classified.consultation,
    });
    expect(record.actions[sourceAction.actionId]?.state).toBe('consultation-paused');
    expect(record.actions[sourceAction.actionId]?.result).toBeUndefined();

    const invocation = teacherInvocationForRun(record.runId, classified.consultation);
    const teacher = teacherAction(classified.consultation.consultationId, invocation);
    record = mustReduce(record, {
      kind: 'admit-action', action: teacher, attemptOrdinal: 0, deliveryMode: 'grant',
    });
    record = mustReduce(record, {
      kind: 'link-consultation-teacher',
      consultationId: classified.consultation.consultationId,
      teacherActionId: teacher.actionId,
    });
    const active = record.consultations![classified.consultation.consultationId]!;
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
    record = mustReduce(record, {
      kind: 'commit-action-result',
      actionId: teacher.actionId,
      status: 'succeeded',
      receiptDigest: recordIds.digest,
      result: advice,
      evidence: [],
      actor: (teacher.completionAuthority!.actor),
      actorAttestation: makeRecordEvidence(teacher),
    });
    const advised = commitTeacherAdvice({
      consultation: record.consultations![active.consultationId]!,
      teacherAction: teacher,
      result: advice,
      actor: teacher.completionAuthority!.actor,
      actorAttestation: makeRecordEvidence(teacher),
      evidence: [makeRecordEvidence(teacher)],
    });
    record = mustReduce(record, {
      kind: 'commit-consultation-advice', consultation: advised,
    });
    record = mustReduce(record, {
      kind: 'grant-consultation-continuation', consultationId: advised.consultationId,
    });
    const committed = record.consultations![advised.consultationId]!;
    const grant = continuationGrantFromCommitted(record, committed);
    expect(grant.stableSessionId).toBe(UUID_A);
    expect(grant.input.contract).toBe('teacher-consultation/resume/1');
    expect(grant.sourceActionId).toBe(sourceAction.actionId);

    const roundTrip = decodeCanonicalRunRecord(JSON.parse(JSON.stringify(record)));
    expect(roundTrip.consultations?.[advised.consultationId]).toEqual(committed);
    record = mustReduce(record, {
      kind: 'settle-consultation-continuation',
      consultationId: advised.consultationId,
      resultDigest: `sha256:${'e'.repeat(64)}` as Digest,
    });
    expect(record.actions[sourceAction.actionId]?.state).toBe('active');
    expect(record.consultations?.[advised.consultationId]?.state).toBe('continued');
  });

  it('classifies exact duplicate request idempotently and rejects conflicting bytes', () => {
    const sourceAction = authoritative(makeRecordAction());
    let record = mustReduce(initial(), {
      kind: 'admit-action', action: sourceAction, attemptOrdinal: 0, deliveryMode: 'grant',
    });
    const request = {
      format: 'teacher-consultation/submission/1' as const,
      runId: record.runId,
      actionId: sourceAction.actionId as ActionId,
      invocationId: sourceAction.invocationId as InvocationId,
      expectedRecordVersion: record.recordVersion,
      stableSessionId: UUID_A,
      requestId: UUID_A,
      resultDigest: recordIds.digest,
      question: {
        problemSummary: 'x', question: 'y?', attemptedApproaches: [], constraints: [], evidencePointers: [],
      },
      actor,
      actorAttestation: makeRecordEvidence(sourceAction),
      evidence: [makeRecordEvidence(sourceAction)],
    };
    const first = classifyConsultationRequest({
      record, source: record.actions[sourceAction.actionId]!, binding, submission: request,
    });
    if (first.kind !== 'new') throw new Error('expected new');
    record = mustReduce(record, { kind: 'request-consultation', consultation: first.consultation });
    expect(classifyConsultationRequest({
      record,
      source: record.actions[sourceAction.actionId]!,
      binding,
      submission: request,
    }).kind).toBe('duplicate');
    expect(classifyConsultationRequest({
      record,
      source: record.actions[sourceAction.actionId]!,
      binding,
      submission: { ...request, resultDigest: `sha256:${'f'.repeat(64)}` as Digest },
    }).kind).toBe('conflict');
    expect(classifyConsultationRequest({
      record,
      source: record.actions[sourceAction.actionId]!,
      binding,
      submission: { ...request, expectedRecordVersion: request.expectedRecordVersion + 1 },
    }).kind).toBe('conflict');
    expect(classifyConsultationRequest({
      record,
      source: record.actions[sourceAction.actionId]!,
      binding,
      submission: {
        ...request,
        actorAttestation: {
          ...request.actorAttestation,
          evidenceDigest: `sha256:${'e'.repeat(64)}` as Digest,
        },
      },
    }).kind).toBe('conflict');
  });

  it('derives gap-free ordinals and bounded unavailability independently of Teacher attempts', () => {
    const sourceAction = authoritative(makeRecordAction());
    let record = mustReduce(initial(), {
      kind: 'admit-action',
      action: sourceAction,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    const classifications: Array<ReturnType<typeof classifyConsultationRequest>> = [];
    for (let index = 1; index <= 3; index += 1) {
      const classified = classifyConsultationRequest({
        record,
        source: record.actions[sourceAction.actionId]!,
        binding,
        submission: {
          format: 'teacher-consultation/submission/1',
          runId: record.runId,
          actionId: sourceAction.actionId as ActionId,
          invocationId: sourceAction.invocationId as InvocationId,
          expectedRecordVersion: record.recordVersion,
          stableSessionId: UUID_A,
          requestId: `00000000-0000-0000-0000-00000000000${index}`,
          resultDigest: `sha256:${String(index).repeat(64)}` as Digest,
          question: {
            problemSummary: `problem ${index}`,
            question: `question ${index}?`,
            attemptedApproaches: [],
            constraints: [],
            evidencePointers: [],
          },
          actor,
          actorAttestation: makeRecordEvidence(sourceAction),
          evidence: [makeRecordEvidence(sourceAction)],
        },
      });
      classifications.push(classified);
      if (
        classified.kind !== 'new' &&
        classified.kind !== 'budget-exhausted'
      ) {
        throw new Error(`unexpected classification ${classified.kind}`);
      }
      record = {
        ...record,
        consultations: {
          ...(record.consultations ?? {}),
          [classified.consultation.consultationId]: {
            ...classified.consultation,
            state: 'closed',
          },
        },
      };
    }
    expect(classifications.map((entry) => entry.kind)).toEqual([
      'new',
      'new',
      'budget-exhausted',
    ]);
    expect(
      classifications.map((entry) =>
        entry.kind === 'conflict' ? -1 : entry.consultation.ordinal
      )
    ).toEqual([1, 2, 3]);
    const exhausted = classifications[2]!;
    if (exhausted.kind !== 'budget-exhausted') return;
    expect(exhausted.consultation).toMatchObject({
      state: 'unavailable',
      failure: { code: 'consultation-limit-exhausted' },
      counters: {
        consultations: { used: 2, max: 2 },
        teacherAttempts: { used: 0, max: 2 },
      },
    });
  });
});
