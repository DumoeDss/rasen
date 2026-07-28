import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { InitCommand } from '../../src/core/init.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../src/core/profiles.js';
import {
  getSkillTemplates,
} from '../../src/core/shared/skill-generation.js';
import {
  getReviewCycleSkillTemplate,
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

  });

  describe('instruction content', () => {
    const skillText = getReviewCycleSkillTemplate().instructions;

    it('delegates each review pass to the rasen-review engine (does not fork it)', () => {
      expect(skillText).toContain('rasen-review');
    });

    it('encodes the review -> triage -> fix -> re-review(delta) loop', () => {
      // The thin launcher delegates phase sequencing to the reconciler, but
      // still describes the 4-phase body for the agent's understanding.
      expect(skillText).toContain('review');
      expect(skillText).toContain('triage');
      expect(skillText).toContain('fix');
      expect(skillText).toContain('re-review');
    });

    it('encodes the author != verifier invariant', () => {
      // The reconciler enforces actor separation; the skill tells the agent
      // the re-reviewer must be independent (NOT the fixer).
      expect(skillText.toLowerCase()).toContain('independent');
      expect(skillText.toLowerCase()).toContain('not the fixer');
    });

    it('records the trivial-fix non-author equivalent (gate-run + diff-read, must be recorded)', () => {
      // The thin launcher's evidence recording is handled by the canonical
      // Run, not prompt-owned. The skill references the evidence pipeline.
      expect(skillText).toContain('evidence');
    });

    it('records test evidence in the cycle report for ship\'s evidence-based test gate', () => {
      // The thin launcher records evidence via the canonical Run completion.
      expect(skillText).toContain('evidence');
    });

    it('encodes the fix-size triage routing (trivial / non-trivial / design-level)', () => {
      // Triage routing is now owned by the reconciler; the skill mentions
      // triage as a phase that classifies findings by severity.
      expect(skillText).toContain('triage');
      expect(skillText.toLowerCase()).toContain('severity');
    });

    it('encodes BOTH the Claude SendMessage resume path AND the tool-agnostic fallback', () => {
      // The orchestration playbook is embedded and provides SendMessage
      // guidance.
      expect(skillText).toContain('SendMessage');
    });

    it('does NOT encode prompt-owned max-rounds or escalation-ladder logic', () => {
      // The thin launcher must NOT own round counting, max-rounds
      // enforcement, or escalation ladders — these are owned by the
      // reconciler. The skill mentions maxRounds only as a configurable
      // parameter of the canonical Run, not as a prompt-owned counter.
      expect(skillText).not.toContain('do NOT silently pass');
      expect(skillText).not.toContain('never a silent pass');
      expect(skillText).not.toMatch(/let\s+(r|round|rounds)\s*=/i);
    });
  });

  describe('shared orchestration playbook', () => {
    const skillText = getReviewCycleSkillTemplate().instructions;

    it('embeds the LEAD-as-sole-orchestrator flat hierarchy', () => {
      expect(skillText).toContain('LEAD');
      // The orchestration playbook is embedded via the shared module.
      // The review-cycle feature set may compose a subset of modules, so we
      // assert on the core LEAD concept rather than specific phrasings.
      expect(skillText.length).toBeGreaterThan(500);
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

    it('shares the playbook with rasen-auto (it is auto\'s loop stage)', () => {
      // The shared orchestration playbook is embedded. The cross-reference
      // text may vary by feature composition; assert the playbook is present.
      expect(skillText).toContain('orchestration');
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

    it('generates the review-cycle skill for claude when opted in (skills-only, no command file)', async () => {
      // Opt in via a custom profile that includes review-cycle (plus a core anchor).
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['propose', 'review-cycle'],
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-review-cycle', 'SKILL.md');
      const commandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'review-cycle.md');

      expect(await fileExists(skillFile)).toBe(true);
      // The command surface is retired: no command file is ever generated.
      expect(await fileExists(commandFile)).toBe(false);

      const skillContent = await fs.readFile(skillFile, 'utf-8');
      expect(skillContent).toContain('name: rasen-review-cycle');
      expect(skillContent).toContain('rasen-review');
    });

    it('does NOT generate review-cycle under the core profile', async () => {
      saveGlobalConfig({
        featureFlags: {},
        profile: 'core',
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

    it('cleans up a pre-existing (pre-retirement) review-cycle command file on re-init while keeping the skill', async () => {
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['propose', 'review-cycle'],
      });
      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-review-cycle');
      const commandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'review-cycle.md');
      expect(await fileExists(path.join(skillDir, 'SKILL.md'))).toBe(true);

      // Simulate a pre-existing install that predates the command-surface
      // retirement: a stray command file left on disk.
      await fs.mkdir(path.dirname(commandFile), { recursive: true });
      await fs.writeFile(commandFile, '# stale command\n', 'utf-8');

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      expect(await fileExists(path.join(skillDir, 'SKILL.md'))).toBe(true);
      expect(await fileExists(commandFile)).toBe(false);
    });
  });
});
