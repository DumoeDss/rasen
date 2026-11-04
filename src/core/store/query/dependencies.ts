/**
 * Local-substitutable adapters for the aggregate query Module.
 *
 * This Module's Git verb set is closed, read-only, and stated once in
 * `STORE_QUERY_GIT_VERBS`:
 *
 *   rev-parse, for-each-ref, show, ls-tree
 *
 * There is no writing verb at all. `worktree`, `merge`, `rebase`, `reset`,
 * `checkout`, `switch`, `branch`, `commit`, `add`, `fetch`, `pull`, `push`,
 * `clone`, and `tag` are absent on purpose, the allow-list is enforced at RUN
 * time as well as by the source guard so a verb assembled through a variable
 * still cannot be smuggled in, and
 * `test/core/store/store-query-read-only-guard.test.ts` fails if any forbidden
 * verb appears anywhere under `src/core/store/query/`.
 *
 * A dedicated Git adapter rather than the finalization Module's is deliberate,
 * for the same reason finalization declined to reuse the workspace Module's:
 * the guard that keeps this surface read-only should have nothing to reason
 * about beyond this directory.
 *
 * The filesystem adapter is READ-ONLY by Interface. It cannot create, write,
 * move, or delete, so "the query module has no write surface" is a property of
 * the type rather than a promise in a comment.
 */
import { execFile } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { promisify } from 'node:util';

import { getGlobalDataDir } from '../../global-config.js';
import { readProjectRegistryState } from '../../project-registry.js';
import { FileSystemUtils } from '../../../utils/file-system.js';
import {
  createNodeWorkspaceCoordination,
  type WorkspaceCoordination,
  type WorkspaceProjectSnapshot,
} from '../workspace/dependencies.js';

const execFilePromise = promisify(execFile);

/** Every Git verb this Module may spawn. All of them read. */
export const STORE_QUERY_GIT_VERBS: readonly string[] = Object.freeze([
  'rev-parse',
  'for-each-ref',
  'show',
  'ls-tree',
]);

const ALLOWED_VERBS: ReadonlySet<string> = new Set(STORE_QUERY_GIT_VERBS);

export interface StoreQueryRefTarget {
  readonly ref: string;
  readonly oid: string;
  readonly objectType: string;
}

/** The read-only Git surface. Nothing here can change a ref, an index, or a tree. */
export interface StoreQueryGit {
  /** `rev-parse --verify <rev>^{commit}` → full lowercase OID, or null. */
  resolveCommit(repoRoot: string, rev: string): Promise<string | null>;
  /** Every ref matching the exact full name; more than one means ambiguous. */
  resolveRef(repoRoot: string, ref: string): Promise<readonly StoreQueryRefTarget[]>;
  /** `git show <ref>:<path>` for a blob; null when absent at that ref. */
  showBlob(repoRoot: string, ref: string, portablePath: string): Promise<string | null>;
  /**
   * `git ls-tree <ref>:<dir>` entry names, with a trailing `/` on every subtree
   * so a caller can tell a directory from a blob without a second call. Null
   * when the path is absent at that ref.
   */
  showTree(
    repoRoot: string,
    ref: string,
    portablePath: string
  ): Promise<readonly string[] | null>;
}

/** Read-only filesystem access. There is deliberately no write method. */
export interface StoreQueryFileSystem {
  statKind(target: string): Promise<'file' | 'directory' | 'other' | 'absent'>;
  readText(target: string): Promise<string | null>;
  listNames(target: string): Promise<readonly string[]>;
  canonicalizeExisting(target: string): string;
}

export interface StoreQueryDependencies {
  readonly fs: StoreQueryFileSystem;
  readonly git: StoreQueryGit;
  /** The machine workspace index root. Read through, never written. */
  coordination(globalDataDir?: string): WorkspaceCoordination;
  snapshotProjects(globalDataDir?: string): Promise<readonly WorkspaceProjectSnapshot[]>;
  now(): Date;
}

export class StoreQueryGitCommandError extends Error {
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
    this.name = 'StoreQueryGitCommandError';
  }
}

interface GitRun {
  readonly stdout: string;
  readonly exitCode: number | undefined;
}

/** The one place this Module spawns Git, with the verb allow-list enforced. */
async function spawnGit(
  repoRoot: string,
  args: readonly string[],
  options: { readonly tolerateFailure?: boolean } = {}
): Promise<GitRun | null> {
  const verb = args[0];
  if (verb === undefined || !ALLOWED_VERBS.has(verb)) {
    throw new Error(
      `The Store aggregate query Module may only run ${STORE_QUERY_GIT_VERBS.join(
        ', '
      )}; '${verb ?? '(none)'}' is not in its read-only verb set.`
    );
  }
  try {
    const { stdout } = await execFilePromise('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    if (options.tolerateFailure === true) {
      return { stdout: failure.stdout ?? '', exitCode: failure.code };
    }
    throw new StoreQueryGitCommandError(args, failure.stderr ?? '', failure.code);
  }
}

function nonEmptyLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

export const nodeStoreQueryGit: StoreQueryGit = {
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

  async showBlob(repoRoot, ref, portablePath) {
    const result = await spawnGit(repoRoot, ['show', `${ref}:${portablePath}`], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return null;
    return result.stdout;
  },

  async showTree(repoRoot, ref, portablePath) {
    // The full `ls-tree` format carries the object TYPE, which `--name-only`
    // drops. Directory-vs-blob has to come from Git rather than from guessing
    // at a name's shape: a Change alias may contain a dot, and a file may not.
    const result = await spawnGit(repoRoot, ['ls-tree', `${ref}:${portablePath}`], {
      tolerateFailure: true,
    });
    if (result === null || result.exitCode !== 0) return null;
    return nonEmptyLines(result.stdout)
      .map(line => {
        const separator = line.indexOf('\t');
        if (separator < 0) return null;
        const type = line.slice(0, separator).split(/\s+/u)[1];
        const name = line.slice(separator + 1);
        if (name.length === 0) return null;
        return type === 'tree' ? `${name}/` : name;
      })
      .filter((entry): entry is string => entry !== null);
  },
};

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

export const nodeStoreQueryFileSystem: StoreQueryFileSystem = {
  async statKind(target) {
    try {
      const stat = await nodeFs.promises.stat(target);
      if (stat.isFile()) return 'file';
      if (stat.isDirectory()) return 'directory';
      return 'other';
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return 'absent';
      throw error;
    }
  },
  async readText(target) {
    try {
      return await nodeFs.promises.readFile(target, 'utf8');
    } catch (error) {
      const code = nodeErrorCode(error);
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return null;
      throw error;
    }
  },
  async listNames(target) {
    try {
      return (await nodeFs.promises.readdir(target)).sort((left, right) =>
        left.localeCompare(right)
      );
    } catch (error) {
      const code = nodeErrorCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw error;
    }
  },
  canonicalizeExisting: target => FileSystemUtils.canonicalizeExistingPath(target),
};

export const productionStoreQueryDependencies: StoreQueryDependencies = {
  fs: nodeStoreQueryFileSystem,
  git: nodeStoreQueryGit,
  coordination: globalDataDir =>
    createNodeWorkspaceCoordination(globalDataDir ?? getGlobalDataDir()),
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

/** A fixed clock, so a result for equal inputs is byte-identical. */
export function withDeterministicStoreQueryClock(
  base: StoreQueryDependencies,
  now: string
): StoreQueryDependencies {
  const frozen = new Date(now);
  if (Number.isNaN(frozen.valueOf())) {
    throw new TypeError(`withDeterministicStoreQueryClock received an invalid date: ${now}`);
  }
  return { ...base, now: () => new Date(frozen.valueOf()) };
}
