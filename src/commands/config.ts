import { Command } from 'commander';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getGlobalConfigPath,
  getGlobalConfig,
  saveGlobalConfig,
  GlobalConfig,
} from '../core/global-config.js';
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
  findWildcardDefinition,
  validateConfigValue,
  RETIRED_CONFIG_KEYS,
  type ConfigScope,
} from '../core/config-keys.js';
import {
  resolveConfigStoreLayer,
  resolveEffectiveConfig,
  type EffectiveConfigEntry,
} from '../core/effective-config.js';
import { readProjectConfig, updateProjectConfigKey, resolveConfigFilePath } from '../core/project-config.js';
import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { WORKSPACE_DIR_NAME } from '../core/config.js';
import { CORE_WORKFLOWS, ALL_WORKFLOWS, getCurrentBuiltInWorkflowIds } from '../core/profiles.js';
import { isPromptCancellationError } from './shared-output.js';
import { runUiLaunch } from './ui-launch.js';
import { runLegacyConfigProfileCommand } from './profile.js';
import {
  configDescription,
  configGroup,
  createConfigDiagnosticReporter,
  getConfigCommandMessages,
  getConfigEditorMessages,
} from './config-messages.js';
import { getCliLocale } from '../core/cli-locale.js';
import type { CliLocale } from '../utils/locale.js';

export {
  deriveProfileFromWorkflowSelection,
  diffProfileState,
  formatWorkflowSummary,
  resolveCurrentProfileState,
} from './profile-editor.js';

/**
 * Resolve `--scope` from the subcommand's merged (own + inherited) options,
 * validating it as `global` (default) | `project`. Reports an error and sets
 * a non-zero exit code (rather than calling `process.exit`, for testability)
 * on any other value, naming the accepted scopes, and returns `undefined` so
 * callers can bail out early.
 */
function resolveScope(command: Command): ConfigScope | undefined {
  const messages = getConfigCommandMessages();
  const scope = (command.optsWithGlobals() as { scope?: string }).scope ?? 'global';
  if (scope !== 'global' && scope !== 'project') {
    console.error(messages.invalidScope(scope));
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
  const messages = getConfigCommandMessages();
  const root = findRepoPlanningRootSync(process.cwd());
  if (!root) {
    console.error(messages.projectNotFound(WORKSPACE_DIR_NAME));
    console.error(messages.projectInitGuidance);
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

function getGlobalConfigForCli(locale: CliLocale = getCliLocale()): GlobalConfig {
  return getGlobalConfig({ reporter: createConfigDiagnosticReporter(locale) });
}

function readProjectConfigForCli(
  projectRoot: string,
  locale: CliLocale = getCliLocale()
) {
  return readProjectConfig(projectRoot, {
    reporter: createConfigDiagnosticReporter(locale),
  });
}

/** Renders an effective-config value for CLI display: scalars as-is, containers as JSON. */
function formatEntryValue(value: unknown, locale: CliLocale = getCliLocale()): string {
  if (value === undefined) return getConfigEditorMessages(locale).unsetValue;
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
async function printEffectiveConfigView(): Promise<void> {
  const locale = getCliLocale();
  const ui = getConfigEditorMessages(locale);
  const projectRoot = findRepoPlanningRootSync(process.cwd()) ?? undefined;
  const storeLayer = await resolveConfigStoreLayer(projectRoot);
  const entries = resolveEffectiveConfig({
    projectRoot,
    store: storeLayer,
    reporter: createConfigDiagnosticReporter(locale),
  });

  for (const entry of entries) {
    console.log(
      `${entry.definition.key} = ${formatEntryValue(entry.value, locale)} (${ui.source[entry.source]})`
    );
  }
  console.log();
  console.log(ui.effectiveHelp);
}

type ChalkModule = typeof import('chalk')['default'];
type InquirerModule = typeof import('@inquirer/prompts');

/** Builds one `select` row for the interactive editor, per D6's non-editable-row rules. */
function buildEditorChoice(
  entry: EffectiveConfigEntry,
  projectRoot: string | undefined,
  chalk: ChalkModule,
  locale: CliLocale
): { value: string; name: string; description?: string; disabled?: boolean | string } {
  const ui = getConfigEditorMessages(locale);
  const definition = entry.definition;
  const localizedSource = ui.source[entry.source];
  const sourceLabel = entry.source === 'default' ? chalk.dim(localizedSource) : localizedSource;
  let label = `${configGroup(definition.group, locale)} / ${definition.key} = ${formatEntryValue(entry.value, locale)} (${sourceLabel})`;

  if (entry.source === 'env-override') {
    label += chalk.yellow(ui.environmentOverrideNote);
  }

  if (definition.key === 'workflows') {
    return {
      value: '__workflows__',
      name: label,
      description: ui.workflowsDescription,
      disabled: ui.workflowsDisabled,
    };
  }

  // `ui.pinnedSpaces` is the second-ever array key and, like `workflows`, has
  // no interactive array prompt — render it as a disabled row pointing at the
  // Spaces page rather than letting the editor try to prompt an array type.
  if (definition.key === 'ui.pinnedSpaces') {
    return {
      value: '__pinnedSpaces__',
      name: label,
      description: ui.pinnedSpacesDescription,
      disabled: ui.pinnedSpacesDisabled,
    };
  }

  // "Project-only" for the EDITOR's write targets means: settable at project
  // scope but NOT global. The `store` scope is not a CLI write target (W1
  // Non-Goal), so a store+project key (e.g. `schema`) is still edited at
  // project scope, exactly like a project-only key.
  const isProjectOnly =
    definition.scopes.includes('project') && !definition.scopes.includes('global');
  if (isProjectOnly && !projectRoot) {
    return {
      value: definition.key,
      name: label,
      disabled: ui.projectRequired,
    };
  }

  return { value: definition.key, name: label, description: configDescription(definition, locale) };
}

/** Prompts for and writes a new value for one registry key, per its type/scope. */
async function editConfigEntry(
  entry: EffectiveConfigEntry,
  projectRoot: string | undefined,
  inquirer: Pick<InquirerModule, 'select' | 'input'>,
  chalk: ChalkModule,
  locale: CliLocale
): Promise<void> {
  const ui = getConfigEditorMessages(locale);
  const definition = entry.definition;

  // The editor writes to global or project only — `store` is not a CLI write
  // target in W1 (design Non-Goal). A key settable at BOTH global and project
  // prompts for which; a project-settable-but-not-global key (project-only or
  // store+project) writes to project; everything else writes to global.
  const settableGlobal = definition.scopes.includes('global');
  const settableProject = definition.scopes.includes('project');
  let scope: ConfigScope;
  if (settableGlobal && settableProject && projectRoot) {
    scope = await inquirer.select<ConfigScope>({
      message: ui.scopePrompt(definition.key),
      choices: [
        { value: 'project', name: ui.projectScope },
        { value: 'global', name: ui.globalScope },
      ],
    });
  } else if (settableProject && projectRoot) {
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
      message: ui.thresholdPrompt(definition.key),
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
    console.error(chalk.red(`${ui.errorPrefix} ${valueError}`));
    return;
  }

  if (scope === 'project') {
    if (!projectRoot) return;
    try {
      updateProjectConfigKey(projectRoot, definition.key, rawValue, {
        reporter: createConfigDiagnosticReporter(locale),
      });
    } catch (error) {
      console.error(
        chalk.red(`${ui.errorPrefix} ${error instanceof Error ? error.message : String(error)}`)
      );
      return;
    }
  } else {
    const config = getGlobalConfigForCli(locale) as Record<string, unknown>;
    const newConfig = JSON.parse(JSON.stringify(config));
    setNestedValue(newConfig, definition.key, rawValue);
    const validation = validateConfig(newConfig);
    if (!validation.success) {
      console.error(
        chalk.red(`${ui.errorPrefix} ${ui.invalidConfiguration(String(validation.error))}`)
      );
      return;
    }
    setNestedValue(config, definition.key, rawValue);
    // Setting `workflows` persists a user-wide selection, so it must seed the
    // known-built-in baseline like every other selection-persisting path
    // (applyProfileState/init/migration); otherwise a later `update` could
    // under-surface a genuinely new built-in against a stale baseline.
    if (definition.key === 'workflows') {
      (config as GlobalConfig).knownBuiltInWorkflows = getCurrentBuiltInWorkflowIds();
    }
    saveGlobalConfig(config as GlobalConfig);
  }

  console.log(ui.setValue(definition.key, formatSetDisplayValue(rawValue)));

  // Relocation hint (archive-destination spec): a config-only destination flip
  // leaves existing archives where they are. When the repo archive is
  // non-empty, point at `archive relocate` so data and config move together.
  if (
    scope === 'project' &&
    projectRoot &&
    definition.key === 'archive.destination' &&
    (rawValue === 'external' || rawValue === 'prune')
  ) {
    maybeEmitRelocateHint(projectRoot, String(rawValue));
  }
}

/**
 * Prints the `archive relocate` hint when a config-only destination flip leaves
 * a non-empty in-repo archive behind (archive-destination spec). Sync (the
 * `config set` write path is synchronous).
 */
function maybeEmitRelocateHint(projectRoot: string, value: string): void {
  if (value !== 'external' && value !== 'prune') return;
  const archiveDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', 'archive');
  let nonEmpty = false;
  try {
    nonEmpty = fs.readdirSync(archiveDir).length > 0;
  } catch {
    nonEmpty = false;
  }
  if (!nonEmpty) return;
  console.log(
    `Note: existing archives remain in the repo. Run 'rasen archive relocate --to ${value === 'external' ? 'external' : 'in-repo'}' to move them together with the config${value === 'prune' ? " (prune deletes rather than relocates; relocate does not target prune)" : ''}.`
  );
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
  const locale = getCliLocale();
  const ui = getConfigEditorMessages(locale);

  const projectRoot = findRepoPlanningRootSync(process.cwd()) ?? undefined;
  const storeLayer = await resolveConfigStoreLayer(projectRoot);

  try {
    for (;;) {
      const entries = resolveEffectiveConfig({
        projectRoot,
        store: storeLayer,
        reporter: createConfigDiagnosticReporter(locale),
      });

      const byGroup = new Map<string, EffectiveConfigEntry[]>();
      for (const entry of entries) {
        const group = configGroup(entry.definition.group, locale);
        const list = byGroup.get(group) ?? [];
        list.push(entry);
        byGroup.set(group, list);
      }

      type EditorChoice = ReturnType<typeof buildEditorChoice> | InstanceType<typeof Separator>;
      const choices: EditorChoice[] = [];
      for (const [group, groupEntries] of byGroup) {
        choices.push(new Separator(chalk.bold(`-- ${group} --`)));
        for (const entry of groupEntries) {
          choices.push(buildEditorChoice(entry, projectRoot, chalk, locale));
        }
      }
      choices.push(new Separator());
      choices.push({ value: '__exit__', name: ui.exit });

      console.log(chalk.bold(ui.heading));
      if (!projectRoot) {
        console.log(chalk.dim(ui.outsideProject));
      }

      const picked = await select<string>({
        message: ui.selectKey,
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
        console.log(ui.manageWorkflows);
        continue;
      }

      const entry = entries.find((e) => e.definition.key === picked);
      if (!entry) continue;

      await editConfigEntry(entry, projectRoot, inquirer, chalk, locale);
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
        await printEffectiveConfigView();
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
          const projectConfig = readProjectConfigForCli(projectRoot) ?? {};
          console.log(options.json ? JSON.stringify(projectConfig, null, 2) : formatValueYaml(projectConfig));
          return;
        }

        const config = getGlobalConfigForCli();

        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          const messages = getConfigCommandMessages();
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
          const profileSource = rawConfig.profile !== undefined
            ? messages.explicitSource
            : messages.defaultSource;
          console.log(`\n${messages.profileSettingsHeading}`);
          console.log(`  profile: ${config.profile} ${profileSource}`);
          if (config.profile === 'full') {
            console.log(`  workflows: ${ALL_WORKFLOWS.join(', ')} ${messages.fromFullProfile}`);
          } else if (config.profile === 'core') {
            console.log(`  workflows: ${CORE_WORKFLOWS.join(', ')} ${messages.fromCoreProfile}`);
          } else if (config.workflows && config.workflows.length > 0) {
            console.log(`  workflows: ${config.workflows.join(', ')} ${messages.explicitSource}`);
          } else {
            console.log(`  workflows: ${messages.noneValue}`);
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
          const projectConfig = readProjectConfigForCli(projectRoot) ?? {};
          value = getNestedValue(projectConfig as Record<string, unknown>, key);
        } else {
          const config = getGlobalConfigForCli();
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
          const messages = getConfigCommandMessages();

          // Retired keys (e.g. `delivery`) are recognized by name and routed
          // to a friendly notice — no persistence, no crash — rather than
          // the generic "unknown key" error a bare registry removal would
          // otherwise produce (design D4).
          if (scope === 'global' && RETIRED_CONFIG_KEYS.has(key)) {
            console.log(messages.retiredKey(key));
            return;
          }

          const allowUnknown = scope === 'global' && Boolean(options.allowUnknown);
          const keyValidation = validateConfigKeyPath(key, scope);
          if (!keyValidation.valid && !allowUnknown) {
            const reason = keyValidation.reason ? ` ${keyValidation.reason}.` : '';
            console.error(messages.invalidKey(key, reason));
            console.error(
              messages.listKeysGuidance(
                `rasen config list${scope === 'project' ? ' --scope project' : ''}`
              )
            );
            if (scope === 'global') {
              console.error(messages.allowUnknownGuidance);
            }
            process.exitCode = 1;
            return;
          }

          const coercedValue = coerceValue(value, options.string || false);

          // Project scope has no whole-object schema gate on the write path
          // (unlike global's validateConfig() below), so the registry's
          // per-key type/range check is the only pre-write validation —
          // apply it here. A wildcard family instance (e.g.
          // `pipelines.x.gates.propose`) resolves through the family matcher,
          // since `findConfigKeyDefinition` only returns fixed keys; without
          // this a junk instance value would write to config.yaml unchecked
          // and be silently dropped on read. Global scope skips this whole
          // block: global's `validateConfig()` already gates wildcard values
          // via the schema.
          if (scope === 'project') {
            const definition =
              findConfigKeyDefinition(key, scope) ?? findWildcardDefinition(key, scope);
            if (definition) {
              const valueError = validateConfigValue(definition, coercedValue);
              if (valueError) {
                console.error(messages.errorWithDetail(valueError));
                process.exitCode = 1;
                return;
              }
            }
          }

          if (scope === 'project') {
            const projectRoot = resolveProjectRootOrFail();
            if (!projectRoot) return;
            try {
              updateProjectConfigKey(projectRoot, key, coercedValue, {
                reporter: createConfigDiagnosticReporter(),
              });
            } catch (error) {
              console.error(
                messages.errorWithDetail(error instanceof Error ? error.message : String(error))
              );
              process.exitCode = 1;
              return;
            }
          } else {
            const config = getGlobalConfigForCli() as Record<string, unknown>;

            // Create a copy to validate before saving
            const newConfig = JSON.parse(JSON.stringify(config));
            setNestedValue(newConfig, key, coercedValue);

            // Validate the new config
            const validation = validateConfig(newConfig);
            if (!validation.success) {
              console.error(messages.invalidConfiguration(String(validation.error)));
              process.exitCode = 1;
              return;
            }

            // Apply changes and save
            setNestedValue(config, key, coercedValue);
            // Setting `workflows` persists a user-wide selection, so seed the
            // known-built-in baseline like every other selection-persisting
            // path; a stale baseline would let `update` under-surface a new
            // built-in workflow later.
            if (key === 'workflows') {
              (config as GlobalConfig).knownBuiltInWorkflows = getCurrentBuiltInWorkflowIds();
            }
            saveGlobalConfig(config as GlobalConfig);
          }

          console.log(messages.setValue(key, formatSetDisplayValue(coercedValue)));

          if (
            scope === 'project' &&
            key === 'archive.destination' &&
            (coercedValue === 'external' || coercedValue === 'prune')
          ) {
            const projectRoot = resolveProjectRootOrFail();
            if (projectRoot) {
              maybeEmitRelocateHint(projectRoot, String(coercedValue));
            }
          }
        });
      }
    );

  // config unset
  configCmd
    .command('unset <key>')
    .description('Remove a key (revert to default)')
    .action((key: string, _options: unknown, command: Command) => {
      runScoped(command, (scope) => {
        const messages = getConfigCommandMessages();

        if (scope === 'global' && RETIRED_CONFIG_KEYS.has(key)) {
          console.log(messages.retiredKey(key));
          return;
        }

        if (scope === 'project') {
          // Registry-gated like `set`: unset must not delete hand-edit-only
          // fields (context, rules, quality-rules, ...) the design explicitly
          // keeps out of CLI editing.
          const keyValidation = validateConfigKeyPath(key, scope);
          if (!keyValidation.valid) {
            const reason = keyValidation.reason ? ` ${keyValidation.reason}.` : '';
            console.error(messages.invalidKey(key, reason));
            console.error(messages.listKeysGuidance('rasen config list --scope project'));
            process.exitCode = 1;
            return;
          }

          const projectRoot = resolveProjectRootOrFail();
          if (!projectRoot) return;
          let result: { existed: boolean };
          try {
            result = updateProjectConfigKey(projectRoot, key, undefined, {
              reporter: createConfigDiagnosticReporter(),
            });
          } catch (error) {
            console.error(
              messages.errorWithDetail(error instanceof Error ? error.message : String(error))
            );
            process.exitCode = 1;
            return;
          }
          console.log(
            result.existed ? messages.unsetValue(key) : messages.keyNotSet(key)
          );
          return;
        }

        const config = getGlobalConfigForCli() as Record<string, unknown>;
        const existed = deleteNestedValue(config, key);

        if (existed) {
          saveGlobalConfig(config as GlobalConfig);
          console.log(messages.unsetValue(key));
        } else {
          console.log(messages.keyNotSet(key));
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
      const messages = getConfigCommandMessages();
      const scope = resolveScope(command);
      if (!scope) return;
      if (scope === 'project') {
        console.error(messages.resetGlobalOnly);
        console.error(messages.resetProjectGuidance(WORKSPACE_DIR_NAME));
        process.exitCode = 1;
        return;
      }

      if (!options.all) {
        console.error(messages.resetAllRequired);
        console.error(messages.resetUsage);
        process.exitCode = 1;
        return;
      }

      if (!options.yes) {
        const { confirm } = await import('@inquirer/prompts');
        let confirmed: boolean;
        try {
          confirmed = await confirm({
            message: messages.resetPrompt,
            default: false,
          });
        } catch (error) {
          if (isPromptCancellationError(error)) {
            console.log(messages.resetCancelled);
            process.exitCode = 130;
            return;
          }
          throw error;
        }

        if (!confirmed) {
          console.log(messages.resetCancelled);
          return;
        }
      }

      saveGlobalConfig({ ...DEFAULT_CONFIG });
      console.log(messages.resetComplete);
    });

  // config edit
  configCmd
    .command('edit')
    .description('Open config in $EDITOR (global scope only)')
    .action(async (_options: unknown, command: Command) => {
      const messages = getConfigCommandMessages();
      const scope = resolveScope(command);
      if (!scope) return;
      if (scope === 'project') {
        console.error(messages.editGlobalOnly);
        console.error(messages.editProjectGuidance(WORKSPACE_DIR_NAME));
        process.exitCode = 1;
        return;
      }

      const editor = process.env.EDITOR || process.env.VISUAL;

      if (!editor) {
        console.error(messages.noEditor);
        console.error(messages.editorGuidance);
        console.error(messages.editorExample);
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
            reject(new Error(messages.editorExited(code)));
          }
        });
        child.on('error', reject);
      });

      try {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const parsedConfig = JSON.parse(rawConfig);
        const validation = validateConfig(parsedConfig);

        if (!validation.success) {
          console.error(messages.invalidConfiguration(String(validation.error)));
          process.exitCode = 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(messages.configFileNotFound(configPath));
        } else if (error instanceof SyntaxError) {
          console.error(messages.invalidJson(configPath));
          console.error(error.message);
        } else {
          console.error(
            messages.unableToValidate(error instanceof Error ? error.message : String(error))
          );
        }
        process.exitCode = 1;
      }
    });

  // config profile [preset]
  configCmd
    .command('profile [preset]')
    .description('Compatibility alias for `rasen profile`')
    .action(async (preset?: string) => {
      await runLegacyConfigProfileCommand(preset);
    });

  // config ui — deprecated alias (design D1): launches the same unified
  // management server as `rasen ui`, opens the config view, and prints a
  // one-line deprecation notice. Thin wrapper over the shared launch flow.
  configCmd
    .command('ui')
    .description('[Deprecated: use `rasen ui`] Start the localhost management server and open the config view')
    .option('--no-open', 'Do not open the default browser')
    .option('--port <n>', 'Pin the listen port (default: ephemeral)')
    .action(async (options: { open?: boolean; port?: string }) => {
      await runUiLaunch(options, {
        entryPath: '/config',
        label: 'Config UI',
        serverLabel: 'management server',
        notice: 'Notice: `rasen config ui` is deprecated — use `rasen ui` instead.',
      });
    });
}
