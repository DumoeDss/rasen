/**
 * The two locks finalization takes, and an honest note about the two it does
 * not.
 *
 * | key         | material                            | taken here |
 * | scope       | (storeUid, projectId, targetLineId) | yes — the destination and the canonical specs are scope-owned |
 * | workspace   | (workspacePairId)                   | no  — no worktree is created, moved, or removed |
 * | change      | (changeInstanceId)                  | yes — two finalizations of one Change instance must be mutually exclusive |
 * | integration | (storeUid, targetLineId)            | no  — this capability performs no merge into a Store integration ref |
 *
 * The integration key is left DEFINED and UNHELD rather than taken "for
 * safety". Taking a lock that protects nothing would make the guarantee look
 * enforced when the operation it guards has not been built; the condition is
 * stated instead — the first slice that merges a planning branch into an
 * integration ref must take it.
 *
 * Keys and acquisition order come from child 4's published protocol, so a
 * finalization and a workspace preparation contend on the same files.
 */
import {
  changeLockKey,
  integrationLockKey,
  scopeLockKey,
  withWorkspaceLocks,
  type WorkspaceLockKey,
} from '../workspace/locks.js';
import type { WorkspaceCoordination } from '../workspace/dependencies.js';
import type { ArchiveFinalizationLockKey } from '../../archive-engine.js';

export interface FinalizationLockScope {
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeInstanceId: string;
}

/** The keys this capability takes, in child 4's fixed order. */
export function finalizationLockKeys(
  scope: FinalizationLockScope
): readonly WorkspaceLockKey[] {
  return [
    scopeLockKey({
      storeUid: scope.storeUid,
      projectId: scope.projectId,
      targetLineId: scope.targetLineId,
    }),
    changeLockKey({ changeInstanceId: scope.changeInstanceId }),
  ];
}

/**
 * The key this capability deliberately does NOT take, published so a reader can
 * see the omission is a decision rather than an oversight.
 */
export function unheldIntegrationLockKey(scope: {
  readonly storeUid: string;
  readonly targetLineId: string;
}): WorkspaceLockKey {
  return integrationLockKey(scope);
}

export function recordedLockKeys(
  scope: FinalizationLockScope
): ArchiveFinalizationLockKey[] {
  return finalizationLockKeys(scope).map(key => ({
    kind: key.kind,
    material: { ...key.material },
    label: key.label,
  }));
}

/**
 * Runs `fn` under the scope and Change-instance locks. Contention retries
 * within a bounded deadline and then reports the recorded holder; a SEMANTIC
 * conflict thrown from inside `fn` is never retried, because retrying cannot
 * change the answer and only delays the diagnostic.
 */
export async function withFinalizationLocks<T>(
  coordination: WorkspaceCoordination,
  scope: FinalizationLockScope,
  fn: () => Promise<T>,
  options: { readonly deadlineMs?: number; readonly pollMs?: number } = {}
): Promise<T> {
  return withWorkspaceLocks(coordination, finalizationLockKeys(scope), fn, options);
}
