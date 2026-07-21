import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

import { ALL_EXPERTS, ALL_WORKFLOWS } from '../../src/core/profiles.js';
import { getExpertSkillDefinitions } from '../../src/core/workflow-registry/index.js';

// The picker's choice list is workflows + experts + 2 group Separators
// (design.md D6: experts are selectable alongside workflows, shown as a
// second labeled group).
const PICKER_CHOICE_COUNT = ALL_WORKFLOWS.length + ALL_EXPERTS.length + 2;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('@inquirer/prompts', async () => {
  const actual = await vi.importActual<typeof import('@inquirer/prompts')>('@inquirer/prompts');
  return {
    ...actual,
    select: vi.fn(),
    checkbox: vi.fn(),
    confirm: vi.fn(),
  };
});

async function runConfigCommand(args: string[]): Promise<void> {
  const { registerConfigCommand } = await import('../../src/commands/config.js');
  const program = new Command();
  registerConfigCommand(program);
  await program.parseAsync(['node', 'rasen', 'config', ...args]);
}

async function getPromptMocks(): Promise<{
  select: ReturnType<typeof vi.fn>;
  checkbox: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
}> {
  const prompts = await import('@inquirer/prompts');
  return {
    select: prompts.select as unknown as ReturnType<typeof vi.fn>,
    checkbox: prompts.checkbox as unknown as ReturnType<typeof vi.fn>,
    confirm: prompts.confirm as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('diffProfileState workflow formatting', () => {
  it('uses explicit "removed" wording when workflows are deleted', async () => {
    const { diffProfileState } = await import('../../src/commands/config.js');

    const diff = diffProfileState(
      { profile: 'custom', delivery: 'both', workflows: ['propose', 'sync'] },
      { profile: 'custom', delivery: 'both', workflows: ['propose'] },
      'en',
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.lines).toEqual(['workflows: removed sync']);
  });

  it('uses explicit labels when workflows are added and removed', async () => {
    const { diffProfileState } = await import('../../src/commands/config.js');

    const diff = diffProfileState(
      { profile: 'custom', delivery: 'both', workflows: ['propose', 'sync'] },
      { profile: 'custom', delivery: 'both', workflows: ['propose', 'verify'] },
      'en',
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.lines).toEqual(['workflows: added verify; removed sync']);
  });
});

describe('deriveProfileFromWorkflowSelection', () => {
  it('returns custom for an empty workflow selection', async () => {
    const { deriveProfileFromWorkflowSelection } = await import('../../src/commands/config.js');
    expect(deriveProfileFromWorkflowSelection([])).toBe('custom');
  });

  it('returns custom when selection is a superset of core workflows', async () => {
    const { deriveProfileFromWorkflowSelection } = await import('../../src/commands/config.js');
    expect(deriveProfileFromWorkflowSelection(['propose', 'explore', 'apply', 'sync', 'archive', 'new'])).toBe('custom');
  });

  it('returns custom when selection has exactly the core workflows but no quality-floor experts', async () => {
    const { deriveProfileFromWorkflowSelection } = await import('../../src/commands/config.js');
    expect(deriveProfileFromWorkflowSelection(['archive', 'auto-command', 'sync', 'apply', 'explore', 'propose', 'help'])).toBe('custom');
  });

  it('returns core when selection has exactly core workflows plus the quality-floor experts, in different order', async () => {
    const { deriveProfileFromWorkflowSelection } = await import('../../src/commands/config.js');
    expect(deriveProfileFromWorkflowSelection([
      'archive', 'auto-command', 'sync', 'apply', 'explore', 'propose', 'help',
      'design-review', 'benchmark', 'qa-only', 'qa', 'cso', 'review',
    ])).toBe('core');
  });
});

describe('config profile interactive flow', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalTTY: boolean | undefined;
  let originalExitCode: number | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function setupDriftedProjectArtifacts(projectDir: string): void {
    fs.mkdirSync(path.join(projectDir, 'rasen'), { recursive: true });
    const exploreSkillPath = path.join(projectDir, '.claude', 'skills', 'rasen-explore', 'SKILL.md');
    fs.mkdirSync(path.dirname(exploreSkillPath), { recursive: true });
    fs.writeFileSync(exploreSkillPath, 'name: rasen-explore\n', 'utf-8');
  }

  function setupSyncedCoreBothArtifacts(projectDir: string): void {
    fs.mkdirSync(path.join(projectDir, 'rasen'), { recursive: true });
    const coreSkillDirs = [
      'rasen-propose',
      'rasen-explore',
      'rasen-apply-change',
      'rasen-sync-specs',
      'rasen-archive-change',
      'rasen-auto',
      'rasen-help',
    ];
    for (const dirName of coreSkillDirs) {
      const skillPath = path.join(projectDir, '.claude', 'skills', dirName, 'SKILL.md');
      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, `name: ${dirName}\n`, 'utf-8');
    }

    // Legacy (no explicit expert selection) resolves to CORE_WORKFLOWS +
    // ALL_EXPERTS (design.md D4 non-regression fallback) — a project fully
    // in sync also has every expert skill dir installed.
    for (const expert of getExpertSkillDefinitions()) {
      const skillPath = path.join(projectDir, '.claude', 'skills', expert.dirName, 'SKILL.md');
      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, `name: ${expert.dirName}\n`, 'utf-8');
    }

    const coreCommands = ['propose', 'explore', 'apply', 'sync', 'archive', 'auto', 'help'];
    for (const commandId of coreCommands) {
      const commandPath = path.join(projectDir, '.claude', 'commands', 'rasen', `${commandId}.md`);
      fs.mkdirSync(path.dirname(commandPath), { recursive: true });
      fs.writeFileSync(commandPath, `# ${commandId}\n`, 'utf-8');
    }
  }

  function addExtraVerifyWorkflowArtifacts(projectDir: string): void {
    const verifySkillPath = path.join(projectDir, '.claude', 'skills', 'rasen-verify-change', 'SKILL.md');
    fs.mkdirSync(path.dirname(verifySkillPath), { recursive: true });
    fs.writeFileSync(verifySkillPath, 'name: rasen-verify-change\n', 'utf-8');

    const verifyCommandPath = path.join(projectDir, '.claude', 'commands', 'rasen', 'verify.md');
    fs.mkdirSync(path.dirname(verifyCommandPath), { recursive: true });
    fs.writeFileSync(verifyCommandPath, '# verify\n', 'utf-8');
  }

  beforeEach(() => {
    vi.resetModules();

    tempDir = path.join(os.tmpdir(), `rasen-config-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    originalTTY = (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;

    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME — clear it so this suite's XDG isolation
    // actually resolves into tempDir.
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    process.env.RASEN_LANG = 'en';
    process.chdir(tempDir);
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = true;
    process.exitCode = undefined;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(execSync).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    fs.rmSync(tempDir, { recursive: true, force: true });

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('delivery-only action should not invoke workflow checkbox prompt', async () => {
    const { saveGlobalConfig, getGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, checkbox } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    select.mockResolvedValueOnce('delivery');
    select.mockResolvedValueOnce('skills');

    await runConfigCommand(['profile']);

    expect(checkbox).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(2);
    expect(getGlobalConfig().delivery).toBe('skills');
  });

  it('action picker should use configure wording and describe each path', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    select.mockResolvedValueOnce('keep');

    await runConfigCommand(['profile']);

    const firstCall = select.mock.calls[0][0];
    expect(firstCall.message).toBe('What do you want to configure?');
    expect(firstCall.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: 'delivery',
        description: 'Change where workflows are installed',
      }),
      expect.objectContaining({
        value: 'workflows',
        description: 'Change which workflow actions are available',
      }),
      expect.objectContaining({
        value: 'keep',
        name: 'Keep current settings (exit)',
      }),
    ]));
  });

  it('workflows-only action should not invoke delivery prompt', async () => {
    const { saveGlobalConfig, getGlobalConfig } = await import('../../src/core/global-config.js');
    const { ALL_WORKFLOWS } = await import('../../src/core/profiles.js');
    const { select, checkbox } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    select.mockResolvedValueOnce('workflows');
    checkbox.mockResolvedValueOnce(['propose', 'explore']);

    await runConfigCommand(['profile']);

    expect(select).toHaveBeenCalledTimes(1);
    expect(checkbox).toHaveBeenCalledTimes(1);
    const checkboxCall = checkbox.mock.calls[0][0];
    expect(checkboxCall.pageSize).toBe(PICKER_CHOICE_COUNT);
    expect(checkboxCall.theme).toEqual({
      icon: {
        checked: '[x]',
        unchecked: '[ ]',
      },
    });
    const proposeChoice = checkboxCall.choices.find((choice: { value: string }) => choice.value === 'propose');
    const onboardChoice = checkboxCall.choices.find((choice: { value: string }) => choice.value === 'onboard');
    expect(proposeChoice.checked).toBe(true);
    expect(onboardChoice.checked).toBe(false);
    expect(getGlobalConfig().workflows).toEqual(['propose', 'explore']);
  });

  it('delivery picker should mark current option inline and offer only two choices', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills', workflows: ['explore'] });
    select.mockResolvedValueOnce('delivery');
    select.mockResolvedValueOnce('skills');

    await runConfigCommand(['profile']);

    expect(select).toHaveBeenCalledTimes(2);
    const secondCall = select.mock.calls[1][0];
    expect(secondCall.choices).toHaveLength(2);
    expect(secondCall.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'skills', name: 'Skills only [current]' }),
      expect.objectContaining({ value: 'both', name: 'Both (skills + commands)' }),
    ]));
  });

  it('workflow picker should align public workflow ids with friendly names and descriptions', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, checkbox } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    select.mockResolvedValueOnce('workflows');
    checkbox.mockResolvedValueOnce(['propose', 'explore', 'apply', 'sync', 'archive']);

    await runConfigCommand(['profile']);

    const checkboxCall = checkbox.mock.calls[0][0];
    expect(checkboxCall.message).toBe('Select workflows to make available:');
    expect(checkboxCall.instructions).toBe(
      'Space to toggle, A to select/clear all, Enter to confirm'
    );
    expect(checkboxCall.shortcuts).toEqual({ all: 'a' });
    expect(checkboxCall.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: 'propose',
        name: 'propose         - Propose change',
        description: 'Turn a request into a complete proposal, specs, design, and task list',
      }),
      expect.objectContaining({
        value: 'verify',
        name: 'verify          - Verify change',
        description: 'Check that implementation matches the change artifacts before archiving',
      }),
    ]));
    expect(checkboxCall.choices).toHaveLength(PICKER_CHOICE_COUNT);
    expect(checkboxCall.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: 'goal-command',
        name: 'goal            - Run goal loop',
        description: 'Orchestrate planning, iterations, and reporting for a long-running goal',
      }),
    ]));
    expect(
      checkboxCall.choices
        .filter((choice: { value?: string }) => choice.value && (ALL_WORKFLOWS as readonly string[]).includes(choice.value))
        .map((choice: { name: string }) => choice.name.indexOf(' - '))
    ).toEqual(ALL_WORKFLOWS.map(() => 15));
    expect(
      checkboxCall.choices.find(
        (choice: { value: string }) => choice.value === 'verify-enhanced-command'
      )
    ).toEqual(
      expect.objectContaining({
        name: 'verify-enhanced - Enhanced verification',
      })
    );
  });

  it('workflow picker should localize every choice in Japanese', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, checkbox } = await getPromptMocks();

    process.env.RASEN_LANG = 'ja';
    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both' });
    select.mockResolvedValueOnce('workflows');
    checkbox.mockResolvedValueOnce(['propose', 'explore', 'apply', 'sync', 'archive']);

    await runConfigCommand(['profile']);

    const actionCall = select.mock.calls[0][0];
    expect(actionCall.message).toBe('何を設定しますか?');
    expect(actionCall.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'workflows', name: 'ワークフローのみ' }),
      ])
    );
    const checkboxCall = checkbox.mock.calls[0][0];
    expect(checkboxCall.message).toBe('利用可能にするワークフローを選択:');
    expect(checkboxCall.instructions).toBe(
      'Spaceで切り替え、Aですべて選択・解除、Enterで確定'
    );
    expect(checkboxCall.choices).toHaveLength(PICKER_CHOICE_COUNT);
    expect(checkboxCall.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: 'propose',
        name: 'propose         - 変更を提案',
        description: '依頼から変更提案、仕様、設計、タスクリストをまとめて作成します',
      }),
      expect.objectContaining({
        value: 'goal-command',
        name: 'goal            - 目標ループを実行',
        description: '長期目標の計画、反復、結果報告をまとめて進行します',
      }),
    ]));
    expect(
      checkboxCall.choices
        .filter((choice: { value?: string }) => choice.value && (ALL_WORKFLOWS as readonly string[]).includes(choice.value))
        .map((choice: { name: string }) => choice.name.indexOf(' - '))
    ).toEqual(ALL_WORKFLOWS.map(() => 15));
  });

  it('selecting current values only should be a no-op and should not ask apply', async () => {
    const { saveGlobalConfig, getGlobalConfigPath } = await import('../../src/core/global-config.js');
    const { select, confirm } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    const configPath = getGlobalConfigPath();
    const beforeContent = fs.readFileSync(configPath, 'utf-8');

    fs.mkdirSync(path.join(tempDir, 'rasen'), { recursive: true });
    select.mockResolvedValueOnce('delivery');
    select.mockResolvedValueOnce('both');

    await runConfigCommand(['profile']);

    const afterContent = fs.readFileSync(configPath, 'utf-8');
    expect(afterContent).toBe(beforeContent);
    expect(confirm).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('No config changes.');
  });

  it('keep action should warn when project files drift from global config', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    setupDriftedProjectArtifacts(tempDir);
    select.mockResolvedValueOnce('keep');

    await runConfigCommand(['profile']);

    expect(consoleLogSpy).toHaveBeenCalledWith('No config changes.');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Global config is not applied to this project.'));
  });

  it('keep action should not warn when project files are already synced', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    setupSyncedCoreBothArtifacts(tempDir);
    select.mockResolvedValueOnce('keep');

    await runConfigCommand(['profile']);

    const allLogs = consoleLogSpy.mock.calls.map((args) => args.map(String).join(' '));
    expect(allLogs.some((line) => line.includes('Warning: Global config is not applied to this project.'))).toBe(false);
  });

  it('effective no-op after prompts should warn when project files drift', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, confirm } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    setupDriftedProjectArtifacts(tempDir);
    select.mockResolvedValueOnce('delivery');
    select.mockResolvedValueOnce('both');

    await runConfigCommand(['profile']);

    expect(consoleLogSpy).toHaveBeenCalledWith('No config changes.');
    expect(confirm).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Global config is not applied to this project.'));
  });

  it('keep action should warn when project has extra workflows beyond global config', async () => {
    const { saveGlobalConfig } = await import('../../src/core/global-config.js');
    const { select } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    setupSyncedCoreBothArtifacts(tempDir);
    addExtraVerifyWorkflowArtifacts(tempDir);
    select.mockResolvedValueOnce('keep');

    await runConfigCommand(['profile']);

    expect(consoleLogSpy).toHaveBeenCalledWith('No config changes.');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Global config is not applied to this project.'));
  });

  it('changed config should save and ask apply when inside project', async () => {
    const { saveGlobalConfig, getGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, confirm } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    fs.mkdirSync(path.join(tempDir, 'rasen'), { recursive: true });

    select.mockResolvedValueOnce('delivery');
    select.mockResolvedValueOnce('skills');
    confirm.mockResolvedValueOnce(false);

    await runConfigCommand(['profile']);

    expect(getGlobalConfig().delivery).toBe('skills');
    expect(confirm).toHaveBeenCalledWith({
      message: 'Apply changes to this project now?',
      default: true,
    });
  });

  it('confirmed project apply should run rasen update in the project', async () => {
    const { saveGlobalConfig, getGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, confirm } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both', workflows: ['propose', 'explore', 'apply', 'sync', 'archive'] });
    fs.mkdirSync(path.join(tempDir, 'rasen'), { recursive: true });

    select.mockResolvedValueOnce('delivery');
    select.mockResolvedValueOnce('skills');
    confirm.mockResolvedValueOnce(true);

    await runConfigCommand(['profile']);

    expect(getGlobalConfig().delivery).toBe('skills');
    // The apply path re-invokes the currently-running CLI binary (not `npx
    // openspec`) so a stale/broken local install cannot break the update.
    expect(execSync).toHaveBeenCalledWith(`"${process.execPath}" "${process.argv[1]}" update`, {
      stdio: 'inherit',
      cwd: fs.realpathSync(tempDir),
    });
  });

  it('core preset should preserve delivery setting', async () => {
    const { saveGlobalConfig, getGlobalConfig } = await import('../../src/core/global-config.js');
    const { select, checkbox, confirm } = await getPromptMocks();

    saveGlobalConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills', workflows: ['explore'] });

    await runConfigCommand(['profile', 'core']);

    const config = getGlobalConfig();
    expect(config.profile).toBe('core');
    expect(config.delivery).toBe('skills');
    // `profile use core` is an explicit expert-aware write path (design.md
    // D4): the core preset now names the quality-floor experts too.
    expect(config.workflows).toEqual([
      'propose', 'explore', 'apply', 'sync', 'archive', 'auto-command', 'help',
      'review', 'cso', 'qa', 'qa-only', 'benchmark', 'design-review',
    ]);
    expect(config.expertSelectionExplicit).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(checkbox).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Ctrl+C should cancel without stack trace and set interrupted exit code', async () => {
    const { select, checkbox, confirm } = await getPromptMocks();
    const cancellationError = new Error('User force closed the prompt with SIGINT');
    cancellationError.name = 'ExitPromptError';

    select.mockRejectedValueOnce(cancellationError);

    await expect(runConfigCommand(['profile'])).resolves.toBeUndefined();

    expect(consoleLogSpy).toHaveBeenCalledWith('Config profile cancelled.');
    expect(process.exitCode).toBe(130);
    expect(checkbox).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
