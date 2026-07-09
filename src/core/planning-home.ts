import { LEGACY_WORKSPACE_DIR_NAME, WORKSPACE_DIR_NAME } from './config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../utils/file-system.js';

export type PlanningHomeKind = 'repo';

export interface PlanningHome {
  kind: PlanningHomeKind;
  root: string;
  changesDir: string;
  defaultSchema: string;
}

export interface ResolvePlanningHomeOptions {
  startPath?: string;
  allowImplicitRepoRoot?: boolean;
}

const REPO_DEFAULT_SCHEMA = 'spec-driven';

function pathExistsAsDirectory(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function getSearchStartDirectory(startPath: string): string {
  const resolved = path.resolve(startPath);

  try {
    const stats = fs.statSync(resolved);
    const searchStart = stats.isDirectory() ? resolved : path.dirname(resolved);
    return FileSystemUtils.canonicalizeExistingPath(searchStart);
  } catch {
    return resolved;
  }
}

function findNearestAncestor(startPath: string, predicate: (dirPath: string) => boolean): string | null {
  let currentDir = getSearchStartDirectory(startPath);

  while (true) {
    if (predicate(currentDir)) {
      return FileSystemUtils.canonicalizeExistingPath(currentDir);
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function findRepoPlanningRootSync(startPath = process.cwd()): string | null {
  return findNearestAncestor(startPath, (dirPath) =>
    pathExistsAsDirectory(path.join(dirPath, WORKSPACE_DIR_NAME))
  );
}

/**
 * Finds the nearest ancestor that holds a legacy `openspec/` workspace but no
 * `rasen/` workspace. Used to guide the user to `rasen migrate` instead of a
 * generic "not initialized" error. Never treated as an active workspace.
 */
export function findLegacyWorkspaceRootSync(startPath = process.cwd()): string | null {
  return findNearestAncestor(startPath, (dirPath) =>
    pathExistsAsDirectory(path.join(dirPath, LEGACY_WORKSPACE_DIR_NAME)) &&
    !pathExistsAsDirectory(path.join(dirPath, WORKSPACE_DIR_NAME))
  );
}

/**
 * Guidance shown when a workspace-requiring command finds a legacy `openspec/`
 * workspace but no `rasen/` one. Copy-only migration; originals untouched.
 */
export function legacyWorkspaceGuidance(legacyRoot: string): string {
  return (
    `Detected a legacy OpenSpec workspace at ${path.join(legacyRoot, LEGACY_WORKSPACE_DIR_NAME)} but no ${WORKSPACE_DIR_NAME}/ workspace. ` +
    `Run 'rasen migrate' to copy it into ${WORKSPACE_DIR_NAME}/ (copy-only — the original ${LEGACY_WORKSPACE_DIR_NAME}/ is left untouched), or 'rasen init' to start fresh.`
  );
}

function repoPlanningHome(repoRoot: string): PlanningHome {
  return {
    kind: 'repo',
    root: repoRoot,
    changesDir: path.join(repoRoot, WORKSPACE_DIR_NAME, 'changes'),
    defaultSchema: REPO_DEFAULT_SCHEMA,
  };
}

export function resolveCurrentPlanningHomeSync(
  options: ResolvePlanningHomeOptions = {}
): PlanningHome {
  const startPath = options.startPath ?? process.cwd();
  const searchStart = getSearchStartDirectory(startPath);
  const repoRoot = findRepoPlanningRootSync(searchStart);

  if (repoRoot) {
    return repoPlanningHome(repoRoot);
  }

  if (options.allowImplicitRepoRoot === false) {
    throw new Error('No Rasen planning home found from the current directory.');
  }

  return repoPlanningHome(FileSystemUtils.canonicalizeExistingPath(searchStart));
}

export function getChangeDir(planningHome: PlanningHome, changeName: string): string {
  return FileSystemUtils.joinPath(planningHome.changesDir, changeName);
}

export function formatChangeLocation(planningHome: PlanningHome, changeName: string): string {
  // Repo homes always nest changesDir under the root.
  return path.relative(planningHome.root, getChangeDir(planningHome, changeName));
}
