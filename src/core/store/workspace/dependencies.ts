/**
 * Local-substitutable adapters for the workspace Module.
 *
 * Filesystem and canonicalization, Git, the machine-root coordination store
 * (plans, the binding index, locks), the clock, and entropy all pass through
 * here. Production wires the existing implementations; tests substitute a fixed
 * clock and a seeded entropy source so a plan for equal inputs is byte-identical.
 *
 * This is the portfolio's first Git-MUTATING adapter, so its verb set is closed
 * and stated once, in `GIT_WRITE_VERBS` / `GIT_READ_VERBS` below:
 *
 *   write:  worktree add, worktree remove (never forced), worktree prune
 *   read:   rev-parse, for-each-ref, symbolic-ref, worktree list --porcelain,
 *           status --porcelain, merge-base --is-ancestor, ls-files --others
 *
 * `merge`, `rebase`, `reset`, `checkout`, `switch`, `branch -d/-D`, `push`,
 * `fetch`, `clone`, and `worktree remove --force` are absent on purpose, and
 * `test/core/store/workspace-git-verb-guard.test.ts` fails if any of them
 * appears anywhere under `src/core/store/workspace/`.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { getGlobalDataDir } from '../../global-config.js';
import { StoreWorkspaceError } from './diagnostics.js';
import {
  readProjectRegistryState,
  type ProjectRegistryEntryState,
} from '../../project-registry.js';
import { FileSystemUtils } from '../../../utils/file-system.js';
import { mintChangeInstanceSeed } from '../planning-foundation.js';

const fs = nodeFs.promises;
const execFilePromise = promisify(execFile);

export const WORKSPACE_COORDINATION_DIR_NAME = 'planning-workspaces';

export type WorkspaceEntryKind = 'file' | 'directory' | 'other' | 'absent';

export interface WorkspaceFileSystem {
  statKind(target: string): Promise<WorkspaceEntryKind>;
  readText(target: string): Promise<string | null>;
  listNames(target: string): Promise<readonly string[]>;
  mkdirp(target: string): Promise<void>;
  writeText(target: string, content: string): Promise<void>;
  /**
   * Crash-safe replacement. A durable exact intent is adopted on retry; a
   * partial or disagreeing intent preserves the previous target and refuses.
   */
  writeTextAtomic?(
    target: string,
    content: string,
    expectedBefore?: AtomicWorkspaceExpectedBefore
  ): Promise<void>;
  readAtomicSnapshot?(
    target: string
  ): Promise<AtomicWorkspaceExpectedBefore>;
  removeFile(target: string): Promise<void>;
  removeDirectoryIfEmpty(target: string): Promise<void>;
  /**
   * The canonical absolute form of an EXISTING path, with symlinks, Windows
   * short names, and drive-letter case resolved. Throws when the path cannot be
   * canonicalized — identity never degrades to the literal string.
   */
  canonicalizeExisting(target: string): string;
}

export interface WorktreeListEntry {
  readonly root: string;
  /** True for the repository's main checkout, which is never a linked worktree. */
  readonly main: boolean;
  readonly ref?: string;
  readonly headOid?: string;
  readonly detached: boolean;
  readonly bare: boolean;
}

export interface ResolvedRefTarget {
  readonly ref: string;
  readonly oid: string;
  readonly objectType: string;
}

export interface WorktreeStatusEntry {
  readonly path: string;
  readonly status: 'tracked-modified' | 'staged';
}

export interface WorkspaceGit {
  /** Canonical repository and worktree identity inputs, or null when absent. */
  repositoryPaths(
    root: string
  ): Promise<{ readonly toplevel: string; readonly commonDir: string } | null>;
  worktreeList(repoRoot: string): Promise<readonly WorktreeListEntry[] | null>;
  /** Every ref matching the exact full name; more than one means ambiguous. */
  resolveRef(repoRoot: string, ref: string): Promise<readonly ResolvedRefTarget[]>;
  headOid(root: string): Promise<string | null>;
  checkedOutRef(root: string): Promise<string | null>;
  /** True when `commit` exists in `repoRoot` and is a commit. */
  commitExists(repoRoot: string, commit: string): Promise<boolean>;
  /** Tracked modifications and staged changes in one worktree. */
  dirtyEntries(root: string): Promise<readonly WorktreeStatusEntry[]>;
  untrackedFiles(root: string): Promise<readonly string[]>;
  isAncestor(repoRoot: string, candidate: string, descendant: string): Promise<boolean>;
  /** `git worktree add -b <branch> <destination> <commit>`. */
  addWorktree(input: {
    readonly repoRoot: string;
    readonly destination: string;
    readonly branch: string;
    readonly commit: string;
  }): Promise<void>;
  /** `git worktree remove <root>` — never forced. */
  removeWorktree(repoRoot: string, worktreeRoot: string): Promise<void>;
  pruneWorktrees(repoRoot: string): Promise<void>;
}

export interface WorkspaceCoordination {
  /** Machine-root directory for plans, the index, and locks. Never in Git. */
  root(): string;
  resolve(relativePath: string): string;
  readJson(relativePath: string): Promise<unknown | null>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
  remove(relativePath: string): Promise<void>;
  listNames(relativePath: string): Promise<readonly string[]>;
}

export interface WorkspaceProjectSnapshot {
  readonly root: string;
  readonly entry: ProjectRegistryEntryState;
}

export interface StoreWorkspaceDependencies {
  readonly fs: WorkspaceFileSystem;
  readonly git: WorkspaceGit;
  coordination(globalDataDir?: string): WorkspaceCoordination;
  snapshotProjects(globalDataDir?: string): Promise<readonly WorkspaceProjectSnapshot[]>;
  now(): Date;
  mintInstanceSeed(): string;
  randomToken(): string;
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

export class AtomicWorkspaceWriteConflictError extends Error {
  readonly code = 'workspace_atomic_write_conflict';

  constructor(readonly target: string, detail: string) {
    super(`Atomic workspace write conflict at ${target}: ${detail}`);
    this.name = 'AtomicWorkspaceWriteConflictError';
  }
}

export interface AtomicWorkspaceIdentity {
  readonly dev: string;
  readonly ino: string;
  readonly mode: number;
  readonly size: string;
}

function atomicWorkspaceIdentity(
  stat: Awaited<ReturnType<typeof fs.lstat>>
): AtomicWorkspaceIdentity {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: stat.mode,
    size: String(stat.size),
  };
}

function sameAtomicWorkspaceIdentity(
  left: AtomicWorkspaceIdentity,
  right: AtomicWorkspaceIdentity
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function stableAtomicWorkspaceFile(target: string): Promise<{
  readonly content: string;
  readonly identity: AtomicWorkspaceIdentity;
} | null> {
  let before;
  try {
    before = await fs.lstat(target);
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new AtomicWorkspaceWriteConflictError(
      target,
      'the carrier is not a real regular file'
    );
  }
  const content = await fs.readFile(target, 'utf8');
  const after = await fs.lstat(target);
  const beforeIdentity = atomicWorkspaceIdentity(before);
  const afterIdentity = atomicWorkspaceIdentity(after);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    !sameAtomicWorkspaceIdentity(beforeIdentity, afterIdentity)
  ) {
    throw new AtomicWorkspaceWriteConflictError(
      target,
      'the carrier changed during stable identity observation'
    );
  }
  return { content, identity: afterIdentity };
}

export interface AtomicWorkspaceCarrierAuthority {
  readonly target: string;
  readonly contentDigest: string;
  readonly directory: {
    readonly path: string;
    readonly identity: AtomicWorkspaceIdentity;
  };
  readonly intent: {
    readonly path: string;
    readonly identity: AtomicWorkspaceIdentity;
  };
  readonly claim: {
    readonly path: string;
    readonly identity: AtomicWorkspaceIdentity;
  };
}

export interface AtomicWorkspaceExpectedBefore {
  readonly content: string | null;
  readonly identity: AtomicWorkspaceIdentity | null;
  readonly authority?: AtomicWorkspaceCarrierAuthority;
  readonly onPrepared?: (
    authority: AtomicWorkspaceCarrierAuthority
  ) => Promise<void>;
}
export async function readAtomicWorkspaceSnapshot(
  target: string
): Promise<AtomicWorkspaceExpectedBefore> {
  const stable = await stableAtomicWorkspaceFile(target);
  return stable === null
    ? { content: null, identity: null }
    : { content: stable.content, identity: stable.identity };
}

async function atomicWorkspaceWriteText(
  target: string,
  content: string,
  expectedBefore?: AtomicWorkspaceExpectedBefore
): Promise<void> {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const canonicalDirectory = await fs.realpath(directory);
  const directoryIdentity = atomicWorkspaceIdentity(
    await fs.lstat(canonicalDirectory)
  );
  const requireDirectoryIdentity = async () => {
    const observedCanonical = await fs.realpath(directory);
    const current = await fs.lstat(canonicalDirectory);
    if (
      observedCanonical !== canonicalDirectory ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !sameAtomicWorkspaceIdentity(
        directoryIdentity,
        atomicWorkspaceIdentity(current)
      )
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the lexical carrier ancestry changed before mutation'
      );
    }
  };
  const syncDirectory = async () => {
    await requireDirectoryIdentity();
    const handle = await fs.open(canonicalDirectory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  const prefix = `.${path.basename(target)}.rasen-write-${digest}`;
  const intentPath = path.join(directory, `${prefix}.intent`);
  const backupPath = path.join(directory, `${prefix}.backup`);
  const claimPath = path.join(directory, `${prefix}.claim`);
  const allowedNames = new Set([
    path.basename(intentPath),
    path.basename(backupPath),
    path.basename(claimPath),
  ]);
  const foreignIntent = (await fs.readdir(directory)).find(
    name =>
      name.startsWith(`.${path.basename(target)}.rasen-write-`) &&
      !allowedNames.has(name)
  );
  if (foreignIntent !== undefined) {
    throw new AtomicWorkspaceWriteConflictError(
      target,
      `a disagreeing durable intent is retained at ${path.join(
        directory,
        foreignIntent
      )}`
    );
  }
  const current = await stableAtomicWorkspaceFile(target);
  const existingClaim = await stableAtomicWorkspaceFile(claimPath);
  if (
    expectedBefore !== undefined &&
    existingClaim === null &&
    ((current?.content ?? null) !== expectedBefore.content ||
      (current === null
        ? expectedBefore.identity !== null
        : expectedBefore.identity === null ||
          !sameAtomicWorkspaceIdentity(
            current.identity,
            expectedBefore.identity
          )))
  ) {
    throw new AtomicWorkspaceWriteConflictError(
      target,
      'the carrier changed after the validated snapshot'
    );
  }
  if (current?.content === content && existingClaim === null) {
    if (
      expectedBefore?.authority !== undefined &&
      !sameAtomicWorkspaceIdentity(
        current.identity,
        expectedBefore.authority.intent.identity
      )
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the exact bytes are carried by an identity outside journal authority'
      );
    }
    return;
  }

  let claim: {
    readonly version: 1;
    readonly target: string;
    readonly contentDigest: string;
    readonly beforeDigest: string | null;
    readonly beforeIdentity: AtomicWorkspaceIdentity | null;
    readonly intentIdentity: AtomicWorkspaceIdentity;
  };
  if (existingClaim === null) {
    if (
      (await stableAtomicWorkspaceFile(intentPath)) !== null ||
      (await stableAtomicWorkspaceFile(backupPath)) !== null
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'an unclaimed write intent or backup is retained'
      );
    }
    await requireDirectoryIdentity();
    const intentHandle = await fs.open(intentPath, 'wx', 0o600);
    try {
      await intentHandle.writeFile(content, 'utf8');
      await intentHandle.sync();
    } finally {
      await intentHandle.close();
    }
    const intent = await stableAtomicWorkspaceFile(intentPath);
    if (intent === null || intent.content !== content) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the durable intent does not contain the exact planned bytes'
      );
    }
    claim = {
      version: 1,
      target,
      contentDigest: digest,
      beforeDigest:
        current === null
          ? null
          : createHash('sha256').update(current.content, 'utf8').digest('hex'),
      beforeIdentity: current?.identity ?? null,
      intentIdentity: intent.identity,
    };
    const claimHandle = await fs.open(claimPath, 'wx', 0o600);
    try {
      await claimHandle.writeFile(`${JSON.stringify(claim)}\n`, 'utf8');
      await claimHandle.sync();
    } finally {
      await claimHandle.close();
    }
    await syncDirectory();
    const durableClaim = await stableAtomicWorkspaceFile(claimPath);
    if (durableClaim === null) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the durable ownership claim vanished before journal preparation'
      );
    }
    await expectedBefore?.onPrepared?.({
      target,
      contentDigest: digest,
      directory: {
        path: canonicalDirectory,
        identity: directoryIdentity,
      },
      intent: { path: intentPath, identity: intent.identity },
      claim: { path: claimPath, identity: durableClaim.identity },
    });
  } else {
    const authority = expectedBefore?.authority;
    if (
      authority === undefined ||
      authority.target !== target ||
      authority.contentDigest !== digest ||
      authority.directory.path !== canonicalDirectory ||
      !sameAtomicWorkspaceIdentity(
        authority.directory.identity,
        directoryIdentity
      ) ||
      authority.intent.path !== intentPath ||
      authority.claim.path !== claimPath ||
      !sameAtomicWorkspaceIdentity(
        authority.claim.identity,
        existingClaim.identity
      )
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the retained carrier claim lacks exact journal-bound authority'
      );
    }
    try {
      claim = JSON.parse(existingClaim.content) as typeof claim;
    } catch {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the durable ownership claim is corrupt and retained'
      );
    }
    if (
      claim.version !== 1 ||
      claim.target !== target ||
      claim.contentDigest !== digest ||
      typeof claim.intentIdentity !== 'object' ||
      claim.intentIdentity === null
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the durable ownership claim disagrees with this write'
      );
    }
  }

  const intent = await stableAtomicWorkspaceFile(intentPath);
  if (
    expectedBefore?.authority !== undefined &&
    (intent === null ||
      !sameAtomicWorkspaceIdentity(
        intent.identity,
        expectedBefore.authority.intent.identity
      ))
  ) {
    throw new AtomicWorkspaceWriteConflictError(
      target,
      'the retained intent no longer matches journal-bound authority'
    );
  }
  const targetNow = await stableAtomicWorkspaceFile(target);
  const backup = await stableAtomicWorkspaceFile(backupPath);
  const targetIsPublishedIntent =
    targetNow !== null &&
    targetNow.content === content &&
    sameAtomicWorkspaceIdentity(targetNow.identity, claim.intentIdentity);
  if (!targetIsPublishedIntent) {
    if (
      intent === null ||
      intent.content !== content ||
      !sameAtomicWorkspaceIdentity(intent.identity, claim.intentIdentity)
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the claimed durable intent identity or bytes changed'
      );
    }
    if (targetNow !== null) {
      const beforeMatches =
        claim.beforeIdentity !== null &&
        sameAtomicWorkspaceIdentity(targetNow.identity, claim.beforeIdentity) &&
        createHash('sha256').update(targetNow.content, 'utf8').digest('hex') ===
          claim.beforeDigest;
      if (!beforeMatches || backup !== null) {
        throw new AtomicWorkspaceWriteConflictError(
          target,
          'the previous carrier changed before its no-clobber claim'
        );
      }
      await requireDirectoryIdentity();
      try {
        await fs.link(target, backupPath);
      } catch (error) {
        if (nodeErrorCode(error) === 'EEXIST') {
          throw new AtomicWorkspaceWriteConflictError(
            target,
            'the exclusive backup claim is already occupied'
          );
        }
        throw error;
      }
      await syncDirectory();
      const targetBeforeRemoval = await stableAtomicWorkspaceFile(target);
      if (
        targetBeforeRemoval === null ||
        claim.beforeIdentity === null ||
        !sameAtomicWorkspaceIdentity(
          targetBeforeRemoval.identity,
          claim.beforeIdentity
        )
      ) {
        throw new AtomicWorkspaceWriteConflictError(
          target,
          'the previous carrier changed after its exclusive backup claim'
        );
      }
      await requireDirectoryIdentity();
      await fs.unlink(target);
      await syncDirectory();
    } else if (
      claim.beforeIdentity !== null &&
      (backup === null ||
        !sameAtomicWorkspaceIdentity(backup.identity, claim.beforeIdentity))
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        'the claimed previous carrier or its backup is missing'
      );
    }

    await requireDirectoryIdentity();
    try {
      await fs.link(intentPath, target);
    } catch (error) {
      if (nodeErrorCode(error) === 'EEXIST') {
        throw new AtomicWorkspaceWriteConflictError(
          target,
          'a concurrent carrier appeared at the no-clobber publication boundary'
        );
      }
      throw error;
    }
    await syncDirectory();
  }

  const published = await stableAtomicWorkspaceFile(target);
  if (
    published === null ||
    published.content !== content ||
    !sameAtomicWorkspaceIdentity(published.identity, claim.intentIdentity)
  ) {
    throw new AtomicWorkspaceWriteConflictError(
      target,
      'the published carrier does not match the claimed intent identity'
    );
  }
  for (const [ownedPath, expectedIdentity] of [
    [intentPath, claim.intentIdentity],
    [backupPath, claim.beforeIdentity],
  ] as const) {
    const owned = await stableAtomicWorkspaceFile(ownedPath);
    if (owned === null) continue;
    if (
      expectedIdentity === null ||
      !sameAtomicWorkspaceIdentity(owned.identity, expectedIdentity)
    ) {
      throw new AtomicWorkspaceWriteConflictError(
        target,
        `the retained transaction path is not owned: ${ownedPath}`
      );
    }
    await requireDirectoryIdentity();
    await fs.unlink(ownedPath);
  }
  await syncDirectory();
  await requireDirectoryIdentity();
  await fs.unlink(claimPath);
  await syncDirectory();
}

export { atomicWorkspaceWriteText };

export const nodeWorkspaceFileSystem: WorkspaceFileSystem = {
  async statKind(target) {
    try {
      const stat = await fs.lstat(target);
      if (stat.isFile()) return 'file';
      if (stat.isDirectory()) return 'directory';
      return 'other';
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(nodeErrorCode(error) ?? '')) return 'absent';
      throw error;
    }
  },
  readAtomicSnapshot: readAtomicWorkspaceSnapshot,
  async readText(target) {
    try {
      return await fs.readFile(target, 'utf8');
    } catch (error) {
      if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(nodeErrorCode(error) ?? '')) return null;
      throw error;
    }
  },
  async listNames(target) {
    try {
      return (await fs.readdir(target)).sort((left, right) => left.localeCompare(right));
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
  writeTextAtomic: atomicWorkspaceWriteText,
  async removeFile(target) {
    try {
      await fs.unlink(target);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
    }
  },
  async removeDirectoryIfEmpty(target) {
    try {
      await fs.rmdir(target);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(nodeErrorCode(error) ?? '')) throw error;
    }
  },
  canonicalizeExisting: (target) => FileSystemUtils.canonicalizeExistingPath(target),
};

/** The only Git verbs this Module may spawn with a write effect. */
export const GIT_WRITE_VERBS: readonly string[] = Object.freeze(['worktree']);

/** The only Git verbs this Module may spawn to read. */
export const GIT_READ_VERBS: readonly string[] = Object.freeze([
  'rev-parse',
  'for-each-ref',
  'symbolic-ref',
  'status',
  'ls-files',
  'merge-base',
]);

/** `git worktree` subcommands this Module may use. `list` is read-only. */
export const GIT_WORKTREE_SUBCOMMANDS: readonly string[] = Object.freeze([
  'add',
  'remove',
  'prune',
  'list',
]);

const ALLOWED_GIT_VERBS: ReadonlySet<string> = new Set([
  ...GIT_WRITE_VERBS,
  ...GIT_READ_VERBS,
]);

/**
 * A Git command that failed, surfaced AS ITSELF.
 *
 * It carries the taxonomy code `workspace_git_failed` because the callers that
 * translate a failure for an agent branch on a code: `statusFromError`
 * duck-types `error.diagnostic`, and the `store workspace` adapter's `fail`
 * reads `StoreError.diagnostic`. A bare `Error` reached the
 * `rasen new change --json` seam — which has no adapter-level fallback — as a
 * generic `change_error`, collapsing a Git-level failure into the same bucket
 * as everything else. Extending the workspace error type is what makes both
 * surfaces report the specific code without either of them special-casing this
 * class.
 */
export class WorkspaceGitCommandError extends StoreWorkspaceError {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | undefined
  ) {
    super(
      'workspace_git_failed',
      `git ${args.join(' ')} failed${exitCode === undefined ? '' : ` (exit ${exitCode})`}: ${stderr.trim()}`,
      {
        target: `git ${args.join(' ')}`,
        fix: 'Resolve the Git failure reported above and retry. Rasen never retries, forces, or works around a failing Git command.',
      }
    );
    this.name = 'WorkspaceGitCommandError';
  }
}

interface GitRun {
  readonly stdout: string;
}

/**
 * The one place this Module spawns Git. The verb allow-list is enforced at run
 * time as well as by the source guard, so a call added through a variable —
 * which a source scan cannot see — still cannot smuggle a forbidden verb in.
 */
async function spawnGit(
  cwd: string,
  args: readonly string[],
  options: { readonly tolerateFailure?: boolean } = {}
): Promise<GitRun | null> {
  const verb = args[0];
  if (verb === undefined || !ALLOWED_GIT_VERBS.has(verb)) {
    throw new Error(
      `the workspace Git adapter may only spawn its closed verb set; '${String(verb)}' is not in it`
    );
  }
  if (verb === 'worktree') {
    const subcommand = args[1];
    if (subcommand === undefined || !GIT_WORKTREE_SUBCOMMANDS.includes(subcommand)) {
      throw new Error(
        `the workspace Git adapter may only use 'git worktree ${GIT_WORKTREE_SUBCOMMANDS.join('/')}'; '${String(subcommand)}' is not one`
      );
    }
    if (subcommand === 'remove' && args.some((arg) => arg === '--force' || arg === '-f')) {
      throw new Error('the workspace Git adapter may never force a worktree removal');
    }
  }
  try {
    const { stdout } = await execFilePromise('git', ['-C', cwd, ...args], {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout };
  } catch (error) {
    if (options.tolerateFailure === true) return null;
    const failure = error as { stderr?: string; code?: number };
    throw new WorkspaceGitCommandError(args, failure.stderr ?? '', failure.code);
  }
}

function nonEmptyLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * NUL-separated records, for the two commands that emit PATHS.
 *
 * A path is bytes, not a line: under the default `core.quotePath` Git wraps any
 * path containing non-ASCII bytes, a quote, a backslash, a newline, or a
 * control character in double quotes and escapes it C-style, so
 * `设计文档.md` arrives as the 24-character literal
 * `\350\256\276\350\256\241\346\226\207\346\241\243.md`. Stripping the
 * surrounding quotes without decoding yields a name no filesystem call can
 * resolve. `-z` sidesteps the encoding entirely: Git emits the raw bytes and
 * separates records with NUL, which is the one byte a path cannot contain — so
 * a path with a newline in it survives too. Nothing is trimmed, because a
 * leading or trailing space is part of the name.
 */
function nulSeparatedRecords(stdout: string): string[] {
  return stdout.split('\0').filter((record) => record.length > 0);
}

export const nodeWorkspaceGit: WorkspaceGit = {
  async repositoryPaths(root) {
    const absolute = await spawnGit(
      root,
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { tolerateFailure: true }
    );
    if (absolute !== null) {
      const [toplevel, commonDir] = nonEmptyLines(absolute.stdout);
      if (toplevel !== undefined && commonDir !== undefined) return { toplevel, commonDir };
    }
    // `--path-format` predates neither Git 2.31 nor this Module's supported
    // range everywhere, so resolve the relative form against the worktree.
    const relative = await spawnGit(root, ['rev-parse', '--show-toplevel', '--git-common-dir'], {
      tolerateFailure: true,
    });
    if (relative === null) return null;
    const [toplevel, commonDir] = nonEmptyLines(relative.stdout);
    if (toplevel === undefined || commonDir === undefined) return null;
    return {
      toplevel: path.resolve(toplevel),
      commonDir: path.isAbsolute(commonDir) ? commonDir : path.resolve(root, commonDir),
    };
  },

  async worktreeList(repoRoot) {
    const result = await spawnGit(repoRoot, ['worktree', 'list', '--porcelain'], {
      tolerateFailure: true,
    });
    if (result === null) return null;
    const entries: WorktreeListEntry[] = [];
    let current: {
      root?: string;
      ref?: string;
      headOid?: string;
      detached: boolean;
      bare: boolean;
    } = { detached: false, bare: false };
    const flush = (): void => {
      if (current.root === undefined) return;
      entries.push({
        root: current.root,
        main: entries.length === 0,
        ...(current.ref === undefined ? {} : { ref: current.ref }),
        ...(current.headOid === undefined ? {} : { headOid: current.headOid }),
        detached: current.detached,
        bare: current.bare,
      });
      current = { detached: false, bare: false };
    };
    for (const line of result.stdout.split(/\r?\n/u)) {
      if (line.startsWith('worktree ')) {
        flush();
        current.root = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        current.headOid = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        current.ref = line.slice('branch '.length).trim();
      } else if (line.trim() === 'detached') {
        current.detached = true;
      } else if (line.trim() === 'bare') {
        current.bare = true;
      }
    }
    flush();
    return entries;
  },

  async resolveRef(repoRoot, ref) {
    const result = await spawnGit(
      repoRoot,
      [
        'for-each-ref',
        '--format=%(refname)%09%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)',
        ref,
      ],
      { tolerateFailure: true }
    );
    if (result === null) return [];
    const targets: ResolvedRefTarget[] = [];
    for (const line of nonEmptyLines(result.stdout)) {
      const [refname, objectType, objectName, peeledType, peeledName] = line.split('\t');
      if (refname === undefined || refname !== ref) continue;
      // An annotated tag peels to its target; a lightweight one does not.
      const type = peeledType !== undefined && peeledType.length > 0 ? peeledType : objectType;
      const oid = peeledName !== undefined && peeledName.length > 0 ? peeledName : objectName;
      if (type === undefined || oid === undefined) continue;
      targets.push({ ref: refname, oid, objectType: type });
    }
    return targets;
  },

  async headOid(root) {
    const result = await spawnGit(root, ['rev-parse', 'HEAD'], { tolerateFailure: true });
    const oid = result === null ? undefined : nonEmptyLines(result.stdout)[0];
    return oid === undefined ? null : oid;
  },

  async checkedOutRef(root) {
    const result = await spawnGit(root, ['symbolic-ref', '--quiet', 'HEAD'], {
      tolerateFailure: true,
    });
    const ref = result === null ? undefined : nonEmptyLines(result.stdout)[0];
    return ref === undefined ? null : ref;
  },

  async commitExists(repoRoot, commit) {
    const result = await spawnGit(
      repoRoot,
      ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`],
      { tolerateFailure: true }
    );
    return result !== null && nonEmptyLines(result.stdout).length > 0;
  },

  async dirtyEntries(root) {
    const result = await spawnGit(
      root,
      ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--no-renames'],
      { tolerateFailure: true }
    );
    if (result === null) return [];
    const entries: WorktreeStatusEntry[] = [];
    for (const record of nulSeparatedRecords(result.stdout)) {
      if (record.length < 4) continue;
      const indexState = record[0] ?? ' ';
      const workingState = record[1] ?? ' ';
      const target = record.slice(3);
      if (target.length === 0) continue;
      if (indexState !== ' ' && indexState !== '?') {
        entries.push({ path: target, status: 'staged' });
      }
      if (workingState !== ' ' && workingState !== '?') {
        entries.push({ path: target, status: 'tracked-modified' });
      }
    }
    return entries;
  },

  async untrackedFiles(root) {
    const result = await spawnGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], {
      tolerateFailure: true,
    });
    if (result === null) return [];
    return nulSeparatedRecords(result.stdout);
  },

  async isAncestor(repoRoot, candidate, descendant) {
    const result = await spawnGit(
      repoRoot,
      ['merge-base', '--is-ancestor', candidate, descendant],
      { tolerateFailure: true }
    );
    return result !== null;
  },

  async addWorktree({ repoRoot, destination, branch, commit }) {
    // `-b` takes a BRANCH NAME, not a full ref: passing `refs/heads/x` creates
    // `refs/heads/refs/heads/x`. Everything above this adapter speaks full refs
    // (that is what the plan freezes and the index records), so the conversion
    // belongs here, and a ref that is not a branch is refused rather than
    // silently mangled.
    if (!branch.startsWith('refs/heads/')) {
      throw new Error(
        `a worktree branch must be a full branch ref below refs/heads/; received '${branch}'`
      );
    }
    const branchName = branch.slice('refs/heads/'.length);
    await spawnGit(repoRoot, ['worktree', 'add', '-b', branchName, destination, commit]);
  },

  async removeWorktree(repoRoot, worktreeRoot) {
    await spawnGit(repoRoot, ['worktree', 'remove', worktreeRoot]);
  },

  async pruneWorktrees(repoRoot) {
    await spawnGit(repoRoot, ['worktree', 'prune']);
  },
};

export function createNodeWorkspaceCoordination(
  globalDataDir?: string
): WorkspaceCoordination {
  const root = path.join(globalDataDir ?? getGlobalDataDir(), WORKSPACE_COORDINATION_DIR_NAME);
  return {
    root: () => root,
    resolve: (relativePath) => path.join(root, relativePath),
    async readJson(relativePath) {
      try {
        return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8')) as unknown;
      } catch (error) {
        if (nodeErrorCode(error) === 'ENOENT') return null;
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    },
    async writeJson(relativePath, value) {
      const target = path.join(root, relativePath);
      await atomicWorkspaceWriteText(
        target,
        `${JSON.stringify(value, null, 2)}\n`
      );
      return target;
    },
    async remove(relativePath) {
      await fs.rm(path.join(root, relativePath), { recursive: true, force: true });
    },
    async listNames(relativePath) {
      try {
        return (await fs.readdir(path.join(root, relativePath))).sort((left, right) =>
          left.localeCompare(right)
        );
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(nodeErrorCode(error) ?? '')) return [];
        throw error;
      }
    },
  };
}

export const productionStoreWorkspaceDependencies: StoreWorkspaceDependencies = {
  fs: nodeWorkspaceFileSystem,
  git: nodeWorkspaceGit,
  coordination: (globalDataDir) => createNodeWorkspaceCoordination(globalDataDir),
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
  randomToken: () => randomBytes(16).toString('hex'),
};

/** Deterministic clock + entropy, so a plan for equal inputs is byte-identical. */
export function withDeterministicWorkspaceIdentity(
  base: StoreWorkspaceDependencies,
  options: { readonly now: string; readonly seedPrefix?: string }
): StoreWorkspaceDependencies {
  let counter = 0;
  const prefix = options.seedPrefix ?? 'workspace-test-seed';
  return {
    ...base,
    now: () => new Date(options.now),
    mintInstanceSeed: () => {
      counter += 1;
      return createHash('sha256').update(`${prefix}:${counter}`).digest('hex').slice(0, 32);
    },
    randomToken: () => {
      counter += 1;
      return createHash('sha256').update(`${prefix}:token:${counter}`).digest('hex').slice(0, 32);
    },
  };
}
