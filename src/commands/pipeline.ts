/**
 * Pipeline Command
 *
 * Inspect and reason about orchestration pipelines:
 *   - list     : enumerate available pipelines (project > user > package)
 *   - show     : print a single pipeline's stage DAG + build order
 *   - classify : deterministic keyword heuristic mapping a task to a pipeline
 *   - resume   : compute next/remaining stages from a change's run-state
 *
 * This command is a thin consumer of the pipeline-registry public API; it does
 * not own any pipeline parsing/graph logic of its own.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  resolveFrozenExecutionBinding,
  type ExecutionBindingFailure,
  type ExecutionBindingResult,
} from '../core/pipeline-registry/execution-binding.js';
import { frozenExecutionRef } from '../core/learned-skills/context.js';
import type { FrozenKnowledgeContext } from '../core/learned-skills/types.js';
import {
  isSessionContextError,
  requireSessionRuntimeContext,
  type RuntimeContext,
} from '../core/session-runtime-context.js';
import {
  AgentRuntimeSchema,
  StageRoleSchema,
  loadPipelineByName,
  listPipelines,
  listPipelinesWithInfo,
  PipelineGraph,
  readRunStateDetailed,
  resolveRunStateLocation,
  completedStages,
  stageWorkers,
  stagesWithStatus,
  stagesLackingDurableHandle,
  detectDuplicateKeys,
  latestStageHandoffs,
  sessionHandoffGeneration,
  normalizeWorker,
  readPortfolioStateDetailed,
  resolvePortfolioStateLocation,
  runnableChildren,
  interruptedChildren,
  escalatedChildren,
  arePortfolioChildrenComplete,
  isPortfolioComplete,
  resolveChildPipelineName,
  mapLegacySkillId,
  resolveStageRuntimeConfig,
  resolveStageHandoffConfig,
  resolvePipelineReuseConfig,
  resolvePipelineExecutionPlan,
  resolvePipelineRoleRuntimes,
  resolvePipelineStageOverrides,
  resolveMaskedStageGate,
  validatePipelineForExecution,
  type AgentRuntime,
  type PipelineExecutionOptions,
  type PipelineInfo,
  type PipelineYaml,
  type ResolvedStageHandoffConfig,
  type HandoffConfigLayers,
  type ModelConfigLayers,
  type ModelSource,
  type RuntimeSource,
  type StageConfigOverrides,
  type PipelineStageOverrides,
  type MaskedGateSource,
  type ResolvedReuseConfig,
  type ResolvedRoleRuntime,
  type ExecutionStageRuntime,
  type ThresholdValue,
  type ThresholdResolutionContext,
  type RunStateWorker,
  type Stage,
  type StageRole,
} from '../core/pipeline-registry/index.js';
import {
  requireConfigStoreLayer,
  resolveConfigStoreLayer,
  resolveHandoffThresholdLayers,
  resolveModelConfigLayers,
  resolveThresholdBindingLayers,
} from '../core/effective-config.js';
import { loadThresholdSchemeSnapshot } from '../core/threshold-resolver.js';
import { getGlobalConfig } from '../core/global-config.js';
import {
  readProjectConfig,
  resolveAutopilotGatePolicy,
  updateProjectConfigKey,
  type ResolvedGatePolicy,
} from '../core/project-config.js';
import {
  findWildcardDefinition,
  validateConfigKeyPath,
  validateConfigValue,
} from '../core/config-keys.js';
import { tryContextEstimate, type ContextEstimate } from '../core/agent-context.js';
import { validateChangeExists } from './workflow/shared.js';
import { resolveChangeWorkDir } from '../core/change-work.js';
import {
  resolveRootForCommand,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import {
  formatPipelineExecutionNotice,
  formatPipelineRootSelectionNotice,
  getPipelineMessages,
  pipelineMessageError,
  type PipelineMessages,
} from './pipeline-messages.js';
import {
  detectHostRuntime,
  resolveDispatchRoute,
  type DetectedHostRuntime,
  type DispatchMode,
} from '../core/runtime-adapters.js';

interface PipelineCommandOptions {
  json?: boolean;
  forExecution?: boolean;
  store?: string;
  project?: string;
  storePath?: string;
  planner?: string;
  implementer?: string;
  reviewer?: string;
  fixer?: string;
  shipper?: string;
}

type PipelineAgentsOptions = PipelineCommandOptions;

const STAGE_ROLES: StageRole[] = ['planner', 'implementer', 'reviewer', 'fixer', 'shipper'];

/**
 * Serialized form of a single stage in `show` output: every field, with
 * defaults made explicit so consumers (e.g. auto.ts) get a stable shape.
 */
interface StageView {
  id: string;
  kind: Stage['kind'];
  skill: string | null;
  childPipeline: string | null;
  role: Stage['role'] | null;
  requires: string[];
  /** The stage's declared gate value (from the pipeline definition), unmasked. */
  gate: boolean;
  /** The effective gate after the mask (per-stage instance > autopilot.gates off > definition). */
  effectiveGate: boolean;
  /** The layer that decided the effective gate. */
  gateSource: MaskedGateSource;
  loop: Stage['loop'] | null;
  parallelGroup: string | null;
  condition: string | null;
  leadReview: boolean;
  verifyPolicy: Stage['verifyPolicy'] | null;
  runtime: AgentRuntime;
  runtimeSource: RuntimeSource;
  dispatchMode: DispatchMode;
  sessionReuse: Stage['sessionReuse'] | null;
  sandbox: Stage['sandbox'] | null;
  model: string | null;
  modelSource: ModelSource;
  effort: string | null;
  handoff: ResolvedStageHandoffConfig;
}

// Keyword heuristics for `classify`. Matched against the lowercased task string.
const BUG_FIX_KEYWORDS = [
  'fix',
  'bug',
  'broken',
  'regression',
  'error',
  "doesn't work",
  'crash',
  'hotfix',
] as const;

const FULL_FEATURE_KEYWORDS = [
  'add system',
  'implement',
  'module',
  'new feature',
  'multi-component',
  'architecture',
  'redesign',
  'subsystem',
] as const;

/**
 * Whole-word/phrase match so short keywords like "fix" don't hit substrings
 * such as "prefix" / "suffix". Boundaries are non-alphanumeric (or string
 * edges), which also handles multi-word phrases and apostrophes.
 */
function matchesKeyword(keyword: string, lowercasedText: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(lowercasedText);
}

/**
 * Legible rendering of a dual-form threshold for the human-readable detail
 * view: a bare fraction as-is, the absolute `{ remainingTokens }` form as
 * `N tokens remaining`.
 */
function formatThreshold(
  threshold: ThresholdValue,
  messages: PipelineMessages
): string {
  return typeof threshold === 'number'
    ? String(threshold)
    : messages.format('thresholdTokensRemaining', { tokens: threshold.remainingTokens });
}

export class PipelineCommand {
  /**
   * Resolve the Rasen root through the shared root-selection layer, exactly
   * as `rasen validate` does: `--store <id>` selects a registered store,
   * otherwise the nearest ancestor root wins with an implicit-root fallback.
   * Returns null only in `--json` mode when resolution failed — the resolver
   * already printed a machine-readable diagnostic and set `process.exitCode`,
   * so callers early-return without further output (mirrors validate.ts:86-89).
   */
  private async resolveRoot(
    options: PipelineCommandOptions
  ): Promise<ResolvedOpenSpecRoot | null> {
    if (options.json) {
      return resolveRootForCommand(options, { json: true, reporter: false });
    }
    return resolveRootForCommand(options, {
      reporter: (notice) => console.error(formatPipelineRootSelectionNotice(notice)),
    });
  }

  private executionOptions(
    options: PipelineCommandOptions,
    host: DetectedHostRuntime
  ): PipelineExecutionOptions {
    const roleRuntimeOverrides = this.runtimeUpdatesFromOptions(options);
    if (options.json) return { reporter: false, host, roleRuntimeOverrides };
    return {
      reporter: (notice) => console.warn(formatPipelineExecutionNotice(notice)),
      host,
      roleRuntimeOverrides,
    };
  }

  /**
   * List available pipelines with metadata.
   */
  async list(options: PipelineCommandOptions = {}): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    const pipelines = listPipelinesWithInfo(root.path);

    if (options.json) {
      console.log(JSON.stringify({ pipelines }, null, 2));
      return;
    }

    const messages = getPipelineMessages();
    if (pipelines.length === 0) {
      console.log(messages.format('noPipelinesFound'));
      return;
    }

    this.printPipelineTable(pipelines, messages);
  }

  /**
   * Show a single pipeline's stage DAG and build order.
   */
  async show(name: string, options: PipelineCommandOptions = {}): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    const projectRoot = root.path;
    const host = detectHostRuntime();
    const roleRuntimeOverrides = this.runtimeUpdatesFromOptions(options);

    let pipeline;
    try {
      pipeline = loadPipelineByName(name, projectRoot);
    } catch {
      const available = listPipelines(projectRoot);
      const messages = getPipelineMessages();
      throw pipelineMessageError(
        'pipelineNotFound',
        {
          name,
          available: available.length > 0 ? available.join('\n  ') : messages.format('none'),
        },
        'pipeline_not_found'
      );
    }
    if (options.forExecution) {
      await validatePipelineForExecution(
        pipeline,
        projectRoot,
        this.executionOptions(options, host)
      );
    }

    const graph = PipelineGraph.fromPipeline(pipeline);
    const buildOrder = graph.getBuildOrder();
    const storeLayer = await requireConfigStoreLayer(projectRoot);
    const configLayers = resolveHandoffThresholdLayers(projectRoot, storeLayer?.storeRoot);
    const modelLayers = resolveModelConfigLayers(projectRoot, storeLayer?.storeRoot);
    const overrides = resolvePipelineStageOverrides(pipeline.name, {
      projectRoot,
      store: storeLayer,
    });
    const thresholdContext = this.thresholdContext(
      pipeline,
      overrides,
      projectRoot,
      storeLayer?.storeRoot,
      host,
      roleRuntimeOverrides
    );
    const executionStages = new Map(
      resolvePipelineExecutionPlan(pipeline, {
        host,
        overrides,
        modelLayers,
        roleRuntimeOverrides,
      }).stages.map((stage) => [stage.id, stage])
    );
    const basePolicy = this.resolveBaseGatePolicy(projectRoot, storeLayer?.storeRoot);
    const stages: StageView[] = pipeline.stages.map((s) =>
      this.toStageView(
        s,
        pipeline,
        configLayers,
        modelLayers,
        overrides,
        basePolicy,
        thresholdContext,
        host,
        executionStages.get(s.id)
      )
    );
    const reuse: ResolvedReuseConfig = resolvePipelineReuseConfig(pipeline, thresholdContext);

    const result = {
      version: pipeline.version,
      name: pipeline.name,
      description: pipeline.description ?? '',
      agents: pipeline.agents ?? {},
      hostRuntime: host.runtime,
      hostRuntimeSource: host.source,
      reuse,
      buildOrder,
      stages,
      // Provenance marker (autonomy-ladder rung 2: composed pipelines) —
      // included only when declared so a human-authored pipeline's JSON shape
      // is unchanged.
      ...(pipeline.origin ? { origin: pipeline.origin } : {}),
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const source = listPipelinesWithInfo(projectRoot).find(
      (info) => info.name === pipeline.name
    )?.source;
    this.printPipelineDetail(result, graph, source, getPipelineMessages());
  }

  /**
   * Show or update role-level Claude/Codex runtime defaults for a pipeline.
   *
   * Updates persist as `pipelines.<name>.runtimes.<role>` configuration
   * instances written to the resolved root's `rasen/config.yaml` (project-scope
   * semantics; `--store <id>` resolves the store's own root and writes there) —
   * NEVER a frozen pipeline-definition copy. Registry precedence makes the new
   * choices effective; upstream changes to the built-in pipeline keep applying.
   */
  async agents(name: string, options: PipelineAgentsOptions = {}): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    const projectRoot = root.path;
    const normalizedName = name.replace(/\.ya?ml$/, '');
    const pipeline = this.loadPipelineOrExplain(normalizedName, projectRoot);
    const updates = this.runtimeUpdatesFromOptions(options);

    let configPath: string | null = null;
    if (Object.keys(updates).length > 0) {
      configPath = this.writeRuntimeInstances(projectRoot, pipeline.name, updates);
    }

    // Reads report the runtimes as RESOLVED from configuration (including the
    // instances just written), not from a mutated pipeline object.
    const result = await this.toAgentsResult(pipeline.name, pipeline, configPath, projectRoot);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    this.printAgentsDetail(result, getPipelineMessages());
  }

  /**
   * Persists per-role runtime updates as `pipelines.<name>.runtimes.<role>`
   * configuration instances at `projectRoot` through the standard config write
   * path, validating each key/value against the registry family first. Returns
   * the config file written to. Throws with the config write path's own guidance
   * (e.g. a config-less root) — never writes a pipeline definition file.
   */
  private writeRuntimeInstances(
    projectRoot: string,
    name: string,
    updates: Partial<Record<StageRole, AgentRuntime>>
  ): string {
    let configPath = '';
    for (const role of STAGE_ROLES) {
      const runtime = updates[role];
      if (!runtime) continue;
      const key = `pipelines.${name}.runtimes.${role}`;
      const keyValidation = validateConfigKeyPath(key, 'project');
      if (!keyValidation.valid) {
        throw pipelineMessageError('invalidRuntime', { runtime, role });
      }
      const definition = findWildcardDefinition(key, 'project');
      if (!definition || validateConfigValue(definition, runtime) !== null) {
        throw pipelineMessageError('invalidRuntime', { runtime, role });
      }
      const written = updateProjectConfigKey(projectRoot, key, runtime);
      configPath = written.configPath;
    }
    return configPath;
  }

  /**
   * Classify a task string to a suggested pipeline using deterministic keyword
   * heuristics. Advisory only — callers may override.
   */
  async classify(task: string, options: PipelineCommandOptions = {}): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    const available = listPipelines(root.path);
    const lowered = (task ?? '').toLowerCase();

    const bugMatches = BUG_FIX_KEYWORDS.filter((kw) => matchesKeyword(kw, lowered));
    const fullMatches = FULL_FEATURE_KEYWORDS.filter((kw) => matchesKeyword(kw, lowered));

    let suggested: string;
    let matched: string[];
    if (bugMatches.length > 0) {
      suggested = 'bug-fix';
      matched = [...bugMatches];
    } else if (fullMatches.length > 0) {
      suggested = 'full-feature';
      matched = [...fullMatches];
    } else {
      suggested = 'small-feature';
      matched = [];
    }

    // basis names WHY suggested was chosen: 'keyword' when an indicator
    // matched, 'default' when nothing matched and small-feature is the
    // unmatched fallback. Lets an adopting caller (autopilot-selection-policy)
    // distinguish an affirmative suggestion from a shrug.
    const basis: 'keyword' | 'default' = matched.length > 0 ? 'keyword' : 'default';

    const result = { suggested, matched, available, basis };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const messages = getPipelineMessages();
    console.log(messages.format('suggestedPipeline', { pipeline: suggested }));
    if (matched.length > 0) {
      console.log(messages.format('matchedIndicators', { indicators: matched.join(', ') }));
    } else {
      console.log(messages.format('matchedIndicatorsDefault'));
    }
    console.log(messages.format('classificationBasis', { basis }));
    console.log(messages.format('classificationAdvisory'));
    if (available.length > 0) {
      console.log(messages.format('availablePipelines', { pipelines: available.join(', ') }));
    }
  }

  /**
   * The frozen-resume rule (unified-session-runtime-context design D4).
   * A broken session context is reported as such rather than silently
   * dropping to cwd derivation, which is exactly how a resume lands in the
   * wrong clone.
   */
  private async resolveResumeExecution(
    frozen: FrozenKnowledgeContext | undefined,
    projectRoot: string,
    options: PipelineCommandOptions
  ): Promise<ExecutionBindingResult | { ok: false; reported: true }> {
    let sessionContext: RuntimeContext | undefined;
    try {
      sessionContext = requireSessionRuntimeContext();
    } catch (error) {
      if (!isSessionContextError(error)) throw error;
      const messages = getPipelineMessages();
      const detail = messages.format('sessionContextBroken', {
        path: error.broken.path,
        detail: error.broken.message,
      });
      if (options.json) {
        console.log(
          JSON.stringify(
            { error: 'session_context_broken', reason: error.broken.reason, message: detail },
            null,
            2
          )
        );
      } else {
        console.error(detail);
      }
      return { ok: false, reported: true };
    }

    return resolveFrozenExecutionBinding({
      frozen: frozen === undefined ? undefined : frozenExecutionRef(frozen),
      ...(sessionContext ? { sessionContext } : {}),
      cwd: projectRoot,
      ...(options.project !== undefined ? { explicitProjectId: options.project } : {}),
    });
  }

  private reportExecutionBindingFailure(
    failure: ExecutionBindingFailure,
    changeName: string,
    options: PipelineCommandOptions
  ): void {
    const messages = getPipelineMessages();
    let detail: string;
    switch (failure.code) {
      case 'project_binding_selector_conflict':
        detail = messages.format('executionBindingSelectorConflict', {
          frozen: failure.frozenProjectId,
          selector: failure.foundProjectId ?? '',
        });
        break;
      case 'project_binding_ambiguous':
        detail = messages.format('executionBindingAmbiguous', {
          frozen: failure.frozenProjectId,
          candidates: (failure.candidates ?? []).join(', '),
        });
        break;
      case 'project_binding_missing':
        detail = messages.format('executionBindingMissing', {
          frozen: failure.frozenProjectId,
        });
        break;
      default:
        detail = messages.format('executionBindingMismatch', {
          frozen: failure.frozenProjectId,
          found: failure.foundProjectId ?? '',
          checkout: failure.checkout ?? '',
        });
        break;
    }
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            change: changeName,
            error: failure.code,
            frozenProjectId: failure.frozenProjectId,
            ...(failure.foundProjectId !== undefined
              ? { foundProjectId: failure.foundProjectId }
              : {}),
            ...(failure.checkout !== undefined ? { checkout: failure.checkout } : {}),
            ...(failure.candidates !== undefined ? { candidates: failure.candidates } : {}),
            message: detail,
          },
          null,
          2
        )
      );
      return;
    }
    console.error(detail);
  }

  /**
   * Resume a change: compute next/remaining stages from its run-state file.
   */
  async resume(change: string | undefined, options: PipelineCommandOptions = {}): Promise<void> {
    const root = await this.resolveRoot(options);
    if (!root) return;
    const projectRoot = root.path;
    const host = detectHostRuntime();
    const changeName = await validateChangeExists(change, projectRoot, root.changesDir);

    const changeDir = path.join(root.changesDir, changeName);

    // Probe-only (ensure:false): resume is a read-only surface and must
    // never mint identity or write to the repo/registry (design D2).
    const workDir = await resolveChangeWorkDir(projectRoot, changeName, { ensure: false });

    // Portfolio parent? The portfolio record is authoritative — resume reports
    // the next runnable child(ren) from the dependency DAG rather than stages.
    // Sticky-legacy (design D4): workDir first, change dir fallback.
    //
    // Read DETAILED so a located-but-unreadable record is reported instead of
    // being read as "this change was never split". That substitution is not
    // cosmetic: it drops the parent to the stage-based branch below, where a
    // decomposed parent's stage list can leave delivery as the only thing
    // remaining — offering `ship` for work its children have not finished.
    const portfolioLocation = resolvePortfolioStateLocation(changeDir, workDir);
    const portfolioRead = portfolioLocation
      ? readPortfolioStateDetailed(portfolioLocation.dir)
      : ({ kind: 'absent' } as const);
    if (portfolioRead.kind === 'invalid' && portfolioLocation) {
      const result = {
        change: changeName,
        isPortfolio: true as const,
        hasRunState: false as const,
        invalidPortfolioState: true as const,
        portfolioStatePath: portfolioLocation.path,
        complete: false as const,
        pipeline: null,
        next: null,
        ready: [] as string[],
        remaining: [] as string[],
        note: getPipelineMessages('en').format('invalidPortfolioStateNote', {
          path: portfolioLocation.path,
          reason: portfolioRead.reason,
        }),
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const messages = getPipelineMessages();
      console.log(messages.format('changeLabel', { change: changeName }));
      console.log(messages.format('invalidPortfolioStateNote', {
        path: portfolioLocation.path,
        reason: portfolioRead.reason,
      }));
      return;
    }
    const portfolio = portfolioRead.kind === 'ok' ? portfolioRead.state : null;
    if (portfolio && portfolioLocation) {
      const isSatisfied = (s: string) => s === 'done' || s === 'skipped';
      const remainingPipelineNames = new Set(
        portfolio.children
          .filter((child) => !isSatisfied(child.status))
          .map((child) => child.pipeline)
      );
      for (const pipelineName of remainingPipelineNames) {
        await validatePipelineForExecution(
          loadPipelineByName(pipelineName, projectRoot),
          projectRoot,
          this.executionOptions(options, host)
        );
      }
      const runnable = runnableChildren(portfolio);
      // Interrupted (in_progress) and escalated children are NOT runnable, but
      // must be surfaced so resume never silently strands them: interrupted →
      // warm-seed-resume; escalated → human attention.
      const interrupted = interruptedChildren(portfolio);
      const escalated = escalatedChildren(portfolio);
      // Run-level persistent planner pointer (one planner spans all children's
      // proposes) — the resumer warm-seeds the next planner from it.
      const planner = normalizeWorker(portfolio.planner) ?? null;
      const completedChildren = portfolio.children
        .filter(c => isSatisfied(c.status))
        .map(c => c.id);
      const remainingChildren = portfolio.children
        .filter(c => !isSatisfied(c.status))
        .map(c => c.id);
      const childrenComplete = arePortfolioChildrenComplete(portfolio);
      const deliveryTerminal =
        portfolio.delivery.status === 'done' || portfolio.delivery.status === 'skipped';
      const deliveryRunnable =
        childrenComplete
        && (portfolio.delivery.status === 'pending'
          || portfolio.delivery.status === 'in_progress');
      // Delivery-related fields (`next`, `remaining`, `delivery`, `childrenComplete`)
      // surface ONLY once every child has finished — matching the first-parent
      // portfolio output, which never let a portfolio with outstanding children
      // frame delivery as the frontier. Omitting the keys entirely (vs. `null`)
      // keeps them `undefined` in the JSON round-trip so a stale `next` can never
      // reach a caller that never asked about delivery.
      const result = {
        change: changeName,
        isPortfolio: true as const,
        hasRunState: true as const,
        runStateDir: portfolioLocation.dir,
        complete: isPortfolioComplete(portfolio),
        completedChildren,
        runnableChildren: runnable,
        interruptedChildren: interrupted,
        escalatedChildren: escalated,
        planner,
        remainingChildren,
        children: portfolio.children.map(c => ({
          id: c.id,
          pipeline: c.pipeline,
          dependsOn: c.dependsOn,
          status: c.status,
          // Present only when the record used a word this reader does not
          // know: the value AS WRITTEN, so the drift is visible here rather
          // than only in the file. A clean record gains no new key.
          ...(c.statusRaw !== undefined ? { statusRaw: c.statusRaw } : {}),
        })),
        ...(childrenComplete
          ? {
              childrenComplete,
              delivery: portfolio.delivery,
              next: deliveryRunnable ? 'portfolio-delivery' : null,
              remaining: deliveryTerminal ? [] : ['portfolio-delivery'],
            }
          : {}),
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const messages = getPipelineMessages();
      const none = messages.format('none');
      console.log(messages.format('portfolioChange', {
        change: changeName,
        count: portfolio.children.length,
      }));
      console.log(messages.format('runStateReadFrom', { path: portfolioLocation.dir }));
      console.log(messages.format('completed', {
        stages: completedChildren.length > 0 ? completedChildren.join(', ') : none,
      }));
      console.log(messages.format('runnableNow', {
        children: runnable.length > 0 ? runnable.join(', ') : none,
      }));
      if (interrupted.length > 0) {
        console.log(messages.format('interrupted', { stages: interrupted.join(', ') }));
      }
      if (escalated.length > 0) {
        console.log(messages.format('escalated', { stages: escalated.join(', ') }));
      }
      if (planner) {
        const plannerId = planner.threadId
          ?? planner.agentId
          ?? planner.transcript
          ?? planner.role
          ?? messages.format('recorded');
        console.log(messages.format('persistentPlanner', { planner: plannerId }));
      }
      if (childrenComplete) {
        console.log(messages.format('portfolioDelivery', {
          status: portfolio.delivery.status,
        }));
        if (deliveryRunnable) {
          console.log(messages.format('nextStage', { stage: 'portfolio-delivery' }));
        }
      }
      console.log(messages.format('remaining', {
        stages: remainingChildren.length > 0 ? remainingChildren.join(', ') : none,
      }));
      return;
    }

    // Sticky-legacy (design D4): workDir first, change dir fallback. Detailed
    // read (design D3) so a located-but-unparseable file is reported
    // distinctly from no file at all, instead of masquerading as "not found".
    const runStateLocation = resolveRunStateLocation(changeDir, workDir);
    const runStateRead = runStateLocation
      ? readRunStateDetailed(runStateLocation.dir)
      : ({ kind: 'absent' } as const);
    const runState = runStateRead.kind === 'ok' ? runStateRead.state : null;

    // No run-state recorded yet (or not in usable form).
    if (!runState || runState.pipeline.length === 0) {
      if (runStateRead.kind === 'invalid' && runStateLocation) {
        const result = {
          change: changeName,
          hasRunState: false as const,
          invalidRunState: true as const,
          runStatePath: runStateLocation.path,
          pipeline: null,
          completed: [] as string[],
          next: null,
          remaining: [] as string[],
          note: getPipelineMessages('en').format('invalidRunStateNote', {
            path: runStateLocation.path,
            reason: runStateRead.reason,
          }),
        };
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        const messages = getPipelineMessages();
        console.log(messages.format('changeLabel', { change: changeName }));
        console.log(messages.format('invalidRunStateNote', {
          path: runStateLocation.path,
          reason: runStateRead.reason,
        }));
        return;
      }
      const result = {
        change: changeName,
        hasRunState: false as const,
        pipeline: null,
        completed: [] as string[],
        next: null,
        remaining: [] as string[],
        note: getPipelineMessages('en').format('noRunStateNote'),
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const messages = getPipelineMessages();
      console.log(messages.format('changeLabel', { change: changeName }));
      console.log(messages.format('noRunStateNote'));
      return;
    }

    const pipeline = loadPipelineByName(runState.pipeline, projectRoot);
    // A project-local or user-override pipeline authored before the rebrand can
    // still name legacy `openspec-*`/`openspec:*` or retired colon-form skill IDs
    // that no installed skill answers to. Surface each stale stage skill with its
    // rasen mapping so the resumer can rename the stage instead of dispatching a
    // dead ID.
    const legacySkillHints = pipeline.stages
      .filter((stage) => stage.skill)
      .map((stage) => {
        const mapped = mapLegacySkillId(stage.skill as string);
        return mapped ? { stage: stage.id, from: stage.skill as string, to: mapped } : null;
      })
      .filter((hint): hint is { stage: string; from: string; to: string } => hint !== null);
    // Retired legacy skill IDs are NOT valid execution IDs (design D3: `validate`
    // and dispatch still reject them — the fallback is a hint, not acceptance).
    // But resume must not dead-end on a stale pipeline: preflight a copy with each
    // legacy stage skill resolved to its current target, so a genuinely-unknown
    // skill still fails here while a pre-rebrand colon/openspec pipeline reaches
    // the old→new hint surfaced in the result below.
    const preflightPipeline =
      legacySkillHints.length === 0
        ? pipeline
        : {
            ...pipeline,
            stages: pipeline.stages.map((stage) => {
              const mapped = stage.skill ? mapLegacySkillId(stage.skill) : null;
              return mapped ? { ...stage, skill: mapped } : stage;
            }),
          };
    await validatePipelineForExecution(
      preflightPipeline,
      projectRoot,
      this.executionOptions(options, host)
    );
    const graph = PipelineGraph.fromPipeline(pipeline);
    const buildOrder = graph.getBuildOrder();
    const completed = completedStages(runState);
    const completedSet = new Set(completed);
    // getNextStages can return several ready stages (parallel frontier); report
    // the full set as `ready`, and keep `next` as its first member for callers
    // that want a single cursor.
    const ready = graph.getNextStages(completedSet);
    const next = ready[0] ?? null;
    const remaining = buildOrder.filter((id) => !completedSet.has(id));
    // Worker pointers recorded per stage. After a restart these agentIds are
    // dead SendMessage handles, but their `transcript` paths let a resume
    // WARM-SEED a fresh same-role worker from its predecessor's context. Even
    // WITHIN a session a completed worker is not reliably name-addressable, so
    // re-engagement is agentId-first (a live handle only in the spawning
    // session) with a transcript warm-seed fallback — a spawn `name` is a
    // non-durable dispatch label, never a resume handle.
    const workers = stageWorkers(runState);
    // Enrich each worker whose recorded transcript is readable with a
    // best-effort context estimate. A probe MUST NOT fail resume: any read
    // error silently drops the estimate for that worker.
    const workersWithContext: Record<
      string,
      RunStateWorker & { contextEstimate?: ContextEstimate }
    > = {};
    for (const [id, w] of Object.entries(workers)) {
      const estimate = w.transcript ? tryContextEstimate(w.transcript) : undefined;
      workersWithContext[id] = estimate ? { ...w, contextEstimate: estimate } : w;
    }
    // Handoff distillate pointers: session-level (whole-session handoff) and the
    // latest per-stage handoff document. A resumer prefers these over raw
    // transcript warm-seeding.
    const sessionHandoff = runState.sessionHandoff;
    const handoffs = latestStageHandoffs(runState);
    // Surface non-terminal stages so resume never hides them: in_progress was
    // interrupted (re-engage), escalated needs human attention. openFindings
    // carries unresolved Blocker/Major so a resumer does not ship past them.
    const inProgressStages = stagesWithStatus(runState, 'in_progress');
    const escalatedStages = stagesWithStatus(runState, 'escalated');
    const openFindings = runState.openFindings ?? [];

    // Run-state integrity warnings (advisory, non-fatal — resume stays exit 0).
    // Computed before the result object so the --json and human surfaces see the
    // same set, and emitted ONLY when non-empty so clean runs gain no new keys.
    const workerHandleWarnings = stagesLackingDurableHandle(runState);

    // Where does this run continue? The FROZEN identity says which project;
    // the session context (or, failing that, this checkout) says where that
    // project is on this machine; `--project` only cross-checks. A
    // disagreement stops the resume instead of continuing in another clone —
    // a resume into the wrong working tree produces a plausible-looking diff,
    // which is far more expensive than an error.
    const executionBinding = await this.resolveResumeExecution(
      runState.knowledgeContext,
      projectRoot,
      options
    );
    if (!executionBinding.ok) {
      if (!('reported' in executionBinding)) {
        this.reportExecutionBindingFailure(executionBinding, changeName, options);
      }
      process.exitCode = 1;
      return;
    }
    let duplicateKeyWarnings: { path: string; key: string }[] = [];
    if (runStateLocation && fs.existsSync(runStateLocation.path)) {
      duplicateKeyWarnings = detectDuplicateKeys(fs.readFileSync(runStateLocation.path, 'utf-8'));
    }

    const result = {
      change: changeName,
      pipeline: runState.pipeline,
      hasRunState: true as const,
      // runState is non-null only when runStateLocation resolved (see guard
      // above), so this is always defined here.
      runStateDir: runStateLocation!.dir,
      completed,
      next,
      ready,
      remaining,
      workers: workersWithContext,
      inProgressStages,
      escalatedStages,
      openFindings,
      // autopilot-gate-policy: the resolved gate policy recorded at run start
      // (see run-state.ts `gatePolicy`), so resume honors it without the user
      // re-passing `--no-gate`. Included only when present — a run recorded
      // before this capability existed carries no key, and the LEAD's
      // built-in default (gates on) still applies.
      ...(runState.gatePolicy ? { gatePolicy: runState.gatePolicy } : {}),
      ...(runState.knowledgeContext
        ? { knowledgeContext: runState.knowledgeContext }
        : {}),
      // Reported only when the run actually recorded an execution binding, so
      // a pre-existing run's JSON gains no new key.
      ...(executionBinding.kind === 'unrecorded' ? {} : { executionBinding }),
      // Handoff pointers are included only when present so existing callers see
      // no new keys unless a run actually recorded handoffs.
      ...(sessionHandoff ? { sessionHandoff } : {}),
      ...(Object.keys(handoffs).length > 0 ? { handoffs } : {}),
      // Legacy skill-ID hints only when a stale pipeline was resolved.
      ...(legacySkillHints.length > 0 ? { legacySkillHints } : {}),
      // Worker-handle + duplicate-key warnings only when present so existing
      // callers see no new keys on clean runs.
      ...(workerHandleWarnings.length > 0 ? { workerHandleWarnings } : {}),
      ...(duplicateKeyWarnings.length > 0 ? { duplicateKeyWarnings } : {}),
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const messages = getPipelineMessages();
    const none = messages.format('none');
    const warmSeedable = Object.keys(workers);
    console.log(messages.format('changeLabel', { change: changeName }));
    console.log(messages.format('pipelineLabel', { name: runState.pipeline }));
    console.log(messages.format('runStateReadFrom', { path: runStateLocation!.dir }));
    if (executionBinding.kind === 'planning-only') {
      console.log(messages.format('executionBindingPlanningOnly'));
    } else if (executionBinding.kind === 'project') {
      console.log(
        messages.format('executionBinding', {
          project: executionBinding.projectId,
          path: executionBinding.root,
        })
      );
    }
    console.log(messages.format('completed', {
      stages: completed.length > 0 ? completed.join(', ') : none,
    }));
    console.log(messages.format('nextStage', {
      stage: next ?? messages.format('complete'),
    }));
    console.log(messages.format('remaining', {
      stages: remaining.length > 0 ? remaining.join(', ') : none,
    }));
    if (inProgressStages.length > 0) {
      console.log(messages.format('interrupted', { stages: inProgressStages.join(', ') }));
    }
    if (escalatedStages.length > 0) {
      console.log(messages.format('escalated', { stages: escalatedStages.join(', ') }));
    }
    if (openFindings.length > 0) {
      console.log(messages.format('openFindings', { count: openFindings.length }));
    }
    if (legacySkillHints.length > 0) {
      console.log(messages.format('legacySkillHeading', { pipeline: runState.pipeline }));
      for (const hint of legacySkillHints) {
        console.log(messages.format('legacySkillEntry', hint));
      }
    }
    for (const warning of workerHandleWarnings) {
      const recorded = warning.keys.length > 0
        ? warning.keys.join(', ')
        : messages.format('bareWorkerLabel');
      console.log(messages.format('workerHandleWarning', {
        stage: warning.stage,
        recorded,
      }));
    }
    for (const warning of duplicateKeyWarnings) {
      console.log(messages.format('duplicateRunStateKey', {
        key: warning.key,
        path: warning.path,
      }));
    }
    if (warmSeedable.length > 0) {
      console.log(messages.format('resumeHandles', { stages: warmSeedable.join(', ') }));
    }
    if (sessionHandoff) {
      console.log(messages.format('sessionHandoff', {
        generation: sessionHandoffGeneration(sessionHandoff),
        path: sessionHandoff.path,
      }));
    }
    if (runState.gatePolicy) {
      console.log(messages.format('gatePolicy', {
        effective: runState.gatePolicy.effective,
        source: runState.gatePolicy.source,
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private loadPipelineOrExplain(name: string, projectRoot: string): PipelineYaml {
    try {
      return loadPipelineByName(name, projectRoot);
    } catch {
      const available = listPipelines(projectRoot);
      const messages = getPipelineMessages();
      throw pipelineMessageError(
        'pipelineNotFound',
        {
          name,
          available: available.length > 0 ? available.join('\n  ') : messages.format('none'),
        },
        'pipeline_not_found'
      );
    }
  }

  private runtimeUpdatesFromOptions(options: PipelineAgentsOptions): Partial<Record<StageRole, AgentRuntime>> {
    const updates: Partial<Record<StageRole, AgentRuntime>> = {};

    for (const role of STAGE_ROLES) {
      const value = options[role];
      if (value === undefined) continue;

      const parsedRole = StageRoleSchema.parse(role);
      const parsedRuntime = AgentRuntimeSchema.safeParse(value);
      if (!parsedRuntime.success) {
        throw pipelineMessageError('invalidRuntime', { runtime: value, role });
      }
      updates[parsedRole] = parsedRuntime.data;
    }

    return updates;
  }

  private async toAgentsResult(
    name: string,
    pipeline: PipelineYaml,
    configPath: string | null,
    projectRoot: string
  ): Promise<{
    name: string;
    configPath: string | null;
    agents: PipelineYaml['agents'];
    hostRuntime: DetectedHostRuntime['runtime'];
    hostRuntimeSource: DetectedHostRuntime['source'];
    effectiveRoles: Record<StageRole, ResolvedRoleRuntime>;
    stages: StageView[];
  }> {
    const host = detectHostRuntime();
    const storeLayer = await requireConfigStoreLayer(projectRoot);
    const configLayers = resolveHandoffThresholdLayers(projectRoot, storeLayer?.storeRoot);
    const modelLayers = resolveModelConfigLayers(projectRoot, storeLayer?.storeRoot);
    const overrides = resolvePipelineStageOverrides(name, { projectRoot, store: storeLayer });
    const thresholdContext = this.thresholdContext(
      pipeline,
      overrides,
      projectRoot,
      storeLayer?.storeRoot,
      host
    );
    const executionStages = new Map(
      resolvePipelineExecutionPlan(pipeline, {
        host,
        overrides,
        modelLayers,
      }).stages.map((stage) => [stage.id, stage])
    );
    const basePolicy = this.resolveBaseGatePolicy(projectRoot, storeLayer?.storeRoot);

    // Effective runtime per role: family instance (project > store > global) >
    // pipeline declaration > detected host > legacy Claude compatibility.
    const effectiveRoles = resolvePipelineRoleRuntimes(pipeline, overrides, host);

    return {
      name,
      configPath,
      agents: pipeline.agents ?? {},
      hostRuntime: host.runtime,
      hostRuntimeSource: host.source,
      effectiveRoles,
      stages: pipeline.stages.map((s) =>
        this.toStageView(
          s,
          pipeline,
          configLayers,
          modelLayers,
          overrides,
          basePolicy,
          thresholdContext,
          host,
          executionStages.get(s.id)
        )
      ),
    };
  }

  /**
   * The per-stage/per-role config top layer for one stage, drawn from the
   * pipeline's resolved override maps: model/handoff by stage id, runtime by
   * role. Absent maps (no config context) yield an all-undefined set, so the
   * resolvers fall through to their existing chains byte-identically.
   */
  private stageConfigOverrides(
    stage: Stage,
    overrides?: PipelineStageOverrides
  ): StageConfigOverrides {
    if (!overrides) return {};
    return {
      model: overrides.models.get(stage.id),
      handoff: overrides.handoff.get(stage.id),
      runtime: stage.role ? overrides.runtimes.get(stage.role) : undefined,
    };
  }

  private toStageView(
    stage: Stage,
    pipeline: PipelineYaml,
    configLayers?: HandoffConfigLayers,
    modelLayers?: ModelConfigLayers,
    overrides?: PipelineStageOverrides,
    basePolicy?: ResolvedGatePolicy,
    thresholdContext?: ThresholdResolutionContext,
    host: DetectedHostRuntime = { runtime: 'unknown', source: 'unknown' },
    executionRuntime?: ExecutionStageRuntime
  ): StageView {
    const stageOverrides = this.stageConfigOverrides(stage, overrides);
    const runtime = executionRuntime ?? resolveStageRuntimeConfig(
      stage,
      pipeline,
      modelLayers,
      stageOverrides,
      { host }
    );
    const effectiveStageRuntime = executionRuntime?.runtime ?? runtime.runtime;
    // The mask needs a base policy; without one (no config context) fall back to
    // the built-in "gates on" default so effective equals the declared gate.
    const policy: ResolvedGatePolicy = basePolicy ?? { effective: 'on', source: 'default' };
    const maskedGate = resolveMaskedStageGate(stage.gate, overrides?.gates.get(stage.id), policy);
    return {
      id: stage.id,
      kind: stage.kind,
      skill: stage.skill ?? null,
      // For a decompose stage, surface the RESOLVED child pipeline (default
      // applied) so consumers see exactly what each child will run.
      childPipeline: stage.kind === 'decompose' ? resolveChildPipelineName(stage) : null,
      role: stage.role ?? null,
      requires: stage.requires,
      gate: stage.gate,
      effectiveGate: maskedGate.effective,
      gateSource: maskedGate.source,
      loop: stage.loop ?? null,
      parallelGroup: stage.parallelGroup ?? null,
      condition: stage.condition ?? null,
      leadReview: stage.leadReview,
      verifyPolicy: stage.verifyPolicy ?? null,
      runtime: effectiveStageRuntime,
      runtimeSource: executionRuntime?.runtimeSource ?? runtime.runtimeSource,
      dispatchMode: executionRuntime?.dispatchMode
        ?? resolveDispatchRoute(host.runtime, effectiveStageRuntime).mode,
      sessionReuse: runtime.sessionReuse ?? null,
      sandbox: runtime.sandbox ?? null,
      model: runtime.model ?? null,
      modelSource: runtime.modelSource,
      effort: runtime.effort ?? null,
      handoff: resolveStageHandoffConfig(
        stage,
        pipeline,
        configLayers,
        modelLayers,
        stageOverrides,
        { ...thresholdContext, host, stageRuntime: effectiveStageRuntime }
      ),
    };
  }

  private thresholdContext(
    pipeline: PipelineYaml,
    overrides: PipelineStageOverrides,
    projectRoot: string,
    storeRoot?: string | null,
    host: DetectedHostRuntime = { runtime: 'unknown', source: 'unknown' },
    roleRuntimeOverrides: Partial<Record<StageRole, AgentRuntime>> = {}
  ): ThresholdResolutionContext {
    const roleRuntimes = resolvePipelineRoleRuntimes(
      pipeline,
      overrides,
      host,
      roleRuntimeOverrides
    );
    const runtimes = Object.fromEntries(
      STAGE_ROLES.map((role) => [role, roleRuntimes[role].runtime])
    ) as Record<StageRole, AgentRuntime>;
    return {
      bindings: resolveThresholdBindingLayers(projectRoot, storeRoot),
      schemes: loadThresholdSchemeSnapshot(),
      runtimes,
      host,
    };
  }

  /**
   * Resolves the effective `autopilot.gates` base policy for a root (the mask
   * base). `noGateFlag` is false — `pipeline show`/`agents` are inspection, not
   * a run — so the base resolves purely from project/store/global config.
   */
  private resolveBaseGatePolicy(
    projectRoot: string,
    storeRoot: string | null | undefined
  ): ResolvedGatePolicy {
    return resolveAutopilotGatePolicy(
      readProjectConfig(projectRoot),
      false,
      getGlobalConfig(),
      storeRoot ? readProjectConfig(storeRoot) : null
    );
  }

  private printPipelineTable(
    pipelines: PipelineInfo[],
    messages: PipelineMessages
  ): void {
    console.log(messages.format('availablePipelinesHeading'));
    console.log();
    for (const pipeline of pipelines) {
      console.log(messages.format('pipelineTableEntry', {
        name: pipeline.name,
        source: pipeline.source,
      }));
      const description = messages.description(
        pipeline.name,
        pipeline.source,
        pipeline.description
      );
      if (description) {
        console.log(`    ${description.replace(/\s+/g, ' ').trim()}`);
      }
      console.log(messages.format('pipelineTableStages', {
        stages: pipeline.stages.join(' -> '),
      }));
      console.log();
    }
  }

  private printPipelineDetail(
    result: {
      version: PipelineYaml['version'];
      name: string;
      description: string;
      agents?: PipelineYaml['agents'];
      reuse: ResolvedReuseConfig;
      buildOrder: string[];
      stages: StageView[];
      hostRuntime: DetectedHostRuntime['runtime'];
      hostRuntimeSource: DetectedHostRuntime['source'];
      origin?: PipelineYaml['origin'];
    },
    graph: PipelineGraph,
    source: PipelineInfo['source'] | undefined,
    messages: PipelineMessages
  ): void {
    this.printThresholdDiagnostics(result);
    console.log(messages.format('pipelineLabel', { name: result.name }));
    console.log(messages.format('definitionVersionLabel', { version: result.version }));
    console.log(messages.format('hostRuntimeLabel', {
      runtime: result.hostRuntime,
      source: result.hostRuntimeSource,
    }));
    const description = source
      ? messages.description(result.name, source, result.description)
      : result.description;
    if (description) {
      console.log(description.replace(/\s+/g, ' ').trim());
    }
    if (result.origin) {
      console.log(messages.format('originLabel', { origin: result.origin }));
    }
    console.log();
    console.log(messages.format('buildOrderHeading'));
    for (const id of result.buildOrder) {
      const stage = graph.getStage(id);
      if (!stage) continue;
      const meta: string[] = [];
      if (stage.role) meta.push(messages.format('stageMetaRole', { role: stage.role }));
      if (stage.requires.length > 0) {
        meta.push(messages.format('stageMetaRequires', {
          requires: stage.requires.join(', '),
        }));
      }
      if (stage.gate) meta.push(messages.format('stageMetaGate'));
      if (stage.loop) {
        if (stage.loop.kind === 'review-cycle') {
          meta.push(messages.format('stageMetaReviewLoop', {
            maximum: stage.loop.maxRounds,
          }));
        } else {
          meta.push(messages.format('stageMetaGoalLoop', {
            gate: stage.loop.gate.kind,
            maximum: stage.loop.maxRounds,
            stall: stage.loop.loopStallLimit,
          }));
        }
      }
      if (stage.parallelGroup) {
        meta.push(messages.format('stageMetaParallelGroup', { group: stage.parallelGroup }));
      }
      if (stage.condition) {
        meta.push(messages.format('stageMetaCondition', { condition: stage.condition }));
      }
      if (stage.leadReview) meta.push(messages.format('stageMetaLeadReview'));
      if (stage.verifyPolicy) {
        meta.push(messages.format('stageMetaVerifyPolicy', { policy: stage.verifyPolicy }));
      }
      // Read runtime fields from the stageView (resolved once in toStageView
      // WITH the machine-config model layers) rather than re-resolving here
      // layerlessly — a second resolveStageRuntimeConfig call without
      // modelLayers would silently report a machine-config-blind model the
      // day someone renders `model` from it.
      const stageView = result.stages.find((candidate) => candidate.id === id);
      if (stageView) {
        meta.push(
          messages.format('stageMetaRuntimeSource', {
            runtime: stageView.runtime,
            source: stageView.runtimeSource,
          })
        );
        meta.push(messages.format('stageMetaDispatch', { mode: stageView.dispatchMode }));
        if (stageView.sessionReuse) {
          meta.push(messages.format('stageMetaSessionReuse', {
            session: stageView.sessionReuse,
          }));
        }
        if (stageView.sandbox) {
          meta.push(messages.format('stageMetaSandbox', { sandbox: stageView.sandbox }));
        }
      }
      if (stageView && stageView.handoff.source !== 'default') {
        meta.push(messages.format('stageMetaHandoff', {
          threshold: formatThreshold(stageView.handoff.threshold, messages),
          source: stageView.handoff.source,
        }));
      }
      const suffix = meta.length > 0 ? `  (${meta.join('; ')})` : '';
      // A decompose stage has no leaf skill; show its fan-out target instead.
      const action = stage.kind === 'decompose'
        ? messages.format('stageActionDecompose', {
            pipeline: resolveChildPipelineName(stage),
          })
        : (stage.skill ?? '');
      console.log(messages.format('stageLine', { id, action, suffix }));
    }
  }

  private printThresholdDiagnostics(result: {
    reuse: ResolvedReuseConfig;
    stages: StageView[];
  }): void {
    const diagnostics = [
      ...result.stages.flatMap((stage) => stage.handoff.diagnostics ?? []),
      ...(result.reuse.diagnostics ?? []),
    ];
    const seen = new Set<string>();
    for (const diagnostic of diagnostics) {
      const key = [
        diagnostic.code,
        diagnostic.scope,
        diagnostic.row,
        diagnostic.scheme,
      ].join('\0');
      if (seen.has(key)) continue;
      seen.add(key);
      console.warn(diagnostic.message);
    }
  }

  private printAgentsDetail(
    result: {
      name: string;
      configPath: string | null;
      hostRuntime: DetectedHostRuntime['runtime'];
      hostRuntimeSource: DetectedHostRuntime['source'];
      effectiveRoles: Record<StageRole, ResolvedRoleRuntime>;
      stages: StageView[];
    },
    messages: PipelineMessages
  ): void {
    console.log(messages.format('pipelineLabel', { name: result.name }));
    console.log(messages.format('hostRuntimeLabel', {
      runtime: result.hostRuntime,
      source: result.hostRuntimeSource,
    }));
    if (result.configPath) {
      console.log(messages.format('projectOverrideLabel', { path: result.configPath }));
    }
    console.log();
    console.log(messages.format('roleRuntimesHeading'));
    for (const role of STAGE_ROLES) {
      console.log(messages.format('agentRoleLine', {
        role,
        runtime: result.effectiveRoles[role].runtime,
        source: result.effectiveRoles[role].source,
        dispatch: result.effectiveRoles[role].dispatchMode,
      }));
    }
    console.log();
    console.log(messages.format('stagesHeading'));
    for (const stage of result.stages) {
      const role = stage.role ?? messages.format('none');
      console.log(messages.format('agentStageLine', {
        id: stage.id,
        role,
        runtime: stage.runtime,
        source: stage.runtimeSource,
        dispatch: stage.dispatchMode,
      }));
    }
  }
}
