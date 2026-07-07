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

    it('defaults to the small-feature pipeline (no auto-escalation)', () => {
      expect(skillText).toContain('default = small-feature');
      expect(skillText.toLowerCase()).toContain('do not auto-escalate');
      // built-ins still listed for reference
      expect(skillText).toContain('full-feature');
      expect(skillText).toContain('small-feature');
      expect(skillText).toContain('bug-fix');
    });

    it('supports explicit pipeline selection (--pipeline or a leading name) over the default', () => {
      expect(skillText).toContain('--pipeline');
      // a bare leading pipeline name selects directly
      expect(skillText.toLowerCase()).toContain('first token is a known pipeline name');
      // explicit selection beats the small-feature default
      expect(skillText.toLowerCase()).toContain('always wins');
    });

    it('allows per-role Claude/Codex runtime overrides', () => {
      expect(skillText).toContain('--planner claude|codex');
      expect(skillText).toContain('--reviewer claude|codex');
      expect(skillText).toContain('planner=claude|codex');
      expect(skillText).toContain('runtime');
      expect(skillText).toContain('threadId');
      expect(skillText).toContain('Codex');
    });

    it('sources the pipeline DAG from the registry CLI, not hard-coded inline', () => {
      expect(skillText).toContain('openspec pipeline classify');
      expect(skillText).toContain('openspec pipeline show');
      expect(skillText).toContain('openspec pipeline resume');
      expect(skillText.toLowerCase()).toContain('do not hard-code');
      expect(skillText).toContain('buildOrder');
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

    it('ships decomposed children locally with one portfolio-level delivery', () => {
      // per-child ship is commit-only; delivery happens once at the parent level
      expect(skillText).toContain('**local** delivery mode');
      expect(skillText).toContain('Single portfolio-level delivery');
      expect(skillText.toLowerCase()).toContain('never push a half-delivered portfolio');
      // adaptive verify records evidence for ship's evidence-based test gate
      expect(skillText).toContain('evidence-based test gate');
    });

    it('covers decompose as the conditional first step and portfolio fan-out', () => {
      // decompose stage kind + conditional first step
      expect(skillText.toLowerCase()).toContain('kind: decompose');
      expect(skillText).toContain('childPipeline');
      expect(skillText).toContain('Portfolio orchestration');
      // LEAD-audited, not a human gate
      expect(skillText.toLowerCase()).toContain('no human gate');
      // the conservative parallel safety rule
      expect(skillText.toLowerCase()).toContain('cannot prove are independent');
      // portfolio run-state + resume
      expect(skillText).toContain('portfolio-run.json');
    });
  });
});
