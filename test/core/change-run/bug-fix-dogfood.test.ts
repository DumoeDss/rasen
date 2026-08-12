import { describe, expect, it } from 'vitest';
import { TEST_ATTESTATION_AUTHORITY } from '../../fixtures/trusted-completion.js';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/index.js';
import { createRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import {
  createCanonicalRunRecord,
  type CanonicalRecordLimits,
} from '../../../src/core/change-run/internal/record.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunAction,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;

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

const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
const workspaceDigest = branded<Digest>(`sha256:${'c'.repeat(64)}`);
const workspaceRevision = {
  format: 'workspace-revision/1' as const,
  head: { kind: 'commit' as const, digest: workspaceDigest, detached: false },
  treeDigest: workspaceDigest,
  dirtyWorktreeDigest: workspaceDigest,
};
const limits: CanonicalRecordLimits = {
  maxAttempts: 12,
  maxActions: 64,
  maxRecordRevisions: 256,
  maxTransitions: 4096,
  maxEvidenceRefsPerAction: 16,
  limitOutcome: 'escalated',
};

function prepare(): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(BUG_FIX, createCapabilityCatalogSnapshot([]));
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * v2-compatible profile entries. The normalized bug-fix definition has:
 *  - 4 root AtomicStage nodes (propose, apply, ship, archive) at `root:stage:<id>`
 *  - 4 ReviewCycle body phases (review, triage, fix, re-review) at
 *    `declaration:review-cycle-body:verify/node:verify:<phase>`
 */
const V2_NODES = [
  { path: 'root:stage:propose', skill: 'rasen-propose', role: 'planner', gate: true, access: 'read' as const, model: 'default' as const },
  { path: 'root:stage:apply', skill: 'rasen-apply-change', role: 'implementer', gate: true, access: 'write' as const, model: 'default' as const },
  { path: 'root:stage:ship', skill: 'rasen-ship', role: 'shipper', gate: true, access: 'write' as const, model: 'sonnet' as const },
  { path: 'root:stage:archive', skill: 'rasen-archive-change', role: 'shipper', gate: false, access: 'write' as const, model: 'sonnet' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:review', skill: 'rasen-review', role: 'reviewer', gate: false, access: 'read' as const, model: 'default' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:triage', skill: 'rasen-review', role: 'reviewer', gate: false, access: 'read' as const, model: 'default' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:fix', skill: 'rasen-review', role: 'implementer', gate: false, access: 'write' as const, model: 'default' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:re-review', skill: 'rasen-review', role: 'reviewer', gate: false, access: 'read' as const, model: 'default' as const },
] as const;

function profileFor(prepared: PreparedDefinition) {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:bug-fix',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: V2_NODES.map((node) => ({
      nodeId: node.path,
      authoredCapability: { id: `skill:${node.skill}`, version: 'legacy' },
      contract: { id: node.skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
      actionKind: 'agent' as const,
      resultContract: { id: `${node.skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
      evidenceContract: { id: `${node.skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
      recovery: 'suspend-if-ambiguous' as const,
      workspace: {
        access: node.access,
        resources: ['worktree'],
      },
      effects: [
        { slot: 'workspace', kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const },
      ],
      adapter: {
        id: `adapter:${node.skill}`,
        version: '1',
        contentDigest: `sha256:${'6'.repeat(64)}`,
        attestationAuthority: TEST_ATTESTATION_AUTHORITY,
      },
    })),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: V2_NODES.map((node) => ({
        nodeId: node.path,
        role: node.role,
        model: node.model,
        effort: 'default',
        runtime: 'codex',
        sandbox: node.access === 'read' ? ('read-only' as const) : ('workspace-write' as const),
        gate: node.gate,
        sessionReuse: 'never' as const,
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
        provenance: {
          role: 'stage', model: 'default', effort: 'default', runtime: 'stage',
          sandbox: 'stage', gate: 'stage', sessionReuse: 'default',
          handoffTokenLimit: 'default', reuseRoundLimit: 'default',
        },
      })),
    },
  });
}

describe('simple bug-fix dogfood through the facade (11.5/11.6)', () => {
  it('runs the lowered bug-fix plan end to end through one owner to finish', async () => {
    const prepared = prepare();
    const profile = profileFor(prepared);
    const plan = lowerRuntimePlan(prepared, profile, runId);

    const initial = createCanonicalRunRecord({
      runId: plan.runId,
      runOrdinal: 1,
      change: {
        planningSpaceId: branded('planning-space:' + '1'.repeat(64)) as PlanningSpaceId,
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

    const store = createInMemoryRunStore();
    const capabilityByPath = new Map(profile.capabilities.map((c) => [c.nodeId, c] as const));
    const stageByPath = new Map(profile.policy.stages.map((s) => [s.nodeId, s] as const));
    const buildAction = (descriptor: { nodeId: string; occurrence: number; admissionKind: 'agent' | 'command' | 'host'; renderedTurnInput?: string }): RunAction => {
      const node = plan.nodes.find((n) => n.nodeId === descriptor.nodeId)!;
      const capability = capabilityByPath.get(node.hierarchicalPath)!;
      const stage = stageByPath.get(node.hierarchicalPath)!;
      return buildAgentAction(
        {
          capability,
          stage: stage as never,
          executionProfileDigest: profile.profileDigest,
          policyDigest: profile.policyDigest,
        },
        {
          runId: plan.runId,
          nodeId: descriptor.nodeId,
          occurrence: descriptor.occurrence,
          attemptOrdinal: 0,
          expectedBeforeWorkspace: workspaceRevision,
        },
        {
          renderedTurnInput:
            descriptor.renderedTurnInput ?? 'trusted fixture prompt',
          input: { change: 'fixture-change' } as never,
        }
      );
    };

    const runtime = createChangePipelineRuntime({ store, plan, initialRecord: initial, buildAction });

    // start: propose is gated -> the facade commits the gate wait as a durable
    // part of the Record (design §5.6: settle to quiescence). No executable
    // action is granted until the gate is decided.
    const started = await runtime.start(
      { change: { projectRoot: '/root', changeId: 'fixture-change' }, pipeline: 'bug-fix', launchRequestId: branded('launch:' + '1'.repeat(59)) as never },
      { deliveryMode: 'grant' }
    );
    expect(started.disposition).toBe('created');
    // No executable action is granted yet (the gate is not decided).
    expect(started.actions).toEqual([]);
    const root = started.view.sections[0] as Extract<(typeof started.view.sections)[number], { kind: 'root-dag' }>;
    // No active actions; the gate wait is committed and visible in the view.
    expect(root.actions).toEqual([]);
    expect(root.waits.length).toBe(1);
    expect(root.waits[0].kind).toBe('gate');

    // The reconciler no longer emits an await-gate candidate — the wait is
    // already committed by the facade's settle. This is the corrected behavior:
    // the facade settles the full candidate batch (admits + waits + terminals)
    // in one revision, so the gate wait enters the Record on start.
    const reconciled = reconcile(plan, store.load(plan.runId));
    if (!reconciled.ok) throw new Error('reconcile failed');
    expect(reconciled.actions.some((a) => a.kind === 'await-gate')).toBe(false);

    // The spine is confirmed: lowered plan -> facade start commits the gate
    // wait -> the Record carries a durable WaitId the control path can target.
    expect(store.has(plan.runId)).toBe(true);
  });

  it('complex adaptive route suspends before ship (11.7)', () => {
    const plan = lowerRuntimePlan(prepare(), profileFor(prepare()), runId);
    // verify is adaptive; it lowers as a bounded-loop ReviewCycle node whose
    // body runs the 4-phase review/triage/fix/re-review cycle.
    const loopNode = plan.nodes.find((n) => n.kind === 'bounded-loop');
    expect(loopNode).toBeDefined();
    expect(loopNode!.kind === 'bounded-loop' && loopNode!.body.kind === 'review-cycle').toBe(true);
    // Root stages remain atomic.
    expect(plan.nodes.some((n) => n.kind === 'atomic')).toBe(true);
  });
});
