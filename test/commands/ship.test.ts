import { describe, it, expect } from 'vitest';

import {
  getSkillTemplates,
  getCommandTemplates,
  getCommandContents,
} from '../../src/core/shared/skill-generation.js';
import {
  getShipCommandSkillTemplate,
  getOpsxShipCommandTemplate,
} from '../../src/core/templates/skill-templates.js';

describe('ship workflow (delivery modes + evidence-based test gate)', () => {
  describe('registration', () => {
    it('is registered as a skill template with the expected dirName and name', () => {
      const skill = getSkillTemplates().find(s => s.workflowId === 'ship-command');
      expect(skill).toBeDefined();
      expect(skill?.dirName).toBe('rasen-ship');
      expect(skill?.template.name).toBe('rasen-ship');
    });

    it('is registered as a command template (/rasen:ship)', () => {
      const command = getCommandTemplates().find(c => c.id === 'ship-command');
      expect(command).toBeDefined();
      expect(command?.template.name).toBe('Rasen: Ship');
      expect(command?.template.category).toBe('Workflow');
      expect(getCommandContents().find(c => c.id === 'ship-command')).toBeDefined();
    });
  });

  describe('instruction content', () => {
    const skillText = getShipCommandSkillTemplate().instructions;
    const commandText = getOpsxShipCommandTemplate().content;

    it('skill and command share the same instruction body', () => {
      expect(commandText).toBe(skillText);
    });

    it('resolves exactly one of the three delivery modes', () => {
      expect(skillText).toContain('Resolve the delivery mode');
      expect(skillText).toContain('**pr**');
      expect(skillText).toContain('**push**');
      expect(skillText).toContain('**local**');
      // resolution precedence: explicit > existing PR > repo convention > ask
      expect(skillText).toContain('pipeline stage metadata');
      expect(skillText).toContain('An existing open PR for the current branch');
      expect(skillText).toContain('Repository convention');
      expect(skillText).toContain('Ask the user');
    });

    it('never falls back to the repository default branch as the integration base', () => {
      expect(skillText).toContain(
        "NEVER resolve an integration base by falling back to the repository's default branch"
      );
      // the old blind-detection chain must stay gone
      expect(skillText).not.toContain('defaultBranchRef');
      expect(skillText).not.toContain('fall back to `main`');
    });

    it('owns the commit, honoring hooks without bypass', () => {
      expect(skillText).toContain('Commit the change (all modes)');
      expect(skillText).toContain('Pre-commit hooks');
      expect(skillText).toContain('NEVER bypass with `--no-verify`');
      // pre-flight no longer demands a pre-committed tree
      expect(skillText.toLowerCase()).toContain('uncommitted changes do not block');
    });

    it('merges the integration base only in pr mode', () => {
      expect(skillText).toContain('Merge the integration base (pr mode ONLY)');
      expect(skillText.toLowerCase()).toContain('there is no merge event to pre-validate');
    });

    it('gates tests on evidence instead of running unconditionally', () => {
      expect(skillText).toContain('Evidence-based test gate');
      expect(skillText.toLowerCase()).toContain('green test evidence');
      expect(skillText).toContain('review-cycle-report.md');
      expect(skillText).toContain('skips on proof, never on hope');
      // fresh-verification gate survives the rewrite
      expect(skillText).toContain('Fresh-verification gate');
    });

    it('delivers per mode, deferring local delivery to the portfolio level', () => {
      expect(skillText).toContain('Deliver per mode');
      expect(skillText).toContain('gh pr create');
      expect(skillText).toContain('deferred to the portfolio/parent level');
      // ship log + land-and-deploy are mode-aware
      expect(skillText).toContain('**Mode:** pr | push | local');
      expect(skillText).toContain('Land and Deploy (pr mode only)');
    });
  });
});
