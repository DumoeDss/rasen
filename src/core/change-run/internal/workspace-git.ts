import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Digest } from '../contracts.js';
import {
  blobDigest,
  type WorkspaceHead,
  type WorkspaceManifest,
  type WorkspaceSubmoduleEntry,
} from './workspace.js';

export type WorkspaceGitErrorCode =
  | 'workspace-git-unavailable'
  | 'workspace-observation-unsupported';

export class WorkspaceGitError extends Error {
  constructor(
    readonly code: WorkspaceGitErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceGitError';
  }
}

function git(repoPath: string, args: readonly string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkspaceGitError('workspace-git-unavailable', message);
  }
}

function isSha(value: string): value is string {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

const textEncoder = new TextEncoder();

/**
 * Git object SHAs are SHA-1 (40 hex); the canonical Digest type is
 * sha256-prefixed 64 hex. Re-hash the git SHA under sha256 so git identities
 * surface as stable canonical Digests without changing their meaning.
 */
function gitShaToDigest(sha: string): Digest {
  return blobDigest(textEncoder.encode(sha));
}

function headRevision(repoPath: string): WorkspaceHead {
  // On an unborn repo `rev-parse HEAD` exits non-zero; treat that as unborn
  // rather than a git-unavailable error.
  let revParse = '';
  try {
    revParse = git(repoPath, ['rev-parse', '--verify', '-q', 'HEAD']);
  } catch {
    return Object.freeze({ kind: 'unborn' });
  }
  const commit = revParse.trim();
  if (!isSha(commit)) {
    return Object.freeze({ kind: 'unborn' });
  }
  let symbolic = '';
  try {
    symbolic = git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim();
  } catch {
    symbolic = '';
  }
  return Object.freeze({
    kind: 'commit',
    digest: gitShaToDigest(commit),
    detached: symbolic.length === 0,
  });
}

function parseLsTree(output: string): { path: string; mode: string; blobDigest: Digest }[] {
  // <mode> <type> <blob-sha>\t<path>
  const entries: { path: string; mode: string; blobDigest: Digest }[] = [];
  for (const line of output.split('\n')) {
    if (line.length === 0) continue;
    const [meta, filePath] = line.split('\t');
    if (meta === undefined || filePath === undefined) continue;
    const [mode, type, blob] = meta.split(' ');
    if (type !== 'blob' || !isSha(blob ?? '')) continue;
    entries.push({ path: filePath, mode: mode ?? '100644', blobDigest: gitShaToDigest(blob) });
  }
  return entries;
}

/**
 * Observe a real git workspace and produce the path-independent
 * {@link WorkspaceManifest} the pure observer digests over. Uses bounded git
 * plumbing (rev-parse, ls-tree, ls-files) — no `git diff`, no mtimes. File
 * contents are read with a no-follow physical read; symlinks/reparse points
 * are reported as link entries, not followed.
 */
export function observeGitWorkspace(repoPath: string): WorkspaceManifest {
  const head = headRevision(repoPath);
  const headTreeRaw =
    head.kind === 'unborn' ? '' : git(repoPath, ['ls-tree', '-r', 'HEAD']);
  const headTree = parseLsTree(headTreeRaw);

  const indexRaw = git(repoPath, ['ls-files', '-s']);
  const index = indexRaw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      // <mode> <sha>\t<path>  with stage prefix on conflicts; ls-files -s:
      // <mode> <sha> <stage>\t<path>
      const [meta, filePath] = line.split('\t');
      const parts = (meta ?? '').split(' ');
      return {
        path: filePath ?? '',
        stage: Number.parseInt(parts[2] ?? '0', 10),
        mode: parts[0] ?? '100644',
        blobDigest: gitShaToDigest(parts[1] ?? ''),
      };
    })
    .filter((entry) => entry.path.length > 0);

  const trackedPaths = new Set(
    [...headTree, ...index].map((entry) => entry.path)
  );
  const trackedWorking = [...trackedPaths].map((filePath) => {
    let bytes = new Uint8Array();
    let mode = '100644';
    try {
      const absolute = path.join(repoPath, filePath);
      const st = statSync(absolute);
      mode = st.isDirectory() ? '040000' : '100644';
      if (st.isFile()) {
        bytes = new Uint8Array(readFileSync(absolute));
      }
    } catch {
      // deleted-from-working: zero bytes (captured as a deletion in the delta).
    }
    return { path: filePath, bytes, mode };
  });

  const untrackedRaw = git(repoPath, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  const untracked = untrackedRaw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((filePath) => {
      let bytes = new Uint8Array();
      try {
        bytes = new Uint8Array(readFileSync(path.join(repoPath, filePath)));
      } catch {
        // ignored
      }
      return { path: filePath, bytes };
    });

  const symlinks = [...trackedPaths, ...untracked.map((u) => u.path)]
    .map((filePath) => {
      try {
        const st = statSync(path.join(repoPath, filePath));
        if (st.isSymbolicLink()) {
          return { path: filePath, target: readFileSync(path.join(repoPath, filePath), 'utf8') };
        }
      } catch {
        // not present / not a symlink
      }
      return null;
    })
    .filter((entry): entry is { path: string; target: string } => entry !== null);

  const submodules: WorkspaceSubmoduleEntry[] = [];

  return Object.freeze({
    head,
    headTree,
    index,
    trackedWorking,
    untracked,
    symlinks,
    submodules,
  });
}

export { blobDigest };
