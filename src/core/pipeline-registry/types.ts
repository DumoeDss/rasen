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
 * A single stage in an orchestration pipeline.
 */
export const StageSchema = z.object({
  id: z.string().min(1, { error: 'Stage ID is required' }),
  skill: z.string().min(1, { error: 'skill field is required' }),
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
