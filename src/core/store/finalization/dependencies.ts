/**
 * Local-substitutable adapters for the finalization Module.
 *
 * Filesystem/canonicalization, the machine-root coordination store, the clock,
 * and entropy are reused from the workspace Module's implementations — they are
 * the same machine facilities and a second copy would drift. Git is NOT reused:
 * the workspace adapter can create and remove worktrees, and finalization must
 * never be able to.
 *
 * This Module's Git verb set is closed and read-only, stated once in
 * `FINALIZATION_GIT_VERBS`:
 *
 *   rev-parse, for-each-ref, merge-base --is-ancestor, show, status --porcelain,
 *   symbolic-ref
 *
 * There is no writing verb at all — no `merge`, `rebase`, `reset`, `checkout`,
 * `switch`, `branch`, `worktree`, `add`, `commit`, `fetch`, `pull`, `push`,
 * `clone`, or `tag`. `test/core/store/finalization-git-verb-guard.test.ts`
 * fails if any of them appears anywhere under `src/core/store/finalization/`.
 * Finalization is the only slice in this portfolio that mutates the Store's
 * working tree while making no Git call that writes.
 */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

import {
  createNodeWorkspaceCoordination,
  nodeWorkspaceFileSystem,
  type WorkspaceCoordination,
  type WorkspaceFileSystem,
  type WorkspaceProjectSnapshot,
} from '../workspace/dependencies.js';
import { readProjectRegistryState } from '../../project-registry.js';

const execFilePromise = promisify(execFile);

/** Every Git verb this Module may spawn. All of them read. */
export const FINALIZATION_GIT_VERBS: readonly string[] = Object.freeze([
  'rev-parse',
  'for-each-ref',
  'merge-base',
  'show',
  'status',
  'symbolic-ref',
]);

const ALLOWED_VERBS: ReadonlySet<string> = new Set(FINALIZATION_GIT_VERBS);

export interface FinalizationRefTarget {
  readonly ref: string;
  readonly oid: string;
  readonly objectType: string;
}

/**
 * The read-only Git surface. `isAncestor` returns `null` for an INDETERMINATE
 * answer — Git unavailable, the repository ambiguous, the query failing
 * unexpectedly — which the reachability prover refuses on rather than
 * defaulting either way.
 */
export interface FinalizationGit {
  /** `rev-parse --verify <rev>^{commit}` → full lowercase OID, or null. */
  resolveCommit(repoRoot: string, rev: string): Promise<string | null>;
  /** Every ref matching the exact full name; more than one means ambiguous. */
  resolveRef(repoRoot: string, ref: string): Promise<readonly FinalizationRefTarget[]>;
  /** `merge-base --is-ancestor`; null when the answer cannot be determined. */
  isAncestor(
    repoRoot: string,
    ancestor: string,
    descendant: string
  ): Promise<boolean | null>;
  /** `git show <ref>:<path>` for a blob; null when the path is absent at that ref. */
  showBlob(repoRoot: string, ref: string, portablePath: string): Promise<string | null>;
  /**
   * `git show <ref>:<dir>` for a tree, returning the entry names it lists.
   * Directory entries keep their trailing `/` exactly as Git prints them.
   */
  showTree(
    repoRoot: string,
    ref: string,
    portablePath: string
  ): Promise<readonly string[] | null>;
  checkedOutRef(root: string): Promise<string | null>;
  /** Canonical identity inputs for proving that a root is still a live worktree. */
  repositoryPaths(root: string): Promise<{
    readonly toplevel: string;
    readonly commonDir: string;
  } | null>;
  headOid(root: string): Promise<string | null>;
  /** `status --porcelain` lines. */
  statusEntries(root: string): Promise<readonly string[]>;
}

export interface FinalizationDependencies {
  readonly fs: WorkspaceFileSystem;
  readonly git: FinalizationGit;
  coordination(globalDataDir?: string): WorkspaceCoordination;
  snapshotProjects(globalDataDir?: string): Promise<readonly WorkspaceProjectSnapshot[]>;
  now(): Date;
}

export class FinalizationGitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | undefined
  ) {
    super(
      `git ${args.join(' ')} failed${
        exitCode === undefined ? '' : ` (exit ${exitCode})`
      }: ${stderr.trim()}`
    );
    this.name = 'FinalizationGitCommandError';
  }
}

interface GitRun {
  readonly stdout: string;
  readonly exitCode: number | undefined;
}

/**
 * The one place this Module spawns Git. The verb allow-list is enforced at run
 * time as well as by the source guard, so a call assembled through a variable —
 * which a source scan cannot see — still cannot smuggle a verb in.
 */
async function spawnGit(
  cwd: string,
  args: readonly string[],
  options: { readonly tolerateFailure?: boolean } = {}
): Promise<GitRun | null> {
  const verb = args[0];
  if (verb === undefined || !ALLOWED_VERBS.has(verb)) {
    throw new Error(
      `the finalization Git adapter may only spawn its closed read-only verb set; '${String(verb)}' is not in it`
    );
  }
  try {
    const { stdout } = await execFilePromise('git', ['-C', cwd, ...args], {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as { stderr?: string; code?: number; stdout?: string };
    if (options.tolerateFailure === true) {
      return typeof failure.code === 'number'
        ? { stdout: failure.stdout ?? '', exitCode: failure.code }
        : null;
    }
    throw new FinalizationGitCommandError(args, failure.stderr ?? '', failure.code);
  }
}

function nonEmptyLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export const nodeFinalizationGit: FinalizationGit = {
  async resolveCommit(repoRoot, rev) {
    const result = await spawnGit(repoRoot, ['rev-parse', '--verify', `${rev}^{commit}`], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return null;
    const oid = result.stdout.trim().toLowerCase();
    return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/u.test(oid) ? oid : null;
  },

  async resolveRef(repoRoot, ref) {
    const result = await spawnGit(
      repoRoot,
      ['for-each-ref', '--format=%(refname) %(objectname) %(objecttype)', ref],
      { tolerateFailure: true }
    );
    if (result === null || result.exitCode !== 0) return [];
    return nonEmptyLines(result.stdout)
      .map(line => line.split(/\s+/u))
      .filter(parts => parts.length >= 3 && parts[0] === ref)
      .map(parts => ({
        ref: parts[0] as string,
        oid: (parts[1] as string).toLowerCase(),
        objectType: parts[2] as string,
      }));
  },

  async isAncestor(repoRoot, ancestor, descendant) {
    const result = await spawnGit(
      repoRoot,
      ['merge-base', '--is-ancestor', ancestor, descendant],
      { tolerateFailure: true }
    );
    // git answers 0 (yes) or 1 (no); ANY other outcome is indeterminate and is
    // never collapsed into "not reachable".
    if (result === null) return null;
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    return null;
  },

  async showBlob(repoRoot, ref, portablePath) {
    const result = await spawnGit(repoRoot, ['show', `${ref}:${portablePath}`], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return null;
    return result.stdout;
  },

  async showTree(repoRoot, ref, portablePath) {
    const result = await spawnGit(repoRoot, ['show', `${ref}:${portablePath}`], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return null;
    // `git show <ref>:<dir>` prints `tree <ref>:<dir>`, a blank line, then one
    // entry per line with a trailing `/` on directories.
    const lines = result.stdout.split(/\r?\n/u);
    if (lines[0]?.startsWith('tree ') !== true) return null;
    return lines
      .slice(1)
      .map(line => line.trim())
      .filter(line => line.length > 0);
  },

  async repositoryPaths(root) {
    const [toplevelResult, commonDirResult] = await Promise.all([
      spawnGit(root, ['rev-parse', '--show-toplevel'], {
        tolerateFailure: true,
      }),
      spawnGit(root, ['rev-parse', '--git-common-dir'], {
        tolerateFailure: true,
      }),
    ]);
    if (
      toplevelResult === null ||
      commonDirResult === null ||
      toplevelResult.exitCode !== 0 ||
      commonDirResult.exitCode !== 0
    ) {
      return null;
    }
    const toplevel = toplevelResult.stdout.trim();
    const commonDirRaw = commonDirResult.stdout.trim();
    if (toplevel.length === 0 || commonDirRaw.length === 0) return null;
    return {
      toplevel,
      commonDir: path.resolve(root, commonDirRaw),
    };
  },
  async checkedOutRef(root) {
    const result = await spawnGit(root, ['symbolic-ref', '--quiet', 'HEAD'], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return null;
    const ref = result.stdout.trim();
    return ref.length > 0 ? ref : null;
  },

  async headOid(root) {
    return nodeFinalizationGit.resolveCommit(root, 'HEAD');
  },

  async statusEntries(root) {
    const result = await spawnGit(root, ['status', '--porcelain'], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return [];
    return nonEmptyLines(result.stdout);
  },
};

export const productionFinalizationDependencies: FinalizationDependencies = {
  fs: nodeWorkspaceFileSystem,
  git: nodeFinalizationGit,
  coordination: globalDataDir => createNodeWorkspaceCoordination(globalDataDir),
  async snapshotProjects(globalDataDir) {
    const registry = await readProjectRegistryState(
      globalDataDir === undefined ? {} : { globalDataDir }
    );
    if (!registry) return [];
    return Object.entries(registry.projects)
      .map(([root, entry]) => ({ root, entry }))
      .sort((left, right) => left.root.localeCompare(right.root));
  },
  now: () => new Date(),
};

/** A fixed clock, so a plan for equal inputs is byte-identical. */
export function withDeterministicFinalizationClock(
  base: FinalizationDependencies,
  now: string
): FinalizationDependencies {
  return { ...base, now: () => new Date(now) };
}
