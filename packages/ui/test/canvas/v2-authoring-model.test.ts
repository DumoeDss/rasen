import { describe, expect, it } from 'vitest';
import {
  createParallelPair,
  definitionIssuePathTarget,
  duplicateV2Definition,
  removeParallelPair,
  removeV2Node,
  renameDeclaration,
  renameV2Node,
  updateAtomicStageExecution,
  updateBodyStageExecution,
  updateBoundedLoopContract,
  updateDeclaration,
  updateDefinitionContracts,
  updateGateDecisions,
  updateGateDisposition,
  updateParallelMember,
  updateParallelContract,
  setParallelMembers,
  V2_ROOT_PALETTE_KINDS,
} from '../../src/canvas/draft.js';
import type {
  WireAtomicStageNode,
  WireBoundedLoopNode,
  WireFanOutNode,
  WireGateNode,
  WireJoinNode,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

function definition(): WirePipelineDefinitionV2 {
  return {
    version: 2,
    id: 'pipeline:canvas-parity',
    sourceId: 'fixture:canvas-parity',
    name: 'canvas-parity',
    inputs: [{ name: 'request', type: 'text/plain', required: true }],
    artifacts: [{ name: 'report', type: 'artifact/report' }],
    outcomes: ['done', 'failed'],
    limits: { maxActions: 20, budget: 20, extensionLimit: 'preserve' } as never,
    declarations: [
      {
        id: 'body',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['retry', 'done'],
        graph: {
          nodes: [
            {
              id: 'body-stage',
              kind: 'AtomicStage',
              capability: { id: 'skill:body', version: 'sha256:body' },
              execution: {
                version: 1,
                role: 'implementer',
                workspace: { access: 'write', futureWorkspace: true },
                futureExecution: { retain: true },
              },
            },
          ],
          connections: [],
          futureBodyGraph: true,
        },
        futureDeclaration: true,
      },
    ],
    root: {
      nodes: [
        {
          id: 'work',
          kind: 'AtomicStage',
          capability: { id: 'skill:work', version: 'sha256:work' },
          execution: {
            version: 1,
            role: 'implementer',
            workspace: { access: 'write', futureWorkspace: 'keep' },
            handoff: { threshold: 0.5, maxRelays: 2, futureHandoff: true },
            futureExecution: { keep: true },
          },
          futureNode: true,
        },
        {
          id: 'review',
          kind: 'AtomicStage',
          capability: { id: 'skill:review', version: 'sha256:review' },
          execution: {
            version: 1,
            role: 'reviewer',
            workspace: { access: 'read' },
          },
        },
        {
          id: 'approval',
          kind: 'Gate',
          target: 'work',
          outcomes: ['approved', 'rejected'],
          dispositions: { approved: 'proceed', rejected: 'escalate' },
        },
        {
          id: 'loop',
          kind: 'BoundedLoop',
          body: 'body',
          goalCycleVariant: 'research',
          limits: { maxIterations: 3, maxActions: 12, budget: 12 },
          lifecycle: {
            version: 1,
            thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
            strategy: {
              maxAttempts: 1,
              requireMaterialChange: true,
              capability: { id: 'skill:strategy', version: 'sha256:strategy' },
              futureStrategy: 'keep',
            },
            exits: {
              iterationLimit: { action: 'strategy' },
              actionLimit: { action: 'fail', outcome: 'action-limit' },
              budgetLimit: { action: 'fail', outcome: 'budget-limit' },
              stalled: { action: 'strategy' },
              blocked: { action: 'human-required', outcome: 'blocked' },
              strategyExhausted: { action: 'exit', outcome: 'strategy-exhausted' },
            },
            futureLifecycle: true,
          },
          exits: {
            retry: { action: 'continue' },
            done: { action: 'exit', outcome: 'done' },
          },
        },
        { id: 'body-ref', kind: 'CompositeRef', declarationId: 'body' },
        { id: 'choice', kind: 'Choice', outcomes: ['parallel', 'skip'] },
        { id: 'finish', kind: 'Finish', outcome: 'done' },
      ],
      connections: [
        {
          id: 'work-to-review',
          from: { node: 'work', port: 'done' },
          to: { node: 'review', port: 'input' },
        },
      ],
      futureGraph: true,
    },
    futureDefinition: { keep: true },
  };
}

describe('closed v2 Canvas wire vocabulary', () => {
  it('represents all eight authorable root kinds with their closed fields', () => {
    expect(V2_ROOT_PALETTE_KINDS).toEqual([
      'AtomicStage',
      'CompositeRef',
      'BoundedLoop',
      'Choice',
      'FanOut',
      'Join',
      'Gate',
      'Finish',
    ]);

    const atomic = definition().root.nodes[0] as WireAtomicStageNode;
    const gate = definition().root.nodes[2] as WireGateNode;
    const loop = definition().root.nodes[3] as WireBoundedLoopNode;
    expect(atomic.execution).toMatchObject({
      version: 1,
      role: 'implementer',
      workspace: { access: 'write' },
    });
    expect(gate).toMatchObject({
      target: 'work',
      dispositions: { approved: 'proceed', rejected: 'escalate' },
    });
    expect(loop).toMatchObject({
      goalCycleVariant: 'research',
      lifecycle: { version: 1 },
    });
  });
});

describe('v2 duplicate identity fork', () => {
  it('changes only name/id/source identity and remains authored v2', () => {
    const original = definition();
    const duplicate = duplicateV2Definition(original, 'copied-pipeline');
    expect(duplicate).toEqual({
      ...original,
      id: 'pipeline:copied-pipeline',
      sourceId: 'canvas:copied-pipeline',
      name: 'copied-pipeline',
    });
    expect(duplicate.version).toBe(2);
    expect(duplicate.root).toBe(original.root);
    expect(duplicate.declarations).toBe(original.declarations);
  });
});

describe('lossless nested v2 patches', () => {
  it('patches AtomicStage execution/workspace/handoff and clears optional fields without rebuilding siblings', () => {
    const next = updateAtomicStageExecution(definition(), 'work', {
      role: 'fixer',
      workspace: { access: 'read' },
      handoff: { threshold: 0.75 },
      model: 'gpt-next',
      effort: null,
    });
    const node = next.root.nodes[0] as WireAtomicStageNode;
    expect(node.execution).toMatchObject({
      version: 1,
      role: 'fixer',
      workspace: { access: 'read', futureWorkspace: 'keep' },
      handoff: {
        threshold: 0.75,
        maxRelays: 2,
        futureHandoff: true,
      },
      model: 'gpt-next',
      futureExecution: { keep: true },
    });
    expect(node.execution).not.toHaveProperty('effort');
    expect(node.futureNode).toBe(true);
    expect(next.root.futureGraph).toBe(true);
    expect(next.futureDefinition).toEqual({ keep: true });

    const cleared = updateAtomicStageExecution(next, 'work', {
      handoff: { maxRelays: null },
    });
    const clearedExecution = (cleared.root.nodes[0] as WireAtomicStageNode).execution!;
    expect(clearedExecution.handoff).toEqual({
      threshold: 0.75,
      futureHandoff: true,
    });
  });

  it('patches declaration-body execution without dropping body, node, workspace, or handoff extensions', () => {
    const base = definition();
    const bodyNode = base.declarations[0]!.graph.nodes[0] as WireAtomicStageNode;
    bodyNode.execution = {
      ...bodyNode.execution!,
      handoff: { maxRelays: 2, futureHandoff: 'keep' },
    };
    const next = updateBodyStageExecution(base, 'body', 'body-stage', {
      role: 'reviewer',
      workspace: { access: 'read' },
      handoff: { maxRelays: null },
    });
    const updated = next.declarations[0]!.graph.nodes[0] as WireAtomicStageNode;
    expect(updated.execution).toMatchObject({
      role: 'reviewer',
      workspace: { access: 'read', futureWorkspace: true },
      handoff: { futureHandoff: 'keep' },
      futureExecution: { retain: true },
    });
    expect(next.declarations[0]!.graph.futureBodyGraph).toBe(true);
    expect(next.declarations[0]!.futureDeclaration).toBe(true);
  });

  it('refuses duplicate or blank typed identities and non-positive authored limits in the draft model', () => {
    expect(() =>
      updateDefinitionContracts(definition(), {
        inputs: [
          { name: 'same', type: 'artifact/text' },
          { name: 'same', type: 'artifact/json' },
        ],
      })
    ).toThrow('must be unique');
    expect(() =>
      updateDefinitionContracts(definition(), {
        artifacts: [{ name: 'report', type: '' }],
      })
    ).toThrow('type cannot be blank');
    expect(() =>
      updateDefinitionContracts(definition(), { limits: { budget: 0 } })
    ).toThrow('positive integer');
  });

  it('patches definition and complete loop contracts without collapsing extension-bearing owners', () => {
    let next = updateDefinitionContracts(definition(), {
      outcomes: ['done', 'partial', 'failed'],
      limits: { budget: 30 },
    });
    next = updateBoundedLoopContract(next, 'loop', {
      limits: { maxActions: 18 },
      lifecycle: {
        thresholds: { stallIterations: 4 },
        strategy: { maxAttempts: 0, capability: null },
      },
      exits: { retry: { action: 'exit', outcome: 'partial' } },
    });
    const loop = next.root.nodes.find((node) => node.id === 'loop') as WireBoundedLoopNode;
    expect(next.limits).toEqual({
      maxActions: 20,
      budget: 30,
      extensionLimit: 'preserve',
    });
    expect(loop.limits).toEqual({ maxIterations: 3, maxActions: 18, budget: 12 });
    expect(loop.lifecycle!.thresholds).toEqual({
      stallIterations: 4,
      sameBlockerAttempts: 2,
    });
    expect(loop.lifecycle!.strategy).toEqual({
      maxAttempts: 0,
      requireMaterialChange: true,
      futureStrategy: 'keep',
    });
    expect(loop.lifecycle!.futureLifecycle).toBe(true);
    expect(loop.exits).toEqual({
      retry: { action: 'exit', outcome: 'partial' },
      done: { action: 'exit', outcome: 'done' },
    });

    next = updateDefinitionContracts(next, { limits: { budget: null } });
    next = updateBoundedLoopContract(next, 'loop', {
      limits: { budget: null },
    });
    expect(next.limits).toEqual({
      maxActions: 20,
      extensionLimit: 'preserve',
    });
    expect(
      (next.root.nodes.find((node) => node.id === 'loop') as WireBoundedLoopNode)
        .limits
    ).toEqual({ maxIterations: 3, maxActions: 18 });
  });

  it('reconciles domain exits atomically when a BoundedLoop changes body', () => {
    const base = definition();
    base.declarations.push({
      id: 'alternate-body',
      kind: 'Composite',
      provenance: 'custom',
      inputs: [],
      artifacts: [],
      outcomes: ['done', 'partial'],
      graph: {
        nodes: structuredClone(base.declarations[0]!.graph.nodes),
        connections: [],
      },
    });

    const next = updateBoundedLoopContract(base, 'loop', {
      body: 'alternate-body',
    });
    const loop = next.root.nodes.find((node) => node.id === 'loop') as WireBoundedLoopNode;

    expect(loop.body).toBe('alternate-body');
    expect(loop.exits).toEqual({
      done: { action: 'exit', outcome: 'done' },
      partial: { action: 'continue' },
    });
    expect(loop.exits).not.toHaveProperty('retry');
  });

  it('reconciles every referencing BoundedLoop when declaration outcomes change', () => {
    const base = definition();
    const firstLoop = base.root.nodes.find((node) => node.id === 'loop');
    if (!firstLoop || firstLoop.kind !== 'BoundedLoop') {
      throw new Error('loop fixture missing');
    }
    const secondLoop: WireBoundedLoopNode = {
      ...structuredClone(firstLoop),
      id: 'loop-2',
      exits: {
        retry: { action: 'exit', outcome: 'failed' },
        done: { action: 'continue' },
      },
      retainedLoopField: { keep: 'second' },
    };
    const otherDeclaration = {
      ...structuredClone(base.declarations[0]!),
      id: 'other-body',
      outcomes: ['done'],
      retainedDeclarationField: { keep: 'other' },
    };
    const unrelatedLoop: WireBoundedLoopNode = {
      ...structuredClone(firstLoop),
      id: 'other-loop',
      body: 'other-body',
      exits: { done: { action: 'exit', outcome: 'failed' } },
      retainedLoopField: { keep: 'unrelated' },
    };
    base.declarations.push(otherDeclaration);
    base.root.nodes.push(secondLoop, unrelatedLoop);

    const originalBody = base.declarations[0]!;
    const next = updateDeclaration(base, 'body', {
      outcomes: ['done', 'partial'],
    });

    expect(next.declarations[0]).toMatchObject({
      outcomes: ['done', 'partial'],
      futureDeclaration: true,
    });
    expect(next.declarations[0]!.inputs).toBe(originalBody.inputs);
    expect(next.declarations[0]!.artifacts).toBe(originalBody.artifacts);
    expect(next.declarations[0]!.graph).toBe(originalBody.graph);
    expect(next.declarations[1]).toBe(otherDeclaration);
    expect(
      (next.root.nodes.find((node) => node.id === 'loop') as WireBoundedLoopNode)
        .exits
    ).toEqual({
      done: { action: 'exit', outcome: 'done' },
      partial: { action: 'continue' },
    });
    expect(
      (next.root.nodes.find((node) => node.id === 'loop-2') as WireBoundedLoopNode)
        .exits
    ).toEqual({
      done: { action: 'continue' },
      partial: { action: 'exit', outcome: 'done' },
    });
    expect(next.root.nodes.find((node) => node.id === 'other-loop')).toBe(
      unrelatedLoop
    );
    expect(next.root.nodes.find((node) => node.id === 'work')).toBe(
      base.root.nodes.find((node) => node.id === 'work')
    );
    expect(next.root.connections).toBe(base.root.connections);
  });
});

describe('Gate sole-authority mutations', () => {
  it('keeps exactly one disposition per ordered unique decision', () => {
    let next = updateGateDecisions(definition(), 'approval', [
      'approved',
      'retry',
      'approved',
    ]);
    next = updateGateDisposition(next, 'approval', 'retry', 'fail');
    const gate = next.root.nodes.find((node) => node.id === 'approval') as WireGateNode;
    expect(gate.outcomes).toEqual(['approved', 'retry']);
    expect(gate.dispositions).toEqual({ approved: 'proceed', retry: 'fail' });
    const atomic = next.root.nodes.find((node) => node.id === 'work') as WireAtomicStageNode;
    expect(atomic.execution).not.toHaveProperty('gate');
  });
});

describe('reference-aware identity transactions', () => {
  it('renames root nodes across connections, Gate targets, and paired parallel metadata', () => {
    let next = createParallelPair(definition(), {
      fanOutId: 'experts',
      joinId: 'experts-join',
      memberNodeIds: ['work', 'review'],
      requiredMemberIds: ['work'],
      concurrencyCap: 2,
      budget: 4,
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    next = renameV2Node(next, 'work', 'apply');
    next = renameV2Node(next, 'experts-join', 'results');
    const fan = next.root.nodes.find((node) => node.kind === 'FanOut') as WireFanOutNode;
    const join = next.root.nodes.find((node) => node.kind === 'Join') as WireJoinNode;
    const gate = next.root.nodes.find((node) => node.kind === 'Gate') as WireGateNode;
    expect(next.root.connections[0]?.from.node).toBe('apply');
    expect(gate.target).toBe('apply');
    expect(fan.branches).toEqual(['apply', 'review']);
    expect(fan.members[0]).toMatchObject({ id: 'apply', hierarchicalPath: 'apply' });
    expect(fan.joinNodeId).toBe('results');
    expect(join).toMatchObject({
      id: 'results',
      inputs: ['apply', 'review'],
      requiredMembers: ['apply'],
      optionalMembers: ['review'],
    });
  });

  it('renames declarations and rewrites CompositeRef plus BoundedLoop references', () => {
    const next = renameDeclaration(definition(), 'body', 'work-body');
    expect(next.declarations[0]?.id).toBe('work-body');
    expect(next.root.nodes.find((node) => node.kind === 'CompositeRef')).toMatchObject({
      declarationId: 'work-body',
    });
    expect(next.root.nodes.find((node) => node.kind === 'BoundedLoop')).toMatchObject({
      body: 'work-body',
    });
    expect(() => renameDeclaration(next, 'work-body', '  ')).toThrow(/blank/i);
  });

  it('removes a non-final parallel member from both halves and refuses a targeted Gate stage', () => {
    let next = createParallelPair(definition(), {
      fanOutId: 'experts',
      joinId: 'experts-join',
      memberNodeIds: ['work', 'review'],
      requiredMemberIds: ['work'],
      concurrencyCap: 2,
      budget: 4,
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    expect(() => removeV2Node(next, 'work')).toThrow(/targeted by Gate/i);
    next = removeV2Node(next, 'review');
    const fan = next.root.nodes.find((node) => node.kind === 'FanOut') as WireFanOutNode;
    const join = next.root.nodes.find((node) => node.kind === 'Join') as WireJoinNode;
    expect(fan.branches).toEqual(['work']);
    expect(fan.members.map((member) => member.id)).toEqual(['work']);
    expect(join.inputs).toEqual(['work']);
    expect(join.optionalMembers).toEqual([]);
  });

  it('updates both parallel halves, refuses empty membership, and requires paired structural deletion', () => {
    let next = createParallelPair(definition(), {
      fanOutId: 'experts',
      joinId: 'experts-join',
      memberNodeIds: ['work', 'review'],
      requiredMemberIds: ['work'],
      concurrencyCap: 2,
      budget: 4,
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    next = updateParallelMember(next, 'experts', 'review', {
      required: true,
      condition: 'ui',
      hierarchicalPath: 'experts/review',
    });
    const fan = next.root.nodes.find((node) => node.kind === 'FanOut') as WireFanOutNode;
    const join = next.root.nodes.find((node) => node.kind === 'Join') as WireJoinNode;
    expect(fan.members[1]).toEqual({
      id: 'review',
      required: true,
      condition: 'ui',
      hierarchicalPath: 'experts/review',
    });
    expect(join.requiredMembers).toEqual(['work', 'review']);
    expect(join.optionalMembers).toEqual([]);
    next = updateParallelContract(next, 'experts', {
      concurrencyCap: 1,
      budget: 8,
      joinId: 'results',
      outcomes: { proceed: 'partial', failed: 'failed' },
    });
    const updatedFan = next.root.nodes.find(
      (node) => node.kind === 'FanOut'
    ) as WireFanOutNode;
    const updatedJoin = next.root.nodes.find(
      (node) => node.kind === 'Join'
    ) as WireJoinNode;
    expect(updatedFan).toMatchObject({
      concurrencyCap: 1,
      budget: 8,
      joinNodeId: 'results',
    });
    expect(updatedJoin).toMatchObject({
      id: 'results',
      outcomes: { proceed: 'partial', failed: 'failed' },
    });
    next = setParallelMembers(next, 'experts', ['review']);
    expect(
      (next.root.nodes.find((node) => node.kind === 'FanOut') as WireFanOutNode)
        .branches
    ).toEqual(['review']);
    expect(
      (next.root.nodes.find((node) => node.kind === 'Join') as WireJoinNode)
        .inputs
    ).toEqual(['review']);
    expect(() => setParallelMembers(next, 'experts', [])).toThrow(/empty membership/i);
    expect(() => removeV2Node(next, 'experts')).toThrow(/paired/i);
    expect(removeParallelPair(next, 'experts').root.nodes.map((node) => node.id)).not.toContain(
      'results'
    );

    const single = createParallelPair(definition(), {
      fanOutId: 'single',
      joinId: 'single-join',
      memberNodeIds: ['review'],
      requiredMemberIds: ['review'],
      concurrencyCap: 1,
      budget: 1,
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    expect(() => removeV2Node(single, 'review')).toThrow(/only parallel member/i);
  });
});

describe('nested server diagnostic locator', () => {
  it.each([
    ['/limits/budget', { kind: 'definition', field: 'limits/budget' }],
    [
      '/root/nodes/0/execution/workspace/access',
      { kind: 'node', index: 0, id: 'work', field: 'execution/workspace/access' },
    ],
    [
      '/root/nodes/3/lifecycle/exits/blocked/action',
      { kind: 'node', index: 3, id: 'loop', field: 'lifecycle/exits/blocked/action' },
    ],
    [
      '/declarations/0/outcomes/1',
      { kind: 'declaration', index: 0, id: 'body', field: 'outcomes/1' },
    ],
    [
      '/declarations/0/graph/nodes/0/execution/role',
      {
        kind: 'body-node',
        declarationIndex: 0,
        declarationId: 'body',
        index: 0,
        id: 'body-stage',
        field: 'execution/role',
      },
    ],
  ])('maps %s to its exact owner and nested field', (path, expected) => {
    expect(definitionIssuePathTarget(definition(), path)).toEqual(expected);
  });

  it('leaves malformed, out-of-range, and newer top-level paths unmapped', () => {
    const def = definition();
    expect(definitionIssuePathTarget(def, '/declarations/9/graph/nodes/0/id')).toBeNull();
    expect(definitionIssuePathTarget(def, '/root/nodes/nope/id')).toBeNull();
    expect(definitionIssuePathTarget(def, '/futureDefinition/keep')).toBeNull();
    expect(definitionIssuePathTarget(def, '/root/nodes/0/~2bad')).toBeNull();
  });
});
