/**
 * Multi-project update enumeration and execution (project-install-manifest
 * spec). Reads the machine-wide project registry to find other registered
 * projects whose cached `installedVersion` is behind the current CLI version
 * (or unknown), and drives a serial update of the chosen subset.
 *
 * The enumeration is read-only and best-effort; the execution catches
 * per-project errors and continues with the remaining candidates. A failed
 * project never aborts the batch.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readProjectRegistryState, resolveRegistrationRoot, type ProjectRegistryEntryState } from './project-registry.js';
import { readProjectConfig } from './project-config.js';

/**
 * A registered project whose cached version is behind the current CLI
 * version (or whose version is unknown), making it a candidate for the
 * multi-project update offer.
 */
export interface BehindProject {
  /** Canonical registered path of the project. */
  projectRoot: string;
  /** Display name (kebab-cased basename at registration). */
  name: string;
  /** Cached `installedVersion`, or undefined when unknown. */
  cachedVersion?: string;
  /** ISO-8601 timestamp of the most recent cache refresh. */
  lastUpdated?: string;
  /** True when the project is pinned via `update.pin: true`. */
  pinned: boolean;
}

/**
 * Per-project result from {@link updateMultipleProjects}.
 */
export interface PerProjectResult {
  projectRoot: string;
  name: string;
  status: 'updated' | 'skipped-missing' | 'skipped-pinned' | 'skipped-current' | 'failed';
  error?: string;
}

/**
 * Enumerates the projects in the machine-wide registry that are behind the
 * current CLI version, excluding the current project, missing directories,
 * pinned projects, and entries already at the current version.
 *
 * "Behind" means: the cached `installedVersion` differs from
 * `currentVersion`, OR is absent (version unknown — eligible by default).
 * Entries whose cached version EQUALS `currentVersion` are excluded.
 *
 * Read-only and best-effort: a registry read failure returns an empty list
 * (the caller's update of the current project already succeeded).
 */
export async function enumerateBehindProjects(
  currentProjectRoot: string,
  currentVersion: string,
  options: { globalDataDir?: string } = {}
): Promise<BehindProject[]> {
  const state = await readProjectRegistryState(
    options.globalDataDir !== undefined ? { globalDataDir: options.globalDataDir } : {}
  );
  if (!state) return [];

  // Pierce the current root onto the main checkout so a run inside a linked
  // worktree excludes the main checkout's own entry (the registry key for the
  // current project when running in a worktree is the MAIN checkout's path).
  const canonicalCurrent = await resolveRegistrationRoot(path.resolve(currentProjectRoot));

  const behind: BehindProject[] = [];
  for (const [projectRoot, entry] of Object.entries(state.projects)) {
    // Exclude the current project (path-exact AND pierced-root). The registry
    // key is already canonical, but `path.resolve` normalizes for comparison.
    if (path.resolve(projectRoot) === canonicalCurrent) continue;

    // Exclude missing directories.
    if (!fs.existsSync(projectRoot)) continue;

    // Read this project's config to check pinning.
    let pinned = false;
    try {
      const config = readProjectConfig(projectRoot);
      if (config?.update?.pin === true) pinned = true;
    } catch {
      // Unreadable config: not pinned (still eligible).
    }

    if (pinned) continue;

    // Exclude entries whose cached version equals currentVersion.
    if (entry.installedVersion === currentVersion) continue;

    behind.push({
      projectRoot,
      name: entry.name,
      cachedVersion: entry.installedVersion,
      lastUpdated: entry.lastUpdated,
      pinned,
    });
  }
  return behind;
}

/**
 * Updates a list of projects serially. Per-project failures are caught and
 * recorded; the batch continues. Missing directories and pinned projects
 * (defensively, even when enumeration already excluded them) are skipped
 * with a summary status.
 *
 * The per-project refresh delegates to a fresh `UpdateCommand` instance
 * scoped with `onlyThis: true` so the targeted project's own manifest
 * governs and no recursive multi-project offer is made.
 */
export async function updateMultipleProjects(
  projects: readonly BehindProject[],
  options: { force?: boolean } = {}
): Promise<PerProjectResult[]> {
  // Deferred import avoids a load-time cycle: update.ts imports this module
  // for enumeration/summary formatting at its top level via a dynamic
  // import, and this module imports UpdateCommand.
  const { UpdateCommand } = await import('./update.js');

  const results: PerProjectResult[] = [];
  for (const project of projects) {
    if (!fs.existsSync(project.projectRoot)) {
      results.push({
        projectRoot: project.projectRoot,
        name: project.name,
        status: 'skipped-missing',
      });
      continue;
    }

    // Defensive pin check (in case the registry changed between enumeration
    // and execution).
    try {
      const config = readProjectConfig(project.projectRoot);
      if (config?.update?.pin === true) {
        results.push({
          projectRoot: project.projectRoot,
          name: project.name,
          status: 'skipped-pinned',
        });
        continue;
      }
    } catch {
      // Unreadable config: continue with the update.
    }

    try {
      const cmd = new UpdateCommand({ force: options.force, onlyThis: true });
      await cmd.execute(project.projectRoot);
      results.push({
        projectRoot: project.projectRoot,
        name: project.name,
        status: 'updated',
      });
    } catch (error) {
      results.push({
        projectRoot: project.projectRoot,
        name: project.name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/**
 * Formats the per-project summary as human-readable lines. Empty when
 * nothing was updated/skipped/failed.
 */
export function formatMultiProjectSummary(results: readonly PerProjectResult[]): string[] {
  if (results.length === 0) return [];
  const lines: string[] = [];
  for (const result of results) {
    const label = `${result.name} (${path.basename(result.projectRoot)})`;
    switch (result.status) {
      case 'updated':
        lines.push(`  - ${label}: updated`);
        break;
      case 'skipped-missing':
        lines.push(`  - ${label}: skipped (directory missing)`);
        break;
      case 'skipped-pinned':
        lines.push(`  - ${label}: skipped (pinned)`);
        break;
      case 'skipped-current':
        lines.push(`  - ${label}: skipped (already current)`);
        break;
      case 'failed':
        lines.push(`  - ${label}: failed${result.error ? ` — ${result.error}` : ''}`);
        break;
    }
  }
  return lines;
}
