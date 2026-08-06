import { z } from 'zod';
import { resolveModelPreset } from '../model-presets.js';
import {
  THRESHOLD_ROLES,
  thresholdSchema as sharedThresholdSchema,
  type ThresholdValue,
} from '../threshold-values.js';
import {
  resolveThreshold,
  type ThresholdBindingLayers,
  type ThresholdBindingMetadata,
  type ThresholdDiagnostic,
  type ThresholdSchemeSnapshot,
} from '../threshold-resolver.js';
import {
  DISPATCH_RUNTIMES,
  hasRuntimeCapability,
  type DetectedHostRuntime,
  type DispatchRuntime,
} from '../runtime-adapters.js';

export type { ThresholdValue };

/**
 * The role a stage plays in an orchestration pipeline.
 */
export const StageRoleSchema = z.enum(THRESHOLD_ROLES);
export type StageRole = z.infer<typeof StageRoleSchema>;

/**
 * The agent runtime used to execute a pipeline role or stage.
 *
 * `claude` is the existing Claude Code subagent path. `codex` means the LEAD
 * should dispatch the work as a non-interactive `codex exec` process (the
 * `src/core/codex` exec bridge) and record the resulting threadId in
 * run-state for direct resume.
 */
export const AgentRuntimeSchema = z.enum(DISPATCH_RUNTIMES);
export type AgentRuntime = DispatchRuntime;

export const AgentRuntimeSessionReuseSchema = z.enum([
  'none',
  'stage',
  'run-planner',
  'review-thread',
]);
export type AgentRuntimeSessionReuse = z.infer<typeof AgentRuntimeSessionReuseSchema>;

export const AgentRuntimeSandboxSchema = z.enum(['read-only', 'workspace-write']);
export type AgentRuntimeSandbox = z.infer<typeof AgentRuntimeSandboxSchema>;

/** Canonical reasoning-effort vocabulary for first-class leaf dispatch. */
export const LEAF_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const LeafEffortSchema = z.enum(LEAF_EFFORTS);
export type LeafEffort = z.infer<typeof LeafEffortSchema>;

export const AgentRuntimeConfigSchema = z.object({
  runtime: AgentRuntimeSchema.optional(),
  sessionReuse: AgentRuntimeSessionReuseSchema.optional(),
  sandbox: AgentRuntimeSandboxSchema.optional(),
  model: z.string().min(1).optional(),
  effort: LeafEffortSchema.optional(),
});
export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfigSchema>;

export const AgentRuntimeConfigValueSchema = z.union([
  AgentRuntimeSchema,
  AgentRuntimeConfigSchema,
]);

export const PipelineAgentRuntimeOverridesSchema = z
  .object({
    planner: AgentRuntimeConfigValueSchema.optional(),
    implementer: AgentRuntimeConfigValueSchema.optional(),
    reviewer: AgentRuntimeConfigValueSchema.optional(),
    fixer: AgentRuntimeConfigValueSchema.optional(),
    shipper: AgentRuntimeConfigValueSchema.optional(),
  })
  .strict();
export type PipelineAgentRuntimeOverrides = z.infer<typeof PipelineAgentRuntimeOverridesSchema>;

/**
 * Build the dual-form threshold schema shared by handoff and reuse: a bare
 * number is ALWAYS a fraction of the context window in (0, 1]; the absolute
 * form is ALWAYS the strict object `{ remainingTokens: <positive integer> }`
 * — a required-headroom threshold in tokens. No bare number is ever read as
 * a token count. `label` customizes the fraction error message so it stays
 * self-describing per threshold family (cf. HandoffThresholdSchema vs
 * ReuseThresholdSchema).
 */
export const thresholdSchema = sharedThresholdSchema;

/**
 * A context-handoff threshold: a fraction of the context window in (0, 1] at or
 * above which an agent should hand off before compaction degrades it, OR the
 * absolute form `{ remainingTokens: N }` — hand off when N tokens or fewer
 * remain.
 */
const HandoffThresholdSchema = thresholdSchema('threshold');

/**
 * Per-role threshold overrides. Each role's value tunes only the handoff
 * threshold for stages playing that role; relay/stall caps stay global.
 */
const HandoffRolesSchema = z
  .object({
    planner: HandoffThresholdSchema.optional(),
    implementer: HandoffThresholdSchema.optional(),
    reviewer: HandoffThresholdSchema.optional(),
    fixer: HandoffThresholdSchema.optional(),
    shipper: HandoffThresholdSchema.optional(),
  })
  .strict();

/**
 * Context-handoff tuning, accepted at pipeline level and per-stage.
 *  - `threshold` — context-window fraction that triggers a handoff.
 *  - `roles` — per-role threshold overrides (pipeline level only in practice).
 *  - `maxRelays` — the (Nth+1) handoff request on one stage triggers LEAD review.
 *  - `stallLimit` — consecutive no-progress handoffs that trigger LEAD review.
 */
export const HandoffConfigSchema = z
  .object({
    threshold: HandoffThresholdSchema.optional(),
    roles: HandoffRolesSchema.optional(),
    maxRelays: z
      .number()
      .int()
      .positive({ error: 'maxRelays must be a positive integer' })
      .optional(),
    stallLimit: z
      .number()
      .int()
      .positive({ error: 'stallLimit must be a positive integer' })
      .optional(),
  })
  .strict();
export type HandoffConfig = z.infer<typeof HandoffConfigSchema>;

/**
 * Stage-level handoff overrides. `roles` is pipeline-level only (a stage
 * already has exactly one role), so it is rejected here rather than being
 * accepted and silently ignored by resolveStageHandoffConfig.
 */
export const StageHandoffConfigSchema = HandoffConfigSchema.omit({ roles: true }).strict();
export type StageHandoffConfig = z.infer<typeof StageHandoffConfigSchema>;

/**
 * Whether a role's worker may be carried into a new child change.
 *  - `auto` — the orchestrator may reuse (warm) or retire the worker per policy.
 *  - `never` — always spawn a fresh worker for this role (today's behavior).
 */
export const ReuseModeSchema = z.enum(['auto', 'never']);
export type ReuseMode = z.infer<typeof ReuseModeSchema>;

/**
 * A reuse threshold, in two forms with distinct comparison directions:
 *  - fraction, in (0, 1]: the maximum context OCCUPANCY at which a worker may
 *    take on a whole new child change — the orchestrator reuses the worker
 *    when measured occupancy `pct <= threshold`, retires it otherwise
 *    (playbook Step G.1.3). It is an occupancy CEILING, not required
 *    headroom; stricter (lower) than the handoff threshold, because taking on
 *    a fresh change needs more free context than finishing the task in hand.
 *  - absolute, `{ remainingTokens: N }`: a required-headroom FLOOR — the
 *    orchestrator reuses the worker only when `remainingTokens >= N`.
 * Kept as a separate schema (not shared with HandoffThresholdSchema) so its
 * validation message vocabulary ("reuse threshold") stays self-describing.
 */
const ReuseThresholdSchema = thresholdSchema('reuse threshold');

/**
 * Per-role reuse threshold overrides. Only `planner` and `implementer` are
 * reusable roles (reviewer/fixer/shipper are out of scope — a fixer's
 * fresh-eyes value is the reason), so restricting the keys both documents scope
 * and rejects e.g. `roles: { reviewer: … }` as an unknown key.
 */
const ReuseRolesSchema = z
  .object({
    planner: ReuseThresholdSchema.optional(),
    implementer: ReuseThresholdSchema.optional(),
  })
  .strict();

/**
 * Worker-reuse policy config, accepted at pipeline level only (reuse is a
 * cross-change concern with no stage form).
 *  - `planner` / `implementer` — reuse mode switch for that role.
 *  - `threshold` — pipeline-level reuse threshold (context headroom).
 *  - `roles` — per-role `threshold` overrides for `planner` / `implementer`.
 */
export const ReuseConfigSchema = z
  .object({
    planner: ReuseModeSchema.optional(),
    implementer: ReuseModeSchema.optional(),
    threshold: ReuseThresholdSchema.optional(),
    roles: ReuseRolesSchema.optional(),
  })
  .strict();
export type ReuseConfig = z.infer<typeof ReuseConfigSchema>;

/**
 * Loop configuration for a stage that re-runs until a condition is met.
 *
 * Two kinds today:
 *  - `review-cycle` — the bounded review -> fix loop (Step E of the playbook).
 *  - `goal` — the goal-driven iteration loop (Step L of the playbook): repeat
 *    modify -> judge until a gate is satisfied or a round cap is hit.
 *
 * The `goal` variant carries a required `gate` discriminated union — exactly
 * ONE gate per pipeline (measure XOR evaluate). No combination in v1: the
 * discriminated union makes the two gate kinds structurally exclusive, which is
 * what dissolves AND/OR-combination complexity.
 */
export const StageLoopSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('review-cycle'),
    maxRounds: z
      .number()
      .int()
      .positive({ error: 'maxRounds must be a positive integer' })
      .default(3),
  }),
  z
    .object({
      kind: z.literal('goal'),
      // Exactly ONE gate per pipeline (measure XOR evaluate). The pipeline YAML
      // registers only the gate TYPE ({kind: measure} / {kind: evaluate}); the
      // LEAD injects the concrete command/threshold/goal/rubric from goal-plan.md
      // into iterate.loopConfig at run start.
      gate: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('measure'),
            // Optional in the registry schema, REQUIRED at run-time: the LEAD
            // asserts it is present (read from goal-plan.md) before round 1.
            command: z.string().min(1).optional(),
            // Score stop threshold (gte/lte against gate stdout `score`).
            threshold: z.number().optional(),
            // passed-count target (against gate stdout `passed`).
            target: z.number().optional(),
            direction: z.enum(['gte', 'lte']).default('gte'), // lte = smaller is better
            timeoutSec: z.number().int().positive().default(120),
          })
          .strict(),
        z
          .object({
            kind: z.literal('evaluate'),
            // NL success criterion + rubric — injected at run-time from goal-plan.md.
            goal: z.string().min(1).optional(),
            rubric: z.string().optional(),
          })
          .strict(),
      ]),
      maxRounds: z
        .number()
        .int()
        .positive({ error: 'maxRounds must be a positive integer' })
        .default(5),
      // gate-neutral; avoids HandoffConfigSchema.stallLimit collision.
      loopStallLimit: z
        .number()
        .int()
        .positive({ error: 'loopStallLimit must be a positive integer' })
        .default(2),
      // Distinct counter from loopStallLimit (non-progressing rounds) and
      // maxRounds (total budget): the number of consecutive rounds the SAME
      // implementer-reported blocker must recur before the loop escalates it
      // as genuinely blocked. Default 3 (> stall 2 by design — a self-reported
      // wall earns more alternate-angle retries than a silent non-improvement).
      blockedThreshold: z
        .number()
        .int()
        .positive({ error: 'blockedThreshold must be a positive integer' })
        .default(3),
      runArtifact: z.string().default('goal-run.json'),
    })
    .superRefine((s, ctx) => {
      // A measure gate that names a command (i.e. is concretely configured to
      // run) MUST also define a stop condition — threshold OR target. The bare
      // registry template `{ kind: measure }` (no command) is ALLOWED: the
      // pipeline registers only the gate type, and the LEAD injects the concrete
      // command + threshold/target at run-time from goal-plan.md (Step L Inject).
      // This keeps the data-driven template valid while still catching a
      // half-configured measure gate that would run without a stop condition.
      if (
        s.gate.kind === 'measure' &&
        s.gate.command !== undefined &&
        s.gate.threshold === undefined &&
        s.gate.target === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['gate'],
          message: 'measure gate with a command needs threshold or target',
        });
      }
    }),
]);

/**
 * The `loop.kind` vocabulary, named alongside `StageLoopSchema` above so the
 * pipeline-catalog endpoint (pipeline-definition-api) sources it from one
 * place instead of retyping the discriminated union's literals.
 */
export const LOOP_KIND_VALUES = ['review-cycle', 'goal'] as const;

/**
 * Policy hint for how thoroughly a verification/review stage should run.
 */
export const VerifyPolicySchema = z.enum(['adaptive', 'standard', 'light']);

/**
 * The kind of a stage. A `standard` stage names a `skill` the LEAD dispatches
 * once. A `decompose` stage is a LEAD-interpreted fan-out point (not a leaf
 * skill call): the LEAD splits the task into multiple child changes and runs
 * each through `childPipeline`. Tracked as a named enum per the repo rule
 * "if we generate it, track it by name".
 */
export const StageKindSchema = z.enum(['standard', 'decompose']);

/**
 * The built-in pipeline a decompose stage runs for each child change when the
 * stage does not name an explicit `childPipeline`. MUST be decompose-free.
 */
export const DEFAULT_CHILD_PIPELINE = 'small-feature';

/**
 * A single stage in an orchestration pipeline.
 *
 * `skill` is required for `standard` stages and optional for `decompose`
 * stages (which the LEAD interprets rather than dispatching to a leaf worker);
 * the conditional requirement is enforced by the superRefine below.
 */
export const StageSchema = z
  .object({
    id: z.string().min(1, { error: 'Stage ID is required' }),
    kind: StageKindSchema.default('standard'),
    skill: z.string().min(1, { error: 'skill field is required' }).optional(),
    // For kind: decompose — the pipeline each child change runs. Resolved
    // (with a decompose-free guard) at the registry layer; defaults to
    // DEFAULT_CHILD_PIPELINE when omitted.
    childPipeline: z.string().min(1).optional(),
    role: StageRoleSchema.optional(),
    requires: z.array(z.string()).default([]),
    // Stage-level PAUSE gate (distinct from the goal-loop `loop.gate`
    // measure/evaluate discriminated union below, which configures the
    // iterate loop's stop condition — do not confuse the two). `true` pauses
    // for human confirmation, `false` does not. Every gate is individually
    // controllable via `pipelines.<name>.gates.<stage>` (autopilot-gate-policy);
    // a legacy `gate: 'vet'` spelling is coerced to `true` by the pipeline-level
    // shim below (coerceLegacyVetGates).
    gate: z.boolean().default(false),
    loop: StageLoopSchema.optional(),
    parallelGroup: z.string().optional(),
    // Freeform condition label, e.g. 'always', 'security-relevant',
    // 'performance-sensitive', 'ui', 'non-ui'.
    condition: z.string().optional(),
    leadReview: z.boolean().default(false),
    verifyPolicy: VerifyPolicySchema.optional(),
    // Optional runtime override for this single stage. When omitted, consumers
    // use `pipeline.agents[role]` if present, otherwise `claude`.
    runtime: AgentRuntimeSchema.optional(),
    sessionReuse: AgentRuntimeSessionReuseSchema.optional(),
    sandbox: AgentRuntimeSandboxSchema.optional(),
    model: z.string().min(1).optional(),
    effort: LeafEffortSchema.optional(),
    // Per-stage context-handoff overrides. Resolved against the pipeline block
    // and built-in defaults by resolveStageHandoffConfig. `roles` is not
    // accepted here — it is pipeline-level config.
    handoff: StageHandoffConfigSchema.optional(),
  })
  .superRefine((stage, ctx) => {
    // skill is required for every non-decompose stage.
    if (stage.kind !== 'decompose' && !stage.skill) {
      ctx.addIssue({
        code: 'custom',
        path: ['skill'],
        message: 'skill field is required',
      });
    }
  });

/**
 * Tracks which pipelines have already emitted the legacy `gate: 'vet'`
 * deprecation warning this process, so the warning fires at most once per
 * pipeline per process (same shape as other one-time warnings in the codebase).
 */
const warnedLegacyVetPipelines = new Set<string>();

/**
 * Legacy-coercion shim for the retired `gate: 'vet'` gate type (design D1).
 *
 * This is the ONLY place the `'vet'` literal is permitted to appear in `src/`
 * (a source-tree guard test asserts it). A user pipeline YAML still carrying
 * `gate: 'vet'` reads as `gate: true` with a single warning per pipeline per
 * process — never a parse error, so existing user libraries keep loading. Every
 * gate is now individually controllable via `pipelines.<name>.gates.<stage>`.
 *
 * Runs as a `z.preprocess` on the whole pipeline (rather than on the gate field)
 * because the warning names the pipeline, which is not in scope at the stage.
 */
function coerceLegacyVetGates(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const pipeline = raw as { name?: unknown; stages?: unknown };
  if (!Array.isArray(pipeline.stages)) return raw;
  const pipelineName = typeof pipeline.name === 'string' ? pipeline.name : '<unknown>';
  for (const stage of pipeline.stages) {
    if (stage === null || typeof stage !== 'object') continue;
    const s = stage as { id?: unknown; gate?: unknown };
    if (s.gate !== 'vet') continue;
    s.gate = true;
    if (warnedLegacyVetPipelines.has(pipelineName)) continue;
    warnedLegacyVetPipelines.add(pipelineName);
    const stageId = typeof s.id === 'string' ? s.id : '<stage>';
    console.warn(
      `Pipeline "${pipelineName}" stage "${stageId}" declares gate: 'vet', which is no longer a distinct gate type; reading it as gate: true — every gate is now individually controllable via pipelines.${pipelineName}.gates.${stageId}.`
    );
  }
  return raw;
}

/**
 * Full pipeline YAML structure.
 */
export const PIPELINE_DEFINITION_VERSION = 1 as const;

/**
 * The public Pipeline definition content version. A missing version is the
 * sole legacy form and normalizes to v1; every explicit non-v1 value fails
 * closed so a future definition is never interpreted with the wrong grammar.
 */
export const PipelineDefinitionVersionSchema = z
  .literal(PIPELINE_DEFINITION_VERSION, {
    error: (issue) => {
      const received = JSON.stringify(issue.input) ?? String(issue.input);
      return (
        `Unsupported Pipeline content version at /version: received ${received}; ` +
        `supported version is ${PIPELINE_DEFINITION_VERSION}. Upgrade to a compatible ` +
        'Rasen version before using this definition.'
      );
    },
  })
  .default(PIPELINE_DEFINITION_VERSION);

export const PipelineYamlSchema = z.preprocess(coerceLegacyVetGates, z.object({
  version: PipelineDefinitionVersionSchema,
  name: z.string().min(1, { error: 'Pipeline name is required' }),
  description: z.string().optional(),
  agents: PipelineAgentRuntimeOverridesSchema.optional(),
  handoff: HandoffConfigSchema.optional(),
  reuse: ReuseConfigSchema.optional(),
  // Records provenance: `composed` means autopilot-assembled and activates the
  // hard quality floor; `ui` means Canvas-authored and carries no extra policy.
  // Absent means no recorded assembly origin.
  origin: z.enum(['composed', 'ui']).optional().describe(
    "Records how a pipeline was assembled: 'composed' by the autopilot LEAD, 'ui' by the management UI's Canvas; absent means no recorded assembly origin. Only 'composed' activates the required reviewer-role stage and review-cycle loop quality floor."
  ),
  stages: z.array(StageSchema).min(1, { error: 'At least one stage required' }),
}));

// Derived TypeScript types
export type StageLoop = z.infer<typeof StageLoopSchema>;
export type StageKind = z.infer<typeof StageKindSchema>;
export type VerifyPolicy = z.infer<typeof VerifyPolicySchema>;
export type Stage = z.infer<typeof StageSchema>;
export type PipelineYaml = z.infer<typeof PipelineYamlSchema>;

/** The config scope a per-stage/per-role override was supplied from. */
export type StageOverrideScope = 'project' | 'store' | 'global';

/** A per-stage/per-role override value plus the scope-qualified layer that decided it. */
export interface StageOverride<T> {
  value: T;
  scope: StageOverrideScope;
}

/**
 * The per-stage/per-role configuration top layer for a single stage (design D2
 * of `ui-config-redesign-pipelines-page`): the `pipelines.<name>.models.<stage>`,
 * `pipelines.<name>.handoff.<stage>`, and `pipelines.<name>.runtimes.<role>`
 * instances resolved for THIS stage, each sitting ABOVE the stage-level YAML
 * value. All fields optional — an absent field means "no override", and the
 * chain below resolves byte-identically to before this layer existed.
 */
export interface StageConfigOverrides {
  model?: StageOverride<string>;
  effort?: StageOverride<LeafEffort>;
  handoff?: StageOverride<ThresholdValue>;
  runtime?: StageOverride<AgentRuntime>;
}

/** Provenance of the MODEL field specifically — tracked separately from `source` (which names the runtime/session/sandbox/effort provenance) because the two can differ: e.g. a stage with only `runtime` overridden still resolves its model from machine config. */
export type ModelSource =
  | 'stage-override-project'
  | 'stage-override-store'
  | 'stage-override-global'
  | 'stage'
  | 'agent'
  | 'project-role'
  | 'project-default'
  | 'store-role'
  | 'store-default'
  | 'global-role'
  | 'global-default'
  | 'default';

/** Provenance of reasoning effort, tracked independently from model/runtime. */
export type EffortSource = ModelSource;

/** Provenance of the resolved `runtime` field specifically — a per-role config instance tops the pipeline declaration and default. */
export type RuntimeSource =
  | 'invocation'
  | 'stage-override-project'
  | 'stage-override-store'
  | 'stage-override-global'
  | 'stage'
  | 'agent'
  | 'host'
  | 'legacy-default';

export interface ResolvedStageRuntimeConfig extends AgentRuntimeConfig {
  runtime: AgentRuntime;
  source: 'stage' | 'agent' | 'default';
  /** Provenance of the resolved `model` field; always present, independent of `source`. */
  modelSource: ModelSource;
  /** Provenance of the resolved effort; absent effort with `default` means runtime default. */
  effortSource: EffortSource;
  /** Provenance of the resolved `runtime` field; always present, independent of `source`. Equals `source` when no runtime override applies. */
  runtimeSource: RuntimeSource;
}

export interface RuntimeResolutionContext {
  host: DetectedHostRuntime;
}

export const UNKNOWN_HOST_RUNTIME = {
  runtime: 'unknown',
  source: 'unknown',
} as const satisfies DetectedHostRuntime;

/**
 * Project/store/global machine-config model layers, slotted below the pipeline
 * `agents.<role>.model` role default and above the runtime's own default.
 * `roles` carries the per-role `models.roles.<role>` overrides at each
 * scope; `default`/`Default` name each scope's base `models.default`. The
 * store layer (`storeRoles`/`storeDefault`) sits between project and global,
 * and applies only when the project inherits from a store (see
 * `store-config-inheritance`).
 */
export interface ModelConfigLayers {
  projectRoles?: Partial<Record<StageRole, string>>;
  projectDefault?: string;
  storeRoles?: Partial<Record<StageRole, string>>;
  storeDefault?: string;
  globalRoles?: Partial<Record<StageRole, string>>;
  globalDefault?: string;
}

/** Project/store/global reasoning-effort layers, symmetric with model layers. */
export interface EffortConfigLayers {
  projectRoles?: Partial<Record<StageRole, LeafEffort>>;
  projectDefault?: LeafEffort;
  storeRoles?: Partial<Record<StageRole, LeafEffort>>;
  storeDefault?: LeafEffort;
  globalRoles?: Partial<Record<StageRole, LeafEffort>>;
  globalDefault?: LeafEffort;
}

export function normalizeAgentRuntimeConfig(
  value: z.infer<typeof AgentRuntimeConfigValueSchema> | undefined
): AgentRuntimeConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return { runtime: value };
  return AgentRuntimeConfigSchema.parse(value);
}

/**
 * Resolve the runtime that should execute a stage.
 *
 * Precedence (runtime/sessionReuse/sandbox/effort):
 * 1. Stage-level override (`runtime`, `model`, etc.).
 * 2. Pipeline role default (`agents.<role>`).
 * 3. Existing Claude behavior.
 *
 * Precedence (model field ONLY — independent of the above, since a stage
 * with no model override still resolves its model from machine config):
 * 1. Stage-level `model`.
 * 2. Pipeline `agents.<role>.model`.
 * 3. Project config `models.roles.<role>` (`modelLayers.projectRoles`).
 * 4. Project config `models.default` (`modelLayers.projectDefault`).
 * 5. Store config `models.roles.<role>` (`modelLayers.storeRoles`).
 * 6. Store config `models.default` (`modelLayers.storeDefault`).
 * 7. Global config `models.roles.<role>` (`modelLayers.globalRoles`).
 * 8. Global config `models.default` (`modelLayers.globalDefault`).
 * 9. Runtime's own default (no model configured).
 *
 * A model id at any layer is an opaque string used as-is — no allow-list
 * rejection. `modelLayers` is optional so existing two-argument call sites
 * are unaffected (model then resolves exactly as before, falling to
 * `undefined` when neither the stage nor the pipeline role sets one).
 */
export function resolveStageRuntimeConfig(
  stage: Stage,
  pipeline: PipelineYaml,
  modelLayers?: ModelConfigLayers,
  stageOverrides?: StageConfigOverrides,
  runtimeContext: RuntimeResolutionContext = { host: UNKNOWN_HOST_RUNTIME },
  effortLayers?: EffortConfigLayers
): ResolvedStageRuntimeConfig {
  const roleDefault = stage.role
    ? normalizeAgentRuntimeConfig(pipeline.agents?.[stage.role])
    : undefined;
  const stageHasOverride =
    stage.runtime !== undefined ||
    stage.sessionReuse !== undefined ||
    stage.sandbox !== undefined ||
    stage.model !== undefined ||
    stage.effort !== undefined;

  const projectRoleModel = stage.role ? modelLayers?.projectRoles?.[stage.role] : undefined;
  const storeRoleModel = stage.role ? modelLayers?.storeRoles?.[stage.role] : undefined;
  const globalRoleModel = stage.role ? modelLayers?.globalRoles?.[stage.role] : undefined;
  const projectRoleEffort = stage.role ? effortLayers?.projectRoles?.[stage.role] : undefined;
  const storeRoleEffort = stage.role ? effortLayers?.storeRoles?.[stage.role] : undefined;
  const globalRoleEffort = stage.role ? effortLayers?.globalRoles?.[stage.role] : undefined;

  const runtimeOverride = stageOverrides?.runtime;
  let runtime: AgentRuntime;
  let runtimeSource: RuntimeSource;
  if (runtimeOverride) {
    runtime = runtimeOverride.value;
    runtimeSource = `stage-override-${runtimeOverride.scope}` as RuntimeSource;
  } else if (stage.runtime !== undefined) {
    runtime = stage.runtime;
    runtimeSource = 'stage';
  } else if (roleDefault?.runtime !== undefined) {
    runtime = roleDefault.runtime;
    runtimeSource = 'agent';
  } else if (hasRuntimeCapability(runtimeContext.host.runtime, 'canDispatch')) {
    runtime = runtimeContext.host.runtime;
    runtimeSource = 'host';
  } else {
    runtime = 'claude';
    runtimeSource = 'legacy-default';
  }

  let model: string | undefined;
  let modelSource: ModelSource;
  if (stageOverrides?.model !== undefined) {
    model = stageOverrides.model.value;
    modelSource = `stage-override-${stageOverrides.model.scope}` as ModelSource;
  } else if (stage.model !== undefined) {
    model = stage.model;
    modelSource = 'stage';
  } else if (roleDefault?.model !== undefined) {
    model = roleDefault.model;
    modelSource = 'agent';
  } else if (projectRoleModel !== undefined) {
    model = projectRoleModel;
    modelSource = 'project-role';
  } else if (modelLayers?.projectDefault !== undefined) {
    model = modelLayers.projectDefault;
    modelSource = 'project-default';
  } else if (storeRoleModel !== undefined) {
    model = storeRoleModel;
    modelSource = 'store-role';
  } else if (modelLayers?.storeDefault !== undefined) {
    model = modelLayers.storeDefault;
    modelSource = 'store-default';
  } else if (globalRoleModel !== undefined) {
    model = globalRoleModel;
    modelSource = 'global-role';
  } else if (modelLayers?.globalDefault !== undefined) {
    model = modelLayers.globalDefault;
    modelSource = 'global-default';
  } else {
    model = undefined;
    modelSource = 'default';
  }

  let effort: LeafEffort | undefined;
  let effortSource: EffortSource;
  if (stageOverrides?.effort !== undefined) {
    effort = stageOverrides.effort.value;
    effortSource = `stage-override-${stageOverrides.effort.scope}` as EffortSource;
  } else if (stage.effort !== undefined) {
    effort = stage.effort;
    effortSource = 'stage';
  } else if (roleDefault?.effort !== undefined) {
    effort = roleDefault.effort;
    effortSource = 'agent';
  } else if (projectRoleEffort !== undefined) {
    effort = projectRoleEffort;
    effortSource = 'project-role';
  } else if (effortLayers?.projectDefault !== undefined) {
    effort = effortLayers.projectDefault;
    effortSource = 'project-default';
  } else if (storeRoleEffort !== undefined) {
    effort = storeRoleEffort;
    effortSource = 'store-role';
  } else if (effortLayers?.storeDefault !== undefined) {
    effort = effortLayers.storeDefault;
    effortSource = 'store-default';
  } else if (globalRoleEffort !== undefined) {
    effort = globalRoleEffort;
    effortSource = 'global-role';
  } else if (effortLayers?.globalDefault !== undefined) {
    effort = effortLayers.globalDefault;
    effortSource = 'global-default';
  } else {
    effort = undefined;
    effortSource = 'default';
  }

  if (stageHasOverride) {
    return {
      runtime,
      sessionReuse: stage.sessionReuse ?? roleDefault?.sessionReuse,
      sandbox: stage.sandbox ?? roleDefault?.sandbox,
      model,
      effort,
      source: 'stage',
      modelSource,
      effortSource,
      runtimeSource,
    };
  }

  if (roleDefault) {
    return {
      ...roleDefault,
      runtime,
      model,
      effort,
      source: 'agent',
      modelSource,
      effortSource,
      runtimeSource,
    };
  }

  return {
    runtime,
    model,
    effort,
    source: 'default',
    modelSource,
    effortSource,
    runtimeSource,
  };
}

/**
 * Built-in handoff defaults, applied when neither the stage nor the pipeline
 * configures a field. `stallLimit` has no per-role loosening: hard problems slow
 * progress, they don't zero it (eliminating a hypothesis counts as progress).
 */
export const DEFAULT_HANDOFF_CONFIG = {
  threshold: 0.5,
  maxRelays: 3,
  stallLimit: 2,
} as const;

/**
 * Built-in handoff-threshold default for a `codex` runtime. Codex hosts run
 * a larger window (~250k) with low-loss native auto-compact, so a worker can
 * productively use far more of its window before handing off than Claude's
 * 0.5 default allows — handing off at 0.5 retires a worker that could have
 * kept working through another compaction. Still overridable by any
 * project/store/global `handoff.threshold` or bound scheme.
 */
export const DEFAULT_CODEX_HANDOFF_THRESHOLD = 0.85;

/**
 * Built-in handoff-threshold default for a runtime: Codex gets
 * {@link DEFAULT_CODEX_HANDOFF_THRESHOLD}; every other runtime (including the
 * claude/unknown fallback) gets {@link DEFAULT_HANDOFF_CONFIG.threshold}.
 * This is the floor of threshold resolution — the value used only when no
 * config layer, preset, or bound scheme supplies one.
 */
export function defaultHandoffThresholdForRuntime(
  runtime: string | undefined
): number {
  return runtime === 'codex'
    ? DEFAULT_CODEX_HANDOFF_THRESHOLD
    : DEFAULT_HANDOFF_CONFIG.threshold;
}

export interface ResolvedStageHandoffConfig {
  threshold: ThresholdValue;
  maxRelays: number;
  stallLimit: number;
  source:
    | 'stage-override-project'
    | 'stage-override-store'
    | 'stage-override-global'
    | 'stage'
    | 'project-scheme-role'
    | 'project-scheme'
    | 'store-scheme-role'
    | 'store-scheme'
    | 'global-scheme-role'
    | 'global-scheme'
    | 'role'
    | 'pipeline'
    | 'project-role'
    | 'project-config'
    | 'store-role'
    | 'store-config'
    | 'global-role'
    | 'global-config'
    | 'preset'
    | 'default';
  binding?: ThresholdBindingMetadata;
  diagnostics?: ThresholdDiagnostic[];
}

export interface ThresholdResolutionContext {
  bindings?: ThresholdBindingLayers;
  schemes?: ThresholdSchemeSnapshot;
  /** Role-wide effective runtimes used by reuse resolution. */
  runtimes?: Partial<Record<StageRole, AgentRuntime>>;
  /** Final effective runtime for the one stage whose handoff is being resolved. */
  stageRuntime?: AgentRuntime;
  /** Host detected once for this execution/inspection plan. */
  host?: DetectedHostRuntime;
}

/**
 * Project/store/global config-layer threshold values, slotted below pipeline
 * declarations and above the model-preset layer. `projectRoles`/`storeRoles`/
 * `globalRoles` carry the per-role `handoff.roles.<role>` overrides at each
 * scope — a role-specific value wins over that scope's scalar threshold. The
 * store layer sits between project and global, and applies only when the
 * project inherits from a store (see `store-config-inheritance`).
 */
export interface HandoffConfigLayers {
  projectThreshold?: ThresholdValue;
  storeThreshold?: ThresholdValue;
  globalThreshold?: ThresholdValue;
  projectRoles?: Partial<Record<StageRole, ThresholdValue>>;
  storeRoles?: Partial<Record<StageRole, ThresholdValue>>;
  globalRoles?: Partial<Record<StageRole, ThresholdValue>>;
}

/**
 * Resolve the effective handoff config for a stage.
 *
 * Precedence (field-wise):
 * 1. Configured `pipelines.<pipeline>.handoff.<stage>` instance.
 * 2. Stage-level YAML `handoff`.
 * 3. Bound threshold scheme: the effective runtime row at project, store, then
 *    global scope; then the `default` row at project, store, then global scope.
 *    Within the selected scheme, a stage-role override wins over its scalar.
 * 4. Pipeline `handoff.roles[<stage role>]` — threshold ONLY.
 * 5. Pipeline-level `handoff`.
 * 6. Project config `handoff.roles[<stage role>]` — threshold ONLY.
 * 7. Project config `handoff.threshold` — threshold ONLY.
 * 8. Store config `handoff.roles[<stage role>]` — threshold ONLY.
 * 9. Store config `handoff.threshold` — threshold ONLY.
 * 10. Global config `handoff.roles[<stage role>]` — threshold ONLY.
 * 11. Global config `handoff.threshold` — threshold ONLY.
 * 12. Model preset (the suggested `handoffThreshold` of the preset matching the
 *    stage's resolved model, per `resolveStageRuntimeConfig`) — threshold ONLY.
 * 13. Built-in defaults.
 *
 * `source` names the layer that supplied the resolved THRESHOLD specifically
 * (provenance-first, in this same precedence order), so callers can report
 * where the effective threshold came from — not merely a layer that touched
 * the handoff block at all. Only when no layer supplies a threshold (every
 * field falls through to the built-in default) does `source` fall back to
 * whichever layer configured `maxRelays`/`stallLimit`. The config layers
 * (`configLayers`) are passed in rather than read here — this function stays
 * pure/synchronous; callers resolve the values via
 * `resolveHandoffThresholdLayers()` (src/core/effective-config.ts) using the
 * pipeline's project root. A stage with no resolvable model, or whose model
 * has no preset (or no suggested handoff threshold), skips the preset layer.
 */
export function resolveStageHandoffConfig(
  stage: Stage,
  pipeline: PipelineYaml,
  configLayers?: HandoffConfigLayers,
  modelLayers?: ModelConfigLayers,
  stageOverrides?: StageConfigOverrides,
  thresholdContext?: ThresholdResolutionContext
): ResolvedStageHandoffConfig {
  const stageHandoff = stage.handoff;
  const pipelineHandoff = pipeline.handoff;
  const roleThreshold = stage.role ? pipelineHandoff?.roles?.[stage.role] : undefined;
  const projectRoleThreshold = stage.role ? configLayers?.projectRoles?.[stage.role] : undefined;
  const storeRoleThreshold = stage.role ? configLayers?.storeRoles?.[stage.role] : undefined;
  const globalRoleThreshold = stage.role ? configLayers?.globalRoles?.[stage.role] : undefined;
  // The preset keys off the stage's RESOLVED model, so a per-stage model
  // override must feed the preset lookup too (pass the full override set).
  const resolvedRuntime = resolveStageRuntimeConfig(
    stage,
    pipeline,
    modelLayers,
    stageOverrides,
    { host: thresholdContext?.host ?? UNKNOWN_HOST_RUNTIME }
  );
  const bindingRuntime = thresholdContext?.stageRuntime ?? resolvedRuntime.runtime;
  const presetThreshold = resolveModelPreset(resolvedRuntime.model)?.handoffThreshold;

  // A `pipelines.<name>.handoff.<stage>` instance tops the threshold chain.
  const overrideThreshold = stageOverrides?.handoff?.value;

  const resolvedThreshold = resolveThreshold({
    family: 'handoff',
    role: stage.role,
    runtime: bindingRuntime,
    pipeline: pipeline.name,
    stage: stage.id,
    bindings: thresholdContext?.bindings,
    schemes: thresholdContext?.schemes,
    nonBinding: {
      configuredStage: {
        value: overrideThreshold,
        source: stageOverrides?.handoff
          ? `stage-override-${stageOverrides.handoff.scope}`
          : 'stage-override-project',
      },
      stage: { value: stageHandoff?.threshold, source: 'stage' },
      pipelineRole: { value: roleThreshold, source: 'role' },
      pipeline: { value: pipelineHandoff?.threshold, source: 'pipeline' },
      projectRole: { value: projectRoleThreshold, source: 'project-role' },
      project: { value: configLayers?.projectThreshold, source: 'project-config' },
      storeRole: { value: storeRoleThreshold, source: 'store-role' },
      store: { value: configLayers?.storeThreshold, source: 'store-config' },
      globalRole: { value: globalRoleThreshold, source: 'global-role' },
      global: { value: configLayers?.globalThreshold, source: 'global-config' },
      preset: { value: presetThreshold, source: 'preset' },
      default: { value: defaultHandoffThresholdForRuntime(bindingRuntime), source: 'default' },
    },
  });
  const threshold = resolvedThreshold.threshold;
  const maxRelays =
    stageHandoff?.maxRelays ?? pipelineHandoff?.maxRelays ?? DEFAULT_HANDOFF_CONFIG.maxRelays;
  const stallLimit =
    stageHandoff?.stallLimit ?? pipelineHandoff?.stallLimit ?? DEFAULT_HANDOFF_CONFIG.stallLimit;

  const hasFields = (h: HandoffConfig | undefined): boolean =>
    h !== undefined &&
    (h.threshold !== undefined ||
      h.maxRelays !== undefined ||
      h.stallLimit !== undefined ||
      h.roles !== undefined);

  // `source` names the layer that supplied the resolved THRESHOLD, in the
  // same precedence order the threshold itself resolves in — not merely a
  // layer that touched the handoff block at all. Without this, a pipeline
  // block that sets `roles.reviewer` alone would tag an unrelated
  // implementer stage's preset-sourced threshold as 'pipeline' (hasFields
  // sees `roles` and stops there), misreporting a form-changing preset
  // object as pipeline config. Only when NO layer supplies a threshold
  // (every field falls through to the built-in default) does source fall
  // back to whichever layer configured maxRelays/stallLimit, preserving the
  // pre-preset behavior for that edge.
  let source = resolvedThreshold.source as ResolvedStageHandoffConfig['source'];
  if (source === 'default') {
    if (hasFields(stageHandoff)) source = 'stage';
    else if (hasFields(pipelineHandoff)) source = 'pipeline';
  }

  return {
    threshold,
    maxRelays,
    stallLimit,
    source,
    ...(resolvedThreshold.binding ? { binding: resolvedThreshold.binding } : {}),
    ...(resolvedThreshold.diagnostics.length > 0
      ? { diagnostics: resolvedThreshold.diagnostics }
      : {}),
  };
}

/**
 * Built-in reuse defaults, applied when the pipeline configures no `reuse`
 * block (or leaves a field unset). Both roles default to `auto`; the threshold
 * is stricter than handoff's — it answers "should this worker take on a whole
 * new change", not "should it keep going on the task in hand".
 */
export const DEFAULT_REUSE_CONFIG = {
  planner: 'auto',
  implementer: 'auto',
  threshold: 0.25,
} as const;

export interface ResolvedReuseConfig {
  planner: ReuseMode;
  implementer: ReuseMode;
  /** Pipeline-level resolved reuse threshold. No preset layer — not model-specific. */
  threshold: ThresholdValue;
  /** Per-role resolved reuse thresholds. */
  roles: { planner: ThresholdValue; implementer: ThresholdValue };
  sources?: {
    threshold: string;
    roles: { planner: string; implementer: string };
  };
  bindings?: {
    threshold?: ThresholdBindingMetadata;
    roles?: Partial<Record<'planner' | 'implementer', ThresholdBindingMetadata>>;
  };
  diagnostics?: ThresholdDiagnostic[];
}

/**
 * Resolve the effective reuse config for a pipeline.
 *
 * Precedence (field-wise):
 *  - per-role threshold: bound threshold scheme for the role's effective
 *    runtime row at project/store/global, then the `default` row at
 *    project/store/global (scheme role override > scheme scalar) >
 *    `reuse.roles[<role>]` > `reuse.threshold` > model preset (the suggested
 *    `reuseThreshold` of the preset matching that role's `agents[<role>]`
 *    model, when one is configured) > built-in default.
 *  - mode: `reuse[<role>]` > built-in default.
 *  - top-level threshold: bound threshold scheme from only the `default` row
 *    at project/store/global (scheme scalar only) > `reuse.threshold` >
 *    built-in default. Runtime rows and the preset layer do not apply because
 *    there is no single pipeline-wide runtime/model.
 *
 * Reuse has no stage dimension, so this is pipeline-scoped (unlike the
 * stage-scoped resolveStageHandoffConfig). A role with no configured model, or
 * whose model has no preset (or no suggested reuse threshold), skips the
 * preset layer.
 */
export function resolvePipelineReuseConfig(
  pipeline: PipelineYaml,
  thresholdContext?: ThresholdResolutionContext
): ResolvedReuseConfig {
  const reuse = pipeline.reuse;
  const topLevel = resolveThreshold({
    family: 'reuse',
    bindingRows: 'default-only',
    bindings: thresholdContext?.bindings,
    schemes: thresholdContext?.schemes,
    nonBinding: {
      pipeline: { value: reuse?.threshold, source: 'pipeline' },
      default: { value: DEFAULT_REUSE_CONFIG.threshold, source: 'default' },
    },
  });
  const threshold = topLevel.threshold;

  const roleThreshold = (role: 'planner' | 'implementer') => {
    const roleModel = normalizeAgentRuntimeConfig(pipeline.agents?.[role])?.model;
    const presetThreshold = resolveModelPreset(roleModel)?.reuseThreshold;
    const declaredRuntime = normalizeAgentRuntimeConfig(pipeline.agents?.[role])?.runtime;
    const hostRuntime = thresholdContext?.host?.runtime;
    const fallbackRuntime = hasRuntimeCapability(hostRuntime, 'canDispatch')
      ? hostRuntime
      : 'claude';
    return resolveThreshold({
      family: 'reuse',
      role,
      runtime: thresholdContext?.runtimes?.[role] ?? declaredRuntime ?? fallbackRuntime,
      bindings: thresholdContext?.bindings,
      schemes: thresholdContext?.schemes,
      nonBinding: {
        pipelineRole: { value: reuse?.roles?.[role], source: 'role' },
        pipeline: { value: reuse?.threshold, source: 'pipeline' },
        preset: { value: presetThreshold, source: 'preset' },
        default: { value: DEFAULT_REUSE_CONFIG.threshold, source: 'default' },
      },
    });
  };

  const planner = roleThreshold('planner');
  const implementer = roleThreshold('implementer');
  const diagnostics = [
    ...topLevel.diagnostics,
    ...planner.diagnostics,
    ...implementer.diagnostics,
  ].filter(
    (diagnostic, index, all) =>
      all.findIndex((candidate) => candidate.message === diagnostic.message) === index
  );
  const hasResolutionMetadata =
    topLevel.binding !== undefined ||
    planner.binding !== undefined ||
    implementer.binding !== undefined ||
    diagnostics.length > 0;

  return {
    planner: reuse?.planner ?? DEFAULT_REUSE_CONFIG.planner,
    implementer: reuse?.implementer ?? DEFAULT_REUSE_CONFIG.implementer,
    threshold,
    roles: {
      planner: planner.threshold,
      implementer: implementer.threshold,
    },
    ...(hasResolutionMetadata
      ? {
          sources: {
            threshold: topLevel.source,
            roles: { planner: planner.source, implementer: implementer.source },
          },
          bindings: {
            ...(topLevel.binding ? { threshold: topLevel.binding } : {}),
            roles: {
              ...(planner.binding ? { planner: planner.binding } : {}),
              ...(implementer.binding ? { implementer: implementer.binding } : {}),
            },
          },
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        }
      : {}),
  };
}

// Runtime state types (not Zod - internal only)

// Completion tracking set of stage IDs.
export type CompletedSet = Set<string>;

// Return type for blocked query: stage id -> unmet dependency ids.
export interface BlockedStages {
  [stageId: string]: string[];
}
