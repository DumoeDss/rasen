/**
 * Public types for the learned-skill core. The persistence mechanics (schema
 * validation, canonical paths, locks, staging, digests, rollback) are hidden
 * behind {@link LearnedSkillMutationRequest} → plan → commit and the read-side
 * resolver; callers see these types, never the internal filesystem seams
 * (design D4).
 */

import type {
  GlobalIdentityRef,
  ProjectIdentityRef,
  StoreIdentityRef,
} from '../store/identity-types.js';

/**
 * Child A's Store identity, re-exported so a learned-skill consumer names it
 * from one place. Redeclaring it here would be a second vocabulary for the one
 * fact this release exists to make singular.
 */
export type { GlobalIdentityRef, ProjectIdentityRef, StoreIdentityRef };

/**
 * Learned-skill scope. Project is the default; a Store holds knowledge its
 * member projects draw on; global requires promotion beyond any one Store.
 */
export type LearnedSkillScope = 'project' | 'store' | 'global';

/**
 * Closed, serializable owner identity used by SELECTORS and by the frozen
 * run-state record. `id` here is whatever the user or an earlier run named —
 * a stable projectId, a project-namespace locator, or a Store's display alias.
 *
 * It is deliberately NOT what a catalog record is keyed on: see
 * {@link DurableKnowledgeOwnerRef}, which is the form that still resolves when
 * two Stores share a display name.
 */
export type KnowledgeOwnerRef =
  | { type: 'global' }
  | { type: 'project'; id: string }
  | { type: 'store'; id: string };

/** Closed, serializable planning-root identity. Same locator semantics. */
export type KnowledgePlanningRootRef =
  | { type: 'project'; id: string }
  | { type: 'store'; id: string };

/**
 * The owner a durable catalog record is keyed on. The Store arm is child A's
 * {@link StoreIdentityRef}: the permanent identity is the authority and the
 * display alias travels alongside for readability only, so renaming a Store
 * changes nothing already recorded and two namesake Stores stay distinct.
 *
 * Imported from `store/identity-types.ts` rather than redeclared — the release
 * declares this vocabulary once.
 */
export type DurableKnowledgeOwnerRef =
  | GlobalIdentityRef
  | ProjectIdentityRef
  | StoreIdentityRef;

/** Who contributed evidence, or owns a promotion source. Never `global`. */
export type DurableEvidenceOwnerRef = ProjectIdentityRef | StoreIdentityRef;

/**
 * A frozen record's planning root, named durably — the same permanent-identity
 * authority {@link DurableKnowledgeOwnerRef} carries, minus the global arm
 * (planning always happens in a project or a Store).
 */
export type DurableKnowledgePlanningRootRef = ProjectIdentityRef | StoreIdentityRef;

/**
 * The project a frozen run belongs to. Durable and path-free BY DESIGN: a
 * frozen run-state file lives in the change directory, which for a repo-local
 * change is Git-tracked — a checkout root recorded here would travel to every
 * other machine and misroute a resume. The local address for this identity
 * comes from the session context or the current checkout, never from here.
 */
export type FrozenExecutionRef =
  | { kind: 'planning-only' }
  | { kind: 'project'; projectId: string };

/**
 * Versioned run-state payload. Absolute machine paths are deliberately absent.
 *
 * Version 1 records planning root and owner only. Version 2 adds the execution
 * binding; a version 1 record reads as "no execution binding recorded", never
 * as an error.
 *
 * Version 3 is what new runs write. Its refs carry PERMANENT identity —
 * {@link DurableKnowledgeOwnerRef} / {@link DurableKnowledgePlanningRootRef} —
 * so renaming a Store changes nothing already frozen and two namesake Stores
 * stay distinct to every run frozen against either. The display name travels
 * alongside for readability only. Its `execution` is optional for the same
 * reason version 1 exists: a run with no execution binding still has permanent
 * identity worth recording.
 *
 * Versions 1 and 2 stay readable forever. They are never rewritten on read — a
 * frozen record is the authority for a run already in flight, and rewriting it
 * during a resume changes the thing being resumed. Resolving the name they
 * carry is fail-closed: exactly one match resolves, none or several refuse.
 */
export type FrozenKnowledgeContext =
  | {
      version: 1;
      planningRoot: KnowledgePlanningRootRef;
      owner: KnowledgeOwnerRef;
    }
  | {
      version: 2;
      planningRoot: KnowledgePlanningRootRef;
      owner: KnowledgeOwnerRef;
      execution: FrozenExecutionRef;
    }
  | {
      version: 3;
      planningRoot: DurableKnowledgePlanningRootRef;
      owner: DurableKnowledgeOwnerRef;
      execution?: FrozenExecutionRef;
    };

/**
 * A resolved owner: identity plus the machine-local root it lives at. `uid` is
 * present whenever the Store carries a permanent identity, and absent only for
 * a Store whose metadata predates one — which is why every DURABLE write
 * refuses rather than recording a name (see `learned_owner_legacy_alias`).
 */
export type ResolvedKnowledgeOwnerRef =
  | { type: 'global' }
  | { type: 'project'; id: string; root: string }
  | { type: 'store'; id: string; uid?: string; root: string };

export type ResolvedKnowledgePlanningRootRef =
  | { type: 'project'; id: string; root: string }
  | { type: 'store'; id: string; uid?: string; root: string };

export interface KnowledgeSelector {
  project?: string;
  store?: string;
}

export interface LearnedSkillExecutionContext {
  planningRoot?: ResolvedKnowledgePlanningRootRef;
  owner: ResolvedKnowledgeOwnerRef;
  /**
   * The checkout applicability is DECIDED in — the second of the three roots
   * §15.6 separates.
   *
   * It is not `owner.root`, and the difference is the point. `owner.root` is
   * the project's REGISTERED root: a run inside a linked worktree resolves it
   * to the main checkout, and two clones of one project resolve it to whichever
   * one registered first. Applicability has to be answered where the work is
   * actually happening, so this carries the session's own execution checkout
   * (child C's precedence) and falls back to the launch directory only when no
   * session recorded one. The canonical OWNER root and the materialization
   * target are the other two, and neither is this.
   */
  evaluationRoot?: string;
  source:
    | 'run-state'
    /** The session's own recorded runtime context (design D4's second step). */
    | 'session-context'
    | 'explicit-project'
    | 'explicit-store'
    | 'launch-project'
    | 'direct-store';
  globalDataDir?: string;
}

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

/**
 * The same evidence reference with its contributor named durably. Version 1
 * records normalize into this on READ without their file being rewritten, so a
 * caller never has to know which era a record comes from.
 */
export interface NormalizedEvidenceReference {
  owner: DurableEvidenceOwnerRef;
  change: string;
  artifact: string;
  digest: string;
}

/**
 * A request for one EXACT managed source record. Publishing into a Store or
 * promoting beyond one names its sources this way rather than asserting them:
 * the record must exist, be active, and carry this knowledge key, so a shared
 * id is never mistaken for shared knowledge.
 */
export interface PromotionSourceLocator {
  owner: DurableEvidenceOwnerRef;
  id: string;
  knowledgeKey: string;
}

/** Fields both manifest versions carry, in their stable serialized order. */
interface LearnedSkillManifestCommon {
  id: string;
  /** Stable knowledge key: identical guidance rewrites the same record even when wording changes. */
  knowledgeKey: string;
  status: LearnedSkillStatus;
  /** Ownership marker — must equal LEARNED_SKILL_GENERATED_BY to be rewritable. */
  generatedBy: string;
  /** Digest of the canonical SKILL.md content. */
  contentDigest: string;
  /** Always-loaded skill description (frontmatter). */
  description: string;
  applicability: Applicability;
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

/**
 * The exact version 1 format. Still written for project and global records
 * that have no store-typed provenance, so an older reader keeps working and a
 * read never migrates a file behind the user's back.
 */
export interface LearnedSkillManifestV1 extends LearnedSkillManifestCommon {
  version: 1;
  scope: 'project' | 'global';
  /** Deduplicated evidence tuples, capped by LEARNED_SKILL_MAX_EVIDENCE_ENTRIES. */
  evidence: EvidenceReference[];
}

/**
 * The store-capable format: an explicit durable owner and exact source
 * locators. A Store record is always this version — version 1 has nowhere to
 * put the Store's permanent identity, and recording a display name would be
 * keying ownership on the one field this release makes renameable.
 */
export interface LearnedSkillManifestV2 extends LearnedSkillManifestCommon {
  version: 2;
  scope: LearnedSkillScope;
  owner: DurableKnowledgeOwnerRef;
  evidence: NormalizedEvidenceReference[];
  sources: PromotionSourceLocator[];
}

export type LearnedSkillManifest = LearnedSkillManifestV1 | LearnedSkillManifestV2;

/** What a record IS, independent of where this machine keeps it. */
export interface CanonicalKnowledgeIdentity {
  owner: DurableKnowledgeOwnerRef;
  id: string;
}

/** A canonical record on disk: its manifest plus the resolved directory. */
export interface CanonicalLearnedSkill {
  identity: CanonicalKnowledgeIdentity;
  manifest: LearnedSkillManifest;
  scope: LearnedSkillScope;
  /** Absolute canonical directory (<catalog>/<id>). */
  directory: string;
  /** The canonical SKILL.md content. */
  content: string;
  /** Version 1 evidence normalized here, WITHOUT rewriting the manifest. */
  evidence: NormalizedEvidenceReference[];
}

/**
 * A strict candidate accepted by `knowledge apply`. Synthesized by the retain
 * codify branch and submitted through the CLI; the core never trusts source
 * text as instruction.
 */
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

/** The store-capable candidate: a durable owner plus exact source locators. */
export type LearnedSkillCandidateV2 =
  | {
      version: 2;
      operation: 'upsert' | 'promote';
      scope: LearnedSkillScope;
      owner: DurableKnowledgeOwnerRef;
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
      owner: DurableKnowledgeOwnerRef;
      id: string;
      retirementReason?: string;
    };

export type LearnedSkillCandidate = LearnedSkillCandidateV1 | LearnedSkillCandidateV2;

/** Fields shared by the two write-shaped mutation requests. */
interface WriteMutationFields {
  /** Omitted means version 1 — the shape every existing caller already sends. */
  version?: 1 | 2;
  owner?: DurableKnowledgeOwnerRef;
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[] | NormalizedEvidenceReference[];
  sources?: PromotionSourceLocator[];
}

/** The caller-facing mutation request (a candidate plus the optional rename op). */
export type LearnedSkillMutationRequest =
  | (WriteMutationFields & { operation: 'upsert'; scope: LearnedSkillScope })
  | (WriteMutationFields & { operation: 'promote' })
  | {
      version?: 1 | 2;
      operation: 'retire';
      scope: LearnedSkillScope;
      owner?: DurableKnowledgeOwnerRef;
      id: string;
      retirementReason?: string;
    }
  | { operation: 'rename'; scope: LearnedSkillScope; fromId: string; toId: string };

/** Context threading project identity and DI overrides through plan/commit/resolve. */
export interface LearnedSkillContext {
  /** Deterministic typed context. Production callers should provide this. */
  execution?: LearnedSkillExecutionContext;
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
  /**
   * Consent for a publication into ONE named Store. It carries the Store's
   * permanent identity rather than being a bare boolean, so an approval can
   * neither widen to the global scope nor drift onto a different Store that
   * happens to share a display name.
   */
  approveStore?: StoreApprovalGrant;
  /**
   * Override for the catalog lock acquisition deadline (milliseconds).
   * Defaults to the owner-aware lock's built-in default (5 s). Lowering
   * this is primarily useful in tests to prove non-eviction quickly.
   */
  lockDeadlineMs?: number;
}

/**
 * An approval, bound to the exact scope it approves. Approval is never
 * inferred — not from a previous approval, not from silence, and not from the
 * knowledge already existing somewhere narrower.
 */
export interface StoreApprovalGrant {
  scope: 'store';
  /** The Store's permanent identity, as resolved when the approval was given. */
  uid: string;
  /** Display alias, carried for the message only. */
  id?: string;
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
    /** The Store has no membership record for a contributing project. */
    | 'store_membership_invalid'
    /** Fewer independent member projects than publication requires. */
    | 'store_evidence_insufficient'
    /** A named source record is missing, retired, or carries another key. */
    | 'promotion_source_invalid'
    /** Sources of different classes cannot be combined into one publication. */
    | 'promotion_source_mixed'
    /** A source or the target changed between planning and committing. */
    | 'promotion_source_drift'
    /** Explicit, Store-scoped approval was not given. */
    | 'store_approval_required'
    /** The approval names a different scope, or a different Store. */
    | 'store_approval_scope_mismatch'
    /** A Store whose metadata predates permanent identity cannot own records. */
    | 'learned_owner_legacy_alias'
    /** The authoritative owner is no longer the one the plan was made against. */
    | 'typed_owner_mismatch'
    | 'knowledge_owner_scope_mismatch'
    | 'knowledge_store_scope_unavailable'
    | 'knowledge_candidate_owner_mismatch'
    | 'invalid_request';
  message: string;
  /** An ordered, copy-pasteable command that would make this work. */
  repair?: string[];
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
  /** What the record IS — the durable owner plus the id. */
  identity: CanonicalKnowledgeIdentity;
  /** The exact source records this publication draws on, resolved. */
  sourceIdentities: CanonicalKnowledgeIdentity[];
  knowledgeKey?: string;
  applicability?: Applicability;
  requiresGlobalApproval: boolean;
  /** Set for a Store publication; satisfied only by an approval naming this Store. */
  requiresStoreApproval: boolean;
  block?: LearnedSkillBlock;
  /** Human-readable one-line summary of the planned action. */
  summary: string;
  /** Internal commit payload (absent for no-op/blocked). */
  readonly commit?: LearnedSkillCommitPayload;
}

/** What one promotion source looked like when the plan was made. */
export interface PromotionSourceSnapshot {
  locator: PromotionSourceLocator;
  identity: CanonicalKnowledgeIdentity;
  contentDigest: string;
  manifestDigest: string;
  updatedAt: string;
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
  /** Lock file path for the target catalog (per-owner serialization). */
  lockPath: string;
  /** Expected content digest to re-verify after staging (atomic-write guard). */
  expectedContentDigest?: string;
  /** What the target looked like at plan time; a change aborts the commit. */
  expectedTarget?:
    | { kind: 'absent' }
    | { kind: 'managed'; contentDigest: string; manifestDigest: string; updatedAt: string };
  /** For rename: what the source looked like at plan time. */
  expectedFrom?: { contentDigest: string; manifestDigest: string; updatedAt: string };
  /** Re-verified under the lock, so a source cannot change mid-publication. */
  sourceSnapshots?: PromotionSourceSnapshot[];
  /** The Store this write lands in, by permanent identity, and its checkout. */
  targetStoreUid?: string;
  targetStoreRoot?: string;
}

/** The outcome of committing a plan. */
export interface LearnedSkillResult {
  outcome: 'created' | 'rewritten' | 'retired' | 'renamed' | 'no-op' | 'blocked';
  scope: LearnedSkillScope;
  id: string;
  identity: CanonicalKnowledgeIdentity;
  status?: LearnedSkillStatus;
  directory?: string;
  /** Present for a Store mutation: the repository the user must commit in. */
  storeRoot?: string;
  /** Absolute paths this mutation wrote. Rasen stages and commits nothing. */
  changedFiles?: string[];
  block?: LearnedSkillBlock;
}

/** The read-side result: active canonical skills relevant to a context. */
export interface ResolvedLearnedSkillSet {
  /** Active project-scoped skills owned by the resolved project. */
  project: CanonicalLearnedSkill[];
  /** Active skills owned by the resolved Store. */
  store: CanonicalLearnedSkill[];
  /** Active approved global skills (applicability filtering is the caller's job for project-local homes). */
  global: CanonicalLearnedSkill[];
}
