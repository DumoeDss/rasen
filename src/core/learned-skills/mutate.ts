/** Deterministic plan/commit persistence with typed publication authority. */
import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { acquireFileLock, releaseFileLock } from '../file-state.js';
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
  LEARNED_SKILL_PROMOTION_MIN_SOURCES,
  LEARNED_SKILL_STAGING_PREFIX,
} from './constants.js';
import { checkLearnedSkillId, learnedSkillIdCollisionKey } from './id.js';
import { validateApplicability } from './applicability.js';
import {
  learnedSkillDir,
  probeStoreWritable,
  resolveCanonicalStore,
  type ResolvedStore,
} from './stores.js';
import {
  promotionSnapshotsEqual,
  queryStoreMemberProjects,
  resolvePromotionSources,
} from './authority.js';
import type {
  Applicability,
  CanonicalKnowledgeIdentity,
  EvidenceReference,
  KnowledgeOwnerRef,
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

function ownerIdentity(
  scope: LearnedSkillScope,
  context: LearnedSkillContext,
  requested?: KnowledgeOwnerRef
): KnowledgeOwnerRef {
  if (scope === 'global') return { type: 'global' };
  const owner = context.execution?.owner ?? requested;
  if (owner?.type === scope) return { type: owner.type, id: owner.id };
  return { type: scope, id: owner && owner.type !== 'global' ? owner.id : '' };
}

function identity(
  scope: LearnedSkillScope,
  id: string,
  context: LearnedSkillContext,
  requested?: KnowledgeOwnerRef
): CanonicalKnowledgeIdentity {
  return { owner: ownerIdentity(scope, context, requested), id };
}

function blockedPlan(
  scope: LearnedSkillScope,
  id: string,
  block: LearnedSkillBlock,
  context: LearnedSkillContext,
  requestedOwner?: KnowledgeOwnerRef
): LearnedSkillPlan {
  return {
    action: 'blocked',
    scope,
    id,
    identity: identity(scope, id, context, requestedOwner),
    sourceIdentities: [],
    requiresGlobalApproval: false,
    requiresStoreApproval: false,
    block,
    summary: `blocked: ${block.message}`,
  };
}

function sameOwner(left: KnowledgeOwnerRef, right: KnowledgeOwnerRef): boolean {
  return (
    left.type === right.type &&
    (left.type === 'global' || (right.type !== 'global' && left.id === right.id))
  );
}

function validateTargetOwner(
  scope: LearnedSkillScope,
  requested: KnowledgeOwnerRef | undefined,
  context: LearnedSkillContext
): LearnedSkillBlock | undefined {
  const execution = context.execution?.owner;
  if (requested && requested.type !== scope) {
    return {
      code: 'knowledge_owner_scope_mismatch',
      message: `candidate owner ${requested.type}${requested.type === 'global' ? '' : `:${requested.id}`} does not match ${scope} scope`,
    };
  }
  if (execution) {
    const actual: KnowledgeOwnerRef =
      execution.type === 'global'
        ? { type: 'global' }
        : { type: execution.type, id: execution.id };
    if (actual.type !== scope || (requested && !sameOwner(actual, requested))) {
      return {
        code: 'knowledge_owner_scope_mismatch',
        message: `${scope} learned-skill scope does not agree with resolved ${actual.type}${actual.type === 'global' ? '' : `:${actual.id}`} owner`,
      };
    }
  }
  return undefined;
}

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

function typedEvidence(
  evidence: readonly EvidenceReference[] | readonly NormalizedEvidenceReference[]
): NormalizedEvidenceReference[] {
  return evidence.map((entry) =>
    'projectId' in entry
      ? {
          owner: { type: 'project' as const, id: entry.projectId },
          change: entry.change,
          artifact: entry.artifact,
          digest: entry.digest,
        }
      : entry
  );
}

function v1Evidence(
  evidence: readonly NormalizedEvidenceReference[]
): EvidenceReference[] | undefined {
  if (evidence.some((entry) => entry.owner.type !== 'project')) return undefined;
  return evidence.map((entry) => ({
    projectId: entry.owner.id,
    change: entry.change,
    artifact: entry.artifact,
    digest: entry.digest,
  }));
}

function v1Locators(
  id: string,
  knowledgeKey: string,
  evidence: readonly EvidenceReference[]
): PromotionSourceLocator[] {
  return evidence.map((entry) => ({
    owner: { type: 'project' as const, id: entry.projectId },
    id,
    knowledgeKey,
  }));
}

interface WriteContent {
  version: 1 | 2;
  owner?: KnowledgeOwnerRef;
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[] | NormalizedEvidenceReference[];
  sources: PromotionSourceLocator[];
}

async function publicationAuthority(
  scope: LearnedSkillScope,
  content: WriteContent,
  context: LearnedSkillContext
): Promise<
  | {
      ok: true;
      snapshots: PromotionSourceSnapshot[];
      evidence: NormalizedEvidenceReference[];
      locators: PromotionSourceLocator[];
    }
  | { ok: false; block: LearnedSkillBlock }
> {
  if (scope === 'project') {
    return {
      ok: true,
      snapshots: [],
      evidence: typedEvidence(content.evidence),
      locators: [],
    };
  }
  const locatorRequests =
    content.version === 1 && isV1Evidence(content.evidence)
      ? v1Locators(content.id, content.knowledgeKey, content.evidence)
      : [...content.sources];
  if (locatorRequests.length === 0) {
    return {
      ok: false,
      block: {
        code: 'promotion_source_invalid',
        message: `${scope} publication requires exact managed source record locators`,
      },
    };
  }
  let resolved;
  try {
    resolved = await resolvePromotionSources(
      locatorRequests,
      content.knowledgeKey,
      context
    );
  } catch (error) {
    return {
      ok: false,
      block: {
        code: 'promotion_source_invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const canonicalLocators = resolved.snapshots.map((snapshot) => snapshot.locator);
  const classes = new Set(
    resolved.snapshots.map((snapshot) => snapshot.identity.owner.type)
  );
  if (
    scope === 'store' &&
    (classes.size !== 1 || !classes.has('project'))
  ) {
    return {
      ok: false,
      block: {
        code: 'store_evidence_insufficient',
        message: 'store publication requires homogeneous project source records',
      },
    };
  }
  if (scope === 'global' && classes.size !== 1) {
    return {
      ok: false,
      block: {
        code: 'promotion_source_mixed',
        message: 'global publication requires project sources or store sources, not a mixed class',
      },
    };
  }
  const canonicalOwnerKeys = resolved.snapshots.map((snapshot) => {
    const owner = snapshot.identity.owner;
    return owner.type === 'global' ? 'global' : `${owner.type}:${owner.id}`;
  });
  const distinctOwners = new Set(canonicalOwnerKeys);
  if (
    distinctOwners.size < LEARNED_SKILL_PROMOTION_MIN_SOURCES ||
    distinctOwners.size !== canonicalOwnerKeys.length
  ) {
    return {
      ok: false,
      block: {
        code:
          scope === 'store'
            ? 'store_evidence_insufficient'
            : 'global_evidence_insufficient',
        message: `${scope} scope requires at least ${LEARNED_SKILL_PROMOTION_MIN_SOURCES} distinct stable ${[...classes][0] ?? 'eligible'} owners (found ${distinctOwners.size})`,
      },
    };
  }
  if (scope === 'store') {
    try {
      const membership = await queryStoreMemberProjects(context);
      const members = new Set(membership.members.map((member) => member.owner.id));
      const missing = resolved.snapshots
        .filter(
          (snapshot) =>
            snapshot.identity.owner.type !== 'project' ||
            !members.has(snapshot.identity.owner.id)
        )
        .map((snapshot) =>
          snapshot.identity.owner.type === 'global'
            ? 'global'
            : snapshot.identity.owner.id
        );
      if (missing.length > 0) {
        return {
          ok: false,
          block: {
            code: 'store_membership_invalid',
            message: `project sources are not current explicit project-namespace members of store:${membership.store.id}: ${[...new Set(missing)].join(', ')}`,
          },
        };
      }
    } catch (error) {
      return {
        ok: false,
        block: {
          code: 'store_membership_invalid',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  return {
    ok: true,
    snapshots: resolved.snapshots,
    evidence: resolved.evidence,
    locators: canonicalLocators,
  };
}

async function planWrite(
  scope: LearnedSkillScope,
  content: WriteContent,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const ownerBlock = validateTargetOwner(scope, content.owner, context);
  if (ownerBlock) return blockedPlan(scope, content.id, ownerBlock, context, content.owner);
  if (scope === 'store' && content.version !== 2) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'invalid_request',
        message: 'store mutations require the strict store-capable candidate version 2',
      },
      context,
      content.owner
    );
  }
  const idCheck = checkLearnedSkillId(content.id);
  if (!idCheck.valid) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'invalid_id',
        message: `invalid learned-skill id "${content.id}": ${idCheck.violations.join('; ')}`,
      },
      context,
      content.owner
    );
  }
  const applicabilityCheck = validateApplicability(content.applicability);
  if (!applicabilityCheck.valid || !applicabilityCheck.normalized) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'invalid_applicability',
        message: `invalid applicability: ${applicabilityCheck.violations.join('; ')}`,
      },
      context,
      content.owner
    );
  }
  const applicability = applicabilityCheck.normalized;
  const contentBytes = bytes(content.description) + bytes(content.instructions);
  if (contentBytes > LEARNED_SKILL_CONTENT_BUDGET) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'content_budget_exceeded',
        message: `generated content for "${content.id}" is ${contentBytes} bytes, over the LEARNED_SKILL_CONTENT_BUDGET of ${LEARNED_SKILL_CONTENT_BUDGET}`,
      },
      context,
      content.owner
    );
  }
  const evidenceBytes = bytes(JSON.stringify(content.evidence));
  if (evidenceBytes > LEARNED_SKILL_CONTEXT_BUDGET) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'context_budget_exceeded',
        message: `evidence for "${content.id}" is ${evidenceBytes} bytes, over the LEARNED_SKILL_CONTEXT_BUDGET of ${LEARNED_SKILL_CONTEXT_BUDGET}`,
      },
      context,
      content.owner
    );
  }
  if (content.evidence.length === 0 && scope === 'project') {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'invalid_evidence',
        message: `learned skill "${content.id}" must carry at least one evidence reference`,
      },
      context,
      content.owner
    );
  }

  const storeResult = await resolveCanonicalStore(scope, context);
  if (!storeResult.ok) {
    return blockedPlan(
      scope,
      content.id,
      { code: storeResult.code, message: storeResult.message },
      context,
      content.owner
    );
  }
  const store = storeResult.store;
  const canonicalIdentity = { owner: store.owner, id: content.id };
  if (content.owner && !sameOwner(content.owner, store.owner)) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'knowledge_candidate_owner_mismatch',
        message: 'candidate typed owner does not match the authoritative canonical owner',
      },
      context,
      content.owner
    );
  }
  if (
    scope === 'project' &&
    store.owner.type === 'project' &&
    (() => {
      const projectId = store.owner.id;
      return typedEvidence(content.evidence).some(
        (entry) => entry.owner.type !== 'project' || entry.owner.id !== projectId
      );
    })()
  ) {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'knowledge_candidate_owner_mismatch',
        message: `candidate evidence owner must match authoritative project:${store.owner.id}`,
      },
      context,
      content.owner
    );
  }
  const writable = await probeStoreWritable(store);
  if (!writable.ok) {
    return blockedPlan(
      scope,
      content.id,
      { code: 'store_unwritable', message: writable.message },
      context,
      content.owner
    );
  }
  const directory = learnedSkillDir(store, content.id);
  const existing = readCanonicalRecord(directory, scope, store.owner);
  if (existing.kind === 'unmanaged') {
    return blockedPlan(
      scope,
      content.id,
      {
        code: 'ownership_collision',
        message: `cannot write learned skill "${content.id}": ${existing.reason}`,
      },
      context,
      content.owner
    );
  }

  const authority = await publicationAuthority(scope, content, context);
  if (!authority.ok) {
    return blockedPlan(scope, content.id, authority.block, context, content.owner);
  }
  const now = new Date().toISOString();
  const createdAt =
    existing.kind === 'managed' ? existing.record.manifest.createdAt : now;
  const canonicalContent = buildCanonicalContent(
    content.id,
    content.description,
    content.instructions
  );
  const contentDigest = digestContent(canonicalContent);

  const canWriteV1 =
    content.version === 1 &&
    scope !== 'store' &&
    (existing.kind !== 'managed' || existing.record.manifest.version === 1);
  let manifest: LearnedSkillManifest;
  if (canWriteV1) {
    const authoritativeV1 =
      scope === 'project'
        ? isV1Evidence(content.evidence)
          ? [...content.evidence]
          : v1Evidence(authority.evidence)
        : v1Evidence(authority.evidence);
    if (!authoritativeV1) {
      return blockedPlan(
        scope,
        content.id,
        {
          code: 'invalid_evidence',
          message: 'store-typed provenance requires manifest version 2',
        },
        context,
        content.owner
      );
    }
    const previous =
      existing.kind === 'managed' && existing.record.manifest.version === 1
        ? existing.record.manifest.evidence
        : [];
    manifest = buildManifestV1({
      id: content.id,
      knowledgeKey: content.knowledgeKey,
      scope,
      contentDigest,
      description: content.description,
      applicability,
      evidence: dedupeEvidence([...previous, ...authoritativeV1]),
      createdAt,
      updatedAt: now,
    });
  } else {
    const previous =
      existing.kind === 'managed' ? normalizeEvidence(existing.record.manifest) : [];
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
      (prior.version === 1 ||
        (manifest.version === 2 &&
          JSON.stringify(prior.sources) === JSON.stringify(manifest.sources)));
    action = unchanged ? 'no-op' : 'rewrite';
  }

  const basePlan = {
    scope,
    id: content.id,
    identity: canonicalIdentity,
    sourceIdentities: authority.snapshots.map((snapshot) => snapshot.identity),
    knowledgeKey: content.knowledgeKey,
    applicability,
    requiresGlobalApproval: scope === 'global',
    requiresStoreApproval: scope === 'store',
  };
  if (action === 'no-op') {
    return {
      ...basePlan,
      action,
      summary: `no change: "${content.id}" already reflects this evidence`,
    };
  }
  return {
    ...basePlan,
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
        ? { targetStoreId: store.owner.id, targetStoreRoot: store.root }
        : {}),
    },
  };
}

async function resolveManagedTarget(
  scope: LearnedSkillScope,
  id: string,
  context: LearnedSkillContext
): Promise<
  | { ok: true; store: ResolvedStore; record: Extract<ReturnType<typeof readCanonicalRecord>, { kind: 'managed' }>['record'] }
  | { ok: false; plan: LearnedSkillPlan }
> {
  const storeResult = await resolveCanonicalStore(scope, context);
  if (!storeResult.ok) {
    return {
      ok: false,
      plan: blockedPlan(
        scope,
        id,
        { code: storeResult.code, message: storeResult.message },
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
      plan: blockedPlan(
        scope,
        id,
        { code: 'not_found', message: `no learned skill "${id}" was found` },
        context
      ),
    };
  }
  if (read.kind === 'unmanaged') {
    return {
      ok: false,
      plan: blockedPlan(
        scope,
        id,
        { code: 'not_managed', message: `cannot mutate "${id}": ${read.reason}` },
        context
      ),
    };
  }
  return { ok: true, store: storeResult.store, record: read.record };
}

async function planRetire(
  request: Extract<LearnedSkillMutationRequest, { operation: 'retire' }>,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const ownerBlock = validateTargetOwner(request.scope, request.owner, context);
  if (ownerBlock) {
    return blockedPlan(request.scope, request.id, ownerBlock, context, request.owner);
  }
  const target = await resolveManagedTarget(request.scope, request.id, context);
  if (!target.ok) return target.plan;
  if (target.record.manifest.status === 'retired') {
    return {
      action: 'no-op',
      scope: request.scope,
      id: request.id,
      identity: target.record.identity,
      sourceIdentities: [],
      knowledgeKey: target.record.manifest.knowledgeKey,
      requiresGlobalApproval: false,
      requiresStoreApproval: false,
      summary: `no change: "${request.id}" is already retired`,
    };
  }
  const now = new Date().toISOString();
  const manifest: LearnedSkillManifest = {
    ...target.record.manifest,
    status: 'retired',
    updatedAt: now,
    retiredAt: now,
    ...(request.retirementReason
      ? { retirementReason: request.retirementReason }
      : {}),
  };
  return {
    action: 'retire',
    scope: request.scope,
    id: request.id,
    identity: target.record.identity,
    sourceIdentities: [],
    knowledgeKey: manifest.knowledgeKey,
    requiresGlobalApproval: false,
    requiresStoreApproval: false,
    summary: `retire ${request.scope} learned skill "${request.id}"`,
    commit: {
      scope: request.scope,
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
        ? { targetStoreId: target.store.owner.id, targetStoreRoot: target.store.root }
        : {}),
    },
  };
}

function stripFrontmatter(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

async function planRename(
  request: Extract<LearnedSkillMutationRequest, { operation: 'rename' }>,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  if (request.scope === 'store') {
    return blockedPlan(
      request.scope,
      request.toId,
      {
        code: 'invalid_request',
        message:
          'store learned-skill rename is not supported; create or rewrite the intended store record through an approved publication plan',
      },
      context
    );
  }
  const toCheck = checkLearnedSkillId(request.toId);
  if (!toCheck.valid) {
    return blockedPlan(
      request.scope,
      request.toId,
      {
        code: 'invalid_id',
        message: `invalid target id "${request.toId}": ${toCheck.violations.join('; ')}`,
      },
      context
    );
  }
  if (
    learnedSkillIdCollisionKey(request.fromId) ===
    learnedSkillIdCollisionKey(request.toId)
  ) {
    return blockedPlan(
      request.scope,
      request.toId,
      {
        code: 'invalid_request',
        message: `rename source and target resolve to the same id "${request.toId}"`,
      },
      context
    );
  }
  const source = await resolveManagedTarget(request.scope, request.fromId, context);
  if (!source.ok) return source.plan;
  const toDirectory = learnedSkillDir(source.store, request.toId);
  const occupied = readCanonicalRecord(toDirectory, request.scope, source.store.owner);
  if (occupied.kind !== 'absent') {
    return blockedPlan(
      request.scope,
      request.toId,
      { code: 'ownership_collision', message: `target id "${request.toId}" is already occupied` },
      context
    );
  }
  const canonicalContent = buildCanonicalContent(
    request.toId,
    source.record.manifest.description,
    stripFrontmatter(source.record.content)
  );
  const contentDigest = digestContent(canonicalContent);
  const manifest: LearnedSkillManifest = {
    ...source.record.manifest,
    id: request.toId,
    contentDigest,
    updatedAt: new Date().toISOString(),
  };
  return {
    action: 'rename',
    scope: request.scope,
    id: request.toId,
    identity: { owner: source.store.owner, id: request.toId },
    sourceIdentities: [],
    knowledgeKey: manifest.knowledgeKey,
    requiresGlobalApproval: false,
    requiresStoreApproval: false,
    summary: `rename ${request.scope} learned skill "${request.fromId}" -> "${request.toId}"`,
    commit: {
      scope: request.scope,
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
      ...(source.store.owner.type === 'store'
        ? { targetStoreId: source.store.owner.id, targetStoreRoot: source.store.root }
        : {}),
    },
  };
}

export async function planLearnedSkillMutation(
  request: LearnedSkillMutationRequest,
  context: LearnedSkillContext = {}
): Promise<LearnedSkillPlan> {
  switch (request.operation) {
    case 'upsert':
      return planWrite(
        request.scope,
        {
          version: request.version ?? 1,
          ...(request.owner ? { owner: request.owner } : {}),
          id: request.id,
          knowledgeKey: request.knowledgeKey,
          description: request.description,
          instructions: request.instructions,
          applicability: request.applicability,
          evidence: request.evidence,
          sources: request.sources ?? [],
        },
        context
      );
    case 'promote':
      return planWrite(
        'global',
        {
          version: request.version ?? 1,
          ...(request.owner ? { owner: request.owner } : {}),
          id: request.id,
          knowledgeKey: request.knowledgeKey,
          description: request.description,
          instructions: request.instructions,
          applicability: request.applicability,
          evidence: request.evidence,
          sources: request.sources ?? [],
        },
        context
      );
    case 'retire':
      return planRetire(request, context);
    case 'rename':
      return planRename(request, context);
  }
}

function writeCanonicalDirectory(
  directory: string,
  manifest: LearnedSkillManifest,
  content: string,
  expectedContentDigest: string | undefined
): void {
  const parent = path.dirname(directory);
  fs.mkdirSync(parent, { recursive: true });
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const staging = path.join(
    parent,
    `${LEARNED_SKILL_STAGING_PREFIX}${path.basename(directory)}-${suffix}`
  );
  const backup = path.join(
    parent,
    `${LEARNED_SKILL_BACKUP_PREFIX}${path.basename(directory)}-${suffix}`
  );
  fs.mkdirSync(staging, { recursive: false });
  try {
    const contentPath = path.join(staging, LEARNED_SKILL_CONTENT_FILE);
    fs.writeFileSync(
      path.join(staging, LEARNED_SKILL_MANIFEST_FILE),
      serializeManifest(manifest),
      { mode: 0o600 }
    );
    fs.writeFileSync(contentPath, content, { mode: 0o600 });
    if (
      expectedContentDigest !== undefined &&
      digestContent(fs.readFileSync(contentPath, 'utf-8')) !== expectedContentDigest
    ) {
      throw new Error(`staged content digest mismatch for ${directory}`);
    }
    if (!fs.existsSync(directory)) {
      fs.renameSync(staging, directory);
      return;
    }
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

function targetChanged(
  payload: NonNullable<LearnedSkillPlan['commit']>,
  current: ReturnType<typeof readCanonicalRecord>
): LearnedSkillBlock | undefined {
  const expected = payload.expectedTarget;
  if (!expected) return undefined;
  if (expected.kind === 'absent') {
    if (current.kind !== 'absent') {
      return {
        code: 'ownership_collision',
        message: `target "${payload.directory}" changed after planning`,
      };
    }
    return undefined;
  }
  if (current.kind === 'absent') {
    return { code: 'not_found', message: 'managed target disappeared after planning' };
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
      message: 'managed target changed after planning; re-plan before committing',
    };
  }
  return undefined;
}

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

function canonicalPathsEqual(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    try {
      return FileSystemUtils.canonicalizeExistingPath(value);
    } catch {
      return path.resolve(value);
    }
  };
  const a = canonical(left);
  const b = canonical(right);
  return process.platform === 'win32'
    ? a.toLocaleLowerCase() === b.toLocaleLowerCase()
    : a === b;
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
  if (plan.requiresGlobalApproval && context.approveGlobal !== true) {
    return {
      outcome: 'blocked',
      ...base,
      block: {
        code: 'global_approval_required',
        message: `writing the global learned skill "${plan.id}" requires explicit global approval`,
      },
    };
  }
  if (plan.requiresStoreApproval && context.approveStore !== true) {
    return {
      outcome: 'blocked',
      ...base,
      block: {
        code: 'store_approval_required',
        message: `writing store learned skill "${plan.id}" requires explicit store approval`,
      },
    };
  }

  const payload = plan.commit;
  const lock = await acquireFileLock({
    lockPath: payload.lockPath,
    errorFor: (_kind, info) =>
      new Error(`learned-skill registry is busy or unwritable (${info.lockPath})`),
  });
  try {
    if (plan.scope === 'store') {
      const authoritative = await resolveCanonicalStore('store', context);
      if (!authoritative.ok || authoritative.store.owner.type !== 'store') {
        return {
          outcome: 'blocked',
          ...base,
          block: authoritative.ok
            ? {
                code: 'typed_owner_mismatch',
                message: 'store target no longer resolves to a typed store owner',
              }
            : { code: authoritative.code, message: authoritative.message },
        };
      }
      const plannedRoot = payload.targetStoreRoot;
      const authoritativeDirectory = learnedSkillDir(authoritative.store, plan.id);
      const rootsMatch =
        plannedRoot !== undefined &&
        canonicalPathsEqual(plannedRoot, authoritative.store.root);
      if (
        authoritative.store.owner.id !== payload.targetStoreId ||
        !rootsMatch ||
        !canonicalPathsEqual(payload.directory, authoritativeDirectory)
      ) {
        return {
          outcome: 'blocked',
          ...base,
          block: {
            code: 'typed_owner_mismatch',
            message:
              'the authoritative store registry root changed after planning; re-plan before committing',
          },
        };
      }
    }
    const current = readCanonicalRecord(
      payload.directory,
      payload.scope,
      plan.identity.owner
    );
    const drift = targetChanged(payload, current);
    if (drift) return { outcome: 'blocked', ...base, block: drift };

    if (payload.sourceSnapshots && payload.sourceSnapshots.length > 0) {
      let actual;
      try {
        actual = await resolvePromotionSources(
          payload.sourceSnapshots.map((snapshot) => snapshot.locator),
          plan.knowledgeKey ?? '',
          context
        );
      } catch (error) {
        return {
          outcome: 'blocked',
          ...base,
          block: {
            code: 'promotion_source_drift',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
      if (!promotionSnapshotsEqual(payload.sourceSnapshots, actual.snapshots)) {
        return {
          outcome: 'blocked',
          ...base,
          block: {
            code: 'promotion_source_drift',
            message: 'a managed promotion source changed after planning',
          },
        };
      }
      if (payload.targetStoreId) {
        try {
          const membership = await queryStoreMemberProjects(context);
          const members = new Set(membership.members.map((member) => member.owner.id));
          if (
            payload.sourceSnapshots.some(
              (snapshot) =>
                snapshot.locator.owner.type !== 'project' ||
                !members.has(snapshot.locator.owner.id)
            )
          ) {
            return {
              outcome: 'blocked',
              ...base,
              block: {
                code: 'promotion_source_drift',
                message: 'store project membership changed after planning',
              },
            };
          }
        } catch (error) {
          return {
            outcome: 'blocked',
            ...base,
            block: {
              code: 'promotion_source_drift',
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
    }

    if (payload.action === 'rename' && payload.fromDirectory) {
      const from = readCanonicalRecord(
        payload.fromDirectory,
        payload.scope,
        plan.identity.owner
      );
      if (
        from.kind !== 'managed' ||
        !payload.expectedFrom ||
        from.record.manifest.contentDigest !== payload.expectedFrom.contentDigest ||
        digestContent(serializeManifest(from.record.manifest)) !==
          payload.expectedFrom.manifestDigest ||
        from.record.manifest.updatedAt !== payload.expectedFrom.updatedAt
      ) {
        return {
          outcome: 'blocked',
          ...base,
          block: {
            code: 'promotion_source_drift',
            message: 'rename source changed after planning',
          },
        };
      }
      const backup = path.join(
        path.dirname(payload.fromDirectory),
        `${LEARNED_SKILL_BACKUP_PREFIX}${path.basename(payload.fromDirectory)}-${process.pid}-${Math.random().toString(36).slice(2)}`
      );
      fs.renameSync(payload.fromDirectory, backup);
      try {
        writeCanonicalDirectory(
          payload.directory,
          payload.manifest!,
          payload.content!,
          payload.expectedContentDigest
        );
        fs.rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        if (fs.existsSync(payload.directory)) {
          fs.rmSync(payload.directory, { recursive: true, force: true });
        }
        if (fs.existsSync(backup)) fs.renameSync(backup, payload.fromDirectory);
        throw error;
      }
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
      payload.manifest!,
      payload.content!,
      payload.expectedContentDigest
    );
    const outcome =
      payload.action === 'retire'
        ? 'retired'
        : payload.action === 'create'
          ? 'created'
          : 'rewritten';
    return {
      outcome,
      ...base,
      status: payload.action === 'retire' ? 'retired' : 'active',
      directory: payload.directory,
      ...(payload.targetStoreRoot ? { storeRoot: payload.targetStoreRoot } : {}),
      changedFiles: changedFiles(payload),
    };
  } finally {
    await releaseFileLock(lock, payload.lockPath);
  }
}
