import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  listStoreRegistryEntries,
  readStoreRegistryState,
  type RegistryEntryType,
} from '../../store/foundation.js';
import { getStoreRootForBackend } from '../../store/registry.js';
import {
  findProjectRegistryEntry,
  readProjectRegistryState,
  type ProjectRegistryEntryState,
} from '../../project-registry.js';
import { FileSystemUtils } from '../../../utils/file-system.js';
import { RASEN_SESSION_CONTEXT_ENV } from '../../session-runtime-context.js';
import {
  mintChangeInstanceSeed,
  type ChangeInstanceSeed,
} from '../../store/planning-foundation.js';
import {
  assertPlanningWorktreeUnbound,
  completeChangeBinding,
  probePlanningWorktree,
  type ChangeBindingInput,
  type CompleteChangeBindingInput,
  type CompletedChangeBinding,
  type PlanningWorktreeProbeInput,
  type PlanningWorktreeProbeResult,
} from '../../store/workspace/index.js';

export interface StoreRegistrySnapshotEntry {
  readonly id: string;
  readonly uid?: string;
  readonly type: RegistryEntryType;
  readonly root: string;
}

export interface ProjectRegistrySnapshotEntry {
  readonly root: string;
  readonly entry: ProjectRegistryEntryState;
}

export type CheckoutRole = 'integration' | 'linked-worktree' | 'not-git' | 'unavailable';

export interface StorePlanningFileIdentity {
  readonly dev: number;
  readonly ino: number;
}

export interface StorePlanningFileSystem {
  canonicalizeExisting(target: string): string;
  statKind(target: string): Promise<'file' | 'directory' | 'other' | 'absent'>;
  readText(target: string): Promise<string | null>;
  listNames(target: string): Promise<readonly string[]>;
  mkdir(target: string, options?: { recursive?: boolean }): Promise<void>;
  writeText(target: string, content: string): Promise<void>;
  rename(source: string, target: string): Promise<void>;
  link(source: string, target: string): Promise<void>;
  statIdentity(target: string): Promise<StorePlanningFileIdentity | null>;
  removeFile(target: string): Promise<void>;
  removeDirectoryIfEmpty(target: string): Promise<void>;
  removeOwnedTree(target: string): Promise<void>;
  openExclusive(target: string): Promise<fs.promises.FileHandle>;
}

export interface StorePlanningDependencies {
  readonly fs: StorePlanningFileSystem;
  snapshotStores(globalDataDir?: string): Promise<readonly StoreRegistrySnapshotEntry[]>;
  snapshotProjects(globalDataDir?: string): Promise<readonly ProjectRegistrySnapshotEntry[]>;
  findRegisteredProject(
    projectRoot: string,
    globalDataDir?: string
  ): Promise<ProjectRegistrySnapshotEntry | null>;
  sessionContextPath(): string | undefined;
  checkoutRole(root: string): CheckoutRole;
  /**
   * Live Git evidence for the planning-worktree gate: is the candidate a linked
   * worktree, does its identity re-derive, and does the target line's Store ref
   * resolve to a commit there. Marker PRESENCE is no longer verification
   * (`store-planning-worktree-bindings`, "A planning worktree is verified
   * rather than assumed").
   */
  probePlanningWorktree(
    input: PlanningWorktreeProbeInput
  ): Promise<PlanningWorktreeProbeResult>;
  /**
   * Refuses a second Change in one planning worktree, decided from the recorded
   * binding rather than a directory scan. Runs before any Change directory is
   * created.
   */
  assertPlanningWorktreeUnbound(input: ChangeBindingInput): Promise<void>;
  /**
   * Completes the two-phase binding once `createChange` has minted the Change
   * instance. Machine-local only; it writes nothing into either repository.
   */
  completeChangeBinding(input: CompleteChangeBindingInput): Promise<CompletedChangeBinding>;
  now(): Date;
  mintInstanceSeed(): ChangeInstanceSeed;
  randomSuffix(): string;
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

export const nodeStorePlanningFileSystem: StorePlanningFileSystem = {
  canonicalizeExisting: (target) => FileSystemUtils.canonicalizeExistingPath(target),
  async statKind(target) {
    try {
      const stat = await fs.promises.stat(target);
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
      return await fs.promises.readFile(target, 'utf8');
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
  async listNames(target) {
    try {
      return (await fs.promises.readdir(target)).sort((left, right) =>
        left.localeCompare(right)
      );
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return [];
      throw error;
    }
  },
  async mkdir(target, options = {}) {
    await fs.promises.mkdir(target, { recursive: options.recursive === true });
  },
  async writeText(target, content) {
    await fs.promises.writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
  },
  async rename(source, target) {
    await fs.promises.rename(source, target);
  },
  async link(source, target) {
    await fs.promises.link(source, target);
  },
  async statIdentity(target) {
    try {
      const stat = await fs.promises.stat(target);
      return { dev: stat.dev, ino: stat.ino };
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
  async removeFile(target) {
    try {
      await fs.promises.unlink(target);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
    }
  },
  async removeDirectoryIfEmpty(target) {
    try {
      await fs.promises.rmdir(target);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(nodeErrorCode(error) ?? '')) {
        throw error;
      }
    }
  },
  async removeOwnedTree(target) {
    await fs.promises.rm(target, { recursive: true, force: true });
  },
  openExclusive: (target) => fs.promises.open(target, 'wx', 0o600),
};

function checkoutRole(root: string): CheckoutRole {
  const result = spawnSync(
    'git',
    ['-C', root, 'worktree', 'list', '--porcelain'],
    { encoding: 'utf8', windowsHide: true, timeout: 5_000 }
  );
  if (result.error || result.status !== 0) return 'not-git';
  const worktrees = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  if (worktrees.length === 0) return 'unavailable';
  let canonicalRoot: string;
  try {
    canonicalRoot = FileSystemUtils.canonicalizeExistingPath(root);
  } catch {
    canonicalRoot = path.resolve(root);
  }
  const canonicalWorktrees = worktrees.map((candidate) => {
    try {
      return FileSystemUtils.canonicalizeExistingPath(candidate);
    } catch {
      return path.resolve(candidate);
    }
  });
  const index = canonicalWorktrees.findIndex(
    (candidate) => process.platform === 'win32'
      ? candidate.toLowerCase() === canonicalRoot.toLowerCase()
      : candidate === canonicalRoot
  );
  if (index < 0) return 'unavailable';
  return index === 0 ? 'integration' : 'linked-worktree';
}

export const productionStorePlanningDependencies: StorePlanningDependencies = {
  fs: nodeStorePlanningFileSystem,
  async snapshotStores(globalDataDir) {
    const registry = await readStoreRegistryState(
      globalDataDir === undefined ? {} : { globalDataDir }
    );
    if (!registry) return [];
    return listStoreRegistryEntries(registry).map((entry) => ({
      id: entry.id,
      type: entry.type,
      root: getStoreRootForBackend(entry.backend),
      ...(entry.uid === undefined ? {} : { uid: entry.uid }),
    }));
  },
  async snapshotProjects(globalDataDir) {
    const registry = await readProjectRegistryState(
      globalDataDir === undefined ? {} : { globalDataDir }
    );
    if (!registry) return [];
    return Object.entries(registry.projects)
      .map(([root, entry]) => ({ root, entry }))
      .sort((left, right) => left.root.localeCompare(right.root));
  },
  async findRegisteredProject(projectRoot, globalDataDir) {
    const found = await findProjectRegistryEntry(
      projectRoot,
      globalDataDir === undefined ? {} : { globalDataDir }
    );
    return found === null ? null : { root: found.canonicalPath, entry: found.entry };
  },
  sessionContextPath: () => process.env[RASEN_SESSION_CONTEXT_ENV],
  checkoutRole,
  probePlanningWorktree: (input) => probePlanningWorktree(input),
  assertPlanningWorktreeUnbound: async (input) => {
    await assertPlanningWorktreeUnbound(input);
  },
  completeChangeBinding: (input) => completeChangeBinding(input),
  now: () => new Date(),
  mintInstanceSeed: () => mintChangeInstanceSeed(),
  randomSuffix: () => `${process.pid}.${randomBytes(16).toString('hex')}`,
};
