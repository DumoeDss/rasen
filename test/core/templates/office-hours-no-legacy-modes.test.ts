import { describe, expect, it } from 'vitest';

import {
  getOfficeHoursSkillTemplate,
  getOfficeHoursCommandSkillTemplate,
  getOpsxOfficeHoursCommandTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { generateSkillContent } from '../../../src/core/shared/skill-generation.js';

// Standing regression guard (Success Criterion 7 in the office-hours-fork-first
// design doc): office-hours was rewritten to route by product (Diagnosis /
// Design) instead of three named paths (Startup mode / Builder mode /
// Consultation posture). These literal strings must never reappear — their
// presence would mean a dangling reference to a deleted named path.
const BANNED_SUBSTRINGS = ['Startup mode', 'Builder mode', 'Consultation posture'] as const;

describe('office-hours: no legacy named-path references', () => {
  it('the expert skill template body contains none of the deleted named paths', () => {
    const content = generateSkillContent(getOfficeHoursSkillTemplate(), 'REGRESSION-GUARD');
    for (const banned of BANNED_SUBSTRINGS) {
      expect(content, `expert template should not contain "${banned}"`).not.toContain(banned);
    }
  });

  it('the office-hours command skill template body contains none of the deleted named paths', () => {
    const content = generateSkillContent(getOfficeHoursCommandSkillTemplate(), 'REGRESSION-GUARD');
    for (const banned of BANNED_SUBSTRINGS) {
      expect(content, `command skill template should not contain "${banned}"`).not.toContain(banned);
    }
  });

  it('the opsx office-hours command content contains none of the deleted named paths', () => {
    const content = getOpsxOfficeHoursCommandTemplate().content;
    for (const banned of BANNED_SUBSTRINGS) {
      expect(content, `opsx command template should not contain "${banned}"`).not.toContain(banned);
    }
  });
});
