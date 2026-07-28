import chalk from 'chalk';

import { probeCodexAvailability } from '../codex/index.js';
import { resolveConfigStoreLayer } from '../effective-config.js';
import { getGlobalConfig } from '../global-config.js';
import { resolveDesiredWorkflowSelection } from '../profiles.js';
import { resolveProjectHome } from '../project-home.js';
import { hasExpertSelectionAck } from '../expert-selection-state.js';
import {
  loadWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowRegistryOptions,
} from '../workflow-registry/index.js';
import { PipelineValidationError, validatePipelineSkills } from './pipeline.js';
import {
  loadPipelineByName,
  type PreparedPipelineResolution,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
} from './resolver.js';
import {
  resolvePipelineExecutionPlan,
  resolvePipelineStageOverrides,
  type PipelineExecutionPlan,
} from './stage-overrides.js';
import {
  detectHostRuntime,
  type DetectedHostRuntime,
} from '../runtime-adapters.js';
import type { AgentRuntime, PipelineYaml, StageRole } from './types.js';
import type { PreparedDefinition } from './definition.js';

export type PipelineExecutionNotice =
  | {
      kind: 'unknown-profile-workflows';
      workflowIds: string[];
    }
  | {
      kind: 'unknown-host-runtime';
      override: 'RASEN_AGENT_RUNTIME';
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
  /** Injected once-detected LEAD host. */
  host?: DetectedHostRuntime;
  /** Test seam used only when `host` is not supplied. */
  detectHost?: () => DetectedHostRuntime;
  /** Run-local role choices. These participate in the final execution-plan
   * route preflight and top persisted config without mutating it. */
  roleRuntimeOverrides?: Partial<Record<StageRole, AgentRuntime>>;
  /** Human preflight notices. `false` suppresses them; omitted preserves the
   * legacy English console output for non-pipeline callers. */
  reporter?: PipelineExecutionReporter | false;
  /**
   * A caller-owned frozen preparation operation. Product launch paths provide
   * these together so capability admission, child resolution, and runtime
   * validation all observe one catalog snapshot.
   */
  skillSets?: PipelineExecutionSkillSets;
  loadPrepared?: (name: string) => PreparedPipelineResolution;
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

  const message =
    notice.kind === 'unknown-profile-workflows'
      ? `Warning: dropping unknown workflow id(s) from stored profile: ${notice.workflowIds.join(', ')}`
      : 'Warning: the LEAD host runtime is unknown; using the legacy compatibility route. ' +
        `Set ${notice.override}=claude|codex for deterministic dispatch.`;
  // Warnings/notices go to stderr so they never corrupt `--json` stdout (the
  // CLI-spawning tests JSON.parse stdout; a stdout warning broke them on CI,
  // where RASEN_AGENT_RUNTIME is unset and this notice fires).
  console.error(chalk.yellow(message));
}

function throwRuntimeUnavailable(plan: PipelineExecutionPlan): never {
  const bridged = plan.stages.find(
    (stage) =>
      stage.dispatchMode === 'exec-bridge' ||
      (stage.dispatchMode === 'legacy-fallback' && stage.runtime === 'codex')
  );
  throw new PipelineValidationError(
    `Stage "${bridged?.id ?? '<unknown>'}" requires the codex exec bridge, but codex is not available. ` +
      'Override the affected role to claude (e.g. `rasen pipeline agents <name> --<role> claude`, ' +
      'or a stage-level `runtime: claude` in the pipeline.yaml), or install the codex CLI.',
    'pipeline_runtime_unavailable'
  );
}

function throwUnsupportedRoute(plan: PipelineExecutionPlan): never {
  const stage = plan.stages.find((candidate) => candidate.dispatchMode === 'unsupported');
  throw new PipelineValidationError(
    `Unsupported runtime route ${plan.hostRuntime} -> ${stage?.runtime ?? '<unknown>'} ` +
      `for stage "${stage?.id ?? '<unknown>'}"${stage?.role ? ` (role ${stage.role})` : ''}. ` +
      'Remove or change the explicit runtime override to inherit the host, or run this workflow from a supported host.',
    'pipeline_runtime_route_unsupported'
  );
}

export interface PipelineExecutionSkillSets {
  knownSkillNames: Set<string>;
  enabledSkillNames: Set<string>;
}

export interface ResolvePipelineExecutionSkillSetsOptions
  extends Pick<PipelineExecutionOptions, 'reporter'> {
  /** Already-frozen catalog for this product operation. */
  workflowCatalog?: WorkflowCatalog;
  /** Used only when no frozen catalog was supplied. */
  workflowRegistryOptions?: WorkflowRegistryOptions;
}

export interface PreparedDefinitionExecutionSelection {
  readonly mode: 'legacy' | 'reconciler';
  readonly pipeline: PipelineYaml;
}

/**
 * Definition-aware launch selection. A compiled plan is not itself runtime
 * ownership: this slice selects between the legacy prompt-owned path (v1
 * definitions without ReviewCycle) and the reconciler path (v1 definitions
 * whose normalized form has a ReviewCycle BoundedLoop, plus authored v2).
 * Definitions with no runtime owner fail here with the stable capability
 * reason before any legacy or reconciler dispatcher can be reached.
 */
export function preflightPreparedDefinitionExecution(
  prepared: PreparedDefinition
): PreparedDefinitionExecutionSelection {
  if (
    !prepared.capability.executable ||
    prepared.capability.executionMode === 'unavailable' ||
    prepared.authoredVersion !== 1
  ) {
    const reason =
      prepared.capability.unavailableReason ?? 'pipeline_runtime_unavailable';
    throw new PipelineValidationError(
      `Pipeline Definition version ${prepared.authoredVersion} has a valid plan, but no complete runtime owner is available (${reason}).`,
      reason
    );
  }

  return {
    mode: prepared.capability.executionMode === 'reconciler' ? 'reconciler' : 'legacy',
    pipeline: prepared.authoredSource as PipelineYaml,
  };
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
  options: ResolvePipelineExecutionSkillSetsOptions = {}
): Promise<PipelineExecutionSkillSets> {
  const catalog =
    options.workflowCatalog ??
    loadWorkflowCatalog(options.workflowRegistryOptions);
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
 * After the skill checks, resolves one host-aware runtime/dispatch plan across
 * the pipeline AND its decompose children. Unsupported routes fail before
 * dispatch, after run-local role overrides have topped persisted configuration
 * in that final plan. The Codex CLI is probed at most once only when an
 * exec-bridge (or unknown-host legacy Codex target) needs it; Codex-native
 * stages never probe the external CLI.
 */
export async function validatePipelineForExecution(
  pipeline: PipelineYaml,
  projectRoot?: string,
  options?: PipelineExecutionOptions
): Promise<void> {
  const { knownSkillNames, enabledSkillNames } =
    options?.skillSets ??
    (await resolvePipelineExecutionSkillSets(projectRoot, {
      reporter: options?.reporter,
    }));
  validatePipelineSkills(pipeline, knownSkillNames, enabledSkillNames);
  const loadChild = options?.loadPrepared
    ? (name: string): PipelineYaml =>
        preflightPreparedDefinitionExecution(
          options.loadPrepared!(name).prepared
        ).pipeline
    : undefined;
  validateDecomposeChildPipelines(pipeline, projectRoot, loadChild);

  const host =
    options?.host ??
    options?.detectHost?.() ??
    detectHostRuntime();
  if (host.runtime === 'unknown') {
    reportPipelineExecutionNotice(options?.reporter, {
      kind: 'unknown-host-runtime',
      override: 'RASEN_AGENT_RUNTIME',
    });
  }

  const storeLayer = projectRoot ? await resolveConfigStoreLayer(projectRoot) : null;
  const resolvePlan = (candidate: PipelineYaml): PipelineExecutionPlan =>
    resolvePipelineExecutionPlan(candidate, {
      host,
      roleRuntimeOverrides: options?.roleRuntimeOverrides,
      overrides: resolvePipelineStageOverrides(candidate.name, {
        projectRoot,
        store: storeLayer,
      }),
    });
  const plans = [resolvePlan(pipeline)];

  for (const stage of pipeline.stages) {
    if (stage.kind !== 'decompose') continue;
    const child = loadChild
      ? loadChild(resolveChildPipelineName(stage))
      : loadPipelineByName(resolveChildPipelineName(stage), projectRoot);
    validatePipelineSkills(child, knownSkillNames, enabledSkillNames);
    plans.push(resolvePlan(child));
  }

  for (const plan of plans) {
    if (plan.stages.some((stage) => stage.dispatchMode === 'unsupported')) {
      throwUnsupportedRoute(plan);
    }
  }

  const bridgePlan = plans.find((plan) =>
    plan.stages.some(
      (stage) =>
        stage.dispatchMode === 'exec-bridge' ||
        (stage.dispatchMode === 'legacy-fallback' && stage.runtime === 'codex')
    )
  );
  if (bridgePlan) {
    const probeCodex = options?.probeCodex ?? probeCodexAvailability;
    if (!probeCodex()) {
      throwRuntimeUnavailable(bridgePlan);
    }
  }
}
