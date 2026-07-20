import * as fs from 'node:fs';

import { Command } from 'commander';

import {
  deleteWorkflow,
  exportWorkflow,
  importWorkflow,
  scaffoldWorkflow,
  scanWorkflowUsage,
  validateWorkflowInput,
  workflowDefinitionForJson,
  WorkflowLibraryError,
} from '../core/workflow-library.js';
import { loadWorkflowCatalog } from '../core/workflow-registry/index.js';
import { isInteractive } from '../utils/interactive.js';
import { isPromptCancellationError, printJson } from './shared-output.js';

interface JsonOption {
  json?: boolean;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'workflow_command_error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runWorkflowAction(
  options: JsonOption,
  emptyPayload: Record<string, unknown>,
  action: () => void | Promise<void>
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      if (options.json) {
        printJson({ ...emptyPayload, status: [{ severity: 'error', code: 'cancelled', message: 'Cancelled.' }] });
      } else {
        console.error('Cancelled.');
      }
      process.exitCode = 130;
      return;
    }
    const status = { severity: 'error', code: errorCode(error), message: errorMessage(error) };
    if (options.json) printJson({ ...emptyPayload, status: [status] });
    else console.error(`Error: ${status.message}`);
    process.exitCode = 1;
  }
}

export function registerWorkflowLibraryCommand(program: Command): void {
  const workflow = program
    .command('workflow')
    .description('Manage installable workflows in the user-wide library');

  workflow
    .command('list')
    .description('List built-in and user workflows')
    .option('--unused', 'Show only user workflows with no detected consumers')
    .option('--json', 'Output as JSON')
    .action(async (options: { unused?: boolean; json?: boolean }) => {
      await runWorkflowAction(options, { workflows: [], diagnostics: [] }, () => {
        const catalog = loadWorkflowCatalog();
        const workflows = catalog.definitions
          .map((definition) => {
            const usage = definition.source === 'user' ? scanWorkflowUsage(definition.id) : [];
            return {
              id: definition.id,
              source: definition.source,
              sourcePath: definition.sourcePath ?? null,
              digest: definition.digest,
              skillName: definition.skill.template.name,
              commandId: definition.command?.content.id ?? null,
              unused: definition.source === 'user' && usage.length === 0,
            };
          })
          .filter((entry) => !options.unused || entry.unused);
        const invalid = catalog.invalid.map((record) => ({
          id: record.id,
          source: record.source,
          sourcePath: record.sourcePath,
          valid: false,
          diagnostics: record.diagnostics,
        }));
        if (options.json) {
          printJson({ workflows, invalid, diagnostics: catalog.diagnostics, status: [] });
          return;
        }
        for (const entry of workflows) {
          console.log(`${entry.id}\t${entry.source}\t${entry.skillName}${entry.unused ? '\tunused' : ''}`);
        }
        for (const entry of invalid) console.log(`${entry.id}\tuser\tinvalid`);
        for (const diagnostic of catalog.diagnostics) console.warn(`Warning: ${diagnostic.message}`);
      });
    });

  workflow
    .command('show <id>')
    .description('Show an installable workflow definition and known usage')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: JsonOption) => {
      await runWorkflowAction(options, { workflow: null, usage: [] }, () => {
        const catalog = loadWorkflowCatalog();
        const definition = catalog.get(id);
        if (!definition) throw new WorkflowLibraryError(`Workflow "${id}" was not found`, 'workflow_not_found');
        const usage = scanWorkflowUsage(id);
        const payload = { workflow: workflowDefinitionForJson(definition), usage, status: [] };
        if (options.json) {
          printJson(payload);
          return;
        }
        console.log(`${definition.id} (${definition.source})`);
        console.log(`Skill: ${definition.skill.template.name}`);
        console.log(`Command: ${definition.command?.content.id ?? 'none'}`);
        console.log(`Digest: ${definition.digest}`);
        console.log(`Requires workflows: ${definition.requires.workflows.join(', ') || 'none'}`);
        console.log(`Requires skills: ${definition.requires.skills.join(', ') || 'none'}`);
        console.log(`Known usage: ${usage.map((item) => `${item.kind}:${item.consumer}`).join(', ') || 'none'}`);
      });
    });

  workflow
    .command('which <id>')
    .description('Show where an installable workflow resolves from')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: JsonOption) => {
      await runWorkflowAction(options, { workflow: null }, () => {
        const definition = loadWorkflowCatalog().get(id);
        if (!definition) throw new WorkflowLibraryError(`Workflow "${id}" was not found`, 'workflow_not_found');
        const payload = {
          workflow: {
            id: definition.id,
            source: definition.source,
            sourcePath: definition.sourcePath ?? null,
            digest: definition.digest,
          },
          status: [],
        };
        if (options.json) printJson(payload);
        else console.log(definition.sourcePath ?? `built-in:${definition.id}`);
      });
    });

  workflow
    .command('init <id>')
    .description('Create a minimal workflow draft without installing it')
    .requiredOption('--output <path>', 'Empty workflow draft directory to create')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: JsonOption & { output: string }) => {
      await runWorkflowAction(options, { workflow: null }, () => {
        const catalog = loadWorkflowCatalog();
        if (catalog.has(id) || catalog.invalid.some((record) => record.id === id)) {
          throw new WorkflowLibraryError(`Workflow ID "${id}" already exists`, 'workflow_id_collision');
        }
        const output = scaffoldWorkflow(id, options.output);
        const payload = { workflow: { id, output }, status: [] };
        if (options.json) printJson(payload);
        else console.log(`Created workflow draft at ${output}`);
      });
    });

  workflow
    .command('validate <id-or-path>')
    .description('Validate an installed workflow, draft directory, or .rasenpkg')
    .option('--json', 'Output as JSON')
    .action(async (idOrPath: string, options: JsonOption) => {
      await runWorkflowAction(options, { validation: null }, () => {
        const validation = validateWorkflowInput(idOrPath);
        if (options.json) printJson({ validation, status: [] });
        else {
          console.log(validation.valid ? 'Workflow is valid.' : 'Workflow is invalid.');
          for (const diagnostic of validation.diagnostics) {
            console.log(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
          }
        }
        if (!validation.valid) process.exitCode = 1;
      });
    });

  workflow
    .command('import <path>')
    .description('Validate and atomically install a workflow directory or package')
    .option('--json', 'Output as JSON')
    .action(async (sourcePath: string, options: JsonOption) => {
      await runWorkflowAction(options, { imported: [], reused: [], roots: [] }, async () => {
        const result = await importWorkflow(sourcePath);
        if (options.json) printJson({ ...result, status: [] });
        else {
          if (result.imported.length > 0) console.log(`Imported: ${result.imported.join(', ')}`);
          if (result.reused.length > 0) console.log(`Already installed: ${result.reused.join(', ')}`);
        }
      });
    });

  workflow
    .command('export <id> <path>')
    .description('Export a user workflow and its user dependencies as .rasenpkg')
    .option('--force', 'Replace an existing destination file')
    .option('--json', 'Output as JSON')
    .action(async (id: string, destination: string, options: JsonOption & { force?: boolean }) => {
      await runWorkflowAction(options, { workflow: null }, async () => {
        let overwrite = options.force === true;
        if (fs.existsSync(destination) && !overwrite) {
          if (!isInteractive()) {
            throw new WorkflowLibraryError('Export destination already exists; use --force', 'destination_exists');
          }
          const { confirm } = await import('@inquirer/prompts');
          overwrite = await confirm({ message: `Replace ${destination}?`, default: false });
          if (!overwrite) throw new WorkflowLibraryError('Export cancelled', 'cancelled');
        }
        const exportedPath = exportWorkflow(id, destination, { overwrite });
        const payload = { workflow: { id, path: exportedPath }, status: [] };
        if (options.json) printJson(payload);
        else console.log(`Exported ${id} to ${exportedPath}`);
      });
    });

  workflow
    .command('delete <id>')
    .description('Delete an unreferenced user workflow')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: JsonOption & { yes?: boolean }) => {
      await runWorkflowAction(options, { deleted: null }, async () => {
        if (!options.yes) {
          if (!isInteractive()) {
            throw new WorkflowLibraryError('Deletion requires --yes in non-interactive mode', 'confirmation_required');
          }
          const { confirm } = await import('@inquirer/prompts');
          const confirmed = await confirm({ message: `Delete workflow ${id}?`, default: false });
          if (!confirmed) throw new WorkflowLibraryError('Deletion cancelled', 'cancelled');
        }
        await deleteWorkflow(id);
        if (options.json) printJson({ deleted: id, status: [] });
        else console.log(`Deleted workflow ${id}`);
        console.warn('Warning: project-local consumers outside the current project may still exist.');
      });
    });
}

