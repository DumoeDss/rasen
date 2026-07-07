import { z } from 'zod';

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
 * should dispatch the work through a Codex app-server thread and record the
 * resulting threadId in run-state for direct resume.
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
 * A context-handoff threshold: a fraction of the context window in (0, 1] at or
 * above which an agent should hand off before compaction degrades it.
 */
const HandoffThresholdSchema = z
  .number()
  .gt(0, { error: 'threshold must be in (0, 1]' })
  .lte(1, { error: 'threshold must be in (0, 1]' });

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
 * A reuse threshold: the fraction of context headroom in (0, 1] a worker must
 * have before it may take on a whole new child change. Numerically identical to
 * HandoffThresholdSchema's rule, kept separate so its validation message
 * vocabulary ("reuse threshold") stays self-describing.
 */
const ReuseThresholdSchema = z
  .number()
  .gt(0, { error: 'reuse threshold must be in (0, 1]' })
  .lte(1, { error: 'reuse threshold must be in (0, 1]' });

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
 * Currently only the 'review-cycle' kind is supported.
 */
export const StageLoopSchema = z.object({
  kind: z.literal('review-cycle'),
  maxRounds: z.number().int().positive({ error: 'maxRounds must be a positive integer' }).default(3),
});

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
  threshold: number;
  maxRelays: number;
  stallLimit: number;
  source: 'stage' | 'role' | 'pipeline' | 'default';
}

/**
 * Resolve the effective handoff config for a stage.
 *
 * Precedence (field-wise):
 * 1. Stage-level `handoff`.
 * 2. Pipeline `handoff.roles[<stage role>]` — threshold ONLY.
 * 3. Pipeline-level `handoff`.
 * 4. Built-in defaults.
 *
 * `source` names the highest-precedence layer that contributed anything, so
 * callers can report where the effective config came from.
 */
export function resolveStageHandoffConfig(
  stage: Stage,
  pipeline: PipelineYaml
): ResolvedStageHandoffConfig {
  const stageHandoff = stage.handoff;
  const pipelineHandoff = pipeline.handoff;
  const roleThreshold = stage.role ? pipelineHandoff?.roles?.[stage.role] : undefined;

  const threshold =
    stageHandoff?.threshold ??
    roleThreshold ??
    pipelineHandoff?.threshold ??
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

  const source: ResolvedStageHandoffConfig['source'] = hasFields(stageHandoff)
    ? 'stage'
    : roleThreshold !== undefined
      ? 'role'
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
  /** Pipeline-level resolved reuse threshold. */
  threshold: number;
  /** Per-role resolved reuse thresholds. */
  roles: { planner: number; implementer: number };
}

/**
 * Resolve the effective reuse config for a pipeline.
 *
 * Precedence (field-wise):
 *  - per-role threshold: `reuse.roles[<role>]` > `reuse.threshold` > built-in default.
 *  - mode: `reuse[<role>]` > built-in default.
 *  - top-level threshold: `reuse.threshold` > built-in default.
 *
 * Reuse has no stage dimension, so this is pipeline-scoped (unlike the
 * stage-scoped resolveStageHandoffConfig).
 */
export function resolvePipelineReuseConfig(pipeline: PipelineYaml): ResolvedReuseConfig {
  const reuse = pipeline.reuse;
  const threshold = reuse?.threshold ?? DEFAULT_REUSE_CONFIG.threshold;
  return {
    planner: reuse?.planner ?? DEFAULT_REUSE_CONFIG.planner,
    implementer: reuse?.implementer ?? DEFAULT_REUSE_CONFIG.implementer,
    threshold,
    roles: {
      planner: reuse?.roles?.planner ?? threshold,
      implementer: reuse?.roles?.implementer ?? threshold,
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
