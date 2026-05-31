import { describe, it, expect } from 'vitest';

import {
  getSkillTemplates,
  getCommandTemplates,
  getCommandContents,
} from '../../src/core/shared/skill-generation.js';
import {
  getAutoCommandSkillTemplate,
  getOpsxAutoCommandTemplate,
} from '../../src/core/templates/skill-templates.js';

describe('auto workflow (orchestrated autopilot)', () => {
  describe('registration', () => {
    it('is registered as a skill template with the expected dirName and name', () => {
      const skill = getSkillTemplates().find(s => s.workflowId === 'auto-command');
      expect(skill).toBeDefined();
      expect(skill?.dirName).toBe('openspec-opsx-auto');
      expect(skill?.template.name).toBe('openspec-opsx-auto');
    });

    it('is registered as a command template (/opsx:auto)', () => {
      const command = getCommandTemplates().find(c => c.id === 'auto-command');
      expect(command).toBeDefined();
      expect(command?.template.name).toBe('OPSX: Auto');
      expect(command?.template.category).toBe('Workflow');
      expect(getCommandContents().find(c => c.id === 'auto-command')).toBeDefined();
    });
  });

  describe('instruction content', () => {
    const skillText = getAutoCommandSkillTemplate().instructions;
    const commandText = getOpsxAutoCommandTemplate().content;

    it('skill and command share the same instruction body', () => {
      expect(commandText).toBe(skillText);
    });

    it('drives the pipeline as the LEAD via the shared orchestration playbook', () => {
      expect(skillText).toContain('LEAD');
      expect(skillText).toContain('Orchestration Playbook');
      expect(skillText.toLowerCase()).toContain('role-isolated');
      expect(skillText).toContain('Task tool');
      // the three capability tiers come from the embedded playbook
      expect(skillText).toContain('Tier A');
      expect(skillText).toContain('Tier B');
      expect(skillText).toContain('Tier C');
    });

    it('classifies to a registry pipeline (full-feature / small-feature / bug-fix)', () => {
      expect(skillText).toContain('Classify');
      expect(skillText).toContain('full-feature');
      expect(skillText).toContain('small-feature');
      expect(skillText).toContain('bug-fix');
    });

    it('interprets stage metadata: gate / loop / parallelGroup / condition', () => {
      expect(skillText).toContain('gate');
      expect(skillText).toContain('loop');
      expect(skillText).toContain('parallelGroup');
      expect(skillText).toContain('condition');
    });

    it('includes the optional propose direction-review gate', () => {
      expect(skillText).toContain('--review-plan');
      expect(skillText).toContain('leadReview');
      expect(skillText.toLowerCase()).toContain('drift');
      // the lead did not author the proposal -> legitimate non-author check
      expect(skillText.toLowerCase()).toContain('non-author');
    });

    it('includes the adaptive Bug-Fix verify policy', () => {
      expect(skillText).toContain('verifyPolicy');
      expect(skillText.toLowerCase()).toContain('adaptive');
      expect(skillText.toLowerCase()).toContain('unit-test gate');
      expect(skillText.toLowerCase()).toContain('dedicated test');
    });

    it('enforces author != verifier across stages', () => {
      expect(skillText.toLowerCase()).toContain('author != verifier');
    });
  });
});
