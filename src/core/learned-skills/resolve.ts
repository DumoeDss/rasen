/**
 * The read side of the learned-skill module (design D4/D9): resolves the active
 * canonical records relevant to a context — the owning project's project-scoped
 * skills and every active global skill — separately from workflow definitions.
 * Applicability filtering for a project-local tool home is the materialization
 * caller's job (init/update); this resolver only returns active records and
 * never adds identities to workflow or profile resolution.
 */

import { loadStoreCatalog } from './catalog.js';
import {
  resolveGlobalStore,
  resolveProjectStore,
  resolveRegisteredKnowledgeStore,
  resolveCanonicalStore,
} from './stores.js';
import type { CanonicalLearnedSkill, LearnedSkillContext, ResolvedLearnedSkillSet } from './types.js';

const isActive = (record: CanonicalLearnedSkill): boolean => record.manifest.status === 'active';

export async function resolveLearnedSkills(
  context: LearnedSkillContext = {}
): Promise<ResolvedLearnedSkillSet> {
  const global = loadStoreCatalog(resolveGlobalStore(context), 'global').filter(isActive);

  let project: CanonicalLearnedSkill[] = [];
  let store: CanonicalLearnedSkill[] = [];
  if (context.execution?.owner.type === 'project' || context.projectRoot) {
    const resolution = await resolveProjectStore(context);
    if (resolution.ok) {
      project = loadStoreCatalog(resolution.store, 'project').filter(isActive);
    }
  }
  if (context.execution?.owner.type === 'store') {
    const resolution = await resolveRegisteredKnowledgeStore(context);
    if (resolution.ok) {
      store = loadStoreCatalog(resolution.store, 'store').filter(isActive);
    }
  }

  return { project, store, global };
}

/** Lists every record (active and retired) in a scope — powers `knowledge list`/`show`. */
export async function listCanonicalLearnedSkills(
  scope: 'project' | 'store' | 'global',
  context: LearnedSkillContext = {}
): Promise<CanonicalLearnedSkill[]> {
  const resolution = await resolveCanonicalStore(scope, context);
  return resolution.ok ? loadStoreCatalog(resolution.store, scope) : [];
}
