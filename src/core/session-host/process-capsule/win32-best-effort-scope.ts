import {
  ProcessScopeError,
  WIN32_BEST_EFFORT_SCOPE_SEMANTICS,
  type BestEffortScopeDeclaration,
  type DeclaredUnprovenReceipt,
  type DeclaredUnprovenOutcome,
  type LiveProcessScope,
  type PreparedProcessScope,
  type ProcessControlPhase,
  type ProcessObservation,
  type ProcessRef,
  type ProcessScope,
  type TerminationIntent,
  type TerminationReceipt,
} from '../process-scope.js';
import {
  createNativeProcessScope,
  type NativeProcessScopeOptions,
} from './native-process-scope.js';

/**
 * Declared best-effort process scope for win32 hosted sessions.
 *
 * The termination mechanics stay exactly what the legacy ProcessCapsule already
 * measured working on Windows - a Job object per scope, TerminateJobObject on
 * cancel, and KILL_ON_JOB_CLOSE teardown when the daemon dies. This module adds
 * no mechanism at all: it delegates every control verb to an unmodified capsule
 * scope and translates only the vocabulary the hosted seam speaks.
 *
 * The translation exists because the capsule reports an exact tier: a proven
 * scope-empty claim. That claim is not provable at this tier (a Job member can
 * be created with breakaway, and Job accounting is an observation rather than a
 * proof), so the hosted seam declares emptiness unproven before anything starts
 * and every terminal it mints says so.
 *
 * The invariant that carries the whole design: a declared-unproven terminal is
 * mintable ONLY from an actual capsule protocol outcome. Losing the control
 * transport, a protocol violation, and a control timeout each produce a typed
 * uncertain outcome with authority retained - never a terminal, and therefore
 * never a release.
 */

const JOB_EMPTY_LOCAL_DIAGNOSTIC =
  'windows Job accounting observed empty after the capsule acknowledged termination; emptiness is not proven';
const JOB_EMPTY_PROBE_DIAGNOSTIC =
  'windows Job observed empty by the capsule one-shot probe; the scope belongs to a previous daemon lifetime and emptiness is not proven';
const NEVER_ACTIVATED_DIAGNOSTIC = 'no workload ran';

/**
 * The declaration this tier publishes before any workload starts. Both limit
 * flags are literal `false` and no code path can widen them.
 */
export const WIN32_BEST_EFFORT_DECLARATION: BestEffortScopeDeclaration = Object.freeze({
  tier: 'best-effort',
  exactCancel: false,
  scopeEmptyProof: false,
  semantics: WIN32_BEST_EFFORT_SCOPE_SEMANTICS,
});

export type Win32BestEffortProcessScopeOptions = NativeProcessScopeOptions;

interface ScopeState {
  activated: boolean;
  /** Latched on the first cancel; a cancelled scope never settles 'completed'. */
  cancelling: boolean;
  terminal?: DeclaredUnprovenReceipt;
  settleTerminal(receipt: DeclaredUnprovenReceipt): void;
  readonly closed: Promise<DeclaredUnprovenReceipt>;
}

function unprovenReceipt(
  outcome: DeclaredUnprovenOutcome,
  detail: {
    jobObservedEmpty: boolean;
    forced: boolean;
    diagnostic: string;
  }
): DeclaredUnprovenReceipt {
  // `emptiness` is a literal. There is deliberately no branch that can turn a
  // Job-accounting observation into a scope-emptiness proof, and the observation
  // itself is carried only as diagnostic detail.
  return Object.freeze({
    state: 'declared-unproven',
    outcome,
    emptiness: 'unproven',
    groupObservedEmpty: detail.jobObservedEmpty,
    forced: detail.forced,
    diagnostic: detail.diagnostic,
  });
}

function terminationFrom(receipt: DeclaredUnprovenReceipt): TerminationReceipt {
  return {
    state: 'declared-unproven',
    gracefulAttempted: receipt.outcome === 'cancelled',
    forced: receipt.forced,
    unproven: receipt,
  };
}

/**
 * True exactly when the capsule acknowledged its own protocol outcome for the
 * scope end to end. This is the sole gate through which a terminal can be
 * minted; every other capsule result is uncertainty.
 */
function capsuleAcknowledgedEmpty(receipt: TerminationReceipt): boolean {
  return receipt.state === 'closed';
}

function uncertainReceipt(receipt: TerminationReceipt): TerminationReceipt {
  return {
    state: 'uncertain',
    gracefulAttempted: receipt.gracefulAttempted,
    forced: receipt.forced,
    diagnostic: receipt.diagnostic ?? 'capsule control outcome was not observed',
    ...(receipt.failure ? { failure: receipt.failure } : {}),
  };
}

function uncertainFromError(error: unknown, phase: ProcessControlPhase): TerminationReceipt {
  if (error instanceof ProcessScopeError) {
    return {
      state: 'uncertain',
      gracefulAttempted: phase !== 'inspect',
      forced: false,
      diagnostic: error.message,
      failure: {
        code:
          error.code === 'process-control-timeout'
            ? 'process-control-timeout'
            : 'process-control-lost',
        phase: error.phase ?? phase,
      },
    };
  }
  throw error;
}

function uncertainObservationFromError(
  error: unknown,
  phase: ProcessControlPhase
): ProcessObservation {
  if (error instanceof ProcessScopeError) {
    return {
      state: 'uncertain',
      controllable: false,
      diagnostic: error.message,
      failure: {
        code:
          error.code === 'process-control-timeout'
            ? 'process-control-timeout'
            : 'process-control-lost',
        phase: error.phase ?? phase,
      },
    };
  }
  throw error;
}

export function createWin32BestEffortProcessScope(
  options: Win32BestEffortProcessScopeOptions = {}
): ProcessScope {
  const capsule = createNativeProcessScope(options);
  // Scopes this daemon lifetime prepared. A ref absent from this map either
  // belongs to a previous daemon lifetime or was never ours; either way it is
  // reconciled through the capsule's one-shot probe, never adopted as a live
  // scope of this daemon and never re-derived into a control capability.
  const scopes = new Map<ProcessRef, ScopeState>();

  function createState(): ScopeState {
    let settle!: (value: DeclaredUnprovenReceipt) => void;
    const closed = new Promise<DeclaredUnprovenReceipt>((resolve) => {
      settle = resolve;
    });
    const state: ScopeState = {
      activated: false,
      cancelling: false,
      closed,
      settleTerminal(receipt) {
        if (state.terminal) return;
        state.terminal = receipt;
        settle(receipt);
      },
    };
    return state;
  }

  /**
   * Translate a capsule termination result for a scope this daemon prepared.
   * `outcome` is decided by the scope's own lifecycle, never by the capsule's
   * vocabulary.
   */
  function translateTermination(
    state: ScopeState,
    receipt: TerminationReceipt
  ): TerminationReceipt {
    if (!capsuleAcknowledgedEmpty(receipt)) {
      // `retained` means the scope is still live and controllable; it is the
      // capsule's own honest answer and passes through untouched.
      if (receipt.state === 'retained') return receipt;
      return uncertainReceipt(receipt);
    }
    const outcome: DeclaredUnprovenOutcome = state.activated ? 'cancelled' : 'never-activated';
    const unproven = unprovenReceipt(outcome, {
      jobObservedEmpty: state.activated,
      forced: state.activated,
      diagnostic: state.activated ? JOB_EMPTY_LOCAL_DIAGNOSTIC : NEVER_ACTIVATED_DIAGNOSTIC,
    });
    state.settleTerminal(unproven);
    return terminationFrom(unproven);
  }

  /**
   * Translate a capsule termination result for a ref this daemon did not
   * prepare. A Job the probe observed gone is reported as a declared-unproven
   * cancel so stale-record reconciliation can complete honestly instead of
   * wedging the Session forever; the diagnostic names the one-shot observation
   * so the Record never implies this daemon watched the cancel happen.
   */
  function translateForeignTermination(receipt: TerminationReceipt): TerminationReceipt {
    if (!capsuleAcknowledgedEmpty(receipt)) {
      if (receipt.state === 'retained') return receipt;
      return uncertainReceipt(receipt);
    }
    return terminationFrom(
      unprovenReceipt('cancelled', {
        jobObservedEmpty: true,
        forced: true,
        diagnostic: JOB_EMPTY_PROBE_DIAGNOSTIC,
      })
    );
  }

  return {
    async prepare(input): Promise<PreparedProcessScope> {
      // Prepare failures propagate as the capsule typed them: no scope exists,
      // so there is nothing to declare and nothing to translate.
      const prepared = await capsule.prepare(input);
      const state = createState();
      scopes.set(prepared.ref, state);
      return {
        ref: prepared.ref,
        ...(prepared.displayPid !== undefined ? { displayPid: prepared.displayPid } : {}),
        // Attached before activation, so the host records the limits while the
        // workload still does not exist.
        declaration: WIN32_BEST_EFFORT_DECLARATION,
        async activate(): Promise<LiveProcessScope> {
          const live = await prepared.activate();
          state.activated = true;
          // The capsule's own close signal is a protocol outcome and may mint a
          // terminal. Its rejection is transport loss and must not: the hosted
          // terminal simply stays unsettled and authority stays retained.
          void live.closed.then(
            () => {
              state.settleTerminal(
                unprovenReceipt(state.cancelling ? 'cancelled' : 'completed', {
                  jobObservedEmpty: true,
                  forced: state.cancelling,
                  diagnostic: JOB_EMPTY_LOCAL_DIAGNOSTIC,
                })
              );
            },
            () => undefined
          );
          return {
            ref: live.ref,
            ...(live.displayPid !== undefined ? { displayPid: live.displayPid } : {}),
            stdin: live.stdin,
            stdout: live.stdout,
            stderr: live.stderr,
            rootExited: live.rootExited,
            closed: state.closed,
          };
        },
        async abort(reason): Promise<TerminationReceipt> {
          if (state.terminal) return terminationFrom(state.terminal);
          state.cancelling = true;
          let receipt: TerminationReceipt;
          try {
            receipt = await prepared.abort(reason);
          } catch (error) {
            return uncertainFromError(error, 'abort');
          }
          return translateTermination(state, receipt);
        },
      };
    },

    async inspect(ref): Promise<ProcessObservation> {
      const state = scopes.get(ref);
      if (state?.terminal) {
        return { state: 'declared-unproven', controllable: false, terminal: state.terminal };
      }
      let observation: ProcessObservation;
      try {
        observation = await capsule.inspect(ref);
      } catch (error) {
        return uncertainObservationFromError(error, 'inspect');
      }
      if (observation.controllable) return observation;
      if (observation.state === 'foreign' || observation.state === 'uncertain') {
        return observation;
      }
      if (observation.state === 'declared-unproven') return observation;
      // The remaining case is the capsule's exact claim about a Job the one-shot
      // probe found gone. Reported as a declared-unproven completion so a stale
      // record can be reconciled, with the observation named in the diagnostic.
      const terminal = unprovenReceipt('completed', {
        jobObservedEmpty: true,
        forced: false,
        diagnostic: JOB_EMPTY_PROBE_DIAGNOSTIC,
      });
      state?.settleTerminal(terminal);
      return { state: 'declared-unproven', controllable: false, terminal };
    },

    async terminate(ref, intent: TerminationIntent): Promise<TerminationReceipt> {
      const state = scopes.get(ref);
      if (state?.terminal) return terminationFrom(state.terminal);
      if (state) state.cancelling = true;
      let receipt: TerminationReceipt;
      try {
        receipt = await capsule.terminate(ref, intent);
      } catch (error) {
        return uncertainFromError(error, 'terminate');
      }
      return state ? translateTermination(state, receipt) : translateForeignTermination(receipt);
    },
  };
}
