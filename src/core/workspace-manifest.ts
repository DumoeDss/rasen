import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_INTERNAL_INSTABILITY_RETRIES = 1;
const READ_BUFFER_BYTES = 64 * 1024;

export type WorkspaceManifestErrorCode =
  | 'internal-instability'
  | 'persistent-instability'
  | 'permission'
  | 'path'
  | 'decoding'
  | 'bounds'
  | 'unsupported-entry';

export class WorkspaceManifestError extends Error {
  constructor(
    readonly code: WorkspaceManifestErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'WorkspaceManifestError';
  }
}

export type WorkspaceManifestPhase =
  | 'observation-start'
  | 'after-file-read'
  | 'after-directory-enumeration'
  | 'after-directory-children';

export interface WorkspaceManifestPhaseEvent {
  readonly phase: WorkspaceManifestPhase;
  readonly attempt: number;
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface ObserveStableWorkspaceManifestOptions {
  readonly cwd: string;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly internalInstabilityRetries?: number;
  /** Deterministic race/fault seam used by stability tests. */
  readonly onPhase?: (event: WorkspaceManifestPhaseEvent) => void;
}

export interface StableWorkspaceManifest {
  readonly schema: 'rasen-stable-workspace-manifest/1';
  readonly root: string;
  readonly digest: string;
  readonly entries: number;
  readonly bytes: number;
  readonly attempts: number;
}

interface ObservationBounds {
  readonly maxBytes: number;
  readonly maxEntries: number;
}

interface EntryMetadata {
  readonly kind: 'file' | 'directory' | 'symlink';
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

const INTERNAL_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'ESTALE',
  'EBUSY',
]);
const PERMISSION_CODES = new Set(['EACCES', 'EPERM']);

function manifestError(
  error: unknown,
  operation: string,
  pathFailure = false
): WorkspaceManifestError {
  if (error instanceof WorkspaceManifestError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (PERMISSION_CODES.has(code ?? '')) {
    return new WorkspaceManifestError(
      'permission',
      `Workspace manifest ${operation} was denied.`,
      { cause: error }
    );
  }
  if (!pathFailure && INTERNAL_CODES.has(code ?? '')) {
    return new WorkspaceManifestError(
      'internal-instability',
      `Workspace manifest ${operation} raced with a path change.`,
      { cause: error }
    );
  }
  return new WorkspaceManifestError(
    'path',
    `Workspace manifest ${operation} failed.`,
    { cause: error }
  );
}

function safeRealpath(value: string, label: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch (error) {
    throw manifestError(error, label, true);
  }
}

function gitBytes(cwd: string, args: readonly string[], maxBytes: number): Buffer {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'buffer',
    maxBuffer: maxBytes,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw manifestError(result.error, 'Git identity read', true);
  }
  return Buffer.from(result.stdout ?? Buffer.alloc(0));
}

function gitPath(cwd: string, args: readonly string[], maxBytes: number): string {
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true })
      .decode(gitBytes(cwd, args, maxBytes))
      .trim();
  } catch (error) {
    if (error instanceof WorkspaceManifestError) throw error;
    throw new WorkspaceManifestError(
      'decoding',
      'Workspace Git path is not valid UTF-8.',
      { cause: error }
    );
  }
  if (value.length === 0 || value.includes('\0')) {
    throw new WorkspaceManifestError('path', 'Workspace Git path is empty or invalid.');
  }
  return value;
}

function filesystemPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

function entryMetadata(stat: fs.BigIntStats): EntryMetadata {
  const kind = stat.isFile()
    ? 'file'
    : stat.isDirectory()
      ? 'directory'
      : stat.isSymbolicLink()
        ? 'symlink'
        : undefined;
  if (kind === undefined) {
    throw new WorkspaceManifestError(
      'unsupported-entry',
      'Workspace contains an unsupported filesystem entry.'
    );
  }
  return Object.freeze({
    kind,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  });
}

function sameMetadata(left: EntryMetadata, right: EntryMetadata): boolean {
  return left.kind === right.kind &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function instability(message: string): never {
  throw new WorkspaceManifestError('internal-instability', message);
}

function checkedLstat(absolute: string): fs.BigIntStats {
  try {
    return fs.lstatSync(absolute, { bigint: true });
  } catch (error) {
    throw manifestError(error, 'lstat');
  }
}

function checkedFstat(descriptor: number): fs.BigIntStats {
  try {
    return fs.fstatSync(descriptor, { bigint: true });
  } catch (error) {
    throw manifestError(error, 'fstat');
  }
}

function decodeDirectoryName(value: Buffer): string {
  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch (error) {
    throw new WorkspaceManifestError(
      'decoding',
      'Workspace entry name is not valid UTF-8.',
      { cause: error }
    );
  }
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('\0') ||
    name.includes('/') ||
    (process.platform === 'win32' && name.includes('\\'))
  ) {
    throw new WorkspaceManifestError('path', 'Workspace entry name is invalid.');
  }
  return name;
}

function readChildren(absolute: string): string[] {
  let values: Buffer[];
  try {
    values = fs.readdirSync(absolute, { encoding: 'buffer' }) as Buffer[];
  } catch (error) {
    throw manifestError(error, 'directory enumeration');
  }
  return values
    .map(decodeDirectoryName)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sameChildren(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function validatePositiveBound(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return selected;
}

function observeOnce(
  options: ObserveStableWorkspaceManifestOptions,
  bounds: ObservationBounds,
  attempt: number
): StableWorkspaceManifest {
  if (typeof options.cwd !== 'string' || options.cwd.length === 0 || options.cwd.includes('\0')) {
    throw new TypeError('Workspace manifest cwd is invalid.');
  }
  const canonicalCwd = safeRealpath(options.cwd, 'cwd resolution');
  const worktreeRoot = safeRealpath(
    gitPath(canonicalCwd, ['rev-parse', '--show-toplevel'], bounds.maxBytes),
    'worktree resolution'
  );
  const relativeCwd = path.relative(worktreeRoot, canonicalCwd);
  if (relativeCwd.startsWith('..') || path.isAbsolute(relativeCwd)) {
    throw new WorkspaceManifestError(
      'path',
      'Workspace cwd escaped its canonical worktree.'
    );
  }
  const gitDirectory = path.resolve(
    gitPath(canonicalCwd, ['rev-parse', '--absolute-git-dir'], bounds.maxBytes)
  );
  const excluded = new Set([
    filesystemPathKey(path.join(worktreeRoot, '.git')),
    filesystemPathKey(gitDirectory),
  ]);
  options.onPhase?.({
    phase: 'observation-start',
    attempt,
    absolutePath: worktreeRoot,
    relativePath: '.',
  });

  const hash = createHash('sha256');
  let observedBytes = 0;
  let observedEntries = 0;
  const update = (value: string | Buffer): void => {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    observedBytes += bytes.byteLength;
    if (observedBytes > bounds.maxBytes) {
      throw new WorkspaceManifestError(
        'bounds',
        'Workspace manifest exceeded its byte bound.'
      );
    }
    hash.update(bytes);
  };
  update('rasen-stable-workspace-manifest/1\0');
  update(gitBytes(canonicalCwd, ['rev-parse', '--verify', 'HEAD'], bounds.maxBytes));
  update(gitBytes(canonicalCwd, ['ls-files', '--stage', '-z'], bounds.maxBytes));
  const readBuffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);

  const phase = (
    value: WorkspaceManifestPhase,
    absolutePath: string,
    relativePath: string
  ): void => options.onPhase?.({
    phase: value,
    attempt,
    absolutePath,
    relativePath: relativePath === '' ? '.' : relativePath.split(path.sep).join('/'),
  });

  const visit = (absolute: string, relative: string): void => {
    if (relative !== '' && excluded.has(filesystemPathKey(absolute))) return;
    observedEntries += 1;
    if (observedEntries > bounds.maxEntries) {
      throw new WorkspaceManifestError(
        'bounds',
        'Workspace manifest exceeded its entry bound.'
      );
    }
    const initialStat = checkedLstat(absolute);
    const initial = entryMetadata(initialStat);
    const manifestPath = relative === '' ? '.' : relative.split(path.sep).join('/');
    update(
      `${manifestPath}\0${initial.kind}\0${initial.dev}\0${initial.ino}\0${initial.mode}\0${initial.size}\0${initial.mtimeNs}\0${initial.ctimeNs}\0`
    );

    if (initial.kind === 'symlink') {
      let target: Buffer;
      try {
        target = fs.readlinkSync(absolute, { encoding: 'buffer' });
      } catch (error) {
        throw manifestError(error, 'symlink read');
      }
      update(`link:${target.byteLength}\0`);
      update(target);
      if (!sameMetadata(initial, entryMetadata(checkedLstat(absolute)))) {
        instability('Workspace symlink changed while it was observed.');
      }
      return;
    }

    if (initial.kind === 'file') {
      if (initial.size > BigInt(bounds.maxBytes - observedBytes)) {
        throw new WorkspaceManifestError(
          'bounds',
          'Workspace manifest exceeded its byte bound.'
        );
      }
      const noFollow = process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW;
      let descriptor: number;
      try {
        descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
      } catch (error) {
        throw manifestError(error, 'no-follow file open');
      }
      try {
        if (!sameMetadata(initial, entryMetadata(checkedFstat(descriptor)))) {
          instability('Workspace file identity changed between lstat and open.');
        }
        update(`content:${initial.size}\0`);
        let readBytes = 0n;
        for (;;) {
          let count: number;
          try {
            count = fs.readSync(
              descriptor,
              readBuffer,
              0,
              readBuffer.byteLength,
              null
            );
          } catch (error) {
            throw manifestError(error, 'file read');
          }
          if (count === 0) break;
          readBytes += BigInt(count);
          update(readBuffer.subarray(0, count));
        }
        if (readBytes !== initial.size) {
          instability('Workspace file size changed while it was read.');
        }
        phase('after-file-read', absolute, relative);
        if (!sameMetadata(initial, entryMetadata(checkedFstat(descriptor)))) {
          instability('Workspace file metadata changed while it was read.');
        }
      } finally {
        try {
          fs.closeSync(descriptor);
        } catch (error) {
          throw manifestError(error, 'file close');
        }
      }
      return;
    }

    const children = readChildren(absolute);
    update(`children:${children.length}\0${children.join('\0')}\0`);
    phase('after-directory-enumeration', absolute, relative);
    if (!sameMetadata(initial, entryMetadata(checkedLstat(absolute)))) {
      instability('Workspace directory changed after enumeration.');
    }
    for (const child of children) {
      visit(
        path.join(absolute, child),
        relative === '' ? child : path.join(relative, child)
      );
    }
    phase('after-directory-children', absolute, relative);
    if (!sameMetadata(initial, entryMetadata(checkedLstat(absolute)))) {
      instability('Workspace directory changed while its children were observed.');
    }
    if (!sameChildren(children, readChildren(absolute))) {
      instability('Workspace directory child set changed while it was observed.');
    }
  };

  visit(worktreeRoot, '');
  return Object.freeze({
    schema: 'rasen-stable-workspace-manifest/1',
    root: worktreeRoot,
    digest: hash.digest('hex'),
    entries: observedEntries,
    bytes: observedBytes,
    attempts: attempt,
  });
}

export function observeStableWorkspaceManifest(
  options: ObserveStableWorkspaceManifestOptions
): StableWorkspaceManifest {
  const bounds = Object.freeze({
    maxBytes: validatePositiveBound(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes'),
    maxEntries: validatePositiveBound(
      options.maxEntries,
      DEFAULT_MAX_ENTRIES,
      'maxEntries'
    ),
  });
  const retries = options.internalInstabilityRetries ??
    DEFAULT_INTERNAL_INSTABILITY_RETRIES;
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 16) {
    throw new TypeError('internalInstabilityRetries must be a safe integer from 0 to 16.');
  }
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return observeOnce(options, bounds, attempt);
    } catch (error) {
      const classified = manifestError(error, 'observation');
      if (classified.code !== 'internal-instability') throw classified;
      if (attempt > retries) {
        throw new WorkspaceManifestError(
          'persistent-instability',
          'Workspace manifest remained internally unstable after bounded retries.',
          { cause: classified }
        );
      }
    }
  }
  throw new WorkspaceManifestError(
    'persistent-instability',
    'Workspace manifest retry bound was exhausted.'
  );
}
