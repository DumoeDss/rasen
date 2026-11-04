import { describe, expect, it } from 'vitest';

import { getGoalIterateSkillTemplate } from '../../../src/core/templates/workflows/goal-iterate.js';
import { getReviewCycleSkillTemplate } from '../../../src/core/templates/workflows/review-cycle.js';

const STRATEGY_INVOCATION = 'bounded-loop/strategy-invocation/1';
const STRATEGY_RESULT = 'bounded-loop/strategy-result/1';

describe('bounded-loop strategy capability prompts', () => {
  it.each([
    ['rasen-review-cycle', getReviewCycleSkillTemplate],
    ['rasen-goal-iterate', getGoalIterateSkillTemplate],
  ] as const)('%s consumes and produces the exact versioned strategy contracts', (_name, factory) => {
    const instructions = factory().instructions;

    expect(instructions).toContain(STRATEGY_INVOCATION);
    expect(instructions).toContain(STRATEGY_RESULT);
    for (const field of [
      'loopPath',
      'attempt',
      'trigger',
      'strategyKey',
      'rationale',
      'intendedChangeSurface',
      'evidence',
    ]) {
      expect(instructions).toContain(field);
    }
  });

  it('review-cycle strategy mode selects recovery without recursively launching another Run', () => {
    const instructions = getReviewCycleSkillTemplate().instructions;
    expect(instructions).toContain('Do NOT launch or resume another Run');
    expect(instructions).toContain('return only the strategy result');
  });

  it('goal-iterate strategy mode selects a new angle without editing the work product as an ordinary round', () => {
    const instructions = getGoalIterateSkillTemplate().instructions;
    expect(instructions).toContain('Do NOT edit the work product in strategy mode');
    expect(instructions).toContain('return only the strategy result');
  });
});
