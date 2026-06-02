import type { Stage, PipelineYaml, CompletedSet, BlockedStages } from './types.js';
import { loadPipeline, parsePipeline } from './pipeline.js';

/**
 * Represents a pipeline stage dependency graph.
 * Provides methods for querying build order, ready stages, and completion status.
 */
export class PipelineGraph {
  private stages: Map<string, Stage>;
  private pipeline: PipelineYaml;

  private constructor(pipeline: PipelineYaml) {
    this.pipeline = pipeline;
    this.stages = new Map(pipeline.stages.map(s => [s.id, s]));
  }

  /**
   * Creates a PipelineGraph from a YAML file path.
   */
  static fromYaml(filePath: string): PipelineGraph {
    const pipeline = loadPipeline(filePath);
    return new PipelineGraph(pipeline);
  }

  /**
   * Creates a PipelineGraph from YAML content string.
   */
  static fromYamlContent(yamlContent: string): PipelineGraph {
    const pipeline = parsePipeline(yamlContent);
    return new PipelineGraph(pipeline);
  }

  /**
   * Creates a PipelineGraph from a pre-validated pipeline object.
   */
  static fromPipeline(pipeline: PipelineYaml): PipelineGraph {
    return new PipelineGraph(pipeline);
  }

  /**
   * Gets a single stage by ID.
   */
  getStage(id: string): Stage | undefined {
    return this.stages.get(id);
  }

  /**
   * Gets all stages in the graph.
   */
  getAllStages(): Stage[] {
    return Array.from(this.stages.values());
  }

  /**
   * Gets the pipeline name.
   */
  getName(): string {
    return this.pipeline.name;
  }

  /**
   * Returns the pipeline's decompose stage (the LEAD fan-out entry point), or
   * undefined when the pipeline has none. Validation guarantees at most one and
   * that it is the build-order entry point.
   */
  getDecomposeStage(): Stage | undefined {
    return this.getAllStages().find(s => s.kind === 'decompose');
  }

  /**
   * Computes the topological build order using Kahn's algorithm.
   * Returns stage IDs in the order they should be executed.
   */
  getBuildOrder(): string[] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    // Initialize all stages
    for (const stage of this.stages.values()) {
      inDegree.set(stage.id, stage.requires.length);
      dependents.set(stage.id, []);
    }

    // Build reverse adjacency (who depends on whom)
    for (const stage of this.stages.values()) {
      for (const req of stage.requires) {
        dependents.get(req)!.push(stage.id);
      }
    }

    // Start with roots (in-degree 0), sorted for determinism
    const queue = [...this.stages.keys()].filter(id => inDegree.get(id) === 0).sort();

    const result: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // Collect newly ready stages, then sort before adding
      const newlyReady: string[] = [];
      for (const dep of dependents.get(current)!) {
        const newDegree = inDegree.get(dep)! - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
          newlyReady.push(dep);
        }
      }
      queue.push(...newlyReady.sort());
    }

    return result;
  }

  /**
   * Gets stages that are ready to be executed (all dependencies completed).
   */
  getNextStages(completed: CompletedSet): string[] {
    const ready: string[] = [];

    for (const stage of this.stages.values()) {
      if (completed.has(stage.id)) {
        continue; // Already completed
      }

      const allDepsCompleted = stage.requires.every(req => completed.has(req));
      if (allDepsCompleted) {
        ready.push(stage.id);
      }
    }

    // Sort for deterministic ordering
    return ready.sort();
  }

  /**
   * Checks if all stages in the graph are completed.
   */
  isComplete(completed: CompletedSet): boolean {
    for (const stage of this.stages.values()) {
      if (!completed.has(stage.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gets blocked stages and their unmet dependencies.
   */
  getBlocked(completed: CompletedSet): BlockedStages {
    const blocked: BlockedStages = {};

    for (const stage of this.stages.values()) {
      if (completed.has(stage.id)) {
        continue; // Already completed
      }

      const unmetDeps = stage.requires.filter(req => !completed.has(req));
      if (unmetDeps.length > 0) {
        blocked[stage.id] = unmetDeps.sort();
      }
    }

    return blocked;
  }
}
