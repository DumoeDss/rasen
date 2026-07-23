/**
 * Pipeline Library Command
 *
 * Package, install, and remove orchestration pipelines — the `pipeline`
 * group's installable-library verbs, mirroring `rasen workflow`'s UX:
 *   - init     : scaffold a minimal pipeline.yaml draft
 *   - validate : structural validation of an installed pipeline, a directory,
 *                or a `.rasenpkg`
 *   - import   : validate + atomically install a `.rasenpkg` (`pipeline` kind)
 *   - export   : package a user pipeline as a `.rasenpkg`
 *   - delete   : remove an unreferenced user pipeline (refcount-guarded)
 *
 * Routed through the shared root-selection layer (`--store`/`--project`),
 * exactly like the inspection verbs (list/show/agents/classify/resume) in
 * `commands/pipeline.ts`.
 */

import * as fs from 'node:fs';

import {
  deletePipeline,
  exportPipeline,
  importPipelinePackage,
  savePipeline,
  scaffoldPipeline,
  validatePipelineInput,
} from '../core/pipeline-library.js';
import { listPipelines } from '../core/pipeline-registry/index.js';
import { isInteractive } from '../utils/interactive.js';
import { resolveRootForCommand, type ResolvedOpenSpecRoot } from '../core/root-selection.js';
import {
  formatPipelineError,
  formatPipelineErrorDetail,
  formatPipelineRootSelectionNotice,
  getPipelineMessages,
  pipelineMessageError,
} from './pipeline-messages.js';

interface PipelineLibraryCommandOptions {
  json?: boolean;
  store?: string;
  project?: string;
  storePath?: string;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'pipeline_command_error';
}



export class PipelineLibraryCommand {
  private async resolveRoot(
    options: PipelineLibraryCommandOptions
  ): Promise<ResolvedOpenSpecRoot | null> {
    if (options.json) {
      return resolveRootForCommand(options, { json: true, reporter: false });
    }
    return resolveRootForCommand(options, {
      reporter: (notice) => console.error(formatPipelineRootSelectionNotice(notice)),
    });
  }

  async init(
    name: string,
    options: PipelineLibraryCommandOptions & { output: string }
  ): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      if (listPipelines(root.path).includes(name)) {
        throw pipelineMessageError(
          'pipelineIdCollision',
          { name },
          'pipeline_id_collision'
        );
      }
      const output = scaffoldPipeline(name, options.output);
      if (options.json) {
        console.log(JSON.stringify({ pipeline: { name, output }, status: [] }, null, 2));
      } else {
        console.log(getPipelineMessages().format('createdDraft', { path: output }));
      }
    } catch (error) {
      this.reportError(options, error);
    }
  }

  async validate(nameOrPath: string, options: PipelineLibraryCommandOptions): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      const validation = validatePipelineInput(nameOrPath, { projectRoot: root.path });
      if (options.json) {
        console.log(JSON.stringify({ validation, status: [] }, null, 2));
      } else {
        const messages = getPipelineMessages();
        console.log(
          validation.valid
            ? messages.format('pipelineValid')
            : messages.format('pipelineInvalid')
        );
        for (const diagnostic of validation.diagnostics) {
          console.log(messages.format('validationDiagnostic', diagnostic));
        }
      }
      if (!validation.valid) process.exitCode = 1;
    } catch (error) {
      this.reportError(options, error);
    }
  }

  async import(sourcePath: string, options: PipelineLibraryCommandOptions & { force?: boolean }): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      const result = await importPipelinePackage(sourcePath, {
        projectRoot: root.path,
        overwrite: options.force === true,
      });
      if (options.json) {
        console.log(JSON.stringify({ ...result, status: [] }, null, 2));
      } else {
        const messages = getPipelineMessages();
        console.log(messages.format('importedHeading', { path: result.path }));
        for (const name of result.imported) {
          console.log(messages.format('importedEntry', {
            name,
            digest: result.digests[name],
          }));
        }
      }
    } catch (error) {
      this.reportError(options, error);
    }
  }

  async export(name: string, destination: string, options: PipelineLibraryCommandOptions & { force?: boolean }): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      let overwrite = options.force === true;
      if (fs.existsSync(destination) && !overwrite) {
        if (!isInteractive()) {
          throw pipelineMessageError('destinationExists', undefined, 'destination_exists');
        }
        const { confirm } = await import('@inquirer/prompts');
        const messages = getPipelineMessages();
        overwrite = await confirm({
          message: messages.format('replaceDestination', { path: destination }),
          default: false,
        });
        if (!overwrite) {
          throw pipelineMessageError('exportCancelled', undefined, 'cancelled');
        }
      }
      const exportedPath = exportPipeline(name, destination, { projectRoot: root.path, overwrite });
      if (options.json) {
        console.log(JSON.stringify({ pipeline: { name, path: exportedPath }, status: [] }, null, 2));
      } else {
        console.log(getPipelineMessages().format('exported', {
          name,
          path: exportedPath,
        }));
      }
    } catch (error) {
      this.reportError(options, error);
    }
  }

  async delete(name: string, options: PipelineLibraryCommandOptions & { yes?: boolean; force?: boolean }): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      if (!options.yes) {
        if (!isInteractive()) {
          throw pipelineMessageError(
            'deletionRequiresYes',
            undefined,
            'confirmation_required'
          );
        }
        const { confirm } = await import('@inquirer/prompts');
        const messages = getPipelineMessages();
        const confirmed = await confirm({
          message: messages.format('deletePipeline', { name }),
          default: false,
        });
        if (!confirmed) {
          throw pipelineMessageError('deletionCancelled', undefined, 'cancelled');
        }
      }
      const result = await deletePipeline(name, { projectRoot: root.path, force: options.force === true });
      if (options.json) {
        console.log(JSON.stringify({ deleted: name, forcedReferrers: result.forcedReferrers, status: [] }, null, 2));
      } else {
        const messages = getPipelineMessages();
        console.log(messages.format('deleted', { name }));
        if (result.forcedReferrers.length > 0) {
          console.warn(messages.format('forcedDeleteWarning', {
            name,
            referrers: result.forcedReferrers.join(', '),
          }));
        }
      }
    } catch (error) {
      this.reportError(options, error);
    }
  }

  async save(
    name: string,
    options: PipelineLibraryCommandOptions & { from: string; force?: boolean }
  ): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      const result = await savePipeline(name, options.from, {
        projectRoot: root.path,
        force: options.force === true,
      });
      if (options.json) {
        console.log(JSON.stringify(
          { pipeline: { name: result.name, path: result.path }, created: result.created, status: [] },
          null,
          2
        ));
      } else {
        console.log(getPipelineMessages().format('savedPipeline', {
          name: result.name,
          path: result.path,
        }));
      }
    } catch (error) {
      this.reportError(options, error);
    }
  }

  private reportError(options: PipelineLibraryCommandOptions, error: unknown): void {
    const status = {
      severity: 'error' as const,
      code: errorCode(error),
      message: formatPipelineErrorDetail(error, 'en'),
    };
    if (options.json) {
      console.log(JSON.stringify({ status: [status] }, null, 2));
    } else {
      console.error(formatPipelineError(error));
    }
    process.exitCode = 1;
  }
}
