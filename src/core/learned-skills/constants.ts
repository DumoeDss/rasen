/**
 * Centralized constants for the learned-skill core. Named limits and identity
 * markers live here rather than as scattered literals (design D7): the concrete
 * values MAY evolve without changing the contract, but a change is made in one
 * place and the error messages name the limit.
 */

/** Canonical catalog subdirectory under a machine home / the global data dir. */
export const LEARNED_SKILLS_DIR_NAME = 'learned-skills';

/**
 * A Store's catalog lives beside its planning content, inside the Store's own
 * repository: `<store>/rasen/learned-skills/<id>`. Named segments rather than a
 * path literal, so every composition goes through `path.join()`.
 */
export const STORE_LEARNED_SKILLS_SEGMENTS: readonly string[] = [
  'rasen',
  LEARNED_SKILLS_DIR_NAME,
];

/** The strict managed manifest filename inside a canonical learned-skill dir. */
export const LEARNED_SKILL_MANIFEST_FILE = 'learned-skill.yaml';

/** The canonical generated skill body filename. */
export const LEARNED_SKILL_CONTENT_FILE = 'SKILL.md';

/**
 * Manifest schema versions. Version 1 stays readable and is still WRITTEN for
 * project/global records with no store-typed provenance — a read never
 * migrates a file, and a newer shape appears only when a mutation the user
 * performed actually needs it.
 */
export const LEARNED_SKILL_MANIFEST_VERSION = 2 as const;
export const LEARNED_SKILL_MANIFEST_V1_VERSION = 1 as const;

/** Current candidate (knowledge apply input) schema version; version 1 still parses. */
export const LEARNED_SKILL_CANDIDATE_VERSION = 2 as const;
export const LEARNED_SKILL_CANDIDATE_V1_VERSION = 1 as const;

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

/**
 * Distinct stable owners required before knowledge may be published into a
 * Store or promoted beyond one. "More than one project" is the whole point:
 * one project's experience is a project learned skill.
 */
export const LEARNED_SKILL_PROMOTION_MIN_SOURCES = 2;
/** Historical alias for the global gate, kept so existing callers still read. */
export const LEARNED_SKILL_GLOBAL_PROMOTION_MIN_PROJECTS =
  LEARNED_SKILL_PROMOTION_MIN_SOURCES;

/**
 * Machine-local staging names used by the persistence layer.
 *
 * The lock directory lives under the machine data dir and NEVER inside a
 * Store's repository: a lock file written beside a Store's catalog would be an
 * untracked file appearing in the user's `git status` every time knowledge is
 * read or written.
 */
export const LEARNED_SKILL_LOCKS_DIR_NAME = 'learned-skill-locks';
export const LEARNED_SKILL_STAGING_PREFIX = '.rasen-learned-skill-staging-';
export const LEARNED_SKILL_BACKUP_PREFIX = '.rasen-learned-skill-backup-';
