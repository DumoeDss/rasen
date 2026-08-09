/**
 * Session-policy-and-control-parity: the audit operation (slice acceptance 6;
 * design D2 / task 2.2).
 *
 * The executor's representative parity gate (7.1) covered start/dispatch on two
 * faces. This module adds the `audit` operation to the parity surface: an
 * ADDITIVE READ-ONLY operation that projects a canonical Run/Action identity,
 * its committed completion state, and the capability matrix's availability
 * verdict for a requested backend. It performs NO Record mutation — completion
 * truth stays solely in the canonical Record through the Facade — and it
 * resolves to the same RunId/ActionId every other operation resolves to, so it
 * is caught by the parity drift-prevention gate (2.3) like every other face.
 *
 * The operation consumes the canonical `CanonicalRunRecord` (read-only), the
 * shipped capability matrix, and the executor's audit-relevant seams; it does
 * not widen the frozen change-run projector contract (`change-run/internal/
 * projector.ts`) — it is a new additive read in a new module.
 */
import type { CanonicalRunRecord } from '../change-run/internal/record.js';
import {
  queryCapabilityCell,
  type ExecutionBackendId,
  type ExecutionCapabilityMatrix,
} from '../frozen-action-executor/capability-matrix.js';

/**
 * The audit projection of one Run/Action. `deliveryState` is the committed
 * completion state read from the canonical Record; `capability` is the
 * capability matrix's typed availability verdict for the requested backend on
 * this host (the sole "when capability allows" oracle).
 */
export interface AuditView {
  readonly runId: string;
  readonly actionId: string;
  readonly deliveryState: string;
  readonly capability: {
    readonly backend: ExecutionBackendId;
    readonly availability: 'available' | 'authority-unavailable';
    readonly reason?: string;
  };
}

/** The Run/Action was not found in the canonical Record. */
export interface AuditNotFound {
  readonly kind: 'not-found';
  readonly runId: string;
  readonly actionId: string;
}

/**
 * Project the audit view for a committed Action. Read-only: the canonical
 * Record is consulted, never mutated. A Run/Action not present in the Record
 * returns a typed `not-found` (never a fabricated projection); a present
 * Action returns its committed delivery state plus the matrix's availability
 * verdict for the requested backend on this host.
 */
export function projectAuditView(
  record: CanonicalRunRecord,
  actionId: string,
  matrix: ExecutionCapabilityMatrix,
  backend: ExecutionBackendId
): AuditView | AuditNotFound {
  const committed = record.actions[actionId];
  if (committed === undefined) {
    return { kind: 'not-found', runId: record.runId, actionId };
  }
  const cell = queryCapabilityCell(matrix, matrix.hostPlatform, backend);
  // A missing cell (undeclared platform) is a typed authority-unavailable, not
  // a silent "available" — the matrix is the sole oracle.
  const availability =
    cell !== undefined && cell.availability.kind === 'available'
      ? ('available' as const)
      : ('authority-unavailable' as const);
  const reason =
    cell !== undefined && cell.availability.kind !== 'available'
      ? cell.availability.reason
      : undefined;
  return {
    runId: record.runId,
    actionId: committed.action.actionId,
    deliveryState: committed.deliveryState,
    capability: { backend, availability, ...(reason !== undefined ? { reason } : {}) },
  };
}
