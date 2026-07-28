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
  normalizeAgentRuntimeConfig,
  freezeProductionPreparedPipelineRegistry,
  preflightPreparedDefinitionExecution,
  listPipelines,
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
import { analyzeReconcilerSupport } from '../core/pipeline-registry/execution-plan-internal.js';
import { resolveRuntimeExecutionProfile } from '../core/pipeline-registry/profile-resolver.js';
import {
  prepareRuntimeContext,
  decodeCompletion,
  decodeControl,
  ChangeRunRuntimeError,
  createAssociationLedgerStore,
  type ChangePipelineRuntime,
  type CompleteRunAction,
  type ChangeRunControlRequest,
  type EvidenceRef,
  type Digest,
} from '../core/change-run/index.js';
import {
  deriveChangeInstanceId,
  derivePlanningSpaceId,
  deriveRunId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
} from '../core/change-run/internal/identity.js';
import { createFilesystemRunStore } from '../core/change-run/internal/run-store-fs.js';
import {
  createBoundedEvidenceStore,
  computeEvidenceContentDigest,
} from '../core/change-run/internal/evidence.js';
import {
  readBoundedJson,
  InputReaderError,
} from '../core/change-run/internal/input-reader.js';
import { getGlobalDataDir } from '../core/global-config.js';
import { WORKSPACE_DIR_NAME } from '../core/config.js';
import { resolveProjectHome } from '../core/project-home.js';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/**
 * The resolved runtime context for an engine-aware Run command (start/status/
 * resume-run/cancel/complete/control). All engine-aware commands share this
 * shape from {@link PipelineCommand.resolveRuntime}.
 */
interface ResolvedRuntime {
  ctx: ReturnType<typeof prepareRuntimeContext>;
  pipeline: PipelineYaml;
  runId: string;
  projectRoot: string;
  projectId: string;
  launchKey: string;
}

/**
 * Test-injected resolver for the --run-based commands (complete/control).
 * In production this is undefined; the default filesystem-backed resolution
 * loads the Record by runId to recover the pipeline name and re-prepares the
 * definition + profile. Tests inject a pre-built in-memory context so the CLI
 * parsing/validation/upload-staging/formatting layer can be exercised without
 * spawning a real project setup.
 */
type RuntimeForRunResolver = (
  changeId: string,
  runId: string,
  options: PipelineCommandOptions
) => Promise<ResolvedRuntime>;

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
   * @param runtimeForRunOverride Optional test-injected resolver for the
   *   --run-based commands (complete/control). When set, bypasses the default
   *   filesystem-backed Run resolution (open store → load record → recover
   *   pipeline name → re-prepare definition + profile). Production callers
   *   never pass this — the default path is the real CLI surface.
   */
  constructor(
    private readonly runtimeForRunOverride?: RuntimeForRunResolver
  ) {}

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
    host: DetectedHostRuntime = detectHostRuntime()
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
    const registry = await freezeProductionPreparedPipelineRegistry(root.path, {
      reporter: this.executionOptions(options).reporter,
    });
    const pipelines = registry.list().map((info) => this.publicPipelineInfo(info));

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

    const available = listPipelines(projectRoot);
    const normalizedName = name.replace(/\.ya?ml$/, '');
    if (!available.includes(normalizedName)) {
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
    const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
      reporter: this.executionOptions(options, host).reporter,
    });
    const info = registry.list().find((entry) => entry.name === normalizedName);
    if (info && info.definitionValid === false && !options.forExecution) {
      const result = {
        version: info.authoredVersion,
        name: info.name,
        description: info.description,
        definition: info.authoredDefinition ?? {},
        source: info.source,
        preparation: {
          authoredVersion: info.authoredVersion,
          normalizedVersion: 2,
          definitionValid: false,
          diagnostics: info.diagnostics ?? [],
          planAvailable: false,
          executable: false,
          executionMode: 'unavailable',
        },
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const executionSelection = options.forExecution
      ? await registry.selectForExecution(
          normalizedName,
          this.executionOptions(options, host)
        )
      : undefined;
    const resolution =
      executionSelection?.resolution ?? registry.load(normalizedName);
    if (resolution.prepared.authoredVersion === 2 && !options.forExecution) {
      const prepared = resolution.prepared;
      const result = {
        version: 2,
        name: prepared.authoredSource.name,
        description: prepared.authoredSource.description ?? '',
        definition: prepared.authoredSource,
        source: resolution.source,
        preparation: {
          authoredVersion: prepared.authoredVersion,
          normalizedVersion: prepared.normalizedVersion,
          definitionValid: prepared.capability.definitionValid,
          diagnostics: prepared.warnings,
          digests: prepared.digests,
          planAvailable: prepared.capability.planAvailable,
          executable: prepared.capability.executable,
          executionMode: prepared.capability.executionMode,
          unavailableReason: prepared.capability.unavailableReason,
        },
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const pipeline =
      executionSelection?.pipeline ??
      (resolution.prepared.authoredSource as PipelineYaml);
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

    // Engine support analysis (task 12.8): availableEngines/reconcilerSupport
    // are additive fields shared with `pipeline start`, management detail, and
    // Canvas. Without a launch-time execution profile, a supported root-DAG
    // reports legacy availability and execution_profile_unavailable.
    const support = analyzeReconcilerSupport(resolution.prepared, null);

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
      availableEngines: support.availableEngines,
      reconcilerSupport: support.reconcilerSupport,
      // Provenance marker (autonomy-ladder rung 2: composed pipelines) —
      // included only when declared so a human-authored pipeline's JSON shape
      // is unchanged.
      ...(pipeline.origin ? { origin: pipeline.origin } : {}),
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const source = registry.list().find((entry) => entry.name === pipeline.name)?.source;
    this.printPipelineDetail(result, graph, source, getPipelineMessages());
  }

  /**
   * Start (or reuse) a reconciler-engine Run for a change under a pipeline
   * (task 12.1/12.2). Freezes the prepared Definition + capability catalog +
   * effective policy into a sealed RuntimeExecutionProfile, derives the Run
   * identity from the workspace's physical identity, assembles the runtime
   * facade, and creates the Run on the immutable filesystem store. Output is
   * the ChangeRunReceipt (view + disposition + granted actions).
   */
  /**
   * Resolve the runtime context for a change under a pipeline (shared by the
   * engine-aware run commands). Freezes the prepared Definition + capability
   * catalog + effective policy into a sealed profile, derives the Run identity
   * from the workspace's physical identity, and assembles the facade against
   * the immutable filesystem store.
   */
  private async resolveRuntime(
    changeId: string,
    pipelineName: string,
    options: PipelineCommandOptions,
    runIdOverride?: string
  ): Promise<ResolvedRuntime> {
    const root = await this.resolveRoot(options);
    if (!root) throw new Error('No Rasen root resolved.');
    const projectRoot = root.path;
    const host = detectHostRuntime();
    const roleRuntimeOverrides = this.runtimeUpdatesFromOptions(options);

    const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
      reporter: false,
    });
    const execution = await registry.selectForExecution(
      pipelineName.replace(/\.ya?ml$/, ''),
      this.executionOptions(options, host)
    );
    const prepared = execution.resolution.prepared;
    const pipeline = prepared.authoredSource as PipelineYaml;
    const storeLayer = await requireConfigStoreLayer(projectRoot);
    const modelLayers = resolveModelConfigLayers(
      projectRoot,
      storeLayer?.storeRoot
    );
    const overrides = resolvePipelineStageOverrides(pipeline.name, {
      projectRoot,
      store: storeLayer,
    });
    const executionStages = new Map(
      resolvePipelineExecutionPlan(pipeline, {
        host,
        overrides,
        modelLayers,
        roleRuntimeOverrides,
      }).stages.map((stage) => [stage.id, stage])
    );
    const baseGatePolicy = this.resolveBaseGatePolicy(
      projectRoot,
      storeLayer?.storeRoot
    );

    const sourceRevision = {
      layer: execution.resolution.source,
      kind: 'pipeline-yaml',
      sourceId: `${execution.resolution.source}:${pipeline.name}`,
      authoredContentDigest: `sha256:${prepared.digests.source}` as never,
      semanticDigest: `sha256:${prepared.digests.source}` as never,
    };
    const policyStages = pipeline.stages.map((stage) => {
      const resolved = executionStages.get(stage.id);
      if (!resolved) {
        throw new Error(
          `Execution plan omitted stage "${stage.id}" from pipeline "${pipeline.name}".`
        );
      }
      const roleDefault = stage.role
        ? normalizeAgentRuntimeConfig(pipeline.agents?.[stage.role])
        : undefined;
      const sourceFor = (
        stageValue: unknown,
        roleValue: unknown
      ): 'stage' | 'agent' | 'default' =>
        stageValue !== undefined
          ? 'stage'
          : roleValue !== undefined
            ? 'agent'
            : 'default';
      const sandbox =
        resolved.sandbox ??
        (stage.verifyPolicy === 'adaptive' || stage.id === 'verify'
          ? ('read-only' as const)
          : ('workspace-write' as const));
      const gate = resolveMaskedStageGate(
        stage.gate,
        overrides.gates.get(stage.id),
        baseGatePolicy
      );
      return {
        nodeId: `stage:${stage.id}`,
        role: stage.role ?? 'implementer',
        model: resolved.model ?? 'default',
        effort: resolved.effort ?? 'default',
        runtime: resolved.runtime,
        sandbox,
        gate: gate.effective,
        sessionReuse:
          resolved.sessionReuse === undefined || resolved.sessionReuse === 'none'
            ? ('never' as const)
            : ('same-invocation' as const),
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
        provenance: {
          role: stage.role ? 'stage' : 'default',
          model: resolved.modelSource,
          effort: sourceFor(stage.effort, roleDefault?.effort),
          runtime: resolved.runtimeSource,
          sandbox: sourceFor(stage.sandbox, roleDefault?.sandbox),
          gate: gate.source,
          sessionReuse: sourceFor(
            stage.sessionReuse,
            roleDefault?.sessionReuse
          ),
          handoffTokenLimit: 'default',
          reuseRoundLimit: 'default',
        },
      };
    });
    const profile = resolveRuntimeExecutionProfile(
      prepared,
      registry.catalog,
      policyStages,
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 }
    );
    const support = analyzeReconcilerSupport(prepared, profile);
    if (!support.reconcilerSupport.supported) {
      throw pipelineMessageError(
        'pipelineNotFound',
        { name: pipelineName, available: support.reconcilerSupport.reason },
        'unsupported_pipeline_shape'
      );
    }

    const home = getGlobalDataDir();
    const changeDir = path.join(
      projectRoot,
      WORKSPACE_DIR_NAME,
      'changes',
      changeId
    );
    const alias = `changes/${changeId}`;

    // --- Identity derivation ------------------------------------------------
    // Primary path: the association registry (Change directory's physical
    // identity via the persisted ledger). Fallback path: the legacy
    // project-root stat + path-hash (for unregistered projects with no
    // rasen config.yaml, preserving pre-registry behavior).
    let planningSpaceId: ReturnType<typeof derivePlanningSpaceId>;
    let projectId: string;
    let changeInstanceId: ReturnType<typeof deriveChangeInstanceId>;
    let workspaceInstanceId: ReturnType<typeof deriveWorkspaceInstanceId>;
    // Hoisted so resolveSourceState (M2) can close over it — undefined in the
    // fallback path (unregistered project).
    let ledgerStore: ReturnType<typeof createAssociationLedgerStore> | undefined;

    let projectHome = await resolveProjectHome(projectRoot, { ensure: true }).catch(() => null);
    if (!projectHome) {
      // Fallback: legacy identity derivation for unregistered projects.
      projectHome = null;
      const planningSpaceHome = `project-${createHash('sha256')
        .update(projectRoot)
        .digest('hex')
        .slice(0, 12)}`;
      planningSpaceId = derivePlanningSpaceId(planningSpaceHome);
      projectId = `project:${createHash('sha256')
        .update(projectRoot)
        .digest('hex')
        .slice(0, 12)}`;
      const st = statSync(projectRoot, { bigint: true });
      const physical = readPhysicalIdentity({
        device: st.dev,
        ino: st.ino,
        birthtimeMs: st.birthtimeMs,
      });
      changeInstanceId = deriveChangeInstanceId(
        planningSpaceId,
        changeId,
        physical
      );
      workspaceInstanceId = deriveWorkspaceInstanceId(planningSpaceId, physical);
    } else {
      // Primary: registry-based identity from the Change directory's physical
      // identity. Archiving and recreating the same Change name produces a new
      // directory → new identity → new Run.
      planningSpaceId = derivePlanningSpaceId(projectHome.name);
      projectId = projectHome.projectId;
      ledgerStore = createAssociationLedgerStore({
        homeDir: projectHome.homeDir,
        planningSpaceId,
        projectId,
      });

      if (fs.existsSync(changeDir)) {
        // Active Change: stat the Change directory and bind via the registry.
        const st = statSync(changeDir, { bigint: true });
        const physical = readPhysicalIdentity({
          device: st.dev,
          ino: st.ino,
          birthtimeMs: st.birthtimeMs,
        });

        // Ambiguity check (m1): runs in BOTH branches (changeDir exists and
        // not-exist) so a deleted Change dir with ≥2 archived generations
        // surfaces launch_instance_ambiguous (not invalid_run_request).
        this.assertLaunchUnambiguous(ledgerStore, changeId);

        const bound = ledgerStore.bindActive(changeId, alias, physical);
        changeInstanceId = bound.association.instanceId as never;
        workspaceInstanceId = deriveWorkspaceInstanceId(
          planningSpaceId,
          physical
        ) as never;
      } else {
        // No active Change directory (archived or missing source). Look up the
        // historical association to recover the ChangeInstanceId.
        // Ambiguity check (m1): also runs here — a deleted Change dir with ≥2
        // archived generations surfaces launch_instance_ambiguous.
        this.assertLaunchUnambiguous(ledgerStore, changeId);

        const association = ledgerStore.resolveAssociationByAlias(alias);
        if (association) {
          changeInstanceId = association.instanceId as never;
        } else if (runIdOverride) {
          // No association found but the caller specified --run; derive a
          // placeholder identity for Record-shape compatibility (the RunStore
          // loads by runId, not by changeInstanceId). Covers pre-registry Runs.
          const st = statSync(projectRoot, { bigint: true });
          const fallbackPhysical = readPhysicalIdentity({
            device: st.dev,
            ino: st.ino,
            birthtimeMs: st.birthtimeMs,
          });
          changeInstanceId = deriveChangeInstanceId(
            planningSpaceId,
            changeId,
            fallbackPhysical
          ) as never;
        } else {
          throw new ChangeRunRuntimeError(
            'invalid_run_request',
            `No active Change directory for "${changeId}" and no association found in the registry. ` +
              'Create the Change directory or supply --run to target a historical Run.'
          );
        }
        const st = statSync(projectRoot, { bigint: true });
        const fallbackPhysical = readPhysicalIdentity({
          device: st.dev,
          ino: st.ino,
          birthtimeMs: st.birthtimeMs,
        });
        workspaceInstanceId = deriveWorkspaceInstanceId(
          planningSpaceId,
          fallbackPhysical
        ) as never;
      }
    }

    const launchKey = `cli-start-${changeId}`;
    const runId = (runIdOverride ?? deriveRunId(
      planningSpaceId,
      changeInstanceId,
      changeId,
      launchKey
    )) as never;
    const launchRequestDigest = `sha256:${createHash('sha256')
      .update(launchKey)
      .digest('hex')}` as never;

    const ctx = prepareRuntimeContext({
      projectRoot,
      prepared,
      profile,
      runId,
      planningSpaceId,
      workspaceInstanceId,
      changeInstanceId,
      changeId,
      projectId,
      launchRequestDigest,
      storeRoot: `${home}/runs`,
      // M2: resolve the registry's source state so `pipeline status` on an
      // archived Run reports sourceState: 'archived'. Falls back to 'active'
      // when no ledger is available (unregistered project / pre-registry Run).
      resolveSourceState: ledgerStore
        ? (record) => {
            const association = ledgerStore!.resolveAssociationByInstanceId(
              record.change.instanceId
            );
            if (association) {
              return association.state === 'active' ? 'active' : 'archived';
            }
            return 'active';
          }
        : undefined,
    });
    return { ctx, pipeline, runId, projectRoot, projectId, launchKey };
  }

  private printRunReceipt(
    options: PipelineCommandOptions,
    payload: unknown
  ): void {
    console.log(JSON.stringify(payload, null, 2));
  }

  /**
   * Human-readable rendering of a Run's current view (task 8.3). Shows the
   * run status, committed actions, active waits, and — when present — the
   * review-cycle section (round, phase, outcome, findings, actors).
   */
  private printRunStatusHuman(runId: string, view: unknown): void {
    const v = view as {
      status: string;
      sections: Array<Record<string, unknown>>;
    };
    console.log(`Run: ${runId}`);
    console.log(`Status: ${v.status}`);
    // Render the review-cycle section when present.
    const rc = v.sections.find(
      (s) => s.kind === 'review-cycle'
    ) as
      | {
          kind: 'review-cycle';
          round: number;
          phase: string;
          outcome?: string;
          findings: Array<{ id: string; severity: string; status: string }>;
          actors: { fixer?: unknown; verifier?: unknown; lastActor?: unknown };
          waitReason?: string;
          maxRounds: number;
          loopPath: string;
        }
      | undefined;
    if (rc) {
      console.log();
      console.log('Review Cycle:');
      console.log(`  Round: ${rc.round} / ${rc.maxRounds}`);
      console.log(`  Phase: ${rc.phase}`);
      if (rc.outcome) {
        console.log(`  Outcome: ${rc.outcome}`);
      }
      if (rc.waitReason) {
        console.log(`  Wait: ${rc.waitReason}`);
      }
      if (rc.findings.length > 0) {
        console.log(`  Findings (${rc.findings.length}):`);
        for (const f of rc.findings) {
          console.log(`    [${f.severity}] ${f.id}: ${f.status}`);
        }
      }
      const actorKinds = Object.entries(rc.actors)
        .filter(([, val]) => val !== undefined)
        .map(([key]) => key);
      if (actorKinds.length > 0) {
        console.log(`  Actors: ${actorKinds.join(', ')}`);
      }
    }
  }

  /**
   * Start (or reuse) a reconciler-engine Run for a change under a pipeline
   * (task 12.1/12.2).
   */
  async start(
    changeId: string,
    pipelineName: string,
    options: PipelineCommandOptions = {}
  ): Promise<void> {
    const { ctx, pipeline, runId, projectRoot, projectId, launchKey } =
      await this.resolveRuntime(changeId, pipelineName, options);
    const receipt = await ctx.facade.start(
      {
        change: { projectRoot, changeId },
        pipeline: pipeline.name,
        launchRequestId: launchKey as never,
        engine: 'reconciler',
      },
      { deliveryMode: 'grant' }
    );
    this.printRunReceipt(options, {
      runId,
      change: { projectRoot, changeId, projectId },
      pipeline: pipeline.name,
      engine: 'reconciler',
      disposition: receipt.disposition,
      status: receipt.view.status,
      actions: receipt.actions.map((action) => ({
        actionId: action.actionId,
        nodeId: action.nodeId,
        kind: action.kind,
      })),
    });
  }

  /**
   * Print a Run's current view (task 12.3/12.4 inspect).
   *
   * Supports the same test-injection override as `complete`/`control`
   * (task 15.1): when `runtimeForRunOverride` is set (tests only — production
   * never passes it), the heavy root-selection + registry-freeze chain is
   * bypassed so cross-plane parity can be asserted against an in-memory fixture
   * without spawning a process. The view itself still flows through the same
   * `facade.inspect` → `projectRunView(record)` path either way.
   */
  async status(
    changeId: string,
    pipelineName: string,
    options: PipelineCommandOptions = {}
  ): Promise<void> {
    const { ctx, runId, projectRoot } = this.runtimeForRunOverride
      ? await this.runtimeForRunOverride(changeId, pipelineName as never, options)
      : await this.resolveRuntime(changeId, pipelineName, options);
    if (!ctx.store.has(runId as never)) {
      throw pipelineMessageError(
        'pipelineNotFound',
        { name: changeId, available: 'no_run' },
        'run_not_found'
      );
    }
    const view = await ctx.facade.inspect({
      change: { projectRoot, changeId },
      runId: runId as never,
    });
    if (!options.json) {
      this.printRunStatusHuman(runId, view);
      return;
    }
    this.printRunReceipt(options, { runId, status: view.status, view });
  }

  /**
   * Resume a Run: grant the ready frontier (task 12.3/12.4).
   */
  async resumeRun(
    changeId: string,
    pipelineName: string,
    options: PipelineCommandOptions = {}
  ): Promise<void> {
    const { ctx, pipeline, runId, projectRoot, launchKey } =
      await this.resolveRuntime(changeId, pipelineName, options);
    const receipt = await ctx.facade.resume(
      { change: { projectRoot, changeId }, runId: runId as never },
      { deliveryMode: 'grant' }
    );
    this.printRunReceipt(options, {
      runId,
      pipeline: pipeline.name,
      disposition: receipt.disposition,
      status: receipt.view.status,
      actions: receipt.actions.map((action) => ({
        actionId: action.actionId,
        nodeId: action.nodeId,
        kind: action.kind,
      })),
    });
    void launchKey;
  }

  /**
   * Cancel a Run (task 12.3/12.4 control).
   */
  async cancelRun(
    changeId: string,
    pipelineName: string,
    options: PipelineCommandOptions = {}
  ): Promise<void> {
    const { ctx, runId, projectRoot } = await this.resolveRuntime(
      changeId,
      pipelineName,
      options
    );
    const receipt = await ctx.facade.control(
      { kind: 'cancel', change: { projectRoot, changeId }, runId: runId as never } as never,
      { deliveryMode: 'grant' }
    );
    this.printRunReceipt(options, { runId, disposition: receipt.disposition, status: receipt.view.status });
  }

  // -------------------------------------------------------------------------
  // Engine-aware complete / control (tasks 12.5 / 12.6 / 7.9)
  // -------------------------------------------------------------------------

  /**
   * Resolve the runtime context for a --run-based command (complete/control).
   * Opens the filesystem RunStore, loads the Record by the exact runId to
   * recover the pipeline name, then delegates to {@link resolveRuntime} with
   * the runId override so the plan's runId matches the stored Record.
   * Test-injected resolvers bypass this path entirely.
   */
  private async resolveRuntimeForRun(
    changeId: string,
    runId: string,
    options: PipelineCommandOptions
  ): Promise<ResolvedRuntime> {
    if (this.runtimeForRunOverride) {
      return this.runtimeForRunOverride(changeId, runId, options);
    }

    const root = await this.resolveRoot(options);
    if (!root) throw new Error('No Rasen root resolved.');

    const home = getGlobalDataDir();
    const storeRoot = `${home}/runs`;
    const store = createFilesystemRunStore(storeRoot);
    if (!store.has(runId as never)) {
      throw pipelineMessageError(
        'pipelineNotFound',
        { name: runId, available: 'no_run' },
        'run_not_found'
      );
    }
    const record = store.load(runId as never);
    const pipelineName = record.pipeline;

    // Re-prepare the definition + profile using the recovered pipeline name,
    // overriding the derived runId with the exact --run value. The identities
    // (planningSpaceId, changeInstanceId, workspaceInstanceId) are derived from
    // the physical workspace and remain stable across re-preparation.
    return this.resolveRuntime(changeId, pipelineName, options, runId);
  }

  /**
   * Ambiguity guard (m1): if no active association exists for the changeId and
   * more than one archived generation is present, throw
   * `launch_instance_ambiguous` with the candidate list. This prevents silently
   * picking one archived generation when the user should supply `--run` to
   * disambiguate. Runs in BOTH the changeDir-exists and changeDir-not-exist
   * branches of `resolveRuntime`.
   */
  private assertLaunchUnambiguous(
    ledgerStore: ReturnType<typeof createAssociationLedgerStore>,
    changeId: string
  ): void {
    const ledger = ledgerStore.load();
    const latest = ledger.revisions.at(-1)?.associations ?? [];
    const hasActive = latest.some(
      (a) => a.changeId === changeId && a.state === 'active'
    );
    if (hasActive) return;
    const archived = latest.filter(
      (a) => a.changeId === changeId && a.state === 'archived'
    );
    if (archived.length > 1) {
      const candidates = archived
        .map((a) => `(${a.instanceId})`)
        .join(', ');
      throw new ChangeRunRuntimeError(
        'launch_instance_ambiguous',
        `Multiple historical Change instances exist for "${changeId}" (${archived.length} archived generations). ` +
          'Supply an exact --run to disambiguate. ' +
          `Candidates: ${candidates}`
      );
    }
  }

  /**
   * Reject mutations (`complete`/`control`) on a Run whose source Change has
   * been archived. The registry is the authoritative source of truth: the
   * Run Record's stored `changeInstanceId` (the immutable identity from when
   * the Run was created) is looked up in the association ledger by INSTANCE
   * ID — not by textual alias. After archive + same-name recreate, the alias
   * resolves to the NEW active association, but the OLD Run's stored instance
   * ID resolves to the ARCHIVED one. This is the B1 fix: the check must be
   * instance-scoped.
   *
   * The filesystem heuristic (an active `rasen/changes/<id>/` directory vs an
   * archived `<home>/archive/*-<id>/` directory) remains as a fallback for
   * cases the registry cannot resolve (unregistered project, missing ledger,
   * manually-moved source, or a pre-registry Run with no stored instanceId
   * match in the ledger).
   *
   * The registry SHALL be authoritative; the filesystem SHALL NOT override a
   * registry refusal. A corrupt/missing registry never widens the mutation
   * surface beyond the filesystem fallback.
   */
  private async assertChangeNotArchived(
    changeId: string,
    projectRoot: string,
    runId?: string
  ): Promise<void> {
    const changeDir = path.join(
      projectRoot,
      WORKSPACE_DIR_NAME,
      'changes',
      changeId
    );

    // First try the registry (authoritative path) — instance-scoped lookup.
    try {
      const projectHome = await resolveProjectHome(projectRoot, { ensure: false });
      if (projectHome) {
        const planningSpaceId = derivePlanningSpaceId(projectHome.name) as never;
        const ledgerStore = createAssociationLedgerStore({
          homeDir: projectHome.homeDir,
          planningSpaceId,
          projectId: projectHome.projectId,
        });

        // Instance-scoped lookup (B1): if the caller supplied a runId, load
        // the Run Record, read its STORED changeInstanceId, and look THAT up
        // in the ledger. This prevents a same-name recreate from making the
        // alias resolve to the new active association while the OLD Run is
        // being mutated.
        let association;
        if (runId) {
          const storeRoot = `${getGlobalDataDir()}/runs`;
          const runStore = createFilesystemRunStore(storeRoot);
          if (runStore.has(runId as never)) {
            const record = runStore.load(runId as never);
            const storedInstanceId = record.change.instanceId;
            association = ledgerStore.resolveAssociationByInstanceId(storedInstanceId);
          }
        }

        // Fall back to alias-based lookup if the instance-scoped path did not
        // resolve (e.g. pre-registry Run with no matching instanceId, or no
        // runId supplied).
        if (!association) {
          const alias = `changes/${changeId}`;
          association = ledgerStore.resolveAssociationByAlias(alias);
        }

        if (association) {
          if (association.state === 'archived') {
            const archiveAliases = association.archiveAliases.join(', ');
            throw new ChangeRunRuntimeError(
              'change_instance_inactive',
              `Change "${changeId}" is archived (${archiveAliases}). ` +
                'Mutations (complete/control) on its Runs are rejected via the association registry. ' +
                'The Run remains inspectable via `pipeline status`.'
            );
          }
          // Registry says active — mutation allowed.
          if (association.state === 'active') return;
          // state === 'missing' — fall through to filesystem heuristic.
        }
        // No association found — fall through to filesystem heuristic.
      }
    } catch (err) {
      // Re-throw the guard error; swallow resolution/registry failures.
      if (err instanceof ChangeRunRuntimeError) throw err;
    }

    // Filesystem fallback (Gap D behavior preserved for unregistered cases).
    if (fs.existsSync(changeDir)) return; // active — mutation allowed

    try {
      const home = await resolveProjectHome(projectRoot, { ensure: false });
      if (home) {
        const archiveDir = home.archiveDir;
        if (fs.existsSync(archiveDir)) {
          const entries = fs.readdirSync(archiveDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.endsWith(`-${changeId}`)) {
              throw new ChangeRunRuntimeError(
                'change_instance_inactive',
                `Change "${changeId}" is archived (${entry.name}). ` +
                  'Mutations (complete/control) on its Runs are rejected. ' +
                  'The Run remains inspectable via `pipeline status`.'
              );
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof ChangeRunRuntimeError) throw err;
    }
  }

  /**
   * Read a bounded JSON payload from a file path or `-` (stdin). Applies the
   * same bounded no-follow reader as the kernel (task 12.6): symlinks,
   * non-regular files, oversized bodies, and malformed JSON are rejected with
   * stable typed errors before any staging or facade call.
   */
  private readBoundedPayload(from: string, maxBytes = 1024 * 1024): unknown {
    if (from === '-') {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(0);
      } catch {
        throw new InputReaderError('input_not_found', 'Could not read from stdin.');
      }
      if (buf.byteLength > maxBytes) {
        throw new InputReaderError(
          'input_too_large',
          `Input exceeds ${maxBytes} bytes.`
        );
      }
      try {
        return JSON.parse(buf.toString('utf8'));
      } catch {
        throw new InputReaderError('input_malformed', 'Input is not valid JSON.');
      }
    }
    return readBoundedJson(from, maxBytes);
  }

  /**
   * Stage trusted-host transport uploads through a bounded content-addressed
   * HostEvidenceWriter BEFORE the facade receives any refs (task 7.9). Only
   * refs (contentDigest + identity) enter the receipt bytes — never raw
   * content. Every EvidenceRef in the completion must have its content staged;
   * orphaned uploads (not referenced by any ref) are rejected so arbitrary
   * content cannot be injected into the evidence store.
   *
   * Returns the bounded store handle so tests can inspect what was staged.
   */
  private stageTransportUploads(
    uploads: ReadonlyArray<{ contentDigest: string; contentBase64: string }>,
    requiredDigests: ReadonlySet<string>
  ): ReturnType<typeof createBoundedEvidenceStore> {
    const store = createBoundedEvidenceStore({
      maxRunBytes: 64 * 1024 * 1024,
      maxEntries: 64,
    });

    const stagedDigests = new Set<string>();
    for (const upload of uploads) {
      const content = Buffer.from(upload.contentBase64, 'base64');
      const actualDigest = computeEvidenceContentDigest(
        new Uint8Array(content)
      );
      if (actualDigest !== upload.contentDigest) {
        throw new InputReaderError(
          'input_malformed',
          `Upload contentDigest mismatch: claimed ${upload.contentDigest}, actual ${actualDigest}.`
        );
      }
      store.stage(new Uint8Array(content));
      stagedDigests.add(upload.contentDigest);
    }

    // Every EvidenceRef must have staged content — no ref enters the facade
    // without its raw bytes proven against the claimed digest.
    for (const digest of requiredDigests) {
      if (!stagedDigests.has(digest)) {
        throw new InputReaderError(
          'input_malformed',
          `Evidence ref contentDigest ${digest} has no staged upload content.`
        );
      }
    }
    // Orphaned uploads cannot advance: content uploaded but not referenced by
    // any EvidenceRef is rejected (prevents evidence-store injection).
    for (const digest of stagedDigests) {
      if (!requiredDigests.has(digest)) {
        throw new InputReaderError(
          'input_malformed',
          `Orphaned upload ${digest} is not referenced by any evidence ref.`
        );
      }
    }
    return store;
  }

  /**
   * Collect every contentDigest from EvidenceRefs in a completion envelope.
   * These are the digests that MUST have staged upload content before the
   * facade sees the refs.
   */
  private collectRequiredDigests(completion: CompleteRunAction): Set<string> {
    const digests = new Set<string>();
    digests.add(completion.actorAttestation.contentDigest);
    for (const ref of completion.evidence) {
      digests.add(ref.contentDigest);
    }
    return digests;
  }

  /**
   * Validate and parse the uploads array from a submission body. Each entry
   * must be an object with string `contentDigest` and `contentBase64` fields.
   */
  private parseUploads(
    raw: unknown
  ): Array<{ contentDigest: string; contentBase64: string }> {
    if (!Array.isArray(raw)) return [];
    const uploads: Array<{ contentDigest: string; contentBase64: string }> = [];
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      if (entry === null || typeof entry !== 'object') {
        throw new InputReaderError(
          'input_malformed',
          `Upload entry ${i} must be an object.`
        );
      }
      const e = entry as Record<string, unknown>;
      if (
        typeof e.contentDigest !== 'string' ||
        typeof e.contentBase64 !== 'string'
      ) {
        throw new InputReaderError(
          'input_malformed',
          `Upload entry ${i} must have string contentDigest and contentBase64.`
        );
      }
      uploads.push({
        contentDigest: e.contentDigest,
        contentBase64: e.contentBase64,
      });
    }
    return uploads;
  }

  /**
   * Complete a Run action from a receipt body (task 12.5/12.6).
   *
   * `rasen pipeline complete <change> --run <runId> --from <receipt.json|->`
   *
   * Reads a bounded JSON body from a file or stdin, stages trusted-host
   * transport uploads through HostEvidenceWriter BEFORE the facade receives
   * refs (only refs/digests enter receipt bytes — never raw content), then
   * calls `facade.complete(...)`. The body is a submission wrapper:
   *
   * ```json
   * {
   *   "completion": { ...change-run-completion/1 envelope... },
   *   "uploads": [{ "contentDigest": "sha256:...", "contentBase64": "..." }]
   * }
   * ```
   */
  async complete(
    changeId: string,
    runId: string,
    from: string,
    options: PipelineCommandOptions = {}
  ): Promise<void> {
    const resolved = await this.resolveRuntimeForRun(changeId, runId, options);
    await this.assertChangeNotArchived(changeId, resolved.projectRoot, runId);
    const body = this.readBoundedPayload(from) as {
      completion?: unknown;
      uploads?: unknown;
    };
    if (
      body === null ||
      typeof body !== 'object' ||
      body.completion === undefined
    ) {
      throw new InputReaderError(
        'input_malformed',
        'Body must be an object with a "completion" field.'
      );
    }
    const uploads = this.parseUploads(body.uploads);
    // Decode the completion through the strict contract schema — unknown
    // fields, wrong types, and missing required fields all fail here.
    const completion = decodeCompletion(body.completion);
    const requiredDigests = this.collectRequiredDigests(completion);
    // Stage uploads through HostEvidenceWriter before the facade sees refs.
    this.stageTransportUploads(uploads, requiredDigests);
    const receipt = await resolved.ctx.facade.complete(completion, {
      deliveryMode: 'grant',
    });
    this.printRunReceipt(options, {
      runId,
      disposition: receipt.disposition,
      status: receipt.view.status,
    });
  }

  /**
   * Submit a typed control request from a body (task 12.5/12.6).
   *
   * `rasen pipeline control <change> --run <runId> --from <control.json|->`
   *
   * The body is a submission wrapper:
   *
   * ```json
   * {
   *   "control": { ...change-run-control/1 request... },
   *   "uploads": [{ "contentDigest": "sha256:...", "contentBase64": "..." }]
   * }
   * ```
   *
   * Transport uploads are staged through HostEvidenceWriter when the control
   * command carries EvidenceRefs (e.g. accept-workspace-revision, decision).
   * `cancel` is typed sugar over this path.
   */
  async control(
    changeId: string,
    runId: string,
    from: string,
    options: PipelineCommandOptions = {}
  ): Promise<void> {
    const resolved = await this.resolveRuntimeForRun(changeId, runId, options);
    await this.assertChangeNotArchived(changeId, resolved.projectRoot, runId);
    const body = this.readBoundedPayload(from) as {
      control?: unknown;
      uploads?: unknown;
    };
    if (
      body === null ||
      typeof body !== 'object' ||
      body.control === undefined
    ) {
      throw new InputReaderError(
        'input_malformed',
        'Body must be an object with a "control" field.'
      );
    }
    const uploads = this.parseUploads(body.uploads);
    const control = decodeControl(body.control);
    // Collect required digests from any EvidenceRefs the command carries.
    const requiredDigests = this.collectRequiredDigestsFromControl(control);
    if (requiredDigests.size > 0 || uploads.length > 0) {
      this.stageTransportUploads(uploads, requiredDigests);
    }
    // The facade's control method casts the request as a RunStimulus (the
    // reducer expects a top-level `kind`, not the control envelope's nested
    // `command.kind`). Convert the decoded control request to the matching
    // stimulus shape. This mirrors how cancelRun already passes a stimulus-
    // shaped object via `as never`.
    const stimulus = this.controlRequestToStimulus(control);
    const receipt = await resolved.ctx.facade.control(stimulus as never, {
      deliveryMode: 'grant',
    });
    this.printRunReceipt(options, {
      runId,
      disposition: receipt.disposition,
      status: receipt.view.status,
    });
  }

  /**
   * Collect content digests from EvidenceRefs embedded in a control request's
   * command (decision/accept-workspace-revision may carry evidence).
   */
  private collectRequiredDigestsFromControl(
    control: ChangeRunControlRequest
  ): Set<string> {
    const digests = new Set<string>();
    const cmd = control.command;
    if (cmd.kind === 'decision' && cmd.evidence) {
      for (const ref of cmd.evidence) {
        digests.add(ref.contentDigest);
      }
    }
    if (cmd.kind === 'accept-workspace-revision') {
      for (const ref of cmd.evidence) {
        digests.add(ref.contentDigest);
      }
    }
    return digests;
  }

  /**
   * Convert a decoded ChangeRunControlRequest into the RunStimulus shape the
   * reducer expects (top-level `kind`, not nested `command.kind`). The facade's
   * control method casts its argument as a RunStimulus, so the command must be
   * flattened before the call. This mirrors how `cancelRun` already constructs
   * a stimulus-shaped object inline.
   */
  private controlRequestToStimulus(
    control: ChangeRunControlRequest
  ): Readonly<Record<string, unknown>> {
    const cmd = control.command;
    switch (cmd.kind) {
      case 'cancel':
        return { kind: 'cancel', ...(cmd.reason ? { reason: cmd.reason } : {}) };
      case 'escalate':
        // The escalate stimulus requires a `code`; the control command only
        // carries a human `reason`. Use a stable default code.
        return { kind: 'escalate', code: 'user_escalated', reason: cmd.reason };
      case 'resume':
        return { kind: 'resume-wait', waitId: cmd.waitId };
      case 'decision':
        return {
          kind: 'decide-gate',
          waitId: cmd.waitId,
          decisionId: cmd.decisionId,
          outcome: cmd.outcome,
        };
      case 'accept-workspace-revision':
        return {
          kind: 'accept-workspace-revision',
          waitId: cmd.waitId,
          revision: cmd.revision,
          evidence: cmd.evidence,
        };
    }
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
    const pipeline = await this.loadPipelineOrExplain(
      normalizedName,
      projectRoot,
      options
    );
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
    const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
      reporter: this.executionOptions(options, host).reporter,
    });
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
        await registry.selectForExecution(
          pipelineName,
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

    const pipeline = preflightPreparedDefinitionExecution(
      registry.load(runState.pipeline).prepared
    ).pipeline;
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
      {
        ...this.executionOptions(options, host),
        skillSets: registry.skillSets,
        loadPrepared: registry.load,
      }
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

  private async loadPipelineOrExplain(
    name: string,
    projectRoot: string,
    options: PipelineCommandOptions
  ): Promise<PipelineYaml> {
    const available = listPipelines(projectRoot);
    if (!available.includes(name)) {
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
    const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
      reporter: this.executionOptions(options).reporter,
    });
    // `pipeline agents` is a configuration/read surface, not a launch. Keep
    // Definition preparation and the stable v1 adapter boundary, but do not
    // probe target binaries or require the current active profile to be able to
    // execute the pipeline merely to inspect or change its runtime defaults.
    return preflightPreparedDefinitionExecution(
      registry.load(name).prepared
    ).pipeline;
  }

  private publicPipelineInfo(info: PipelineInfo): PipelineInfo {
    const {
      prepared: _prepared,
      authoredText: _authoredText,
      authoredDefinition: _authoredDefinition,
      pipelinePath: _pipelinePath,
      ...publicInfo
    } = info;
    return publicInfo;
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
