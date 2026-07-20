import { Command } from 'commander';
import { spawn, execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getGlobalConfigPath,
  getGlobalConfig,
  saveGlobalConfig,
  GlobalConfig,
} from '../core/global-config.js';
import type { Profile, Delivery } from '../core/global-config.js';
import {
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  coerceValue,
  formatValueYaml,
  validateConfigKeyPath,
  validateConfig,
  DEFAULT_CONFIG,
} from '../core/config-schema.js';
import {
  findConfigKeyDefinition,
  validateConfigValue,
  type ConfigScope,
} from '../core/config-keys.js';
import { resolveEffectiveConfig, type EffectiveConfigEntry } from '../core/effective-config.js';
import { readProjectConfig, updateProjectConfigKey, resolveConfigFilePath } from '../core/project-config.js';
import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { WORKSPACE_DIR_NAME, OPENSPEC_DIR_NAME } from '../core/config.js';
import { CORE_WORKFLOWS, ALL_WORKFLOWS, getProfileWorkflows } from '../core/profiles.js';
import { hasProjectConfigDrift } from '../core/profile-sync-drift.js';
import { isPromptCancellationError } from './shared-output.js';
import { startConfigApiServer } from '../core/config-api/server.js';
import { resolveLaunchProjectRef } from '../core/config-api/project-addressing.js';
import { resolveUiPackageDir, UI_PACKAGE_NAME } from '../core/config-api/ui-package.js';

const require = createRequire(import.meta.url);

type ProfileAction = 'both' | 'delivery' | 'workflows' | 'keep';

interface ProfileState {
  profile: Profile;
  delivery: Delivery;
  workflows: string[];
}

interface ProfileStateDiff {
  hasChanges: boolean;
  lines: string[];
}

interface WorkflowPromptMeta {
  name: string;
  description: string;
}

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


/**
 * Resolve the effective current profile state from global config defaults.
 */
export function resolveCurrentProfileState(config: GlobalConfig): ProfileState {
  const profile = config.profile || 'full';
  const delivery = config.delivery || 'both';
  const workflows = [
    ...getProfileWorkflows(profile, config.workflows ? [...config.workflows] : undefined),
  ];
  return { profile, delivery, workflows };
}

/**
 * Derive profile type from selected workflows.
 */
export function deriveProfileFromWorkflowSelection(selectedWorkflows: string[]): Profile {
  const isFullMatch =
    selectedWorkflows.length === ALL_WORKFLOWS.length &&
    ALL_WORKFLOWS.every((w) => selectedWorkflows.includes(w));
  if (isFullMatch) {
    return 'full';
  }
  const isCoreMatch =
    selectedWorkflows.length === CORE_WORKFLOWS.length &&
    CORE_WORKFLOWS.every((w) => selectedWorkflows.includes(w));
  return isCoreMatch ? 'core' : 'custom';
}

/**
 * Format a compact workflow summary for the profile header.
 */
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

  const extras = workflows.filter((w) => !ALL_WORKFLOWS.includes(w as (typeof ALL_WORKFLOWS)[number]));
  extras.sort();
  for (const extra of extras) {
    if (!seen.has(extra)) {
      ordered.push(extra);
      seen.add(extra);
    }
  }

  return ordered;
}

/**
 * Build a user-facing diff summary between two profile states.
 */
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

  const added = afterOrdered.filter((w) => !beforeSet.has(w));
  const removed = beforeOrdered.filter((w) => !afterSet.has(w));

  if (added.length > 0 || removed.length > 0) {
    const tokens: string[] = [];
    if (added.length > 0) {
      tokens.push(`added ${added.join(', ')}`);
    }
    if (removed.length > 0) {
      tokens.push(`removed ${removed.join(', ')}`);
    }
    lines.push(`workflows: ${tokens.join('; ')}`);
  }

  return {
    hasChanges: lines.length > 0,
    lines,
  };
}

function maybeWarnProjectConfigDrift(
  projectDir: string,
  state: ProfileState,
  colorize: (message: string) => string
): void {
  const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
  if (!fs.existsSync(openspecDir)) {
    return;
  }
  if (!hasProjectConfigDrift(projectDir, state.workflows, state.delivery)) {
    return;
  }
  console.log(colorize('Warning: Global config is not applied to this project. Run `rasen update` to sync.'));
}

function printConfigProfileApplyGuidance(): void {
  console.log('Config updated. Run `rasen update` in your projects to apply.');
}

/**
 * Resolve `--scope` from the subcommand's merged (own + inherited) options,
 * validating it as `global` (default) | `project`. Reports an error and sets
 * a non-zero exit code (rather than calling `process.exit`, for testability)
 * on any other value, naming the accepted scopes, and returns `undefined` so
 * callers can bail out early.
 */
function resolveScope(command: Command): ConfigScope | undefined {
  const scope = (command.optsWithGlobals() as { scope?: string }).scope ?? 'global';
  if (scope !== 'global' && scope !== 'project') {
    console.error(`Error: --scope must be "global" or "project" (got "${scope}").`);
    process.exitCode = 1;
    return undefined;
  }
  return scope;
}

/**
 * Resolves the nearest ancestor Rasen project root for `--scope project`
 * operations, matching other repo-local commands (nearest-`rasen/`-ancestor
 * resolution; store/project-flag routing is out of scope for this command).
 * Exits 1 with guidance when no project is found.
 */
function resolveProjectRootOrFail(): string | undefined {
  const root = findRepoPlanningRootSync(process.cwd());
  if (!root) {
    console.error(
      `Error: no Rasen project found (no "${WORKSPACE_DIR_NAME}/" directory in this directory or its ancestors).`
    );
    console.error(`Run 'rasen init' to create one, or omit --scope project to use global config.`);
    process.exitCode = 1;
    return undefined;
  }
  return root;
}

function runScoped(command: Command, fn: (scope: ConfigScope) => void): void {
  const scope = resolveScope(command);
  if (!scope) return;
  fn(scope);
}

/** Renders an effective-config value for CLI display: scalars as-is, containers as JSON. */
function formatEntryValue(value: unknown): string {
  if (value === undefined) return '(unset)';
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Renders a just-written value for the `Set <key> = <value>` confirmation
 * line: strings quoted (so `Set schema = "spec-driven"` reads unambiguously),
 * a plain object (e.g. the `{ remainingTokens: N }` absolute threshold form)
 * as JSON — without this, an object value renders as `[object Object]` —
 * arrays and scalars keep their established `String()` rendering (e.g.
 * `workflows` as a comma-joined list) unchanged.
 */
function formatSetDisplayValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (!Array.isArray(value) && typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Non-TTY no-arg `rasen config`: the effective view, one line per registered key, then exit 0. */
function printEffectiveConfigView(): void {
  const projectRoot = findRepoPlanningRootSync(process.cwd()) ?? undefined;
  const entries = resolveEffectiveConfig({ projectRoot });

  for (const entry of entries) {
    console.log(`${entry.definition.key} = ${formatEntryValue(entry.value)} (${entry.source})`);
  }
  console.log();
  console.log('Run `rasen config --help` for subcommands.');
}

type ChalkModule = typeof import('chalk')['default'];
type InquirerModule = typeof import('@inquirer/prompts');

/** Builds one `select` row for the interactive editor, per D6's non-editable-row rules. */
function buildEditorChoice(
  entry: EffectiveConfigEntry,
  projectRoot: string | undefined,
  chalk: ChalkModule
): { value: string; name: string; description?: string; disabled?: boolean | string } {
  const definition = entry.definition;
  const sourceLabel = entry.source === 'default' ? chalk.dim('default') : entry.source;
  let label = `${definition.group} / ${definition.key} = ${formatEntryValue(entry.value)} (${sourceLabel})`;

  if (entry.source === 'env-override') {
    label += chalk.yellow(' [environment variable takes precedence]');
  }

  if (definition.key === 'workflows') {
    return {
      value: '__workflows__',
      name: label,
      description: 'Use `rasen config profile` to change workflows',
      disabled: 'use `rasen config profile`',
    };
  }

  const isProjectOnly = definition.scopes.length === 1 && definition.scopes[0] === 'project';
  if (isProjectOnly && !projectRoot) {
    return { value: definition.key, name: label, disabled: 'requires a Rasen project' };
  }

  return { value: definition.key, name: label, description: definition.description };
}

/** Prompts for and writes a new value for one registry key, per its type/scope. */
async function editConfigEntry(
  entry: EffectiveConfigEntry,
  projectRoot: string | undefined,
  inquirer: Pick<InquirerModule, 'select' | 'input'>,
  chalk: ChalkModule
): Promise<void> {
  const definition = entry.definition;

  let scope: ConfigScope;
  if (definition.scopes.length === 2 && projectRoot) {
    scope = await inquirer.select<ConfigScope>({
      message: `Set "${definition.key}" at which scope?`,
      choices: [
        { value: 'project', name: 'Project (this repo)' },
        { value: 'global', name: 'Global (this machine)' },
      ],
    });
  } else if (definition.scopes.includes('project') && projectRoot) {
    scope = 'project';
  } else {
    scope = 'global';
  }

  let rawValue: unknown;
  if (definition.type === 'boolean') {
    rawValue = await inquirer.select<boolean>({
      message: `${definition.key}:`,
      choices: [
        { value: true, name: 'true' },
        { value: false, name: 'false' },
      ],
    });
  } else if (definition.type === 'enum') {
    rawValue = await inquirer.select<string>({
      message: `${definition.key}:`,
      choices: (definition.enumValues ?? []).map((v) => ({ value: v, name: v })),
    });
  } else if (definition.type === 'threshold') {
    // Dual-form: a bare fraction ("0.6") or the absolute object form
    // ('{"remainingTokens": 60000}') — coerceValue's number/JSON-container
    // branches parse either, same as `rasen config set`'s CLI value.
    const answer = await inquirer.input({
      message: `${definition.key} (fraction in (0, 1], or {"remainingTokens": N}):`,
      validate: (raw: string) => {
        const error = validateConfigValue(definition, coerceValue(raw));
        return error ?? true;
      },
    });
    rawValue = coerceValue(answer);
  } else {
    const answer = await inquirer.input({
      message: `${definition.key} (${definition.type}):`,
      validate: (raw: string) => {
        const coerced = definition.type === 'number' ? Number(raw) : raw;
        const error = validateConfigValue(definition, coerced);
        return error ?? true;
      },
    });
    rawValue = definition.type === 'number' ? Number(answer) : answer;
  }

  const valueError = validateConfigValue(definition, rawValue);
  if (valueError) {
    console.error(chalk.red(`Error: ${valueError}`));
    return;
  }

  if (scope === 'project') {
    if (!projectRoot) return;
    try {
      updateProjectConfigKey(projectRoot, definition.key, rawValue);
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
  } else {
    const config = getGlobalConfig() as Record<string, unknown>;
    const newConfig = JSON.parse(JSON.stringify(config));
    setNestedValue(newConfig, definition.key, rawValue);
    const validation = validateConfig(newConfig);
    if (!validation.success) {
      console.error(chalk.red(`Error: Invalid configuration - ${validation.error}`));
      return;
    }
    setNestedValue(config, definition.key, rawValue);
    saveGlobalConfig(config as GlobalConfig);
  }

  console.log(`Set ${definition.key} = ${formatSetDisplayValue(rawValue)}`);
}

/**
 * No-arg `rasen config` in a TTY: an `@inquirer/prompts` select loop styled
 * after `config profile`, showing every registry key's effective value and
 * source, grouped by area (design D6). Refreshes (re-resolves) after each
 * write and continues until Exit; Ctrl+C exits cleanly with code 130.
 */
async function runInteractiveConfigEditor(): Promise<void> {
  const inquirer = await import('@inquirer/prompts');
  const { select, Separator } = inquirer;
  const chalk = (await import('chalk')).default;

  const projectRoot = findRepoPlanningRootSync(process.cwd()) ?? undefined;

  try {
    for (;;) {
      const entries = resolveEffectiveConfig({ projectRoot });

      const byGroup = new Map<string, EffectiveConfigEntry[]>();
      for (const entry of entries) {
        const list = byGroup.get(entry.definition.group) ?? [];
        list.push(entry);
        byGroup.set(entry.definition.group, list);
      }

      type EditorChoice = ReturnType<typeof buildEditorChoice> | InstanceType<typeof Separator>;
      const choices: EditorChoice[] = [];
      for (const [group, groupEntries] of byGroup) {
        choices.push(new Separator(chalk.bold(`-- ${group} --`)));
        for (const entry of groupEntries) {
          choices.push(buildEditorChoice(entry, projectRoot, chalk));
        }
      }
      choices.push(new Separator());
      choices.push({ value: '__exit__', name: 'Exit' });

      console.log(chalk.bold('\nRasen configuration'));
      if (!projectRoot) {
        console.log(chalk.dim('  (not inside a Rasen project — project-only keys are unavailable)'));
      }

      const picked = await select<string>({
        message: 'Select a key to edit:',
        choices,
        pageSize: 20,
      });

      // Defensive: a degenerate prompt result (undefined/null — an exhausted
      // mock queue in tests, or a closed stdin in production) must not spin
      // this `for (;;)` loop forever re-resolving config and rebuilding
      // choices every iteration. Treat it as an implicit exit rather than
      // looping on it.
      if (picked === undefined || picked === null) {
        return;
      }

      if (picked === '__exit__') return;
      if (picked === '__workflows__') {
        console.log('Manage workflows via `rasen config profile`.');
        continue;
      }

      const entry = entries.find((e) => e.definition.key === picked);
      if (!entry) continue;

      await editConfigEntry(entry, projectRoot, inquirer, chalk);
    }
  } catch (error) {
    if (isPromptCancellationError(error)) {
      process.exitCode = 130;
      return;
    }
    throw error;
  }
}

/**
 * Register the config command and all its subcommands.
 *
 * @param program - The Commander program instance
 */
export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('View and modify global or project Rasen configuration')
    .option('--scope <scope>', 'Config scope: "global" (default) or "project"')
    .action(async (options: { scope?: string }, command: Command) => {
      // No-arg invocation: interactive full-view editor (TTY) or the
      // effective-config listing (non-TTY). `--scope` is not meaningful here
      // (the editor shows both scopes at once) but still validated.
      if (resolveScope(command) === undefined) return;

      if (process.stdout.isTTY) {
        await runInteractiveConfigEditor();
      } else {
        printEffectiveConfigView();
      }
    });

  // config path
  configCmd
    .command('path')
    .description('Show config file location')
    .action((_options: unknown, command: Command) => {
      runScoped(command, (scope) => {
        if (scope === 'global') {
          console.log(getGlobalConfigPath());
          return;
        }
        const projectRoot = resolveProjectRootOrFail();
        if (!projectRoot) return;
        console.log(resolveConfigFilePath(projectRoot) ?? path.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yaml'));
      });
    });

  // config list
  configCmd
    .command('list')
    .description('Show all current settings')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }, command: Command) => {
      runScoped(command, (scope) => {
        if (scope === 'project') {
          const projectRoot = resolveProjectRootOrFail();
          if (!projectRoot) return;
          const projectConfig = readProjectConfig(projectRoot) ?? {};
          console.log(options.json ? JSON.stringify(projectConfig, null, 2) : formatValueYaml(projectConfig));
          return;
        }

        const config = getGlobalConfig();

        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          // Read raw config to determine which values are explicit vs defaults
          const configPath = getGlobalConfigPath();
          let rawConfig: Record<string, unknown> = {};
          try {
            if (fs.existsSync(configPath)) {
              rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
          } catch {
            // If reading fails, treat all as defaults
          }

          console.log(formatValueYaml(config));

          // Annotate profile settings
          const profileSource = rawConfig.profile !== undefined ? '(explicit)' : '(default)';
          const deliverySource = rawConfig.delivery !== undefined ? '(explicit)' : '(default)';
          console.log(`\nProfile settings:`);
          console.log(`  profile: ${config.profile} ${profileSource}`);
          console.log(`  delivery: ${config.delivery} ${deliverySource}`);
          if (config.profile === 'full') {
            console.log(`  workflows: ${ALL_WORKFLOWS.join(', ')} (from full profile)`);
          } else if (config.profile === 'core') {
            console.log(`  workflows: ${CORE_WORKFLOWS.join(', ')} (from core profile)`);
          } else if (config.workflows && config.workflows.length > 0) {
            console.log(`  workflows: ${config.workflows.join(', ')} (explicit)`);
          } else {
            console.log(`  workflows: (none)`);
          }
        }
      });
    });

  // config get
  configCmd
    .command('get <key>')
    .description('Get a specific value (raw, scriptable)')
    .action((key: string, _options: unknown, command: Command) => {
      runScoped(command, (scope) => {
        let value: unknown;
        if (scope === 'project') {
          const projectRoot = resolveProjectRootOrFail();
          if (!projectRoot) return;
          const projectConfig = readProjectConfig(projectRoot) ?? {};
          value = getNestedValue(projectConfig as Record<string, unknown>, key);
        } else {
          const config = getGlobalConfig();
          value = getNestedValue(config as Record<string, unknown>, key);
        }

        if (value === undefined) {
          process.exitCode = 1;
          return;
        }

        if (typeof value === 'object' && value !== null) {
          console.log(JSON.stringify(value));
        } else {
          console.log(String(value));
        }
      });
    });

  // config set
  configCmd
    .command('set <key> <value>')
    .description('Set a value (auto-coerce types), validated against the config-key registry')
    .option('--string', 'Force value to be stored as string')
    .option('--allow-unknown', 'Allow setting unknown keys (global scope only)')
    .action(
      (
        key: string,
        value: string,
        options: { string?: boolean; allowUnknown?: boolean },
        command: Command
      ) => {
        runScoped(command, (scope) => {
          const allowUnknown = scope === 'global' && Boolean(options.allowUnknown);
          const keyValidation = validateConfigKeyPath(key, scope);
          if (!keyValidation.valid && !allowUnknown) {
            const reason = keyValidation.reason ? ` ${keyValidation.reason}.` : '';
            console.error(`Error: Invalid configuration key "${key}".${reason}`);
            console.error(`Use "rasen config list${scope === 'project' ? ' --scope project' : ''}" to see available keys.`);
            if (scope === 'global') {
              console.error('Pass --allow-unknown to bypass this check.');
            }
            process.exitCode = 1;
            return;
          }

          const coercedValue = coerceValue(value, options.string || false);

          // Project scope has no whole-object schema gate on the write path
          // (unlike global's validateConfig() below), so the registry's
          // per-key type/range check is the only pre-write validation —
          // apply it here. Global scope skips it: `delivery` accepts legacy
          // synonyms (commands/skills-first/commands-first) that the zod
          // schema transforms on read but the registry's enum intentionally
          // does not list (they are not the keys the editor should offer),
          // so registry validation would wrongly reject them here.
          if (scope === 'project') {
            const definition = findConfigKeyDefinition(key, scope);
            if (definition) {
              const valueError = validateConfigValue(definition, coercedValue);
              if (valueError) {
                console.error(`Error: ${valueError}`);
                process.exitCode = 1;
                return;
              }
            }
          }

          if (scope === 'project') {
            const projectRoot = resolveProjectRootOrFail();
            if (!projectRoot) return;
            try {
              updateProjectConfigKey(projectRoot, key, coercedValue);
            } catch (error) {
              console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
              process.exitCode = 1;
              return;
            }
          } else {
            const config = getGlobalConfig() as Record<string, unknown>;

            // Create a copy to validate before saving
            const newConfig = JSON.parse(JSON.stringify(config));
            setNestedValue(newConfig, key, coercedValue);

            // Validate the new config
            const validation = validateConfig(newConfig);
            if (!validation.success) {
              console.error(`Error: Invalid configuration - ${validation.error}`);
              process.exitCode = 1;
              return;
            }

            // Apply changes and save
            setNestedValue(config, key, coercedValue);
            saveGlobalConfig(config as GlobalConfig);
          }

          console.log(`Set ${key} = ${formatSetDisplayValue(coercedValue)}`);
        });
      }
    );

  // config unset
  configCmd
    .command('unset <key>')
    .description('Remove a key (revert to default)')
    .action((key: string, _options: unknown, command: Command) => {
      runScoped(command, (scope) => {
        if (scope === 'project') {
          // Registry-gated like `set`: unset must not delete hand-edit-only
          // fields (context, rules, quality-rules, ...) the design explicitly
          // keeps out of CLI editing.
          const keyValidation = validateConfigKeyPath(key, scope);
          if (!keyValidation.valid) {
            const reason = keyValidation.reason ? ` ${keyValidation.reason}.` : '';
            console.error(`Error: Invalid configuration key "${key}".${reason}`);
            console.error('Use "rasen config list --scope project" to see available keys.');
            process.exitCode = 1;
            return;
          }

          const projectRoot = resolveProjectRootOrFail();
          if (!projectRoot) return;
          let result: { existed: boolean };
          try {
            result = updateProjectConfigKey(projectRoot, key, undefined);
          } catch (error) {
            console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
            process.exitCode = 1;
            return;
          }
          console.log(
            result.existed ? `Unset ${key} (reverted to default)` : `Key "${key}" was not set`
          );
          return;
        }

        const config = getGlobalConfig() as Record<string, unknown>;
        const existed = deleteNestedValue(config, key);

        if (existed) {
          saveGlobalConfig(config as GlobalConfig);
          console.log(`Unset ${key} (reverted to default)`);
        } else {
          console.log(`Key "${key}" was not set`);
        }
      });
    });

  // config reset
  configCmd
    .command('reset')
    .description('Reset configuration to defaults (global scope only)')
    .option('--all', 'Reset all configuration (required)')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (options: { all?: boolean; yes?: boolean }, command: Command) => {
      const scope = resolveScope(command);
      if (!scope) return;
      if (scope === 'project') {
        console.error('Error: "rasen config reset" only supports global scope.');
        console.error(
          `Project config has no bulk reset — remove or hand-edit ${WORKSPACE_DIR_NAME}/config.yaml directly, or unset individual keys with "rasen config unset --scope project <key>".`
        );
        process.exitCode = 1;
        return;
      }

      if (!options.all) {
        console.error('Error: --all flag is required for reset');
        console.error('Usage: rasen config reset --all [-y]');
        process.exitCode = 1;
        return;
      }

      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        let confirmed: boolean;
        try {
          confirmed = await confirm({
            message: 'Reset all configuration to defaults?',
            default: false,
          });
        } catch (error) {
          if (isPromptCancellationError(error)) {
            console.log('Reset cancelled.');
            process.exitCode = 130;
            return;
          }
          throw error;
        }

        if (!confirmed) {
          console.log('Reset cancelled.');
          return;
        }
      }

      saveGlobalConfig({ ...DEFAULT_CONFIG });
      console.log('Configuration reset to defaults');
    });

  // config edit
  configCmd
    .command('edit')
    .description('Open config in $EDITOR (global scope only)')
    .action(async (_options: unknown, command: Command) => {
      const scope = resolveScope(command);
      if (!scope) return;
      if (scope === 'project') {
        console.error('Error: "rasen config edit" only supports global scope.');
        console.error(
          `Project config is hand-edited directly — open ${WORKSPACE_DIR_NAME}/config.yaml in your editor, or use "rasen config set/get/unset --scope project <key>".`
        );
        process.exitCode = 1;
        return;
      }

      const editor = process.env.EDITOR || process.env.VISUAL;

      if (!editor) {
        console.error('Error: No editor configured');
        console.error('Set the EDITOR or VISUAL environment variable to your preferred editor');
        console.error('Example: export EDITOR=vim');
        process.exitCode = 1;
        return;
      }

      const configPath = getGlobalConfigPath();

      // Ensure config file exists with defaults
      if (!fs.existsSync(configPath)) {
        saveGlobalConfig({ ...DEFAULT_CONFIG });
      }

      // Spawn editor and wait for it to close
      // Avoid shell parsing to correctly handle paths with spaces in both
      // the editor path and config path
      const child = spawn(editor, [configPath], {
        stdio: 'inherit',
        shell: false,
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Editor exited with code ${code}`));
          }
        });
        child.on('error', reject);
      });

      try {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const parsedConfig = JSON.parse(rawConfig);
        const validation = validateConfig(parsedConfig);

        if (!validation.success) {
          console.error(`Error: Invalid configuration - ${validation.error}`);
          process.exitCode = 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(`Error: Config file not found at ${configPath}`);
        } else if (error instanceof SyntaxError) {
          console.error(`Error: Invalid JSON in ${configPath}`);
          console.error(error.message);
        } else {
          console.error(`Error: Unable to validate configuration - ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exitCode = 1;
      }
    });

  // config profile [preset]
  configCmd
    .command('profile [preset]')
    .description('Configure workflow profile (interactive picker or preset shortcut)')
    .action(async (preset?: string) => {
      // Preset shortcuts: `rasen config profile full` / `rasen config profile core`
      if (preset === 'full' || preset === 'core') {
        const config = getGlobalConfig();
        config.profile = preset;
        config.workflows = preset === 'full' ? [...ALL_WORKFLOWS] : [...CORE_WORKFLOWS];
        // Preserve delivery setting
        saveGlobalConfig(config);
        printConfigProfileApplyGuidance();
        return;
      }

      if (preset) {
        console.error(`Error: Unknown profile preset "${preset}". Available presets: full, core`);
        process.exitCode = 1;
        return;
      }

      // Non-interactive check
      if (!process.stdout.isTTY) {
        console.error('Interactive mode required. Use `rasen config profile full` (or `core`) or set config via environment/flags.');
        process.exitCode = 1;
        return;
      }

      // Interactive picker
      const { select, checkbox, confirm } = await import('@inquirer/prompts');
      const chalk = (await import('chalk')).default;

      try {
        const config = getGlobalConfig();
        const currentState = resolveCurrentProfileState(config);

        console.log(chalk.bold('\nCurrent profile settings'));
        console.log(`  Delivery: ${currentState.delivery}`);
        console.log(`  Workflows: ${formatWorkflowSummary(currentState.workflows, currentState.profile)}`);
        console.log(chalk.dim('  Delivery = whether commands are installed alongside skills (skills are always installed)'));
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
          const deliveryChoices: { value: Delivery; name: string; description: string }[] = [
            {
              value: 'both' as Delivery,
              name: 'Both (skills + commands)',
              description: 'Install workflows as both skills and slash commands',
            },
            {
              value: 'skills' as Delivery,
              name: 'Skills only',
              description: 'Install workflows only as skills',
            },
          ];
          for (const choice of deliveryChoices) {
            if (choice.value === currentState.delivery) {
              choice.name += ' [current]';
            }
          }

          nextState.delivery = await select<Delivery>({
            message: 'Delivery mode (how workflows are installed):',
            choices: deliveryChoices,
            default: currentState.delivery,
          });
        }

        if (action === 'both' || action === 'workflows') {
          const formatWorkflowChoice = (workflow: string) => {
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
          };

          const selectedWorkflows = await checkbox<string>({
            message: 'Select workflows to make available:',
            instructions: 'Space to toggle, Enter to confirm',
            pageSize: ALL_WORKFLOWS.length,
            theme: {
              icon: {
                checked: '[x]',
                unchecked: '[ ]',
              },
            },
            choices: ALL_WORKFLOWS.map(formatWorkflowChoice),
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

        console.log(chalk.bold('\nConfig changes:'));
        for (const line of diff.lines) {
          console.log(`  ${line}`);
        }
        console.log();

        config.profile = nextState.profile;
        config.delivery = nextState.delivery;
        config.workflows = nextState.workflows;
        saveGlobalConfig(config);

        // Check if inside a Rasen project
        const projectDir = process.cwd();
        const openspecDir = path.join(projectDir, OPENSPEC_DIR_NAME);
        if (fs.existsSync(openspecDir)) {
          const applyNow = await confirm({
            message: 'Apply changes to this project now?',
            default: true,
          });

          if (applyNow) {
            try {
              // Re-invoke the SAME binary that is currently running rather than
              // `npx rasen`, which resolves the nearest local node_modules and
              // can hit a stale/broken install (e.g. a leftover symlink). Running
              // the current entry guarantees the CLI the user invoked applies the change.
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

        printConfigProfileApplyGuidance();
      } catch (error) {
        if (isPromptCancellationError(error)) {
          console.log('Config profile cancelled.');
          process.exitCode = 130;
          return;
        }
        throw error;
      }
    });

  // config ui
  configCmd
    .command('ui')
    .description('Start the localhost config API + optional web UI')
    .option('--no-open', 'Do not open the default browser')
    .option('--port <n>', 'Pin the listen port (default: ephemeral)')
    .action(async (options: { open?: boolean; port?: string }) => {
      let port: number | undefined;
      if (options.port !== undefined) {
        port = Number(options.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          console.error(`Error: --port must be an integer between 0 and 65535 (got "${options.port}").`);
          process.exitCode = 1;
          return;
        }
      }

      const launchProjectRoot = findRepoPlanningRootSync(process.cwd());
      const launchProjectRef = await resolveLaunchProjectRef(launchProjectRoot);
      const uiAssetsDir = resolveUiPackageDir();
      const token = crypto.randomBytes(32).toString('hex');
      const { version } = require('../../package.json') as { version: string };

      let handle: Awaited<ReturnType<typeof startConfigApiServer>>;
      try {
        handle = await startConfigApiServer({
          port,
          context: { token, launchProjectRoot, launchProjectRef, version, uiAssetsDir },
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
          console.error(`Error: port ${port} is already in use. Try a different --port, or omit it for an ephemeral one.`);
        } else {
          console.error(`Error: could not start the config server (${error instanceof Error ? error.message : String(error)}).`);
        }
        process.exitCode = 1;
        return;
      }

      const url = `http://127.0.0.1:${handle.port}/#token=${token}`;
      console.log(`Config UI: ${url}`);
      if (!uiAssetsDir) {
        console.log(`UI package not installed. Run: npm install -g ${UI_PACKAGE_NAME}`);
      }

      if (options.open !== false) {
        openInBrowser(url);
      }

      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        await handle.stopServer();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });
}

/**
 * Best-effort default-browser launch via the platform opener (`open` /
 * `cmd /c start` / `xdg-open`), spawned detached with stdio ignored and
 * unref'd so it never holds the CLI process's event loop open (design D6).
 * Deliberately not the `open` npm package — one dependency this repo has
 * chosen not to add for a single `spawn` call.
 */
function openInBrowser(url: string): void {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {
      // Best-effort: the URL is already printed for manual opening.
    });
    child.unref();
  } catch {
    // Best-effort: the URL is already printed for manual opening.
  }
}
