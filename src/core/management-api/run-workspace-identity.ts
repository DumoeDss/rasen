import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import type { ProjectHome } from '../project-home.js';
import {
  derivePlanningSpaceId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
} from '../change-run/internal/identity.js';

export interface RunWorkspaceIdentityFs {
  readonly stat: (target: string) => fs.BigIntStats;
  readonly listDirectories: (target: string) => readonly string[];
}

const FILESYSTEM: RunWorkspaceIdentityFs = Object.freeze({
  stat: (target: string) => fs.statSync(target, { bigint: true }),
  listDirectories: (target: string) =>
    fs.readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
});

function deriveWorkspaceId(
  planningSpaceHome: string,
  physical: fs.BigIntStats
): string {
  const planningSpaceId = derivePlanningSpaceId(planningSpaceHome);
  const identity = readPhysicalIdentity({
    device: physical.dev,
    ino: physical.ino,
    birthtimeMs: physical.birthtimeMs,
  });
  return deriveWorkspaceInstanceId(planningSpaceId, identity) as string;
}

export type RunWorkspaceIdentityUnavailableReason =
  | 'selected-root-unavailable'
  | 'active-change-unavailable'
  | 'archive-unavailable'
  | 'archive-candidate-unavailable';

export type RunWorkspaceIdentityResolution =
  | {
      readonly ok: true;
      /** Always contains the selected-root legacy identity. */
      readonly workspaceIds: readonly [string, ...string[]];
      /** Distinguishes a valid no-candidate transition from failed authority. */
      readonly registeredSource: 'none' | 'active' | 'archived';
    }
  | {
      readonly ok: false;
      readonly code: 'workspace_identity_unavailable';
      readonly reason: RunWorkspaceIdentityUnavailableReason;
      readonly message: string;
    };

function unavailable(
  reason: RunWorkspaceIdentityUnavailableReason
): RunWorkspaceIdentityResolution {
  return {
    ok: false,
    code: 'workspace_identity_unavailable',
    reason,
    message: `Workspace identity authority could not be established (${reason}).`,
  };
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function resolved(
  legacyWorkspaceId: string,
  registeredSource: 'none' | 'active' | 'archived',
  registeredWorkspaceId?: string
): RunWorkspaceIdentityResolution {
  return {
    ok: true,
    workspaceIds:
      registeredWorkspaceId !== undefined && registeredWorkspaceId !== legacyWorkspaceId
        ? [legacyWorkspaceId, registeredWorkspaceId]
        : [legacyWorkspaceId],
    registeredSource,
  };
}

/**
 * Read-only mirror of both CLI identity paths.
 *
 * A project may have launched a legacy-derived Run before registration and be
 * registered by the time Management reads it. Retaining both candidates makes
 * that transition observable without treating a different physical worktree
 * as current. Registered active/archived Changes use their own physical
 * identity; the legacy candidate always uses this exact selected root.
 */
export function deriveRunWorkspaceIds(
  root: string,
  home: ProjectHome | null,
  changeId: string,
  io: RunWorkspaceIdentityFs = FILESYSTEM
): RunWorkspaceIdentityResolution {
  const legacyPlanningSpaceHome = `project-${createHash('sha256')
    .update(root)
    .digest('hex')
    .slice(0, 12)}`;
  let rootStat: fs.BigIntStats;
  try {
    rootStat = io.stat(root);
  } catch {
    return unavailable('selected-root-unavailable');
  }
  if (!rootStat.isDirectory()) {
    return unavailable('selected-root-unavailable');
  }
  const legacyWorkspaceId = deriveWorkspaceId(
    legacyPlanningSpaceHome,
    rootStat
  );

  if (home === null) return resolved(legacyWorkspaceId, 'none');

  const changeDir = path.join(root, WORKSPACE_DIR_NAME, 'changes', changeId);
  try {
    const activeStat = io.stat(changeDir);
    if (!activeStat.isDirectory()) {
      return unavailable('active-change-unavailable');
    }
    return resolved(
      legacyWorkspaceId,
      'active',
      deriveWorkspaceId(home.name, activeStat)
    );
  } catch (error) {
    if (!isMissing(error)) {
      return unavailable('active-change-unavailable');
    }
  }

  let archivedCandidates: string[];
  try {
    archivedCandidates = io
      .listDirectories(home.archiveDir)
      .filter((entry) => entry.endsWith(`-${changeId}`))
      .map((entry) => path.join(home.archiveDir, entry))
      .sort();
  } catch (error) {
    if (isMissing(error)) return resolved(legacyWorkspaceId, 'none');
    return unavailable('archive-unavailable');
  }

  for (const candidate of archivedCandidates) {
    try {
      const candidateStat = io.stat(candidate);
      if (!candidateStat.isDirectory()) continue;
      return resolved(
        legacyWorkspaceId,
        'archived',
        deriveWorkspaceId(home.name, candidateStat)
      );
    } catch (error) {
      // A listed entry can disappear before stat. Skip that stale candidate
      // and continue so one race cannot erase a later legal archive identity.
      if (isMissing(error)) continue;
      return unavailable('archive-candidate-unavailable');
    }
  }

  if (archivedCandidates.length > 0) {
    // If the archive itself moved during candidate inspection, this is not a
    // valid "no candidate" result: authority became unavailable mid-read.
    try {
      const archiveStat = io.stat(home.archiveDir);
      if (!archiveStat.isDirectory()) {
        return unavailable('archive-unavailable');
      }
    } catch {
      return unavailable('archive-unavailable');
    }
  }

  return resolved(legacyWorkspaceId, 'none');
}
