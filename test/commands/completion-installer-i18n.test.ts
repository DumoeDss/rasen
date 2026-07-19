import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CompletionCommand } from '../../src/commands/completion.js';
import { formatInstallerMessage } from '../../src/commands/completion-messages.js';
import { BashInstaller } from '../../src/core/completions/installers/bash-installer.js';
import { FishInstaller } from '../../src/core/completions/installers/fish-installer.js';
import { PowerShellInstaller } from '../../src/core/completions/installers/powershell-installer.js';
import { ZshInstaller } from '../../src/core/completions/installers/zsh-installer.js';
import {
  CompletionFactory,
  type CompletionInstaller,
  type InstallationResult,
} from '../../src/core/completions/factory.js';
import type { SupportedShell } from '../../src/utils/shell-detection.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';

const BUILT_IN_SHELLS = ['bash', 'fish', 'powershell', 'zsh'] as const;

function createInstaller(shell: SupportedShell, homeDir: string): CompletionInstaller {
  switch (shell) {
    case 'bash':
      return new BashInstaller(homeDir);
    case 'fish':
      return new FishInstaller(homeDir);
    case 'powershell':
      return new PowerShellInstaller(homeDir);
    case 'zsh':
      return new ZshInstaller(homeDir);
  }
}

function getInstallBlockingPath(shell: SupportedShell, homeDir: string): string {
  switch (shell) {
    case 'bash':
      return path.join(homeDir, '.local');
    case 'fish':
    case 'powershell':
      return process.platform === 'win32' && shell === 'powershell'
        ? path.join(homeDir, 'Documents')
        : path.join(homeDir, '.config');
    case 'zsh':
      return path.join(homeDir, '.zsh');
  }
}

function renderInstructions(result: InstallationResult): string[] {
  return (result.instructions ?? []).map((line, index) =>
    formatInstallerMessage(result.instructionDescriptors?.[index] ?? undefined, line, 'ja')
  );
}

function renderWarnings(result: InstallationResult): string[] {
  return (result.warnings ?? []).map((line, index) =>
    formatInstallerMessage(result.warningDescriptors?.[index] ?? undefined, line, 'ja')
  );
}

function expectAllProseStructured(result: InstallationResult): void {
  expect(result.instructionDescriptors).toHaveLength(result.instructions?.length ?? 0);
  for (const [index, line] of (result.instructions ?? []).entries()) {
    if (line !== '' && !line.startsWith('  ')) {
      expect(result.instructionDescriptors?.[index], line).not.toBeNull();
    }
  }
}

describe('completion installer structured localization', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-completion-i18n-'));
    originalEnv = { ...process.env };
    process.env.RASEN_NO_AUTO_CONFIG = '1';
    delete process.env.ZSH;
    delete process.env.PROFILE;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exitCode = 0;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('localizes Bash manual setup and package guidance while preserving shell code', async () => {
    const installer = new BashInstaller(tempDir);
    vi.spyOn(installer, 'isBashCompletionInstalled').mockResolvedValue(false);

    const result = await installer.install('# bash completion');
    const rendered = renderInstructions(result);
    const renderedWarnings = (result.warnings ?? []).map((line, index) =>
      formatInstallerMessage(result.warningDescriptors?.[index] ?? undefined, line, 'ja')
    );

    expectAllProseStructured(result);
    expect(result.warningDescriptors).toHaveLength(result.warnings?.length ?? 0);
    expect(rendered).toContain('補完を有効にするには、次の内容を~/.bashrcへ追加してください:');
    expect(rendered.some((line) => line.includes('if [ -d'))).toBe(true);
    expect(renderedWarnings).toContain('⚠️  警告: bash-completionパッケージが見つかりません');
    expect(renderedWarnings).toContain('  brew install bash-completion@2');
  });

  it('localizes Fish activation guidance', async () => {
    const result = await new FishInstaller(tempDir).install('# fish completion');
    const rendered = renderInstructions(result);

    expectAllProseStructured(result);
    expect(rendered).toEqual([
      'Fishは~/.config/fish/completions/から補完を自動的に読み込みます',
      '補完はすぐに利用でき、シェルの再起動は不要です。',
    ]);
  });

  it('localizes PowerShell manual setup while preserving profile commands', async () => {
    const installer = new PowerShellInstaller(tempDir);
    vi.spyOn(installer, 'configureProfile').mockResolvedValue(false);

    const result = await installer.install('# PowerShell completion');
    const rendered = renderInstructions(result);

    expectAllProseStructured(result);
    expect(rendered.some((line) => line.startsWith('補完を有効にするには'))).toBe(true);
    expect(rendered.some((line) => line.includes('Test-Path'))).toBe(true);
    expect(rendered).toContain('その後、PowerShellを再起動するか `. $PROFILE` を実行してください。');
  });

  it('localizes standard Zsh manual setup while preserving fpath commands', async () => {
    const result = await new ZshInstaller(tempDir).install('# zsh completion');
    const rendered = renderInstructions(result);

    expectAllProseStructured(result);
    expect(rendered).toContain('補完を有効にするには、次の内容を~/.zshrcへ追加してください:');
    expect(rendered.some((line) => line.includes('fpath=('))).toBe(true);
    expect(rendered).toContain('シェルを再起動するか、`exec zsh` を実行してください。');
  });

  it('localizes Oh My Zsh fpath verification guidance', async () => {
    fs.mkdirSync(path.join(tempDir, '.oh-my-zsh'), { recursive: true });

    const result = await new ZshInstaller(tempDir).install('# zsh completion');
    const rendered = renderInstructions(result);

    expectAllProseStructured(result);
    expect(rendered).toContain(
      '注: 通常、Oh My Zshはcustom/completionsから補完を自動的に読み込みます。'
    );
    expect(rendered.some((line) => line.includes('がfpathに含まれること'))).toBe(true);
    expect(rendered).toContain('  echo $fpath | grep "custom/completions"');
  });

  it('does not print English debug or warning output during first installs', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bash = new BashInstaller(path.join(tempDir, 'bash'));
    vi.spyOn(bash, 'isBashCompletionInstalled').mockResolvedValue(true);

    await bash.install('# bash completion');
    await new FishInstaller(path.join(tempDir, 'fish')).install('# fish completion');
    await new PowerShellInstaller(path.join(tempDir, 'powershell')).install('# ps completion');
    await new ZshInstaller(path.join(tempDir, 'zsh')).install('# zsh completion');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns localized Bash and Zsh auto-configuration diagnostics', async () => {
    delete process.env.RASEN_NO_AUTO_CONFIG;
    vi.spyOn(FileSystemUtils, 'updateFileWithMarkers').mockRejectedValue(
      new Error('test failure')
    );

    const bash = new BashInstaller(path.join(tempDir, 'bash-failure'));
    vi.spyOn(bash, 'isBashCompletionInstalled').mockResolvedValue(true);
    const bashResult = await bash.install('# bash completion');
    const zshResult = await new ZshInstaller(path.join(tempDir, 'zsh-failure')).install(
      '# zsh completion'
    );

    expect(renderWarnings(bashResult)).toContain(
      '警告: 補完用に.bashrcを設定できませんでした: test failure'
    );
    expect(renderWarnings(zshResult)).toContain(
      '警告: 補完用に.zshrcを設定できませんでした: test failure'
    );
    expect(renderWarnings(bashResult).join('\n')).not.toContain('Could not configure');
    expect(renderWarnings(zshResult).join('\n')).not.toContain('Could not configure');
  });

  it('returns a localized PowerShell profile diagnostic instead of printing English', async () => {
    const installer = new PowerShellInstaller(path.join(tempDir, 'powershell-failure'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(FileSystemUtils, 'canWriteFile').mockResolvedValue(false);
    const warnings: string[] = [];
    const descriptors: NonNullable<InstallationResult['warningDescriptors']> = [];

    await installer.configureProfile('completion.ps1', (message, descriptor) => {
      warnings.push(message);
      descriptors.push(descriptor);
    });
    const result: InstallationResult = {
      success: true,
      message: '',
      warnings,
      warningDescriptors: descriptors,
    };

    expect(warnSpy).not.toHaveBeenCalled();
    expect(renderWarnings(result)[0]).toMatch(/^警告: .*を設定できませんでした:/);
    expect(renderWarnings(result)[0]).not.toContain('Warning: Could not configure');
  });

  for (const shell of BUILT_IN_SHELLS) {
    it(`suppresses direct diagnostics and reports a localized ${shell} ENOTDIR install failure`, async () => {
      process.env.RASEN_LANG = 'ja';
      const homeDir = path.join(tempDir, `${shell}-command-install`);
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(getInstallBlockingPath(shell, homeDir), 'not a directory');
      const installer = createInstaller(shell, homeDir);
      vi.spyOn(CompletionFactory, 'createInstaller').mockReturnValue(installer);
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await new CompletionCommand().install({ shell });

      const errorOutput = errorSpy.mock.calls.flat().join('\n');
      expect(debugSpy).not.toHaveBeenCalled();
      expect(errorOutput).toContain('補完スクリプトのインストールに失敗しました');
      expect(errorOutput).not.toContain('Unable to determine write permissions');
      expect(errorOutput).not.toContain('Path component');
      expect(process.exitCode).toBe(1);
    });
  }

  it.skipIf(process.platform === 'win32')(
    'reports Fish and PowerShell read-only uninstall failures only through localized command results',
    async () => {
      process.env.RASEN_LANG = 'ja';
      const cases = [
        {
          shell: 'fish' as const,
          homeDir: path.join(tempDir, 'fish-command-uninstall'),
        },
        {
          shell: 'powershell' as const,
          homeDir: path.join(tempDir, 'powershell-command-uninstall'),
        },
      ];

      for (const { shell, homeDir } of cases) {
        const installer = createInstaller(shell, homeDir);
        const targetPath = shell === 'fish'
          ? (installer as FishInstaller).getInstallationPath()
          : (installer as PowerShellInstaller).getInstallationPath();
        const targetDir = path.dirname(targetPath);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, 'completion');
        fs.chmodSync(targetDir, 0o555);
        vi.spyOn(CompletionFactory, 'createInstaller').mockReturnValue(installer);
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
          await new CompletionCommand().uninstall({ shell, yes: true });

          const errorOutput = errorSpy.mock.calls.flat().join('\n');
          expect(debugSpy).not.toHaveBeenCalled();
          expect(errorOutput).toContain('補完スクリプトのアンインストールに失敗しました');
          expect(errorOutput).not.toContain('Unable to determine write permissions');
          expect(process.exitCode).toBe(1);
        } finally {
          fs.chmodSync(targetDir, 0o755);
          vi.restoreAllMocks();
          process.exitCode = 0;
        }
      }
    }
  );
});
