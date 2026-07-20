import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { GlobalConfig, Profile, Delivery } from '../core/global-config.js';
import { getGlobalConfig, saveGlobalConfig } from '../core/global-config.js';
import { OPENSPEC_DIR_NAME } from '../core/config.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS, getProfileWorkflows } from '../core/profiles.js';
import { getCommandFileId } from '../core/command-generation/command-file-id.js';
import { hasProjectConfigDrift } from '../core/profile-sync-drift.js';
import {
  getProfilePromptMessages,
  type ProfilePromptMessages,
  getProfileUiMessages,
} from './profile-messages.js';
import { isPromptCancellationError } from './shared-output.js';
import type { CliLocale } from '../utils/locale.js';

type ProfileAction = 'both' | 'delivery' | 'workflows' | 'keep';

export interface ProfileState {
  profile: Profile;
  delivery: Delivery;
  workflows: string[];
}

export interface ProfileStateDiff {
  hasChanges: boolean;
  lines: string[];
}

const WORKFLOW_PICKER_SHORTCUTS = { all: 'a' } as const;
const WORKFLOW_DISPLAY_IDS = new Map(
  ALL_WORKFLOWS.map((workflow) => [workflow, getCommandFileId(workflow)])
);
const WORKFLOW_ID_COLUMN_WIDTH = Math.max(
  ...[...WORKFLOW_DISPLAY_IDS.values()].map((workflow) => workflow.length)
);

export function resolveCurrentProfileState(config: GlobalConfig): ProfileState {
  const profile = config.profile || 'full';
  const delivery = config.delivery || 'both';
  const workflows = [
    ...getProfileWorkflows(profile, config.workflows ? [...config.workflows] : undefined),
  ];
  return { profile, delivery, workflows };
}

export function deriveProfileFromWorkflowSelection(selectedWorkflows: string[]): Profile {
  const isFullMatch =
    selectedWorkflows.length === ALL_WORKFLOWS.length &&
    ALL_WORKFLOWS.every((workflow) => selectedWorkflows.includes(workflow));
  if (isFullMatch) return 'full';

  const isCoreMatch =
    selectedWorkflows.length === CORE_WORKFLOWS.length &&
    CORE_WORKFLOWS.every((workflow) => selectedWorkflows.includes(workflow));
  return isCoreMatch ? 'core' : 'custom';
}

export function formatWorkflowSummary(
  workflows: readonly string[],
  profile: Profile,
  locale?: CliLocale
): string {
  return getProfileUiMessages(locale).workflowSummary(workflows.length, profile);
}

function stableWorkflowOrder(workflows: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const workflow of ALL_WORKFLOWS) {
    if (workflows.includes(workflow) && !seen.has(workflow)) {
      ordered.push(workflow);
      seen.add(workflow);
    }
  }

  const extras = workflows.filter(
    (workflow) => !ALL_WORKFLOWS.includes(workflow as (typeof ALL_WORKFLOWS)[number])
  );
  extras.sort();
  for (const extra of extras) {
    if (!seen.has(extra)) {
      ordered.push(extra);
      seen.add(extra);
    }
  }

  return ordered;
}

export function diffProfileState(
  before: ProfileState,
  after: ProfileState,
  locale?: CliLocale
): ProfileStateDiff {
  const messages = getProfileUiMessages(locale);
  const lines: string[] = [];

  if (before.delivery !== after.delivery) {
    lines.push(messages.diffDelivery(before.delivery, after.delivery));
  }
  if (before.profile !== after.profile) {
    lines.push(messages.diffProfile(before.profile, after.profile));
  }

  const beforeOrdered = stableWorkflowOrder(before.workflows);
  const afterOrdered = stableWorkflowOrder(after.workflows);
  const beforeSet = new Set(beforeOrdered);
  const afterSet = new Set(afterOrdered);
  const added = afterOrdered.filter((workflow) => !beforeSet.has(workflow));
  const removed = beforeOrdered.filter((workflow) => !afterSet.has(workflow));

  if (added.length > 0 || removed.length > 0) {
    lines.push(messages.diffWorkflows(added, removed));
  }

  return { hasChanges: lines.length > 0, lines };
}

function workflowChoices(
  currentState: ProfileState,
  messages: ProfilePromptMessages
): Array<{
  value: string;
  name: string;
  description: string;
  short: string;
  checked: boolean;
}> {
  return ALL_WORKFLOWS.map((workflow) => {
    const metadata = messages.workflows[workflow];
    const displayId = WORKFLOW_DISPLAY_IDS.get(workflow) ?? workflow;
    return {
      value: workflow,
      name: `${displayId.padEnd(WORKFLOW_ID_COLUMN_WIDTH)} - ${metadata.name}`,
      description: metadata.description,
      short: metadata.name,
      checked: currentState.workflows.includes(workflow),
    };
  });
}

function deliveryChoices(
  currentDelivery: Delivery | undefined,
  messages: ProfilePromptMessages
): Array<{
  value: Delivery;
  name: string;
  description: string;
}> {
  const choices = [
    {
      value: 'both' as const,
      ...messages.delivery.both,
    },
    {
      value: 'skills' as const,
      ...messages.delivery.skills,
    },
  ];
  for (const choice of choices) {
    if (choice.value === currentDelivery) choice.name += messages.currentSuffix;
  }
  return choices;
}

export async function promptForNewProfileState(currentState: ProfileState): Promise<ProfileState> {
  const { select, checkbox } = await import('@inquirer/prompts');
  const messages = getProfilePromptMessages();
  const delivery = await select<Delivery>({
    message: messages.deliveryPickerMessage,
    choices: deliveryChoices(currentState.delivery, messages),
    default: currentState.delivery,
  });
  const workflows = await checkbox<string>({
    message: messages.workflowPickerMessage,
    instructions: messages.workflowPickerInstructions,
    shortcuts: WORKFLOW_PICKER_SHORTCUTS,
    pageSize: ALL_WORKFLOWS.length,
    theme: { icon: { checked: '[x]', unchecked: '[ ]' } },
    choices: workflowChoices(currentState, messages),
  });
  return {
    profile: deriveProfileFromWorkflowSelection(workflows),
    delivery,
    workflows,
  };
}

function maybeWarnProjectConfigDrift(
  projectDir: string,
  state: ProfileState,
  colorize: (message: string) => string
): void {
  const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
  if (!fs.existsSync(openspecDir)) return;
  if (!hasProjectConfigDrift(projectDir, state.workflows, state.delivery)) return;
  console.log(colorize(getProfileUiMessages().driftWarning));
}

export function printProfileApplyGuidance(): void {
  console.log(getProfileUiMessages().applyGuidance);
}

export function applyProfileState(state: ProfileState): void {
  const config = getGlobalConfig();
  config.profile = state.profile;
  config.delivery = state.delivery;
  config.workflows = [...state.workflows];
  saveGlobalConfig(config);
}

export async function runInteractiveProfileEditor(): Promise<void> {
  const ui = getProfileUiMessages();
  if (!process.stdout.isTTY) {
    console.error(ui.interactiveRequired);
    process.exitCode = 1;
    return;
  }

  const { select, checkbox, confirm } = await import('@inquirer/prompts');
  const chalk = (await import('chalk')).default;

  try {
    const config = getGlobalConfig();
    const currentState = resolveCurrentProfileState(config);
    const messages = getProfilePromptMessages();

    console.log(chalk.bold(ui.currentSettingsHeading));
    console.log(`  ${ui.deliveryLabel}: ${currentState.delivery}`);
    console.log(`  ${ui.workflowsLabel}: ${formatWorkflowSummary(currentState.workflows, currentState.profile)}`);
    console.log(chalk.dim(ui.deliveryExplanation));
    console.log(chalk.dim(ui.workflowsExplanation));
    console.log();

    const action = await select<ProfileAction>({
      message: ui.configurePrompt,
      choices: [
        {
          value: 'both',
          ...ui.actions.both,
        },
        {
          value: 'delivery',
          ...ui.actions.delivery,
        },
        {
          value: 'workflows',
          ...ui.actions.workflows,
        },
        {
          value: 'keep',
          ...ui.actions.keep,
        },
      ],
    });

    if (action === 'keep') {
      console.log(ui.noConfigChanges);
      maybeWarnProjectConfigDrift(process.cwd(), currentState, chalk.yellow);
      return;
    }

    const nextState: ProfileState = {
      profile: currentState.profile,
      delivery: currentState.delivery,
      workflows: [...currentState.workflows],
    };

    if (action === 'both' || action === 'delivery') {
      nextState.delivery = await select<Delivery>({
        message: messages.deliveryPickerMessage,
        choices: deliveryChoices(currentState.delivery, messages),
        default: currentState.delivery,
      });
    }

    if (action === 'both' || action === 'workflows') {
      const selectedWorkflows = await checkbox<string>({
        message: messages.workflowPickerMessage,
        instructions: messages.workflowPickerInstructions,
        shortcuts: WORKFLOW_PICKER_SHORTCUTS,
        pageSize: ALL_WORKFLOWS.length,
        theme: { icon: { checked: '[x]', unchecked: '[ ]' } },
        choices: workflowChoices(currentState, messages),
      });
      nextState.workflows = selectedWorkflows;
      nextState.profile = deriveProfileFromWorkflowSelection(selectedWorkflows);
    }

    const diff = diffProfileState(currentState, nextState);
    if (!diff.hasChanges) {
      console.log(ui.noConfigChanges);
      maybeWarnProjectConfigDrift(process.cwd(), nextState, chalk.yellow);
      return;
    }

    console.log(chalk.bold(ui.profileChangesHeading));
    for (const line of diff.lines) console.log(`  ${line}`);
    console.log();

    applyProfileState(nextState);

    const projectDir = process.cwd();
    const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
    if (fs.existsSync(openspecDir)) {
      const applyNow = await confirm({
        message: ui.applyToProject,
        default: true,
      });

      if (applyNow) {
        try {
          execSync(`"${process.execPath}" "${process.argv[1]}" update`, {
            stdio: 'inherit',
            cwd: projectDir,
          });
          console.log(ui.updateOtherProjects);
        } catch {
          console.error(ui.updateFailed);
          process.exitCode = 1;
        }
        return;
      }
    }

    printProfileApplyGuidance();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      console.log(ui.profileCancelled);
      process.exitCode = 130;
      return;
    }
    throw error;
  }
}
