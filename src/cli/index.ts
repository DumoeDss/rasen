import { asStatus } from '../commands/shared-output.js';
import { Command, Option } from 'commander';
import { createRequire } from 'module';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { getToolsWithSkillsDir } from '../core/shared/index.js';
import { UpdateCommand } from '../core/update.js';
import { ListCommand } from '../core/list.js';
import { ArchiveCommand, type ArchiveOptions } from '../core/archive.js';
import { ViewCommand } from '../core/view.js';
import { resolveRootForCommand, toRootOutput } from '../core/root-selection.js';
import { ValidateCommand } from '../commands/validate.js';
import { ShowCommand } from '../commands/show.js';
import { CompletionCommand } from '../commands/completion.js';
import { FeedbackCommand } from '../commands/feedback.js';
import { registerConfigCommand } from '../commands/config.js';
import { registerUiCommand } from '../commands/ui.js';
import { registerDaemonCommand } from '../commands/daemon.js';
import { registerProfileCommand } from '../commands/profile.js';
import { registerSchemaCommand } from '../commands/schema.js';
import { PipelineCommand } from '../commands/pipeline.js';
import { PipelineLibraryCommand } from '../commands/pipeline-library.js';
import { formatPipelineError } from '../commands/pipeline-messages.js';
import { AgentCommand } from '../commands/agent.js';
import { registerStoreCommand } from '../commands/store.js';
import { registerDoctorCommand } from '../commands/doctor.js';
import { registerContextCommand } from '../commands/context.js';
import { registerWorksetCommand } from '../commands/workset.js';
import { registerWorkCommand } from '../commands/work.js';
import { registerWorkflowLibraryCommand } from '../commands/workflow-library.js';
import {
  statusCommand,
  instructionsCommand,
  applyInstructionsCommand,
  templatesCommand,
  schemasCommand,
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions,
  type TemplatesOptions,
  type SchemasOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';
import { adoptLegacyMachineData } from '../core/global-config.js';
import { COMMON_FLAGS } from '../core/completions/shared-flags.js';
import { isInteractive } from '../utils/interactive.js';
import { localizeProgramHelp, ROOT_OPTION_DESCRIPTIONS } from './help-localization.js';

const STORE_OPTION_DESCRIPTION = COMMON_FLAGS.store.description;
const PROJECT_OPTION_DESCRIPTION = COMMON_FLAGS.project.description;

// Deliberate rejection path: --store-path stays registered (hidden) so the
// resolver can explain that registering the path is the supported route,
// instead of Commander emitting a generic unknown-option error (or, for
// `show`, silently ignoring it via allowUnknownOption).
function hiddenStorePathOption(): Option {
  return new Option(
    '--store-path <path>',
    'Not supported; register the path with "rasen store register <path>" and use --store <id>'
  ).hideHelp();
}

function failWithError(
  error: unknown,
  json?: { enabled: boolean | undefined; payload?: Record<string, unknown>; fallbackCode?: string }
): void {
  // The agent contract: every --json failure leaves exactly one JSON
  // document on stdout (the command's null-shape plus a status array).
  if (json?.enabled) {
    console.log(
      JSON.stringify(
        { ...(json.payload ?? {}), status: [asStatus(error, json.fallbackCode ?? 'command_error')] },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }
  ora().fail(`Error: ${(error as Error).message}`);
  // Resolution and store errors carry a pasteable fix - never drop it.
  const fix = (error as { diagnostic?: { fix?: string } }).diagnostic?.fix;
  if (fix) {
    console.error(`Fix: ${fix}`);
  }
  process.exitCode = process.exitCode ?? 1;
}

function failPipelineAction(error: unknown): never {
  console.log();
  ora().fail(formatPipelineError(error));
  process.exit(1);
}

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/**
 * Get the full command path for nested commands.
 * For example: 'change show' -> 'change:show'
 */
export function getCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root 'rasen' command
    if (name && name !== 'rasen') {
      names.unshift(name);
    }
    current = current.parent;
  }

  return names.join(':') || 'rasen';
}

program
  .name('rasen')
  .description('AI-native system for spec-driven development')
  .version(version);

// Global options
program.option('--no-color', ROOT_OPTION_DESCRIPTIONS[0]);

// Apply global flags and telemetry before any command runs
// Note: preAction receives (thisCommand, actionCommand) where:
// - thisCommand: the command where hook was added (root program)
// - actionCommand: the command actually being executed (subcommand)
program.hook('preAction', async (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }

  // Do not print the first-run telemetry notice into machine-readable output.
  // JSON commands must emit JSON only on stdout.
  const actionOpts = actionCommand.opts();
  if (!actionOpts.json) {
    await maybeShowTelemetryNotice();
  }

  // Track command execution (use actionCommand to get the actual subcommand)
  const commandPath = getCommandPath(actionCommand);
  await trackCommand(commandPath, version);
});

// Shutdown telemetry after command completes
program.hook('postAction', async () => {
  await shutdown();
});

const availableToolIds = getToolsWithSkillsDir();
const toolsOptionDescription = `Configure AI tools non-interactively. Use "all", "none", or a comma-separated list of: ${availableToolIds.join(', ')}`;

program
  .command('init [path]')
  .description('Initialize Rasen in your project')
  .option('--tools <tools>', toolsOptionDescription)
  .option('--force', 'Auto-cleanup legacy files without prompting')
  .option('--profile <profile>', 'Override global config profile (full, core, or custom)')
  .action(async (targetPath = '.', options?: { tools?: string; force?: boolean; profile?: string }) => {
    try {
      // Validate that the path is a valid directory
      const resolvedPath = path.resolve(targetPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path "${targetPath}" is not a directory`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, but we can create it
          console.log(`Directory "${targetPath}" doesn't exist, it will be created.`);
        } else if (error.message && error.message.includes('not a directory')) {
          throw error;
        } else {
          throw new Error(`Cannot access path "${targetPath}": ${error.message}`);
        }
      }

      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tools,
        force: options?.force,
        profile: options?.profile,
      });
      await initCommand.execute(targetPath);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden alias: 'experimental' -> 'init' for backwards compatibility
program
  .command('experimental', { hidden: true })
  .description('Alias for init (deprecated)')
  .option('--tool <tool-id>', 'Target AI tool (maps to --tools)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options?: { tool?: string; noInteractive?: boolean }) => {
    try {
      console.log('Note: "rasen experimental" is deprecated. Use "rasen init" instead.');
      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tool,
        interactive: options?.noInteractive === true ? false : undefined,
      });
      await initCommand.execute('.');
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('update [path]')
  .description('Update Rasen instruction files')
  .option('--force', 'Force update even when tools are up to date')
  .action(async (targetPath = '.', options?: { force?: boolean }) => {
    try {
      const updateCommand = new UpdateCommand({ force: options?.force });
      await updateCommand.execute(targetPath);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('migrate [path]')
  .description('Copy a legacy openspec/ workspace into rasen/ (copy-only; originals untouched)')
  .option('--no-interactive', 'Do not prompt (skips optional marker-block cleanup)')
  .action(async (targetPath = '.', options?: { interactive?: boolean }) => {
    try {
      const projectRoot = path.resolve(targetPath);
      const { migrateWorkspace, formatMigrationSummary, hasLegacyWorkspace } =
        await import('../core/workspace-migration.js');

      if (!hasLegacyWorkspace(projectRoot)) {
        console.log(
          'No legacy openspec/ workspace found here. Run "rasen init" to create a new rasen/ workspace.'
        );
        return;
      }

      const summary = migrateWorkspace(projectRoot);
      console.log(formatMigrationSummary(summary));
      if (summary.failed.length > 0) {
        process.exitCode = 1;
      }

      // Consent-gated (default no) marker-block cleanup: only inside the migrate
      // flow, and only when interactive, may rasen remove OpenSpec marker blocks
      // from shared config files (they may belong to upstream OpenSpec).
      if (isInteractive(options)) {
        const { detectLegacyArtifacts, cleanupMarkerBlocks } = await import(
          '../core/legacy-cleanup.js'
        );
        const detection = await detectLegacyArtifacts(projectRoot);
        if (detection.configFilesToUpdate.length > 0) {
          const { confirm } = await import('@inquirer/prompts');
          const shouldClean = await confirm({
            message: `Remove OpenSpec marker blocks from ${detection.configFilesToUpdate.join(', ')}? (they may be used by upstream OpenSpec)`,
            default: false,
          });
          if (shouldClean) {
            const { modifiedFiles, errors } = await cleanupMarkerBlocks(projectRoot, detection);
            if (modifiedFiles.length > 0) {
              console.log(`Removed OpenSpec markers from: ${modifiedFiles.join(', ')}`);
            }
            for (const error of errors) {
              console.log(`  ⚠ ${error}`);
            }
          } else {
            console.log('Keeping marker blocks. You can remove them manually anytime.');
          }
        }
      }
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List items (changes by default). Use --specs to list specs.')
  .option('--specs', 'List specs instead of changes')
  .option('--changes', 'List changes explicitly (default)')
  .option('--sort <order>', 'Sort order: "recent" (default) or "name"', 'recent')
  .option('--long', 'Show id and title with counts')
  .option('--json', 'Output as JSON (for programmatic use)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; long?: boolean; json?: boolean; store?: string; project?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options ?? {}, {
        json: options?.json,
        failurePayload: options?.specs ? { specs: [], root: null } : { changes: [], root: null },
      });
      if (!root) {
        return;
      }
      const listCommand = new ListCommand();
      const mode: 'changes' | 'specs' = options?.specs ? 'specs' : 'changes';
      const sort = options?.sort === 'name' ? 'name' : 'recent';
      await listCommand.execute(root.path, mode, {
        sort,
        long: options?.long,
        json: options?.json,
        ...(options?.json ? { root: toRootOutput(root) } : {}),
      });
    } catch (error) {
      failWithError(error, {
        enabled: options?.json,
        payload: options?.specs ? { specs: [], root: null } : { changes: [], root: null },
        fallbackCode: 'list_error',
      });
      process.exit(1);
    }
  });

program
  .command('view')
  .description('Display an interactive dashboard of specs and changes')
  .action(async () => {
    try {
      const viewCommand = new ViewCommand();
      await viewCommand.execute('.');
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('archive [change-name]')
  .description('Archive a completed change and update main specs')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--confirm-prune', "Confirm a 'prune' destination's permanent deletion (separate from --yes; required in addition to it)")
  .option('--skip-specs', 'Skip spec update operations (useful for infrastructure, tooling, or doc-only changes)')
  .option('--no-validate', 'Skip validation (not recommended, requires confirmation)')
  .option('--json', 'Output as JSON (non-interactive)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (changeName?: string, options?: ArchiveOptions) => {
    try {
      const archiveCommand = new ArchiveCommand();
      await archiveCommand.execute(changeName, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

registerConfigCommand(program);
registerUiCommand(program);
registerDaemonCommand(program);
registerProfileCommand(program);
registerSchemaCommand(program);
registerStoreCommand(program);
registerDoctorCommand(program);
registerContextCommand(program);
registerWorksetCommand(program);
registerWorkCommand(program);
registerWorkflowLibraryCommand(program);

// Top-level validate command
program
  .command('validate [item-name]')
  .description('Validate changes, specs, and pipelines')
  .option('--all', 'Validate all changes, specs, and pipelines')
  .option('--changes', 'Validate all changes')
  .option('--specs', 'Validate all specs')
  .option('--pipelines', 'Validate all pipelines')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec|pipeline')
  .option('--strict', 'Enable strict validation mode')
  .option('--json', 'Output validation results as JSON')
  .option('--concurrency <n>', 'Max concurrent validations (defaults to env RASEN_CONCURRENCY or 6)')
  .option('--no-interactive', 'Disable interactive prompts')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (itemName?: string, options?: { all?: boolean; changes?: boolean; specs?: boolean; pipelines?: boolean; type?: string; strict?: boolean; json?: boolean; noInteractive?: boolean; concurrency?: string; store?: string; project?: string; storePath?: string }) => {
    try {
      const validateCommand = new ValidateCommand();
      await validateCommand.execute(itemName, options);
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: 'validate_error' });
      process.exit(1);
    }
  });

// Top-level show command
program
  .command('show [item-name]')
  .description('Show a change or spec')
  .option('--json', 'Output as JSON')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec')
  .option('--no-interactive', 'Disable interactive prompts')
  // change-only flags
  .option('--deltas-only', 'Show only deltas (JSON only, change)')
  .option('--requirements-only', 'Alias for --deltas-only (deprecated, change)')
  // spec-only flags
  .option('--requirements', 'JSON only: Show only requirements (exclude scenarios)')
  .option('--no-scenarios', 'JSON only: Exclude scenario content')
  .option('-r, --requirement <id>', 'JSON only: Show specific requirement by ID (1-based)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  // Explicit registration required: allowUnknownOption would otherwise
  // silently swallow --store-path instead of rejecting it deliberately.
  .addOption(hiddenStorePathOption())
  // allow unknown options to pass-through to underlying command implementation
  .allowUnknownOption(true)
  .action(async (itemName?: string, options?: { json?: boolean; type?: string; noInteractive?: boolean; [k: string]: any }) => {
    try {
      const showCommand = new ShowCommand();
      await showCommand.execute(itemName, options ?? {});
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: 'show_error' });
      process.exit(1);
    }
  });

// Feedback command
program
  .command('feedback <message>')
  .description('Submit feedback about Rasen')
  .option('--body <text>', 'Detailed description for the feedback')
  .action(async (message: string, options?: { body?: string }) => {
    try {
      const feedbackCommand = new FeedbackCommand();
      await feedbackCommand.execute(message, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Completion command with subcommands
const completionCmd = program
  .command('completion')
  .description('Manage shell completions for Rasen CLI');

completionCmd
  .command('generate [shell]')
  .description('Generate completion script for a shell (outputs to stdout)')
  .action(async (shell?: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.generate({ shell });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('install [shell]')
  .description('Install completion script for a shell')
  .option('--verbose', 'Show detailed installation output')
  .action(async (shell?: string, options?: { verbose?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.install({ shell, verbose: options?.verbose });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('uninstall [shell]')
  .description('Uninstall completion script for a shell')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (shell?: string, options?: { yes?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.uninstall({ shell, yes: options?.yes });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden command for machine-readable completion data
program
  .command('__complete <type>', { hidden: true })
  .description('Output completion data in machine-readable format (internal use)')
  .action(async (type: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.complete({ type });
    } catch (error) {
      // Silently fail for graceful shell completion experience
      process.exitCode = 1;
    }
  });

// ═══════════════════════════════════════════════════════════
// Workflow Commands (formerly experimental)
// ═══════════════════════════════════════════════════════════

// Status command
program
  .command('status')
  .description('Display artifact completion status for a change')
  .option('--change <id>', 'Change name to show status for')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: StatusOptions) => {
    try {
      await statusCommand(options);
    } catch (error) {
      failWithError(error, { enabled: options.json, fallbackCode: 'change_error' });
      process.exit(1);
    }
  });

// Instructions command
program
  .command('instructions [artifact]')
  .description('Output enriched instructions for creating an artifact or applying tasks')
  .option('--change <id>', 'Change name')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (artifactId: string | undefined, options: InstructionsOptions) => {
    try {
      // Special case: "apply" is not an artifact, but a command to get apply instructions
      if (artifactId === 'apply') {
        await applyInstructionsCommand(options);
      } else {
        await instructionsCommand(artifactId, options);
      }
    } catch (error) {
      failWithError(error, { enabled: options.json, fallbackCode: 'change_error' });
      process.exit(1);
    }
  });

// Templates command
program
  .command('templates')
  .description('Show resolved template paths for all artifacts in a schema')
  .option('--schema <name>', `Schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--json', 'Output as JSON mapping artifact IDs to template paths')
  .action(async (options: TemplatesOptions) => {
    try {
      await templatesCommand(options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Schemas command
program
  .command('schemas')
  .description('List available workflow schemas with descriptions')
  .option('--json', 'Output as JSON (for agent use)')
  .action(async (options: SchemasOptions) => {
    try {
      await schemasCommand(options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// New command group with change subcommand
const newCmd = program.command('new').description('Create new items');

newCmd
  .command('change <name>')
  .description('Create a new change directory')
  .option('--description <text>', 'Description to add to README.md')
  .option('--proposal <text>', 'Seed proposal.md with this text, making the change active immediately')
  .option('--goal <text>', 'Optional goal metadata to store with the change')
  .option('--schema <name>', `Workflow schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  // Removed options kept registered (hidden) so users get a deliberate
  // explanation instead of a generic unknown-option error.
  .addOption(new Option('--initiative <id>', 'No longer supported').hideHelp())
  .addOption(new Option('--areas <names>', 'No longer supported').hideHelp())
  .action(async (name: string, options: NewChangeOptions) => {
    try {
      await newChangeCommand(name, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Pipeline command group: inspect orchestration pipelines and run-state
const pipelineCmd = program
  .command('pipeline')
  .description('Inspect and manage orchestration pipelines');

pipelineCmd
  .command('list')
  .description('List available pipelines (project > user > package)')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options?: { json?: boolean; store?: string; project?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.list(options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('show <name>')
  .description('Show a pipeline stage DAG and build order')
  .option('--for-execution', 'Validate active-profile skills before returning the executable DAG')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options?: { json?: boolean; forExecution?: boolean; store?: string; project?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.show(name, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('agents <name>')
  .description('Show or set per-role Claude/Codex runtimes for a pipeline')
  .option('--planner <runtime>', 'Set planner runtime: claude or codex')
  .option('--implementer <runtime>', 'Set implementer runtime: claude or codex')
  .option('--reviewer <runtime>', 'Set reviewer runtime: claude or codex')
  .option('--fixer <runtime>', 'Set fixer runtime: claude or codex')
  .option('--shipper <runtime>', 'Set shipper runtime: claude or codex')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (
    name: string,
    options?: {
      planner?: string;
      implementer?: string;
      reviewer?: string;
      fixer?: string;
      shipper?: string;
      json?: boolean;
      store?: string;
      project?: string;
      storePath?: string;
    }
  ) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.agents(name, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('classify <task>')
  .description('Suggest a pipeline for a task (advisory keyword heuristic)')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (task: string, options?: { json?: boolean; store?: string; project?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.classify(task, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('resume <change>')
  .description("Show a change's pipeline run-state (next/remaining stages)")
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (change: string, options?: { json?: boolean; store?: string; project?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.resume(change, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('init <name>')
  .description('Create a minimal pipeline draft without installing it')
  .requiredOption('--output <path>', 'Empty pipeline draft directory to create')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options: { output: string; json?: boolean; store?: string; project?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.init(name, options);
  });

pipelineCmd
  .command('validate <name-or-path>')
  .description('Validate an installed pipeline, draft directory, or .rasenpkg')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (nameOrPath: string, options: { json?: boolean; store?: string; project?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.validate(nameOrPath, options);
  });

pipelineCmd
  .command('import <path>')
  .description('Validate and atomically install a pipeline .rasenpkg')
  .option('--force', 'Overwrite an already-installed pipeline of the same name')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (sourcePath: string, options: { force?: boolean; json?: boolean; store?: string; project?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.import(sourcePath, options);
  });

pipelineCmd
  .command('export <name> <path>')
  .description('Export a user pipeline as .rasenpkg')
  .option('--force', 'Replace an existing destination file')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (name: string, destination: string, options: { force?: boolean; json?: boolean; store?: string; project?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.export(name, destination, options);
  });

pipelineCmd
  .command('delete <name>')
  .description('Delete an unreferenced user pipeline')
  .option('-y, --yes', 'Skip confirmation')
  .option('--force', 'Bypass the referrer guard, deleting even a still-referenced pipeline')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .option('--project <id>', PROJECT_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options: { yes?: boolean; force?: boolean; json?: boolean; store?: string; project?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.delete(name, options);
  });

// Agent command group: introspect an agent's own runtime state
const agentCmd = program
  .command('agent')
  .description('Introspect agent runtime state (context)');

agentCmd
  .command('context')
  .description('Report context-window occupancy of a transcript from its recorded usage')
  .option('--transcript <path>', 'Path to a Claude Code transcript or Codex rollout jsonl')
  .option('--latest', 'Use the newest main-session transcript for the current directory')
  .option('--dir <dir>', 'Override the Claude projects directory used by --latest')
  .option('--limit <n>', 'Override the resolved context-window limit', (v) => parseInt(v, 10))
  .option('--runtime <runtime>', 'Force detection to "claude" or "codex" instead of sniffing the file')
  .option('--json', 'Output as JSON')
  .action(async (options?: {
    transcript?: string;
    latest?: boolean;
    dir?: string;
    limit?: number;
    runtime?: string;
    json?: boolean;
  }) => {
    try {
      const agentCommand = new AgentCommand();
      await agentCommand.context(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

agentCmd
  .command('wait')
  .description('One cache-keepalive beat: block briefly polling the change\'s role signal file')
  .requiredOption('--change <name>', 'Change whose signals directory to poll')
  .requiredOption('--role <key>', 'Role key identifying this worker\'s signal file (e.g. reviewer, impl-spaces)')
  .option('--max-beats <n>', 'Override the default beat cap (12)', (v) => parseInt(v, 10))
  .option('--context-tokens <n>', 'Self-reported context size; below the keepalive floor stands down immediately', (v) => parseInt(v, 10))
  .option('--beat-seconds <s>', 'Beat duration in seconds (default 270, max 300)', (v) => parseInt(v, 10))
  .action(async (options: {
    change: string;
    role: string;
    maxBeats?: number;
    contextTokens?: number;
    beatSeconds?: number;
  }) => {
    try {
      const agentCommand = new AgentCommand();
      await agentCommand.wait(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

export { program };

export function runCli(argv = process.argv): void {
  // One-time adoption of legacy machine data (brand rename + root
  // relocation) into the resolved config/data locations. Best-effort and
  // synchronous; must run before any config is read.
  adoptLegacyMachineData();
  localizeProgramHelp(program);
  program.parse(argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
