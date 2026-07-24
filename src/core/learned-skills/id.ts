/**
 * Context-first learned-skill id validation (design D6). An id is 3–6 lowercase
 * ASCII kebab-case semantic tokens, at most 64 characters. The first token(s)
 * identify applicable context; later tokens the operation/seam/constraint.
 * Dates, change ids, user/project ids, and generic memory words are rejected.
 *
 * Reuses the workflow-registry portable helpers so the id space, its
 * case/NFC-collision key, and the path-segment rules cannot drift from the
 * rest of Rasen.
 */

import {
  isPortableWorkflowId,
  portablePathCollisionKey,
} from '../workflow-registry/path-policy.js';
import {
  FORBIDDEN_LEARNED_SKILL_ID_TOKENS,
  LEARNED_SKILL_ID_MAX_LENGTH,
  LEARNED_SKILL_ID_MAX_TOKENS,
  LEARNED_SKILL_ID_MIN_TOKENS,
} from './constants.js';

export interface LearnedSkillIdCheck {
  valid: boolean;
  /** All violated rules, so the caller can report every problem at once. */
  violations: string[];
}

const DATE_LIKE_TOKEN = /^\d{4}$|^\d{6,8}$|^\d{4}-?\d{2}-?\d{2}$/;
const PURE_NUMERIC_TOKEN = /^\d+$/;

/**
 * Validates a learned-skill id and returns every violated rule. A caller that
 * only needs a boolean can read `.valid`.
 */
export function checkLearnedSkillId(id: string): LearnedSkillIdCheck {
  const violations: string[] = [];

  if (id.length > LEARNED_SKILL_ID_MAX_LENGTH) {
    violations.push(`id exceeds ${LEARNED_SKILL_ID_MAX_LENGTH} characters`);
  }
  // Base portability: lowercase kebab-case, ASCII, no leading hyphen.
  if (!isPortableWorkflowId(id)) {
    violations.push('id must be lowercase ASCII kebab-case (a-z, 0-9, hyphen; no leading hyphen)');
    // Without a portable base the token analysis below is not meaningful.
    return { valid: false, violations };
  }

  const tokens = id.split('-');
  if (tokens.length < LEARNED_SKILL_ID_MIN_TOKENS || tokens.length > LEARNED_SKILL_ID_MAX_TOKENS) {
    violations.push(
      `id must have ${LEARNED_SKILL_ID_MIN_TOKENS}-${LEARNED_SKILL_ID_MAX_TOKENS} semantic tokens (found ${tokens.length})`
    );
  }
  if (tokens.some((token) => token.length === 0)) {
    violations.push('id must not contain an empty token (no leading, trailing, or doubled hyphen)');
  }

  for (const token of tokens) {
    const lowered = token.toLowerCase();
    if (FORBIDDEN_LEARNED_SKILL_ID_TOKENS.includes(lowered)) {
      violations.push(`token "${token}" is a generic memory/provenance word and is not allowed`);
    }
    if (DATE_LIKE_TOKEN.test(token) || PURE_NUMERIC_TOKEN.test(token)) {
      violations.push(`token "${token}" looks like a date or numeric id, which is not allowed`);
    }
  }

  return { valid: violations.length === 0, violations };
}

/** Convenience boolean guard. */
export function isValidLearnedSkillId(id: string): boolean {
  return checkLearnedSkillId(id).valid;
}

/**
 * The portable case/NFC collision key for a learned-skill id — shared with the
 * workflow registry so a case-insensitive filesystem cannot host two records
 * that differ only by case or NFC form.
 */
export function learnedSkillIdCollisionKey(id: string): string {
  return portablePathCollisionKey(id);
}
