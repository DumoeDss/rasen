import { WORKSPACE_DIR_NAME } from '../config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGlobalDataDir } from '../global-config.js';
import {
  parsePipeline,
  PipelineValidationError,
  pipelineValidationErrorFromDefinitionReadError,
} from './pipeline.js';
import {
  DefinitionReadError,
  EcpDefinitionModule,
  type CapabilityCatalogSnapshot,
  type DefinitionDiagnostic,
  type DefinitionPreparationResult,
  type PreparedDefinition,
} from './definition.js';
import { DEFAULT_CHILD_PIPELINE, type PipelineYaml, type Stage } from './types.js';

/**
 * Error thrown when loading a pipeline fails.
 */
export class PipelineLoadError extends Error {
  constructor(
    message: string,
    public readonly pipelinePath: string,
    public readonly cause?: Error,
    public readonly authoredText?: string
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
  return path.join(projectRoot, WORKSPACE_DIR_NAME, 'pipelines');
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
export function loadPipelineByName(
  name: string,
  projectRoot?: string,
  options?: PipelinePreparationOptions
): PipelineYaml {
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
    // This public contract returns only the prompt-owned legacy PipelineYaml
    // runtime value. A caller that may encounter authored v2 must supply the
    // authoritative frozen catalog so preparation can complete before the
    // explicit unavailable-runtime selection. Omitting it is an explicit
    // legacy-only path; parsePipeline never gives v2 an empty-catalog meaning.
    return parsePipeline(content, options?.catalog);
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

export type PipelineSourceLayer = 'project' | 'user' | 'package';

export interface PipelinePreparationOptions {
  readonly catalog: CapabilityCatalogSnapshot;
  readonly prepare?: (
    source: unknown,
    catalog: CapabilityCatalogSnapshot
  ) => DefinitionPreparationResult;
}

export interface PreparedPipelineResolution {
  /** Normalized registry key used for resolution. */
  readonly name: string;
  readonly pipelinePath: string;
  readonly source: PipelineSourceLayer;
  /** Exact winning file content retained for source-compatible read/export. */
  readonly authoredText: string;
  /** Exact prepared result shared by registry detail/list consumers. */
  readonly prepared: PreparedDefinition;
}

function sourceLayerForPath(
  pipelinePath: string,
  normalizedName: string,
  projectRoot?: string
): PipelineSourceLayer {
  const resolved = path.resolve(pipelinePath);
  if (
    projectRoot &&
    resolved ===
      path.resolve(getProjectPipelinesDir(projectRoot), normalizedName, 'pipeline.yaml')
  ) {
    return 'project';
  }
  if (
    resolved ===
    path.resolve(getUserPipelinesDir(), normalizedName, 'pipeline.yaml')
  ) {
    return 'user';
  }
  return 'package';
}

function preparePipelineAtPath(
  normalizedName: string,
  pipelinePath: string,
  source: PipelineSourceLayer,
  options: PipelinePreparationOptions
): PreparedPipelineResolution {
  let authoredText: string;
  try {
    authoredText = fs.readFileSync(pipelinePath, 'utf-8');
  } catch (error) {
    const ioError = error instanceof Error ? error : new Error(String(error));
    throw new PipelineLoadError(
      `Failed to read pipeline at '${pipelinePath}': ${ioError.message}`,
      pipelinePath,
      ioError
    );
  }

  const result = (options.prepare ?? EcpDefinitionModule.prepare)(
    authoredText,
    options.catalog
  );
  if (!result.ok) {
    throw new PipelineLoadError(
      `Invalid pipeline definition at '${pipelinePath}': ${result.error.message}`,
      pipelinePath,
      result.error,
      authoredText
    );
  }

  return {
    name: normalizedName,
    pipelinePath,
    source,
    authoredText,
    prepared: result.value,
  };
}

/**
 * Resolves and prepares the winning authored Pipeline Definition without
 * widening the legacy `loadPipelineByName(): PipelineYaml` contract.
 *
 * The winning path is selected before preparation, so an unsupported or
 * invalid higher-precedence definition fails closed rather than falling
 * through to a lower layer.
 */
export function loadPreparedPipelineByName(
  name: string,
  projectRoot: string | undefined,
  options: PipelinePreparationOptions
): PreparedPipelineResolution {
  const normalizedName = name.replace(/\.ya?ml$/, '');
  const pipelinePath = resolvePipelinePath(normalizedName, projectRoot);
  if (!pipelinePath) {
    const available = listPipelines(projectRoot);
    throw new Error(
      `Pipeline '${normalizedName}' not found. Available pipelines: ${available.join(', ')}`
    );
  }

  return preparePipelineAtPath(
    normalizedName,
    pipelinePath,
    sourceLayerForPath(pipelinePath, normalizedName, projectRoot),
    options
  );
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
  source: PipelineSourceLayer;
  authoredVersion?: number;
  definitionValid?: boolean;
  planAvailable?: boolean;
  executable?: boolean;
  executionMode?: 'legacy' | 'unavailable';
  unavailableReason?: string;
  prepared?: PreparedDefinition;
  diagnostics?: readonly DefinitionDiagnostic[];
  pipelinePath?: string;
  authoredText?: string;
  /** Total projection captured by authoritative preparation; never reparsed. */
  authoredDefinition?: unknown;
}

/**
 * Adds pipelines from a base directory as PipelineInfo entries with the given
 * source, skipping any names already seen (precedence) and any invalid files.
 */
function collectPipelineInfo(
  baseDir: string,
  source: PipelineInfo['source'],
  seenNames: Set<string>,
  into: PipelineInfo[],
  preparation?: PipelinePreparationOptions,
  loadPrepared?: (name: string) => PreparedPipelineResolution
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
    // Reserve precedence as soon as this manifest wins. Preparation failure
    // must never reveal a lower layer with the same registry key.
    seenNames.add(entry.name);
    try {
      if (preparation) {
        const resolution = loadPrepared
          ? loadPrepared(entry.name)
          : preparePipelineAtPath(
              entry.name,
              pipelinePath,
              source,
              preparation
            );
        const authored = resolution.prepared.authoredSource;
        into.push({
          name: entry.name,
          description: authored.description || '',
          stages:
            resolution.prepared.authoredVersion === 1
              ? (authored as PipelineYaml).stages.map((stage) => stage.id)
              : resolution.prepared.definition.root.nodes.map((node) => node.id),
          source,
          authoredVersion: resolution.prepared.authoredVersion,
          definitionValid: resolution.prepared.capability.definitionValid,
          planAvailable: resolution.prepared.capability.planAvailable,
          executable: resolution.prepared.capability.executable,
          executionMode: resolution.prepared.capability.executionMode,
          ...(resolution.prepared.capability.unavailableReason
            ? {
                unavailableReason:
                  resolution.prepared.capability.unavailableReason,
              }
            : {}),
          prepared: resolution.prepared,
          pipelinePath: resolution.pipelinePath,
          authoredText: resolution.authoredText,
          authoredDefinition: resolution.prepared.authoredSource,
        });
        continue;
      }

      const pipeline = parsePipeline(fs.readFileSync(pipelinePath, 'utf-8'));
      into.push({
        name: entry.name,
        description: pipeline.description || '',
        stages: pipeline.stages.map(s => s.id),
        source,
      });
    } catch (error) {
      if (
        preparation &&
        error instanceof PipelineLoadError &&
        error.cause instanceof DefinitionReadError
      ) {
        const authoredText = error.authoredText ?? '';
        const authoredValue = error.cause.authoredSource;
        const authoredRecord =
          authoredValue !== null &&
          typeof authoredValue === 'object' &&
          !Array.isArray(authoredValue)
            ? (authoredValue as Record<string, unknown>)
            : undefined;
        const explicitVersion = authoredRecord?.version;
        into.push({
          name: entry.name,
          description:
            typeof authoredRecord?.description === 'string'
              ? authoredRecord.description
              : '',
          stages: [],
          source,
          authoredVersion:
            typeof explicitVersion === 'number' ? explicitVersion : 1,
          definitionValid: false,
          planAvailable: false,
          executable: false,
          executionMode: 'unavailable',
          diagnostics: error.cause.diagnostics,
          pipelinePath,
          authoredText,
          authoredDefinition: authoredValue,
        });
      }
      // Without a preparation contract, preserve the legacy success-only list.
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
  projectRoot?: string,
  loadChild: (name: string) => PipelineYaml = (name) =>
    loadPipelineByName(name, projectRoot)
): void {
  for (const [stageIndex, stage] of pipeline.stages.entries()) {
    if (stage.kind !== 'decompose') continue;
    const childName = resolveChildPipelineName(stage);
    const stagePath = `/stages/${stageIndex}/childPipeline`;

    let child: PipelineYaml;
    try {
      child = loadChild(childName);
    } catch (error) {
      const contextualize = (
        cause: PipelineValidationError
      ): PipelineValidationError =>
        new PipelineValidationError(
          `Decompose stage '${stage.id}' references childPipeline '${childName}': ${cause.message}`,
          cause.code,
          {
            path: cause.path ?? stagePath,
            cause,
          }
        );
      if (error instanceof PipelineValidationError) {
        throw contextualize(error);
      }
      if (error instanceof PipelineLoadError) {
        if (error.cause instanceof PipelineValidationError) {
          throw contextualize(error.cause);
        }
        if (error.cause instanceof DefinitionReadError) {
          throw contextualize(
            pipelineValidationErrorFromDefinitionReadError(error.cause, {
              cause: error,
              fallbackPath: stagePath,
            })
          );
        }
        throw new PipelineValidationError(
          `Decompose stage '${stage.id}' references childPipeline '${childName}', but the resolved source could not be loaded: ${error.message}`,
          'pipeline_invalid',
          { path: stagePath, cause: error }
        );
      }
      throw new PipelineValidationError(
        `Decompose stage '${stage.id}' references childPipeline '${childName}' which cannot be resolved`,
        'pipeline_invalid',
        { path: stagePath, cause: error }
      );
    }

    if (child.stages.some(s => s.kind === 'decompose')) {
      throw new PipelineValidationError(
        `Recursion guard: childPipeline '${childName}' (used by decompose stage '${stage.id}') ` +
          `itself contains a decompose stage; child pipelines must be decompose-free`,
        'pipeline_invalid',
        { path: stagePath }
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
export function listPipelinesWithInfo(
  projectRoot?: string,
  preparation?: PipelinePreparationOptions,
  loadPrepared?: (name: string) => PreparedPipelineResolution
): PipelineInfo[] {
  const pipelines: PipelineInfo[] = [];
  const seenNames = new Set<string>();

  // Project-local first (highest priority, if projectRoot provided)
  if (projectRoot) {
    collectPipelineInfo(
      getProjectPipelinesDir(projectRoot),
      'project',
      seenNames,
      pipelines,
      preparation,
      loadPrepared
    );
  }

  // User overrides (if not overridden by project)
  collectPipelineInfo(
    getUserPipelinesDir(),
    'user',
    seenNames,
    pipelines,
    preparation,
    loadPrepared
  );

  // Package built-ins (if not overridden by project or user)
  collectPipelineInfo(
    getPackagePipelinesDir(),
    'package',
    seenNames,
    pipelines,
    preparation,
    loadPrepared
  );

  return pipelines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
