import * as fs from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';

import { getGlobalConfig } from '../core/global-config.js';
import {
  BUILTIN_PROFILE_NAMES,
  PROFILE_DEFINITION_VERSION,
  NamedProfileError,
  assertValidUserProfileName,
  deleteNamedProfile,
  exportProfile,
  importProfilePackage,
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
  formatNamedProfileError,
  formatNamedProfileMessageDescriptor,
  getProfileUiMessages,
} from './profile-messages.js';
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
  const messages = getProfileUiMessages();
  const validationError = validateUserProfileName(name);
  if (validationError) {
    const reserved =
      BUILTIN_PROFILE_NAMES.includes(name as (typeof BUILTIN_PROFILE_NAMES)[number]) ||
      name === 'custom';
    return reserved ? messages.profileNameReserved(name) : messages.invalidProfileName;
  }
  return namedProfileExists(name) ? messages.profileAlreadyExists(name) : true;
}

function printProfileError(error: unknown): void {
  const messages = getProfileUiMessages();
  const detail = error instanceof NamedProfileError
    ? formatNamedProfileError(error)
    : error instanceof Error
      ? error.message
      : String(error);
  console.error(`${messages.errorPrefix} ${detail}`);
  process.exitCode = 1;
}

async function runProfileAction(action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      console.log(getProfileUiMessages().profileCommandCancelled);
      process.exitCode = 130;
      return;
    }
    printProfileError(error);
  }
}

function formatAvailableProfileError(profile: AvailableProfile): string {
  return formatNamedProfileMessageDescriptor(
    profile.errorDescriptor,
    profile.error ?? getProfileUiMessages().invalidProfile
  );
}

function availableProfileChoices(): Array<{
  value: string;
  name: string;
  description: string;
  disabled?: string;
}> {
  const messages = getProfileUiMessages();
  const delivery = getGlobalConfig().delivery ?? 'both';
  return listAvailableProfiles(delivery).map((profile) => {
    if (!profile.definition) {
      return {
        value: profile.name,
        name: profile.name,
        description: formatAvailableProfileError(profile),
        disabled: messages.invalidProfileFile,
      };
    }
    return {
      value: profile.name,
      name: profile.name,
      description: `${messages.profileSource(profile.builtIn)} · ${profile.definition.delivery} · ${messages.workflowCount(profile.definition.workflows.length)}`,
    };
  });
}

async function chooseProfileName(message: string): Promise<string> {
  if (!process.stdout.isTTY) {
    throw new NamedProfileError(
      getProfileUiMessages().profileNameRequired,
      'invalid_name'
    );
  }
  const { select } = await import('@inquirer/prompts');
  return select<string>({ message, choices: availableProfileChoices() });
}

async function chooseUserProfileName(message: string): Promise<string> {
  if (!process.stdout.isTTY) {
    throw new NamedProfileError(
      getProfileUiMessages().profileNameRequired,
      'invalid_name'
    );
  }
  const profiles = listUserProfiles();
  if (profiles.length === 0) {
    throw new NamedProfileError(getProfileUiMessages().noSavedProfiles, 'not_found');
  }
  const { select } = await import('@inquirer/prompts');
  return select<string>({
    message,
    choices: profiles.map((profile) => ({
      value: profile.name,
      name: profile.name,
      description: profile.definition
        ? `${profile.definition.delivery} · ${getProfileUiMessages().workflowCount(profile.definition.workflows.length)}`
        : formatAvailableProfileError(profile),
    })),
  });
}

export function useProfile(name: string): void {
  const config = getGlobalConfig();
  const definition = resolveProfileDefinition(name, config.delivery ?? 'both');
  applyProfileState(profileStateFromDefinition(definition));
  console.log(getProfileUiMessages().usingProfile(name));
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
  const messages = getProfileUiMessages();
  if (!process.stdout.isTTY) {
    throw new NamedProfileError(messages.profileNewRequiresTty, 'invalid_name');
  }

  const { input, confirm } = await import('@inquirer/prompts');
  const name =
    nameArgument ??
    (await input({
      message: messages.profileNamePrompt,
      validate: validateNewProfileName,
    }));

  const nameValidation = validateNewProfileName(name);
  if (nameValidation !== true) {
    throw new NamedProfileError(
      nameValidation,
      namedProfileExists(name) ? 'already_exists' : 'invalid_name'
    );
  }

  const currentState = resolveCurrentProfileState(getGlobalConfig());
  const nextState = await promptForNewProfileState(currentState);
  const diff = diffProfileState(currentState, nextState);

  console.log(messages.newProfile(name));
  if (diff.hasChanges) {
    for (const line of diff.lines) console.log(`  ${line}`);
  } else {
    console.log(messages.usesCurrentSettings);
  }

  const confirmed = await confirm({
    message: messages.saveAndUseProfile(name),
    default: true,
  });
  if (!confirmed) {
    console.log(messages.profileCreationCancelled);
    return;
  }

  saveNamedProfile(name, profileDefinitionFromState(nextState));
  applyProfileState(nextState);
  console.log(messages.profileCreated(name));
  printProfileApplyGuidance();
}

async function useProfileCommand(nameArgument?: string): Promise<void> {
  const name =
    nameArgument ?? (await chooseProfileName(getProfileUiMessages().selectProfileToUse));
  useProfile(name);
}

function profileListPayload(): {
  current: ProfileDefinition;
  profiles: Array<AvailableProfile & { matchesCurrent: boolean }>;
} {
  const current = currentProfileDefinition();
  const profiles = listAvailableProfiles(current.delivery).map((profile) => {
    const entry: AvailableProfile & { matchesCurrent: boolean } = {
      ...profile,
      matchesCurrent: profile.definition
        ? definitionsMatch(profile.definition, current)
        : false,
    };
    if (profile.errorDescriptor) {
      Object.defineProperty(entry, 'errorDescriptor', {
        value: profile.errorDescriptor,
        enumerable: false,
      });
    }
    return entry;
  });
  return { current, profiles };
}

function listProfiles(options: { json?: boolean }): void {
  const messages = getProfileUiMessages();
  const payload = profileListPayload();
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(messages.profilesHeading);
  for (const profile of payload.profiles) {
    const marker = profile.matchesCurrent ? '*' : ' ';
    if (!profile.definition) {
      console.log(
        `${marker} ${profile.name} [${messages.invalidMarker}] ${formatAvailableProfileError(profile)}`.trimEnd()
      );
      continue;
    }
    const source = messages.profileSource(profile.builtIn);
    console.log(
      `${marker} ${profile.name} [${source}] ${profile.definition.delivery}, ${messages.workflowCount(profile.definition.workflows.length)}`
    );
  }
  console.log(messages.matchesCurrentSettings);
}

async function deleteProfileCommand(
  nameArgument: string | undefined,
  options: { yes?: boolean }
): Promise<void> {
  const messages = getProfileUiMessages();
  const name = nameArgument ?? (await chooseUserProfileName(messages.selectProfileToDelete));
  if (BUILTIN_PROFILE_NAMES.includes(name as (typeof BUILTIN_PROFILE_NAMES)[number])) {
    throw new NamedProfileError(messages.builtInCannotDelete(name), 'reserved_name');
  }
  assertValidUserProfileName(name);

  if (!options.yes) {
    if (!process.stdout.isTTY) {
      throw new NamedProfileError(
        messages.deletionRequiresConfirmation,
        'invalid_name'
      );
    }
    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({
      message: messages.deleteProfile(name),
      default: false,
    });
    if (!confirmed) {
      console.log(messages.profileDeletionCancelled);
      return;
    }
  }

  deleteNamedProfile(name);
  console.log(messages.profileDeleted(name));
}

async function importProfileCommand(
  sourcePath: string,
  options: { force?: boolean; as?: string }
): Promise<void> {
  const messages = getProfileUiMessages();
  const imported = path.extname(sourcePath).toLowerCase() === '.rasenpkg'
    ? await importProfilePackage(sourcePath, { overwrite: options.force, name: options.as })
    : importNamedProfile(sourcePath, { overwrite: options.force, name: options.as });
  console.log(messages.profileImported(
    imported.name,
    imported.definition.delivery,
    imported.definition.workflows.length
  ));
  console.log(messages.useImportedProfile(imported.name));
}

async function exportProfileCommand(
  destinationPath: string,
  options: { profile?: string; force?: boolean; thin?: boolean }
): Promise<void> {
  const messages = getProfileUiMessages();
  const config = getGlobalConfig();
  const definition = options.profile
    ? resolveProfileDefinition(options.profile, config.delivery ?? 'both')
    : profileDefinitionFromState(resolveCurrentProfileState(config));

  let overwrite = options.force === true;
  if (fs.existsSync(destinationPath) && !overwrite) {
    if (!process.stdout.isTTY) {
      throw new NamedProfileError(
        messages.destinationExists(destinationPath),
        'already_exists'
      );
    }
    const { confirm } = await import('@inquirer/prompts');
    overwrite = await confirm({
      message: messages.overwriteFile(destinationPath),
      default: false,
    });
    if (!overwrite) {
      console.log(messages.profileExportCancelled);
      return;
    }
  }

  const packageName = options.profile && !BUILTIN_PROFILE_NAMES.includes(
    options.profile as (typeof BUILTIN_PROFILE_NAMES)[number]
  )
    ? options.profile
    : options.profile
      ? `${options.profile}-profile`
      : 'current-profile';
  const exported = exportProfile(destinationPath, packageName, definition, {
    overwrite,
    thin: options.thin,
  });
  const subject = options.profile
    ? messages.namedProfileSettings(options.profile)
    : messages.currentProfileSettings;
  console.log(messages.profileExported(subject, exported.path));
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
    .description('Import a profile package, YAML, or JSON profile')
    .option('--as <name>', 'Save the imported profile under a different name')
    .option('--force', 'Replace an existing profile with the same name')
    .action(async (sourcePath: string, options: { force?: boolean; as?: string }) => {
      await runProfileAction(() => importProfileCommand(sourcePath, options));
    });

  profileCommand
    .command('export <path>')
    .description('Export current settings or a named profile')
    .option('--profile <name>', 'Export a built-in or saved profile instead of current settings')
    .option('--thin', 'Export YAML or JSON without embedding user workflows')
    .option('--force', 'Overwrite an existing destination')
    .action(async (destinationPath: string, options: { profile?: string; force?: boolean; thin?: boolean }) => {
      await runProfileAction(() => exportProfileCommand(destinationPath, options));
    });
}
