/**
 * Where a Store-level Issue write may land.
 *
 * An Issue scope resolves ONE Store and requires no project and no target line;
 * that is the accepted design's §7 exception, and it is the whole reason this
 * resolution is separate from the project-scoped one. It never invents,
 * infers, or demands a project, and opening it confers no project authority.
 *
 * The one location rule this slice adds is the refusal: a bound planning
 * worktree. That worktree's branch is ONE Change's unmerged line, so a
 * cross-line resource authored there is guaranteed to be invisible from every
 * other line until an unrelated merge. The refusal names the checkout, the
 * Change it is bound to, and the repair.
 */
import * as path from 'node:path';

import { resolveStorePlanningLayoutV2Path } from '../planning-foundation.js';
import {
  PLANNING_MARKER_FILE_NAME,
  RUN_STATE_DIR_NAME,
} from '../workspace/binding.js';
import { listAllWorkspaceIndexEntries } from '../workspace/registry.js';
import {
  resolveQueryStore,
  type ResolvedQueryStore,
} from '../query/refs.js';
import { nodeStoreQueryFileSystem } from '../query/dependencies.js';
import type { StoreIssueDependencies } from './dependencies.js';
import { issueError, issueRefusal } from './diagnostics.js';

export interface ResolvedIssueScope extends ResolvedQueryStore {
  /** The Store checkout this command is standing in. A Git-tracked write lands here. */
  readonly checkoutRoot: string;
  readonly checkoutRef: string | null;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value);
  return process.platform === 'win32'
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right);
}

/**
 * The canonical absolute form of an existing path, falling back to the resolved
 * literal when the path cannot be canonicalized. A worktree Git just listed
 * normally exists; the fallback keeps a transient failure from turning a
 * resolvable scope into a refusal.
 */
function canonicalOrLiteral(
  dependencies: StoreIssueDependencies,
  candidate: string
): string {
  try {
    return dependencies.fs.canonicalizeExisting(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function isContainedIn(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/**
 * Resolves a Store-level Issue scope: the Store, and the checkout of it this
 * command is standing in. Neither a project nor a target line is required,
 * requested, or invented.
 */
export async function resolveIssueScope(
  dependencies: StoreIssueDependencies,
  input: {
    readonly store?: string;
    readonly startPath: string;
    readonly globalDataDir?: string;
  }
): Promise<ResolvedIssueScope> {
  const store = await resolveQueryStore(
    { fs: nodeStoreQueryFileSystem },
    {
      ...(input.store === undefined ? {} : { store: input.store }),
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    }
  );

  const worktrees = await dependencies.checkout.worktreeRoots(store.registeredRoot);
  let checkoutRoot = store.registeredRoot;
  for (const candidate of worktrees ?? []) {
    if (isContainedIn(candidate, input.startPath)) {
      // `git worktree list` prints POSIX-separated paths even on Windows, so a
      // root taken straight from it is a DIFFERENT SPELLING of the same
      // directory. Every path this scope reports is an identity a caller
      // compares, so it is canonicalized rather than passed through.
      checkoutRoot = canonicalOrLiteral(dependencies, candidate);
      break;
    }
  }
  const checkoutRef = await dependencies.checkout.checkedOutRef(checkoutRoot);
  return { ...store, checkoutRoot, checkoutRef };
}

/**
 * Refuses an Issue write whose resolved checkout is a planning worktree bound
 * to a Change.
 *
 * Marker PRESENCE is deliberately sufficient HERE, unlike everywhere child 4
 * verifies a worktree. This is a refusal, so the conservative direction is to
 * believe a marker that says "this checkout is one Change's line": a false
 * refusal costs one `cd`, a false ACCEPT writes a cross-line resource onto a
 * branch nothing else can see.
 */
export async function assertIssueWriteLocation(
  dependencies: StoreIssueDependencies,
  scope: ResolvedIssueScope,
  globalDataDir?: string
): Promise<void> {
  const markerPath = path.join(
    scope.checkoutRoot,
    RUN_STATE_DIR_NAME,
    PLANNING_MARKER_FILE_NAME
  );
  if ((await dependencies.fs.statKind(markerPath)) !== 'file') return;

  const coordination = dependencies.coordination(globalDataDir);
  const entries = await listAllWorkspaceIndexEntries(coordination);
  const bound = entries.find(entry => samePath(entry.planning.root, scope.checkoutRoot));
  const changeDescription =
    bound === undefined
      ? 'a Change this machine has no index entry for'
      : `Change '${bound.changeId}' (${bound.projectId} on ${bound.targetLineId})`;

  throw issueRefusal(
    'issue_write_requires_store_checkout',
    `${scope.checkoutRoot} is a planning worktree bound to ${changeDescription}, so an Issue written there would live on one Change's unmerged line and be invisible from every other target line.`,
    {
      expected: 'a Store checkout that is not bound to a Change',
      actual: scope.checkoutRoot,
      target: markerPath,
      fix: `Run the Issue write from a Store checkout that is not a planning worktree — the Store's integration checkout at ${scope.registeredRoot} is one — or pass --store and run it from outside any planning worktree.`,
    }
  );
}

/** The four Store-level Issue addresses, all computed from the layout contract. */
export function issueAddresses(
  storeCheckoutRoot: string,
  issueId: string
): {
  readonly directory: string;
  readonly record: string;
  readonly plans: string;
  readonly readme: string;
} {
  const directory = resolveStorePlanningLayoutV2Path(storeCheckoutRoot, {
    kind: 'issue',
    issueId,
  });
  return {
    directory,
    record: resolveStorePlanningLayoutV2Path(storeCheckoutRoot, {
      kind: 'issue-record',
      issueId,
    }),
    plans: resolveStorePlanningLayoutV2Path(storeCheckoutRoot, {
      kind: 'execution-plans',
      issueId,
    }),
    // The narrative is optional and is never parsed for facts, so it is not a
    // layout address; it is the one Issue file whose absence changes nothing.
    readme: path.join(directory, 'README.md'),
  };
}

export function revisionAddress(
  storeCheckoutRoot: string,
  issueId: string,
  revisionId: string
): string {
  return resolveStorePlanningLayoutV2Path(storeCheckoutRoot, {
    kind: 'execution-plan',
    issueId,
    revisionId,
  });
}

/**
 * The Store-relative POSIX pathspec a commit suggestion names. Issue content is
 * Git-tracked Store content, and Rasen stages nothing.
 */
export function issuePathspec(storeCheckoutRoot: string, target: string): string {
  return path.relative(storeCheckoutRoot, target).split(path.sep).join('/');
}

export function requireIssueScopeStore(store: string | undefined): string {
  if (store === undefined || store.length === 0) {
    throw issueError(
      'issue_scope_required',
      'A Store-level Issue operation resolves exactly one Store and requires no project and no target line.',
      { target: 'selection.store', fix: 'Add --store <store-id>.' }
    );
  }
  return store;
}
