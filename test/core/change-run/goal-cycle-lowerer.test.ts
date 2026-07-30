import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/index.js';

const GOAL_LOOP_MEASURE = {
  version: 1,
  name: 'goal-loop-measure',
  description: 'Test measure goal loop',
  stages: [
    { id: 'define-goal', skill: 'rasen-goal-plan', role: 'planner', requires: [], gate: true },
    { id: 'iterate', skill: 'rasen-goal-iterate', role: 'implementer', requires: ['define-goal'],
      loop: { kind: 'goal' as const, gate: { kind: 'measure' as const }, maxRounds: 5, loopStallLimit: 2, blockedThreshold: 3, runArtifact: 'goal-run.json' } },
    { id: 'ship', skill: 'rasen-ship', role: 'shipper', requires: ['iterate'], gate: true, model: 'sonnet' },
  ],
} as const;

const GOAL_LOOP_RESEARCH = {
  version: 1,
  name: 'goal-loop-research',
  description: 'Test research goal loop',
  stages: [
    { id: 'define-goal', skill: 'rasen-goal-plan', role: 'planner', requires: [], gate: true },
    { id: 'iterate', skill: 'rasen-goal-iterate', role: 'implementer', requires: ['define-goal'],
      loop: { kind: 'goal' as const, gate: { kind: 'evaluate' as const }, maxRounds: 3, loopStallLimit: 2, blockedThreshold: 3, runArtifact: 'goal-run.json' } },
    { id: 'report', skill: 'rasen-goal-report', role: 'shipper', requires: ['iterate'] },
  ],
} as const;

function prepare(source: unknown): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(
    source,
    createCapabilityCatalogSnapshot([])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('goal-cycle lowerer — v1 normalization (task 5.6)', () => {
  it('normalizes goal-loop-measure to BoundedLoop with goal-cycle declaration', () => {
    const prepared = prepare(GOAL_LOOP_MEASURE);

    // The iterate stage should normalize to a BoundedLoop.
    const boundedLoop = prepared.definition.root.nodes.find(
      (n) => n.kind === 'BoundedLoop'
    );
    expect(boundedLoop).toBeDefined();
    expect(boundedLoop!.kind).toBe('BoundedLoop');

    // Verify exits: clean→exit, needs_fix→continue.
    const exits = (boundedLoop as { exits: Record<string, { action: string; outcome?: string }> }).exits;
    expect(exits.clean).toBeDefined();
    expect(exits.clean.action).toBe('exit');
    expect(exits.needs_fix).toBeDefined();
    expect(exits.needs_fix.action).toBe('continue');

    // Verify the body declaration has 2 AtomicStages with goalCyclePhase tags.
    const bodyId = (boundedLoop as { body: string }).body;
    const declaration = prepared.definition.declarations.find(
      (d) => d.id === bodyId
    );
    expect(declaration).toBeDefined();
    expect(declaration!.kind).toBe('Composite');

    const bodyNodes = declaration!.graph.nodes;
    expect(bodyNodes).toHaveLength(2);
    expect(bodyNodes.every((n) => n.kind === 'AtomicStage')).toBe(true);

    // Work phase tagged with goalCyclePhase: 'work'
    const workNode = bodyNodes.find(
      (n) => (n as unknown as { goalCyclePhase?: string }).goalCyclePhase === 'work'
    );
    expect(workNode).toBeDefined();

    // Judge phase tagged with goalCyclePhase: 'judge'
    const judgeNode = bodyNodes.find(
      (n) => (n as unknown as { goalCyclePhase?: string }).goalCyclePhase === 'judge'
    );
    expect(judgeNode).toBeDefined();

    // Verify work→judge connection exists.
    const connections = declaration!.graph.connections;
    const workToJudge = connections.find(
      (c) => c.from.node === workNode!.id && c.to.node === judgeNode!.id
    );
    expect(workToJudge).toBeDefined();

    // Verify maxIterations.
    const limits = (boundedLoop as { limits: { maxIterations: number } }).limits;
    expect(limits.maxIterations).toBe(5);
  });

  it('normalizes goal-loop-research to BoundedLoop with evaluate gate', () => {
    const prepared = prepare(GOAL_LOOP_RESEARCH);

    const boundedLoop = prepared.definition.root.nodes.find(
      (n) => n.kind === 'BoundedLoop'
    );
    expect(boundedLoop).toBeDefined();

    const limits = (boundedLoop as { limits: { maxIterations: number } }).limits;
    expect(limits.maxIterations).toBe(3);

    // Research pipeline should NOT have ship/archive stages — only a report.
    const rootNodes = prepared.definition.root.nodes;
    const hasShip = rootNodes.some(
      (n) => n.id.includes('ship') || n.id.includes('archive')
    );
    expect(hasShip).toBe(false);
  });

  it('does not affect non-goal-loop stages (atomic stages preserved)', () => {
    const prepared = prepare(GOAL_LOOP_MEASURE);

    // define-goal and ship should still be AtomicStage nodes.
    const atomicStages = prepared.definition.root.nodes.filter(
      (n) => n.kind === 'AtomicStage'
    );
    expect(atomicStages.length).toBeGreaterThanOrEqual(2);

    const defineGoal = atomicStages.find((n) => n.id.includes('define-goal'));
    expect(defineGoal).toBeDefined();
  });
});
