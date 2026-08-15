/**
 * Worktree identity.
 *
 * Child 1 specifies `WorktreeInstanceId` as derived from "canonical repository
 * identity and canonical physical worktree identity supplied by the local Git
 * adapter". This is the supply:
 *
 *   canonicalRepositoryIdentity = canonicalized absolute `--git-common-dir`
 *   canonicalWorktreeIdentity   = canonicalized absolute `--show-toplevel`
 *
 * Both go through the same canonicalization and platform case rule the planning
 * resolver uses, so drive-letter case, Windows short names, junctions, and
 * separator forms all collapse to ONE identity. A path that cannot be
 * canonicalized yields NO identity and fails closed; it never degrades to the
 * literal string, because a literal-string identity would make two spellings of
 * one worktree look like two worktrees and silently create a second binding.
 *
 * The common directory is shared by every linked worktree of a repository,
 * which is exactly why it is the repository half: two worktrees of one
 * repository share a repository identity and differ in their worktree identity.
 */
import * as path from 'node:path';

import {
  deriveWorktreeInstanceId,
  type WorktreeInstanceId,
} from '../planning-identity.js';
import type { StorePlanningPathFlavor } from '../planning-layout-v2.js';
import type { StoreWorkspaceDependencies, WorktreeListEntry } from './dependencies.js';
import { workspaceError } from './diagnostics.js';

export function pathApiFor(flavor: StorePlanningPathFlavor): path.PlatformPath {
  if (flavor === 'win32') return path.win32;
  if (flavor === 'posix') return path.posix;
  return path;
}

/** The platform case rule: Windows paths compare case-insensitively. */
export function comparablePath(value: string, flavor: StorePlanningPathFlavor): string {
  const api = pathApiFor(flavor);
  const resolved = api.resolve(value);
  return flavor === 'win32' || (flavor === 'native' && process.platform === 'win32')
    ? resolved.toLowerCase()
    : resolved;
}

export function samePath(
  left: string,
  right: string,
  flavor: StorePlanningPathFlavor
): boolean {
  return comparablePath(left, flavor) === comparablePath(right, flavor);
}

/**
 * Is `candidate` inside `root` (or `root` itself)? Computed on the plan's
 * declared path flavor, so a `win32` fixture behaves identically on a POSIX
 * host.
 */
export function isContainedIn(
  root: string,
  candidate: string,
  flavor: StorePlanningPathFlavor
): boolean {
  const api = pathApiFor(flavor);
  const relative = api.relative(comparablePath(root, flavor), comparablePath(candidate, flavor));
  if (relative.length === 0) return true;
  return !relative.startsWith('..') && !api.isAbsolute(relative);
}

export interface WorktreeIdentity {
  readonly repositoryIdentity: string;
  readonly worktreeIdentity: string;
  readonly worktreeInstanceId: WorktreeInstanceId;
  /** The canonical worktree root, for recording and comparison. */
  readonly canonicalRoot: string;
  /** The canonical repository common directory. */
  readonly canonicalCommonDir: string;
}

/**
 * Derives both identity inputs and the instance id for an EXISTING worktree.
 * Returns null when the path is not inside a Git work tree; throws when it is
 * one but its identity cannot be established.
 */
export async function deriveWorktreeIdentity(
  dependencies: StoreWorkspaceDependencies,
  root: string,
  flavor: StorePlanningPathFlavor = 'native'
): Promise<WorktreeIdentity | null> {
  const paths = await dependencies.git.repositoryPaths(root);
  if (paths === null) return null;

  let canonicalRoot: string;
  let canonicalCommonDir: string;
  try {
    canonicalRoot = dependencies.fs.canonicalizeExisting(paths.toplevel);
    canonicalCommonDir = dependencies.fs.canonicalizeExisting(paths.commonDir);
  } catch (error) {
    throw workspaceError(
      'workspace_identity_unavailable',
      `Worktree identity for ${root} cannot be established: its canonical path could not be resolved.`,
      {
        target: root,
        fix: 'Make the worktree and its repository directory readable, then retry. Rasen never identifies a worktree by an uncanonicalized path.',
        cause: error,
      }
    );
  }

  const repositoryIdentity = comparablePath(canonicalCommonDir, flavor);
  const worktreeIdentity = comparablePath(canonicalRoot, flavor);
  return {
    repositoryIdentity,
    worktreeIdentity,
    worktreeInstanceId: deriveWorktreeInstanceId({ repositoryIdentity, worktreeIdentity }),
    canonicalRoot,
    canonicalCommonDir,
  };
}

/**
 * The worktree list of the repository containing `root`, with the main checkout
 * flagged. Returns null when `root` is not in a Git work tree.
 */
export async function listWorktrees(
  dependencies: StoreWorkspaceDependencies,
  root: string
): Promise<readonly WorktreeListEntry[] | null> {
  return dependencies.git.worktreeList(root);
}

/** Is `root` a LINKED worktree of its repository — never the main checkout? */
export async function isLinkedWorktree(
  dependencies: StoreWorkspaceDependencies,
  root: string,
  flavor: StorePlanningPathFlavor = 'native'
): Promise<boolean | null> {
  const entries = await listWorktrees(dependencies, root);
  if (entries === null || entries.length === 0) return null;
  const match = entries.find((entry) => samePath(entry.root, root, flavor));
  if (match === undefined) {
    // The path resolves through an alias Git did not print; compare canonically.
    let canonical: string;
    try {
      canonical = dependencies.fs.canonicalizeExisting(root);
    } catch {
      return null;
    }
    const aliased = entries.find((entry) => {
      try {
        return samePath(dependencies.fs.canonicalizeExisting(entry.root), canonical, flavor);
      } catch {
        return false;
      }
    });
    return aliased === undefined ? null : !aliased.main;
  }
  return !match.main;
}
