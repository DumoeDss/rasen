import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parsePipeline,
  validatePipelineSkills,
  validatePipelineDraft,
  PipelineValidationError,
} from '../../../src/core/pipeline-registry/pipeline.js';
import {
  resolveStageRuntimeConfig,
  resolveStageHandoffConfig,
  resolvePipelineReuseConfig,
  DEFAULT_HANDOFF_CONFIG,
  DEFAULT_REUSE_CONFIG,
} from '../../../src/core/pipeline-registry/types.js';

describe('pipeline-registry/pipeline', () => {
  describe('parsePipeline', () => {
    it('should parse valid pipeline YAML', () => {
      const yaml = `
name: test-pipeline
description: A test pipeline
stages:
  - id: propose
    skill: rasen-propose
    role: planner
    requires: []
    gate: true
  - id: apply
    skill: rasen-apply-change
    role: implementer
    requires:
      - propose
`;
      const pipeline = parsePipeline(yaml);

      expect(pipeline.name).toBe('test-pipeline');
      expect(pipeline.description).toBe('A test pipeline');
      expect(pipeline.stages).toHaveLength(2);
      expect(pipeline.stages[0].id).toBe('propose');
      expect(pipeline.stages[0].role).toBe('planner');
      expect(pipeline.stages[0].gate).toBe(true);
      expect(pipeline.stages[1].requires).toEqual(['propose']);
    });

    it('should apply defaults for requires, gate, leadReview', () => {
      const yaml = `
name: defaults
stages:
  - id: only
    skill: rasen-propose
`;
      const pipeline = parsePipeline(yaml);
      const stage = pipeline.stages[0];

      expect(stage.requires).toEqual([]);
      expect(stage.gate).toBe(false);
      expect(stage.leadReview).toBe(false);
      expect(stage.role).toBeUndefined();
      expect(stage.parallelGroup).toBeUndefined();
      expect(stage.condition).toBeUndefined();
      expect(stage.loop).toBeUndefined();
      expect(stage.verifyPolicy).toBeUndefined();
    });

    // autopilot-gate-policy: the stage gate is a plain boolean. This is a
    // DIFFERENT field from the goal-loop `loop.gate` measure/evaluate union
    // tested below — do not confuse them. The retired `gate: 'vet'` spelling
    // is coerced to `true` by the legacy shim (see the coercion tests).
    describe('gate: boolean (autopilot-gate-policy)', () => {
      const stageYaml = (gate: string, name = 'gate-test') => `
name: ${name}
stages:
  - id: only
    skill: rasen-propose
    gate: ${gate}
`;

      it('parses gate: true', () => {
        const pipeline = parsePipeline(stageYaml('true'));
        expect(pipeline.stages[0].gate).toBe(true);
      });

      it('parses gate: false', () => {
        const pipeline = parsePipeline(stageYaml('false'));
        expect(pipeline.stages[0].gate).toBe(false);
      });

      it('defaults to false when gate is omitted', () => {
        const yaml = `
name: gate-omitted
stages:
  - id: only
    skill: rasen-propose
`;
        const pipeline = parsePipeline(yaml);
        expect(pipeline.stages[0].gate).toBe(false);
      });

      it('rejects an invalid gate value', () => {
        expect(() => parsePipeline(stageYaml('maybe'))).toThrow();
      });
    });

    // autopilot-gate-policy "Legacy vet gate values read as ordinary gates":
    // the retired `gate: 'vet'` type is no longer a distinct value; a user YAML
    // still carrying it reads as `gate: true` with a single warning per pipeline
    // per process, never a parse error, so existing libraries keep loading.
    describe("legacy gate: 'vet' coercion (autopilot-gate-policy)", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      const vetYaml = (name: string) => `
name: ${name}
stages:
  - id: define-goal
    skill: rasen-goal-plan
    gate: vet
`;

      it("coerces gate: 'vet' to true instead of erroring", () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pipeline = parsePipeline(vetYaml('legacy-coerce-basic'));
        expect(pipeline.stages[0].gate).toBe(true);
      });

      it('warns exactly once per pipeline per process even when loaded twice', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const yaml = vetYaml('legacy-coerce-once');
        parsePipeline(yaml);
        parsePipeline(yaml);
        const vetWarnings = warn.mock.calls.filter(([msg]) =>
          typeof msg === 'string' && msg.includes("gate: 'vet'")
        );
        expect(vetWarnings).toHaveLength(1);
        // The warning names the pipeline, the stage, and the per-stage key.
        expect(vetWarnings[0][0]).toContain('legacy-coerce-once');
        expect(vetWarnings[0][0]).toContain('define-goal');
        expect(vetWarnings[0][0]).toContain('pipelines.legacy-coerce-once.gates.define-goal');
      });
    });

    it('should apply default maxRounds of 3 for review-cycle loop', () => {
      const yaml = `
name: loop-default
stages:
  - id: loop
    skill: rasen-review-cycle
    loop:
      kind: review-cycle
`;
      const pipeline = parsePipeline(yaml);
      expect(pipeline.stages[0].loop).toEqual({ kind: 'review-cycle', maxRounds: 3 });
    });

    it('should parse a goal loop with a measure gate and narrow on kind', () => {
      const yaml = `
name: goal-measure
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate: { kind: measure }
      runArtifact: goal-run.json
`;
      const pipeline = parsePipeline(yaml);
      const loop = pipeline.stages[0].loop;
      expect(loop).toBeDefined();
      expect(loop?.kind).toBe('goal');
      if (loop?.kind === 'goal') {
        expect(loop.gate.kind).toBe('measure');
        expect(loop.maxRounds).toBe(5);
        expect(loop.loopStallLimit).toBe(2);
        expect(loop.runArtifact).toBe('goal-run.json');
      }
    });

    it('should parse a goal loop with an evaluate gate', () => {
      const yaml = `
name: goal-evaluate
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate: { kind: evaluate }
`;
      const pipeline = parsePipeline(yaml);
      const loop = pipeline.stages[0].loop;
      expect(loop?.kind).toBe('goal');
      if (loop?.kind === 'goal') {
        expect(loop.gate.kind).toBe('evaluate');
      }
    });

    it('should apply defaults loopStallLimit=2 and maxRounds=5 for a goal loop', () => {
      const yaml = `
name: goal-defaults
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate: { kind: evaluate }
`;
      const pipeline = parsePipeline(yaml);
      const loop = pipeline.stages[0].loop;
      if (loop?.kind === 'goal') {
        expect(loop.maxRounds).toBe(5);
        expect(loop.loopStallLimit).toBe(2);
        expect(loop.runArtifact).toBe('goal-run.json');
      }
    });

    it('should default blockedThreshold to 3 when omitted and accept an explicit value', () => {
      const defaulted = parsePipeline(`
name: goal-blocked-default
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate: { kind: evaluate }
`);
      const defLoop = defaulted.stages[0].loop;
      expect(defLoop?.kind).toBe('goal');
      if (defLoop?.kind === 'goal') {
        expect(defLoop.blockedThreshold).toBe(3);
      }

      const explicit = parsePipeline(`
name: goal-blocked-explicit
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate: { kind: evaluate }
      blockedThreshold: 5
`);
      const expLoop = explicit.stages[0].loop;
      if (expLoop?.kind === 'goal') {
        expect(expLoop.blockedThreshold).toBe(5);
      }
    });

    it('should parse a measure gate with a stop condition (threshold)', () => {
      const yaml = `
name: goal-threshold
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate:
        kind: measure
        command: ./lighthouse
        threshold: 90
        direction: gte
`;
      const pipeline = parsePipeline(yaml);
      const loop = pipeline.stages[0].loop;
      if (loop?.kind === 'goal' && loop.gate.kind === 'measure') {
        expect(loop.gate.command).toBe('./lighthouse');
        expect(loop.gate.threshold).toBe(90);
        expect(loop.gate.direction).toBe('gte');
        expect(loop.gate.timeoutSec).toBe(120);
      }
    });

    it('should reject a measure gate (with a command) missing both threshold and target', () => {
      const yaml = `
name: goal-no-stop
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate:
        kind: measure
        command: ./score
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/threshold or target/);
    });

    it('should reject a gate that combines measure and evaluate fields', () => {
      // The discriminated union on gate.kind makes measure XOR evaluate
      // structurally exclusive: a gate claiming measure but carrying an
      // evaluate-only field (rubric) is rejected.
      const yaml = `
name: goal-combo
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: goal
      gate:
        kind: measure
        command: ./score
        threshold: 90
        rubric: shouldBeRejected
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
    });

    it('should reject an unknown loop kind', () => {
      const yaml = `
name: bad-loop-kind
stages:
  - id: iterate
    skill: rasen-goal-iterate
    loop:
      kind: unknown
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
    });

    it('should parse optional verifyPolicy, condition, parallelGroup', () => {
      const yaml = `
name: opts
stages:
  - id: a
    skill: rasen-propose
  - id: verify
    skill: rasen-review
    requires: [a]
    condition: always
    verifyPolicy: adaptive
    parallelGroup: experts
`;
      const pipeline = parsePipeline(yaml);
      const verify = pipeline.stages[1];
      expect(verify.condition).toBe('always');
      expect(verify.verifyPolicy).toBe('adaptive');
      expect(verify.parallelGroup).toBe('experts');
    });

    it('should parse role-level and stage-level agent runtime selection', () => {
      const yaml = `
name: runtime-switch
agents:
  planner:
    runtime: codex
    sessionReuse: run-planner
    sandbox: workspace-write
    model: gpt-5.4-codex
  reviewer: claude
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: verify
    skill: rasen-review
    role: reviewer
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
    requires: [propose]
`;
      const pipeline = parsePipeline(yaml);
      const propose = pipeline.stages[0];
      const verify = pipeline.stages[1];

      expect(resolveStageRuntimeConfig(propose, pipeline)).toMatchObject({
        runtime: 'codex',
        source: 'agent',
        sessionReuse: 'run-planner',
        sandbox: 'workspace-write',
        model: 'gpt-5.4-codex',
      });
      expect(resolveStageRuntimeConfig(verify, pipeline)).toMatchObject({
        runtime: 'codex',
        source: 'stage',
        sessionReuse: 'review-thread',
        sandbox: 'read-only',
      });
    });

    describe('per-role machine model config layers (config-page-coherence)', () => {
      const noModelPipeline = parsePipeline(`
name: model-layer-test
stages:
  - id: a
    skill: rasen-review
    role: reviewer
`);
      const reviewerStage = noModelPipeline.stages[0];

      it('the global base model applies when nothing more specific is set', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          globalDefault: 'sonnet',
        });
        expect(result.model).toBe('sonnet');
        expect(result.modelSource).toBe('global-default');
      });

      it('a per-role model beats the base within the same scope', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          globalDefault: 'sonnet',
          globalRoles: { reviewer: 'fable' },
        });
        expect(result.model).toBe('fable');
        expect(result.modelSource).toBe('global-role');

        const implementerPipeline = parsePipeline(`
name: model-layer-test-2
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const nonReviewer = resolveStageRuntimeConfig(implementerPipeline.stages[0], implementerPipeline, {
          globalDefault: 'sonnet',
          globalRoles: { reviewer: 'fable' },
        });
        expect(nonReviewer.model).toBe('sonnet');
        expect(nonReviewer.modelSource).toBe('global-default');
      });

      it('project model config beats global', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          globalRoles: { reviewer: 'sonnet' },
          projectRoles: { reviewer: 'fable' },
        });
        expect(result.model).toBe('fable');
        expect(result.modelSource).toBe('project-role');
      });

      it('the pipeline role default beats machine config', () => {
        const pipeline = parsePipeline(`
name: model-layer-pipeline-role
agents:
  reviewer:
    model: opus
stages:
  - id: a
    skill: rasen-review
    role: reviewer
`);
        const result = resolveStageRuntimeConfig(pipeline.stages[0], pipeline, {
          globalRoles: { reviewer: 'sonnet' },
        });
        expect(result.model).toBe('opus');
        expect(result.modelSource).toBe('agent');
      });

      it('a stage-level model wins over everything', () => {
        const pipeline = parsePipeline(`
name: model-layer-stage-wins
agents:
  reviewer:
    model: opus
stages:
  - id: a
    skill: rasen-review
    role: reviewer
    model: haiku
`);
        const result = resolveStageRuntimeConfig(pipeline.stages[0], pipeline, {
          globalRoles: { reviewer: 'sonnet' },
          projectRoles: { reviewer: 'fable' },
        });
        expect(result.model).toBe('haiku');
        expect(result.modelSource).toBe('stage');
      });

      it('an unrecognized model id resolves as-is (no preset)', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          projectDefault: 'not-a-real-model-xyz',
        });
        expect(result.model).toBe('not-a-real-model-xyz');
        expect(result.modelSource).toBe('project-default');
      });

      it('resolves modelSource default when no layer sets a model', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline);
        expect(result.model).toBeUndefined();
        expect(result.modelSource).toBe('default');
      });

      it('the store base model applies below the project layer and above global', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          storeDefault: 'opus',
          globalDefault: 'sonnet',
        });
        expect(result.model).toBe('opus');
        expect(result.modelSource).toBe('store-default');
      });

      it('a store per-role model beats the store base and the global layer', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          storeDefault: 'sonnet',
          storeRoles: { reviewer: 'fable' },
          globalRoles: { reviewer: 'opus' },
        });
        expect(result.model).toBe('fable');
        expect(result.modelSource).toBe('store-role');
      });

      it('project model config beats the store layer', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          storeRoles: { reviewer: 'sonnet' },
          projectRoles: { reviewer: 'fable' },
        });
        expect(result.model).toBe('fable');
        expect(result.modelSource).toBe('project-role');
      });

      it('absent store fields change nothing', () => {
        const result = resolveStageRuntimeConfig(reviewerStage, noModelPipeline, {
          globalDefault: 'sonnet',
        });
        expect(result.model).toBe('sonnet');
        expect(result.modelSource).toBe('global-default');
      });
    });

    it('should reject invalid runtime selection', () => {
      const yaml = `
name: bad-runtime
agents:
  planner: llama
stages:
  - id: propose
    skill: rasen-propose
    role: planner
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
    });

    it('should throw on missing pipeline name', () => {
      const yaml = `
stages:
  - id: a
    skill: rasen-propose
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/name/);
    });

    it('should throw on missing stage skill', () => {
      const yaml = `
name: no-skill
stages:
  - id: a
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/skill/);
    });

    it('should throw on empty stages array', () => {
      const yaml = `
name: empty
stages: []
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/stage/i);
    });

    it('should throw on invalid role enum', () => {
      const yaml = `
name: bad-role
stages:
  - id: a
    skill: rasen-propose
    role: wizard
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
    });

    it('should throw on invalid verifyPolicy enum', () => {
      const yaml = `
name: bad-policy
stages:
  - id: a
    skill: rasen-review
    verifyPolicy: extreme
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
    });
  });

  describe('validators', () => {
    it('should throw on duplicate stage IDs', () => {
      const yaml = `
name: dup
stages:
  - id: apply
    skill: rasen-propose
  - id: apply
    skill: rasen-apply-change
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/Duplicate stage ID: apply/);
    });

    it('should throw on dangling requires reference', () => {
      const yaml = `
name: dangling
stages:
  - id: apply
    skill: rasen-apply-change
    requires:
      - nonexistent
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/Invalid dependency reference.*nonexistent/);
    });

    it('should detect self-referencing cycle', () => {
      const yaml = `
name: self
stages:
  - id: A
    skill: rasen-propose
    requires:
      - A
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/Cyclic dependency detected/);
    });

    it('should detect simple A → B → A cycle', () => {
      const yaml = `
name: cycle2
stages:
  - id: A
    skill: rasen-propose
    requires:
      - B
  - id: B
    skill: rasen-apply-change
    requires:
      - A
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/Cyclic dependency detected/);
      expect(() => parsePipeline(yaml)).toThrow(/→/);
    });

    it('should detect longer A → B → C → A cycle and list IDs', () => {
      const yaml = `
name: cycle3
stages:
  - id: A
    skill: rasen-propose
    requires:
      - C
  - id: B
    skill: rasen-apply-change
    requires:
      - A
  - id: C
    skill: rasen-review
    requires:
      - B
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      const error = (() => {
        try {
          parsePipeline(yaml);
        } catch (e) {
          return e;
        }
      })() as Error;
      expect(error.message).toMatch(/A.*→.*B|B.*→.*C|C.*→.*A/);
    });

    it('should throw when parallelGroup members depend on each other', () => {
      const yaml = `
name: bad-parallel
stages:
  - id: root
    skill: rasen-apply-change
  - id: review
    skill: rasen-review
    requires: [root]
    parallelGroup: experts
  - id: cso
    skill: rasen-cso
    requires: [root, review]
    parallelGroup: experts
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/parallelGroup 'experts' must be mutually independent/);
    });

    it('should allow parallelGroup members that share an external dependency', () => {
      const yaml = `
name: good-parallel
stages:
  - id: root
    skill: rasen-apply-change
  - id: review
    skill: rasen-review
    requires: [root]
    parallelGroup: experts
  - id: cso
    skill: rasen-cso
    requires: [root]
    parallelGroup: experts
`;
      expect(() => parsePipeline(yaml)).not.toThrow();
    });
  });

  describe('validatePipelineSkills', () => {
    const yaml = `
name: skills
stages:
  - id: a
    skill: rasen-propose
  - id: b
    skill: rasen-review
    requires: [a]
`;

    it('should pass when all skills are known', () => {
      const pipeline = parsePipeline(yaml);
      const known = new Set(['rasen-propose', 'rasen-review', 'extra']);
      expect(() => validatePipelineSkills(pipeline, known)).not.toThrow();
    });

    it('should throw when a stage references an unknown skill', () => {
      const pipeline = parsePipeline(yaml);
      const known = new Set(['rasen-propose']); // missing rasen-review
      expect(() => validatePipelineSkills(pipeline, known)).toThrow(PipelineValidationError);
      expect(() => validatePipelineSkills(pipeline, known)).toThrow(
        /Stage 'b' references unknown skill: 'rasen-review'/
      );
    });

    it('should throw against an empty known set', () => {
      const pipeline = parsePipeline(yaml);
      expect(() => validatePipelineSkills(pipeline, new Set())).toThrow(PipelineValidationError);
    });

    it('distinguishes a known but disabled skill from an unknown skill', () => {
      const pipeline = parsePipeline(yaml);
      const known = new Set(['rasen-propose', 'rasen-review']);
      const enabled = new Set(['rasen-propose']);

      try {
        validatePipelineSkills(pipeline, known, enabled);
        throw new Error('expected disabled skill validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineValidationError);
        expect(error).toMatchObject({ code: 'pipeline_skill_disabled' });
        expect((error as Error).message).toMatch(
          /Stage 'b' references known but disabled skill: 'rasen-review'/
        );
      }
    });

    it('should skip decompose stages (they carry no leaf skill)', () => {
      const pipeline = parsePipeline(`
name: dec
stages:
  - id: decompose
    kind: decompose
    childPipeline: small-feature
  - id: propose
    skill: rasen-propose
    requires: [decompose]
`);
      // decompose stage has no skill but must NOT trip the unknown-skill check
      expect(() => validatePipelineSkills(pipeline, new Set(['rasen-propose']))).not.toThrow();
    });
  });

  describe('validatePipelineDraft (pipeline-definition-api: parse-chain-rejects ⇔ collector-reports-error)', () => {
    const skillSets = {
      knownSkillNames: new Set(['rasen-propose', 'rasen-apply-change', 'rasen-review']),
      enabledSkillNames: new Set(['rasen-propose', 'rasen-apply-change', 'rasen-review']),
    };

    it('reports no error issues for a fixture parsePipeline accepts', () => {
      const yaml = `
name: draft-ok
stages:
  - id: a
    skill: rasen-propose
  - id: b
    skill: rasen-review
    requires: [a]
`;
      expect(() => parsePipeline(yaml)).not.toThrow();
      const issues = validatePipelineDraft(
        { name: 'draft-ok', stages: [{ id: 'a', skill: 'rasen-propose' }, { id: 'b', skill: 'rasen-review', requires: ['a'] }] },
        skillSets
      );
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('reports a Zod issue per schema violation, with its own path', () => {
      const issues = validatePipelineDraft({ name: '', stages: [] }, skillSets);
      expect(issues.length).toBeGreaterThanOrEqual(2);
      for (const issue of issues) {
        expect(issue.severity).toBe('error');
        expect(issue.path.startsWith('/')).toBe(true);
      }
    });

    it('collects a cycle issue AND an unknown-skill issue for the same draft (multi-issue, single pass)', () => {
      const definition = {
        name: 'draft-multi',
        stages: [
          { id: 'a', skill: 'no-such-skill', requires: ['b'] },
          { id: 'b', skill: 'rasen-apply-change', requires: ['a'] },
        ],
      };
      const issues = validatePipelineDraft(definition, skillSets);
      expect(issues.some((i) => /[Cc]yclic/.test(i.message))).toBe(true);
      expect(issues.some((i) => i.path === '/stages/0/skill' && /unknown skill/.test(i.message))).toBe(true);
    });

    it('locates a disabled-skill issue at its stage path', () => {
      const definition = {
        name: 'draft-disabled',
        stages: [{ id: 'a', skill: 'rasen-review' }],
      };
      const issues = validatePipelineDraft(definition, {
        knownSkillNames: new Set(['rasen-review']),
        enabledSkillNames: new Set(),
      });
      expect(issues).toContainEqual(
        expect.objectContaining({ severity: 'error', path: '/stages/0/skill' })
      );
    });

    it('parse-chain-rejects ⇔ collector-reports-an-error over shared fixtures: floor scope (composed/ui/origin-free)', () => {
      const floorFreeStages = [{ id: 'a', skill: 'rasen-propose' }];

      for (const origin of ['composed', 'ui'] as const) {
        const definition = { name: 'floor-check', origin, stages: floorFreeStages };
        expect(() => parsePipeline(`name: floor-check\norigin: ${origin}\nstages:\n  - id: a\n    skill: rasen-propose\n`)).toThrow();
        const issues = validatePipelineDraft(definition, skillSets);
        expect(issues.some((i) => i.severity === 'error')).toBe(true);
      }

      // Origin-free: the same floor-free shape is untouched by either path.
      const originFreeYaml = 'name: floor-check\nstages:\n  - id: a\n    skill: rasen-propose\n';
      expect(() => parsePipeline(originFreeYaml)).not.toThrow();
      const originFreeIssues = validatePipelineDraft(
        { name: 'floor-check', stages: floorFreeStages },
        skillSets
      );
      expect(originFreeIssues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('never throws on an invalid draft — invalidity is data', () => {
      expect(() =>
        validatePipelineDraft({ name: 'a', stages: [{ id: 'x', requires: ['missing'] }] }, skillSets)
      ).not.toThrow();
    });
  });

  describe('decompose stages', () => {
    it('parses a decompose stage (no skill, with childPipeline)', () => {
      const pipeline = parsePipeline(`
name: dec
stages:
  - id: decompose
    kind: decompose
    childPipeline: small-feature
  - id: propose
    skill: rasen-propose
    requires: [decompose]
`);
      const stage = pipeline.stages[0];
      expect(stage.kind).toBe('decompose');
      expect(stage.childPipeline).toBe('small-feature');
      expect(stage.skill).toBeUndefined();
    });

    it('defaults a kind-less stage to standard and still requires skill', () => {
      const pipeline = parsePipeline(`
name: std
stages:
  - id: a
    skill: rasen-propose
`);
      expect(pipeline.stages[0].kind).toBe('standard');

      // a standard (kind-less) stage with no skill is rejected
      expect(() =>
        parsePipeline(`
name: nope
stages:
  - id: a
`)
      ).toThrow(/skill/);
    });

    it('rejects more than one decompose stage', () => {
      const yaml = `
name: two-decompose
stages:
  - id: d1
    kind: decompose
  - id: d2
    kind: decompose
    requires: [d1]
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/At most one decompose stage/);
    });

    it('rejects a decompose stage that is not the build-order entry point', () => {
      // decompose depends on propose -> propose is the root, decompose is not first
      const yaml = `
name: not-first
stages:
  - id: propose
    skill: rasen-propose
  - id: decompose
    kind: decompose
    requires: [propose]
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/must be the first stage/);
    });

    it('rejects a decompose stage when a second independent root exists', () => {
      // decompose is a root, but so is `other` -> decompose is not the SOLE entry point
      const yaml = `
name: two-roots
stages:
  - id: decompose
    kind: decompose
  - id: other
    skill: rasen-propose
  - id: apply
    skill: rasen-apply-change
    requires: [decompose, other]
`;
      expect(() => parsePipeline(yaml)).toThrow(/must be the first stage/);
    });

    it('accepts a well-formed decompose-first pipeline', () => {
      expect(() =>
        parsePipeline(`
name: ok
stages:
  - id: decompose
    kind: decompose
    childPipeline: small-feature
  - id: propose
    skill: rasen-propose
    requires: [decompose]
  - id: apply
    skill: rasen-apply-change
    requires: [propose]
`)
      ).not.toThrow();
    });
  });

  describe('origin: composed quality floor (autonomy-ladder rung 2)', () => {
    it('parses origin: composed when both floor stages are present', () => {
      const pipeline = parsePipeline(`
name: composed-ok
origin: composed
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
  - id: verify
    skill: rasen-review
    role: reviewer
    requires: [apply]
  - id: review-loop
    skill: rasen-review-cycle
    requires: [verify]
    loop:
      kind: review-cycle
`);
      expect(pipeline.origin).toBe('composed');
    });

    it('rejects origin: composed missing a reviewer-role stage', () => {
      const yaml = `
name: composed-no-reviewer
origin: composed
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
  - id: review-loop
    skill: rasen-review-cycle
    requires: [apply]
    loop:
      kind: review-cycle
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/reviewer/);
    });

    it('rejects origin: composed missing a review-cycle loop stage', () => {
      const yaml = `
name: composed-no-loop
origin: composed
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
  - id: verify
    skill: rasen-review
    role: reviewer
    requires: [apply]
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
      expect(() => parsePipeline(yaml)).toThrow(/review-cycle/);
    });

    it('leaves a pipeline WITHOUT origin unaffected even with no floor stages (bug-fix built-in shape)', () => {
      // Floor-free fixture (neither floor stage). The real bug-fix built-in
      // does carry a reviewer-role stage; what it lacks is the review-cycle
      // loop — either absence must stay valid without an origin marker.
      const pipeline = parsePipeline(`
name: bug-fix-shape
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: apply
    skill: rasen-apply-change
    role: implementer
    requires: [propose]
  - id: verify
    skill: rasen-verify-enhanced
    requires: [apply]
`);
      expect(pipeline.origin).toBeUndefined();
    });

    it('rejects an invalid origin value', () => {
      const yaml = `
name: bad-origin
origin: hand-authored
stages:
  - id: a
    skill: rasen-propose
`;
      expect(() => parsePipeline(yaml)).toThrow(PipelineValidationError);
    });

    it('parses origin: ui when both floor stages are present, and enforces the same floor as composed', () => {
      const pipeline = parsePipeline(`
name: ui-ok
origin: ui
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
  - id: verify
    skill: rasen-review
    role: reviewer
    requires: [apply]
    loop:
      kind: review-cycle
`);
      expect(pipeline.origin).toBe('ui');

      const missingReviewer = `
name: ui-no-reviewer
origin: ui
stages:
  - id: apply
    skill: rasen-apply-change
    role: implementer
  - id: review-loop
    skill: rasen-review-cycle
    requires: [apply]
    loop:
      kind: review-cycle
`;
      expect(() => parsePipeline(missingReviewer)).toThrow(/origin: ui/);
    });
  });

  describe('handoff config', () => {
    it('accepts the (0,1] upper boundary threshold of exactly 1', () => {
      const pipeline = parsePipeline(`
name: hoff-max
handoff:
  threshold: 1
stages:
  - id: a
    skill: rasen-propose
`);
      expect(pipeline.handoff?.threshold).toBe(1);
    });

    it('rejects roles at stage level (pipeline-level config only)', () => {
      expect(() =>
        parsePipeline(`
name: bad-stage-roles
stages:
  - id: a
    skill: rasen-propose
    role: reviewer
    handoff:
      roles:
        reviewer: 0.9
`)
      ).toThrow(PipelineValidationError);
    });

    it('parses a valid pipeline- and stage-level handoff block', () => {
      const pipeline = parsePipeline(`
name: hoff
handoff:
  threshold: 0.5
  roles:
    reviewer: 0.65
  maxRelays: 3
  stallLimit: 2
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: review
    skill: rasen-review
    role: reviewer
    requires: [propose]
    handoff:
      threshold: 0.7
      maxRelays: 5
`);
      expect(pipeline.handoff?.threshold).toBe(0.5);
      expect(pipeline.handoff?.roles?.reviewer).toBe(0.65);
      expect(pipeline.stages[1].handoff?.threshold).toBe(0.7);
    });

    it('rejects a threshold outside (0, 1]', () => {
      expect(() =>
        parsePipeline(`
name: bad-hi
handoff:
  threshold: 1.5
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(PipelineValidationError);
      expect(() =>
        parsePipeline(`
name: bad-zero
handoff:
  threshold: 0
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(/threshold must be in/);
    });

    it('rejects a non-positive maxRelays / stallLimit', () => {
      expect(() =>
        parsePipeline(`
name: bad-relays
handoff:
  maxRelays: 0
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(/maxRelays must be a positive integer/);
      expect(() =>
        parsePipeline(`
name: bad-stall
handoff:
  stallLimit: -1
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(/stallLimit must be a positive integer/);
    });

    it('rejects unknown keys in a handoff block (strict)', () => {
      expect(() =>
        parsePipeline(`
name: bad-key
handoff:
  bogus: 1
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(PipelineValidationError);
    });

    it('resolves precedence: stage > roles[role] > pipeline > defaults', () => {
      const pipeline = parsePipeline(`
name: prec
handoff:
  threshold: 0.4
  roles:
    reviewer: 0.65
  maxRelays: 4
  stallLimit: 3
stages:
  - id: implement
    skill: rasen-apply-change
    role: implementer
  - id: review
    skill: rasen-review
    role: reviewer
    requires: [implement]
  - id: fix
    skill: rasen-apply-change
    role: fixer
    requires: [review]
    handoff:
      threshold: 0.8
`);
      const [implement, review, fix] = pipeline.stages;

      // implementer: no role override, no stage override → pipeline threshold,
      // pipeline relays/stall.
      expect(resolveStageHandoffConfig(implement, pipeline)).toEqual({
        threshold: 0.4,
        maxRelays: 4,
        stallLimit: 3,
        source: 'pipeline',
      });

      // reviewer: role threshold wins for threshold, relays/stall from pipeline.
      expect(resolveStageHandoffConfig(review, pipeline)).toEqual({
        threshold: 0.65,
        maxRelays: 4,
        stallLimit: 3,
        source: 'role',
      });

      // fixer: stage-level threshold wins; relays/stall still fall back.
      expect(resolveStageHandoffConfig(fix, pipeline)).toEqual({
        threshold: 0.8,
        maxRelays: 4,
        stallLimit: 3,
        source: 'stage',
      });
    });

    it('resolves to built-in defaults when nothing is configured', () => {
      const pipeline = parsePipeline(`
name: nodefaults
stages:
  - id: a
    skill: rasen-propose
    role: planner
`);
      expect(resolveStageHandoffConfig(pipeline.stages[0], pipeline)).toEqual({
        threshold: DEFAULT_HANDOFF_CONFIG.threshold,
        maxRelays: DEFAULT_HANDOFF_CONFIG.maxRelays,
        stallLimit: DEFAULT_HANDOFF_CONFIG.stallLimit,
        source: 'default',
      });
    });

    describe('config layers (unified-config-layer)', () => {
      const noPipelineHandoff = parsePipeline(`
name: config-layer-test
stages:
  - id: a
    skill: rasen-propose
    role: planner
`).stages[0];
      const pipelineNoHandoff = parsePipeline(`
name: config-layer-test
stages:
  - id: a
    skill: rasen-propose
    role: planner
`);

      it('applies the project config threshold below pipeline declarations', () => {
        const result = resolveStageHandoffConfig(noPipelineHandoff, pipelineNoHandoff, {
          projectThreshold: 0.4,
        });
        expect(result).toEqual({
          threshold: 0.4,
          maxRelays: DEFAULT_HANDOFF_CONFIG.maxRelays,
          stallLimit: DEFAULT_HANDOFF_CONFIG.stallLimit,
          source: 'project-config',
        });
      });

      it('falls back to the global config threshold when no project threshold is set', () => {
        const result = resolveStageHandoffConfig(noPipelineHandoff, pipelineNoHandoff, {
          globalThreshold: 0.65,
        });
        expect(result.threshold).toBe(0.65);
        expect(result.source).toBe('global-config');
      });

      it('pipeline declarations beat config layers', () => {
        const pipeline = parsePipeline(`
name: config-layer-beats
handoff:
  threshold: 0.7
stages:
  - id: a
    skill: rasen-propose
    role: planner
`);
        const result = resolveStageHandoffConfig(pipeline.stages[0], pipeline, {
          projectThreshold: 0.4,
          globalThreshold: 0.2,
        });
        expect(result.threshold).toBe(0.7);
        expect(result.source).toBe('pipeline');
      });

      it('attributes source to the config layer, not the pipeline, when the pipeline declares only maxRelays (no threshold) (MIN3)', () => {
        const pipeline = parsePipeline(`
name: config-layer-non-threshold-fields
handoff:
  maxRelays: 5
stages:
  - id: a
    skill: rasen-propose
    role: planner
`);
        const result = resolveStageHandoffConfig(pipeline.stages[0], pipeline, {
          projectThreshold: 0.4,
        });
        expect(result.threshold).toBe(0.4);
        expect(result.maxRelays).toBe(5);
        expect(result.source).toBe('project-config');
      });

      it('attributes source to the config layer when a stage declares only stallLimit (no threshold)', () => {
        const pipeline = parsePipeline(`
name: config-layer-stage-non-threshold
stages:
  - id: a
    skill: rasen-propose
    role: planner
    handoff:
      stallLimit: 4
`);
        const result = resolveStageHandoffConfig(pipeline.stages[0], pipeline, {
          globalThreshold: 0.55,
        });
        expect(result.threshold).toBe(0.55);
        expect(result.stallLimit).toBe(4);
        expect(result.source).toBe('global-config');
      });

      it('resolves built-in default when no config layers are passed', () => {
        const result = resolveStageHandoffConfig(noPipelineHandoff, pipelineNoHandoff);
        expect(result.threshold).toBe(DEFAULT_HANDOFF_CONFIG.threshold);
        expect(result.source).toBe('default');
      });

      it('accepts the absolute { remainingTokens } form in a config layer', () => {
        const result = resolveStageHandoffConfig(noPipelineHandoff, pipelineNoHandoff, {
          projectThreshold: { remainingTokens: 45_000 },
        });
        expect(result).toEqual({
          threshold: { remainingTokens: 45_000 },
          maxRelays: DEFAULT_HANDOFF_CONFIG.maxRelays,
          stallLimit: DEFAULT_HANDOFF_CONFIG.stallLimit,
          source: 'project-config',
        });
      });

      it('a project/global config layer beats the model-preset layer', () => {
        const pipeline = parsePipeline(`
name: config-layer-beats-preset
agents:
  implementer:
    model: gpt-5.6-sol
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const result = resolveStageHandoffConfig(pipeline.stages[0], pipeline, {
          globalThreshold: 0.45,
        });
        expect(result.threshold).toBe(0.45);
        expect(result.source).toBe('global-config');
      });
    });

    describe('per-role config layers (config-page-coherence)', () => {
      const reviewerStage = parsePipeline(`
name: role-layer-test
stages:
  - id: a
    skill: rasen-review
    role: reviewer
`).stages[0];
      const reviewerPipeline = parsePipeline(`
name: role-layer-test
stages:
  - id: a
    skill: rasen-review
    role: reviewer
`);
      const implementerStage = parsePipeline(`
name: role-layer-test-2
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`).stages[0];
      const implementerPipeline = parsePipeline(`
name: role-layer-test-2
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);

      it('project per-role threshold beats the project scalar for a matching role', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          projectThreshold: 0.4,
          projectRoles: { reviewer: 0.7 },
        });
        expect(result.threshold).toBe(0.7);
        expect(result.source).toBe('project-role');
      });

      it('a non-matching role resolves to the project scalar', () => {
        const result = resolveStageHandoffConfig(implementerStage, implementerPipeline, {
          projectThreshold: 0.4,
          projectRoles: { reviewer: 0.7 },
        });
        expect(result.threshold).toBe(0.4);
        expect(result.source).toBe('project-config');
      });

      it('global per-role threshold beats the global scalar', () => {
        const result = resolveStageHandoffConfig(implementerStage, implementerPipeline, {
          globalThreshold: 0.6,
          globalRoles: { implementer: 0.8 },
        });
        expect(result.threshold).toBe(0.8);
        expect(result.source).toBe('global-role');
      });

      it('project role beats global role for the same role', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          projectRoles: { reviewer: 0.5 },
          globalRoles: { reviewer: 0.9 },
        });
        expect(result.threshold).toBe(0.5);
        expect(result.source).toBe('project-role');
      });

      it('project role beats the project scalar, which beats global role', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          projectThreshold: 0.4,
          globalRoles: { reviewer: 0.9 },
        });
        expect(result.threshold).toBe(0.4);
        expect(result.source).toBe('project-config');
      });

      it('a config layer role beats the model-preset layer', () => {
        const pipeline = parsePipeline(`
name: role-layer-beats-preset
agents:
  implementer:
    model: gpt-5.6-sol
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const result = resolveStageHandoffConfig(pipeline.stages[0], pipeline, {
          globalRoles: { implementer: 0.42 },
        });
        expect(result.threshold).toBe(0.42);
        expect(result.source).toBe('global-role');
      });

      it('accepts the absolute { remainingTokens } form for a per-role config layer', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          projectRoles: { reviewer: { remainingTokens: 40_000 } },
        });
        expect(result.threshold).toEqual({ remainingTokens: 40_000 });
        expect(result.source).toBe('project-role');
      });

      it('the store config threshold applies below the project layer', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          storeThreshold: 0.45,
        });
        expect(result.threshold).toBe(0.45);
        expect(result.source).toBe('store-config');
      });

      it('a store per-role threshold beats the store scalar', () => {
        const reviewerResult = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          storeThreshold: 0.45,
          storeRoles: { reviewer: 0.7 },
        });
        expect(reviewerResult.threshold).toBe(0.7);
        expect(reviewerResult.source).toBe('store-role');

        const nonReviewerResult = resolveStageHandoffConfig(implementerStage, implementerPipeline, {
          storeThreshold: 0.45,
          storeRoles: { reviewer: 0.7 },
        });
        expect(nonReviewerResult.threshold).toBe(0.45);
        expect(nonReviewerResult.source).toBe('store-config');
      });

      it('the project layer beats the store layer entirely', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          projectThreshold: 0.4,
          storeRoles: { reviewer: 0.7 },
        });
        expect(result.threshold).toBe(0.4);
        expect(result.source).toBe('project-config');
      });

      it('the store layer beats the global layer', () => {
        const result = resolveStageHandoffConfig(implementerStage, implementerPipeline, {
          storeRoles: { implementer: 0.8 },
          globalRoles: { implementer: 0.6 },
        });
        expect(result.threshold).toBe(0.8);
        expect(result.source).toBe('store-role');
      });

      it('the store layer accepts the absolute { remainingTokens } form', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          storeThreshold: { remainingTokens: 45_000 },
        });
        expect(result.threshold).toEqual({ remainingTokens: 45_000 });
        expect(result.source).toBe('store-config');
      });

      it('absent store fields never report a store source', () => {
        const result = resolveStageHandoffConfig(reviewerStage, reviewerPipeline, {
          globalThreshold: 0.65,
        });
        expect(result.source).toBe('global-config');
      });
    });

    describe('dual-form threshold: { remainingTokens: N }', () => {
      it('parses the absolute form at pipeline, role, and stage level', () => {
        const pipeline = parsePipeline(`
name: hoff-abs
handoff:
  threshold:
    remainingTokens: 60000
  roles:
    implementer:
      remainingTokens: 40000
stages:
  - id: a
    skill: rasen-propose
    role: implementer
    handoff:
      threshold:
        remainingTokens: 20000
`);
        expect(pipeline.handoff?.threshold).toEqual({ remainingTokens: 60000 });
        expect(pipeline.handoff?.roles?.implementer).toEqual({ remainingTokens: 40000 });
        expect(pipeline.stages[0].handoff?.threshold).toEqual({ remainingTokens: 20000 });
      });

      it('resolves the object form through unchanged (no fraction normalization)', () => {
        const pipeline = parsePipeline(`
name: hoff-abs-resolve
handoff:
  threshold:
    remainingTokens: 60000
stages:
  - id: a
    skill: rasen-propose
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toEqual({ remainingTokens: 60000 });
        expect(resolved.source).toBe('pipeline');
      });

      it('rejects a non-positive remainingTokens', () => {
        for (const bad of [0, -5]) {
          expect(() =>
            parsePipeline(`
name: bad-tokens
handoff:
  threshold:
    remainingTokens: ${bad}
stages:
  - id: a
    skill: rasen-propose
`)
          ).toThrow(/remainingTokens must be a positive integer/);
        }
      });

      it('rejects a non-integer remainingTokens', () => {
        expect(() =>
          parsePipeline(`
name: bad-tokens-float
handoff:
  threshold:
    remainingTokens: 1.5
stages:
  - id: a
    skill: rasen-propose
`)
        ).toThrow(PipelineValidationError);
      });

      it('rejects unknown keys inside the threshold object', () => {
        expect(() =>
          parsePipeline(`
name: bad-threshold-key
handoff:
  threshold:
    remainingTokens: 1000
    bogus: 1
stages:
  - id: a
    skill: rasen-propose
`)
        ).toThrow(PipelineValidationError);
      });

      it('a bare number is never read as a token count, even when large', () => {
        expect(() =>
          parsePipeline(`
name: bare-large
handoff:
  threshold: 50
stages:
  - id: a
    skill: rasen-propose
`)
        ).toThrow(/threshold must be in \(0, 1\]/);
      });
    });

    describe('model preset layer', () => {
      it('applies the preset threshold when nothing is configured and the stage model matches', () => {
        const pipeline = parsePipeline(`
name: hoff-preset
agents:
  implementer:
    model: gpt-5.6-sol
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toEqual({ remainingTokens: 60000 });
        expect(resolved.source).toBe('preset');
        expect(resolved.maxRelays).toBe(DEFAULT_HANDOFF_CONFIG.maxRelays);
        expect(resolved.stallLimit).toBe(DEFAULT_HANDOFF_CONFIG.stallLimit);
      });

      it('a configured threshold at any layer wins over the preset', () => {
        const pipeline = parsePipeline(`
name: hoff-preset-override
agents:
  implementer:
    model: gpt-5.6-sol
handoff:
  threshold: 0.6
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toBe(0.6);
        expect(resolved.source).toBe('pipeline');
      });

      it('skips the preset layer when the stage has no resolvable model', () => {
        const pipeline = parsePipeline(`
name: hoff-no-model
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.source).toBe('default');
        expect(resolved.threshold).toBe(DEFAULT_HANDOFF_CONFIG.threshold);
      });

      it('skips the preset layer when the model has no suggested handoff threshold', () => {
        const pipeline = parsePipeline(`
name: hoff-large-window
agents:
  implementer:
    model: claude-fable-5
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.source).toBe('default');
        expect(resolved.threshold).toBe(DEFAULT_HANDOFF_CONFIG.threshold);
      });

      it('reports source: preset even when a pipeline-level handoff block sets an UNRELATED field (M3 regression)', () => {
        // `handoff.roles.reviewer` touches the pipeline handoff block but says
        // nothing about the implementer stage below — `hasFields` alone would
        // wrongly tag this stage's preset-sourced threshold as 'pipeline'.
        const pipeline = parsePipeline(`
name: hoff-preset-unrelated-pipeline-field
agents:
  implementer:
    model: gpt-5.6-sol
handoff:
  roles:
    reviewer: 0.65
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toEqual({ remainingTokens: 60000 });
        expect(resolved.source).toBe('preset');
      });

      it('reports source: pipeline (not stage) when only stage maxRelays is set and pipeline supplies the threshold', () => {
        // Threshold-specific provenance: the stage block contributes
        // maxRelays only, so the resolved THRESHOLD still traces to the
        // pipeline layer even though the stage handoff block is non-empty.
        const pipeline = parsePipeline(`
name: hoff-stage-maxrelays-only
handoff:
  threshold: 0.4
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
    handoff:
      maxRelays: 6
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toBe(0.4);
        expect(resolved.maxRelays).toBe(6);
        expect(resolved.source).toBe('pipeline');
      });

      it('reports source: role (not stage) when only stage maxRelays is set and a role threshold is available', () => {
        // Same threshold-specific provenance fix, but the resolved THRESHOLD
        // traces to the pipeline-level role override rather than the
        // pipeline-level threshold — the stage's own maxRelays-only block
        // must not shadow that.
        const pipeline = parsePipeline(`
name: hoff-stage-maxrelays-only-role-threshold
handoff:
  roles:
    reviewer: 0.65
stages:
  - id: a
    skill: rasen-review
    role: reviewer
    handoff:
      maxRelays: 6
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toBe(0.65);
        expect(resolved.maxRelays).toBe(6);
        expect(resolved.source).toBe('role');
      });

      it('falls back to hasFields-based source when no layer supplies a threshold at all', () => {
        // Nothing (stage/role/pipeline/preset) supplies a threshold, so it
        // resolves to the built-in default — but the stage's maxRelays
        // override still identifies 'stage' as the contributing layer,
        // matching pre-preset behavior for this edge.
        const pipeline = parsePipeline(`
name: hoff-stage-maxrelays-only-no-pipeline-threshold
stages:
  - id: a
    skill: rasen-apply-change
    role: implementer
    handoff:
      maxRelays: 6
`);
        const resolved = resolveStageHandoffConfig(pipeline.stages[0], pipeline);
        expect(resolved.threshold).toBe(DEFAULT_HANDOFF_CONFIG.threshold);
        expect(resolved.maxRelays).toBe(6);
        expect(resolved.source).toBe('stage');
      });
    });
  });

  describe('reuse config', () => {
    it('parses a valid reuse block', () => {
      const pipeline = parsePipeline(`
name: reuse-ok
reuse:
  planner: auto
  implementer: never
  threshold: 0.4
  roles:
    planner: 0.5
stages:
  - id: a
    skill: rasen-propose
`);
      expect(pipeline.reuse?.planner).toBe('auto');
      expect(pipeline.reuse?.implementer).toBe('never');
      expect(pipeline.reuse?.threshold).toBe(0.4);
      expect(pipeline.reuse?.roles?.planner).toBe(0.5);
    });

    it('accepts the (0,1] upper boundary threshold of exactly 1', () => {
      const pipeline = parsePipeline(`
name: reuse-max
reuse:
  threshold: 1
stages:
  - id: a
    skill: rasen-propose
`);
      expect(pipeline.reuse?.threshold).toBe(1);
    });

    it('rejects a mode other than auto/never', () => {
      expect(() =>
        parsePipeline(`
name: bad-mode
reuse:
  planner: sometimes
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(PipelineValidationError);
    });

    it('rejects a threshold outside (0, 1] (top-level and per-role)', () => {
      expect(() =>
        parsePipeline(`
name: bad-hi
reuse:
  threshold: 1.5
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(/reuse threshold must be in/);
      expect(() =>
        parsePipeline(`
name: bad-zero
reuse:
  threshold: 0
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(/reuse threshold must be in/);
      expect(() =>
        parsePipeline(`
name: bad-role-threshold
reuse:
  roles:
    implementer: 2
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(/reuse threshold must be in/);
    });

    it('rejects unknown keys in a reuse block (strict)', () => {
      expect(() =>
        parsePipeline(`
name: bad-key
reuse:
  bogus: 1
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(PipelineValidationError);
    });

    it('rejects an unknown (non-reusable) role in reuse.roles (strict)', () => {
      expect(() =>
        parsePipeline(`
name: bad-role
reuse:
  roles:
    reviewer: 0.5
stages:
  - id: a
    skill: rasen-propose
`)
      ).toThrow(PipelineValidationError);
    });

    it('resolves per-role threshold: roles[role] > pipeline threshold > default', () => {
      const pipeline = parsePipeline(`
name: reuse-prec
reuse:
  threshold: 0.3
  roles:
    planner: 0.5
stages:
  - id: a
    skill: rasen-propose
`);
      expect(resolvePipelineReuseConfig(pipeline)).toEqual({
        planner: 'auto',
        implementer: 'auto',
        threshold: 0.3,
        roles: { planner: 0.5, implementer: 0.3 },
      });
    });

    it('resolves modes: declared value > default', () => {
      const pipeline = parsePipeline(`
name: reuse-modes
reuse:
  planner: never
stages:
  - id: a
    skill: rasen-propose
`);
      const resolved = resolvePipelineReuseConfig(pipeline);
      expect(resolved.planner).toBe('never');
      expect(resolved.implementer).toBe('auto');
    });

    it('resolves to built-in defaults when no reuse block is configured', () => {
      const pipeline = parsePipeline(`
name: reuse-defaults
stages:
  - id: a
    skill: rasen-propose
`);
      expect(resolvePipelineReuseConfig(pipeline)).toEqual({
        planner: DEFAULT_REUSE_CONFIG.planner,
        implementer: DEFAULT_REUSE_CONFIG.implementer,
        threshold: DEFAULT_REUSE_CONFIG.threshold,
        roles: {
          planner: DEFAULT_REUSE_CONFIG.threshold,
          implementer: DEFAULT_REUSE_CONFIG.threshold,
        },
      });
    });

    describe('dual-form threshold: { remainingTokens: N }', () => {
      it('parses the absolute form top-level and per-role', () => {
        const pipeline = parsePipeline(`
name: reuse-abs
reuse:
  threshold:
    remainingTokens: 200000
  roles:
    implementer:
      remainingTokens: 180000
stages:
  - id: a
    skill: rasen-propose
`);
        expect(pipeline.reuse?.threshold).toEqual({ remainingTokens: 200000 });
        expect(pipeline.reuse?.roles?.implementer).toEqual({ remainingTokens: 180000 });

        const resolved = resolvePipelineReuseConfig(pipeline);
        expect(resolved.threshold).toEqual({ remainingTokens: 200000 });
        expect(resolved.roles.implementer).toEqual({ remainingTokens: 180000 });
        expect(resolved.roles.planner).toEqual({ remainingTokens: 200000 });
      });

      it('rejects a non-positive-integer remainingTokens', () => {
        expect(() =>
          parsePipeline(`
name: bad-reuse-tokens
reuse:
  threshold:
    remainingTokens: -1
stages:
  - id: a
    skill: rasen-propose
`)
        ).toThrow(/remainingTokens must be a positive integer/);
      });

      it('rejects unknown keys inside a reuse threshold object', () => {
        expect(() =>
          parsePipeline(`
name: bad-reuse-threshold-key
reuse:
  threshold:
    remainingTokens: 1000
    bogus: 1
stages:
  - id: a
    skill: rasen-propose
`)
        ).toThrow(PipelineValidationError);
      });
    });

    describe('model preset layer', () => {
      it('applies the preset reuse threshold to a role with a matching configured model', () => {
        const pipeline = parsePipeline(`
name: reuse-preset
agents:
  implementer:
    model: gpt-5.6-sol
stages:
  - id: a
    skill: rasen-propose
`);
        const resolved = resolvePipelineReuseConfig(pipeline);
        expect(resolved.roles.implementer).toEqual({ remainingTokens: 180000 });
        // planner has no configured model → no preset → built-in default.
        expect(resolved.roles.planner).toBe(DEFAULT_REUSE_CONFIG.threshold);
      });

      it('a declared reuse.threshold or reuse.roles value wins over the preset', () => {
        const pipeline = parsePipeline(`
name: reuse-preset-override
agents:
  implementer:
    model: gpt-5.6-sol
reuse:
  threshold: 0.3
stages:
  - id: a
    skill: rasen-propose
`);
        const resolved = resolvePipelineReuseConfig(pipeline);
        expect(resolved.roles.implementer).toBe(0.3);
      });

      it('skips the preset layer when the role model has no suggested reuse threshold', () => {
        const pipeline = parsePipeline(`
name: reuse-large-window
agents:
  implementer:
    model: claude-fable-5
stages:
  - id: a
    skill: rasen-propose
`);
        const resolved = resolvePipelineReuseConfig(pipeline);
        expect(resolved.roles.implementer).toBe(DEFAULT_REUSE_CONFIG.threshold);
      });

      it('the top-level threshold has no preset layer regardless of role models', () => {
        const pipeline = parsePipeline(`
name: reuse-top-level-no-preset
agents:
  implementer:
    model: gpt-5.6-sol
stages:
  - id: a
    skill: rasen-propose
`);
        const resolved = resolvePipelineReuseConfig(pipeline);
        expect(resolved.threshold).toBe(DEFAULT_REUSE_CONFIG.threshold);
      });
    });
  });
});
