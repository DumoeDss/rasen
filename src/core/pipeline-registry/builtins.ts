/**
 * Package pipelines whose authored source is part of the Change-level ECP v2
 * product contract. Keep this list explicit: directory discovery also sees
 * compatibility-only entry pipelines such as auto-decompose.
 */
export const CHANGE_LEVEL_BUILTIN_PIPELINES = [
  'bug-fix',
  'small-feature',
  'full-feature',
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
] as const;

export type ChangeLevelBuiltinPipeline =
  (typeof CHANGE_LEVEL_BUILTIN_PIPELINES)[number];

/**
 * Package manifests intentionally retained as authored v1 compatibility
 * fixtures. These are not Change-level v2 defaults and must not grow silently.
 */
export const PIPELINE_V1_COMPATIBILITY_FIXTURES = [
  'auto-decompose',
] as const;

export type PipelineV1CompatibilityFixture =
  (typeof PIPELINE_V1_COMPATIBILITY_FIXTURES)[number];

export const PIPELINE_V1_COMPATIBILITY_BOUNDARIES = {
  'auto-decompose': 'issue-dispatch-0.3.0',
} as const satisfies Record<PipelineV1CompatibilityFixture, string>;

export type PipelineCompatibilityBoundary =
  (typeof PIPELINE_V1_COMPATIBILITY_BOUNDARIES)[PipelineV1CompatibilityFixture];

export function pipelineV1CompatibilityBoundary(
  name: string
): PipelineCompatibilityBoundary | undefined {
  return Object.prototype.hasOwnProperty.call(
    PIPELINE_V1_COMPATIBILITY_BOUNDARIES,
    name
  )
    ? PIPELINE_V1_COMPATIBILITY_BOUNDARIES[
        name as PipelineV1CompatibilityFixture
      ]
    : undefined;
}
