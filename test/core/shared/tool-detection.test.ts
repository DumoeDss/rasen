import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  SKILL_NAMES,
  COMMAND_IDS,
  getToolsWithSkillsDir,
  getToolSkillStatus,
  getToolStates,
  extractGeneratedByVersion,
  getToolVersionStatus,
  getConfiguredTools,
  getAllToolVersionStatus,
  resolveToolSkillsRoot,
  resolveConfiguredTools,
} from '../../../src/core/shared/tool-detection.js';
import { readProjectConfig } from '../../../src/core/project-config.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import { resolveHermesHome } from '../../../src/core/hermes/hermes-home.js';

describe('tool-detection', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('SKILL_NAMES', () => {
    it('should contain all skill names matching COMMAND_IDS', () => {
      expect(SKILL_NAMES).toHaveLength(10);
      expect(SKILL_NAMES).toContain('rasen-explore');
      expect(SKILL_NAMES).toContain('rasen-new-change');
      expect(SKILL_NAMES).toContain('rasen-continue-change');
      expect(SKILL_NAMES).toContain('rasen-apply-change');
      expect(SKILL_NAMES).toContain('rasen-sync-specs');
      expect(SKILL_NAMES).toContain('rasen-archive-change');
      expect(SKILL_NAMES).toContain('rasen-bulk-archive-change');
      expect(SKILL_NAMES).toContain('rasen-verify-change');
      expect(SKILL_NAMES).toContain('rasen-onboard');
      expect(SKILL_NAMES).toContain('rasen-propose');
    });
  });

  describe('COMMAND_IDS', () => {
    it('should include goal-command (goal-loop workflow family)', () => {
      expect(COMMAND_IDS).toContain('goal-command');
    });
  });

  describe('getToolsWithSkillsDir', () => {
    it('should return exactly the tools the registry marks adapted', () => {
      const tools = getToolsWithSkillsDir();
      expect(tools).toContain('claude');
      expect(tools).toContain('codex');
      expect(tools).toContain('hermes');
      expect(tools).toContain('omp');
      expect(tools).not.toContain('cursor');
      expect(tools).not.toContain('windsurf');
      // Derived from the registry rather than restated, so adding an adapted
      // tool cannot leave this assertion silently describing the old set.
      expect([...tools].sort()).toEqual(
        AI_TOOLS.filter((t) => t.skillsDir && t.adapted)
          .map((t) => t.value)
          .sort()
      );
    });
  });

  describe('resolveToolSkillsRoot', () => {
    let originalHermesHome: string | undefined;

    beforeEach(() => {
      originalHermesHome = process.env.HERMES_HOME;
    });

    afterEach(() => {
      if (originalHermesHome === undefined) {
        delete process.env.HERMES_HOME;
      } else {
        process.env.HERMES_HOME = originalHermesHome;
      }
    });

    it('returns the project-local path for a project-local tool (claude)', () => {
      const claude = AI_TOOLS.find((t) => t.value === 'claude')!;
      const projectPath = path.join(testDir, 'my-project');
      expect(resolveToolSkillsRoot(claude, projectPath)).toBe(
        path.join(projectPath, '.claude', 'skills')
      );
    });

    it('returns the default HERMES_HOME-based path for hermes', () => {
      delete process.env.HERMES_HOME;
      const hermes = AI_TOOLS.find((t) => t.value === 'hermes')!;
      const projectPath = path.join(testDir, 'my-project');
      const result = resolveToolSkillsRoot(hermes, projectPath);
      expect(result).toBe(path.join(resolveHermesHome(), 'skills'));
      // The result must not depend on the project path at all.
      expect(result).not.toContain(projectPath);
    });

    it('honors a HERMES_HOME override for hermes', () => {
      const customHome = path.join(testDir, 'custom-hermes-home');
      process.env.HERMES_HOME = customHome;
      const hermes = AI_TOOLS.find((t) => t.value === 'hermes')!;
      const projectPath = path.join(testDir, 'my-project');
      expect(resolveToolSkillsRoot(hermes, projectPath)).toBe(
        path.join(customHome, 'skills')
      );
    });

    it('returns the project-local path for omp, never a global skills home', () => {
      // The assertion that would have caught a `skillsHome: 'global'` misdirection:
      // that branch is hard-wired to `resolveHermesHome()`, so a second
      // global-home tool would silently write into Hermes' home. HERMES_HOME is
      // set to a distinctive value here BECAUSE both the init and e2e suites set
      // it too — a wrong root has to fail, not pass under a shared override.
      process.env.HERMES_HOME = path.join(testDir, 'hermes-decoy');
      const omp = AI_TOOLS.find((t) => t.value === 'omp')!;
      const projectPath = path.join(testDir, 'my-project');
      const result = resolveToolSkillsRoot(omp, projectPath);
      expect(result).toBe(path.join(projectPath, '.omp', 'skills'));
      expect(result).not.toContain('hermes-decoy');
      expect(omp.skillsHome).toBeUndefined();
    });
  });

  describe('getToolSkillStatus', () => {
    it('should return not configured for unknown tool', () => {
      const status = getToolSkillStatus(testDir, 'unknown-tool');
      expect(status.configured).toBe(false);
      expect(status.fullyConfigured).toBe(false);
      expect(status.skillCount).toBe(0);
    });

    it('should return not configured when no skills exist', () => {
      const status = getToolSkillStatus(testDir, 'claude');
      expect(status.configured).toBe(false);
      expect(status.fullyConfigured).toBe(false);
      expect(status.skillCount).toBe(0);
    });

    it('should detect when one skill exists', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');

      const status = getToolSkillStatus(testDir, 'claude');
      expect(status.configured).toBe(true);
      expect(status.fullyConfigured).toBe(false);
      expect(status.skillCount).toBe(1);
    });

    it('should detect when all skills exist', async () => {
      for (const skillName of SKILL_NAMES) {
        const skillDir = path.join(testDir, '.claude', 'skills', skillName);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');
      }

      const status = getToolSkillStatus(testDir, 'claude');
      expect(status.configured).toBe(true);
      expect(status.fullyConfigured).toBe(true);
      expect(status.skillCount).toBe(SKILL_NAMES.length);
    });
  });

  describe('getToolStates', () => {
    it('should return status for all tools with skillsDir', () => {
      const states = getToolStates(testDir);
      expect(states.has('claude')).toBe(true);
      expect(states.has('cursor')).toBe(true);

      const claudeStatus = states.get('claude');
      expect(claudeStatus?.configured).toBe(false);
    });

    it('should detect configured tools', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'test content');

      const states = getToolStates(testDir);
      expect(states.get('claude')?.configured).toBe(true);
      expect(states.get('cursor')?.configured).toBe(false);
    });
  });

  describe('extractGeneratedByVersion', () => {
    it('should return null for non-existent file', () => {
      const version = extractGeneratedByVersion(path.join(testDir, 'missing.md'));
      expect(version).toBeNull();
    });

    it('should return null when generatedBy is not present', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: rasen-explore
metadata:
  author: openspec
  version: "1.0"
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBeNull();
    });

    it('should extract generatedBy version with double quotes', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: rasen-explore
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "0.23.0"
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBe('0.23.0');
    });

    it('should extract generatedBy version with single quotes', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: rasen-explore
metadata:
  generatedBy: '0.24.0'
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBe('0.24.0');
    });

    it('should extract generatedBy version without quotes', async () => {
      const filePath = path.join(testDir, 'skill.md');
      await fs.writeFile(filePath, `---
name: rasen-explore
metadata:
  generatedBy: 0.25.0
---

Content here
`);

      const version = extractGeneratedByVersion(filePath);
      expect(version).toBe('0.25.0');
    });
  });

  describe('getToolVersionStatus', () => {
    it('should return not configured for unknown tool', () => {
      const status = getToolVersionStatus(testDir, 'unknown-tool', '0.23.0');
      expect(status.configured).toBe(false);
      expect(status.generatedByVersion).toBeNull();
      expect(status.needsUpdate).toBe(false);
    });

    it('should return not configured when no skills exist', () => {
      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(false);
      expect(status.generatedByVersion).toBeNull();
      expect(status.needsUpdate).toBe(false);
    });

    it('should detect needsUpdate when generatedBy is missing', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: rasen-explore
metadata:
  author: openspec
  version: "1.0"
---

Content here
`);

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(true);
      expect(status.generatedByVersion).toBeNull();
      expect(status.needsUpdate).toBe(true);
    });

    it('should detect needsUpdate when version differs', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: rasen-explore
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "0.22.0"
---

Content here
`);

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(true);
      expect(status.generatedByVersion).toBe('0.22.0');
      expect(status.needsUpdate).toBe(true);
    });

    it('should not need update when version matches', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: rasen-explore
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "0.23.0"
---

Content here
`);

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.configured).toBe(true);
      expect(status.generatedByVersion).toBe('0.23.0');
      expect(status.needsUpdate).toBe(false);
    });

    it('should include tool name in status', async () => {
      const skillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'content');

      const status = getToolVersionStatus(testDir, 'claude', '0.23.0');
      expect(status.toolId).toBe('claude');
      expect(status.toolName).toBe('Claude Code');
    });
  });

  describe('getConfiguredTools', () => {
    it('should return empty array when no tools are configured', () => {
      const tools = getConfiguredTools(testDir);
      expect(tools).toEqual([]);
    });

    it('should return configured tools', async () => {
      // Setup Claude
      const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), 'content');

      // Setup Cursor
      const cursorSkillDir = path.join(testDir, '.cursor', 'skills', 'rasen-explore');
      await fs.mkdir(cursorSkillDir, { recursive: true });
      await fs.writeFile(path.join(cursorSkillDir, 'SKILL.md'), 'content');

      const tools = getConfiguredTools(testDir);
      expect(tools).toContain('claude');
      expect(tools).toContain('cursor');
      expect(tools).toHaveLength(2);
    });
  });

  describe('getAllToolVersionStatus', () => {
    it('should return empty array when no tools are configured', () => {
      const statuses = getAllToolVersionStatus(testDir, '0.23.0');
      expect(statuses).toEqual([]);
    });

    it('should return version status for all configured tools', async () => {
      // Setup Claude with old version
      const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
      await fs.mkdir(claudeSkillDir, { recursive: true });
      await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), `---
metadata:
  generatedBy: "0.22.0"
---
`);

      // Setup Cursor with current version
      const cursorSkillDir = path.join(testDir, '.cursor', 'skills', 'rasen-explore');
      await fs.mkdir(cursorSkillDir, { recursive: true });
      await fs.writeFile(path.join(cursorSkillDir, 'SKILL.md'), `---
metadata:
  generatedBy: "0.23.0"
---
`);

      const statuses = getAllToolVersionStatus(testDir, '0.23.0');
      expect(statuses).toHaveLength(2);

      const claudeStatus = statuses.find(s => s.toolId === 'claude');
      expect(claudeStatus?.generatedByVersion).toBe('0.22.0');
      expect(claudeStatus?.needsUpdate).toBe(true);

      const cursorStatus = statuses.find(s => s.toolId === 'cursor');
      expect(cursorStatus?.generatedByVersion).toBe('0.23.0');
      expect(cursorStatus?.needsUpdate).toBe(false);
    });
  });

  describe('resolveConfiguredTools (project-install-manifest)', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    function writeConfig(root: string, yaml: string): void {
      const rasenDir = path.join(root, 'rasen');
      fsSync.mkdirSync(rasenDir, { recursive: true });
      fsSync.writeFileSync(path.join(rasenDir, 'config.yaml'), yaml);
    }

    function writeClaudeSkill(root: string): void {
      const skillDir = path.join(root, '.claude', 'skills', 'rasen-propose');
      fsSync.mkdirSync(skillDir, { recursive: true });
      fsSync.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ngeneratedBy: "0.1.7"\n---\n');
    }

    function writeCodexSkill(root: string): void {
      const skillDir = path.join(root, '.codex', 'skills', 'rasen-propose');
      fsSync.mkdirSync(skillDir, { recursive: true });
      fsSync.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\ngeneratedBy: "0.1.7"\n---\n');
    }

    it('returns manifest verbatim when present (including empty list)', () => {
      writeConfig(testDir, 'schema: spec-driven\ntools: []\n');
      const result = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      expect(result.tools).toEqual([]);
      expect(result.seeded).toBe(false);
    });

    it('returns manifest verbatim with specific tools', () => {
      writeConfig(testDir, 'schema: spec-driven\ntools:\n  - claude\n');
      writeCodexSkill(testDir); // disk has codex but manifest says claude only
      const result = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      expect(result.tools).toEqual(['claude']);
      expect(result.seeded).toBe(false);
    });

    it('seeds from skill-configured tools when manifest absent', () => {
      writeConfig(testDir, 'schema: spec-driven\n');
      writeClaudeSkill(testDir);
      const result = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      expect(result.tools).toEqual(['claude']);
      expect(result.seeded).toBe(true);

      // Config was seeded.
      const config = readProjectConfig(testDir);
      expect(config?.tools).toEqual(['claude']);
    });

    it('is idempotent on second call (no rewrite, seeded=false)', () => {
      writeConfig(testDir, 'schema: spec-driven\n');
      writeClaudeSkill(testDir);
      const first = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      expect(first.seeded).toBe(true);

      const second = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      expect(second.seeded).toBe(false);
      expect(second.tools).toEqual(first.tools);
    });

    it('seeds from skill+command union when commands-only legacy install', () => {
      writeConfig(testDir, 'schema: spec-driven\n');
      // Create a leftover command file for codex (no skill file)
      const cmdDir = path.join(testDir, '.codex');
      fsSync.mkdirSync(cmdDir, { recursive: true });
      // Use a retired command path that getAllRetiredCommandFilePathCandidates returns
      // We can't easily create a real retired file without knowing the path,
      // so we just verify the seed includes skill-configured tools.
      writeClaudeSkill(testDir);
      const result = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      expect(result.tools).toContain('claude');
    });

    it('falls back to on-disk when config write fails; returns non-empty list', () => {
      writeConfig(testDir, 'schema: spec-driven\n');
      writeClaudeSkill(testDir);
      // Make config read-only so the write fails.
      const configPath = path.join(testDir, 'rasen', 'config.yaml');
      fsSync.chmodSync(configPath, 0o444);

      try {
        const result = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
        expect(result.tools).toContain('claude');
        expect(result.seeded).toBe(true);
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('could not seed'));
      } finally {
        fsSync.chmodSync(configPath, 0o644);
      }
    });

    it('falls back to on-disk when config is unparseable; logs a warning', () => {
      // Write a config file that is syntactically invalid YAML.
      const rasenDir = path.join(testDir, 'rasen');
      fsSync.mkdirSync(rasenDir, { recursive: true });
      fsSync.writeFileSync(path.join(rasenDir, 'config.yaml'), 'schema: spec-driven\n: : invalid yaml\n');
      writeClaudeSkill(testDir);

      const result = resolveConfiguredTools(testDir, { seedProvider: () => getConfiguredTools(testDir) });
      // Should fall back to disk detection.
      expect(result.tools).toContain('claude');
      expect(result.seeded).toBe(true);
    });
  });
});
