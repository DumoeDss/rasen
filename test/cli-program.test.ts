import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli/index.js';
import { getLocaleCatalog } from '../src/locales/index.js';
import type { CliLocale } from '../src/utils/locale.js';

const facts = {
  availableToolIds: ['claude', 'codex'],
  defaultSchema: 'spec-driven',
  workspaceDir: 'rasen',
} as const;

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
});
