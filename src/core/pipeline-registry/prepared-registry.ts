import {
  loadWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowRegistryOptions,
} from '../workflow-registry/index.js';
import {
  createProductionCapabilityCatalogSnapshot,
  DefinitionReadError,
  type CapabilityCatalogSnapshot,
} from './definition.js';
import {
  preflightPreparedDefinitionExecution,
  resolvePipelineExecutionSkillSets,
  validatePipelineForExecution,
  validatePreparedPipelineForExecution,
  type PipelineExecutionOptions,
  type PipelineExecutionSkillSets,
} from './execution-validation.js';
import {
  listPipelinesWithInfo,
  loadPreparedPipelineByName,
  PipelineLoadError,
  type PipelineInfo,
  type PreparedPipelineResolution,
} from './resolver.js';
import { pipelineValidationErrorFromDefinitionReadError } from './pipeline.js';
import type { PipelineYaml } from './types.js';
import { getGlobalDataDir } from '../global-config.js';
import {
  loadTrustedExecutionAdapterCatalog,
  type TrustedExecutionAdapterCatalog,
} from './trusted-execution-adapters.js';

export interface PreparedPipelineExecution {
  readonly resolution: PreparedPipelineResolution;
  readonly pipeline: PipelineYaml;
}

export interface ProductionPreparedPipelineRegistry {
  readonly projectRoot: string | undefined;
  readonly workflowCatalog: WorkflowCatalog;
  readonly catalog: CapabilityCatalogSnapshot;
  readonly trustedExecutionAdapters: TrustedExecutionAdapterCatalog | undefined;
  readonly skillSets: PipelineExecutionSkillSets;
  load(name: string): PreparedPipelineResolution;
  list(): PipelineInfo[];
  selectForExecution(
    name: string,
    options?: PipelineExecutionOptions
  ): Promise<PreparedPipelineExecution>;
}

export interface FreezePreparedPipelineRegistryOptions {
  readonly reporter?: PipelineExecutionOptions['reporter'];
  readonly forbiddenSkillNames?: ReadonlySet<string>;
  readonly workflowRegistryOptions?: WorkflowRegistryOptions;
  /** Test/host seam; invoked exactly once for the frozen operation. */
  readonly workflowCatalogLoader?: (
    options?: WorkflowRegistryOptions
  ) => WorkflowCatalog;
  /** Host/test seam. Project Definitions never supply this catalog. */
  readonly trustedExecutionAdapterCatalogLoader?: (
    hostStateRoot: string
  ) => TrustedExecutionAdapterCatalog | undefined;
}

/**
 * Freezes the project-aware capability meaning once for one product operation.
 * Every registry read and launch selection returned by the session shares that
 * exact snapshot. The legacy PipelineYaml adapter is selected only after the
 * prepared result passes the Definition-aware runtime preflight.
 */
export async function freezeProductionPreparedPipelineRegistry(
  projectRoot?: string,
  options: FreezePreparedPipelineRegistryOptions = {}
): Promise<ProductionPreparedPipelineRegistry> {
  const workflowRegistryOptions = {
    ...options.workflowRegistryOptions,
    ...(options.workflowRegistryOptions?.projectRoot === undefined &&
    projectRoot !== undefined
      ? { projectRoot }
      : {}),
  };
  const workflowCatalog = (
    options.workflowCatalogLoader ?? loadWorkflowCatalog
  )(workflowRegistryOptions);
  const skillSets = await resolvePipelineExecutionSkillSets(projectRoot, {
    reporter: options.reporter,
    workflowCatalog,
  });
  const catalog = createProductionCapabilityCatalogSnapshot(
    workflowCatalog.definitions,
    skillSets.enabledSkillNames,
    options.forbiddenSkillNames
  );
  const trustedExecutionAdapters = (
    options.trustedExecutionAdapterCatalogLoader ??
    loadTrustedExecutionAdapterCatalog
  )(getGlobalDataDir());
  const preparation = { catalog };
  const resolutions = new Map<
    string,
    | { readonly ok: true; readonly value: PreparedPipelineResolution }
    | { readonly ok: false; readonly error: unknown }
  >();
  const load = (name: string): PreparedPipelineResolution => {
    const normalizedName = name.replace(/\.ya?ml$/, '');
    const cached = resolutions.get(normalizedName);
    if (cached) {
      if (cached.ok) return cached.value;
      throw cached.error;
    }
    try {
      const value = loadPreparedPipelineByName(
        normalizedName,
        projectRoot,
        preparation
      );
      resolutions.set(normalizedName, { ok: true, value });
      return value;
    } catch (error) {
      resolutions.set(normalizedName, { ok: false, error });
      throw error;
    }
  };

  return Object.freeze({
    projectRoot,
    workflowCatalog,
    catalog,
    trustedExecutionAdapters,
    skillSets,
    load,
    list: (): PipelineInfo[] =>
      listPipelinesWithInfo(projectRoot, preparation, load),
    selectForExecution: async (
      name: string,
      executionOptions: PipelineExecutionOptions = {}
    ): Promise<PreparedPipelineExecution> => {
      let resolution: PreparedPipelineResolution;
      try {
        resolution = load(name);
      } catch (error) {
        if (
          error instanceof PipelineLoadError &&
          error.cause instanceof DefinitionReadError
        ) {
          throw pipelineValidationErrorFromDefinitionReadError(error.cause, {
            cause: error,
          });
        }
        throw error;
      }
      const selection = preflightPreparedDefinitionExecution(
        resolution.prepared
      );
      if (resolution.prepared.authoredVersion === 1) {
        await validatePipelineForExecution(selection.pipeline, projectRoot, {
          ...executionOptions,
          skillSets,
          loadPrepared: load,
        });
      } else {
        await validatePreparedPipelineForExecution(
          resolution.prepared,
          catalog,
          projectRoot,
          executionOptions
        );
      }
      return {
        resolution,
        pipeline: selection.pipeline,
      };
    },
  });
}
