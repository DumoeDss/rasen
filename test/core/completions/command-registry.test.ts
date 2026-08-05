import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';

import { createProgram, getCommandPath } from '../../../src/cli/index.js';
import { COMMAND_REGISTRY } from '../../../src/core/completions/command-registry.js';
import { resolveCliPresentation } from '../../../src/core/completions/cli-presentation.js';
import type {
  CommandDefinition,
  FlagDefinition,
  PositionalDefinition,
} from '../../../src/core/completions/types.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

const facts = {
  availableToolIds: ['claude', 'codex'],
  defaultSchema: 'spec-driven',
  workspaceDir: 'rasen',
} as const;

function program(): Command {
  return createProgram({ locale: 'en', facts });
}

function command(...path: string[]): CommandDefinition | undefined {
  let current: CommandDefinition | undefined = COMMAND_REGISTRY;
  for (const name of path) {
    current = current.subcommands?.find((entry) => entry.name === name);
  }
  return current;
}

function visibleChildCommands(parent: Command): Command[] {
  return parent.commands.filter(
    (child) =>
      !(child as unknown as { _hidden?: boolean })._hidden &&
      child.name() !== 'help',
  );
}

function normalizeName(name: string): string {
  return name.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

interface FlagShape {
  name: string;
  short?: string;
  takesValue?: true;
  acceptedValues?: readonly string[];
}

function flagShape(flag: FlagDefinition): FlagShape {
  return {
    name: flag.name,
    ...(flag.short ? { short: flag.short } : {}),
    ...(flag.takesValue ? { takesValue: true as const } : {}),
    ...(flag.acceptedValues ? { acceptedValues: flag.acceptedValues } : {}),
  };
}

function commanderFlagShapes(parent: Command): FlagShape[] {
  return parent.options
    .filter((option) => !option.hidden && option.long !== '--version')
    .map((option) => ({
      name: option.long.replace(/^--/u, ''),
      ...(option.short ? { short: option.short.replace(/^-/, '') } : {}),
      ...(option.required || option.optional ? { takesValue: true as const } : {}),
      ...(option.argChoices ? { acceptedValues: option.argChoices } : {}),
    }));
}

function sortedFlags(flags: readonly FlagShape[]): FlagShape[] {
  return [...flags].sort((left, right) => left.name.localeCompare(right.name));
}

function positionalShape(positional: PositionalDefinition): {
  name: string;
  optional?: true;
} {
  return {
    name: normalizeName(positional.name),
    ...(positional.optional ? { optional: true as const } : {}),
  };
}

function assertCommandParity(
  actual: Command,
  expected: CommandDefinition,
  semanticPath: string,
): void {
  expect(actual.name(), `${semanticPath} name`).toBe(expected.name);
  expect([...actual.aliases()].sort(), `${semanticPath} aliases`).toEqual(
    [...(expected.aliases ?? [])].sort(),
  );
  expect(
    sortedFlags(commanderFlagShapes(actual)),
    `${semanticPath} options`,
  ).toEqual(sortedFlags(expected.flags.map(flagShape)));
  expect(
    actual.registeredArguments.map((argument) => ({
      name: normalizeName(argument.name()),
      ...(argument.required ? {} : { optional: true as const }),
    })),
    `${semanticPath} positionals`,
  ).toEqual((expected.positionals ?? []).map(positionalShape));

  const actualChildren = visibleChildCommands(actual);
  const expectedChildren = expected.subcommands ?? [];
  expect(
    actualChildren.map((child) => child.name()).sort(),
    `${semanticPath} commands`,
  ).toEqual(expectedChildren.map((child) => child.name).sort());
  for (const childDefinition of expectedChildren) {
    const child = actualChildren.find(
      (candidate) => candidate.name() === childDefinition.name,
    );
    expect(child, `${semanticPath}.${childDefinition.name}`).toBeDefined();
    assertCommandParity(
      child as Command,
      childDefinition,
      `${semanticPath}.commands.${childDefinition.name}`,
    );
  }
}

describe('root-inclusive CLI structure', () => {
  it('matches the complete visible Commander structure', () => {
    assertCommandParity(program(), COMMAND_REGISTRY, 'cli.root');
  });

  it('keeps simple aliases on canonical commands', () => {
    const store = command('store');
    expect(store?.subcommands?.map((entry) => entry.name)).toEqual([
      'setup',
      'register',
      'add-project',
      'migrate-membership',
      'upgrade-identity',
      'unregister',
      'remove',
      'adopt',
      'eject',
      'list',
      'doctor',
    ]);
    expect(command('store', 'list')?.aliases).toEqual(['ls']);
    expect(command('workset', 'list')?.aliases).toEqual(['ls']);

    const presentation = resolveCliPresentation({ locale: 'ja', facts });
    const storePresentation = presentation.root.subcommands?.find(
      (entry) => entry.name === 'store',
    );
    const canonical = storePresentation?.subcommands?.find(
      (entry) => entry.name === 'list',
    );
    const projected = presentation.completionCommands
      .find((entry) => entry.name === 'store')
      ?.subcommands?.find((entry) => entry.name === 'ls');
    expect(projected?.description).toBe(canonical?.description);
  });

  it('keeps hidden compatibility commands out of the public structure', () => {
    const rootNames = COMMAND_REGISTRY.subcommands?.map((entry) => entry.name);
    expect(rootNames).not.toContain('experimental');
    expect(rootNames).not.toContain('__complete');
    expect(command('profile')?.subcommands?.map((entry) => entry.name)).not.toContain(
      'check',
    );
  });

  it('keeps accepted values separate from completion-only values', () => {
    const type = command('validate')?.flags.find((flag) => flag.name === 'type');
    expect(type?.acceptedValues).toBeUndefined();
    expect(type?.completionValues).toEqual(['change', 'spec']);
  });

  it('tracks top-level workflow commands and machine-facing flags', () => {
    for (const name of ['status', 'instructions', 'templates', 'schemas', 'new']) {
      expect(command(name), `${name} command`).toBeDefined();
    }
    expect(command('set')).toBeUndefined();
    expect(command('new', 'change')?.flags.map((flag) => flag.name)).toEqual([
      'description',
      'proposal',
      'goal',
      'schema',
      'pipeline',
      'json',
      'store',
      'project',
    ]);
  });

  it('keeps store-selection options paired and guidance complete', () => {
    const seen: string[] = [];
    const lifecycle: string[] = [];
    const pipeline: string[] = [];

    function walk(definition: CommandDefinition, parentPath: string): void {
      for (const child of definition.subcommands ?? []) {
        const commandPath = parentPath
          ? `${parentPath} ${child.name}`
          : child.name;
        const flagNames = child.flags.map((flag) => flag.name);
        if (flagNames.includes('store')) {
          seen.push(commandPath);
          expect(flagNames, `${commandPath} --project`).toContain('project');
          if (commandPath.startsWith('pipeline ')) {
            pipeline.push(commandPath);
          } else if (!commandPath.startsWith('knowledge ')) {
            lifecycle.push(commandPath);
          }
        }
        walk(child, commandPath);
      }
    }

    walk(COMMAND_REGISTRY, '');
    expect(lifecycle.sort()).toEqual([
      'archive',
      'context',
      'doctor',
      'instructions',
      'list',
      'new change',
      'retain prepare',
      'show',
      'status',
      'validate',
      'work migrate',
    ]);
    expect(pipeline.sort()).toEqual([
      'pipeline agents',
      'pipeline classify',
      'pipeline delete',
      'pipeline export',
      'pipeline import',
      'pipeline init',
      'pipeline list',
      'pipeline resume',
      'pipeline save',
      'pipeline show',
      'pipeline validate',
    ]);

    const deferredLibraryVerbs = new Set([
      'pipeline init',
      'pipeline validate',
      'pipeline import',
      'pipeline export',
      'pipeline delete',
      'pipeline save',
    ]);
    const specializedSelectorCommands = new Set(['work migrate']);
    for (const commandPath of seen) {
      if (
        commandPath.startsWith('knowledge ') ||
        deferredLibraryVerbs.has(commandPath) ||
        specializedSelectorCommands.has(commandPath)
      ) {
        continue;
      }
      expect(STORE_SELECTION_GUIDANCE, `guidance names ${commandPath}`).toContain(
        `\`${commandPath}\``,
      );
    }
  });

  it('tracks store subcommands under the store telemetry path', () => {
    const root = program();
    const store = root.commands.find((child) => child.name() === 'store');
    const setup = store?.commands.find((child) => child.name() === 'setup');
    expect(getCommandPath(setup as Command)).toBe('store:setup');
  });
});
