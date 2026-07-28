export type RunScope = 'same' | 'other' | 'mismatch';

export type ScopeErrorCode = 'scope_mismatch_blocks_mutation';

export class ScopeError extends Error {
  constructor(
    readonly code: ScopeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ScopeError';
  }
}

export interface ScopeIdentity {
  readonly planningSpaceId: string;
  readonly workspaceInstanceId: string;
}

/**
 * Selected-root scope (task 8.9). A mutation (resume/complete/control/host)
 * targets exactly one Run under the selected workspace; a workspace or
 * Change-instance mismatch blocks it with zero writes. An exact cross-worktree
 * inspect within the same PlanningSpace is read-only and reported as
 * `scope: other`.
 */
export function classifyRunScope(selected: ScopeIdentity, run: ScopeIdentity): RunScope {
  if (selected.planningSpaceId !== run.planningSpaceId) return 'mismatch';
  if (selected.workspaceInstanceId !== run.workspaceInstanceId) return 'other';
  return 'same';
}

/** Mutations require the exact same workspace; any other scope is blocked. */
export function assertMutationScope(selected: ScopeIdentity, run: ScopeIdentity): void {
  if (classifyRunScope(selected, run) !== 'same') {
    throw new ScopeError(
      'scope_mismatch_blocks_mutation',
      'A Run mutation requires the selected workspace to match the Run workspace exactly.'
    );
  }
}
