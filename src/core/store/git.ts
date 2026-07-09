import { execFile } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { StoreError } from './errors.js';

const fs = nodeFs.promises;
const execFileAsync = promisify(execFile);

/**
 * Git mechanics for stores: repository detection, setup-time init and
 * commit, and the read-only facts doctor reports. Nothing here clones, pulls,
 * pushes, or syncs — setup-time `git init` plus one initial commit is the
 * entire write surface.
 */

function isSpawnNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function isGitRepositoryAtRoot(storeRoot: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(storeRoot, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function initGitRepository(storeRoot: string): Promise<boolean> {
  if (await isGitRepositoryAtRoot(storeRoot)) {
    return false;
  }

  try {
    await execFileAsync('git', ['init'], { cwd: storeRoot });
  } catch (error) {
    throw new StoreError(
      `Failed to initialize Git repository: ${error instanceof Error ? error.message : String(error)}`,
      'store_git_init_failed',
      {
        target: 'store.git',
        fix: 'Install Git or rerun setup with --no-init-git.',
      }
    );
  }

  return true;
}

/**
 * `git var` resolves identity exactly as `git commit` would (config, env vars,
 * auto-detection), so this fails precisely when the initial commit would.
 */
export async function assertGitCommitIdentity(probeCwd: string): Promise<void> {
  for (const identVar of ['GIT_COMMITTER_IDENT', 'GIT_AUTHOR_IDENT']) {
    try {
      await execFileAsync('git', ['var', identVar], { cwd: probeCwd });
    } catch (error) {
      if (isSpawnNotFoundError(error)) {
        throw new StoreError(
          'Git is not available, so setup cannot create the initial store commit.',
          'store_git_init_failed',
          {
            target: 'store.git',
            fix: 'Install Git or rerun setup with --no-init-git.',
          }
        );
      }

      throw new StoreError(
        'No usable Git commit identity is configured, so setup cannot create the initial store commit.',
        'store_git_identity_missing',
        {
          target: 'store.git',
          fix: 'Run git config --global user.name "Your Name" and git config --global user.email "you@example.com", or rerun setup with --no-init-git.',
        }
      );
    }
  }
}

/**
 * Index-preserving initial commit: the pathspec on `git commit` keeps files
 * the user had already staged out of setup's commit and leaves them staged.
 * Pathspecs may be files or directories.
 */
export async function commitStoreFiles(
  storeRoot: string,
  id: string,
  pathspecs: string[]
): Promise<boolean> {
  if (pathspecs.length === 0) {
    return false;
  }

  try {
    await execFileAsync('git', ['add', '--', ...pathspecs], { cwd: storeRoot });
    await execFileAsync(
      'git',
      ['commit', '-m', `Initialize Rasen store ${id}`, '--', ...pathspecs],
      { cwd: storeRoot }
    );
  } catch (error) {
    // Best-effort unstage so a failed commit (gpg signing, hooks) does not
    // leave setup's files in the user's index after rollback deletes them.
    await execFileAsync('git', ['rm', '--cached', '-r', '-f', '-q', '--', ...pathspecs], {
      cwd: storeRoot,
    }).catch(() => undefined);

    throw new StoreError(
      `Failed to create the initial store commit: ${error instanceof Error ? error.message : String(error)}`,
      'store_git_commit_failed',
      {
        target: 'store.git',
        fix: 'Commit the created files manually, or rerun setup with --no-init-git.',
      }
    );
  }

  return true;
}

async function gitProbe(storeRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', storeRoot, ...args]);
    return stdout;
  } catch {
    return null;
  }
}

export async function gitHasCommits(storeRoot: string): Promise<boolean | null> {
  try {
    await execFileAsync('git', ['-C', storeRoot, 'rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch (error) {
    if (isSpawnNotFoundError(error)) return null;
    // Exit 1 = repo exists but HEAD has no commits. Anything else (exit 128:
    // corrupt or fake .git) is unknown, not "commitless".
    const exitCode = (error as { code?: number | string }).code;
    return exitCode === 1 ? false : null;
  }
}

export async function gitHasUncommittedChanges(storeRoot: string): Promise<boolean | null> {
  const stdout = await gitProbe(storeRoot, ['status', '--porcelain']);
  return stdout === null ? null : stdout.trim().length > 0;
}

export async function gitHasRemote(storeRoot: string): Promise<boolean | null> {
  const stdout = await gitProbe(storeRoot, ['remote']);
  return stdout === null ? null : stdout.trim().length > 0;
}

/**
 * The configured origin URL, read from local Git config only — never a
 * network touch. Null when there is no repository or no origin.
 */
export async function gitOriginUrl(storeRoot: string): Promise<string | null> {
  const stdout = await gitProbe(storeRoot, ['remote', 'get-url', 'origin']);
  const url = stdout?.trim();
  return url ? url : null;
}

export async function gitDirectoryHasTrackedFiles(
  storeRoot: string,
  relativeDir: string
): Promise<boolean | null> {
  const stdout = await gitProbe(storeRoot, ['ls-files', '--', relativeDir]);
  return stdout === null ? null : stdout.trim().length > 0;
}

/**
 * Resolves the shared `.git` directory for `repoPath` via `git rev-parse
 * --git-common-dir` — identical for every worktree of one repository, and
 * distinct across independent clones/repositories. Returns null when the
 * path is not a Git working tree or Git is unavailable (project-registry
 * treats that as "cannot determine" and forks rather than shares).
 */
export async function gitCommonDir(repoPath: string): Promise<string | null> {
  const stdout = await gitProbe(repoPath, ['rev-parse', '--git-common-dir']);
  const raw = stdout?.trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(repoPath, raw);
}

/**
 * Resolves the working-tree-specific `.git` directory for `repoPath` via
 * `git rev-parse --git-dir` — distinct per linked worktree, but IDENTICAL
 * for any two paths inside one single working tree (e.g. two subdirectories,
 * or a `cp -r` copy that carries no separate `.git`). Paired with
 * `gitCommonDir`, this lets project-registry tell true worktree siblings
 * (same common dir, different git dir) apart from same-tree paths (same
 * common dir, same git dir too). Returns null when the path is not a Git
 * working tree or Git is unavailable.
 */
export async function gitDir(repoPath: string): Promise<string | null> {
  const stdout = await gitProbe(repoPath, ['rev-parse', '--git-dir']);
  const raw = stdout?.trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(repoPath, raw);
}
