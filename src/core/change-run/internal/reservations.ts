import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type {
  ActionId,
  AttemptId,
  Digest,
  RunId,
} from '../contracts.js';
import {
  digestCanonicalRunRecord,
  type CanonicalRunRecord,
} from './record.js';
import { canonicalJson } from './identity.js';

export interface ReservationEntry {
  readonly workspaceInstanceId: string;
  readonly runId: RunId;
  readonly actionId: ActionId;
  readonly attemptId: AttemptId;
  readonly access: 'read' | 'write';
  readonly recordDigest: Digest;
  readonly recordVersion: number;
  readonly state: 'pending' | 'final';
  readonly consultationSponsor?: Readonly<{
    runId: RunId;
    actionId: ActionId;
    consultationId: string;
  }>;
}

export type ReservationConflictCode =
  | 'workspace-reservation-writer-held'
  | 'workspace-reservation-writer-blocked'
  | 'workspace-reservation-sponsor-mismatch';

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
  readonly reserveConsultationRead: (
    entry: ReservationEntry & { readonly access: 'read' },
    sponsor: Readonly<{
      runId: RunId;
      actionId: ActionId;
      consultationId: string;
      canonicallyPaused: boolean;
    }>
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
      const conflicts = [...entries.values()].filter(
        (existing) =>
          existing.runId !== entry.runId || existing.actionId !== entry.actionId
      );
      const writer = conflicts.find((existing) => existing.access === 'write');
      if (writer !== undefined) {
        return Object.freeze({
          code: 'workspace-reservation-writer-held' as const,
          workspaceInstanceId: entry.workspaceInstanceId,
          conflictingRunId: writer.runId,
          conflictingActionId: writer.actionId,
        });
      }
      if (entry.access === 'write' && conflicts[0] !== undefined) {
        return Object.freeze({
          code: 'workspace-reservation-writer-blocked' as const,
          workspaceInstanceId: entry.workspaceInstanceId,
          conflictingRunId: conflicts[0].runId,
          conflictingActionId: conflicts[0].actionId,
        });
      }
      entries.set(entryKey(entry.runId, entry.actionId), entry);
      return null;
    },
    reserveConsultationRead(
      entry: ReservationEntry & { readonly access: 'read' },
      sponsor: Readonly<{
        runId: RunId;
        actionId: ActionId;
        consultationId: string;
        canonicallyPaused: boolean;
      }>
    ): ReservationConflict | null {
      const entries = bucket(entry.workspaceInstanceId);
      const source = entries.get(entryKey(sponsor.runId, sponsor.actionId));
      const sameTeacher = entries.get(entryKey(entry.runId, entry.actionId));
      if (
        !sponsor.canonicallyPaused ||
        source === undefined ||
        source.access !== 'write' ||
        source.runId !== entry.runId ||
        source.actionId === entry.actionId ||
        (entry.consultationSponsor !== undefined &&
          (entry.consultationSponsor.runId !== sponsor.runId ||
            entry.consultationSponsor.actionId !== sponsor.actionId ||
            entry.consultationSponsor.consultationId !==
              sponsor.consultationId)) ||
        (sameTeacher?.consultationSponsor !== undefined &&
          (sameTeacher.consultationSponsor.runId !== sponsor.runId ||
            sameTeacher.consultationSponsor.actionId !== sponsor.actionId ||
            sameTeacher.consultationSponsor.consultationId !==
              sponsor.consultationId))
      ) {
        return Object.freeze({
          code: 'workspace-reservation-sponsor-mismatch' as const,
          workspaceInstanceId: entry.workspaceInstanceId,
          conflictingRunId: sponsor.runId,
          conflictingActionId: sponsor.actionId,
        });
      }
      for (const existing of entries.values()) {
        const isSponsor =
          existing.runId === sponsor.runId &&
          existing.actionId === sponsor.actionId;
        const isSame =
          existing.runId === entry.runId &&
          existing.actionId === entry.actionId;
        if (isSponsor || isSame) continue;
        return Object.freeze({
          code: 'workspace-reservation-writer-held' as const,
          workspaceInstanceId: entry.workspaceInstanceId,
          conflictingRunId: existing.runId,
          conflictingActionId: existing.actionId,
        });
      }
      entries.set(entryKey(entry.runId, entry.actionId), {
        ...entry,
        consultationSponsor: {
          runId: sponsor.runId,
          actionId: sponsor.actionId,
          consultationId: sponsor.consultationId,
        },
      });
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
        // A source writer and its sponsored readers are one reservation
        // ownership group. Delete dependants first so cancellation/recovery
        // can never leave a Teacher read orphaned after its sponsor vanished.
        for (const [key, existing] of entries) {
          if (
            existing.consultationSponsor?.runId === runId &&
            existing.consultationSponsor.actionId === actionId
          ) {
            entries.delete(key);
          }
        }
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

const DURABLE_RESERVATION_DIRECTORY = '.workspace-reservations';
const DURABLE_RESERVATION_STATE_FILE = 'state.json';
const DURABLE_RESERVATION_LOCK_FILE = 'state.lock';
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 10;

const DurableReservationEntrySchema = z.strictObject({
  workspaceInstanceId: z.string().min(1).max(512),
  runId: z.string().min(1).max(256),
  actionId: z.string().min(1).max(256),
  attemptId: z.string().min(1).max(256),
  access: z.enum(['read', 'write']),
  recordDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  recordVersion: z.number().int().nonnegative().safe(),
  state: z.enum(['pending', 'final']),
  consultationSponsor: z
    .strictObject({
      runId: z.string().min(1).max(256),
      actionId: z.string().min(1).max(256),
      consultationId: z.string().min(1).max(256),
    })
    .optional(),
  ownerPid: z.number().int().nonnegative().safe(),
  acquiredAtMs: z.number().int().nonnegative().safe(),
});
const DurableReservationStateSchema = z.strictObject({
  format: z.literal('workspace-reservation-state/1'),
  revision: z.number().int().nonnegative().safe(),
  entries: z.array(DurableReservationEntrySchema).max(4096),
});
const LockOwnerSchema = z.strictObject({
  pid: z.number().int().positive().safe(),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  acquiredAtMs: z.number().int().nonnegative().safe(),
});

interface DurableReservationEntry extends ReservationEntry {
  readonly ownerPid: number;
  readonly acquiredAtMs: number;
}

interface DurableReservationState {
  readonly revision: number;
  readonly entries: readonly DurableReservationEntry[];
}

export class WorkspaceReservationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'workspace-reservation-state-invalid'
      | 'workspace-reservation-lock-timeout'
      | 'workspace-reservation-record-conflict',
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceReservationPersistenceError';
  }
}

export interface FilesystemWorkspaceReservationRegistryOptions {
  readonly storeRoot: string;
  /** Canonical non-terminal and terminal heads used only for recovery/hydration. */
  readonly loadRecords: () => readonly CanonicalRunRecord[];
}

export function workspaceReservationStatePath(storeRoot: string): string {
  return path.join(
    path.resolve(storeRoot),
    DURABLE_RESERVATION_DIRECTORY,
    DURABLE_RESERVATION_STATE_FILE
  );
}

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Steal only when the kernel affirmatively reports that the owner no
    // longer exists. Permission and unexpected failures remain live/unknown.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function decodeDurableEntry(value: z.infer<typeof DurableReservationEntrySchema>): DurableReservationEntry {
  return Object.freeze({
    workspaceInstanceId: value.workspaceInstanceId,
    runId: value.runId as RunId,
    actionId: value.actionId as ActionId,
    attemptId: value.attemptId as AttemptId,
    access: value.access,
    recordDigest: value.recordDigest as Digest,
    recordVersion: value.recordVersion,
    state: value.state,
    ...(value.consultationSponsor === undefined
      ? {}
      : {
          consultationSponsor: Object.freeze({
            runId: value.consultationSponsor.runId as RunId,
            actionId: value.consultationSponsor.actionId as ActionId,
            consultationId: value.consultationSponsor.consultationId,
          }),
        }),
    ownerPid: value.ownerPid,
    acquiredAtMs: value.acquiredAtMs,
  });
}

function readDurableState(statePath: string): DurableReservationState {
  if (!existsSync(statePath)) return { revision: 0, entries: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    throw new WorkspaceReservationPersistenceError(
      'workspace-reservation-state-invalid',
      'Durable workspace reservation state is not valid UTF-8 JSON.'
    );
  }
  const decoded = DurableReservationStateSchema.safeParse(parsed);
  if (!decoded.success) {
    throw new WorkspaceReservationPersistenceError(
      'workspace-reservation-state-invalid',
      decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    );
  }
  const entries = decoded.data.entries.map(decodeDurableEntry);
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = entryKey(entry.runId, entry.actionId);
    if (keys.has(key)) {
      throw new WorkspaceReservationPersistenceError(
        'workspace-reservation-state-invalid',
        `Durable workspace reservation state duplicates ${key}.`
      );
    }
    keys.add(key);
  }
  return { revision: decoded.data.revision, entries };
}

function writeDurableState(
  statePath: string,
  state: DurableReservationState
): void {
  const staging = `${statePath}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`;
  writeFileSync(
    staging,
    `${canonicalJson({
      format: 'workspace-reservation-state/1',
      revision: state.revision,
      entries: state.entries,
    })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  renameSync(staging, statePath);
}

function acquireReservationLock(lockPath: string): () => void {
  const token = randomBytes(32).toString('hex');
  const content = canonicalJson({
    pid: process.pid,
    token,
    acquiredAtMs: Date.now(),
  });
  const deadline = Date.now() + LOCK_WAIT_MS;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600);
      let identity: ReturnType<typeof fstatSync>;
      try {
        writeFileSync(descriptor, content, 'utf8');
        identity = fstatSync(descriptor, { bigint: true });
      } catch (error) {
        try { closeSync(descriptor); } catch { /* best effort */ }
        try { unlinkSync(lockPath); } catch { /* best effort */ }
        throw error;
      }
      return () => {
        try { closeSync(descriptor); } catch { /* best effort */ }
        try {
          const current = lstatSync(lockPath, { bigint: true });
          if (current.dev !== identity.dev || current.ino !== identity.ino) return;
          if (readFileSync(lockPath, 'utf8') !== content) return;
          unlinkSync(lockPath);
        } catch {
          // Missing or unverifiable ownership is never grounds for deleting
          // another process's lock.
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code !== 'EEXIST' &&
        !(process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(code ?? ''))
      ) {
        throw error;
      }
      let stolen = false;
      try {
        const observed = readFileSync(lockPath, 'utf8');
        const owner = LockOwnerSchema.safeParse(JSON.parse(observed));
        if (owner.success && !processIsAlive(owner.data.pid)) {
          const claimed = `${lockPath}.${process.pid}.${randomBytes(16).toString('hex')}.steal`;
          try {
            renameSync(lockPath, claimed);
            const moved = readFileSync(claimed, 'utf8');
            if (moved === observed) {
              unlinkSync(claimed);
              stolen = true;
            } else {
              try { linkSync(claimed, lockPath); } catch { /* a successor won */ }
              try { unlinkSync(claimed); } catch { /* best effort */ }
            }
          } catch {
            // Another contender may have claimed the dead lock first.
          }
        }
      } catch {
        // Unreadable or malformed ownership is ambiguous and must not be
        // stolen. Wait for a bounded timeout instead.
      }
      if (stolen) continue;
      if (Date.now() >= deadline) {
        throw new WorkspaceReservationPersistenceError(
          'workspace-reservation-lock-timeout',
          'Timed out acquiring the cross-process workspace reservation lock.'
        );
      }
      Atomics.wait(sleeper, 0, 0, LOCK_POLL_MS);
    }
  }
}

function reservationConflict(
  entries: readonly DurableReservationEntry[],
  entry: ReservationEntry,
  sponsor?: Readonly<{
    runId: RunId;
    actionId: ActionId;
    consultationId: string;
    canonicallyPaused: boolean;
  }>
): ReservationConflict | null {
  const sameWorkspace = entries.filter(
    (existing) => existing.workspaceInstanceId === entry.workspaceInstanceId
  );
  if (sponsor !== undefined) {
    const source = sameWorkspace.find(
      (existing) => existing.runId === sponsor.runId && existing.actionId === sponsor.actionId
    );
    const sameTeacher = sameWorkspace.find(
      (existing) => existing.runId === entry.runId && existing.actionId === entry.actionId
    );
    if (
      !sponsor.canonicallyPaused ||
      source === undefined ||
      source.access !== 'write' ||
      source.runId !== entry.runId ||
      source.actionId === entry.actionId ||
      (entry.consultationSponsor !== undefined &&
        (entry.consultationSponsor.runId !== sponsor.runId ||
          entry.consultationSponsor.actionId !== sponsor.actionId ||
          entry.consultationSponsor.consultationId !== sponsor.consultationId)) ||
      (sameTeacher?.consultationSponsor !== undefined &&
        (sameTeacher.consultationSponsor.runId !== sponsor.runId ||
          sameTeacher.consultationSponsor.actionId !== sponsor.actionId ||
          sameTeacher.consultationSponsor.consultationId !== sponsor.consultationId))
    ) {
      return Object.freeze({
        code: 'workspace-reservation-sponsor-mismatch',
        workspaceInstanceId: entry.workspaceInstanceId,
        conflictingRunId: sponsor.runId,
        conflictingActionId: sponsor.actionId,
      });
    }
    const unrelated = sameWorkspace.find(
      (existing) =>
        !(existing.runId === sponsor.runId && existing.actionId === sponsor.actionId) &&
        !(existing.runId === entry.runId && existing.actionId === entry.actionId)
    );
    return unrelated === undefined
      ? null
      : Object.freeze({
          code: 'workspace-reservation-writer-held',
          workspaceInstanceId: entry.workspaceInstanceId,
          conflictingRunId: unrelated.runId,
          conflictingActionId: unrelated.actionId,
        });
  }
  const conflicts = sameWorkspace.filter(
    (existing) =>
      existing.runId !== entry.runId || existing.actionId !== entry.actionId
  );
  const writer = conflicts.find((existing) => existing.access === 'write');
  if (writer !== undefined) {
    return Object.freeze({
      code: 'workspace-reservation-writer-held',
      workspaceInstanceId: entry.workspaceInstanceId,
      conflictingRunId: writer.runId,
      conflictingActionId: writer.actionId,
    });
  }
  if (entry.access === 'write' && conflicts[0] !== undefined) {
    return Object.freeze({
      code: 'workspace-reservation-writer-blocked',
      workspaceInstanceId: entry.workspaceInstanceId,
      conflictingRunId: conflicts[0].runId,
      conflictingActionId: conflicts[0].actionId,
    });
  }
  return null;
}

function canonicalReservationEntries(
  records: readonly CanonicalRunRecord[]
): readonly DurableReservationEntry[] {
  const entries: DurableReservationEntry[] = [];
  const ordered = [...records]
    .filter((record) => record.terminal === undefined)
    .sort((left, right) => left.runId.localeCompare(right.runId));
  for (const record of ordered) {
    const recordDigest = digestCanonicalRunRecord(record);
    for (const committed of Object.values(record.actions).sort((left, right) =>
      left.action.actionId.localeCompare(right.action.actionId)
    )) {
      const action = committed.action;
      if (
        (committed.state !== 'active' && committed.state !== 'consultation-paused') ||
        action.workspace.access === 'none'
      ) {
        continue;
      }
      const consultation = Object.values(record.consultations ?? {}).find(
        (candidate) => candidate.teacher.actionId === action.actionId
      );
      const source =
        consultation === undefined
          ? undefined
          : record.actions[consultation.source.actionId];
      entries.push(Object.freeze({
        workspaceInstanceId: record.workspaceInstanceId,
        runId: record.runId,
        actionId: action.actionId as ActionId,
        attemptId: action.attemptId as AttemptId,
        access: action.workspace.access,
        recordDigest,
        recordVersion: record.recordVersion,
        state: 'final',
        ...(consultation !== undefined &&
        source?.state === 'consultation-paused' &&
        action.workspace.access === 'read'
          ? {
              consultationSponsor: Object.freeze({
                runId: record.runId,
                actionId: consultation.source.actionId as ActionId,
                consultationId: consultation.consultationId,
              }),
            }
          : {}),
        ownerPid: 0,
        acquiredAtMs: 0,
      }));
    }
  }
  const accepted: DurableReservationEntry[] = [];
  const normal = entries.filter((entry) => entry.consultationSponsor === undefined);
  const sponsored = entries.filter((entry) => entry.consultationSponsor !== undefined);
  for (const entry of [...normal, ...sponsored]) {
    const sponsor = entry.consultationSponsor;
    const conflict = reservationConflict(
      accepted,
      entry,
      sponsor === undefined
        ? undefined
        : { ...sponsor, canonicallyPaused: true }
    );
    if (conflict !== null) {
      throw new WorkspaceReservationPersistenceError(
        'workspace-reservation-record-conflict',
        `Canonical Run heads conflict on ${entry.workspaceInstanceId}: ${conflict.code}.`
      );
    }
    accepted.push(entry);
  }
  return Object.freeze(entries);
}

/**
 * Durable registry used by real CLI/daemon contexts. Every operation reloads
 * and atomically replaces one per-store state under a single cross-process
 * lock. Canonical heads hydrate the state on open/restart; live pre-commit
 * pending entries survive only while their owner process is alive.
 */
export function createFilesystemWorkspaceReservationRegistry(
  options: FilesystemWorkspaceReservationRegistryOptions
): WorkspaceReservationRegistry {
  const statePath = workspaceReservationStatePath(options.storeRoot);
  const root = path.dirname(statePath);
  const lockPath = path.join(root, DURABLE_RESERVATION_LOCK_FILE);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const withState = <T>(
    operation: (
      entries: Map<string, DurableReservationEntry>
    ) => Readonly<{ result: T; changed: boolean }>
  ): T => {
    const releaseLock = acquireReservationLock(lockPath);
    try {
      const state = readDurableState(statePath);
      const entries = new Map(
        state.entries.map((entry) => [entryKey(entry.runId, entry.actionId), entry] as const)
      );
      let recovered = false;
      const deadPending = [...entries.values()].filter(
        (entry) => entry.state === 'pending' && !processIsAlive(entry.ownerPid)
      );
      if (deadPending.length > 0) {
        const canonical = new Map(
          canonicalReservationEntries(options.loadRecords()).map(
            (entry) => [entryKey(entry.runId, entry.actionId), entry] as const
          )
        );
        for (const pending of deadPending) {
          const key = entryKey(pending.runId, pending.actionId);
          const expected = canonical.get(key);
          if (expected === undefined) entries.delete(key);
          else entries.set(key, expected);
          recovered = true;
        }
      }
      const outcome = operation(entries);
      if (recovered || outcome.changed) {
        writeDurableState(statePath, {
          revision: state.revision + 1,
          entries: Object.freeze(
            [...entries.values()].sort((left, right) =>
              entryKey(left.runId, left.actionId).localeCompare(
                entryKey(right.runId, right.actionId)
              )
            )
          ),
        });
      }
      return outcome.result;
    } finally {
      releaseLock();
    }
  };

  // Startup/restart recovery: canonical heads are authoritative for final
  // reservations; only live, not-yet-committed pending entries are retained.
  // Idempotent: when the recomputed entries match what is already on disk,
  // nothing is written — bumping the revision would violate the byte-identical
  // contract that a refused (non-mutating) path changes nothing on disk.
  withState((entries) => {
    const canonical = canonicalReservationEntries(options.loadRecords());
    const canonicalKeySet = new Set(
      canonical.map((entry) => entryKey(entry.runId, entry.actionId))
    );
    const livePending = [...entries.values()].filter(
      (entry) =>
        entry.state === 'pending' &&
        processIsAlive(entry.ownerPid) &&
        !canonicalKeySet.has(entryKey(entry.runId, entry.actionId))
    );
    // Build the replacement map and detect whether anything actually changed.
    const replacement = new Map<string, DurableReservationEntry>();
    for (const entry of canonical) {
      replacement.set(entryKey(entry.runId, entry.actionId), entry);
    }
    for (const entry of livePending) {
      replacement.set(entryKey(entry.runId, entry.actionId), entry);
    }
    let changed = entries.size !== replacement.size;
    if (!changed) {
      for (const [key, value] of replacement) {
        const existing = entries.get(key);
        if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(value)) {
          changed = true;
          break;
        }
      }
    }
    entries.clear();
    for (const [key, entry] of replacement) entries.set(key, entry);
    return { result: undefined, changed };
  });

  return Object.freeze({
    reserve(entry: ReservationEntry): ReservationConflict | null {
      return withState((entries) => {
        const existing = [...entries.values()];
        const conflict = reservationConflict(existing, entry);
        if (conflict !== null) return { result: conflict, changed: false };
        entries.set(entryKey(entry.runId, entry.actionId), Object.freeze({
          ...entry,
          ownerPid: process.pid,
          acquiredAtMs: Date.now(),
        }));
        return { result: null, changed: true };
      });
    },
    reserveConsultationRead(
      entry: ReservationEntry & { readonly access: 'read' },
      sponsor: Readonly<{
        runId: RunId;
        actionId: ActionId;
        consultationId: string;
        canonicallyPaused: boolean;
      }>
    ): ReservationConflict | null {
      return withState((entries) => {
        const conflict = reservationConflict([...entries.values()], entry, sponsor);
        if (conflict !== null) return { result: conflict, changed: false };
        entries.set(entryKey(entry.runId, entry.actionId), Object.freeze({
          ...entry,
          consultationSponsor: Object.freeze({
            runId: sponsor.runId,
            actionId: sponsor.actionId,
            consultationId: sponsor.consultationId,
          }),
          ownerPid: process.pid,
          acquiredAtMs: Date.now(),
        }));
        return { result: null, changed: true };
      });
    },
    finalize(runId: RunId, actionId: ActionId): void {
      withState((entries) => {
        const key = entryKey(runId, actionId);
        const existing = entries.get(key);
        if (existing === undefined || existing.state === 'final') {
          return { result: undefined, changed: false };
        }
        entries.set(key, Object.freeze({ ...existing, state: 'final' }));
        return { result: undefined, changed: true };
      });
    },
    release(runId: RunId, actionId: ActionId): void {
      withState((entries) => {
        let changed = false;
        for (const [key, existing] of entries) {
          const sponsor = existing.consultationSponsor;
          if (
            (existing.runId === runId && existing.actionId === actionId) ||
            (sponsor !== undefined &&
              sponsor.runId === runId &&
              sponsor.actionId === actionId)
          ) {
            entries.delete(key);
            changed = true;
          }
        }
        return { result: undefined, changed };
      });
    },
    snapshot(workspaceInstanceId: string): readonly ReservationEntry[] {
      return withState((entries) => ({
        result: Object.freeze(
          [...entries.values()]
            .filter((entry) => entry.workspaceInstanceId === workspaceInstanceId)
            .map(({ ownerPid: _ownerPid, acquiredAtMs: _acquiredAtMs, ...entry }) =>
              Object.freeze(entry)
            )
        ),
        changed: false,
      }));
    },
    isBusy(workspaceInstanceId: string): boolean {
      return withState((entries) => ({
        result: [...entries.values()].some(
          (entry) => entry.workspaceInstanceId === workspaceInstanceId
        ),
        changed: false,
      }));
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
