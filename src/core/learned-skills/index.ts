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
  LearnedSkillCandidateSchema,
  LearnedSkillManifestSchema,
  type ParsedLearnedSkillCandidate,
  type ParsedLearnedSkillManifest,
} from './schema.js';
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
  learnedSkillDir,
  probeStoreWritable,
  resolveGlobalStore,
  resolveProjectStore,
  type ProjectStoreResolution,
  type ResolvedStore,
} from './stores.js';
export {
  buildCanonicalContent,
  dedupeEvidence,
  digestContent,
  distinctProjectIds,
  evidenceTupleKey,
  loadStoreCatalog,
  readCanonicalRecord,
  serializeManifest,
  type CanonicalRecordRead,
  type DedupedEvidence,
} from './catalog.js';
export { commitLearnedSkillPlan, planLearnedSkillMutation } from './mutate.js';
export { listCanonicalLearnedSkills, resolveLearnedSkills } from './resolve.js';
