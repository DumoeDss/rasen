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
  stages: z.array(StageSchema).min(1, { error: 'At least one stage required' }),
});

// Derived TypeScript types
export type StageRole = z.infer<typeof StageRoleSchema>;
export type StageLoop = z.infer<typeof StageLoopSchema>;
export type StageKind = z.infer<typeof StageKindSchema>;
export type VerifyPolicy = z.infer<typeof VerifyPolicySchema>;
export type Stage = z.infer<typeof StageSchema>;
export type PipelineYaml = z.infer<typeof PipelineYamlSchema>;

// Runtime state types (not Zod - internal only)

// Completion tracking set of stage IDs.
export type CompletedSet = Set<string>;

// Return type for blocked query: stage id -> unmet dependency ids.
export interface BlockedStages {
  [stageId: string]: string[];
}
