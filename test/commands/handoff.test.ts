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
      expect(skill?.dirName).toBe('rasen-handoff');
      expect(skill?.template.name).toBe('rasen-handoff');
    });

    it('is registered as a command template under the plain id (/rasen:handoff)', () => {
      const command = getCommandTemplates().find(c => c.id === 'handoff');
      expect(command).toBeDefined();
      expect(command?.template.name).toBe('Rasen: Handoff');
    });
  });

  describe('instruction content', () => {
    const skillText = getHandoffSkillTemplate().instructions;
    const commandText = getOpsxHandoffCommandTemplate().content;

    it('skill and command share the same instruction body', () => {
      expect(commandText).toBe(skillText);
    });

    it('measures via the agent context probe, never guessing', () => {
      expect(skillText).toContain('rasen agent context --latest');
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

    it('offers a session relay after the handoff document is written', () => {
      expect(skillText).toContain('## Session relay (launching the successor yourself)');
      expect(skillText).toContain('relay-prompt.txt');
      expect(skillText).toContain('Offer to relay');
    });

    it('requires quote-safe bootstrap delivery, never bare quoted strings', () => {
      expect(skillText).toContain('file indirection, never bare quoting');
      expect(skillText).toContain('-EncodedCommand');
      expect(skillText).toContain('NEVER inline the prompt into the spawn command');
    });

    it('caps relay generations and records n in sessionHandoff', () => {
      expect(skillText).toContain('"n": <n>');
      expect(skillText).toContain('Generation cap');
      expect(skillText).toContain('maxRelays');
      expect(skillText).toContain('recommend decomposing the change');
    });

    it('spawns only after persistence, visibly, with a manual fallback', () => {
      expect(skillText).toContain('spawn strictly after both');
      expect(skillText).toContain('Spawn a visible interactive window');
      expect(skillText).toContain('Fallback is always manual');
    });

    it('describes the retired-between-children content focus for cross-change reuse', () => {
      expect(skillText).toContain('retired-between-children');
      expect(skillText).toContain('transfer cross-change knowledge');
      // Reuses the existing template; the between-children doc leaves Remaining empty.
      expect(skillText).toContain('leave **Remaining** empty');
      // The same file is the session-relay quiesce rule's "knowledge digest".
      expect(skillText).toContain('knowledge digest');
    });
  });

  describe('orchestration playbook Step H', () => {
    it('defines the context sensing + handoff protocol', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('Step H — Context sensing & the handoff protocol');
      expect(ORCHESTRATION_PLAYBOOK).toContain('rasen agent context');
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

    it('upgrades the H.1 pre-flight to a relay/continue/manual offer', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('automatic relay now');
      expect(ORCHESTRATION_PLAYBOOK).toContain('This is an offer, not a gate');
    });

    it('defines the H.7 session relay with quiesce, ordering, cap, and no worker resurrection', () => {
      expect(ORCHESTRATION_PLAYBOOK).toContain('H.7 Session relay');
      expect(ORCHESTRATION_PLAYBOOK).toContain('Quiesce first');
      expect(ORCHESTRATION_PLAYBOOK).toContain('Relay ONLY at a stage boundary');
      expect(ORCHESTRATION_PLAYBOOK).toContain('Spawn after persistence');
      expect(ORCHESTRATION_PLAYBOOK).toContain('Generation cap');
      expect(ORCHESTRATION_PLAYBOOK).toContain('No cross-session worker resurrection');
    });
  });

  describe('auto + review-cycle integration', () => {
    it('auto performs a one-shot non-blocking pre-flight probe', () => {
      const autoText = getAutoCommandSkillTemplate().instructions;
      expect(autoText).toContain('## 0. Pre-flight context probe (once, non-blocking)');
      expect(autoText).toContain('rasen agent context --latest --json');
      expect(autoText).toContain('/rasen:handoff');
    });

    it('auto pre-flight offers the three-way relay choice', () => {
      const autoText = getAutoCommandSkillTemplate().instructions;
      expect(autoText).toContain('automatic relay now');
      expect(autoText).toContain('Step H.7');
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
      testDir = path.join(os.tmpdir(), `rasen-handoff-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
      originalEnv = { ...process.env };
      configTempDir = path.join(os.tmpdir(), `rasen-handoff-config-${Date.now()}`);
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

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-handoff', 'SKILL.md');
      const commandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'handoff.md');

      expect(await fileExists(skillFile)).toBe(true);
      expect(await fileExists(commandFile)).toBe(true);

      const skillContent = await fs.readFile(skillFile, 'utf-8');
      expect(skillContent).toContain('name: rasen-handoff');
      expect(skillContent).toContain('rasen agent context');
    });

    it('does NOT generate handoff under the core profile', async () => {
      saveGlobalConfig({
        featureFlags: {},
        profile: 'core',
        delivery: 'both',
        workflows: [...CORE_WORKFLOWS],
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const coreSkill = path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md');
      expect(await fileExists(coreSkill)).toBe(true);

      expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-handoff', 'SKILL.md'))).toBe(false);
      expect(await fileExists(path.join(testDir, '.claude', 'commands', 'rasen', 'handoff.md'))).toBe(false);
    });
  });
});
