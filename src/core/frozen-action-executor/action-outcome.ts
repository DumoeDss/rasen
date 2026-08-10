/**
 * Frozen-action session executor: Action-outcome reconciliation (design D4).
 *
 * The session host already returns `turn-outcome-unknown` for an ambiguous
 * interrupted turn and marks a dead generation `interrupted` without resending
 * input (host design Decision 5); the win32 hosted tier latches
 * `transportLost`. This module composes those host-layer facts with the owning
 * daemon/launcher liveness signal into the distinct typed `execution-lost`
 * Action outcome. The mapping lives at the EXECUTOR's reconciliation, not in
 * the host or a provider, because Run/Record outcome typing belongs to the
 * executor with session-host cooperation (Disagreements item 5).
 *
 * Locked decision 11: scope lifetime equals daemon lifetime. Daemon death
 * (hosted) or launcher disappearance (in-tool) types the in-flight Action
 * `execution-lost`; the Run resumes only from the last committed Record
 * frontier, with no reattach and no identity revalidation.
 */

import type { ExecutionBackendId } from './capability-matrix.js';
import type { HostedTurnReceipt } from '../session-host/contracts.js';

/**
 * The typed Action outcomes the executor mints. `execution-lost` is a DISTINCT
 * typed outcome: it is neither generic `uncertain` nor a workload `failed`. A
 * guard proves the three are not reachable for one another's inputs.
 */
export type ActionOutcomeKind =
  | 'succeeded'
  | 'failed'
  | 'execution-lost'
  | 'uncertain';

export interface ActionOutcome {
  readonly kind: ActionOutcomeKind;
  readonly backend: ExecutionBackendId;
  /**
   * The host-layer signal the executor composed to reach this outcome. One of:
   * `daemon-death` / `launcher-disappearance` (the owning-process death that
   * mints execution-lost), `lost-generation` (a hosted lost generation — the
   * scope is no longer controllable even though the daemon process may still be
   * alive; distinct from a literal daemon death), `host-turn` (a settled host
   * turn), `host-ambiguous` (turn-outcome-unknown without a death or lost
   * generation), `host-failure` (a non-death host failure), or
   * `workspace-observation` (the server-owned Teacher mutation guard). Recorded so the
   * mapping is auditable and a mutation that relabels an outcome is detectable.
   */
  readonly source: 'daemon-death' | 'launcher-disappearance' | 'lost-generation' | 'host-turn' | 'host-ambiguous' | 'host-failure' | 'workspace-observation';
  readonly message: string;
  readonly hostedTurn?: HostedTurnFacts;
}

export interface HostedTurnFacts {
  readonly stableSessionId: string;
  readonly backendSessionId?: string;
  readonly requestId: string;
  readonly requestState?: string;
  readonly result?: string;
  readonly resultDigest?: string;
  readonly resultRef?: string;
  readonly receipt?: HostedTurnReceipt;
  readonly replayed: boolean;
  readonly cwd: string;
}

/**
 * The owning-process liveness signal. `hosted` scope lifetime equals daemon
 * lifetime (decision 11), so daemon death IS scope death. `in-tool` lifetime
 * equals launcher lifetime, so launcher disappearance IS execution loss.
 */
export type OwnershipLiveness =
  | { readonly backend: 'hosted'; readonly daemonAlive: boolean }
  | { readonly backend: 'in-tool'; readonly launcherAlive: boolean };

/**
 * The settled result of a turn, abstracted off the concrete `SessionHostOutcome`
 * so this module is unit-testable without the session-host wire types. A
 * `turn-outcome-unknown` with `requestUnfinished: true` is the host's "lost
 * generation" signal (a dead generation with an unfinished request); the
 * executor composes that with liveness to mint `execution-lost`.
 */
export type TurnResult =
  | {
      readonly ok: true;
      readonly status: 'succeeded' | 'failed';
      readonly hostedTurn?: HostedTurnFacts;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly hostedTurn?: HostedTurnFacts;
      /**
       * True when the host could not determine the turn's outcome
       * (`turn-outcome-unknown` or an equivalent ambiguous code). Distinct from
       * a definitive host failure.
       */
      readonly ambiguous: boolean;
      /**
       * True when the unfinished request's commitment state is unknown — the
       * host never settled it. The combination (ambiguous + unfinished) on the
       * hosted backend is the lost-generation execution-lost trigger even
       * before the daemon is observed dead.
       */
      readonly requestUnfinished: boolean;
    };

export interface ReconcileActionOutcomeOptions {
  readonly liveness: OwnershipLiveness;
  /**
   * The turn result. Absent when no turn was ever observed (e.g. the daemon
   * died before any host response reached the executor); that absence combined
   * with a death signal is itself execution-lost.
   */
  readonly turn?: TurnResult;
}

function deathOutcome(
  backend: ExecutionBackendId,
  source: ActionOutcome['source'],
  message: string,
  hostedTurn?: HostedTurnFacts
): ActionOutcome {
  return {
    kind: 'execution-lost',
    backend,
    source,
    message,
    ...(hostedTurn === undefined ? {} : { hostedTurn }),
  };
}

/**
 * Compose the owning-process liveness signal with the host turn result into a
 * typed Action outcome.
 *
 * Discrimination invariants (each proven by a mutation receipt):
 * 1. A death signal (daemon dead on hosted, launcher disappeared on in-tool)
 *    mints `execution-lost`, regardless of any turn result.
 * 2. On the hosted backend, a `turn-outcome-unknown` (ambiguous) with an
 *    unfinished request mints `execution-lost` (the lost-generation case) even
 *    when the daemon is still observed alive.
 * 3. A settled host turn (`ok: true`) mints `succeeded` or `failed`, NEVER
 *    `execution-lost`.
 * 4. A host failure that is neither a death nor a lost-generation ambiguity
 *    mints `uncertain`, NEVER `execution-lost`.
 */
export function reconcileActionOutcome(
  options: ReconcileActionOutcomeOptions
): ActionOutcome {
  const { liveness, turn } = options;
  const backend = liveness.backend;

  // (1) The owning process died. Scope lifetime = daemon/launcher lifetime
  // (decision 11), so the in-flight Action is execution-lost regardless of any
  // turn the host managed to return before death.
  if (liveness.backend === 'hosted' && !liveness.daemonAlive) {
    return deathOutcome(
      backend,
      'daemon-death',
      'The owning daemon died; the hosted scope died with it (scope lifetime equals daemon lifetime). The in-flight Action is execution-lost.'
    );
  }
  if (liveness.backend === 'in-tool' && !liveness.launcherAlive) {
    return deathOutcome(
      backend,
      'launcher-disappearance',
      'The launcher process disappeared; the in-tool worker is gone with it. The in-flight Action is execution-lost.'
    );
  }

  // No turn observed yet and no death: nothing to settle. This is generic
  // uncertainty about an in-flight turn, NOT execution-lost.
  if (turn === undefined) {
    return {
      kind: 'uncertain',
      backend,
      source: 'host-ambiguous',
      message: 'The turn has not settled and no owning-process death was observed.',
    };
  }

  // (3) A settled host turn is a workload outcome, never execution-lost.
  if (turn.ok) {
    return {
      kind: turn.status,
      backend,
      source: 'host-turn',
      message: `The host settled the turn with status ${turn.status}.`,
      ...(turn.hostedTurn === undefined
        ? {}
        : { hostedTurn: turn.hostedTurn }),
    };
  }

  // (2) Hosted lost-generation: an ambiguous turn whose request is unfinished.
  // The host returned turn-outcome-unknown for a dead generation; compose that
  // into execution-lost even when the daemon is still alive (the scope is no
  // longer controllable). On the in-tool backend the equivalent signal is the
  // launcher-disappearance branch above; an ambiguous in-tool turn with the
  // launcher still alive is generic uncertainty, NOT execution-lost.
  if (turn.ambiguous && turn.requestUnfinished && backend === 'hosted') {
    return deathOutcome(
      backend,
      'lost-generation',
      `The host reported ${turn.code} for an unfinished request on a lost generation; the hosted scope is no longer controllable (the daemon process may still be alive). The in-flight Action is execution-lost.`,
      turn.hostedTurn
    );
  }

  // (4) A non-death host failure is generic uncertainty, NOT execution-lost.
  return {
    kind: 'uncertain',
    backend,
    source: turn.ambiguous ? 'host-ambiguous' : 'host-failure',
    message: `The host reported ${turn.code}${turn.ambiguous ? ' (ambiguous)' : ''} without an owning-process death; the turn is uncertain, not execution-lost.`,
    ...(turn.hostedTurn === undefined ? {} : { hostedTurn: turn.hostedTurn }),
  };
}

/**
 * Committed-frontier resume rule (decision 11; requirement "Daemon or launcher
 * death types the in-flight Action execution-lost and resumes only from the
 * committed frontier"). After an execution-lost classification the Run resumes
 * by re-driving ONLY the uncommitted frontier via the Facade. This function
 * partitions a set of invocation commitment states into the already-committed
 * (never re-executed) and the uncommitted (re-driven). It performs no reattach
 * and no identity revalidation; it is a pure partition over recorded state.
 */
export interface InvocationCommitmentState {
  readonly invocationId: string;
  readonly committed: boolean;
}

export interface CommittedFrontierPartition {
  /** Already-committed invocations and effects: never re-executed on resume. */
  readonly committed: readonly InvocationCommitmentState[];
  /** The uncommitted frontier: re-driven by the Facade on resume. */
  readonly uncommitted: readonly InvocationCommitmentState[];
}

export function partitionCommittedFrontier(
  invocations: readonly InvocationCommitmentState[]
): CommittedFrontierPartition {
  const committed: InvocationCommitmentState[] = [];
  const uncommitted: InvocationCommitmentState[] = [];
  for (const invocation of invocations) {
    if (invocation.committed) {
      committed.push(invocation);
    } else {
      uncommitted.push(invocation);
    }
  }
  return Object.freeze({ committed: Object.freeze(committed), uncommitted: Object.freeze(uncommitted) });
}

/**
 * A resend of an already-committed invocation is forbidden on resume. The
 * partition's `committed` set is the sole allowed re-drive boundary; anything
 * in it MUST be skipped. This predicate is the guard the resume path consults
 * before re-driving an invocation.
 */
export function isCommittedInvocation(
  partition: CommittedFrontierPartition,
  invocationId: string
): boolean {
  return partition.committed.some((entry) => entry.invocationId === invocationId);
}
