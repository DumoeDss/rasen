import { describe, it, expect } from 'vitest';
import {
  loadPipelineByName,
  listPipelines,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
} from '../../../src/core/pipeline-registry/resolver.js';
import {
  validatePipelineSkills,
  parsePipeline,
} from '../../../src/core/pipeline-registry/pipeline.js';
import { PipelineGraph } from '../../../src/core/pipeline-registry/graph.js';
import { loadPipeline } from '../../../src/core/pipeline-registry/pipeline.js';
import { resolvePipelinePath } from '../../../src/core/pipeline-registry/resolver.js';
import { resolveStageHandoffConfig } from '../../../src/core/pipeline-registry/types.js';
import { getSkillTemplates } from '../../../src/core/shared/skill-generation.js';

const BUILTIN_NAMES = ['full-feature', 'small-feature', 'bug-fix'] as const;

// Goal-loop backend pipelines (homogeneous: one gate type each). Registered as
// data via pipelines/<name>/pipeline.yaml and auto-discovered by the registry.
const GOAL_LOOP_NAMES = ['goal-loop-measure', 'goal-loop-evaluate', 'goal-loop-research'] as const;

// Pipelines that must remain decompose-free so they are valid child pipelines.
const DECOMPOSE_FREE_NAMES = ['small-feature', 'bug-fix'] as const;

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

  // autopilot-gate-policy: the stage gate is a plain boolean; the existing
  // boolean gate stages of the three non-goal-loop built-ins are unchanged.
  describe('backward-compat: existing gate: true stages are unchanged', () => {
    it('small-feature: propose/apply/ship remain gate: true', () => {
      const pipeline = loadPipelineByName('small-feature');
      for (const id of ['propose', 'apply', 'ship']) {
        expect(pipeline.stages.find((s) => s.id === id)?.gate).toBe(true);
      }
    });

    it('bug-fix: propose/apply/ship remain gate: true', () => {
      const pipeline = loadPipelineByName('bug-fix');
      for (const id of ['propose', 'apply', 'ship']) {
        expect(pipeline.stages.find((s) => s.id === id)?.gate).toBe(true);
      }
    });

    it('full-feature: office-hours/propose/apply/ship remain gate: true', () => {
      const pipeline = loadPipelineByName('full-feature');
      for (const id of ['office-hours', 'propose', 'apply', 'ship']) {
        expect(pipeline.stages.find((s) => s.id === id)?.gate).toBe(true);
      }
    });
  });

  for (const name of DECOMPOSE_FREE_NAMES) {
    it(`${name} is decompose-free (valid as a child pipeline)`, () => {
      const pipeline = loadPipelineByName(name);
      expect(pipeline.stages.some(s => s.kind === 'decompose')).toBe(false);
    });
  }

  it('should expose all three goal-loop pipelines via listPipelines', () => {
    const names = listPipelines();
    for (const name of GOAL_LOOP_NAMES) {
      expect(names).toContain(name);
    }
  });

  for (const name of GOAL_LOOP_NAMES) {
    describe(name, () => {
      it('should parse and pass all validators (load + reparse from disk)', () => {
        const pipeline = loadPipelineByName(name);
        expect(pipeline.name).toBe(name);

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

      it('has a goal loop on its iterate stage', () => {
        const pipeline = loadPipelineByName(name);
        const iterate = pipeline.stages.find(s => s.id === 'iterate');
        expect(iterate?.loop).toBeDefined();
        expect(iterate?.loop?.kind).toBe('goal');
      });
    });
  }

  it('goal-loop-* pipelines are NOT asserted as decompose-free (only small/bug-fix are)', () => {
    // Only small-feature and bug-fix are valid child pipelines; the goal-loop
    // family is intentionally not in DECOMPOSE_FREE_NAMES.
    expect(DECOMPOSE_FREE_NAMES).not.toContain('goal-loop-measure');
    expect(DECOMPOSE_FREE_NAMES).not.toContain('goal-loop-evaluate');
    expect(DECOMPOSE_FREE_NAMES).not.toContain('goal-loop-research');
  });

  // Per-pipeline tail divergence. goal-loop-core asserted each pipeline "has a
  // goal loop on iterate" but did not assert the structural tail differences
  // that make each pipeline homogeneous: measure/evaluate ship code (ship →
  // archive, model: sonnet); research writes prose (report tail, no ship/archive).
  describe('goal-loop per-pipeline tail structure', () => {
    it('goal-loop-measure ends in ship -> archive, each model: sonnet', () => {
      const pipeline = loadPipelineByName('goal-loop-measure');
      const stages = pipeline.stages;
      const last = stages[stages.length - 1];
      const secondLast = stages[stages.length - 2];
      expect(secondLast.id).toBe('ship');
      expect(secondLast.model).toBe('sonnet');
      expect(last.id).toBe('archive');
      expect(last.model).toBe('sonnet');
      // No report stage on a code-tail pipeline.
      expect(stages.some(s => s.id === 'report')).toBe(false);
    });

    it('goal-loop-evaluate ends in ship -> archive, each model: sonnet', () => {
      const pipeline = loadPipelineByName('goal-loop-evaluate');
      const stages = pipeline.stages;
      const last = stages[stages.length - 1];
      const secondLast = stages[stages.length - 2];
      expect(secondLast.id).toBe('ship');
      expect(secondLast.model).toBe('sonnet');
      expect(last.id).toBe('archive');
      expect(last.model).toBe('sonnet');
      expect(stages.some(s => s.id === 'report')).toBe(false);
    });

    it('goal-loop-research ends in a single report stage (no ship/archive)', () => {
      const pipeline = loadPipelineByName('goal-loop-research');
      const stages = pipeline.stages;
      const last = stages[stages.length - 1];
      expect(last.id).toBe('report');
      expect(last.skill).toBe('rasen-goal-report');
      // Research writes prose — there is no code to ship/archive.
      const ids = stages.map(s => s.id);
      expect(ids).not.toContain('ship');
      expect(ids).not.toContain('archive');
    });

    it('goal-loop-research lowers the implementer handoff threshold to 0.35 (source role)', () => {
      // Research is context-heavy; the pipeline sets handoff.roles.implementer
      // to 0.35 so the implementer relays earlier (implementer-inline + relay,
      // not a research-sibling). resolveStageHandoffConfig surfaces it.
      const pipeline = loadPipelineByName('goal-loop-research');
      const iterate = pipeline.stages.find(s => s.id === 'iterate')!;
      const handoff = resolveStageHandoffConfig(iterate, pipeline);
      expect(handoff.threshold).toBe(0.35);
      expect(handoff.source).toBe('role');
    });

    it('goal-loop-measure/evaluate keep the default implementer handoff threshold (0.5)', () => {
      // Contrast: only research lowers the threshold. measure/evaluate keep the
      // built-in default, confirming the 0.35 is a research-pipeline override.
      for (const name of ['goal-loop-measure', 'goal-loop-evaluate'] as const) {
        const pipeline = loadPipelineByName(name);
        const iterate = pipeline.stages.find(s => s.id === 'iterate')!;
        const handoff = resolveStageHandoffConfig(iterate, pipeline);
        expect(handoff.threshold).toBe(0.5);
        expect(handoff.source).toBe('default');
      }
    });
  });

  // autopilot-gate-policy: define-goal is an ordinary gate: true (the vet type
  // is retired). It pauses by default, where the human confirms the
  // LEAD-generated arbitrary-shell measure command before any round runs; under
  // an off base it can be auto-approved unless a per-stage instance restores the
  // pause. No built-in stage declares a 'vet' gate. ship stays gate: true.
  describe('goal-loop define-goal gate is true (autopilot-gate-policy)', () => {
    for (const name of GOAL_LOOP_NAMES) {
      it(`${name}: define-goal is gate: true`, () => {
        const pipeline = loadPipelineByName(name);
        const defineGoal = pipeline.stages.find((s) => s.id === 'define-goal');
        expect(defineGoal?.gate).toBe(true);
      });
    }

    it('no built-in stage declares a vet gate', () => {
      for (const name of listPipelines()) {
        const pipeline = loadPipelineByName(name);
        for (const stage of pipeline.stages) {
          expect(stage.gate).not.toBe('vet');
          expect(typeof stage.gate).toBe('boolean');
        }
      }
    });

    it("goal-loop-measure/evaluate: ship stays gate: true (skippable)", () => {
      for (const name of ['goal-loop-measure', 'goal-loop-evaluate'] as const) {
        const pipeline = loadPipelineByName(name);
        const ship = pipeline.stages.find((s) => s.id === 'ship');
        expect(ship?.gate).toBe(true);
      }
    });
  });

  describe('auto-decompose entry pipeline', () => {
    it('is listed and parses with all validators', () => {
      expect(listPipelines()).toContain('auto-decompose');
      const pipeline = loadPipelineByName('auto-decompose');
      expect(pipeline.name).toBe('auto-decompose');
    });

    it('has its decompose stage as the build-order entry point', () => {
      const graph = PipelineGraph.fromPipeline(loadPipelineByName('auto-decompose'));
      const order = graph.getBuildOrder();
      const first = graph.getStage(order[0]);
      expect(first?.kind).toBe('decompose');
      expect(graph.getDecomposeStage()?.id).toBe(order[0]);
    });

    it('resolves to a decompose-free child pipeline (recursion guard passes)', () => {
      const pipeline = loadPipelineByName('auto-decompose');
      const decompose = pipeline.stages.find(s => s.kind === 'decompose')!;
      expect(resolveChildPipelineName(decompose)).toBe('small-feature');
      expect(() => validateDecomposeChildPipelines(pipeline)).not.toThrow();
    });

    it('its decompose stage is not a human gate', () => {
      const pipeline = loadPipelineByName('auto-decompose');
      const decompose = pipeline.stages.find(s => s.kind === 'decompose')!;
      expect(decompose.gate).toBe(false);
    });
  });
});
