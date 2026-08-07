import { beforeAll, describe, expect, it } from 'vitest';

import {
  freezeProductionPreparedPipelineRegistry,
  type ProductionPreparedPipelineRegistry,
} from '../../../src/core/pipeline-registry/prepared-registry.js';
import {
  preflightPreparedDefinitionExecution,
} from '../../../src/core/pipeline-registry/execution-validation.js';
import {
  projectPreparedPipelineExecutionView,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';

const CODE_GOAL_PIPELINES = ['goal-loop-measure', 'goal-loop-evaluate'] as const;

describe('goal pipeline native-v2 retention tail', () => {
  let registry: ProductionPreparedPipelineRegistry;

  beforeAll(async () => {
    registry = await freezeProductionPreparedPipelineRegistry(undefined, {
      reporter: false,
    });
  });

  describe.each(CODE_GOAL_PIPELINES)('%s', (pipelineName) => {
    it('uses the full-feature retain shape between ship and archive', () => {
      const prepared = registry.load(pipelineName).prepared;
      const source = prepared.authoredSource as DefinitionSourceV2;
      const view = projectPreparedPipelineExecutionView(prepared, registry.catalog);
      const rootStageIds = view.stages
        .filter((stage) => stage.nodePath === stage.profilePath)
        .map((stage) => stage.id);
      expect(rootStageIds).toEqual(['define-goal', 'ship', 'retain', 'archive']);
      expect(source.root.connections.map((connection) =>
        `${connection.from.node}->${connection.to.node}`
      )).toEqual(expect.arrayContaining([
        'define-goal->iterate',
        'iterate->ship',
        'ship->retain',
        'retain->archive',
        'archive->finish',
      ]));
      expect(view.stages.find((stage) => stage.id === 'retain')).toMatchObject({
        capability: { id: 'skill:rasen-retain' },
        role: 'reviewer',
        model: { value: 'sonnet', source: 'stage' },
      });
    });

    it('passes native-v2 execution preflight through the reconciler owner', () => {
      const prepared = registry.load(pipelineName).prepared;
      expect(preflightPreparedDefinitionExecution(prepared)).toMatchObject({
        mode: 'reconciler',
      });
      expect(prepared.capability).toMatchObject({
        executable: true,
        executionMode: 'reconciler',
      });
    });
  });

  it('leaves the research pipeline report-only', () => {
    const prepared = registry.load('goal-loop-research').prepared;
    const source = prepared.authoredSource as DefinitionSourceV2;
    const rootIds = source.root.nodes.map((node) => node.id);
    expect(rootIds).toEqual(['define-goal', 'gate:define-goal', 'iterate', 'report', 'finish']);
    expect(rootIds).not.toEqual(expect.arrayContaining(['ship', 'retain', 'archive']));
    expect(preflightPreparedDefinitionExecution(prepared)).toMatchObject({ mode: 'reconciler' });
  });
});
