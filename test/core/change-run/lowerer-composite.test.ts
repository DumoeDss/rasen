import { describe, expect, it } from 'vitest';

import type {
  DefinitionSourceV2,
  PreparedDefinition,
  CapabilityDescriptor,
} from '../../../src/core/pipeline-registry/definition.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import { lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
import { RuntimePlanLowererError } from '../../../src/core/change-run/internal/lowerer.js';
import type {
  RuntimeCapabilityBinding,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { createRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import type {
  ChangeInstanceId,
  Digest,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';
import { fixtureLoopLifecycle } from './bounded-loop-fixture.js';
import { withTestAttestationAuthority } from '../../fixtures/trusted-completion.js';

const branded = <T>(value: string): T => value as T;
const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
const sha = (char: string) => branded<Digest>(`sha256:${char.repeat(64)}`);

const SKILL_PROPOSE = 'skill:propose-a';
const SKILL_APPLY = 'skill:apply-b';
const SKILL_SHIP = 'skill:ship-c';

const TEST_EXECUTION = {
  version: 1 as const,
  role: 'implementer' as const,
  workspace: { access: 'write' as const },
};

function catalogDescriptors(): readonly CapabilityDescriptor[] {
  const mk = (id: string): CapabilityDescriptor => ({
    id,
    version: '1',
    availability: 'enabled',
    inputs: [{ name: 'input', type: 'ecp/control', required: true }],
    artifacts: [{ name: 'artifact', type: 'string' }],
    outcomes: ['done'],
    limits: {},
  });
  return [mk(SKILL_PROPOSE), mk(SKILL_APPLY), mk(SKILL_SHIP)];
}

/** A minimal v2 definition with a 3-stage CompositeDeclaration body. */
function compositeDefinition(): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'test:custom-composite',
    sourceId: 'package:custom-composite',
    name: 'custom-composite',
    inputs: [],
    artifacts: [],
    outcomes: ['success'],
    declarations: [
      {
        id: 'my-comp',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [
            { id: 'stage-a', kind: 'AtomicStage', capability: { id: SKILL_PROPOSE, version: '1' }, execution: TEST_EXECUTION },
            { id: 'stage-b', kind: 'AtomicStage', capability: { id: SKILL_APPLY, version: '1' }, execution: TEST_EXECUTION },
            { id: 'stage-c', kind: 'AtomicStage', capability: { id: SKILL_SHIP, version: '1' }, execution: TEST_EXECUTION },
          ],
          connections: [
            { id: 'conn-ab', from: { node: 'stage-a', port: 'done' }, to: { node: 'stage-b', port: 'input' } },
            { id: 'conn-bc', from: { node: 'stage-b', port: 'done' }, to: { node: 'stage-c', port: 'input' } },
          ],
        },
      },
    ],
    root: {
      nodes: [
        { id: 'ref-1', kind: 'CompositeRef', declarationId: 'my-comp' },
        { id: 'finish', kind: 'Finish', outcome: 'success' },
      ],
      connections: [
        { id: 'ref-to-finish', from: { node: 'ref-1', port: 'done' }, to: { node: 'finish', port: 'start' } },
      ],
    },
  };
}

function capabilityBindings(
  prepared: PreparedDefinition
): readonly RuntimeCapabilityBinding[] {
  const bindings: RuntimeCapabilityBinding[] = [];
  for (const node of prepared.definition.root.nodes) {
    if (node.kind === 'CompositeRef') {
      const declaration = prepared.definition.declarations.find(
        (d) => d.id === node.declarationId
      );
      if (!declaration) continue;
      for (const bodyNode of declaration.graph.nodes) {
        if (bodyNode.kind !== 'AtomicStage') continue;
        const path = `declaration:${declaration.id}/node:${bodyNode.id}`;
        bindings.push(makeBinding(path));
      }
    }
  }
  return bindings;
}

function makeBinding(nodeId: string): RuntimeCapabilityBinding {
  return withTestAttestationAuthority({
    nodeId,
    authoredCapability: { id: 'skill:test', version: '1' },
    contract: { id: 'test', version: '1', digest: sha('3') },
    actionKind: 'agent',
    resultContract: { id: 'test-result', version: '1', digest: sha('4') },
    evidenceContract: { id: 'test-evidence', version: '1', digest: sha('5') },
    recovery: 'suspend-if-ambiguous',
    workspace: { access: 'write', resources: ['worktree'] },
    effects: [
      { slot: 'workspace', kind: 'workspace', resource: 'worktree', recovery: 'suspend-if-ambiguous' },
    ],
    adapter: { id: 'adapter:test', version: '1', contentDigest: sha('6') },
  });
}

function policyStages(prepared: PreparedDefinition) {
  const stages = [];
  for (const node of prepared.definition.root.nodes) {
    if (node.kind === 'CompositeRef') {
      const declaration = prepared.definition.declarations.find(
        (d) => d.id === node.declarationId
      );
      if (!declaration) continue;
      for (const bodyNode of declaration.graph.nodes) {
        if (bodyNode.kind !== 'AtomicStage') continue;
        stages.push(makePolicyStage(`declaration:${declaration.id}/node:${bodyNode.id}`));
      }
    }
  }
  return stages;
}

function makePolicyStage(nodeId: string) {
  return {
    nodeId,
    role: 'implementer',
    model: 'default',
    effort: 'default',
    runtime: 'codex',
    sandbox: 'workspace-write' as const,
    gate: false,
    sessionReuse: 'never' as const,
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'default', model: 'default', effort: 'default',
      runtime: 'default', sandbox: 'default', gate: 'default',
      sessionReuse: 'default', handoffTokenLimit: 'default', reuseRoundLimit: 'default',
    },
  };
}

function prepareComposite(source: DefinitionSourceV2 = compositeDefinition()): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(source, createCapabilityCatalogSnapshot(catalogDescriptors()));
  if (!result.ok) {
    const err = result.error as { diagnostics?: Array<{ code: string; message: string; path: string }> };
    if (err?.diagnostics) {
      for (const d of err.diagnostics) {
        console.error(`DIAG [${d.code}] ${d.path}: ${d.message}`);
      }
    }
  }
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

function lowerInput(prepared: PreparedDefinition) {
  const profile = createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:custom-composite',
      authoredContentDigest: sha('1'),
      semanticDigest: sha('2'),
    },
    capabilities: [...capabilityBindings(prepared)],
    policy: {
      format: 'effective-run-policy/1' as const,
      maxAttempts: 12,
      maxActions: 64,
      stages: policyStages(prepared),
    },
  });
  return lowerRuntimePlanInput(
    prepared,
    profile,
    runId
  );
}

describe('lowerer — CompositeRef inlining', () => {
  describe('failure-first', () => {
    it('rejects CompositeRef referencing missing declaration (at lower time)', () => {
      // Prepare with valid declaration, then mutate the prepared definition.
      const prepared = prepareComposite();
      // Simulate a missing declaration by removing it.
      const brokenDef = {
        ...prepared.definition,
        declarations: [],
      } as typeof prepared.definition;
      const brokenPrepared = { ...prepared, definition: brokenDef };
      expect(() => lowerInput(brokenPrepared)).toThrow(/missing declaration/);
    });

    it('rejects body containing non-AtomicStage node (at lower time)', () => {
      const prepared = prepareComposite();
      // Inject a BoundedLoop into the body graph.
      const decl = prepared.definition.declarations[0]!;
      const brokenDecl = {
        ...decl,
        graph: {
          ...decl.graph,
          nodes: [
            ...decl.graph.nodes,
            { id: 'nested', kind: 'BoundedLoop', body: 'x', limits: { maxIterations: 3 }, exits: {} },
          ],
        },
      };
      const brokenDef = {
        ...prepared.definition,
        declarations: [brokenDecl],
      } as typeof prepared.definition;
      const brokenPrepared = { ...prepared, definition: brokenDef };
      expect(() => lowerInput(brokenPrepared)).toThrow(/only AtomicStage/);
    });

    it('rejects body with cyclic connections (at lower time)', () => {
      const prepared = prepareComposite();
      // Make connections cyclic.
      const decl = prepared.definition.declarations[0]!;
      const brokenDecl = {
        ...decl,
        graph: {
          ...decl.graph,
          connections: [
            { id: 'c1', from: { node: 'stage-b', port: 'done' }, to: { node: 'stage-a', port: 'input' } },
            { id: 'c2', from: { node: 'stage-c', port: 'done' }, to: { node: 'stage-b', port: 'input' } },
            { id: 'c3', from: { node: 'stage-a', port: 'done' }, to: { node: 'stage-c', port: 'input' } },
          ],
        },
      };
      const brokenDef = {
        ...prepared.definition,
        declarations: [brokenDecl],
      } as typeof prepared.definition;
      const brokenPrepared = { ...prepared, definition: brokenDef };
      expect(() => lowerInput(brokenPrepared)).toThrow(/cycle/);
    });

    it('rejects missing capability binding for a body stage', () => {
      const prepared = prepareComposite();
      expect(() =>
        lowerRuntimePlanInput(
          prepared,
          createRuntimeExecutionProfile({
            sourceRevision: {
              layer: 'package',
              kind: 'pipeline-yaml',
              sourceId: 'package:custom-composite',
              authoredContentDigest: sha('1'),
              semanticDigest: sha('2'),
            },
            capabilities: [],
            policy: {
              format: 'effective-run-policy/1' as const,
              maxAttempts: 12,
              maxActions: 64,
              stages: policyStages(prepared),
            },
          }),
          runId
        )
      ).toThrow(/No frozen capability binding/);
    });
  });

  describe('happy-path', () => {
    it('a 3-stage CompositeRef produces 3 atomic nodes with correct hierarchical paths', () => {
      const prepared = prepareComposite();
      const input = lowerInput(prepared);
      const atomicNodes = input.nodes.filter((n) => n.kind === 'atomic');
      expect(atomicNodes).toHaveLength(3);

      const paths = atomicNodes.map((n) => n.hierarchicalPath).sort();
      expect(paths).toEqual([
        'root:ref-1/stage-a',
        'root:ref-1/stage-b',
        'root:ref-1/stage-c',
      ]);

      const stageA = atomicNodes.find((n) => n.hierarchicalPath === 'root:ref-1/stage-a')!;
      expect(stageA.requires).toEqual([]);

      const stageB = atomicNodes.find((n) => n.hierarchicalPath === 'root:ref-1/stage-b')!;
      expect(stageB.requires).toEqual(['root:ref-1/stage-a']);

      const stageC = atomicNodes.find((n) => n.hierarchicalPath === 'root:ref-1/stage-c')!;
      expect(stageC.requires).toEqual(['root:ref-1/stage-b']);

      // Finish node depends on terminal stage (CompositeRef exit mapping).
      const finishNode = input.nodes.find((n) => n.kind === 'finish');
      expect(finishNode).toBeDefined();
      expect(finishNode!.requires).toEqual(['root:ref-1/stage-c']);

      // Profile paths point to declaration body paths.
      expect(stageA.profilePath).toBe('declaration:my-comp/node:stage-a');
      expect(stageB.profilePath).toBe('declaration:my-comp/node:stage-b');
      expect(stageC.profilePath).toBe('declaration:my-comp/node:stage-c');
    });
  });
});

// ===== Group 3: composite-body BoundedLoop =====

function loopDefinition(): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'test:composite-loop',
    sourceId: 'package:composite-loop',
    name: 'composite-loop',
    inputs: [],
    artifacts: [],
    outcomes: ['success'],
    declarations: [
      {
        id: 'loop-body',
        kind: 'Composite',
        provenance: 'custom',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [
            { id: 'step-a', kind: 'AtomicStage', capability: { id: SKILL_PROPOSE, version: '1' }, execution: TEST_EXECUTION },
            { id: 'step-b', kind: 'AtomicStage', capability: { id: SKILL_APPLY, version: '1' }, execution: TEST_EXECUTION },
          ],
          connections: [
            { id: 'ab', from: { node: 'step-a', port: 'done' }, to: { node: 'step-b', port: 'input' } },
          ],
        },
      },
    ],
    root: {
      nodes: [
        {
          id: 'my-loop',
          kind: 'BoundedLoop',
          body: 'loop-body',
          limits: { maxIterations: 3, maxActions: 12, budget: 12 },
          lifecycle: fixtureLoopLifecycle('exhausted'),
          exits: {
            done: { action: 'exit', outcome: 'success' },
          },
        },
        { id: 'finish', kind: 'Finish', outcome: 'success' },
      ],
      connections: [
        { id: 'loop-finish', from: { node: 'my-loop', port: 'success' }, to: { node: 'finish', port: 'start' } },
      ],
    },
  };
}

function loopCapabilityBindings(
  prepared: PreparedDefinition
): readonly RuntimeCapabilityBinding[] {
  const bindings: RuntimeCapabilityBinding[] = [];
  for (const node of prepared.definition.root.nodes) {
    if (node.kind !== 'BoundedLoop') continue;
    const declaration = prepared.definition.declarations.find(
      (d) => d.id === node.body
    );
    if (!declaration) continue;
    for (const bodyNode of declaration.graph.nodes) {
      if (bodyNode.kind !== 'AtomicStage') continue;
      bindings.push(makeBinding(`declaration:${declaration.id}/node:${bodyNode.id}`));
    }
  }
  return bindings;
}

function loopPolicyStages(prepared: PreparedDefinition) {
  const stages = [];
  for (const node of prepared.definition.root.nodes) {
    if (node.kind !== 'BoundedLoop') continue;
    const declaration = prepared.definition.declarations.find(
      (d) => d.id === node.body
    );
    if (!declaration) continue;
    for (const bodyNode of declaration.graph.nodes) {
      if (bodyNode.kind !== 'AtomicStage') continue;
      stages.push(makePolicyStage(`declaration:${declaration.id}/node:${bodyNode.id}`));
    }
  }
  return stages;
}

function prepareLoop(source: DefinitionSourceV2 = loopDefinition()): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(source, createCapabilityCatalogSnapshot(catalogDescriptors()));
  if (!result.ok) {
    const err = result.error as { diagnostics?: Array<{ code: string; message: string; path: string }> };
    if (err?.diagnostics) {
      for (const d of err.diagnostics) {
        console.error(`DIAG [${d.code}] ${d.path}: ${d.message}`);
      }
    }
  }
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

function lowerLoopInput(prepared: PreparedDefinition) {
  const profile = createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:composite-loop',
      authoredContentDigest: sha('1'),
      semanticDigest: sha('2'),
    },
    capabilities: [...loopCapabilityBindings(prepared)],
    policy: {
      format: 'effective-run-policy/1' as const,
      maxAttempts: 12,
      maxActions: 64,
      stages: loopPolicyStages(prepared),
    },
  });
  return lowerRuntimePlanInput(
    prepared,
    profile,
    runId
  );
}

describe('lowerer — composite-body BoundedLoop', () => {
  it('produces a composite-body bounded-loop node for non-ReviewCycle body', () => {
    const prepared = prepareLoop();
    const input = lowerLoopInput(prepared);
    const loopNodes = input.nodes.filter((n) => n.kind === 'bounded-loop');
    expect(loopNodes).toHaveLength(1);
    const loop = loopNodes[0]!;
    expect(loop.body).toMatchObject({ kind: 'composite', declarationId: 'loop-body' });
    expect(loop.body.kind).toBe('composite');
    if (loop.body.kind !== 'composite') return;
    expect(loop.body.stages).toHaveLength(2);
    expect(loop.body.stages[0]!.hierarchicalPath).toBe('root:my-loop/step-a');
    expect(loop.body.stages[1]!.hierarchicalPath).toBe('root:my-loop/step-b');
    expect(loop.body.stages[1]!.requires).toHaveLength(1);
    expect(loop.body.stages[1]!.requires[0]).toBe('root:my-loop/step-a');
    expect(loop.body.outcomes).toEqual({ done: 'success' });
    expect(loop.limits.maxIterations).toBe(3);
  });
});

// ===== Group 6: Prepare-time gate generalization =====

describe('supportsV2ExecutableRuntime gate', () => {
  it('CompositeRef plan → reconciler executionMode', () => {
    const prepared = prepareComposite();
    expect(prepared.capability.executionMode).toBe('reconciler');
    expect(prepared.capability.executable).toBe(true);
  });

  it('composite-body BoundedLoop plan → reconciler executionMode', () => {
    const prepared = prepareLoop();
    expect(prepared.capability.executionMode).toBe('reconciler');
    expect(prepared.capability.executable).toBe(true);
  });

  it('closed pure atomic v2 plan uses the reconciler runtime', () => {
    const def: DefinitionSourceV2 = {
      version: 2,
      id: 'test:atomic-only',
      sourceId: 'package:atomic-only',
      name: 'atomic-only',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [
          { id: 'a', kind: 'AtomicStage', capability: { id: SKILL_PROPOSE, version: '1' }, execution: TEST_EXECUTION },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [
          { id: 'af', from: { node: 'a', port: 'done' }, to: { node: 'finish', port: 'start' } },
        ],
      },
    };
    const result = EcpDefinitionModule.prepare(def, createCapabilityCatalogSnapshot(catalogDescriptors()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capability.executionMode).toBe('reconciler');
  });
});

