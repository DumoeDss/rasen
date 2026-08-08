import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { getAvailableTools } from '../../src/core/available-tools.js';

describe('available-tools', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-test-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('getAvailableTools', () => {
    it('should return empty array when no tool directories exist', () => {
      const tools = getAvailableTools(testDir);
      expect(tools).toEqual([]);
    });

    it('should detect a single tool directory', async () => {
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].value).toBe('claude');
      expect(tools[0].name).toBe('Claude Code');
      expect(tools[0].skillsDir).toBe('.claude');
    });

    it('should detect multiple tool directories', async () => {
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });
      await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });
      await fs.mkdir(path.join(testDir, '.windsurf'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('claude');
      expect(toolValues).toContain('cursor');
      expect(toolValues).toContain('windsurf');
      expect(tools).toHaveLength(3);
    });

    it('should ignore files that are not directories', async () => {
      // Create a file named .claude instead of a directory
      await fs.writeFile(path.join(testDir, '.claude'), 'not a directory');

      const tools = getAvailableTools(testDir);
      expect(tools).toEqual([]);
    });

    it('should only return tools that have a skillsDir property', async () => {
      // .agents value has no skillsDir in AI_TOOLS config
      // Create directories for both a valid and the agents case
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('claude');
      expect(toolValues).not.toContain('agents');
    });

    it('should return full AIToolOption objects', async () => {
      await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'Cursor',
        value: 'cursor',
        available: true,
        skillsDir: '.cursor',
      });
    });

    it('should handle paths with spaces', async () => {
      const spacedDir = path.join(testDir, 'path with spaces');
      await fs.mkdir(spacedDir, { recursive: true });
      await fs.mkdir(path.join(spacedDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(spacedDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].value).toBe('claude');
    });

    it('should not detect GitHub Copilot from bare .github directory', async () => {
      // .github/ exists in virtually every GitHub repo (for workflows, issue templates, etc.)
      // A bare .github/ directory should NOT trigger Copilot detection
      await fs.mkdir(path.join(testDir, '.github'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).not.toContain('github-copilot');
    });

    it('should detect GitHub Copilot when copilot-instructions.md exists', async () => {
      await fs.mkdir(path.join(testDir, '.github'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.github', 'copilot-instructions.md'), '');

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('github-copilot');
    });

    it('should detect GitHub Copilot when .github/prompts directory exists', async () => {
      await fs.mkdir(path.join(testDir, '.github', 'prompts'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('github-copilot');
    });

    it('should detect GitHub Copilot when .github/agents directory exists', async () => {
      await fs.mkdir(path.join(testDir, '.github', 'agents'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('github-copilot');
    });

    it('should detect GitHub Copilot when .github/skills directory exists', async () => {
      await fs.mkdir(path.join(testDir, '.github', 'skills'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('github-copilot');
    });

    it('should detect GitHub Copilot when copilot-setup-steps.yml exists', async () => {
      await fs.mkdir(path.join(testDir, '.github', 'workflows'), { recursive: true });
      await fs.writeFile(path.join(testDir, '.github', 'workflows', 'copilot-setup-steps.yml'), '');

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('github-copilot');
    });

    it('should still use skillsDir detection for tools without detectionPaths', async () => {
      // Claude Code has no detectionPaths, so .claude/ directory should still work
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('claude');
    });

    it('should detect Mistral Vibe when .vibe directory exists', async () => {
      // Mistral Vibe uses skillsDir: '.vibe' without detectionPaths
      // This test ensures path semantics do not drift for Vibe skill detection
      await fs.mkdir(path.join(testDir, '.vibe'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('vibe');
      
      const vibeTool = tools.find((t) => t.value === 'vibe');
      expect(vibeTool).toBeDefined();
      expect(vibeTool?.name).toBe('Mistral Vibe');
      expect(vibeTool?.skillsDir).toBe('.vibe');
    });

    it('should not detect Oh My Pi from a bare empty .omp directory', async () => {
      // Oh My Pi (and unrelated tooling) can leave an empty `.omp/` behind —
      // this very repository carried one, untracked, before Oh My Pi was an
      // install target. Under the default bare-directory rule that would report
      // the tool as configured and make `rasen update` nudge on every run.
      await fs.mkdir(path.join(testDir, '.omp'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).not.toContain('omp');
    });

    // Titled "directory exists", not "populated": detection is `statSync` on the
    // path, so the DIRECTORY existing is what triggers it, empty or not. That is
    // the `github-copilot` precedent this entry follows — `.github/prompts`,
    // `.github/agents` and `.github/skills` are pinned the same way above — so
    // narrowing it here would silently change that tool's shipped behavior.
    // Recorded as a follow-up rather than fixed inside this change.
    it.each([
      ['skills', 'skills'],
      ['commands', 'commands'],
      ['agents', 'agents'],
    ])('should detect Oh My Pi when the .omp/%s directory exists', async (_label, dirName) => {
      await fs.mkdir(path.join(testDir, '.omp', dirName), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).toContain('omp');
    });

    it('should still not detect Oh My Pi from a bare .omp with no known child', async () => {
      // The distinction that makes the entry's detectionPaths worth having: the
      // tool directory itself is not a detection, only a named child of it.
      await fs.mkdir(path.join(testDir, '.omp', 'unrelated-junk'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).not.toContain('omp');
    });

    it.each(['AGENTS.md', 'RULES.md', 'settings.json', 'config.yml', 'mcp.json'])(
      'should detect Oh My Pi from .omp/%s',
      async (fileName) => {
        await fs.mkdir(path.join(testDir, '.omp'), { recursive: true });
        await fs.writeFile(path.join(testDir, '.omp', fileName), '');

        const tools = getAvailableTools(testDir);
        const omp = tools.find((t) => t.value === 'omp');
        expect(omp).toBeDefined();
        expect(omp?.name).toBe('Oh My Pi');
        expect(omp?.skillsDir).toBe('.omp');
        expect(omp?.adapted).toBe(true);
      }
    );
  });
});
