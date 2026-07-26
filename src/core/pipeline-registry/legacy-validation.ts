import type { PipelineYaml, Stage } from './types.js';

export type LegacyPipelineDiagnosticCode =
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REFERENCE'
  | 'GRAPH_CYCLE'
  | 'PORT_MISMATCH'
  | 'INVALID_SOURCE';

export interface LegacyPipelineDiagnostic {
  readonly code: LegacyPipelineDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly related?: readonly Readonly<{ path: string; message: string }>[];
}

function issue(
  code: LegacyPipelineDiagnosticCode,
  path: string,
  message: string,
  related?: readonly Readonly<{ path: string; message: string }>[]
): LegacyPipelineDiagnostic {
  return { code, path, message, ...(related ? { related } : {}) };
}

function duplicateIdentityIssue(stages: readonly Stage[]): LegacyPipelineDiagnostic | undefined {
  const firstIndex = new Map<string, number>();
  for (const [index, stage] of stages.entries()) {
    const previous = firstIndex.get(stage.id);
    if (previous !== undefined) {
      return issue(
        'DUPLICATE_ID',
        `/stages/${index}/id`,
        `Duplicate stage ID: ${stage.id}`,
        [{ path: `/stages/${previous}/id`, message: `Stage ID '${stage.id}' was first declared here.` }]
      );
    }
    firstIndex.set(stage.id, index);
  }
  return undefined;
}

function missingReferenceIssue(stages: readonly Stage[]): LegacyPipelineDiagnostic | undefined {
  const validIds = new Set(stages.map((stage) => stage.id));
  for (const [stageIndex, stage] of stages.entries()) {
    for (const [requireIndex, required] of stage.requires.entries()) {
      if (!validIds.has(required)) {
        return issue(
          'UNKNOWN_REFERENCE',
          `/stages/${stageIndex}/requires/${requireIndex}`,
          `Invalid dependency reference in stage '${stage.id}': '${required}' does not exist`
        );
      }
    }
  }
  return undefined;
}

function cycleIssue(stages: readonly Stage[]): LegacyPipelineDiagnostic | undefined {
  const stageMap = new Map(stages.map((stage, index) => [stage.id, { stage, index }]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  function visit(id: string): LegacyPipelineDiagnostic | undefined {
    visited.add(id);
    inStack.add(id);
    stack.push(id);
    const current = stageMap.get(id);
    if (!current) {
      stack.pop();
      inStack.delete(id);
      return undefined;
    }

    for (const [requireIndex, dependency] of current.stage.requires.entries()) {
      if (!visited.has(dependency)) {
        const nested = visit(dependency);
        if (nested) return nested;
      } else if (inStack.has(dependency)) {
        const cycleStart = stack.indexOf(dependency);
        const cycle = [...stack.slice(cycleStart), dependency];
        return issue(
          'GRAPH_CYCLE',
          `/stages/${current.index}/requires/${requireIndex}`,
          `Cyclic dependency detected: ${cycle.join(' → ')}`
        );
      }
    }

    stack.pop();
    inStack.delete(id);
    return undefined;
  }

  for (const stage of stages) {
    if (visited.has(stage.id)) continue;
    const found = visit(stage.id);
    if (found) return found;
  }
  return undefined;
}

function parallelGroupIssue(stages: readonly Stage[]): LegacyPipelineDiagnostic | undefined {
  const groupById = new Map<string, string>();
  for (const stage of stages) {
    if (stage.parallelGroup) groupById.set(stage.id, stage.parallelGroup);
  }
  for (const [stageIndex, stage] of stages.entries()) {
    if (!stage.parallelGroup) continue;
    for (const [requireIndex, required] of stage.requires.entries()) {
      if (groupById.get(required) === stage.parallelGroup) {
        return issue(
          'PORT_MISMATCH',
          `/stages/${stageIndex}/requires/${requireIndex}`,
          `Stages in parallelGroup '${stage.parallelGroup}' must be mutually independent: stage '${stage.id}' requires '${required}' in the same group`
        );
      }
    }
  }
  return undefined;
}

function decomposeIssue(stages: readonly Stage[]): LegacyPipelineDiagnostic | undefined {
  const decomposes = stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => stage.kind === 'decompose');
  if (decomposes.length > 1) {
    const names = decomposes.map(({ stage }) => `'${stage.id}'`).join(', ');
    return issue(
      'INVALID_SOURCE',
      `/stages/${decomposes[1]!.index}/kind`,
      `At most one decompose stage is allowed per pipeline; found ${decomposes.length} (${names})`
    );
  }
  if (decomposes.length === 0) return undefined;

  const [{ stage: decompose, index }] = decomposes;
  const roots = stages.filter((stage) => stage.requires.length === 0);
  if (roots.length === 1 && roots[0]!.id === decompose.id) return undefined;
  return issue(
    'INVALID_SOURCE',
    `/stages/${index}/kind`,
    `Decompose stage '${decompose.id}' must be the first stage (build-order index 0): it must be the pipeline's sole entry point with no \`requires\`, and every other stage must depend (directly or transitively) on it`
  );
}

function qualityFloorIssue(pipeline: PipelineYaml): LegacyPipelineDiagnostic | undefined {
  if (pipeline.origin !== 'composed') return undefined;
  if (!pipeline.stages.some((stage) => stage.role === 'reviewer')) {
    return issue(
      'INVALID_SOURCE',
      '/origin',
      `Pipeline '${pipeline.name}' (origin: ${pipeline.origin}) is missing the quality-floor verification stage: at least one stage must declare role: 'reviewer'`
    );
  }
  if (!pipeline.stages.some((stage) => stage.loop?.kind === 'review-cycle')) {
    return issue(
      'INVALID_SOURCE',
      '/origin',
      `Pipeline '${pipeline.name}' (origin: ${pipeline.origin}) is missing the quality-floor review loop: at least one stage must declare loop.kind: 'review-cycle'`
    );
  }
  return undefined;
}

/**
 * The authoritative registry-free v1 semantic validator. It is intentionally
 * pure so Definition preparation, the legacy adapter, draft validation, save,
 * export, and registry projections can consume one result.
 */
export function validateLegacyPipelineDefinition(
  pipeline: PipelineYaml
): readonly LegacyPipelineDiagnostic[] {
  const checks = [
    duplicateIdentityIssue(pipeline.stages),
    missingReferenceIssue(pipeline.stages),
    cycleIssue(pipeline.stages),
    parallelGroupIssue(pipeline.stages),
    decomposeIssue(pipeline.stages),
    qualityFloorIssue(pipeline),
  ];
  return checks.filter(
    (item): item is LegacyPipelineDiagnostic => item !== undefined
  );
}
