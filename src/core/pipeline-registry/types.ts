import { z } from 'zod';
import { resolveModelPreset, type ThresholdValue } from '../model-presets.js';

export type { ThresholdValue };

/**
 * The role a stage plays in an orchestration pipeline.
 */
export const StageRoleSchema = z.enum([
  'planner',
  'implementer',
  'reviewer',
  'fixer',
  'shipper',
]);
export type StageRole = z.infer<typeof StageRoleSchema>;

/**
 * The agent runtime used to execute a pipeline role or stage.
 *
 * `claude` is the existing Claude Code subagent path. `codex` means the LEAD
 * should dispatch the work as a non-interactive `codex exec` process (the
 * `src/core/codex` exec bridge) and record the resulting threadId in
 * run-state for direct resume.
 */
export const AgentRuntimeSchema = z.enum(['claude', 'codex']);
export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>;

export const AgentRuntimeSessionReuseSchema = z.enum([
  'none',
  'stage',
  'run-planner',
  'review-thread',
]);
export type AgentRuntimeSessionReuse = z.infer<typeof AgentRuntimeSessionReuseSchema>;

export const AgentRuntimeSandboxSchema = z.enum(['read-only', 'workspace-write']);
export type AgentRuntimeSandbox = z.infer<typeof AgentRuntimeSandboxSchema>;

export const AgentRuntimeConfigSchema = z.object({
  runtime: AgentRuntimeSchema.default('claude'),
  sessionReuse: AgentRuntimeSessionReuseSchema.optional(),
  sandbox: AgentRuntimeSandboxSchema.optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
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
export function thresholdSchema(label: string) {
  return z.union([
    z.number().gt(0, { error: `${label} must be in (0, 1]` }).lte(1, {
      error: `${label} must be in (0, 1]`,
    }),
    z
      .object({
        remainingTokens: z
          .number()
          .int({ error: `${label} remainingTokens must be a positive integer` })
          .positive({ error: `${label} remainingTokens must be a positive integer` }),
      })
      .strict(),
  ]);
}

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
    // for human confirmation, `false` does not, and `'vet'` marks a gate that
    // MUST always pause — never auto-approved by `--no-gate` or an
    // `autopilot.gates: off` project default (autopilot-gate-policy).
    gate: z.union([z.boolean(), z.literal('vet')]).default(false),
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
    effort: z.string().min(1).optional(),
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
 * Full pipeline YAML structure.
 */
export const PipelineYamlSchema = z.object({
  name: z.string().min(1, { error: 'Pipeline name is required' }),
  description: z.string().optional(),
  agents: PipelineAgentRuntimeOverridesSchema.optional(),
  handoff: HandoffConfigSchema.optional(),
  reuse: ReuseConfigSchema.optional(),
  // Marks a pipeline assembled by the autopilot LEAD (autonomy-ladder rung 2:
  // composed pipelines). Absent means human-authored. The ONLY value is
  // 'composed' — the marker scopes the quality-floor guard (see
  // validateComposedPolicyFloor in pipeline.ts) to exactly the LEAD-composed
  // population, leaving human-authored pipelines (built-in or project) unaffected.
  origin: z.literal('composed').optional().describe(
    "Marks a pipeline assembled by the autopilot LEAD; absent means human-authored. When 'composed', the pipeline MUST contain a reviewer-role stage and a review-cycle loop stage (enforced at parse time)."
  ),
  stages: z.array(StageSchema).min(1, { error: 'At least one stage required' }),
});

// Derived TypeScript types
export type StageLoop = z.infer<typeof StageLoopSchema>;
export type StageKind = z.infer<typeof StageKindSchema>;
export type VerifyPolicy = z.infer<typeof VerifyPolicySchema>;
export type Stage = z.infer<typeof StageSchema>;
export type PipelineYaml = z.infer<typeof PipelineYamlSchema>;

export interface ResolvedStageRuntimeConfig extends AgentRuntimeConfig {
  source: 'stage' | 'agent' | 'default';
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
 * Precedence:
 * 1. Stage-level override (`runtime`, `model`, etc.).
 * 2. Pipeline role default (`agents.<role>`).
 * 3. Existing Claude behavior.
 */
export function resolveStageRuntimeConfig(
  stage: Stage,
  pipeline: PipelineYaml
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

  if (stageHasOverride) {
    return {
      runtime: stage.runtime ?? roleDefault?.runtime ?? 'claude',
      sessionReuse: stage.sessionReuse ?? roleDefault?.sessionReuse,
      sandbox: stage.sandbox ?? roleDefault?.sandbox,
      model: stage.model ?? roleDefault?.model,
      effort: stage.effort ?? roleDefault?.effort,
      source: 'stage',
    };
  }

  if (roleDefault) {
    return {
      ...roleDefault,
      source: 'agent',
    };
  }

  return {
    runtime: 'claude',
    source: 'default',
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

export interface ResolvedStageHandoffConfig {
  threshold: ThresholdValue;
  maxRelays: number;
  stallLimit: number;
  source:
    | 'stage'
    | 'role'
    | 'pipeline'
    | 'project-config'
    | 'global-config'
    | 'preset'
    | 'default';
}

/** Project/global config-layer threshold values, slotted below pipeline declarations and above the model-preset layer. */
export interface HandoffConfigLayers {
  projectThreshold?: ThresholdValue;
  globalThreshold?: ThresholdValue;
}

/**
 * Resolve the effective handoff config for a stage.
 *
 * Precedence (field-wise):
 * 1. Stage-level `handoff`.
 * 2. Pipeline `handoff.roles[<stage role>]` — threshold ONLY.
 * 3. Pipeline-level `handoff`.
 * 4. Project config `handoff.threshold` — threshold ONLY.
 * 5. Global config `handoff.threshold` — threshold ONLY.
 * 6. Model preset (the suggested `handoffThreshold` of the preset matching the
 *    stage's resolved model, per `resolveStageRuntimeConfig`) — threshold ONLY.
 * 7. Built-in defaults.
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
  configLayers?: HandoffConfigLayers
): ResolvedStageHandoffConfig {
  const stageHandoff = stage.handoff;
  const pipelineHandoff = pipeline.handoff;
  const roleThreshold = stage.role ? pipelineHandoff?.roles?.[stage.role] : undefined;
  const presetThreshold = resolveModelPreset(
    resolveStageRuntimeConfig(stage, pipeline).model
  )?.handoffThreshold;

  const threshold =
    stageHandoff?.threshold ??
    roleThreshold ??
    pipelineHandoff?.threshold ??
    configLayers?.projectThreshold ??
    configLayers?.globalThreshold ??
    presetThreshold ??
    DEFAULT_HANDOFF_CONFIG.threshold;
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
  const source: ResolvedStageHandoffConfig['source'] =
    stageHandoff?.threshold !== undefined
      ? 'stage'
      : roleThreshold !== undefined
        ? 'role'
        : pipelineHandoff?.threshold !== undefined
          ? 'pipeline'
          : configLayers?.projectThreshold !== undefined
            ? 'project-config'
            : configLayers?.globalThreshold !== undefined
              ? 'global-config'
              : presetThreshold !== undefined
                ? 'preset'
                : hasFields(stageHandoff)
                  ? 'stage'
                  : hasFields(pipelineHandoff)
                    ? 'pipeline'
                    : 'default';

  return { threshold, maxRelays, stallLimit, source };
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
}

/**
 * Resolve the effective reuse config for a pipeline.
 *
 * Precedence (field-wise):
 *  - per-role threshold: `reuse.roles[<role>]` > `reuse.threshold` > model
 *    preset (the suggested `reuseThreshold` of the preset matching that
 *    role's `agents[<role>]` model, when one is configured) > built-in default.
 *  - mode: `reuse[<role>]` > built-in default.
 *  - top-level threshold: `reuse.threshold` > built-in default (no preset
 *    layer — there is no single pipeline-wide model).
 *
 * Reuse has no stage dimension, so this is pipeline-scoped (unlike the
 * stage-scoped resolveStageHandoffConfig). A role with no configured model, or
 * whose model has no preset (or no suggested reuse threshold), skips the
 * preset layer.
 */
export function resolvePipelineReuseConfig(pipeline: PipelineYaml): ResolvedReuseConfig {
  const reuse = pipeline.reuse;
  const threshold = reuse?.threshold ?? DEFAULT_REUSE_CONFIG.threshold;

  const roleThreshold = (role: 'planner' | 'implementer'): ThresholdValue => {
    if (reuse?.roles?.[role] !== undefined) return reuse.roles[role];
    if (reuse?.threshold !== undefined) return reuse.threshold;
    const roleModel = normalizeAgentRuntimeConfig(pipeline.agents?.[role])?.model;
    const presetThreshold = resolveModelPreset(roleModel)?.reuseThreshold;
    return presetThreshold ?? DEFAULT_REUSE_CONFIG.threshold;
  };

  return {
    planner: reuse?.planner ?? DEFAULT_REUSE_CONFIG.planner,
    implementer: reuse?.implementer ?? DEFAULT_REUSE_CONFIG.implementer,
    threshold,
    roles: {
      planner: roleThreshold('planner'),
      implementer: roleThreshold('implementer'),
    },
  };
}

// Runtime state types (not Zod - internal only)

// Completion tracking set of stage IDs.
export type CompletedSet = Set<string>;

// Return type for blocked query: stage id -> unmet dependency ids.
export interface BlockedStages {
  [stageId: string]: string[];
}
