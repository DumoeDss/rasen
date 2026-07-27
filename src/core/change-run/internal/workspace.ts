import { createHash } from 'node:crypto';

import type { Digest, WorkspaceRevision } from '../contracts.js';
import { canonicalJson, domainDigest } from './identity.js';

export type WorkspaceHead =
  | Readonly<{ kind: 'commit'; digest: Digest; detached: boolean }>
  | Readonly<{ kind: 'unborn' }>
  | Readonly<{ kind: 'detached'; digest: Digest }>;

export interface WorkspaceTreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly blobDigest: Digest;
}

export interface WorkspaceIndexEntry {
  readonly path: string;
  readonly stage: number;
  readonly mode: string;
  readonly blobDigest: Digest;
}

export interface WorkspaceWorkingEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mode: string;
}

export interface WorkspaceUntrackedEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface WorkspaceSymlinkEntry {
  readonly path: string;
  readonly target: string;
}

export interface WorkspaceSubmoduleEntry {
  readonly path: string;
  readonly gitlinkCommit: Digest;
  readonly headCommit?: Digest;
  readonly innerClean: boolean;
  readonly supported: boolean;
}

/**
 * A path-independent snapshot of one workspace's git state, collected by
 * bounded git plumbing plus physical reads. The observer is pure over this
 * manifest; the plumbing adapter (which shells out to git) is the runtime
 * substitute, and tests supply golden manifests directly.
 */
export interface WorkspaceManifest {
  readonly head: WorkspaceHead;
  readonly headTree: readonly WorkspaceTreeEntry[];
  readonly index: readonly WorkspaceIndexEntry[];
  readonly trackedWorking: readonly WorkspaceWorkingEntry[];
  readonly untracked: readonly WorkspaceUntrackedEntry[];
  readonly symlinks: readonly WorkspaceSymlinkEntry[];
  readonly submodules: readonly WorkspaceSubmoduleEntry[];
}

export type WorkspaceErrorCode =
  | 'workspace_path_normalization'
  | 'workspace_submodule_dirty'
  | 'workspace_submodule_unsupported';

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** Blob digest of raw working bytes (git-style sha256 content identity). */
export function blobDigest(bytes: Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Digest;
}

/**
 * Normalize a git path to the canonical form the manifest digests over:
 * forward slashes, Unicode NFC. Case-colliding distinct entries are the
 * plumbing adapter's responsibility to reject; here we only canonicalize.
 */
function nfcPath(path: string): string {
  return path.split('\\').join('/').normalize('NFC');
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedManifest(manifest: WorkspaceManifest): Record<string, unknown> {
  const byPath = <T extends { path: string }>(entries: readonly T[]) =>
    [...entries]
      .map((entry) => ({ ...entry, path: nfcPath(entry.path) }))
      .sort((left, right) => compareStrings(left.path, right.path));
  return {
    head: manifest.head,
    headTree: byPath(manifest.headTree),
    index: byPath(manifest.index),
    trackedWorking: byPath(manifest.trackedWorking).map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      blobDigest: blobDigest(entry.bytes),
    })),
    untracked: byPath(manifest.untracked).map((entry) => ({
      path: entry.path,
      blobDigest: blobDigest(entry.bytes),
    })),
    symlinks: byPath(manifest.symlinks),
    submodules: byPath(manifest.submodules),
  };
}

/**
 * `treeDigest` covers the complete current manifest; any mutation of HEAD,
 * index, tracked working bytes/modes, untracked content, symlinks, or
 * submodule state changes it. Order-independent (canonical path sort + NFC).
 */
export function deriveTreeDigest(manifest: WorkspaceManifest): Digest {
  return domainDigest('workspace-tree/1', sortedManifest(manifest));
}

interface DirtyDelta {
  readonly staged: readonly Readonly<{ path: string; mode?: string; blobDigest: Digest }>[];
  readonly unstaged: readonly Readonly<{ path: string; mode?: string; blobDigest: Digest }>[];
  readonly untracked: readonly Digest[];
  readonly deleted: readonly string[];
}

/**
 * Compute the canonical staged/unstaged/untracked delta from HEAD. The
 * `dirtyWorktreeDigest` binds exactly these differences; a workspace that
 * matches HEAD on every tracked path and has no untracked content yields a
 * stable clean delta regardless of path enumeration order.
 */
function dirtyDelta(manifest: WorkspaceManifest): DirtyDelta {
  const headByPath = new Map(
    manifest.headTree.map((entry) => [nfcPath(entry.path), entry] as const)
  );
  const indexByPath = new Map(
    manifest.index.map((entry) => [nfcPath(entry.path), entry] as const)
  );

  const staged: DirtyDelta['staged'][number][] = [];
  const deleted: string[] = [];
  for (const entry of manifest.index) {
    const path = nfcPath(entry.path);
    const head = headByPath.get(path);
    if (head === undefined) {
      staged.push({ path, mode: entry.mode, blobDigest: entry.blobDigest });
    } else if (head.mode !== entry.mode || head.blobDigest !== entry.blobDigest) {
      staged.push({ path, mode: entry.mode, blobDigest: entry.blobDigest });
    }
  }
  for (const [path] of headByPath) {
    if (!indexByPath.has(path)) deleted.push(path);
  }

  const unstaged: DirtyDelta['unstaged'][number][] = [];
  for (const entry of manifest.trackedWorking) {
    const path = nfcPath(entry.path);
    const index = indexByPath.get(path);
    const workingDigest = blobDigest(entry.bytes);
    if (index === undefined) continue;
    if (index.mode !== entry.mode || index.blobDigest !== workingDigest) {
      unstaged.push({ path, mode: entry.mode, blobDigest: workingDigest });
    }
  }

  const untracked = manifest.untracked.map((entry) => blobDigest(entry.bytes));

  return {
    staged: staged.sort((left, right) => compareStrings(left.path, right.path)),
    unstaged: unstaged.sort((left, right) => compareStrings(left.path, right.path)),
    untracked: [...untracked].sort(compareStrings),
    deleted: [...deleted].sort(compareStrings),
  };
}

export function deriveDirtyWorktreeDigest(manifest: WorkspaceManifest): Digest {
  return domainDigest('workspace-dirty/1', dirtyDelta(manifest));
}

function headRevision(head: WorkspaceHead): WorkspaceRevision['head'] {
  switch (head.kind) {
    case 'commit':
      return { kind: 'commit', digest: head.digest, detached: head.detached };
    case 'detached':
      // A detached HEAD is a commit reference with the detached flag set.
      return { kind: 'commit', digest: head.digest, detached: true };
    case 'unborn':
      return { kind: 'unborn', detached: false };
  }
}

/**
 * Derive the canonical path-independent {@link WorkspaceRevision} from a
 * workspace manifest. Each clean submodule contributes its superproject
 * gitlink plus checked-out commit; any inner dirtiness, nested submodule,
 * uninitialized/unreadable state, race, or budget excess fails typed
 * (workspace_submodule_dirty / workspace_submodule_unsupported) rather than
 * being folded into a digest that could hide mutation.
 */
export function deriveWorkspaceRevision(
  manifest: WorkspaceManifest
): WorkspaceRevision {
  for (const submodule of manifest.submodules) {
    if (!submodule.supported) {
      throw new WorkspaceError(
        'workspace_submodule_unsupported',
        `Submodule ${submodule.path} is uninitialized, unreadable, racing, or over budget.`
      );
    }
    if (!submodule.innerClean) {
      throw new WorkspaceError(
        'workspace_submodule_dirty',
        `Submodule ${submodule.path} has internal staged/unstaged/untracked or nested dirtiness.`
      );
    }
  }
  return Object.freeze({
    format: 'workspace-revision/1',
    head: headRevision(manifest.head),
    treeDigest: deriveTreeDigest(manifest),
    dirtyWorktreeDigest: deriveDirtyWorktreeDigest(manifest),
  } as WorkspaceRevision);
}

/** Structural equality of two workspace revisions (head + tree + dirty). */
export function workspaceMatches(
  a: WorkspaceRevision,
  b: WorkspaceRevision
): boolean {
  return (
    canonicalJson(a.head) === canonicalJson(b.head) &&
    a.treeDigest === b.treeDigest &&
    a.dirtyWorktreeDigest === b.dirtyWorktreeDigest
  );
}

export type WorkspaceDrift = 'unchanged' | 'drifted';

/** Detect whether an observed revision drifted from the expected baseline. */
export function detectWorkspaceDrift(
  expected: WorkspaceRevision,
  observed: WorkspaceRevision
): WorkspaceDrift {
  return workspaceMatches(expected, observed) ? 'unchanged' : 'drifted';
}

/**
 * Writer completion verification (task 8.3). A workspace writer must prove its
 * expected before-revision matches the observed before-revision; otherwise the
 * workspace was changed by something else and the writer's effect is ungrounded
 * (workspace-drift). A `not_executed` writer must prove before === after (no
 * delta); a successful writer's after is the validated new revision.
 */
export function verifyWriterBefore(
  expectedBefore: WorkspaceRevision,
  observedBefore: WorkspaceRevision
): WorkspaceDrift {
  return detectWorkspaceDrift(expectedBefore, observedBefore);
}

/** A not_executed writer must leave the workspace byte-identical (no delta). */
export function verifyWriterNotExecuted(
  before: WorkspaceRevision,
  after: WorkspaceRevision
): boolean {
  return workspaceMatches(before, after);
}

export { canonicalJson };
