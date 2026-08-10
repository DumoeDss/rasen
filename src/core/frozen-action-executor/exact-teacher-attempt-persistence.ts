import {
  EXACT_TEACHER_SESSION_ATTEMPT_SCHEMA,
  ExactTeacherAttemptRecoveryLoadError,
  type ExactTeacherAttemptPhase,
  type ExactTeacherAttemptPhaseCommit,
  type ExactTeacherAttemptPhaseCommitter,
  type ExactTeacherAttemptSeed,
  type ExactTeacherSessionAttemptFacts,
  type HostedSessionRecord,
} from '../session-host/contracts.js';
import {
  SessionHostRegistryError,
  type SessionHostRegistry,
} from '../session-host/registry.js';
import {
  EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA,
  EXACT_TEACHER_ATTEMPT_PHASES,
  type ExactTeacherAttemptJournal,
  type ExactTeacherAttemptJournalRecord,
} from './exact-teacher-attempt-journal.js';

export interface ExactTeacherAttemptPersistenceOptions {
  readonly journal: ExactTeacherAttemptJournal;
  readonly sessionRegistry: SessionHostRegistry;
}

const PHASE_INDEX = new Map(
  EXACT_TEACHER_ATTEMPT_PHASES.map((phase, index) => [phase, index])
);
const PROCESS_PHASE = PHASE_INDEX.get('authority-prepared-inert')!;
// A competing daemon can hold the registry lease through fsync + atomic
// replace. Cap retries at 32 with up to 320 ms of requested backoff, plus
// registry I/O, while allowing an exact projection to publish idempotently.
const MAX_SESSION_PROJECTION_CAS_ATTEMPTS = 32;
const SESSION_PROJECTION_BUSY_RETRY_MS = 10;

function sameSeed(
  record: ExactTeacherAttemptJournalRecord,
  seed: ExactTeacherAttemptSeed
): boolean {
  return record.attemptId === seed.attemptId &&
    record.provider.providerId === seed.provider.providerId &&
    record.provider.capabilityId === seed.provider.capabilityId &&
    record.provider.protocolVersion === seed.provider.protocolVersion &&
    record.runId === seed.runId &&
    record.actionId === seed.actionId &&
    record.invocationId === seed.invocationId &&
    record.attempt === seed.attempt &&
    record.stableSessionId === seed.stableSessionId &&
    record.requestId === seed.requestId;
}

function sessionFacts(
  record: ExactTeacherAttemptJournalRecord
): ExactTeacherSessionAttemptFacts | undefined {
  if (record.processRef === undefined) return undefined;
  return Object.freeze({
    schema: EXACT_TEACHER_SESSION_ATTEMPT_SCHEMA,
    recordVersion: 1,
    attemptId: record.attemptId,
    provider: Object.freeze({ ...record.provider }),
    processRef: record.processRef,
    runId: record.runId,
    actionId: record.actionId,
    invocationId: record.invocationId,
    attempt: record.attempt,
    stableSessionId: record.stableSessionId,
    requestId: record.requestId,
    journalRevision: record.revision,
    phase: record.phase,
    ...(record.baselineIdentity === undefined
      ? {}
      : { baselineIdentity: record.baselineIdentity }),
    ...(record.hostedReceipt === undefined
      ? {}
      : { hostedReceipt: Object.freeze({ ...record.hostedReceipt }) }),
    ...(record.quarantineIdentity === undefined
      ? {}
      : { quarantineIdentity: record.quarantineIdentity }),
  });
}

function sameFacts(
  left: ExactTeacherSessionAttemptFacts,
  right: ExactTeacherSessionAttemptFacts
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameAuthorityIdentity(
  left: ExactTeacherSessionAttemptFacts,
  right: ExactTeacherSessionAttemptFacts
): boolean {
  return left.schema === right.schema &&
    left.recordVersion === right.recordVersion &&
    left.attemptId === right.attemptId &&
    left.provider.providerId === right.provider.providerId &&
    left.provider.capabilityId === right.provider.capabilityId &&
    left.provider.protocolVersion === right.provider.protocolVersion &&
    left.processRef === right.processRef &&
    left.runId === right.runId &&
    left.actionId === right.actionId &&
    left.invocationId === right.invocationId &&
    left.attempt === right.attempt &&
    left.stableSessionId === right.stableSessionId &&
    left.requestId === right.requestId;
}

function preservesOptionalFacts(
  current: ExactTeacherSessionAttemptFacts,
  projected: ExactTeacherSessionAttemptFacts
): boolean {
  return (current.baselineIdentity === undefined ||
      current.baselineIdentity === projected.baselineIdentity) &&
    (current.hostedReceipt === undefined ||
      JSON.stringify(current.hostedReceipt) === JSON.stringify(projected.hostedReceipt)) &&
    (current.quarantineIdentity === undefined ||
      current.quarantineIdentity === projected.quarantineIdentity);
}

function assertRepairableProjectionGap(
  current: ExactTeacherSessionAttemptFacts | undefined,
  projected: ExactTeacherSessionAttemptFacts
): void {
  if (current === undefined) {
    throw new ExactTeacherAttemptRecoveryLoadError(
      'durable-session-state-unavailable'
    );
  }
  if (!sameAuthorityIdentity(current, projected)) {
    throw new ExactTeacherAttemptRecoveryLoadError(
      'authority-identity-mismatch'
    );
  }
  const currentPhase = PHASE_INDEX.get(current.phase);
  const projectedPhase = PHASE_INDEX.get(projected.phase);
  if (
    currentPhase === undefined ||
    projectedPhase === undefined ||
    projected.journalRevision !== current.journalRevision + 1 ||
    projectedPhase !== currentPhase + 1 ||
    !preservesOptionalFacts(current, projected)
  ) {
    throw new ExactTeacherAttemptRecoveryLoadError('durable-frontier-conflict');
  }
}

async function projectJournalFacts(
  registry: SessionHostRegistry,
  initial: HostedSessionRecord,
  projected: ExactTeacherSessionAttemptFacts
): Promise<HostedSessionRecord> {
  let session = initial;
  for (
    let attempt = 0;
    attempt < MAX_SESSION_PROJECTION_CAS_ATTEMPTS;
    attempt += 1
  ) {
    if (
      session.exactTeacherAttempt !== undefined &&
      sameFacts(session.exactTeacherAttempt, projected)
    ) {
      return session;
    }
    assertRepairableProjectionGap(session.exactTeacherAttempt, projected);
    try {
      return await registry.update(
        session.sessionId,
        { generation: session.generation, revision: session.revision ?? 0 },
        (current) => ({ ...current, exactTeacherAttempt: projected })
      );
    } catch (error) {
      if (
        !(error instanceof SessionHostRegistryError) ||
        (error.code !== 'stale-generation' && error.code !== 'registry-busy')
      ) {
        throw error;
      }
      if (error.code === 'registry-busy') {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, SESSION_PROJECTION_BUSY_RETRY_MS);
        });
      }
    }
    try {
      await registry.load();
    } catch (error) {
      if (error instanceof SessionHostRegistryError) {
        throw new ExactTeacherAttemptRecoveryLoadError(
          'durable-session-state-unavailable'
        );
      }
      throw error;
    }
    const latest = registry.get(projected.stableSessionId);
    if (latest === undefined) {
      throw new ExactTeacherAttemptRecoveryLoadError(
        'durable-session-state-unavailable'
      );
    }
    session = latest;
  }
  if (
    session.exactTeacherAttempt !== undefined &&
    sameFacts(session.exactTeacherAttempt, projected)
  ) {
    return session;
  }
  assertRepairableProjectionGap(session.exactTeacherAttempt, projected);
  throw new ExactTeacherAttemptRecoveryLoadError('durable-frontier-conflict');
}

/**
 * One crash-detecting persistence seam shared by the deep Module and exact
 * SessionHost. Journal commits precede registry projection. A crash between
 * them leaves an explicit frontier mismatch for restart reconciliation; it
 * never rewrites or drops the opaque ProcessRef.
 */
export function createExactTeacherAttemptPersistence(
  options: ExactTeacherAttemptPersistenceOptions
): ExactTeacherAttemptPhaseCommitter {
  const load = (attemptId: string): ExactTeacherSessionAttemptFacts | undefined =>
    sessionFacts(options.journal.load(attemptId)!);

  return Object.freeze({
    load(attemptId: string) {
      const record = options.journal.load(attemptId);
      return record === undefined ? undefined : sessionFacts(record);
    },
    async loadRecovery(attemptId: string) {
      let journal: ExactTeacherAttemptJournalRecord | undefined;
      try {
        journal = options.journal.load(attemptId);
      } catch (error) {
        if (error instanceof TypeError) {
          throw new ExactTeacherAttemptRecoveryLoadError('durable-journal-malformed');
        }
        throw error;
      }
      if (journal === undefined) return undefined;
      let session = journal.processRef === undefined
        ? undefined
        : options.sessionRegistry.get(journal.stableSessionId);
      const projected = sessionFacts(journal);
      if (
        projected !== undefined &&
        session !== undefined &&
        (session.exactTeacherAttempt === undefined ||
          !sameFacts(session.exactTeacherAttempt, projected))
      ) {
        session = await projectJournalFacts(
          options.sessionRegistry,
          session,
          projected
        );
      }
      return Object.freeze({
        journal,
        ...(session === undefined ? {} : { session }),
      });
    },
    async commit(
      seed: ExactTeacherAttemptSeed,
      phase: ExactTeacherAttemptPhase,
      facts: ExactTeacherAttemptPhaseCommit = {}
    ): Promise<void> {
      const targetIndex = PHASE_INDEX.get(phase);
      if (targetIndex === undefined) {
        throw new TypeError('Exact Teacher persistence phase is unknown.');
      }
      let record = options.journal.load(seed.attemptId);
      if (record === undefined) {
        if (phase !== 'canonical-preflight') {
          throw new TypeError('Exact Teacher journal must begin at canonical preflight.');
        }
        record = options.journal.create({
          schema: EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA,
          recordVersion: 1,
          revision: 1,
          ...seed,
          phase,
        });
      } else {
        if (!sameSeed(record, seed)) {
          throw new TypeError('Exact Teacher persistence seed crossed canonical authority.');
        }
        const currentIndex = PHASE_INDEX.get(record.phase)!;
        if (targetIndex > currentIndex + 1) {
          throw new TypeError('Exact Teacher persistence phase has an event gap.');
        }
        if (targetIndex === currentIndex + 1) {
          record = options.journal.advance(seed.attemptId, record.revision, {
            revision: record.revision + 1,
            phase,
            ...(facts.baselineIdentity === undefined
              ? {}
              : { baselineIdentity: facts.baselineIdentity }),
            ...(facts.processRef === undefined ? {} : { processRef: facts.processRef }),
            ...(facts.hostedReceipt === undefined
              ? {}
              : { hostedReceipt: facts.hostedReceipt }),
            ...(facts.quarantineIdentity === undefined
              ? {}
              : { quarantineIdentity: facts.quarantineIdentity }),
          });
        } else if (targetIndex < currentIndex) {
          // The exact provider callback may have durably advanced while its
          // outer Module operation was still returning. Older callbacks are
          // idempotent only when the immutable seed agrees.
          return;
        }
      }

      if (targetIndex < PROCESS_PHASE || facts.deferSessionProjection === true) return;
      const projected = sessionFacts(record);
      if (projected === undefined) {
        throw new TypeError('Exact Teacher persistence lost its opaque ProcessRef.');
      }
      const session = options.sessionRegistry.get(seed.stableSessionId);
      if (session === undefined) {
        throw new TypeError('Exact Teacher Session registry entry is unavailable.');
      }
      if (session.exactTeacherAttempt !== undefined &&
          sameFacts(session.exactTeacherAttempt, projected)) {
        return;
      }
      await projectJournalFacts(options.sessionRegistry, session, projected);
      if (!sameFacts(load(seed.attemptId)!, projected)) {
        throw new TypeError('Exact Teacher persistence reread lost journal identity.');
      }
    },
  });
}
