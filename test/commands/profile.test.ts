import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerProfileCommand } from '../../src/commands/profile.js';
import { getGlobalConfig, saveGlobalConfig } from '../../src/core/global-config.js';
import {
  namedProfileExists,
  readNamedProfile,
  saveNamedProfile,
} from '../../src/core/named-profiles.js';
import {
  importWorkflow,
  scaffoldWorkflow,
  workflowDefinitionForJson,
} from '../../src/core/workflow-library.js';
import {
  getUserWorkflowsDir,
  loadWorkflowCatalog,
} from '../../src/core/workflow-registry/index.js';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  confirm: vi.fn(),
}));

async function runProfileCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerProfileCommand(program);
  await program.parseAsync(['node', 'rasen', 'profile', ...args]);
}

async function promptMocks(): Promise<{
  input: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  checkbox: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
}> {
  const prompts = await import('@inquirer/prompts');
  return {
    input: prompts.input as unknown as ReturnType<typeof vi.fn>,
    select: prompts.select as unknown as ReturnType<typeof vi.fn>,
    checkbox: prompts.checkbox as unknown as ReturnType<typeof vi.fn>,
    confirm: prompts.confirm as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('profile command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalTTY: boolean | undefined;
  let originalExitCode: number | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-command-'));
    originalEnv = { ...process.env };
    originalTTY = (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;
    process.env.RASEN_HOME = tempDir;
    process.env.RASEN_LANG = 'en';
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = true;
    process.exitCode = undefined;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses a saved profile by copying its delivery and workflows to global config', async () => {
    saveNamedProfile('minimal', {
      version: 1,
      delivery: 'skills',
      workflows: ['propose', 'apply'],
    });

    await runProfileCommand(['use', 'minimal']);

    expect(getGlobalConfig()).toMatchObject({
      profile: 'custom',
      delivery: 'skills',
      workflows: ['propose', 'apply'],
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Using profile "minimal".');
  });

  it('preserves delivery when using a built-in profile', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills', workflows: [] });

    await runProfileCommand(['use', 'core']);

    expect(getGlobalConfig().profile).toBe('core');
    expect(getGlobalConfig().delivery).toBe('skills');
    expect(getGlobalConfig().workflows).toContain('sync');
  });

  it('offers profile selection when use is called without a name', async () => {
    const { select } = await promptMocks();
    select.mockResolvedValueOnce('core');

    await runProfileCommand(['use']);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Select a profile to use:' })
    );
    expect(getGlobalConfig().profile).toBe('core');
  });

  it('creates, saves, and selects a named profile interactively', async () => {
    const { select, checkbox, confirm } = await promptMocks();
    select.mockResolvedValueOnce('skills');
    checkbox.mockResolvedValueOnce(['propose', 'explore']);
    confirm.mockResolvedValueOnce(true);

    await runProfileCommand(['new', 'team']);

    expect(readNamedProfile('team')).toEqual({
      version: 1,
      delivery: 'skills',
      workflows: ['propose', 'explore'],
    });
    expect(getGlobalConfig()).toMatchObject({
      profile: 'custom',
      delivery: 'skills',
      workflows: ['propose', 'explore'],
    });
    expect(checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Space to toggle, A to select/clear all, Enter to confirm',
        shortcuts: { all: 'a' },
      })
    );
  });

  it('uses Japanese delivery and workflow pickers when creating a profile', async () => {
    const { select, checkbox, confirm } = await promptMocks();
    process.env.RASEN_LANG = 'ja';
    select.mockResolvedValueOnce('skills');
    checkbox.mockResolvedValueOnce(['propose']);
    confirm.mockResolvedValueOnce(false);

    await runProfileCommand(['new', 'team']);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '配信方法（ワークフローのインストール形式）:',
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'skills', name: 'スキルのみ' }),
        ]),
      })
    );
    expect(checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '利用可能にするワークフローを選択:',
        instructions: 'Spaceで切り替え、Aですべて選択・解除、Enterで確定',
        choices: expect.arrayContaining([
          expect.objectContaining({
            value: 'propose',
            name: 'propose         - 変更を提案',
            description: '依頼から変更提案、仕様、設計、タスクリストをまとめて作成します',
          }),
        ]),
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'プロファイル「team」を保存して使用しますか?' })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('プロファイル作成をキャンセルしました。');
    expect(namedProfileExists('team')).toBe(false);
  });

  it('keeps the name prompt open for reserved and existing profile names', async () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    const { input, select, checkbox, confirm } = await promptMocks();
    input.mockResolvedValueOnce('fresh');
    select.mockResolvedValueOnce('both');
    checkbox.mockResolvedValueOnce(['propose']);
    confirm.mockResolvedValueOnce(true);

    await runProfileCommand(['new']);

    const validate = input.mock.calls[0][0].validate as (name: string) => string | true;
    expect(validate('core')).toBe('Profile name "core" is reserved.');
    expect(validate('team')).toBe('Profile "team" already exists.');
    expect(validate('available')).toBe(true);
    expect(namedProfileExists('fresh')).toBe(true);
  });

  it('bounds long user workflow descriptions without hiding the localized source label', async () => {
    process.env.RASEN_LANG = 'ja';
    const draft = scaffoldWorkflow('picker-long', path.join(tempDir, 'draft', 'picker-long'));
    const skillPath = path.join(draft, 'SKILL.md');
    const longDescription = 'long description '.repeat(1000).trim();
    fs.writeFileSync(
      skillPath,
      fs.readFileSync(skillPath, 'utf8').replace(
        'description: Describe when to use the picker-long workflow.',
        `description: ${longDescription}`
      )
    );
    await importWorkflow(draft);
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['picker-long'],
    });
    const { select, checkbox, confirm } = await promptMocks();
    select.mockResolvedValueOnce('both');
    checkbox.mockResolvedValueOnce(['picker-long']);
    confirm.mockResolvedValueOnce(false);

    await runProfileCommand(['new', 'picker-long-profile']);

    const choices = checkbox.mock.calls[0][0].choices as Array<{
      value: string;
      description: string;
    }>;
    const description = choices.find((choice) => choice.value === 'picker-long')?.description;
    expect(description?.startsWith('[ユーザー] ')).toBe(true);
    expect(description?.split('\n')).toHaveLength(2);
    expect(description?.endsWith('...')).toBe(true);

    const definition = loadWorkflowCatalog().get('picker-long');
    expect(definition).toBeDefined();
    expect(workflowDefinitionForJson(definition!)).toMatchObject({
      skill: { description: longDescription },
    });
  });

  it('labels user workflows and prevents deselecting a required dependency', async () => {
    const baseDraft = scaffoldWorkflow('picker-base', path.join(tempDir, 'draft', 'picker-base'));
    await importWorkflow(baseDraft);
    const rootDraft = scaffoldWorkflow('picker-root', path.join(tempDir, 'draft', 'picker-root'));
    const rootManifest = path.join(rootDraft, 'workflow.yaml');
    fs.writeFileSync(
      rootManifest,
      fs.readFileSync(rootManifest, 'utf8').replace(
        '  workflows: []',
        '  workflows: [picker-base]'
      )
    );
    await importWorkflow(rootDraft);
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['picker-base', 'picker-root'],
    });
    const { select, checkbox, confirm } = await promptMocks();
    select.mockResolvedValueOnce('both');
    checkbox.mockResolvedValueOnce(['picker-root']);
    confirm.mockResolvedValueOnce(false);

    await runProfileCommand(['new', 'picker-profile']);

    const choices = checkbox.mock.calls[0][0].choices as Array<{
      value: string;
      description: string;
      disabled?: string;
    }>;
    expect(choices.find((choice) => choice.value === 'picker-root')?.description).toContain('[user]');
    expect(choices.find((choice) => choice.value === 'picker-base')?.disabled).toBe(
      'required by picker-root'
    );
  });

  it('fails clearly for an explicit existing profile name', async () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    const { select, checkbox } = await promptMocks();

    await runProfileCommand(['new', 'team']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Profile "team" already exists.');
    expect(select).not.toHaveBeenCalled();
    expect(checkbox).not.toHaveBeenCalled();
  });

  it('localizes a missing named-profile error in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';

    await runProfileCommand(['use', 'missing']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^エラー: プロファイルファイルが見つかりません:/)
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Profile file not found')
    );
  });

  it('localizes an unsupported import format in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';
    const sourcePath = path.join(tempDir, 'shared.txt');
    fs.writeFileSync(sourcePath, 'not a profile', 'utf-8');

    await runProfileCommand(['import', sourcePath]);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'エラー: プロファイル形式「.txt」には対応していません。.yaml、.yml、または.jsonを使用してください。'
    );
  });

  it('lists built-in and saved profiles as JSON', async () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });

    await runProfileCommand(['list', '--json']);

    const output = consoleLogSpy.mock.calls.map(([value]) => String(value)).join('\n');
    const payload = JSON.parse(output) as { profiles: Array<{ name: string }> };
    expect(payload.profiles.map((profile) => profile.name)).toEqual(['full', 'core', 'team']);
  });

  it('localizes malformed saved-profile details in the human list without changing JSON fields', async () => {
    process.env.RASEN_LANG = 'ja';
    const profilesDir = path.join(tempDir, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(
      path.join(profilesDir, 'broken.yaml'),
      'version: 2\ndelivery: both\nworkflows: [propose]\n',
      'utf-8'
    );

    await runProfileCommand(['list']);
    let output = consoleLogSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(output).toContain('broken [無効]');
    expect(output).toContain('broken.yamlが無効です:');

    consoleLogSpy.mockClear();
    await runProfileCommand(['list', '--json']);
    output = consoleLogSpy.mock.calls.map(([value]) => String(value)).join('\n');
    const payload = JSON.parse(output) as {
      profiles: Array<Record<string, unknown>>;
    };
    const broken = payload.profiles.find((profile) => profile.name === 'broken');
    expect(broken).toBeDefined();
    expect(Object.keys(broken ?? {}).sort()).toEqual(
      ['builtIn', 'error', 'matchesCurrent', 'name'].sort()
    );
    expect(String(broken?.error)).toContain('Invalid ');
    expect(broken).not.toHaveProperty('errorDescriptor');
  });

  it('localizes malformed saved-profile chooser descriptions in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';
    const profilesDir = path.join(tempDir, 'profiles');
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.writeFileSync(
      path.join(profilesDir, 'broken.yaml'),
      'version: 2\ndelivery: both\nworkflows: [propose]\n',
      'utf-8'
    );
    const { select } = await promptMocks();
    select.mockResolvedValueOnce('core');

    await runProfileCommand(['use']);

    const choices = select.mock.calls[0][0].choices as Array<{
      value: string;
      description: string;
    }>;
    const broken = choices.find((choice) => choice.value === 'broken');
    expect(broken?.description).toContain('broken.yamlが無効です:');
    expect(broken?.description).toContain('version:');
  });

  it('imports without applying and exports a selected saved profile', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'skills',
      workflows: ['explore'],
    });
    const sourcePath = path.join(tempDir, 'shared.json');
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({ version: 1, delivery: 'both', workflows: ['propose'] }),
      'utf-8'
    );

    await runProfileCommand(['import', sourcePath]);
    expect(namedProfileExists('shared')).toBe(true);
    expect(getGlobalConfig().workflows).toEqual(['explore']);

    const destinationPath = path.join(tempDir, 'exported.json');
    await runProfileCommand(['export', destinationPath, '--profile', 'shared']);
    expect(JSON.parse(fs.readFileSync(destinationPath, 'utf-8'))).toEqual({
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
  });

  it('requires --force to overwrite an export outside a TTY', async () => {
    const destinationPath = path.join(tempDir, 'existing.yaml');
    fs.writeFileSync(destinationPath, 'keep\n', 'utf-8');
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = false;

    await runProfileCommand(['export', destinationPath]);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Pass --force'));
    expect(fs.readFileSync(destinationPath, 'utf-8')).toBe('keep\n');
  });

  it('exports a self-contained package and imports its embedded workflow with --as', async () => {
    const draft = scaffoldWorkflow('profile-command-user', path.join(tempDir, 'draft', 'profile-command-user'));
    await importWorkflow(draft);
    saveNamedProfile('portable', {
      version: 1,
      delivery: 'both',
      workflows: ['profile-command-user'],
    });
    const packagePath = path.join(tempDir, 'portable.rasenpkg');
    await runProfileCommand(['export', packagePath, '--profile', 'portable']);

    const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-command-clean-'));
    process.env.RASEN_HOME = cleanHome;
    try {
      await runProfileCommand(['import', packagePath, '--as', 'renamed']);
      expect(readNamedProfile('renamed').workflows).toEqual(['profile-command-user']);
      expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'profile-command-user'))).toBe(true);
    } finally {
      fs.rmSync(cleanHome, { recursive: true, force: true });
      process.env.RASEN_HOME = tempDir;
    }
  });

  it('does not let --force replace a conflicting workflow digest', async () => {
    const draft = scaffoldWorkflow('immutable-profile-user', path.join(tempDir, 'draft', 'immutable-profile-user'));
    await importWorkflow(draft);
    saveNamedProfile('immutable-profile', {
      version: 1,
      delivery: 'skills',
      workflows: ['immutable-profile-user'],
    });
    const packagePath = path.join(tempDir, 'immutable-profile.rasenpkg');
    await runProfileCommand(['export', packagePath, '--profile', 'immutable-profile']);
    fs.appendFileSync(
      path.join(getUserWorkflowsDir(), 'immutable-profile-user', 'SKILL.md'),
      '\nChanged installed content.\n'
    );

    await runProfileCommand(['import', packagePath, '--force']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('conflicts with installed user content')
    );
    expect(readNamedProfile('immutable-profile').delivery).toBe('skills');
  });

  it('deletes a saved profile without changing current settings', async () => {
    saveNamedProfile('obsolete', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'skills',
      workflows: ['explore'],
    });

    await runProfileCommand(['delete', 'obsolete', '--yes']);

    expect(namedProfileExists('obsolete')).toBe(false);
    expect(getGlobalConfig().workflows).toEqual(['explore']);
  });
});
