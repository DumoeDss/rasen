import type {
  ChangeRunReceipt,
  ExactChangeRunRef,
} from '../change-run/contracts.js';
import {
  EXACT_TEACHER_ATTEMPT_PHASES,
  type ExactTeacherAttemptPhase,
} from './exact-teacher-attempt-journal.js';
import {
  classifyExactTeacherAuthorityRecovery,
  planExactTeacherAttemptRecovery,
  type ClassifyExactTeacherAuthorityRecoveryInput,
  type ExactTeacherAuthorityRecoveryDisposition,
  type ExactTeacherAuthorityRecoveryObservation,
  type ExactTeacherAttemptRecoveryPlan,
  type PlanExactTeacherAttemptRecoveryInput,
} from './exact-teacher-attempt-recovery.js';
import type {
  ExactTeacherHostedReceiptIdentity,
  ExactTeacherProviderTuple,
} from '../session-host/contracts.js';
import { ExactTeacherAttemptRecoveryLoadError } from '../session-host/contracts.js';

export interface ExactTeacherAttemptLocator {
  readonly runRef: ExactChangeRunRef;
  readonly teacherActionId: string;
  readonly expectedRecordVersion: number;
}

/**
 * Canonical facts resolved behind the deep Module seam. `canonicalContext` is
 * deliberately opaque: execution callers cannot manufacture or replace it.
 */
export interface ExactTeacherResolvedAttempt {
  readonly attemptId: string;
  readonly runId: string;
  readonly actionId: string;
  readonly invocationId: string;
  readonly attempt: number;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly provider?: ExactTeacherProviderTuple;
  readonly canonicalContext: unknown;
}

export interface ExactTeacherBaselineObservation {
  readonly identity: string;
}

export type ExactTeacherAuthorityPreparation =
  | {
      readonly state: 'prepared-inert';
      readonly processRef: string;
      readonly provider?: ExactTeacherProviderTuple;
      readonly authority: unknown;
    }
  | {
      readonly state: 'authority-unavailable';
      readonly reason: string;
    }
  | {
      readonly state: 'retained';
      readonly reason: string;
    };

export interface ExactTeacherPublishedAuthority {
  readonly state: 'published-inert';
  readonly processRef: string;
  readonly provider?: ExactTeacherProviderTuple;
  readonly authority: unknown;
}

export interface ExactTeacherActivatedAuthority {
  readonly state: 'activated';
  readonly processRef: string;
  readonly provider?: ExactTeacherProviderTuple;
  readonly authority: unknown;
}

export interface ExactTeacherSettledTurn {
  readonly state: 'settled';
  readonly result: string;
  readonly hostedReceipt: ExactTeacherHostedReceiptIdentity;
}

export type ExactTeacherTurnOutcome =
  | ExactTeacherSettledTurn
  | { readonly state: 'retained'; readonly reason: string };

/** Raw result bytes exist only in this internal quarantine value. */
export interface ExactTeacherResultQuarantine {
  readonly identity: string;
  readonly result: string;
  readonly hostedReceipt: ExactTeacherHostedReceiptIdentity;
}

export type ExactTeacherFinalObservation =
  | { readonly state: 'stable'; readonly identity: string }
  | { readonly state: 'failed'; readonly reason: string };

export type ExactTeacherAdviceValidation =
  | { readonly state: 'valid'; readonly advice: unknown }
  | { readonly state: 'invalid'; readonly reason: string };

export interface ExactTeacherAttemptPhaseFacts {
  readonly processRef?: string;
  readonly hostedReceipt?: ExactTeacherHostedReceiptIdentity;
  readonly quarantineIdentity?: string;
  readonly baselineIdentity?: string;
}

export interface CanonicalTeacherAdviceSettlement {
  readonly state: 'canonical-advice-settled';
  readonly receipt: ChangeRunReceipt;
}

export interface CanonicalTeacherUnavailableSettlement {
  readonly state: 'canonical-unavailable-settled';
  readonly reason: string;
  readonly receipt: ChangeRunReceipt;
}

export interface ExactTeacherAuthorityRetained {
  readonly state: 'authority-retained';
  readonly attemptId: string;
  readonly reason: string;
  readonly sessionReleaseAllowed: false;
  readonly sponsoredReservationReleaseAllowed: false;
  readonly adviceAllowed: false;
}

export type ExactTeacherAttemptSettlement =
  | CanonicalTeacherAdviceSettlement
  | CanonicalTeacherUnavailableSettlement
  | ExactTeacherAuthorityRetained;

export type ExactTeacherAttemptRecoveryState = PlanExactTeacherAttemptRecoveryInput;

export type ExactTeacherAttemptRecoveryStep =
  | { readonly state: 'advanced' }
  | { readonly state: 'settled'; readonly settlement: ExactTeacherAttemptSettlement }
  | { readonly state: 'retained'; readonly reason: string };

export interface ExactTeacherAttemptModule {
  executeAndSettle(
    locator: ExactTeacherAttemptLocator
  ): Promise<ExactTeacherAttemptSettlement>;
}

export interface ExactTeacherAttemptModuleOptions {
  readonly resolveCanonicalAttempt: (
    locator: ExactTeacherAttemptLocator
  ) => Promise<ExactTeacherResolvedAttempt>;
  readonly commitPhase: (
    attempt: ExactTeacherResolvedAttempt,
    phase: ExactTeacherAttemptPhase,
    facts?: ExactTeacherAttemptPhaseFacts
  ) => Promise<void>;
  readonly captureBaseline: (
    attempt: ExactTeacherResolvedAttempt
  ) => Promise<ExactTeacherBaselineObservation>;
  readonly prepareAuthority: (
    attempt: ExactTeacherResolvedAttempt
  ) => Promise<ExactTeacherAuthorityPreparation>;
  readonly publishAuthority: (
    attempt: ExactTeacherResolvedAttempt,
    prepared: Extract<ExactTeacherAuthorityPreparation, { state: 'prepared-inert' }>
  ) => Promise<ExactTeacherPublishedAuthority>;
  readonly activateAuthority: (
    attempt: ExactTeacherResolvedAttempt,
    published: ExactTeacherPublishedAuthority
  ) => Promise<ExactTeacherActivatedAuthority>;
  readonly executeOnce: (
    attempt: ExactTeacherResolvedAttempt,
    authority: ExactTeacherActivatedAuthority
  ) => Promise<ExactTeacherTurnOutcome>;
  readonly quarantineResult: (
    attempt: ExactTeacherResolvedAttempt,
    settled: ExactTeacherSettledTurn
  ) => Promise<ExactTeacherResultQuarantine>;
  readonly verifyHostedReceipt: (
    attempt: ExactTeacherResolvedAttempt,
    quarantine: ExactTeacherResultQuarantine
  ) => Promise<boolean>;
  readonly retireAuthority: (
    attempt: ExactTeacherResolvedAttempt,
    authority: ExactTeacherActivatedAuthority
  ) => Promise<ExactTeacherAuthorityRecoveryObservation>;
  readonly classifyAuthorityRecovery?: (
    input: ClassifyExactTeacherAuthorityRecoveryInput
  ) => ExactTeacherAuthorityRecoveryDisposition;
  readonly recoverAuthority: (
    attempt: ExactTeacherResolvedAttempt,
    authority: ExactTeacherActivatedAuthority,
    operation: Extract<
      ExactTeacherAuthorityRecoveryDisposition,
      { state: 'recover' }
    >['operation']
  ) => Promise<ExactTeacherAuthorityRecoveryObservation>;
  readonly releaseSponsoredReservation: (
    attempt: ExactTeacherResolvedAttempt
  ) => Promise<void>;
  readonly captureFinalObservation: (
    attempt: ExactTeacherResolvedAttempt,
    baseline: ExactTeacherBaselineObservation
  ) => Promise<ExactTeacherFinalObservation>;
  readonly validateAdvice: (
    attempt: ExactTeacherResolvedAttempt,
    quarantine: ExactTeacherResultQuarantine
  ) => Promise<ExactTeacherAdviceValidation>;
  readonly settleAdvice: (
    attempt: ExactTeacherResolvedAttempt,
    advice: unknown
  ) => Promise<ChangeRunReceipt>;
  readonly settleUnavailable: (
    attempt: ExactTeacherResolvedAttempt,
    reason: string
  ) => Promise<ChangeRunReceipt>;
  /**
   * Trusted restart-union loader. Common callers still provide only the
   * canonical locator; private journal, Session and provider facts remain
   * behind the Module seam.
   */
  readonly loadRecoveryState?: (
    attempt: ExactTeacherResolvedAttempt
  ) => Promise<ExactTeacherAttemptRecoveryState | undefined>;
  readonly executeRecoveryOperation?: (
    attempt: ExactTeacherResolvedAttempt,
    operation: Extract<ExactTeacherAttemptRecoveryPlan, { state: 'resume' }>['operation'],
    state: ExactTeacherAttemptRecoveryState
  ) => Promise<ExactTeacherAttemptRecoveryStep>;
}

function retained(
  attempt: ExactTeacherResolvedAttempt,
  reason: string
): ExactTeacherAuthorityRetained {
  return Object.freeze({
    state: 'authority-retained',
    attemptId: attempt.attemptId,
    reason,
    sessionReleaseAllowed: false,
    sponsoredReservationReleaseAllowed: false,
    adviceAllowed: false,
  });
}

function exactReceiptFacts(
  quarantine: ExactTeacherResultQuarantine,
  processRef: string
): ExactTeacherAttemptPhaseFacts {
  return Object.freeze({
    processRef,
    hostedReceipt: quarantine.hostedReceipt,
    quarantineIdentity: quarantine.identity,
  });
}

const EXACT_TEACHER_ATTEMPT_FLIGHTS = new Map<
  string,
  Promise<ExactTeacherAttemptSettlement>
>();

function exactTeacherAttemptFlightKey(locator: ExactTeacherAttemptLocator): string {
  return JSON.stringify([
    locator.runRef.change.projectRoot,
    locator.runRef.change.changeId,
    locator.runRef.runId,
    locator.teacherActionId,
    locator.expectedRecordVersion,
  ]);
}

/**
 * Compose the exact Teacher attempt once. The returned object intentionally
 * exposes no lifecycle primitives: common callers can provide only a canonical
 * locator and can receive only canonical settlement or retained authority.
 */
export function createExactTeacherAttemptModule(
  options: ExactTeacherAttemptModuleOptions
): ExactTeacherAttemptModule {
  const classify =
    options.classifyAuthorityRecovery ?? classifyExactTeacherAuthorityRecovery;

  const uncoordinated: ExactTeacherAttemptModule = Object.freeze({
    async executeAndSettle(
      locator: ExactTeacherAttemptLocator
    ): Promise<ExactTeacherAttemptSettlement> {
      const attempt = await options.resolveCanonicalAttempt(locator);
      try {
      const loadRecovery = async () => {
        try {
          return await options.loadRecoveryState?.(attempt);
        } catch (error) {
          if (error instanceof ExactTeacherAttemptRecoveryLoadError) return error;
          throw error;
        }
      };
      let recovery = await loadRecovery();
      if (recovery instanceof ExactTeacherAttemptRecoveryLoadError) {
        return retained(attempt, recovery.reason);
      }
      if (recovery !== undefined) {
        if (options.executeRecoveryOperation === undefined) {
          return retained(attempt, 'durable-recovery-unavailable');
        }
        // One phase per pass keeps every irreversible operation behind a
        // durable reread. The bound is one greater than the phase vocabulary
        // so a buggy/non-advancing Adapter cannot spin forever.
        for (let step = 0; step <= EXACT_TEACHER_ATTEMPT_PHASES.length; step += 1) {
          const plan = planExactTeacherAttemptRecovery(recovery);
          if (plan.state === 'retained') return retained(attempt, plan.reason);
          if (plan.state === 'complete') {
            return retained(attempt, 'canonical-settlement-already-complete');
          }
          const outcome = await options.executeRecoveryOperation(
            attempt,
            plan.operation,
            recovery
          );
          if (outcome.state === 'settled') return outcome.settlement;
          if (outcome.state === 'retained') return retained(attempt, outcome.reason);
          recovery = await loadRecovery();
          if (recovery instanceof ExactTeacherAttemptRecoveryLoadError) {
            return retained(attempt, recovery.reason);
          }
          if (recovery === undefined) {
            return retained(attempt, 'durable-recovery-state-lost');
          }
        }
        return retained(attempt, 'durable-recovery-step-bound-exceeded');
      }
      await options.commitPhase(attempt, 'canonical-preflight');

      const baseline = await options.captureBaseline(attempt);
      await options.commitPhase(attempt, 'baseline-stable', {
        baselineIdentity: baseline.identity,
      });

      const prepared = await options.prepareAuthority(attempt);
      if (prepared.state === 'retained') {
        return retained(attempt, prepared.reason);
      }
      if (prepared.state === 'authority-unavailable') {
        await options.releaseSponsoredReservation(attempt);
        const receipt = await options.settleUnavailable(attempt, prepared.reason);
        return Object.freeze({
          state: 'canonical-unavailable-settled' as const,
          reason: prepared.reason,
          receipt,
        });
      }
      await options.commitPhase(attempt, 'authority-prepared-inert', {
        processRef: prepared.processRef,
      });

      const published = await options.publishAuthority(attempt, prepared);
      if (published.processRef !== prepared.processRef) {
        return retained(attempt, 'published-authority-reference-mismatch');
      }
      await options.commitPhase(attempt, 'authority-published-inert', {
        processRef: published.processRef,
      });

      const activated = await options.activateAuthority(attempt, published);
      if (activated.processRef !== published.processRef) {
        return retained(attempt, 'activated-authority-reference-mismatch');
      }
      await options.commitPhase(attempt, 'activated', {
        processRef: activated.processRef,
      });

      // Durable send intent precedes the exactly-once request. Recovery after
      // this point must reconcile/replay a settled result and never resend.
      await options.commitPhase(attempt, 'request-sent', {
        processRef: activated.processRef,
      });
      const settled = await options.executeOnce(attempt, activated);
      if (settled.state === 'retained') {
        return retained(attempt, settled.reason);
      }
      const quarantine = await options.quarantineResult(attempt, settled);
      const phaseFacts = exactReceiptFacts(quarantine, activated.processRef);
      await options.commitPhase(attempt, 'result-quarantined', phaseFacts);

      if (!(await options.verifyHostedReceipt(attempt, quarantine))) {
        return retained(attempt, 'hosted-receipt-mismatch');
      }
      await options.commitPhase(attempt, 'hosted-receipt-verified', phaseFacts);
      await options.commitPhase(attempt, 'retirement-pending', phaseFacts);

      const persistedProvider =
        activated.provider ?? published.provider ?? prepared.provider ?? attempt.provider;
      if (persistedProvider === undefined) {
        return retained(attempt, 'persisted-provider-tuple-unavailable');
      }
      const persisted = Object.freeze({
        state: 'available' as const,
        provider: persistedProvider,
        processRef: activated.processRef,
      });
      let observation = await options.retireAuthority(attempt, activated);
      let disposition = classify({ persisted, observation });
      if (disposition.state === 'recover') {
        observation = await options.recoverAuthority(
          attempt,
          activated,
          disposition.operation
        );
        disposition = classify({ persisted, observation });
      }
      if (disposition.state === 'recover') {
        return retained(attempt, 'authority-recovery-incomplete');
      }
      if (disposition.state === 'retained') {
        return retained(attempt, disposition.reason);
      }

      await options.commitPhase(attempt, 'exact-scope-empty', phaseFacts);
      await options.releaseSponsoredReservation(attempt);

      const finalObservation = await options.captureFinalObservation(
        attempt,
        baseline
      );
      if (finalObservation.state === 'failed') {
        const receipt = await options.settleUnavailable(
          attempt,
          finalObservation.reason
        );
        return Object.freeze({
          state: 'canonical-unavailable-settled' as const,
          reason: finalObservation.reason,
          receipt,
        });
      }
      await options.commitPhase(attempt, 'final-observation-stable', phaseFacts);

      const validation = await options.validateAdvice(attempt, quarantine);
      if (validation.state === 'invalid') {
        const receipt = await options.settleUnavailable(attempt, validation.reason);
        return Object.freeze({
          state: 'canonical-unavailable-settled' as const,
          reason: validation.reason,
          receipt,
        });
      }
      await options.commitPhase(attempt, 'advice-validated', phaseFacts);
      const receipt = await options.settleAdvice(attempt, validation.advice);
      await options.commitPhase(attempt, 'canonical-settled', phaseFacts);
      return Object.freeze({
        state: 'canonical-advice-settled' as const,
        receipt,
      });
      } catch (error) {
        if (error instanceof ExactTeacherAttemptRecoveryLoadError) {
          return retained(attempt, error.reason);
        }
        throw error;
      }
    },
  });

  return Object.freeze({
    executeAndSettle(locator: ExactTeacherAttemptLocator) {
      const key = exactTeacherAttemptFlightKey(locator);
      const active = EXACT_TEACHER_ATTEMPT_FLIGHTS.get(key);
      if (active !== undefined) return active;
      const flight = uncoordinated.executeAndSettle(locator);
      EXACT_TEACHER_ATTEMPT_FLIGHTS.set(key, flight);
      const clear = (): void => {
        if (EXACT_TEACHER_ATTEMPT_FLIGHTS.get(key) === flight) {
          EXACT_TEACHER_ATTEMPT_FLIGHTS.delete(key);
        }
      };
      void flight.then(clear, clear);
      return flight;
    },
  });
}
