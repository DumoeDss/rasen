import { describe, expect, it } from 'vitest';

import { getSkillTemplates } from '../../src/core/shared/skill-generation.js';
import { getGoalCommandSkillTemplate } from '../../src/core/templates/skill-templates.js';

describe('goal workflow guidance', () => {
  const skillText = getGoalCommandSkillTemplate().instructions;

  it('is registered as the goal-command skill template', () => {
    const skill = getSkillTemplates().find(entry => entry.workflowId === 'goal-command');
    expect(skill).toBeDefined();
    expect(skill?.dirName).toBe('rasen-goal');
    expect(skill?.template.name).toBe('rasen-goal');
  });

  it('describes retained code tails and a report-only research tail', () => {
    expect(skillText).toContain(
      'goal-loop-measure** — define-goal -> iterate (measure gate) -> ship -> retain -> archive'
    );
    expect(skillText).toContain(
      'goal-loop-evaluate** — define-goal -> iterate (evaluate gate) -> ship -> retain -> archive'
    );
    expect(skillText).toContain(
      'goal-loop-research** — define-goal -> iterate (evaluate gate) -> report only'
    );
    expect(skillText).toContain('no ship, retain, or archive');
  });

  it('shows the selected tail in progress and resume guidance', () => {
    expect(skillText).toContain("### Tail (show only the selected pipeline's tail)");
    expect(skillText).toContain('ship -> retain -> archive  — measure/evaluate');
    expect(skillText).toContain('report only                — research');
    expect(skillText).toContain(
      'the declared tail (`ship -> retain -> archive` for measure/evaluate; report only for research)'
    );
  });
});
