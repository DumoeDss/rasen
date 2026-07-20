import { getGlobalConfig } from '../global-config.js';
import { getProfileWorkflows } from '../profiles.js';
import {
  getExpertSkillDefinitions,
  loadWorkflowCatalog,
  resolveWorkflowSelection,
} from '../workflow-registry/index.js';
import { validatePipelineSkills } from './pipeline.js';
import {
  loadPipelineByName,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
} from './resolver.js';
import type { PipelineYaml } from './types.js';

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
  const selected = resolveWorkflowSelection(
    catalog,
    getProfileWorkflows(config.profile ?? 'full', config.workflows)
  );
  const enabledSkillNames = new Set([
    ...selected.map((definition) => definition.skill.template.name),
    ...expertSkillNames,
  ]);
  return { knownSkillNames, enabledSkillNames };
}

/**
 * Validate a pipeline immediately before execution. Decompose child pipelines
 * are part of the selected execution plan, so validate their skills too.
 */
export function validatePipelineForExecution(
  pipeline: PipelineYaml,
  projectRoot?: string
): void {
  const { knownSkillNames, enabledSkillNames } = resolvePipelineExecutionSkillSets();
  validatePipelineSkills(pipeline, knownSkillNames, enabledSkillNames);
  validateDecomposeChildPipelines(pipeline, projectRoot);

  for (const stage of pipeline.stages) {
    if (stage.kind !== 'decompose') continue;
    const child = loadPipelineByName(resolveChildPipelineName(stage), projectRoot);
    validatePipelineSkills(child, knownSkillNames, enabledSkillNames);
  }
}
