/**
 * Shared migration core (change `store-migration-commands`): the copy →
 * verify → delete move engine, the adoption ownership manifest, the
 * case-insensitive name-collision precheck, and the git-safety renderers
 * shared by `store adopt`, `store eject`, and `archive relocate`.
 *
 * Every move is copy-then-delete (never `fs.rename`): a repo and a store may
 * live on different drives/filesystems (design D2 / spec "Adopt on Windows
 * and POSIX paths"), so a cross-device rename is never assumed. Deletion runs
 * only after verification passes, so an interruption between copy and delete
 * leaves duplicated-but-consistent state a rerun can resume.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { WORKSPACE_DIR_NAME } from '../config.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { pathIsDirectory, pathIsFile, writeFileAtomically } from '../file-state.js';
import { formatZodIssues } from '../zod-issues.js';
import { getStoreMetadataDir } from './foundation.js';
import { StoreError } from './errors.js';

const fs = nodeFs.promises;
const execFilePromise = promisify(execFile);
// Route every git spawn through here so `windowsHide` is always set — no
// console window flashes when a console-less parent runs a git probe
// (windows-process-launch spec; mirrors store/git.ts:24).
function execFileAsync(
  file: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFilePromise(file, args, { ...options, windowsHide: true });
}

// -----------------------------------------------------------------------------
// Planning-directory layout constants
// -----------------------------------------------------------------------------

export const SPECS_SUBDIR = 'specs';
export const CHANGES_SUBDIR = 'changes';
export const ARCHIVE_SUBDIR = 'archive';

/** Absolute `<root>/rasen`. */
export function planningDir(root: string): string {
  return path.join(root, WORKSPACE_DIR_NAME);
}

/** Absolute `<root>/rasen/specs`. */
export function specsDir(root: string): string {
  return path.join(planningDir(root), SPECS_SUBDIR);
}

/** Absolute `<root>/rasen/changes`. */
export function changesDir(root: string): string {
  return path.join(planningDir(root), CHANGES_SUBDIR);
}

/** Absolute `<root>/rasen/changes/archive`. */
export function inRepoArchiveDir(root: string): string {
  return path.join(changesDir(root), ARCHIVE_SUBDIR);
}

// -----------------------------------------------------------------------------
// Adoption ownership manifest (design D1)
// -----------------------------------------------------------------------------

export const ADOPTIONS_MANIFEST_FILE_NAME = 'adoptions.yaml';

export interface AdoptionEntry {
  /** Spec directory names adopted from the source into the store. */
  specs: string[];
  /** Active change directory names adopted from the source into the store. */
  changes: string[];
  /** Absolute source repo path at adoption time (portable record only). */
  sourcePath: string;
  /** ISO-8601 timestamp of the adoption. */
  timestamp: string;
}

export interface AdoptionsManifest {
  version: 1;
  /** Keyed by the adopted project's `projectId`. */
  adoptions: Record<string, AdoptionEntry>;
}

const AdoptionEntrySchema = z
  .object({
    specs: z.array(z.string()),
    changes: z.array(z.string()),
    sourcePath: z.string().min(1),
    timestamp: z.string().min(1),
  })
  .strict();

const AdoptionsManifestSchema = z
  .object({
    version: z.literal(1),
    adoptions: z.record(z.string(), AdoptionEntrySchema),
  })
  .strict();

function invalidManifestError(storeRoot: string, message: string): StoreError {
  return new StoreError(`Invalid adoption manifest: ${message}`, 'invalid_adoption_manifest', {
    target: 'store.metadata',
    fix: `Repair or remove ${getAdoptionsManifestPath(storeRoot)}.`,
  });
}

/** Absolute path of the store's `.rasen-store/adoptions.yaml`. */
export function getAdoptionsManifestPath(storeRoot: string): string {
  return path.join(getStoreMetadataDir(storeRoot), ADOPTIONS_MANIFEST_FILE_NAME);
}

/** Reads and validates the manifest, or null when absent. Throws on corruption. */
export async function readAdoptionsManifest(storeRoot: string): Promise<AdoptionsManifest | null> {
  const manifestPath = getAdoptionsManifestPath(storeRoot);
  if (!(await pathIsFile(manifestPath))) {
    return null;
  }

  let raw: unknown;
  try {
    raw = parseYaml(await fs.readFile(manifestPath, 'utf-8'));
  } catch (error) {
    throw invalidManifestError(storeRoot, error instanceof Error ? error.message : String(error));
  }

  const result = AdoptionsManifestSchema.safeParse(raw);
  if (!result.success) {
    throw invalidManifestError(storeRoot, formatZodIssues(result.error));
  }
  return { version: 1, adoptions: result.data.adoptions };
}

/** Reads a single project's adoption entry, or null when absent. */
export async function readAdoptionEntry(
  storeRoot: string,
  projectId: string
): Promise<AdoptionEntry | null> {
  const manifest = await readAdoptionsManifest(storeRoot);
  return manifest?.adoptions[projectId] ?? null;
}

async function writeAdoptionsManifest(
  storeRoot: string,
  manifest: AdoptionsManifest
): Promise<void> {
  const result = AdoptionsManifestSchema.safeParse(manifest);
  if (!result.success) {
    throw invalidManifestError(storeRoot, formatZodIssues(result.error));
  }
  await FileSystemUtils.createDirectory(getStoreMetadataDir(storeRoot));
  await writeFileAtomically(
    getAdoptionsManifestPath(storeRoot),
    stringifyYaml({ version: 1, adoptions: result.data.adoptions })
  );
}

/** Inserts or replaces a project's adoption entry, preserving other entries. */
export async function upsertAdoptionEntry(
  storeRoot: string,
  projectId: string,
  entry: AdoptionEntry
): Promise<void> {
  const manifest = (await readAdoptionsManifest(storeRoot)) ?? { version: 1, adoptions: {} };
  manifest.adoptions[projectId] = entry;
  await writeAdoptionsManifest(storeRoot, manifest);
}

/** Removes a project's adoption entry. No-op when absent. */
export async function removeAdoptionEntry(storeRoot: string, projectId: string): Promise<void> {
  const manifest = await readAdoptionsManifest(storeRoot);
  if (!manifest || !(projectId in manifest.adoptions)) {
    return;
  }
  delete manifest.adoptions[projectId];
  await writeAdoptionsManifest(storeRoot, manifest);
}

// -----------------------------------------------------------------------------
// Directory enumeration + case-insensitive collision precheck (design D1, 1.3)
// -----------------------------------------------------------------------------

/** Immediate subdirectory names of `dir` (sorted), or [] when `dir` is absent. */
export async function listSubdirectoryNames(dir: string): Promise<string[]> {
  let entries: nodeFs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Active (non-archive) change directory names under `<root>/rasen/changes`.
 * The `archive` subdirectory is excluded — it is handled on its own axis.
 */
export async function listActiveChangeNames(root: string): Promise<string[]> {
  return (await listSubdirectoryNames(changesDir(root))).filter((name) => name !== ARCHIVE_SUBDIR);
}

/** Spec directory names under `<root>/rasen/specs`. */
export async function listSpecNames(root: string): Promise<string[]> {
  return listSubdirectoryNames(specsDir(root));
}

/**
 * Names in `incoming` whose lowercased form already exists in `existing`.
 * Case-insensitive on ALL platforms (design risk): a case-only "non-collision"
 * would corrupt on a case-insensitive filesystem (Windows/macOS).
 */
export function caseInsensitiveCollisions(incoming: string[], existing: string[]): string[] {
  const existingLower = new Set(existing.map((name) => name.toLowerCase()));
  return incoming.filter((name) => existingLower.has(name.toLowerCase()));
}

// -----------------------------------------------------------------------------
// Copy → verify → delete move engine (design D2, 1.2)
// -----------------------------------------------------------------------------

interface FileFact {
  /** Path relative to the tree root, POSIX-normalized for portable compare. */
  relativePath: string;
  size: number;
}

/** Recursively lists every file under `root` with its size (relative paths). */
async function listTreeFiles(root: string): Promise<FileFact[]> {
  const facts: FileFact[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const stat = await fs.stat(abs);
        facts.push({
          relativePath: FileSystemUtils.toPosixPath(path.relative(root, abs)),
          size: stat.size,
        });
      }
    }
  }

  if (!(await pathIsDirectory(root))) {
    return facts;
  }
  await walk(root);
  return facts;
}

async function sha256(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

/** Recursively copies `src` into `dest` (creating `dest`), preserving structure. */
export async function copyTree(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export interface VerifyTreeResult {
  ok: boolean;
  /** Human-readable reasons the verify failed (empty when ok). */
  problems: string[];
}

/**
 * Verifies `dest` faithfully reproduces `src`: identical file set and, per
 * file, matching size (and sha256 when `verifyHash` is set). No hashing by
 * default (design D2) — size + count catches truncated/partial copies at near
 * zero cost; `--verify-hash` opts into full content comparison.
 */
export async function verifyTree(
  src: string,
  dest: string,
  options: { verifyHash?: boolean } = {}
): Promise<VerifyTreeResult> {
  const [srcFiles, destFiles] = await Promise.all([listTreeFiles(src), listTreeFiles(dest)]);
  const problems: string[] = [];

  const destByPath = new Map(destFiles.map((f) => [f.relativePath, f]));
  for (const srcFile of srcFiles) {
    const destFile = destByPath.get(srcFile.relativePath);
    if (!destFile) {
      problems.push(`missing in copy: ${srcFile.relativePath}`);
      continue;
    }
    if (destFile.size !== srcFile.size) {
      problems.push(
        `size mismatch: ${srcFile.relativePath} (source ${srcFile.size}, copy ${destFile.size})`
      );
      continue;
    }
    if (options.verifyHash) {
      const [srcHash, destHash] = await Promise.all([
        sha256(path.join(src, srcFile.relativePath)),
        sha256(path.join(dest, srcFile.relativePath)),
      ]);
      if (srcHash !== destHash) {
        problems.push(`content mismatch: ${srcFile.relativePath}`);
      }
    }
  }

  if (destFiles.length !== srcFiles.length) {
    problems.push(`file count mismatch: source ${srcFiles.length}, copy ${destFiles.length}`);
  }

  return { ok: problems.length === 0, problems };
}

/** Recursively deletes `target`. No-op when absent. */
export async function deleteTree(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

/**
 * Moves a single directory `src` -> `dest` via copy → verify → delete. Throws
 * a `StoreError` when verification fails (leaving the source intact — the
 * deletion never runs). Cross-device safe (no `fs.rename`).
 */
export async function moveTreeVerified(
  src: string,
  dest: string,
  options: { verifyHash?: boolean } = {}
): Promise<void> {
  await copyTree(src, dest);
  const verify = await verifyTree(src, dest, options);
  if (!verify.ok) {
    throw new StoreError(
      `Copy verification failed for ${src} -> ${dest}: ${verify.problems.join('; ')}`,
      'migration_verify_failed',
      {
        target: 'store.root',
        fix: 'The source was left intact; rerun after resolving the disk/permission problem.',
      }
    );
  }
  await deleteTree(src);
}

// -----------------------------------------------------------------------------
// Git safety: uncommitted detection + suggested-commit renderer (1.4)
// -----------------------------------------------------------------------------

/**
 * Paths (relative to `repoRoot`) inside `scopes` that git reports as
 * uncommitted, untracked, or ignored-but-present. Returns [] when git is
 * unavailable or `repoRoot` is not a repository — this feeds a warning, never
 * a hard gate, so a non-git source degrades to "cannot flag" rather than
 * failing the operation.
 */
export async function detectUncommittedPaths(
  repoRoot: string,
  scopes: string[]
): Promise<string[]> {
  if (scopes.length === 0) return [];
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      repoRoot,
      'status',
      '--porcelain',
      '--ignored',
      '--',
      ...scopes,
    ]);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Porcelain lines are `XY <path>`; keep the path portion. Rename lines
      // read `orig -> new`; keep the new path (where the content now lives).
      .map((line) => {
        const stripped = line.replace(/^..\s+/, '');
        const renamed = stripped.split(' -> ');
        const pathPart = renamed.length > 1 ? renamed[renamed.length - 1] : stripped;
        return pathPart.replace(/^"(.*)"$/, '$1');
      });
  } catch {
    return [];
  }
}

export interface SuggestedGitCommand {
  /** Absolute repo root the command should run in. */
  repoRoot: string;
  /** The full, copy-pasteable command (never executed by Rasen). */
  command: string;
  /** One-line description of what the command records. */
  purpose: string;
}

/**
 * Quotes a pathspec for a shell when it contains whitespace or a double quote,
 * escaping any embedded double quotes so the rendered (never-executed) command
 * stays pasteable even for exotic paths.
 */
function shellQuote(value: string): string {
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Renders a suggested, pathspec-scoped `git add … && git commit` command
 * (design D2, spec "git-safe"). Never executed — migration never writes the
 * git index. Returns null when `pathspecs` is empty (nothing to suggest).
 */
export function renderSuggestedCommit(
  repoRoot: string,
  pathspecs: string[],
  message: string,
  purpose: string
): SuggestedGitCommand | null {
  if (pathspecs.length === 0) return null;
  const specs = pathspecs.map(shellQuote).join(' ');
  return {
    repoRoot,
    command: `git -C ${shellQuote(repoRoot)} add ${specs} && git -C ${shellQuote(repoRoot)} commit -m ${shellQuote(message)}`,
    purpose,
  };
}
