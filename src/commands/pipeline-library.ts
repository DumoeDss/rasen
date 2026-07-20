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
  PipelineLibraryError,
  scaffoldPipeline,
  validatePipelineInput,
} from '../core/pipeline-library.js';
import { listPipelines } from '../core/pipeline-registry/index.js';
import { isInteractive } from '../utils/interactive.js';
import { resolveRootForCommand, type ResolvedOpenSpecRoot } from '../core/root-selection.js';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PipelineLibraryCommand {
  private async resolveRoot(
    options: PipelineLibraryCommandOptions
  ): Promise<ResolvedOpenSpecRoot | null> {
    return resolveRootForCommand(options, { json: options.json });
  }

  async init(
    name: string,
    options: PipelineLibraryCommandOptions & { output: string }
  ): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    try {
      if (listPipelines(root.path).includes(name)) {
        throw new PipelineLibraryError(`Pipeline "${name}" already exists`, 'pipeline_id_collision');
      }
      const output = scaffoldPipeline(name, options.output);
      if (options.json) {
        console.log(JSON.stringify({ pipeline: { name, output }, status: [] }, null, 2));
      } else {
        console.log(`Created pipeline draft at ${output}`);
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
        console.log(validation.valid ? 'Pipeline is valid.' : 'Pipeline is invalid.');
        for (const diagnostic of validation.diagnostics) {
          console.log(`  [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
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
        console.log(`Imported pipeline(s) from ${result.path}:`);
        for (const name of result.imported) {
          console.log(`  ${name} (digest ${result.digests[name]})`);
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
          throw new PipelineLibraryError('Export destination already exists; use --force', 'destination_exists');
        }
        const { confirm } = await import('@inquirer/prompts');
        overwrite = await confirm({ message: `Replace ${destination}?`, default: false });
        if (!overwrite) throw new PipelineLibraryError('Export cancelled', 'cancelled');
      }
      const exportedPath = exportPipeline(name, destination, { projectRoot: root.path, overwrite });
      if (options.json) {
        console.log(JSON.stringify({ pipeline: { name, path: exportedPath }, status: [] }, null, 2));
      } else {
        console.log(`Exported pipeline "${name}" to ${exportedPath}`);
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
          throw new PipelineLibraryError('Deletion requires --yes in non-interactive mode', 'confirmation_required');
        }
        const { confirm } = await import('@inquirer/prompts');
        const confirmed = await confirm({ message: `Delete pipeline "${name}"?`, default: false });
        if (!confirmed) throw new PipelineLibraryError('Deletion cancelled', 'cancelled');
      }
      const result = await deletePipeline(name, { projectRoot: root.path, force: options.force === true });
      if (options.json) {
        console.log(JSON.stringify({ deleted: name, forcedReferrers: result.forcedReferrers, status: [] }, null, 2));
      } else {
        console.log(`Deleted pipeline "${name}".`);
      }
      if (result.forcedReferrers.length > 0) {
        console.warn(`Warning: "${name}" was still referenced by: ${result.forcedReferrers.join(', ')}`);
      }
    } catch (error) {
      this.reportError(options, error);
    }
  }

  private reportError(options: PipelineLibraryCommandOptions, error: unknown): void {
    const status = { severity: 'error' as const, code: errorCode(error), message: errorMessage(error) };
    if (options.json) {
      console.log(JSON.stringify({ status: [status] }, null, 2));
    } else {
      console.error(`Error: ${status.message}`);
    }
    process.exitCode = 1;
  }
}
