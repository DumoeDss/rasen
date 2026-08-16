/**
 * Unit coverage for the pure draft-mutation module (pipeline-canvas-edit
 * design D2): cycle rejection, delete-with-reference-cleanup, rename
 * rewrites, EVERY-loader-field preservation, and issue-path mapping. No
 * canvas mount, no jsdom — same reasoning as `layout.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  addBodyConnection,
  addBodyStage,
  addDeclaration,
  addRequire,
  bodyWouldCreateCycle,
  createBlankCanvasPipelineDefinitionV2,
  createParallelPair,
  deriveSubgraphContract,
  EMPTY_CANVAS_SELECTION,
  extractSubgraph,
  insertCompositeRef,
  subgraphExtractionRefusals,
  updateBodyStage,
  addStage,
  addV2Connection,
  addV2Node,
  definitionIssuePathTarget,
  isDirty,
  isV2EditableNodeKind,
  issuePathTarget,
  removeBodyConnection,
  removeBodyStage,
  removeDeclaration,
  removeRequire,
  removeStage,
  removeV2Connection,
  removeV2Node,
  removeV2Nodes,
  renameStage,
  renameV2Node,
  selectionPanelMode,
  singletonConnectionId,
  singletonNodeId,
  stageIdFor,
  updateStageFields,
  updateStageHandoffThreshold,
  updateV2NodeFields,
  v2ConnectionIdFor,
  v2NodeIdFor,
  wouldCreateCycle,
} from '../../src/canvas/draft.js';
import type {
  WirePipelineDefinition,
  WirePipelineDefinitionV1,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

function baseDef(): WirePipelineDefinitionV1 {
  return {
    version: 1,
    name: 'demo',
    description: 'A demo pipeline',
    stages: [
      { id: 'a', kind: 'standard', requires: [], gate: false, leadReview: false },
      { id: 'b', kind: 'standard', requires: ['a'], gate: false, leadReview: false },
      { id: 'c', kind: 'standard', requires: ['b'], gate: false, leadReview: false },
    ],
  };
}

describe('createBlankCanvasPipelineDefinitionV2', () => {
  it('creates the complete browser-safe blank v2 envelope with stable identities', () => {
    expect(createBlankCanvasPipelineDefinitionV2('fresh-draft')).toEqual({
      version: 2,
      id: 'pipeline:fresh-draft',
      sourceId: 'canvas:fresh-draft',
      name: 'fresh-draft',
      inputs: [],
      artifacts: [],
      outcomes: [],
      declarations: [],
      root: { nodes: [], connections: [] },
    });
  });
});

describe('wouldCreateCycle', () => {
  it('rejects a direct cycle (b already requires a; a->b would close it back... a requiring b)', () => {
    const def = baseDef();
    // b requires a. Connecting b -> a (a would require b) closes an immediate loop.
    expect(wouldCreateCycle(def, 'b', 'a')).toBe(true);
  });

  it('rejects a transitive cycle', () => {
    const def = baseDef();
    // c requires b requires a. Connecting c -> a (a would require c) closes a transitive loop.
    expect(wouldCreateCycle(def, 'c', 'a')).toBe(true);
  });

  it('rejects a self-loop', () => {
    const def = baseDef();
    expect(wouldCreateCycle(def, 'a', 'a')).toBe(true);
  });

  it('allows a connection that does not create a cycle', () => {
    const def = baseDef();
    // Connecting a -> c (c would require a) is already implied transitively but not a cycle.
    expect(wouldCreateCycle(def, 'a', 'c')).toBe(false);
  });
});

describe('removeStage', () => {
  it('drops the stage and every requires reference to it', () => {
    const def = baseDef();
    const next = removeStage(def, 'b');
    expect(next.stages.map((s) => s.id)).toEqual(['a', 'c']);
    const c = next.stages.find((s) => s.id === 'c')!;
    expect(c.requires).toEqual([]); // 'b' reference cleaned up, no dangling edge
  });
});

describe('addRequire / removeRequire', () => {
  it('adds a dependency without duplicating an existing one', () => {
    const def = baseDef();
    const once = addRequire(def, 'a', 'c');
    expect(once.stages.find((s) => s.id === 'c')!.requires.sort()).toEqual(['a', 'b']);
    const twice = addRequire(once, 'a', 'c');
    expect(twice.stages.find((s) => s.id === 'c')!.requires.filter((r) => r === 'a')).toHaveLength(1);
  });

  it('removes a dependency', () => {
    const def = baseDef();
    const next = removeRequire(def, 'a', 'b');
    expect(next.stages.find((s) => s.id === 'b')!.requires).toEqual([]);
  });
});

describe('renameStage', () => {
  it('rewrites every requires reference to the renamed stage', () => {
    const def = baseDef();
    const next = renameStage(def, 'a', 'alpha');
    expect(next.stages.map((s) => s.id)).toEqual(['alpha', 'b', 'c']);
    expect(next.stages.find((s) => s.id === 'b')!.requires).toEqual(['alpha']);
  });
});

describe('stageIdFor', () => {
  it('derives an id from the skill and lowercases/collapses it', () => {
    const def: WirePipelineDefinition = { version: 1, name: 'demo', stages: [] };
    expect(stageIdFor('rasen-Review Cycle!', def)).toBe('rasen-review-cycle');
  });

  it('uniquifies against existing stage ids with a numeric suffix', () => {
    const def = baseDef();
    def.stages.push({ id: 'rasen-review', kind: 'standard', requires: [], gate: false, leadReview: false });
    expect(stageIdFor('rasen-review', def)).toBe('rasen-review-2');
  });

  it('falls back to "stage" when the skill collapses to nothing (all non-alphanumeric)', () => {
    const def: WirePipelineDefinition = { version: 1, name: 'demo', stages: [] };
    expect(stageIdFor('!!!', def)).toBe('stage');
    expect(stageIdFor('   ', def)).toBe('stage');
  });
});

describe('updateStageFields — EVERY-loader-field preservation', () => {
  it('preserves every unrelated definition field, byte-identical, when only one field is edited', () => {
    const def: WirePipelineDefinition = {
      version: 1,
      name: 'full-loader-coverage',
      description: 'Exercises every loader-accepted field',
      agents: {
        planner: 'claude',
        implementer: { runtime: 'codex', sessionReuse: 'run-planner', sandbox: 'workspace-write', model: 'opus-4', effort: 'high' },
      },
      handoff: { threshold: 0.6, roles: { planner: 0.5, reviewer: { remainingTokens: 40000 } }, maxRelays: 3, stallLimit: 2 },
      reuse: { planner: 'auto', implementer: 'never', threshold: 0.4, roles: { planner: 0.3 } },
      origin: 'ui',
      stages: [
        {
          id: 'goal-stage',
          kind: 'standard',
          skill: 'rasen-goal-iterate',
          role: 'implementer',
          requires: [],
          gate: true,
          loop: {
            kind: 'goal',
            gate: { kind: 'measure', command: 'npm test', threshold: 0.9, target: 1, direction: 'gte', timeoutSec: 300 },
            maxRounds: 5,
            loopStallLimit: 2,
            runArtifact: 'goal-run.json',
          },
          parallelGroup: 'checks',
          condition: 'always',
          leadReview: true,
          verifyPolicy: 'adaptive',
          runtime: 'codex',
          sessionReuse: 'review-thread',
          sandbox: 'workspace-write',
          model: 'opus-4',
          effort: 'high',
          handoff: { threshold: 0.7, maxRelays: 1, stallLimit: 1 },
        },
        {
          id: 'review-cycle-stage',
          kind: 'standard',
          skill: 'rasen-review-cycle',
          role: 'fixer',
          requires: ['goal-stage'],
          gate: true,
          loop: { kind: 'review-cycle', maxRounds: 3 },
          leadReview: false,
        },
      ],
    };

    const patched = updateStageFields(def, 'review-cycle-stage', { gate: false });

    // The edited field changed...
    expect(patched.stages[1].gate).toBe(false);
    // ...but everything else — including the untouched first stage carrying
    // every loader field (agents/handoff/reuse/goal-loop/sessionReuse/sandbox/
    // effort) and the pipeline-level agents/handoff/reuse/origin — survives
    // byte-identical in the would-be save body.
    const { stages: patchedStages, ...patchedRest } = patched;
    const { stages: origStages, ...origRest } = def;
    expect(patchedRest).toEqual(origRest);
    expect(patchedStages[0]).toEqual(origStages[0]);
    expect(patchedStages[1]).toEqual({ ...origStages[1], gate: false });
  });
});

describe('updateStageHandoffThreshold', () => {
  it('sets either supported threshold form without changing unrelated stage fields', () => {
    const def = baseDef();
    const fraction = updateStageHandoffThreshold(def, 'a', 0.65);
    expect(fraction.stages[0]).toEqual({
      ...def.stages[0],
      handoff: { threshold: 0.65 },
    });

    const remaining = updateStageHandoffThreshold(
      fraction,
      'a',
      { remainingTokens: 48_000 }
    );
    expect(remaining.stages[0].handoff).toEqual({
      threshold: { remainingTokens: 48_000 },
    });
  });

  it('preserves unexposed relay and stall limits when clearing the threshold', () => {
    const def = baseDef();
    def.stages[0] = {
      ...def.stages[0],
      handoff: { threshold: 0.7, maxRelays: 4, stallLimit: 2 },
    };

    const cleared = updateStageHandoffThreshold(def, 'a', undefined);
    expect(cleared.stages[0].handoff).toEqual({ maxRelays: 4, stallLimit: 2 });
  });

  it('removes only a truly empty handoff block after clearing the threshold', () => {
    const def = baseDef();
    def.stages[0] = { ...def.stages[0], handoff: { threshold: 0.7 } };

    const cleared = updateStageHandoffThreshold(def, 'a', undefined);
    expect(cleared.stages[0]).not.toHaveProperty('handoff');
  });
});

describe('isDirty', () => {
  it('is false for a structurally identical draft regardless of key order', () => {
    const def = baseDef();
    const reordered: WirePipelineDefinitionV1 = {
      version: def.version,
      stages: def.stages.map((s) => ({ ...s })),
      description: def.description,
      name: def.name,
    };
    expect(isDirty(reordered, def)).toBe(false);
  });

  it('is true once a field diverges', () => {
    const def = baseDef();
    const changed = updateStageFields(def, 'a', { gate: true });
    expect(isDirty(changed, def)).toBe(true);
  });
});

describe('issuePathTarget', () => {
  it('maps a stage-and-field path', () => {
    expect(issuePathTarget('/stages/2/skill')).toEqual({ stageIndex: 2, field: 'skill' });
  });

  it('maps a bare stage-index path', () => {
    expect(issuePathTarget('/stages/0')).toEqual({ stageIndex: 0 });
  });

  it('degrades pipeline-level and unrecognized paths to null (never dropped by the caller)', () => {
    expect(issuePathTarget('/stages')).toBeNull();
    expect(issuePathTarget('/')).toBeNull();
    expect(issuePathTarget('/name')).toBeNull();
  });
});

describe('addStage', () => {
  it('appends a stage verbatim', () => {
    const def = baseDef();
    const stage = { id: 'd', kind: 'standard' as const, requires: ['c'], gate: false, leadReview: false };
    const next = addStage(def, stage);
    expect(next.stages).toHaveLength(4);
    expect(next.stages[3]).toEqual(stage);
  });
});

describe('version 2 definition draft preservation', () => {
  it('edits one exposed root-node field without losing declarations or unexposed fields', () => {
    const def = {
      version: 2 as const,
      id: 'definition:v2-draft',
      sourceId: 'fixture:v2-draft',
      name: 'v2-draft',
      inputs: [{ name: 'request', type: 'text/plain', required: true }],
      artifacts: [{ name: 'report', type: 'artifact/report' }],
      outcomes: ['done', 'failed'],
      declarations: [
        {
          id: 'body',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [{ id: 'body-finish', kind: 'Finish' as const, outcome: 'done' }],
            connections: [],
          },
          unexposed: { preserve: true },
        },
      ],
      root: {
        nodes: [
          {
            id: 'finish',
            kind: 'Finish' as const,
            outcome: 'done',
            position: { x: 10, y: 20 },
            unexposed: { preserve: 'node' },
          },
        ],
        connections: [],
        unexposed: { preserve: 'graph' },
      },
      limits: { maxActions: 4, budget: 4 },
      unexposed: { preserve: 'definition' },
    } satisfies WirePipelineDefinition;

    const next = updateV2NodeFields(def, 'finish', { outcome: 'failed' });

    expect(next.root.nodes[0]).toEqual({
      ...def.root.nodes[0],
      outcome: 'failed',
    });
    expect(next.declarations).toEqual(def.declarations);
    expect(next.root.unexposed).toEqual(def.root.unexposed);
    expect(next.unexposed).toEqual(def.unexposed);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  });
});

function v2Def(): WirePipelineDefinitionV2 {
  return {
    version: 2,
    id: 'definition:v2-canvas',
    sourceId: 'fixture:v2-canvas',
    name: 'v2-canvas',
    inputs: [{ name: 'request', type: 'text/plain', required: true }],
    artifacts: [],
    outcomes: ['done', 'failed'],
    declarations: [],
    root: {
      nodes: [
        {
          id: 'produce',
          kind: 'AtomicStage',
          capability: { id: 'skill:produce', version: 'sha256:produce' },
          hidden: { preserve: true },
        },
        {
          id: 'gate',
          kind: 'Gate',
          target: 'produce',
          outcomes: ['approved', 'rejected'],
          dispositions: { approved: 'proceed', rejected: 'escalate' },
        },
        { id: 'finish', kind: 'Finish', outcome: 'done' },
      ],
      connections: [],
      hidden: { preserve: 'root' },
    },
    hidden: { preserve: 'definition' },
  };
}

describe('version 2 root graph reducer', () => {
  it('creates every enabled root kind with stable unique ids and authored defaults', () => {
    let def = v2Def();
    const atomicId = v2NodeIdFor('AtomicStage', def);
    expect(atomicId).toBe('atomic-stage');
    def = addV2Node(def, {
      id: atomicId,
      kind: 'AtomicStage',
      capability: { id: 'skill:consume', version: 'sha256:consume' },
    });
    const choiceId = v2NodeIdFor('Choice', def);
    def = addV2Node(def, { id: choiceId, kind: 'Choice', outcomes: ['matched', 'skipped'] });
    const gateId = v2NodeIdFor('Gate', def);
    def = addV2Node(def, {
      id: gateId,
      kind: 'Gate',
      target: 'produce',
      outcomes: ['approved', 'rejected'],
      dispositions: { approved: 'proceed', rejected: 'escalate' },
    });
    const finishId = v2NodeIdFor('Finish', def);
    def = addV2Node(def, { id: finishId, kind: 'Finish', outcome: 'failed' });

    expect(def.root.nodes.slice(-4)).toEqual([
      {
        id: 'atomic-stage',
        kind: 'AtomicStage',
        capability: { id: 'skill:consume', version: 'sha256:consume' },
      },
      { id: 'choice', kind: 'Choice', outcomes: ['matched', 'skipped'] },
      {
        id: 'gate-2',
        kind: 'Gate',
        target: 'produce',
        outcomes: ['approved', 'rejected'],
        dispositions: { approved: 'proceed', rejected: 'escalate' },
      },
      { id: 'finish-2', kind: 'Finish', outcome: 'failed' },
    ]);
    expect(v2NodeIdFor('Gate', def)).toBe('gate-3');
    expect(def.hidden).toEqual({ preserve: 'definition' });
    expect(def.root.hidden).toEqual({ preserve: 'root' });
  });

  it('connects typed ports with a stable identity, rewrites endpoints on rename, and cleans edges on delete', () => {
    let def = v2Def();
    def = addV2Node(def, {
      id: 'consume',
      kind: 'AtomicStage',
      capability: { id: 'skill:consume', version: 'sha256:consume' },
    });
    const id = v2ConnectionIdFor(def, {
      source: 'produce',
      sourcePort: 'patch',
      target: 'consume',
      targetPort: 'patch',
    });
    expect(id).toBe('produce:patch->consume:patch');
    def = addV2Connection(def, {
      id,
      from: { node: 'produce', port: 'patch' },
      to: { node: 'consume', port: 'patch' },
    });
    expect(def.root.connections[0]).toEqual({
      id: 'produce:patch->consume:patch',
      from: { node: 'produce', port: 'patch' },
      to: { node: 'consume', port: 'patch' },
    });
    expect(
      v2ConnectionIdFor(def, {
        source: 'produce',
        sourcePort: 'patch',
        target: 'consume',
        targetPort: 'patch',
      })
    ).toBe('produce:patch->consume:patch-2');

    def = renameV2Node(def, 'consume', 'verify');
    expect(def.root.connections[0].to.node).toBe('verify');
    expect(def.root.nodes.find((node) => node.id === 'produce')?.hidden).toEqual({
      preserve: true,
    });

    def = removeV2Connection(def, id);
    expect(def.root.connections).toEqual([]);
    def = addV2Connection(def, {
      id: 'finish-edge',
      from: { node: 'produce', port: 'done' },
      to: { node: 'finish', port: 'in' },
    });
    def = removeV2Node(def, 'finish');
    expect(def.root.nodes.some((node) => node.id === 'finish')).toBe(false);
    expect(def.root.connections).toEqual([]);
  });

  it('recognizes all eight enabled root kinds and preserves unrelated nodes byte-for-byte', () => {
    expect(['AtomicStage', 'Gate', 'Choice', 'Finish', 'CompositeRef', 'BoundedLoop'].every(isV2EditableNodeKind)).toBe(true);
    expect(['FanOut', 'Join'].every(isV2EditableNodeKind)).toBe(true);

    const def = v2Def();
    def.root.nodes.push(
      {
        id: 'composite',
        kind: 'CompositeRef',
        declarationId: 'review-body',
        futurePayload: { preserve: ['all', 'fields'] },
      },
      {
        id: 'fan',
        kind: 'FanOut',
        branches: ['a', 'b'],
        concurrencyCap: 2,
        budget: 2,
        joinNodeId: 'join',
        members: [
          { id: 'a', hierarchicalPath: 'a', required: true, condition: 'always' },
          { id: 'b', hierarchicalPath: 'b', required: false, condition: 'always' },
        ],
        futurePayload: { preserve: true },
      }
    );
    const beforeUnsupported = structuredClone(def.root.nodes.slice(-2));
    const next = updateV2NodeFields(def, 'finish', { outcome: 'failed' });

    expect(next.root.nodes.slice(-2)).toEqual(beforeUnsupported);
  });
});

describe('definitionIssuePathTarget', () => {
  it('maps v2 root node paths to the node and nested property', () => {
    expect(definitionIssuePathTarget(v2Def(), '/root/nodes/1/outcomes/0')).toEqual({
      kind: 'node',
      index: 1,
      id: 'gate',
      field: 'outcomes/0',
    });
  });

  it('maps v2 root connection paths to the edge and endpoint property', () => {
    const def = v2Def();
    def.root.connections.push({
      id: 'typed-edge',
      from: { node: 'produce', port: 'patch' },
      to: { node: 'gate', port: 'in' },
    });
    expect(definitionIssuePathTarget(def, '/root/connections/0/to/port')).toEqual({
      kind: 'connection',
      index: 0,
      id: 'typed-edge',
      field: 'to/port',
    });
  });

  it('maps definition fields while retaining absent declarations, malformed, and out-of-range paths as unmapped', () => {
    const def = v2Def();
    expect(definitionIssuePathTarget(def, '/declarations/0/graph/nodes/0')).toBeNull();
    expect(definitionIssuePathTarget(def, '/limits/budget')).toEqual({
      kind: 'definition',
      field: 'limits/budget',
    });
    expect(definitionIssuePathTarget(def, '/root/nodes/99/id')).toBeNull();
    expect(definitionIssuePathTarget(def, '/root/connections/nope')).toBeNull();
  });

  it('keeps the existing v1 locator behavior through the shared entry point', () => {
    expect(definitionIssuePathTarget(baseDef(), '/stages/1/handoff/threshold')).toEqual({
      kind: 'node',
      index: 1,
      id: 'b',
      field: 'handoff/threshold',
    });
  });
});

// ===== ECP-2: Composite declaration CRUD =====

describe('Composite declaration CRUD', () => {
  function emptyV2(): WirePipelineDefinitionV2 {
    return {
      version: 2,
      id: 'test',
      sourceId: 'test',
      name: 'test',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: { nodes: [], connections: [] },
    };
  }

  it('creates a declaration → references from root → round-trip', () => {
    let def = emptyV2();
    def = addDeclaration(def, 'my-comp');
    expect(def.declarations).toHaveLength(1);
    expect(def.declarations[0]!.id).toBe('my-comp');
    expect(def.declarations[0]!.provenance).toBe('custom');
    expect(def.declarations[0]!.outcomes).toEqual(['done']);

    // Reference from root.
    def = addV2Node(def, {
      id: 'ref-1',
      kind: 'CompositeRef',
      declarationId: 'my-comp',
    } as never);
    expect(def.root.nodes).toHaveLength(1);
    expect(def.root.nodes[0]!.kind).toBe('CompositeRef');
  });

  it('rejects duplicate declaration id', () => {
    let def = emptyV2();
    def = addDeclaration(def, 'dup');
    expect(() => addDeclaration(def, 'dup')).toThrow(/already exists/);
  });

  it('rejects a blank declaration id in the MODEL, not just the panel', () => {
    // The blank-id rule used to live only in `DeclarationsPanel`'s disabled
    // state — the inverse of the one-owner discipline every other refusal in
    // that panel follows. Any caller, not just the button, must be refused.
    const def = emptyV2();
    expect(() => addDeclaration(def, '')).toThrow(/cannot be blank/);
    expect(() => addDeclaration(def, '   ')).toThrow(/cannot be blank/);
    expect(def.declarations).toHaveLength(0);
  });

  it('blocks deleting a referenced declaration', () => {
    let def = emptyV2();
    def = addDeclaration(def, 'used');
    def = addV2Node(def, {
      id: 'ref-1',
      kind: 'CompositeRef',
      declarationId: 'used',
    } as never);
    expect(() => removeDeclaration(def, 'used')).toThrow(/still referenced/);
  });

  it('allows deleting an unreferenced declaration', () => {
    let def = emptyV2();
    def = addDeclaration(def, 'unused');
    def = removeDeclaration(def, 'unused');
    expect(def.declarations).toHaveLength(0);
  });

  it('adds and removes body stages', () => {
    let def = emptyV2();
    def = addDeclaration(def, 'comp');
    def = addBodyStage(def, 'comp', {
      id: 'step-a',
      capability: { id: 'skill:test', version: '1' },
    });
    def = addBodyStage(def, 'comp', {
      id: 'step-b',
      capability: { id: 'skill:test2', version: '1' },
    });
    expect(def.declarations[0]!.graph.nodes).toHaveLength(2);
    def = removeBodyStage(def, 'comp', 'step-a');
    expect(def.declarations[0]!.graph.nodes).toHaveLength(1);
    expect(def.declarations[0]!.graph.nodes[0]!.id).toBe('step-b');
  });

  it('adds and removes body connections', () => {
    let def = emptyV2();
    def = addDeclaration(def, 'comp');
    def = addBodyStage(def, 'comp', { id: 'a', capability: { id: 'x', version: '1' } });
    def = addBodyStage(def, 'comp', { id: 'b', capability: { id: 'y', version: '1' } });
    def = addBodyConnection(def, 'comp', {
      id: 'ab',
      from: { node: 'a', port: 'done' },
      to: { node: 'b', port: 'input' },
    });
    expect(def.declarations[0]!.graph.connections).toHaveLength(1);
    def = removeBodyConnection(def, 'comp', 'ab');
    expect(def.declarations[0]!.graph.connections).toHaveLength(0);
  });

  // --- ECP-2 "Canvas edits composite body stages", delivered by ECP-5 -----

  /** A declaration with two body stages and, optionally, an `a -> b` edge. */
  function withBody(id: string, connected: boolean) {
    let def = emptyV2();
    def = addDeclaration(def, id);
    def = addBodyStage(def, id, { id: 'a', capability: { id: 'x', version: '1' } });
    def = addBodyStage(def, id, { id: 'b', capability: { id: 'y', version: '1' } });
    if (connected) {
      def = addBodyConnection(def, id, {
        id: 'ab',
        from: { node: 'a', port: 'done' },
        to: { node: 'b', port: 'input' },
      });
    }
    return def;
  }

  it('refuses a body connection that would close a cycle', () => {
    // "#### Scenario: Body connection creating a cycle is rejected".
    const def = withBody('comp', true);
    expect(() =>
      addBodyConnection(def, 'comp', {
        id: 'ba',
        from: { node: 'b', port: 'done' },
        to: { node: 'a', port: 'input' },
      })
    ).toThrow(/would create a cycle/);
    // Self-edges are cycles too.
    expect(() =>
      addBodyConnection(def, 'comp', {
        id: 'aa',
        from: { node: 'a', port: 'done' },
        to: { node: 'a', port: 'input' },
      })
    ).toThrow(/would create a cycle/);
  });

  it('scopes the body cycle rule to ONE declaration', () => {
    // DISCRIMINATING PROBE. `b -> a` is a cycle in X (which has `a -> b`) and
    // perfectly legal in Y (which has the same two stages and no edges). An
    // implementation that pooled all declarations' connections, or that read
    // `root.connections`, refuses BOTH — and a single-declaration fixture
    // cannot tell either wrong implementation from the right one.
    let def = withBody('x', true);
    def = addDeclaration(def, 'y');
    def = addBodyStage(def, 'y', { id: 'a', capability: { id: 'x', version: '1' } });
    def = addBodyStage(def, 'y', { id: 'b', capability: { id: 'y', version: '1' } });

    expect(bodyWouldCreateCycle(def, 'x', 'b', 'a')).toBe(true);
    expect(bodyWouldCreateCycle(def, 'y', 'b', 'a')).toBe(false);

    const next = addBodyConnection(def, 'y', {
      id: 'ba',
      from: { node: 'b', port: 'done' },
      to: { node: 'a', port: 'input' },
    });
    expect(next.declarations.find((d) => d.id === 'y')!.graph.connections).toHaveLength(1);
    // …and X is untouched by Y's edit.
    expect(next.declarations.find((d) => d.id === 'x')!.graph.connections).toHaveLength(1);
  });

  it('refuses a body connection to an unknown stage or a duplicate edge', () => {
    const def = withBody('comp', true);
    expect(() =>
      addBodyConnection(def, 'comp', {
        id: 'ac',
        from: { node: 'a', port: 'done' },
        to: { node: 'ghost', port: 'input' },
      })
    ).toThrow(/does not exist/);
    expect(() =>
      addBodyConnection(def, 'comp', {
        id: 'ab-again',
        from: { node: 'a', port: 'done' },
        to: { node: 'b', port: 'input' },
      })
    ).toThrow(/already connected/);
  });

  it('renaming a body stage rewrites its incident connections', () => {
    // DISCRIMINATING PROBE. A `updateBodyStage` that patches only the node
    // leaves the edge pointing at an id the graph no longer contains — a
    // silently disconnected body, the same failure class F1 exists to close.
    const def = updateBodyStage(withBody('comp', true), 'comp', 'a', { id: 'apply' });
    const declaration = def.declarations[0]!;
    expect((declaration.graph.nodes as { id: string }[]).map((n) => n.id)).toEqual([
      'apply',
      'b',
    ]);
    expect(declaration.graph.connections).toHaveLength(1);
    expect(declaration.graph.connections[0]!.from.node).toBe('apply');
    expect(declaration.graph.connections[0]!.to.node).toBe('b');
    // Ports are untouched by a rename.
    expect(declaration.graph.connections[0]!.from.port).toBe('done');
  });

  it('edits a body stage capability without disturbing the graph', () => {
    const def = updateBodyStage(withBody('comp', true), 'comp', 'b', {
      capability: { id: 'z', version: '2' },
    });
    const node = (def.declarations[0]!.graph.nodes as { id: string; capability: { id: string } }[])
      .find((n) => n.id === 'b')!;
    expect(node.capability).toEqual({ id: 'z', version: '2' });
    expect(def.declarations[0]!.graph.connections).toHaveLength(1);
  });

  it('refuses a blank, duplicate, or unknown body stage edit', () => {
    const def = withBody('comp', true);
    expect(() => updateBodyStage(def, 'comp', 'a', { id: '  ' })).toThrow(/cannot be blank/);
    expect(() => updateBodyStage(def, 'comp', 'a', { id: 'b' })).toThrow(/already exists/);
    expect(() => updateBodyStage(def, 'comp', 'ghost', { id: 'c' })).toThrow(/does not exist/);
  });
});

// ===== canvas-multi-selection: the selection model and the batch removal =====

function selectionOf(
  nodeIds: readonly string[],
  connectionIds: readonly string[] = []
) {
  return {
    nodeIds: new Set(nodeIds),
    connectionIds: new Set(connectionIds),
  };
}

describe('selectionPanelMode / singleton accessors', () => {
  it('maps every selection shape to its panel mode', () => {
    expect(selectionPanelMode(EMPTY_CANVAS_SELECTION)).toBe('empty');
    expect(selectionPanelMode(selectionOf(['a']))).toBe('node');
    expect(selectionPanelMode(selectionOf([], ['c']))).toBe('connection');
    // Any mix, and any two-or-more, is the multi state.
    expect(selectionPanelMode(selectionOf(['a'], ['c']))).toBe('multi');
    expect(selectionPanelMode(selectionOf(['a', 'b']))).toBe('multi');
    expect(selectionPanelMode(selectionOf([], ['c1', 'c2']))).toBe('multi');
  });

  it('yields the singleton id only for an exactly-one selection', () => {
    expect(singletonNodeId(EMPTY_CANVAS_SELECTION)).toBeNull();
    expect(singletonNodeId(selectionOf(['a']))).toBe('a');
    // One node PLUS one connection is not a node selection.
    expect(singletonNodeId(selectionOf(['a'], ['c']))).toBeNull();
    expect(singletonNodeId(selectionOf(['a', 'b']))).toBeNull();

    expect(singletonConnectionId(selectionOf([], ['c']))).toBe('c');
    expect(singletonConnectionId(selectionOf(['a'], ['c']))).toBeNull();
    expect(singletonConnectionId(selectionOf([], ['c1', 'c2']))).toBeNull();
    expect(singletonConnectionId(EMPTY_CANVAS_SELECTION)).toBeNull();
  });
});

/** v2Def() plus a second member, a parallel pair over both, and two connections (one incident to the pair). */
function pairedDef(): WirePipelineDefinitionV2 {
  let def = v2Def();
  def = addV2Node(def, {
    id: 'review',
    kind: 'AtomicStage',
    capability: { id: 'skill:review', version: 'sha256:review' },
  });
  def = createParallelPair(def, {
    fanOutId: 'fan',
    joinId: 'join',
    memberNodeIds: ['produce', 'review'],
    requiredMemberIds: ['produce'],
    concurrencyCap: 2,
    budget: 2,
    outcomes: { proceed: 'done', failed: 'failed' },
  });
  def = addV2Connection(def, {
    id: 'produce:done->finish:input',
    from: { node: 'produce', port: 'done' },
    to: { node: 'finish', port: 'input' },
  });
  def = addV2Connection(def, {
    id: 'fan:produce->join:produce',
    from: { node: 'fan', port: 'produce' },
    to: { node: 'join', port: 'produce' },
  });
  return def;
}

describe('removeV2Nodes', () => {
  it('co-deletes the paired Join with a selected FanOut, selected or not', () => {
    const plan = removeV2Nodes(pairedDef(), new Set(['fan']));
    expect(plan.removedIds).toEqual(['fan', 'join']);
    expect(plan.refused).toEqual([]);
    expect(plan.next.root.nodes.map((node) => node.id)).toEqual([
      'produce',
      'gate',
      'finish',
      'review',
    ]);
    // The pair's incident connection is gone; the member-to-finish edge survives.
    expect(plan.next.root.connections.map((connection) => connection.id)).toEqual([
      'produce:done->finish:input',
    ]);
  });

  it('treats a pair selected on both halves as one unit — no refusal, one removal', () => {
    const plan = removeV2Nodes(pairedDef(), new Set(['fan', 'join']));
    expect(plan.removedIds).toEqual(['fan', 'join']);
    expect(plan.refused).toEqual([]);
  });

  it('refuses a lone Join whose FanOut is not selected, with the existing paired-deletion message', () => {
    const plan = removeV2Nodes(pairedDef(), new Set(['join']));
    expect(plan.removedIds).toEqual([]);
    expect(plan.refused).toEqual([
      { id: 'join', reason: 'FanOut and Join require explicit paired deletion.' },
    ]);
  });

  it('refuses a Gate-targeted node with the existing removeV2Node message', () => {
    const plan = removeV2Nodes(pairedDef(), new Set(['produce']));
    expect(plan.removedIds).toEqual([]);
    expect(plan.refused.map((refusal) => refusal.id)).toEqual(['produce']);
    expect(plan.refused[0]!.reason).toMatch(/targeted by Gate 'gate'/);
  });

  it('refuses a parallel pair\'s last member', () => {
    let def = removeV2Node(v2Def(), 'gate');
    def = createParallelPair(def, {
      fanOutId: 'fan',
      joinId: 'join',
      memberNodeIds: ['produce'],
      requiredMemberIds: ['produce'],
      concurrencyCap: 1,
      budget: 1,
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    const plan = removeV2Nodes(def, new Set(['produce']));
    expect(plan.removedIds).toEqual([]);
    expect(plan.refused.map((refusal) => refusal.id)).toEqual(['produce']);
    expect(plan.refused[0]!.reason).toMatch(/only parallel member of 'fan'/);
  });

  it('reports a mixed batch as removed-plus-refused in draft order, one plan', () => {
    // produce is Gate-targeted, finish is plain, join is a lone barrier.
    const plan = removeV2Nodes(pairedDef(), new Set(['finish', 'join', 'produce']));
    expect(plan.removedIds).toEqual(['finish']);
    expect(plan.refused.map((refusal) => refusal.id)).toEqual(['produce', 'join']);
    expect(plan.next.root.nodes.map((node) => node.id)).toEqual([
      'produce',
      'gate',
      'review',
      'fan',
      'join',
    ]);
  });

  it('removes a member together with its pair when both are selected', () => {
    const plan = removeV2Nodes(pairedDef(), new Set(['review', 'fan']));
    expect(plan.removedIds).toEqual(['review', 'fan', 'join']);
    expect(plan.refused).toEqual([]);
    expect(plan.next.root.nodes.map((node) => node.id)).toEqual([
      'produce',
      'gate',
      'finish',
    ]);
  });

  it('removes EVERY member of a selected pair plus the pair, with no last-member refusal', () => {
    // DISCRIMINATING PROBE for the pairs-first ordering: processing members
    // before the FanOut would remove the first member (2 members -> 1) and
    // then REFUSE the second as the pair's only remaining member — an order
    // artifact for the natural box-select of a frontier plus its members.
    // The FanOut's pair removal goes first, so both members are judged as
    // plain nodes and the whole selection deletes. (The gate is dropped so
    // 'produce' carries no Gate-target refusal of its own.)
    let def = removeV2Node(v2Def(), 'gate');
    def = addV2Node(def, {
      id: 'review',
      kind: 'AtomicStage',
      capability: { id: 'skill:review', version: 'sha256:review' },
    });
    def = createParallelPair(def, {
      fanOutId: 'fan',
      joinId: 'join',
      memberNodeIds: ['produce', 'review'],
      requiredMemberIds: ['produce'],
      concurrencyCap: 2,
      budget: 2,
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    const plan = removeV2Nodes(def, new Set(['produce', 'review', 'fan']));
    expect(plan.removedIds).toEqual(['produce', 'review', 'fan', 'join']);
    expect(plan.refused).toEqual([]);
    expect(plan.next.root.nodes.map((node) => node.id)).toEqual(['finish']);
  });

  it('is a no-op for an empty batch or ids the draft does not carry', () => {
    const def = pairedDef();
    expect(removeV2Nodes(def, new Set())).toEqual({
      next: def,
      removedIds: [],
      refused: [],
    });
    expect(removeV2Nodes(def, new Set(['ghost']))).toEqual({
      next: def,
      removedIds: [],
      refused: [],
    });
  });

  it('skips a kind outside the editable vocabulary silently — not removed, not refused', () => {
    const def = pairedDef();
    def.root.nodes.push({
      id: 'future-sentinel',
      kind: 'FutureSentinel',
    } as never);
    const plan = removeV2Nodes(def, new Set(['future-sentinel', 'finish']));
    expect(plan.removedIds).toEqual(['finish']);
    expect(plan.refused).toEqual([]);
    expect(
      plan.next.root.nodes.some((node) => node.id === 'future-sentinel')
    ).toBe(true);
  });
});

// ===== canvas-subgraph-extraction: refusals, derivation, transaction =====

/** The canonical extraction shape: a --(e-ab)--> b --(e-bc)--> c --(e-cf)--> f(finish). */
function extractionDef(): WirePipelineDefinitionV2 {
  const stage = (id: string) => ({
    id,
    kind: 'AtomicStage' as const,
    capability: { id: `skill:${id}`, version: `sha256:${id}` },
    execution: {
      version: 1 as const,
      role: 'implementer' as const,
      workspace: { access: 'write' as const },
    },
    retained: { note: `keep ${id}` },
  });
  return {
    version: 2,
    id: 'definition:extraction',
    sourceId: 'fixture:extraction',
    name: 'extraction',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [],
    root: {
      nodes: [stage('a'), stage('b'), stage('c'), { id: 'f', kind: 'Finish' as const, outcome: 'done' }],
      connections: [
        {
          id: 'e-ab',
          from: { node: 'a', port: 'done' },
          to: { node: 'b', port: 'input' },
          condition: 'always',
        },
        {
          id: 'e-bc',
          from: { node: 'b', port: 'done' },
          to: { node: 'c', port: 'input' },
        },
        {
          id: 'e-cf',
          from: { node: 'c', port: 'done' },
          to: { node: 'f', port: 'input' },
        },
      ],
    },
  };
}

describe('subgraphExtractionRefusals', () => {
  const refusals = (def: WirePipelineDefinitionV2, ids: readonly string[]) =>
    subgraphExtractionRefusals(def, {
      nodeIds: new Set(ids),
      connectionIds: new Set<string>(),
    });

  it('refuses an empty selection and a selection carrying unknown ids', () => {
    expect(refusals(extractionDef(), []).length).toBe(1);
    expect(refusals(extractionDef(), [])[0]).toMatch(/Select at least one stage/);
    expect(refusals(extractionDef(), ['ghost'])[0]).toMatch(
      /Node 'ghost' does not exist/
    );
  });

  it('accepts a plain chained pair — the happy path is empty', () => {
    expect(refusals(extractionDef(), ['b', 'c'])).toEqual([]);
  });

  it('names every non-AtomicStage kind in a mixed selection', () => {
    const messages = refusals(extractionDef(), ['b', 'f']);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/Only plain stages can be packaged/);
    expect(messages[0]).toMatch(/'f' is a Finish/);
  });

  it('refuses a stage an outside Gate targets, in raw and prefixed form', () => {
    const raw = extractionDef();
    raw.root.nodes.push({
      id: 'gate-1',
      kind: 'Gate',
      target: 'c',
      outcomes: ['approve'],
      dispositions: { approve: 'proceed' },
    });
    expect(refusals(raw, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is targeted by Gate 'gate-1' outside the selection/
    );

    const prefixed = extractionDef();
    prefixed.root.nodes.push({
      id: 'gate-1',
      kind: 'Gate',
      target: 'stage:c',
      outcomes: ['approve'],
      dispositions: { approve: 'proceed' },
    });
    expect(refusals(prefixed, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is targeted by Gate 'gate-1'/
    );
  });

  it('reads references on a fully normalized (stage:-prefixed) fixture', () => {
    // The engine's v1 normalizer writes node ids AND references prefixed —
    // the raw-exact check must still resolve them.
    const def = extractionDef();
    def.root.nodes = def.root.nodes.map((node) =>
      node.id === 'c' ? { ...node, id: 'stage:c' } : node
    );
    def.root.connections = def.root.connections.map((connection) => ({
      ...connection,
      from: connection.from.node === 'c' ? { ...connection.from, node: 'stage:c' } : connection.from,
      to: connection.to.node === 'c' ? { ...connection.to, node: 'stage:c' } : connection.to,
    }));
    def.root.nodes.push({
      id: 'gate-1',
      kind: 'Gate',
      target: 'stage:c',
      outcomes: ['approve'],
      dispositions: { approve: 'proceed' },
    });
    expect(refusals(def, ['b', 'stage:c'])[0]).toMatch(
      /Stage 'stage:c' is targeted by Gate 'gate-1'/
    );
  });

  it('refuses a stage counted by an outside FanOut — branches, member ids, and hierarchicalPath', () => {
    const byBranch = extractionDef();
    byBranch.root.nodes.push({
      id: 'fan',
      kind: 'FanOut',
      branches: ['c'],
      concurrencyCap: 1,
      budget: 1,
      joinNodeId: 'join',
      members: [],
    });
    expect(refusals(byBranch, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is a branch or member of FanOut 'fan' outside the selection/
    );

    const byMember = extractionDef();
    byMember.root.nodes.push({
      id: 'fan',
      kind: 'FanOut',
      branches: [],
      concurrencyCap: 1,
      budget: 1,
      joinNodeId: 'join',
      members: [
        {
          id: 'unrelated',
          hierarchicalPath: 'stage:c',
          required: true,
          condition: 'always',
        },
      ],
    });
    // hierarchicalPath carries the prefixed form while the id points elsewhere
    // — the prefixed check must still catch it.
    expect(refusals(byMember, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is a branch or member of FanOut 'fan'/
    );
  });

  it('refuses a stage listed by an outside Join — inputs, required, and optional', () => {
    const byInput = extractionDef();
    byInput.root.nodes.push({
      id: 'join',
      kind: 'Join',
      inputs: ['stage:c'],
      requiredMembers: [],
      optionalMembers: [],
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    expect(refusals(byInput, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is an input of Join 'join' outside the selection/
    );

    const byOptional = extractionDef();
    byOptional.root.nodes.push({
      id: 'join',
      kind: 'Join',
      inputs: [],
      requiredMembers: [],
      optionalMembers: ['c'],
      outcomes: { proceed: 'done', failed: 'failed' },
    });
    expect(refusals(byOptional, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is an input of Join 'join'/
    );
  });

  it('refuses a stage referenced by a consultation binding — raw, prefixed, and reverse-prefixed forms', () => {
    const binding = (sourceStage: string) => ({
      sourceStage,
      teacherSkill: 'skill:teacher',
      maxConsultationsPerInvocation: 1,
      maxTeacherAttemptsPerConsultation: 1,
    });
    const raw = extractionDef();
    raw.consultations = [binding('c')];
    expect(refusals(raw, ['b', 'c'])[0]).toMatch(
      /Stage 'c' is referenced by a consultation binding/
    );

    const prefixed = extractionDef();
    prefixed.consultations = [binding('stage:c')];
    expect(refusals(prefixed, ['b', 'c'])[0]).toMatch(/Stage 'c'/);

    // Reverse hybrid: node ids are v1-normalized but the consultation mirrors
    // the raw v1 stage id — the reverse-prefix check must catch it.
    const reverse = extractionDef();
    reverse.root.nodes = reverse.root.nodes.map((node) =>
      node.id === 'c' ? { ...node, id: 'stage:c' } : node
    );
    reverse.consultations = [binding('c')];
    expect(refusals(reverse, ['b', 'stage:c'])[0]).toMatch(
      /Stage 'stage:c' is referenced by a consultation binding/
    );
  });

  it('collects several blockers at once — one string each', () => {
    const def = extractionDef();
    def.root.nodes.push(
      {
        id: 'gate-1',
        kind: 'Gate',
        target: 'b',
        outcomes: ['approve'],
        dispositions: { approve: 'proceed' },
      },
      { id: 'f2', kind: 'Finish', outcome: 'done' }
    );
    const messages = refusals(def, ['b', 'c', 'f2']);
    expect(messages).toHaveLength(2);
    // Rule-1 kind refusals emit per selected node before the structural
    // rules run — assert presence, not order.
    expect(messages.some((message) => /targeted by Gate 'gate-1'/.test(message))).toBe(
      true
    );
    expect(messages.some((message) => /'f2' is a Finish/.test(message))).toBe(true);
  });
});

describe('deriveSubgraphContract', () => {
  it('derives one input and one outcome per severed cut, named after the stages', () => {
    const def = extractionDef();
    expect(deriveSubgraphContract(def, new Set(['b', 'c']))).toEqual({
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
    });
  });

  it('suffixes colliding names — one row per distinct (stage, port)', () => {
    const def = extractionDef();
    def.root.connections.push(
      {
        id: 'e-ab2',
        from: { node: 'a', port: 'brief' },
        to: { node: 'b', port: 'artifact/brief' },
      },
      {
        id: 'e-cf2',
        from: { node: 'c', port: 'reviewed' },
        to: { node: 'f', port: 'input' },
      }
    );
    expect(deriveSubgraphContract(def, new Set(['b', 'c']))).toEqual({
      inputs: [
        { name: 'b', type: 'input' },
        { name: 'b-2', type: 'artifact/brief' },
      ],
      artifacts: [],
      outcomes: ['c', 'c-2'],
    });
  });

  it('defaults to the single outcome "done" when no outgoing edge is severed', () => {
    // Every edge has both ends inside {a,b,c,f}, so nothing is severed. (A
    // lone {a} WOULD sever a->b and derive outcome 'a' — derivation has no
    // kind rules of its own.)
    expect(deriveSubgraphContract(extractionDef(), new Set(['a', 'b', 'c', 'f']))).toEqual({
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
    });
    expect(deriveSubgraphContract(extractionDef(), new Set())).toEqual({
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
    });
  });

  it('deduplicates repeated severed edges onto the same (stage, port)', () => {
    const def = extractionDef();
    def.root.connections.push({
      id: 'e-ab-dup',
      from: { node: 'a', port: 'done' },
      to: { node: 'b', port: 'input' },
    });
    expect(deriveSubgraphContract(def, new Set(['b', 'c']))).toEqual({
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
    });
  });
});

describe('extractSubgraph', () => {
  it('moves the body verbatim, rewires the crossings, and preserves extension fields', () => {
    const def = extractionDef();
    const bNode = def.root.nodes[1]!;
    const cNode = def.root.nodes[2]!;
    const internal = def.root.connections[1]!;
    const result = extractSubgraph(def, {
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
    });

    // The declaration: custom, with the reviewed contract and the moved body.
    expect(result.declarationId).toBe('block');
    expect(result.refId).toBe('composite-ref');
    const declaration = result.next.declarations.find((d) => d.id === 'block')!;
    expect(declaration.provenance).toBe('custom');
    expect(declaration.inputs).toEqual([{ name: 'b', type: 'input' }]);
    expect(declaration.outcomes).toEqual(['c']);

    // VERBATIM: the moved stages and internal connection are the same values
    // (ids, execution blocks, and retained extension fields included).
    expect(declaration.graph.nodes).toHaveLength(2);
    expect(declaration.graph.nodes[0]).toBe(bNode);
    expect(declaration.graph.nodes[1]).toBe(cNode);
    expect(declaration.graph.connections).toEqual([internal]);

    // The root keeps only the untouched nodes plus the ref.
    expect(result.next.root.nodes.map((node) => node.id)).toEqual([
      'a',
      'f',
      'composite-ref',
    ]);
    const ref = result.next.root.nodes[2]!;
    expect(ref.kind).toBe('CompositeRef');
    if (ref.kind === 'CompositeRef') expect(ref.declarationId).toBe('block');

    // The crossings rewired onto the mapped ports with fresh endpoint-derived
    // ids, extension fields carried, and only identity/endpoints rewritten.
    const connections = result.next.root.connections;
    expect(connections.map((connection) => connection.id)).toEqual([
      'a:done->composite-ref:b',
      'composite-ref:c->f:input',
    ]);
    const inbound = connections[0]!;
    expect(inbound.from).toEqual({ node: 'a', port: 'done' });
    expect(inbound.to).toEqual({ node: 'composite-ref', port: 'b' });
    expect(inbound.condition).toBe('always');
    const outbound = connections[1]!;
    expect(outbound.from).toEqual({ node: 'composite-ref', port: 'c' });
    expect(outbound.to).toEqual({ node: 'f', port: 'input' });

    // The internal edge left the root and the original ids died with the endpoints.
    expect(
      result.next.root.connections.some((connection) => connection.id === 'e-ab')
    ).toBe(false);
  });

  it('never stamps legacyRuntimeOwner on any moved node or the ref', () => {
    const result = extractSubgraph(extractionDef(), {
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
    });
    for (const declaration of result.next.declarations) {
      for (const node of declaration.graph.nodes) {
        expect(node).not.toHaveProperty('legacyRuntimeOwner');
      }
    }
    for (const node of result.next.root.nodes) {
      expect(node).not.toHaveProperty('legacyRuntimeOwner');
    }
  });

  it('maps severed edges onto REVIEWED rows — a renamed outcome renames the port', () => {
    const result = extractSubgraph(extractionDef(), {
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [{ name: 'entry', type: 'control' }],
      artifacts: [{ name: 'patch', type: 'artifact/text' }],
      outcomes: ['complete'],
    });
    const declaration = result.next.declarations.find((d) => d.id === 'block')!;
    expect(declaration.inputs).toEqual([{ name: 'entry', type: 'control' }]);
    expect(declaration.artifacts).toEqual([{ name: 'patch', type: 'artifact/text' }]);
    expect(declaration.outcomes).toEqual(['complete']);
    const connections = result.next.root.connections;
    expect(connections[0]!.to).toEqual({ node: 'composite-ref', port: 'entry' });
    expect(connections[1]!.from).toEqual({ node: 'composite-ref', port: 'complete' });
    expect(connections.map((connection) => connection.id)).toEqual([
      'a:done->composite-ref:entry',
      'composite-ref:complete->f:input',
    ]);
  });

  it('falls back to the derived port name when a derived row was deleted in review', () => {
    const result = extractSubgraph(extractionDef(), {
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [],
      artifacts: [],
      outcomes: [],
    });
    // No rows survive review, so the edges land on the derived defaults —
    // the declaration itself carries no such port, and Validate stays the
    // authority for the (deliberately possible) red cut.
    expect(result.next.root.connections[0]!.to).toEqual({
      node: 'composite-ref',
      port: 'b',
    });
    expect(result.next.root.connections[1]!.from).toEqual({
      node: 'composite-ref',
      port: 'c',
    });
  });

  it('re-runs the refusal rules — the dialog is not trusted', () => {
    const def = extractionDef();
    def.root.nodes.push({
      id: 'gate-1',
      kind: 'Gate',
      target: 'c',
      outcomes: ['approve'],
      dispositions: { approve: 'proceed' },
    });
    expect(() =>
      extractSubgraph(def, {
        nodeIds: new Set(['b', 'c']),
        id: 'block',
        inputs: [{ name: 'b', type: 'input' }],
        artifacts: [],
        outcomes: ['c'],
      })
    ).toThrow(/targeted by Gate 'gate-1'/);
    expect(
      () =>
        extractSubgraph(extractionDef(), {
          nodeIds: new Set(['b', 'c']),
          id: 'block',
          inputs: [{ name: 'b', type: 'input' }],
          artifacts: [],
          outcomes: ['c'],
        })
    ).not.toThrow();
  });

  it('enforces the declaration id and contract row rules with the model vocabulary', () => {
    const input = (over: Partial<Parameters<typeof extractSubgraph>[1]>) => ({
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
      ...over,
    });
    expect(() => extractSubgraph(extractionDef(), input({ id: '' }))).toThrow(
      /cannot be blank/
    );
    const taken = extractionDef();
    taken.declarations.push({
      id: 'block',
      kind: 'Composite',
      provenance: 'custom',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      graph: { nodes: [], connections: [] },
    });
    expect(() => extractSubgraph(taken, input({}))).toThrow(/already exists/);
    expect(() =>
      extractSubgraph(extractionDef(), input({ inputs: [{ name: '', type: 'input' }] }))
    ).toThrow(/name cannot be blank/);
    expect(() =>
      extractSubgraph(
        extractionDef(),
        input({ inputs: [
          { name: 'x', type: 'input' },
          { name: 'x', type: 'input' },
        ] })
      )
    ).toThrow(/names must be unique/);
    expect(() =>
      extractSubgraph(extractionDef(), input({ outcomes: ['', 'c'] }))
    ).toThrow(/outcome cannot be blank/);
  });

  it('leaves the result re-referenceable — a second insertCompositeRef appends another ref', () => {
    const result = extractSubgraph(extractionDef(), {
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
    });
    const reReferenced = insertCompositeRef(result.next, 'block');
    const refs = reReferenced.root.nodes.filter(
      (node) => node.kind === 'CompositeRef' && node.declarationId === 'block'
    );
    expect(refs.map((node) => node.id)).toEqual(['composite-ref', 'composite-ref-2']);
  });

  it('keeps a valid pre-extraction draft shape-valid post-extraction (rows, ports, sibling loops)', () => {
    const def = extractionDef();
    def.declarations.push({
      id: 'loop-body',
      kind: 'Composite',
      provenance: 'custom',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      graph: {
        nodes: [
          {
            id: 'body-step',
            kind: 'AtomicStage',
            capability: { id: 'skill:body', version: 'sha256:body' },
          },
        ],
        connections: [],
      },
    });
    def.root.nodes.push({
      id: 'loop',
      kind: 'BoundedLoop',
      body: 'loop-body',
      limits: { maxIterations: 2, maxActions: 8, budget: 8 },
      exits: { done: { action: 'exit', outcome: 'done' } },
    });
    const loopNode = def.root.nodes[def.root.nodes.length - 1]!;

    const result = extractSubgraph(def, {
      nodeIds: new Set(['b', 'c']),
      id: 'block',
      inputs: [{ name: 'b', type: 'input' }],
      artifacts: [],
      outcomes: ['c'],
    });

    // The sibling BoundedLoop is untouched — same value, same exits.
    const loopAfter = result.next.root.nodes.find((node) => node.id === 'loop')!;
    expect(loopAfter).toBe(loopNode);
    expect(loopAfter).toEqual({
      id: 'loop',
      kind: 'BoundedLoop',
      body: 'loop-body',
      limits: { maxIterations: 2, maxActions: 8, budget: 8 },
      exits: { done: { action: 'exit', outcome: 'done' } },
    });

    // The extracted declaration's rows are unique and non-blank, and every
    // rewired port names a declared handle of the ref's declaration.
    const declaration = result.next.declarations.find((d) => d.id === 'block')!;
    const inputNames = declaration.inputs.map((row) => row.name);
    expect(new Set(inputNames).size).toBe(inputNames.length);
    expect(inputNames.every(Boolean)).toBe(true);
    const outcomeNames = declaration.outcomes;
    expect(new Set(outcomeNames).size).toBe(outcomeNames.length);
    expect(outcomeNames.every(Boolean)).toBe(true);
    for (const connection of result.next.root.connections) {
      if (connection.to.node === result.refId) {
        expect(inputNames).toContain(connection.to.port);
      }
      if (connection.from.node === result.refId) {
        expect(outcomeNames).toContain(connection.from.port);
      }
    }
  });
});
