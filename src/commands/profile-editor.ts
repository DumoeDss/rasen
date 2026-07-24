import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { GlobalConfig, Profile } from '../core/global-config.js';
import { getGlobalConfig, saveGlobalConfig } from '../core/global-config.js';
import { OPENSPEC_DIR_NAME } from '../core/config.js';
import {
  ALL_EXPERTS,
  ALL_WORKFLOWS,
  CORE_WORKFLOWS,
  QUALITY_FLOOR_EXPERTS,
  getCurrentBuiltInWorkflowIds,
  getProfileWorkflows,
  resolveUserWideProfileBase,
} from '../core/profiles.js';
import { normalizeProfileDefinition, PROFILE_DEFINITION_VERSION } from '../core/named-profiles.js';
import { loadWorkflowCatalog, portablePathCollisionKey } from '../core/workflow-registry/index.js';
import { getCommandFileId } from '../core/shared/retired-command-paths.js';
import { resolveExpertSelectionExplicitReadOnly } from '../core/expert-selection-state.js';
import { hasProjectConfigDrift } from '../core/profile-sync-drift.js';
import { readProjectConfig } from '../core/project-config.js';
import {
  getProfilePromptMessages,
  type ProfilePromptMessages,
  getProfileUiMessages,
} from './profile-messages.js';
import { createConfigDiagnosticReporter } from './config-messages.js';
import { isPromptCancellationError } from './shared-output.js';
import type { CliLocale } from '../utils/locale.js';
import {
  formatPickerDescription,
  resolveTerminalColumns,
  resolveTerminalRows,
} from '../utils/terminal-text.js';

type InquirerPrompts = typeof import('@inquirer/prompts');
type PromptSeparator = InstanceType<InquirerPrompts['Separator']>;

type ProfileAction = 'workflows' | 'keep';

export interface ProfileState {
  /**
   * The three preset literals OR a saved profile name (widened for the
   * user-wide-saved-profile case, m4): the editor displays it verbatim and
   * preserves it on save when the selection is unchanged, rather than coercing
   * a saved name to a preset.
   */
  profile: Profile | string;
  workflows: string[];
}

export interface ProfileStateDiff {
  hasChanges: boolean;
  lines: string[];
}

const WORKFLOW_PICKER_SHORTCUTS = { all: 'a' } as const;
const DEFAULT_WORKFLOW_PICKER_PAGE_SIZE = 7;
// Question, spacer, up to two description lines, and instructions.
const WORKFLOW_PICKER_RESERVED_ROWS = 5;

export function resolveWorkflowPickerPageSize(
  choiceCount: number,
  terminalRows: number | undefined
): number {
  if (
    terminalRows === undefined ||
    !Number.isFinite(terminalRows) ||
    !Number.isInteger(terminalRows) ||
    terminalRows <= 0
  ) {
    return Math.min(choiceCount, DEFAULT_WORKFLOW_PICKER_PAGE_SIZE);
  }

  return Math.min(
    choiceCount,
    Math.max(1, terminalRows - WORKFLOW_PICKER_RESERVED_ROWS)
  );
}

function normalizedSelectedWorkflows(workflows: readonly string[]): string[] {
  return normalizeProfileDefinition({
    version: PROFILE_DEFINITION_VERSION,
    workflows: [...workflows],
  }).workflows;
}

export function resolveCurrentProfileState(config: GlobalConfig): ProfileState {
  const raw = config.profile || 'full';
  const expertSelectionExplicit = config.expertSelectionExplicit === true;
  const customWorkflows = config.workflows ? [...config.workflows] : undefined;
  if (raw === 'full' || raw === 'core' || raw === 'custom') {
    const workflows = [...getProfileWorkflows(raw, customWorkflows, { expertSelectionExplicit })];
    return { profile: raw, workflows };
  }
  // A user-wide profile set to a saved name (m4): display it verbatim and
  // resolve its actual stored workflow set (not `full`'s), so the editor never
  // misrepresents the current profile. An unresolvable name falls back to
  // `full`'s set for the picker but keeps showing the name as current.
  const base = resolveUserWideProfileBase(raw, customWorkflows, expertSelectionExplicit);
  const workflows = base.ok
    ? [...base.workflows]
    : [...getProfileWorkflows('full', undefined, { expertSelectionExplicit })];
  return { profile: raw, workflows };
}

/**
 * `full` = every workflow + every built-in expert; `core` = the CORE
 * workflows + the quality-floor experts (design.md D6/D2). Anything else,
 * including a `full`/`core`-shaped workflow set with a different expert
 * selection, is `custom`.
 */
export function deriveProfileFromWorkflowSelection(selectedWorkflows: string[]): Profile {
  const fullSet = [...ALL_WORKFLOWS, ...ALL_EXPERTS];
  const isFullMatch =
    selectedWorkflows.length === fullSet.length &&
    fullSet.every((id) => selectedWorkflows.includes(id));
  if (isFullMatch) return 'full';

  const coreSet = [...CORE_WORKFLOWS, ...QUALITY_FLOOR_EXPERTS];
  const isCoreMatch =
    selectedWorkflows.length === coreSet.length &&
    coreSet.every((id) => selectedWorkflows.includes(id));
  return isCoreMatch ? 'core' : 'custom';
}

export function formatWorkflowSummary(
  workflows: readonly string[],
  profile: Profile | string,
  locale?: CliLocale
): string {
  return getProfileUiMessages(locale).workflowSummary(workflows.length, profile);
}

function stableWorkflowOrder(workflows: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of [...ALL_WORKFLOWS, ...ALL_EXPERTS]) {
    if (workflows.includes(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  const extras = workflows.filter((id) => !seen.has(id));
  extras.sort();
  for (const extra of extras) {
    if (!seen.has(extra)) {
      ordered.push(extra);
      seen.add(extra);
    }
  }

  return ordered;
}

/** Set-equality over two workflow-id lists (order- and duplicate-insensitive). */
function sameWorkflowSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) if (!setB.has(id)) return false;
  return true;
}

export function diffProfileState(
  before: ProfileState,
  after: ProfileState,
  locale?: CliLocale
): ProfileStateDiff {
  const messages = getProfileUiMessages(locale);
  const lines: string[] = [];

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

interface WorkflowChoice {
  value: string;
  name: string;
  description: string;
  short: string;
  checked: boolean;
  disabled?: string;
}

/**
 * Builds the profile picker's checkbox choices: built-in experts are
 * selectable catalog units alongside workflows (the 6b install flip), shown
 * as a separate labeled group after the workflow group. A closure-required
 * expert (a selected workflow's `requires.skills`, resolved through either
 * skill-identity form via `portablePathCollisionKey`) renders checked and
 * disabled — the user cannot uncheck it while the requiring workflow stays
 * selected (matrix row 8).
 */
export function workflowChoices(
  currentState: ProfileState,
  messages: ProfilePromptMessages,
  SeparatorCtor: InquirerPrompts['Separator']
): Array<WorkflowChoice | PromptSeparator> {
  const catalog = loadWorkflowCatalog();
  const definitions = catalog.definitions;
  // Display ids strip the internal '-command' suffix fusion workflow ids
  // carry (e.g. `ship-command` -> `ship`) so the picker shows the friendly
  // public name — independent of the (now-retired) command file surface.
  const displayIds = new Map(
    definitions.map((definition) => [definition.id, getCommandFileId(definition.id)])
  );
  // Column width is computed per group (workflows vs. experts), not across
  // the combined set: expert ids run longer (e.g. `design-consultation`)
  // than any workflow id, and the two are rendered as separate labeled
  // sections, so aligning them to one shared width would pad every workflow
  // row wider for no visual benefit.
  const workflowColumnWidth = Math.max(
    ...definitions
      .filter((definition) => definition.kind !== 'expert')
      .map((definition) => (displayIds.get(definition.id) ?? definition.id).length)
  );
  const expertColumnWidth = Math.max(
    ...definitions
      .filter((definition) => definition.kind === 'expert')
      .map((definition) => (displayIds.get(definition.id) ?? definition.id).length),
    0
  );
  const terminalColumns = resolveTerminalColumns();

  const skillIdentityToId = new Map<string, string>();
  for (const definition of definitions) {
    for (const name of new Set([definition.skill.template.name, definition.skill.dirName])) {
      skillIdentityToId.set(portablePathCollisionKey(name), definition.id);
    }
  }

  const requiredBy = new Map<string, string>();
  for (const definition of definitions) {
    if (!currentState.workflows.includes(definition.id)) continue;
    for (const dependency of definition.requires.workflows) requiredBy.set(dependency, definition.id);
    for (const skillName of definition.requires.skills) {
      const dependencyId = skillIdentityToId.get(portablePathCollisionKey(skillName));
      if (dependencyId) requiredBy.set(dependencyId, definition.id);
    }
  }

  const toChoice = (definition: (typeof definitions)[number]): WorkflowChoice => {
    const id = definition.id;
    const isExpert = definition.kind === 'expert';
    const metadata = definition.source === 'built-in'
      ? isExpert
        ? messages.experts[id]
        : messages.workflows[id as keyof typeof messages.workflows]
      : {
          // The author-declared display title wins over the skill name; both
          // are user-authored content and are never translated.
          name: definition.title ?? definition.skill.template.name,
          description: `[${messages.sourceUser}] ${definition.skill.template.description}`,
        };
    const displayId = displayIds.get(id) ?? id;
    const dependencyOwner = requiredBy.get(id);
    return {
      value: id,
      name: `${displayId.padEnd(isExpert ? expertColumnWidth : workflowColumnWidth)} - ${metadata.name}`,
      description: formatPickerDescription(metadata.description, terminalColumns),
      short: metadata.name,
      checked: currentState.workflows.includes(id) || requiredBy.has(id),
      disabled: dependencyOwner ? messages.requiredBy(dependencyOwner) : undefined,
    };
  };

  const workflowGroup = definitions.filter((definition) => definition.kind !== 'expert').map(toChoice);
  const expertGroup = definitions.filter((definition) => definition.kind === 'expert').map(toChoice);

  return [
    new SeparatorCtor(messages.workflowsGroupLabel),
    ...workflowGroup,
    new SeparatorCtor(messages.expertsGroupLabel),
    ...expertGroup,
  ];
}

function workflowPickerOptions(
  currentState: ProfileState,
  messages: ProfilePromptMessages,
  SeparatorCtor: InquirerPrompts['Separator']
) {
  const choices = workflowChoices(currentState, messages, SeparatorCtor);

  return {
    message: messages.workflowPickerMessage,
    instructions: messages.workflowPickerInstructions,
    shortcuts: WORKFLOW_PICKER_SHORTCUTS,
    pageSize: resolveWorkflowPickerPageSize(
      choices.length,
      resolveTerminalRows(process.stdout)
    ),
    theme: { icon: { checked: '[x]', unchecked: '[ ]' } },
    choices,
  };
}

export async function promptForNewProfileState(currentState: ProfileState): Promise<ProfileState> {
  const { checkbox, Separator } = await import('@inquirer/prompts');
  const messages = getProfilePromptMessages();
  const workflows = await checkbox<string>(
    workflowPickerOptions(currentState, messages, Separator)
  );
  return {
    profile: deriveProfileFromWorkflowSelection(workflows),
    workflows: normalizedSelectedWorkflows(workflows),
  };
}

async function maybeWarnProjectConfigDrift(
  projectDir: string,
  state: ProfileState,
  colorize: (message: string) => string
): Promise<void> {
  const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
  if (!fs.existsSync(openspecDir)) return;
  const expertSelectionExplicit = await resolveExpertSelectionExplicitReadOnly(projectDir);
  if (!hasProjectConfigDrift(projectDir, state.workflows, { expertSelectionExplicit })) return;
  // A project carrying its own `workflows` override (space-workflow-enablement)
  // or a `profile` lock (init-profile-lock) intentionally differs from the
  // user-wide profile — name the override or lock instead of reporting it as
  // unapplied global config (design.md D3/spec).
  const projectConfig = readProjectConfig(projectDir);
  const messages = getProfileUiMessages();
  if (projectConfig?.workflows !== undefined) {
    console.log(colorize(messages.driftWarningOverride));
    return;
  }
  if (projectConfig?.profile !== undefined) {
    console.log(colorize(messages.driftWarningLocked(projectConfig.profile)));
    return;
  }
  console.log(colorize(messages.driftWarning));
}

export function printProfileApplyGuidance(): void {
  console.log(getProfileUiMessages().applyGuidance);
}

/**
 * Persists a resolved profile state and marks the machine as having
 * explicit expert selection (design.md D4): this is the picker's, `profile
 * use`'s, and `profile new`/`import`'s shared write path, and one of the
 * few paths allowed to set the marker. Once set, the profile-default plus
 * dependency-closure expert set governs installs instead of the legacy
 * "install every expert" fallback.
 */
function getGlobalConfigForProfile(): GlobalConfig {
  return getGlobalConfig({ reporter: createConfigDiagnosticReporter() });
}

export function applyProfileState(state: ProfileState): void {
  const config = getGlobalConfigForProfile();
  config.profile = state.profile;
  config.workflows = [...state.workflows];
  config.expertSelectionExplicit = true;
  // Record the built-in workflows known at this save, so a later `update`
  // surfaces only workflows added to the catalog after this point, never one
  // the user just deliberately deselected here.
  config.knownBuiltInWorkflows = getCurrentBuiltInWorkflowIds();
  saveGlobalConfig(config);
}

/**
 * Built-in workflows available in the catalog but absent from the current
 * selection, as friendly display ids (the picker's public names). Powers the
 * editor's discoverability line so a newly-available workflow is findable
 * without scrolling the paginated picker. Experts are excluded (a disjoint id
 * space); a `full` selection yields an empty list.
 */
export function unselectedBuiltInWorkflowDisplayIds(currentState: ProfileState): string[] {
  const selectedIds = new Set(currentState.workflows);
  return loadWorkflowCatalog()
    .definitions.filter(
      (definition) =>
        definition.source === 'built-in' &&
        definition.kind !== 'expert' &&
        !selectedIds.has(definition.id)
    )
    .map((definition) => getCommandFileId(definition.id) ?? definition.id);
}

export async function runInteractiveProfileEditor(): Promise<void> {
  const ui = getProfileUiMessages();
  if (!process.stdout.isTTY) {
    console.error(ui.interactiveRequired);
    process.exitCode = 1;
    return;
  }

  const { select, checkbox, confirm, Separator } = await import('@inquirer/prompts');
  const chalk = (await import('chalk')).default;

  try {
    const config = getGlobalConfigForProfile();
    const currentState = resolveCurrentProfileState(config);
    const messages = getProfilePromptMessages();

    console.log(chalk.bold(ui.currentSettingsHeading));
    console.log(`  ${ui.workflowsLabel}: ${formatWorkflowSummary(currentState.workflows, currentState.profile)}`);
    console.log(chalk.dim(ui.workflowsExplanation));

    // Surface built-in workflows available but not in the current selection,
    // so a newly-available workflow is findable without scrolling the
    // paginated picker. Display ids match the picker's friendly names.
    const unselectedBuiltIns = unselectedBuiltInWorkflowDisplayIds(currentState);
    if (unselectedBuiltIns.length > 0) {
      console.log(chalk.dim(ui.availableBuiltInsNote(unselectedBuiltIns)));
    }

    console.log();

    const action = await select<ProfileAction>({
      message: ui.configurePrompt,
      choices: [
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
      await maybeWarnProjectConfigDrift(process.cwd(), currentState, chalk.yellow);
      return;
    }

    const nextState: ProfileState = {
      profile: currentState.profile,
      workflows: [...currentState.workflows],
    };

    const selectedWorkflows = await checkbox<string>(
      workflowPickerOptions(currentState, messages, Separator)
    );
    nextState.workflows = normalizedSelectedWorkflows(selectedWorkflows);
    // Preserve a saved-name global profile when the selection is unchanged (m4):
    // only reclassify to a preset when the user actually edited the set, so a
    // no-op pass through the picker never clobbers `my-set` into `custom`.
    const isReserved = currentState.profile === 'full' || currentState.profile === 'core' || currentState.profile === 'custom';
    const selectionUnchanged = sameWorkflowSet(nextState.workflows, currentState.workflows);
    nextState.profile =
      !isReserved && selectionUnchanged
        ? currentState.profile
        : deriveProfileFromWorkflowSelection(selectedWorkflows);

    const diff = diffProfileState(currentState, nextState);
    if (!diff.hasChanges) {
      console.log(ui.noConfigChanges);
      await maybeWarnProjectConfigDrift(process.cwd(), nextState, chalk.yellow);
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
            windowsHide: true,
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
