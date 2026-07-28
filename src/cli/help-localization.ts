import type { Command, Option } from 'commander';

import { COMMAND_REGISTRY } from '../core/completions/command-registry.js';
import {
  localizeCommandRegistry,
  localizeDescription,
} from '../core/completions/description-localization.js';
import { getCliLocale } from '../core/cli-locale.js';
import type { CommandDefinition } from '../core/completions/types.js';
import { getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

export const ROOT_OPTION_DESCRIPTIONS = ['Disable color output'] as const;

function optionName(option: Option): string | undefined {
  return option.long?.replace(/^--/, '');
}

function localizeCommand(
  command: Command,
  definition: CommandDefinition | undefined,
  childDefinitions: readonly CommandDefinition[],
  locale: CliLocale
): void {
  command.description(localizeDescription(command.description(), locale));

  for (const option of command.options) {
    const name = optionName(option);
    const flagDefinition = name
      ? definition?.flags.find((flag) => flag.name === name)
      : undefined;
    const localizedActual = localizeDescription(option.description, locale);
    option.description =
      locale === 'en' || localizedActual !== option.description
        ? localizedActual
        : (flagDefinition?.description ?? option.description);
  }

  if (locale !== 'en') {
    const help = getLocaleCatalog(locale).help;
    const titles = help.titles as Record<string, string>;
    command.helpOption('-h, --help', help.helpOption);
    command.configureHelp({
      styleTitle: (title: string) => titles[title] ?? title,
    });
    if (command.commands.length > 0) {
      command.helpCommand('help [command]', help.helpCommand);
    }
  }

  for (const child of command.commands) {
    const childDefinition = childDefinitions.find((entry) => entry.name === child.name());
    if (childDefinition) {
      child.description(childDefinition.description);
    }
    localizeCommand(
      child,
      childDefinition,
      childDefinition?.subcommands ?? [],
      locale
    );
  }
}

export function localizeProgramHelp(
  program: Command,
  locale: CliLocale = getCliLocale()
): void {
  const definitions = localizeCommandRegistry(COMMAND_REGISTRY, locale);
  localizeCommand(program, undefined, definitions, locale);
}
