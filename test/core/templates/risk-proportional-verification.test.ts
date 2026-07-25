import { describe, expect, it } from 'vitest';

import {
  getInvestigateSkillTemplate,
  getReviewCycleSkillTemplate,
  getShipCommandSkillTemplate,
  getVerifyChangeSkillTemplate,
  getVerifyEnhancedSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';

describe('risk-proportional verification policy', () => {
  it('does not mandate the full repository suite for every investigated fix', () => {
    const instructions = getInvestigateSkillTemplate().instructions;

    expect(instructions).not.toContain('5. **Run the full test suite.**');
    expect(instructions).toContain('Risk-proportional verification');
    expect(instructions).toContain('localized fix');
  });

  it('does not escalate missing ship evidence directly to the full project test command', () => {
    const instructions = getShipCommandSkillTemplate().instructions;

    expect(instructions).toContain('required verification scope');
    expect(instructions).toContain('scoped green evidence');
    expect(instructions).toContain('Never silently escalate');
  });

  it('records scope and rationale in every test-evidence producer', () => {
    for (const instructions of [
      getReviewCycleSkillTemplate().instructions,
      getVerifyChangeSkillTemplate().instructions,
      getVerifyEnhancedSkillTemplate().instructions,
    ]) {
      expect(instructions).toContain('scope');
      expect(instructions).toContain('rationale');
      expect(instructions).toContain('git rev-parse HEAD^{tree}');
    }
  });
});
