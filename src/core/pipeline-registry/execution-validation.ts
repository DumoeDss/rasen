import chalk from 'chalk';

import { probeClaudeAvailability } from '../claude/index.js';
import { probeCodexAvailability } from '../codex/index.js';
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
  type PipelineExecutionPlan,
} from './stage-overrides.js';
import {
  detectHostRuntime,
  hasRuntimeCapability,
  type DetectedHostRuntime,
  type DispatchBridge,
  type RuntimeAdapterId,
} from '../runtime-adapters.js';
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
   * Codex-CLI availability check, injected so the preflight is unit-testable
   * without a real codex binary. Defaults to the real
   * `probeCodexAvailability`. Called at most once per
   * `validatePipelineForExecution` invocation.
   */
  probeCodex?: () => boolean;
  /**
   * Claude-CLI availability check for the `claude-print` bridge. Injected so
   * automated tests never call the real Claude service or CLI.
   */
  probeClaude?: () => boolean;
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
      return (
        `Warning: LEAD host runtime "${notice.host}" has no dispatch adapter; using the legacy compatibility route. ` +
        `Set ${notice.override}=claude|codex for deterministic dispatch — that also makes context probing report the forced runtime.`
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

function throwRuntimeUnavailable(
  plans: PipelineExecutionPlan[],
  bridge: DispatchBridge
): never {
  const plan =
    plans.find((candidate) =>
      candidate.stages.some(
        (stage) =>
          stage.bridge === bridge ||
          (bridge === 'codex-exec' &&
            stage.dispatchMode === 'legacy-fallback' &&
            stage.runtime === 'codex')
      )
    ) ?? plans[0];
  const bridged = plan.stages.find(
    (stage) =>
      stage.bridge === bridge ||
      (bridge === 'codex-exec' &&
        stage.dispatchMode === 'legacy-fallback' &&
        stage.runtime === 'codex')
  );
  const targetLabel = bridge === 'codex-exec' ? 'codex' : 'Claude Code';
  const hostOverride =
    plan.hostRuntime === 'unknown' ? 'the detected host runtime' : plan.hostRuntime;
  throw new PipelineValidationError(
    `Stage "${bridged?.id ?? '<unknown>'}" requires the ${bridge} bridge, but ${targetLabel} is not available. ` +
      `Override the affected role to ${hostOverride} (for example with a role flag or stage runtime), ` +
      `or install the ${bridge === 'codex-exec' ? 'Codex CLI' : 'Claude Code CLI'}.`,
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

  const requiredBridges = new Set<DispatchBridge>();
  for (const plan of plans) {
    for (const stage of plan.stages) {
      if (stage.bridge) requiredBridges.add(stage.bridge);
      if (
        stage.dispatchMode === 'legacy-fallback' &&
        stage.runtime === 'codex'
      ) {
        requiredBridges.add('codex-exec');
      }
    }
  }
  for (const bridge of requiredBridges) {
    const available =
      bridge === 'codex-exec'
        ? (options?.probeCodex ?? probeCodexAvailability)()
        : (options?.probeClaude ?? probeClaudeAvailability)();
    if (!available) {
      throwRuntimeUnavailable(plans, bridge);
    }
  }
}
