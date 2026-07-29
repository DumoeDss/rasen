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
  renameStage,
  renameV2Node,
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
        { id: 'gate', kind: 'Gate', outcomes: ['approved', 'rejected'] },
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
    def = addV2Node(def, { id: gateId, kind: 'Gate', outcomes: ['approved', 'rejected'] });
    const finishId = v2NodeIdFor('Finish', def);
    def = addV2Node(def, { id: finishId, kind: 'Finish', outcome: 'failed' });

    expect(def.root.nodes.slice(-4)).toEqual([
      {
        id: 'atomic-stage',
        kind: 'AtomicStage',
        capability: { id: 'skill:consume', version: 'sha256:consume' },
      },
      { id: 'choice', kind: 'Choice', outcomes: ['matched', 'skipped'] },
      { id: 'gate-2', kind: 'Gate', outcomes: ['approved', 'rejected'] },
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

  it('recognizes the four enabled kinds and preserves known later-slice kinds byte-for-byte', () => {
    expect(['AtomicStage', 'Gate', 'Choice', 'Finish', 'CompositeRef', 'BoundedLoop'].every(isV2EditableNodeKind)).toBe(true);
    expect(['FanOut', 'Join'].some(isV2EditableNodeKind)).toBe(false);

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

  it('retains declaration-level, definition-level, malformed, and out-of-range paths as unmapped', () => {
    const def = v2Def();
    expect(definitionIssuePathTarget(def, '/declarations/0/graph/nodes/0')).toBeNull();
    expect(definitionIssuePathTarget(def, '/limits/budget')).toBeNull();
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
});
