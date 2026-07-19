import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { GlobalConfig, Profile, Delivery } from '../core/global-config.js';
import { getGlobalConfig, saveGlobalConfig } from '../core/global-config.js';
import { OPENSPEC_DIR_NAME } from '../core/config.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS, getProfileWorkflows } from '../core/profiles.js';
import { hasProjectConfigDrift } from '../core/profile-sync-drift.js';
import { isPromptCancellationError } from './shared-output.js';

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

interface WorkflowPromptMeta {
  name: string;
  description: string;
}

const WORKFLOW_PICKER_INSTRUCTIONS =
  'Space to toggle, A to select/clear all, Enter to confirm';
const WORKFLOW_PICKER_SHORTCUTS = { all: 'a' } as const;

const WORKFLOW_PROMPT_META: Record<string, WorkflowPromptMeta> = {
  propose: {
    name: 'Propose change',
    description: 'Create proposal, design, and tasks from a request',
  },
  explore: {
    name: 'Explore ideas',
    description: 'Investigate a problem before implementation',
  },
  new: {
    name: 'New change',
    description: 'Create a new change scaffold quickly',
  },
  continue: {
    name: 'Continue change',
    description: 'Resume work on an existing change',
  },
  apply: {
    name: 'Apply tasks',
    description: 'Implement tasks from the current change',
  },
  ff: {
    name: 'Fast-forward',
    description: 'Run a faster implementation workflow',
  },
  sync: {
    name: 'Sync specs',
    description: 'Sync change artifacts with specs',
  },
  archive: {
    name: 'Archive change',
    description: 'Finalize and archive a completed change',
  },
  'bulk-archive': {
    name: 'Bulk archive',
    description: 'Archive multiple completed changes together',
  },
  verify: {
    name: 'Verify change',
    description: 'Run verification checks against a change',
  },
  onboard: {
    name: 'Onboard',
    description: 'Guided onboarding flow for Rasen',
  },
};

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

export function formatWorkflowSummary(workflows: readonly string[], profile: Profile): string {
  return `${workflows.length} selected (${profile})`;
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

export function diffProfileState(before: ProfileState, after: ProfileState): ProfileStateDiff {
  const lines: string[] = [];

  if (before.delivery !== after.delivery) {
    lines.push(`delivery: ${before.delivery} -> ${after.delivery}`);
  }
  if (before.profile !== after.profile) {
    lines.push(`profile: ${before.profile} -> ${after.profile}`);
  }

  const beforeOrdered = stableWorkflowOrder(before.workflows);
  const afterOrdered = stableWorkflowOrder(after.workflows);
  const beforeSet = new Set(beforeOrdered);
  const afterSet = new Set(afterOrdered);
  const added = afterOrdered.filter((workflow) => !beforeSet.has(workflow));
  const removed = beforeOrdered.filter((workflow) => !afterSet.has(workflow));

  if (added.length > 0 || removed.length > 0) {
    const tokens: string[] = [];
    if (added.length > 0) tokens.push(`added ${added.join(', ')}`);
    if (removed.length > 0) tokens.push(`removed ${removed.join(', ')}`);
    lines.push(`workflows: ${tokens.join('; ')}`);
  }

  return { hasChanges: lines.length > 0, lines };
}

function workflowChoices(currentState: ProfileState): Array<{
  value: string;
  name: string;
  description: string;
  short: string;
  checked: boolean;
}> {
  return ALL_WORKFLOWS.map((workflow) => {
    const metadata = WORKFLOW_PROMPT_META[workflow] ?? {
      name: workflow,
      description: `Workflow: ${workflow}`,
    };
    return {
      value: workflow,
      name: metadata.name,
      description: metadata.description,
      short: metadata.name,
      checked: currentState.workflows.includes(workflow),
    };
  });
}

function deliveryChoices(currentDelivery?: Delivery): Array<{
  value: Delivery;
  name: string;
  description: string;
}> {
  const choices = [
    {
      value: 'both' as const,
      name: 'Both (skills + commands)',
      description: 'Install workflows as both skills and slash commands',
    },
    {
      value: 'skills' as const,
      name: 'Skills only',
      description: 'Install workflows only as skills',
    },
  ];
  for (const choice of choices) {
    if (choice.value === currentDelivery) choice.name += ' [current]';
  }
  return choices;
}

export async function promptForNewProfileState(currentState: ProfileState): Promise<ProfileState> {
  const { select, checkbox } = await import('@inquirer/prompts');
  const delivery = await select<Delivery>({
    message: 'Delivery mode (how workflows are installed):',
    choices: deliveryChoices(currentState.delivery),
    default: currentState.delivery,
  });
  const workflows = await checkbox<string>({
    message: 'Select workflows to make available:',
    instructions: WORKFLOW_PICKER_INSTRUCTIONS,
    shortcuts: WORKFLOW_PICKER_SHORTCUTS,
    pageSize: ALL_WORKFLOWS.length,
    theme: { icon: { checked: '[x]', unchecked: '[ ]' } },
    choices: workflowChoices(currentState),
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
  console.log(colorize('Warning: Global config is not applied to this project. Run `rasen update` to sync.'));
}

export function printProfileApplyGuidance(): void {
  console.log('Config updated. Run `rasen update` in your projects to apply.');
}

export function applyProfileState(state: ProfileState): void {
  const config = getGlobalConfig();
  config.profile = state.profile;
  config.delivery = state.delivery;
  config.workflows = [...state.workflows];
  saveGlobalConfig(config);
}

export async function runInteractiveProfileEditor(): Promise<void> {
  if (!process.stdout.isTTY) {
    console.error(
      'Interactive mode required. Use `rasen profile use <name>` or set config via environment/flags.'
    );
    process.exitCode = 1;
    return;
  }

  const { select, checkbox, confirm } = await import('@inquirer/prompts');
  const chalk = (await import('chalk')).default;

  try {
    const config = getGlobalConfig();
    const currentState = resolveCurrentProfileState(config);

    console.log(chalk.bold('\nCurrent profile settings'));
    console.log(`  Delivery: ${currentState.delivery}`);
    console.log(`  Workflows: ${formatWorkflowSummary(currentState.workflows, currentState.profile)}`);
    console.log(
      chalk.dim(
        '  Delivery = whether commands are installed alongside skills (skills are always installed)'
      )
    );
    console.log(chalk.dim('  Workflows = which actions are available (propose, explore, apply, etc.)'));
    console.log();

    const action = await select<ProfileAction>({
      message: 'What do you want to configure?',
      choices: [
        {
          value: 'both',
          name: 'Delivery and workflows',
          description: 'Update install mode and available actions together',
        },
        {
          value: 'delivery',
          name: 'Delivery only',
          description: 'Change where workflows are installed',
        },
        {
          value: 'workflows',
          name: 'Workflows only',
          description: 'Change which workflow actions are available',
        },
        {
          value: 'keep',
          name: 'Keep current settings (exit)',
          description: 'Leave configuration unchanged and exit',
        },
      ],
    });

    if (action === 'keep') {
      console.log('No config changes.');
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
        message: 'Delivery mode (how workflows are installed):',
        choices: deliveryChoices(currentState.delivery),
        default: currentState.delivery,
      });
    }

    if (action === 'both' || action === 'workflows') {
      const selectedWorkflows = await checkbox<string>({
        message: 'Select workflows to make available:',
        instructions: WORKFLOW_PICKER_INSTRUCTIONS,
        shortcuts: WORKFLOW_PICKER_SHORTCUTS,
        pageSize: ALL_WORKFLOWS.length,
        theme: { icon: { checked: '[x]', unchecked: '[ ]' } },
        choices: workflowChoices(currentState),
      });
      nextState.workflows = selectedWorkflows;
      nextState.profile = deriveProfileFromWorkflowSelection(selectedWorkflows);
    }

    const diff = diffProfileState(currentState, nextState);
    if (!diff.hasChanges) {
      console.log('No config changes.');
      maybeWarnProjectConfigDrift(process.cwd(), nextState, chalk.yellow);
      return;
    }

    console.log(chalk.bold('\nProfile changes:'));
    for (const line of diff.lines) console.log(`  ${line}`);
    console.log();

    applyProfileState(nextState);

    const projectDir = process.cwd();
    const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
    if (fs.existsSync(openspecDir)) {
      const applyNow = await confirm({
        message: 'Apply changes to this project now?',
        default: true,
      });

      if (applyNow) {
        try {
          execSync(`"${process.execPath}" "${process.argv[1]}" update`, {
            stdio: 'inherit',
            cwd: projectDir,
          });
          console.log('Run `rasen update` in your other projects to apply.');
        } catch {
          console.error('`rasen update` failed. Please run it manually to apply the profile changes.');
          process.exitCode = 1;
        }
        return;
      }
    }

    printProfileApplyGuidance();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      console.log('Config profile cancelled.');
      process.exitCode = 130;
      return;
    }
    throw error;
  }
}
