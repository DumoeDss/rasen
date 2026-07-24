import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { InitCommand } from '../../src/core/init.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { saveNamedProfile } from '../../src/core/named-profiles.js';

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

// Init persists an explicit --profile choice as the project's locked profile
// (init-profile-lock spec). Same isolation harness as test/core/init.test.ts.
describe('InitCommand profile lock persistence (init-profile-lock)', () => {
  let testDir: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  const configFile = () => path.join(testDir, 'rasen', 'config.yaml');

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-init-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME/XDG_DATA_HOME — clear it so this suite's XDG
    // isolation below actually applies.
    delete process.env.RASEN_HOME;
    configTempDir = path.join(os.tmpdir(), `rasen-init-lock-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;
    dataTempDir = path.join(os.tmpdir(), `rasen-init-lock-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataTempDir, { recursive: true });
    process.env.XDG_DATA_HOME = dataTempDir;

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
    await fs.rm(dataTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('fresh init with --profile core writes the lock into config.yaml', async () => {
    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'core' });
    await initCommand.execute(testDir);

    const content = await fs.readFile(configFile(), 'utf-8');
    expect(content).toMatch(/^profile: core$/m);

    const logCalls = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .flat()
      .map(String);
    expect(logCalls.some((entry) => entry.includes("locked to 'core'"))).toBe(true);
  });

  it('fresh init with a saved named profile writes the lock and installs its selection', async () => {
    saveNamedProfile('team-web', { version: 1, workflows: ['explore', 'new'] });

    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'team-web' });
    await initCommand.execute(testDir);

    const content = await fs.readFile(configFile(), 'utf-8');
    expect(content).toMatch(/^profile: team-web$/m);

    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md'))).toBe(true);
    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-new-change', 'SKILL.md'))).toBe(true);
    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md'))).toBe(false);
  });

  it('init without --profile writes no profile key', async () => {
    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    const content = await fs.readFile(configFile(), 'utf-8');
    expect(content).not.toMatch(/^profile:/m);
  });

  it('--profile custom is applied for the run but never persisted', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: ['explore'],
    });

    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'custom' });
    await initCommand.execute(testDir);

    const content = await fs.readFile(configFile(), 'utf-8');
    expect(content).not.toMatch(/^profile:/m);
    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md'))).toBe(true);
  });

  it('extend mode updates the lock in an existing config, preserving comments and other keys', async () => {
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
    await fs.writeFile(
      configFile(),
      '# hand-written comment\nschema: spec-driven\ncontext: hello\n'
    );
    saveGlobalConfig({ featureFlags: {}, profile: 'core' });

    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'core' });
    await initCommand.execute(testDir);

    const content = await fs.readFile(configFile(), 'utf-8');
    expect(content).toContain('# hand-written comment');
    expect(content).toContain('context: hello');
    expect(content).toMatch(/^profile: core$/m);
  });

  it('extend mode without --profile honors an existing lock', async () => {
    saveNamedProfile('team-web', { version: 1, workflows: ['explore', 'new'] });
    saveGlobalConfig({ featureFlags: {}, profile: 'core' });
    await fs.mkdir(path.join(testDir, 'rasen'), { recursive: true });
    await fs.writeFile(configFile(), 'schema: spec-driven\nprofile: team-web\n');

    const initCommand = new InitCommand({ tools: 'claude', force: true });
    await initCommand.execute(testDir);

    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md'))).toBe(true);
    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-new-change', 'SKILL.md'))).toBe(true);
    // The user-wide core profile does NOT govern (propose is core-only).
    expect(await fileExists(path.join(testDir, '.claude', 'skills', 'rasen-propose', 'SKILL.md'))).toBe(false);
  });

  it('an unknown --profile name fails listing built-ins and saved profiles', async () => {
    saveNamedProfile('team-web', { version: 1, workflows: ['explore'] });

    const initCommand = new InitCommand({ tools: 'claude', force: true, profile: 'no-such' });

    await expect(initCommand.execute(testDir)).rejects.toThrow(
      /Available profiles: full, core, custom, team-web/
    );
  });
});
