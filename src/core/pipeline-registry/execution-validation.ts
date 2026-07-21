import chalk from 'chalk';

import { probeCodexAvailability } from '../codex/index.js';
import { getGlobalConfig } from '../global-config.js';
import { resolveDesiredWorkflowSelection } from '../profiles.js';
import { resolveProjectHome } from '../project-home.js';
import { hasExpertSelectionAck } from '../expert-selection-state.js';
import { loadWorkflowCatalog } from '../workflow-registry/index.js';
import { PipelineValidationError, validatePipelineSkills } from './pipeline.js';
import {
  loadPipelineByName,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
} from './resolver.js';
import { resolveStageRuntimeConfig } from './types.js';
import type { PipelineYaml } from './types.js';

export type PipelineExecutionNotice = {
  kind: 'unknown-profile-workflows';
  workflowIds: string[];
};

export type PipelineExecutionReporter = (notice: PipelineExecutionNotice) => void;

export interface PipelineExecutionOptions {
  /**
   * Codex-CLI availability check, injected so the preflight is unit-testable
   * without a real codex binary. Defaults to the real
   * `probeCodexAvailability`. Called at most once per
   * `validatePipelineForExecution` invocation.
   */
  probeCodex?: () => boolean;
  /** Human preflight notices. `false` suppresses them; omitted preserves the
   * legacy English console output for non-pipeline callers. */
  reporter?: PipelineExecutionReporter | false;
}

function reportPipelineExecutionNotice(
  reporter: PipelineExecutionReporter | false | undefined,
  notice: PipelineExecutionNotice
): void {
  if (reporter === false) return;
  if (reporter) {
    reporter(notice);
    return;
  }

  console.log(
    chalk.yellow(
      `Warning: dropping unknown workflow id(s) from stored profile: ${notice.workflowIds.join(', ')}`
    )
  );
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

/**
 * Resolve the machine's known skills and active-profile-installed skills
 * once per preflight. Uses the same `resolveDesiredWorkflowSelection`
 * init/update call (workflow ids + profile-default/closure expert ids,
 * `expertSelectionExplicit`-aware) so `enabledSkillNames` reflects experts
 * that are actually part of the resolved install set, instead of treating
 * every expert as unconditionally enabled (review-round Major fix: post-6b,
 * "known expert, not installed" is a normal, intended state the preflight
 * guard must cover — see `validatePipelineSkills`'s `pipeline_skill_disabled`
 * check below). Called exactly once per `validatePipelineForExecution`
 * invocation, preserving the single-call-site/probe-once property.
 *
 * The `expertSelectionExplicit` marker is machine-wide (review-round Blocker
 * fix, `expert-selection-state.ts`) and can flip to `true` from an action
 * against a completely different project than `projectRoot`. Mirroring
 * `update.ts`'s gate exactly: the effective flag used here is
 * `globalMarkerExplicit && projectAcknowledged`, so a project that has never
 * been through its own transition still sees every expert enabled at
 * preflight — consistent with what `update` actually keeps installed for it
 * (a false `pipeline_skill_disabled` during that one-run delay window would
 * be a regression the Blocker fix didn't intend to introduce here). When
 * `projectRoot` is omitted or its machine home can't be resolved, this falls
 * back to the raw global marker (the pre-fix behavior for that edge case),
 * same as `update.ts`'s own best-effort fallback.
 */
export async function resolvePipelineExecutionSkillSets(
  projectRoot?: string,
  options: Pick<PipelineExecutionOptions, 'reporter'> = {}
): Promise<PipelineExecutionSkillSets> {
  const catalog = loadWorkflowCatalog();
  const knownSkillNames = new Set(catalog.definitions.map((definition) => definition.skill.template.name));
  const config = getGlobalConfig();
  const globalMarkerExplicit = config.expertSelectionExplicit === true;

  let projectAcknowledged = false;
  if (globalMarkerExplicit && projectRoot) {
    try {
      const projectHome = await resolveProjectHome(projectRoot, { ensure: false });
      projectAcknowledged = projectHome !== null && hasExpertSelectionAck(projectHome.homeDir);
    } catch {
      projectAcknowledged = false;
    }
  }
  const expertSelectionExplicit = projectRoot
    ? globalMarkerExplicit && projectAcknowledged
    : globalMarkerExplicit;

  const { ids: desiredIds, unknown: unknownProfileWorkflows } = resolveDesiredWorkflowSelection(
    catalog,
    config.profile ?? 'full',
    config.workflows,
    expertSelectionExplicit
  );
  if (unknownProfileWorkflows.length > 0) {
    reportPipelineExecutionNotice(options.reporter, {
      kind: 'unknown-profile-workflows',
      workflowIds: unknownProfileWorkflows,
    });
  }
  const desiredSet = new Set(desiredIds);
  const enabledSkillNames = new Set(
    catalog.definitions
      .filter((definition) => desiredSet.has(definition.id))
      .map((definition) => definition.skill.template.name)
  );
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
export async function validatePipelineForExecution(
  pipeline: PipelineYaml,
  projectRoot?: string,
  options?: PipelineExecutionOptions
): Promise<void> {
  const { knownSkillNames, enabledSkillNames } = await resolvePipelineExecutionSkillSets(
    projectRoot,
    { reporter: options?.reporter }
  );
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
