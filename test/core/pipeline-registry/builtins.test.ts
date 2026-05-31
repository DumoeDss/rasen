import { describe, it, expect } from 'vitest';
import {
  loadPipelineByName,
  listPipelines,
} from '../../../src/core/pipeline-registry/resolver.js';
import {
  validatePipelineSkills,
  parsePipeline,
} from '../../../src/core/pipeline-registry/pipeline.js';
import { PipelineGraph } from '../../../src/core/pipeline-registry/graph.js';
import { loadPipeline } from '../../../src/core/pipeline-registry/pipeline.js';
import { resolvePipelinePath } from '../../../src/core/pipeline-registry/resolver.js';
import { getSkillTemplates } from '../../../src/core/shared/skill-generation.js';

const BUILTIN_NAMES = ['full-feature', 'small-feature', 'bug-fix'] as const;

describe('pipeline-registry/built-ins', () => {
  const knownSkillNames = new Set(getSkillTemplates().map(t => t.template.name));

  it('should expose all three built-in pipelines via listPipelines', () => {
    const names = listPipelines();
    for (const name of BUILTIN_NAMES) {
      expect(names).toContain(name);
    }
  });

  for (const name of BUILTIN_NAMES) {
    describe(name, () => {
      it('should parse and pass all validators (load + reparse from disk)', () => {
        // loadPipelineByName runs parse + all structural validators
        const pipeline = loadPipelineByName(name);
        expect(pipeline.name).toBe(name);

        // Re-parse directly from disk path to confirm validators ran on the file
        const pipelinePath = resolvePipelinePath(name);
        expect(pipelinePath).not.toBeNull();
        expect(() => loadPipeline(pipelinePath!)).not.toThrow();
        expect(() => parsePipeline(JSON.stringify(pipeline))).not.toThrow();
      });

      it('should be acyclic (topo-sort covers every stage)', () => {
        const graph = PipelineGraph.fromPipeline(loadPipelineByName(name));
        const order = graph.getBuildOrder();
        expect(order).toHaveLength(graph.getAllStages().length);
        expect(new Set(order).size).toBe(order.length);
      });

      it('should reference only skills that exist in getSkillTemplates()', () => {
        const pipeline = loadPipelineByName(name);
        expect(() => validatePipelineSkills(pipeline, knownSkillNames)).not.toThrow();
      });

      it('every requires reference must exist as a stage (re-derived check)', () => {
        const pipeline = loadPipelineByName(name);
        const ids = new Set(pipeline.stages.map(s => s.id));
        for (const stage of pipeline.stages) {
          for (const req of stage.requires) {
            expect(ids.has(req)).toBe(true);
          }
        }
      });
    });
  }
});
