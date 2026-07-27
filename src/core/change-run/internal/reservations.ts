import type {
  ActionId,
  AttemptId,
  Digest,
  RunId,
} from '../contracts.js';

export interface ReservationEntry {
  readonly workspaceInstanceId: string;
  readonly runId: RunId;
  readonly actionId: ActionId;
  readonly attemptId: AttemptId;
  readonly access: 'read' | 'write';
  readonly recordDigest: Digest;
  readonly recordVersion: number;
  readonly state: 'pending' | 'final';
}

export type ReservationConflictCode =
  | 'workspace_reservation_writer_held'
  | 'workspace_reservation_writer_blocked';

export interface ReservationConflict {
  readonly code: ReservationConflictCode;
  readonly workspaceInstanceId: string;
  readonly conflictingRunId: RunId;
  readonly conflictingActionId: ActionId;
}

const entryKey = (runId: string, actionId: string) => `${runId}/${actionId}`;

/**
 * Bounded immutable workspace reservation registry (tasks 8.5/8.6), keyed by
 * WorkspaceInstanceId. A writer excludes every other workspace touch across
 * all Changes/Runs; readers coexist while no writer is held. The registry
 * cross-validates exact Run/Action/Attempt identity so one Run can never
 * observe a false free slot, and release/finalize are keyed to that exact
 * identity.
 */
export interface WorkspaceReservationRegistry {
  readonly reserve: (
    entry: ReservationEntry
  ) => ReservationConflict | null;
  readonly finalize: (runId: RunId, actionId: ActionId) => void;
  readonly release: (runId: RunId, actionId: ActionId) => void;
  readonly snapshot: (workspaceInstanceId: string) => readonly ReservationEntry[];
  readonly isBusy: (workspaceInstanceId: string) => boolean;
}

export function createWorkspaceReservationRegistry(): WorkspaceReservationRegistry {
  const byWorkspace = new Map<string, Map<string, ReservationEntry>>();

  const bucket = (workspaceInstanceId: string) => {
    let bucket = byWorkspace.get(workspaceInstanceId);
    if (bucket === undefined) {
      bucket = new Map();
      byWorkspace.set(workspaceInstanceId, bucket);
    }
    return bucket;
  };

  return Object.freeze({
    reserve(entry: ReservationEntry): ReservationConflict | null {
      const entries = bucket(entry.workspaceInstanceId);
      for (const existing of entries.values()) {
        if (
          existing.runId === entry.runId &&
          existing.actionId === entry.actionId
        ) {
          continue;
        }
        if (existing.access === 'write') {
          return Object.freeze({
            code: 'workspace_reservation_writer_held' as const,
            workspaceInstanceId: entry.workspaceInstanceId,
            conflictingRunId: existing.runId,
            conflictingActionId: existing.actionId,
          });
        }
        if (entry.access === 'write') {
          return Object.freeze({
            code: 'workspace_reservation_writer_blocked' as const,
            workspaceInstanceId: entry.workspaceInstanceId,
            conflictingRunId: existing.runId,
            conflictingActionId: existing.actionId,
          });
        }
      }
      entries.set(entryKey(entry.runId, entry.actionId), entry);
      return null;
    },
    finalize(runId: RunId, actionId: ActionId) {
      for (const entries of byWorkspace.values()) {
        const key = entryKey(runId, actionId);
        const existing = entries.get(key);
        if (existing !== undefined) {
          entries.set(key, { ...existing, state: 'final' });
          return;
        }
      }
    },
    release(runId: RunId, actionId: ActionId) {
      for (const entries of byWorkspace.values()) {
        entries.delete(entryKey(runId, actionId));
      }
    },
    snapshot(workspaceInstanceId: string): readonly ReservationEntry[] {
      const entries = byWorkspace.get(workspaceInstanceId);
      if (entries === undefined) return [];
      return [...entries.values()];
    },
    isBusy(workspaceInstanceId: string): boolean {
      const entries = byWorkspace.get(workspaceInstanceId);
      return entries !== undefined && entries.size > 0;
    },
  });
}

export type ReservationDeltaRecovery =
  | 'finalize-new-delete-old'
  | 'discard-new-keep-old'
  | 'busy'
  | 'corrupt';

/**
 * Token-grouped reservation-delta recovery (tasks 8.7/8.8). A mutation that
 * closes upstream workspace access and settles downstream admission is one
 * delta: all new pending reservations share a token binding the exact
 * predecessor and expected committed Record. Recovery classifies by which
 * Records are durable:
 * - committed durable -> finalize every new pending, then delete the old
 *   closing reservations (the delta landed).
 * - only the unchanged predecessor durable -> discard every new pending and
 *   retain the old finals (the delta never committed; nothing partial).
 * - advanced head without predecessor, or neither durable -> busy/corrupt,
 *   never a speculative cleanup.
 */
export function classifyReservationDelta(recovery: {
  readonly predecessorDigest: Digest;
  readonly committedDigest: Digest;
  readonly recordExists: (digest: Digest) => boolean;
}): ReservationDeltaRecovery {
  const committed = recovery.recordExists(recovery.committedDigest);
  const predecessor = recovery.recordExists(recovery.predecessorDigest);
  if (committed && predecessor) return 'finalize-new-delete-old';
  if (!committed && predecessor) return 'discard-new-keep-old';
  if (committed && !predecessor) return 'corrupt';
  return 'busy';
}

/**
 * Apply a reservation delta's recovery decision to the registry. Idempotent:
 * finalizing an already-final entry is a no-op, and deleting absent entries is
 * a no-op, so partial recovery completes cleanly from the Record.
 */
export function applyReservationDelta(
  registry: WorkspaceReservationRegistry,
  decision: ReservationDeltaRecovery,
  delta: {
    readonly closing: readonly ReservationEntry[];
    readonly pending: readonly ReservationEntry[];
  }
): void {
  switch (decision) {
    case 'finalize-new-delete-old':
      for (const entry of delta.pending) {
        registry.finalize(entry.runId, entry.actionId);
      }
      for (const entry of delta.closing) {
        registry.release(entry.runId, entry.actionId);
      }
      return;
    case 'discard-new-keep-old':
      for (const entry of delta.pending) {
        registry.release(entry.runId, entry.actionId);
      }
      return;
    case 'busy':
    case 'corrupt':
      return;
  }
}
