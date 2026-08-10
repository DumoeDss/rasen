import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyExactTeacherAuthorityRecovery,
  planExactTeacherAttemptRecovery,
  type ExactTeacherCanonicalAttemptIdentity,
  type ExactTeacherProviderPublicationFact,
} from '../../../src/core/frozen-action-executor/exact-teacher-attempt-recovery.js';
import {
  EXACT_TEACHER_ATTEMPT_PHASES,
  type ExactTeacherAttemptJournalRecord,
  type ExactTeacherAttemptPhase,
} from '../../../src/core/frozen-action-executor/exact-teacher-attempt-journal.js';
import type { HostedSessionRecord } from '../../../src/core/session-host/contracts.js';
import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  createProcessAuthorityCoordinator,
  createProcessAuthorityPublicationAcknowledgement,
  isExactScopeEmptyReceipt,
  type AuthorityOperationContext,
  type ProcessAuthorityProvider,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  createProviderAuthorityReference,
  encodeProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import { digestSessionHostText } from '../../../src/core/session-host/registry.js';
import { createTestProcessAuthorityProviderRegistry } from '../../helpers/process-authority-test-registry.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];
const provider = {
  providerId: 'test.exact-teacher-recovery',
  capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  protocolVersion: 1,
} as const;
const processRef = encodeProcessAuthorityReference(
  {
    ...provider,
    commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
    providerReferenceVersion: 1,
    semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  },
  createProviderAuthorityReference(1, Buffer.from('teacher-recovery-authority'))
);
const canonical: ExactTeacherCanonicalAttemptIdentity = {
  attemptId: 'attempt:teacher-recovery',
  runId: 'run:teacher-recovery',
  actionId: 'action:teacher-recovery',
  invocationId: 'invocation:teacher-recovery',
  attempt: 1,
  stableSessionId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
};
const receipt = {
  stableSessionId: canonical.stableSessionId,
  requestId: canonical.requestId,
  resultRef: 'host-result:sha256:' + 'a'.repeat(64),
  resultDigest: 'b'.repeat(64),
} as const;
const quarantineIdentity = `quarantine:sha256:${'b'.repeat(64)}`;

class RecoveryProvider implements ProcessAuthorityProvider {
  readonly descriptor = {
    ...provider,
    commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
    providerReferenceVersion: 1,
    semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  } as const;
  readonly reference: ProviderAuthorityReference;

  constructor(identity: string) {
    this.reference = createProviderAuthorityReference(1, Buffer.from(identity));
  }

  async prepare() {
    return {
      reference: this.reference,
      async activate(_context: AuthorityOperationContext) {
        return { state: 'live' as const };
      },
    };
  }
  async inspect() { return { state: 'root-exited' as const, code: 0, signal: null }; }
  async terminate() { return { state: 'exact-scope-empty' as const }; }
  async abort() { return { state: 'exact-scope-empty' as const }; }
}

async function authenticEmpty(identity: string) {
  const exactProvider = new RecoveryProvider(identity);
  let operation = 0;
  const coordinator = createProcessAuthorityCoordinator({
    registry: createTestProcessAuthorityProviderRegistry([exactProvider]),
    operationId: () => `teacher-recovery-${identity}-${++operation}`,
  });
  const prepared = await coordinator.prepare(provider, {
    command: process.execPath,
    args: [],
    cwd: process.cwd(),
    env: {},
  });
  if (prepared.state !== 'prepared-inert') throw new Error('fixture prepare failed');
  const published = await prepared.publish(async (binding) =>
    createProcessAuthorityPublicationAcknowledgement(binding));
  if (published.state !== 'published-inert') throw new Error('fixture publish failed');
  const exact = await published.abort('fixture-empty');
  if (!isExactScopeEmptyReceipt(exact)) throw new Error('fixture receipt was not authentic');
  return exact;
}

function temporaryCwd(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-teacher-recovery-'));
  roots.push(root);
  return fs.realpathSync.native(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

function journal(phase: ExactTeacherAttemptPhase): ExactTeacherAttemptJournalRecord {
  const phaseIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(phase);
  const processIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf('authority-prepared-inert');
  const receiptIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf('result-quarantined');
  return {
    schema: 'rasen-exact-teacher-attempt-journal/1',
    recordVersion: 1,
    revision: phaseIndex + 1,
    ...canonical,
    provider,
    ...(phaseIndex < processIndex ? {} : { processRef: String(processRef) }),
    ...(phaseIndex < receiptIndex ? {} : { hostedReceipt: receipt }),
    ...(phaseIndex < receiptIndex ? {} : { quarantineIdentity }),
    phase,
  };
}

function session(
  cwd: string,
  phase: ExactTeacherAttemptPhase,
  requestState: 'prepared' | 'sent' | 'settled' | 'ambiguous' =
    EXACT_TEACHER_ATTEMPT_PHASES.indexOf(phase) >=
      EXACT_TEACHER_ATTEMPT_PHASES.indexOf('result-quarantined')
      ? 'settled'
      : 'prepared'
): HostedSessionRecord {
  const current = journal(phase);
  const exact = {
    schema: 'rasen-exact-teacher-session-attempt/1' as const,
    recordVersion: 1 as const,
    ...canonical,
    provider,
    processRef: String(processRef),
    journalRevision: current.revision,
    phase,
    ...(current.hostedReceipt === undefined
      ? {}
      : { hostedReceipt: current.hostedReceipt }),
    ...(current.quarantineIdentity === undefined
      ? {}
      : { quarantineIdentity: current.quarantineIdentity }),
  };
  return {
    sessionId: canonical.stableSessionId,
    backend: 'hosted',
    cwd,
    cwdDigest: digestSessionHostText(cwd),
    hostState: requestState === 'ambiguous' ? 'interrupted' : 'idle',
    generation: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    requests: [{
      requestId: canonical.requestId,
      inputDigest: 'c'.repeat(64),
      generation: 1,
      state: requestState,
      preparedAt: '2026-08-10T00:00:00.000Z',
      ...(requestState === 'sent' || requestState === 'settled'
        ? { sentAt: '2026-08-10T00:00:01.000Z' }
        : {}),
      ...(requestState === 'settled'
        ? {
            settledAt: '2026-08-10T00:00:02.000Z',
            resultRef: receipt.resultRef,
            resultDigest: receipt.resultDigest,
          }
        : {}),
    }],
    ...(EXACT_TEACHER_ATTEMPT_PHASES.indexOf(phase) >=
      EXACT_TEACHER_ATTEMPT_PHASES.indexOf('exact-scope-empty')
      ? {}
      : {
          process: {
            generation: 1,
            ownerToken: 'teacher-recovery-owner',
            runtimeRef: String(processRef),
            preparedAt: '2026-08-10T00:00:00.000Z',
          },
        }),
    exactTeacherAttempt: exact,
  };
}

function publication(phase: ExactTeacherAttemptPhase): ExactTeacherProviderPublicationFact {
  const phaseIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(phase);
  const preparedIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf('authority-prepared-inert');
  const publishedIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf('authority-published-inert');
  if (phaseIndex < preparedIndex) return { state: 'absent' };
  return {
    state: phaseIndex < publishedIndex ? 'prepared-inert' : 'published-inert',
    provider,
    processRef: String(processRef),
  };
}

function expectedSafety(phase: ExactTeacherAttemptPhase) {
  const phaseIndex = EXACT_TEACHER_ATTEMPT_PHASES.indexOf(phase);
  const exactEmpty = phaseIndex >=
    EXACT_TEACHER_ATTEMPT_PHASES.indexOf('exact-scope-empty');
  return {
    activationAllowed:
      phaseIndex < EXACT_TEACHER_ATTEMPT_PHASES.indexOf('activated'),
    requestSendAllowed:
      phaseIndex < EXACT_TEACHER_ATTEMPT_PHASES.indexOf('request-sent'),
    quarantinedAdviceReadable:
      phaseIndex >= EXACT_TEACHER_ATTEMPT_PHASES.indexOf('final-observation-stable'),
    sessionReleaseAllowed: exactEmpty,
    sponsoredReservationReleaseAllowed: exactEmpty,
    sourceWriterReleaseAllowed: false,
  } as const;
}

describe('exact Teacher attempt phase recovery planner', () => {
  it('maps every replacement frontier to one operation and durable safety disposition', () => {
    const cwd = temporaryCwd();
    const expected = [
      'capture-stable-baseline',
      'prepare-provider-authority',
      'publish-provider-authority',
      'activate-exact-authority',
      'commit-request-send-intent',
      'reconcile-request-delivery',
      'verify-hosted-receipt',
      'commit-retirement-intent',
      'reconcile-exact-retirement',
      'capture-final-observation',
      'validate-quarantined-advice',
      'settle-canonical-advice',
      'complete',
    ] as const;

    for (const [index, phase] of EXACT_TEACHER_ATTEMPT_PHASES.entries()) {
      const plan = planExactTeacherAttemptRecovery({
        canonical: phase === 'canonical-settled'
          ? { ...canonical, settlement: 'settled' }
          : canonical,
        journal: journal(phase),
        session: index < 2 ? undefined : session(cwd, phase),
        publication: publication(phase),
      });
      expect(plan, phase).toEqual(
        expected[index] === 'complete'
          ? { state: 'complete', safety: expectedSafety(phase) }
          : {
              state: 'resume',
              operation: expected[index],
              safety: expectedSafety(phase),
            }
      );
    }
  });

  it('never resends after request intent and quarantines only a settled matching result', () => {
    const cwd = temporaryCwd();
    for (const state of ['prepared', 'sent', 'ambiguous'] as const) {
      expect(planExactTeacherAttemptRecovery({
        canonical,
        journal: journal('request-sent'),
        session: session(cwd, 'request-sent', state),
        publication: publication('request-sent'),
      })).toMatchObject({
        state: 'resume',
        operation: 'reconcile-request-delivery',
        safety: { activationAllowed: false, requestSendAllowed: false },
      });
    }
    expect(planExactTeacherAttemptRecovery({
      canonical,
      journal: journal('request-sent'),
      session: session(cwd, 'request-sent', 'settled'),
      publication: publication('request-sent'),
    })).toMatchObject({
      state: 'resume',
      operation: 'quarantine-settled-result',
      safety: { activationAllowed: false, requestSendAllowed: false },
    });
  });

  it('accepts a settled Session without a process after authenticated exact-empty recovery', () => {
    const cwd = temporaryCwd();
    const currentSession = session(cwd, 'request-sent', 'settled');
    expect(planExactTeacherAttemptRecovery({
      canonical,
      journal: journal('request-sent'),
      session: { ...currentSession, process: undefined },
      publication: {
        state: 'exact-scope-empty',
        provider,
        processRef: String(processRef),
      },
    })).toMatchObject({
      state: 'resume',
      operation: 'quarantine-settled-result',
      safety: { activationAllowed: false, requestSendAllowed: false },
    });
  });

  it('adopts only authenticated durable work that is ahead at a known commit boundary', () => {
    const cwd = temporaryCwd();
    expect(planExactTeacherAttemptRecovery({
      canonical,
      journal: journal('authority-prepared-inert'),
      session: session(cwd, 'authority-prepared-inert'),
      publication: {
        state: 'published-inert',
        provider,
        processRef: String(processRef),
      },
    })).toMatchObject({ state: 'resume', operation: 'adopt-durable-publication' });

    expect(planExactTeacherAttemptRecovery({
      canonical: { ...canonical, settlement: 'settled' },
      journal: journal('advice-validated'),
      session: session(cwd, 'advice-validated'),
      publication: publication('advice-validated'),
    })).toMatchObject({ state: 'resume', operation: 'adopt-canonical-settlement' });
  });

  it('fails closed on crossed canonical, Session, publication, or frontier identity', () => {
    const cwd = temporaryCwd();
    const currentJournal = journal('result-quarantined');
    const currentSession = session(cwd, 'result-quarantined');
    const currentPublication = publication('result-quarantined');
    const cases = [
      {
        canonical: { ...canonical, actionId: 'action:crossed' },
        session: currentSession,
        publication: currentPublication,
      },
      {
        canonical,
        session: {
          ...currentSession,
          exactTeacherAttempt: {
            ...currentSession.exactTeacherAttempt!,
            requestId: '33333333-3333-4333-8333-333333333333',
          },
        },
        publication: currentPublication,
      },
      {
        canonical,
        session: currentSession,
        publication: {
          ...currentPublication,
          provider: { ...provider, protocolVersion: 2 },
        } as ExactTeacherProviderPublicationFact,
      },
      {
        canonical,
        session: {
          ...currentSession,
          exactTeacherAttempt: {
            ...currentSession.exactTeacherAttempt!,
            journalRevision: currentJournal.revision - 1,
            phase: 'request-sent' as const,
            hostedReceipt: undefined,
            quarantineIdentity: undefined,
          },
        },
        publication: currentPublication,
      },
      {
        canonical,
        session: {
          ...session(cwd, 'request-sent'),
          process: undefined,
        },
        publication: publication('request-sent'),
        journal: journal('request-sent'),
      },
    ];

    for (const value of cases) {
      expect(planExactTeacherAttemptRecovery({
        ...value,
        journal: value.journal ?? currentJournal,
      })).toMatchObject({ state: 'retained' });
    }
  });

  it('recovers only through the persisted authority and retains every unsafe outcome', async () => {
    const recoveryCases = [
      ['prepared-inert', 'abort-persisted-authority'],
      ['published-inert', 'abort-persisted-authority'],
      ['live', 'terminate-persisted-authority'],
      ['root-exited', 'terminate-persisted-authority'],
    ] as const;
    for (const [state, operation] of recoveryCases) {
      expect(classifyExactTeacherAuthorityRecovery({
        persisted: { state: 'available', provider, processRef: String(processRef) },
        observation: { state },
      })).toEqual({
        state: 'recover',
        operation,
        sessionReleaseAllowed: false,
        sponsoredReservationReleaseAllowed: false,
        adviceAllowed: false,
      });
    }

    for (const state of [
      'declared-unproven',
      'timeout',
      'control-loss',
      'authority-unavailable',
      'authority-uncertain',
      'foreign-reference',
      'stale-reference',
      'identity-drift',
      'event-gap',
      'tuple-mismatch',
    ] as const) {
      expect(classifyExactTeacherAuthorityRecovery({
        persisted: { state: 'available', provider, processRef: String(processRef) },
        observation: { state },
      })).toMatchObject({
        state: 'retained',
        sessionReleaseAllowed: false,
        sponsoredReservationReleaseAllowed: false,
        adviceAllowed: false,
      });
    }
    expect(classifyExactTeacherAuthorityRecovery({
      persisted: { state: 'journal-malformed' },
      observation: { state: 'authority-uncertain' },
    })).toMatchObject({
      state: 'retained',
      reason: 'journal-malformed',
      sessionReleaseAllowed: false,
      sponsoredReservationReleaseAllowed: false,
      adviceAllowed: false,
    });
  });

  it('accepts only an authentic exact-empty receipt for the persisted ProcessRef', async () => {
    const matching = await authenticEmpty('matching-authority');
    const foreign = await authenticEmpty('foreign-authority');
    const persisted = {
      state: 'available' as const,
      provider,
      processRef: String(matching.reference),
    };

    expect(classifyExactTeacherAuthorityRecovery({
      persisted,
      observation: { state: 'exact-scope-empty', receipt: matching },
    })).toMatchObject({
      state: 'exact-scope-empty',
      receipt: matching,
      sessionReleaseAllowed: true,
      sponsoredReservationReleaseAllowed: true,
      adviceAllowed: false,
    });
    for (const candidate of [Object.freeze({ ...matching }), foreign]) {
      expect(classifyExactTeacherAuthorityRecovery({
        persisted,
        observation: {
          state: 'exact-scope-empty',
          receipt: candidate as typeof matching,
        },
      })).toMatchObject({
        state: 'retained',
        reason: 'exact-receipt-mismatch',
        sessionReleaseAllowed: false,
        sponsoredReservationReleaseAllowed: false,
        adviceAllowed: false,
      });
    }
  });
});
