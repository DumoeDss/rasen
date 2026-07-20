import chalk from 'chalk';

import { probeCodexAvailability } from '../codex/index.js';
import { getGlobalConfig } from '../global-config.js';
import { getProfileWorkflows } from '../profiles.js';
import {
  filterKnownWorkflowRoots,
  getExpertSkillDefinitions,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
} from '../workflow-registry/index.js';
import { PipelineValidationError, validatePipelineSkills } from './pipeline.js';
import {
  loadPipelineByName,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
} from './resolver.js';
import { resolveStageRuntimeConfig } from './types.js';
import type { PipelineYaml } from './types.js';

export interface PipelineExecutionOptions {
  /**
   * Codex-CLI availability check, injected so the preflight is unit-testable
   * without a real codex binary. Defaults to the real
   * `probeCodexAvailability`. Called at most once per
   * `validatePipelineForExecution` invocation.
   */
  probeCodex?: () => boolean;
}

/** Whether any stage of `pipeline` resolves its effective runtime to `codex`. */
function pipelineRequiresCodex(pipeline: PipelineYaml): boolean {
  return pipeline.stages.some(
    (stage) => resolveStageRuntimeConfig(stage, pipeline).runtime === 'codex'
  );
}

function throwRuntimeUnavailable(): never {
  throw new PipelineValidationError(
    'This pipeline requires the codex CLI runtime, but codex is not available. ' +
      'Override the affected role to claude (e.g. `rasen pipeline agents <name> --<role> claude`, ' +
      'or a stage-level `runtime: claude` in the pipeline.yaml), or install the codex CLI.',
    'pipeline_runtime_unavailable'
  );
}

export interface PipelineExecutionSkillSets {
  knownSkillNames: Set<string>;
  enabledSkillNames: Set<string>;
}

/** Resolve the machine's known skills and active-profile skills once per preflight. */
export function resolvePipelineExecutionSkillSets(): PipelineExecutionSkillSets {
  const catalog = loadWorkflowCatalog();
  const expertSkillNames = getExpertSkillDefinitions().map(
    (definition) => definition.template.name
  );
  const knownSkillNames = new Set([
    ...catalog.definitions.map((definition) => definition.skill.template.name),
    ...expertSkillNames,
  ]);
  const config = getGlobalConfig();
  const { known: knownProfileWorkflows, unknown: unknownProfileWorkflows } =
    filterKnownWorkflowRoots(
      catalog,
      getProfileWorkflows(config.profile ?? 'full', config.workflows)
    );
  if (unknownProfileWorkflows.length > 0) {
    console.log(
      chalk.yellow(
        `Warning: dropping unknown workflow id(s) from stored profile: ${unknownProfileWorkflows.join(', ')}`
      )
    );
  }
  const selected = resolveWorkflowSelection(catalog, knownProfileWorkflows);
  const enabledSkillNames = new Set([
    ...selected.map((definition) => definition.skill.template.name),
    ...expertSkillNames,
  ]);
  return { knownSkillNames, enabledSkillNames };
}

/**
 * Validate a pipeline immediately before execution. Decompose child pipelines
 * are part of the selected execution plan, so validate their skills too.
 *
 * After the skill checks, resolves every stage's effective agent runtime
 * (stage `runtime` > pipeline `agents.<role>` > default `claude`) across the
 * pipeline AND its decompose children (the same single-level recursion the
 * skill checks above already perform — decompose children are themselves
 * decompose-free, per the registry's recursion guard). If any stage
 * resolves to `codex`, the codex CLI's availability is probed at most once
 * (memoized) via `options.probeCodex` (default: the real
 * `probeCodexAvailability`); when codex is required but unavailable, this
 * throws before dispatch naming both remedies. A pipeline where no stage
 * resolves to `codex` never probes and never fails on runtime grounds.
 */
export function validatePipelineForExecution(
  pipeline: PipelineYaml,
  projectRoot?: string,
  options?: PipelineExecutionOptions
): void {
  const { knownSkillNames, enabledSkillNames } = resolvePipelineExecutionSkillSets();
  validatePipelineSkills(pipeline, knownSkillNames, enabledSkillNames);
  validateDecomposeChildPipelines(pipeline, projectRoot);

  let requiresCodex = pipelineRequiresCodex(pipeline);

  for (const stage of pipeline.stages) {
    if (stage.kind !== 'decompose') continue;
    const child = loadPipelineByName(resolveChildPipelineName(stage), projectRoot);
    validatePipelineSkills(child, knownSkillNames, enabledSkillNames);
    requiresCodex = requiresCodex || pipelineRequiresCodex(child);
  }

  if (!requiresCodex) {
    return;
  }

  const probeCodex = options?.probeCodex ?? probeCodexAvailability;
  if (!probeCodex()) {
    throwRuntimeUnavailable();
  }
}
