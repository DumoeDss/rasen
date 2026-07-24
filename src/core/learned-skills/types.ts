/**
 * Public learned-skill contracts. Persistence mechanics remain hidden behind
 * plan/commit and catalog APIs.
 */

export type LearnedSkillScope = 'project' | 'store' | 'global';

export type KnowledgeOwnerRef =
  | { type: 'global' }
  | { type: 'project'; id: string }
  | { type: 'store'; id: string };

export type EvidenceOwnerRef =
  | { type: 'project'; id: string }
  | { type: 'store'; id: string };

export type KnowledgePlanningRootRef =
  | { type: 'project'; id: string }
  | { type: 'store'; id: string };

export interface FrozenKnowledgeContext {
  version: 1;
  planningRoot: KnowledgePlanningRootRef;
  owner: KnowledgeOwnerRef;
}

export type ResolvedKnowledgeOwnerRef =
  | { type: 'global' }
  | { type: 'project'; id: string; root: string }
  | { type: 'store'; id: string; root: string };

export type ResolvedKnowledgePlanningRootRef =
  | { type: 'project'; id: string; root: string }
  | { type: 'store'; id: string; root: string };

export interface KnowledgeSelector {
  project?: string;
  store?: string;
}

export interface LearnedSkillExecutionContext {
  planningRoot?: ResolvedKnowledgePlanningRootRef;
  owner: ResolvedKnowledgeOwnerRef;
  source:
    | 'run-state'
    | 'explicit-project'
    | 'explicit-store'
    | 'launch-project'
    | 'direct-store';
  globalDataDir?: string;
}

export type LearnedSkillStatus = 'active' | 'retired';
export type ApplicabilityMode = 'all' | 'any';

export interface Applicability {
  mode: ApplicabilityMode;
  markers: string[];
}

/** Exact legacy v1 evidence shape. */
export interface EvidenceReference {
  projectId: string;
  change: string;
  artifact: string;
  digest: string;
}

/** Typed v2 and normalized in-memory evidence. */
export interface NormalizedEvidenceReference {
  owner: EvidenceOwnerRef;
  change: string;
  artifact: string;
  digest: string;
}

/** A locator request for one exact managed source record. */
export interface PromotionSourceLocator {
  owner: EvidenceOwnerRef;
  id: string;
  knowledgeKey: string;
}

interface LearnedSkillManifestCommon {
  id: string;
  knowledgeKey: string;
  status: LearnedSkillStatus;
  generatedBy: string;
  contentDigest: string;
  description: string;
  applicability: Applicability;
  evidenceOverflow?: { count: number; digest: string };
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
  retirementReason?: string;
}

/** Exact legacy project/global format. */
export interface LearnedSkillManifestV1 extends LearnedSkillManifestCommon {
  version: 1;
  scope: 'project' | 'global';
  evidence: EvidenceReference[];
}

/** Store-capable format with an explicit typed owner and exact sources. */
export interface LearnedSkillManifestV2 extends LearnedSkillManifestCommon {
  version: 2;
  scope: LearnedSkillScope;
  owner: KnowledgeOwnerRef;
  evidence: NormalizedEvidenceReference[];
  sources: PromotionSourceLocator[];
}

export type LearnedSkillManifest = LearnedSkillManifestV1 | LearnedSkillManifestV2;

export interface CanonicalKnowledgeIdentity {
  owner: KnowledgeOwnerRef;
  id: string;
}

export interface CanonicalLearnedSkill {
  identity: CanonicalKnowledgeIdentity;
  manifest: LearnedSkillManifest;
  scope: LearnedSkillScope;
  directory: string;
  content: string;
  /** V1 is normalized here without rewriting the manifest. */
  evidence: NormalizedEvidenceReference[];
}

export interface LearnedSkillCandidateV1 {
  version: 1;
  operation: 'upsert' | 'promote' | 'retire';
  scope: 'project' | 'global';
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[];
  retirementReason?: string;
}

export type LearnedSkillCandidateV2 =
  | {
      version: 2;
      operation: 'upsert' | 'promote';
      scope: LearnedSkillScope;
      owner: KnowledgeOwnerRef;
      id: string;
      knowledgeKey: string;
      description: string;
      instructions: string;
      applicability: Applicability;
      evidence: NormalizedEvidenceReference[];
      sources: PromotionSourceLocator[];
    }
  | {
      version: 2;
      operation: 'retire';
      scope: LearnedSkillScope;
      owner: KnowledgeOwnerRef;
      id: string;
      retirementReason?: string;
    };

export type LearnedSkillCandidate = LearnedSkillCandidateV1 | LearnedSkillCandidateV2;

interface WriteMutationFields {
  version?: 1 | 2;
  owner?: KnowledgeOwnerRef;
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[] | NormalizedEvidenceReference[];
  sources?: PromotionSourceLocator[];
}

export type LearnedSkillMutationRequest =
  | (WriteMutationFields & { operation: 'upsert'; scope: LearnedSkillScope })
  | (WriteMutationFields & { operation: 'promote' })
  | {
      version?: 1 | 2;
      operation: 'retire';
      scope: LearnedSkillScope;
      owner?: KnowledgeOwnerRef;
      id: string;
      retirementReason?: string;
    }
  | { operation: 'rename'; scope: LearnedSkillScope; fromId: string; toId: string };

export interface LearnedSkillContext {
  execution?: LearnedSkillExecutionContext;
  projectRoot?: string;
  globalDataDir?: string;
  approveGlobal?: boolean;
  approveStore?: boolean;
}

export type LearnedSkillAction =
  | 'create'
  | 'rewrite'
  | 'retire'
  | 'rename'
  | 'no-op'
  | 'blocked';

export interface LearnedSkillBlock {
  code:
    | 'invalid_id'
    | 'invalid_applicability'
    | 'invalid_evidence'
    | 'content_budget_exceeded'
    | 'context_budget_exceeded'
    | 'ownership_collision'
    | 'not_managed'
    | 'not_found'
    | 'unregistered_project'
    | 'store_unwritable'
    | 'global_evidence_insufficient'
    | 'store_evidence_insufficient'
    | 'promotion_source_invalid'
    | 'promotion_source_mixed'
    | 'store_membership_invalid'
    | 'promotion_source_drift'
    | 'typed_owner_mismatch'
    | 'global_approval_required'
    | 'store_approval_required'
    | 'knowledge_owner_scope_mismatch'
    | 'knowledge_store_scope_unavailable'
    | 'knowledge_candidate_owner_mismatch'
    | 'invalid_request';
  message: string;
}

export interface LearnedSkillPlan {
  action: LearnedSkillAction;
  scope: LearnedSkillScope;
  id: string;
  identity: CanonicalKnowledgeIdentity;
  sourceIdentities: CanonicalKnowledgeIdentity[];
  knowledgeKey?: string;
  applicability?: Applicability;
  requiresGlobalApproval: boolean;
  requiresStoreApproval: boolean;
  block?: LearnedSkillBlock;
  summary: string;
  readonly commit?: LearnedSkillCommitPayload;
}

export interface PromotionSourceSnapshot {
  locator: PromotionSourceLocator;
  identity: CanonicalKnowledgeIdentity;
  contentDigest: string;
  manifestDigest: string;
  updatedAt: string;
}

export interface LearnedSkillCommitPayload {
  scope: LearnedSkillScope;
  action: Exclude<LearnedSkillAction, 'no-op' | 'blocked'>;
  directory: string;
  fromDirectory?: string;
  manifest?: LearnedSkillManifest;
  content?: string;
  lockPath: string;
  expectedContentDigest?: string;
  expectedTarget?:
    | { kind: 'absent' }
    | { kind: 'managed'; contentDigest: string; manifestDigest: string; updatedAt: string };
  expectedFrom?: { contentDigest: string; manifestDigest: string; updatedAt: string };
  sourceSnapshots?: PromotionSourceSnapshot[];
  targetStoreId?: string;
  targetStoreRoot?: string;
}

export interface LearnedSkillResult {
  outcome: 'created' | 'rewritten' | 'retired' | 'renamed' | 'no-op' | 'blocked';
  scope: LearnedSkillScope;
  id: string;
  identity: CanonicalKnowledgeIdentity;
  status?: LearnedSkillStatus;
  directory?: string;
  storeRoot?: string;
  changedFiles?: string[];
  block?: LearnedSkillBlock;
}

export interface ResolvedLearnedSkillSet {
  project: CanonicalLearnedSkill[];
  store: CanonicalLearnedSkill[];
  global: CanonicalLearnedSkill[];
}
