import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/index.js';
import {
  analyzeReconcilerSupport,
  createRuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { lowerRuntimePlan, lowerRuntimePlanInput } from '../../../src/core/change-run/internal/lowerer.js';
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
import {
  createRuntimePlan,
  type RuntimePlan,
} from '../../../src/core/change-run/internal/runtime-plan.js';

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

const SMALL_FEATURE = {
  version: 1,
  name: 'small-feature',
  description: 'fixture',
  stages: [
    { id: 'propose', skill: 'rasen-propose', role: 'planner', requires: [], gate: true },
    { id: 'apply', skill: 'rasen-apply-change', role: 'implementer', requires: ['propose'], gate: true },
    { id: 'verify', skill: 'rasen-review', role: 'reviewer', requires: ['apply'], condition: 'always' },
    { id: 'review-loop', skill: 'rasen-review-cycle', role: 'fixer', requires: ['verify'], loop: { kind: 'review-cycle' as const, maxRounds: 3 } },
    { id: 'ship', skill: 'rasen-ship', role: 'shipper', requires: ['review-loop'], gate: true, model: 'sonnet' },
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

/**
 * Build a v2-compatible execution profile for the bug-fix pipeline after D4
 * migration. The verify stage is absorbed into a ReviewCycle BoundedLoop, so
 * capabilities and policy stages use `root:stage:*` paths for root AtomicStages
 * and `declaration:review-cycle-body:verify/node:*` paths for body phases.
 */
function bugFixV2Profile(prepared: PreparedDefinition) {
  const reviewSkill = 'rasen-review';
  const rootStages = (prepared.definition.root.nodes)
    .filter((n): n is typeof n & { kind: 'AtomicStage' } => n.kind === 'AtomicStage');
  const bodyDecl = prepared.definition.declarations.find(
    (d) => d.id === 'review-cycle-body:verify'
  );
  const bodyPhases = bodyDecl
    ? bodyDecl.graph.nodes.filter((n): n is typeof n & { kind: 'AtomicStage' } => n.kind === 'AtomicStage')
    : [];

  const allPaths = [
    ...rootStages.map((n) => `root:${n.id}`),
    ...bodyPhases.map((n) => `declaration:${bodyDecl!.id}/node:${n.id}`),
  ];

  const gateFor = (path: string): boolean => {
    // Root stages with gate=true
    const node = rootStages.find((n) => `root:${n.id}` === path);
    if (node) {
      const legacyStageId = (node as { legacyStageId?: string }).legacyStageId;
      return BUG_FIX.stages.find((s) => s.id === legacyStageId)?.gate ?? false;
    }
    return false;
  };

  const accessFor = (path: string): 'read' | 'write' => {
    if (path.includes('declaration:')) {
      return path.includes(':fix') ? 'write' : 'read';
    }
    const node = rootStages.find((n) => `root:${n.id}` === path);
    const legacyStageId = (node as { legacyStageId?: string }).legacyStageId;
    const stageDef = BUG_FIX.stages.find((s) => s.id === legacyStageId);
    return stageDef?.id === 'propose' || stageDef?.role === 'reviewer' ? 'read' : 'write';
  };

  const skillFor = (path: string): string => {
    if (path.includes('declaration:')) return reviewSkill;
    const node = rootStages.find((n) => `root:${n.id}` === path);
    const legacyStageId = (node as { legacyStageId?: string }).legacyStageId;
    return BUG_FIX.stages.find((s) => s.id === legacyStageId)?.skill ?? 'default';
  };

  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:bug-fix',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: allPaths.map((path) => {
      const skill = skillFor(path);
      return {
        nodeId: path,
        authoredCapability: { id: `skill:${skill}`, version: 'legacy' },
        contract: { id: skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
        actionKind: 'agent' as const,
        resultContract: { id: `${skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
        evidenceContract: { id: `${skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
        recovery: 'suspend-if-ambiguous' as const,
        workspace: {
          access: accessFor(path),
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
          id: `adapter:${skill}`,
          version: '1',
          contentDigest: `sha256:${'6'.repeat(64)}`,
        },
      };
    }),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: allPaths.map((path) => {
        const skill = skillFor(path);
        const isBody = path.includes('declaration:');
        const isFix = path.includes(':fix');
        return {
          nodeId: path,
          role: isFix ? 'implementer' : isBody ? 'reviewer' : (BUG_FIX.stages.find((s) => s.id === skill)?.role ?? 'implementer'),
          model: 'default',
          effort: 'default',
          runtime: 'codex',
          sandbox: accessFor(path) === 'read' ? 'read-only' as const : 'workspace-write' as const,
          gate: gateFor(path),
          sessionReuse: 'never' as const,
          handoffTokenLimit: 10_000,
          reuseRoundLimit: 1,
          provenance: {
            role: 'stage',
            model: 'default',
            effort: 'default',
            runtime: 'stage',
            sandbox: 'stage',
            gate: 'stage',
            sessionReuse: 'default',
            handoffTokenLimit: 'default',
            reuseRoundLimit: 'default',
          },
        };
      }),
    },
  });
}

/**
 * Build a v2-compatible execution profile for the small-feature pipeline.
 * The review-loop stage is migrated to a ReviewCycle BoundedLoop.
 */
function smallFeatureV2Profile(prepared: PreparedDefinition) {
  const reviewSkill = 'rasen-review';
  const rootStages = (prepared.definition.root.nodes)
    .filter((n): n is typeof n & { kind: 'AtomicStage' } => n.kind === 'AtomicStage');
  const bodyDecl = prepared.definition.declarations.find(
    (d) => d.id === 'review-cycle-body:review-loop'
  );
  const bodyPhases = bodyDecl
    ? bodyDecl.graph.nodes.filter((n): n is typeof n & { kind: 'AtomicStage' } => n.kind === 'AtomicStage')
    : [];

  const allPaths = [
    ...rootStages.map((n) => `root:${n.id}`),
    ...bodyPhases.map((n) => `declaration:${bodyDecl!.id}/node:${n.id}`),
  ];

  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:small-feature',
      authoredContentDigest: `sha256:${'a'.repeat(64)}`,
      semanticDigest: `sha256:${'b'.repeat(64)}`,
    },
    capabilities: allPaths.map((path) => {
      const isBody = path.includes('declaration:');
      const skill = isBody ? reviewSkill : 'default';
      return {
        nodeId: path,
        authoredCapability: { id: `skill:${skill}`, version: 'legacy' },
        contract: { id: skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
        actionKind: 'agent' as const,
        resultContract: { id: `${skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
        evidenceContract: { id: `${skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
        recovery: 'suspend-if-ambiguous' as const,
        workspace: {
          access: (isBody && path.includes(':fix')) || (!isBody) ? 'write' as const : 'read' as const,
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
          id: `adapter:${skill}`,
          version: '1',
          contentDigest: `sha256:${'6'.repeat(64)}`,
        },
      };
    }),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: allPaths.map((path) => {
        const isBody = path.includes('declaration:');
        const isFix = path.includes(':fix');
        return {
          nodeId: path,
          role: isFix ? 'implementer' : isBody ? 'reviewer' : 'implementer',
          model: 'default',
          effort: 'default',
          runtime: 'codex',
          sandbox: isFix || (!isBody) ? 'workspace-write' as const : 'read-only' as const,
          gate: false,
          sessionReuse: 'never' as const,
          handoffTokenLimit: 10_000,
          reuseRoundLimit: 1,
          provenance: {
            role: 'stage',
            model: 'default',
            effort: 'default',
            runtime: 'stage',
            sandbox: 'stage',
            gate: 'default',
            sessionReuse: 'default',
            handoffTokenLimit: 'default',
            reuseRoundLimit: 'default',
          },
        };
      }),
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

const REVIEW_CAPABILITIES = [
  {
    phase: 'review',
    id: 'review-cycle:review',
    inputs: [],
    outcomes: ['clean', 'findings'],
  },
  {
    phase: 'triage',
    id: 'review-cycle:triage',
    inputs: [{ name: 'start', type: 'ecp/control', required: true }],
    outcomes: ['ready'],
  },
  {
    phase: 'fix',
    id: 'review-cycle:fix',
    inputs: [{ name: 'start', type: 'ecp/control', required: true }],
    outcomes: ['fixed'],
  },
  {
    phase: 're-review',
    id: 'review-cycle:re-review',
    inputs: [{ name: 'start', type: 'ecp/control', required: true }],
    outcomes: ['clean', 'needs_fix'],
  },
] as const;

const REVIEW_CYCLE_V2: DefinitionSourceV2 = {
  version: 2,
  id: 'review-cycle-v2',
  sourceId: 'fixture:review-cycle-v2',
  name: 'review-cycle-v2',
  inputs: [],
  artifacts: [],
  outcomes: ['clean'],
  declarations: [
    {
      id: 'review-cycle-body',
      kind: 'Composite',
      provenance: 'built-in',
      inputs: [],
      artifacts: [],
      outcomes: ['clean', 'needs_fix'],
      graph: {
        nodes: REVIEW_CAPABILITIES.map((capability) => ({
          id: capability.phase,
          kind: 'AtomicStage' as const,
          capability: { id: capability.id, version: '1' },
          reviewCyclePhase: capability.phase,
        })),
        connections: [
          {
            id: 'review-to-triage',
            from: { node: 'review', port: 'findings' },
            to: { node: 'triage', port: 'start' },
          },
          {
            id: 'triage-to-fix',
            from: { node: 'triage', port: 'ready' },
            to: { node: 'fix', port: 'start' },
          },
          {
            id: 'fix-to-re-review',
            from: { node: 'fix', port: 'fixed' },
            to: { node: 're-review', port: 'start' },
          },
        ],
      },
    },
  ],
  root: {
    nodes: [
      {
        id: 'review-loop',
        kind: 'BoundedLoop',
        body: 'review-cycle-body',
        limits: { maxIterations: 3, maxActions: 12 },
        exits: {
          clean: { action: 'exit', outcome: 'clean' },
          needs_fix: { action: 'continue' },
        },
        exhaustedOutcome: 'exhausted',
      },
    ],
    connections: [],
  },
};

function prepareReviewCycleV2(): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(
    REVIEW_CYCLE_V2,
    createCapabilityCatalogSnapshot(
      REVIEW_CAPABILITIES.map((capability) => ({
        id: capability.id,
        version: '1',
        availability: 'enabled',
        inputs: capability.inputs,
        artifacts: [],
        outcomes: capability.outcomes,
        limits: { maxActions: 8 },
      }))
    )
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

function reviewCycleProfile() {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-definition-v2',
      sourceId: 'fixture:review-cycle-v2',
      authoredContentDigest: `sha256:${'7'.repeat(64)}`,
      semanticDigest: `sha256:${'8'.repeat(64)}`,
    },
    capabilities: REVIEW_CAPABILITIES.map((capability) => ({
      nodeId: `declaration:review-cycle-body/node:${capability.phase}`,
      authoredCapability: { id: capability.id, version: '1' },
      contract: {
        id: capability.id,
        version: '1',
        digest: `sha256:${'3'.repeat(64)}`,
      },
      actionKind: 'agent' as const,
      resultContract: {
        id: `${capability.id}-result`,
        version: '1',
        digest: `sha256:${'4'.repeat(64)}`,
      },
      evidenceContract: {
        id: 'review-cycle-evidence',
        version: '1',
        digest: `sha256:${'5'.repeat(64)}`,
      },
      recovery: 'suspend-if-ambiguous' as const,
      workspace: {
        access: capability.phase === 'fix' ? ('write' as const) : ('read' as const),
        resources: capability.phase === 'fix' ? ['worktree'] : [],
      },
      effects: [],
      adapter: {
        id: `adapter:${capability.id}`,
        version: '1',
        contentDigest: `sha256:${'6'.repeat(64)}`,
      },
    })),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: REVIEW_CAPABILITIES.map((capability) => ({
        nodeId: `declaration:review-cycle-body/node:${capability.phase}`,
        role: capability.phase,
        model: 'default',
        effort: 'default',
        runtime: 'codex',
        sandbox:
          capability.phase === 'fix'
            ? ('workspace-write' as const)
            : ('read-only' as const),
        gate: false,
        sessionReuse: 'never' as const,
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
        provenance: {
          role: 'definition',
          model: 'default',
          effort: 'default',
          runtime: 'default',
          sandbox: 'definition',
          gate: 'default',
          sessionReuse: 'default',
          handoffTokenLimit: 'default',
          reuseRoundLimit: 'default',
        },
      })),
    },
  });
}

describe('runtime plan lowerer (3.2)', () => {
  it('lowers a v1 bug-fix definition+profile into a mixed v2 RuntimePlan with a BoundedLoop', () => {
    // D4 migration: bug-fix's verifyPolicy:'adaptive' stage is absorbed into a
    // ReviewCycle BoundedLoop. The plan has 4 root atomic nodes (propose, apply,
    // ship, archive) + 1 bounded-loop node (verify). The verify stage's atomic
    // path is replaced by the bounded-loop and its declaration body phases.
    const prepared = prepare();
    const profile = bugFixV2Profile(prepared);
    const plan = lowerRuntimePlan(prepared, profile, runId);

    expect(plan.pipeline).toBe('bug-fix');
    const atomicPaths = plan.nodes
      .filter((n) => n.kind === 'atomic')
      .map((n) => n.hierarchicalPath);
    const loopPaths = plan.nodes
      .filter((n) => n.kind === 'bounded-loop')
      .map((n) => n.hierarchicalPath);
    expect(atomicPaths).toEqual([
      'root:stage:propose',
      'root:stage:apply',
      'root:stage:ship',
      'root:stage:archive',
    ]);
    expect(loopPaths).toEqual(['root:stage:verify']);

    const propose = plan.nodes.find((n) => n.hierarchicalPath === 'root:stage:propose')!;
    expect(propose.kind).toBe('atomic');
    if (propose.kind !== 'atomic') return;
    expect(propose.gate?.gateId).toBe('stage:propose-gate');
    expect(propose.workspace.access).toBe('read');

    const loop = plan.nodes.find((n) => n.kind === 'bounded-loop')!;
    if (loop.kind !== 'bounded-loop') return;
    expect(loop.body.phases.map((p) => p.phase)).toEqual([
      'review',
      'triage',
      'fix',
      're-review',
    ]);
    expect(loop.maxIterations).toBe(3);
    expect(plan.implicitFinishOutcome).toBe('bug-fix-completed');
  });

  it('produces a mixed plan the reconciler accepts and drives from the propose Gate', () => {
    const plan = lowerRuntimePlan(prepare(), bugFixV2Profile(prepare()), runId);
    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      {
        kind: 'await-gate',
        nodeId: deriveNodeId(runId, 'root:stage:propose'),
        gateId: 'stage:propose-gate',
        waitId: expect.any(String),
        decisionIds: ['approve', 'reject'],
      },
    ]);
  });

  it('binds plan and profile digests so a record with the lowered identity reconciles', () => {
    const plan = lowerRuntimePlan(prepare(), bugFixV2Profile(prepare()), runId);
    // A record built from the plan's own digests must pass identity validation
    // (this is the contract the facade will rely on at launch).
    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
  });

  it('lowers an authored v2 ReviewCycle BoundedLoop into the canonical runtime', () => {
    const prepared = prepareReviewCycleV2();
    const profile = reviewCycleProfile();
    expect(prepared.capability).toMatchObject({
      executable: true,
      executionMode: 'reconciler',
    });
    expect(prepared.capability.unavailableReason).toBeUndefined();
    expect(analyzeReconcilerSupport(prepared, profile)).toMatchObject({
      availableEngines: ['reconciler'],
      reconcilerSupport: {
        supported: true,
        reason: 'supported_v2_executable',
      },
    });
    const plan = lowerRuntimePlan(prepared, profile, runId);

    expect(plan.nodes).toHaveLength(1);
    const loop = plan.nodes[0]!;
    expect(loop).toMatchObject({
      kind: 'bounded-loop',
      hierarchicalPath: 'root:review-loop',
      maxIterations: 3,
      outcomes: { clean: 'clean', exhausted: 'exhausted' },
    });
    if (loop.kind !== 'bounded-loop') return;
    expect(loop.body.phases.map((phase) => phase.phase)).toEqual([
      'review',
      'triage',
      'fix',
      're-review',
    ]);

    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: 'admit',
        profilePath: 'declaration:review-cycle-body/node:review',
        input: {
          reviewCycle: {
            loopPath: 'root:review-loop',
            round: 1,
            phase: 'review',
            openFindingIds: [],
          },
        },
      }),
    ]);
  });

  // Task 7.4: bug-fix normalizes to v2 BoundedLoop, lowers to valid mixed plan,
  // and analyzeReconcilerSupport returns supported_v2_review_cycle.
  it('bug-fix normalizes to v2 BoundedLoop, lowers, and reports supported (7.4)', () => {
    const prepared = prepare();
    expect(prepared.capability.executionMode).toBe('reconciler');
    const profile = bugFixV2Profile(prepared);

    // Normalized definition has a BoundedLoop.
    const boundedLoop = prepared.definition.root.nodes.find(
      (n) => n.kind === 'BoundedLoop'
    );
    expect(boundedLoop).toBeDefined();

    // analyzeReconcilerSupport returns supported_v2_review_cycle.
    const support = analyzeReconcilerSupport(prepared, profile);
    expect(support.reconcilerSupport).toMatchObject({
      supported: true,
      reason: 'supported_v2_review_cycle',
    });
    expect(support.availableEngines).toContain('reconciler');

    // Lowers to a valid mixed plan: 4 atomic root nodes + 1 bounded-loop.
    const plan = lowerRuntimePlan(prepared, profile, runId);
    expect(plan.nodes.filter((n) => n.kind === 'atomic')).toHaveLength(4);
    expect(plan.nodes.filter((n) => n.kind === 'bounded-loop')).toHaveLength(1);

    // Reconciler accepts the plan.
    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
  });

  // Task 7.5: small-feature normalizes to v2 BoundedLoop (review-loop stage),
  // lowers to valid mixed plan, and analyzeReconcilerSupport returns supported.
  it('small-feature normalizes to v2 BoundedLoop, lowers, and reports supported (7.5)', () => {
    const prepared = prepare(SMALL_FEATURE);
    expect(prepared.capability.executionMode).toBe('reconciler');
    const profile = smallFeatureV2Profile(prepared);

    // Normalized definition has a BoundedLoop from the review-loop stage.
    const boundedLoop = prepared.definition.root.nodes.find(
      (n) => n.kind === 'BoundedLoop'
    );
    expect(boundedLoop).toBeDefined();

    // analyzeReconcilerSupport returns supported_v2_review_cycle.
    const support = analyzeReconcilerSupport(prepared, profile);
    expect(support.reconcilerSupport).toMatchObject({
      supported: true,
      reason: 'supported_v2_review_cycle',
    });
    expect(support.availableEngines).toContain('reconciler');

    // Lowers to a valid mixed plan: 5 atomic root nodes + 1 bounded-loop.
    const plan = lowerRuntimePlan(prepared, profile, runId);
    expect(plan.nodes.filter((n) => n.kind === 'atomic')).toHaveLength(5);
    expect(plan.nodes.filter((n) => n.kind === 'bounded-loop')).toHaveLength(1);

    // Reconciler accepts the plan.
    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ECP-4: Choice/FanOut/Join lowerer tests (M1 — would have caught B1)
// These tests exercise the FULL normalizer→lowerer→createRuntimePlan path
// with v1 parallelGroup stages, proving no duplicate hierarchicalPaths.
// ---------------------------------------------------------------------------

const PARALLEL_FEATURE = {
  version: 1,
  name: 'parallel-test',
  description: 'fixture with parallelGroup for lowerer tests',
  stages: [
    { id: 'prepare', skill: 'rasen-propose', role: 'planner', requires: [], gate: true },
    { id: 'execute', skill: 'rasen-apply-change', role: 'implementer', requires: ['prepare'], gate: true },
    // Parallel group members (all require 'execute')
    {
      id: 'review', skill: 'rasen-review', role: 'reviewer', requires: ['execute'],
      parallelGroup: 'experts', condition: 'always',
    },
    {
      id: 'security', skill: 'rasen-cso', role: 'reviewer', requires: ['execute'],
      parallelGroup: 'experts', condition: 'security-relevant',
    },
    {
      id: 'performance', skill: 'rasen-benchmark', role: 'reviewer', requires: ['execute'],
      parallelGroup: 'experts', condition: 'performance-sensitive',
    },
    // Review cycle after parallel (forces v2 lowerer routing)
    {
      id: 'review-loop', skill: 'rasen-review-cycle', role: 'fixer',
      requires: ['review', 'security', 'performance'],
      loop: { kind: 'review-cycle' as const, maxRounds: 3 },
    },
    // Ship
    {
      id: 'ship', skill: 'rasen-ship', role: 'shipper',
      requires: ['review-loop'], gate: true, model: 'sonnet',
    },
  ],
} as const;

/**
 * Build a v2-compatible execution profile for the parallel-test pipeline.
 * Handles root AtomicStages (including FanOut members), FanOut/Join nodes,
 * and the ReviewCycle BoundedLoop body phases.
 */
function parallelV2Profile(
  prepared: PreparedDefinition,
  options: { includeEvaluators?: boolean } = {}
) {
  const includeEvaluators = options.includeEvaluators ?? true;
  const reviewSkill = 'rasen-review';
  const rootStages = (prepared.definition.root.nodes)
    .filter((n): n is typeof n & { kind: 'AtomicStage' } => n.kind === 'AtomicStage');
  // ECP-4: the FanOut condition evaluator is a synthetic orchestration node —
  // production seals a `parallel-dispatch` binding for it. Mirror that here so
  // the fixture profile matches what analyzeReconcilerSupport expects.
  const evaluatorPaths = includeEvaluators
    ? prepared.definition.root.nodes
        .filter((n) => n.kind === 'FanOut')
        .map((n) => `root:${n.id}`)
    : [];
  const bodyDecl = prepared.definition.declarations.find(
    (d) => d.id === 'review-cycle-body:review-loop'
  );
  const bodyPhases = bodyDecl
    ? bodyDecl.graph.nodes.filter((n): n is typeof n & { kind: 'AtomicStage' } => n.kind === 'AtomicStage')
    : [];

  const allPaths = [
    ...rootStages.map((n) => `root:${n.id}`),
    ...evaluatorPaths,
    ...bodyPhases.map((n) => `declaration:${bodyDecl!.id}/node:${n.id}`),
  ];
  // Stage metadata comes from the prepared source, so this helper works for any
  // v1 parallelGroup fixture (not just PARALLEL_FEATURE).
  const sourceStages = (
    prepared.authoredSource as {
      stages: readonly Readonly<{
        id: string;
        skill?: string;
        role?: string;
        gate?: boolean;
      }>[];
    }
  ).stages;

  const gateFor = (path: string): boolean => {
    const node = rootStages.find((n) => `root:${n.id}` === path);
    if (!node) return false;
    const legacyStageId = (node as { legacyStageId?: string }).legacyStageId;
    return sourceStages.find((stage) => stage.id === legacyStageId)?.gate ?? false;
  };

  const accessFor = (path: string): 'read' | 'write' => {
    if (path.includes('declaration:')) {
      return path.includes(':fix') ? 'write' : 'read';
    }
    const node = rootStages.find((n) => `root:${n.id}` === path);
    const legacyStageId = (node as { legacyStageId?: string })?.legacyStageId;
    const stageDef = sourceStages.find((stage) => stage.id === legacyStageId);
    return stageDef?.role === 'reviewer' ? 'read' : 'write';
  };

  const skillFor = (path: string): string => {
    if (path.includes('declaration:')) return reviewSkill;
    const node = rootStages.find((n) => `root:${n.id}` === path);
    const legacyStageId = (node as { legacyStageId?: string })?.legacyStageId;
    return sourceStages.find((stage) => stage.id === legacyStageId)?.skill ?? 'default';
  };

  const roleFor = (path: string): string => {
    if (path.includes('declaration:')) {
      return path.includes(':fix') ? 'implementer' : 'reviewer';
    }
    const node = rootStages.find((n) => `root:${n.id}` === path);
    const legacyStageId = (node as { legacyStageId?: string })?.legacyStageId;
    return sourceStages.find((stage) => stage.id === legacyStageId)?.role ?? 'implementer';
  };

  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:parallel-test',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: allPaths.map((path) => {
      const skill = skillFor(path);
      return {
        nodeId: path,
        authoredCapability: { id: `skill:${skill}`, version: 'legacy' },
        contract: { id: skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
        actionKind: 'agent' as const,
        resultContract: { id: `${skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
        evidenceContract: { id: `${skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
        recovery: 'suspend-if-ambiguous' as const,
        workspace: { access: accessFor(path), resources: ['worktree'] },
        effects: [{
          slot: 'workspace', kind: 'workspace' as const,
          resource: 'worktree', recovery: 'suspend-if-ambiguous' as const,
        }],
        adapter: { id: `adapter:${skill}`, version: '1', contentDigest: `sha256:${'6'.repeat(64)}` },
      };
    }),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: allPaths.map((path) => ({
        nodeId: path,
        role: roleFor(path),
        model: 'default',
        effort: 'default',
        runtime: 'codex',
        sandbox: accessFor(path) === 'read' ? 'read-only' as const : 'workspace-write' as const,
        gate: gateFor(path),
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

describe('ECP-4 lowerer: FanOut/Join lowering via normalizer (M1)', () => {
  // Use lowerRuntimePlanInput (not lowerRuntimePlan) for topology checks:
  // RuntimePlanInput keeps string requires and fanOutTag; createRuntimePlan
  // transforms them to NodeId and fanOut.
  function lowerInput(prepared: PreparedDefinition) {
    return lowerRuntimePlanInput(prepared, parallelV2Profile(prepared), runId);
  }

  it('v1 parallelGroup normalizes+lowers with NO duplicate hierarchical paths (B1 regression)', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    // Before B1 fix, this would throw:
    //   "Node hierarchical path 'root:stage:review' is declared more than once."
    const input = lowerInput(prepared);

    // Verify NO duplicate hierarchical paths
    const paths = input.nodes.map((n) => n.hierarchicalPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('FanOut members lowered with member paths and fanOutTag, not as standalone atomics', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    const input = lowerInput(prepared);

    // The plan input should have:
    // - 3 standalone root atomics: prepare, execute, ship
    // - 1 bounded-loop: review-loop
    // - 1 fan-out node: fanout:experts
    // - 3 fanOut member atomics: review, security, performance (with fanOutTag)
    // - 1 join node: join:experts-join
    const atomicNodes = input.nodes.filter((n) => n.kind === 'atomic');
    const fanOutNodes = input.nodes.filter((n) => n.kind === 'fan-out');
    const joinNodes = input.nodes.filter((n) => n.kind === 'join');
    const loopNodes = input.nodes.filter((n) => n.kind === 'bounded-loop');

    // Standalone atomics (NOT FanOut members — no fanOutTag)
    const standalone = atomicNodes.filter((n) => n.fanOutTag === undefined);
    expect(standalone.map((n) => n.hierarchicalPath).sort()).toEqual([
      'root:stage:execute',
      'root:stage:prepare',
      'root:stage:ship',
    ]);

    // FanOut members (WITH fanOutTag)
    const memberAtomics = atomicNodes.filter((n) => n.fanOutTag !== undefined);
    expect(memberAtomics.map((n) => n.hierarchicalPath).sort()).toEqual([
      'root:stage:performance',
      'root:stage:review',
      'root:stage:security',
    ]);
    // Each member should have fanOutTag pointing to the FanOut node
    for (const member of memberAtomics) {
      expect(member.fanOutTag).toBeDefined();
      expect(member.fanOutTag!.nodeId).toBe('root:fanout:experts');
    }

    // Exactly one FanOut and one Join
    expect(fanOutNodes).toHaveLength(1);
    expect(fanOutNodes[0]!.hierarchicalPath).toBe('root:fanout:experts');
    expect(joinNodes).toHaveLength(1);
    expect(joinNodes[0]!.hierarchicalPath).toBe('root:join:experts-join');

    // One bounded-loop (review-loop)
    expect(loopNodes).toHaveLength(1);
    expect(loopNodes[0]!.hierarchicalPath).toBe('root:stage:review-loop');
  });

  it('FanOut node requires the upstream stage, Join requires the members', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    const input = lowerInput(prepared);

    const fanOut = input.nodes.find((n) => n.kind === 'fan-out')!;
    // FanOut requires the upstream stage (all members required 'execute')
    expect(fanOut.requires).toContain('root:stage:execute');

    const join = input.nodes.find((n) => n.kind === 'join')!;
    // Join requires the member paths
    expect([...join.requires].sort()).toEqual([
      'root:stage:performance',
      'root:stage:review',
      'root:stage:security',
    ]);
    // Join node has correct required/optional member split
    // review has condition: 'always' → required
    // security has condition: 'security-relevant' → optional
    // performance has condition: 'performance-sensitive' → optional
    expect(join.join!.requiredMembers).toEqual(['root:stage:review']);
    expect([...join.join!.optionalMembers].sort()).toEqual([
      'root:stage:performance',
      'root:stage:security',
    ]);
  });

  it('post-parallel review-loop requires the Join node, not individual members', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    const input = lowerInput(prepared);

    const reviewLoop = input.nodes.find(
      (n) => n.kind === 'bounded-loop' && n.hierarchicalPath === 'root:stage:review-loop'
    );
    expect(reviewLoop).toBeDefined();
    // review-loop should require the Join, not individual group members
    expect(reviewLoop!.requires).toContain('root:join:experts-join');
    // Should NOT require individual members
    expect(reviewLoop!.requires).not.toContain('root:stage:review');
    expect(reviewLoop!.requires).not.toContain('root:stage:security');
    expect(reviewLoop!.requires).not.toContain('root:stage:performance');
  });

  it('reconciler accepts the lowered plan and starts from the prepare Gate', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    const profile = parallelV2Profile(prepared);
    // lowerRuntimePlan calls createRuntimePlan — exercises the FULL path
    const plan = lowerRuntimePlan(prepared, profile, runId);

    const result = reconcile(plan, startRecord(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The first action should be an await-gate on root:stage:prepare
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: 'await-gate',
        gateId: 'stage:prepare-gate',
      }),
    ]);
  });

  it('normalizer deduplicates upstream→FanOut connections (m1)', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    // All 3 group members require 'execute'. The normalizer should produce
    // exactly ONE connection from stage:execute to fanout:experts (not 3).
    const fanOutIncoming = prepared.definition.root.connections.filter(
      (c) => c.to.node === 'fanout:experts' && c.from.node === 'stage:execute'
    );
    expect(fanOutIncoming).toHaveLength(1);

    // review-loop requires 3 group members, but all map to the same Join.
    // There should be exactly ONE connection from join:experts-join to
    // stage:review-loop (not 3).
    const joinToReviewLoop = prepared.definition.root.connections.filter(
      (c) => c.from.node === 'join:experts-join' && c.to.node === 'stage:review-loop'
    );
    expect(joinToReviewLoop).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ECP-4: FanOut member path resolution + analyzeReconcilerSupport (m2)
//
// The bugs these guard were only visible through the REAL CLI:
//   - member paths lowered without the `root:` prefix resolve to
//     `nodeId: undefined`, so the FanOut silently stalls (nothing admitted);
//   - the FanOut condition evaluator has no authored skill, so without a
//     synthetic `parallel-dispatch` binding the facade throws
//     "No capability/policy binding for root:fanout:experts" mid-Run.
// ---------------------------------------------------------------------------

/** parallelGroup with NO ReviewCycle loop — reaches the supported_v2_parallel branch. */
const PARALLEL_ONLY = {
  version: 1,
  name: 'parallel-only',
  description: 'parallelGroup fixture without a review cycle',
  stages: [
    { id: 'prepare', skill: 'rasen-propose', role: 'planner', requires: [] },
    {
      id: 'review', skill: 'rasen-review', role: 'reviewer', requires: ['prepare'],
      parallelGroup: 'experts', condition: 'always',
    },
    {
      id: 'security', skill: 'rasen-cso', role: 'reviewer', requires: ['prepare'],
      parallelGroup: 'experts', condition: 'security-relevant',
    },
    {
      id: 'ship', skill: 'rasen-ship', role: 'shipper',
      requires: ['review', 'security'], model: 'sonnet',
    },
  ],
} as const;

describe('ECP-4 lowerer: FanOut member paths resolve to plan nodes', () => {
  it('lowers member paths as FULL plan paths that map to the member atomic nodes', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    const plan = lowerRuntimePlan(prepared, parallelV2Profile(prepared), runId);

    const fanOut = plan.nodes.find((n) => n.kind === 'fan-out')!;
    if (fanOut.kind !== 'fan-out') return;
    // Member paths must carry the `root:` prefix. Without it createRuntimePlan
    // cannot resolve them and every member nodeId comes back undefined.
    expect(fanOut.members.map((m) => m.hierarchicalPath).sort()).toEqual([
      'root:stage:performance',
      'root:stage:review',
      'root:stage:security',
    ]);

    // Every member nodeId must be a real atomic node in the plan.
    const atomicByNodeId = new Map(
      plan.nodes.filter((n) => n.kind === 'atomic').map((n) => [n.nodeId, n] as const)
    );
    for (const member of fanOut.members) {
      expect(member.nodeId).toBeDefined();
      const memberNode = atomicByNodeId.get(member.nodeId);
      expect(memberNode).toBeDefined();
      expect(memberNode!.hierarchicalPath).toBe(member.hierarchicalPath);
    }

    // The Join's required/optional members must reference the same nodeIds.
    const join = plan.nodes.find((n) => n.kind === 'join')!;
    if (join.kind !== 'join') return;
    const memberNodeIds = new Set(fanOut.members.map((m) => m.nodeId));
    for (const nodeId of [...join.requiredMembers, ...join.optionalMembers]) {
      expect(memberNodeIds.has(nodeId)).toBe(true);
    }
  });

  it('rejects a fan-out whose member path is not a plan node', () => {
    const prepared = prepare(PARALLEL_FEATURE);
    const profile = parallelV2Profile(prepared);
    const input = lowerRuntimePlanInput(prepared, profile, runId);
    const broken = {
      ...input,
      nodes: input.nodes.map((node) =>
        node.kind === 'fan-out'
          ? {
              ...node,
              fanOut: {
                ...node.fanOut!,
                members: node.fanOut!.members.map((m) => ({
                  ...m,
                  hierarchicalPath: m.hierarchicalPath.replace('root:', ''),
                })),
              },
            }
          : node
      ),
    };
    expect(() => createRuntimePlan(broken)).toThrow(/unknown member node/);
  });
});

describe('ECP-4 analyzeReconcilerSupport: parallel bindings (m2 / task 10.4)', () => {
  it('reports supported_v2_parallel for a parallelGroup pipeline with no ReviewCycle', () => {
    const prepared = prepare(PARALLEL_ONLY);
    const support = analyzeReconcilerSupport(prepared, parallelV2Profile(prepared));
    expect(support.reconcilerSupport).toMatchObject({
      supported: true,
      reason: 'supported_v2_parallel',
    });
    expect(support.availableEngines).toContain('reconciler');
  });

  it('reports reconciler available for a parallelGroup + ReviewCycle pipeline', () => {
    // full-feature has BOTH, so the ReviewCycle branch wins the reason — but
    // the reconciler must still be an available engine (task 10.4).
    const prepared = prepare(PARALLEL_FEATURE);
    const support = analyzeReconcilerSupport(prepared, parallelV2Profile(prepared));
    expect(support.reconcilerSupport.supported).toBe(true);
    expect(support.availableEngines).toContain('reconciler');
  });

  it('expects a capability binding for the FanOut evaluator (real-CLI regression)', () => {
    // A profile that omits the synthetic `parallel-dispatch` binding must be
    // rejected as a shape mismatch BEFORE a Run starts. Without this the Run
    // starts fine and dies at the first FanOut admission with
    // "No capability/policy binding for root:fanout:experts".
    const prepared = prepare(PARALLEL_FEATURE);
    const withoutEvaluator = parallelV2Profile(prepared, { includeEvaluators: false });
    const support = analyzeReconcilerSupport(prepared, withoutEvaluator);
    expect(support.reconcilerSupport).toMatchObject({
      supported: false,
      reason: 'unsupported_pipeline_shape',
    });
  });
});
