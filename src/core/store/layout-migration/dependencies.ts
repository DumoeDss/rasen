/**
 * Local-substitutable adapters for the layout-migration Module.
 *
 * Everything the Module touches outside its own pure logic passes through one
 * of these: filesystem, read-only Git, the Store and project registries, the
 * machine-root coordination store, the clock, and entropy. Production wires the
 * existing implementations; tests substitute a fixed clock and a seeded entropy
 * source so a plan for equal inputs is byte-identical.
 *
 * Every Git operation here is READ-ONLY by construction. There is no checkout,
 * merge, rebase, branch write, index write, fetch, or push in this file, and
 * `spawnGit` refuses any verb outside the read-only allow-list.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { getGlobalDataDir } from '../../global-config.js';
import {
  readProjectRegistryState,
  type ProjectRegistryEntryState,
} from '../../project-registry.js';
import { mintChangeInstanceSeed } from '../planning-foundation.js';

const fs = nodeFs.promises;
const execFilePromise = promisify(execFile);

export type FsEntryKind = 'file' | 'directory' | 'other' | 'absent';

export interface LayoutMigrationDirEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'other';
}

export interface LayoutMigrationFileSystem {
  statKind(target: string): Promise<FsEntryKind>;
  readText(target: string): Promise<string | null>;
  readBytes(target: string): Promise<Buffer | null>;
  listEntries(target: string): Promise<readonly LayoutMigrationDirEntry[]>;
  mkdirp(target: string): Promise<void>;
  writeText(target: string, content: string): Promise<void>;
  copyTree(source: string, destination: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  removeTree(target: string): Promise<void>;
  removeFile(target: string): Promise<void>;
}

export interface GitRefEntry {
  readonly ref: string;
  readonly kind: 'local-branch' | 'remote-tracking' | 'other';
}

export interface GitStatusEntry {
  readonly path: string;
  readonly status: 'tracked-modified' | 'staged' | 'untracked';
}

export interface LayoutMigrationGit {
  /** True when `repoRoot` is inside a Git work tree. */
  isRepository(repoRoot: string): Promise<boolean>;
  listRefs(repoRoot: string): Promise<readonly GitRefEntry[]>;
  /** `git show <ref>:<relPath>` — null when the path does not exist at that ref. */
  showBlob(repoRoot: string, ref: string, relPath: string): Promise<string | null>;
  /** True when a tree exists at `<ref>:<relPath>` and holds at least one entry. */
  treeHasEntries(repoRoot: string, ref: string, relPath: string): Promise<boolean>;
  currentRef(repoRoot: string): Promise<string | null>;
  headOid(repoRoot: string): Promise<string | null>;
  worktreePaths(repoRoot: string): Promise<readonly string[]>;
  status(repoRoot: string, pathspecs: readonly string[]): Promise<readonly GitStatusEntry[]>;
}

export interface LayoutMigrationCoordination {
  /** Machine-root directory for plans and recovery manifests. Never in Git. */
  root(): string;
  readJson(relativePath: string): Promise<unknown | null>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
  remove(relativePath: string): Promise<void>;
  resolve(relativePath: string): string;
}

export interface ProjectRegistrySnapshot {
  readonly root: string;
  readonly entry: ProjectRegistryEntryState;
}

export interface StoreLayoutMigrationDependencies {
  readonly fs: LayoutMigrationFileSystem;
  readonly git: LayoutMigrationGit;
  coordination(globalDataDir?: string): LayoutMigrationCoordination;
  snapshotProjects(globalDataDir?: string): Promise<readonly ProjectRegistrySnapshot[]>;
  now(): Date;
  mintInstanceSeed(): string;
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

export const nodeLayoutMigrationFileSystem: LayoutMigrationFileSystem = {
  async statKind(target) {
    try {
      const stat = await fs.lstat(target);
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
      return await fs.readFile(target, 'utf8');
    } catch (error) {
      if (['ENOENT', 'EISDIR'].includes(nodeErrorCode(error) ?? '')) return null;
      throw error;
    }
  },
  async readBytes(target) {
    try {
      return await fs.readFile(target);
    } catch (error) {
      if (['ENOENT', 'EISDIR'].includes(nodeErrorCode(error) ?? '')) return null;
      throw error;
    }
  },
  async listEntries(target) {
    try {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return entries
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory()
            ? ('directory' as const)
            : entry.isFile()
              ? ('file' as const)
              : ('other' as const),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(nodeErrorCode(error) ?? '')) return [];
      throw error;
    }
  },
  async mkdirp(target) {
    await fs.mkdir(target, { recursive: true });
  },
  async writeText(target, content) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  },
  async copyTree(source, destination) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  },
  async rename(source, destination) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  },
  async removeTree(target) {
    await fs.rm(target, { recursive: true, force: true });
  },
  async removeFile(target) {
    try {
      await fs.unlink(target);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
    }
  },
};

/**
 * The complete set of Git verbs this Module may spawn. `checkout`, `merge`,
 * `rebase`, `branch`, `add`, `commit`, `fetch`, and `push` are absent on
 * purpose: the design forbids Rasen performing Git mutation on the operator's
 * behalf, and this list is the enforcement, not the documentation.
 */
const READ_ONLY_GIT_VERBS: ReadonlySet<string> = new Set([
  'cat-file',
  'for-each-ref',
  'ls-tree',
  'rev-parse',
  'show',
  'status',
  'symbolic-ref',
  'worktree',
]);

async function spawnGit(
  repoRoot: string,
  args: readonly string[]
): Promise<{ stdout: string } | null> {
  const verb = args[0];
  if (verb === undefined || !READ_ONLY_GIT_VERBS.has(verb)) {
    throw new Error(
      `store layout migration may only spawn read-only Git verbs; '${String(verb)}' is not one`
    );
  }
  try {
    const { stdout } = await execFilePromise('git', ['-C', repoRoot, ...args], {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout };
  } catch {
    return null;
  }
}

export const nodeLayoutMigrationGit: LayoutMigrationGit = {
  async isRepository(repoRoot) {
    const result = await spawnGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
    return result?.stdout.trim() === 'true';
  },
  async listRefs(repoRoot) {
    const result = await spawnGit(repoRoot, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes',
    ]);
    if (!result) return [];
    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((ref) => ({
        ref,
        kind: ref.startsWith('refs/heads/')
          ? ('local-branch' as const)
          : ref.startsWith('refs/remotes/')
            ? ('remote-tracking' as const)
            : ('other' as const),
      }))
      .sort((left, right) => left.ref.localeCompare(right.ref));
  },
  async showBlob(repoRoot, ref, relPath) {
    const result = await spawnGit(repoRoot, ['show', `${ref}:${relPath}`]);
    return result === null ? null : result.stdout;
  },
  async treeHasEntries(repoRoot, ref, relPath) {
    const result = await spawnGit(repoRoot, ['ls-tree', '--name-only', `${ref}:${relPath}`]);
    if (result === null) return false;
    return result.stdout.split(/\r?\n/u).some((line) => line.trim().length > 0);
  },
  async currentRef(repoRoot) {
    const result = await spawnGit(repoRoot, ['symbolic-ref', '--quiet', 'HEAD']);
    const ref = result?.stdout.trim();
    return ref === undefined || ref.length === 0 ? null : ref;
  },
  async headOid(repoRoot) {
    const result = await spawnGit(repoRoot, ['rev-parse', 'HEAD']);
    const oid = result?.stdout.trim();
    return oid === undefined || oid.length === 0 ? null : oid;
  },
  async worktreePaths(repoRoot) {
    const result = await spawnGit(repoRoot, ['worktree', 'list', '--porcelain']);
    if (!result) return [];
    return result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length).trim())
      .filter((value) => value.length > 0);
  },
  async status(repoRoot, pathspecs) {
    const result = await spawnGit(repoRoot, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--no-renames',
      '--',
      ...pathspecs,
    ]);
    if (!result) return [];
    const entries: GitStatusEntry[] = [];
    for (const line of result.stdout.split(/\r?\n/u)) {
      if (line.length < 4) continue;
      const indexState = line[0] ?? ' ';
      const workingState = line[1] ?? ' ';
      const target = line.slice(3).trim().replace(/^"|"$/gu, '');
      if (target.length === 0) continue;
      if (indexState === '?' && workingState === '?') {
        entries.push({ path: target, status: 'untracked' });
        continue;
      }
      if (indexState !== ' ') entries.push({ path: target, status: 'staged' });
      if (workingState !== ' ') entries.push({ path: target, status: 'tracked-modified' });
    }
    return entries;
  },
};

export const MIGRATION_COORDINATION_DIR_NAME = 'store-layout-migration';

export function createNodeCoordination(globalDataDir?: string): LayoutMigrationCoordination {
  const root = path.join(
    globalDataDir ?? getGlobalDataDir(),
    MIGRATION_COORDINATION_DIR_NAME
  );
  return {
    root: () => root,
    resolve: (relativePath) => path.join(root, relativePath),
    async readJson(relativePath) {
      const target = path.join(root, relativePath);
      try {
        return JSON.parse(await fs.readFile(target, 'utf8')) as unknown;
      } catch (error) {
        if (nodeErrorCode(error) === 'ENOENT') return null;
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    },
    async writeJson(relativePath, value) {
      const target = path.join(root, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      return target;
    },
    async remove(relativePath) {
      await fs.rm(path.join(root, relativePath), { recursive: true, force: true });
    },
  };
}

export const productionStoreLayoutMigrationDependencies: StoreLayoutMigrationDependencies = {
  fs: nodeLayoutMigrationFileSystem,
  git: nodeLayoutMigrationGit,
  coordination: (globalDataDir) => createNodeCoordination(globalDataDir),
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
  mintInstanceSeed: () => mintChangeInstanceSeed(),
};

/** Deterministic clock + entropy for reproducible plans in tests. */
export function withDeterministicIdentity(
  base: StoreLayoutMigrationDependencies,
  options: { readonly now: string; readonly seedPrefix?: string }
): StoreLayoutMigrationDependencies {
  let counter = 0;
  const prefix = options.seedPrefix ?? 'test-seed';
  return {
    ...base,
    now: () => new Date(options.now),
    mintInstanceSeed: () => {
      counter += 1;
      return createHash('sha256')
        .update(`${prefix}:${counter}`)
        .digest('hex')
        .slice(0, 32);
    },
  };
}

/** Non-cryptographic helper kept beside the adapters so callers never re-roll it. */
export function randomToken(): string {
  return randomBytes(16).toString('hex');
}
