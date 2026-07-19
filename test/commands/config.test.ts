import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function runConfigCommand(args: string[]): Promise<void> {
  const { registerConfigCommand } = await import('../../src/commands/config.js');
  const program = new Command();
  registerConfigCommand(program);
  await program.parseAsync(['node', 'rasen', 'config', ...args]);
}

describe('config command integration', () => {
  // These tests use real file system operations with XDG_CONFIG_HOME override
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = path.join(os.tmpdir(), `rasen-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Save original env and set XDG_CONFIG_HOME
    originalEnv = { ...process.env };
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME — clear it so this suite's XDG isolation
    // actually resolves into tempDir instead of the shared net root.
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.RASEN_LANG = 'en';

    // Spy on console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Restore spies
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();

    // Reset module cache to pick up new XDG_CONFIG_HOME
    vi.resetModules();
  });

  it('should use XDG_CONFIG_HOME for config path', async () => {
    const { getGlobalConfigPath } = await import('../../src/core/global-config.js');
    const configPath = getGlobalConfigPath();
    expect(configPath).toBe(path.join(tempDir, 'rasen', 'config.json'));
  });

  it('should save and load config correctly', async () => {
    const { getGlobalConfig, saveGlobalConfig } = await import('../../src/core/global-config.js');

    saveGlobalConfig({ featureFlags: { test: true } });
    const config = getGlobalConfig();
    expect(config.featureFlags).toEqual({ test: true });
  });

  it('should return defaults when config file does not exist', async () => {
    const { getGlobalConfig, getGlobalConfigPath } = await import('../../src/core/global-config.js');

    const configPath = getGlobalConfigPath();
    // Make sure config doesn't exist
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    const config = getGlobalConfig();
    expect(config.featureFlags).toEqual({});
  });

  it('should preserve unknown fields', async () => {
    const { getGlobalConfig, getGlobalConfigDir } = await import('../../src/core/global-config.js');

    const configDir = getGlobalConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      featureFlags: {},
      customField: 'preserved',
    }));

    const config = getGlobalConfig();
    expect((config as Record<string, unknown>).customField).toBe('preserved');
  });

  it('should handle invalid JSON gracefully', async () => {
    const { getGlobalConfig, getGlobalConfigDir } = await import('../../src/core/global-config.js');

    const configDir = getGlobalConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{ invalid json }');

    const config = getGlobalConfig();
    // Should return defaults
    expect(config.featureFlags).toEqual({});
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });

  it('should set workflows from JSON array syntax', async () => {
    await runConfigCommand([
      'set',
      'workflows',
      '["new","ff","apply","archive"]',
    ]);

    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    const config = getGlobalConfig();

    expect(config.workflows).toEqual(['new', 'ff', 'apply', 'archive']);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Set workflows = new,ff,apply,archive'
    );
  });

  it('config set delivery <legacy value> heals to the consolidated value on the next read (cli-config spec)', async () => {
    await runConfigCommand(['set', 'delivery', 'commands-first']);

    // `config set` persists the raw coerced value at write time — it validates
    // via the zod schema (which internally transforms) but only consumes
    // {success, error}, not the transformed output. This matches the spec:
    // "the effective delivery on the next read SHALL be the consolidated
    // value" (not immediately on write), so the file legitimately holds the
    // literal legacy string right after `set`.
    const { getGlobalConfigPath, getGlobalConfig } = await import('../../src/core/global-config.js');
    const onDiskAfterSet = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
    expect(onDiskAfterSet.delivery).toBe('commands-first');

    // The very next read heals it: the one-time notice fires, and both the
    // effective value and the file on disk become the consolidated 'both'.
    const config = getGlobalConfig();
    expect(config.delivery).toBe('both');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('commands-first'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('both'));

    const onDiskAfterRead = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
    expect(onDiskAfterRead.delivery).toBe('both');

    // A second read is idempotent — no repeated notice.
    consoleErrorSpy.mockClear();
    const config2 = getGlobalConfig();
    expect(config2.delivery).toBe('both');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('localizes the legacy delivery migration notice in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';
    const { getGlobalConfigDir, getGlobalConfigPath } = await import(
      '../../src/core/global-config.js'
    );
    fs.mkdirSync(getGlobalConfigDir(), { recursive: true });
    fs.writeFileSync(
      getGlobalConfigPath(),
      JSON.stringify({ featureFlags: {}, language: 'ja', delivery: 'commands-first' }),
      'utf-8'
    );

    await runConfigCommand(['list']);

    const diagnostics = consoleErrorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(diagnostics).toContain("deliveryモード'commands-first'は'both'へ統合されました");
    expect(diagnostics).not.toContain('Note: delivery mode');
    expect(JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).delivery).toBe('both');
  });

  it('localizes invalid global JSON diagnostics in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';
    const { getGlobalConfigDir, getGlobalConfigPath } = await import(
      '../../src/core/global-config.js'
    );
    fs.mkdirSync(getGlobalConfigDir(), { recursive: true });
    fs.writeFileSync(getGlobalConfigPath(), '{ invalid json }', 'utf-8');

    await runConfigCommand(['list']);

    const diagnostics = consoleErrorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(diagnostics).toContain('JSONが無効なため、デフォルトを使用します');
    expect(diagnostics).not.toContain('Warning: Invalid JSON');
  });
});

describe('config command shell completion registry', () => {
  it('should have config command in registry', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');

    const configCmd = COMMAND_REGISTRY.find((cmd) => cmd.name === 'config');
    expect(configCmd).toBeDefined();
    expect(configCmd?.description).toBe(
      'View and modify global or project Rasen configuration'
    );
  });

  it('should have all config subcommands in registry', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');

    const configCmd = COMMAND_REGISTRY.find((cmd) => cmd.name === 'config');
    const subcommandNames = configCmd?.subcommands?.map((s) => s.name) ?? [];

    expect(subcommandNames).toContain('path');
    expect(subcommandNames).toContain('list');
    expect(subcommandNames).toContain('get');
    expect(subcommandNames).toContain('set');
    expect(subcommandNames).toContain('unset');
    expect(subcommandNames).toContain('reset');
    expect(subcommandNames).toContain('edit');
  });

  it('should have --json flag on list subcommand', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');

    const configCmd = COMMAND_REGISTRY.find((cmd) => cmd.name === 'config');
    const listCmd = configCmd?.subcommands?.find((s) => s.name === 'list');
    const flagNames = listCmd?.flags?.map((f) => f.name) ?? [];

    expect(flagNames).toContain('json');
  });

  it('should have --string flag on set subcommand', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');

    const configCmd = COMMAND_REGISTRY.find((cmd) => cmd.name === 'config');
    const setCmd = configCmd?.subcommands?.find((s) => s.name === 'set');
    const flagNames = setCmd?.flags?.map((f) => f.name) ?? [];

    expect(flagNames).toContain('string');
    expect(flagNames).toContain('allow-unknown');
  });

  it('should have --all and -y flags on reset subcommand', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');

    const configCmd = COMMAND_REGISTRY.find((cmd) => cmd.name === 'config');
    const resetCmd = configCmd?.subcommands?.find((s) => s.name === 'reset');
    const flagNames = resetCmd?.flags?.map((f) => f.name) ?? [];

    expect(flagNames).toContain('all');
    expect(flagNames).toContain('yes');
  });

  it('should have --scope flag on config command', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');

    const configCmd = COMMAND_REGISTRY.find((cmd) => cmd.name === 'config');
    const flagNames = configCmd?.flags?.map((f) => f.name) ?? [];

    expect(flagNames).toContain('scope');
    expect(configCmd?.flags.find((flag) => flag.name === 'scope')?.values).toEqual([
      'global',
      'project',
    ]);
  });

  it('should generate both accepted --scope values for Zsh', async () => {
    const { COMMAND_REGISTRY } = await import('../../src/core/completions/command-registry.js');
    const { ZshGenerator } = await import('../../src/core/completions/generators/zsh-generator.js');

    const script = new ZshGenerator().generate(COMMAND_REGISTRY);

    expect(script).toContain(':value:(global project)');
  });
});

describe('config key validation', () => {
  it('rejects unknown top-level keys', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('unknownKey').valid).toBe(false);
  });

  it('allows feature flag keys', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('featureFlags.someFlag').valid).toBe(true);
  });

  it('rejects deeply nested feature flag keys', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('featureFlags.someFlag.extra').valid).toBe(false);
  });

  it('allows profile key', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('profile').valid).toBe(true);
  });

  it('allows delivery key', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('delivery').valid).toBe(true);
  });

  it('allows workflows key', async () => {
    const { validateConfigKeyPath } = await import('../../src/core/config-schema.js');
    expect(validateConfigKeyPath('workflows').valid).toBe(true);
  });
});

describe('config profile command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `rasen-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    originalEnv = { ...process.env };
    // See the note in the earlier beforeEach: clear the net's RASEN_HOME so
    // XDG_CONFIG_HOME isolation actually applies.
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.RASEN_LANG = 'en';
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('core preset should set profile to core and preserve delivery', async () => {
    const { getGlobalConfig, saveGlobalConfig } = await import('../../src/core/global-config.js');

    // Set initial config with custom delivery
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills', workflows: ['explore'] });

    // Simulate the core preset logic
    const config = getGlobalConfig();
    const { CORE_WORKFLOWS } = await import('../../src/core/profiles.js');
    config.profile = 'core';
    config.workflows = [...CORE_WORKFLOWS];
    // Delivery should be preserved
    saveGlobalConfig(config);

    const result = getGlobalConfig();
    expect(result.profile).toBe('core');
    expect(result.delivery).toBe('skills'); // preserved
    expect(result.workflows).toEqual(['propose', 'explore', 'apply', 'sync', 'archive', 'auto-command', 'help']);
  });

  it('custom workflow selection should set profile to custom', async () => {
    const { getGlobalConfig, saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { CORE_WORKFLOWS } = await import('../../src/core/profiles.js');

    // Simulate custom selection that differs from core
    const selectedWorkflows = ['explore', 'new', 'apply', 'ff', 'verify'];
    const isCoreMatch =
      selectedWorkflows.length === CORE_WORKFLOWS.length &&
      CORE_WORKFLOWS.every((w: string) => selectedWorkflows.includes(w));

    expect(isCoreMatch).toBe(false);

    saveGlobalConfig({
      featureFlags: {},
      profile: isCoreMatch ? 'core' : 'custom',
      delivery: 'both',
      workflows: selectedWorkflows,
    });

    const result = getGlobalConfig();
    expect(result.profile).toBe('custom');
    expect(result.workflows).toEqual(selectedWorkflows);
  });

  it('selecting exactly core workflows should set profile to core', async () => {
    const { CORE_WORKFLOWS } = await import('../../src/core/profiles.js');

    const selectedWorkflows = [...CORE_WORKFLOWS];
    const isCoreMatch =
      selectedWorkflows.length === CORE_WORKFLOWS.length &&
      CORE_WORKFLOWS.every((w: string) => selectedWorkflows.includes(w));

    expect(isCoreMatch).toBe(true);
  });

  it('config schema should validate profile and delivery values', async () => {
    const { validateConfig } = await import('../../src/core/config-schema.js');

    expect(validateConfig({ featureFlags: {}, profile: 'full', delivery: 'both' }).success).toBe(true);
    expect(validateConfig({ featureFlags: {}, profile: 'core', delivery: 'both' }).success).toBe(true);
    expect(validateConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills' }).success).toBe(true);
    expect(validateConfig({ featureFlags: {}, language: 'ja' }).success).toBe(true);
    expect(validateConfig({ featureFlags: {}, language: 'fr' }).success).toBe(false);
  });

  it('config schema should accept legacy delivery values and transform them to the mapped value', async () => {
    const { GlobalConfigSchema, validateConfig } = await import('../../src/core/config-schema.js');

    // Whole-file validation (config set/edit) never rejects an old value.
    expect(validateConfig({ featureFlags: {}, profile: 'custom', delivery: 'commands', workflows: ['explore'] }).success).toBe(true);
    expect(validateConfig({ featureFlags: {}, profile: 'custom', delivery: 'commands-first', workflows: ['explore'] }).success).toBe(true);
    expect(validateConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills-first', workflows: ['explore'] }).success).toBe(true);

    // And the legacy value is actually transformed to its mapped equivalent.
    expect(GlobalConfigSchema.parse({ featureFlags: {}, delivery: 'commands' }).delivery).toBe('both');
    expect(GlobalConfigSchema.parse({ featureFlags: {}, delivery: 'commands-first' }).delivery).toBe('both');
    expect(GlobalConfigSchema.parse({ featureFlags: {}, delivery: 'skills-first' }).delivery).toBe('skills');
  });

  it('config schema should reject invalid profile values', async () => {
    const { validateConfig } = await import('../../src/core/config-schema.js');

    const result = validateConfig({ featureFlags: {}, profile: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('config schema should reject invalid delivery values', async () => {
    const { validateConfig } = await import('../../src/core/config-schema.js');

    const result = validateConfig({ featureFlags: {}, delivery: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('config command --scope project and promoted keys', () => {
  let tempDir: string;
  let projectDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalTTY: boolean | undefined;
  let originalExitCode: number | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-config-scope-test-'))
    );
    projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(projectDir, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    originalTTY = (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;

    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.RASEN_LANG = 'en';
    process.chdir(projectDir);
    process.exitCode = undefined;

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    fs.rmSync(tempDir, { recursive: true, force: true });

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.resetModules();
  });

  it('rejects an invalid --scope value', async () => {
    await runConfigCommand(['set', 'proactive', 'false', '--scope', 'bogus']);
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--scope must be'));
  });

  it('set --scope project writes rasen/config.yaml, preserving comments', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\n# keep me\n'
    );

    await runConfigCommand(['set', 'autopilot.gates', 'off', '--scope', 'project']);

    const raw = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(raw).toContain('# keep me');
    expect(raw).toMatch(/gates: off/);
    expect(consoleLogSpy).toHaveBeenCalledWith('Set autopilot.gates = "off"');
  });

  it('get/list --scope project reads rasen/config.yaml', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\nautopilot:\n  gates: off\n'
    );

    await runConfigCommand(['get', 'autopilot.gates', '--scope', 'project']);
    expect(consoleLogSpy).toHaveBeenCalledWith('off');

    await runConfigCommand(['list', '--scope', 'project', '--json']);
    const jsonCall = consoleLogSpy.mock.calls.find(([line]) => typeof line === 'string' && line.includes('"schema"'));
    expect(jsonCall).toBeTruthy();
  });

  it('unset --scope project removes the key and falls back to default', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\nhandoff:\n  threshold: 0.4\n'
    );

    await runConfigCommand(['unset', 'handoff.threshold', '--scope', 'project']);

    expect(consoleLogSpy).toHaveBeenCalledWith('Unset handoff.threshold (reverted to default)');
    const raw = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(raw).not.toContain('threshold');
  });

  it('unset --scope project rejects a hand-edit-only field (context) without touching the file (MIN5)', async () => {
    fs.writeFileSync(
      path.join(projectDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\ncontext: |\n  keep me\n'
    );
    const before = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');

    await runConfigCommand(['unset', 'context', '--scope', 'project']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid configuration key'));
    const after = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('path --scope project prints the project config file location', async () => {
    await runConfigCommand(['path', '--scope', 'project']);
    expect(consoleLogSpy).toHaveBeenCalledWith(path.join(projectDir, 'rasen', 'config.yaml'));
  });

  it('fails --scope project operations outside a Rasen project', async () => {
    process.chdir(tempDir); // no rasen/ here
    await runConfigCommand(['get', 'schema', '--scope', 'project']);
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('no Rasen project found'));
  });

  it('rejects an unknown project key without modifying the file', async () => {
    const before = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');

    await runConfigCommand(['set', '--scope', 'project', 'someUnknownKey', '1']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown configuration key'));
    const after = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects an out-of-range project handoff.threshold without writing', async () => {
    const before = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');

    await runConfigCommand(['set', '--scope', 'project', 'handoff.threshold', '1.5']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('(0, 1]'));
    const after = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(after).toBe(before);
  });

  it.each([
    ['language', 'ja'],
    ['proactive', 'false'],
    ['repoMode', 'solo'],
    ['telemetry.enabled', 'false'],
    ['handoff.threshold', '0.6'],
  ])('sets promoted global key %s without --allow-unknown', async (key, value) => {
    await runConfigCommand(['set', key, value]);
    expect(process.exitCode).not.toBe(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('persists the selected CLI language in the global JSON config', async () => {
    const { getGlobalConfigPath } = await import('../../src/core/global-config.js');

    await runConfigCommand(['set', 'language', 'ja']);

    const saved = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8')) as {
      language?: string;
    };
    expect(saved.language).toBe('ja');
  });

  it('localizes non-JSON list, set, unset, and validation output in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';

    await runConfigCommand(['set', 'proactive', 'false']);
    expect(consoleLogSpy).toHaveBeenCalledWith('proactive = false に設定しました');

    await runConfigCommand(['list']);
    expect(consoleLogSpy).toHaveBeenCalledWith('\nプロファイル設定:');

    await runConfigCommand(['unset', 'proactive']);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'proactiveの設定を解除しました（デフォルトへ戻しました）'
    );

    await runConfigCommand(['set', 'unknownKey', '1']);
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('エラー: 設定キー"unknownKey"は無効です。')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('利用可能なキー')
    );
  });

  it('localizes invalid project YAML and field diagnostics in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const configPath = path.join(projectDir, 'rasen', 'config.yaml');

    fs.writeFileSync(configPath, 'schema: [\n', 'utf-8');
    await runConfigCommand(['list', '--scope', 'project']);
    let diagnostics = warnSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(diagnostics).toContain('解析できませんでした');
    expect(diagnostics).not.toContain('Warning: could not parse');

    warnSpy.mockClear();
    fs.writeFileSync(
      configPath,
      'schema: 123\nautopilot:\n  gates: maybe\n',
      'utf-8'
    );
    await runConfigCommand(['get', 'schema', '--scope', 'project']);
    diagnostics = warnSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(diagnostics).toContain("'schema'フィールドが無効です");
    expect(diagnostics).toContain("'autopilot.gates'フィールドが無効です");
    expect(diagnostics).not.toContain("Invalid 'schema'");
    expect(diagnostics).not.toContain("Invalid 'autopilot.gates'");

    warnSpy.mockRestore();
  });

  it('sets the absolute { remainingTokens } threshold form at project scope, formatting the confirmation as JSON (MIN-M1/M2)', async () => {
    await runConfigCommand([
      'set',
      '--scope',
      'project',
      'handoff.threshold',
      '{"remainingTokens": 60000}',
    ]);

    expect(process.exitCode).not.toBe(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Set handoff.threshold = {"remainingTokens":60000}'
    );
    const raw = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(raw).toMatch(/remainingTokens: 60000/);

    await runConfigCommand(['get', 'handoff.threshold', '--scope', 'project']);
    expect(consoleLogSpy).toHaveBeenCalledWith('{"remainingTokens":60000}');
  });

  it('sets the absolute { remainingTokens } threshold form at global scope, formatting the confirmation as JSON (MIN-M1/M2)', async () => {
    await runConfigCommand(['set', 'handoff.threshold', '{"remainingTokens": 60000}']);

    expect(process.exitCode).not.toBe(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Set handoff.threshold = {"remainingTokens":60000}'
    );

    await runConfigCommand(['get', 'handoff.threshold']);
    expect(consoleLogSpy).toHaveBeenCalledWith('{"remainingTokens":60000}');
  });

  it('rejects an invalid absolute-form threshold at project scope without writing (MIN-M2)', async () => {
    const before = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');

    await runConfigCommand([
      'set',
      '--scope',
      'project',
      'handoff.threshold',
      '{"remainingTokens": 0}',
    ]);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('positive integer'));
    const after = fs.readFileSync(path.join(projectDir, 'rasen', 'config.yaml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects an invalid enum value for a promoted global key', async () => {
    await runConfigCommand(['set', 'repoMode', 'banana']);
    expect(process.exitCode).toBe(1);
  });

  it('rejects an out-of-range global handoff.threshold without writing (MIN6a, zod branch)', async () => {
    const { getGlobalConfigPath } = await import('../../src/core/global-config.js');
    const existedBefore = fs.existsSync(getGlobalConfigPath());

    await runConfigCommand(['set', 'handoff.threshold', '1.5']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid configuration'));
    expect(fs.existsSync(getGlobalConfigPath())).toBe(existedBefore);
  });

  it('rejects a machine-managed telemetry field', async () => {
    await runConfigCommand(['set', 'telemetry.anonymousId', 'abc']);
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not settable'));
  });

  it('non-TTY no-arg prints the effective view and exits 0', async () => {
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = false;

    await runConfigCommand([]);

    expect(process.exitCode).not.toBe(1);
    const printed = consoleLogSpy.mock.calls.map(([line]) => String(line));
    expect(printed.some((line) => line.startsWith('proactive ='))).toBe(true);
    expect(printed.some((line) => line.includes('--help'))).toBe(true);
  });

  describe('reset/edit reject --scope project (M1)', () => {
    it('reset --scope project fails and does not touch the global config file', async () => {
      const { getGlobalConfigPath, saveGlobalConfig } = await import('../../src/core/global-config.js');
      saveGlobalConfig({ proactive: false } as never);
      const before = fs.readFileSync(getGlobalConfigPath(), 'utf-8');

      await runConfigCommand(['reset', '--all', '--yes', '--scope', 'project']);

      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('only supports global scope'));
      const after = fs.readFileSync(getGlobalConfigPath(), 'utf-8');
      expect(after).toBe(before);
    });

    it('reset --all --yes (global scope) still resets the global config, unaffected by the guard', async () => {
      const { getGlobalConfig, saveGlobalConfig } = await import('../../src/core/global-config.js');
      saveGlobalConfig({ proactive: false } as never);

      await runConfigCommand(['reset', '--all', '--yes']);

      expect(process.exitCode).not.toBe(1);
      const config = getGlobalConfig();
      expect(config.proactive).toBe(true);
    });

    it('edit --scope project fails without touching or spawning an editor', async () => {
      process.env.EDITOR = 'true';

      await runConfigCommand(['edit', '--scope', 'project']);

      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('only supports global scope'));
      const { getGlobalConfigPath } = await import('../../src/core/global-config.js');
      expect(fs.existsSync(getGlobalConfigPath())).toBe(false);
    });

    it('reset/edit reject an invalid --scope value the same way other subcommands do', async () => {
      await runConfigCommand(['reset', '--all', '--yes', '--scope', 'bogus']);
      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--scope must be'));
    });
  });
});
