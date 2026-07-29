import { getLocaleCatalog } from '../../locales/index.js';
import type { CliLocale } from '../../utils/locale.js';
import { DEFAULT_SCHEMA, WORKSPACE_DIR_NAME } from '../config.js';
import { getToolsWithSkillsDir } from '../shared/index.js';
import {
  COMMAND_REGISTRY,
  COMPATIBILITY_COMMAND_REGISTRY,
} from './command-registry.js';
import type {
  CliPresentationFacts,
  CommandDefinition,
  FlagDefinition,
  ResolvedCliChrome,
  ResolvedCliPresentation,
  ResolvedCommandDefinition,
  ResolvedFlagDefinition,
  ResolvedPositionalDefinition,
} from './types.js';
import { CliPresentationError } from './types.js';

interface CliCatalogNode {
  description?: string;
  options?: Record<string, CliCatalogNode>;
  positionals?: Record<string, CliCatalogNode>;
  commands?: Record<string, CliCatalogNode>;
}

interface CliCatalog {
  chrome: Record<keyof ResolvedCliChrome, string>;
  compatibilityCommands: Record<string, CliCatalogNode>;
  root: CliCatalogNode;
}

export interface ResolveCliPresentationOptions {
  locale: CliLocale;
  facts?: Partial<CliPresentationFacts>;
}

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;
const CLI_CHROME_KEY_MAP = {
  usageTitle: true,
  argumentsTitle: true,
  optionsTitle: true,
  globalOptionsTitle: true,
  commandsTitle: true,
  helpOption: true,
  helpCommand: true,
  versionOption: true,
} as const satisfies Record<keyof ResolvedCliChrome, true>;
const CLI_CHROME_KEYS = Object.keys(
  CLI_CHROME_KEY_MAP,
) as (keyof ResolvedCliChrome)[];

function semanticError(
  code: ConstructorParameters<typeof CliPresentationError>[0],
  semanticPath: string,
  message: string,
  placeholder?: string,
): never {
  throw new CliPresentationError(code, semanticPath, message, placeholder);
}

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => match[1])
    .sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveCopy(
  englishCopy: unknown,
  selectedCopy: unknown,
  semanticPath: string,
  facts: Readonly<Record<string, string>>,
): string {
  if (englishCopy === undefined) {
    semanticError('missing-english-copy', semanticPath, 'Missing English CLI presentation copy');
  }
  if (typeof englishCopy !== 'string' || englishCopy.trim().length === 0) {
    semanticError('empty-copy', semanticPath, 'English CLI presentation copy is empty');
  }

  const selected =
    typeof selectedCopy === 'string' && selectedCopy.trim().length > 0
      ? selectedCopy
      : englishCopy;
  const englishPlaceholders = placeholders(englishCopy);
  const selectedPlaceholders = placeholders(selected);
  if (!sameStrings(englishPlaceholders, selectedPlaceholders)) {
    semanticError(
      'placeholder-mismatch',
      semanticPath,
      `Localized placeholders do not match English (${selectedPlaceholders.join(', ')} != ${englishPlaceholders.join(', ')})`,
    );
  }

  const interpolated = selected.replace(
    PLACEHOLDER_PATTERN,
    (_placeholder, key: string): string => {
      const value = facts[key];
      if (value === undefined || value.length === 0) {
        semanticError(
          'missing-runtime-fact',
          semanticPath,
          `Missing CLI presentation runtime fact: ${key}`,
          key,
        );
      }
      return value;
    },
  );

  const unresolved = PLACEHOLDER_PATTERN.exec(interpolated);
  PLACEHOLDER_PATTERN.lastIndex = 0;
  if (unresolved) {
    semanticError(
      'unresolved-placeholder',
      semanticPath,
      `Unresolved CLI presentation placeholder: ${unresolved[1]}`,
      unresolved[1],
    );
  }
  return interpolated;
}

function assertUniqueStructure(
  parentPath: string,
  commands: readonly CommandDefinition[],
): void {
  const identities = new Map<string, string>();

  for (const command of commands) {
    const commandPath = `${parentPath}.commands.${command.name}`;
    if (identities.has(command.name)) {
      semanticError(
        'duplicate-command',
        commandPath,
        `Duplicate command identity: ${command.name}`,
      );
    }
    identities.set(command.name, commandPath);

    assertUniqueOptions(commandPath, command.flags);

    for (const alias of command.aliases ?? []) {
      if (identities.has(alias) || commands.some((candidate) => candidate.name === alias)) {
        semanticError(
          'alias-collision',
          `${commandPath}.aliases.${alias}`,
          `Command alias collides with another identity: ${alias}`,
        );
      }
      identities.set(alias, commandPath);
    }

    assertUniqueStructure(commandPath, command.subcommands ?? []);
  }
}

function assertUniqueOptions(
  commandPath: string,
  options: readonly FlagDefinition[],
): void {
  const optionNames = new Set<string>();
  for (const option of options) {
    if (optionNames.has(option.name)) {
      semanticError(
        'duplicate-option',
        `${commandPath}.options.${option.name}`,
        `Duplicate option identity: ${option.name}`,
      );
    }
    optionNames.add(option.name);
  }
}

function resolveOption(
  definition: FlagDefinition,
  englishNode: CliCatalogNode | undefined,
  selectedNode: CliCatalogNode | undefined,
  semanticPath: string,
  facts: Readonly<Record<string, string>>,
): ResolvedFlagDefinition {
  return {
    ...definition,
    description: resolveCopy(
      englishNode?.description,
      selectedNode?.description,
      `${semanticPath}.description`,
      facts,
    ),
  };
}

function resolvePositional(
  definition: ResolvedPositionalDefinition,
  englishNode: CliCatalogNode | undefined,
  selectedNode: CliCatalogNode | undefined,
  semanticPath: string,
  facts: Readonly<Record<string, string>>,
): ResolvedPositionalDefinition {
  if (
    englishNode?.description === undefined &&
    selectedNode?.description === undefined
  ) {
    return { ...definition };
  }

  return {
    ...definition,
    description: resolveCopy(
      englishNode?.description,
      selectedNode?.description,
      `${semanticPath}.description`,
      facts,
    ),
  };
}

function resolveCommand(
  definition: CommandDefinition,
  englishNode: CliCatalogNode | undefined,
  selectedNode: CliCatalogNode | undefined,
  semanticPath: string,
  facts: Readonly<Record<string, string>>,
): ResolvedCommandDefinition {
  const flags = definition.flags.map((flag) =>
    resolveOption(
      flag,
      englishNode?.options?.[flag.name],
      selectedNode?.options?.[flag.name],
      `${semanticPath}.options.${flag.name}`,
      facts,
    ),
  );
  const positionals = definition.positionals?.map((positional) =>
    resolvePositional(
      positional,
      englishNode?.positionals?.[positional.name],
      selectedNode?.positionals?.[positional.name],
      `${semanticPath}.positionals.${positional.name}`,
      facts,
    ),
  );
  const subcommands = definition.subcommands?.map((command) =>
    resolveCommand(
      command,
      englishNode?.commands?.[command.name],
      selectedNode?.commands?.[command.name],
      `${semanticPath}.commands.${command.name}`,
      facts,
    ),
  );
  const {
    flags: _flags,
    positionals: _positionals,
    subcommands: _subcommands,
    ...structure
  } = definition;

  return {
    ...structure,
    description: resolveCopy(
      englishNode?.description,
      selectedNode?.description,
      `${semanticPath}.description`,
      facts,
    ),
    flags,
    ...(positionals ? { positionals } : {}),
    ...(subcommands ? { subcommands } : {}),
  };
}

function projectAliases(
  commands: readonly ResolvedCommandDefinition[],
): readonly ResolvedCommandDefinition[] {
  const projected: ResolvedCommandDefinition[] = [];
  for (const command of commands) {
    const subcommands = command.subcommands
      ? projectAliases(command.subcommands)
      : undefined;
    const canonical = {
      ...command,
      ...(subcommands ? { subcommands } : {}),
    };
    projected.push(canonical);
    for (const alias of command.aliases ?? []) {
      projected.push({
        ...canonical,
        name: alias,
        aliases: undefined,
      });
    }
  }
  return projected;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function presentationFacts(
  overrides: Partial<CliPresentationFacts> | undefined,
): Readonly<Record<string, string>> {
  const defaults: CliPresentationFacts = {
    availableToolIds: getToolsWithSkillsDir(),
    defaultSchema: DEFAULT_SCHEMA,
    workspaceDir: WORKSPACE_DIR_NAME,
  };
  const facts = { ...defaults, ...overrides };
  return {
    ids: facts.availableToolIds?.join(', ') ?? '',
    defaultSchema: facts.defaultSchema ?? '',
    workspaceDir: facts.workspaceDir ?? '',
  };
}

export function resolveCliPresentation({
  locale,
  facts: factOverrides,
}: ResolveCliPresentationOptions): ResolvedCliPresentation {
  assertUniqueOptions('cli.root', COMMAND_REGISTRY.flags);
  assertUniqueStructure('cli.root', COMMAND_REGISTRY.subcommands ?? []);

  const englishCatalog = getLocaleCatalog('en').cli as CliCatalog;
  const selectedCatalog = getLocaleCatalog(locale).cli as CliCatalog;
  const facts = presentationFacts(factOverrides);
  const chrome = Object.fromEntries(
    CLI_CHROME_KEYS.map((key) => [
      key,
      resolveCopy(
        englishCatalog.chrome[key],
        selectedCatalog.chrome?.[key],
        `cli.chrome.${key}`,
        facts,
      ),
    ]),
  ) as unknown as ResolvedCliChrome;
  const root = resolveCommand(
    COMMAND_REGISTRY,
    englishCatalog.root,
    selectedCatalog.root,
    'cli.root',
    facts,
  );
  const compatibilityCommands = COMPATIBILITY_COMMAND_REGISTRY.map((command) =>
    resolveCommand(
      command,
      englishCatalog.compatibilityCommands?.[command.name],
      selectedCatalog.compatibilityCommands?.[command.name],
      `cli.compatibilityCommands.${command.name}`,
      facts,
    ),
  );

  return deepFreeze({
    chrome,
    root,
    compatibilityCommands,
    completionCommands: projectAliases(root.subcommands ?? []),
  });
}
