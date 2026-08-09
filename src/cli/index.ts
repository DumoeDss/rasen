import { asStatus } from '../commands/shared-output.js';
import { Command, Option } from 'commander';
import { createRequire } from 'module';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
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
import { registerSchemeCommand } from '../commands/scheme.js';
import { registerKnowledgeCommand } from '../commands/knowledge.js';
import { registerSchemaCommand } from '../commands/schema.js';
import { PipelineCommand } from '../commands/pipeline.js';
import { registerRetainCommand } from '../commands/retain.js';
import { PipelineLibraryCommand } from '../commands/pipeline-library.js';
import { formatPipelineError } from '../commands/pipeline-messages.js';
import { AgentCommand } from '../commands/agent.js';
import { registerStoreCommand } from '../commands/store.js';
import { registerBootstrapCommand } from '../commands/bootstrap.js';
import {
  registerArchiveRelocateSubcommand,
  registerHomeCommand,
} from '../commands/store-migration.js';
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
  type StatusOptions,
  type InstructionsOptions,
  type TemplatesOptions,
  type SchemasOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';
import { adoptLegacyMachineData } from '../core/global-config.js';
import { isInteractive } from '../utils/interactive.js';
import { getCliLocale } from '../core/cli-locale.js';
import { resolveCliPresentation } from '../core/completions/cli-presentation.js';
import type {
  CliPresentationFacts,
  ResolvedCliPresentation,
} from '../core/completions/types.js';
import type { CliLocale } from '../utils/locale.js';
import { applyCliPresentation } from './commander-presentation.js';
import { formatCliVersion } from '../core/shared/build-info.js';

// Deliberate rejection path: --store-path stays registered (hidden) so the
// resolver can explain that registering the path is the supported route,
// instead of Commander emitting a generic unknown-option error (or, for
// `show`, silently ignoring it via allowUnknownOption).
function hiddenStorePathOption(): Option {
  return new Option('--store-path <path>', '').hideHelp();
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

interface ProgramPresentationContext {
  locale: CliLocale;
  presentation: ResolvedCliPresentation;
}

function buildUnlocalizedProgram({
  locale,
  presentation,
}: ProgramPresentationContext): Command {
const program = new Command();
const createCompletionCommand = (): CompletionCommand =>
  new CompletionCommand({ locale, presentation });

program
  .name('rasen')
  .description('')
  .version(formatCliVersion(version), '-V, --version', '');

// Global options
program.option('--no-color', '');

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

program
  .command('init [path]')
  .description('')
  .option('--tools <tools>', '')
  .option('--force', '')
  .option('--profile <profile>', '')
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
  .description('')
  .option('--tool <tool-id>', '')
  .option('--no-interactive', '')
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
  .description('')
  .option('--force', '')
  .option('--all-projects', '')
  .option('--only-this', '')
  .action(async (targetPath = '.', options?: { force?: boolean; allProjects?: boolean; onlyThis?: boolean }) => {
    try {
      const updateCommand = new UpdateCommand({
        force: options?.force,
        allProjects: options?.allProjects,
        onlyThis: options?.onlyThis,
      });
      await updateCommand.execute(targetPath);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('migrate [path]')
  .description('')
  .option('--no-interactive', '')
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
  .description('')
  .option('--specs', '')
  .option('--changes', '')
  .option('--sort <order>', '', 'recent')
  .option('--long', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; long?: boolean; json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
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
        changesDir: root.changesDir,
        specsDir: root.specsDir,
        ...(root.schemasDir === undefined ? {} : { schemasDir: root.schemasDir }),
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
  .description('')
  .action(async () => {
    try {
      const viewCommand = new ViewCommand();
      await viewCommand.execute('.');
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

const archiveCommand = program
  .command('archive [change-name]')
  .description('')
  .option('-y, --yes', '')
  .option('--skip-specs', '')
  .option('--no-validate', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .option('--outcome <outcome>', '')
  .option('--reason <text>', '')
  .option('--by <changeInstanceId>', '')
  .option('--by-target-line <id>', '')
  .option('--commit <oid>', '')
  .option('--keep-ephemera', '')
  .option('--dry-run', '')
  .option('--save-plan', '')
  .option('--apply-plan <token>', '')
  .option('--abort-plan <token>', '')
  .option('--intent-template', '')
  .option('--intent-file <path>', '')
  .addOption(hiddenStorePathOption())
  .action(async (changeName?: string, options?: ArchiveOptions) => {
    try {
      const command = new ArchiveCommand();
      await command.execute(changeName, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// `rasen archive relocate` — a subcommand of the archive command (commander
// runs it instead of the parent action when `relocate` is the first operand).
registerArchiveRelocateSubcommand(archiveCommand);
registerHomeCommand(program);

registerConfigCommand(program);
registerUiCommand(program);
registerDaemonCommand(program);
registerProfileCommand(program);
registerSchemeCommand(program);
registerKnowledgeCommand(program);
registerSchemaCommand(program);
registerStoreCommand(program);
registerBootstrapCommand(program);
registerDoctorCommand(program);
registerContextCommand(program);
registerWorksetCommand(program);
registerWorkCommand(program);
registerWorkflowLibraryCommand(program);

// Top-level validate command
program
  .command('validate [item-name]')
  .description('')
  .option('--all', '')
  .option('--changes', '')
  .option('--specs', '')
  .option('--pipelines', '')
  .option('--type <type>', '')
  .option('--strict', '')
  .option('--json', '')
  .option('--concurrency <n>', '')
  .option('--no-interactive', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (itemName?: string, options?: { all?: boolean; changes?: boolean; specs?: boolean; pipelines?: boolean; type?: string; strict?: boolean; json?: boolean; noInteractive?: boolean; concurrency?: string; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
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
  .description('')
  .option('--json', '')
  .option('--type <type>', '')
  .option('--no-interactive', '')
  // change-only flags
  .option('--deltas-only', '')
  .option('--requirements-only', '')
  // spec-only flags
  .option('--requirements', '')
  .option('--no-scenarios', '')
  .option('-r, --requirement <id>', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
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
  .description('')
  .option('--body <text>', '')
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
  .description('');

completionCmd
  .command('generate [shell]')
  .description('')
  .action(async (shell?: string) => {
    try {
      const completionCommand = createCompletionCommand();
      await completionCommand.generate({ shell });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('install [shell]')
  .description('')
  .option('--verbose', '')
  .action(async (shell?: string, options?: { verbose?: boolean }) => {
    try {
      const completionCommand = createCompletionCommand();
      await completionCommand.install({ shell, verbose: options?.verbose });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('uninstall [shell]')
  .description('')
  .option('-y, --yes', '')
  .action(async (shell?: string, options?: { yes?: boolean }) => {
    try {
      const completionCommand = createCompletionCommand();
      await completionCommand.uninstall({ shell, yes: options?.yes });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden command for machine-readable completion data
program
  .command('__complete <type>', { hidden: true })
  .description('')
  .action(async (type: string) => {
    try {
      const completionCommand = createCompletionCommand();
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
  .description('')
  .option('--change <id>', '')
  .option('--schema <name>', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
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
  .description('')
  .option('--change <id>', '')
  .option('--schema <name>', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
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

// `templates` and `schemas` intentionally remain standalone-only schema
// tooling. They are outside the generated Store-selection command contract;
// scoped workflow consumers receive their typed `project-schemas` location
// from StorePlanning instead of adding selectors to these enumeration tools.
// Templates command
program
  .command('templates')
  .description('')
  .option('--schema <name>', '')
  .option('--json', '')
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
  .description('')
  .option('--json', '')
  .action(async (options: SchemasOptions) => {
    try {
      await schemasCommand(options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// New command group with change subcommand
const newCmd = program.command('new').description('');

newCmd
  .command('change <name>')
  .description('')
  .option('--description <text>', '')
  .option('--proposal <text>', '')
  .option('--goal <text>', '')
  .option('--schema <name>', '')
  .option('--pipeline <name>', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  // Removed options kept registered (hidden) so users get a deliberate
  // explanation instead of a generic unknown-option error.
  .addOption(new Option('--initiative <id>', '').hideHelp())
  .addOption(new Option('--areas <names>', '').hideHelp())
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
  .description('');

pipelineCmd
  .command('list')
  .description('')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (options?: { json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.list(options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('show <name>')
  .description('')
  .option('--for-execution', '')
  .option('--planner <runtime>', '')
  .option('--implementer <runtime>', '')
  .option('--reviewer <runtime>', '')
  .option('--fixer <runtime>', '')
  .option('--shipper <runtime>', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options?: {
    planner?: string;
    implementer?: string;
    reviewer?: string;
    fixer?: string;
    shipper?: string;
    json?: boolean;
    forExecution?: boolean;
    store?: string;
    project?: string;
    targetLine?: string;
    storePath?: string;
  }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.show(name, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('agents <name>')
  .description('')
  .option('--planner <runtime>', '')
  .option('--implementer <runtime>', '')
  .option('--reviewer <runtime>', '')
  .option('--fixer <runtime>', '')
  .option('--shipper <runtime>', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
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
      targetLine?: string;
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
  .description('')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (task: string, options?: { json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.classify(task, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('resume <change>')
  .description('')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (change: string, options?: { json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    try {
      const pipelineCommand = new PipelineCommand();
      await pipelineCommand.resume(change, options);
    } catch (error) {
      failPipelineAction(error);
    }
  });

pipelineCmd
  .command('init <name>')
  .description('')
  .requiredOption('--output <path>', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options: { output: string; json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.init(name, options);
  });

pipelineCmd
  .command('validate <name-or-path>')
  .description('')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (nameOrPath: string, options: { json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.validate(nameOrPath, options);
  });

pipelineCmd
  .command('import <path>')
  .description('')
  .option('--force', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (sourcePath: string, options: { force?: boolean; json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.import(sourcePath, options);
  });

pipelineCmd
  .command('export <name> <path>')
  .description('')
  .option('--force', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (name: string, destination: string, options: { force?: boolean; json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.export(name, destination, options);
  });

pipelineCmd
  .command('save <name>')
  .description('')
  .requiredOption('--from <file>', '')
  .option('--force', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options: { from: string; force?: boolean; json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.save(name, options);
  });

pipelineCmd
  .command('delete <name>')
  .description('')
  .option('-y, --yes', '')
  .option('--force', '')
  .option('--json', '')
  .option('--store <id>', '')
  .option('--project <id>', '')
  .option('--target-line <id>', '')
  .addOption(hiddenStorePathOption())
  .action(async (name: string, options: { yes?: boolean; force?: boolean; json?: boolean; store?: string; project?: string; targetLine?: string; storePath?: string }) => {
    const pipelineLibraryCommand = new PipelineLibraryCommand();
    await pipelineLibraryCommand.delete(name, options);
  });

// Retain command group: prepare a change for a retention run
registerRetainCommand(program);

// Agent command group: introspect an agent's own runtime state
const agentCmd = program
  .command('agent')
  .description('');

agentCmd
  .command('dispatch')
  .description('')
  .option('--runtime <runtime>', '')
  .option('--prompt-file <path>', '')
  .option('--contract <contract>', '')
  .option('--sandbox <sandbox>', '')
  .option('--model <model>', '')
  .option('--effort <effort>', '')
  .option('--cwd <directory>', '')
  .option('--timeout-ms <ms>', '', (value) => Number(value))
  .option('--resume <session-id>', '')
  .option('--json', '')
  .action(async (options: {
    runtime?: string;
    promptFile?: string;
    contract?: string;
    sandbox?: string;
    model?: string;
    effort?: string;
    cwd?: string;
    timeoutMs?: number;
    resume?: string;
    json?: boolean;
  }) => {
    try {
      await new AgentCommand().dispatch(options);
    } catch (error) {
      console.log(
        JSON.stringify({
          ok: false,
          runtime: options.runtime ?? 'unknown',
          dispatchMode: 'exec-bridge',
          bridge: 'claude-print',
          ...(options.contract ? { contract: options.contract } : {}),
          failure: {
            kind: 'invalid-input',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      );
      process.exitCode = 1;
    }
  });

agentCmd
  .command('context')
  .description('')
  .option('--transcript <path>', '')
  .option('--latest', '')
  .option('--dir <dir>', '')
  .option('--limit <n>', '', (v) => parseInt(v, 10))
  .option('--runtime <runtime>', '')
  .option('--json', '')
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
  .description('')
  .requiredOption('--change <name>', '')
  .requiredOption('--role <key>', '')
  .option('--max-beats <n>', '', (v) => parseInt(v, 10))
  .option('--context-tokens <n>', '', (v) => parseInt(v, 10))
  .option('--beat-seconds <s>', '', (v) => parseInt(v, 10))
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

agentCmd
  .command('audit [sessionId|path]')
  .description(
    ''
  )
  .option('--projects-dir <dir>', '')
  .option('--out <path>', '')
  .option('--runtime <runtime>', '')
  .option('--match <text>', '')
  .option('--db <path>', '')
  .option('--json', '')
  .option('--open', '')
  .action(async (target: string | undefined, options?: {
    projectsDir?: string;
    out?: string;
    runtime?: string;
    match?: string;
    db?: string;
    json?: boolean;
    open?: boolean;
  }) => {
    try {
      const agentCommand = new AgentCommand();
      await agentCommand.audit(target ?? '', options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

return program;
}

export interface CreateProgramOptions {
  locale: CliLocale;
  facts?: Partial<CliPresentationFacts>;
}

export function createProgram(options: CreateProgramOptions): Command {
  const presentation = resolveCliPresentation(options);
  const program = buildUnlocalizedProgram({
    locale: options.locale,
    presentation,
  });
  applyCliPresentation(program, presentation);
  return program;
}

export function runCli(argv = process.argv): void {
  // One-time adoption of legacy machine data (brand rename + root
  // relocation) into the resolved config/data locations. Best-effort and
  // synchronous; must run before any config is read.
  adoptLegacyMachineData();
  const locale = getCliLocale();
  const program = createProgram({ locale });
  program.parse(argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
