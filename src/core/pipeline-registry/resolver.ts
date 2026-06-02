import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalDataDir } from '../global-config.js';
import { parsePipeline, PipelineValidationError } from './pipeline.js';
import { DEFAULT_CHILD_PIPELINE, type PipelineYaml, type Stage } from './types.js';

/**
 * Error thrown when loading a pipeline fails.
 */
export class PipelineLoadError extends Error {
  constructor(
    message: string,
    public readonly pipelinePath: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PipelineLoadError';
  }
}

/**
 * Gets the package's built-in pipelines directory path.
 * Uses import.meta.url to resolve relative to the current module.
 */
export function getPackagePipelinesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  // Navigate from dist/core/pipeline-registry/ to package root's pipelines/
  return path.join(path.dirname(currentFile), '..', '..', '..', 'pipelines');
}

/**
 * Gets the user's pipeline override directory path.
 */
export function getUserPipelinesDir(): string {
  return path.join(getGlobalDataDir(), 'pipelines');
}

/**
 * Gets the project-local pipelines directory path.
 * @param projectRoot - The project root directory
 * @returns The path to the project's pipelines directory
 */
export function getProjectPipelinesDir(projectRoot: string): string {
  return path.join(projectRoot, 'openspec', 'pipelines');
}

/**
 * Resolves a pipeline name to its directory path.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local: <projectRoot>/openspec/pipelines/<name>/pipeline.yaml
 * 2. User override: ${XDG_DATA_HOME}/openspec/pipelines/<name>/pipeline.yaml
 * 3. Package built-in: <package>/pipelines/<name>/pipeline.yaml
 *
 * When projectRoot is not provided, only user override and package built-in are checked.
 *
 * @param name - Pipeline name (e.g., "full-feature")
 * @param projectRoot - Optional project root directory for project-local resolution
 * @returns The path to the pipeline directory, or null if not found
 */
export function getPipelineDir(name: string, projectRoot?: string): string | null {
  // 1. Check project-local directory (if projectRoot provided)
  if (projectRoot) {
    const projectDir = path.join(getProjectPipelinesDir(projectRoot), name);
    const projectPipelinePath = path.join(projectDir, 'pipeline.yaml');
    if (fs.existsSync(projectPipelinePath)) {
      return projectDir;
    }
  }

  // 2. Check user override directory
  const userDir = path.join(getUserPipelinesDir(), name);
  const userPipelinePath = path.join(userDir, 'pipeline.yaml');
  if (fs.existsSync(userPipelinePath)) {
    return userDir;
  }

  // 3. Check package built-in directory
  const packageDir = path.join(getPackagePipelinesDir(), name);
  const packagePipelinePath = path.join(packageDir, 'pipeline.yaml');
  if (fs.existsSync(packagePipelinePath)) {
    return packageDir;
  }

  return null;
}

/**
 * Resolves a pipeline name to its pipeline.yaml file path.
 *
 * @param name - Pipeline name (e.g., "full-feature")
 * @param projectRoot - Optional project root directory for project-local resolution
 * @returns The path to the pipeline.yaml file, or null if not found
 */
export function resolvePipelinePath(name: string, projectRoot?: string): string | null {
  // Normalize name (remove .yaml extension if provided)
  const normalizedName = name.replace(/\.ya?ml$/, '');

  const pipelineDir = getPipelineDir(normalizedName, projectRoot);
  if (!pipelineDir) {
    return null;
  }

  return path.join(pipelineDir, 'pipeline.yaml');
}

/**
 * Resolves a pipeline name to a PipelineYaml object.
 *
 * Resolution order (when projectRoot is provided):
 * 1. Project-local
 * 2. User override
 * 3. Package built-in
 *
 * @param name - Pipeline name (e.g., "full-feature")
 * @param projectRoot - Optional project root directory for project-local resolution
 * @returns The resolved pipeline object
 * @throws Error if pipeline is not found in any location
 */
export function loadPipelineByName(name: string, projectRoot?: string): PipelineYaml {
  // Normalize name (remove .yaml extension if provided)
  const normalizedName = name.replace(/\.ya?ml$/, '');

  const pipelinePath = resolvePipelinePath(normalizedName, projectRoot);
  if (!pipelinePath) {
    const available = listPipelines(projectRoot);
    throw new Error(
      `Pipeline '${normalizedName}' not found. Available pipelines: ${available.join(', ')}`
    );
  }

  // Load and parse the pipeline
  let content: string;
  try {
    content = fs.readFileSync(pipelinePath, 'utf-8');
  } catch (err) {
    const ioError = err instanceof Error ? err : new Error(String(err));
    throw new PipelineLoadError(
      `Failed to read pipeline at '${pipelinePath}': ${ioError.message}`,
      pipelinePath,
      ioError
    );
  }

  try {
    return parsePipeline(content);
  } catch (err) {
    if (err instanceof PipelineValidationError) {
      throw new PipelineLoadError(
        `Invalid pipeline at '${pipelinePath}': ${err.message}`,
        pipelinePath,
        err
      );
    }
    const parseError = err instanceof Error ? err : new Error(String(err));
    throw new PipelineLoadError(
      `Failed to parse pipeline at '${pipelinePath}': ${parseError.message}`,
      pipelinePath,
      parseError
    );
  }
}

/**
 * Scans a base directory for pipeline subdirectories that contain a
 * pipeline.yaml file, adding their names to the provided set.
 */
function collectPipelineNames(baseDir: string, into: Set<string>): void {
  if (!fs.existsSync(baseDir)) {
    return;
  }
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const pipelinePath = path.join(baseDir, entry.name, 'pipeline.yaml');
      if (fs.existsSync(pipelinePath)) {
        into.add(entry.name);
      }
    }
  }
}

/**
 * Lists all available pipeline names.
 * Combines project-local, user override, and package built-in pipelines.
 *
 * @param projectRoot - Optional project root directory for project-local resolution
 */
export function listPipelines(projectRoot?: string): string[] {
  const pipelines = new Set<string>();

  // Package built-ins
  collectPipelineNames(getPackagePipelinesDir(), pipelines);

  // User overrides (may shadow package built-ins by name)
  collectPipelineNames(getUserPipelinesDir(), pipelines);

  // Project-local (if projectRoot provided)
  if (projectRoot) {
    collectPipelineNames(getProjectPipelinesDir(projectRoot), pipelines);
  }

  return Array.from(pipelines).sort();
}

/**
 * Pipeline info with metadata (name, description, stages).
 */
export interface PipelineInfo {
  name: string;
  description: string;
  stages: string[];
  source: 'project' | 'user' | 'package';
}

/**
 * Adds pipelines from a base directory as PipelineInfo entries with the given
 * source, skipping any names already seen (precedence) and any invalid files.
 */
function collectPipelineInfo(
  baseDir: string,
  source: PipelineInfo['source'],
  seenNames: Set<string>,
  into: PipelineInfo[]
): void {
  if (!fs.existsSync(baseDir)) {
    return;
  }
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || seenNames.has(entry.name)) {
      continue;
    }
    const pipelinePath = path.join(baseDir, entry.name, 'pipeline.yaml');
    if (!fs.existsSync(pipelinePath)) {
      continue;
    }
    try {
      const pipeline = parsePipeline(fs.readFileSync(pipelinePath, 'utf-8'));
      into.push({
        name: entry.name,
        description: pipeline.description || '',
        stages: pipeline.stages.map(s => s.id),
        source,
      });
      seenNames.add(entry.name);
    } catch {
      // Skip invalid pipelines
    }
  }
}

/**
 * The pipeline name a decompose stage runs for each child change: the stage's
 * explicit `childPipeline`, or the documented default when omitted.
 */
export function resolveChildPipelineName(stage: Stage): string {
  return stage.childPipeline ?? DEFAULT_CHILD_PIPELINE;
}

/**
 * Validates the registry-dependent constraints on every decompose stage in a
 * pipeline: its `childPipeline` (explicit or defaulted) MUST resolve through the
 * registry (project > user > package, never pattern matching) and the resolved
 * child pipeline MUST itself be decompose-free — bounding fan-out to a single
 * level (the recursion guard). Stage-level constraints (single, first) are
 * checked in pipeline.ts; this is the part that needs registry access, so the
 * CLI validate path and `pipeline show` call it with the project root.
 *
 * @throws PipelineValidationError when a child pipeline cannot be resolved or
 *   would recurse.
 */
export function validateDecomposeChildPipelines(
  pipeline: PipelineYaml,
  projectRoot?: string
): void {
  for (const stage of pipeline.stages) {
    if (stage.kind !== 'decompose') continue;
    const childName = resolveChildPipelineName(stage);

    let child: PipelineYaml;
    try {
      child = loadPipelineByName(childName, projectRoot);
    } catch {
      throw new PipelineValidationError(
        `Decompose stage '${stage.id}' references childPipeline '${childName}' which cannot be resolved`
      );
    }

    if (child.stages.some(s => s.kind === 'decompose')) {
      throw new PipelineValidationError(
        `Recursion guard: childPipeline '${childName}' (used by decompose stage '${stage.id}') ` +
          `itself contains a decompose stage; child pipelines must be decompose-free`
      );
    }
  }
}

/**
 * Lists all available pipelines with their descriptions and stage lists.
 * Precedence: project > user > package.
 *
 * @param projectRoot - Optional project root directory for project-local resolution
 */
export function listPipelinesWithInfo(projectRoot?: string): PipelineInfo[] {
  const pipelines: PipelineInfo[] = [];
  const seenNames = new Set<string>();

  // Project-local first (highest priority, if projectRoot provided)
  if (projectRoot) {
    collectPipelineInfo(getProjectPipelinesDir(projectRoot), 'project', seenNames, pipelines);
  }

  // User overrides (if not overridden by project)
  collectPipelineInfo(getUserPipelinesDir(), 'user', seenNames, pipelines);

  // Package built-ins (if not overridden by project or user)
  collectPipelineInfo(getPackagePipelinesDir(), 'package', seenNames, pipelines);

  return pipelines.sort((a, b) => a.name.localeCompare(b.name));
}
