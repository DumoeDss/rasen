import * as fs from 'node:fs';

import { Command } from 'commander';

import { getGlobalConfig } from '../core/global-config.js';
import {
  BUILTIN_PROFILE_NAMES,
  PROFILE_DEFINITION_VERSION,
  NamedProfileError,
  assertValidUserProfileName,
  deleteNamedProfile,
  exportProfileDefinition,
  importNamedProfile,
  listAvailableProfiles,
  listUserProfiles,
  namedProfileExists,
  resolveProfileDefinition,
  saveNamedProfile,
  validateUserProfileName,
  type AvailableProfile,
  type ProfileDefinition,
} from '../core/named-profiles.js';
import { isPromptCancellationError } from './shared-output.js';
import {
  applyProfileState,
  deriveProfileFromWorkflowSelection,
  diffProfileState,
  printProfileApplyGuidance,
  promptForNewProfileState,
  resolveCurrentProfileState,
  runInteractiveProfileEditor,
  type ProfileState,
} from './profile-editor.js';

function profileStateFromDefinition(definition: ProfileDefinition): ProfileState {
  return {
    profile: deriveProfileFromWorkflowSelection(definition.workflows),
    delivery: definition.delivery,
    workflows: [...definition.workflows],
  };
}

function profileDefinitionFromState(state: ProfileState): ProfileDefinition {
  return {
    version: PROFILE_DEFINITION_VERSION,
    delivery: state.delivery,
    workflows: [...state.workflows],
  };
}

function definitionsMatch(left: ProfileDefinition, right: ProfileDefinition): boolean {
  return (
    left.delivery === right.delivery &&
    left.workflows.length === right.workflows.length &&
    left.workflows.every((workflow, index) => workflow === right.workflows[index])
  );
}

function currentProfileDefinition(): ProfileDefinition {
  return profileDefinitionFromState(resolveCurrentProfileState(getGlobalConfig()));
}

function validateNewProfileName(name: string): string | true {
  const validationError = validateUserProfileName(name);
  if (validationError) return validationError;
  return namedProfileExists(name) ? `Profile "${name}" already exists.` : true;
}

function printProfileError(error: unknown): void {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function runProfileAction(action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      console.log('Profile command cancelled.');
      process.exitCode = 130;
      return;
    }
    printProfileError(error);
  }
}

function availableProfileChoices(): Array<{
  value: string;
  name: string;
  description: string;
  disabled?: string;
}> {
  const delivery = getGlobalConfig().delivery ?? 'both';
  return listAvailableProfiles(delivery).map((profile) => {
    if (!profile.definition) {
      return {
        value: profile.name,
        name: profile.name,
        description: profile.error ?? 'Invalid profile',
        disabled: 'invalid profile file',
      };
    }
    return {
      value: profile.name,
      name: profile.name,
      description: `${profile.builtIn ? 'built-in' : 'saved'} · ${profile.definition.delivery} · ${profile.definition.workflows.length} workflows`,
    };
  });
}

async function chooseProfileName(message: string): Promise<string> {
  if (!process.stdout.isTTY) {
    throw new NamedProfileError(
      'A profile name is required outside an interactive terminal.',
      'invalid_name'
    );
  }
  const { select } = await import('@inquirer/prompts');
  return select<string>({ message, choices: availableProfileChoices() });
}

async function chooseUserProfileName(message: string): Promise<string> {
  if (!process.stdout.isTTY) {
    throw new NamedProfileError(
      'A profile name is required outside an interactive terminal.',
      'invalid_name'
    );
  }
  const profiles = listUserProfiles();
  if (profiles.length === 0) {
    throw new NamedProfileError('No saved profiles are available.', 'not_found');
  }
  const { select } = await import('@inquirer/prompts');
  return select<string>({
    message,
    choices: profiles.map((profile) => ({
      value: profile.name,
      name: profile.name,
      description: profile.definition
        ? `${profile.definition.delivery} · ${profile.definition.workflows.length} workflows`
        : profile.error,
    })),
  });
}

export function useProfile(name: string): void {
  const config = getGlobalConfig();
  const definition = resolveProfileDefinition(name, config.delivery ?? 'both');
  applyProfileState(profileStateFromDefinition(definition));
  console.log(`Using profile "${name}".`);
  printProfileApplyGuidance();
}

export async function runLegacyConfigProfileCommand(preset?: string): Promise<void> {
  if (preset) {
    await runProfileAction(() => useProfile(preset));
    return;
  }
  await runInteractiveProfileEditor();
}

async function createProfile(nameArgument?: string): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new NamedProfileError('`rasen profile new` requires an interactive terminal.', 'invalid_name');
  }

  const { input, confirm } = await import('@inquirer/prompts');
  const name =
    nameArgument ??
    (await input({
      message: 'Profile name:',
      validate: validateNewProfileName,
    }));

  assertValidUserProfileName(name);
  if (namedProfileExists(name)) {
    throw new NamedProfileError(`Profile "${name}" already exists.`, 'already_exists');
  }

  const currentState = resolveCurrentProfileState(getGlobalConfig());
  const nextState = await promptForNewProfileState(currentState);
  const diff = diffProfileState(currentState, nextState);

  console.log(`\nNew profile: ${name}`);
  if (diff.hasChanges) {
    for (const line of diff.lines) console.log(`  ${line}`);
  } else {
    console.log('  Uses the current profile settings.');
  }

  const confirmed = await confirm({
    message: `Save and use profile "${name}"?`,
    default: true,
  });
  if (!confirmed) {
    console.log('Profile creation cancelled.');
    return;
  }

  saveNamedProfile(name, profileDefinitionFromState(nextState));
  applyProfileState(nextState);
  console.log(`Created and selected profile "${name}".`);
  printProfileApplyGuidance();
}

async function useProfileCommand(nameArgument?: string): Promise<void> {
  const name = nameArgument ?? (await chooseProfileName('Select a profile to use:'));
  useProfile(name);
}

function profileListPayload(): {
  current: ProfileDefinition;
  profiles: Array<AvailableProfile & { matchesCurrent: boolean }>;
} {
  const current = currentProfileDefinition();
  const profiles = listAvailableProfiles(current.delivery).map((profile) => ({
    ...profile,
    matchesCurrent: profile.definition
      ? definitionsMatch(profile.definition, current)
      : false,
  }));
  return { current, profiles };
}

function listProfiles(options: { json?: boolean }): void {
  const payload = profileListPayload();
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('Profiles:');
  for (const profile of payload.profiles) {
    const marker = profile.matchesCurrent ? '*' : ' ';
    if (!profile.definition) {
      console.log(`${marker} ${profile.name} [invalid] ${profile.error ?? ''}`.trimEnd());
      continue;
    }
    const source = profile.builtIn ? 'built-in' : 'saved';
    console.log(
      `${marker} ${profile.name} [${source}] ${profile.definition.delivery}, ${profile.definition.workflows.length} workflows`
    );
  }
  console.log('\n* matches the current profile settings');
}

async function deleteProfileCommand(
  nameArgument: string | undefined,
  options: { yes?: boolean }
): Promise<void> {
  const name = nameArgument ?? (await chooseUserProfileName('Select a profile to delete:'));
  if (BUILTIN_PROFILE_NAMES.includes(name as (typeof BUILTIN_PROFILE_NAMES)[number])) {
    throw new NamedProfileError(`Built-in profile "${name}" cannot be deleted.`, 'reserved_name');
  }
  assertValidUserProfileName(name);

  if (!options.yes) {
    if (!process.stdout.isTTY) {
      throw new NamedProfileError(
        'Deletion requires confirmation in a terminal or the --yes flag.',
        'invalid_name'
      );
    }
    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({
      message: `Delete profile "${name}"?`,
      default: false,
    });
    if (!confirmed) {
      console.log('Profile deletion cancelled.');
      return;
    }
  }

  deleteNamedProfile(name);
  console.log(`Deleted profile "${name}". Current settings were not changed.`);
}

function importProfileCommand(sourcePath: string, options: { force?: boolean }): void {
  const imported = importNamedProfile(sourcePath, { overwrite: options.force });
  console.log(
    `Imported profile "${imported.name}" (${imported.definition.delivery}, ${imported.definition.workflows.length} workflows).`
  );
  console.log(`Run \`rasen profile use ${imported.name}\` to use it.`);
}

async function exportProfileCommand(
  destinationPath: string,
  options: { profile?: string; force?: boolean }
): Promise<void> {
  const config = getGlobalConfig();
  const definition = options.profile
    ? resolveProfileDefinition(options.profile, config.delivery ?? 'both')
    : profileDefinitionFromState(resolveCurrentProfileState(config));

  let overwrite = options.force === true;
  if (fs.existsSync(destinationPath) && !overwrite) {
    if (!process.stdout.isTTY) {
      throw new NamedProfileError(
        `Destination already exists: ${destinationPath}. Pass --force to overwrite it.`,
        'already_exists'
      );
    }
    const { confirm } = await import('@inquirer/prompts');
    overwrite = await confirm({
      message: `Overwrite existing file "${destinationPath}"?`,
      default: false,
    });
    if (!overwrite) {
      console.log('Profile export cancelled.');
      return;
    }
  }

  const exportedPath = exportProfileDefinition(destinationPath, definition, { overwrite });
  console.log(
    `Exported ${options.profile ? `profile "${options.profile}"` : 'current profile settings'} to ${exportedPath}.`
  );
}

export function registerProfileCommand(program: Command): void {
  const profileCommand = program
    .command('profile')
    .description('Manage reusable workflow profiles')
    .action(async () => {
      await runProfileAction(runInteractiveProfileEditor);
    });

  profileCommand
    .command('new [name]')
    .description('Create and use a named profile interactively')
    .action(async (name?: string) => {
      await runProfileAction(() => createProfile(name));
    });

  profileCommand
    .command('use [name]')
    .description('Use a built-in or saved profile')
    .action(async (name?: string) => {
      await runProfileAction(() => useProfileCommand(name));
    });

  profileCommand
    .command('list')
    .description('List built-in and saved profiles')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      await runProfileAction(() => listProfiles(options));
    });

  profileCommand
    .command('delete [name]')
    .description('Delete a saved profile')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (name: string | undefined, options: { yes?: boolean }) => {
      await runProfileAction(() => deleteProfileCommand(name, options));
    });

  profileCommand
    .command('import <path>')
    .description('Import a YAML or JSON profile')
    .option('--force', 'Replace an existing profile with the same name')
    .action(async (sourcePath: string, options: { force?: boolean }) => {
      await runProfileAction(() => importProfileCommand(sourcePath, options));
    });

  profileCommand
    .command('export <path>')
    .description('Export current settings or a named profile')
    .option('--profile <name>', 'Export a built-in or saved profile instead of current settings')
    .option('--force', 'Overwrite an existing destination')
    .action(async (destinationPath: string, options: { profile?: string; force?: boolean }) => {
      await runProfileAction(() => exportProfileCommand(destinationPath, options));
    });
}
