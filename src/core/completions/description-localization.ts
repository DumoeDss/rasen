import type { CommandDefinition } from './types.js';
import { formatLocaleMessage, getLocaleCatalog } from '../../locales/index.js';
import type { CliLocale } from '../../utils/locale.js';

export function localizeDescription(description: string, locale: CliLocale): string {
  const catalog = getLocaleCatalog(locale);
  const descriptions = catalog.commandDescriptions as Record<string, string>;
  const localized = descriptions[description];
  if (localized) return localized;

  const sourceTemplate = getLocaleCatalog('en').commandDescriptionTemplates.toolsPrefix;
  const placeholder = '{ids}';
  const placeholderIndex = sourceTemplate.indexOf(placeholder);
  const sourcePrefix = sourceTemplate.slice(0, placeholderIndex);
  if (placeholderIndex >= 0 && description.startsWith(sourcePrefix)) {
    return formatLocaleMessage(catalog.commandDescriptionTemplates.toolsPrefix, {
      ids: description.slice(sourcePrefix.length),
    });
  }

  return description;
}

export function localizeCommandRegistry(
  definitions: readonly CommandDefinition[],
  locale: CliLocale
): CommandDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    description: localizeDescription(definition.description, locale),
    flags: definition.flags.map((flag) => ({
      ...flag,
      description: localizeDescription(flag.description, locale),
    })),
    subcommands: definition.subcommands
      ? localizeCommandRegistry(definition.subcommands, locale)
      : undefined,
  }));
}

export function hasLocalizedDescription(
  description: string,
  locale: CliLocale
): boolean {
  const descriptions = getLocaleCatalog(locale).commandDescriptions as Record<string, string>;
  return descriptions[description] !== undefined;
}
