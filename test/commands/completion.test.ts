import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CompletionCommand } from '../../src/commands/completion.js';
import * as shellDetection from '../../src/utils/shell-detection.js';

// Mock the shell detection module
vi.mock('../../src/utils/shell-detection.js', () => ({
  detectShell: vi.fn(),
}));

// Mock the ZshInstaller
vi.mock('../../src/core/completions/installers/zsh-installer.js', () => ({
  ZshInstaller: vi.fn().mockImplementation(() => ({
    install: vi.fn().mockResolvedValue({
      success: true,
      installedPath: '/home/user/.oh-my-zsh/completions/_rasen',
      isOhMyZsh: true,
      message: 'Completion script installed successfully for Oh My Zsh',
      messageDescriptor: { key: 'installedForOhMyZsh' },
      instructions: [
        'Completion script installed to Oh My Zsh completions directory.',
        'Restart your shell or run: exec zsh',
        'Completions should activate automatically.',
      ],
      instructionDescriptors: [
        { key: 'installedOhMyZshDirectory' },
        { key: 'restartZsh' },
        { key: 'completionsActivateAutomatically' },
      ],
    }),
    uninstall: vi.fn().mockResolvedValue({
      success: true,
      message: 'Completion script removed from /home/user/.oh-my-zsh/completions/_rasen',
      messageDescriptor: {
        key: 'removedFrom',
        values: { path: '/home/user/.oh-my-zsh/completions/_rasen' },
      },
    }),
  })),
}));

describe('CompletionCommand', () => {
  let command: CompletionCommand;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let tempDir: string;
  let originalRasenHome: string | undefined;
  let originalRasenLang: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-completion-command-'));
    originalRasenHome = process.env.RASEN_HOME;
    originalRasenLang = process.env.RASEN_LANG;
    process.env.RASEN_HOME = tempDir;
    process.env.RASEN_LANG = 'en';
    command = new CompletionCommand();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    if (originalRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalRasenHome;
    if (originalRasenLang === undefined) delete process.env.RASEN_LANG;
    else process.env.RASEN_LANG = originalRasenLang;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generate subcommand', () => {
    it('should generate Zsh completion script to stdout', async () => {
      await command.generate({ shell: 'zsh' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('#compdef rasen');
      expect(output).toContain('_rasen() {');
    });

    it('should auto-detect Zsh shell when no shell specified', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: 'zsh', detected: 'zsh' });

      await command.generate({});

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('#compdef rasen');
    });

    it('should generate Japanese command descriptions', async () => {
      process.env.RASEN_LANG = 'ja';

      await command.generate({ shell: 'zsh' });

      const output = String(consoleLogSpy.mock.calls[0][0]);
      expect(output).toContain('プロジェクトでRasenを初期化します');
    });

    it('should generate Simplified Chinese command descriptions', async () => {
      process.env.RASEN_LANG = 'zh-cn';

      await command.generate({ shell: 'zsh' });

      const output = String(consoleLogSpy.mock.calls[0][0]);
      expect(output).toContain('在项目中初始化 Rasen');
      expect(output).not.toContain('Initialize Rasen in your project');
    });

    it('should show error when shell cannot be auto-detected', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: undefined });

      await command.generate({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error: Could not auto-detect shell. Please specify shell explicitly.'
      );
      expect(process.exitCode).toBe(1);
    });

    it('should localize shell detection errors in Japanese', async () => {
      process.env.RASEN_LANG = 'ja';
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: undefined });

      await command.generate({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'エラー: シェルを自動検出できません。シェルを明示的に指定してください。'
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '対応済み: zsh, bash, fish, powershell'
      );
      expect(process.exitCode).toBe(1);
    });

    it('should localize shell detection errors in Simplified Chinese', async () => {
      process.env.RASEN_LANG = 'zh-cn';
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: undefined });

      await command.generate({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '错误：无法自动检测 shell。请显式指定 shell。'
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '当前支持：zsh, bash, fish, powershell'
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Could not auto-detect shell')
      );
      expect(process.exitCode).toBe(1);
    });

    it('should show error for unsupported shell', async () => {
      await command.generate({ shell: 'tcsh' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Shell 'tcsh' is not supported yet. Currently supported: zsh, bash, fish, powershell"
      );
      expect(process.exitCode).toBe(1);
    });

    it('should handle shell parameter case-insensitively', async () => {
      await command.generate({ shell: 'ZSH' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('#compdef rasen');
    });
  });

  describe('install subcommand', () => {
    it('should install Zsh completion script', async () => {
      await command.install({ shell: 'zsh' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completion script installed successfully')
      );
      expect(process.exitCode).toBe(0);
    });

    it('should show verbose output when --verbose flag is provided', async () => {
      await command.install({ shell: 'zsh', verbose: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Installed to:')
      );
    });

    it('should auto-detect Zsh shell when no shell specified', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: 'zsh', detected: 'zsh' });

      await command.install({});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completion script installed successfully')
      );
    });

    it('should show error when shell cannot be auto-detected', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: undefined });

      await command.install({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error: Could not auto-detect shell. Please specify shell explicitly.'
      );
      expect(process.exitCode).toBe(1);
    });

    it('should show error for unsupported shell', async () => {
      await command.install({ shell: 'tcsh' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Shell 'tcsh' is not supported yet. Currently supported: zsh, bash, fish, powershell"
      );
      expect(process.exitCode).toBe(1);
    });

    it('should display installation instructions', async () => {
      await command.install({ shell: 'zsh' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restart your shell or run: exec zsh')
      );
    });

    it('should localize installation results and instructions in Japanese', async () => {
      process.env.RASEN_LANG = 'ja';

      await command.install({ shell: 'zsh', verbose: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Oh My Zsh用の補完スクリプトをインストールしました')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('インストール先:')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'シェルを再起動するか、`exec zsh` を実行してください。'
      );
    });

    it('should localize installation results and instructions in Simplified Chinese', async () => {
      process.env.RASEN_LANG = 'zh-cn';

      await command.install({ shell: 'zsh', verbose: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('已成功安装 Oh My Zsh 补全脚本')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('已安装到：/home/user/.oh-my-zsh/completions/_rasen')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('请重启 shell 或运行：exec zsh');
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Restart your shell')
      );
    });
  });

  describe('uninstall subcommand', () => {
    it('should uninstall Zsh completion script', async () => {
      await command.uninstall({ shell: 'zsh', yes: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completion script removed')
      );
      expect(process.exitCode).toBe(0);
    });

    it('should auto-detect Zsh shell when no shell specified', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: 'zsh', detected: 'zsh' });

      await command.uninstall({ yes: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completion script removed')
      );
    });

    it('should show error when shell cannot be auto-detected', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: undefined });

      await command.uninstall({ yes: true });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error: Could not auto-detect shell. Please specify shell explicitly.'
      );
      expect(process.exitCode).toBe(1);
    });

    it('should show error for unsupported shell', async () => {
      await command.uninstall({ shell: 'tcsh', yes: true });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Shell 'tcsh' is not supported yet. Currently supported: zsh, bash, fish, powershell"
      );
      expect(process.exitCode).toBe(1);
    });

    it('should localize uninstallation results in Japanese', async () => {
      process.env.RASEN_LANG = 'ja';

      await command.uninstall({ shell: 'zsh', yes: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('/home/user/.oh-my-zsh/completions/_rasenから補完スクリプトを削除しました')
      );
    });

    it('should localize uninstallation results in Simplified Chinese', async () => {
      process.env.RASEN_LANG = 'zh-cn';

      await command.uninstall({ shell: 'zsh', yes: true });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('已从 /home/user/.oh-my-zsh/completions/_rasen 移除补全脚本')
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Completion script removed')
      );
    });
  });

  describe('error handling', () => {
    it('should handle installation failures gracefully', async () => {
      const { ZshInstaller } = await import('../../src/core/completions/installers/zsh-installer.js');
      vi.mocked(ZshInstaller).mockImplementationOnce(() => ({
        install: vi.fn().mockResolvedValue({
          success: false,
          isOhMyZsh: false,
          message: 'Permission denied',
        }),
        uninstall: vi.fn(),
        isInstalled: vi.fn(),
        getInstallationInfo: vi.fn(),
        isOhMyZshInstalled: vi.fn(),
        getInstallationPath: vi.fn(),
        backupExistingFile: vi.fn(),
      } as any));

      const cmd = new CompletionCommand();
      await cmd.install({ shell: 'zsh' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Permission denied')
      );
      expect(process.exitCode).toBe(1);
    });

    it('should handle uninstallation failures gracefully', async () => {
      const { ZshInstaller } = await import('../../src/core/completions/installers/zsh-installer.js');
      vi.mocked(ZshInstaller).mockImplementationOnce(() => ({
        install: vi.fn(),
        uninstall: vi.fn().mockResolvedValue({
          success: false,
          message: 'Completion script is not installed',
        }),
        isInstalled: vi.fn(),
        getInstallationInfo: vi.fn(),
        isOhMyZshInstalled: vi.fn(),
        getInstallationPath: vi.fn(),
        backupExistingFile: vi.fn(),
      } as any));

      const cmd = new CompletionCommand();
      await cmd.uninstall({ shell: 'zsh', yes: true });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completion script is not installed')
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('dynamic completion data', () => {
    it('should output schema names for shell completion', async () => {
      await command.complete({ type: 'schemas' });

      expect(consoleLogSpy).toHaveBeenCalledWith('spec-driven\tschema');
      expect(process.exitCode).toBe(0);
    });

    it('should output built-in profile names for shell completion', async () => {
      await command.complete({ type: 'profiles' });

      expect(consoleLogSpy).toHaveBeenCalledWith('full\tbuilt-in profile');
      expect(consoleLogSpy).toHaveBeenCalledWith('core\tbuilt-in profile');
      expect(process.exitCode).toBe(0);
    });

    it('should localize dynamic completion descriptions', async () => {
      process.env.RASEN_LANG = 'ja';

      await command.complete({ type: 'profiles' });

      expect(consoleLogSpy).toHaveBeenCalledWith('full\t組み込みプロファイル');
      expect(consoleLogSpy).toHaveBeenCalledWith('core\t組み込みプロファイル');
    });

    it('should localize dynamic completion descriptions in Simplified Chinese', async () => {
      process.env.RASEN_LANG = 'zh-cn';

      await command.complete({ type: 'profiles' });

      expect(consoleLogSpy).toHaveBeenCalledWith('full\t内置 配置方案');
      expect(consoleLogSpy).toHaveBeenCalledWith('core\t内置 配置方案');
    });

    it('reports legacy delivery migration in Simplified Chinese from the completion command-owned read', async () => {
      process.env.RASEN_LANG = 'zh-cn';
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ featureFlags: {}, language: 'zh-cn', delivery: 'commands-first' }),
        'utf-8'
      );

      await command.complete({ type: 'profiles' });

      const diagnostics = consoleErrorSpy.mock.calls.map(([value]: [unknown]) => String(value)).join('\n');
      expect(diagnostics).toContain("交付模式 'commands-first' 已合并为 'both'");
      expect(diagnostics).not.toContain('Note: delivery mode');
      expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).delivery).toBe('both');
    });
  });

  describe('shell detection integration', () => {
    it('should show appropriate error when detected shell is unsupported', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: 'tcsh' });

      await command.generate({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Shell 'tcsh' is not supported yet. Currently supported: zsh, bash, fish, powershell"
      );
      expect(process.exitCode).toBe(1);
    });

    it('should respect explicit shell parameter over auto-detection', async () => {
      vi.mocked(shellDetection.detectShell).mockReturnValue({ shell: undefined, detected: 'bash' });

      await command.generate({ shell: 'zsh' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('#compdef rasen');
    });
  });
});
