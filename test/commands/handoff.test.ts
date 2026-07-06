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
} from '../../src/core/shared/skill-generation.js';
import {
  getHandoffSkillTemplate,
  getOpsxHandoffCommandTemplate,
  getAutoCommandSkillTemplate,
  getReviewCycleSkillTemplate,
} from '../../src/core/templates/skill-templates.js';
import { ORCHESTRATION_PLAYBOOK } from '../../src/core/templates/workflows/_orchestration.js';

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

describe('handoff workflow', () => {
  describe('registration', () => {
    it('appears in ALL_WORKFLOWS but is opt-in (not in CORE_WORKFLOWS)', () => {
      expect(ALL_WORKFLOWS).toContain('handoff');
      expect([...CORE_WORKFLOWS]).not.toContain('handoff');
    });

    it('is registered as a skill template with the expected dirName and name', () => {
      const skill = getSkillTemplates().find(s => s.workflowId === 'handoff');
      expect(skill).toBeDefined();
      expect(skill?.dirName).toBe('openspec-handoff');
      expect(skill?.template.name).toBe('openspec-handoff');
    });

    it('is registered as a command template under the plain id (/opsx:handoff)', () => {
      const command = getCommandTemplates().find(c => c.id === 'handoff');
      expect(command).toBeDefined();
      expect(command?.template.name).toBe('OPSX: Handoff');
    });
  });

  describe('instruction content', () => {
    const skillText = getHandoffSkillTemplate().instructions;
    const commandText = getOpsxHandoffCommandTemplate().content;

    it('skill and command share the same instruction body', () => {
      expect(commandText).toBe(skillText);
    });

    it('measures via the agent context probe, never guessing', () => {
      expect(skillText).toContain('openspec agent context --latest');
      expect(skillText).toContain('--transcript');
    });

    it('writes numbered handoff documents into the change directory', () => {
      expect(skillText).toContain('handoff/lead-<n>.md');
      expect(skillText).toContain('Never overwrite an existing handoff document');
    });

    it('records the sessionHandoff pointer in run-state, LEAD-side only', () => {
      expect(skillText).toContain('sessionHandoff');
      expect(skillText).toContain('auto-run.json');
      expect(skillText).toContain('Workers NEVER update run-state');
    });

    it('mandates the eliminated-hypotheses section for fixer/debugger roles', () => {
      expect(skillText).toContain('Eliminated hypotheses');
      expect(skillText).toContain('MANDATORY for fixer/debugger');
    });
  });

  describe('orchestration playbook Step H', () => {
    it('defines the context sensing + handoff protocol', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('Step H — Context sensing & the handoff protocol');
      expect(ORCHESTRATION_PLAYBOOK).toContain('openspec agent context');
      expect(ORCHESTRATION_PLAYBOOK).toContain('NEVER inject a running token countdown');
    });

    it('carries the worker self-handoff contract in the dispatch prompt shape', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('handoff clause — Step H.3');
      expect(ORCHESTRATION_PLAYBOOK).toContain('HANDOFF { path, reason: compaction|budget|self-assessment');
      expect(ORCHESTRATION_PLAYBOOK).toContain('Workers NEVER write run-state');
    });

    it('guards every SendMessage warm-continue with a transcript probe', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('H.2 Warm-continue guard');
      expect(ORCHESTRATION_PLAYBOOK).toContain('Before EVERY `SendMessage` to an existing worker');
    });

    it('bounds relays with maxRelays and stall detection, reviewed by the LEAD not a human', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('maxRelays: 3');
      expect(ORCHESTRATION_PLAYBOOK).toContain('stallLimit: 2');
      expect(ORCHESTRATION_PLAYBOOK).toContain('not a human gate');
      expect(ORCHESTRATION_PLAYBOOK).toContain('hypotheses eliminated');
    });

    it('parks exhausted stages as escalated instead of hard-stopping the run', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('H.6 Strategy budget & non-blocking escalation');
      expect(ORCHESTRATION_PLAYBOOK).toContain('PARK');
      expect(ORCHESTRATION_PLAYBOOK).toContain('never report clean while a Blocker/Major is open');
      expect(ORCHESTRATION_PLAYBOOK).toContain('strategyAttempts');
    });

    it('prefers handoff documents over raw transcripts on resume', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('Handoff document first, transcript second');
    });

    it('makes planner retirement deterministic via the probe', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('Retire on bloat (deterministic)');
    });
  });

  describe('auto + review-cycle integration', () => {
    it('auto performs a one-shot non-blocking pre-flight probe', () => {
      const autoText = getAutoCommandSkillTemplate().instructions;
      expect(autoText).toContain('## 0. Pre-flight context probe (once, non-blocking)');
      expect(autoText).toContain('openspec agent context --latest --json');
      expect(autoText).toContain('/opsx:handoff');
    });

    it('review-cycle routes round exhaustion through the escalation ladder, never a silent pass', () => {
      const rcText = getReviewCycleSkillTemplate().instructions;
      expect(rcText).toContain('Step H.5/H.6 escalation ladder');
      expect(rcText).toContain('strategyAttempts');
      expect(rcText).toContain('Never report clean while any Blocker or Major finding is unresolved');
    });
  });

  describe('generation for the claude tool', () => {
    let testDir: string;
    let configTempDir: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `openspec-handoff-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
      originalEnv = { ...process.env };
      configTempDir = path.join(os.tmpdir(), `openspec-handoff-config-${Date.now()}`);
      await fs.mkdir(configTempDir, { recursive: true });
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

    it('generates the handoff skill + command for claude when opted in', async () => {
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        delivery: 'both',
        workflows: ['propose', 'handoff'],
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'openspec-handoff', 'SKILL.md');
      const commandFile = path.join(testDir, '.claude', 'commands', 'opsx', 'handoff.md');

      expect(await fileExists(skillFile)).toBe(true);
      expect(await fileExists(commandFile)).toBe(true);

      const skillContent = await fs.readFile(skillFile, 'utf-8');
      expect(skillContent).toContain('name: openspec-handoff');
      expect(skillContent).toContain('openspec agent context');
    });

    it('does NOT generate handoff under the core profile', async () => {
      saveGlobalConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'both',
        workflows: [...CORE_WORKFLOWS],
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const coreSkill = path.join(testDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
      expect(await fileExists(coreSkill)).toBe(true);

      expect(await fileExists(path.join(testDir, '.claude', 'skills', 'openspec-handoff', 'SKILL.md'))).toBe(false);
      expect(await fileExists(path.join(testDir, '.claude', 'commands', 'opsx', 'handoff.md'))).toBe(false);
    });
  });
});
