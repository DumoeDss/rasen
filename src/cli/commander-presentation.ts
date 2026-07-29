import type { Argument, Command, Option } from 'commander';

import type {
  ResolvedCliChrome,
  ResolvedCliPresentation,
  ResolvedCommandDefinition,
  ResolvedFlagDefinition,
} from '../core/completions/types.js';
import { CliPresentationError } from '../core/completions/types.js';

interface PresentationPlan {
  command: Command;
  presentation: ResolvedCommandDefinition;
  optionPairs: readonly {
    option: Option;
    presentation: ResolvedFlagDefinition;
  }[];
  positionalPairs: readonly {
    argument: Argument;
    description: string;
  }[];
}

function mismatch(semanticPath: string, detail: string): never {
  throw new CliPresentationError(
    'commander-structure-mismatch',
    semanticPath,
    `Commander structure does not match CLI presentation: ${detail}`,
  );
}

function visibleCommands(command: Command): Command[] {
  return command.commands.filter(
    (child) => !(child as unknown as { _hidden?: boolean })._hidden,
  );
}

function visibleOptions(command: Command): Option[] {
  return command.options.filter(
    (option) => !option.hidden && option.long !== '--version',
  );
}

function normalizedArgumentName(name: string): string {
  return name.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertOption(
  option: Option,
  definition: ResolvedFlagDefinition,
  semanticPath: string,
): void {
  const longName = option.long?.replace(/^--/u, '');
  if (longName !== definition.name) {
    mismatch(semanticPath, `expected --${definition.name}, received ${option.long}`);
  }
  const shortName = option.short?.replace(/^-/u, '');
  if (shortName !== definition.short) {
    mismatch(
      semanticPath,
      `short option differs (${definition.short ?? 'none'} != ${shortName ?? 'none'})`,
    );
  }
  const takesValue = option.required || option.optional;
  if (takesValue !== (definition.takesValue ?? false)) {
    mismatch(semanticPath, 'option value arity differs');
  }
  if (
    !sameOptionalValues(
      definition.acceptedValues,
      option.argChoices,
    )
  ) {
    mismatch(semanticPath, 'accepted option values differ');
  }
}

function sameOptionalValues(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  return JSON.stringify(expected ?? []) === JSON.stringify(actual ?? []);
}

function assertPositionals(
  command: Command,
  definition: ResolvedCommandDefinition,
  semanticPath: string,
): PresentationPlan['positionalPairs'] {
  const expected = definition.positionals ?? [];
  const actual = command.registeredArguments;
  if (expected.length !== actual.length) {
    mismatch(semanticPath, 'positional argument count differs');
  }
  for (const [index, positional] of expected.entries()) {
    const argument = actual[index];
    if (
      normalizedArgumentName(positional.name) !==
        normalizedArgumentName(argument.name()) ||
      (positional.optional ?? false) !== !argument.required
    ) {
      mismatch(`${semanticPath}.positionals.${positional.name}`, 'positional argument differs');
    }
  }
  return expected.flatMap((positional, index) =>
    positional.description === undefined
      ? []
      : [{ argument: actual[index], description: positional.description }],
  );
}

function preflightCommand(
  command: Command,
  presentation: ResolvedCommandDefinition,
  semanticPath: string,
  plans: PresentationPlan[],
): void {
  if (command.name() !== presentation.name) {
    mismatch(semanticPath, `expected command ${presentation.name}, received ${command.name()}`);
  }
  if (
    JSON.stringify(sorted(command.aliases())) !==
    JSON.stringify(sorted(presentation.aliases ?? []))
  ) {
    mismatch(semanticPath, 'command aliases differ');
  }

  const commandOptions = visibleOptions(command);
  if (commandOptions.length !== presentation.flags.length) {
    mismatch(semanticPath, 'visible option count differs');
  }
  const optionPairs = presentation.flags.map((flag) => {
    const option = commandOptions.find(
      (candidate) => candidate.long?.replace(/^--/u, '') === flag.name,
    );
    if (!option) {
      mismatch(`${semanticPath}.options.${flag.name}`, `missing --${flag.name}`);
    }
    assertOption(option, flag, `${semanticPath}.options.${flag.name}`);
    return { option, presentation: flag };
  });
  const positionalPairs = assertPositionals(command, presentation, semanticPath);

  const children = visibleCommands(command);
  const presentedChildren = presentation.subcommands ?? [];
  if (children.length !== presentedChildren.length) {
    mismatch(semanticPath, 'visible subcommand count differs');
  }
  for (const childPresentation of presentedChildren) {
    const child = children.find((candidate) => candidate.name() === childPresentation.name);
    if (!child) {
      mismatch(
        `${semanticPath}.commands.${childPresentation.name}`,
        `missing command ${childPresentation.name}`,
      );
    }
    preflightCommand(
      child,
      childPresentation,
      `${semanticPath}.commands.${childPresentation.name}`,
      plans,
    );
  }

  plans.push({ command, presentation, optionPairs, positionalPairs });
}

function configureChrome(command: Command, chrome: ResolvedCliChrome): void {
  const titleMap: Record<string, string> = {
    'Usage:': chrome.usageTitle,
    'Arguments:': chrome.argumentsTitle,
    'Options:': chrome.optionsTitle,
    'Global Options:': chrome.globalOptionsTitle,
    'Commands:': chrome.commandsTitle,
  };
  command.helpOption('-h, --help', chrome.helpOption);
  command.configureHelp({
    styleTitle: (title: string) => titleMap[title] ?? title,
    optionDescription: (option: Option) => option.description,
  });
  if (visibleCommands(command).length > 0) {
    command.helpCommand('help [command]', chrome.helpCommand);
  }
}

export function applyCliPresentation(
  program: Command,
  presentation: ResolvedCliPresentation,
): void {
  const plans: PresentationPlan[] = [];
  preflightCommand(program, presentation.root, 'cli.root', plans);
  for (const compatibilityPresentation of presentation.compatibilityCommands) {
    const command = program.commands.find(
      (candidate) => candidate.name() === compatibilityPresentation.name,
    );
    if (!command) {
      mismatch(
        `cli.compatibilityCommands.${compatibilityPresentation.name}`,
        `missing command ${compatibilityPresentation.name}`,
      );
    }
    preflightCommand(
      command,
      compatibilityPresentation,
      `cli.compatibilityCommands.${compatibilityPresentation.name}`,
      plans,
    );
  }

  const versionOption = program.options.find((option) => option.long === '--version');
  if (!versionOption) {
    mismatch('cli.chrome.versionOption', 'missing generated version option');
  }

  for (const {
    command,
    presentation: commandPresentation,
    optionPairs,
    positionalPairs,
  } of plans) {
    command.description(commandPresentation.description);
    for (const { option, presentation: optionPresentation } of optionPairs) {
      option.description = optionPresentation.description;
    }
    for (const { argument, description } of positionalPairs) {
      argument.description = description;
    }
    configureChrome(command, presentation.chrome);
  }

  versionOption.description = presentation.chrome.versionOption;
}
