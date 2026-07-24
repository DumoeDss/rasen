/** Authoritative canonical persistence roots for global/project/store knowledge. */
import * as path from 'node:path';

import { getGlobalDataDir } from '../global-config.js';
import { resolveProjectHome } from '../project-home.js';
import { getRegisteredStore } from '../store/registry.js';
import { inspectRegisteredStore } from '../root-selection.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  LEARNED_SKILLS_DIR_NAME,
  LEARNED_SKILL_LOCKS_DIR_NAME,
} from './constants.js';
import type {
  KnowledgeOwnerRef,
  LearnedSkillContext,
  LearnedSkillScope,
} from './types.js';

export interface ResolvedStore {
  dir: string;
  owner: KnowledgeOwnerRef;
  /** Canonical persistence root (global dir, project home, or store repo). */
  root: string;
  /** Present only for shareable store scope. */
  storeRoot?: string;
  lockPath: string;
  projectId?: string;
}

export type ProjectStoreResolution =
  | { ok: true; store: ResolvedStore }
  | {
      ok: false;
      code:
        | 'unregistered_project'
        | 'knowledge_owner_scope_mismatch'
        | 'knowledge_store_scope_unavailable'
        | 'typed_owner_mismatch';
      message: string;
    };

function globalDir(context: LearnedSkillContext): string {
  return context.execution?.globalDataDir ?? context.globalDataDir ?? getGlobalDataDir();
}

function lockPath(context: LearnedSkillContext, owner: KnowledgeOwnerRef): string {
  const suffix = owner.type === 'global' ? 'global' : `${owner.type}-${owner.id}`;
  return FileSystemUtils.joinPath(
    globalDir(context),
    LEARNED_SKILL_LOCKS_DIR_NAME,
    `${suffix}.lock`
  );
}

export function resolveGlobalStore(context: LearnedSkillContext = {}): ResolvedStore {
  const root = globalDir(context);
  const owner = { type: 'global' as const };
  return {
    dir: FileSystemUtils.joinPath(root, LEARNED_SKILLS_DIR_NAME),
    owner,
    root,
    lockPath: lockPath(context, owner),
  };
}

export async function resolveProjectStore(
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  if (context.execution?.owner.type === 'store') {
    return {
      ok: false,
      code: 'knowledge_owner_scope_mismatch',
      message: `A project-scoped learned skill cannot use store:${context.execution.owner.id}.`,
    };
  }
  if (context.execution?.owner.type === 'global') {
    return {
      ok: false,
      code: 'knowledge_owner_scope_mismatch',
      message: 'A project-scoped learned skill cannot use the global owner.',
    };
  }
  const projectRoot =
    context.execution?.owner.type === 'project'
      ? context.execution.owner.root
      : context.projectRoot;
  if (!projectRoot) {
    return {
      ok: false,
      code: 'unregistered_project',
      message: 'A project-scoped learned skill requires a registered project root.',
    };
  }
  const home = await resolveProjectHome(projectRoot, {
    ensure: false,
    ...(globalDir(context) ? { globalDataDir: globalDir(context) } : {}),
  });
  if (!home) {
    return {
      ok: false,
      code: 'unregistered_project',
      message: `Project at ${projectRoot} has no registered machine home yet. Run \`rasen init\` to register it before codifying a learned skill.`,
    };
  }
  if (
    context.execution?.owner.type === 'project' &&
    context.execution.owner.id !== home.projectId
  ) {
    return {
      ok: false,
      code: 'typed_owner_mismatch',
      message: `Resolved project owner '${context.execution.owner.id}' does not match machine-home owner '${home.projectId}'.`,
    };
  }
  const owner = { type: 'project' as const, id: home.projectId };
  return {
    ok: true,
    store: {
      dir: FileSystemUtils.joinPath(home.homeDir, LEARNED_SKILLS_DIR_NAME),
      owner,
      root: home.homeDir,
      projectId: home.projectId,
      lockPath: lockPath(context, owner),
    },
  };
}

/** Resolves exactly one registered store namespace entry and rechecks metadata/root health. */
export async function resolveRegisteredKnowledgeStore(
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  const owner = context.execution?.owner;
  if (owner?.type !== 'store') {
    return {
      ok: false,
      code: 'knowledge_owner_scope_mismatch',
      message: 'Store-scoped learned skills require one explicit typed store owner.',
    };
  }
  try {
    const registered = await getRegisteredStore({
      id: owner.id,
      type: 'store',
      globalDataDir: globalDir(context),
    });
    const inspection = await inspectRegisteredStore(registered.id, registered.storeRoot);
    if (inspection.kind !== 'ok') {
      return {
        ok: false,
        code: 'knowledge_store_scope_unavailable',
        message: `Store '${owner.id}' is unavailable (${inspection.kind.replace(/_/g, ' ')}). Run \`rasen store doctor ${owner.id}\`.`,
      };
    }
    const selected = FileSystemUtils.canonicalizeExistingPath(owner.root);
    if (path.normalize(selected) !== path.normalize(inspection.canonicalRoot)) {
      return {
        ok: false,
        code: 'typed_owner_mismatch',
        message: `Resolved store:${owner.id} changed canonical root; re-resolve the knowledge context.`,
      };
    }
    const typedOwner = { type: 'store' as const, id: owner.id };
    return {
      ok: true,
      store: {
        dir: FileSystemUtils.joinPath(
          inspection.canonicalRoot,
          'rasen',
          LEARNED_SKILLS_DIR_NAME
        ),
        owner: typedOwner,
        root: inspection.canonicalRoot,
        storeRoot: inspection.canonicalRoot,
        lockPath: lockPath(context, typedOwner),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: 'knowledge_store_scope_unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveCanonicalStore(
  scope: LearnedSkillScope,
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  if (scope === 'global') {
    if (context.execution && context.execution.owner.type !== 'global') {
      return {
        ok: false,
        code: 'knowledge_owner_scope_mismatch',
        message: `Global learned-skill scope cannot use ${context.execution.owner.type}:${context.execution.owner.id}.`,
      };
    }
    return { ok: true, store: resolveGlobalStore(context) };
  }
  if (scope === 'store') return resolveRegisteredKnowledgeStore(context);
  return resolveProjectStore(context);
}

export function learnedSkillDir(store: ResolvedStore, id: string): string {
  return FileSystemUtils.joinPath(store.dir, id);
}

export async function probeStoreWritable(
  store: ResolvedStore
): Promise<{ ok: true } | { ok: false; message: string }> {
  const writable = await FileSystemUtils.canWriteFile(store.dir);
  return writable
    ? { ok: true }
    : {
        ok: false,
        message: `The learned-skill store at ${store.dir} is not writable. Check directory permissions.`,
      };
}
