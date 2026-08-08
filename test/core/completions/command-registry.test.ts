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
      // `store-layout-v2-migration` task 9.3: the layout migration sits
      // immediately before adopt because adopt now requires layout v2.
      'migrate-layout',
      'adopt',
      'eject',
      'list',
      'doctor',
      // `store-planning-worktree-bindings` task 11.2: target-line authoring
      // lives under `store` because a release line is Store-level content that
      // outlives every workspace on it.
      'target-line',
      // `store-scoped-issues-management` task 8.1: a Store-level Issue is
      // cross-project intent that references project Changes and owns none of
      // them, so it is Store content and not a project-scoped group.
      'issue',
      // `store-scoped-issues-management` tasks 8.3-8.4: the aggregate reads.
      // They answer questions that span more than one project, which no
      // project-scoped surface can.
      'changes',
      'projects',
      // `store-planning-worktree-bindings` task 11.1: the planning/execution
      // worktree PAIR is Store content too, and `workspace` is a retired
      // top-level group name (see `legacy-groups-removed.test.ts`) that stays
      // retired, so the group is a `store` subcommand rather than a fourth
      // top-level `work*` group.
      'workspace',
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
      'target-line',
    ]);
  });

  it('keeps store-selection options paired and guidance complete', () => {
    const seen: string[] = [];
    const lifecycle: string[] = [];
    const pipeline: string[] = [];

    /**
     * `store-scoped-issues-management` task 8.2. Each of these resolves a STORE
     * and requires no project and no target line, because the thing it
     * addresses spans projects by construction:
     *
     *   store issue new|list|show|state — an Issue is Store-level cross-project
     *     intent; demanding one project would contradict the resource.
     *   store issue plan — takes `--project`/`--target-line`, but they scope a
     *     plan NODE, not the command. It is listed here so the exemption is
     *     about what the flags MEAN rather than whether they are present.
     *   store changes / store projects — aggregate READS over every project;
     *     the same two flags appear as narrowing filters.
     *
     * The list is enumerated rather than expressed as a `store ` prefix rule on
     * purpose: a prefix rule would silently exempt every future Store
     * subcommand, including one that really is project-scoped.
     */
    const storeLevelScoped = new Set([
      'store issue new',
      'store issue list',
      'store issue show',
      'store issue plan',
      'store issue state',
      'store changes',
      'store projects',
    ]);
    /** The subset that must not carry the pair AT ALL, in either meaning. */
    const requiresNoProjectSelector = new Set([
      'store issue new',
      'store issue list',
      'store issue show',
      'store issue state',
    ]);

    function walk(definition: CommandDefinition, parentPath: string): void {
      for (const child of definition.subcommands ?? []) {
        const commandPath = parentPath
          ? `${parentPath} ${child.name}`
          : child.name;
        const flagNames = child.flags.map((flag) => flag.name);
        if (flagNames.includes('store')) {
          seen.push(commandPath);
          // `store target-line ...` addresses a LINE, not a planning scope: the
          // line is the positional operand, `list` is Store-wide, and
          // `--project` selects which code locator is being read or edited. The
          // triple would be meaningless there, so the pairing rule applies to
          // planning-scoped commands only (`store-planning-worktree-bindings`
          // task 11.2).
          const lineScoped = commandPath.startsWith('store target-line ');
          const storeLevel = storeLevelScoped.has(commandPath);
          if (requiresNoProjectSelector.has(commandPath)) {
            // The positive half of the exemption: these do not merely tolerate
            // a missing project, they must not offer one, so a future edit
            // cannot quietly turn a Store-level Issue command into a
            // project-scoped one and still pass by being "exempt".
            expect(flagNames, `${commandPath} --project`).not.toContain('project');
            expect(flagNames, `${commandPath} --target-line`).not.toContain('target-line');
          }
          if (!lineScoped && !storeLevel) {
            expect(flagNames, `${commandPath} --project`).toContain('project');
          }
          if (!commandPath.startsWith('knowledge ') && !lineScoped && !storeLevel) {
            expect(flagNames, `${commandPath} --target-line`).toContain('target-line');
          }
          if (commandPath.startsWith('pipeline ')) {
            pipeline.push(commandPath);
          } else if (!commandPath.startsWith('knowledge ') && !lineScoped && !storeLevel) {
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
      // `store-planning-worktree-bindings` task 11.1: preparing, inspecting,
      // and removing the worktree pair is scoped by the same orthogonal triple.
      'store workspace cleanup',
      'store workspace plan',
      'store workspace show',
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
    // `rasen store workspace` prepares the worktree PAIR; the shared skill
    // guidance teaches threading planning selectors through spec/Change
    // commands, which this group is not one of. Naming it there would also
    // re-baseline every pinned skill-template digest for copy that is not about
    // specs or Changes.
    const specializedSelectorCommands = new Set([
      'work migrate',
      'store workspace plan',
      'store workspace show',
      'store workspace cleanup',
    ]);
    for (const commandPath of seen) {
      if (
        commandPath.startsWith('knowledge ') ||
        commandPath.startsWith('store target-line ') ||
        deferredLibraryVerbs.has(commandPath) ||
        specializedSelectorCommands.has(commandPath) ||
        // The Store-level Issue and aggregate commands are the counter-case to
        // the shared selector guidance: that copy teaches threading the
        // planning TRIPLE through spec and Change commands, and these commands
        // exist precisely because some work has no single project.
        storeLevelScoped.has(commandPath)
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
