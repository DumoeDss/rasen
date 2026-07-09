/**
 * Copy-only migration of a legacy `openspec/` workspace into `rasen/`.
 *
 * Contract (mirrors global-config.ts `migrateLegacyBrandConfig`):
 * - Recursively COPY `openspec/{specs,changes,config.yaml,config.yml}` into
 *   `rasen/`. The source is never modified, moved, or deleted.
 * - Files that already exist at the destination are skipped, never overwritten
 *   (idempotent: a re-run only fills in what is missing).
 * - An individual file failure never aborts the migration; failures are
 *   collected and reported in the summary.
 * - Every path is built with path.join for cross-platform correctness.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { LEGACY_WORKSPACE_DIR_NAME, WORKSPACE_DIR_NAME } from './config.js';

export interface WorkspaceMigrationSummary {
  /** The legacy `openspec/` directory that was read (source). */
  legacyDir: string;
  /** The `rasen/` directory that was written (destination). */
  workspaceDir: string;
  /** Relative paths (POSIX form) of files copied this run. */
  copied: string[];
  /** Relative paths of files skipped because the destination already existed. */
  skipped: string[];
  /** Files that could not be copied, with the error message. */
  failed: Array<{ path: string; error: string }>;
  /** True when the legacy `openspec/` directory did not exist. */
  legacyMissing: boolean;
}

/** Top-level entries copied from the legacy workspace. */
const MIGRATION_ENTRIES = ['specs', 'changes', 'config.yaml', 'config.yml'] as const;

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * Recursively copies `src` into `dest`, skipping any destination file that
 * already exists. Records outcomes in the summary keyed by path relative to
 * `workspaceDir` for readable reporting.
 */
function copyRecursiveSkipExisting(
  src: string,
  dest: string,
  workspaceDir: string,
  summary: WorkspaceMigrationSummary
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(src);
  } catch (error) {
    summary.failed.push({
      path: path.relative(workspaceDir, dest).split(path.sep).join('/'),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (stat.isDirectory()) {
    try {
      fs.mkdirSync(dest, { recursive: true });
    } catch (error) {
      summary.failed.push({
        path: path.relative(workspaceDir, dest).split(path.sep).join('/'),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(src);
    } catch (error) {
      summary.failed.push({
        path: path.relative(workspaceDir, dest).split(path.sep).join('/'),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const entry of entries) {
      copyRecursiveSkipExisting(
        path.join(src, entry),
        path.join(dest, entry),
        workspaceDir,
        summary
      );
    }
    return;
  }

  // Regular file.
  const relative = path.relative(workspaceDir, dest).split(path.sep).join('/');
  if (fs.existsSync(dest)) {
    summary.skipped.push(relative);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    summary.copied.push(relative);
  } catch (error) {
    summary.failed.push({
      path: relative,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Migrates the legacy `openspec/` workspace at `projectRoot` into `rasen/`.
 * Copy-only, skip-existing, per-file-failure tolerant, idempotent.
 */
export function migrateWorkspace(projectRoot: string): WorkspaceMigrationSummary {
  const legacyDir = path.join(projectRoot, LEGACY_WORKSPACE_DIR_NAME);
  const workspaceDir = path.join(projectRoot, WORKSPACE_DIR_NAME);

  const summary: WorkspaceMigrationSummary = {
    legacyDir,
    workspaceDir,
    copied: [],
    skipped: [],
    failed: [],
    legacyMissing: false,
  };

  if (!isDirectory(legacyDir)) {
    summary.legacyMissing = true;
    return summary;
  }

  fs.mkdirSync(workspaceDir, { recursive: true });

  for (const entry of MIGRATION_ENTRIES) {
    const src = path.join(legacyDir, entry);
    if (isDirectory(src) || isFile(src)) {
      copyRecursiveSkipExisting(
        src,
        path.join(workspaceDir, entry),
        workspaceDir,
        summary
      );
    }
  }

  return summary;
}

/** Whether a legacy `openspec/` workspace exists at `projectRoot`. */
export function hasLegacyWorkspace(projectRoot: string): boolean {
  return isDirectory(path.join(projectRoot, LEGACY_WORKSPACE_DIR_NAME));
}

/** Whether a `rasen/` workspace already exists at `projectRoot`. */
export function hasRasenWorkspace(projectRoot: string): boolean {
  return isDirectory(path.join(projectRoot, WORKSPACE_DIR_NAME));
}

/** Human-readable one-line report of a migration outcome. */
export function formatMigrationSummary(summary: WorkspaceMigrationSummary): string {
  if (summary.legacyMissing) {
    return `No legacy ${LEGACY_WORKSPACE_DIR_NAME}/ workspace found at ${summary.legacyDir}; nothing to migrate.`;
  }
  const lines = [
    `Migrated ${LEGACY_WORKSPACE_DIR_NAME}/ → ${WORKSPACE_DIR_NAME}/ (copy-only; ${LEGACY_WORKSPACE_DIR_NAME}/ left untouched).`,
    `  copied:  ${summary.copied.length}`,
    `  skipped: ${summary.skipped.length} (already present in ${WORKSPACE_DIR_NAME}/)`,
  ];
  if (summary.failed.length > 0) {
    lines.push(`  failed:  ${summary.failed.length}`);
    for (const failure of summary.failed) {
      lines.push(`    - ${failure.path}: ${failure.error}`);
    }
  }
  return lines.join('\n');
}
