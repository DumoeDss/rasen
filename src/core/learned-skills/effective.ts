/**
 * What a project actually RECEIVES.
 *
 * The order is stated once and never varies:
 *
 *     applicability filtering
 *             ↓
 *     project record exists → project wins
 *             ↓
 *     otherwise resolve every ELIGIBLE Store record
 *             ↓
 *     records exactly equivalent → one winner recording ALL contributing identities
 *     records differ            → conflict, no winner
 *             ↓
 *     no Store winner → machine-wide fallback
 *
 * Four shortcuts are explicitly unreachable, each because it produces a winner
 * chosen by accident: the first Store in registry order, the Store the project
 * happens to plan in, the alphabetically first display name, and "same
 * knowledge key means same knowledge". The fifth — treating a Store that
 * cannot be reached as a Store with nothing in it — is worse than accidental:
 * it deletes generated files the user is still relying on.
 *
 * Everything here is READ-ONLY. It resolves, validates, and reports; the
 * materialization module is the only seam that writes.
 */

import { Buffer } from 'node:buffer';

import { listProjectStoreCandidates } from '../store/membership.js';
import { hasStoreDeclaration, readStorePointer } from '../project-config.js';
import { storeBindingDeclarationFrom } from '../effective-config.js';
import { resolveStoreBinding } from '../store/identity.js';
import { storeUidsMatch } from '../store/identity-types.js';
import { matchesApplicability } from './applicability.js';
import { loadStoreCatalog } from './catalog.js';
import { LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET, STORE_LEARNED_SKILLS_SEGMENTS } from './constants.js';
import {
  compareDurableOwners,
  describeDurableOwner,
  durableOwnerKey,
} from './owner-identity.js';
import { resolveGlobalStore, resolveProjectStore, type ResolvedStore } from './stores.js';
import { resolutionDigestV2 } from './resolution-digest.js';
import type {
  CanonicalKnowledgeIdentity,
  CanonicalLearnedSkill,
  DurableKnowledgeOwnerRef,
  LearnedSkillExecutionContext,
  StoreIdentityRef,
} from './types.js';

import * as path from 'node:path';

export type EffectiveLearnedSkillScope = 'project' | 'store' | 'global';

/** Every route by which a Store is RELEVANT to this project (plan §15.5). */
export type StoreRelevanceReason =
  /** Declared in the project's own `storeMemberships`. */
  | 'declared'
  /** Named as a source by the previous ownership record. */
  | 'previous-source'
  /** The project's current primary planning pointer. */
  | 'config-pointer'
  /** A frozen planning/membership fact from a resumed run. */
  | 'frozen-planning-root'
  /** Locally reverse-discovered: this Store's own records include the project. */
  | 'local-record';

export interface EffectiveStoreMemberFact {
  status: 'member';
  store: StoreIdentityRef;
  relevance: StoreRelevanceReason[];
  catalog: CanonicalLearnedSkill[];
}

export interface EffectiveStoreNotMemberFact {
  status: 'not-member';
  store: StoreIdentityRef;
  relevance: StoreRelevanceReason[];
}

export interface EffectiveStoreUnavailableFact {
  status: 'unavailable';
  /**
   * What is known of the Store's identity. A Store that never resolved may
   * carry no permanent identity at all, which is why the display alias is
   * still recorded here — for the MESSAGE. Nothing is keyed on it.
   */
  store: { type: 'store'; uid?: string; id?: string };
  diagnostic: string;
  /** True when this outage must defer cleanup rather than read as empty. */
  relevant: boolean;
  relevance: StoreRelevanceReason[];
  /** Copy-pasteable repair, from child A/B's own resolution failure. */
  repair: string[];
}

export type EffectiveStoreFact =
  | EffectiveStoreMemberFact
  | EffectiveStoreNotMemberFact
  | EffectiveStoreUnavailableFact;

export interface StoreConflictParticipant {
  source: CanonicalKnowledgeIdentity;
  knowledgeKey: string;
  canonicalContentDigest: string;
  /** Display only, so a reader can tell two namesake Stores apart. */
  label: string;
}

export interface StoreSkillConflict {
  id: string;
  /** `effective` blocks reconciliation; `latent` is recorded beside a project winner. */
  kind: 'effective' | 'latent';
  participants: StoreConflictParticipant[];
  guidance: string;
}

export interface EffectiveLearnedSkill {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  /** Every contributing owner, by PERMANENT identity, in durable-key order. */
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

export interface EffectiveLearnedSkillPlan {
  status: 'ready' | 'degraded' | 'blocked';
  project: { type: 'project'; id: string; root: string };
  /** The three roots §15.6 keeps apart, resolved and carried together. */
  canonicalOwnerRoot: string;
  evaluationRoot: string;
  skills: EffectiveLearnedSkill[];
  globalRecords: CanonicalLearnedSkill[];
  stores: EffectiveStoreFact[];
  conflicts: StoreSkillConflict[];
  unavailableStores: EffectiveStoreUnavailableFact[];
  planningErrors: Array<{ code: string; message: string; repair?: string[] }>;
  budgetFailure?: EffectiveDescriptionBudgetFailure;
}

export interface ResolveEffectiveLearnedSkillPlanInput {
  execution: LearnedSkillExecutionContext;
  /**
   * Store identities the PREVIOUS ownership record named. Used only to decide
   * whether an outage is cleanup-relevant — never to widen eligibility.
   */
  previousStores?: readonly StoreIdentityRef[];
}

export interface ResolveEffectiveLearnedSkillRecordsInput {
  /** The checkout applicability is decided against — never the storage location. */
  evaluationRoot: string;
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
  readonly code: 'project_owner_required' | 'project_catalog_unavailable';
  readonly repair: string[];

  constructor(
    message: string,
    code: 'project_owner_required' | 'project_catalog_unavailable',
    repair: string[] = []
  ) {
    super(message);
    this.name = 'EffectiveLearnedSkillPlanningError';
    this.code = code;
    this.repair = repair;
  }
}

/**
 * Owner key plus id — the pair that names one record durably. A Store's
 * display alias contributes nothing, so a rename moves no key and two namesake
 * Stores never collide.
 */
export function identityKey(identity: CanonicalKnowledgeIdentity): string {
  return `${durableOwnerKey(identity.owner)}/${identity.id}`;
}

function compareIdentity(
  left: CanonicalKnowledgeIdentity,
  right: CanonicalKnowledgeIdentity
): number {
  const owner = compareDurableOwners(left.owner, right.owner);
  return owner !== 0 ? owner : left.id.localeCompare(right.id);
}

function effectiveItem(
  record: CanonicalLearnedSkill,
  effectiveScope: EffectiveLearnedSkillScope,
  sources: readonly CanonicalKnowledgeIdentity[],
  contributors: readonly CanonicalLearnedSkill[]
): EffectiveLearnedSkill {
  const sortedSources = [...sources].sort(compareIdentity);
  return {
    id: record.manifest.id,
    effectiveScope,
    sources: sortedSources,
    knowledgeKey: record.manifest.knowledgeKey,
    canonicalContentDigest: record.manifest.contentDigest,
    resolutionDigest: resolutionDigestV2({
      id: record.manifest.id,
      knowledgeKey: record.manifest.knowledgeKey,
      effectiveScope,
      sources: sortedSources,
      canonicalContentDigests: contributors.map((item) => item.manifest.contentDigest),
      record,
    }),
    canonicalRecord: record,
  };
}

/**
 * Applicable, active records only — evaluated against the EVALUATION root.
 *
 * Ordering is by id then durable identity, so nothing downstream can observe
 * the order the catalogs happened to be read in.
 */
function applicable(
  records: readonly CanonicalLearnedSkill[],
  evaluationRoot: string
): CanonicalLearnedSkill[] {
  return records
    .filter(
      (record) =>
        record.manifest.status === 'active' &&
        matchesApplicability(record.manifest.applicability, evaluationRoot)
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
    // Sorted by permanent identity, so the SAME set of Stores produces the
    // same conflict whatever order they were considered in.
    participants: records
      .map((record) => ({
        source: record.identity,
        knowledgeKey: record.manifest.knowledgeKey,
        canonicalContentDigest: record.manifest.contentDigest,
        label: describeDurableOwner(record.identity.owner),
      }))
      .sort((left, right) => compareIdentity(left.source, right.source)),
    guidance:
      'Align the canonical store records exactly, rename one learned skill, or retire the inapplicable revision.',
  };
}

/**
 * Equivalence: ALL FIVE, never four.
 *
 * Same identifier (they are grouped by it), same knowledge key, byte-identical
 * canonical content, identical content digest, and both valid managed records
 * — which every record reaching here already is, because `loadStoreCatalog`
 * returns only records that verified. Content and digest are both compared on
 * purpose: a digest match with differing bytes means one of them was tampered
 * with, and that is a conflict, not a duplicate.
 */
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

/** Pure precedence/equivalence/budget core, exposed for deterministic matrix tests. */
export function resolveEffectiveLearnedSkillRecords(
  input: ResolveEffectiveLearnedSkillRecordsInput
): EffectiveRecordResolution {
  const projectById = groupById(applicable(input.projectRecords, input.evaluationRoot));
  const storeById = groupById(applicable(input.storeRecords, input.evaluationRoot));
  const globalById = groupById(applicable(input.globalRecords, input.evaluationRoot));
  const ids = [...new Set([...projectById.keys(), ...storeById.keys(), ...globalById.keys()])].sort();
  const skills: EffectiveLearnedSkill[] = [];
  const conflicts: StoreSkillConflict[] = [];

  for (const id of ids) {
    const projectGroup = projectById.get(id) ?? [];
    const storeGroup = storeById.get(id) ?? [];
    const globalGroup = globalById.get(id) ?? [];

    if (projectGroup.length > 0) {
      const winner = projectGroup[0]!;
      skills.push(effectiveItem(winner, 'project', [winner.identity], [winner]));
      // A divergence below a project winner is real but not fatal: the project
      // already decided. It is RECORDED so nobody has to discover it later.
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
      // Every copy is the same knowledge, so which object is carried forward
      // is immaterial — but it must still be CHOSEN deterministically, and by
      // permanent identity rather than by a renameable display name.
      const ordered = [...storeGroup].sort((left, right) =>
        compareIdentity(left.identity, right.identity)
      );
      skills.push(
        effectiveItem(
          ordered[0]!,
          'store',
          ordered.map((record) => record.identity),
          ordered
        )
      );
      continue;
    }

    if (globalGroup.length > 0) {
      const winner = globalGroup[0]!;
      skills.push(effectiveItem(winner, 'global', [winner.identity], [winner]));
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
      conflicts.some((conflict) => conflict.kind === 'effective') || budgetFailure !== undefined,
  };
}

// -----------------------------------------------------------------------------
// Eligibility and relevance
// -----------------------------------------------------------------------------

/** A catalog view over an already-resolved Store checkout. */
function storeCatalogAt(root: string, owner: DurableKnowledgeOwnerRef): ResolvedStore {
  return {
    dir: path.join(root, ...STORE_LEARNED_SKILLS_SEGMENTS),
    owner,
    root,
    storeRoot: root,
    // Reading never locks; a lock path is required by the shape and unused here.
    lockPath: '',
  };
}

function sameStore(
  left: { uid?: string; id?: string },
  right: { uid?: string; id?: string }
): boolean {
  if (left.uid !== undefined && right.uid !== undefined) {
    return storeUidsMatch(left.uid, right.uid);
  }
  // Without a permanent identity on both sides the display name is all there
  // is. It is used ONLY to decide relevance — a question whose wrong answer
  // errs towards deferring cleanup, never towards deleting a file.
  return left.id !== undefined && left.id === right.id;
}

/**
 * The Store the project's primary pointer names, by identity where one exists.
 *
 * The pointer confers NO eligibility and no priority — it is read only to
 * decide whether an outage is relevant, which is a question whose wrong answer
 * errs towards deferring a deletion. It goes through the single identity
 * resolver rather than a by-name registry lookup, so a display name shared by
 * two Stores does not silently pick one; when the pointer cannot resolve at
 * all, the declaration's own expectation is enough to match an outage against.
 */
async function resolvePointerStore(
  evaluationRoot: string,
  pathOptions: { globalDataDir?: string }
): Promise<{ uid?: string; id?: string } | undefined> {
  const pointer = readStorePointer(evaluationRoot);
  if (!hasStoreDeclaration(pointer)) return undefined;
  const binding = await resolveStoreBinding({
    declaration: storeBindingDeclarationFrom(pointer),
    projectRoot: evaluationRoot,
    ...pathOptions,
  });
  if (binding.kind === 'resolved') {
    return {
      ...(binding.store.uid !== undefined ? { uid: binding.store.uid } : {}),
      id: binding.store.id,
    };
  }
  if (binding.kind === 'unavailable') {
    return {
      ...(binding.expected.uid !== undefined ? { uid: binding.expected.uid } : {}),
      ...(binding.expected.id !== undefined ? { id: binding.expected.id } : {}),
    };
  }
  return undefined;
}

/**
 * Resolves the whole plan: the eligible Stores, what each of them holds, which
 * outages matter, and what the project therefore receives.
 */
export async function resolveEffectiveLearnedSkillPlan(
  input: ResolveEffectiveLearnedSkillPlanInput
): Promise<EffectiveLearnedSkillPlan> {
  const { execution } = input;
  if (execution.owner.type !== 'project') {
    throw new EffectiveLearnedSkillPlanningError(
      'A resolved project owner is required for project-local learned materialization; a store owner cannot select a member project.',
      'project_owner_required',
      ['rasen knowledge list --project <id>']
    );
  }
  const project = execution.owner;
  const context = { execution };
  const projectResolution = await resolveProjectStore(context);
  if (!projectResolution.ok) {
    throw new EffectiveLearnedSkillPlanningError(
      projectResolution.message,
      'project_catalog_unavailable',
      projectResolution.repair ?? []
    );
  }

  const evaluationRoot = execution.evaluationRoot ?? project.root;
  const projectRecords = loadStoreCatalog(projectResolution.store, 'project');
  const globalRecords = loadStoreCatalog(resolveGlobalStore(context), 'global')
    .filter((record) => record.manifest.status === 'active')
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));

  const planningErrors: EffectiveLearnedSkillPlan['planningErrors'] = [];
  const previousStores = input.previousStores ?? [];
  const pathOptions =
    execution.globalDataDir !== undefined ? { globalDataDir: execution.globalDataDir } : {};
  const pointerStore = await resolvePointerStore(evaluationRoot, pathOptions);
  const frozenPlanningStore =
    execution.source === 'run-state' && execution.planningRoot?.type === 'store'
      ? execution.planningRoot
      : undefined;

  const relevanceFor = (
    candidate: { uid?: string; id?: string },
    sources: ReadonlyArray<'declared' | 'local-record'>
  ): StoreRelevanceReason[] => {
    const reasons = new Set<StoreRelevanceReason>(sources);
    if (previousStores.some((store) => sameStore(store, candidate))) {
      reasons.add('previous-source');
    }
    if (pointerStore && sameStore(pointerStore, candidate)) {
      reasons.add('config-pointer');
    }
    if (frozenPlanningStore && sameStore(frozenPlanningStore, candidate)) {
      reasons.add('frozen-planning-root');
    }
    return [...reasons].sort();
  };

  const storeFacts: EffectiveStoreFact[] = [];
  const memberRecords: CanonicalLearnedSkill[] = [];

  // Eligibility is child B's provider: declared `storeMemberships` UNION the
  // locally available Stores whose own records include this project. The
  // primary planning pointer contributes nothing — planning where a Store
  // lives is a different relation from sharing knowledge with it.
  let listing: Awaited<ReturnType<typeof listProjectStoreCandidates>> | undefined;
  try {
    listing = await listProjectStoreCandidates(evaluationRoot, pathOptions);
  } catch (error) {
    planningErrors.push({
      code: 'store_membership_unavailable',
      message: `The Stores this project may draw on could not be determined, so learned reconciliation is blocked until it is repaired: ${
        error instanceof Error ? error.message : String(error)
      }`,
      repair: ['rasen doctor'],
    });
  }

  for (const candidate of listing?.candidates ?? []) {
    const discovered: Array<'declared' | 'local-record'> = candidate.sources.map((source) =>
      source === 'hint' ? 'declared' : 'local-record'
    );
    const relevance = relevanceFor(candidate, discovered);

    if (candidate.unavailable || !candidate.store) {
      // NEVER read as empty. A declared Store that is not here is a Store whose
      // knowledge is temporarily unknown, and every removal it would imply is
      // deferred rather than performed.
      storeFacts.push({
        status: 'unavailable',
        store: {
          type: 'store',
          ...(candidate.uid !== undefined ? { uid: candidate.uid } : {}),
          ...(candidate.id !== undefined ? { id: candidate.id } : {}),
        },
        diagnostic:
          candidate.diagnostics[0]?.message ??
          `store ${candidate.id ?? candidate.uid ?? '<unknown>'} could not be reached on this machine (${
            candidate.unavailable?.reason ?? 'unresolved'
          })`,
        relevant: relevance.length > 0,
        relevance,
        repair: candidate.unavailable?.repair ?? ['rasen store list', 'rasen doctor'],
      });
      continue;
    }

    const store = candidate.store;
    if (store.uid === undefined) {
      // A Store with no permanent identity cannot own a durable record, so it
      // cannot contribute a source either. Refusing here is the same refusal
      // the write path makes, for the same reason.
      storeFacts.push({
        status: 'unavailable',
        store: { type: 'store', id: store.id },
        diagnostic: `store '${store.id}' has no permanent identity yet, so records it holds cannot be attributed durably.`,
        relevant: relevance.length > 0,
        relevance,
        repair: [`rasen store upgrade-identity ${store.id}`],
      });
      continue;
    }

    const owner: StoreIdentityRef = { type: 'store', uid: store.uid, id: store.id };
    if (!candidate.membership?.roles.knowledge) {
      storeFacts.push({ status: 'not-member', store: owner, relevance });
      continue;
    }

    try {
      const catalog = loadStoreCatalog(storeCatalogAt(store.root, owner), 'store')
        .filter((record) => record.manifest.status === 'active')
        .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
      storeFacts.push({ status: 'member', store: owner, relevance, catalog });
      memberRecords.push(...catalog);
    } catch (error) {
      storeFacts.push({
        status: 'unavailable',
        store: owner,
        diagnostic: `store ${describeDurableOwner(owner)} holds a catalog that could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        relevant: relevance.length > 0,
        relevance,
        repair: ['rasen doctor'],
      });
    }
  }

  const resolved = resolveEffectiveLearnedSkillRecords({
    evaluationRoot,
    projectRecords,
    storeRecords: memberRecords,
    globalRecords,
  });

  const byLabel = (fact: EffectiveStoreFact): string =>
    fact.store.uid ?? fact.store.id ?? '';
  const unavailableStores = storeFacts
    .filter((fact): fact is EffectiveStoreUnavailableFact => fact.status === 'unavailable')
    .sort((left, right) => byLabel(left).localeCompare(byLabel(right)));

  return {
    status:
      resolved.blocked || planningErrors.length > 0
        ? 'blocked'
        : unavailableStores.some((store) => store.relevant)
          ? 'degraded'
          : 'ready',
    project,
    canonicalOwnerRoot: projectResolution.store.root,
    evaluationRoot,
    skills: resolved.skills,
    globalRecords,
    stores: storeFacts.sort((left, right) => byLabel(left).localeCompare(byLabel(right))),
    conflicts: resolved.conflicts,
    unavailableStores,
    planningErrors,
    ...(resolved.budgetFailure ? { budgetFailure: resolved.budgetFailure } : {}),
  };
}
