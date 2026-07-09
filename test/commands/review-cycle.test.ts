import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { InitCommand } from '../../src/core/init.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../src/core/profiles.js';
import {
  getSkillTemplates,
  getCommandTemplates,
  getCommandContents,
} from '../../src/core/shared/skill-generation.js';
import {
  getReviewCycleSkillTemplate,
  getOpsxReviewCycleCommandTemplate,
} from '../../src/core/templates/skill-templates.js';

const { confirmMock, showWelcomeScreenMock, searchableMultiSelectMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  showWelcomeScreenMock: vi.fn().mockResolvedValue(undefined),
  searchableMultiSelectMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
}));

vi.mock('../../src/ui/welcome-screen.js', () => ({
  showWelcomeScreen: showWelcomeScreenMock,
}));

vi.mock('../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('review-cycle workflow', () => {
  describe('registration', () => {
    it('appears in ALL_WORKFLOWS but is opt-in (not in CORE_WORKFLOWS)', () => {
      expect(ALL_WORKFLOWS).toContain('review-cycle');
      expect([...CORE_WORKFLOWS]).not.toContain('review-cycle');
    });

    it('is registered as a skill template with the expected dirName and name', () => {
      const skill = getSkillTemplates().find(s => s.workflowId === 'review-cycle');
      expect(skill).toBeDefined();
      expect(skill?.dirName).toBe('rasen-review-cycle');
      expect(skill?.template.name).toBe('rasen-review-cycle');
    });

    it('is registered as a command template with a clean (no -command suffix) id', () => {
      const command = getCommandTemplates().find(c => c.id === 'review-cycle');
      expect(command).toBeDefined();
      expect(command?.template.name).toBe('Rasen: Review Cycle');
      expect(command?.template.category).toBe('Workflow');

      // The command id becomes the generated slash command: /rasen:review-cycle
      const content = getCommandContents().find(c => c.id === 'review-cycle');
      expect(content).toBeDefined();
    });
  });

  describe('instruction content', () => {
    const skillText = getReviewCycleSkillTemplate().instructions;
    const commandText = getOpsxReviewCycleCommandTemplate().content;

    it('skill and command share the same instruction body', () => {
      expect(commandText).toBe(skillText);
    });

    it('delegates each review pass to the rasen-review engine (does not fork it)', () => {
      expect(skillText).toContain('rasen-review');
    });

    it('encodes the review -> triage -> fix -> re-review(delta) loop', () => {
      expect(skillText).toContain('review -> triage -> fix -> re-review(delta)');
    });

    it('encodes the author != verifier invariant', () => {
      expect(skillText.toLowerCase()).toContain('author != verifier');
      // self-certification by the fixer is rejected
      expect(skillText.toLowerCase()).toContain('self-certification');
      // the re-reviewer must be a different worker than the fix author
      expect(skillText.toLowerCase()).toContain('must not be the worker that authored the fix');
    });

    it('records the trivial-fix non-author equivalent (gate-run + diff-read, must be recorded)', () => {
      expect(skillText).toContain('gate-run');
      expect(skillText).toContain('diff-read');
      expect(skillText).toContain('MUST be recorded');
    });

    it('records test evidence in the cycle report for ship\'s evidence-based test gate', () => {
      expect(skillText).toContain('test evidence');
      expect(skillText).toContain('evidence-based test gate');
      // evidence carries the content tree fingerprint of the git state the tests ran against
      expect(skillText).toContain('git rev-parse HEAD^{tree}');
    });

    it('encodes the fix-size triage routing (trivial / non-trivial / design-level)', () => {
      expect(skillText).toContain('trivial');
      expect(skillText).toContain('non-trivial');
      expect(skillText).toContain('design-level');
      // routed to role-isolated workers (orchestration vocabulary)
      expect(skillText.toLowerCase()).toContain('separate fixer worker');
      expect(skillText.toLowerCase()).toContain('implementer worker');
    });

    it('encodes BOTH the Claude SendMessage resume path AND the tool-agnostic fallback', () => {
      // Claude acceleration: lead-only SendMessage resume of the original reviewer
      expect(skillText).toContain('SendMessage');
      expect(skillText).toContain('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1');
      // Only the lead may originate SendMessage (lead-only constraint).
      expect(skillText.toLowerCase()).toContain('only the lead may originate');
      // Mandatory tool-agnostic fallback: fresh delta review via a shared file
      expect(skillText).toContain('fallback');
      expect(skillText.toLowerCase()).toContain('fresh reviewer over just the delta');
      expect(skillText.toUpperCase()).toContain('SHARED FILE');
    });

    it('encodes the max-rounds / escalation-ladder termination rule (never silently pass)', () => {
      expect(skillText).toContain('max-rounds');
      expect(skillText).toContain('default 3');
      // Round exhaustion routes through the LEAD-first ladder (Step H.5/H.6),
      // then parks as escalated for the human at the next natural pause —
      // never a silent pass.
      expect(skillText).toContain('escalation ladder');
      expect(skillText).toContain('do NOT silently pass');
      expect(skillText).toContain('never a silent pass');
    });
  });

  describe('shared orchestration playbook', () => {
    const skillText = getReviewCycleSkillTemplate().instructions;

    it('embeds the LEAD-as-sole-orchestrator flat hierarchy', () => {
      expect(skillText).toContain('LEAD');
      expect(skillText.toLowerCase()).toContain('sole orchestrator');
      expect(skillText.toLowerCase()).toContain('leaf worker');
      // multi-agent path is primary, single-context is the explicit fallback
      expect(skillText).toContain('PRIMARY');
      expect(skillText.toLowerCase()).toContain('explicit fallback');
    });

    it('declares the three capability tiers', () => {
      expect(skillText).toContain('Tier A');
      expect(skillText).toContain('Tier B');
      expect(skillText).toContain('Tier C');
    });

    it('dispatches role-isolated workers that invoke existing skills via the Task tool', () => {
      expect(skillText.toLowerCase()).toContain('role-isolated');
      expect(skillText).toContain('Task tool');
      expect(skillText).toContain('Skill tool');
    });

    it('uses the change directory as the blackboard and records run-state', () => {
      expect(skillText.toLowerCase()).toContain('change directory');
      expect(skillText).toContain('run-state');
    });

    it('shares the playbook with /rasen:auto (it is auto\'s loop stage)', () => {
      expect(skillText.toLowerCase()).toContain('shares the orchestration playbook with');
      expect(skillText).toContain('/rasen:auto');
    });
  });

  describe('generation for the claude tool', () => {
    let testDir: string;
    let configTempDir: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `rasen-review-cycle-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
      originalEnv = { ...process.env };
      configTempDir = path.join(os.tmpdir(), `rasen-review-cycle-config-${Date.now()}`);
      await fs.mkdir(configTempDir, { recursive: true });
      // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
      // outranks XDG_CONFIG_HOME — clear it so this suite's XDG isolation
      // actually resolves into configTempDir.
      delete process.env.RASEN_HOME;
      process.env.XDG_CONFIG_HOME = configTempDir;

      vi.spyOn(console, 'log').mockImplementation(() => {});
      confirmMock.mockReset();
      confirmMock.mockResolvedValue(true);
      showWelcomeScreenMock.mockClear();
      searchableMultiSelectMock.mockReset();
    });

    afterEach(async () => {
      process.env = originalEnv;
      await fs.rm(testDir, { recursive: true, force: true });
      await fs.rm(configTempDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('generates the review-cycle skill + command for claude when opted in', async () => {
      // Opt in via a custom profile that includes review-cycle (plus a core anchor).
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'both',
        workflows: ['propose', 'review-cycle'],
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-review-cycle', 'SKILL.md');
      const commandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'review-cycle.md');

      expect(await fileExists(skillFile)).toBe(true);
      expect(await fileExists(commandFile)).toBe(true);

      const skillContent = await fs.readFile(skillFile, 'utf-8');
      expect(skillContent).toContain('name: rasen-review-cycle');
      expect(skillContent).toContain('rasen-review');

      const commandContent = await fs.readFile(commandFile, 'utf-8');
      expect(commandContent).toContain('name: "Rasen: Review Cycle"');
      // No ugly -command suffix in the generated slash command file name.
      const suffixed = path.join(testDir, '.claude', 'commands', 'rasen', 'review-cycle-command.md');
      expect(await fileExists(suffixed)).toBe(false);
    });

    it('does NOT generate review-cycle under the core profile', async () => {
      saveGlobalConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'both',
        workflows: ['propose', 'explore', 'apply', 'archive'],
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      // A core skill IS generated (sanity that generation ran)...
      const coreSkill = path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md');
      expect(await fileExists(coreSkill)).toBe(true);

      // ...but review-cycle is opt-in and must be absent.
      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-review-cycle', 'SKILL.md');
      const commandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'review-cycle.md');
      expect(await fileExists(skillFile)).toBe(false);
      expect(await fileExists(commandFile)).toBe(false);
    });

    it('keeps the review-cycle skill dir present across a both->skills re-init (no delivery mode removes skill dirs)', async () => {
      // 1) Generate skills + commands (delivery: both), creating the
      //    review-cycle skill dir and command file.
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'both',
        workflows: ['propose', 'review-cycle'],
      });
      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-review-cycle');
      const commandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'review-cycle.md');
      expect(await fileExists(path.join(skillDir, 'SKILL.md'))).toBe(true);
      expect(await fileExists(commandFile)).toBe(true);

      // 2) Re-init with skills-only delivery: the command file is removed
      //    (delivery === 'skills' gates command generation), but the skill
      //    dir survives — skills are always installed regardless of delivery
      //    (design D5), so no `removeSkillDirs` machinery exists anymore.
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'skills',
        workflows: ['propose', 'review-cycle'],
      });
      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      expect(await fileExists(path.join(skillDir, 'SKILL.md'))).toBe(true);
      expect(await fileExists(commandFile)).toBe(false);
    });
  });
});
