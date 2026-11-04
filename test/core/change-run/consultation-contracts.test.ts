import { describe, expect, it } from 'vitest';

import {
  CONSULTATION_SERVER_LIMITS,
  decodeAgentContinuationGrant,
  decodeConsultationContinuationSettlement,
  decodeConsultationQuestion,
  decodeConsultationStepSubmission,
  decodeTeacherConsultationAdvice,
  decodeTeacherConsultationResume,
  deriveConsultationId,
  deriveContinuationRequestId,
  deriveFreshStepRequestId,
  digestContinuationInput,
  digestTeacherConsultationAdvice,
} from '../../../src/core/change-run/consultation-contracts.js';
import type {
  ActionId,
  AttemptId,
  RunId,
} from '../../../src/core/change-run/contracts.js';

const RUN = `run:${'1'.repeat(64)}` as RunId;
const ACTION = `action:${'2'.repeat(64)}` as ActionId;
const ATTEMPT = `attempt:${'3'.repeat(64)}` as AttemptId;
const LIMITS = {
  maxQuestionBytes: 4096,
  maxAdviceBytes: 8192,
  maxAttemptedApproaches: 4,
  maxConstraints: 4,
  maxEvidencePointers: 4,
  maxAdviceSteps: 8,
  maxCautions: 4,
  maxEvidenceNotes: 4,
} as const;

function settledReceipt(requestId: string) {
  return {
    format: 'rasen-session-host-turn-receipt/1' as const,
    stableSessionId: '11111111-1111-1111-1111-111111111111',
    backend: 'hosted',
    requestId,
    requestState: 'settled' as const,
    cwd: '/root',
    cwdDigest: '8'.repeat(64),
    sandbox: 'workspace-write' as const,
    resultRef: `host-result:sha256:${'7'.repeat(64)}`,
    resultDigest: '7'.repeat(64),
    result: '{"status":"DONE"}',
    replayed: false,
  };
}

describe('teacher consultation frozen contracts', () => {
  it('derives stable, domain-separated consultation and request identities', () => {
    const consultation = deriveConsultationId(RUN, ACTION, 1);
    expect(deriveConsultationId(RUN, ACTION, 1)).toBe(consultation);
    expect(deriveConsultationId(RUN, ACTION, 2)).not.toBe(consultation);
    expect(deriveFreshStepRequestId(RUN, ACTION, ATTEMPT)).toMatch(
      /^[0-9a-f-]{36}$/
    );
    expect(
      deriveContinuationRequestId(
        consultation,
        `sha256:${'4'.repeat(64)}` as never
      )
    ).not.toBe(deriveFreshStepRequestId(RUN, ACTION, ATTEMPT));
  });

  it('strictly bounds questions and rejects authority fields', () => {
    const question = {
      problemSummary: 'type inference stalls',
      question: 'Which boundary should own the decoder?',
      attemptedApproaches: ['inline parsing'],
      constraints: ['legacy digest compatibility'],
      evidencePointers: ['src/core/change-run/contracts.ts'],
    };
    expect(decodeConsultationQuestion(question, LIMITS)).toEqual(question);
    expect(() =>
      decodeConsultationQuestion(
        { ...question, model: 'stronger-model' },
        LIMITS
      )
    ).toThrow(/invalid/i);
    expect(() =>
      decodeConsultationQuestion(
        { ...question, attemptedApproaches: ['1', '2', '3', '4', '5'] },
        LIMITS
      )
    ).toThrow(/collection bounds/i);
  });

  it('correlates resume advice and its canonical digest', () => {
    const consultationId = deriveConsultationId(RUN, ACTION, 1);
    const advice = decodeTeacherConsultationAdvice(
      {
        contract: 'teacher-consultation/advice/1',
        consultationId,
        teacherAttempt: 1,
        decision: 'correction',
        rationale: 'Keep the existing leaf contract closed.',
        steps: ['Introduce a separate parser.'],
        cautions: ['Do not widen legacy schemas.'],
        evidenceNotes: [],
      },
      LIMITS
    );
    const adviceDigest = digestTeacherConsultationAdvice(advice);
    expect(
      decodeTeacherConsultationResume(
        {
          contract: 'teacher-consultation/resume/1',
          consultationId,
          adviceDigest,
          advice,
        },
        LIMITS
      ).advice.decision
    ).toBe('correction');
    expect(() =>
      decodeTeacherConsultationResume(
        {
          contract: 'teacher-consultation/resume/1',
          consultationId,
          adviceDigest: `sha256:${'9'.repeat(64)}`,
          advice,
        },
        LIMITS
      )
    ).toThrow(/digest/i);
  });

  it('keeps all server maxima finite and positive', () => {
    expect(Object.values(CONSULTATION_SERVER_LIMITS).every((value) => value > 0)).toBe(true);
  });

  it('strictly decodes and correlates continuation grants and settlements', () => {
    const consultationId = deriveConsultationId(RUN, ACTION, 1);
    const input = {
      contract: 'teacher-consultation/unavailable/1' as const,
      consultationId,
      reason: 'teacher-unavailable' as const,
      consultations: { used: 1, max: 2 },
      teacherAttempts: { used: 1, max: 2 },
      detail: 'The frozen Teacher route is temporarily unavailable.',
    };
    const inputDigest = digestContinuationInput(input);
    const requestId = deriveContinuationRequestId(consultationId, inputDigest);
    const grant = {
      format: 'teacher-consultation/continuation-grant/1' as const,
      runId: RUN,
      sourceActionId: ACTION,
      sourceInvocationId: `invocation:${'5'.repeat(64)}`,
      sourceAttemptId: ATTEMPT,
      consultationId,
      stableSessionId: '11111111-1111-1111-1111-111111111111',
      requestId,
      expectedRecordVersion: 3,
      backend: 'hosted' as const,
      role: 'implementer',
      workspaceInstanceId: `workspace-instance:${'6'.repeat(64)}`,
      inputDigest,
      input,
    };
    expect(decodeAgentContinuationGrant(grant, LIMITS)).toEqual(grant);
    expect(() =>
      decodeAgentContinuationGrant(
        { ...grant, inputDigest: `sha256:${'9'.repeat(64)}` },
        LIMITS
      )
    ).toThrow(/digest|identity/i);
    expect(
      decodeConsultationContinuationSettlement({
        format: 'teacher-consultation/continuation-settlement/1',
        runId: RUN,
        sourceActionId: ACTION,
        consultationId,
        requestId,
        expectedRecordVersion: 4,
        outcome: 'settled',
        receipt: settledReceipt(requestId),
      }).outcome
    ).toBe('settled');
    expect(() =>
      decodeConsultationContinuationSettlement({
        format: 'teacher-consultation/continuation-settlement/1',
        runId: RUN,
        sourceActionId: ACTION,
        consultationId,
        requestId,
        expectedRecordVersion: 4,
        outcome: 'ambiguous',
        receipt: settledReceipt(requestId),
      })
    ).toThrow(/sent or ambiguous/i);
  });

  it('rejects settled continuation detail that would otherwise be ignored', () => {
    const consultationId = deriveConsultationId(RUN, ACTION, 1);
    const requestId = deriveContinuationRequestId(
      consultationId,
      `sha256:${'4'.repeat(64)}` as never
    );
    expect(() =>
      decodeConsultationContinuationSettlement({
        format: 'teacher-consultation/continuation-settlement/1',
        runId: RUN,
        sourceActionId: ACTION,
        consultationId,
        requestId,
        expectedRecordVersion: 4,
        outcome: 'settled',
        receipt: settledReceipt(requestId),
        detail: 'not part of a settled result',
      })
    ).toThrow(/cannot claim ambiguous detail/i);
  });

  it('rejects unknown runtime-owned authority fields before decoding evidence', () => {
    expect(() =>
      decodeConsultationStepSubmission(
        {
          format: 'teacher-consultation/submission/1',
          runId: RUN,
          actionId: ACTION,
          invocationId: `invocation:${'5'.repeat(64)}`,
          expectedRecordVersion: 3,
          stableSessionId: '11111111-1111-1111-1111-111111111111',
          requestId: '22222222-2222-2222-2222-222222222222',
          resultDigest: `sha256:${'7'.repeat(64)}`,
          question: {
            problemSummary: 'x',
            question: 'y?',
            attemptedApproaches: [],
            constraints: [],
            evidencePointers: [],
          },
          actor: {},
          actorAttestation: {},
          evidence: [],
          model: 'caller-substitution',
        },
        LIMITS
      )
    ).toThrow();
  });
});
