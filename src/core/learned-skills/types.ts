/**
 * Public types for the learned-skill core. The persistence mechanics (schema
 * validation, canonical paths, locks, staging, digests, rollback) are hidden
 * behind {@link LearnedSkillMutationRequest} → plan → commit and the read-side
 * resolver; callers see these types, never the internal filesystem seams
 * (design D4).
 */

/** Learned-skill scope. Project is the default; global requires promotion. */
export type LearnedSkillScope = 'project' | 'global';

/** Canonical lifecycle status. Retired records keep provenance but never materialize. */
export type LearnedSkillStatus = 'active' | 'retired';

/** Applicability composition: `all` markers must exist, or `any` one of them. */
export type ApplicabilityMode = 'all' | 'any';

/** A `path-exists` applicability contract: portable root-relative marker paths. */
export interface Applicability {
  mode: ApplicabilityMode;
  markers: string[];
}

/**
 * One evidence reference. Records the source identity needed to audit a
 * decision — never the raw artifact body (design D3/D8: source text is
 * untrusted data, not persisted verbatim as instruction).
 */
export interface EvidenceReference {
  /** Stable project id the evidence came from. */
  projectId: string;
  /** Change identity (name) the evidence came from. */
  change: string;
  /** Artifact kind (proposal, design, tasks, review, qa, cso, ship, test, …). */
  artifact: string;
  /** Content digest of the source artifact (sha256:…), for audit without the body. */
  digest: string;
}

/** The strict managed manifest persisted as `learned-skill.yaml`. */
export interface LearnedSkillManifest {
  version: 1;
  id: string;
  /** Stable knowledge key: identical guidance rewrites the same record even when wording changes. */
  knowledgeKey: string;
  scope: LearnedSkillScope;
  status: LearnedSkillStatus;
  /** Ownership marker — must equal LEARNED_SKILL_GENERATED_BY to be rewritable. */
  generatedBy: string;
  /** Digest of the canonical SKILL.md content. */
  contentDigest: string;
  /** Always-loaded skill description (frontmatter). */
  description: string;
  applicability: Applicability;
  /** Deduplicated evidence tuples, capped by LEARNED_SKILL_MAX_EVIDENCE_ENTRIES. */
  evidence: EvidenceReference[];
  /**
   * When evidence overflowed the cap, a bounded summary of what was dropped
   * (count + a stable digest over the dropped tuples) — provenance without
   * unbounded growth.
   */
  evidenceOverflow?: { count: number; digest: string };
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
  retirementReason?: string;
}

/** A canonical record on disk: its manifest plus the resolved directory. */
export interface CanonicalLearnedSkill {
  manifest: LearnedSkillManifest;
  scope: LearnedSkillScope;
  /** Absolute canonical directory (<store>/learned-skills/<id>). */
  directory: string;
  /** The canonical SKILL.md content. */
  content: string;
}

/**
 * A strict candidate accepted by `knowledge apply`. Synthesized by the retain
 * codify branch and submitted through the CLI; the core never trusts source
 * text as instruction.
 */
export interface LearnedSkillCandidate {
  version: 1;
  operation: 'upsert' | 'promote' | 'retire';
  scope: LearnedSkillScope;
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[];
  retirementReason?: string;
}

/** The caller-facing mutation request (a candidate plus the optional rename op). */
export type LearnedSkillMutationRequest =
  | { operation: 'upsert'; scope: LearnedSkillScope; id: string; knowledgeKey: string; description: string; instructions: string; applicability: Applicability; evidence: EvidenceReference[] }
  | { operation: 'promote'; id: string; knowledgeKey: string; description: string; instructions: string; applicability: Applicability; evidence: EvidenceReference[] }
  | { operation: 'retire'; scope: LearnedSkillScope; id: string; retirementReason?: string }
  | { operation: 'rename'; scope: LearnedSkillScope; fromId: string; toId: string };

/** Context threading project identity and DI overrides through plan/commit/resolve. */
export interface LearnedSkillContext {
  /** Project root for project-scoped ops and applicability evaluation. */
  projectRoot?: string;
  /** DI override for the global data dir (default: getGlobalDataDir()). */
  globalDataDir?: string;
  /**
   * Consent for a global create/promotion. A plan that {@link LearnedSkillPlan.requiresGlobalApproval}
   * commits only when this is true; the CLI sets it after an interactive prompt
   * or the explicit `--approve-global` flag.
   */
  approveGlobal?: boolean;
}

/** The concrete action a plan resolved to. */
export type LearnedSkillAction = 'create' | 'rewrite' | 'retire' | 'rename' | 'no-op' | 'blocked';

/** Why a plan is blocked (never mutates). */
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
    | 'global_approval_required'
    | 'invalid_request';
  message: string;
}

/**
 * A deterministic mutation plan. Carries everything commit needs (resolved
 * store dir, target directory, serialized manifest + content, prior record) so
 * commit performs no re-planning — it only locks, stages, digests, and renames.
 */
export interface LearnedSkillPlan {
  action: LearnedSkillAction;
  scope: LearnedSkillScope;
  id: string;
  knowledgeKey?: string;
  requiresGlobalApproval: boolean;
  block?: LearnedSkillBlock;
  /** Human-readable one-line summary of the planned action. */
  summary: string;
  /** Internal commit payload (absent for no-op/blocked). */
  readonly commit?: LearnedSkillCommitPayload;
}

/** Opaque-to-callers payload the plan hands to commit. */
export interface LearnedSkillCommitPayload {
  scope: LearnedSkillScope;
  action: Exclude<LearnedSkillAction, 'no-op' | 'blocked'>;
  /** Absolute canonical directory of the (target) record. */
  directory: string;
  /** For rename: the source directory to remove after the new one is written. */
  fromDirectory?: string;
  /** Serialized manifest to write (absent for retire-of-missing / rename reuse). */
  manifest?: LearnedSkillManifest;
  /** Serialized SKILL.md content to write. */
  content?: string;
  /** Lock file path for the target registry (per-store serialization). */
  lockPath: string;
  /** Expected content digest to re-verify after staging (atomic-write guard). */
  expectedContentDigest?: string;
}

/** The outcome of committing a plan. */
export interface LearnedSkillResult {
  outcome: 'created' | 'rewritten' | 'retired' | 'renamed' | 'no-op' | 'blocked';
  scope: LearnedSkillScope;
  id: string;
  status?: LearnedSkillStatus;
  directory?: string;
  block?: LearnedSkillBlock;
}

/** The read-side result: active canonical skills relevant to a context. */
export interface ResolvedLearnedSkillSet {
  /** Active project-scoped skills owned by the resolved project. */
  project: CanonicalLearnedSkill[];
  /** Active approved global skills (applicability filtering is the caller's job for project-local homes). */
  global: CanonicalLearnedSkill[];
}
