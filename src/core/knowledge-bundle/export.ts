/**
 * Export one project's own canonical learned knowledge to one user-named file.
 *
 * The read side composes the landed project identity, canonical knowledge
 * home, canonical-record reader, and read-only Git probe. The write side does
 * not create parent directories. It holds the staging descriptor open inside
 * an exclusive 0700 private directory outside the user-selected destination
 * directory, re-proves descriptor/path identity before publication and
 * cleanup, and publishes without replacement. Once publication succeeds, the
 * destination is committed and never touched again.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveProjectSelector, type ResolvedProject } from '../config-api/project-addressing.js';
import {
  readStoreCatalog,
  type StoreCatalogRead,
} from '../learned-skills/catalog.js';
import type { ResolvedStore } from '../learned-skills/stores.js';
import {
  resolveProjectKnowledgeHome,
  type ProjectKnowledgeHome,
} from '../project-knowledge-home.js';
import { gitHeadCommit } from '../store/git.js';
import {
  assertNeverStoreBinding,
  primaryRepair,
  resolveStoreBinding,
  type StoreBindingResolution,
} from '../store/identity.js';
import { isValidStoreUid } from '../store/identity-types.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  createKnowledgeBundle,
  createKnowledgeBundleRecord,
  type KnowledgeBundle,
} from './schema.js';

export type KnowledgeBundleExportWarning =
  | 'base_project_commit_unavailable'
  | 'staging_cleanup_deferred';
export const KNOWLEDGE_BUNDLE_EXPORT_STATE = 'exported' as const;
export const KNOWLEDGE_BUNDLE_STORE_TRANSPORT_DIRECTORY =
  'rasen' as const;
export const KNOWLEDGE_BUNDLE_STORE_TRANSPORT_SUBDIRECTORY =
  'knowledge-bundles' as const;

export interface KnowledgeBundleStoreTransportResult {
  store: {
    id: string;
    uid?: string;
  };
  destination: string;
  filesToCommit: string[];
}

export interface KnowledgeBundleExportResult {
  projectId: string;
  recordCount: number;
  destination: string;
  warnings: KnowledgeBundleExportWarning[];
  bundle: KnowledgeBundle;
  transport?: KnowledgeBundleStoreTransportResult;
}

export type KnowledgeBundleExportErrorCode =
  | 'knowledge_bundle_project_not_found'
  | 'knowledge_bundle_destination_occupied'
  | 'knowledge_bundle_record_unreadable'
  | 'knowledge_bundle_store_overlap'
  | 'knowledge_bundle_store_unavailable'
  | 'knowledge_bundle_store_write_failed'
  | 'knowledge_bundle_write_failed';

export class KnowledgeBundleExportError extends Error {
  readonly code: KnowledgeBundleExportErrorCode;
  readonly details: Record<string, string>;

  constructor(
    code: KnowledgeBundleExportErrorCode,
    message: string,
    details: Record<string, string> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'KnowledgeBundleExportError';
    this.code = code;
    this.details = details;
  }
}

export interface KnowledgeBundleExportIo {
  targetExists: (target: string) => boolean;
  createPrivateDirectory: (prefix: string) => string;
  openExclusive: (target: string) => number;
  write: (fd: number, content: string) => void;
  sync: (fd: number) => void;
  close: (fd: number) => void;
  pathOwnsOpenFile: (fd: number, target: string) => boolean;
  beforePublish: (destination: string) => void;
  publishNewFile: (temporary: string, destination: string) => void;
  removeOwnedFile: (target: string) => void;
  removeOwnedDirectory: (target: string) => void;
  sameFileSystem: (leftDirectory: string, rightDirectory: string) => boolean;
}

export interface KnowledgeBundleStoreDirectoryAuthorization {
  storeRoot: string;
  intendedDirectory: string;
  canonicalDirectory: string;
  device: string;
  inode: string;
}

export interface KnowledgeBundleExportDependencies {
  resolveProject: (selector: string) => Promise<ResolvedProject | null>;
  resolveStore: (selector: string) => Promise<StoreBindingResolution>;
  resolveKnowledgeHome: (projectId: string) => ProjectKnowledgeHome;
  readCatalog: (home: ProjectKnowledgeHome) => StoreCatalogRead;
  readBaseProjectCommit: (root: string) => Promise<string | null>;
  bundleId: () => string;
  now: () => Date;
  canonicalizeStoreRoot: (root: string) => string;
  ensureStoreDirectory: (
    storeRoot: string,
    directory: string
  ) => KnowledgeBundleStoreDirectoryAuthorization;
  io: KnowledgeBundleExportIo;
}

export interface ExportKnowledgeBundleOptions {
  project: string;
  to: string;
  toStore?: string;
  dependencies?: Partial<Omit<KnowledgeBundleExportDependencies, 'io'>> & {
    io?: Partial<KnowledgeBundleExportIo>;
  };
}

function targetExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

const DEFAULT_IO: KnowledgeBundleExportIo = {
  targetExists,
  createPrivateDirectory: (prefix) => {
    const directory = fs.mkdtempSync(prefix);
    try {
      fs.chmodSync(directory, 0o700);
      return directory;
    } catch (error) {
      try {
        fs.rmdirSync(directory);
      } catch {
        // Preserve the chmod failure; the directory was exclusively created.
      }
      throw error;
    }
  },
  openExclusive: (target) => fs.openSync(target, 'wx', 0o600),
  write: (fd, content) => fs.writeFileSync(fd, content, 'utf8'),
  sync: (fd) => fs.fsyncSync(fd),
  close: (fd) => fs.closeSync(fd),
  pathOwnsOpenFile: (fd, target) => {
    const opened = fs.fstatSync(fd, { bigint: true });
    try {
      const named = fs.statSync(target, { bigint: true });
      return opened.dev === named.dev && opened.ino === named.ino;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  },
  beforePublish: () => {},
  // `rename` has replace semantics on POSIX. A hard link is the portable
  // atomic no-clobber publication primitive already used elsewhere in Rasen:
  // the complete temporary inode appears at the destination, or EEXIST leaves
  // the occupant byte-identical. The owned temporary name is then removed.
  publishNewFile: (temporary, destination) => fs.linkSync(temporary, destination),
  removeOwnedFile: (target) => fs.unlinkSync(target),
  removeOwnedDirectory: (target) => fs.rmdirSync(target),
  sameFileSystem: (leftDirectory, rightDirectory) =>
    fs.statSync(leftDirectory, { bigint: true }).dev ===
    fs.statSync(rightDirectory, { bigint: true }).dev,
};

function projectCatalog(home: ProjectKnowledgeHome): StoreCatalogRead {
  const owner = { type: 'project' as const, projectId: home.projectId };
  const store: ResolvedStore = {
    dir: home.catalogDir,
    owner,
    root: home.root,
    projectId: home.projectId,
    // readStoreCatalog does not acquire a lock. Supplying the canonical
    // machine-local shape keeps this adapter on the landed catalog API without
    // introducing an alternate discovery walk.
    lockPath: path.join(home.root, '.knowledge-bundle-read-only.lock'),
  };
  return readStoreCatalog(store, 'project');
}

const DEFAULT_DEPENDENCIES: KnowledgeBundleExportDependencies = {
  resolveProject: resolveProjectSelector,
  resolveStore: (selector) =>
    resolveStoreBinding({
      declaration: isValidStoreUid(selector)
        ? { form: 'durable', uid: selector }
        : { form: 'alias', id: selector },
    }),
  resolveKnowledgeHome: resolveProjectKnowledgeHome,
  readCatalog: projectCatalog,
  readBaseProjectCommit: gitHeadCommit,
  bundleId: randomUUID,
  now: () => new Date(),
  canonicalizeStoreRoot: resolveKnowledgeBundleStoreRoot,
  ensureStoreDirectory: ensureKnowledgeBundleStoreDirectory,
  io: DEFAULT_IO,
};

function resolveDependencies(
  overrides: ExportKnowledgeBundleOptions['dependencies']
): KnowledgeBundleExportDependencies {
  return {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
    io: {
      ...DEFAULT_IO,
      ...overrides?.io,
    },
  };
}

/**
 * Canonicalizes the existing parent rather than the non-existent file. Thus a
 * symlink/junction spelling, Windows short path, drive-letter case difference,
 * or separator difference cannot make one occupied destination look like two.
 */
export function resolveKnowledgeBundleDestination(destination: string): string {
  const resolved = path.resolve(destination);
  const parent = FileSystemUtils.canonicalizeExistingPath(path.dirname(resolved));
  return path.join(parent, path.basename(resolved));
}

export function resolveKnowledgeBundleStoreRoot(storeRoot: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(path.resolve(storeRoot));
  } catch {
    return path.resolve(storeRoot);
  }
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function pathsArePlatformEqual(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function assertReservedDirectoryHasNoRedirection(
  canonicalStoreRoot: string,
  intendedDirectory: string
): void {
  const resolvedDirectory = path.resolve(intendedDirectory);
  if (!pathIsInside(canonicalStoreRoot, resolvedDirectory)) {
    throw new Error(`Store transport directory is outside the Store root: ${intendedDirectory}.`);
  }
  const relative = path.relative(canonicalStoreRoot, resolvedDirectory);
  let current = canonicalStoreRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Store transport reserved path contains a symlink or junction: ${current}.`
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`Store transport reserved path is not a directory: ${current}.`);
    }
  }
}

/**
 * Authorizes exactly the lexical reserved subtree. A symlink, junction, or
 * reparse-like link is refused even when it redirects somewhere else inside
 * the Store, because "inside Store" is weaker than "transport-only".
 */
export function ensureKnowledgeBundleStoreDirectory(
  storeRoot: string,
  directory: string
): KnowledgeBundleStoreDirectoryAuthorization {
  const canonicalRoot = resolveKnowledgeBundleStoreRoot(storeRoot);
  const intendedDirectory = path.resolve(directory);
  assertReservedDirectoryHasNoRedirection(canonicalRoot, intendedDirectory);
  fs.mkdirSync(intendedDirectory, { recursive: true });
  assertReservedDirectoryHasNoRedirection(canonicalRoot, intendedDirectory);

  const canonicalDirectory =
    FileSystemUtils.canonicalizeExistingPath(intendedDirectory);
  if (!pathsArePlatformEqual(canonicalDirectory, intendedDirectory)) {
    throw new Error(
      `Store transport reserved path redirected from ${intendedDirectory} to ${canonicalDirectory}.`
    );
  }
  const identity = fs.statSync(canonicalDirectory, { bigint: true });
  if (!identity.isDirectory()) {
    throw new Error(`Store transport destination parent is not a directory: ${canonicalDirectory}.`);
  }
  return {
    storeRoot: canonicalRoot,
    intendedDirectory,
    canonicalDirectory,
    device: identity.dev.toString(),
    inode: identity.ino.toString(),
  };
}

export function verifyKnowledgeBundleStoreDirectory(
  authorization: KnowledgeBundleStoreDirectoryAuthorization
): void {
  assertReservedDirectoryHasNoRedirection(
    authorization.storeRoot,
    authorization.intendedDirectory
  );
  const canonicalDirectory = FileSystemUtils.canonicalizeExistingPath(
    authorization.intendedDirectory
  );
  if (
    !pathsArePlatformEqual(canonicalDirectory, authorization.intendedDirectory) ||
    !pathsArePlatformEqual(canonicalDirectory, authorization.canonicalDirectory)
  ) {
    throw new Error(
      `Store transport destination parent changed before publication: ${authorization.intendedDirectory}.`
    );
  }
  const identity = fs.statSync(canonicalDirectory, { bigint: true });
  if (
    !identity.isDirectory() ||
    identity.dev.toString() !== authorization.device ||
    identity.ino.toString() !== authorization.inode
  ) {
    throw new Error(
      `Store transport destination parent identity changed before publication: ${authorization.intendedDirectory}.`
    );
  }
}

/**
 * The transport directory is deliberately separate from Store catalog and
 * membership files. Every segment is composed by the platform path module;
 * bundle identity is the final collision key.
 */
export function resolveKnowledgeBundleStoreDestination(
  storeRoot: string,
  projectId: string,
  bundleId: string
): string {
  return path.resolve(
    storeRoot,
    KNOWLEDGE_BUNDLE_STORE_TRANSPORT_DIRECTORY,
    KNOWLEDGE_BUNDLE_STORE_TRANSPORT_SUBDIRECTORY,
    projectId,
    `${bundleId}.bundle.json`
  );
}

export function serializeKnowledgeBundle(bundle: KnowledgeBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/**
 * Builds the prefix for an exclusive, randomized private staging directory
 * beside the destination directory, not inside it. A filesystem root has no
 * outside sibling staging location and is refused before staging begins.
 */
export function resolveKnowledgeBundleStagingDirectoryPrefix(
  destination: string,
  bundleId: string,
  processId = process.pid
): string {
  const destinationDirectory = path.dirname(destination);
  const stagingDirectory = path.dirname(destinationDirectory);
  if (path.resolve(stagingDirectory) === path.resolve(destinationDirectory)) {
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_write_failed',
      `Could not safely stage knowledge bundle for ${destination}.`,
      {
        destination,
        reason: 'the destination directory has no external sibling staging location',
      }
    );
  }
  return path.join(
    stagingDirectory,
    `.${path.basename(destinationDirectory)}.${path.basename(destination)}.${processId}.${bundleId}.staging-`
  );
}

/**
 * Store transport staging is a private sibling of the canonical Store root.
 * Thus a deferred cleanup can never add a second untracked entry to the Store.
 */
export function resolveKnowledgeBundleStoreStagingDirectoryPrefix(
  storeRoot: string,
  bundleId: string,
  processId = process.pid
): string {
  const canonicalRoot = resolveKnowledgeBundleStoreRoot(storeRoot);
  const stagingBase = path.dirname(canonicalRoot);
  if (pathsArePlatformEqual(stagingBase, canonicalRoot)) {
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_store_write_failed',
      `Could not safely stage a Store transport bundle for ${canonicalRoot}.`,
      {
        destination: canonicalRoot,
        reason: 'the Store root has no external sibling staging location',
      }
    );
  }
  return path.join(
    stagingBase,
    `.${path.basename(canonicalRoot)}.knowledge-bundle-transport.${processId}.${bundleId}.staging-`
  );
}

function destinationOccupied(destination: string): KnowledgeBundleExportError {
  return new KnowledgeBundleExportError(
    'knowledge_bundle_destination_occupied',
    `Export destination is occupied: ${destination}`,
    { destination }
  );
}

function removeOwnedTemporary(io: KnowledgeBundleExportIo, temporary: string): void {
  try {
    io.removeOwnedFile(temporary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

interface WriteBundleFileOptions {
  stagingPrefix?: string;
  authorization?: KnowledgeBundleStoreDirectoryAuthorization;
}

function writeBundleFile(
  destination: string,
  serializedBundle: string,
  io: KnowledgeBundleExportIo,
  bundleId: string,
  options: WriteBundleFileOptions = {}
): KnowledgeBundleExportWarning[] {
  try {
    if (io.targetExists(destination)) throw destinationOccupied(destination);
  } catch (error) {
    if (error instanceof KnowledgeBundleExportError) throw error;
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_write_failed',
      `Could not inspect knowledge bundle destination ${destination}.`,
      { destination, reason: error instanceof Error ? error.message : String(error) },
      { cause: error }
    );
  }

  const stagingPrefix =
    options.stagingPrefix ??
    resolveKnowledgeBundleStagingDirectoryPrefix(destination, bundleId);
  let sameFileSystem: boolean;
  try {
    sameFileSystem = io.sameFileSystem(
      path.dirname(stagingPrefix),
      path.dirname(destination)
    );
  } catch (error) {
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_write_failed',
      `Could not safely stage knowledge bundle for ${destination}.`,
      { destination, reason: error instanceof Error ? error.message : String(error) },
      { cause: error }
    );
  }
  if (!sameFileSystem) {
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_write_failed',
      `Could not safely stage knowledge bundle for ${destination}.`,
      {
        destination,
        reason: 'the external staging location is on a different filesystem',
      }
    );
  }
  let stagingDirectory: string | undefined;
  let temporary: string | undefined;
  let fd: number | undefined;
  let ownsTemporary = false;
  let ownershipLost = false;
  let publicationAttempted = false;
  let published = false;
  let cleanupDeferred = false;
  let failure: KnowledgeBundleExportError | undefined;
  try {
    stagingDirectory = io.createPrivateDirectory(stagingPrefix);
    temporary = path.join(stagingDirectory, 'bundle.tmp');
    fd = io.openExclusive(temporary);
    ownsTemporary = true;
    io.write(fd, serializedBundle);
    io.sync(fd);

    // Keep the descriptor open and re-prove that the private pathname still
    // identifies its inode immediately before path-based publication.
    let ownedAtPublication: boolean;
    try {
      ownedAtPublication = io.pathOwnsOpenFile(fd, temporary);
    } catch (error) {
      ownershipLost = true;
      throw error;
    }
    if (!ownedAtPublication) {
      ownershipLost = true;
      throw new KnowledgeBundleExportError(
        'knowledge_bundle_write_failed',
        `Could not safely publish knowledge bundle to ${destination}.`,
        {
          destination,
          reason: 'staging pathname ownership changed before publication',
        }
      );
    }

    io.beforePublish(destination);
    if (options.authorization !== undefined) {
      verifyKnowledgeBundleStoreDirectory(options.authorization);
    }
    publicationAttempted = true;
    io.publishNewFile(temporary, destination);
    published = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      publicationAttempted &&
      (code === 'EEXIST' ||
        ((code === 'EACCES' || code === 'EPERM') && io.targetExists(destination)))
    ) {
      failure = destinationOccupied(destination);
    } else if (error instanceof KnowledgeBundleExportError) {
      failure = error;
    } else {
      failure = new KnowledgeBundleExportError(
        'knowledge_bundle_write_failed',
        `Could not write knowledge bundle to ${destination}.`,
        { destination, reason: error instanceof Error ? error.message : String(error) },
        { cause: error }
      );
    }
  } finally {
    let stagingEntryRemoved = false;
    if (
      ownsTemporary &&
      !ownershipLost &&
      fd !== undefined &&
      temporary !== undefined
    ) {
      let ownedAtCleanup = false;
      try {
        ownedAtCleanup = io.pathOwnsOpenFile(fd, temporary);
      } catch (error) {
        if (published) {
          cleanupDeferred = true;
        } else if (failure === undefined) {
          failure = new KnowledgeBundleExportError(
            'knowledge_bundle_write_failed',
            `Could not verify temporary knowledge bundle ownership for ${destination}.`,
            { destination, reason: error instanceof Error ? error.message : String(error) },
            { cause: error }
          );
        }
      }
      if (ownedAtCleanup) {
        try {
          removeOwnedTemporary(io, temporary);
          stagingEntryRemoved = true;
        } catch (error) {
          if (published) {
            cleanupDeferred = true;
          } else if (failure === undefined) {
            failure = new KnowledgeBundleExportError(
              'knowledge_bundle_write_failed',
              `Could not clean up the temporary knowledge bundle for ${destination}.`,
              { destination, reason: error instanceof Error ? error.message : String(error) },
              { cause: error }
            );
          }
        }
      } else if (published) {
        // The destination already links the descriptor-owned inode. A changed
        // private pathname is foreign and must not enter path cleanup.
        cleanupDeferred = true;
      } else if (failure === undefined) {
        failure = new KnowledgeBundleExportError(
          'knowledge_bundle_write_failed',
          `Could not safely clean up knowledge bundle staging for ${destination}.`,
          {
            destination,
            reason: 'staging pathname ownership changed before cleanup',
          }
        );
      }
    }
    if (fd !== undefined) {
      try {
        io.close(fd);
      } catch (error) {
        if (published) {
          cleanupDeferred = true;
        } else if (failure === undefined) {
          failure = new KnowledgeBundleExportError(
            'knowledge_bundle_write_failed',
            `Could not close knowledge bundle staging for ${destination}.`,
            { destination, reason: error instanceof Error ? error.message : String(error) },
            { cause: error }
          );
        }
      }
    }
    if (
      stagingDirectory !== undefined &&
      (stagingEntryRemoved || !ownsTemporary)
    ) {
      try {
        io.removeOwnedDirectory(stagingDirectory);
      } catch (error) {
        if (published) {
          cleanupDeferred = true;
        } else if (failure === undefined) {
          failure = new KnowledgeBundleExportError(
            'knowledge_bundle_write_failed',
            `Could not clean up knowledge bundle staging directory for ${destination}.`,
            { destination, reason: error instanceof Error ? error.message : String(error) },
            { cause: error }
          );
        }
      }
    }
  }
  if (failure !== undefined) throw failure;
  return cleanupDeferred ? ['staging_cleanup_deferred'] : [];
}

/**
 * Exports only project-owned canonical managed records. Every fallible read,
 * schema validation, relationship check, and machine-path assertion completes
 * before the external staging file is opened.
 */
export async function exportKnowledgeBundle(
  options: ExportKnowledgeBundleOptions
): Promise<KnowledgeBundleExportResult> {
  const dependencies = resolveDependencies(options.dependencies);
  const destination = resolveKnowledgeBundleDestination(options.to);

  // Any filesystem entry — file, directory, symlink, device — occupies --to.
  // Refuse before project/catalog/Git reads and before any temporary name.
  if (dependencies.io.targetExists(destination)) throw destinationOccupied(destination);

  let storeBinding: StoreBindingResolution | undefined;
  let resolvedStoreRoot: string | undefined;
  if (options.toStore !== undefined) {
    storeBinding = await dependencies.resolveStore(options.toStore);
    switch (storeBinding.kind) {
      case 'resolved':
        resolvedStoreRoot = dependencies.canonicalizeStoreRoot(
          storeBinding.store.root
        );
        if (pathIsInside(resolvedStoreRoot, destination)) {
          throw new KnowledgeBundleExportError(
            'knowledge_bundle_store_overlap',
            `The user export destination is inside selected Store ${storeBinding.store.id}.`,
            {
              selector: options.toStore,
              destination,
              storeRoot: resolvedStoreRoot,
            }
          );
        }
        break;
      case 'unavailable':
        {
          const repair =
            storeBinding.reason === 'alias-ambiguous'
              ? 'rasen store list --json'
              : primaryRepair(storeBinding);
        throw new KnowledgeBundleExportError(
          'knowledge_bundle_store_unavailable',
          storeBinding.diagnostics[0]?.message ??
            `Store ${options.toStore} is unavailable.`,
          {
            selector: options.toStore,
            reason: storeBinding.reason,
            diagnostic:
              storeBinding.diagnostics[0]?.message ??
              `Store ${options.toStore} is unavailable.`,
            repair,
          }
        );
        }
      case 'absent':
        throw new KnowledgeBundleExportError(
          'knowledge_bundle_store_unavailable',
          `Store ${options.toStore} did not resolve.`,
          {
            selector: options.toStore,
            reason: 'absent',
            diagnostic: `Store ${options.toStore} did not resolve.`,
            repair: 'rasen store list',
          }
        );
      default:
        assertNeverStoreBinding(storeBinding);
    }
  }

  const project = await dependencies.resolveProject(options.project);
  if (project === null) {
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_project_not_found',
      `Project selector did not resolve: ${options.project}`,
      { selector: options.project }
    );
  }

  const home = dependencies.resolveKnowledgeHome(project.ref.projectId);
  const projectId = home.projectId;
  const catalog = dependencies.readCatalog(home);
  if (catalog.unreadable.length > 0) {
    const unreadable = catalog.unreadable[0]!;
    throw new KnowledgeBundleExportError(
      'knowledge_bundle_record_unreadable',
      `Project record "${unreadable.id}" could not be read: ${unreadable.reason}`,
      { recordId: unreadable.id, reason: unreadable.reason }
    );
  }

  const baseProjectCommit = await dependencies.readBaseProjectCommit(project.root);
  const records = [...catalog.records]
    .sort((left, right) => left.identity.id.localeCompare(right.identity.id))
    .map((record) =>
      createKnowledgeBundleRecord({
        id: record.identity.id,
        knowledgeKey: record.manifest.knowledgeKey,
        contentDigest: record.manifest.contentDigest,
        manifest: record.manifest,
        content: record.content,
      })
    );
  const bundleId = dependencies.bundleId();
  const bundle = createKnowledgeBundle({
    bundleId,
    projectId,
    createdAt: dependencies.now().toISOString(),
    baseProjectCommit,
    records,
  });
  const serializedBundle = serializeKnowledgeBundle(bundle);

  let transport:
    | {
        storeRoot: string;
        destination: string;
        stagingPrefix: string;
        authorization: KnowledgeBundleStoreDirectoryAuthorization;
        result: KnowledgeBundleStoreTransportResult;
      }
    | undefined;
  if (storeBinding?.kind === 'resolved' && resolvedStoreRoot !== undefined) {
    const storeRoot = resolvedStoreRoot;
    const proposedTransportDestination = resolveKnowledgeBundleStoreDestination(
      storeRoot,
      projectId,
      bundleId
    );
    let transportDestination: string;
    try {
      const authorization = dependencies.ensureStoreDirectory(
        storeRoot,
        path.dirname(proposedTransportDestination)
      );
      transportDestination = path.join(
        authorization.canonicalDirectory,
        path.basename(proposedTransportDestination)
      );
      transport = {
        storeRoot,
        destination: transportDestination,
        stagingPrefix: resolveKnowledgeBundleStoreStagingDirectoryPrefix(
          storeRoot,
          bundleId
        ),
        authorization,
        result: {
          store: {
            id: storeBinding.store.id,
            ...(storeBinding.store.uid !== undefined
              ? { uid: storeBinding.store.uid }
              : {}),
          },
          destination: transportDestination,
          filesToCommit: [path.relative(storeRoot, transportDestination)],
        },
      };
    } catch (error) {
      throw new KnowledgeBundleExportError(
        'knowledge_bundle_store_write_failed',
        `Could not prepare Store transport destination ${proposedTransportDestination}.`,
        {
          selector: options.toStore!,
          destination: proposedTransportDestination,
          reason: error instanceof Error ? error.message : String(error),
          userDestination: destination,
          userDestinationPublished: 'false',
        },
        { cause: error }
      );
    }
  }

  const writeWarnings = writeBundleFile(
    destination,
    serializedBundle,
    dependencies.io,
    bundleId
  );
  if (transport !== undefined) {
    try {
      writeWarnings.push(
        ...writeBundleFile(
          transport.destination,
          serializedBundle,
          dependencies.io,
          bundleId,
          {
            stagingPrefix: transport.stagingPrefix,
            authorization: transport.authorization,
          }
        )
      );
    } catch (error) {
      const reason =
        error instanceof KnowledgeBundleExportError
          ? error.details.reason ?? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      if (
        error instanceof KnowledgeBundleExportError &&
        error.code === 'knowledge_bundle_destination_occupied'
      ) {
        throw new KnowledgeBundleExportError(
          'knowledge_bundle_store_write_failed',
          `Store transport destination is occupied: ${transport.destination}`,
          {
            selector: options.toStore!,
            destination: transport.destination,
            reason: 'destination occupied',
            userDestination: destination,
            userDestinationPublished: 'true',
          },
          { cause: error }
        );
      }
      if (error instanceof KnowledgeBundleExportError) {
        throw new KnowledgeBundleExportError(
          'knowledge_bundle_store_write_failed',
          error.message,
          {
            selector: options.toStore!,
            destination: transport.destination,
            reason,
            userDestination: destination,
            userDestinationPublished: 'true',
          },
          { cause: error }
        );
      }
      throw new KnowledgeBundleExportError(
        'knowledge_bundle_store_write_failed',
        `Could not place knowledge bundle in Store at ${transport.destination}.`,
        {
          selector: options.toStore!,
          destination: transport.destination,
          reason,
          userDestination: destination,
          userDestinationPublished: 'true',
        },
        { cause: error }
      );
    }
  }
  const warnings: KnowledgeBundleExportWarning[] = [];
  if (baseProjectCommit === null) warnings.push('base_project_commit_unavailable');
  warnings.push(...writeWarnings);

  return {
    projectId,
    recordCount: records.length,
    destination,
    warnings,
    bundle,
    ...(transport !== undefined ? { transport: transport.result } : {}),
  };
}
