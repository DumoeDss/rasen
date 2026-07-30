/**
 * Ephemera cleaner (design `file-placement-collapse-archive`, D2).
 *
 * The portfolio's ONLY destructive operation. It deletes only files whose
 * names match a known whitelist of regenerable ephemera, preserves every
 * unknown entry byte-for-byte, and NEVER recurses into directories.
 *
 * Discipline (from `docs/zh/file-placement-and-planning-roots.md` 清理纪律):
 * - Whitelist-by-filename delete — never discretionary.
 * - Unknown / future-version / malformed / nested entries are preserved
 *   byte-for-byte with their exact paths reported.
 * - Source-manifest discovery aborts the change's clean entirely (probes were
 *   misclassified).
 * - Never recursively delete the ephemera directory or any part of machine
 *   root.
 *
 * Layering:
 * - `classifyEphemera` (task 1.1 + 1.3): pure classification — reads the
 *   directory, returns what would be discarded / preserved / aborted. Touches
 *   nothing.
 * - `applyEphemeraDeletion` (task 1.2): the ONLY destructive function. Takes
 *   the classification result and performs the whitelisted deletions. Shall
 *   not delete preserved files, shall not recurse.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Run-state filenames that are safe to delete (regenerable by re-running the
 * pipeline). These are exact top-level filename matches.
 */
const RUN_STATE_FILENAMES = new Set([
  'auto-run.json',
  'portfolio-run.json',
  'goal-run.json',
]);

/**
 * Control-state filenames: change-level signal/lock/heartbeat files and
 * worker/expert selection state. Exact top-level filename matches.
 */
const CONTROL_STATE_FILENAMES = new Set([
  '.signal',
  '.lock',
  '.heartbeat',
  'expert-selection-explicit.json',
]);

/**
 * Source manifests whose presence at the ephemera directory's top level
 * signals that probes were misclassified. Discovering any of these aborts the
 * change's clean — nothing is deleted.
 */
const SOURCE_MANIFEST_FILENAMES = new Set([
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'build.rs',
  'rust-toolchain.toml',
]);

/** Glob-style patterns for regenerable raw material at the top level only. */
const RAW_LOG_PATTERN = /\.log$/i;
const RAW_JSON_PATTERN = /^raw-.*\.json$/i;
const BENCHMARK_PATTERN = /^benchmark-.*\.json$/i;

/**
 * Checks whether a top-level filename matches the deletion whitelist.
 * Order: exact run-state → exact control-state → pattern-based raw material.
 */
function isWhitelisted(name: string): boolean {
  if (RUN_STATE_FILENAMES.has(name)) return true;
  if (CONTROL_STATE_FILENAMES.has(name)) return true;
  if (RAW_LOG_PATTERN.test(name)) return true;
  if (RAW_JSON_PATTERN.test(name)) return true;
  if (BENCHMARK_PATTERN.test(name)) return true;
  return false;
}

export interface EphemeraClassification {
  /**
   * Whitelisted files that would be / were deleted, as paths relative to the
   * ephemera directory (filenames for top-level entries).
   */
  discarded: string[];
  /**
   * Unknown files and directories preserved byte-for-byte, as paths relative
   * to the ephemera directory. Each entry's exact path is reported for human
   * judgment.
   */
  preserved: string[];
  /**
   * True when a source manifest was discovered at the ephemera directory's
   * top level — the clean is aborted and no file is deleted for that change.
   */
  aborted: boolean;
  /**
   * The discovered source manifest path (relative to the ephemera directory)
   * that triggered the abort. Present only when `aborted` is true.
   */
  abortReason?: string;
}

async function safeReaddir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * PURE classification pass (tasks 1.1 + 1.3). Reads the ephemera directory and
 * returns what would be discarded, what would be preserved, and whether a
 * source-manifest discovery aborts the clean. Touches nothing on disk.
 *
 * Non-recursively scans the ephemera directory's TOP LEVEL only — nested
 * directories are preserved by construction (reported, never entered). An empty
 * or nonexistent ephemera directory is a no-op: `{ discarded: [], preserved: [],
 * aborted: false }`.
 */
export async function classifyEphemera(ephemeraDir: string): Promise<EphemeraClassification> {
  const entries = await safeReaddir(ephemeraDir);

  if (entries.length === 0) {
    return { discarded: [], preserved: [], aborted: false };
  }

  // Source-manifest detection (task 1.3): scan for manifests FIRST. If any are
  // found at the top level, abort the entire change's clean — probes were
  // misclassified, and the matter is handed to the user.
  for (const entry of entries) {
    if (!entry.isDirectory() && SOURCE_MANIFEST_FILENAMES.has(entry.name)) {
      return {
        discarded: [],
        preserved: [],
        aborted: true,
        abortReason: entry.name,
      };
    }
  }

  const discarded: string[] = [];
  const preserved: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Nested directory entries are ALWAYS preserved — never recursed into.
      preserved.push(entry.name);
      continue;
    }
    if (!entry.isFile()) {
      // Symlinks, sockets, etc. — preserve, do not touch.
      preserved.push(entry.name);
      continue;
    }

    const name = entry.name;
    if (isWhitelisted(name)) {
      discarded.push(name);
    } else {
      preserved.push(name);
    }
  }

  // Sort for deterministic output (stable across runs and platforms).
  discarded.sort();
  preserved.sort();

  return { discarded, preserved, aborted: false };
}

/**
 * The ONLY destructive function (task 1.2). Takes a classification result and
 * the ephemera directory, and performs the whitelisted deletions. Shall not
 * delete preserved files, shall not recurse into directories, and shall not
 * delete anything when the classification was aborted.
 *
 * Returns the list of files actually deleted (relative paths). A file that was
 * classified for deletion but vanished between classification and deletion
 * (race) is silently skipped — it is already gone.
 */
export async function applyEphemeraDeletion(
  ephemeraDir: string,
  classification: EphemeraClassification
): Promise<string[]> {
  if (classification.aborted) {
    return [];
  }

  const deleted: string[] = [];
  for (const relativePath of classification.discarded) {
    const target = path.join(ephemeraDir, relativePath);
    try {
      await fs.rm(target, { force: false });
      deleted.push(relativePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // Already gone — not an error, just nothing to delete.
        continue;
      }
      // EPERM/EBUSY etc. surface as a real error so the caller can decide
      // whether to retry or report. We never swallow a write-side failure.
      throw error;
    }
  }
  return deleted;
}

/**
 * Convenience: classify, then delete (unless `dryRun`). Returns the
 * classification and the list of files actually deleted (empty in dry-run or
 * when aborted). This is the seam `rasen archive` calls.
 */
export async function cleanEphemera(
  ephemeraDir: string,
  options: { dryRun?: boolean } = {}
): Promise<{ classification: EphemeraClassification; deleted: string[] }> {
  const classification = await classifyEphemera(ephemeraDir);
  if (options.dryRun || classification.aborted) {
    return { classification, deleted: [] };
  }
  const deleted = await applyEphemeraDeletion(ephemeraDir, classification);
  return { classification, deleted };
}

/**
 * Content hash of a directory tree (recursively), used by the dry-run
 * byte-identical verification (task 1.5). Returns a single sha256 hex digest
 * combining every file's relative path and content. Two calls returning the
 * same digest guarantees the tree is byte-identical.
 */
export async function hashDirectoryTree(dir: string): Promise<string> {
  const hash = createHash('sha256');

  async function walkSorted(d: string, prefix: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(rel);
      hash.update('\0');
      if (entry.isDirectory()) {
        await walkSorted(path.join(d, entry.name), rel);
      } else if (entry.isFile()) {
        const content = await fs.readFile(path.join(d, entry.name));
        hash.update(content);
        hash.update('\0');
      }
    }
  }

  await walkSorted(dir, '');
  return hash.digest('hex');
}
