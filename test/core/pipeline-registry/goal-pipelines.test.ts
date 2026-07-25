import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { validatePipelineForExecution } from '../../../src/core/pipeline-registry/execution-validation.js';
import { PipelineGraph } from '../../../src/core/pipeline-registry/graph.js';
import { PipelineValidationError } from '../../../src/core/pipeline-registry/pipeline.js';
import { loadPipelineByName } from '../../../src/core/pipeline-registry/resolver.js';
import {
  completedStages,
  parseRunState,
} from '../../../src/core/pipeline-registry/run-state.js';

const CODE_GOAL_PIPELINES = ['goal-loop-measure', 'goal-loop-evaluate'] as const;

async function withGoalProfile(run: () => Promise<void>): Promise<void> {
  const originalRasenHome = process.env.RASEN_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-goal-preflight-'));
  process.env.RASEN_HOME = tempHome;
  fs.writeFileSync(
    path.join(tempHome, 'config.json'),
    JSON.stringify({
      profile: 'custom',
      workflows: [
        'goal-plan',
        'goal-iterate',
        'goal-report',
        'goal-command',
        'ship-command',
        'archive',
      ],
      retention: 'codify',
      expertSelectionExplicit: true,
    })
  );
  try {
    await run();
  } finally {
    if (originalRasenHome === undefined) {
      delete process.env.RASEN_HOME;
    } else {
      process.env.RASEN_HOME = originalRasenHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

describe('goal pipeline retention tail', () => {
  describe.each(CODE_GOAL_PIPELINES)('%s', (pipelineName) => {
    it('uses the full-feature retain shape between ship and archive', () => {
      const pipeline = loadPipelineByName(pipelineName);

      expect(pipeline.stages.map((stage) => stage.id)).toEqual([
        'define-goal',
        'iterate',
        'ship',
        'retain',
        'archive',
      ]);
      expect(pipeline.stages.find((stage) => stage.id === 'retain')).toMatchObject({
        skill: 'rasen-retain',
        role: 'reviewer',
        requires: ['ship'],
        model: 'sonnet',
      });
      expect(pipeline.stages.find((stage) => stage.id === 'archive')?.requires).toEqual([
        'retain',
      ]);

      const graph = PipelineGraph.fromPipeline(pipeline);
      expect(graph.getBuildOrder()).toEqual([
        'define-goal',
        'iterate',
        'ship',
        'retain',
        'archive',
      ]);
    });

    it('naturally exposes retain for a legacy run awaiting archive', () => {
      const state = parseRunState(
        JSON.stringify({
          pipeline: pipelineName,
          retention: 'off',
          stages: {
            'define-goal': { status: 'done' },
            iterate: { status: 'done' },
            ship: { status: 'done' },
            archive: { status: 'pending' },
          },
        })
      );
      const graph = PipelineGraph.fromPipeline(loadPipelineByName(pipelineName));
      const completed = new Set(completedStages(state));

      expect(state.stages?.retain).toBeUndefined();
      expect(graph.getNextStages(completed)).toEqual(['retain']);

      completed.add('retain');
      expect(graph.getNextStages(completed)).toEqual(['archive']);
    });

    it('passes execution preflight with a goal-capable profile and its retention dependency', async () => {
      await withGoalProfile(async () => {
        await expect(
          validatePipelineForExecution(loadPipelineByName(pipelineName))
        ).resolves.toBeUndefined();
      });
    });

    it('reports the canonical disabled-skill diagnostic through execution preflight', async () => {
      await withGoalProfile(async () => {
        const pipeline = loadPipelineByName(pipelineName);
        const retain = pipeline.stages.find((stage) => stage.id === 'retain');
        if (!retain) throw new Error('expected retain stage');
        retain.skill = 'rasen-tdd';

        try {
          await validatePipelineForExecution(pipeline);
          expect.fail('expected disabled stage skill to fail preflight');
        } catch (error) {
          expect(error).toBeInstanceOf(PipelineValidationError);
          expect(error).toMatchObject({ code: 'pipeline_skill_disabled' });
        }
      });
    });

    it('reports the canonical unknown-skill diagnostic through execution preflight', async () => {
      await withGoalProfile(async () => {
        const pipeline = loadPipelineByName(pipelineName);
        const retain = pipeline.stages.find((stage) => stage.id === 'retain');
        if (!retain) throw new Error('expected retain stage');
        retain.skill = 'rasen-missing';

        try {
          await validatePipelineForExecution(pipeline);
          expect.fail('expected missing stage skill to fail preflight');
        } catch (error) {
          expect(error).toBeInstanceOf(PipelineValidationError);
          expect(error).toMatchObject({ code: 'pipeline_skill_unknown' });
        }
      });
    });

    it('keeps a migrated legacy archived run complete', () => {
      const state = parseRunState(
        JSON.stringify({
          pipeline: pipelineName,
          stages: {
            'define-goal': { status: 'done' },
            iterate: { status: 'done' },
            ship: { status: 'done' },
            archive: { status: 'done' },
          },
        })
      );
      const graph = PipelineGraph.fromPipeline(loadPipelineByName(pipelineName));

      expect(graph.isComplete(new Set(completedStages(state)))).toBe(true);
    });
  });

  it('leaves the research pipeline report-only', () => {
    const pipeline = loadPipelineByName('goal-loop-research');
    const ids = pipeline.stages.map((stage) => stage.id);

    expect(ids).toEqual(['define-goal', 'iterate', 'report']);
    expect(ids).not.toContain('ship');
    expect(ids).not.toContain('retain');
    expect(ids).not.toContain('archive');
  });
});
