/**
 * The two Issue semantic lock keys, and why prepending them leaves the existing
 * deadlock argument valid.
 *
 * | key         | material                            | taken by                       |
 * | issue-allocation | (storeUid)                     | Issue identity allocation and generated migration publication |
 * | issue       | (storeUid, issueUid)                | Issue and revision writes      |
 * | scope       | (storeUid, projectId, targetLineId) | target-line writes, plan/apply |
 * | workspace   | (workspacePairId) or provisional    | apply, cleanup                 |
 * | change      | (changeInstanceId)                  | finalization                   |
 * | integration | (storeUid, targetLineId)            | finalization                   |
 *
 * The full order is
 * `issue-allocation -> issue -> scope -> workspace -> change -> integration`.
 * `store-planning-worktree-bindings` asserts that no path reaches back for an
 * earlier key while holding a later one, with its order starting at `scope`.
 * PREPENDING keys that no path of that Module ever takes leaves that assertion
 * true exactly as written, which is why this file extends it rather than
 * editing it — and this Module asserts the extended six-key order itself, so
 * the extension is proven rather than assumed harmless.
 *
 * Every Issue mutation takes allocation then UID Issue so selector resolution
 * cannot race identity publication. Neither touches a project partition,
 * worktree, or canonical spec. A READ takes no lock at all, because a read
 * that blocked on a writer would make an aggregate board hostage to one stuck
 * command.
 *
 * Contention retries within a bounded deadline and then fails naming the
 * holder; a SEMANTIC conflict is never retried, because retrying cannot change
 * the answer and only delays the diagnostic. Both rules are the workspace
 * Module's and are reused rather than restated.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { canonicalBytes } from '../../canonical-json.js';
import {
  acquireOwnerAwareFileLock,
  releaseOwnerAwareFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from '../../file-state.js';
import type { WorkspaceCoordination } from '../workspace/dependencies.js';
import {
  LOCKS_DIR_NAME,
  WORKSPACE_LOCK_ORDER,
  heldLockKinds,
  type WorkspaceLockKind,
} from '../workspace/locks.js';
import { issueError } from './diagnostics.js';

export type StoreLockKind = 'issue-allocation' | 'issue' | WorkspaceLockKind;

/**
 * The full acquisition order across both Modules. Index = precedence.
 *
 * ENUMERATED, one key per line with its reason, rather than spread from
 * `WORKSPACE_LOCK_ORDER`. A spread would make this list absorb a key child 4
 * added without anyone deciding where it belongs relative to `issue` — which
 * is the precise way an ordering gate keeps passing while it stops meaning
 * anything. `assertStoreLockOrderAgreesWithWorkspace` below is what turns a
 * change on child 4's side into a loud failure instead of a silent absorption.
 */
export const STORE_LOCK_ORDER: readonly StoreLockKind[] = Object.freeze([
  // One per Store while a new UID/key is checked and its record is published.
  'issue-allocation',
  // Taken by an Issue or Execution Plan write, keyed (storeUid, issueUid).
  // FIRST because an Issue is Store-level and touches no project partition, no
  // worktree, and no canonical spec: nothing it holds is ever wanted by a
  // holder of a later key, so prepending it cannot create a cycle.
  'issue',
  // (storeUid, projectId, targetLineId) — target-line writes, plan/apply, cleanup.
  'scope',
  // (workspacePairId), or the prepared pair's provisional key — apply, cleanup.
  'workspace',
  // (changeInstanceId) — published for finalization.
  'change',
  // (storeUid, targetLineId) — published for finalization.
  'integration',
]);

/**
 * The four workspace keys must appear in `STORE_LOCK_ORDER`, in child 4's own
 * order, immediately after the two Issue keys. Called at module load so a divergence is a
 * startup failure rather than a lock acquired in the wrong order at run time.
 */
export function assertStoreLockOrderAgreesWithWorkspace(): void {
  const tail = STORE_LOCK_ORDER.slice(2);
  const expected = WORKSPACE_LOCK_ORDER;
  const agrees =
    tail.length === expected.length &&
    tail.every((kind, index) => kind === expected[index]);
  if (!agrees) {
    throw new Error(
      `store lock order disagrees with the workspace Module: expected issue-allocation -> issue -> ${expected.join(
        ' -> '
      )}, found ${STORE_LOCK_ORDER.join(' -> ')}. Extend STORE_LOCK_ORDER by enumerating the new key with its reason and deciding where it sits relative to 'issue'.`
    );
  }
  if (STORE_LOCK_ORDER[0] !== 'issue-allocation' || STORE_LOCK_ORDER[1] !== 'issue') {
    throw new Error(
      "store lock order must begin with 'issue-allocation' -> 'issue'; a later position would let Issue creation reach back while holding a later key."
    );
  }
}

assertStoreLockOrderAgreesWithWorkspace();

export interface IssueLockKey {
  readonly kind: 'issue';
  readonly material: Readonly<Record<string, string>>;
  readonly label: string;
}

export interface IssueAllocationLockKey {
  readonly kind: 'issue-allocation';
  readonly material: Readonly<Record<string, string>>;
  readonly label: string;
}

type IssueCoordinationLockKey = IssueAllocationLockKey | IssueLockKey;

export function issueAllocationLockKey(input: {
  readonly storeUid: string;
}): IssueAllocationLockKey {
  return {
    kind: 'issue-allocation',
    material: { storeUid: input.storeUid },
    label: `Issue allocation in Store ${input.storeUid}`,
  };
}

/**
 * Keyed by SEMANTIC identity — the permanent Store identity and the Issue
 * identifier — never by a title, a directory spelling, or a branch. The
 * filename is a digest of the canonically serialized key material, so an
 * identifier's length or case never becomes a filesystem property.
 */
export function issueLockKey(input: {
  readonly storeUid: string;
  readonly issueUid: string;
}): IssueLockKey {
  return {
    kind: 'issue',
    material: { storeUid: input.storeUid, issueUid: input.issueUid },
    label: `Issue ${input.issueUid}`,
  };
}

export function issueLockFileName(key: IssueCoordinationLockKey): string {
  const digest = createHash('sha256')
    .update(issueLockCanonicalBytes(key))
    .digest('hex');
  return `${key.kind}-${digest}.lock`;
}

export function issueLockPath(
  coordination: WorkspaceCoordination,
  key: IssueCoordinationLockKey
): string {
  return coordination.resolve(path.join(LOCKS_DIR_NAME, issueLockFileName(key)));
}

interface HeldIssueLocks {
  readonly held: boolean;
  readonly keys: readonly IssueLockKey[];
}

const heldIssue = new AsyncLocalStorage<HeldIssueLocks>();
const heldAllocation = new AsyncLocalStorage<boolean>();

/** Whether this async context currently holds the issue lock. */
export function issueLockHeld(): boolean {
  return heldIssue.getStore()?.held === true;
}

export function issueAllocationLockHeld(): boolean {
  return heldAllocation.getStore() === true;
}

/** Canonical domain bytes used both for lock filenames and batch ordering. */
export function issueLockCanonicalBytes(key: IssueCoordinationLockKey): Buffer {
  return canonicalBytes({ domain: 'issue-lock/v1', kind: key.kind, material: key.material });
}

/** The canonical batch held by the current async publication context. */
export function heldIssueLockKeys(): readonly IssueLockKey[] {
  return heldIssue.getStore()?.keys ?? [];
}

/** Every lock kind this async context holds, in acquisition order. */
export function heldStoreLockKinds(): readonly StoreLockKind[] {
  return [
    ...(issueAllocationLockHeld() ? (['issue-allocation'] as const) : []),
    ...(issueLockHeld() ? (['issue'] as const) : []),
    ...heldLockKinds(),
  ];
}

export function assertIssueAllocationAcquisitionOrder(
  held: readonly StoreLockKind[] = heldStoreLockKinds()
): void {
  if (held.length > 0) {
    throw new Error(
      `store lock ordering violated: cannot take the issue-allocation lock while holding ${held.join(
        ', '
      )}; the order is ${STORE_LOCK_ORDER.join(' -> ')}`
    );
  }
}

/**
 * Refuses taking the issue key while a later key is held. This is a programming
 * error rather than an operator-facing refusal, so it throws a plain Error the
 * same way the workspace Module's assertion does.
 */
export function assertIssueAcquisitionOrder(
  held: readonly StoreLockKind[] = heldStoreLockKinds()
): void {
  const later = held.filter(kind => STORE_LOCK_ORDER.indexOf(kind) > 1);
  if (later.length > 0) {
    throw new Error(
      `store lock ordering violated: cannot take the issue lock while holding ${later.join(
        ', '
      )}; the order is ${STORE_LOCK_ORDER.join(' -> ')}`
    );
  }
  if (held.includes('issue')) {
    throw new Error(
      'store lock ordering violated: the issue lock is already held in this acquisition'
    );
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
  key: IssueCoordinationLockKey
): (kind: FileLockErrorKind, info: FileLockErrorInfo) => Error {
  return (kind, info) => {
    if (kind === 'create-failed') {
      return issueError(
        'issue_scope_required',
        `Cannot create the issue lock file ${info.lockPath} (${
          (info.cause as NodeJS.ErrnoException | undefined)?.code ?? String(info.cause)
        }).`,
        {
          target: info.lockPath,
          fix: `Check permissions on ${path.dirname(info.lockPath)}, then retry.`,
        }
      );
    }
    return issueError(
      'issue_scope_required',
      `The issue lock for ${key.label} is held by ${readHolder(info.lockPath)}.`,
      {
        target: info.lockPath,
        fix: `Wait for that operation to finish and retry. Rasen never steals a lock held by a live process; if the holder is gone, remove ${info.lockPath}.`,
      }
    );
  };
}

export interface IssueLockOptions {
  readonly deadlineMs?: number;
  readonly pollMs?: number;
  /** Internal deterministic-observation seam used by Store migration tests. */
  readonly onAcquired?: (
    key: IssueLockKey,
    index: number,
    total: number
  ) => Promise<void>;
}

export interface IssueAllocationLockOptions {
  readonly deadlineMs?: number;
  readonly pollMs?: number;
}

export async function withIssueAllocationLock<T>(
  coordination: WorkspaceCoordination,
  key: IssueAllocationLockKey,
  fn: () => Promise<T>,
  options: IssueAllocationLockOptions = {}
): Promise<T> {
  assertIssueAllocationAcquisitionOrder();
  const handle = await acquireOwnerAwareFileLock({
    lockPath: issueLockPath(coordination, key),
    errorFor: lockErrorFor(key),
    holder: key.label,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
  });
  try {
    return await heldAllocation.run(true, fn);
  } finally {
    await releaseOwnerAwareFileLock(handle);
  }
}

/** Takes the issue key and runs `fn` under it. Released even on failure. */
export async function withIssueLock<T>(
  coordination: WorkspaceCoordination,
  key: IssueLockKey,
  fn: () => Promise<T>,
  options: IssueLockOptions = {}
): Promise<T> {
  assertIssueAcquisitionOrder();
  const handle = await acquireOwnerAwareFileLock({
    lockPath: issueLockPath(coordination, key),
    errorFor: lockErrorFor(key),
    holder: key.label,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
  });
  try {
    return await heldIssue.run({ held: true, keys: [key] }, fn);
  } finally {
    await releaseOwnerAwareFileLock(handle);
  }
}


/**
 * Acquires one complete migration Issue batch in canonical byte order.
 * Partial acquisition and callback failure both release exactly once in
 * reverse order.  The layout module supplies already constructed normal Issue
 * keys, so this remains the sole path/holder/stale-owner implementation.
 */
export async function withIssueLockBatch<T>(
  coordination: WorkspaceCoordination,
  inputKeys: readonly IssueLockKey[],
  fn: () => Promise<T>,
  options: IssueLockOptions = {}
): Promise<T> {
  assertIssueAcquisitionOrder();
  const byBytes = new Map<string, IssueLockKey>();
  for (const key of inputKeys) {
    if (key.kind !== 'issue') {
      throw new Error(`Issue batch contains non-issue key '${String(key.kind)}'.`);
    }
    const bytes = issueLockCanonicalBytes(key);
    byBytes.set(bytes.toString('hex'), key);
  }
  const keys = [...byBytes.values()].sort((left, right) =>
    Buffer.compare(issueLockCanonicalBytes(left), issueLockCanonicalBytes(right))
  );
  const handles: Awaited<ReturnType<typeof acquireOwnerAwareFileLock>>[] = [];
  try {
    for (const key of keys) {
      handles.push(
        await acquireOwnerAwareFileLock({
          lockPath: issueLockPath(coordination, key),
          errorFor: lockErrorFor(key),
          holder: key.label,
          ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
          ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
        })
      );
      await options.onAcquired?.(key, handles.length - 1, keys.length);
    }
    return await heldIssue.run({ held: true, keys: Object.freeze(keys) }, fn);
  } finally {
    for (const handle of [...handles].reverse()) {
      await releaseOwnerAwareFileLock(handle);
    }
  }
}
