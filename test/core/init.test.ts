import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { InitCommand } from '../../src/core/init.js';
import { saveGlobalConfig, getGlobalConfig } from '../../src/core/global-config.js';

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

describe('InitCommand', () => {
  let testDir: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openspec-init-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME/XDG_DATA_HOME — clear it so this suite's XDG
    // isolation below actually applies.
    delete process.env.RASEN_HOME;
    // Use a temp dir for global config to avoid reading real config
    configTempDir = path.join(os.tmpdir(), `openspec-config-init-${Date.now()}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;
    // Isolate the global data dir (machine home / project registry) too.
    dataTempDir = path.join(os.tmpdir(), `openspec-data-init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataTempDir, { recursive: true });
    process.env.XDG_DATA_HOME = dataTempDir;

    // Mock console.log to suppress output during tests
    vi.spyOn(console, 'log').mockImplementation(() => { });
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    await fs.rm(dataTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('hook configuration hints', () => {
    it('prints safety + compact-recovery hook snippets without touching .claude/settings.json', async () => {
      await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

      const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call.join(' '))
        .join('\n');
      expect(logged).toContain('hooks/safety-check.sh');
      expect(logged).toContain('Compact Recovery Hook (optional):');
      expect(logged).toContain('"SessionStart"');
      expect(logged).toContain('"matcher": "compact"');
      expect(logged).toContain('hooks/compact-recovery.sh');

      // Instructions only — init must never write the hook config itself.
      // (settings.json may exist for the agent-teams env flag, but no hooks key.)
      const settingsPath = path.join(testDir, '.claude', 'settings.json');
      if (await fileExists(settingsPath)) {
        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(settings.hooks).toBeUndefined();
      }
    });
  });

  describe('execute with --tools flag', () => {
    it('should create Rasen directory structure', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const openspecPath = path.join(testDir, 'rasen');
      expect(await directoryExists(openspecPath)).toBe(true);
      expect(await directoryExists(path.join(openspecPath, 'specs'))).toBe(true);
      expect(await directoryExists(path.join(openspecPath, 'changes'))).toBe(true);
      expect(await directoryExists(path.join(openspecPath, 'changes', 'archive'))).toBe(true);
    });

    it('should create config.yaml with default schema', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      const configPath = path.join(testDir, 'rasen', 'config.yaml');
      expect(await fileExists(configPath)).toBe(true);

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('schema: spec-driven');
    });

    it('should create full profile skills for Claude Code by default', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      // Full profile (default): all workflow skills are installed
      const expectedSkillNames = [
        'rasen-propose',
        'rasen-explore',
        'rasen-apply-change',
        'rasen-sync-specs',
        'rasen-archive-change',
        'rasen-new-change',
        'rasen-continue-change',
        'rasen-bulk-archive-change',
        'rasen-verify-change',
      ];

      for (const skillName of expectedSkillNames) {
        const skillFile = path.join(testDir, '.claude', 'skills', skillName, 'SKILL.md');
        expect(await fileExists(skillFile)).toBe(true);

        const content = await fs.readFile(skillFile, 'utf-8');
        expect(content).toContain('---');
        expect(content).toContain('name:');
        expect(content).toContain('description:');
      }
    });

    it('should create full profile commands for Claude Code by default', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(testDir);

      // Full profile (default): all workflow commands are installed
      const expectedCommandNames = [
        'rasen/propose.md',
        'rasen/explore.md',
        'rasen/apply.md',
        'rasen/sync.md',
        'rasen/archive.md',
        'rasen/new.md',
        'rasen/continue.md',
        'rasen/bulk-archive.md',
        'rasen/verify.md',
      ];

      for (const cmdName of expectedCommandNames) {
        const cmdFile = path.join(testDir, '.claude', 'commands', cmdName);
        expect(await fileExists(cmdFile)).toBe(true);
      }
    });

    it('should create only core profile skills with --profile core', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'core' });

      await initCommand.execute(testDir);

      const coreSkillNames = [
        'rasen-propose',
        'rasen-explore',
        'rasen-apply-change',
        'rasen-sync-specs',
        'rasen-archive-change',
      ];

      for (const skillName of coreSkillNames) {
        const skillFile = path.join(testDir, '.claude', 'skills', skillName, 'SKILL.md');
        expect(await fileExists(skillFile)).toBe(true);
      }

      const nonCoreSkillNames = [
        'rasen-new-change',
        'rasen-continue-change',
        'rasen-bulk-archive-change',
        'rasen-verify-change',
      ];

      for (const skillName of nonCoreSkillNames) {
        const skillFile = path.join(testDir, '.claude', 'skills', skillName, 'SKILL.md');
        expect(await fileExists(skillFile)).toBe(false);
      }
    });

    it('should create skills in Codex skills directory', async () => {
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      const initCommand = new InitCommand({ tools: 'codex', force: true });

      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.codex', 'skills', 'rasen-explore', 'SKILL.md');
      expect(await fileExists(skillFile)).toBe(true);
    });

    it('should install Hermes skills to the resolved Hermes home, not project-local .hermes/', async () => {
      const hermesHome = path.join(testDir, '.hermes-home');
      process.env.HERMES_HOME = hermesHome;
      const initCommand = new InitCommand({ tools: 'hermes', force: true });

      await initCommand.execute(testDir);

      const globalSkillFile = path.join(hermesHome, 'skills', 'rasen-explore', 'SKILL.md');
      expect(await fileExists(globalSkillFile)).toBe(true);

      // No project-local .hermes/ tree should be created.
      const projectLocalDir = path.join(testDir, '.hermes');
      expect(await directoryExists(projectLocalDir)).toBe(false);
    });

    it('should skip command-file generation for Hermes (no adapter) while still installing skills', async () => {
      const hermesHome = path.join(testDir, '.hermes-home');
      process.env.HERMES_HOME = hermesHome;
      const initCommand = new InitCommand({ tools: 'hermes', force: true });

      await initCommand.execute(testDir);

      const globalSkillFile = path.join(hermesHome, 'skills', 'rasen-explore', 'SKILL.md');
      expect(await fileExists(globalSkillFile)).toBe(true);

      const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().map(String);
      expect(
        logCalls.some(
          (entry) => entry.includes('Commands skipped for: hermes') && entry.includes('(no adapter)'),
        ),
      ).toBe(true);
    });

    it('should reject an unadapted tool (Windsurf) with a "not yet adapted" message', async () => {
      const initCommand = new InitCommand({ tools: 'windsurf', force: true });

      await expect(initCommand.execute(testDir)).rejects.toThrow(/recognized but not yet adapted/);

      // No skills should have been created for the rejected tool.
      const skillFile = path.join(testDir, '.windsurf', 'skills', 'rasen-explore', 'SKILL.md');
      expect(await fileExists(skillFile)).toBe(false);
    });

    it('should create skills for multiple tools at once', async () => {
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      const initCommand = new InitCommand({ tools: 'claude,codex', force: true });

      await initCommand.execute(testDir);

      const claudeSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const codexSkill = path.join(testDir, '.codex', 'skills', 'rasen-explore', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(codexSkill)).toBe(true);
    });

    it('should select only adapted tools with --tools all option', async () => {
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      const hermesHome = path.join(testDir, '.hermes-home');
      process.env.HERMES_HOME = hermesHome;
      const initCommand = new InitCommand({ tools: 'all', force: true });

      await initCommand.execute(testDir);

      const claudeSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const codexSkill = path.join(testDir, '.codex', 'skills', 'rasen-explore', 'SKILL.md');
      const hermesSkill = path.join(hermesHome, 'skills', 'rasen-explore', 'SKILL.md');
      const cursorSkill = path.join(testDir, '.cursor', 'skills', 'rasen-explore', 'SKILL.md');
      const windsurfSkill = path.join(testDir, '.windsurf', 'skills', 'rasen-explore', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(codexSkill)).toBe(true);
      expect(await fileExists(hermesSkill)).toBe(true);
      expect(await fileExists(cursorSkill)).toBe(false);
      expect(await fileExists(windsurfSkill)).toBe(false);
    });

    it('should skip tool configuration with --tools none option', async () => {
      const initCommand = new InitCommand({ tools: 'none', force: true });

      await initCommand.execute(testDir);

      // Should create Rasen structure but no skills
      const openspecPath = path.join(testDir, 'rasen');
      expect(await directoryExists(openspecPath)).toBe(true);

      // No tool-specific directories should be created
      const claudeSkillsDir = path.join(testDir, '.claude', 'skills');
      expect(await directoryExists(claudeSkillsDir)).toBe(false);
    });

    it('should throw error for invalid tool names', async () => {
      const initCommand = new InitCommand({ tools: 'invalid-tool', force: true });

      await expect(initCommand.execute(testDir)).rejects.toThrow(/Invalid tool\(s\): invalid-tool/);
    });

    it('should reject a known but unadapted tool with a "not yet adapted" message', async () => {
      const initCommand = new InitCommand({ tools: 'cursor', force: true });

      await expect(initCommand.execute(testDir)).rejects.toThrow(
        /recognized but not yet adapted in Rasen.*claude, codex/
      );
    });

    it('should handle comma-separated tool names with spaces', async () => {
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      const initCommand = new InitCommand({ tools: 'claude, codex', force: true });

      await initCommand.execute(testDir);

      const claudeSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const codexSkill = path.join(testDir, '.codex', 'skills', 'rasen-explore', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(codexSkill)).toBe(true);
    });

    it('should reject combining reserved keywords with explicit tool ids', async () => {
      const initCommand = new InitCommand({ tools: 'all,claude', force: true });

      await expect(initCommand.execute(testDir)).rejects.toThrow(
        /Cannot combine reserved values "all" or "none" with specific tool IDs/
      );
    });

    it('should not create config.yaml if it already exists', async () => {
      // Pre-create config.yaml
      const openspecDir = path.join(testDir, 'rasen');
      await fs.mkdir(openspecDir, { recursive: true });
      const configPath = path.join(openspecDir, 'config.yaml');
      const existingContent = 'schema: custom-schema\n';
      await fs.writeFile(configPath, existingContent);

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      // Init must not overwrite an existing config's content - but it now
      // also mints a projectId (task 4.1) via a lazy append, so the
      // original content is a preserved prefix rather than byte-identical.
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content.startsWith(existingContent.trimEnd())).toBe(true);
      expect(content).toContain('projectId: ');
    });

    it('should handle non-existent target directory', async () => {
      const newDir = path.join(testDir, 'new-project');
      const initCommand = new InitCommand({ tools: 'claude', force: true });

      await initCommand.execute(newDir);

      const openspecPath = path.join(newDir, 'rasen');
      expect(await directoryExists(openspecPath)).toBe(true);
    });

    it('should work in extend mode (re-running init)', async () => {
      const initCommand1 = new InitCommand({ tools: 'claude', force: true });
      await initCommand1.execute(testDir);

      // Run init again with a different tool
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      const initCommand2 = new InitCommand({ tools: 'codex', force: true });
      await initCommand2.execute(testDir);

      // Both tools should have skills
      const claudeSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const codexSkill = path.join(testDir, '.codex', 'skills', 'rasen-explore', 'SKILL.md');

      expect(await fileExists(claudeSkill)).toBe(true);
      expect(await fileExists(codexSkill)).toBe(true);
    });

    it('should refresh skills on re-run for the same tool', async () => {
      const initCommand1 = new InitCommand({ tools: 'claude', force: true });
      await initCommand1.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const originalContent = await fs.readFile(skillFile, 'utf-8');

      // Modify the file
      await fs.writeFile(skillFile, '# Modified content\n');

      // Run init again
      const initCommand2 = new InitCommand({ tools: 'claude', force: true });
      await initCommand2.execute(testDir);

      const newContent = await fs.readFile(skillFile, 'utf-8');
      expect(newContent).toBe(originalContent);
    });
  });

  describe('skill content validation', () => {
    it('should generate valid SKILL.md with YAML frontmatter', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      // Should have YAML frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name: rasen-explore');
      expect(content).toContain('description:');
      expect(content).toContain('license:');
      expect(content).toContain('compatibility:');
      expect(content).toContain('metadata:');
      expect(content).toMatch(/---\n\n/); // End of frontmatter
    });

    it('should include explore mode instructions', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      expect(content).toContain('Enter explore mode');
      expect(content).toContain('thinking partner');
    });

    it('should include propose skill instructions', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      expect(content).toContain('name: rasen-propose');
    });

    it('should include apply-change skill instructions', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-apply-change', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      expect(content).toContain('name: rasen-apply-change');
    });

    it('should embed generatedBy version in skill files', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
      const content = await fs.readFile(skillFile, 'utf-8');

      // Should contain generatedBy field with a version string
      expect(content).toMatch(/generatedBy:\s*["']?\d+\.\d+\.\d+["']?/);
    });
  });

  describe('command generation', () => {
    it('should generate Claude Code commands with correct format', async () => {
      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await initCommand.execute(testDir);

      const cmdFile = path.join(testDir, '.claude', 'commands', 'rasen', 'explore.md');
      const content = await fs.readFile(cmdFile, 'utf-8');

      // Claude commands use YAML frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name:');
      expect(content).toContain('description:');
    });

    it('should generate Codex commands with correct format', async () => {
      process.env.CODEX_HOME = path.join(testDir, '.codex-home');
      const initCommand = new InitCommand({ tools: 'codex', force: true });
      await initCommand.execute(testDir);

      const cmdFile = path.join(process.env.CODEX_HOME, 'prompts', 'rasen-explore.md');
      expect(await fileExists(cmdFile)).toBe(true);

      const content = await fs.readFile(cmdFile, 'utf-8');
      expect(content).toMatch(/^---\n/);
    });
  });

  describe('error handling', () => {
    it('should provide helpful error for insufficient permissions', async () => {
      // Mock the permission check to fail
      const readOnlyDir = path.join(testDir, 'readonly');
      await fs.mkdir(readOnlyDir);

      const originalWriteFile = fs.writeFile;
      vi.spyOn(fs, 'writeFile').mockImplementation(
        async (filePath: any, ...args: any[]) => {
          if (
            typeof filePath === 'string' &&
            filePath.includes('.openspec-test-')
          ) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile.call(fs, filePath, ...args);
        }
      );

      const initCommand = new InitCommand({ tools: 'claude', force: true });
      await expect(initCommand.execute(readOnlyDir)).rejects.toThrow(/Insufficient permissions/);
    });

    it('should throw error in non-interactive mode without --tools flag and no detected tools', async () => {
      const initCommand = new InitCommand({ interactive: false });

      await expect(initCommand.execute(testDir)).rejects.toThrow(/No tools detected and no --tools flag/);
    });
  });

  // Per-adapter format/path coverage for unadapted tools (Gemini, Windsurf,
  // Continue, Cline, GitHub Copilot, etc.) lives in
  // test/core/command-generation/adapters.test.ts, which exercises each
  // adapter's getFilePath/formatFile directly. Those tools are no longer
  // reachable through InitCommand's --tools surface (adapted-agent-visibility
  // change), so the integration-level coverage here was removed rather than
  // updated to a tool that can't reach it.
});

describe('InitCommand - profile and detection features', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openspec-init-profile-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME — clear it so this suite's XDG isolation
    // actually resolves into configTempDir.
    delete process.env.RASEN_HOME;
    // Use a temp dir for global config to avoid polluting real config
    configTempDir = path.join(os.tmpdir(), `openspec-config-test-${Date.now()}`);
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

  it('should use --profile flag to override global config', async () => {
    // Set global config to custom profile
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['explore', 'new', 'apply'],
    });

    // Override with --profile core
    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'core' });
    await initCommand.execute(testDir);

    // Core profile skills should be created
    const proposeSkill = path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md');
    expect(await fileExists(proposeSkill)).toBe(true);

    // Non-core skills (from the custom profile) should NOT be created
    const newChangeSkill = path.join(testDir, '.claude', 'skills', 'rasen-new-change', 'SKILL.md');
    expect(await fileExists(newChangeSkill)).toBe(false);
  });

  it('should drop a retired workflow id (ff) from a stored custom profile with a warning, and still succeed', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['explore', 'ff', 'apply'],
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await expect(initCommand.execute(testDir)).resolves.not.toThrow();

    const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().map(String);
    expect(logCalls.some((entry) => entry.includes('ff'))).toBe(true);

    const exploreSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    const applySkill = path.join(testDir, '.claude', 'skills', 'rasen-apply-change', 'SKILL.md');
    expect(await fileExists(exploreSkill)).toBe(true);
    expect(await fileExists(applySkill)).toBe(true);
  });

  it('should heal a retired ff install (skill dir + command file) on init, and no-op when absent', async () => {
    // Simulate a machine that already has the retired rasen-ff-change skill
    // dir and ff command file from a prior install.
    const skillsDir = path.join(testDir, '.claude', 'skills');
    const retiredSkillDir = path.join(skillsDir, 'rasen-ff-change');
    await fs.mkdir(retiredSkillDir, { recursive: true });
    await fs.writeFile(path.join(retiredSkillDir, 'SKILL.md'), 'stale ff skill');

    const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
    await fs.mkdir(commandsDir, { recursive: true });
    await fs.writeFile(path.join(commandsDir, 'ff.md'), 'stale ff command');

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    expect(await fileExists(retiredSkillDir)).toBe(false);
    expect(await fileExists(path.join(commandsDir, 'ff.md'))).toBe(false);

    // Running again with nothing retired left is a no-op (no error).
    const secondRun = new InitCommand({ tools: 'claude', force: true });
    await expect(secondRun.execute(testDir)).resolves.not.toThrow();
  });

  it('should reject invalid --profile values', async () => {
    const initCommand = new InitCommand({
      tools: 'claude',
      force: true,
      profile: 'invalid-profile',
    });

    await expect(initCommand.execute(testDir)).rejects.toThrow(
      /Invalid profile "invalid-profile"/
    );
  });

  it('should use detected tools in non-interactive mode when no --tools flag', async () => {
    // Create a .claude directory to simulate detected tool
    await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

    const initCommand = new InitCommand({ interactive: false, force: true });
    await initCommand.execute(testDir);

    // Should have used claude (detected)
    const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);
  });

  it('should leave legacy artifacts untouched and print a coexistence notice', async () => {
    // Create legacy Claude command directory (old openspec-namespaced path)
    const legacyDir = path.join(testDir, '.claude', 'commands', 'openspec');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'propose.md'), 'legacy content');

    // Run init in non-interactive mode without --force
    const initCommand = new InitCommand({ tools: 'claude' });
    await initCommand.execute(testDir);

    // rasen never deletes legacy artifacts — the file stays put.
    expect(await fileExists(path.join(legacyDir, 'propose.md'))).toBe(true);

    // A one-time coexistence notice is printed instead.
    const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().map(String);
    expect(
      logCalls.some((entry) => entry.includes('Legacy OpenSpec-namespace artifacts detected'))
    ).toBe(true);

    // New rasen-namespaced commands are still created at the correct path.
    const newCommandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
    expect(await directoryExists(newCommandsDir)).toBe(true);
  });

  it('should preselect configured tools but not directory-detected tools in extend mode', async () => {
    // Simulate existing Rasen project (extend mode).
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });

    // Configured with Rasen
    const claudeSkillDir = path.join(testDir, '.claude', 'skills', 'rasen-explore');
    await fs.mkdir(claudeSkillDir, { recursive: true });
    await fs.writeFile(path.join(claudeSkillDir, 'SKILL.md'), 'configured');

    // Directory detected only (not configured with Rasen) — an adapted tool
    // (codex) so it still appears in the narrowed choices list.
    await fs.mkdir(path.join(testDir, '.codex'), { recursive: true });

    searchableMultiSelectMock.mockResolvedValue(['claude']);

    const initCommand = new InitCommand({ force: true });
    vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

    await initCommand.execute(testDir);

    expect(searchableMultiSelectMock).toHaveBeenCalledTimes(1);
    const [{ choices }] = searchableMultiSelectMock.mock.calls[0] as [{ choices: Array<{ value: string; preSelected?: boolean; detected?: boolean }> }];

    const claude = choices.find((choice) => choice.value === 'claude');
    const codex = choices.find((choice) => choice.value === 'codex');

    expect(claude?.preSelected).toBe(true);
    expect(codex?.preSelected).toBe(false);
    expect(codex?.detected).toBe(true);
  });

  it('should preselect detected tools for first-time interactive setup', async () => {
    // First-time init: no openspec/ directory and no configured Rasen skills.
    await fs.mkdir(path.join(testDir, '.codex'), { recursive: true });

    process.env.CODEX_HOME = path.join(testDir, '.codex-home');
    searchableMultiSelectMock.mockResolvedValue(['codex']);

    const initCommand = new InitCommand({ force: true });
    vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);

    await initCommand.execute(testDir);

    expect(searchableMultiSelectMock).toHaveBeenCalledTimes(1);
    const [{ choices }] = searchableMultiSelectMock.mock.calls[0] as [{ choices: Array<{ value: string; preSelected?: boolean }> }];
    const codex = choices.find((choice) => choice.value === 'codex');

    expect(codex?.preSelected).toBe(true);
  });

  it('should respect custom profile from global config', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['explore', 'new'],
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    // Custom profile skills should be created
    const exploreSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    const newChangeSkill = path.join(testDir, '.claude', 'skills', 'rasen-new-change', 'SKILL.md');
    expect(await fileExists(exploreSkill)).toBe(true);
    expect(await fileExists(newChangeSkill)).toBe(true);

    // Non-selected skills should NOT be created
    const proposeSkill = path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md');
    expect(await fileExists(proposeSkill)).toBe(false);
  });

  it('should migrate commands-only extend mode to custom profile, healing delivery to both (skills restored)', async () => {
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
    await fs.mkdir(path.join(testDir, '.claude', 'commands', 'rasen'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.claude', 'commands', 'rasen', 'explore.md'), '# explore\n');

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    const config = getGlobalConfig();
    expect(config.profile).toBe('custom');
    // inferDelivery now heals a commands-only install to 'both' instead of
    // 'commands' — skills are restored rather than treated as data loss (design D6).
    expect(config.delivery).toBe('both');
    expect(config.workflows).toEqual(['explore']);

    const exploreCommand = path.join(testDir, '.claude', 'commands', 'rasen', 'explore.md');
    const proposeCommand = path.join(testDir, '.claude', 'commands', 'rasen', 'propose.md');
    expect(await fileExists(exploreCommand)).toBe(true);
    expect(await fileExists(proposeCommand)).toBe(false);

    // Skills are always installed now — the explore skill is restored even
    // though the project was previously commands-only.
    const exploreSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    const proposeSkill = path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md');
    expect(await fileExists(exploreSkill)).toBe(true);
    expect(await fileExists(proposeSkill)).toBe(false);
  });

  it('should not prompt for confirmation when applying custom profile in interactive init', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['explore', 'new'],
    });

    const initCommand = new InitCommand({ force: true });
    vi.spyOn(initCommand as any, 'canPromptInteractively').mockReturnValue(true);
    vi.spyOn(initCommand as any, 'getSelectedTools').mockResolvedValue(['claude']);

    await initCommand.execute(testDir);

    expect(showWelcomeScreenMock).toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();

    const exploreSkill = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    const newChangeSkill = path.join(testDir, '.claude', 'skills', 'rasen-new-change', 'SKILL.md');
    expect(await fileExists(exploreSkill)).toBe(true);
    expect(await fileExists(newChangeSkill)).toBe(true);

    const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().map(String);
    expect(logCalls.some((entry) => entry.includes('Applying custom profile'))).toBe(false);
  });

  it('should respect delivery=skills setting (no commands)', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'skills',
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    // Skills should exist
    const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);

    // Commands should NOT exist
    const cmdFile = path.join(testDir, '.claude', 'commands', 'rasen', 'explore.md');
    expect(await fileExists(cmdFile)).toBe(false);
  });

  it('should always generate skills under a legacy commands-only config value, and heal delivery to both', async () => {
    // Simulate a pre-existing config file holding the removed 'commands' value —
    // written directly (not via saveGlobalConfig, whose Delivery type no longer
    // accepts it) to reproduce what an old config.json on disk looks like.
    const legacyConfigPath = path.join(process.env.XDG_CONFIG_HOME!, 'rasen', 'config.json');
    await fs.mkdir(path.dirname(legacyConfigPath), { recursive: true });
    await fs.writeFile(legacyConfigPath, JSON.stringify({ featureFlags: {}, profile: 'core', delivery: 'commands' }));

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    // The legacy value is mapped to 'both' on the read inside execute().
    const config = getGlobalConfig();
    expect(config.delivery).toBe('both');

    // Skills are always installed, regardless of the legacy value.
    const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);

    // Commands are also installed, since the mapped delivery is 'both'.
    const cmdFile = path.join(testDir, '.claude', 'commands', 'rasen', 'explore.md');
    expect(await fileExists(cmdFile)).toBe(true);
  });

  it('should never remove skill dirs by delivery, including under a legacy commands-first config value', async () => {
    const legacyConfigPath = path.join(process.env.XDG_CONFIG_HOME!, 'rasen', 'config.json');
    await fs.mkdir(path.dirname(legacyConfigPath), { recursive: true });
    await fs.writeFile(legacyConfigPath, JSON.stringify({ featureFlags: {}, profile: 'full', delivery: 'commands-first' }));

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    const skillsDir = path.join(testDir, '.claude', 'skills');

    // No mode deletes skill directories anymore — the goal-loop's skill-only
    // stage workflows AND workflows with a command counterpart (e.g. apply)
    // all keep their skill dirs.
    for (const skillDir of ['rasen-goal-plan', 'rasen-goal-iterate', 'rasen-goal-report', 'rasen-apply-change']) {
      expect(await fileExists(path.join(skillsDir, skillDir, 'SKILL.md'))).toBe(true);
    }

    // The goal command payload is present too, since the legacy value maps to 'both'.
    const goalCmdFile = path.join(testDir, '.claude', 'commands', 'rasen', 'goal.md');
    expect(await fileExists(goalCmdFile)).toBe(true);
  });

  it('should remove commands on re-init when delivery changes to skills', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'both',
    });

    const initCommand1 = new InitCommand({ tools: 'claude', force: true });
    await initCommand1.execute(testDir);

    const cmdFile = path.join(testDir, '.claude', 'commands', 'rasen', 'explore.md');
    expect(await fileExists(cmdFile)).toBe(true);

    saveGlobalConfig({
      featureFlags: {},
      profile: 'core',
      delivery: 'skills',
    });

    const initCommand2 = new InitCommand({ tools: 'claude', force: true });
    await initCommand2.execute(testDir);

    expect(await fileExists(cmdFile)).toBe(false);

    const skillFile = path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    expect(await fileExists(skillFile)).toBe(true);
  });
});

describe('InitCommand machine-home registration', () => {
  let testDir: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openspec-init-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME/XDG_DATA_HOME — clear it so this suite's XDG
    // isolation below actually applies.
    delete process.env.RASEN_HOME;
    configTempDir = path.join(os.tmpdir(), `openspec-config-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;
    dataTempDir = path.join(os.tmpdir(), `openspec-data-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataTempDir, { recursive: true });
    process.env.XDG_DATA_HOME = dataTempDir;

    vi.spyOn(console, 'log').mockImplementation(() => { });
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    await fs.rm(dataTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('registers the project and creates its machine home on fresh init', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const configPath = path.join(testDir, 'rasen', 'config.yaml');
    const configContent = await fs.readFile(configPath, 'utf-8');
    expect(configContent).toMatch(/projectId: [0-9a-f-]{36}/);

    const registryPath = path.join(dataTempDir, 'rasen', 'projects', 'registry.json');
    expect(await fileExists(registryPath)).toBe(true);
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
    const entries = Object.values(registry.projects) as Array<{ home: string }>;
    expect(entries).toHaveLength(1);

    const homeDir = path.join(dataTempDir, 'rasen', 'projects', entries[0].home);
    expect(await directoryExists(homeDir)).toBe(true);

    const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call.join(' '))
      .join('\n');
    expect(logged).toContain('Machine home:');
  });

  it('preserves projectId, registry entry, and home directory on re-init', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    const configPath = path.join(testDir, 'rasen', 'config.yaml');
    const firstContent = await fs.readFile(configPath, 'utf-8');
    const firstMatch = firstContent.match(/projectId: ([0-9a-f-]{36})/);
    expect(firstMatch).not.toBeNull();

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    const secondContent = await fs.readFile(configPath, 'utf-8');
    const secondMatch = secondContent.match(/projectId: ([0-9a-f-]{36})/);
    expect(secondMatch?.[1]).toBe(firstMatch?.[1]);

    const registryPath = path.join(dataTempDir, 'rasen', 'projects', 'registry.json');
    const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
    expect(Object.keys(registry.projects)).toHaveLength(1);
  });

  it('downgrades a registry write failure to a warning without failing init', async () => {
    // Point XDG_DATA_HOME at a FILE, not a directory: any attempt to mkdir
    // a subdirectory underneath it fails with ENOTDIR.
    const blockedDataDir = path.join(os.tmpdir(), `openspec-data-blocked-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.writeFile(blockedDataDir, 'not a directory');
    process.env.XDG_DATA_HOME = blockedDataDir;

    await expect(
      new InitCommand({ tools: 'claude', force: true }).execute(testDir)
    ).resolves.not.toThrow();

    // Repo-side setup still completed.
    const configPath = path.join(testDir, 'rasen', 'config.yaml');
    expect(await fileExists(configPath)).toBe(true);

    const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call.join(' '))
      .join('\n');
    expect(logged).toContain('Machine home registration failed');
    expect(logged).not.toContain('Machine home:');

    await fs.rm(blockedDataDir, { force: true });
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
