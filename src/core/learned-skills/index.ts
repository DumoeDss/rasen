/**
 * The learned-skill core: a deep module whose public surface is the plan/commit
 * write path, the read-side resolver, and the strict candidate/manifest schemas
 * plus their supporting constants and pure helpers. Callers (the `rasen
 * knowledge` CLI, init/update materialization) depend only on these exports —
 * never on the internal filesystem, lock, or staging seams.
 */

export * from './constants.js';
export * from './types.js';
export {
  DurableEvidenceOwnerRefSchema,
  DurableKnowledgeOwnerRefSchema,
  LearnedSkillCandidateSchema,
  LearnedSkillManifestSchema,
  LearnedSkillManifestV1Schema,
  LearnedSkillManifestV2Schema,
  FrozenExecutionRefSchema,
  FrozenKnowledgeContextSchema,
  KnowledgeOwnerRefSchema,
  KnowledgePlanningRootRefSchema,
  type ParsedLearnedSkillCandidate,
  type ParsedLearnedSkillManifest,
} from './schema.js';
export {
  compareDurableOwners,
  describeDurableOwner,
  durableOwnerFrom,
  durableOwnerKey,
  durableOwnerSelector,
  isDurableEvidenceOwner,
  sameDurableOwner,
  storeOwnerFrom,
} from './owner-identity.js';
export {
  checkLearnedSkillId,
  isValidLearnedSkillId,
  learnedSkillIdCollisionKey,
  type LearnedSkillIdCheck,
} from './id.js';
export {
  matchesApplicability,
  validateApplicability,
  type ApplicabilityCheck,
} from './applicability.js';
export {
  canonicalPathsEqual,
  learnedSkillDir,
  probeStoreWritable,
  resolveCanonicalStore,
  resolveGlobalStore,
  resolveProjectStore,
  resolveRegisteredKnowledgeStore,
  type ProjectStoreResolution,
  type ResolvedStore,
} from './stores.js';
export {
  buildCanonicalContent,
  buildManifestV1,
  buildManifestV2,
  dedupeEvidence,
  dedupeTypedEvidence,
  digestContent,
  distinctProjectIds,
  evidenceTupleKey,
  loadStoreCatalog,
  normalizeEvidence,
  readCanonicalRecord,
  readStoreCatalog,
  serializeManifest,
  type CanonicalRecordRead,
  type DedupedEvidence,
  type DedupedTypedEvidence,
  type StoreCatalogRead,
  type UnreadableCanonicalRecord,
} from './catalog.js';
export {
  PromotionSourceError,
  promotionSnapshotsEqual,
  queryStoreMemberProjects,
  resolvePromotionSources,
  sourceProjectIds,
  type ResolvedPromotionSources,
  type StoreKnowledgeMember,
  type StoreMemberQuery,
} from './authority.js';
export { commitLearnedSkillPlan, planLearnedSkillMutation } from './mutate.js';
export {
  listCanonicalLearnedSkills,
  readCanonicalLearnedSkillCatalog,
  resolveLearnedSkills,
} from './resolve.js';
export {
  KnowledgeContextError,
  freezeKnowledgeContext,
  frozenExecutionRef,
  isKnowledgeContextError,
  resolveLearnedSkillExecutionContext,
  resolveLearnedSkillRoots,
  type KnowledgeContextDiagnostic,
  type KnowledgeContextDiagnosticCode,
  type LearnedSkillRoots,
  type ResolveLearnedSkillExecutionContextInput,
} from './context.js';
// The single stated rule for which checkout applicability is decided in,
// shared by context.ts and effective.ts so the two cannot drift apart.
export { resolveEvaluationCheckout } from './evaluation-root.js';
export {
  EffectiveLearnedSkillPlanningError,
  identityKey,
  resolveEffectiveLearnedSkillPlan,
  resolveEffectiveLearnedSkillRecords,
  type EffectiveDescriptionBudgetFailure,
  type EffectiveLearnedSkill,
  type EffectiveLearnedSkillPlan,
  type EffectiveLearnedSkillScope,
  type EffectiveRecordResolution,
  type EffectiveStoreFact,
  type EffectiveStoreMemberFact,
  type EffectiveStoreNotMemberFact,
  type EffectiveStoreUnavailableFact,
  type ResolveEffectiveLearnedSkillPlanInput,
  type ResolveEffectiveLearnedSkillRecordsInput,
  type StoreConflictParticipant,
  type StoreRelevanceReason,
  type StoreSkillConflict,
} from './effective.js';
export {
  RESOLUTION_DIGEST_V1_VERSION,
  RESOLUTION_DIGEST_VERSION,
  managedBodyInputFor,
  renderManagedDocument,
  renderSourceKeys,
  resolutionDigestV2,
  stripFrontmatter,
  type ManagedBodyInput,
  type ResolutionDigestInput,
  type ResolutionDigestVersion,
} from './resolution-digest.js';
