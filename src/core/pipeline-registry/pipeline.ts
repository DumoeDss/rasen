import * as fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { PipelineYamlSchema, type PipelineYaml, type Stage } from './types.js';

export class PipelineValidationError extends Error {
  constructor(message: string, readonly code = 'pipeline_invalid') {
    super(message);
    this.name = 'PipelineValidationError';
  }
}

/**
 * Loads and validates a pipeline from a YAML file.
 */
export function loadPipeline(filePath: string): PipelineYaml {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parsePipeline(content);
}

/**
 * Parses and validates a pipeline from YAML content.
 */
export function parsePipeline(yamlContent: string): PipelineYaml {
  const parsed = parseYaml(yamlContent);

  // Validate with Zod
  const result = PipelineYamlSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new PipelineValidationError(`Invalid pipeline: ${errors}`);
  }

  const pipeline = result.data;

  // Check for duplicate stage IDs
  validateNoDuplicateIds(pipeline.stages);

  // Check that all requires references are valid
  validateRequiresReferences(pipeline.stages);

  // Check for cycles
  validateNoCycles(pipeline.stages);

  // Check parallelGroup members are mutually independent
  validateParallelGroups(pipeline.stages);

  // Check decompose stage constraints (at most one, must be the entry point)
  validateDecomposeStages(pipeline.stages);

  // Enforce the composed-pipeline quality floor (autonomy-ladder rung 2)
  validateComposedPolicyFloor(pipeline);

  return pipeline;
}

/**
 * Enforces the quality floor on a LEAD-composed pipeline (autonomy-ladder
 * rung 2: composed pipelines): when `origin: composed`, the pipeline MUST
 * contain at least one stage with `role: 'reviewer'` (verification) and at
 * least one stage with `loop.kind: 'review-cycle'` (review loop) — the LEAD
 * never composes itself an inspection-free pipeline. Scoped to the marker so
 * human-authored pipelines (no `origin`, e.g. the built-in `bug-fix`, which
 * has no review-loop stage) are entirely unaffected.
 */
function validateComposedPolicyFloor(pipeline: PipelineYaml): void {
  if (pipeline.origin !== 'composed') return;

  const hasReviewerStage = pipeline.stages.some(s => s.role === 'reviewer');
  if (!hasReviewerStage) {
    throw new PipelineValidationError(
      `Composed pipeline '${pipeline.name}' is missing the quality-floor verification stage: at least one stage must declare role: 'reviewer'`
    );
  }

  const hasReviewCycleLoop = pipeline.stages.some(s => s.loop?.kind === 'review-cycle');
  if (!hasReviewCycleLoop) {
    throw new PipelineValidationError(
      `Composed pipeline '${pipeline.name}' is missing the quality-floor review loop: at least one stage must declare loop.kind: 'review-cycle'`
    );
  }
}

/**
 * Validates the structural constraints on `decompose` stages (the registry-free
 * subset; childPipeline resolution + the recursion guard need the registry and
 * live in resolver.ts):
 *  - at most ONE decompose stage per pipeline, and
 *  - when present, it must be the pipeline's sole entry point — i.e. build-order
 *    index 0. Since the build order (Kahn's algorithm) starts from the roots,
 *    a stage is index 0 iff it is the UNIQUE root (the only stage with no
 *    `requires`). This is checked here without building the graph to avoid a
 *    circular import.
 */
function validateDecomposeStages(stages: Stage[]): void {
  const decomposeStages = stages.filter(s => s.kind === 'decompose');
  if (decomposeStages.length > 1) {
    const names = decomposeStages.map(s => `'${s.id}'`).join(', ');
    throw new PipelineValidationError(
      `At most one decompose stage is allowed per pipeline; found ${decomposeStages.length} (${names})`
    );
  }
  if (decomposeStages.length === 0) return;

  const decompose = decomposeStages[0];
  const roots = stages.filter(s => s.requires.length === 0);
  const isUniqueRoot = roots.length === 1 && roots[0].id === decompose.id;
  if (!isUniqueRoot) {
    throw new PipelineValidationError(
      `Decompose stage '${decompose.id}' must be the first stage (build-order index 0): ` +
        `it must be the pipeline's sole entry point with no \`requires\`, and every other ` +
        `stage must depend (directly or transitively) on it`
    );
  }
}

/**
 * Validates that there are no duplicate stage IDs.
 */
function validateNoDuplicateIds(stages: Stage[]): void {
  const seen = new Set<string>();
  for (const stage of stages) {
    if (seen.has(stage.id)) {
      throw new PipelineValidationError(`Duplicate stage ID: ${stage.id}`);
    }
    seen.add(stage.id);
  }
}

/**
 * Validates that all `requires` references point to valid stage IDs.
 */
function validateRequiresReferences(stages: Stage[]): void {
  const validIds = new Set(stages.map(s => s.id));

  for (const stage of stages) {
    for (const req of stage.requires) {
      if (!validIds.has(req)) {
        throw new PipelineValidationError(
          `Invalid dependency reference in stage '${stage.id}': '${req}' does not exist`
        );
      }
    }
  }
}

/**
 * Validates that there are no cyclic dependencies.
 * Uses DFS to detect cycles and reports the full cycle path.
 */
function validateNoCycles(stages: Stage[]): void {
  const stageMap = new Map(stages.map(s => [s.id, s]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const parent = new Map<string, string>();

  function dfs(id: string): string | null {
    visited.add(id);
    inStack.add(id);

    const stage = stageMap.get(id);
    if (!stage) return null;

    for (const dep of stage.requires) {
      if (!visited.has(dep)) {
        parent.set(dep, id);
        const cycle = dfs(dep);
        if (cycle) return cycle;
      } else if (inStack.has(dep)) {
        // Found a cycle - reconstruct the path
        const cyclePath = [dep];
        let current = id;
        while (current !== dep) {
          cyclePath.unshift(current);
          current = parent.get(current)!;
        }
        cyclePath.unshift(dep);
        return cyclePath.join(' → ');
      }
    }

    inStack.delete(id);
    return null;
  }

  for (const stage of stages) {
    if (!visited.has(stage.id)) {
      const cycle = dfs(stage.id);
      if (cycle) {
        throw new PipelineValidationError(`Cyclic dependency detected: ${cycle}`);
      }
    }
  }
}

/**
 * Validates that no stage in a parallelGroup requires another stage in the
 * SAME parallelGroup. Members of a parallel group must be mutually independent
 * so they can run concurrently.
 */
function validateParallelGroups(stages: Stage[]): void {
  // Map each stage id to its parallelGroup (if any)
  const groupOf = new Map<string, string>();
  for (const stage of stages) {
    if (stage.parallelGroup) {
      groupOf.set(stage.id, stage.parallelGroup);
    }
  }

  for (const stage of stages) {
    const group = stage.parallelGroup;
    if (!group) continue;

    for (const req of stage.requires) {
      if (groupOf.get(req) === group) {
        throw new PipelineValidationError(
          `Stages in parallelGroup '${group}' must be mutually independent: ` +
            `stage '${stage.id}' requires '${req}' in the same group`
        );
      }
    }
  }
}

/**
 * Validates that every stage's `skill` exists in the provided set of known
 * skill names. Kept as a SEPARATE function that accepts an injected set so it
 * is unit-testable without the skill registry; the CLI/validate layer wires
 * the full catalog separately from the active profile's effective selection.
 *
 * @throws PipelineValidationError if any stage references an unknown skill.
 */
export function validatePipelineSkills(
  pipeline: PipelineYaml,
  knownSkillNames: Set<string>,
  enabledSkillNames: Set<string> = knownSkillNames
): void {
  for (const stage of pipeline.stages) {
    // decompose stages are LEAD-interpreted fan-out points, not leaf skill
    // calls, so they carry no `skill` to validate.
    if (stage.kind === 'decompose') continue;
    if (!stage.skill || !knownSkillNames.has(stage.skill)) {
      throw new PipelineValidationError(
        `Stage '${stage.id}' references unknown skill: '${stage.skill ?? '(missing)'}'`,
        'pipeline_skill_unknown'
      );
    }
    if (!enabledSkillNames.has(stage.skill)) {
      throw new PipelineValidationError(
        `Stage '${stage.id}' references known but disabled skill: '${stage.skill}'`,
        'pipeline_skill_disabled'
      );
    }
  }
}
