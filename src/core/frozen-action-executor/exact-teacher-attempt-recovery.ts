import {
  EXACT_TEACHER_ATTEMPT_PHASES,
  type ExactTeacherAttemptJournalRecord,
  type ExactTeacherAttemptPhase,
} from './exact-teacher-attempt-journal.js';
import type { HostedRequestRecord, HostedSessionRecord } from '../session-host/contracts.js';
import {
  isExactScopeEmptyReceipt,
  type ExactScopeEmptyReceipt,
  type ProcessAuthoritySelection,
} from '../session-host/process-authority/index.js';

export interface ExactTeacherCanonicalAttemptIdentity {
  readonly attemptId: string;
  readonly runId: string;
  readonly actionId: string;
  readonly invocationId: string;
  readonly attempt: number;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly settlement?: 'pending' | 'settled';
}

export type ExactTeacherProviderPublicationFact =
  | { readonly state: 'absent' }
  | {
      readonly state: 'prepared-inert' | 'published-inert' | 'exact-scope-empty';
      readonly provider: ProcessAuthoritySelection;
      readonly processRef: string;
    }
  | {
      readonly state: 'authority-uncertain' | 'event-gap';
      readonly diagnostic?: string;
    };

export type ExactTeacherRecoveryOperation =
  | 'capture-stable-baseline'
  | 'prepare-provider-authority'
  | 'publish-provider-authority'
  | 'adopt-durable-publication'
  | 'activate-exact-authority'
  | 'commit-request-send-intent'
  | 'reconcile-request-delivery'
  | 'quarantine-settled-result'
  | 'verify-hosted-receipt'
  | 'commit-retirement-intent'
  | 'reconcile-exact-retirement'
  | 'capture-final-observation'
  | 'validate-quarantined-advice'
  | 'settle-canonical-advice'
  | 'adopt-canonical-settlement';

export interface ExactTeacherAttemptRecoverySafety {
  /** False once activation is durably committed; replacement may never activate again. */
  readonly activationAllowed: boolean;
  /** False once request send intent is durable; replacement may reconcile, never resend. */
  readonly requestSendAllowed: boolean;
  /** Quarantined bytes remain unreadable until the final observation is durable. */
  readonly quarantinedAdviceReadable: boolean;
  /** Exact Session authority may release only after authentic exact empty was committed. */
  readonly sessionReleaseAllowed: boolean;
  /** The sponsored Teacher read follows the same exact-empty release fence. */
  readonly sponsoredReservationReleaseAllowed: boolean;
  /** The paused source writer is owned only by the canonical source lifecycle. */
  readonly sourceWriterReleaseAllowed: false;
}

export type ExactTeacherAttemptRecoveryPlan =
  | {
      readonly state: 'resume';
      readonly operation: ExactTeacherRecoveryOperation;
      readonly safety: ExactTeacherAttemptRecoverySafety;
    }
  | { readonly state: 'complete'; readonly safety: ExactTeacherAttemptRecoverySafety }
  | {
      readonly state: 'retained';
      readonly reason:
        | 'canonical-identity-mismatch'
        | 'canonical-frontier-mismatch'
        | 'session-unavailable'
        | 'session-identity-mismatch'
        | 'request-event-gap'
        | 'publication-event-gap';
      readonly safety: ExactTeacherAttemptRecoverySafety;
    };

export interface PlanExactTeacherAttemptRecoveryInput {
  readonly canonical: ExactTeacherCanonicalAttemptIdentity;
  readonly journal: ExactTeacherAttemptJournalRecord;
  readonly session?: HostedSessionRecord;
  readonly publication: ExactTeacherProviderPublicationFact;
}

export type ExactTeacherPersistedAuthority =
  | {
      readonly state: 'available';
      readonly provider: ProcessAuthoritySelection;
      readonly processRef: string;
    }
  | { readonly state: 'journal-malformed' };

export type ExactTeacherAuthorityRecoveryObservation =
  | { readonly state: 'prepared-inert' | 'published-inert' | 'live' | 'root-exited' }
  | { readonly state: 'exact-scope-empty'; readonly receipt: ExactScopeEmptyReceipt }
  | {
      readonly state:
        | 'declared-unproven'
        | 'timeout'
        | 'control-loss'
        | 'authority-unavailable'
        | 'authority-uncertain'
        | 'foreign-reference'
        | 'stale-reference'
        | 'identity-drift'
        | 'event-gap'
        | 'tuple-mismatch';
    };

export interface ClassifyExactTeacherAuthorityRecoveryInput {
  readonly persisted: ExactTeacherPersistedAuthority;
  readonly observation: ExactTeacherAuthorityRecoveryObservation;
}

interface ExactTeacherAuthorityReleaseDisposition {
  readonly sessionReleaseAllowed: boolean;
  readonly sponsoredReservationReleaseAllowed: boolean;
  readonly adviceAllowed: false;
}

export type ExactTeacherAuthorityRecoveryDisposition =
  | (ExactTeacherAuthorityReleaseDisposition & {
      readonly state: 'recover';
      readonly operation: 'abort-persisted-authority' | 'terminate-persisted-authority';
    })
  | (ExactTeacherAuthorityReleaseDisposition & {
      readonly state: 'retained';
      readonly reason:
        | 'journal-malformed'
        | 'declared-unproven'
        | 'timeout'
        | 'control-loss'
        | 'authority-unavailable'
        | 'authority-uncertain'
        | 'foreign-reference'
        | 'stale-reference'
        | 'identity-drift'
        | 'event-gap'
        | 'tuple-mismatch'
        | 'exact-receipt-mismatch';
    })
  | (ExactTeacherAuthorityReleaseDisposition & {
      readonly state: 'exact-scope-empty';
      readonly receipt: ExactScopeEmptyReceipt;
      readonly sessionReleaseAllowed: true;
      readonly sponsoredReservationReleaseAllowed: true;
    });

const RETAINED_RELEASE_DISPOSITION = Object.freeze({
  sessionReleaseAllowed: false,
  sponsoredReservationReleaseAllowed: false,
  adviceAllowed: false,
} as const);

export function classifyExactTeacherAuthorityRecovery(
  input: ClassifyExactTeacherAuthorityRecoveryInput
): ExactTeacherAuthorityRecoveryDisposition {
  if (input.persisted.state === 'journal-malformed') {
    return Object.freeze({
      state: 'retained',
      reason: 'journal-malformed',
      ...RETAINED_RELEASE_DISPOSITION,
    });
  }

  switch (input.observation.state) {
    case 'prepared-inert':
    case 'published-inert':
      return Object.freeze({
        state: 'recover',
        operation: 'abort-persisted-authority',
        ...RETAINED_RELEASE_DISPOSITION,
      });
    case 'live':
    case 'root-exited':
      return Object.freeze({
        state: 'recover',
        operation: 'terminate-persisted-authority',
        ...RETAINED_RELEASE_DISPOSITION,
      });
    case 'exact-scope-empty':
      if (
        isExactScopeEmptyReceipt(input.observation.receipt) &&
        String(input.observation.receipt.reference) === input.persisted.processRef
      ) {
        return Object.freeze({
          state: 'exact-scope-empty',
          receipt: input.observation.receipt,
          sessionReleaseAllowed: true,
          sponsoredReservationReleaseAllowed: true,
          adviceAllowed: false,
        });
      }
      return Object.freeze({
        state: 'retained',
        reason: 'exact-receipt-mismatch',
        ...RETAINED_RELEASE_DISPOSITION,
      });
    default:
      return Object.freeze({
        state: 'retained',
        reason: input.observation.state,
        ...RETAINED_RELEASE_DISPOSITION,
      });
  }
}

const PHASE_INDEX = new Map<ExactTeacherAttemptPhase, number>(
  EXACT_TEACHER_ATTEMPT_PHASES.map((phase, index) => [phase, index])
);
const SESSION_REQUIRED_FROM = PHASE_INDEX.get('authority-prepared-inert')!;
const PUBLICATION_REQUIRED_FROM = PHASE_INDEX.get('authority-prepared-inert')!;
const PUBLISHED_REQUIRED_FROM = PHASE_INDEX.get('authority-published-inert')!;
const RESULT_REQUIRED_FROM = PHASE_INDEX.get('result-quarantined')!;
const ACTIVATED_PHASE = PHASE_INDEX.get('activated')!;
const REQUEST_SENT_PHASE = PHASE_INDEX.get('request-sent')!;
const EXACT_EMPTY_PHASE = PHASE_INDEX.get('exact-scope-empty')!;
const FINAL_OBSERVATION_PHASE = PHASE_INDEX.get('final-observation-stable')!;

const RETAINED_RECOVERY_SAFETY = Object.freeze({
  activationAllowed: false,
  requestSendAllowed: false,
  quarantinedAdviceReadable: false,
  sessionReleaseAllowed: false,
  sponsoredReservationReleaseAllowed: false,
  sourceWriterReleaseAllowed: false,
} satisfies ExactTeacherAttemptRecoverySafety);

function recoverySafety(phaseIndex: number): ExactTeacherAttemptRecoverySafety {
  const exactEmpty = phaseIndex >= EXACT_EMPTY_PHASE;
  return Object.freeze({
    activationAllowed: phaseIndex < ACTIVATED_PHASE,
    requestSendAllowed: phaseIndex < REQUEST_SENT_PHASE,
    quarantinedAdviceReadable: phaseIndex >= FINAL_OBSERVATION_PHASE,
    sessionReleaseAllowed: exactEmpty,
    sponsoredReservationReleaseAllowed: exactEmpty,
    sourceWriterReleaseAllowed: false,
  });
}

function sameProvider(
  left: ProcessAuthoritySelection,
  right: ProcessAuthoritySelection
): boolean {
  return left.providerId === right.providerId &&
    left.capabilityId === right.capabilityId &&
    left.protocolVersion === right.protocolVersion;
}

function canonicalMatches(
  canonical: ExactTeacherCanonicalAttemptIdentity,
  journal: ExactTeacherAttemptJournalRecord
): boolean {
  return canonical.attemptId === journal.attemptId &&
    canonical.runId === journal.runId &&
    canonical.actionId === journal.actionId &&
    canonical.invocationId === journal.invocationId &&
    canonical.attempt === journal.attempt &&
    canonical.stableSessionId === journal.stableSessionId &&
    canonical.requestId === journal.requestId;
}

function sessionMatches(
  session: HostedSessionRecord,
  journal: ExactTeacherAttemptJournalRecord,
  publication: ExactTeacherProviderPublicationFact
): boolean {
  const facts = session.exactTeacherAttempt;
  const phaseIndex = PHASE_INDEX.get(journal.phase)!;
  const retirementIndex = PHASE_INDEX.get('retirement-pending')!;
  if (
    facts === undefined ||
    session.sessionId !== journal.stableSessionId ||
    facts.attemptId !== journal.attemptId ||
    facts.runId !== journal.runId ||
    facts.actionId !== journal.actionId ||
    facts.invocationId !== journal.invocationId ||
    facts.attempt !== journal.attempt ||
    facts.stableSessionId !== journal.stableSessionId ||
    facts.requestId !== journal.requestId ||
    facts.processRef !== journal.processRef ||
    !sameProvider(facts.provider, journal.provider) ||
    facts.journalRevision !== journal.revision ||
    facts.phase !== journal.phase ||
    facts.baselineIdentity !== journal.baselineIdentity ||
    JSON.stringify(facts.hostedReceipt) !== JSON.stringify(journal.hostedReceipt) ||
    facts.quarantineIdentity !== journal.quarantineIdentity
  ) {
    return false;
  }
  if (
    phaseIndex < retirementIndex &&
    session.process === undefined &&
    publication.state !== 'exact-scope-empty'
  ) {
    return false;
  }
  return session.process === undefined || session.process.runtimeRef === facts.processRef;
}

function matchingRequest(
  session: HostedSessionRecord,
  journal: ExactTeacherAttemptJournalRecord
): HostedRequestRecord | undefined {
  const matching = session.requests.filter(
    (request) => request.requestId === journal.requestId
  );
  if (matching.length !== 1) return undefined;
  const request = matching[0]!;
  if (journal.hostedReceipt === undefined) return request;
  return request.state === 'settled' &&
    request.resultRef === journal.hostedReceipt.resultRef &&
    request.resultDigest === journal.hostedReceipt.resultDigest
    ? request
    : undefined;
}

function publicationMatches(
  publication: ExactTeacherProviderPublicationFact,
  journal: ExactTeacherAttemptJournalRecord,
  phaseIndex: number
): boolean {
  if (phaseIndex < PUBLICATION_REQUIRED_FROM) return publication.state === 'absent';
  if (
    publication.state !== 'prepared-inert' &&
    publication.state !== 'published-inert' &&
    publication.state !== 'exact-scope-empty'
  ) {
    return false;
  }
  if (
    journal.processRef === undefined ||
    publication.processRef !== journal.processRef ||
    !sameProvider(publication.provider, journal.provider)
  ) {
    return false;
  }
  return phaseIndex < PUBLISHED_REQUIRED_FROM ||
    publication.state === 'published-inert' ||
    publication.state === 'exact-scope-empty';
}

function retained(
  reason: Extract<ExactTeacherAttemptRecoveryPlan, { state: 'retained' }>['reason']
): ExactTeacherAttemptRecoveryPlan {
  return Object.freeze({ state: 'retained', reason, safety: RETAINED_RECOVERY_SAFETY });
}

function resume(
  operation: ExactTeacherRecoveryOperation,
  safety: ExactTeacherAttemptRecoverySafety
): ExactTeacherAttemptRecoveryPlan {
  return Object.freeze({ state: 'resume', operation, safety });
}

export function planExactTeacherAttemptRecovery(
  input: PlanExactTeacherAttemptRecoveryInput
): ExactTeacherAttemptRecoveryPlan {
  const phaseIndex = PHASE_INDEX.get(input.journal.phase);
  if (phaseIndex === undefined || !canonicalMatches(input.canonical, input.journal)) {
    return retained('canonical-identity-mismatch');
  }
  const settlement = input.canonical.settlement ?? 'pending';
  if (
    settlement === 'settled' &&
    input.journal.phase !== 'advice-validated' &&
    input.journal.phase !== 'canonical-settled'
  ) {
    return retained('canonical-frontier-mismatch');
  }
  if (!publicationMatches(input.publication, input.journal, phaseIndex)) {
    return retained('publication-event-gap');
  }

  let request: HostedRequestRecord | undefined;
  if (phaseIndex >= SESSION_REQUIRED_FROM) {
    if (input.session === undefined) return retained('session-unavailable');
    if (!sessionMatches(input.session, input.journal, input.publication)) {
      return retained('session-identity-mismatch');
    }
    request = matchingRequest(input.session, input.journal);
    if (request === undefined) return retained('request-event-gap');
    if (phaseIndex >= RESULT_REQUIRED_FROM && request.state !== 'settled') {
      return retained('request-event-gap');
    }
  } else if (input.session !== undefined) {
    return retained('session-identity-mismatch');
  }
  const safety = recoverySafety(phaseIndex);

  switch (input.journal.phase) {
    case 'canonical-preflight':
      return resume('capture-stable-baseline', safety);
    case 'baseline-stable':
      return resume('prepare-provider-authority', safety);
    case 'authority-prepared-inert':
      return input.publication.state === 'published-inert'
        ? resume('adopt-durable-publication', safety)
        : resume('publish-provider-authority', safety);
    case 'authority-published-inert':
      return resume('activate-exact-authority', safety);
    case 'activated':
      return resume('commit-request-send-intent', safety);
    case 'request-sent':
      return request?.state === 'settled'
        ? resume('quarantine-settled-result', safety)
        : request?.state === 'prepared' ||
            request?.state === 'sent' ||
            request?.state === 'ambiguous'
          ? resume('reconcile-request-delivery', safety)
          : retained('request-event-gap');
    case 'result-quarantined':
      return resume('verify-hosted-receipt', safety);
    case 'hosted-receipt-verified':
      return resume('commit-retirement-intent', safety);
    case 'retirement-pending':
      return resume('reconcile-exact-retirement', safety);
    case 'exact-scope-empty':
      return resume('capture-final-observation', safety);
    case 'final-observation-stable':
      return resume('validate-quarantined-advice', safety);
    case 'advice-validated':
      return settlement === 'settled'
        ? resume('adopt-canonical-settlement', safety)
        : resume('settle-canonical-advice', safety);
    case 'canonical-settled':
      return settlement === 'settled'
        ? Object.freeze({ state: 'complete', safety })
        : retained('canonical-frontier-mismatch');
  }
}
