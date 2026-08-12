/**
 * The migration Module's ONE source-side reader for a legacy flat Store.
 *
 * Layout v2 has no writable flat Store namespace, so nothing else in this
 * Module may address `rasen/specs`, `rasen/changes`, or `rasen/changes/archive`
 * against a Store root. Everything the Module reads out of the old layout is
 * enumerated here, and the bounded source guard in
 * `test/core/store-planning/planning-path-source-guard.test.ts` asserts that
 * this file and the frozen legacy adapter are the only Store-root callers of
 * the flat path helpers.
 *
 * This file reads. It never writes, moves, or removes anything.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../../config.js';
import { getStoreMetadataDir } from '../foundation.js';
import {
  ADOPTIONS_MANIFEST_FILE_NAME,
  ARCHIVE_SUBDIR,
  changesDir,
  inRepoArchiveDir,
  specsDir,
} from '../migration.js';
import { STORE_PROJECT_RECORDS_DIR_NAME } from '../project-records.js';
import type { LayoutMigrationFileSystem } from './dependencies.js';

export const FLAT_DESIGN_DOCS_SUBDIR = 'design-docs';

export interface FlatStorePaths {
  readonly storeRoot: string;
  readonly planning: string;
  readonly specs: string;
  readonly changes: string;
  readonly archive: string;
  readonly designDocs: string;
  readonly storeMetadata: string;
  readonly projectRecords: string;
  readonly adoptionsManifest: string;
}

/** Every flat address the Module reads, computed once from the Store root. */
export function flatStorePaths(candidateStoreRoot: string): FlatStorePaths {
  const storeRoot = path.resolve(candidateStoreRoot);
  const metadataDir = getStoreMetadataDir(storeRoot);
  return Object.freeze({
    storeRoot,
    planning: path.join(storeRoot, WORKSPACE_DIR_NAME),
    specs: specsDir(storeRoot),
    changes: changesDir(storeRoot),
    archive: inRepoArchiveDir(storeRoot),
    // Spelled with the literal segment on purpose: the bounded source guard's
    // direct-join census must see this file. The helper census beside it is
    // argument-blind, so these three no longer depend on what the local is
    // called.
    designDocs: path.join(storeRoot, WORKSPACE_DIR_NAME, 'design-docs'),
    storeMetadata: path.join(metadataDir, 'store.yaml'),
    projectRecords: path.join(metadataDir, STORE_PROJECT_RECORDS_DIR_NAME),
    adoptionsManifest: path.join(metadataDir, ADOPTIONS_MANIFEST_FILE_NAME),
  });
}

/** Store-relative POSIX form of the flat collections, for blob reads and messages. */
export const FLAT_RELATIVE = Object.freeze({
  planning: `${WORKSPACE_DIR_NAME}`,
  specs: `${WORKSPACE_DIR_NAME}/specs`,
  changes: `${WORKSPACE_DIR_NAME}/changes`,
  archive: `${WORKSPACE_DIR_NAME}/changes/${ARCHIVE_SUBDIR}`,
  designDocs: `${WORKSPACE_DIR_NAME}/${FLAT_DESIGN_DOCS_SUBDIR}`,
  storeMetadata: '.rasen-store/store.yaml',
  projectRecords: '.rasen-store/projects',
  adoptionsManifest: '.rasen-store/adoptions.yaml',
});

/** Store-relative POSIX path, so receipts and messages never leak a machine path. */
export function storeRelative(storeRoot: string, target: string): string {
  const relative = path.relative(path.resolve(storeRoot), path.resolve(target));
  return relative.split(path.sep).join('/');
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface TreeFileDigest {
  /** POSIX path relative to the tree root. */
  readonly relative: string;
  readonly digest: string;
  readonly bytes: number;
}

export interface TreeDigest {
  readonly digest: string;
  readonly files: readonly TreeFileDigest[];
}

/**
 * Content address of a file or directory. A directory digests the sorted
 * `<relative>\0<sha256>` pairs of every regular file below it, so a rename, an
 * added file, and a byte edit all move the digest, while directory mtimes and
 * enumeration order do not.
 */
export async function digestTree(
  fsAdapter: LayoutMigrationFileSystem,
  target: string
): Promise<TreeDigest> {
  const kind = await fsAdapter.statKind(target);
  if (kind === 'file') {
    const bytes = (await fsAdapter.readBytes(target)) ?? Buffer.alloc(0);
    const digest = sha256Hex(bytes);
    return {
      digest: sha256Hex(`file\0${digest}`),
      files: [{ relative: '', digest, bytes: bytes.length }],
    };
  }
  if (kind !== 'directory') {
    const link = kind === 'other' ? await fsAdapter.readLink(target) : null;
    return {
      digest: sha256Hex(`${kind}\0${link ?? ''}`),
      files:
        link === null
          ? []
          : [{ relative: '', digest: sha256Hex(`link\0${link}`), bytes: Buffer.byteLength(link) }],
    };
  }

  const files: TreeFileDigest[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await fsAdapter.listEntries(current)) {
      const child = path.join(current, entry.name);
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.kind === 'directory') {
        await walk(child, relative);
      } else if (entry.kind === 'file') {
        const bytes = (await fsAdapter.readBytes(child)) ?? Buffer.alloc(0);
        files.push({ relative, digest: sha256Hex(bytes), bytes: bytes.length });
      } else {
        const link = await fsAdapter.readLink(child);
        if (link !== null) {
          files.push({
            relative,
            digest: sha256Hex(`link\0${link}`),
            bytes: Buffer.byteLength(link),
          });
        }
      }
    }
  };
  await walk(target, '');
  files.sort((left, right) => left.relative.localeCompare(right.relative));

  const hash = createHash('sha256');
  hash.update('dir\0');
  for (const file of files) {
    hash.update(`${file.relative}\0${file.digest}\0`);
  }
  return { digest: hash.digest('hex'), files };
}

/** Immediate subdirectory names, sorted. Never throws on an absent directory. */
export async function listDirectoryNames(
  fsAdapter: LayoutMigrationFileSystem,
  target: string
): Promise<readonly string[]> {
  return (await fsAdapter.listEntries(target))
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => entry.name);
}

/** Immediate file names, sorted. Never throws on an absent directory. */
export async function listFileNames(
  fsAdapter: LayoutMigrationFileSystem,
  target: string
): Promise<readonly string[]> {
  return (await fsAdapter.listEntries(target))
    .filter((entry) => entry.kind === 'file')
    .map((entry) => entry.name);
}

/**
 * Active Change directory names: every immediate subdirectory of the flat
 * `rasen/changes` except the `archive` directory, which is a collection.
 */
export async function listFlatActiveChangeNames(
  fsAdapter: LayoutMigrationFileSystem,
  storeRoot: string
): Promise<readonly string[]> {
  const paths = flatStorePaths(storeRoot);
  return (await listDirectoryNames(fsAdapter, paths.changes)).filter(
    (name) => name !== ARCHIVE_SUBDIR
  );
}

export async function listFlatSpecNames(
  fsAdapter: LayoutMigrationFileSystem,
  storeRoot: string
): Promise<readonly string[]> {
  return listDirectoryNames(fsAdapter, flatStorePaths(storeRoot).specs);
}

export async function listFlatArchiveEntryNames(
  fsAdapter: LayoutMigrationFileSystem,
  storeRoot: string
): Promise<readonly string[]> {
  return listDirectoryNames(fsAdapter, flatStorePaths(storeRoot).archive);
}

export async function listFlatDesignDocNames(
  fsAdapter: LayoutMigrationFileSystem,
  storeRoot: string
): Promise<readonly string[]> {
  return listFileNames(fsAdapter, flatStorePaths(storeRoot).designDocs);
}
