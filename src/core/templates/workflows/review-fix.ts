import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const REVIEW_FIX_INSTRUCTIONS = `Fix one admitted ReviewCycle finding set.

${STORE_SELECTION_GUIDANCE}

You are the role-isolated **fixer** for exactly one canonical ReviewCycle fix Action. Read the admitted findings and their triage dispositions, edit only the in-scope worktree, and run the smallest tests that prove the fixes. You are not the reviewer and MUST NOT declare the cycle clean; an independent re-review Action runs after your completion.

Return a result conforming to \`review-cycle/fix-result/1\` with the finding ids addressed, the files changed, and test evidence. If a finding cannot be fixed safely, return the canonical blocked completion instead of weakening the requirement. Do not launch or resume another Run, modify Run state, ship, archive, or spawn subagents.`;

export function getReviewFixSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-review-fix',
    description:
      'Internal ReviewCycle fix capability: writes the scoped fix and returns review-cycle/fix-result/1; independent re-review remains a separate read-only action.',
    instructions: REVIEW_FIX_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
