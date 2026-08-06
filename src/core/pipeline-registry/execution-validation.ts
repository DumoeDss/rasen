import chalk from 'chalk';

import { resolveConfigStoreLayer } from '../effective-config.js';
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
import {
  resolvePipelineExecutionPlan,
  resolvePipelineStageOverrides,
  type ExecutionStageRuntime,
  type PipelineExecutionPlan,
} from './stage-overrides.js';
import {
  detectHostRuntime,
  hasRuntimeCapability,
  type DetectedHostRuntime,
  type DispatchRuntime,
  type RuntimeAdapterId,
} from '../runtime-adapters.js';
import { DISPATCH_ADAPTERS } from '../runtimes/dispatch-adapters.js';
import type { AgentRuntime, PipelineYaml, StageRole } from './types.js';

export type PipelineExecutionNotice =
  | {
      kind: 'unknown-profile-workflows';
      workflowIds: string[];
    }
  | {
      kind: 'unknown-host-runtime';
      override: 'RASEN_AGENT_RUNTIME';
    }
  | {
      kind: 'host-runtime-without-dispatch-adapter';
      host: RuntimeAdapterId;
      override: 'RASEN_AGENT_RUNTIME';
    };

export type PipelineExecutionReporter = (notice: PipelineExecutionNotice) => void;

export interface PipelineExecutionOptions {
  /**
   * Per-target availability checks, injected so the preflight is unit-testable
   * without a real binary. A target's own `DispatchAdapter.probeAvailability`
   * is used when no override is supplied. Each required target is checked at
   * most once per `validatePipelineForExecution` invocation.
   */
  probe?: Partial<Record<DispatchRuntime, () => boolean>>;
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
}

/**
 * English fallback copy for callers that pass no reporter. The localized
 * catalog (`formatPipelineExecutionNotice`) is the pipeline-command path;
 * this keeps non-pipeline callers diagnosable without a locale dependency.
 */
function unlocalizedNoticeMessage(notice: PipelineExecutionNotice): string {
  switch (notice.kind) {
    case 'unknown-profile-workflows':
      return `Warning: dropping unknown workflow id(s) from stored profile: ${notice.workflowIds.join(', ')}`;
    case 'unknown-host-runtime':
      return (
        'Warning: the LEAD host runtime is unknown; using the legacy compatibility route. ' +
        `Set ${notice.override}=claude|codex for deterministic dispatch.`
      );
    case 'host-runtime-without-dispatch-adapter':
      // The second clause states what forcing the override ACTUALLY does to
      // the context probe (design D7's coupling): it lifts the
      // `unsupported-host` refusal, after which an implicit `--latest`
      // resolves the Claude transcript store again — NOT this harness's own
      // session, and not the forced runtime's store either (the override
      // feeds host detection only; the probe still takes its store from
      // `--runtime`, which an implicit probe does not pass).
      return (
        `Warning: LEAD host runtime "${notice.host}" has no dispatch adapter; using the legacy compatibility route. ` +
        `Set ${notice.override}=claude|codex for deterministic dispatch — that also lifts the context-probe refusal, ` +
        'after which `rasen agent context --latest` reads the Claude transcript store instead of this host\'s own session.'
      );
  }
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

  const message = unlocalizedNoticeMessage(notice);
  // Warnings/notices go to stderr so they never corrupt `--json` stdout (the
  // CLI-spawning tests JSON.parse stdout; a stdout warning broke them on CI,
  // where RASEN_AGENT_RUNTIME is unset and this notice fires).
  console.error(chalk.yellow(message));
}

/**
 * Whether a stage can only run if `target`'s own CLI is present.
 *
 * A bridged stage always needs it. Under the legacy compatibility route the
 * orchestration playbook drives dispatch itself, so the tool is needed
 * exactly when the target's spawn is playbook-owned — the playbook shells the
 * binary — and not when it is rasen-owned, because Rasen is not the one
 * dispatching on that route.
 */
function stageNeedsTargetTool(
  stage: ExecutionStageRuntime,
  target: DispatchRuntime
): boolean {
  if (stage.runtime !== target) return false;
  if (stage.bridge !== undefined) return true;
  return (
    stage.dispatchMode === 'legacy-fallback' &&
    DISPATCH_ADAPTERS[target].spawn === 'playbook-owned'
  );
}

/**
 * The availability check for a dispatch target: an injected override, else
 * the target's own adapter. One seam keyed by target rather than a named
 * option per runtime, so a runtime added later needs no new option.
 */
function resolveAvailabilityProbe(
  target: DispatchRuntime,
  options: PipelineExecutionOptions | undefined
): () => boolean {
  return options?.probe?.[target] ?? DISPATCH_ADAPTERS[target].probeAvailability;
}

/**
 * A stage whose worker cannot be started because the target runtime's own
 * tool is missing. Every user-facing fact here comes from that runtime's
 * adapter, so the message can never name another bridge's tool (design D6).
 */
function throwRuntimeUnavailable(
  plans: PipelineExecutionPlan[],
  target: DispatchRuntime
): never {
  const adapter = DISPATCH_ADAPTERS[target];
  const plan =
    plans.find((candidate) =>
      candidate.stages.some((stage) => stageNeedsTargetTool(stage, target))
    ) ?? plans[0];
  const bridged = plan.stages.find((stage) => stageNeedsTargetTool(stage, target));
  // Only a dispatch-capable host names a role runtime the role flags accept
  // (`AgentRuntimeSchema` = `z.enum(DISPATCH_RUNTIMES)`). A recognized host
  // with no dispatch adapter must NOT be printed here — advising "override
  // the role to omp" names a value every role validator rejects.
  const hostOverride = hasRuntimeCapability(plan.hostRuntime, 'canDispatch')
    ? plan.hostRuntime
    : 'the detected host runtime';
  throw new PipelineValidationError(
    `Stage "${bridged?.id ?? '<unknown>'}" requires the ${adapter.bridge} bridge, but ${adapter.cliLabel} is not available. ` +
      `Override the affected role to ${hostOverride} (for example with a role flag or stage runtime), ` +
      `or install the ${adapter.installHint}.`,
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
  const { knownSkillNames, enabledSkillNames } = await resolvePipelineExecutionSkillSets(
    projectRoot,
    { reporter: options?.reporter }
  );
  validatePipelineSkills(pipeline, knownSkillNames, enabledSkillNames);
  validateDecomposeChildPipelines(pipeline, projectRoot);

  const host =
    options?.host ??
    options?.detectHost?.() ??
    detectHostRuntime();
  if (host.runtime === 'unknown') {
    reportPipelineExecutionNotice(options?.reporter, {
      kind: 'unknown-host-runtime',
      override: 'RASEN_AGENT_RUNTIME',
    });
  } else if (!hasRuntimeCapability(host.runtime, 'canDispatch')) {
    // D6: after host identity widened past dispatch capability, a recognized
    // host takes the legacy route too. Without this branch the degradation
    // would be silent — the one thing this change exists to prevent.
    reportPipelineExecutionNotice(options?.reporter, {
      kind: 'host-runtime-without-dispatch-adapter',
      host: host.runtime,
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
    const child = loadPipelineByName(resolveChildPipelineName(stage), projectRoot);
    validatePipelineSkills(child, knownSkillNames, enabledSkillNames);
    plans.push(resolvePlan(child));
  }

  for (const plan of plans) {
    if (plan.stages.some((stage) => stage.dispatchMode === 'unsupported')) {
      throwUnsupportedRoute(plan);
    }
  }

  const requiredTargets = new Set<DispatchRuntime>();
  for (const plan of plans) {
    for (const stage of plan.stages) {
      if (stageNeedsTargetTool(stage, stage.runtime)) requiredTargets.add(stage.runtime);
    }
  }
  for (const target of requiredTargets) {
    if (!resolveAvailabilityProbe(target, options)()) {
      throwRuntimeUnavailable(plans, target);
    }
  }
}
