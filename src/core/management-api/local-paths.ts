/**
 * `GET /api/v1/local-paths` handler (local-path-browsing design D3).
 *
 * Read-only directory enumeration for the create-space picker. Strictly
 * read-only — it creates, writes, and registers nothing, and never touches a
 * registry. Two shapes of request:
 *  - no `path` param → the home start-point response (the confinement half of
 *    the rule: the server never volunteers a location above home);
 *  - an absolute `path` → that directory, wherever it points (the escape
 *    hatch: an explicitly typed absolute path is the sole way above home, so
 *    every escalation traces to a user action).
 * A relative or empty `path` is rejected 400 — which doubles as the
 * option-injection guard for the later create-space spawn.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import type { LocalPathEntry, LocalPathsResponse } from './wire-types.js';

export type LocalPathsResult =
  | { ok: true; response: LocalPathsResponse }
  | { ok: false; status: number; code: string; message: string };

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/** Maps a filesystem errno onto the structured error envelope (design D3): missing → 404, forbidden → 403, everything else degrades to 404. */
function fsError(error: unknown, target: string): LocalPathsResult {
  const code = errnoCode(error);
  if (code === 'EACCES' || code === 'EPERM') {
    return { ok: false, status: 403, code: 'path_forbidden', message: `Permission denied reading ${target}.` };
  }
  if (code === 'ENOTDIR') {
    return { ok: false, status: 400, code: 'not_a_directory', message: `${target} is not a directory.` };
  }
  // ENOENT and any other unexpected errno both surface as "not found" rather
  // than crashing — the endpoint never throws.
  return { ok: false, status: 404, code: 'path_not_found', message: `${target} does not exist.` };
}

/**
 * True when the directory entry `<dir>/<name>` is (or contains) a git
 * repository: a `.git` directory OR a `.git` file (worktrees and submodules
 * use a file). Best-effort — any stat failure yields false, never throws.
 */
async function detectGitRepo(dir: string, name: string): Promise<boolean> {
  try {
    await fs.promises.stat(path.join(dir, name, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function handleLocalPaths(pathParam: string | undefined): Promise<LocalPathsResult> {
  const isHome = pathParam === undefined;
  const target = isHome ? os.homedir() : pathParam;

  if (!isHome && !path.isAbsolute(target)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_path',
      message: 'path must be an absolute filesystem path.',
    };
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target);
  } catch (error) {
    return fsError(error, target);
  }
  if (!stat.isDirectory()) {
    return { ok: false, status: 400, code: 'not_a_directory', message: `${target} is not a directory.` };
  }

  // Canonicalize so Windows drive-letter case and separator variants resolve
  // to one stable form (design D3); parent/child paths are built off it.
  const canonical = FileSystemUtils.canonicalizeExistingPath(target);

  let dirents: fs.Dirent[];
  try {
    dirents = await fs.promises.readdir(canonical, { withFileTypes: true });
  } catch (error) {
    return fsError(error, canonical);
  }

  const entries: LocalPathEntry[] = await Promise.all(
    dirents.map(async (dirent) => {
      // Symlinks are not followed: `isDirectory()` is false for a symlink,
      // so a symlinked directory reads as a plain entry (design D3).
      const isDir = dirent.isDirectory();
      const isGitRepo = isDir ? await detectGitRepo(canonical, dirent.name) : false;
      return { name: dirent.name, isDir, isGitRepo };
    })
  );

  // Directories first, then alphabetical within each group.
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // At the home start point the server advertises NO ascent (`parent: null`):
  // it must never volunteer a location above home — an explicitly typed
  // absolute path is the sole escape (local-path-browsing spec / design D3).
  // Elsewhere, `parent` is the canonical dirname, or null at a filesystem root.
  const parentPath = path.dirname(canonical);
  const parent = isHome || parentPath === canonical ? null : parentPath;

  return {
    ok: true,
    response: {
      path: canonical,
      parent,
      separator: path.sep,
      ...(isHome ? { home: true } : {}),
      entries,
    },
  };
}
