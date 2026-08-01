import { describe, expect, it } from 'vitest';

import { getInvestigateSkillTemplate } from '../../../src/core/templates/experts/investigate.js';
import { getNavigatorSkillTemplate } from '../../../src/core/templates/experts/navigator.js';
import { getReviewSkillTemplate } from '../../../src/core/templates/experts/review.js';

describe('scope evidence guidance', () => {
  it('makes investigate declare, revise, and audit its affected area', () => {
    const content = getInvestigateSkillTemplate().instructions;

    expect(content).toContain('## Affected-area declaration');
    expect(content).toContain('initial allowlist');
    expect(content).toContain('record the evidence and revised allowlist **before** editing');
    expect(content).toContain('git diff --name-only');
    expect(content).toContain('unresolved out-of-scope work');
    expect(content).toContain('not mechanical write enforcement');
    expect(content).toContain('NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST');
    expect(content).toContain('Risk-proportional verification');
    expect(content).not.toContain('rasen agent edit-boundary');
    expect(content).not.toContain('## Scope Lock');
  });

  it('routes navigator to caution, investigation, and changed-file review', () => {
    const content = getNavigatorSkillTemplate().instructions;

    expect(content).toContain('rasen-careful');
    expect(content).toContain('rasen-investigate');
    expect(content).toContain('rasen-review');
    expect(content).toContain('rasen-verify-change');
    expect(content).toContain('actual changed-file set and diff');
    expect(content).toContain('Managed daemon/ECP workspace access and sandbox policy');
    expect(content).not.toContain('rasen agent edit-boundary');
    expect(content).not.toContain('hard` denies');
  });

  it('grounds standalone fix honesty in write results and the current diff', () => {
    const content = getReviewSkillTemplate().instructions;

    expect(content).toContain('Write-result and scope honesty');
    expect(content).toContain('inspect the tool result and the current diff');
    expect(content).toContain('unexpected file without a recorded justification');
    expect(content).toContain('not mechanical write enforcement');
    expect(content).not.toContain('Denied-edit honesty');
    expect(content).not.toContain('rasen agent edit-boundary');
  });
});
