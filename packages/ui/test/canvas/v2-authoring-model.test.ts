import { describe, expect, it } from 'vitest';
import {
  addAtomicStageForCapability,
  addBoundedLoopOverDeclaration,
  addFinishNode,
  addParallelFrontier,
  createParallelPair,
  definitionIssuePathTarget,
  duplicateV2Definition,
  gateForStage,
  insertCompositeRef,
  removeParallelPair,
  removeV2Node,
  renameDeclaration,
  renameV2Node,
  setStageGate,
  spliceConditionOntoConnection,
  unavailableRootGestures,
  unspliceChoice,
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
  V2_BODY_PALETTE_KINDS,
  V2_ROOT_PALETTE_GESTURES,
} from '../../src/canvas/draft.js';
import * as draftModule from '../../src/canvas/draft.js';
import type {
  WireAtomicStageNode,
  WireBoundedLoopNode,
  WireChoiceNode,
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
  it('the root palette offers the four author gestures, not the eight raw node kinds', () => {
    expect(V2_ROOT_PALETTE_GESTURES).toEqual(['stage', 'parallel', 'loop', 'finish']);
    // V2_ROOT_PALETTE_KINDS (design D2) was withdrawn, not left beside the
    // gesture list — a re-added export would slip past a TS-only check if
    // nothing imported it, so this reads the module dynamically.
    expect(
      (draftModule as Record<string, unknown>).V2_ROOT_PALETTE_KINDS
    ).toBeUndefined();
  });

  it('the declaration-body palette stays constrained to AtomicStage only (executable-custom-composite)', () => {
    // The body palette must not widen alongside the root gesture rewrite —
    // it reads this same constant, unchanged since before this change.
    expect(V2_BODY_PALETTE_KINDS).toEqual(['AtomicStage']);
  });

  it('the Definition IR itself still carries all eight node kinds unchanged', () => {
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

describe('unavailableRootGestures (design D2)', () => {
  it('withholds each gesture for its own rule, independently of the others', () => {
    const def = definition();
    const withCapability = { exactCapabilities: [{ id: 'skill:new', version: 'sha256:new' }] };

    expect(unavailableRootGestures(def, { exactCapabilities: [] })).toEqual(['stage']);
    expect(unavailableRootGestures(def, withCapability)).toEqual([]);

    const noAtomicStage: WirePipelineDefinitionV2 = {
      ...def,
      root: {
        ...def.root,
        nodes: def.root.nodes.filter((node) => node.kind !== 'AtomicStage'),
      },
    };
    expect(unavailableRootGestures(noAtomicStage, withCapability)).toEqual(['parallel']);

    const noBodyDeclaration: WirePipelineDefinitionV2 = {
      ...def,
      declarations: def.declarations.map((declaration) => ({
        ...declaration,
        graph: { ...declaration.graph, nodes: [] },
      })),
    };
    expect(unavailableRootGestures(noBodyDeclaration, withCapability)).toEqual(['loop']);

    // finish is never withheld, no matter how thin the draft is
    expect(unavailableRootGestures(def, { exactCapabilities: [] })).not.toContain('finish');
  });
});

describe('gesture composition helpers (design D3)', () => {
  it('addAtomicStageForCapability appends one AtomicStage bound to the chosen capability', () => {
    const next = addAtomicStageForCapability(definition(), {
      id: 'skill:new',
      version: 'sha256:new',
    });
    const added = next.root.nodes[next.root.nodes.length - 1] as WireAtomicStageNode;
    expect(added).toMatchObject({
      kind: 'AtomicStage',
      capability: { id: 'skill:new', version: 'sha256:new' },
      execution: { version: 1, role: 'implementer', workspace: { access: 'write' } },
    });
  });

  it('addParallelFrontier fans out over every root AtomicStage, with FanOut and Join referencing each other', () => {
    const next = addParallelFrontier(definition());
    const fanOut = next.root.nodes.find((node) => node.kind === 'FanOut') as WireFanOutNode;
    const join = next.root.nodes.find((node) => node.kind === 'Join') as WireJoinNode;
    expect(fanOut.joinNodeId).toBe(join.id);
    expect(join.inputs).toEqual(fanOut.branches);
    expect(fanOut.branches).toEqual(['work', 'review']);
  });

  it('addParallelFrontier refuses when no root AtomicStage exists', () => {
    const def = definition();
    const noAtomicStage: WirePipelineDefinitionV2 = {
      ...def,
      root: { ...def.root, nodes: [], connections: [] },
    };
    expect(() => addParallelFrontier(noAtomicStage)).toThrow(/Add an AtomicStage/);
  });

  it('addBoundedLoopOverDeclaration wraps the first declaration carrying a body graph', () => {
    const next = addBoundedLoopOverDeclaration(definition());
    const added = next.root.nodes[next.root.nodes.length - 1] as WireBoundedLoopNode;
    expect(added).toMatchObject({ kind: 'BoundedLoop', body: 'body' });
  });

  it('addBoundedLoopOverDeclaration refuses when no declaration has a body graph', () => {
    const emptyDeclarations: WirePipelineDefinitionV2 = { ...definition(), declarations: [] };
    expect(() => addBoundedLoopOverDeclaration(emptyDeclarations)).toThrow(
      /No declaration is available/
    );
  });

  it("addFinishNode maps to the definition's first outcome", () => {
    const next = addFinishNode(definition());
    const added = next.root.nodes[next.root.nodes.length - 1];
    expect(added).toEqual({ id: expect.any(String), kind: 'Finish', outcome: 'done' });
  });

  it('insertCompositeRef refuses an unknown declaration and a non-referenceable one', () => {
    expect(() => insertCompositeRef(definition(), 'missing')).toThrow(/does not exist/);

    const builtInEmpty: WirePipelineDefinitionV2 = {
      ...definition(),
      declarations: [
        {
          id: 'empty-builtin',
          kind: 'Composite',
          provenance: 'built-in',
          inputs: [],
          artifacts: [],
          outcomes: [],
          graph: { nodes: [], connections: [] },
        },
      ],
    };
    expect(() => insertCompositeRef(builtInEmpty, 'empty-builtin')).toThrow(
      /no body graph to reference/
    );
  });

  it('insertCompositeRef references the requested declaration, not the first referenceable one (design D6)', () => {
    const withTwo: WirePipelineDefinitionV2 = {
      ...definition(),
      declarations: [
        ...definition().declarations,
        {
          id: 'second-body',
          kind: 'Composite',
          provenance: 'custom',
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [
              {
                id: 'second-body-stage',
                kind: 'AtomicStage',
                capability: { id: 'skill:second', version: 'sha256:second' },
                execution: { version: 1, role: 'implementer', workspace: { access: 'write' } },
              },
            ],
            connections: [],
          },
        },
      ],
    };
    // 'body' (the first, already-referenceable declaration) is deliberately
    // NOT what's requested here — the author picked the row, so this must
    // not silently fall back to the first referenceable declaration.
    const next = insertCompositeRef(withTwo, 'second-body');
    const added = next.root.nodes[next.root.nodes.length - 1];
    expect(added).toMatchObject({ kind: 'CompositeRef', declarationId: 'second-body' });
  });
});

describe('setStageGate (design D4)', () => {
  it('enabling appends a Gate with the Canvas approved/rejected vocabulary, and is idempotent', () => {
    const def = definition();
    expect(gateForStage(def, 'review')).toBeUndefined();
    const withGate = setStageGate(def, 'review', true);
    const gate = gateForStage(withGate, 'review')!;
    expect(gate).toMatchObject({
      kind: 'Gate',
      target: 'review',
      outcomes: ['approved', 'rejected'],
      dispositions: { approved: 'proceed', rejected: 'escalate' },
    });
    expect(setStageGate(withGate, 'review', true)).toBe(withGate);
  });

  it('refuses a target that is not a root AtomicStage', () => {
    expect(() => setStageGate(definition(), 'approval', true)).toThrow(
      /not a root AtomicStage/
    );
  });

  it('disabling removes the gate and its incident connections, and the stage becomes deletable again', () => {
    const def = definition();
    const wired: WirePipelineDefinitionV2 = {
      ...def,
      root: {
        ...def.root,
        connections: [
          ...def.root.connections,
          {
            id: 'work-to-approval',
            from: { node: 'work', port: 'done' },
            to: { node: 'approval', port: 'input' },
          },
        ],
      },
    };
    expect(gateForStage(wired, 'work')).toMatchObject({ id: 'approval' });

    const disabled = setStageGate(wired, 'work', false);
    expect(gateForStage(disabled, 'work')).toBeUndefined();
    expect(disabled.root.nodes.some((node) => node.id === 'approval')).toBe(false);
    expect(disabled.root.connections.some((c) => c.to.node === 'approval')).toBe(false);

    // 'work' is no longer targeted by any Gate, so removeV2Node no longer refuses it
    expect(() => removeV2Node(disabled, 'work')).not.toThrow();

    // disabling with no gate present is a no-op
    expect(setStageGate(disabled, 'work', false)).toBe(disabled);
  });
});

describe('Choice as a connection condition (design D5)', () => {
  it('splices a Choice into the connection, rewires it, and never writes legacyRuntimeOwner', () => {
    const def = definition();
    const spliced = spliceConditionOntoConnection(def, 'work-to-review', 'result.ok');

    expect(spliced.root.connections.some((c) => c.id === 'work-to-review')).toBe(false);

    const choiceNode = spliced.root.nodes.find(
      (node) => node.kind === 'Choice' && (node as WireChoiceNode).expression === 'result.ok'
    ) as (WireChoiceNode & { expression?: string; legacyRuntimeOwner?: unknown }) | undefined;
    expect(choiceNode).toBeDefined();
    expect(choiceNode!.outcomes).toEqual(['matched', 'skipped']);
    expect(choiceNode).not.toHaveProperty('legacyRuntimeOwner');

    const into = spliced.root.connections.find((c) => c.to.node === choiceNode!.id);
    const out = spliced.root.connections.find((c) => c.from.node === choiceNode!.id);
    expect(into).toMatchObject({
      from: { node: 'work', port: 'done' },
      to: { node: choiceNode!.id, port: 'input' },
    });
    expect(out).toMatchObject({
      from: { node: choiceNode!.id, port: 'matched' },
      to: { node: 'review', port: 'input' },
    });

    const unspliced = unspliceChoice(spliced, choiceNode!.id);
    expect(unspliced.root.nodes.some((node) => node.id === choiceNode!.id)).toBe(false);
    expect(unspliced.root.connections).toEqual([
      {
        id: 'work:done->review:input',
        from: { node: 'work', port: 'done' },
        to: { node: 'review', port: 'input' },
      },
    ]);
  });

  it('refuses to unsplice when the skipped branch is wired', () => {
    const def = definition();
    const spliced = spliceConditionOntoConnection(def, 'work-to-review', 'result.ok');
    const choiceNode = spliced.root.nodes.find(
      (node) => node.kind === 'Choice' && (node as WireChoiceNode).expression === 'result.ok'
    )!;
    const wired: WirePipelineDefinitionV2 = {
      ...spliced,
      root: {
        ...spliced.root,
        connections: [
          ...spliced.root.connections,
          {
            id: 'skip-to-finish',
            from: { node: choiceNode.id, port: 'skipped' },
            to: { node: 'finish', port: 'input' },
          },
        ],
      },
    };
    expect(() => unspliceChoice(wired, choiceNode.id)).toThrow(/skipped/);
  });

  it('refuses to splice onto a missing connection or a blank expression', () => {
    const def = definition();
    expect(() => spliceConditionOntoConnection(def, 'does-not-exist', 'x')).toThrow(
      /does not exist/
    );
    expect(() => spliceConditionOntoConnection(def, 'work-to-review', '   ')).toThrow(
      /blank/i
    );
  });

  it('refuses to splice onto a connection that touches a preserved read-only node', () => {
    // `spliceConditionOntoConnection`'s third refusal (task 5.1's first
    // clause), the one the other two tests do not reach. A kind outside the
    // closed editable vocabulary is preserved verbatim and must not be
    // rewired by an authoring gesture.
    const def = definition();
    const withPreserved: WirePipelineDefinitionV2 = {
      ...def,
      root: {
        ...def.root,
        nodes: [
          ...def.root.nodes,
          { id: 'future-kind', kind: 'FuturePlugin' } as unknown as
            WirePipelineDefinitionV2['root']['nodes'][number],
        ],
        connections: [
          ...def.root.connections,
          {
            id: 'work-to-future',
            from: { node: 'work', port: 'done' },
            to: { node: 'future-kind', port: 'input' },
          },
        ],
      },
    };
    expect(() =>
      spliceConditionOntoConnection(withPreserved, 'work-to-future', 'result.ok')
    ).toThrow(/read-only/);
    // The editable-endpoint connection on the SAME draft still splices, so the
    // refusal is attributable to the preserved endpoint and not to the extra
    // node merely being present.
    expect(() =>
      spliceConditionOntoConnection(withPreserved, 'work-to-review', 'result.ok')
    ).not.toThrow();
  });

  it('refuses to unsplice a Choice with a second inbound connection, naming both sources', () => {
    // `removeV2Node` drops EVERY connection incident on the Choice while only
    // one inbound edge can be restored, so a `find`-based guard would delete
    // the second with no refusal and no toast. `onConnect` imposes no per-port
    // arity limit, so two inbound edges are reachable by ordinary drags.
    const def = definition();
    const spliced = spliceConditionOntoConnection(def, 'work-to-review', 'result.ok');
    const choiceNode = spliced.root.nodes.find(
      (node) => node.kind === 'Choice' && (node as WireChoiceNode).expression === 'result.ok'
    )!;
    const twoInbound: WirePipelineDefinitionV2 = {
      ...spliced,
      root: {
        ...spliced.root,
        connections: [
          ...spliced.root.connections,
          {
            id: 'body-ref-into-choice',
            from: { node: 'body-ref', port: 'done' },
            to: { node: choiceNode.id, port: 'input' },
          },
        ],
      },
    };
    expect(() => unspliceChoice(twoInbound, choiceNode.id)).toThrow(
      /2 incoming connections/
    );
    // The message names the edge that would otherwise vanish, not just a count.
    expect(() => unspliceChoice(twoInbound, choiceNode.id)).toThrow(/'body-ref'/);
  });

  it("refuses to unsplice a Choice whose matched branch fans out to two targets", () => {
    // The `strayOut` guard cannot see this one: both edges carry port
    // 'matched', so it filters neither of them out.
    const def = definition();
    const spliced = spliceConditionOntoConnection(def, 'work-to-review', 'result.ok');
    const choiceNode = spliced.root.nodes.find(
      (node) => node.kind === 'Choice' && (node as WireChoiceNode).expression === 'result.ok'
    )!;
    const twoMatched: WirePipelineDefinitionV2 = {
      ...spliced,
      root: {
        ...spliced.root,
        connections: [
          ...spliced.root.connections,
          {
            id: 'matched-to-finish',
            from: { node: choiceNode.id, port: 'matched' },
            to: { node: 'finish', port: 'input' },
          },
        ],
      },
    };
    expect(() => unspliceChoice(twoMatched, choiceNode.id)).toThrow(
      /branch 'matched' is wired to 2 targets/
    );
    expect(() => unspliceChoice(twoMatched, choiceNode.id)).toThrow(/'finish'/);
    // One inbound + one matched outbound still unsplices — the arity guard
    // refuses duplicates, it does not refuse the ordinary case.
    expect(() => unspliceChoice(spliced, choiceNode.id)).not.toThrow();
  });
});
