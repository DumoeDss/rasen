/**
 * A deterministic in-memory implementation of the finalization Module's
 * read-only Git adapter.
 *
 * The Module's own adapter can only READ, so an in-memory stand-in is a
 * complete substitute for the prover and the successor search — the two units
 * whose interesting cases (an indeterminate ancestry answer, an unreadable
 * Store ref, an ambiguous ref) are difficult or impossible to produce on demand
 * against real Git, and whose behavior on those cases is exactly what must be
 * pinned.
 *
 * Everything that depends on real worktree identity, real OIDs, or a real
 * transaction uses `store-finalization-fixture.ts` instead. This is for the
 * pure logic above the adapter, not a substitute for the end-to-end proof.
 */
import type {
  FinalizationDependencies,
  FinalizationGit,
  FinalizationRefTarget,
} from '../../src/core/store/finalization/dependencies.js';
import type {
  WorkspaceCoordination,
  WorkspaceFileSystem,
} from '../../src/core/store/workspace/dependencies.js';

export interface MemoryGitSeed {
  /** Object ids that resolve as commits. A revision absent here resolves to null. */
  readonly commits?: readonly string[];
  /** Full ref name -> the objects `for-each-ref` prints for it (>1 is ambiguous). */
  readonly refs?: Readonly<Record<string, readonly FinalizationRefTarget[]>>;
  /** `${descendantOid}` -> the ancestors reachable from it. */
  readonly ancestors?: Readonly<Record<string, readonly string[]>>;
  /** `${ancestor}->${descendant}` pairs whose ancestry Git cannot determine. */
  readonly indeterminate?: readonly string[];
  /** `${ref}:${portablePath}` -> blob content. */
  readonly blobs?: Readonly<Record<string, string>>;
  /** `${ref}:${portablePath}` -> tree entry names, directories keeping their `/`. */
  readonly trees?: Readonly<Record<string, readonly string[]>>;
  readonly heads?: Readonly<Record<string, string>>;
  readonly checkedOut?: Readonly<Record<string, string>>;
  readonly status?: Readonly<Record<string, readonly string[]>>;
}

export interface MemoryGit extends FinalizationGit {
  /** Every `(repoRoot, args)` this adapter was asked for, in order. */
  readonly calls: string[];
}

export function createMemoryFinalizationGit(seed: MemoryGitSeed = {}): MemoryGit {
  const commits = new Set(seed.commits ?? []);
  const refs = seed.refs ?? {};
  const ancestors = seed.ancestors ?? {};
  const indeterminate = new Set(seed.indeterminate ?? []);
  const blobs = seed.blobs ?? {};
  const trees = seed.trees ?? {};
  const heads = seed.heads ?? {};
  const checkedOut = seed.checkedOut ?? {};
  const status = seed.status ?? {};
  const calls: string[] = [];

  return {
    calls,
    async resolveCommit(repoRoot, rev) {
      calls.push(`resolveCommit ${repoRoot} ${rev}`);
      if (commits.has(rev)) return rev;
      const targets = refs[rev];
      const first = targets?.[0];
      if (targets !== undefined && targets.length === 1 && first?.objectType === 'commit') {
        return first.oid;
      }
      return null;
    },
    async resolveRef(repoRoot, ref) {
      calls.push(`resolveRef ${repoRoot} ${ref}`);
      return refs[ref] ?? [];
    },
    async isAncestor(repoRoot, ancestor, descendant) {
      calls.push(`isAncestor ${repoRoot} ${ancestor} ${descendant}`);
      if (indeterminate.has(`${ancestor}->${descendant}`)) return null;
      if (ancestor === descendant) return true;
      return (ancestors[descendant] ?? []).includes(ancestor);
    },
    async showBlob(repoRoot, ref, portablePath) {
      calls.push(`showBlob ${repoRoot} ${ref}:${portablePath}`);
      return blobs[`${ref}:${portablePath}`] ?? null;
    },
    async showTree(repoRoot, ref, portablePath) {
      calls.push(`showTree ${repoRoot} ${ref}:${portablePath}`);
      const entries = trees[`${ref}:${portablePath}`];
      return entries === undefined ? null : [...entries];
    },
    async repositoryPaths(root) {
      calls.push(`repositoryPaths ${root}`);
      return null;
    },
    async checkedOutRef(root) {
      calls.push(`checkedOutRef ${root}`);
      return checkedOut[root] ?? null;
    },
    async headOid(root) {
      calls.push(`headOid ${root}`);
      return heads[root] ?? null;
    },
    async statusEntries(root) {
      calls.push(`statusEntries ${root}`);
      return status[root] ?? [];
    },
  };
}

/** A dependency set whose Git is in memory and whose other adapters throw if used. */
export function memoryFinalizationDependencies(
  git: FinalizationGit,
  overrides: Partial<FinalizationDependencies> = {}
): FinalizationDependencies {
  const refuse = (what: string) => () => {
    throw new Error(`this in-memory dependency set has no ${what}`);
  };
  return {
    fs: refuse('filesystem') as unknown as WorkspaceFileSystem,
    git,
    coordination: refuse('coordination store') as unknown as (
      globalDataDir?: string
    ) => WorkspaceCoordination,
    snapshotProjects: async () => [],
    now: () => new Date('2026-08-07T00:00:00.000Z'),
    ...overrides,
  };
}
