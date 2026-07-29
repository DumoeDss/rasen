import { describe, expect, it, vi } from 'vitest';

import { createProgram } from '../src/cli/index.js';
import type { ResolvedPositionalDefinition } from '../src/index.js';
import { getLocaleCatalog } from '../src/locales/index.js';
import type { CliLocale } from '../src/utils/locale.js';

const facts = {
  availableToolIds: ['claude', 'codex'],
  defaultSchema: 'spec-driven',
  workspaceDir: 'rasen',
} as const;
const exportedPositionalType: ResolvedPositionalDefinition = {
  name: 'bundle',
  type: 'path',
  description: 'Bundle path',
};

function help(locale: CliLocale, commandName?: string): string {
  const program = createProgram({ locale, facts });
  if (!commandName) {
    return program.helpInformation();
  }
  const command = program.commands.find((candidate) => candidate.name() === commandName);
  expect(command).toBeDefined();
  return command?.helpInformation() ?? '';
}

describe('localized Commander program factory', () => {
  it('exports the resolved positional presentation type', () => {
    expect(exportedPositionalType.description).toBe('Bundle path');
  });

  it('renders root and nested help in every supported locale', () => {
    const expectations = {
      en: ['Usage:', 'Commands:'],
      ja: ['使用法:', 'コマンド:'],
      'zh-cn': ['用法：', '命令：'],
    } as const;

    for (const [locale, fragments] of Object.entries(expectations)) {
      const rootHelp = help(locale as CliLocale);
      const storeHelp = help(locale as CliLocale, 'store');
      expect(rootHelp, locale).toContain(fragments[0]);
      expect(rootHelp, locale).toContain(fragments[1]);
      expect(storeHelp, locale).toContain(
        getLocaleCatalog(locale as CliLocale).cli.root.commands.store.description,
      );
    }
  });

  it('returns independent program instances with isolated locales', () => {
    const japanese = createProgram({ locale: 'ja', facts });
    const english = createProgram({ locale: 'en', facts });

    expect(japanese).not.toBe(english);
    expect(japanese.helpInformation()).toContain('仕様駆動開発');
    expect(english.helpInformation()).toContain(
      'AI-native system for spec-driven development',
    );
    expect(japanese.helpInformation()).not.toContain(
      'AI-native system for spec-driven development',
    );
  });

  it('applies canonical aliases and generated help/version copy', () => {
    const japanese = createProgram({ locale: 'ja', facts });
    const store = japanese.commands.find((command) => command.name() === 'store');
    const list = store?.commands.find((command) => command.name() === 'list');
    const versionOption = japanese.options.find(
      (option) => option.long === '--version',
    );

    expect(list?.aliases()).toEqual(['ls']);
    expect(store?.helpInformation()).toContain('list|ls');
    expect(japanese.helpInformation()).toMatch(
      /-h, --help\s+コマンドのヘルプを表示します/u,
    );
    expect(versionOption?.description).toBe('バージョン番号を表示します');
  });

  it('does not append Commander-owned English metadata to localized option copy', () => {
    const japanese = createProgram({ locale: 'ja', facts });
    const list = japanese.commands.find((command) => command.name() === 'list');

    expect(list?.helpInformation()).not.toContain('(default:');
  });

  it('renders runtime facts around unchanged machine tokens', () => {
    const japanese = createProgram({
      locale: 'ja',
      facts: {
        availableToolIds: ['claude', 'codex'],
        defaultSchema: 'custom-schema',
        workspaceDir: 'custom-workspace',
      },
    });
    const init = japanese.commands.find((command) => command.name() === 'init');
    const templates = japanese.commands.find(
      (command) => command.name() === 'templates',
    );
    const store = japanese.commands.find((command) => command.name() === 'store');
    const setup = store?.commands.find((command) => command.name() === 'setup');

    expect(init?.helpInformation()).toContain('claude, codex');
    expect(templates?.helpInformation()).toContain('custom-schema');
    expect(setup?.helpInformation()).toContain('~/custom-workspace/<id>');
  });

  it('reuses the program presentation snapshot for completion actions', async () => {
    const originalLanguage = process.env.RASEN_LANG;
    const originalTelemetry = process.env.RASEN_TELEMETRY;
    process.env.RASEN_LANG = 'en';
    process.env.RASEN_TELEMETRY = '0';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const program = createProgram({
        locale: 'ja',
        facts: {
          availableToolIds: ['custom-tool'],
          defaultSchema: 'custom-schema',
          workspaceDir: 'custom-workspace',
        },
      });
      await program.parseAsync([
        'node',
        'rasen',
        'completion',
        'generate',
        'fish',
      ]);
      const script = log.mock.calls
        .flat()
        .map(String)
        .find((message) => message.includes('# Fish completion script'));

      expect(script).toContain('プロジェクトでRasenを初期化します');
      expect(script).toContain('custom-tool');
      expect(script).not.toContain('Initialize Rasen in your project');
    } finally {
      log.mockRestore();
      if (originalLanguage === undefined) delete process.env.RASEN_LANG;
      else process.env.RASEN_LANG = originalLanguage;
      if (originalTelemetry === undefined) delete process.env.RASEN_TELEMETRY;
      else process.env.RASEN_TELEMETRY = originalTelemetry;
    }
  });

  it('preserves the knowledge bundle positional help description', () => {
    const program = createProgram({ locale: 'en', facts });
    const knowledge = program.commands.find((command) => command.name() === 'knowledge');
    const bundle = knowledge?.commands.find((command) => command.name() === 'bundle');
    const importCommand = bundle?.commands.find((command) => command.name() === 'import');

    expect(importCommand?.helpInformation()).toContain('Arguments:');
    expect(importCommand?.helpInformation()).toContain(
      'Portable bundle file to validate and import',
    );
  });

  it('preserves direct help for the hidden experimental compatibility command', () => {
    const program = createProgram({ locale: 'ja', facts });
    const experimental = program.commands.find(
      (command) => command.name() === 'experimental',
    );
    const output = experimental?.helpInformation();

    expect(output).toContain('使用法:');
    expect(output).toContain('init のエイリアスです（非推奨）');
    expect(output).toContain('対象AIツール（--toolsに対応）');
    expect(output).toContain('対話プロンプトを無効にします');
  });
});
