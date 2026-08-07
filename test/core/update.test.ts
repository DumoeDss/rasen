import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UpdateCommand, scanInstalledWorkflows } from '../../src/core/update.js';
import { InitCommand } from '../../src/core/init.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { OPENSPEC_MARKERS } from '../../src/core/config.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import type { GlobalConfig } from '../../src/core/global-config.js';
import { ALL_WORKFLOWS, getCurrentBuiltInWorkflowIds } from '../../src/core/profiles.js';
import { readNamedProfile, saveNamedProfile } from '../../src/core/named-profiles.js';
import {
  enumerateBehindProjects,
  updateMultipleProjects,
} from '../../src/core/multi-project-update.js';
import { isInteractive } from '../../src/utils/interactive.js';
import { select as inquirerSelect } from '@inquirer/prompts';
import { registerProject } from '../../src/core/project-registry.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';

// Shared mutable mock config state
const mockState = {
  config: {
    featureFlags: {},
    profile: 'core' as const,
  } as GlobalConfig,
  // When true, delegate to the real (unmocked) getGlobalConfig/saveGlobalConfig —
  // used by the retired-delivery healing test, which must exercise the real
  // retirement-detection/notice/persist path in global-config.ts rather than
  // the in-memory mock state below.
  useReal: false,
};

// Mock global config module to isolate tests from the machine's actual config
vi.mock('../../src/core/global-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/global-config.js')>();

  return {
    ...actual,
    getGlobalConfig: () => (mockState.useReal ? actual.getGlobalConfig() : { ...mockState.config }),
    saveGlobalConfig: vi.fn((config: GlobalConfig) => {
      if (mockState.useReal) {
        actual.saveGlobalConfig(config);
      }
    }),
  };
});

// Multi-project update mocks for integration tests (M5d/M5f/M5g/M5h).
// Wraps real implementations in vi.fn() for call tracking; behavior is
// unchanged unless a test explicitly overrides the implementation.
const mpuActual = vi.hoisted(() => ({
  enumerateBehindProjects: null as null | ((...args: any[]) => Promise<any[]>),
  updateMultipleProjects: null as null | ((...args: any[]) => Promise<any[]>),
  isInteractive: null as null | ((...args: any[]) => boolean),
}));

vi.mock('../../src/core/multi-project-update.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/multi-project-update.js')>();
  mpuActual.enumerateBehindProjects = actual.enumerateBehindProjects;
  mpuActual.updateMultipleProjects = actual.updateMultipleProjects;
  return {
    ...actual,
    enumerateBehindProjects: vi.fn(actual.enumerateBehindProjects),
    updateMultipleProjects: vi.fn(actual.updateMultipleProjects),
  };
});

vi.mock('../../src/utils/interactive.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/interactive.js')>();
  mpuActual.isInteractive = actual.isInteractive;
  return {
    ...actual,
    isInteractive: vi.fn(actual.isInteractive),
  };
});

// Prevent real TTY prompts during tests (only reached in M5h interactive tests).
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
}));

// Helper to set mock config for tests
function setMockConfig(config: GlobalConfig) {
  mockState.config = config;
}

function resetMockConfig() {
  mockState.config = { featureFlags: {}, profile: 'core' };
}

describe('UpdateCommand', () => {
  let testDir: string;
  let updateCommand: UpdateCommand;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `openspec-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create openspec directory
    const openspecDir = path.join(testDir, 'rasen');
    await fs.mkdir(openspecDir, { recursive: true });

    updateCommand = new UpdateCommand();

    // Reset mock config to defaults
    resetMockConfig();

    // Clear all mocks before each test
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    // Restore all mocks after each test
    vi.restoreAllMocks();

    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('basic validation', () => {
    it('should throw error if openspec directory does not exist', async () => {
      // Remove openspec directory
      await fs.rm(path.join(testDir, 'rasen'), {
        recursive: true,
        force: true,
      });

      await expect(updateCommand.execute(testDir)).rejects.toThrow(
        "No rasen project found. Run 'rasen init' to set up."
      );
    });

    it('should report no configured tools when none exist', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No configured tools found')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('expert-selection migration notice locale (locale-diagnostic-reporter)', () => {
    it('renders the notice in the resolved CLI locale', async () => {
      const savedRasenLang = process.env.RASEN_LANG;
      process.env.RASEN_LANG = 'ja';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        // Default mock config has no expertSelectionExplicit marker, so the
        // legacy branch fires the migration notice on every `update`.
        await updateCommand.execute(testDir);

        const messages = warnSpy.mock.calls.map((call) => call[0]);
        expect(messages.some((message) => typeof message === 'string' && message.includes('エキスパートを個別に選択'))).toBe(true);
        expect(messages.some((message) => typeof message === 'string' && message.includes('are now individually selectable'))).toBe(false);
      } finally {
        warnSpy.mockRestore();
        if (savedRasenLang === undefined) {
          delete process.env.RASEN_LANG;
        } else {
          process.env.RASEN_LANG = savedRasenLang;
        }
      }
    });
  });

  describe('skill updates', () => {
    it('should update skill files for configured Claude tool', async () => {
      // Set up a configured Claude tool by creating skill directories
      const skillsDir = path.join(testDir, '.claude', 'skills');
      const exploreSkillDir = path.join(skillsDir, 'rasen-explore');
      await fs.mkdir(exploreSkillDir, { recursive: true });

      // Create an existing skill file
      const oldSkillContent = `---
name: rasen-explore (old)
description: Old description
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "0.9"
---

Old instructions content
`;
      await fs.writeFile(
        path.join(exploreSkillDir, 'SKILL.md'),
        oldSkillContent
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Check skill file was updated
      const updatedSkill = await fs.readFile(
        path.join(exploreSkillDir, 'SKILL.md'),
        'utf-8'
      );
      expect(updatedSkill).toContain('name: rasen-explore');
      expect(updatedSkill).not.toContain('Old instructions content');
      expect(updatedSkill).toContain('license: MIT');

      // Check console output
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 1 tool(s): claude')
      );

      consoleSpy.mockRestore();
    });

    it('should update core profile skill files when tool is configured', async () => {
      // Set up a configured tool with one skill directory
      const skillsDir = path.join(testDir, '.claude', 'skills');

      // Create at least one skill to mark tool as configured
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old content'
      );

      await updateCommand.execute(testDir);

      // Verify core profile skill files were created/updated (propose, explore, apply, sync, archive)
      const coreSkillNames = [
        'rasen-explore',
        'rasen-apply-change',
        'rasen-sync-specs',
        'rasen-archive-change',
        'rasen-propose',
      ];

      for (const skillName of coreSkillNames) {
        const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
        const exists = await FileSystemUtils.fileExists(skillFile);
        expect(exists).toBe(true);

        const content = await fs.readFile(skillFile, 'utf-8');
        expect(content).toContain('---');
        expect(content).toContain('name:');
        expect(content).toContain('description:');
      }

      // Verify non-core skills are NOT created
      const nonCoreSkillNames = [
        'rasen-new-change',
        'rasen-continue-change',
        'rasen-bulk-archive-change',
        'rasen-verify-change',
      ];

      for (const skillName of nonCoreSkillNames) {
        const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
        const exists = await FileSystemUtils.fileExists(skillFile);
        expect(exists).toBe(false);
      }
    });
  });

  describe('command updates (retired)', () => {
    it('never creates a command file for a configured Claude tool — skills are the only delivery surface', async () => {
      // Set up a configured Claude tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old content'
      );

      await updateCommand.execute(testDir);

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      const exploreCmd = path.join(commandsDir, 'explore.md');
      expect(await FileSystemUtils.fileExists(exploreCmd)).toBe(false);
    });

    it('updates core profile skills, and never creates a command file, when a tool is configured', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old content'
      );

      await updateCommand.execute(testDir);

      // Verify core profile skills were created (propose, explore, apply, sync, archive)
      const coreSkillDirs = ['rasen-explore', 'rasen-apply-change', 'rasen-sync-specs', 'rasen-archive-change', 'rasen-propose'];
      for (const dirName of coreSkillDirs) {
        expect(await FileSystemUtils.fileExists(path.join(skillsDir, dirName, 'SKILL.md'))).toBe(true);
      }

      // No command file is ever created.
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      expect(await FileSystemUtils.fileExists(commandsDir)).toBe(false);
    });

  });

  describe('multi-tool support', () => {
    it('should update multiple configured tools', async () => {
      // Set up Claude
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      // Set up Cursor
      const cursorSkillsDir = path.join(testDir, '.cursor', 'skills');
      await fs.mkdir(path.join(cursorSkillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(cursorSkillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Both tools should be updated
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 2 tool(s)')
      );

      // Verify Claude skills updated
      const claudeSkill = await fs.readFile(
        path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'),
        'utf-8'
      );
      expect(claudeSkill).toContain('name: rasen-explore');

      // Verify Cursor skills updated
      const cursorSkill = await fs.readFile(
        path.join(cursorSkillsDir, 'rasen-explore', 'SKILL.md'),
        'utf-8'
      );
      expect(cursorSkill).toContain('name: rasen-explore');

      consoleSpy.mockRestore();
    });

    it('updates Qwen skills and never creates a command file', async () => {
      // Set up Qwen
      const qwenSkillsDir = path.join(testDir, '.qwen', 'skills');
      await fs.mkdir(path.join(qwenSkillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(qwenSkillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      expect(await FileSystemUtils.fileExists(
        path.join(qwenSkillsDir, 'rasen-explore', 'SKILL.md')
      )).toBe(true);

      // Qwen never had its own skills-format command file — no command
      // surface exists for any tool now.
      const qwenCmd = path.join(testDir, '.qwen', 'commands', 'rasen-explore.toml');
      expect(await FileSystemUtils.fileExists(qwenCmd)).toBe(false);
    });

    it('updates Windsurf skills and never creates a command file', async () => {
      // Set up Windsurf
      const windsurfSkillsDir = path.join(testDir, '.windsurf', 'skills');
      await fs.mkdir(path.join(windsurfSkillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(windsurfSkillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      expect(await FileSystemUtils.fileExists(
        path.join(windsurfSkillsDir, 'rasen-explore', 'SKILL.md')
      )).toBe(true);

      const windsurfCmd = path.join(testDir, '.windsurf', 'workflows', 'rasen-explore.md');
      expect(await FileSystemUtils.fileExists(windsurfCmd)).toBe(false);
    });

    it('should treat Hermes as configured via its global skills home and refresh only rasen- skills there', async () => {
      const originalHermesHome = process.env.HERMES_HOME;
      const hermesHome = path.join(testDir, '.hermes-home');
      process.env.HERMES_HOME = hermesHome;
      try {
        // Pre-install a stale Rasen skill under the global Hermes home.
        const hermesSkillsDir = path.join(hermesHome, 'skills');
        await fs.mkdir(path.join(hermesSkillsDir, 'rasen-explore'), { recursive: true });
        await fs.writeFile(path.join(hermesSkillsDir, 'rasen-explore', 'SKILL.md'), 'old');

        // A sibling, non-rasen-prefixed skill the user authored themselves —
        // update must never touch this.
        await fs.mkdir(path.join(hermesSkillsDir, 'my-own-skill'), { recursive: true });
        await fs.writeFile(
          path.join(hermesSkillsDir, 'my-own-skill', 'SKILL.md'),
          'user-authored, do not touch'
        );

        const consoleSpy = vi.spyOn(console, 'log');

        await updateCommand.execute(testDir);

        // Hermes was recognized as configured and updated.
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Updating 1 tool(s)')
        );

        // The rasen- skill was refreshed (no longer the stale placeholder content).
        const refreshedSkill = await fs.readFile(
          path.join(hermesSkillsDir, 'rasen-explore', 'SKILL.md'),
          'utf-8'
        );
        expect(refreshedSkill).toContain('name: rasen-explore');
        expect(refreshedSkill).not.toBe('old');

        // The sibling non-rasen- skill is untouched.
        const untouchedSkill = await fs.readFile(
          path.join(hermesSkillsDir, 'my-own-skill', 'SKILL.md'),
          'utf-8'
        );
        expect(untouchedSkill).toBe('user-authored, do not touch');

        // No project-local .hermes/ tree was created.
        const projectLocalDir = path.join(testDir, '.hermes');
        await expect(fs.stat(projectLocalDir)).rejects.toThrow();

        consoleSpy.mockRestore();
      } finally {
        if (originalHermesHome === undefined) {
          delete process.env.HERMES_HOME;
        } else {
          process.env.HERMES_HOME = originalHermesHome;
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle tool update failures gracefully', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      // Mock writeFile to fail for skills
      const originalWriteFile = FileSystemUtils.writeFile.bind(FileSystemUtils);
      const writeSpy = vi
        .spyOn(FileSystemUtils, 'writeFile')
        .mockImplementation(async (filePath, content) => {
          if (filePath.includes('SKILL.md')) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile(filePath, content);
        });

      const consoleSpy = vi.spyOn(console, 'log');

      // Should not throw
      await updateCommand.execute(testDir);

      // Should report failure
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed')
      );

      writeSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should continue updating other tools when one fails', async () => {
      // Set up Claude and Cursor
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      const cursorSkillsDir = path.join(testDir, '.cursor', 'skills');
      await fs.mkdir(path.join(cursorSkillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(cursorSkillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      // Mock writeFile to fail only for Claude
      const originalWriteFile = FileSystemUtils.writeFile.bind(FileSystemUtils);
      const writeSpy = vi
        .spyOn(FileSystemUtils, 'writeFile')
        .mockImplementation(async (filePath, content) => {
          if (filePath.includes('.claude') && filePath.includes('SKILL.md')) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile(filePath, content);
        });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Cursor should still be updated - check the actual format from ora spinner
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Cursor')
      );

      // Claude should be reported as failed
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed')
      );

      writeSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('tool detection', () => {
    it('should detect tool as configured only when skill file exists', async () => {
      // Create skills directory but no skill files
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(skillsDir, { recursive: true });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should report no configured tools
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No configured tools found')
      );

      consoleSpy.mockRestore();
    });

    it('should detect tool when any single skill exists', async () => {
      // Create only one skill file
      const skillDir = path.join(
        testDir,
        '.claude',
        'skills',
        'rasen-archive-change'
      );
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should detect and update Claude
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updating 1 tool(s): claude')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('skill content validation', () => {
    it('should generate valid YAML frontmatter in skill files', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      const skillContent = await fs.readFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'utf-8'
      );

      // Validate frontmatter structure
      expect(skillContent).toMatch(/^---\n/);
      expect(skillContent).toContain('name:');
      expect(skillContent).toContain('description:');
      expect(skillContent).toContain('license:');
      expect(skillContent).toContain('compatibility:');
      expect(skillContent).toContain('metadata:');
      expect(skillContent).toContain('author:');
      expect(skillContent).toContain('version:');
      expect(skillContent).toMatch(/---\n\n/);
    });

    it('should include proper instructions in skill files', async () => {
      // Set up a configured tool with apply-change skill (which is in core profile)
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-apply-change'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-apply-change', 'SKILL.md'),
        'old'
      );

      await updateCommand.execute(testDir);

      const skillContent = await fs.readFile(
        path.join(skillsDir, 'rasen-apply-change', 'SKILL.md'),
        'utf-8'
      );

      // Apply skill should contain implementation instructions
      expect(skillContent.toLowerCase()).toContain('task');
    });
  });

  describe('success output', () => {
    it('should display success message with tool name', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // The success output uses "✓ Updated: <name>"
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      consoleSpy.mockRestore();
    });

    it('should suggest IDE restart after update', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restart your IDE')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('smart update detection', () => {
    it('should show "up to date" message when skills have current version', async () => {
      // Initialize full core profile output so there is no profile/delivery drift.
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('up to date')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('--force')
      );

      consoleSpy.mockRestore();
    });

    it('should detect update needed when generatedBy is missing', async () => {
      // Set up a configured tool without generatedBy
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        `---
name: rasen-explore
metadata:
  author: openspec
  version: "1.0"
---

Legacy content without generatedBy
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show "unknown → version" in the update message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown')
      );

      consoleSpy.mockRestore();
    });

    it('should detect update needed when version differs', async () => {
      // Set up a configured tool with old version
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        `---
name: rasen-explore
metadata:
  generatedBy: "0.0.1"
---

Old version content
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show version transition (old pinned version → current, version-agnostic)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('0.0.1 →')
      );

      consoleSpy.mockRestore();
    });

    it('should embed generatedBy in updated skill files', async () => {
      // Set up a configured tool without generatedBy
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old content without version'
      );

      await updateCommand.execute(testDir);

      const updatedContent = await fs.readFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'utf-8'
      );

      // Should contain generatedBy field
      expect(updatedContent).toMatch(/generatedBy:\s*["']\d+\.\d+\.\d+["']/);
    });
  });

  describe('--force flag', () => {
    it('should update when force is true even if up to date', async () => {
      // Set up a configured tool with current version
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });

      const { version } = await import('../../package.json');
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        `---
metadata:
  generatedBy: "${version}"
---
Content
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      // Create update command with force option
      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show "Force updating" message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Force updating')
      );

      // Should show updated message
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated: Claude Code')
      );

      consoleSpy.mockRestore();
    });

    it('should not show --force hint when force is used', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old content'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Get all console.log calls as strings
      const allCalls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );

      // Should not show "Use --force" since force was used
      const hasForceHint = allCalls.some(call => call.includes('Use --force'));
      expect(hasForceHint).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should update all tools when force is used with mixed versions', async () => {
      // Set up Claude with current version
      const { version } = await import('../../package.json');
      const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeSkillDir, 'SKILL.md'),
        `---
metadata:
  generatedBy: "${version}"
---
`
      );

      // Set up Cursor with old version
      const cursorSkillDir = path.join(testDir, '.cursor', 'skills', 'rasen-explore');
      await fs.mkdir(cursorSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(cursorSkillDir, 'SKILL.md'),
        `---
metadata:
  generatedBy: "0.0.1"
---
`
      );

      const consoleSpy = vi.spyOn(console, 'log');

      const forceUpdateCommand = new UpdateCommand({ force: true });
      await forceUpdateCommand.execute(testDir);

      // Should show both tools being force updated
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Force updating 2 tool(s)')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('version tracking', () => {
    it('should show version in success message', async () => {
      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'old'
      );

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should show version in success message
      const { version } = await import('../../package.json');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`(v${version})`)
      );

      consoleSpy.mockRestore();
    });

    it('should only update tools that need updating', async () => {
      const originalCodexHome = process.env.CODEX_HOME;
      // Initialize both adapted tools so Codex is fully synced with profile/delivery.
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      try {
        const initCommand = new InitCommand({ tools: 'claude,codex', force: true });
        await initCommand.execute(testDir);

        // Make Claude stale to force a version update.
        const claudeSkillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
        const claudeContent = await fs.readFile(claudeSkillFile, 'utf-8');
        await fs.writeFile(
          claudeSkillFile,
          claudeContent.replace(/generatedBy:\s*["'][^"']+["']/, 'generatedBy: "0.0.1"')
        );

        const consoleSpy = vi.spyOn(console, 'log');

        await updateCommand.execute(testDir);

        // Should show only Claude being updated
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Updating 1 tool(s)')
        );

        // Should mention Codex is already up to date
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Already up to date: codex')
        );

        consoleSpy.mockRestore();
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
      }
    });
  });

  describe('profile-aware updates', () => {
    it('should generate only profile workflows when custom profile is set', async () => {
      // Set custom profile with only explore and new
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['explore', 'new'],
      });

      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      // Should create explore and new skills
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md')
      )).toBe(true);
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-new-change', 'SKILL.md')
      )).toBe(true);

      // Should NOT create non-profile skills
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-apply-change', 'SKILL.md')
      )).toBe(false);
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-propose', 'SKILL.md')
      )).toBe(false);
    });

    it('updates a ship-only named profile with one complete retention runner and an unchanged snapshot', async () => {
      const profileName = `pashifika-${randomUUID().slice(0, 8)}`;
      saveNamedProfile(profileName, {
        version: 2,
        workflows: ['ship-command'],
        retention: 'codify',
      });
      setMockConfig({
        featureFlags: {},
        profile: profileName,
        expertSelectionExplicit: true,
      });

      const skillsRoot = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsRoot, 'rasen-ship'), { recursive: true });
      await fs.writeFile(path.join(skillsRoot, 'rasen-ship', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      for (const fileName of ['SKILL.md', 'report.md', 'codify.md']) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsRoot, 'rasen-retain', fileName)
        )).toBe(true);
      }
      expect(await FileSystemUtils.fileExists(
        path.join(skillsRoot, 'rasen-auto', 'SKILL.md')
      )).toBe(false);
      const wrapper = await fs.readFile(
        path.join(skillsRoot, 'rasen-retro', 'SKILL.md'),
        'utf-8'
      );
      expect(wrapper).toContain('disable-model-invocation: true');
      expect(readNamedProfile(profileName)).toEqual({
        version: 2,
        workflows: ['ship-command'],
        retention: 'codify',
      });
    });

    it('repairs a wrapper-without-runner install even when the profile has neither ship nor auto', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['explore'],
        retention: 'report',
        expertSelectionExplicit: true,
      });

      const skillsRoot = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsRoot, 'rasen-retro'), { recursive: true });
      await fs.writeFile(path.join(skillsRoot, 'rasen-retro', 'SKILL.md'), 'old wrapper');

      await updateCommand.execute(testDir);

      for (const fileName of ['SKILL.md', 'report.md', 'codify.md']) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsRoot, 'rasen-retain', fileName)
        )).toBe(true);
      }
      const wrapper = await fs.readFile(
        path.join(skillsRoot, 'rasen-retro', 'SKILL.md'),
        'utf-8'
      );
      expect(wrapper).toContain('disable-model-invocation: true');
      expect(mockState.config.workflows).toEqual(['explore']);
      expect(mockState.config.workflows).not.toContain('retain-command');
    });

    it.each([
      { label: 'report sidecar', pathParts: ['rasen-retain', 'report.md'] },
      { label: 'codify sidecar', pathParts: ['rasen-retain', 'codify.md'] },
      { label: 'retro wrapper', pathParts: ['rasen-retro', 'SKILL.md'] },
    ])('repairs a current installation missing only its $label', async ({ pathParts }) => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['ship-command'],
        retention: 'codify',
        expertSelectionExplicit: true,
      });

      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
      const skillsRoot = path.join(testDir, '.claude', 'skills');
      const missingPath = path.join(skillsRoot, ...pathParts);
      await fs.rm(missingPath, { recursive: true, force: true });

      await updateCommand.execute(testDir);

      expect(await FileSystemUtils.fileExists(missingPath)).toBe(true);
      for (const fileName of ['SKILL.md', 'report.md', 'codify.md']) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsRoot, 'rasen-retain', fileName)
        )).toBe(true);
      }
      expect(await FileSystemUtils.fileExists(
        path.join(skillsRoot, 'rasen-retro', 'SKILL.md')
      )).toBe(true);
    });

    it('deduplicates auto, ship, and compatibility paths to one retention directory', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['auto-command', 'ship-command'],
        expertSelectionExplicit: true,
      });

      const skillsRoot = path.join(testDir, '.claude', 'skills');
      for (const dirName of ['rasen-auto', 'rasen-ship']) {
        await fs.mkdir(path.join(skillsRoot, dirName), { recursive: true });
        await fs.writeFile(path.join(skillsRoot, dirName, 'SKILL.md'), 'old');
      }

      await updateCommand.execute(testDir);

      const entries = await fs.readdir(skillsRoot);
      expect(entries.filter((entry) => entry === 'rasen-retain')).toEqual(['rasen-retain']);
      for (const fileName of ['SKILL.md', 'report.md', 'codify.md']) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsRoot, 'rasen-retain', fileName)
        )).toBe(true);
      }
    });

    it('removes a deselected ship skill while preserving the compatibility runner and wrapper', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['explore'],
        expertSelectionExplicit: true,
      });

      const skillsRoot = path.join(testDir, '.claude', 'skills');
      for (const dirName of ['rasen-explore', 'rasen-ship', 'rasen-retain', 'rasen-retro']) {
        await fs.mkdir(path.join(skillsRoot, dirName), { recursive: true });
        await fs.writeFile(path.join(skillsRoot, dirName, 'SKILL.md'), 'old');
      }

      await updateCommand.execute(testDir);

      expect(await FileSystemUtils.fileExists(path.join(skillsRoot, 'rasen-ship'))).toBe(false);
      for (const fileName of ['SKILL.md', 'report.md', 'codify.md']) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsRoot, 'rasen-retain', fileName)
        )).toBe(true);
      }
      const wrapper = await fs.readFile(
        path.join(skillsRoot, 'rasen-retro', 'SKILL.md'),
        'utf-8'
      );
      expect(wrapper).toContain('disable-model-invocation: true');
    });

    it('should suggest core preset when custom profile preserves the old core workflow set', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['propose', 'explore', 'apply', 'archive'],
      });

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      expect(calls.some(call =>
        call.includes('The core profile now includes sync')
      )).toBe(true);
      expect(calls.some(call =>
        call.includes('rasen profile use core') && call.includes('rasen update')
      )).toBe(true);

      expect(await FileSystemUtils.fileExists(
        path.join(testDir, '.claude', 'skills', 'rasen-sync-specs', 'SKILL.md')
      )).toBe(false);
      expect(await FileSystemUtils.fileExists(
        path.join(testDir, '.claude', 'commands', 'rasen', 'sync.md')
      )).toBe(false);

      consoleSpy.mockRestore();
    });

    it('never generates a command file, under any profile (the surface is fully retired)', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
      });

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      // Skills should be created
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md')
      )).toBe(true);

      // Commands should NOT be created
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'explore.md')
      )).toBe(false);
    });

    it('should apply config sync when templates are up to date', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
      });

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as { version: string };
      await fs.writeFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        `---
name: rasen-explore
metadata:
  generatedBy: "${packageJson.version}"
---
content
`
      );

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'explore.md'), 'old command');

      await updateCommand.execute(testDir);

      // A stale (pre-retirement) command file is cleaned up opportunistically,
      // even though the skill version is current and no tool needs an update.
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'explore.md')
      )).toBe(false);
    });

    it('should detect commands-only tool configuration', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'core',
      });

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'explore.md'), 'existing command');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Should not short-circuit with "No configured tools found"
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasNoConfiguredMessage = calls.some(call =>
        call.includes('No configured tools found')
      );
      expect(hasNoConfiguredMessage).toBe(false);

      // Skills are generated for the core profile; the pre-existing command
      // file is cleaned up (the surface is retired).
      expect(await FileSystemUtils.fileExists(
        path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md')
      )).toBe(true);
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'explore.md')
      )).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should remove workflows outside profile during update sync', async () => {
      // Set core profile (propose, explore, apply, sync, archive)
      setMockConfig({
        featureFlags: {},
        profile: 'core',
      });

      // Set up tool with extra workflows beyond core profile
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      // Add a non-core workflow
      await fs.mkdir(path.join(skillsDir, 'rasen-new-change'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-new-change', 'SKILL.md'), 'old');
      const extraCommandFile = path.join(testDir, '.claude', 'commands', 'rasen', 'new.md');
      await fs.mkdir(path.dirname(extraCommandFile), { recursive: true });
      await fs.writeFile(extraCommandFile, 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      // Deselected workflow artifacts should be removed.
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-new-change', 'SKILL.md')
      )).toBe(false);
      expect(await FileSystemUtils.fileExists(extraCommandFile)).toBe(false);

      // Should report deselected workflow cleanup.
      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasDeselectedRemovalNote = calls.some(call =>
        call.includes('deselected workflows')
      );
      expect(hasDeselectedRemovalNote).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should install the goal-loop workflow family under the full profile, with no command file', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'full',
      });

      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      const goalSkillDirs = [
        'rasen-goal-plan',
        'rasen-goal-iterate',
        'rasen-goal-judge',
        'rasen-goal-report',
        'rasen-goal',
      ];
      for (const skillDir of goalSkillDirs) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsDir, skillDir, 'SKILL.md')
        )).toBe(true);
      }

      // No goal directories should be removed by drift/cleanup logic under full profile
      const remainingSkillDirs = await fs.readdir(skillsDir);
      for (const skillDir of goalSkillDirs) {
        expect(remainingSkillDirs).toContain(skillDir);
      }

      // No command file is ever generated — the surface is retired.
      const goalCommandPath = path.join(testDir, '.claude', 'commands', 'rasen', 'goal.md');
      expect(await FileSystemUtils.fileExists(goalCommandPath)).toBe(false);
    });

    it('should never remove a skill dir for a workflow that used to have a command counterpart', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'full',
      });

      // Set up a configured tool
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      await updateCommand.execute(testDir);

      // Skill-only goal-loop stage workflows survive, as before.
      const goalStageSkillDirs = [
        'rasen-goal-plan',
        'rasen-goal-iterate',
        'rasen-goal-judge',
        'rasen-goal-report',
      ];
      for (const skillDir of goalStageSkillDirs) {
        expect(await FileSystemUtils.fileExists(
          path.join(skillsDir, skillDir, 'SKILL.md')
        )).toBe(true);
      }

      // A workflow that used to have a command counterpart (e.g. apply) ALSO
      // keeps its skill dir — no mode removes skill directories anymore
      // (design D5).
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-apply-change', 'SKILL.md')
      )).toBe(true);

      // No command file is ever generated — the surface is retired.
      const goalCommandPath = path.join(testDir, '.claude', 'commands', 'rasen', 'goal.md');
      expect(await FileSystemUtils.fileExists(goalCommandPath)).toBe(false);
    });

    it('should read a stored legacy delivery value without error, print a one-time retirement notice, strip it, and restore missing skills on update', async () => {
      const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
      const originalRasenHome = process.env.RASEN_HOME;
      const configTempDir = path.join(os.tmpdir(), `openspec-update-config-${randomUUID()}`);
      await fs.mkdir(configTempDir, { recursive: true });
      // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
      // outranks XDG_CONFIG_HOME — clear it so this test's XDG isolation
      // actually resolves into configTempDir (mockState.useReal below routes
      // getGlobalConfig() to the real implementation for this one test).
      delete process.env.RASEN_HOME;
      process.env.XDG_CONFIG_HOME = configTempDir;
      mockState.useReal = true;

      try {
        const configDir = path.join(configTempDir, 'rasen');
        const configPath = path.join(configDir, 'config.json');
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          configPath,
          JSON.stringify({ featureFlags: {}, profile: 'core', delivery: 'commands-first' })
        );

        // Project has only command files installed (skill dirs missing), as a
        // commands-first project would.
        const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
        await fs.mkdir(commandsDir, { recursive: true });
        await fs.writeFile(path.join(commandsDir, 'explore.md'), 'old command');

        const consoleErrorSpy = vi.spyOn(console, 'error');

        await updateCommand.execute(testDir);

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('commands-first'));

        const rewritten = JSON.parse(await fs.readFile(configPath, 'utf-8'));
        expect(rewritten.delivery).toBeUndefined();

        const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
        expect(await FileSystemUtils.fileExists(skillFile)).toBe(true);

        // The pre-existing (pre-retirement) command file is cleaned up.
        expect(await FileSystemUtils.fileExists(path.join(commandsDir, 'explore.md'))).toBe(false);
      } finally {
        mockState.useReal = false;
        process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        if (originalRasenHome === undefined) {
          delete process.env.RASEN_HOME;
        } else {
          process.env.RASEN_HOME = originalRasenHome;
        }
        await fs.rm(configTempDir, { recursive: true, force: true });
      }
    });

    it('should drop a retired workflow id (ff) from a stored custom profile with a warning, and still succeed', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['explore', 'ff', 'apply'],
      });

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await expect(updateCommand.execute(testDir)).resolves.not.toThrow();

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      expect(calls.some((call) => call.includes('ff'))).toBe(true);

      // The remaining known workflows are still updated normally.
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md')
      )).toBe(true);
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-apply-change', 'SKILL.md')
      )).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should heal a retired ff install (skill dir + command file) on update, and no-op when absent', async () => {
      // Simulate a machine that still has the retired rasen-ff-change skill
      // dir and ff command file from a prior install.
      const skillsDir = path.join(testDir, '.claude', 'skills');
      const retiredSkillDir = path.join(skillsDir, 'rasen-ff-change');
      await fs.mkdir(retiredSkillDir, { recursive: true });
      await fs.writeFile(path.join(retiredSkillDir, 'SKILL.md'), 'stale ff skill');

      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'ff.md'), 'stale ff command');

      await updateCommand.execute(testDir);

      expect(await FileSystemUtils.fileExists(retiredSkillDir)).toBe(false);
      expect(await FileSystemUtils.fileExists(
        path.join(commandsDir, 'ff.md')
      )).toBe(false);

      // Current artifacts are left intact.
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md')
      )).toBe(true);

      // Running again with nothing retired left is a no-op (no error).
      await expect(updateCommand.execute(testDir)).resolves.not.toThrow();
    });
  });

  describe('locked-profile updates (init-profile-lock)', () => {
    let homeDir: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      homeDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'rasen-update-lock-home-'));
      originalEnv = { ...process.env };
      process.env.RASEN_HOME = homeDir;
    });

    afterEach(() => {
      process.env = originalEnv;
      fsSync.rmSync(homeDir, { recursive: true, force: true });
    });

    it('resolves from the locked profile instead of the global profile and names the lock', async () => {
      setMockConfig({ featureFlags: {}, profile: 'core' });
      saveNamedProfile('team-web', {
              version: 2,
              workflows: ['explore', 'new'],
              retention: 'off',
            });
      await fs.writeFile(
        path.join(testDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprofile: team-web\n'
      );

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');
      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' '));
      expect(calls.some((call) => call.includes("locked to profile 'team-web'"))).toBe(true);

      // The locked selection is installed…
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-new-change', 'SKILL.md')
      )).toBe(true);
      // …and the global core profile does NOT govern (propose is core-only).
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-propose', 'SKILL.md')
      )).toBe(false);

      consoleSpy.mockRestore();
    });

    it('warns and falls back to the global profile when the locked profile does not exist', async () => {
      setMockConfig({ featureFlags: {}, profile: 'custom', workflows: ['explore'] });
      await fs.writeFile(
        path.join(testDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprofile: ghost-profile\n'
      );

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const warnSpy = vi.spyOn(console, 'warn');
      await updateCommand.execute(testDir);

      const warnings = warnSpy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' '));
      expect(warnings.some((warning) => warning.includes("ghost-profile"))).toBe(true);

      // Fallback applied the global custom selection (explore refreshed).
      const refreshed = await fs.readFile(
        path.join(skillsDir, 'rasen-explore', 'SKILL.md'),
        'utf-8'
      );
      expect(refreshed).not.toBe('old');

      warnSpy.mockRestore();
    });

    it('prefers a workflows override over the lock and warns about the shadowed lock', async () => {
      setMockConfig({ featureFlags: {}, profile: 'core' });
      saveNamedProfile('team-web', {
              version: 2,
              workflows: ['new'],
              retention: 'off',
            });
      await fs.writeFile(
        path.join(testDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprofile: team-web\nworkflows:\n  - explore\n'
      );

      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const warnSpy = vi.spyOn(console, 'warn');
      await updateCommand.execute(testDir);

      const warnings = warnSpy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' '));
      expect(warnings.some((warning) => warning.includes('team-web'))).toBe(true);

      // The override governs: only explore is installed, not the lock's `new`.
      expect(await FileSystemUtils.fileExists(
        path.join(skillsDir, 'rasen-new-change', 'SKILL.md')
      )).toBe(false);

      warnSpy.mockRestore();
    });
  });

  describe('new tool detection', () => {
    it('should detect new adapted tool directories not currently configured', async () => {
      const originalCodexHome = process.env.CODEX_HOME;
      // Isolate Codex's global command home so this empty test dir isn't
      // seen as "already configured" via real ~/.codex/prompts files.
      process.env.CODEX_HOME = path.join(testDir, '.codex-home-empty');
      try {
        // Set up a configured Claude tool
        const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
        await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), { recursive: true });
        await fs.writeFile(path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'), 'old');

        // Create a Codex directory (adapted, not configured — no skills)
        await fs.mkdir(path.join(testDir, '.codex'), { recursive: true });

        const consoleSpy = vi.spyOn(console, 'log');

        await updateCommand.execute(testDir);

        // Should detect Codex as a new tool
        const calls = consoleSpy.mock.calls.map(call =>
          call.map(arg => String(arg)).join(' ')
        );
        const hasNewToolMessage = calls.some(call =>
          call.includes("Detected new tool: Codex. Run 'rasen init' to add it.")
        );
        expect(hasNewToolMessage).toBe(true);

        consoleSpy.mockRestore();
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
      }
    });

    it('should not nudge for new unadapted tool directories (GitHub Copilot, Windsurf)', async () => {
      // Set up a configured Claude tool
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      // Create two unconfigured, unadapted tool directories — the "run rasen
      // init to add it" nudge must not suggest either, since init would
      // refuse them (adapted-agent-visibility).
      await fs.mkdir(path.join(testDir, '.github'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.github', 'copilot-instructions.md'), '');
      await fs.mkdir(path.join(testDir, '.windsurf'), { recursive: true });

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );

      expect(calls.some(call => call.includes('Detected new tool'))).toBe(false);
      expect(calls.some(call => call.includes('GitHub Copilot'))).toBe(false);
      expect(calls.some(call => call.includes('Windsurf'))).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should consolidate multiple new adapted tools into one message', async () => {
      const originalCodexHome = process.env.CODEX_HOME;
      // Isolate Codex's global command home (see note above).
      process.env.CODEX_HOME = path.join(testDir, '.codex-home-empty');
      try {
        // No tools configured yet; both adapted tool directories are present
        // (Claude configured, Codex detected-only).
        const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
        await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), { recursive: true });
        await fs.writeFile(path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'), 'old');
        await fs.mkdir(path.join(testDir, '.codex'), { recursive: true });
        // Also mix in an unadapted, unconfigured directory to prove it's excluded.
        await fs.mkdir(path.join(testDir, '.windsurf'), { recursive: true });

        const consoleSpy = vi.spyOn(console, 'log');

        await updateCommand.execute(testDir);

        const calls = consoleSpy.mock.calls.map(call =>
          call.map(arg => String(arg)).join(' ')
        );

        const newToolCalls = calls.filter(call => call.includes('Detected new tool'));
        expect(newToolCalls).toHaveLength(1);
        expect(newToolCalls[0]).toContain('Codex');
        expect(newToolCalls[0]).not.toContain('Windsurf');

        consoleSpy.mockRestore();
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
      }
    });

    it('should not show new tool message when no new tools detected', async () => {
      // Set up a configured tool (only Claude, no other tool directories)
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasNewToolMessage = calls.some(call =>
        call.includes('Detected new tool')
      );
      expect(hasNewToolMessage).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('scanInstalledWorkflows', () => {
    it('should detect installed workflows across tools', async () => {
      // Create skills for Claude
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'), 'content');
      await fs.mkdir(path.join(claudeSkillsDir, 'rasen-apply-change'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'rasen-apply-change', 'SKILL.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toContain('explore');
      expect(workflows).toContain('apply');
      expect(workflows).not.toContain('propose');
    });

    it('should return union of workflows across multiple tools', async () => {
      // Claude has explore
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(claudeSkillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(claudeSkillsDir, 'rasen-explore', 'SKILL.md'), 'content');

      // Cursor has apply
      const cursorSkillsDir = path.join(testDir, '.cursor', 'skills');
      await fs.mkdir(path.join(cursorSkillsDir, 'rasen-apply-change'), { recursive: true });
      await fs.writeFile(path.join(cursorSkillsDir, 'rasen-apply-change', 'SKILL.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude', 'cursor']);
      expect(workflows).toContain('explore');
      expect(workflows).toContain('apply');
    });

    it('should only match workflows in ALL_WORKFLOWS', async () => {
      // Create a custom skill directory that doesn't match any workflow
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'my-custom-skill'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'my-custom-skill', 'SKILL.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toHaveLength(0);
    });

    it('should return empty array when no tools have skills', async () => {
      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toHaveLength(0);
    });

    it('should detect installed workflows from managed command files', async () => {
      const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
      await fs.mkdir(commandsDir, { recursive: true });
      await fs.writeFile(path.join(commandsDir, 'explore.md'), 'content');

      const workflows = scanInstalledWorkflows(testDir, ['claude']);
      expect(workflows).toContain('explore');
    });
  });

  describe('tools output', () => {
    it('should list affected tools in output', async () => {
      const skillsDir = path.join(testDir, '.claude', 'skills');
      await fs.mkdir(path.join(skillsDir, 'rasen-explore'), { recursive: true });
      await fs.writeFile(path.join(skillsDir, 'rasen-explore', 'SKILL.md'), 'old');

      const consoleSpy = vi.spyOn(console, 'log');

      await updateCommand.execute(testDir);

      const calls = consoleSpy.mock.calls.map(call =>
        call.map(arg => String(arg)).join(' ')
      );
      const hasToolsList = calls.some(call =>
        call.includes('Tools:') && call.includes('Claude Code')
      );
      expect(hasToolsList).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('surfacing newly-available built-in workflows (update-sync-new-workflows)', () => {
    // Pin the locale so the literal-English marker is deterministic regardless
    // of the host machine's CLI locale (the note is localized).
    const NOTE_MARKER = 'new built-in workflow';
    let savedRasenLang: string | undefined;
    beforeEach(() => {
      savedRasenLang = process.env.RASEN_LANG;
      process.env.RASEN_LANG = 'en';
    });
    afterEach(() => {
      if (savedRasenLang === undefined) delete process.env.RASEN_LANG;
      else process.env.RASEN_LANG = savedRasenLang;
    });
    // A custom selection saved before `audit` joined the catalog: it omits
    // audit and every path treats it verbatim.
    const customBeforeAudit = ALL_WORKFLOWS.filter((id) => id !== 'audit');

    function warnedMessages(spy: ReturnType<typeof vi.spyOn>): string[] {
      return spy.mock.calls.map((call) => String(call[0]));
    }

    it('surfaces the note for a custom selection whose baseline predates audit, and leaves config.workflows unchanged', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: [...customBeforeAudit],
        expertSelectionExplicit: true,
        knownBuiltInWorkflows: [...customBeforeAudit],
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await updateCommand.execute(testDir);

      expect(warnedMessages(warnSpy).some((m) => m.includes(NOTE_MARKER) && m.includes('audit'))).toBe(true);
      // The stored selection is never rewritten to absorb the workflow.
      const saveMock = saveGlobalConfig as unknown as ReturnType<typeof vi.fn>;
      for (const call of saveMock.mock.calls) {
        const saved = call[0] as GlobalConfig;
        if (saved.workflows) expect(saved.workflows).not.toContain('audit');
      }

      warnSpy.mockRestore();
    });

    it('does not surface a workflow the baseline already knew (deliberate deselection)', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: [...customBeforeAudit],
        expertSelectionExplicit: true,
        // audit is already in the baseline: the user deselected it deliberately.
        knownBuiltInWorkflows: [...getCurrentBuiltInWorkflowIds()],
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await updateCommand.execute(testDir);

      expect(warnedMessages(warnSpy).some((m) => m.includes(NOTE_MARKER))).toBe(false);
      warnSpy.mockRestore();
    });

    it('does not surface for a full profile (live catalog already includes every built-in)', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'full',
        expertSelectionExplicit: true,
        knownBuiltInWorkflows: [...customBeforeAudit],
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await updateCommand.execute(testDir);

      expect(warnedMessages(warnSpy).some((m) => m.includes(NOTE_MARKER))).toBe(false);
      warnSpy.mockRestore();
    });

    it('seeds the baseline silently on a legacy config lacking it (no note that run)', async () => {
      setMockConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: [...customBeforeAudit],
        expertSelectionExplicit: true,
        // No knownBuiltInWorkflows field: a pre-behavior config.
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await updateCommand.execute(testDir);

      expect(warnedMessages(warnSpy).some((m) => m.includes(NOTE_MARKER))).toBe(false);
      // The baseline is recorded with the currently-known built-ins.
      const saveMock = saveGlobalConfig as unknown as ReturnType<typeof vi.fn>;
      const seeded = saveMock.mock.calls
        .map((call) => call[0] as GlobalConfig)
        .find((cfg) => Array.isArray(cfg.knownBuiltInWorkflows));
      expect(seeded).toBeDefined();
      expect(seeded!.knownBuiltInWorkflows).toContain('audit');

      warnSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// project-install-manifest integration tests (M2, M4, M5 flag behavior)
// ---------------------------------------------------------------------------

describe('UpdateCommand manifest-honors-update (project-install-manifest M2)', () => {
  let testDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-manifest-${randomUUID()}`);
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
    dataDir = path.join(os.tmpdir(), `rasen-manifest-data-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(dataDir, 'config');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function writeConfig(yaml: string): void {
    fsSync.writeFileSync(path.join(testDir, 'rasen', 'config.yaml'), yaml);
  }

  function writeClaudeSkill(old = false): void {
    const dir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(
      path.join(dir, 'SKILL.md'),
      old
        ? '---\nname: rasen-explore (old)\n---\nOld content\n'
        : '---\ngeneratedBy: "0.0.1"\nname: rasen-explore\n---\nOld\n'
    );
  }

  function writeCodexSkill(): void {
    const dir = path.join(testDir, '.codex', 'skills', 'rasen-propose');
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\ngeneratedBy: "0.0.1"\nname: rasen-propose\n---\nStray\n'
    );
  }

  function consoleText(): string {
    return (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c.join(' '))
      .join('\n');
  }

  it('(M2a) manifest [claude] refreshes only Claude even with stray .codex skill', async () => {
    writeConfig('schema: spec-driven\ntools:\n  - claude\n');
    writeClaudeSkill(true);
    writeCodexSkill(); // stray — should NOT be refreshed

    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    const text = consoleText();
    // Claude is updated.
    expect(text).toMatch(/Updating.*claude/i);
    // Codex is NOT in the update list.
    expect(text).not.toMatch(/Updating.*codex/i);
  });

  it('(M2b) absent manifest seeds and prints seed message exactly once', async () => {
    writeConfig('schema: spec-driven\n');
    writeClaudeSkill(true);

    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    const text = consoleText();
    expect(text).toContain('Seeded tools: claude');
    // The seed message appears exactly once.
    expect(text.split('Seeded tools:').length - 1).toBe(1);
  });

  it('(M2c) empty manifest shows "No configured tools found." without scanning disk', async () => {
    writeConfig('schema: spec-driven\ntools: []\n');
    // Put a skill file on disk — it should NOT be detected because manifest is empty.
    writeClaudeSkill(true);

    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    const text = consoleText();
    expect(text).toContain('No configured tools found');
    expect(text).not.toMatch(/Updating.*tool/i);
  });

  it('(M2d) manifest [claude, codex] with .codex/skills/ deleted regenerates Codex', async () => {
    writeConfig('schema: spec-driven\ntools:\n  - claude\n  - codex\n');
    writeClaudeSkill(true);
    // Deliberately do NOT create .codex/skills/ — manifest is authoritative.

    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    const text = consoleText();
    // Both tools are refreshed (manifest is authoritative, not disk state).
    expect(text).toMatch(/Updating.*claude/i);
    expect(text).toMatch(/Updating.*codex/i);
  });

  it('(M2e) second run after seeding does not re-seed (idempotent)', async () => {
    writeConfig('schema: spec-driven\n');
    writeClaudeSkill(true);

    // First run: seeds.
    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Second run: manifest is present, should NOT re-seed.
    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    const text = consoleText();
    expect(text).not.toContain('Seeded tools:');
  });
});

describe('UpdateCommand version-cache write (project-install-manifest M4)', () => {
  let testDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-vcache-${randomUUID()}`);
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
    dataDir = path.join(os.tmpdir(), `rasen-vcache-data-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(dataDir, 'config');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('(M4a) successful update writes installedVersion, lastUpdated, and tools to registry', async () => {
    fsSync.writeFileSync(
      path.join(testDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\ntools:\n  - claude\n'
    );
    const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
    fsSync.mkdirSync(skillDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\ngeneratedBy: "0.0.1"\nname: rasen-explore\n---\nOld\n'
    );

    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    const { readProjectRegistryState } = await import('../../src/core/project-registry.js');
    const state = await readProjectRegistryState({});
    expect(state).not.toBeNull();
    const entries = Object.values(state!.projects);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries.find((e) => e.installedVersion !== undefined);
    expect(entry).toBeDefined();
    expect(entry!.installedVersion).toBeDefined();
    expect(entry!.lastUpdated).toBeDefined();
    expect(entry!.tools).toEqual(['claude']);
  });

  it('(M4b) failed update leaves cache unchanged (MUST-NOT-advance-before-success)', async () => {
    // Register the project first with an old cache.
    const { resolveProjectHome, touchProjectRegistry } = await import(
      '../../src/core/project-home.js'
    );
    const { readProjectRegistryState } = await import(
      '../../src/core/project-registry.js'
    );
    fsSync.writeFileSync(
      path.join(testDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\ntools:\n  - claude\n'
    );
    const home = await resolveProjectHome(testDir, {});
    expect(home).not.toBeNull();

    // Pre-seed an old installedVersion.
    await touchProjectRegistry(testDir, { tools: ['claude'], installedVersion: '0.1.5' });

    const stateBefore = await readProjectRegistryState({});
    const entryBefore = Object.values(stateBefore!.projects).find(
      (e) => e.installedVersion === '0.1.5'
    );
    expect(entryBefore).toBeDefined();

    // Now break the project: remove rasen/ so execute() throws early.
    await fs.rm(path.join(testDir, 'rasen'), { recursive: true, force: true });

    await expect(new UpdateCommand({ onlyThis: true }).execute(testDir)).rejects.toThrow();

    // Cache should be unchanged.
    const stateAfter = await readProjectRegistryState({});
    const entryAfter = Object.values(stateAfter!.projects).find((e) => e.projectId === entryBefore!.projectId);
    expect(entryAfter!.installedVersion).toBe('0.1.5');
  });
});

describe('UpdateCommand multi-project flags (project-install-manifest M5)', () => {
  let testDir: string;
  let dataDir: string;
  let fixturesRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-mp-flags-${randomUUID()}`);
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
    dataDir = path.join(os.tmpdir(), `rasen-mp-flags-data-${randomUUID()}`);
    await fs.mkdir(dataDir, { recursive: true });
    fixturesRoot = path.join(os.tmpdir(), `rasen-mp-fix-${randomUUID()}`);
    await fs.mkdir(fixturesRoot, { recursive: true });
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(dataDir, 'config');
    process.env.OPEN_SPEC_INTERACTIVE = '0';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset multi-project mocks to passthrough after any prior override.
    vi.mocked(enumerateBehindProjects).mockImplementation(
      mpuActual.enumerateBehindProjects as typeof enumerateBehindProjects
    );
    vi.mocked(updateMultipleProjects).mockImplementation(
      mpuActual.updateMultipleProjects as typeof updateMultipleProjects
    );
    vi.mocked(isInteractive).mockImplementation(
      mpuActual.isInteractive as typeof isInteractive
    );
    vi.mocked(inquirerSelect).mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(fixturesRoot, { recursive: true, force: true });
  });

  // Set up the current project with a non-empty manifest and a stale Claude skill.
  function setupCurrentProject(): void {
    fsSync.writeFileSync(
      path.join(testDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\ntools:\n  - claude\n'
    );
    const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
    fsSync.mkdirSync(skillDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\ngeneratedBy: "0.0.1"\nname: rasen-explore\n---\nOld\n'
    );
  }

  // Create a behind-project directory with a stale Claude skill.
  function makeBehindProjectDir(name: string, pinned = false): string {
    const dir = path.join(fixturesRoot, name);
    fsSync.mkdirSync(path.join(dir, 'rasen'), { recursive: true });
    const pinYaml = pinned ? 'update:\n  pin: true\n' : '';
    fsSync.writeFileSync(
      path.join(dir, 'rasen', 'config.yaml'),
      `schema: spec-driven\ntools:\n  - claude\n${pinYaml}`
    );
    const skillDir = path.join(dir, '.claude', 'skills', 'rasen-explore');
    fsSync.mkdirSync(skillDir, { recursive: true });
    fsSync.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\ngeneratedBy: "0.0.1"\nname: rasen-explore\n---\nOld behind\n'
    );
    return dir;
  }

  // Register a project in the isolated registry. Does NOT pass globalDataDir:
  // registerProject and enumerateBehindProjects (inside offerMultiProjectUpdate)
  // must both resolve through getGlobalDataDir() (which reads XDG_DATA_HOME) so
  // they agree on the same registry path.
  async function registerBehind(
    dir: string,
    name: string,
    options: { version?: string; tools?: string[] } = {}
  ): Promise<void> {
    await registerProject({
      projectRoot: dir,
      projectId: `mp-${name}-${randomUUID().slice(0, 8)}`,
      mode: 'in-repo',
      ...(options.version !== undefined ? { installedVersion: options.version } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
    });
  }

  function consoleText(): string {
    return (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c.join(' '))
      .join('\n');
  }

  // (M5d) --only-this must completely skip step 17 (offerMultiProjectUpdate).
  // Non-vacuity: if the `if (!this.onlyThis)` guard at update.ts:517 is removed,
  // offerMultiProjectUpdate runs and calls enumerateBehindProjects. The spy
  // assertion `not.toHaveBeenCalled()` would then fail.
  it('(M5d) --only-this does not consult the registry for multi-project', async () => {
    setupCurrentProject();
    // Set up a real behind project to prove the registry data exists.
    const behind = makeBehindProjectDir('behind-d');
    await registerBehind(behind, 'behind-d', { version: '0.0.1', tools: ['claude'] });

    await new UpdateCommand({ onlyThis: true }).execute(testDir);

    // The multi-project enumeration was never called (step 17 skipped entirely).
    expect(enumerateBehindProjects).not.toHaveBeenCalled();
    // No multi-project output whatsoever.
    const text = consoleText();
    expect(text).not.toContain('Multi-project update');
    expect(text).not.toContain('All registered projects are current');
    // The behind project's skill was NOT updated (still stale).
    const behindSkill = fsSync.readFileSync(
      path.join(behind, '.claude', 'skills', 'rasen-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(behindSkill).toContain('Old behind');
  });

  // (M5f) Non-interactive without --all-projects must skip the offer.
  // Non-vacuity: if the `if (!interactive && !this.allProjects) { return; }` gate
  // at update.ts:574 is removed, the code proceeds to updateMultipleProjects.
  // The spy assertion `not.toHaveBeenCalled()` would then fail.
  it('(M5f) non-interactive without --all-projects does not update other projects', async () => {
    setupCurrentProject();
    const behind = makeBehindProjectDir('behind-f');
    await registerBehind(behind, 'behind-f', { version: '0.0.1', tools: ['claude'] });

    // Non-interactive: OPEN_SPEC_INTERACTIVE=0 is set in beforeEach.
    await new UpdateCommand().execute(testDir);

    // The registry WAS consulted (enumerateBehindProjects ran).
    expect(enumerateBehindProjects).toHaveBeenCalled();
    // But no batch update happened.
    expect(updateMultipleProjects).not.toHaveBeenCalled();
    // No prompt was shown.
    expect(inquirerSelect).not.toHaveBeenCalled();
    // The behind project's skill was NOT updated.
    const behindSkill = fsSync.readFileSync(
      path.join(behind, '.claude', 'skills', 'rasen-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(behindSkill).toContain('Old behind');
  });

  // (M5g) --all-projects bypasses the prompt and updates all reachable non-pinned
  // behind projects.
  // Non-vacuity: if the --all-projects path stops triggering the batch (e.g. the
  // gate at update.ts:574 always returns), updateMultipleProjects is never called
  // and the reachable project's skill stays stale.
  it('(M5g) --all-projects updates reachable non-pinned behind projects without prompting', async () => {
    setupCurrentProject();
    // Behind project 1: reachable, non-pinned, old version → should be updated.
    const reachable = makeBehindProjectDir('reachable-g', false);
    await registerBehind(reachable, 'reachable-g', { version: '0.0.1', tools: ['claude'] });
    // Behind project 2: pinned → excluded by enumeration (update.pin: true).
    const pinned = makeBehindProjectDir('pinned-g', true);
    await registerBehind(pinned, 'pinned-g', { version: '0.0.1', tools: ['claude'] });
    // Behind project 3: missing directory → excluded by enumeration.
    const missingDir = path.join(fixturesRoot, 'missing-g');
    await registerBehind(missingDir, 'missing-g', { version: '0.0.1', tools: ['claude'] });

    await new UpdateCommand({ allProjects: true }).execute(testDir);

    // No prompt was shown.
    expect(inquirerSelect).not.toHaveBeenCalled();
    // The batch update ran.
    expect(updateMultipleProjects).toHaveBeenCalled();
    // The reachable project's skill was refreshed (no longer stale).
    const reachableSkill = fsSync.readFileSync(
      path.join(reachable, '.claude', 'skills', 'rasen-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(reachableSkill).not.toContain('Old behind');
    // The pinned project's skill was NOT updated (excluded by enumeration).
    const pinnedSkill = fsSync.readFileSync(
      path.join(pinned, '.claude', 'skills', 'rasen-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(pinnedSkill).toContain('Old behind');
    // Multi-project summary was printed.
    expect(consoleText()).toContain('Multi-project update');
  });

  // (M5h-1) Interactive prompt defaults to Skip — no projects updated.
  // Non-vacuity: if the prompt is removed, inquirerSelect is never called.
  it('(M5h-1) interactive prompt defaults to Skip (no projects updated)', async () => {
    setupCurrentProject();
    const behind = makeBehindProjectDir('behind-h1');
    await registerBehind(behind, 'behind-h1', { version: '0.0.1', tools: ['claude'] });

    // Override interactivity for this test.
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(inquirerSelect).mockResolvedValue('skip');

    await new UpdateCommand().execute(testDir);

    // The prompt was shown.
    expect(inquirerSelect).toHaveBeenCalled();
    // No batch update happened (user chose Skip).
    expect(updateMultipleProjects).not.toHaveBeenCalled();
    // The behind project's skill was NOT updated.
    const behindSkill = fsSync.readFileSync(
      path.join(behind, '.claude', 'skills', 'rasen-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(behindSkill).toContain('Old behind');
  });

  // (M5h-2) Interactive prompt "Update all" updates reachable behind projects.
  // Non-vacuity: if "Update all" stops triggering the batch, updateMultipleProjects
  // is never called and the behind project's skill stays stale.
  it('(M5h-2) interactive prompt "Update all" updates reachable behind projects', async () => {
    setupCurrentProject();
    const behind = makeBehindProjectDir('behind-h2');
    await registerBehind(behind, 'behind-h2', { version: '0.0.1', tools: ['claude'] });

    // Override interactivity for this test.
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(inquirerSelect).mockResolvedValue('all');

    await new UpdateCommand().execute(testDir);

    // The prompt was shown.
    expect(inquirerSelect).toHaveBeenCalled();
    // The batch update ran.
    expect(updateMultipleProjects).toHaveBeenCalled();
    // The behind project's skill was refreshed.
    const behindSkill = fsSync.readFileSync(
      path.join(behind, '.claude', 'skills', 'rasen-explore', 'SKILL.md'),
      'utf-8'
    );
    expect(behindSkill).not.toContain('Old behind');
  });
});
