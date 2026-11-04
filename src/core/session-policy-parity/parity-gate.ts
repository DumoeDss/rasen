/**
 * Session-policy-and-control-parity: the cross-driver parity drift-prevention
 * gate (slice acceptance 6; design D2).
 *
 * The frozen-action executor wires every driver face (interactive launcher,
 * bare CLI, Management API, Canvas, Operations/audit, daemon) through the one
 * `dispatchGrantedAction` contract so no face maintains a second Run or Session
 * truth (executor design D7). This module is the gate that KEEPS that property
 * honest as faces evolve: it asserts every face's projected Run/Action identity
 * and completion state is backed by the canonical Run Record, and that all
 * faces agree on the same Run/Action for the same operation. A face that
 * projects a Run, Action, or completion fact the canonical Record does not back
 * fails closed with a typed drift outcome rather than silently regressing to a
 * divergent truth.
 *
 * The gate consumes the canonical `CanonicalRunRecord` (read-only) and the
 * shipped executor contract; it does not modify them, the Facade, or the
 * EvidenceStore. It is a pure function over recorded state — the deterministic
 * 0.2.0 gate (design D6).
 */
import type { CanonicalRunRecord } from '../change-run/internal/record.js';

/**
 * The driver faces the executor routes through the one contract. Adding a face
 * is one table row plus its harness cell; the coverage guard (2.1) flags any
 * uncovered face.
 */
export const DRIVER_FACES = Object.freeze([
  'interactive-launcher',
  'bare-cli',
  'management-api',
  'canvas',
  'operations-audit',
  'daemon',
] as const);

export type DriverFaceId = (typeof DRIVER_FACES)[number];

/**
 * The operations on the parity surface. `audit` is the additive read-only
 * operation this change adds (2.2); the others are the control operations every
 * face routes through the shared projector/control contract.
 */
export const CONTROL_OPERATIONS = Object.freeze([
  'start',
  'resume',
  'cancel',
  'inspect',
  'audit',
] as const);

export type ControlOperation = (typeof CONTROL_OPERATIONS)[number];

/**
 * One face's projected Run/Action identity and completion state for one
 * operation. The drift gate asserts each field is backed by the canonical
 * Record; the parity check asserts all faces agree.
 */
export interface FaceProjection {
  readonly face: DriverFaceId;
  readonly operation: ControlOperation;
  readonly runId: string;
  readonly actionId: string;
  /** The completion state the face projects (the committed action's deliveryState). */
  readonly completionState: string;
}

/** The field of a projection that diverged from the canonical Record. */
export type DriftField = 'runId' | 'actionId' | 'completionState';

/**
 * The typed drift outcome. `backed` means every field is backed by the
 * canonical Record; `drift` carries the divergent field plus the projected and
 * canonical values so the regression is auditable rather than silent.
 */
export type DriftOutcome =
  | { readonly kind: 'backed' }
  | {
      readonly kind: 'drift';
      readonly face: DriverFaceId;
      readonly field: DriftField;
      readonly projected: string;
      readonly canonical: string;
    };

/**
 * Assert a face's projection is backed by the canonical Run Record. A
 * projection whose `runId` is not the Record's, whose `actionId` is not a
 * committed Action in the Record, or whose `completionState` does not match
 * that Action's `deliveryState` is a drift — the face is maintaining a second
 * Run/Action/completion truth. The gate fails closed with a typed drift
 * outcome; it never silently accepts a divergent projection.
 */
export function assertProjectionBackedByRecord(
  projection: FaceProjection,
  record: CanonicalRunRecord
): DriftOutcome {
  if (projection.runId !== record.runId) {
    return {
      kind: 'drift',
      face: projection.face,
      field: 'runId',
      projected: projection.runId,
      canonical: record.runId,
    };
  }
  const committed = record.actions[projection.actionId];
  if (committed === undefined) {
    return {
      kind: 'drift',
      face: projection.face,
      field: 'actionId',
      projected: projection.actionId,
      canonical: '<absent from canonical Record>',
    };
  }
  if (projection.completionState !== committed.deliveryState) {
    return {
      kind: 'drift',
      face: projection.face,
      field: 'completionState',
      projected: projection.completionState,
      canonical: committed.deliveryState,
    };
  }
  return { kind: 'backed' };
}

/**
 * The parity outcome across all faces for one operation. `consistent` means
 * every face projected the same canonical Run/Action/completion; `divergent`
 * carries the field on which two faces disagreed.
 */
export type ParityOutcome =
  | {
      readonly kind: 'consistent';
      readonly runId: string;
      readonly actionId: string;
      readonly completionState: string;
    }
  | {
      readonly kind: 'divergent';
      readonly operation: ControlOperation;
      readonly field: DriftField;
      readonly values: ReadonlyArray<{ readonly face: DriverFaceId; readonly value: string }>;
    };

/**
 * Assert every face's projection for an operation agrees on Run/Action/
 * completion. This is the cross-face parity check: a face that resolved to a
 * different Run/Action than its peers (a second truth) is flagged. Composed
 * with {@link assertProjectionBackedByRecord} per projection, a divergent face
 * is caught both here (it disagrees with peers) and there (it is unbacked by
 * the Record).
 */
export function assertProjectionsParity(
  operation: ControlOperation,
  projections: readonly FaceProjection[]
): ParityOutcome {
  if (projections.length === 0) {
    return {
      kind: 'divergent',
      operation,
      field: 'runId',
      values: [],
    };
  }
  const first = projections[0]!;
  for (const field of ['runId', 'actionId', 'completionState'] as const) {
    const canonical = first[field];
    for (const projection of projections) {
      if (projection[field] !== canonical) {
        return {
          kind: 'divergent',
          operation,
          field,
          values: projections.map((p) => ({ face: p.face, value: p[field] })),
        };
      }
    }
  }
  return {
    kind: 'consistent',
    runId: first.runId,
    actionId: first.actionId,
    completionState: first.completionState,
  };
}

/**
 * The coverage guard (task 2.1): every declared face x operation cell MUST be
 * exercised. Returns the set of missing cells (empty = full coverage). Adding
 * a face or operation to the declared tables without adding its harness cell
 * fails this guard.
 */
export function uncoveredParityCells(
  exercised: ReadonlyArray<{ readonly face: DriverFaceId; readonly operation: ControlOperation }>
): ReadonlyArray<{ readonly face: DriverFaceId; readonly operation: ControlOperation }> {
  const seen = new Set(exercised.map((cell) => `${cell.face}:${cell.operation}`));
  const missing: { face: DriverFaceId; operation: ControlOperation }[] = [];
  for (const face of DRIVER_FACES) {
    for (const operation of CONTROL_OPERATIONS) {
      if (!seen.has(`${face}:${operation}`)) {
        missing.push({ face, operation });
      }
    }
  }
  return missing;
}
