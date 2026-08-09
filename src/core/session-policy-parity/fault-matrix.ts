/**
 * Session-policy-and-control-parity: the exhaustive cancel/restart/ack-loss
 * fault-injection matrix (slice acceptance 4; design D3).
 *
 * The frozen-action executor shipped the `execution-lost` mechanism plus
 * committed-frontier resume and representative receipts; this module is the
 * authoritative enumeration of the seven named failure modes the slice
 * acceptance requires, crossed with the recovery invariants each must satisfy.
 * Each mode is exercised by the harness at the executor's injectable
 * `HostedBackendSeam` / `InToolBackendSeam` (the same interface the real
 * session host satisfies), so the exercised path is the production execution
 * path, never a parallel fixture (task 3.1 guard).
 *
 * This module holds the enumeration and the coverage guard; the harness
 * (`test/core/session-policy-parity/fault-matrix.test.ts`) injects each fault
 * at the shipped seam and asserts the recovery invariants. It consumes the
 * executor's typed outcomes; it does not modify the executor module.
 */
import type { ExecutionBackendId } from '../frozen-action-executor/capability-matrix.js';
import type { ActionOutcomeKind } from '../frozen-action-executor/action-outcome.js';

/**
 * The seven named failure modes (slice acceptance 4). Host/daemon restart is
 * ONE mode exercised for BOTH the host process (lost-generation) and the daemon
 * process (daemon-death), so the harness runs eight cells. Adding a failure
 * mode is one table row plus its harness cell; the coverage guard (task 3.1)
 * flags any uncovered mode.
 */
export const FAULT_MODES = Object.freeze([
  'cancel-before-start',
  'cancel-in-flight',
  'host-restart',
  'daemon-restart',
  'worker-process-loss',
  'completion-ack-loss',
  'duplicate-completion',
  'stale-control',
] as const);

export type FaultMode = (typeof FAULT_MODES)[number];

/**
 * The recovery invariants every matrix entry must satisfy (task 3.2).
 * - `committed-frontier-only`: recovery continues only the uncommitted
 *   frontier; already-committed invocations and effects are never re-executed.
 * - `no-resend`: an input whose commitment state is unknown is never resent.
 * - `no-reexecute`: a committed invocation is never re-driven on resume.
 * - `fail-closed-on-unprovable`: unprovable state is typed-waited or escalated,
 *   never silently completed or silently dropped.
 * - `execution-lost-composition`: daemon death (hosted) / launcher
 *   disappearance (in-tool) compose into the typed `execution-lost` outcome.
 */
export const RECOVERY_INVARIANTS = Object.freeze([
  'committed-frontier-only',
  'no-resend',
  'no-reexecute',
  'fail-closed-on-unprovable',
  'execution-lost-composition',
] as const);

export type RecoveryInvariant = (typeof RECOVERY_INVARIANTS)[number];

/**
 * The expected behaviour for one matrix cell: the backend the fault is injected
 * on, the typed outcome kind the executor's reconciliation must produce, and the
 * recovery invariants the harness asserts for the cell. The `outcomeKind` is
 * the SPECIFIC typed result only the shipped `reconcileActionOutcome` /
 * `validateGrantedAction` produce for this fault — asserting it is the
 * anti-theater proof that the harness drove the production path (a parallel
 * fixture could not produce these exact typed outcomes).
 */
export interface FaultModeSpec {
  readonly mode: FaultMode;
  readonly backend: ExecutionBackendId;
  readonly outcomeKind: ActionOutcomeKind | 'rejected' | 'duplicate' | 'authority-unavailable';
  readonly invariants: readonly RecoveryInvariant[];
}

/**
 * The authoritative mode x invariant table. The harness reads this and injects
 * each fault at the shipped seam; the coverage guard ensures every mode is
 * exercised. `execution-lost` outcomes carry the source the shipped
 * `reconcileActionOutcome` mints for the fault (daemon-death / lost-generation /
 * launcher-disappearance), asserted by the harness as the anti-theater guard.
 */
export const FAULT_MODE_SPECS: readonly FaultModeSpec[] = Object.freeze([
  {
    mode: 'cancel-before-start',
    backend: 'hosted',
    outcomeKind: 'uncertain',
    invariants: ['committed-frontier-only', 'no-reexecute'],
  },
  {
    mode: 'cancel-in-flight',
    backend: 'hosted',
    outcomeKind: 'execution-lost',
    invariants: ['committed-frontier-only', 'no-resend', 'no-reexecute', 'execution-lost-composition'],
  },
  {
    mode: 'host-restart',
    backend: 'hosted',
    outcomeKind: 'execution-lost',
    invariants: ['committed-frontier-only', 'no-resend', 'execution-lost-composition'],
  },
  {
    mode: 'daemon-restart',
    backend: 'hosted',
    outcomeKind: 'execution-lost',
    invariants: ['committed-frontier-only', 'no-resend', 'no-reexecute', 'execution-lost-composition'],
  },
  {
    mode: 'worker-process-loss',
    backend: 'in-tool',
    outcomeKind: 'execution-lost',
    invariants: ['committed-frontier-only', 'no-resend', 'no-reexecute', 'execution-lost-composition'],
  },
  {
    mode: 'completion-ack-loss',
    backend: 'hosted',
    outcomeKind: 'succeeded',
    invariants: ['fail-closed-on-unprovable'],
  },
  {
    mode: 'duplicate-completion',
    backend: 'hosted',
    outcomeKind: 'duplicate',
    invariants: ['fail-closed-on-unprovable'],
  },
  {
    mode: 'stale-control',
    backend: 'hosted',
    outcomeKind: 'rejected',
    invariants: ['fail-closed-on-unprovable'],
  },
]);

/**
 * The coverage guard (task 3.1): every declared fault mode MUST be exercised by
 * the harness. Returns the set of missing modes (empty = full coverage).
 */
export function uncoveredFaultModes(
  exercised: readonly FaultMode[]
): readonly FaultMode[] {
  const seen = new Set(exercised);
  return FAULT_MODES.filter((mode) => !seen.has(mode));
}
