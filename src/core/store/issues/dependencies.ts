/**
 * Local-substitutable adapters for the Store-level Issue Module.
 *
 * The Git surface is the aggregate query Module's, unchanged and READ-ONLY:
 * this Module's Git write verb set is EMPTY. It writes files into a Store
 * checkout and prints the pathspec that would commit them; it never stages,
 * commits, fetches, or pushes, and
 * `test/core/store/store-query-read-only-guard.test.ts` fails if a writing verb
 * appears anywhere under `src/core/store/issues/`.
 *
 * The filesystem, coordination, and worktree adapters are the workspace
 * Module's implementations rather than second copies: they are the same machine
 * facilities, and a second copy would drift.
 */
import {
  nodeWorkspaceFileSystem,
  createNodeWorkspaceCoordination,
  nodeWorkspaceGit,
  type WorkspaceCoordination,
  type WorkspaceFileSystem,
} from '../workspace/dependencies.js';
import {
  nodeStoreQueryGit,
  type StoreQueryGit,
} from '../query/dependencies.js';

/** The narrow read-only Git facts an Issue write needs about its checkout. */
export interface IssueCheckoutGit {
  /** The full ref the checkout has out, or null when detached. */
  checkedOutRef(root: string): Promise<string | null>;
  /** Every worktree of the repository containing `root`, or null. */
  worktreeRoots(root: string): Promise<readonly string[] | null>;
}

export interface StoreIssueDependencies {
  readonly fs: WorkspaceFileSystem;
  /** Read-only, shared with the aggregate query Module. */
  readonly git: StoreQueryGit;
  readonly checkout: IssueCheckoutGit;
  coordination(globalDataDir?: string): WorkspaceCoordination;
  now(): Date;
}

export const nodeIssueCheckoutGit: IssueCheckoutGit = {
  checkedOutRef: root => nodeWorkspaceGit.checkedOutRef(root),
  async worktreeRoots(root) {
    const worktrees = await nodeWorkspaceGit.worktreeList(root);
    return worktrees === null ? null : worktrees.map(entry => entry.root);
  },
};

export const productionStoreIssueDependencies: StoreIssueDependencies = {
  fs: nodeWorkspaceFileSystem,
  git: nodeStoreQueryGit,
  checkout: nodeIssueCheckoutGit,
  coordination: globalDataDir => createNodeWorkspaceCoordination(globalDataDir),
  now: () => new Date(),
};

/** A fixed clock, so a published revision is reproducible byte for byte. */
export function withDeterministicIssueClock(
  base: StoreIssueDependencies,
  now: string
): StoreIssueDependencies {
  const frozen = new Date(now);
  if (Number.isNaN(frozen.valueOf())) {
    throw new TypeError(`withDeterministicIssueClock received an invalid date: ${now}`);
  }
  return { ...base, now: () => new Date(frozen.valueOf()) };
}
