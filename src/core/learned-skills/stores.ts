/**
 * Canonical catalog resolution — where each scope's knowledge actually lives.
 *
 *   global   <global data dir>/learned-skills/<id>/
 *   project  <global data dir>/project-knowledge/<projectId>/learned-skills/<id>/
 *   store    <store repo>/rasen/learned-skills/<id>/
 *
 * A project's catalog is keyed on the project's IDENTITY, not on the clone the
 * command ran in. Two clones and any number of linked worktrees therefore share
 * one catalog, and `rasen knowledge migrate` moves an existing per-clone
 * catalog there. The checkout still decides where applicability is evaluated
 * and where generated files land — three roots, kept apart (plan §15.6).
 *
 * Project and global knowledge stays out of the repository (design D3): an
 * in-repo fallback would dirty the worktree after shipping. A Store's catalog
 * is the deliberate exception — it lives in the Store's own repository beside
 * its planning content, because being shareable is the entire point. Nothing
 * else Rasen writes for a Store goes there: the lock file lives under the
 * machine data dir, so reading or writing knowledge never leaves an untracked
 * file in someone's `git status`.
 *
 * The Store is always reached through child A's `resolveStoreBinding()`. A
 * by-id registry lookup cannot address two Stores that share a display name,
 * and picking one of them silently is how a team's knowledge ends up published
 * into the wrong repository.
 */

import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { getGlobalDataDir } from '../global-config.js';
import { resolveProjectHome } from '../project-home.js';
import {
  ProjectKnowledgeHomeError,
  resolveProjectKnowledgeHome,
  type ProjectKnowledgeHome,
} from '../project-knowledge-home.js';
import {
  describeUnavailableStore,
  resolveStoreBinding,
  type StoreBindingResolution,
} from '../store/identity.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  LEARNED_SKILLS_DIR_NAME,
  LEARNED_SKILL_LOCKS_DIR_NAME,
  STORE_LEARNED_SKILLS_SEGMENTS,
} from './constants.js';
import { durableOwnerKey, storeOwnerFrom } from './owner-identity.js';
import type {
  DurableKnowledgeOwnerRef,
  LearnedSkillBlock,
  LearnedSkillContext,
  LearnedSkillScope,
} from './types.js';

export interface ResolvedStore {
  /** Absolute canonical catalog directory (may not exist yet). */
  dir: string;
  /** The durable owner every record in this catalog is keyed on. */
  owner: DurableKnowledgeOwnerRef;
  /**
   * The canonical OWNER root — where this owner's knowledge lives. For a
   * project that is the identity-keyed knowledge home, never the checkout the
   * command ran in and never that clone's machine home.
   */
  root: string;
  /** Present only for the Store scope: the repository the user must commit in. */
  storeRoot?: string;
  /** Machine-local lock file; never inside the Store's repository. */
  lockPath: string;
  /** The stable project id for a project catalog; undefined otherwise. */
  projectId?: string;
}

export type ProjectStoreResolution =
  | { ok: true; store: ResolvedStore }
  | ({ ok: false } & Pick<LearnedSkillBlock, 'code' | 'message' | 'repair'>);

function globalDir(context: LearnedSkillContext): string {
  return context.execution?.globalDataDir ?? context.globalDataDir ?? getGlobalDataDir();
}

function pathOptions(context: LearnedSkillContext): { globalDataDir?: string } {
  const dir = context.execution?.globalDataDir ?? context.globalDataDir;
  return dir === undefined ? {} : { globalDataDir: dir };
}

/**
 * One lock per durable owner, under the machine data dir.
 *
 * The filename is a digest of the owner key rather than the key itself: a
 * projectId is only validated, never sanitized (child B), so it can contain
 * characters no filesystem accepts — and a Store's permanent identity must not
 * be discoverable by listing a directory on a shared machine. The readable
 * prefix keeps the file identifiable while debugging.
 */
function lockPathFor(context: LearnedSkillContext, owner: DurableKnowledgeOwnerRef): string {
  const key = durableOwnerKey(owner);
  const digest = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
  return path.join(
    globalDir(context),
    LEARNED_SKILL_LOCKS_DIR_NAME,
    `${owner.type}-${digest}.lock`
  );
}

/** The global learned-skill catalog under the resolved global data directory. */
export function resolveGlobalStore(context: LearnedSkillContext = {}): ResolvedStore {
  const root = globalDir(context);
  const owner: DurableKnowledgeOwnerRef = { type: 'global' };
  return {
    dir: FileSystemUtils.joinPath(root, LEARNED_SKILLS_DIR_NAME),
    owner,
    root,
    lockPath: lockPathFor(context, owner),
  };
}

/**
 * The project learned-skill catalog in the project's CANONICAL knowledge home,
 * keyed on the project's identity.
 *
 * There is no in-repository fallback: an unregistered project (no `projectId`
 * or no registry entry) yields an actionable `rasen init` diagnostic instead.
 * The machine home is still consulted — it is what proves this checkout is a
 * registered project and which identity it carries — but the catalog no longer
 * lives inside it, because a machine home is per CLONE and a project's
 * knowledge is per PROJECT.
 */
export async function resolveProjectStore(
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  if (context.execution?.owner.type === 'store') {
    return {
      ok: false,
      code: 'knowledge_owner_scope_mismatch',
      message: `A project-scoped learned skill cannot use store '${context.execution.owner.id}' as its owner.`,
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
      message:
        'A project-scoped learned skill requires a project root. Run this inside a Rasen project.',
    };
  }
  const globalDataDir = context.execution?.globalDataDir ?? context.globalDataDir;
  const home = await resolveProjectHome(projectRoot, {
    ensure: false,
    ...(globalDataDir !== undefined ? { globalDataDir } : {}),
  });
  if (!home) {
    return {
      ok: false,
      code: 'unregistered_project',
      message: `Project at ${projectRoot} has no registered machine home yet. Run \`rasen init\` to register it before codifying a learned skill.`,
      repair: ['rasen init'],
    };
  }
  // The resolved owner and the machine home must name the same project. They
  // are derived independently, and a disagreement means one of them is stale —
  // writing under either would record provenance the other contradicts.
  if (
    context.execution?.owner.type === 'project' &&
    context.execution.owner.id !== home.projectId
  ) {
    return {
      ok: false,
      code: 'typed_owner_mismatch',
      message: `Resolved project owner '${context.execution.owner.id}' does not match the machine home's project '${home.projectId}'.`,
      repair: ['rasen init'],
    };
  }
  const owner: DurableKnowledgeOwnerRef = { type: 'project', projectId: home.projectId };
  let knowledgeHome: ProjectKnowledgeHome;
  try {
    knowledgeHome = resolveProjectKnowledgeHome(home.projectId, pathOptions(context));
  } catch (error) {
    if (error instanceof ProjectKnowledgeHomeError) {
      return {
        ok: false,
        code: 'unregistered_project',
        message: error.message,
        repair: [...error.repair],
      };
    }
    throw error;
  }
  return {
    ok: true,
    store: {
      dir: knowledgeHome.catalogDir,
      owner,
      root: knowledgeHome.root,
      projectId: home.projectId,
      lockPath: lockPathFor(context, owner),
    },
  };
}

/** Re-resolves a Store owner through the single identity resolver. */
async function bindResolvedStoreOwner(
  owner: { id: string; uid?: string },
  context: LearnedSkillContext
): Promise<StoreBindingResolution> {
  // A permanent identity resolves exactly; a legacy Store that has none can
  // only be named by its alias, and an ambiguous alias comes back
  // `unavailable` rather than silently picking one of the namesakes.
  return resolveStoreBinding({
    declaration:
      owner.uid !== undefined
        ? { form: 'durable', uid: owner.uid, id: owner.id }
        : { form: 'alias', id: owner.id },
    ...pathOptions(context),
  });
}

/**
 * The catalog inside one Store's repository, re-verified against the registry
 * and the checkout's own metadata every time. Returns a refusal — never a
 * silent fall-through to global or to an empty directory — when the Store is
 * not usable here.
 */
export async function resolveRegisteredKnowledgeStore(
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  const owner = context.execution?.owner;
  if (owner?.type !== 'store') {
    return {
      ok: false,
      code: 'knowledge_owner_scope_mismatch',
      message: 'Store-scoped learned skills require one explicit store owner. Pass --store <store>.',
    };
  }

  const binding = await bindResolvedStoreOwner(owner, context);
  if (binding.kind !== 'resolved') {
    return binding.kind === 'absent'
      ? {
          ok: false,
          code: 'knowledge_store_scope_unavailable',
          message: `Store '${owner.id}' no longer resolves on this machine.`,
          repair: ['rasen store list', 'rasen doctor'],
        }
      : {
          ok: false,
          code: 'knowledge_store_scope_unavailable',
          message: describeUnavailableStore(binding),
          repair: [...binding.repair],
        };
  }

  // The checkout the context recorded and the one the registry resolves must
  // be the same directory. A Store re-cloned or re-registered elsewhere
  // between resolution and use fails here rather than publishing into whatever
  // happens to be at the new path.
  if (!canonicalPathsEqual(owner.root, binding.store.root)) {
    return {
      ok: false,
      code: 'typed_owner_mismatch',
      message: `Store '${binding.store.id}' now resolves to ${binding.store.root}, not the ${owner.root} this operation was resolved against. Re-run the command.`,
      repair: [`rasen store doctor ${binding.store.id}`],
    };
  }

  const durableOwner = storeOwnerFrom(binding.store);
  if (!durableOwner) {
    // Recording a display alias as ownership is exactly the record this
    // release exists to stop writing, so the honest answer is a refusal that
    // names the command which mints the identity.
    return {
      ok: false,
      code: 'learned_owner_legacy_alias',
      message: `Store '${binding.store.id}' has no permanent identity yet, so it cannot own knowledge records — a record keyed on its display name would move the moment the Store is renamed.`,
      repair: [`rasen store upgrade-identity ${binding.store.id}`],
    };
  }

  return {
    ok: true,
    store: {
      dir: path.join(binding.store.root, ...STORE_LEARNED_SKILLS_SEGMENTS),
      owner: durableOwner,
      root: binding.store.root,
      storeRoot: binding.store.root,
      lockPath: lockPathFor(context, durableOwner),
    },
  };
}

/** Canonical, case-insensitive on Windows — the comparison a path can make. */
export function canonicalPathsEqual(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    try {
      return FileSystemUtils.canonicalizeExistingPath(value);
    } catch {
      return path.resolve(value);
    }
  };
  const a = canonical(left);
  const b = canonical(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

/** The one entry point every scope's catalog resolution goes through. */
export async function resolveCanonicalStore(
  scope: LearnedSkillScope,
  context: LearnedSkillContext
): Promise<ProjectStoreResolution> {
  if (scope === 'global') {
    if (context.execution && context.execution.owner.type !== 'global') {
      const owner = context.execution.owner;
      return {
        ok: false,
        code: 'knowledge_owner_scope_mismatch',
        message: `Global learned-skill scope cannot use ${owner.type}:${owner.id} as its owner.`,
      };
    }
    return { ok: true, store: resolveGlobalStore(context) };
  }
  if (scope === 'store') return resolveRegisteredKnowledgeStore(context);
  return resolveProjectStore(context);
}

/** The absolute canonical directory for one learned-skill id in a catalog. */
export function learnedSkillDir(store: ResolvedStore, id: string): string {
  return FileSystemUtils.joinPath(store.dir, id);
}

/**
 * Probes whether a catalog can be written, producing an actionable permission
 * diagnostic when it cannot. A catalog directory that does not exist yet is
 * writable when its nearest existing ancestor is.
 */
export async function probeStoreWritable(
  store: ResolvedStore
): Promise<{ ok: true } | { ok: false; message: string }> {
  const writable = await FileSystemUtils.canWriteFile(store.dir);
  if (writable) return { ok: true };
  return {
    ok: false,
    message: `The learned-skill catalog at ${store.dir} is not writable. Check directory permissions.`,
  };
}
