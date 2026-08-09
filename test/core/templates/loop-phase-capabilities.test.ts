import { describe, expect, it } from 'vitest';

import {
  getGoalIterateSkillTemplate,
  getGoalJudgeSkillTemplate,
  getReviewFixSkillTemplate,
  getReviewSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';

describe('bounded-loop phase capability contracts', () => {
  it('gives fix a write contract and keeps independent re-review report-only', () => {
    const fix = getReviewFixSkillTemplate().instructions;
    const review = getReviewSkillTemplate().instructions;

    expect(fix).toContain('review-cycle/fix-result/1');
    expect(fix).toContain('edit only the in-scope worktree');
    expect(fix).toContain('independent re-review');
    expect(review).toContain('make **no** code edits');
    expect(getReviewFixSkillTemplate().name).not.toBe(getReviewSkillTemplate().name);
  });

  it('makes only the fresh read-only judge authoritative for all goal variants', () => {
    const work = getGoalIterateSkillTemplate().instructions;
    const judge = getGoalJudgeSkillTemplate().instructions;

    expect(work).toContain('Do NOT declare the gate satisfied yourself');
    expect(judge).toContain('without changing the work product');
    expect(judge).toContain('author != verifier');
    expect(judge).toContain('goal-cycle/measure-judge/1');
    expect(judge).toContain('goal-cycle/evaluate-judge/1');
    expect(judge).toContain('goal-cycle/research-judge/1');
    expect(getGoalJudgeSkillTemplate().name).not.toBe(getGoalIterateSkillTemplate().name);
  });
});
