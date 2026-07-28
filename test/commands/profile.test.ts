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
import { ALL_EXPERTS, ALL_WORKFLOWS } from '../../src/core/profiles.js';
import {
  importWorkflow,
  scaffoldWorkflow,
  workflowDefinitionForJson,
} from '../../src/core/workflow-library.js';
import {
  getUserWorkflowsDir,
  loadWorkflowCatalog,
} from '../../src/core/workflow-registry/index.js';
import { setStdoutRows } from '../helpers/stdout.js';

const PICKER_CHOICE_COUNT = ALL_WORKFLOWS.length + ALL_EXPERTS.length + 2;

vi.mock('@inquirer/prompts', async () => {
  const actual = await vi.importActual<typeof import('@inquirer/prompts')>('@inquirer/prompts');
  return {
    ...actual,
    input: vi.fn(),
    select: vi.fn(),
    checkbox: vi.fn(),
    confirm: vi.fn(),
  };
});



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

describe('resolveWorkflowPickerPageSize', () => {
  it.each<[string, number, number | undefined, number]>([
    ['unavailable height', 45, undefined, 7],
    ['NaN height', 45, NaN, 7],
    ['zero height', 45, 0, 7],
    ['negative height', 45, -1, 7],
    ['fractional height', 45, 12.5, 7],
    ['three-row terminal', 45, 3, 1],
    ['five-row terminal', 45, 5, 1],
    ['12-row terminal', 45, 12, 7],
    ['24-row terminal', 45, 24, 19],
    ['50-row terminal', 45, 50, 45],
    ['100-row terminal', 45, 100, 45],
    ['short choice list', 4, 24, 4],
  ])('uses the contract page size for %s', async (_case, choiceCount, rows, expected) => {
    const { resolveWorkflowPickerPageSize } = await import(
      '../../src/commands/profile-editor.js'
    );

    expect(resolveWorkflowPickerPageSize(choiceCount, rows)).toBe(expected);
  });
});

describe('profile command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalTTY: boolean | undefined;
  let originalExitCode: typeof process.exitCode;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-command-'));
    originalEnv = { ...process.env };
    originalTTY = (process.stdout as unknown as { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;
    process.env.RASEN_HOME = tempDir;
    process.env.RASEN_LANG = 'en';
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = true;
    process.exitCode = undefined;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses a saved profile by copying its workflows to global config', async () => {
    saveNamedProfile('minimal', {
      version: 1,
      workflows: ['propose', 'apply'],
    });

    await runProfileCommand(['use', 'minimal']);

    expect(getGlobalConfig()).toMatchObject({
      profile: 'custom',
      workflows: ['propose', 'apply'],
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Using profile "minimal".');
  });

  it('uses a built-in profile and does not surface a delivery setting', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', workflows: [] });

    await runProfileCommand(['use', 'core']);

    expect(getGlobalConfig().profile).toBe('core');
    expect((getGlobalConfig() as any).delivery).toBeUndefined();
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

  it('creates, saves, and selects a named profile within a short terminal', async () => {
    const { select, checkbox, confirm } = await promptMocks();
    const restoreRows = setStdoutRows(12);
    checkbox.mockResolvedValueOnce(['propose', 'explore']);
    select.mockResolvedValueOnce('off');
    confirm.mockResolvedValueOnce(true);

    try {
      await runProfileCommand(['new', 'team']);

      expect(readNamedProfile('team')).toEqual({
        version: 2,
        workflows: ['propose', 'explore'],
        retention: 'off',
      });
      expect(getGlobalConfig()).toMatchObject({
        profile: 'custom',
        workflows: ['propose', 'explore'],
      });
      expect(checkbox).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: 'Space to toggle, A to select/clear all, Enter to confirm',
          shortcuts: { all: 'a' },
          pageSize: 7,
          choices: expect.any(Array),
        })
      );
      expect(checkbox.mock.calls[0][0].choices).toHaveLength(PICKER_CHOICE_COUNT);
    } finally {
      restoreRows();
    }
  });

  describe('update subcommand (init-profile-lock)', () => {
    it('edits a saved definition in place without touching the current global selection', async () => {
      saveNamedProfile('team', { version: 1, workflows: ['propose', 'apply'] });
      saveGlobalConfig({
        featureFlags: {},
        profile: 'core',
        expertSelectionExplicit: true,
      });
      const { select, checkbox, confirm } = await promptMocks();
      checkbox.mockResolvedValueOnce(['propose', 'explore']);
      select.mockResolvedValueOnce('off');
      confirm.mockResolvedValueOnce(true);

      await runProfileCommand(['update', 'team']);

      expect(readNamedProfile('team')).toEqual({
        version: 2,
        workflows: ['propose', 'explore'],
        retention: 'off',
      });
      // The user-wide selection stays as it was (definitions are snapshots).
      expect(getGlobalConfig()).toMatchObject({ profile: 'core' });
      expect(consoleLogSpy).toHaveBeenCalledWith('Updated profile "team". Current settings were not changed.');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Projects locked to "team" apply the change on their next `rasen update`.')
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('seeds the picker from the stored definition, not the current global selection', async () => {
      saveNamedProfile('team', { version: 1, workflows: ['propose'] });
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['explore', 'apply'],
        expertSelectionExplicit: true,
      });
      const { checkbox } = await promptMocks();
      // The unchanged selection short-circuits before any confirm prompt, so
      // queue nothing on `confirm` (a leftover once-value would leak into a
      // later test — clearAllMocks does not drop queued once-implementations).
      checkbox.mockResolvedValueOnce(['propose']);

      await runProfileCommand(['update', 'team']);

      const choices = checkbox.mock.calls[0][0].choices as Array<{
        value?: string;
        checked?: boolean;
      }>;
      const checked = choices.flatMap((choice) =>
        typeof choice.value === 'string' && choice.checked === true ? [choice.value] : []
      );
      expect(checked).toEqual(['propose']);
    });

    it('declining the confirmation leaves the definition file byte-identical', async () => {
      saveNamedProfile('team', { version: 1, workflows: ['propose', 'apply'] });
      const definitionPath = path.join(tempDir, 'profiles', 'team.yaml');
      const before = fs.readFileSync(definitionPath, 'utf-8');
      const { checkbox, confirm } = await promptMocks();
      checkbox.mockResolvedValueOnce(['explore']);
      confirm.mockResolvedValueOnce(false);

      await runProfileCommand(['update', 'team']);

      expect(fs.readFileSync(definitionPath, 'utf-8')).toBe(before);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Profile update cancelled. No changes were saved.'
      );
    });

    it('an unchanged selection saves nothing', async () => {
      saveNamedProfile('team', { version: 1, workflows: ['propose'] });
      const definitionPath = path.join(tempDir, 'profiles', 'team.yaml');
      const before = fs.readFileSync(definitionPath, 'utf-8');
      const { select, checkbox, confirm } = await promptMocks();
      checkbox.mockResolvedValueOnce(['propose']);
      select.mockResolvedValueOnce('off');

      await runProfileCommand(['update', 'team']);

      expect(confirm).not.toHaveBeenCalled();
      expect(fs.readFileSync(definitionPath, 'utf-8')).toBe(before);
      expect(consoleLogSpy).toHaveBeenCalledWith('No changes to profile "team". Nothing was saved.');
    });

    it('rejects built-in and reserved names', async () => {
      for (const reserved of ['full', 'core', 'custom']) {
        process.exitCode = undefined;
        await runProfileCommand(['update', reserved]);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Profile "${reserved}" is built-in or reserved and cannot be edited.`)
        );
        expect(process.exitCode).toBe(1);
      }
    });

    it('fails for an unknown saved profile name', async () => {
      await runProfileCommand(['update', 'ghost']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(process.exitCode).toBe(1);
    });

    it('requires an interactive terminal', async () => {
      saveNamedProfile('team', { version: 1, workflows: ['propose'] });
      (process.stdout as unknown as { isTTY?: boolean }).isTTY = false;

      await runProfileCommand(['update', 'team']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('`rasen profile update` requires an interactive terminal.')
      );
      expect(process.exitCode).toBe(1);
    });

    it('prompts among saved profiles when no name is given', async () => {
      saveNamedProfile('team', { version: 1, workflows: ['propose'] });
      const { select, checkbox, confirm } = await promptMocks();
      // The name chooser and the retention radio are both `select` prompts,
      // in that order.
      select.mockResolvedValueOnce('team');
      checkbox.mockResolvedValueOnce(['explore']);
      select.mockResolvedValueOnce('off');
      confirm.mockResolvedValueOnce(true);

      await runProfileCommand(['update']);

      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Select a profile to update:' })
      );
      expect(readNamedProfile('team')).toEqual({
        version: 2,
        workflows: ['explore'],
        retention: 'off',
      });
    });

    it('fails with no saved profiles when update is called without a name', async () => {
      const { select } = await promptMocks();

      await runProfileCommand(['update']);

      expect(select).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No saved profiles are available.')
      );
      expect(process.exitCode).toBe(1);
    });
  });

  it('uses the opening terminal height in the current-profile editor', async () => {
    const { select, checkbox } = await promptMocks();
    const restoreRows = setStdoutRows(24);
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: ['propose'],
      expertSelectionExplicit: true,
    });
    select.mockResolvedValueOnce('workflows');
    checkbox.mockImplementationOnce(async (options: {
      choices: Array<{ value?: string; checked?: boolean }>;
    }) => options.choices.flatMap((choice) =>
      typeof choice.value === 'string' && choice.checked === true ? [choice.value] : []
    ));

    try {
      await runProfileCommand([]);

      const checkboxCall = checkbox.mock.calls[0][0];
      expect(checkboxCall.pageSize).toBe(19);
      expect(checkboxCall.choices).toHaveLength(PICKER_CHOICE_COUNT);
    } finally {
      restoreRows();
    }
  });

  it('falls back safely and recaptures height when the picker opens again', async () => {
    const { checkbox, confirm } = await promptMocks();
    const restoreRows = setStdoutRows(undefined);
    checkbox.mockResolvedValue(['propose']);
    confirm.mockResolvedValue(false);

    try {
      await runProfileCommand(['new', 'fallback']);
      Object.defineProperty(process.stdout, 'rows', {
        configurable: true,
        value: 24,
      });
      await runProfileCommand(['new', 'resized']);

      expect(checkbox.mock.calls.map(([options]) => options.pageSize)).toEqual([7, 19]);
      expect(checkbox.mock.calls[0][0].choices).toHaveLength(PICKER_CHOICE_COUNT);
      expect(checkbox.mock.calls[1][0].choices).toHaveLength(PICKER_CHOICE_COUNT);
    } finally {
      restoreRows();
    }
  });

  it('uses the Japanese workflow picker and retention radio when creating a profile (delivery retired)', async () => {
    const { select, checkbox, confirm } = await promptMocks();
    process.env.RASEN_LANG = 'ja';
    checkbox.mockResolvedValueOnce(['propose']);
    select.mockResolvedValueOnce('off');
    confirm.mockResolvedValueOnce(false);

    await runProfileCommand(['new', 'team']);

    // Delivery is retired; the only non-checkbox profile prompt is the
    // localized retention radio.
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: '保持ポリシー（ship の後、archive の前に実行）:' })
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

  it('uses Simplified Chinese prompts, built-in metadata, and results when creating a profile', async () => {
    const { select, checkbox, confirm } = await promptMocks();
    process.env.RASEN_LANG = 'zh-cn';
    checkbox.mockResolvedValueOnce(['propose']);
    select.mockResolvedValueOnce('off');
    confirm.mockResolvedValueOnce(false);

    await runProfileCommand(['new', 'team']);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: '保留策略（在 ship 之后、archive 之前运行）：' })
    );
    expect(checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '选择要启用的工作流：',
        instructions: '按空格键切换，按 A 全选/清空，按 Enter 确认',
        choices: expect.arrayContaining([
          expect.objectContaining({
            value: 'propose',
            name: 'propose         - 提出变更',
            description: '将请求转化为完整的提案、规格、设计和任务清单',
          }),
          expect.objectContaining({
            value: 'review',
            name: expect.stringContaining('审查'),
            description: expect.stringContaining('合入前'),
          }),
        ]),
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: '保存并使用配置方案 "team"？' })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith('配置方案创建已取消。');
    expect(namedProfileExists('team')).toBe(false);
  });

  it('keeps the name prompt open for reserved and existing profile names', async () => {
    saveNamedProfile('team', {
      version: 1,
      workflows: ['propose'],
    });
    const { input, select, checkbox, confirm } = await promptMocks();
    input.mockResolvedValueOnce('fresh');
    checkbox.mockResolvedValueOnce(['propose']);
    select.mockResolvedValueOnce('off');
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
      workflows: ['picker-long'],
    });
    const { checkbox, confirm } = await promptMocks();
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

  it('keeps user-authored workflow content verbatim in the Simplified Chinese picker', async () => {
    process.env.RASEN_LANG = 'zh-cn';
    const authoredDescription = 'ユーザーが書いた説明をそのまま表示する';
    const draft = scaffoldWorkflow(
      'authored-verbatim',
      path.join(tempDir, 'draft', 'authored-verbatim')
    );
    const skillPath = path.join(draft, 'SKILL.md');
    fs.writeFileSync(
      skillPath,
      fs.readFileSync(skillPath, 'utf8').replace(
        'description: Describe when to use the authored-verbatim workflow.',
        `description: ${authoredDescription}`
      )
    );
    await importWorkflow(draft);
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: ['authored-verbatim'],
    });
    const { checkbox, confirm } = await promptMocks();
    checkbox.mockResolvedValueOnce(['authored-verbatim']);
    confirm.mockResolvedValueOnce(false);

    await runProfileCommand(['new', 'authored-profile']);

    const choices = checkbox.mock.calls[0][0].choices as Array<{
      value: string;
      name: string;
      description: string;
    }>;
    expect(choices.find((choice) => choice.value === 'propose')).toEqual(
      expect.objectContaining({ name: expect.stringMatching(/^propose\s+- 提出变更$/) })
    );
    expect(choices.find((choice) => choice.value === 'authored-verbatim')).toEqual(
      expect.objectContaining({
        description: `[用户] ${authoredDescription}`,
      })
    );
    expect(loadWorkflowCatalog().get('authored-verbatim')?.skill.template.description).toBe(
      authoredDescription
    );
  });

  it.each(['en', 'ja', 'zh-cn'])(
    'shows a declared skill title verbatim in the %s picker while storing the workflow id',
    async (lang) => {
      process.env.RASEN_LANG = lang;
      const titledDraft = scaffoldWorkflow(
        'titled-picker',
        path.join(tempDir, 'draft', 'titled-picker')
      );
      fs.appendFileSync(
        path.join(titledDraft, 'workflow.yaml'),
        'skill:\n  name: Example Local Verify\n'
      );
      await importWorkflow(titledDraft);
      const untitledDraft = scaffoldWorkflow(
        'untitled-picker',
        path.join(tempDir, 'draft', 'untitled-picker')
      );
      await importWorkflow(untitledDraft);
      saveGlobalConfig({
        featureFlags: {},
        profile: 'custom',
        workflows: ['titled-picker', 'untitled-picker'],
      });
      const { checkbox, confirm } = await promptMocks();
      checkbox.mockResolvedValueOnce(['titled-picker']);
      confirm.mockResolvedValueOnce(false);

      await runProfileCommand(['new', 'titled-profile']);

      const choices = checkbox.mock.calls[0][0].choices as Array<{
        value: string;
        name: string;
        short: string;
      }>;
      const titled = choices.find((choice) => choice.value === 'titled-picker');
      expect(titled?.name).toMatch(/^titled-picker\s+- Example Local Verify$/);
      expect(titled?.short).toBe('Example Local Verify');
      const untitled = choices.find((choice) => choice.value === 'untitled-picker');
      expect(untitled?.name).toMatch(/- rasen-untitled-picker$/);
      expect(untitled?.short).toBe('rasen-untitled-picker');
    }
  );

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
      workflows: ['picker-base', 'picker-root'],
    });
    const { checkbox, confirm } = await promptMocks();
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

  it('localizes named-profile failures in Simplified Chinese', async () => {
    process.env.RASEN_LANG = 'zh-cn';

    await runProfileCommand(['use', 'missing']);

    expect(process.exitCode).toBe(1);
    let output = consoleErrorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(output).toMatch(/错误： 未找到配置方案文件：/);
    expect(output).not.toContain('Profile file not found');

    process.exitCode = undefined;
    consoleErrorSpy.mockClear();
    const sourcePath = path.join(tempDir, 'shared.txt');
    fs.writeFileSync(sourcePath, 'not a profile', 'utf-8');
    await runProfileCommand(['import', sourcePath]);

    expect(process.exitCode).toBe(1);
    output = consoleErrorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(output).toContain('不支持配置方案格式 ".txt"');
    expect(output).not.toContain('Unsupported profile format');
  });

  it('reports legacy delivery migration in Simplified Chinese from the profile command-owned read', async () => {
    process.env.RASEN_LANG = 'zh-cn';
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ featureFlags: {}, language: 'zh-cn', delivery: 'commands-first' }),
      'utf-8'
    );

    await runProfileCommand(['list']);

    const diagnostics = consoleErrorSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(diagnostics).toContain("'delivery' 设置已被弃用");
    expect(diagnostics).not.toContain('交付模式');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).delivery).toBeUndefined();
  });

  it('lists built-in and saved profiles as JSON', async () => {
    saveNamedProfile('team', {
      version: 1,
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
      'version: 9\nworkflows: [propose]\n',
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
    expect(broken?.description).toContain('version');
  });

  it('imports without applying and exports a selected saved profile', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
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
      version: 2,
      workflows: ['propose'],
      retention: 'off',
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
    expect(readNamedProfile('immutable-profile').workflows).toEqual(['immutable-profile-user']);
  });

  it('deletes a saved profile without changing current settings', async () => {
    saveNamedProfile('obsolete', {
      version: 1,
      workflows: ['propose'],
    });
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: ['explore'],
    });

    await runProfileCommand(['delete', 'obsolete', '--yes']);

    expect(namedProfileExists('obsolete')).toBe(false);
    expect(getGlobalConfig().workflows).toEqual(['explore']);
  });
});
