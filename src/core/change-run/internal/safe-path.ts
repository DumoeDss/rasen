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
  const rootReal = normalize(plumbing.realpath(root));
  if (plumbing.lstat(root) === null) {
    throw new SafePathError('unsafe_missing_root', 'Safe path root does not exist.');
  }
  const targetReal = normalize(plumbing.realpath(target));
  if (
    targetReal !== rootReal &&
    !targetReal.startsWith(rootReal + '/')
  ) {
    throw new SafePathError(
      'unsafe_path_escape',
      'Target realpath escapes the safe root.'
    );
  }
  // Walk every component strictly inside the root and reject traversal hazards.
  const relative = targetReal === rootReal ? '' : targetReal.slice(rootReal.length + 1);
  const segments = relative.split('/').filter((segment) => segment.length > 0);
  let prefix = rootReal;
  for (const segment of segments) {
    prefix = `${prefix}/${segment}`;
    const stat = plumbing.lstat(prefix);
    if (stat === null) continue;
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
