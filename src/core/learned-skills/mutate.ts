/**
 * The two caller-facing write operations (design D4): `planLearnedSkillMutation`
 * validates and computes a deterministic plan (identity, ownership, budgets,
 * publication authority) without touching disk; `commitLearnedSkillPlan`
 * executes an unblocked plan under a per-owner lock with private staging,
 * digest re-verification, atomic replacement, and rollback. Persistence
 * authority stays in deterministic TypeScript, never in stochastic skill
 * instructions.
 *
 * Three properties hold on every path and are what the Store scope depends on:
 *
 * - **A refusal writes nothing.** Not a record, not a file, not an ownership
 *   entry. Reporting what evidence exists and what is missing is the output.
 * - **Nothing is staged, committed, or pushed.** A mutation reports the files
 *   the user needs to commit; the git index is never touched.
 * - **Everything durable names its owner permanently.** What lands on disk is
 *   checked, not what the summary line says.
 */

import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { acquireOwnerAwareFileLock, releaseOwnerAwareFileLock } from '../file-state.js';
import { storeUidsMatch } from '../store/identity-types.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  buildCanonicalContent,
  buildManifestV1,
  buildManifestV2,
  dedupeEvidence,
  dedupeTypedEvidence,
  digestContent,
  evidenceTupleKey,
  normalizeEvidence,
  readCanonicalRecord,
  serializeManifest,
} from './catalog.js';
import {
  LEARNED_SKILL_BACKUP_PREFIX,
  LEARNED_SKILL_CONTENT_BUDGET,
  LEARNED_SKILL_CONTENT_FILE,
  LEARNED_SKILL_CONTEXT_BUDGET,
  LEARNED_SKILL_MANIFEST_FILE,
  LEARNED_SKILL_MANIFEST_V1_VERSION,
  LEARNED_SKILL_PROMOTION_MIN_SOURCES,
  LEARNED_SKILL_STAGING_PREFIX,
} from './constants.js';
import { LearnedSkillManifestSchema } from './schema.js';
import { checkLearnedSkillId, learnedSkillIdCollisionKey } from './id.js';
import { validateApplicability } from './applicability.js';
import {
  canonicalPathsEqual,
  learnedSkillDir,
  probeStoreWritable,
  resolveCanonicalStore,
  type ResolvedStore,
} from './stores.js';
import {
  describeDurableOwner,
  durableOwnerKey,
  sameDurableOwner,
} from './owner-identity.js';
import {
  promotionSnapshotsEqual,
  queryStoreMemberProjects,
  resolvePromotionSources,
  sourceProjectIds,
} from './authority.js';
import type {
  Applicability,
  CanonicalKnowledgeIdentity,
  DurableEvidenceOwnerRef,
  DurableKnowledgeOwnerRef,
  EvidenceReference,
  LearnedSkillBlock,
  LearnedSkillContext,
  LearnedSkillManifest,
  LearnedSkillMutationRequest,
  LearnedSkillPlan,
  LearnedSkillResult,
  LearnedSkillScope,
  NormalizedEvidenceReference,
  PromotionSourceLocator,
  PromotionSourceSnapshot,
} from './types.js';

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

// -----------------------------------------------------------------------------
// Identity plumbing
// -----------------------------------------------------------------------------

/**
 * The best identity available for a plan that never got as far as resolving
 * its catalog. A blocked plan still has to say WHAT it refused to write, and
 * the caller's declared owner is the only honest answer at that point.
 */
function provisionalIdentity(
  scope: LearnedSkillScope,
  id: string,
  context: LearnedSkillContext,
  requested?: DurableKnowledgeOwnerRef
): CanonicalKnowledgeIdentity {
  if (requested && requested.type === scope) return { owner: requested, id };
  const resolved = context.execution?.owner;
  if (scope === 'global') return { owner: { type: 'global' }, id };
  if (scope === 'project' && resolved?.type === 'project') {
    return { owner: { type: 'project', projectId: resolved.id }, id };
  }
  if (scope === 'store' && resolved?.type === 'store' && resolved.uid !== undefined) {
    return { owner: { type: 'store', uid: resolved.uid, id: resolved.id }, id };
  }
  // Nothing durable resolved. `uid: ''` / `projectId: ''` is never written —
  // a blocked plan carries no commit payload — and it keeps the reported
  // identity's SHAPE honest instead of pretending an owner was known.
  return {
    owner:
      scope === 'store' ? { type: 'store', uid: '' } : { type: 'project', projectId: '' },
    id,
  };
}

function blockedPlan(
  scope: LearnedSkillScope,
  id: string,
  block: LearnedSkillBlock,
  context: LearnedSkillContext,
  requestedOwner?: DurableKnowledgeOwnerRef
): LearnedSkillPlan {
  return {
    action: 'blocked',
    scope,
    id,
    identity: provisionalIdentity(scope, id, context, requestedOwner),
    sourceIdentities: [],
    requiresGlobalApproval: false,
    requiresStoreApproval: false,
    block,
    summary: `blocked: ${block.message}`,
  };
}

/**
 * The declared owner, the resolved owner, and the requested scope must all
 * agree before anything is planned. The candidate is untrusted input, so its
 * claim is checked against the resolved context rather than believed.
 */
function validateTargetOwner(
  scope: LearnedSkillScope,
  requested: DurableKnowledgeOwnerRef | undefined,
  context: LearnedSkillContext
): LearnedSkillBlock | undefined {
  if (requested && requested.type !== scope) {
    return {
      code: 'knowledge_owner_scope_mismatch',
      message: `candidate owner ${describeDurableOwner(requested)} does not match ${scope} scope`,
    };
  }
  const resolved = context.execution?.owner;
  if (!resolved) return undefined;
  if (resolved.type !== scope) {
    return {
      code: 'knowledge_owner_scope_mismatch',
      message: `${scope} learned-skill scope does not agree with the resolved ${resolved.type}${
        resolved.type === 'global' ? '' : `:${resolved.id}`
      } owner`,
    };
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// Evidence shaping
// -----------------------------------------------------------------------------

function evidenceEqual(
  left: readonly (EvidenceReference | NormalizedEvidenceReference)[],
  right: readonly (EvidenceReference | NormalizedEvidenceReference)[]
): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(evidenceTupleKey));
  return left.every((entry) => rightKeys.has(evidenceTupleKey(entry)));
}

function applicabilityEqual(left: Applicability, right: Applicability): boolean {
  return (
    left.mode === right.mode &&
    left.markers.length === right.markers.length &&
    left.markers.every((marker, index) => marker === right.markers[index])
  );
}

function isV1Evidence(
  evidence: readonly EvidenceReference[] | readonly NormalizedEvidenceReference[]
): evidence is readonly EvidenceReference[] {
  return evidence.every((entry) => 'projectId' in entry);
}

/** Version 1 evidence read as durable evidence, without touching any file. */
function typedEvidence(
  evidence: readonly EvidenceReference[] | readonly NormalizedEvidenceReference[]
): NormalizedEvidenceReference[] {
  return evidence.map((entry) =>
    'projectId' in entry
      ? {
          owner: { type: 'project' as const, projectId: entry.projectId },
          change: entry.change,
          artifact: entry.artifact,
          digest: entry.digest,
        }
      : entry
  );
}

/**
 * Durable evidence projected back onto the version 1 shape, or undefined when
 * it carries provenance version 1 cannot express. Undefined is the signal to
 * write version 2 rather than to drop the provenance.
 */
function v1Evidence(
  evidence: readonly NormalizedEvidenceReference[]
): EvidenceReference[] | undefined {
  if (evidence.some((entry) => entry.owner.type !== 'project')) return undefined;
  return evidence.map((entry) => ({
    projectId: (entry.owner as Extract<DurableEvidenceOwnerRef, { type: 'project' }>).projectId,
    change: entry.change,
    artifact: entry.artifact,
    digest: entry.digest,
  }));
}

/**
 * The source locators a version 1 candidate implies: one per contributing
 * project, each claiming that project owns this exact record under this exact
 * knowledge key. Making the claim explicit is what lets it be VERIFIED — the
 * previous rule counted self-declared project ids in an array.
 */
function v1Locators(
  id: string,
  knowledgeKey: string,
  evidence: readonly EvidenceReference[]
): PromotionSourceLocator[] {
  const seen = new Set<string>();
  const locators: PromotionSourceLocator[] = [];
  for (const entry of evidence) {
    if (seen.has(entry.projectId)) continue;
    seen.add(entry.projectId);
    locators.push({
      owner: { type: 'project', projectId: entry.projectId },
      id,
      knowledgeKey,
    });
  }
  return locators;
}

interface WriteContent {
  version: 1 | 2;
  owner?: DurableKnowledgeOwnerRef;
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[] | NormalizedEvidenceReference[];
  sources: PromotionSourceLocator[];
}

interface PublicationAuthority {
  snapshots: PromotionSourceSnapshot[];
  evidence: NormalizedEvidenceReference[];
  locators: PromotionSourceLocator[];
}

/**
 * The publication gate for a scope wider than one project.
 *
 * Independence is counted per DISTINCT owner: the same project contributing
 * repeatedly is one contributor, not several. Homogeneity is required because
 * combining a project source with a Store source produces a record whose
 * provenance nobody can reason about.
 */
async function publicationAuthority(
  scope: LearnedSkillScope,
  store: ResolvedStore,
  content: WriteContent,
  context: LearnedSkillContext
): Promise<{ ok: true; authority: PublicationAuthority } | { ok: false; block: LearnedSkillBlock }> {
  if (scope === 'project') {
    return {
      ok: true,
      authority: { snapshots: [], evidence: typedEvidence(content.evidence), locators: [] },
    };
  }

  const insufficient = scope === 'store' ? 'store_evidence_insufficient' : 'global_evidence_insufficient';
  const requested =
    content.version === 1 && isV1Evidence(content.evidence)
      ? v1Locators(content.id, content.knowledgeKey, content.evidence)
      : [...content.sources];
  if (requested.length === 0) {
    return {
      ok: false,
      block: {
        code: 'promotion_source_invalid',
        message: `${scope} publication must name the exact managed records it draws on`,
      },
    };
  }

  let resolved;
  try {
    resolved = await resolvePromotionSources(requested, content.knowledgeKey, context);
  } catch (error) {
    return {
      ok: false,
      block: {
        code: 'promotion_source_invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const classes = new Set(resolved.snapshots.map((snapshot) => snapshot.identity.owner.type));
  if (classes.size > 1) {
    return {
      ok: false,
      block: {
        code: 'promotion_source_mixed',
        message: `${scope} publication requires sources of one kind — project sources or store sources, never a mixture`,
      },
    };
  }
  if (scope === 'store' && !classes.has('project')) {
    return {
      ok: false,
      block: {
        code: insufficient,
        message: 'store publication draws on its member projects, so every source must be a project record',
      },
    };
  }

  // Repeated evidence from one owner counts ONCE. Collapsing rather than
  // rejecting is the difference between "you sent the same thing twice" and
  // "you have not convinced two projects yet".
  const distinctOwners = new Set(
    resolved.snapshots.map((snapshot) => durableOwnerKey(snapshot.identity.owner))
  );
  if (distinctOwners.size < LEARNED_SKILL_PROMOTION_MIN_SOURCES) {
    return {
      ok: false,
      block: {
        code: insufficient,
        message: `${scope} scope requires independent evidence from at least ${LEARNED_SKILL_PROMOTION_MIN_SOURCES} distinct ${
          [...classes][0] ?? 'eligible'
        } sources; ${distinctOwners.size} distinct source${distinctOwners.size === 1 ? '' : 's'} contributed`,
      },
    };
  }

  if (scope === 'store') {
    const membershipBlock = await membershipRefusal(store, resolved.snapshots, context);
    if (membershipBlock) return { ok: false, block: membershipBlock };
  }

  return {
    ok: true,
    authority: {
      snapshots: resolved.snapshots,
      evidence: resolved.evidence,
      locators: resolved.snapshots.map((snapshot) => snapshot.locator),
    },
  };
}

/**
 * Every source must be a project the Store itself records as a knowledge
 * member. A project that is merely recorded for planning is named separately,
 * because "you are not in the roster" and "you are in the roster for something
 * else" have different repairs and telling a user the wrong one wastes an hour.
 */
async function membershipRefusal(
  store: ResolvedStore,
  snapshots: readonly PromotionSourceSnapshot[],
  context: LearnedSkillContext
): Promise<LearnedSkillBlock | undefined> {
  let membership;
  try {
    membership = await queryStoreMemberProjects(store, context);
  } catch (error) {
    return {
      code: 'store_membership_invalid',
      message: `store membership could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      repair: ['rasen store doctor'],
    };
  }

  const knowledgeMembers = new Set(membership.members.map((member) => member.projectId));
  const planningOnly = new Set(membership.nonKnowledgeMembers.map((member) => member.projectId));
  const contributors = sourceProjectIds(snapshots);
  const missing = [...new Set(contributors.filter((id) => !knowledgeMembers.has(id)))].sort();
  if (missing.length === 0) return undefined;

  const recorded = missing.filter((id) => planningOnly.has(id));
  const unrecorded = missing.filter((id) => !planningOnly.has(id));
  const selector = membership.store.id;
  const detail = [
    unrecorded.length > 0
      ? `store '${selector}' has no membership record for ${unrecorded.join(', ')}`
      : '',
    recorded.length > 0
      ? `store '${selector}' records ${recorded.join(', ')} for planning only, not for knowledge`
      : '',
  ]
    .filter(Boolean)
    .join('; ');

  return {
    code: 'store_membership_invalid',
    message: `${detail}. Evidence from a project the store does not record as a knowledge member does not count.`,
    repair: missing.map(
      (id) => `rasen store add-project ${selector} --project ${id}`
    ),
  };
}

// -----------------------------------------------------------------------------
// Planning
// -----------------------------------------------------------------------------

async function planWrite(
  scope: LearnedSkillScope,
  content: WriteContent,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const refuse = (block: LearnedSkillBlock): LearnedSkillPlan =>
    blockedPlan(scope, content.id, block, context, content.owner);

  const ownerBlock = validateTargetOwner(scope, content.owner, context);
  if (ownerBlock) return refuse(ownerBlock);

  if (scope === 'store' && content.version !== 2) {
    return refuse({
      code: 'invalid_request',
      message:
        'a store record must be submitted as a version 2 candidate — version 1 has nowhere to record the store’s permanent identity',
    });
  }

  const idCheck = checkLearnedSkillId(content.id);
  if (!idCheck.valid) {
    return refuse({
      code: 'invalid_id',
      message: `invalid learned-skill id "${content.id}": ${idCheck.violations.join('; ')}`,
    });
  }

  const applicabilityCheck = validateApplicability(content.applicability);
  if (!applicabilityCheck.valid || !applicabilityCheck.normalized) {
    return refuse({
      code: 'invalid_applicability',
      message: `invalid applicability: ${applicabilityCheck.violations.join('; ')}`,
    });
  }
  const applicability = applicabilityCheck.normalized;

  const contentBytes = bytes(content.description) + bytes(content.instructions);
  if (contentBytes > LEARNED_SKILL_CONTENT_BUDGET) {
    return refuse({
      code: 'content_budget_exceeded',
      message: `generated content for "${content.id}" is ${contentBytes} bytes, over the LEARNED_SKILL_CONTENT_BUDGET of ${LEARNED_SKILL_CONTENT_BUDGET}; bound or split the procedure`,
    });
  }
  const evidenceBytes = bytes(JSON.stringify(content.evidence));
  if (evidenceBytes > LEARNED_SKILL_CONTEXT_BUDGET) {
    return refuse({
      code: 'context_budget_exceeded',
      message: `evidence for "${content.id}" is ${evidenceBytes} bytes, over the LEARNED_SKILL_CONTEXT_BUDGET of ${LEARNED_SKILL_CONTEXT_BUDGET}; narrow the evidence or split the candidate`,
    });
  }
  // A store or global record draws its provenance from its named sources, so
  // its own evidence array may legitimately be empty; a project record is the
  // origin of provenance and cannot be.
  if (content.evidence.length === 0 && scope === 'project') {
    return refuse({
      code: 'invalid_evidence',
      message: `learned skill "${content.id}" must carry at least one evidence reference`,
    });
  }

  const storeResult = await resolveCanonicalStore(scope, context);
  if (!storeResult.ok) {
    return refuse({
      code: storeResult.code,
      message: storeResult.message,
      ...(storeResult.repair ? { repair: storeResult.repair } : {}),
    });
  }
  const store = storeResult.store;

  // The candidate's declared owner is compared against the AUTHORITATIVE one,
  // by permanent identity. A candidate naming a Store by a display alias that
  // now points elsewhere fails here rather than publishing into the namesake.
  if (content.owner && !sameDurableOwner(content.owner, store.owner)) {
    return refuse({
      code: 'knowledge_candidate_owner_mismatch',
      message: `candidate owner ${describeDurableOwner(content.owner)} is not the authoritative owner ${describeDurableOwner(store.owner)}`,
    });
  }

  if (scope === 'project' && store.owner.type === 'project') {
    const projectId = store.owner.projectId;
    const foreign = typedEvidence(content.evidence).some(
      (entry) => entry.owner.type !== 'project' || entry.owner.projectId !== projectId
    );
    if (foreign) {
      return refuse({
        code: 'knowledge_candidate_owner_mismatch',
        message: `candidate evidence must come from the authoritative project '${projectId}'`,
      });
    }
  }

  const writable = await probeStoreWritable(store);
  if (!writable.ok) {
    return refuse({ code: 'store_unwritable', message: writable.message });
  }

  const directory = learnedSkillDir(store, content.id);
  const existing = readCanonicalRecord(directory, scope, store.owner);
  if (existing.kind === 'unmanaged') {
    return refuse({
      code: 'ownership_collision',
      message: `cannot write learned skill "${content.id}": ${existing.reason}`,
    });
  }

  const gate = await publicationAuthority(scope, store, content, context);
  if (!gate.ok) return refuse(gate.block);
  const authority = gate.authority;

  const now = new Date().toISOString();
  const createdAt = existing.kind === 'managed' ? existing.record.manifest.createdAt : now;
  const canonicalContent = buildCanonicalContent(content.id, content.description, content.instructions);
  const contentDigest = digestContent(canonicalContent);

  // Version 1 stays the written shape whenever it can express everything the
  // record now holds. Bumping a project record to version 2 because an
  // unrelated feature shipped would report every user's catalog as modified.
  const canWriteV1 =
    content.version === 1 &&
    scope !== 'store' &&
    (existing.kind !== 'managed' ||
      existing.record.manifest.version === LEARNED_SKILL_MANIFEST_V1_VERSION);

  let manifest: LearnedSkillManifest;
  if (canWriteV1) {
    const authoritativeV1 =
      scope === 'project' && isV1Evidence(content.evidence)
        ? [...content.evidence]
        : v1Evidence(authority.evidence);
    if (!authoritativeV1) {
      return refuse({
        code: 'invalid_evidence',
        message: 'store-typed provenance cannot be recorded in a version 1 manifest',
      });
    }
    const previous =
      existing.kind === 'managed' &&
      existing.record.manifest.version === LEARNED_SKILL_MANIFEST_V1_VERSION
        ? existing.record.manifest.evidence
        : [];
    manifest = buildManifestV1({
      id: content.id,
      knowledgeKey: content.knowledgeKey,
      scope: scope as 'project' | 'global',
      contentDigest,
      description: content.description,
      applicability,
      evidence: dedupeEvidence([...previous, ...authoritativeV1]),
      createdAt,
      updatedAt: now,
    });
  } else {
    const previous = existing.kind === 'managed' ? normalizeEvidence(existing.record.manifest) : [];
    manifest = buildManifestV2({
      id: content.id,
      knowledgeKey: content.knowledgeKey,
      scope,
      owner: store.owner,
      contentDigest,
      description: content.description,
      applicability,
      evidence: dedupeTypedEvidence([...previous, ...authority.evidence]),
      sources: authority.locators,
      createdAt,
      updatedAt: now,
    });
  }

  let action: LearnedSkillPlan['action'];
  if (existing.kind === 'absent') {
    action = 'create';
  } else {
    const prior = existing.record.manifest;
    const unchanged =
      prior.status === 'active' &&
      prior.version === manifest.version &&
      prior.contentDigest === manifest.contentDigest &&
      prior.description === manifest.description &&
      prior.knowledgeKey === manifest.knowledgeKey &&
      applicabilityEqual(prior.applicability, manifest.applicability) &&
      evidenceEqual(prior.evidence, manifest.evidence) &&
      (prior.version === LEARNED_SKILL_MANIFEST_V1_VERSION ||
        (manifest.version !== LEARNED_SKILL_MANIFEST_V1_VERSION &&
          JSON.stringify(prior.sources) === JSON.stringify(manifest.sources)));
    action = unchanged ? 'no-op' : 'rewrite';
  }

  const identity: CanonicalKnowledgeIdentity = { owner: store.owner, id: content.id };
  const base = {
    scope,
    id: content.id,
    identity,
    sourceIdentities: authority.snapshots.map((snapshot) => snapshot.identity),
    knowledgeKey: content.knowledgeKey,
    applicability,
    requiresGlobalApproval: scope === 'global',
    requiresStoreApproval: scope === 'store',
  };

  if (action === 'no-op') {
    return { ...base, action, summary: `no change: "${content.id}" already reflects this evidence` };
  }

  return {
    ...base,
    action,
    summary: `${action} ${scope} learned skill "${content.id}"`,
    commit: {
      scope,
      action,
      directory,
      manifest,
      content: canonicalContent,
      lockPath: store.lockPath,
      expectedContentDigest: contentDigest,
      expectedTarget:
        existing.kind === 'absent'
          ? { kind: 'absent' }
          : {
              kind: 'managed',
              contentDigest: existing.record.manifest.contentDigest,
              manifestDigest: digestContent(serializeManifest(existing.record.manifest)),
              updatedAt: existing.record.manifest.updatedAt,
            },
      sourceSnapshots: authority.snapshots,
      ...(store.owner.type === 'store'
        ? { targetStoreUid: store.owner.uid, targetStoreRoot: store.root }
        : {}),
    },
  };
}

type ManagedRecord = Extract<ReturnType<typeof readCanonicalRecord>, { kind: 'managed' }>['record'];

async function resolveManagedTarget(
  scope: LearnedSkillScope,
  id: string,
  context: LearnedSkillContext
): Promise<
  { ok: true; store: ResolvedStore; record: ManagedRecord } | { ok: false; plan: LearnedSkillPlan }
> {
  const storeResult = await resolveCanonicalStore(scope, context);
  if (!storeResult.ok) {
    return {
      ok: false,
      plan: blockedPlan(
        scope,
        id,
        {
          code: storeResult.code,
          message: storeResult.message,
          ...(storeResult.repair ? { repair: storeResult.repair } : {}),
        },
        context
      ),
    };
  }
  const read = readCanonicalRecord(
    learnedSkillDir(storeResult.store, id),
    scope,
    storeResult.store.owner
  );
  if (read.kind === 'absent') {
    return {
      ok: false,
      plan: blockedPlan(scope, id, { code: 'not_found', message: `no learned skill "${id}" was found` }, context),
    };
  }
  if (read.kind === 'unmanaged') {
    return {
      ok: false,
      plan: blockedPlan(scope, id, { code: 'not_managed', message: `cannot mutate "${id}": ${read.reason}` }, context),
    };
  }
  return { ok: true, store: storeResult.store, record: read.record };
}

async function planRetire(
  request: Extract<LearnedSkillMutationRequest, { operation: 'retire' }>,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const { scope, id } = request;
  const ownerBlock = validateTargetOwner(scope, request.owner, context);
  if (ownerBlock) return blockedPlan(scope, id, ownerBlock, context, request.owner);

  const idCheck = checkLearnedSkillId(id);
  if (!idCheck.valid) {
    return blockedPlan(
      scope,
      id,
      { code: 'invalid_id', message: `invalid learned-skill id "${id}": ${idCheck.violations.join('; ')}` },
      context,
      request.owner
    );
  }

  const target = await resolveManagedTarget(scope, id, context);
  if (!target.ok) return target.plan;

  if (target.record.manifest.status === 'retired') {
    return {
      action: 'no-op',
      scope,
      id,
      identity: target.record.identity,
      sourceIdentities: [],
      knowledgeKey: target.record.manifest.knowledgeKey,
      requiresGlobalApproval: false,
      requiresStoreApproval: false,
      summary: `no change: "${id}" is already retired`,
    };
  }

  const now = new Date().toISOString();
  const manifest: LearnedSkillManifest = {
    ...target.record.manifest,
    status: 'retired',
    updatedAt: now,
    retiredAt: now,
    ...(request.retirementReason ? { retirementReason: request.retirementReason } : {}),
  };
  return {
    action: 'retire',
    scope,
    id,
    identity: target.record.identity,
    sourceIdentities: [],
    knowledgeKey: manifest.knowledgeKey,
    requiresGlobalApproval: false,
    requiresStoreApproval: false,
    summary: `retire ${scope} learned skill "${id}"`,
    commit: {
      scope,
      action: 'retire',
      directory: target.record.directory,
      manifest,
      content: target.record.content,
      lockPath: target.store.lockPath,
      expectedContentDigest: target.record.manifest.contentDigest,
      expectedTarget: {
        kind: 'managed',
        contentDigest: target.record.manifest.contentDigest,
        manifestDigest: digestContent(serializeManifest(target.record.manifest)),
        updatedAt: target.record.manifest.updatedAt,
      },
      ...(target.store.owner.type === 'store'
        ? { targetStoreUid: target.store.owner.uid, targetStoreRoot: target.store.root }
        : {}),
    },
  };
}

/** Strips a leading `---\n…\n---\n` YAML frontmatter block, returning the body. */
function stripFrontmatter(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

async function planRename(
  request: Extract<LearnedSkillMutationRequest, { operation: 'rename' }>,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const { scope, fromId, toId } = request;
  // A Store record's id is part of what its member projects were shown when
  // the publication was approved. Renaming it in place would move approved
  // knowledge to a name nobody approved; the honest route is publish + retire.
  if (scope === 'store') {
    return blockedPlan(
      scope,
      toId,
      {
        code: 'invalid_request',
        message:
          'a store learned skill cannot be renamed in place; publish the intended record and retire the old one',
      },
      context
    );
  }

  const toCheck = checkLearnedSkillId(toId);
  if (!toCheck.valid) {
    return blockedPlan(
      scope,
      toId,
      { code: 'invalid_id', message: `invalid target id "${toId}": ${toCheck.violations.join('; ')}` },
      context
    );
  }
  if (learnedSkillIdCollisionKey(fromId) === learnedSkillIdCollisionKey(toId)) {
    return blockedPlan(
      scope,
      toId,
      { code: 'invalid_request', message: `rename source and target resolve to the same id "${toId}"` },
      context
    );
  }

  const source = await resolveManagedTarget(scope, fromId, context);
  if (!source.ok) return source.plan;

  const toDirectory = learnedSkillDir(source.store, toId);
  const occupied = readCanonicalRecord(toDirectory, scope, source.store.owner);
  if (occupied.kind !== 'absent') {
    return blockedPlan(
      scope,
      toId,
      { code: 'ownership_collision', message: `target id "${toId}" is already occupied` },
      context
    );
  }

  const canonicalContent = buildCanonicalContent(
    toId,
    source.record.manifest.description,
    // The body after the frontmatter is the record's instructions; a rename
    // rewrites only the frontmatter `name`, so re-derive from stored content.
    stripFrontmatter(source.record.content)
  );
  const contentDigest = digestContent(canonicalContent);
  const manifest: LearnedSkillManifest = {
    ...source.record.manifest,
    id: toId,
    contentDigest,
    updatedAt: new Date().toISOString(),
  };
  return {
    action: 'rename',
    scope,
    id: toId,
    identity: { owner: source.store.owner, id: toId },
    sourceIdentities: [],
    knowledgeKey: manifest.knowledgeKey,
    requiresGlobalApproval: false,
    requiresStoreApproval: false,
    summary: `rename ${scope} learned skill "${fromId}" -> "${toId}"`,
    commit: {
      scope,
      action: 'rename',
      directory: toDirectory,
      fromDirectory: source.record.directory,
      manifest,
      content: canonicalContent,
      lockPath: source.store.lockPath,
      expectedContentDigest: contentDigest,
      expectedTarget: { kind: 'absent' },
      expectedFrom: {
        contentDigest: source.record.manifest.contentDigest,
        manifestDigest: digestContent(serializeManifest(source.record.manifest)),
        updatedAt: source.record.manifest.updatedAt,
      },
    },
  };
}

export async function planLearnedSkillMutation(
  request: LearnedSkillMutationRequest,
  context: LearnedSkillContext = {}
): Promise<LearnedSkillPlan> {
  switch (request.operation) {
    case 'upsert':
      return planWrite(request.scope, writeContentFrom(request), context);
    case 'promote':
      return planWrite('global', writeContentFrom(request), context);
    case 'retire':
      return planRetire(request, context);
    case 'rename':
      return planRename(request, context);
  }
}

function writeContentFrom(
  request: Extract<LearnedSkillMutationRequest, { operation: 'upsert' | 'promote' }>
): WriteContent {
  return {
    version: request.version ?? 1,
    ...(request.owner ? { owner: request.owner } : {}),
    id: request.id,
    knowledgeKey: request.knowledgeKey,
    description: request.description,
    instructions: request.instructions,
    applicability: request.applicability,
    evidence: request.evidence,
    sources: request.sources ?? [],
  };
}

// -----------------------------------------------------------------------------
// Committing
// -----------------------------------------------------------------------------

/** Atomically writes a fresh learned-skill directory (manifest + content) at `directory`. */
function writeCanonicalDirectory(
  directory: string,
  manifest: LearnedSkillManifest,
  content: string,
  expectedContentDigest: string | undefined
): void {
  const parent = path.dirname(directory);
  fs.mkdirSync(parent, { recursive: true });
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const staging = path.join(parent, `${LEARNED_SKILL_STAGING_PREFIX}${path.basename(directory)}-${suffix}`);
  const backup = path.join(parent, `${LEARNED_SKILL_BACKUP_PREFIX}${path.basename(directory)}-${suffix}`);

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const contentPath = path.join(staging, LEARNED_SKILL_CONTENT_FILE);
    fs.writeFileSync(path.join(staging, LEARNED_SKILL_MANIFEST_FILE), serializeManifest(manifest), {
      mode: 0o600,
    });
    fs.writeFileSync(contentPath, content, { mode: 0o600 });

    // Re-verify the staged content digest before swapping it into place.
    if (expectedContentDigest !== undefined) {
      const staged = fs.readFileSync(contentPath, 'utf-8');
      if (digestContent(staged) !== expectedContentDigest) {
        throw new Error(`staged content digest mismatch for ${directory}`);
      }
    }

    if (!fs.existsSync(directory)) {
      fs.renameSync(staging, directory);
      return;
    }
    // Rewrite: move the current record aside, swap in the new one, then remove
    // the backup. Restore the backup if the swap fails, so an interruption
    // leaves the catalog reading exactly as it did before.
    fs.renameSync(directory, backup);
    try {
      fs.renameSync(staging, directory);
    } catch (error) {
      if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
      fs.renameSync(backup, directory);
      throw error;
    }
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, directory);
      throw error;
    }
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Recovers and clears debris a mutation killed mid-swap left behind.
 *
 * The rename pair is not atomic against process death: a SIGKILL between
 * `directory -> backup` and `staging -> directory` leaves the record ABSENT,
 * with the previous copy sitting under a backup name. The `catch` restore only
 * covers a thrown error. Since a catalog lives inside the user's Store
 * repository, the debris also shows up in `git status` and nothing sweeps it.
 *
 * Run under the lock, so nothing else is mid-swap in this catalog:
 *
 * - **staging** is never the only copy of anything — the record it was going to
 *   become is reproducible from the plan — so it is simply removed;
 * - **backup** whose record directory is absent is RESTORED, not deleted: it is
 *   the previous record and deleting it would turn "recoverable" into "lost";
 * - **backup** whose record directory exists lost its race and is removed;
 * - a backup whose own manifest cannot be read is left strictly alone, because
 *   nothing here may delete a directory it cannot identify.
 *
 * Best-effort throughout: failing to tidy must never fail the mutation.
 */
function sweepMutationDebris(catalogDirectory: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(catalogDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(catalogDirectory, entry.name);
    try {
      if (entry.name.startsWith(LEARNED_SKILL_STAGING_PREFIX)) {
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      if (!entry.name.startsWith(LEARNED_SKILL_BACKUP_PREFIX)) continue;
      // The record's own manifest names it — parsing the id back out of the
      // debris filename would guess, and an id may itself contain hyphens.
      const manifestPath = path.join(full, LEARNED_SKILL_MANIFEST_FILE);
      const parsed = LearnedSkillManifestSchema.safeParse(
        parseYaml(fs.readFileSync(manifestPath, 'utf-8'))
      );
      if (!parsed.success) continue;
      const restored = path.join(catalogDirectory, (parsed.data as LearnedSkillManifest).id);
      if (fs.existsSync(restored)) fs.rmSync(full, { recursive: true, force: true });
      else fs.renameSync(full, restored);
    } catch {
      // Leave anything we could not act on; debris is cheaper than damage.
    }
  }
}

/**
 * Whether the target is still what the plan was made against. The plan-time
 * read was unlocked, so the target may have changed in the plan→commit window
 * (a human-authored directory appearing on the id, a concurrent writer, a
 * deletion). Never clobber whatever now occupies the id.
 */
function targetChanged(
  payload: NonNullable<LearnedSkillPlan['commit']>,
  current: ReturnType<typeof readCanonicalRecord>
): LearnedSkillBlock | undefined {
  const expected = payload.expectedTarget;
  if (!expected) return undefined;
  if (expected.kind === 'absent') {
    return current.kind === 'absent'
      ? undefined
      : {
          code: 'ownership_collision',
          message: `cannot ${payload.action} into "${payload.directory}": it was occupied after planning; re-run to merge or resolve the collision`,
        };
  }
  if (current.kind === 'absent') {
    return { code: 'not_found', message: `the managed record disappeared after planning; nothing to ${payload.action}` };
  }
  if (current.kind === 'unmanaged') {
    return { code: 'not_managed', message: current.reason };
  }
  if (
    current.record.manifest.contentDigest !== expected.contentDigest ||
    digestContent(serializeManifest(current.record.manifest)) !== expected.manifestDigest ||
    current.record.manifest.updatedAt !== expected.updatedAt
  ) {
    return {
      code: 'promotion_source_drift',
      message: 'the managed record changed after planning; re-plan before committing',
    };
  }
  return undefined;
}

/** The files this mutation wrote — what the user needs to commit themselves. */
function changedFiles(payload: NonNullable<LearnedSkillPlan['commit']>): string[] {
  const files = [
    FileSystemUtils.joinPath(payload.directory, LEARNED_SKILL_MANIFEST_FILE),
    FileSystemUtils.joinPath(payload.directory, LEARNED_SKILL_CONTENT_FILE),
  ];
  if (payload.action === 'rename' && payload.fromDirectory) {
    files.push(
      FileSystemUtils.joinPath(payload.fromDirectory, LEARNED_SKILL_MANIFEST_FILE),
      FileSystemUtils.joinPath(payload.fromDirectory, LEARNED_SKILL_CONTENT_FILE)
    );
  }
  return files;
}

/**
 * The approval gate. An approval names the scope it applies to and, for a
 * Store, the exact Store — so it can neither widen to the global scope nor
 * drift onto a namesake. Nothing here reads an existing record, a previous
 * approval, or the absence of an objection as consent.
 */
function approvalRefusal(
  plan: LearnedSkillPlan,
  context: LearnedSkillContext
): LearnedSkillBlock | undefined {
  if (plan.requiresGlobalApproval && context.approveGlobal !== true) {
    return {
      code: 'global_approval_required',
      message: `writing the global learned skill "${plan.id}" requires explicit approval for the global scope`,
    };
  }
  if (!plan.requiresStoreApproval) return undefined;

  const grant = context.approveStore;
  if (!grant) {
    return {
      code: 'store_approval_required',
      message: `publishing "${plan.id}" into ${describeDurableOwner(plan.identity.owner)} requires explicit approval naming that store`,
    };
  }
  if (grant.scope !== 'store') {
    return {
      code: 'store_approval_scope_mismatch',
      message: 'the approval names a different scope than the publication it was offered for',
    };
  }
  const target = plan.identity.owner;
  if (target.type !== 'store' || !storeUidsMatch(grant.uid, target.uid)) {
    return {
      code: 'store_approval_scope_mismatch',
      message: `the approval names store ${grant.id ?? grant.uid}, not ${describeDurableOwner(target)}; an approval for one store never authorizes another`,
    };
  }
  return undefined;
}

export async function commitLearnedSkillPlan(
  plan: LearnedSkillPlan,
  context: LearnedSkillContext = {}
): Promise<LearnedSkillResult> {
  const base = { scope: plan.scope, id: plan.id, identity: plan.identity };
  if (plan.block) return { outcome: 'blocked', ...base, block: plan.block };
  if (plan.action === 'no-op' || !plan.commit) return { outcome: 'no-op', ...base };

  const ownerBlock = validateTargetOwner(plan.scope, plan.identity.owner, context);
  if (ownerBlock) return { outcome: 'blocked', ...base, block: ownerBlock };

  // Consent is checked BEFORE the lock, so a refused publication does not even
  // create a lock file.
  const approvalBlock = approvalRefusal(plan, context);
  if (approvalBlock) return { outcome: 'blocked', ...base, block: approvalBlock };

  const payload = plan.commit;
  const lock = await acquireOwnerAwareFileLock({
    lockPath: payload.lockPath,
    errorFor: (_kind, info) =>
      new Error(`learned-skill catalog is busy or unwritable (${info.lockPath})`),
    holder: 'learned-skill-catalog',
    ...(context.lockDeadlineMs !== undefined
      ? { deadlineMs: context.lockDeadlineMs }
      : {}),
  });
  try {
    // Before anything reads the catalog: recover whatever a previously killed
    // mutation left half-swapped, so the drift checks below see the catalog as
    // it was rather than as a crash left it.
    sweepMutationDebris(path.dirname(payload.directory));

    if (plan.scope === 'store') {
      const drift = await storeTargetDrift(payload, plan.id, context);
      if (drift) return { outcome: 'blocked', ...base, block: drift };
    }

    const current = readCanonicalRecord(payload.directory, payload.scope, plan.identity.owner);
    const changed = targetChanged(payload, current);
    if (changed) return { outcome: 'blocked', ...base, block: changed };

    const sourceDrift = await sourcesDrifted(payload, plan, context);
    if (sourceDrift) return { outcome: 'blocked', ...base, block: sourceDrift };

    if (payload.action === 'rename' && payload.fromDirectory) {
      const renameBlock = commitRename(payload, plan);
      if (renameBlock) return { outcome: 'blocked', ...base, block: renameBlock };
      return {
        outcome: 'renamed',
        ...base,
        status: 'active',
        directory: payload.directory,
        ...(payload.targetStoreRoot ? { storeRoot: payload.targetStoreRoot } : {}),
        changedFiles: changedFiles(payload),
      };
    }

    writeCanonicalDirectory(
      payload.directory,
      payload.manifest as LearnedSkillManifest,
      payload.content as string,
      payload.expectedContentDigest
    );

    const outcome =
      payload.action === 'retire' ? 'retired' : payload.action === 'create' ? 'created' : 'rewritten';
    return {
      outcome,
      ...base,
      status: payload.action === 'retire' ? 'retired' : 'active',
      directory: payload.directory,
      ...(payload.targetStoreRoot ? { storeRoot: payload.targetStoreRoot } : {}),
      changedFiles: changedFiles(payload),
    };
  } finally {
    await releaseOwnerAwareFileLock(lock);
  }
}

/**
 * Re-resolves the target Store under the lock. A Store re-registered or
 * re-cloned between planning and committing must not silently receive a
 * publication planned against a different checkout.
 */
async function storeTargetDrift(
  payload: NonNullable<LearnedSkillPlan['commit']>,
  id: string,
  context: LearnedSkillContext
): Promise<LearnedSkillBlock | undefined> {
  const authoritative = await resolveCanonicalStore('store', context);
  if (!authoritative.ok) {
    return {
      code: authoritative.code,
      message: authoritative.message,
      ...(authoritative.repair ? { repair: authoritative.repair } : {}),
    };
  }
  const store = authoritative.store;
  if (store.owner.type !== 'store') {
    return { code: 'typed_owner_mismatch', message: 'the target no longer resolves to a store owner' };
  }
  const rootsMatch =
    payload.targetStoreRoot !== undefined && canonicalPathsEqual(payload.targetStoreRoot, store.root);
  if (
    !storeUidsMatch(store.owner.uid, payload.targetStoreUid) ||
    !rootsMatch ||
    !canonicalPathsEqual(payload.directory, learnedSkillDir(store, id))
  ) {
    return {
      code: 'typed_owner_mismatch',
      message: 'the authoritative store checkout changed after planning; re-plan before committing',
    };
  }
  return undefined;
}

/** Re-resolves and re-digests every named source under the lock. */
async function sourcesDrifted(
  payload: NonNullable<LearnedSkillPlan['commit']>,
  plan: LearnedSkillPlan,
  context: LearnedSkillContext
): Promise<LearnedSkillBlock | undefined> {
  const snapshots = payload.sourceSnapshots;
  if (!snapshots || snapshots.length === 0) return undefined;

  let actual;
  try {
    actual = await resolvePromotionSources(
      snapshots.map((snapshot) => snapshot.locator),
      plan.knowledgeKey ?? '',
      context
    );
  } catch (error) {
    return {
      code: 'promotion_source_drift',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!promotionSnapshotsEqual(snapshots, actual.snapshots)) {
    return { code: 'promotion_source_drift', message: 'a managed promotion source changed after planning' };
  }

  if (plan.scope === 'store') {
    const authoritative = await resolveCanonicalStore('store', context);
    if (!authoritative.ok) {
      return { code: 'promotion_source_drift', message: authoritative.message };
    }
    const membershipBlock = await membershipRefusal(authoritative.store, snapshots, context);
    if (membershipBlock) {
      return {
        code: 'promotion_source_drift',
        message: `store membership changed after planning: ${membershipBlock.message}`,
        ...(membershipBlock.repair ? { repair: membershipBlock.repair } : {}),
      };
    }
  }
  return undefined;
}

/**
 * Renames by moving the source aside first, so the new directory is written
 * into a free name and the old one is restored on any failure.
 */
function commitRename(
  payload: NonNullable<LearnedSkillPlan['commit']>,
  plan: LearnedSkillPlan
): LearnedSkillBlock | undefined {
  const fromDirectory = payload.fromDirectory as string;
  const from = readCanonicalRecord(fromDirectory, payload.scope, plan.identity.owner);
  if (
    from.kind !== 'managed' ||
    !payload.expectedFrom ||
    from.record.manifest.contentDigest !== payload.expectedFrom.contentDigest ||
    digestContent(serializeManifest(from.record.manifest)) !== payload.expectedFrom.manifestDigest ||
    from.record.manifest.updatedAt !== payload.expectedFrom.updatedAt
  ) {
    return { code: 'promotion_source_drift', message: 'the rename source changed after planning' };
  }

  const backup = path.join(
    path.dirname(fromDirectory),
    `${LEARNED_SKILL_BACKUP_PREFIX}${path.basename(fromDirectory)}-${process.pid}-${Math.random()
      .toString(36)
      .slice(2)}`
  );
  fs.renameSync(fromDirectory, backup);
  try {
    writeCanonicalDirectory(
      payload.directory,
      payload.manifest as LearnedSkillManifest,
      payload.content as string,
      payload.expectedContentDigest
    );
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(payload.directory)) fs.rmSync(payload.directory, { recursive: true, force: true });
    if (fs.existsSync(backup)) fs.renameSync(backup, fromDirectory);
    throw error;
  }
  return undefined;
}
