/**
 * The four semantic lock keys.
 *
 * They are keyed by SEMANTIC scope and instance, never by Change alias, so
 * renaming a branch or a Change directory cannot move a lock. Filenames are
 * digests of the canonically serialized key material, so an identifier's
 * length, case, or separator characters never become filesystem properties.
 *
 * | key         | material                                | taken by                      |
 * | scope       | (storeUid, projectId, targetLineId)     | target-line writes, plan/apply, cleanup |
 * | workspace   | (workspacePairId) or the provisional key| apply, cleanup                |
 * | change      | (changeInstanceId)                      | published for finalization    |
 * | integration | (storeUid, targetLineId)                | published for finalization    |
 *
 * Acquisition order is always scope -> workspace -> change -> integration, and
 * a caller that already holds a later lock never reaches back for an earlier
 * one; that is what makes the ordering sufficient against deadlock, and it is
 * asserted rather than documented (`assertAcquisitionOrder`).
 *
 * Contention (a live holder) retries within a bounded deadline and then fails
 * with `workspace_lock_unavailable`, naming the holder recorded in the lock
 * file. A SEMANTIC conflict is never retried: retrying cannot change the answer
 * and only delays the diagnostic.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { canonicalBytes } from '../../canonical-json.js';
import {
  acquireOwnerAwareFileLock,
  fileLockOwnerIsProvablyDead,
  releaseOwnerAwareFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from '../../file-state.js';
import { workspaceError } from './diagnostics.js';
import type { WorkspaceCoordination } from './dependencies.js';

export type WorkspaceLockKind = 'scope' | 'workspace' | 'change' | 'integration';

/** The fixed acquisition order. Index = precedence. */
export const WORKSPACE_LOCK_ORDER: readonly WorkspaceLockKind[] = Object.freeze([
  'scope',
  'workspace',
  'change',
  'integration',
]);

export interface WorkspaceLockKey {
  readonly kind: WorkspaceLockKind;
  readonly material: Readonly<Record<string, string>>;
  /** Human label recorded in the lock file so a holder can be named. */
  readonly label: string;
}

export const LOCKS_DIR_NAME = 'locks';

export function scopeLockKey(input: {
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
}): WorkspaceLockKey {
  return {
    kind: 'scope',
    material: {
      storeUid: input.storeUid,
      projectId: input.projectId,
      targetLineId: input.targetLineId,
    },
    label: `scope ${input.projectId}@${input.targetLineId}`,
  };
}

/**
 * The workspace lock. Before binding there is no `WorkspacePairId`, so the
 * prepared pair's provisional key — its planning scope plus the intended Change
 * alias — stands in. Both forms are distinct key material, so a prepared and a
 * bound workspace never collide on one file.
 */
export function workspaceLockKey(
  input:
    | { readonly workspacePairId: string }
    | { readonly planningScopeId: string; readonly changeId: string }
): WorkspaceLockKey {
  if ('workspacePairId' in input) {
    return {
      kind: 'workspace',
      material: { workspacePairId: input.workspacePairId },
      label: `workspace ${input.workspacePairId}`,
    };
  }
  return {
    kind: 'workspace',
    material: {
      provisionalPlanningScopeId: input.planningScopeId,
      provisionalChangeId: input.changeId,
    },
    label: `workspace (provisional) ${input.changeId}`,
  };
}

/** Published for the finalization owner. This change never takes it. */
export function changeLockKey(input: {
  readonly changeInstanceId: string;
}): WorkspaceLockKey {
  return {
    kind: 'change',
    material: { changeInstanceId: input.changeInstanceId },
    label: `change ${input.changeInstanceId}`,
  };
}

/** Published for the finalization owner. This change never takes it. */
export function integrationLockKey(input: {
  readonly storeUid: string;
  readonly targetLineId: string;
}): WorkspaceLockKey {
  return {
    kind: 'integration',
    material: { storeUid: input.storeUid, targetLineId: input.targetLineId },
    label: `integration ${input.targetLineId}`,
  };
}

export function workspaceLockFileName(key: WorkspaceLockKey): string {
  const digest = createHash('sha256')
    .update(canonicalBytes({ domain: 'workspace-lock/v1', kind: key.kind, material: key.material }))
    .digest('hex');
  return `${key.kind}-${digest}.lock`;
}

export function workspaceLockPath(
  coordination: WorkspaceCoordination,
  key: WorkspaceLockKey
): string {
  return coordination.resolve(path.join(LOCKS_DIR_NAME, workspaceLockFileName(key)));
}

interface HeldLocks {
  readonly kinds: WorkspaceLockKind[];
}

const heldLocks = new AsyncLocalStorage<HeldLocks>();

/** The lock kinds this async context currently holds, outermost first. */
export function heldLockKinds(): readonly WorkspaceLockKind[] {
  return heldLocks.getStore()?.kinds ?? [];
}

/**
 * Refuses an acquisition that would reach back for an earlier lock while a
 * later one is held. This is a programming error, not an operator-facing
 * refusal, so it throws rather than producing a taxonomy code.
 */
export function assertAcquisitionOrder(
  next: readonly WorkspaceLockKind[],
  held: readonly WorkspaceLockKind[] = heldLockKinds()
): void {
  const rank = (kind: WorkspaceLockKind): number => WORKSPACE_LOCK_ORDER.indexOf(kind);
  let highest = held.reduce((max, kind) => Math.max(max, rank(kind)), -1);
  for (const kind of next) {
    if (rank(kind) <= highest) {
      throw new Error(
        `workspace lock ordering violated: cannot take the ${kind} lock while holding ${
          held.length === 0 ? 'a later lock in this acquisition' : held.join(', ')
        }; the order is ${WORKSPACE_LOCK_ORDER.join(' -> ')}`
      );
    }
    highest = rank(kind);
  }
}

function readHolder(lockPath: string): string {
  try {
    const content = nodeFs.readFileSync(lockPath, 'utf8');
    const holder = /^holder:\s*(.+)$/mu.exec(content)?.[1]?.trim();
    const pid = /^pid:\s*(\d+)/mu.exec(content)?.[1];
    if (holder === undefined && pid === undefined) return 'an unidentified holder';
    return `${holder ?? 'an unnamed holder'}${pid === undefined ? '' : ` (pid ${pid})`}`;
  } catch {
    return 'a holder whose lock file could not be read';
  }
}

function lockErrorFor(
  key: WorkspaceLockKey
): (kind: FileLockErrorKind, info: FileLockErrorInfo) => Error {
  return (kind, info) => {
    if (kind === 'create-failed') {
      return workspaceError(
        'workspace_lock_unavailable',
        `Cannot create the ${key.kind} lock file ${info.lockPath} (${
          (info.cause as NodeJS.ErrnoException | undefined)?.code ?? String(info.cause)
        }).`,
        {
          target: info.lockPath,
          fix: `Check permissions on ${path.dirname(info.lockPath)}, then retry.`,
        }
      );
    }
    return workspaceError(
      'workspace_lock_unavailable',
      `The ${key.kind} lock for ${key.label} is held by ${readHolder(info.lockPath)}.`,
      {
        target: info.lockPath,
        fix: `Wait for that operation to finish and retry. Rasen never steals a lock held by a live process; if the holder is gone, remove ${info.lockPath}.`,
      }
    );
  };
}

export interface WorkspaceLockOptions {
  readonly deadlineMs?: number;
  readonly pollMs?: number;
}

/**
 * Takes `keys` in the fixed order and runs `fn` under them. Every lock is
 * released in reverse order, including on failure.
 */
export async function withWorkspaceLocks<T>(
  coordination: WorkspaceCoordination,
  keys: readonly WorkspaceLockKey[],
  fn: () => Promise<T>,
  options: WorkspaceLockOptions = {}
): Promise<T> {
  const ordered = [...keys].sort(
    (left, right) =>
      WORKSPACE_LOCK_ORDER.indexOf(left.kind) - WORKSPACE_LOCK_ORDER.indexOf(right.kind)
  );
  assertAcquisitionOrder(ordered.map((key) => key.kind));

  const acquired: Array<Awaited<ReturnType<typeof acquireOwnerAwareFileLock>>> = [];
  try {
    for (const key of ordered) {
      acquired.push(
        await acquireOwnerAwareFileLock({
          lockPath: workspaceLockPath(coordination, key),
          errorFor: lockErrorFor(key),
          holder: key.label,
          ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
          ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
        })
      );
    }
    const held = [...heldLockKinds(), ...ordered.map((key) => key.kind)];
    return await heldLocks.run({ kinds: held }, fn);
  } finally {
    for (const handle of acquired.reverse()) {
      await releaseOwnerAwareFileLock(handle);
    }
  }
}

/**
 * Is a lock currently held by anyone (this process or another)?
 *
 * The answer mirrors the ACQUIRE protocol rather than file existence.
 * `acquireOwnerAwareFileLock` steals a lock whose recorded pid is provably
 * dead, so a probe that answered "held" for that file would report a
 * precondition no amount of waiting can satisfy — a `rasen store workspace`
 * run killed with Ctrl-C would block every later cleanup of that scope
 * permanently, and cleanup has no `--force`.
 *
 * Everything the acquirer would WAIT on still answers true: a live owner, an
 * unparseable holder, and a lock file this process cannot read.
 */
export async function lockIsHeld(
  coordination: WorkspaceCoordination,
  key: WorkspaceLockKey
): Promise<boolean> {
  const lockPath = workspaceLockPath(coordination, key);
  let content: string;
  try {
    content = await nodeFs.promises.readFile(lockPath, 'utf8');
  } catch (error) {
    // Absent means not held. Anything else is a lock we cannot inspect, which
    // the acquirer waits on, so the probe must not be more permissive.
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  return !fileLockOwnerIsProvablyDead(content);
}
