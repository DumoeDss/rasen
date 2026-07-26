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

export interface KnowledgeBundleExportResult {
  projectId: string;
  recordCount: number;
  destination: string;
  warnings: KnowledgeBundleExportWarning[];
  bundle: KnowledgeBundle;
}

export type KnowledgeBundleExportErrorCode =
  | 'knowledge_bundle_project_not_found'
  | 'knowledge_bundle_destination_occupied'
  | 'knowledge_bundle_record_unreadable'
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
  publishNewFile: (temporary: string, destination: string) => void;
  removeOwnedFile: (target: string) => void;
  removeOwnedDirectory: (target: string) => void;
  sameFileSystem: (leftDirectory: string, rightDirectory: string) => boolean;
}

export interface KnowledgeBundleExportDependencies {
  resolveProject: (selector: string) => Promise<ResolvedProject | null>;
  resolveKnowledgeHome: (projectId: string) => ProjectKnowledgeHome;
  readCatalog: (home: ProjectKnowledgeHome) => StoreCatalogRead;
  readBaseProjectCommit: (root: string) => Promise<string | null>;
  bundleId: () => string;
  now: () => Date;
  io: KnowledgeBundleExportIo;
}

export interface ExportKnowledgeBundleOptions {
  project: string;
  to: string;
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
  resolveKnowledgeHome: resolveProjectKnowledgeHome,
  readCatalog: projectCatalog,
  readBaseProjectCommit: gitHeadCommit,
  bundleId: randomUUID,
  now: () => new Date(),
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

function writeBundleFile(
  destination: string,
  bundle: KnowledgeBundle,
  io: KnowledgeBundleExportIo,
  bundleId: string
): KnowledgeBundleExportWarning[] {
  if (io.targetExists(destination)) throw destinationOccupied(destination);

  const stagingPrefix = resolveKnowledgeBundleStagingDirectoryPrefix(
    destination,
    bundleId
  );
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
    io.write(fd, `${JSON.stringify(bundle, null, 2)}\n`);
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

  const writeWarnings = writeBundleFile(
    destination,
    bundle,
    dependencies.io,
    bundleId
  );
  const warnings: KnowledgeBundleExportWarning[] = [];
  if (baseProjectCommit === null) warnings.push('base_project_commit_unavailable');
  warnings.push(...writeWarnings);

  return {
    projectId,
    recordCount: records.length,
    destination,
    warnings,
    bundle,
  };
}
