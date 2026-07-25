import { Buffer } from 'node:buffer';

import { readStorePointer } from '../project-config.js';
import { inspectRegisteredStore } from '../root-selection.js';
import { listRegisteredStores } from '../store/registry.js';
import { matchesApplicability } from './applicability.js';
import { digestContent, loadStoreCatalog } from './catalog.js';
import { LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET } from './constants.js';
import { queryStoreMemberProjects } from './authority.js';
import {
  resolveGlobalStore,
  resolveProjectStore,
  resolveRegisteredKnowledgeStore,
} from './stores.js';
import type {
  CanonicalKnowledgeIdentity,
  CanonicalLearnedSkill,
  LearnedSkillExecutionContext,
} from './types.js';

export type EffectiveLearnedSkillScope = 'project' | 'store' | 'global';

export interface EffectiveStoreMemberFact {
  status: 'member';
  store: { type: 'store'; id: string };
  catalog: CanonicalLearnedSkill[];
}

export interface EffectiveStoreNotMemberFact {
  status: 'not-member';
  store: { type: 'store'; id: string };
}

export interface EffectiveStoreUnavailableFact {
  status: 'unavailable';
  store: { type: 'store'; id: string };
  diagnostic: string;
  relevant: boolean;
  relevance: Array<'previous-source' | 'config-pointer' | 'frozen-planning-root'>;
}

export type EffectiveStoreFact =
  | EffectiveStoreMemberFact
  | EffectiveStoreNotMemberFact
  | EffectiveStoreUnavailableFact;

export interface StoreConflictParticipant {
  source: CanonicalKnowledgeIdentity;
  knowledgeKey: string;
  canonicalContentDigest: string;
}

export interface StoreSkillConflict {
  id: string;
  kind: 'effective' | 'latent';
  participants: StoreConflictParticipant[];
  guidance: string;
}

export interface EffectiveLearnedSkill {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  knowledgeKey: string;
  canonicalContentDigest: string;
  resolutionDigest: string;
  canonicalRecord: CanonicalLearnedSkill;
}

export interface EffectiveDescriptionBudgetFailure {
  name: 'LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET';
  limit: number;
  actual: number;
  ids: string[];
}

export interface DeferredMaterialization {
  id: string;
  store: { type: 'store'; id: string };
  action: 'remove' | 'replace';
  reason: string;
}

export interface EffectiveLearnedSkillPlan {
  status: 'ready' | 'degraded' | 'blocked';
  project: { type: 'project'; id: string; root: string };
  skills: EffectiveLearnedSkill[];
  globalRecords: CanonicalLearnedSkill[];
  stores: EffectiveStoreFact[];
  conflicts: StoreSkillConflict[];
  unavailableStores: EffectiveStoreUnavailableFact[];
  deferred: DeferredMaterialization[];
  planningErrors: Array<{ code: string; message: string }>;
  budgetFailure?: EffectiveDescriptionBudgetFailure;
}

export interface ResolveEffectiveLearnedSkillPlanInput {
  execution: LearnedSkillExecutionContext;
  /** Typed prior ledger sources used only to decide whether an outage is cleanup-relevant. */
  previousStoreIds?: readonly string[];
}

export interface ResolveEffectiveLearnedSkillRecordsInput {
  projectRoot: string;
  projectRecords: readonly CanonicalLearnedSkill[];
  storeRecords: readonly CanonicalLearnedSkill[];
  globalRecords: readonly CanonicalLearnedSkill[];
}

export interface EffectiveRecordResolution {
  skills: EffectiveLearnedSkill[];
  conflicts: StoreSkillConflict[];
  budgetFailure?: EffectiveDescriptionBudgetFailure;
  blocked: boolean;
}

export class EffectiveLearnedSkillPlanningError extends Error {
  constructor(message: string, readonly code: 'project_owner_required' | 'project_catalog_unavailable') {
    super(message);
    this.name = 'EffectiveLearnedSkillPlanningError';
  }
}

function identityKey(identity: CanonicalKnowledgeIdentity): string {
  return identity.owner.type === 'global'
    ? `global:/${identity.id}`
    : `${identity.owner.type}:${identity.owner.id}/${identity.id}`;
}

function compareIdentity(
  left: CanonicalKnowledgeIdentity,
  right: CanonicalKnowledgeIdentity
): number {
  return identityKey(left).localeCompare(identityKey(right));
}

function resolutionDigest(input: {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: readonly CanonicalKnowledgeIdentity[];
  knowledgeKey: string;
  canonicalContentDigest: string;
  content: string;
}): string {
  return digestContent(
    JSON.stringify({
      id: input.id,
      effectiveScope: input.effectiveScope,
      sources: [...input.sources].sort(compareIdentity),
      knowledgeKey: input.knowledgeKey,
      canonicalContentDigest: input.canonicalContentDigest,
      content: input.content,
    })
  );
}

function effectiveItem(
  record: CanonicalLearnedSkill,
  effectiveScope: EffectiveLearnedSkillScope,
  sources: CanonicalKnowledgeIdentity[]
): EffectiveLearnedSkill {
  const sortedSources = [...sources].sort(compareIdentity);
  return {
    id: record.manifest.id,
    effectiveScope,
    sources: sortedSources,
    knowledgeKey: record.manifest.knowledgeKey,
    canonicalContentDigest: record.manifest.contentDigest,
    resolutionDigest: resolutionDigest({
      id: record.manifest.id,
      effectiveScope,
      sources: sortedSources,
      knowledgeKey: record.manifest.knowledgeKey,
      canonicalContentDigest: record.manifest.contentDigest,
      content: record.content,
    }),
    canonicalRecord: record,
  };
}

function applicable(
  records: readonly CanonicalLearnedSkill[],
  projectRoot: string
): CanonicalLearnedSkill[] {
  return records
    .filter(
      (record) =>
        record.manifest.status === 'active' &&
        matchesApplicability(record.manifest.applicability, projectRoot)
    )
    .sort((left, right) => {
      const id = left.manifest.id.localeCompare(right.manifest.id);
      return id !== 0 ? id : compareIdentity(left.identity, right.identity);
    });
}

function groupById(
  records: readonly CanonicalLearnedSkill[]
): Map<string, CanonicalLearnedSkill[]> {
  const grouped = new Map<string, CanonicalLearnedSkill[]>();
  for (const record of records) {
    const group = grouped.get(record.manifest.id) ?? [];
    group.push(record);
    grouped.set(record.manifest.id, group);
  }
  return grouped;
}

function storeConflict(
  id: string,
  records: readonly CanonicalLearnedSkill[],
  kind: StoreSkillConflict['kind']
): StoreSkillConflict {
  return {
    id,
    kind,
    participants: records
      .map((record) => ({
        source: record.identity,
        knowledgeKey: record.manifest.knowledgeKey,
        canonicalContentDigest: record.manifest.contentDigest,
      }))
      .sort((left, right) => compareIdentity(left.source, right.source)),
    guidance:
      'Align the canonical store records exactly, rename one learned skill, or retire the inapplicable revision.',
  };
}

function equivalentStores(records: readonly CanonicalLearnedSkill[]): boolean {
  const first = records[0];
  if (!first) return true;
  return records.every(
    (record) =>
      record.manifest.knowledgeKey === first.manifest.knowledgeKey &&
      record.manifest.contentDigest === first.manifest.contentDigest &&
      record.content === first.content
  );
}

function inspectionDiagnostic(
  storeId: string,
  inspection: Awaited<ReturnType<typeof inspectRegisteredStore>>
): string {
  switch (inspection.kind) {
    case 'metadata_error':
      return `store:${storeId} metadata is unreadable: ${
        inspection.error instanceof Error ? inspection.error.message : String(inspection.error)
      }`;
    case 'metadata_missing':
      return `store:${storeId} metadata is missing at ${inspection.metadataPath}`;
    case 'metadata_id_mismatch':
      return `store:${storeId} metadata declares '${inspection.actualId}'`;
    case 'unhealthy_root':
      return `store:${storeId} has an unhealthy Rasen root: ${inspection.problems}`;
    case 'ok':
      return '';
  }
}

/** Pure precedence/equivalence/budget core, exposed for deterministic matrix tests. */
export function resolveEffectiveLearnedSkillRecords(
  input: ResolveEffectiveLearnedSkillRecordsInput
): EffectiveRecordResolution {
  const projectById = groupById(applicable(input.projectRecords, input.projectRoot));
  const storeById = groupById(applicable(input.storeRecords, input.projectRoot));
  const globalById = groupById(applicable(input.globalRecords, input.projectRoot));
  const ids = [...new Set([...projectById.keys(), ...storeById.keys(), ...globalById.keys()])].sort();
  const skills: EffectiveLearnedSkill[] = [];
  const conflicts: StoreSkillConflict[] = [];

  for (const id of ids) {
    const projectGroup = projectById.get(id) ?? [];
    const storeGroup = storeById.get(id) ?? [];
    const globalGroup = globalById.get(id) ?? [];
    if (projectGroup.length > 0) {
      const winner = projectGroup[0]!;
      skills.push(effectiveItem(winner, 'project', [winner.identity]));
      if (storeGroup.length > 1 && !equivalentStores(storeGroup)) {
        conflicts.push(storeConflict(id, storeGroup, 'latent'));
      }
      continue;
    }
    if (storeGroup.length > 0) {
      if (!equivalentStores(storeGroup)) {
        conflicts.push(storeConflict(id, storeGroup, 'effective'));
        continue;
      }
      const winner = [...storeGroup].sort((left, right) =>
        compareIdentity(left.identity, right.identity)
      )[0]!;
      skills.push(
        effectiveItem(
          winner,
          'store',
          storeGroup.map((record) => record.identity)
        )
      );
      continue;
    }
    if (globalGroup.length > 0) {
      const winner = globalGroup[0]!;
      skills.push(effectiveItem(winner, 'global', [winner.identity]));
    }
  }

  skills.sort((left, right) => left.id.localeCompare(right.id));
  conflicts.sort((left, right) => {
    const id = left.id.localeCompare(right.id);
    return id !== 0 ? id : left.kind.localeCompare(right.kind);
  });
  const actualDescriptionBytes = skills.reduce(
    (total, skill) =>
      total + Buffer.byteLength(skill.canonicalRecord.manifest.description, 'utf8'),
    0
  );
  const budgetFailure =
    actualDescriptionBytes > LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET
      ? {
          name: 'LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET' as const,
          limit: LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET,
          actual: actualDescriptionBytes,
          ids: skills.map((skill) => skill.id),
        }
      : undefined;
  return {
    skills,
    conflicts,
    ...(budgetFailure ? { budgetFailure } : {}),
    blocked:
      conflicts.some((conflict) => conflict.kind === 'effective') ||
      budgetFailure !== undefined,
  };
}

/**
 * Pure effective-set preflight. It reads authoritative typed facts but performs
 * no learned target or ledger mutation.
 */
export async function resolveEffectiveLearnedSkillPlan(
  input: ResolveEffectiveLearnedSkillPlanInput
): Promise<EffectiveLearnedSkillPlan> {
  const { execution } = input;
  if (execution.owner.type !== 'project') {
    throw new EffectiveLearnedSkillPlanningError(
      'A resolved project owner is required for project-local learned materialization; a store owner cannot select a member project.',
      'project_owner_required'
    );
  }
  const project = execution.owner;
  const context = { execution };
  const projectResolution = await resolveProjectStore(context);
  if (!projectResolution.ok) {
    throw new EffectiveLearnedSkillPlanningError(
      projectResolution.message,
      'project_catalog_unavailable'
    );
  }

  const projectRecords = loadStoreCatalog(projectResolution.store, 'project');
  const globalRecords = loadStoreCatalog(resolveGlobalStore(context), 'global')
    .filter((record) => record.manifest.status === 'active')
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));

  const previousStoreIds = new Set(input.previousStoreIds ?? []);
  const pointer = readStorePointer(project.root).value;
  const frozenPlanningStore =
    execution.source === 'run-state' && execution.planningRoot?.type === 'store'
      ? execution.planningRoot.id
      : undefined;
  const storeFacts: EffectiveStoreFact[] = [];
  const memberRecords: CanonicalLearnedSkill[] = [];
  const planningErrors: EffectiveLearnedSkillPlan['planningErrors'] = [];
  let registry: Awaited<ReturnType<typeof listRegisteredStores>> = [];
  try {
    registry = (await listRegisteredStores({
      ...(execution.globalDataDir ? { globalDataDir: execution.globalDataDir } : {}),
    }))
      .filter((entry) => entry.type === 'store')
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    planningErrors.push({
      code: 'store_registry_unavailable',
      message: `The typed store registry is unavailable; project-local learned reconciliation is blocked until it is repaired: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }

  for (const entry of registry) {
    const relevance: EffectiveStoreUnavailableFact['relevance'] = [];
    if (previousStoreIds.has(entry.id)) relevance.push('previous-source');
    if (pointer === entry.id) relevance.push('config-pointer');
    if (frozenPlanningStore === entry.id) relevance.push('frozen-planning-root');
    const inspection = await inspectRegisteredStore(entry.id, entry.storeRoot);
    if (inspection.kind !== 'ok') {
      storeFacts.push({
        status: 'unavailable',
        store: { type: 'store', id: entry.id },
        diagnostic: inspectionDiagnostic(entry.id, inspection),
        relevant: relevance.length > 0,
        relevance,
      });
      continue;
    }

    const storeExecution: LearnedSkillExecutionContext = {
      owner: { type: 'store', id: entry.id, root: inspection.canonicalRoot },
      source: 'explicit-store',
      ...(execution.planningRoot ? { planningRoot: execution.planningRoot } : {}),
      ...(execution.globalDataDir ? { globalDataDir: execution.globalDataDir } : {}),
    };
    try {
      const membership = await queryStoreMemberProjects({ execution: storeExecution });
      if (!membership.members.some((member) => member.owner.id === project.id)) {
        storeFacts.push({
          status: 'not-member',
          store: { type: 'store', id: entry.id },
        });
        continue;
      }
      const resolution = await resolveRegisteredKnowledgeStore({ execution: storeExecution });
      if (!resolution.ok) throw new Error(resolution.message);
      const catalog = loadStoreCatalog(resolution.store, 'store')
        .filter((record) => record.manifest.status === 'active')
        .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
      storeFacts.push({
        status: 'member',
        store: { type: 'store', id: entry.id },
        catalog,
      });
      memberRecords.push(...catalog);
    } catch (error) {
      storeFacts.push({
        status: 'unavailable',
        store: { type: 'store', id: entry.id },
        diagnostic: `store:${entry.id} membership/catalog is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        relevant: relevance.length > 0,
        relevance,
      });
    }
  }

  const resolved = resolveEffectiveLearnedSkillRecords({
    projectRoot: project.root,
    projectRecords,
    storeRecords: memberRecords,
    globalRecords,
  });
  const unavailableStores = storeFacts
    .filter((fact): fact is EffectiveStoreUnavailableFact => fact.status === 'unavailable')
    .sort((left, right) => left.store.id.localeCompare(right.store.id));
  return {
    status:
      resolved.blocked || planningErrors.length > 0
        ? 'blocked'
        : unavailableStores.some((store) => store.relevant)
          ? 'degraded'
          : 'ready',
    project,
    skills: resolved.skills,
    globalRecords,
    stores: storeFacts.sort((left, right) => left.store.id.localeCompare(right.store.id)),
    conflicts: resolved.conflicts,
    unavailableStores,
    deferred: [],
    planningErrors,
    ...(resolved.budgetFailure ? { budgetFailure: resolved.budgetFailure } : {}),
  };
}
