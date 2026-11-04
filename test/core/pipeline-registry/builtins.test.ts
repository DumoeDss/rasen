import { beforeAll, describe, expect, it } from 'vitest';

import {
  freezeProductionPreparedPipelineRegistry,
  type ProductionPreparedPipelineRegistry,
} from '../../../src/core/pipeline-registry/prepared-registry.js';
import {
  listPipelines,
  loadPipelineByName,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
} from '../../../src/core/pipeline-registry/resolver.js';
import { PipelineGraph } from '../../../src/core/pipeline-registry/graph.js';
import {
  projectPreparedPipelineExecutionView,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/index.js';
import { getSkillTemplates } from '../../../src/core/shared/skill-generation.js';

const CHANGE_BUILTINS = [
  'full-feature',
  'small-feature',
  'bug-fix',
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
] as const;
const GOAL_LOOP_NAMES = [
  'goal-loop-measure',
  'goal-loop-evaluate',
  'goal-loop-research',
] as const;

describe('pipeline-registry/built-ins', () => {
  let registry: ProductionPreparedPipelineRegistry;

  beforeAll(async () => {
    registry = await freezeProductionPreparedPipelineRegistry(undefined, {
      reporter: false,
    });
  });

  const prepared = (name: typeof CHANGE_BUILTINS[number]) =>
    registry.load(name).prepared;
  const definition = (name: typeof CHANGE_BUILTINS[number]) =>
    prepared(name).authoredSource as DefinitionSourceV2;
  const view = (name: typeof CHANGE_BUILTINS[number]) =>
    projectPreparedPipelineExecutionView(prepared(name), registry.catalog);

  it('discovers and prepares exactly the six Change-level built-ins as native v2', () => {
    const listed = listPipelines();
    for (const name of CHANGE_BUILTINS) {
      expect(listed).toContain(name);
      expect(prepared(name)).toMatchObject({
        authoredVersion: 2,
        capability: { definitionValid: true, executable: true, executionMode: 'reconciler' },
      });
      expect(view(name).reconcilerSupport.supported).toBe(true);
    }
  });

  it.each(CHANGE_BUILTINS)('%s has a closed graph and exact installed capability ids', (name) => {
    const source = definition(name);
    const known = new Set(getSkillTemplates().map((item) => `skill:${item.template.name}`));
    const graphs = [source.root, ...source.declarations.map((item) => item.graph)];
    for (const graph of graphs) {
      const ids = new Set(graph.nodes.map((node) => node.id));
      for (const connection of graph.connections) {
        expect(ids.has(connection.from.node)).toBe(true);
        expect(ids.has(connection.to.node)).toBe(true);
      }
      for (const node of graph.nodes) {
        if (node.kind === 'AtomicStage') expect(known.has(node.capability.id)).toBe(true);
      }
    }
    expect(source.root.nodes.some((node) => node.kind === 'Finish')).toBe(true);
    expect(new Set(view(name).buildOrder).size).toBe(view(name).buildOrder.length);
  });

  it('full-feature retains the six-member conditional expert fan-out and retain tail', () => {
    const source = definition('full-feature');
    const fanOut = source.root.nodes.find((node) => node.kind === 'FanOut');
    expect(fanOut).toMatchObject({
      id: 'experts',
      branches: ['review', 'cso', 'benchmark', 'design-review', 'qa', 'qa-report-only'],
      concurrencyCap: 3,
      budget: 6,
      joinNodeId: 'experts-join',
    });
    if (!fanOut || fanOut.kind !== 'FanOut') return;
    expect(fanOut.members).toEqual([
      { id: 'review', hierarchicalPath: 'review', required: true, condition: 'always' },
      { id: 'cso', hierarchicalPath: 'cso', required: false, condition: 'security-relevant' },
      { id: 'benchmark', hierarchicalPath: 'benchmark', required: false, condition: 'performance-sensitive' },
      { id: 'design-review', hierarchicalPath: 'design-review', required: false, condition: 'ui' },
      { id: 'qa', hierarchicalPath: 'qa', required: false, condition: 'ui' },
      { id: 'qa-report-only', hierarchicalPath: 'qa-report-only', required: false, condition: 'non-ui' },
    ]);
    const rootConnections = source.root.connections.map((connection) =>
      `${connection.from.node}->${connection.to.node}`
    );
    expect(rootConnections).toEqual(expect.arrayContaining([
      'experts->review',
      'review->experts-join',
      'experts-join->review-loop',
      'ship->retain',
      'retain->archive',
      'archive->finish',
    ]));
    expect(source.root.nodes.some((node) => node.id === 'retro')).toBe(false);
  });

  it.each([
    ['small-feature', ['propose', 'apply', 'ship']],
    ['bug-fix', ['propose', 'apply', 'ship']],
    ['full-feature', ['office-hours', 'propose', 'apply', 'ship']],
  ] as const)('%s preserves its authored human gates', (name, ids) => {
    const source = definition(name);
    for (const id of ids) {
      const node = source.root.nodes.find((candidate) => candidate.id === id);
      expect(node?.kind).toBe('AtomicStage');
      const gate = source.root.nodes.find(
        (candidate) => candidate.kind === 'Gate' && candidate.target === id
      );
      expect(gate).toMatchObject({
        id: `gate:${id}`,
        kind: 'Gate',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed', rejected: 'escalate' },
      });
    }
  });

  it.each(['small-feature', 'bug-fix'] as const)('%s remains decompose-free', (name) => {
    const source = definition(name);
    expect(source.root.nodes.some((node) =>
      node.kind === 'AtomicStage' && node.capability.id.startsWith('pipeline:')
    )).toBe(false);
  });

  it.each(GOAL_LOOP_NAMES)('%s exposes a typed GoalLoop and its exact strategy path', (name) => {
    const source = definition(name);
    const iterate = source.root.nodes.find((node) => node.id === 'iterate');
    expect(iterate?.kind).toBe('BoundedLoop');
    if (iterate?.kind !== 'BoundedLoop') return;
    expect(iterate.goalCycleVariant).toBe(name.slice('goal-loop-'.length));
    expect(view(name).capabilityPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ profilePath: 'root:iterate/strategy' }),
    ]));
  });

  it.each(['goal-loop-measure', 'goal-loop-evaluate'] as const)(
    '%s ends in ship -> retain -> archive with sonnet policy',
    (name) => {
      const rootStages = view(name).stages.filter((stage) => stage.nodePath === stage.profilePath);
      expect(rootStages.slice(-3).map((stage) => stage.id)).toEqual(['ship', 'retain', 'archive']);
      expect(rootStages.slice(-3).every((stage) => stage.model.value === 'sonnet')).toBe(true);
      expect(rootStages.find((stage) => stage.id === 'ship')?.gate).toBe(true);
    }
  );

  it('goal-loop-research remains report-only and retains its explicit work handoff', () => {
    const rootStages = view('goal-loop-research').stages.filter(
      (stage) => stage.nodePath === stage.profilePath
    );
    expect(rootStages.map((stage) => stage.id)).toEqual(['define-goal', 'report']);
    const ids = definition('goal-loop-research').root.nodes.map((node) => node.id);
    expect(ids).not.toEqual(expect.arrayContaining(['ship', 'retain', 'archive']));
    expect(view('goal-loop-research').stages.find(
      (stage) => stage.profilePath === 'declaration:goal-cycle-body/node:work'
    )?.handoff).toMatchObject({ threshold: 0.35, source: 'stage' });
  });

  describe('auto-decompose v1 compatibility entry', () => {
    it('remains listed, starts with decompose, and resolves a decompose-free child', () => {
      expect(listPipelines()).toContain('auto-decompose');
      const pipeline = loadPipelineByName('auto-decompose');
      const graph = PipelineGraph.fromPipeline(pipeline);
      const order = graph.getBuildOrder();
      const decompose = graph.getStage(order[0])!;
      expect(decompose.kind).toBe('decompose');
      expect(decompose.gate).toBe(false);
      expect(resolveChildPipelineName(decompose)).toBe('small-feature');
      expect(() => validateDecomposeChildPipelines(
        pipeline,
        undefined,
        () => null
      )).not.toThrow();
    });
  });
});
