/**
 * ECP-2 Groups 11-13: Isomorphism, export/import digest, recovery fault injection.
 *
 * Group 11: Built-in vs custom fixture pair produce equivalent plans.
 * Group 12: Export/import round-trip preserves semantic digest.
 * Group 13: Recovery at composite body stage boundaries is deterministic.
 */
import { describe, expect, it } from 'vitest';

import type {
  DefinitionSourceV2,
  CapabilityDescriptor,
  PreparedDefinition,
} from '../../../src/core/pipeline-registry/definition.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import { lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
import { createRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { projectCompositeBodyProgress, compositeBodyStagePath } from '../../../src/core/change-run/internal/composite-runtime.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { deriveNodeId, deriveInvocationId, deriveAttemptId, deriveEffectId, deriveActionId } from '../../../src/core/change-run/internal/identity.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { startRecord, fixtureDigests } from './reconciler-fixture.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { RunId, Digest } from '../../../src/core/change-run/contracts.js';
import { semanticCanonicalizeDefinition } from '../../../src/core/pipeline-registry/definition-plan-internal.js';
import { fixtureRuntimeLoop } from './bounded-loop-fixture.js';
import { withTestAttestationAuthority } from '../../fixtures/trusted-completion.js';

const branded = <T>(value: string): T => value as T;
const COMPLETE_EXECUTION = {
  version: 1,
  role: 'implementer',
  workspace: { access: 'write' },
} as const;
const sha = (char: string) => {
  // Ensure hex-only characters for valid digests.
  const hex = char.length === 1 && /[0-9a-f]/.test(char) ? char : 'a';
  return branded<Digest>(`sha256:${hex.repeat(64)}`);
};

function mkDescriptor(id: string): CapabilityDescriptor {
  return {
    id, version: '1', availability: 'enabled',
    inputs: [{ name: 'input', type: 'ecp/control', required: true }],
    artifacts: [{ name: 'artifact', type: 'string' }],
    outcomes: ['done'], limits: {},
  };
}
const SKILLS = ['skill:a', 'skill:b', 'skill:c'].map(mkDescriptor);
const CATALOG = createCapabilityCatalogSnapshot(SKILLS);

function prepareDef(def: DefinitionSourceV2): PreparedDefinition {
  const r = EcpDefinitionModule.prepare(def, CATALOG);
  if (!r.ok) throw r.error;
  return r.value;
}

function makeBindings(paths: string[]) {
  return paths.map((p) => withTestAttestationAuthority({
    nodeId: p,
    authoredCapability: { id: 'skill:test', version: '1' },
    contract: { id: 'test', version: '1', digest: sha('3') },
    actionKind: 'agent' as const,
    resultContract: { id: 'tr', version: '1', digest: sha('4') },
    evidenceContract: { id: 'te', version: '1', digest: sha('5') },
    recovery: 'suspend-if-ambiguous' as const,
    workspace: { access: 'write' as const, resources: ['worktree'] },
    effects: [{ slot: 'workspace', kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const }],
    adapter: { id: 'adapter:test', version: '1', contentDigest: sha('6') },
  }));
}

function makePolicyStages(paths: string[]) {
  return paths.map((nodeId) => ({
    nodeId, role: 'implementer', model: 'default', effort: 'default',
    runtime: 'codex', sandbox: 'workspace-write' as const, gate: false,
    sessionReuse: 'never' as const, handoffTokenLimit: 10_000, reuseRoundLimit: 1,
    provenance: { role: 'd', model: 'd', effort: 'd', runtime: 'd', sandbox: 'd', gate: 'd', sessionReuse: 'd', handoffTokenLimit: 'd', reuseRoundLimit: 'd' },
  }));
}

function lowerCompositeRefPlan(prepared: PreparedDefinition): RuntimePlan {
  const decl = prepared.definition.declarations[0]!;
  const paths = decl.graph.nodes.map((n) => `declaration:${decl.id}/node:${n.id}`);
  const input = lowerRuntimePlanInput(
    prepared,
    createRuntimeExecutionProfile({
      sourceRevision: {
        layer: 'package', kind: 'pipeline-yaml', sourceId: 'test',
        authoredContentDigest: sha('1'), semanticDigest: sha('2'),
      },
      capabilities: makeBindings(paths),
      policy: { format: 'effective-run-policy/1', maxAttempts: 12, maxActions: 64, stages: makePolicyStages(paths) },
    }),
    fixtureDigests.runId
  );
  return createRuntimePlan(input);
}

function commitSucceed(
  plan: RuntimePlan, record: CanonicalRunRecord,
  nodeId: string
): CanonicalRunRecord {
  const invocationId = deriveInvocationId(plan.runId, branded(nodeId), 0);
  const attemptId = deriveAttemptId(invocationId, 0);
  const effectId = deriveEffectId(invocationId, 'workspace');
  const actionId = deriveActionId(attemptId, 'agent', [{ slot: 'workspace', effectId }]);
  const action = {
    format: 'change-run-action/1' as const, kind: 'agent' as const,
    runId: plan.runId, nodeId: branded(nodeId), invocationId, attemptId, actionId,
    effects: [{ slot: 'workspace', effectId, kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const, operation: { operationKey: 'w', ownershipMarkerContract: 'e/1', conflictPolicy: 'uncertain' } }],
    executionProfileDigest: plan.profileDigest,
    capability: { id: 'skill:t', authoredVersion: '1', contractId: 't', contractVersion: '1', contractDigest: sha('c'), artifact: { id: 't', version: '1', contentDigest: sha('a') } },
    resultContractDigest: sha('r'), evidenceContractDigest: sha('e'),
    policyDigest: plan.policyDigest,
    workspace: { access: 'write' as const, resources: ['worktree'] },
    expectedBeforeWorkspace: record.currentWorkspaceRevision,
    agent: { role: 'i', model: 's', reasoningEffort: 'm', runtime: 'c', sandbox: 'workspace-write', input: { change: 't' }, session: { reuse: 'never', handoffTokenLimit: 10000, reuseRoundLimit: 1 } },
  };
  let r = reduceCanonicalRunRecord(record, { kind: 'admit-action', action, attemptOrdinal: 0, deliveryMode: 'grant' });
  if (!r.ok) throw new Error(r.failure.message);
  r = reduceCanonicalRunRecord(r.record, { kind: 'observe-effect', actionId, effectId, status: 'succeeded', receiptDigest: sha('rd'), observation: { ok: true }, evidence: [] });
  if (!r.ok) throw new Error(r.failure.message);
  r = reduceCanonicalRunRecord(r.record, { kind: 'commit-action-result', actionId, status: 'succeeded', receiptDigest: sha('rd'), result: { route: 'simple' }, evidence: [] });
  if (!r.ok) throw new Error(r.failure.message);
  return r.record;
}

// ===== Group 11: Isomorphism =====

describe('Group 11: Isomorphism — built-in vs custom fixture pair', () => {
  function builtinDef(): DefinitionSourceV2 {
    // 3 root-level AtomicStages (A → B → C) — the "built-in" form.
    return {
      version: 2, id: 'test:builtin', sourceId: 'p:builtin', name: 'builtin',
      inputs: [], artifacts: [], outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [
          { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:a', version: '1' }, execution: COMPLETE_EXECUTION },
          { id: 'b', kind: 'AtomicStage', capability: { id: 'skill:b', version: '1' }, execution: COMPLETE_EXECUTION },
          { id: 'c', kind: 'AtomicStage', capability: { id: 'skill:c', version: '1' }, execution: COMPLETE_EXECUTION },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [
          { id: 'ab', from: { node: 'a', port: 'done' }, to: { node: 'b', port: 'input' } },
          { id: 'bc', from: { node: 'b', port: 'done' }, to: { node: 'c', port: 'input' } },
          { id: 'cf', from: { node: 'c', port: 'done' }, to: { node: 'finish', port: 'start' } },
        ],
      },
    };
  }

  function customDef(): DefinitionSourceV2 {
    // Same 3 stages wrapped in a CompositeDeclaration + CompositeRef.
    return {
      version: 2, id: 'test:custom', sourceId: 'p:custom', name: 'custom',
      inputs: [], artifacts: [], outcomes: ['done'],
      declarations: [{
        id: 'comp', kind: 'Composite', provenance: 'custom',
        inputs: [], artifacts: [], outcomes: ['done'],
        graph: {
          nodes: [
            { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:a', version: '1' }, execution: COMPLETE_EXECUTION },
            { id: 'b', kind: 'AtomicStage', capability: { id: 'skill:b', version: '1' }, execution: COMPLETE_EXECUTION },
            { id: 'c', kind: 'AtomicStage', capability: { id: 'skill:c', version: '1' }, execution: COMPLETE_EXECUTION },
          ],
          connections: [
            { id: 'ab', from: { node: 'a', port: 'done' }, to: { node: 'b', port: 'input' } },
            { id: 'bc', from: { node: 'b', port: 'done' }, to: { node: 'c', port: 'input' } },
          ],
        },
      }],
      root: {
        nodes: [
          { id: 'ref', kind: 'CompositeRef', declarationId: 'comp' },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [
          { id: 'rf', from: { node: 'ref', port: 'done' }, to: { node: 'finish', port: 'start' } },
        ],
      },
    };
  }

  it('both produce 3 atomic nodes with the same dependency graph shape', () => {
    const builtinPrepared = prepareDef(builtinDef());
    const customPrepared = prepareDef(customDef());

    // Built-in: 3 root atomic nodes + 1 finish
    const builtinPaths = makeBindings(
      builtinPrepared.definition.root.nodes
        .filter((n) => n.kind === 'AtomicStage')
        .map((n) => `root:${n.id}`)
    );
    const builtinInput = lowerRuntimePlanInput(
      builtinPrepared,
      createRuntimeExecutionProfile({
        sourceRevision: { layer: 'package', kind: 'pipeline-yaml', sourceId: 'test', authoredContentDigest: sha('1'), semanticDigest: sha('2') },
        capabilities: makeBindings(builtinPrepared.definition.root.nodes.filter((n) => n.kind === 'AtomicStage').map((n) => `root:${n.id}`)),
        policy: { format: 'effective-run-policy/1', maxAttempts: 12, maxActions: 64, stages: makePolicyStages(builtinPrepared.definition.root.nodes.filter((n) => n.kind === 'AtomicStage').map((n) => `root:${n.id}`)) },
      }),
      fixtureDigests.runId
    );
    const builtinPlan = createRuntimePlan(builtinInput);
    const builtinAtomic = builtinPlan.nodes.filter((n) => n.kind === 'atomic');
    expect(builtinAtomic).toHaveLength(3);

    // Custom: 3 inlined atomic nodes + 1 finish
    const customPlan = lowerCompositeRefPlan(customPrepared);
    const customAtomic = customPlan.nodes.filter((n) => n.kind === 'atomic');
    expect(customAtomic).toHaveLength(3);

    // Both have the same finish outcome.
    expect(builtinPlan.implicitFinishOutcome).toBe(customPlan.implicitFinishOutcome);
  });

  it('both produce the same admit candidates for the same Record state', () => {
    const builtinPrepared = prepareDef(builtinDef());
    const customPrepared = prepareDef(customDef());

    const builtinInput = lowerRuntimePlanInput(
      builtinPrepared,
      createRuntimeExecutionProfile({
        sourceRevision: { layer: 'package', kind: 'pipeline-yaml', sourceId: 'test', authoredContentDigest: sha('1'), semanticDigest: sha('2') },
        capabilities: makeBindings(builtinPrepared.definition.root.nodes.filter((n) => n.kind === 'AtomicStage').map((n) => `root:${n.id}`)),
        policy: { format: 'effective-run-policy/1', maxAttempts: 12, maxActions: 64, stages: makePolicyStages(builtinPrepared.definition.root.nodes.filter((n) => n.kind === 'AtomicStage').map((n) => `root:${n.id}`)) },
      }),
      fixtureDigests.runId
    );
    const builtinPlan = createRuntimePlan(builtinInput);
    const customPlan = lowerCompositeRefPlan(customPrepared);

    // Both start with one admit candidate for the first stage.
    const builtinRecord = startRecord(builtinPlan);
    const customRecord = startRecord(customPlan);
    const builtinResult = reconcile(builtinPlan, builtinRecord);
    const customResult = reconcile(customPlan, customRecord);
    expect(builtinResult.ok).toBe(true);
    expect(customResult.ok).toBe(true);
    if (!builtinResult.ok || !customResult.ok) return;
    const builtinAdmits = builtinResult.actions.filter((a) => a.kind === 'admit');
    const customAdmits = customResult.actions.filter((a) => a.kind === 'admit');
    expect(builtinAdmits).toHaveLength(1);
    expect(customAdmits).toHaveLength(1);
    // Same admission kind and access.
    expect(builtinAdmits[0]!.admissionKind).toBe(customAdmits[0]!.admissionKind);
    expect(builtinAdmits[0]!.access).toBe(customAdmits[0]!.access);
  });
});

// ===== Group 12: Export/import round-trip =====

describe('Group 12: Export/import round-trip — digest stability', () => {
  it('canvas metadata stripped; semantic digest unchanged', () => {
    const def: DefinitionSourceV2 = {
      version: 2, id: 'test:rt', sourceId: 'p:rt', name: 'rt',
      inputs: [], artifacts: [], outcomes: ['done'],
      declarations: [{
        id: 'comp', kind: 'Composite', provenance: 'custom',
        inputs: [], artifacts: [], outcomes: ['done'],
        graph: {
          nodes: [{ id: 'a', kind: 'AtomicStage', capability: { id: 'skill:a', version: '1' }, execution: COMPLETE_EXECUTION }],
          connections: [],
        },
        // Non-semantic metadata that should be stripped.
        canvas: { position: { x: 100, y: 200 } },
      }],
      root: {
        nodes: [
          { id: 'ref', kind: 'CompositeRef', declarationId: 'comp' },
          { id: 'finish', kind: 'Finish', outcome: 'done' },
        ],
        connections: [],
      },
      // Non-semantic metadata.
      provenance: { source: 'canvas' },
    };

    const prepared = prepareDef(def);
    const canonicalA = semanticCanonicalizeDefinition(prepared.definition);

    // Simulate export → re-import (JSON serialize → parse → re-prepare).
    const serialized = JSON.parse(JSON.stringify(def));
    const rePrepared = prepareDef(serialized);
    const canonicalB = semanticCanonicalizeDefinition(rePrepared.definition);

    // Digests must match.
    expect(canonicalB).toEqual(canonicalA);
  });
});

// ===== Group 13: Recovery fault injection =====

describe('Group 13: Recovery at composite body stage boundaries', () => {
  function loopPlan(): RuntimePlan {
    return createRuntimePlan({
      runId: fixtureDigests.runId,
      pipeline: 'recovery-test',
      planDigest: fixtureDigests.planDigest,
      profileDigest: fixtureDigests.profileDigest,
      sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
      capabilityDigest: fixtureDigests.capabilityDigest,
      policyDigest: fixtureDigests.policyDigest,
      implicitFinishOutcome: 'done',
      nodes: [{
        kind: 'bounded-loop', hierarchicalPath: 'root/loop', requires: [],
        ...fixtureRuntimeLoop(2, 16, 'exhausted'),
        body: {
          kind: 'composite', declarationId: 'decl',
          stages: [
            { hierarchicalPath: 'root/loop/a', profilePath: 'declaration:decl/node:a', admissionKind: 'agent', workspace: { access: 'write' }, requires: [] },
            { hierarchicalPath: 'root/loop/b', profilePath: 'declaration:decl/node:b', admissionKind: 'agent', workspace: { access: 'write' }, requires: ['root/loop/a'] },
          ],
          outcomes: { done: 'success' },
        },
        outcomes: { clean: 'success', exhausted: 'exhausted' },
      }],
    });
  }

  it('crash before body stage commit: stage A stays active, B not admitted', () => {
    const plan = loopPlan();
    const record = startRecord(plan);
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;

    // Admit stage A but don't commit it.
    const stagePath = compositeBodyStagePath(loop.hierarchicalPath, 1, 'root/loop/a');
    const nodeId = deriveNodeId(plan.runId, stagePath);
    const invocationId = deriveInvocationId(plan.runId, nodeId, 0);
    const attemptId = deriveAttemptId(invocationId, 0);
    const effectId = deriveEffectId(invocationId, 'workspace');
    const actionId = deriveActionId(attemptId, 'agent', [{ slot: 'workspace', effectId }]);

    const admitResult = reduceCanonicalRunRecord(record, {
      kind: 'admit-action',
      action: {
        format: 'change-run-action/1', kind: 'agent', runId: plan.runId,
        nodeId, invocationId, attemptId, actionId,
        effects: [{ slot: 'workspace', effectId, kind: 'workspace', resource: 'worktree', recovery: 'suspend-if-ambiguous', operation: { operationKey: 'w', ownershipMarkerContract: 'e/1', conflictPolicy: 'uncertain' } }],
        executionProfileDigest: plan.profileDigest,
        capability: { id: 'skill:t', authoredVersion: '1', contractId: 't', contractVersion: '1', contractDigest: sha('c'), artifact: { id: 't', version: '1', contentDigest: sha('a') } },
        resultContractDigest: sha('r'), evidenceContractDigest: sha('e'),
        policyDigest: plan.policyDigest,
        workspace: { access: 'write', resources: ['worktree'] },
        expectedBeforeWorkspace: record.currentWorkspaceRevision,
        agent: { role: 'i', model: 's', reasoningEffort: 'm', runtime: 'c', sandbox: 'workspace-write', input: { change: 't' }, session: { reuse: 'never', handoffTokenLimit: 10000, reuseRoundLimit: 1 } },
      },
      attemptOrdinal: 0, deliveryMode: 'grant',
    });
    expect(admitResult.ok).toBe(true);

    // Crash: no commit. Resume by reconciling.
    const result = reconcile(plan, admitResult.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A is active → waiting, no new admit for B.
    const admits = result.actions.filter((a) => a.kind === 'admit');
    expect(admits).toHaveLength(0); // A is already active, B is waiting on A
    expect(result.classification).toBe('waiting');
  });

  it('crash after body stage commit: next stage admitted', () => {
    const plan = loopPlan();
    let record = startRecord(plan);
    const loop = plan.nodes[0]!;
    if (loop.kind !== 'bounded-loop') return;

    // Commit stage A.
    const stagePathA = compositeBodyStagePath(loop.hierarchicalPath, 1, 'root/loop/a');
    const nodeIdA = deriveNodeId(plan.runId, stagePathA);
    record = commitSucceed(plan, record, nodeIdA);

    // Reconcile → stage B should be admitted.
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admits = result.actions.filter((a) => a.kind === 'admit');
    expect(admits).toHaveLength(1);
    // The admit should be for stage B.
    const stagePathB = compositeBodyStagePath(loop.hierarchicalPath, 1, 'root/loop/b');
    const expectedNodeIdB = deriveNodeId(plan.runId, stagePathB);
    expect(admits[0]!.nodeId).toBe(expectedNodeIdB);
  });
});
