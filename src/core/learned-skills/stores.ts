/**
 * Canonical store resolution. Learned skills live under a registered project's
 * machine home or the global data dir — never in the repository (design D3):
 * an in-repo fallback would dirty the worktree after shipping. Both resolvers
 * use platform path primitives and the existing home resolvers, so a Windows
 * drive letter / separator resolves consistently without changing the stable
 * project id.
 *
 *   <global data dir>/learned-skills/<id>/
 *   <project machine home>/learned-skills/<id>/
 */

import { getGlobalDataDir } from '../global-config.js';
import { resolveProjectHome } from '../project-home.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import { LEARNED_SKILLS_DIR_NAME } from './constants.js';
import type { LearnedSkillContext } from './types.js';

export interface ResolvedStore {
  /** Absolute `<root>/learned-skills` directory (may not exist yet). */
  dir: string;
  /** The stable project id for a project store; undefined for the global store. */
  projectId?: string;
}

export type ProjectStoreResolution =
  | { ok: true; store: ResolvedStore }
  | { ok: false; code: 'unregistered_project'; message: string };

/** The global learned-skill store under the resolved global data directory. */
export function resolveGlobalStore(context: LearnedSkillContext = {}): ResolvedStore {
  const root = context.globalDataDir ?? getGlobalDataDir();
  return { dir: FileSystemUtils.joinPath(root, LEARNED_SKILLS_DIR_NAME) };
}

/**
 * The project learned-skill store in the registered project's machine home.
 * There is no in-repository fallback: an unregistered project (no `projectId`
 * or no registry entry) yields an actionable `rasen init` diagnostic instead.
 */
export async function resolveProjectStore(
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  if (!context.projectRoot) {
    return {
      ok: false,
      code: 'unregistered_project',
      message:
        'A project-scoped learned skill requires a project root. Run this inside a Rasen project.',
    };
  }
  const home = await resolveProjectHome(context.projectRoot, {
    ensure: false,
    ...(context.globalDataDir !== undefined ? { globalDataDir: context.globalDataDir } : {}),
  });
  if (!home) {
    return {
      ok: false,
      code: 'unregistered_project',
      message: `Project at ${context.projectRoot} has no registered machine home yet. Run \`rasen init\` to register it before codifying a learned skill.`,
    };
  }
  return {
    ok: true,
    store: {
      dir: FileSystemUtils.joinPath(home.homeDir, LEARNED_SKILLS_DIR_NAME),
      projectId: home.projectId,
    },
  };
}

/** The absolute canonical directory for one learned-skill id in a store. */
export function learnedSkillDir(store: ResolvedStore, id: string): string {
  return FileSystemUtils.joinPath(store.dir, id);
}

/**
 * Probes whether a store can be written, producing an actionable permission
 * diagnostic when it cannot. A store directory that does not exist yet is
 * writable when its nearest existing ancestor is.
 */
export async function probeStoreWritable(
  store: ResolvedStore
): Promise<{ ok: true } | { ok: false; message: string }> {
  const writable = await FileSystemUtils.canWriteFile(store.dir);
  if (writable) return { ok: true };
  return {
    ok: false,
    message: `The learned-skill store at ${store.dir} is not writable. Check directory permissions.`,
  };
}
