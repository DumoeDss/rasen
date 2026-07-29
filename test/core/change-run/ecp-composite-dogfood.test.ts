/**
 * ECP-2 Group 14: Real dogfood of a Custom Composite via the facade-runtime.
 * Exercises success and recovery paths through the same
 * createChangePipelineRuntime facade the CLI uses.
 */
import { describe, expect, it } from 'vitest';

import type { DefinitionSourceV2, CapabilityDescriptor } from '../../../src/core/pipeline-registry/definition.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { deriveInvocationId, deriveAttemptId, deriveEffectId, deriveActionId } from '../../../src/core/change-run/internal/identity.js';
import { startRecord, fixtureDigests } from './reconciler-fixture.js';
import type { RunId, Digest, RunAction, JsonValue, ActionId, EvidenceRef } from '../../../src/core/change-run/contracts.js';

const branded = <T>(value: string): T => value as T;
const sha = (hex: string) => {
  const c = hex.length === 1 && /[0-9a-f]/.test(hex) ? hex : 'a';
  return branded<Digest>(`sha256:${c.repeat(64)}`);
};

function mkDescriptor(id: string): CapabilityDescriptor {
  return {
    id, version: '1', availability: 'enabled',
    inputs: [{ name: 'input', type: 'ecp/control', required: true }],
    artifacts: [{ name: 'artifact', type: 'string' }],
    outcomes: ['done'], limits: {},
  };
}
const SKILLS = ['skill:propose', 'skill:apply', 'skill:ship'].map(mkDescriptor);

function compositeDef(): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'test:custom-dogfood',
    sourceId: 'package:custom-dogfood',
    name: 'custom-dogfood',
    inputs: [], artifacts: [], outcomes: ['done'],
    declarations: [{
      id: 'my-comp', kind: 'Composite', provenance: 'custom',
      inputs: [], artifacts: [], outcomes: ['done'],
      graph: {
        nodes: [
          { id: 'a', kind: 'AtomicStage', capability: { id: 'skill:propose', version: '1' } },
          { id: 'b', kind: 'AtomicStage', capability: { id: 'skill:apply', version: '1' } },
          { id: 'c', kind: 'AtomicStage', capability: { id: 'skill:ship', version: '1' } },
        ],
        connections: [
          { id: 'ab', from: { node: 'a', port: 'done' }, to: { node: 'b', port: 'input' } },
          { id: 'bc', from: { node: 'b', port: 'done' }, to: { node: 'c', port: 'input' } },
        ],
      },
    }],
    root: {
      nodes: [
        { id: 'ref', kind: 'CompositeRef', declarationId: 'my-comp' },
        { id: 'finish', kind: 'Finish', outcome: 'done' },
      ],
      connections: [
        { id: 'rf', from: { node: 'ref', port: 'done' }, to: { node: 'finish', port: 'start' } },
      ],
    },
  };
}

function setupFacade() {
  const prepared = EcpDefinitionModule.prepare(compositeDef(), createCapabilityCatalogSnapshot(SKILLS));
  if (!prepared.ok) throw prepared.error;

  const decl = prepared.value.definition.declarations[0]!;
  const paths = decl.graph.nodes.map((n) => `declaration:${decl.id}/node:${n.id}`);
  const capabilities = paths.map((p) => ({
    nodeId: p,
    authoredCapability: { id: 'skill:test', version: '1' },
    contract: { id: 'test', version: '1', digest: sha('a') },
    actionKind: 'agent' as const,
    resultContract: { id: 'tr', version: '1', digest: sha('b') },
    evidenceContract: { id: 'te', version: '1', digest: sha('c') },
    recovery: 'suspend-if-ambiguous' as const,
    workspace: { access: 'write' as const, resources: ['worktree'] },
    effects: [{ slot: 'workspace', kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const }],
    adapter: { id: 'adapter:test', version: '1', contentDigest: sha('d') },
  }));
  const policyStages = paths.map((nodeId) => ({
    nodeId, role: 'implementer', model: 'default', effort: 'default',
    runtime: 'codex', sandbox: 'workspace-write' as const, gate: false,
    sessionReuse: 'never' as const, handoffTokenLimit: 10_000, reuseRoundLimit: 1,
    provenance: { role: 'd', model: 'd', effort: 'd', runtime: 'd', sandbox: 'd', gate: 'd', sessionReuse: 'd', handoffTokenLimit: 'd', reuseRoundLimit: 'd' },
  }));
  const profile = {
    sourceRevision: { layer: 'package', kind: 'pipeline-yaml', sourceId: 'test', authoredContentDigest: sha('e'), semanticDigest: sha('f') },
    capabilities,
    policy: { format: 'effective-run-policy/1' as const, maxAttempts: 12, maxActions: 64, stages: policyStages },
    capabilityProfileDigest: sha('1'),
    policyDigest: sha('2'),
    profileDigest: sha('3'),
  };

  const plan = lowerRuntimePlan(prepared.value, profile as never, fixtureDigests.runId);
  const initialRecord = startRecord(plan);
  const capByPath = new Map(capabilities.map((c) => [c.nodeId, c] as const));
  const polByPath = new Map(policyStages.map((s) => [s.nodeId, s] as const));

  const buildAction = (desc: { nodeId: string; occurrence: number; admissionKind: 'agent' | 'command' | 'host'; profilePath?: string; input?: JsonValue }): RunAction => {
    const hierarchicalPath = desc.profilePath ?? plan.nodes.find((n) => n.nodeId === desc.nodeId)?.hierarchicalPath;
    if (hierarchicalPath === undefined) throw new Error(`No path for ${desc.nodeId}`);
    const cap = capByPath.get(hierarchicalPath);
    const pol = polByPath.get(hierarchicalPath);
    if (cap === undefined || pol === undefined) throw new Error(`No binding for ${hierarchicalPath}`);
    const invocationId = deriveInvocationId(plan.runId, branded(desc.nodeId), desc.occurrence);
    const attemptId = deriveAttemptId(invocationId, 0);
    const effectId = deriveEffectId(invocationId, 'workspace');
    const actionId = deriveActionId(attemptId, 'agent', [{ slot: 'workspace', effectId }]);
    return {
      format: 'change-run-action/1', kind: 'agent', runId: plan.runId,
      nodeId: branded(desc.nodeId), invocationId, attemptId, actionId,
      effects: [{ slot: 'workspace', effectId, kind: 'workspace', resource: 'worktree', recovery: 'suspend-if-ambiguous', operation: { operationKey: 'w', ownershipMarkerContract: 'e/1', conflictPolicy: 'uncertain' } }],
      executionProfileDigest: plan.profileDigest,
      capability: { id: cap.authoredCapability.id, authoredVersion: cap.authoredCapability.version, contractId: cap.contract.id, contractVersion: cap.contract.version, contractDigest: cap.contract.digest, artifact: cap.adapter },
      resultContractDigest: cap.resultContract.digest, evidenceContractDigest: cap.evidenceContract.digest,
      policyDigest: plan.policyDigest,
      workspace: cap.workspace, expectedBeforeWorkspace: initialRecord.currentWorkspaceRevision,
      agent: { role: pol.role, model: pol.model, reasoningEffort: pol.effort, runtime: pol.runtime, sandbox: pol.sandbox, input: desc.input ?? { change: 'test' }, session: { reuse: 'never', handoffTokenLimit: 10_000, reuseRoundLimit: 1 } },
    };
  };

  const store = createInMemoryRunStore();
  const facade = createChangePipelineRuntime({ store, plan, initialRecord, buildAction });
  return { plan, facade, store };
}

describe('ECP-2 Real dogfood — Custom Composite via facade', () => {
  it('success path: start admits stage A, view shows running', async () => {
    const { facade } = setupFacade();

    // Start the Run.
    const startReceipt = await facade.start({}, { deliveryMode: 'grant' });
    expect(startReceipt.disposition).toBe('created');
    // The CompositeRef inlines 3 body stages. Stage A has no deps → admitted.
    expect(startReceipt.actions).toHaveLength(1);
    expect(startReceipt.view.status).toBe('running');
  });

  it('recovery path: resume after start → stage A still active', async () => {
    const { facade } = setupFacade();

    // Start → stage A admitted.
    await facade.start({}, { deliveryMode: 'grant' });

    // "Crash" — just resume without completing.
    const resume = await facade.resume({}, { deliveryMode: 'grant' });
    // A is still active (not completed) → no new admits, disposition is terminal or advanced.
    expect(resume.actions).toHaveLength(0);
    // The Run is still running (A is active).
    expect(resume.view.status).toBe('running');
  });
});
