/**
 * Centralized constants for the learned-skill core. Named limits and identity
 * markers live here rather than as scattered literals (design D7): the concrete
 * values MAY evolve without changing the contract, but a change is made in one
 * place and the error messages name the limit.
 */

/** Canonical store subdirectory under a machine home / the global data dir. */
export const LEARNED_SKILLS_DIR_NAME = 'learned-skills';

/** The strict managed manifest filename inside a canonical learned-skill dir. */
export const LEARNED_SKILL_MANIFEST_FILE = 'learned-skill.yaml';

/** The canonical generated skill body filename. */
export const LEARNED_SKILL_CONTENT_FILE = 'SKILL.md';

/** Current manifest schema version. */
export const LEARNED_SKILL_MANIFEST_VERSION = 1 as const;

/** Current candidate (knowledge apply input) schema version. */
export const LEARNED_SKILL_CANDIDATE_VERSION = 1 as const;

/**
 * Ownership marker written to `generatedBy`. Only a canonical manifest carrying
 * this exact value may be rewritten or retired by codify — a human-authored or
 * differently-owned directory occupying an id blocks the operation (design D7).
 * Ownership is NOT encoded in the id prefix; it lives here in the manifest.
 */
export const LEARNED_SKILL_GENERATED_BY = 'rasen-learned-skill';

/** Learned-skill id shape: 3–6 lowercase kebab-case tokens, at most 64 chars. */
export const LEARNED_SKILL_ID_MIN_TOKENS = 3;
export const LEARNED_SKILL_ID_MAX_TOKENS = 6;
export const LEARNED_SKILL_ID_MAX_LENGTH = 64;

/**
 * Generic provenance / memory words that never carry applicable context, plus
 * date-like and change-id-like tokens, are rejected as id tokens (design D6):
 * a learned-skill name must identify the applicable context, not that it is a
 * "note" or "lesson". Compared case-insensitively against each token.
 */
export const FORBIDDEN_LEARNED_SKILL_ID_TOKENS: readonly string[] = [
  'memory',
  'memories',
  'lesson',
  'lessons',
  'learning',
  'learnings',
  'note',
  'notes',
  'misc',
  'general',
  'generic',
  'temp',
  'tmp',
  'draft',
  'todo',
];

/**
 * Named context budgets (design D7). Planning fails BEFORE mutation when a
 * limit would be exceeded; nothing is silently truncated.
 *
 * - CONTEXT: total UTF-8 bytes of the accepted candidate's evidence set —
 *   guards runaway evidence copied into a candidate.
 * - CONTENT: total UTF-8 bytes of one skill's description + instructions —
 *   guards an over-long generated body.
 * - ACTIVE_DESCRIPTION: RESERVED / not yet enforced (see the constant below).
 *   The only budgets the specs require — and the only ones enforced — are
 *   CONTEXT and CONTENT (both gated in `planLearnedSkillMutation`).
 * - MAX_EVIDENCE_ENTRIES: canonical evidence-entry cap; overflow is summarized
 *   by count + digest rather than copied indefinitely.
 */
export const LEARNED_SKILL_CONTEXT_BUDGET = 64 * 1024;
export const LEARNED_SKILL_CONTENT_BUDGET = 8 * 1024;
/**
 * RESERVED — NOT YET ENFORCED. A future materialization-time cap on the total
 * always-loaded description bytes per project-local set (design D7's "context
 * grows as learned skills accumulate" mitigation). No code reads this today;
 * per-skill growth is already bounded by CONTENT + rewrite/retire. Enabling it
 * is a follow-up: sum active materialized descriptions in
 * `reconcileProjectLearnedSkillsForTool` and skip/warn when a set exceeds it.
 * Kept as a named constant so that guard has a single source of truth.
 */
export const LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET = 4 * 1024;
export const LEARNED_SKILL_MAX_EVIDENCE_ENTRIES = 16;

/** Distinct stable project IDs required before a global create/promotion is allowed. */
export const LEARNED_SKILL_GLOBAL_PROMOTION_MIN_PROJECTS = 2;
