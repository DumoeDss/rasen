export interface SafePathStat {
  readonly isSymbolicLink: boolean;
  readonly isReparsePoint: boolean;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
}

/**
 * Pluggable filesystem surface so SafeRunPath's containment/traversal logic is
 * pure and testable without a real filesystem. The runtime adapter shells out
 * to lstat/realpath; tests supply synthetic results (symlink/junction/reparse/
 * hardlink/parent-swap).
 */
export interface SafePathPlumbing {
  readonly lstat: (path: string) => SafePathStat | null;
  readonly realpath: (path: string) => string;
}

export type SafePathErrorCode =
  | 'unsafe_path_escape'
  | 'unsafe_symlink_component'
  | 'unsafe_reparse_point'
  | 'unsafe_nonregular'
  | 'unsafe_parent_replacement'
  | 'unsafe_missing_root';

export class SafePathError extends Error {
  constructor(
    readonly code: SafePathErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SafePathError';
  }
}

function normalize(path: string): string {
  return path.split('\\').join('/').replace(/\/+$/, '');
}

function comparable(value: string): string {
  const normalized = normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function isContained(root: string, target: string): boolean {
  const comparableRoot = comparable(root);
  const comparableTarget = comparable(target);
  return (
    comparableTarget === comparableRoot ||
    comparableTarget.startsWith(`${comparableRoot}/`)
  );
}

/** Real filesystem plumbing shared by runtime path consumers. */
export function createNodeSafePathPlumbing(): SafePathPlumbing {
  return Object.freeze({
    lstat(candidate: string): SafePathStat | null {
      try {
        const stat = lstatSync(candidate);
        const symbolic = stat.isSymbolicLink();
        return Object.freeze({
          isSymbolicLink: symbolic,
          // Node exposes Windows junctions through isSymbolicLink(); it has no
          // portable API for arbitrary non-link reparse tags. Keep the field
          // explicit so injected platform adapters can reject those too.
          isReparsePoint: process.platform === 'win32' && symbolic,
          isRegularFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
        });
      } catch {
        return null;
      }
    },
    realpath(candidate: string): string {
      return realpathSync.native(candidate);
    },
  });
}

/**
 * Bounded SafeRunPath containment check (tasks 9.3/9.4). The target's resolved
 * real path must stay under the root's real path, and no component walked from
 * the root may be a symlink, a reparse point, a non-directory ancestor, or a
 * non-regular file leaf. A parent directory that realpath resolves outside the
 * root (parent replacement) is rejected. Same-parent exclusive create/publish
 * uses the same containment check on the parent.
 */
export function assertSafeRunPath(
  root: string,
  target: string,
  plumbing: SafePathPlumbing
): void {
  const normalizedRoot = normalize(root);
  const normalizedTarget = normalize(target);
  const rootStat = plumbing.lstat(normalizedRoot);
  if (rootStat === null) {
    throw new SafePathError('unsafe_missing_root', 'Safe path root does not exist.');
  }
  if (!rootStat.isDirectory) {
    throw new SafePathError('unsafe_nonregular', 'Safe path root is not a directory.');
  }
  if (rootStat.isSymbolicLink) {
    throw new SafePathError(
      'unsafe_symlink_component',
      'Safe path root must not be a symbolic link.'
    );
  }
  if (rootStat.isReparsePoint) {
    throw new SafePathError(
      'unsafe_reparse_point',
      'Safe path root must not be a reparse point.'
    );
  }
  if (!isContained(normalizedRoot, normalizedTarget)) {
    throw new SafePathError(
      'unsafe_path_escape',
      'Target lexical path escapes the safe root.'
    );
  }

  const rootReal = normalize(plumbing.realpath(normalizedRoot));
  const relative = comparable(normalizedTarget) === comparable(normalizedRoot)
    ? ''
    : normalizedTarget.slice(normalizedRoot.length + 1);
  const segments = relative.split('/').filter((segment) => segment.length > 0);
  let prefix = normalizedRoot;
  let missingAncestor = false;
  for (const [index, segment] of segments.entries()) {
    prefix = `${prefix}/${segment}`;
    const stat = plumbing.lstat(prefix);
    if (stat === null) {
      missingAncestor = true;
      continue;
    }
    if (missingAncestor) {
      throw new SafePathError(
        'unsafe_parent_replacement',
        'A descendant appeared below a missing path ancestor.'
      );
    }
    if (stat.isSymbolicLink) {
      throw new SafePathError(
        'unsafe_symlink_component',
        `Path component ${segment} is a symbolic link.`
      );
    }
    if (stat.isReparsePoint) {
      throw new SafePathError(
        'unsafe_reparse_point',
        `Path component ${segment} is a reparse point.`
      );
    }
    const isLeaf = index === segments.length - 1;
    if ((!isLeaf && !stat.isDirectory) || (isLeaf && !stat.isDirectory && !stat.isRegularFile)) {
      throw new SafePathError(
        'unsafe_nonregular',
        `Path component ${segment} has an unsafe file type.`
      );
    }
    const prefixReal = normalize(plumbing.realpath(prefix));
    if (!isContained(rootReal, prefixReal)) {
      throw new SafePathError(
        'unsafe_path_escape',
        `Path component ${segment} resolves outside the safe root.`
      );
    }
  }
}

/**
 * Same-parent exclusive create: a new file may be created only when its parent
 * is the expected safe root and no entry with that name already exists. The
 * pure-Node same-user race boundary is documented at the runtime adapter.
 */
export function assertSafeSameParentCreate(
  parent: string,
  name: string,
  plumbing: SafePathPlumbing
): void {
  const parentReal = normalize(plumbing.realpath(parent));
  const expected = normalize(parent);
  if (parentReal !== expected) {
    throw new SafePathError(
      'unsafe_parent_replacement',
      'Parent directory realpath does not match the expected parent (replacement).'
    );
  }
  if (name.includes('/') || name.includes('\\') || name.length === 0) {
    throw new SafePathError('unsafe_path_escape', 'Unsafe same-parent name.');
  }
  const target = `${parentReal}/${name}`;
  if (plumbing.lstat(target) !== null) {
    throw new SafePathError('unsafe_path_escape', 'Same-parent target already exists.');
  }
}
import { lstatSync, realpathSync } from 'node:fs';
