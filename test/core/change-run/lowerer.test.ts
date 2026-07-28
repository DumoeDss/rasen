import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/index.js';
import { createRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import {
  createCanonicalRunRecord,
  type CanonicalRecordLimits,
} from '../../../src/core/change-run/internal/record.js';
import { deriveNodeId } from '../../../src/core/change-run/internal/identity.js';
import type {
  ChangeInstanceId,
  Digest,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';

const BUG_FIX = {
  version: 1,
  name: 'bug-fix',
  description: 'fixture',
  stages: [
    { id: 'propose', skill: 'rasen-propose', role: 'planner', requires: [], gate: true },
    { id: 'apply', skill: 'rasen-apply-change', role: 'implementer', requires: ['propose'], gate: true },
    { id: 'verify', skill: 'rasen-review', role: 'reviewer', requires: ['apply'], verifyPolicy: 'adaptive' },
    { id: 'ship', skill: 'rasen-ship', role: 'shipper', requires: ['verify'], gate: true, model: 'sonnet' },
    { id: 'archive', skill: 'rasen-archive-change', role: 'shipper', requires: ['ship'], model: 'sonnet' },
  ],
} as const;

const branded = <T>(value: string): T => value as T;
const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
const workspaceDigest = branded<Digest>(`sha256:${'c'.repeat(64)}`);
const workspaceRevision = {
  format: 'workspace-revision/1',
  head: { kind: 'commit', digest: workspaceDigest, detached: false },
  treeDigest: workspaceDigest,
  dirtyWorktreeDigest: workspaceDigest,
} as const;
const limits: CanonicalRecordLimits = {
  maxAttempts: 12,
  maxActions: 64,
  maxRecordRevisions: 256,
  maxTransitions: 4096,
  maxEvidenceRefsPerAction: 16,
  limitOutcome: 'escalated',
};

function prepare(source: unknown = BUG_FIX): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(
    source,
    createCapabilityCatalogSnapshot([])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

function profileFor(prepared: PreparedDefinition) {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:bug-fix',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: (prepared.authoredSource as { stages: { id: string; skill: string }[] }).stages.map(
      (stage) => ({
        nodeId: `stage:${stage.id}`,
        authoredCapability: { id: `skill:${stage.skill}`, version: 'legacy' },
        contract: { id: stage.skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
        actionKind: 'agent' as const,
        resultContract: { id: `${stage.skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
        evidenceContract: { id: `${stage.skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
        recovery: 'suspend-if-ambiguous' as const,
        workspace: {
          access:
            stage.id === 'propose' || stage.id === 'verify' ? 'read' : 'write',
          resources: ['worktree'],
        },
        effects: [
          {
            slot: 'workspace',
            kind: 'workspace' as const,
            resource: 'worktree',
            recovery: 'suspend-if-ambiguous' as const,
          },
        ],
        adapter: {
          id: `adapter:${stage.skill}`,
          version: '1',
          contentDigest: `sha256:${'6'.repeat(64)}`,
        },
      })
    ),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: (prepared.authoredSource as { stages: { id: string; role: string; model?: string }[] }).stages.map(
        (stage) => ({
          nodeId: `stage:${stage.id}`,
          role: stage.role,
          model: stage.model ?? 'default',
          effort: 'default',
          runtime: 'codex',
          sandbox:
            stage.id === 'propose' || stage.id === 'verify'
              ? 'read-only'
              : 'workspace-write',
          gate: BUG_FIX.stages.find((s) => s.id === stage.id)!.gate ?? false,
          sessionReuse: 'never',
          handoffTokenLimit: 10_000,
          reuseRoundLimit: 1,
          provenance: {
            role: 'stage',
            model: stage.model ? 'stage' : 'default',
            effort: 'default',
            runtime: 'stage',
            sandbox: 'stage',
            gate: 'stage',
            sessionReuse: 'default',
            handoffTokenLimit: 'default',
            reuseRoundLimit: 'default',
          },
        })
      ),
    },
  });
}

function startRecord(plan: RuntimePlan) {
  return createCanonicalRunRecord({
    runId: plan.runId,
    runOrdinal: 1,
    change: {
      planningSpaceId: branded('planning-space:' + '1'.repeat(64)),
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: branded('change-instance:' + '2'.repeat(64)) as ChangeInstanceId,
    },
    workspaceInstanceId: branded('workspace-instance:' + '3'.repeat(64)) as WorkspaceInstanceId,
    pipeline: plan.pipeline,
    launchRequestDigest: branded('sha256:' + '9'.repeat(64)) as Digest,
    planDigest: plan.planDigest,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    capabilityDigest: plan.capabilityDigest,
    policyDigest: plan.policyDigest,
    executionProfileDigest: plan.profileDigest,
    initialWorkspaceRevision: workspaceRevision,
    inputs: {},
    limits,
  });
}

describe('runtime plan lowerer (3.2)', () => {
  it('lowers a v1 bug-fix definition+profile into a reconcilable RuntimePlan', () => {
    const prepared = prepare();
    const profile = profileFor(prepared);
    const plan = lowerRuntimePlan(prepared, profile, runId);

    expect(plan.pipeline).toBe('bug-fix');
    expect(plan.nodes.map((n) => n.hierarchicalPath)).toEqual([
      'stage:propose',
      'stage:apply',
      'stage:verify',
      'stage:ship',
      'stage:archive',
    ]);
    const propose = plan.nodes.find((n) => n.hierarchicalPath === 'stage:propose')!;
    expect(propose.kind).toBe('atomic');
    if (propose.kind !== 'atomic') return;
    expect(propose.gate?.gateId).toBe('propose-gate');
    expect(propose.workspace.access).toBe('read');
    const verify = plan.nodes.find((n) => n.hierarchicalPath === 'stage:verify')!;
    if (verify.kind !== 'atomic') return;
    expect(verify.adaptiveVerify).toBe(true);
    expect(verify.gate).toBeUndefined();
    expect(plan.implicitFinishOutcome).toBe('bug-fix-completed');
  });

  it('produces a plan the reconciler accepts and drives from the propose Gate', () => {
    const plan = lowerRuntimePlan(prepare(), profileFor(prepare()), runId);
    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      {
        kind: 'await-gate',
        nodeId: deriveNodeId(runId, 'stage:propose'),
        gateId: 'propose-gate',
        waitId: expect.any(String),
        decisionIds: ['approve', 'reject'],
      },
    ]);
  });

  it('binds plan and profile digests so a record with the lowered identity reconciles', () => {
    const plan = lowerRuntimePlan(prepare(), profileFor(prepare()), runId);
    // A record built from the plan's own digests must pass identity validation
    // (this is the contract the facade will rely on at launch).
    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
  });
});
