/**
 * ECP-5 Candidate 2 — v1 parallel-only lowering (delta spec
 * `executable-parallel-pipelines`, "v1 parallel-only pipelines get truthful
 * engine support and lower consistently").
 *
 * A v1 pipeline whose ONLY v2 construct is `parallelGroup` used to be
 * production-unreachable: `resolveCapabilityBindings` emitted flat
 * `stage:<id>` bindings while `lowerRuntimePlanInput` routed any FanOut/Join
 * definition through the v2 lowerer, which resolves bindings by `root:<id>`.
 * Support analysis then reported `unsupported_pipeline_shape`, so
 * `supported_v2_parallel` could never be reached by the v1 audience it exists
 * for. These tests pin the whole seam — bindings, support, lowering, and the
 * first reconcile pass — to the ONE shared predicate
 * (`definitionRequiresV2Lowering`).
 */
import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import type {
  CapabilityCatalogSnapshot,
  PreparedDefinition,
} from '../../../src/core/pipeline-registry/definition.js';
import { definitionRequiresV2Lowering } from '../../../src/core/pipeline-registry/definition.js';
import {
  resolveCapabilityBindings,
  resolveRuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/profile-resolver.js';
import {
  analyzeReconcilerSupport,
  createRuntimeExecutionProfile,
  type EffectiveRunPolicy,
  type RuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import {
  lowerRuntimePlan,
  lowerRuntimePlanInput,
} from '../../../src/core/change-run/internal/lowerer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from '../change-run/reconciler-fixture.js';
import type { JsonValue, RunId } from '../../../src/core/change-run/index.js';

const RUN_ID = `run:${'a'.repeat(64)}` as RunId;

/**
 * A v1 pipeline whose only v2 construct is a `parallelGroup`. Deliberately NO
 * `loop:` stage — a ReviewCycle BoundedLoop would take the other branch and
 * hide exactly the hole this fixture exists to cover. The group is the FIRST
 * stage set so the FIRST reconcile pass reaches the FanOut evaluator.
 */
const PARALLEL_ONLY = {
  version: 1,
  name: 'parallel-only-test',
  description: 'v1 fixture whose only v2 construct is parallelGroup',
  stages: [
    {
      id: 'review',
      skill: 'rasen-review',
      role: 'reviewer',
      requires: [],
      parallelGroup: 'experts',
      condition: 'always',
    },
    {
      id: 'security',
      skill: 'rasen-cso',
      role: 'reviewer',
      requires: [],
      parallelGroup: 'experts',
      condition: 'security-relevant',
    },
    {
      id: 'ship',
      skill: 'rasen-ship',
      role: 'shipper',
      requires: ['review', 'security'],
    },
  ],
} as const;

function descriptor(skill: string, digest: string) {
  return {
    id: `skill:${skill}`,
    version: digest,
    availability: 'enabled' as const,
    inputs: [],
    artifacts: [],
    outcomes: ['completed'],
    limits: {},
  };
}

function catalog(): CapabilityCatalogSnapshot {
  return createCapabilityCatalogSnapshot([
    descriptor('rasen-review', `sha256:${'1'.repeat(64)}`),
    descriptor('rasen-cso', `sha256:${'2'.repeat(64)}`),
    descriptor('rasen-ship', `sha256:${'3'.repeat(64)}`),
  ]);
}

function prepare(): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(PARALLEL_ONLY, catalog());
  if (!result.ok) throw result.error;
  return result.value;
}

const SOURCE_REVISION = {
  layer: 'package',
  kind: 'pipeline-yaml',
  sourceId: 'package:parallel-only-test',
  authoredContentDigest: `sha256:${'7'.repeat(64)}`,
  semanticDigest: `sha256:${'8'.repeat(64)}`,
} as const;

/**
 * The v1-shaped policy stages the CLI hands to `resolveRuntimeExecutionProfile`
 * (`stage:<id>` keyed, straight off the authored PipelineYaml). The resolver is
 * what remaps them onto v2 hierarchical paths — passing already-remapped stages
 * here would test the fixture rather than the production remap.
 */
function v1PolicyStages(): readonly EffectiveRunPolicy['stages'][number][] {
  return PARALLEL_ONLY.stages.map((stage) => ({
    nodeId: `stage:${stage.id}`,
    role: stage.role,
    model: 'default',
    effort: 'default',
    runtime: 'codex' as const,
    sandbox:
      stage.role === 'reviewer'
        ? ('read-only' as const)
        : ('workspace-write' as const),
    gate: false,
    sessionReuse: 'never' as const,
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'stage' as const,
      model: 'default' as const,
      effort: 'default' as const,
      runtime: 'stage' as const,
      sandbox: 'stage' as const,
      gate: 'default' as const,
      sessionReuse: 'default' as const,
      handoffTokenLimit: 'default' as const,
      reuseRoundLimit: 'default' as const,
    },
  }));
}

function productionProfile(prepared: PreparedDefinition): RuntimeExecutionProfile {
  return resolveRuntimeExecutionProfile(
    prepared,
    catalog(),
    v1PolicyStages(),
    SOURCE_REVISION,
    { maxAttempts: 3, maxActions: 64 }
  );
}

/** Apply one reducer stimulus, failing loudly rather than silently skipping. */
function apply(
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(
      `reducer rejected ${stimulus.kind} (${result.failure.code}): ${result.failure.message}`
    );
  }
  return result.record;
}

/** Admit, observe, and commit a succeeded result for the node at `path`. */
function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true }
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  let next = apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true } as JsonValue,
    evidence: evidenceFor(plan, action.actionId),
  });
  return apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
}

function admittedPaths(
  plan: RuntimePlan,
  result: ReturnType<typeof reconcile>
): readonly string[] {
  if (!result.ok) throw new Error('reconcile failed');
  return result.actions
    .filter((action) => action.kind === 'admit')
    .map(
      (action) =>
        plan.nodes.find((node) => node.nodeId === action.nodeId)
          ?.hierarchicalPath ?? '<unknown>'
    )
    .sort();
}

describe('ECP-5: v1 parallel-only pipelines reach the reconciler', () => {
  it('routes a parallel-only v1 definition through the shared v2 predicate', () => {
    const prepared = prepare();
    expect(prepared.authoredVersion).toBe(1);
    // No BoundedLoop — the fixture's only v2 construct is the FanOut/Join pair.
    expect(
      prepared.definition.root.nodes.some((node) => node.kind === 'BoundedLoop')
    ).toBe(false);
    expect(
      prepared.definition.root.nodes.some((node) => node.kind === 'FanOut')
    ).toBe(true);
    expect(definitionRequiresV2Lowering(prepared)).toBe(true);
  });

  it('resolves v2 hierarchical (`root:<id>`) bindings, including the FanOut evaluator', () => {
    const prepared = prepare();
    const bindings = resolveCapabilityBindings(prepared, catalog());
    const nodeIds = bindings.map((binding) => binding.nodeId).sort();

    // Every binding is `root:`-keyed — the v1 flat `stage:<id>` shape the v2
    // lowerer cannot find must not appear at all.
    expect(nodeIds.every((id) => id.startsWith('root:'))).toBe(true);
    expect(nodeIds.some((id) => id.startsWith('stage:'))).toBe(false);

    const fanOut = prepared.definition.root.nodes.find(
      (node) => node.kind === 'FanOut'
    )!;
    const evaluator = bindings.find(
      (binding) => binding.nodeId === `root:${fanOut.id}`
    );
    expect(evaluator?.contract.id).toBe('parallel-dispatch');
    // The evaluator only reads committed Record state.
    expect(evaluator?.workspace.access).toBe('none');
    expect(evaluator?.effects).toEqual([]);

    // Both group members and the downstream stage bind under `root:`.
    expect(nodeIds).toContain('root:stage:review');
    expect(nodeIds).toContain('root:stage:security');
    expect(nodeIds).toContain('root:stage:ship');
    // A Join node is never admitted, so it never gets a binding.
    const join = prepared.definition.root.nodes.find(
      (node) => node.kind === 'Join'
    );
    expect(join).toBeDefined();
    expect(nodeIds).not.toContain(`root:${join!.id}`);
  });

  it('remaps policy stages onto the SAME hierarchical paths as the bindings', () => {
    const profile = productionProfile(prepare());
    const capabilityPaths = profile.capabilities
      .map((binding) => binding.nodeId)
      .sort();
    const policyPaths = profile.policy.stages
      .map((stage) => stage.nodeId)
      .sort();
    // An Action is built by looking BOTH up under one path; a mismatch here is
    // the `No capability/policy binding for root:<node>` mid-Run death.
    expect(policyPaths).toEqual(capabilityPaths);

    // The remap preserved the authored roles rather than defaulting them.
    const reviewStage = profile.policy.stages.find(
      (stage) => stage.nodeId === 'root:stage:review'
    );
    expect(reviewStage?.role).toBe('reviewer');
    expect(reviewStage?.sandbox).toBe('read-only');
    const shipStage = profile.policy.stages.find(
      (stage) => stage.nodeId === 'root:stage:ship'
    );
    expect(shipStage?.role).toBe('shipper');
  });

  it('reports `supported_v2_parallel` with the production profile', () => {
    const prepared = prepare();
    const support = analyzeReconcilerSupport(prepared, productionProfile(prepared));
    expect(support.reconcilerSupport).toMatchObject({
      supported: true,
      reason: 'supported_v2_parallel',
    });
    expect(support.availableEngines).toContain('reconciler');
  });

  it('fails closed before launch when a binding is missing', () => {
    const prepared = prepare();
    const complete = productionProfile(prepared);
    const fanOut = prepared.definition.root.nodes.find(
      (node) => node.kind === 'FanOut'
    )!;
    const evaluatorPath = `root:${fanOut.id}`;
    // Drop the synthetic evaluator binding (and its policy stage) — the exact
    // incomplete-binding shape that must be rejected BEFORE a Run exists,
    // never admitted and then failed mid-Run.
    const incomplete = createRuntimeExecutionProfile({
      sourceRevision: SOURCE_REVISION,
      capabilities: complete.capabilities.filter(
        (binding) => binding.nodeId !== evaluatorPath
      ),
      policy: {
        ...complete.policy,
        stages: complete.policy.stages.filter(
          (stage) => stage.nodeId !== evaluatorPath
        ),
      },
    });
    const support = analyzeReconcilerSupport(prepared, incomplete);
    expect(support.reconcilerSupport).toMatchObject({
      supported: false,
      reason: 'unsupported_pipeline_shape',
    });
  });

  it('lowers to a FanOut + member + Join plan', () => {
    const prepared = prepare();
    const input = lowerRuntimePlanInput(
      prepared,
      productionProfile(prepared),
      RUN_ID
    );

    const fanOutNodes = input.nodes.filter((node) => node.kind === 'fan-out');
    const joinNodes = input.nodes.filter((node) => node.kind === 'join');
    const memberNodes = input.nodes.filter(
      (node) => node.kind === 'atomic' && node.fanOutTag !== undefined
    );
    const standalone = input.nodes.filter(
      (node) => node.kind === 'atomic' && node.fanOutTag === undefined
    );

    expect(fanOutNodes).toHaveLength(1);
    expect(joinNodes).toHaveLength(1);
    expect(memberNodes.map((node) => node.hierarchicalPath).sort()).toEqual([
      'root:stage:review',
      'root:stage:security',
    ]);
    expect(standalone.map((node) => node.hierarchicalPath)).toEqual([
      'root:stage:ship',
    ]);

    // No duplicate hierarchical paths (the B1 regression class).
    const paths = input.nodes.map((node) => node.hierarchicalPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('admits the FanOut condition evaluator on the FIRST reconcile pass', () => {
    const prepared = prepare();
    const plan = lowerRuntimePlan(prepared, productionProfile(prepared), RUN_ID);
    const record = startRecord(plan);
    const result = reconcile(plan, record);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fanOut = prepared.definition.root.nodes.find(
      (node) => node.kind === 'FanOut'
    )!;
    const fanOutPath = `root:${fanOut.id}`;
    const fanOutNodeId = plan.nodes.find(
      (node) => node.hierarchicalPath === fanOutPath
    )!.nodeId;
    const admitted = result.actions.find(
      (action) => action.kind === 'admit' && action.nodeId === fanOutNodeId
    );

    // Semantic smoke, not a shape assertion: the reconciler must actually GRANT
    // the evaluator action carrying its FanOut condition input. This is where
    // the divergent-binding bug surfaced in production as
    // `No capability/policy binding for root:<node>` at the first FanOut.
    expect(admitted).toBeDefined();
    expect(admitted).toMatchObject({
      kind: 'admit',
      admissionKind: 'agent',
      access: 'none',
      input: { fanOutCondition: { fanOutPath } },
    });

    // Members stay closed until the condition evaluator commits — the evaluator
    // is the ONLY thing the first pass can grant.
    expect(
      result.actions.filter((action) => action.kind === 'admit')
    ).toHaveLength(1);

    // The profile the plan was lowered from can actually build that action:
    // both halves of the lookup resolve under the same hierarchical path.
    const profile = productionProfile(prepared);
    expect(
      profile.capabilities.some((binding) => binding.nodeId === fanOutPath)
    ).toBe(true);
    expect(
      profile.policy.stages.some((stage) => stage.nodeId === fanOutPath)
    ).toBe(true);
  });

  /**
   * Task 2.6 — semantic re-review of the REVIVED path, end to end. Reviving a
   * dead code path has bitten this portfolio three times: the fix makes the
   * path reachable, and the newly-reachable path has its own bug. Walking the
   * whole run (evaluator -> members -> join -> downstream -> finish) is the
   * only thing that falsifies that, not a predicate diff.
   */
  it('drives the revived path evaluator -> members -> join -> ship -> finish', () => {
    const prepared = prepare();
    const plan = lowerRuntimePlan(prepared, productionProfile(prepared), RUN_ID);
    const fanOutPath = `root:${
      prepared.definition.root.nodes.find((node) => node.kind === 'FanOut')!.id
    }`;

    let record = startRecord(plan);
    expect(admittedPaths(plan, reconcile(plan, record))).toEqual([fanOutPath]);

    // The evaluator's committed result activates both members.
    record = commitNode(plan, record, fanOutPath, {
      activeMembers: ['root:stage:review', 'root:stage:security'],
      inactiveMembers: [],
      rationale: {},
    });
    expect(admittedPaths(plan, reconcile(plan, record))).toEqual([
      'root:stage:review',
      'root:stage:security',
    ]);

    // Both members succeed; the Join proceeds and unblocks the downstream
    // stage that `requires` them.
    record = commitNode(plan, record, 'root:stage:review');
    record = commitNode(plan, record, 'root:stage:security');
    expect(admittedPaths(plan, reconcile(plan, record))).toEqual([
      'root:stage:ship',
    ]);

    record = commitNode(plan, record, 'root:stage:ship');
    const final = reconcile(plan, record);
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.actions.some((action) => action.kind === 'finish')).toBe(true);
  });
});
