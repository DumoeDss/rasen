import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { applyCliPresentation } from '../../../src/cli/commander-presentation.js';
import { COMMAND_REGISTRY } from '../../../src/core/completions/command-registry.js';
import { resolveCliPresentation } from '../../../src/core/completions/cli-presentation.js';
import {
  CliPresentationError,
  type CommandDefinition,
  type ResolvedCliPresentation,
} from '../../../src/core/completions/types.js';
import { getLocaleCatalog } from '../../../src/locales/index.js';
import { SUPPORTED_CLI_LOCALES } from '../../../src/utils/locale.js';

const facts = {
  availableToolIds: ['claude', 'codex'],
  defaultSchema: 'custom-schema',
  workspaceDir: 'custom-workspace',
} as const;

interface MutableDescription {
  description?: string;
}

function initTools(locale: 'en' | 'ja' | 'zh-cn'): MutableDescription {
  return getLocaleCatalog(locale).cli.root.commands.init.options.tools;
}

function expectPresentationError(
  action: () => unknown,
  code: CliPresentationError['code'],
  semanticPath: string,
): void {
  expect(action).toThrowError(
    expect.objectContaining({
      name: 'CliPresentationError',
      code,
      semanticPath,
    }),
  );
}

describe.sequential('CLI presentation resolution', () => {
  const restorations: (() => void)[] = [];

  afterEach(() => {
    while (restorations.length > 0) {
      restorations.pop()?.();
    }
  });

  it('resolves complete immutable presentations in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const presentation = resolveCliPresentation({ locale, facts });
      expect(presentation.root.description).not.toBe('');
      expect(presentation.root.subcommands?.length).toBeGreaterThan(0);
      expect(Object.isFrozen(presentation)).toBe(true);
      expect(Object.isFrozen(presentation.root)).toBe(true);
    }
  });

  it('resolves complete localized copy for the archive plan and intent flags', () => {
    const expectedEnglish = {
      'save-plan': 'Save the exact previewed archive plan and output an opaque apply token',
      'apply-plan': 'Apply or resume the exact saved archive plan without replanning',
      'intent-template':
        'Output a complete archive intent template as JSON without changing files',
      'intent-file':
        'Read a complete, strictly validated archive intent from the specified file',
    };

    for (const locale of SUPPORTED_CLI_LOCALES) {
      const archive = resolveCliPresentation({ locale, facts }).root.subcommands
        ?.find((command) => command.name === 'archive');
      const descriptions = Object.fromEntries(
        (archive?.flags ?? [])
          .filter((flag) => Object.hasOwn(expectedEnglish, flag.name))
          .map((flag) => [flag.name, flag.description]),
      );

      expect(Object.keys(descriptions).sort()).toEqual(Object.keys(expectedEnglish).sort());
      expect(Object.values(descriptions).every((description) => description.length > 0)).toBe(true);
      if (locale === 'en') {
        expect(descriptions).toEqual(expectedEnglish);
      } else {
        expect(descriptions).not.toEqual(expectedEnglish);
      }
    }
  });

  it('interpolates typed facts without changing machine values', () => {
    const presentation = resolveCliPresentation({ locale: 'ja', facts });
    const commands = presentation.root.subcommands ?? [];
    const init = commands.find((command) => command.name === 'init');
    const templates = commands.find((command) => command.name === 'templates');
    const store = commands.find((command) => command.name === 'store');

    expect(
      init?.flags.find((flag) => flag.name === 'tools')?.description,
    ).toContain('claude, codex');
    expect(
      templates?.flags.find((flag) => flag.name === 'schema')?.description,
    ).toContain('custom-schema');
    expect(
      store?.subcommands
        ?.find((command) => command.name === 'setup')
        ?.flags.find((flag) => flag.name === 'path')?.description,
    ).toContain('~/custom-workspace/<id>');
    expect(init?.name).toBe('init');
    expect(init?.flags.find((flag) => flag.name === 'tools')?.name).toBe('tools');
  });

  it('falls back to English when selected-locale copy is unavailable', () => {
    const target = initTools('ja');
    const original = target.description;
    delete target.description;
    restorations.push(() => {
      target.description = original;
    });

    const presentation = resolveCliPresentation({ locale: 'ja', facts });
    const description = presentation.root.subcommands
      ?.find((command) => command.name === 'init')
      ?.flags.find((flag) => flag.name === 'tools')?.description;
    expect(description).toBe(
      'Configure AI tools non-interactively. Use "all", "none", or a comma-separated list of: claude, codex',
    );
  });

  it('rejects missing and empty English baseline copy', () => {
    const target = initTools('en');
    const original = target.description;
    delete target.description;
    restorations.push(() => {
      target.description = original;
    });
    expectPresentationError(
      () => resolveCliPresentation({ locale: 'en', facts }),
      'missing-english-copy',
      'cli.root.commands.init.options.tools.description',
    );

    target.description = '';
    expectPresentationError(
      () => resolveCliPresentation({ locale: 'en', facts }),
      'empty-copy',
      'cli.root.commands.init.options.tools.description',
    );
  });

  it('rejects a missing required English chrome slot', () => {
    const chrome = getLocaleCatalog('en').cli.chrome as {
      helpOption?: string;
    };
    const original = chrome.helpOption;
    delete chrome.helpOption;
    restorations.push(() => {
      chrome.helpOption = original;
    });

    expectPresentationError(
      () => resolveCliPresentation({ locale: 'en', facts }),
      'missing-english-copy',
      'cli.chrome.helpOption',
    );
  });

  it('rejects placeholder mismatch and unresolved placeholders', () => {
    const target = initTools('ja');
    const original = target.description;
    restorations.push(() => {
      target.description = original;
    });

    target.description = 'ツール: {tools}';
    expectPresentationError(
      () => resolveCliPresentation({ locale: 'ja', facts }),
      'placeholder-mismatch',
      'cli.root.commands.init.options.tools.description',
    );

    target.description = 'ツール: {{ids}}';
    expectPresentationError(
      () =>
        resolveCliPresentation({
          locale: 'ja',
          facts: { ...facts, availableToolIds: ['claude'] },
        }),
      'unresolved-placeholder',
      'cli.root.commands.init.options.tools.description',
    );
  });

  it('rejects missing runtime facts', () => {
    expectPresentationError(
      () =>
        resolveCliPresentation({
          locale: 'en',
          facts: { ...facts, availableToolIds: [] },
        }),
      'missing-runtime-fact',
      'cli.root.commands.init.options.tools.description',
    );
  });

  it('rejects duplicate identities and alias collisions', () => {
    const rootFlags = COMMAND_REGISTRY.flags as CommandDefinition['flags'] & {
      push(flag: CommandDefinition['flags'][number]): void;
      pop(): CommandDefinition['flags'][number] | undefined;
    };
    rootFlags.push(rootFlags[0]);
    restorations.push(() => {
      rootFlags.pop();
    });
    expectPresentationError(
      () => resolveCliPresentation({ locale: 'en', facts }),
      'duplicate-option',
      'cli.root.options.no-color',
    );
    rootFlags.pop();
    restorations.pop();

    const commands = COMMAND_REGISTRY.subcommands as CommandDefinition[];
    commands.push(commands[0]);
    restorations.push(() => {
      commands.pop();
    });
    expectPresentationError(
      () => resolveCliPresentation({ locale: 'en', facts }),
      'duplicate-command',
      'cli.root.commands.init',
    );
    commands.pop();
    restorations.pop();

    const init = commands[0];
    const aliases = init.aliases;
    init.aliases = ['update'];
    restorations.push(() => {
      init.aliases = aliases;
    });
    expectPresentationError(
      () => resolveCliPresentation({ locale: 'en', facts }),
      'alias-collision',
      'cli.root.commands.init.aliases.update',
    );
  });

  it('preflights Commander structure before applying any copy', () => {
    const presentation = resolveCliPresentation({ locale: 'en', facts });
    const program = new Command()
      .name('rasen')
      .description('')
      .version('1.0.0', '-V, --version', '')
      .option('--no-color', '');
    program.command('unexpected').description('');

    expectPresentationError(
      () => applyCliPresentation(program, presentation),
      'commander-structure-mismatch',
      'cli.root',
    );
    expect(program.description()).toBe('');
    expect(program.options.find((option) => option.long === '--no-color')?.description).toBe('');
  });

  it('checks the generated version option before applying any copy', () => {
    const resolved = resolveCliPresentation({ locale: 'en', facts });
    const presentation: ResolvedCliPresentation = {
      chrome: resolved.chrome,
      root: {
        name: 'rasen',
        description: 'Resolved root',
        flags: [{ name: 'no-color', description: 'Resolved option' }],
      },
      compatibilityCommands: [],
      completionCommands: [],
    };
    const program = new Command()
      .name('rasen')
      .description('')
      .option('--no-color', '');

    expectPresentationError(
      () => applyCliPresentation(program, presentation),
      'commander-structure-mismatch',
      'cli.chrome.versionOption',
    );
    expect(program.description()).toBe('');
    expect(program.options[0].description).toBe('');
  });
});
