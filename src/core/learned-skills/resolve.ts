/**
 * The read side of the learned-skill module (design D4/D9): resolves the active
 * canonical records relevant to a context — the owning project's project-scoped
 * skills and every active global skill — separately from workflow definitions.
 * Applicability filtering for a project-local tool home is the materialization
 * caller's job (init/update); this resolver only returns active records and
 * never adds identities to workflow or profile resolution.
 */

import { loadStoreCatalog, readStoreCatalog, type StoreCatalogRead } from './catalog.js';
import {
  resolveCanonicalStore,
  resolveGlobalStore,
  resolveProjectStore,
  resolveRegisteredKnowledgeStore,
} from './stores.js';
import type {
  CanonicalLearnedSkill,
  LearnedSkillContext,
  LearnedSkillScope,
  ResolvedLearnedSkillSet,
} from './types.js';

const isActive = (record: CanonicalLearnedSkill): boolean => record.manifest.status === 'active';

/**
 * The catalogs this context can read, each returned separately.
 *
 * What a project actually RECEIVES from these — precedence, applicability,
 * conflicts, and the eligible Stores beyond the resolved one — is the sibling
 * change's resolution, not this function's. Here a Store's catalog appears
 * only when the context resolved to that Store as its owner.
 */
export async function resolveLearnedSkills(
  context: LearnedSkillContext = {}
): Promise<ResolvedLearnedSkillSet> {
  const global = loadStoreCatalog(resolveGlobalStore(context), 'global').filter(isActive);

  let project: CanonicalLearnedSkill[] = [];
  if (context.execution?.owner.type === 'project' || context.projectRoot) {
    const resolution = await resolveProjectStore(context);
    if (resolution.ok) {
      project = loadStoreCatalog(resolution.store, 'project').filter(isActive);
    }
  }

  let store: CanonicalLearnedSkill[] = [];
  if (context.execution?.owner.type === 'store') {
    const resolution = await resolveRegisteredKnowledgeStore(context);
    if (resolution.ok) {
      store = loadStoreCatalog(resolution.store, 'store').filter(isActive);
    }
  }

  return { project, store, global };
}

/**
 * Every record in a scope AND every Rasen-authored record the catalog could
 * not read — powers `knowledge list`/`show`.
 *
 * Both halves travel together because the reasons are only useful at the
 * surface a user actually looks at. Verification that drops a record without
 * saying so is indistinguishable from a deletion.
 */
export async function readCanonicalLearnedSkillCatalog(
  scope: LearnedSkillScope,
  context: LearnedSkillContext = {}
): Promise<StoreCatalogRead> {
  const resolution = await resolveCanonicalStore(scope, context);
  return resolution.ok
    ? readStoreCatalog(resolution.store, scope)
    : { records: [], unreadable: [], recoverableBackups: [] };
}

/** Lists every record (active and retired) in a scope — powers `knowledge list`/`show`. */
export async function listCanonicalLearnedSkills(
  scope: LearnedSkillScope,
  context: LearnedSkillContext = {}
): Promise<CanonicalLearnedSkill[]> {
  const resolution = await resolveCanonicalStore(scope, context);
  return resolution.ok ? loadStoreCatalog(resolution.store, scope) : [];
}
