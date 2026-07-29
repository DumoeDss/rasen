import type { Digest } from '../change-run/contracts.js';
import type {
  AtomicStageNode,
  BoundedLoopNode,
  PreparedDefinition,
  CompositeDeclaration,
} from './definition.js';
import type { CapabilityCatalogSnapshot } from './definition.js';
import {
  definitionRequiresV2Lowering,
  orchestrationEvaluatorCapabilityFor,
} from './definition.js';
import type {
  EffectiveRunPolicy,
  ReconcilerSupportProfile,
  RuntimeCapabilityBinding,
  RuntimeExecutionProfile,
  RuntimeExecutionProfileInput,
} from './execution-plan-internal.js';
import { createRuntimeExecutionProfile } from './execution-plan-internal.js';
import { domainDigest } from '../change-run/internal/identity.js';

/**
 * Resolve a prepared v1 Definition's stages into frozen RuntimeCapabilityBindings
 * using the authoritative production capability catalog (task 3.4 profile
 * construction). The catalog descriptor's `version` IS the skill's content
 * digest (ProductionCapabilityDefinition.digest, computed by the workflow
 * catalog); per the design, that single canonical digest binds the contract,
 * Adapter artifact, and result/evidence contracts of the capability. The
 * binding is therefore faithful to the installed skill content without any
 * ad-hoc hashing here.
 *
 * When the normalized definition needs v2 lowering (`definitionRequiresV2Lowering`
 * — a ReviewCycle BoundedLoop for `bug-fix`/`small-feature`, or a FanOut/Join
 * pair from `parallelGroup`), bindings are synthesized for the v2 hierarchical
 * paths (`root:<nodeId>` and `declaration:<bodyId>/node:<phase>`) so the v2
 * lowerer and reconciler can drive them.
 */
export function resolveCapabilityBindings(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot
): readonly RuntimeCapabilityBinding[] {
  if (prepared.authoredVersion !== 1) {
    // ECP-2: resolve capability bindings for v2 authored definitions with
    // CompositeRef and composite-body BoundedLoop nodes.
    return resolveV2AuthoredCapabilityBindings(prepared, catalog);
  }

  // ECP-5 (D4): a v1 definition whose NORMALIZED form carries any v2 construct
  // — a ReviewCycle BoundedLoop, or a FanOut/Join pair from `parallelGroup` —
  // is lowered through the v2 lowerer, which resolves bindings by `root:<id>`.
  // The binding resolver therefore asks the SAME shared predicate the lowerer
  // asks. Before this, a parallel-only v1 definition got flat `stage:<id>`
  // bindings the v2 lowerer could not find (`supported_v2_parallel` was
  // production-unreachable).
  if (definitionRequiresV2Lowering(prepared)) {
    return resolveV2MigrationCapabilityBindings(prepared, catalog);
  }

  const descriptorById = new Map(
    catalog.descriptors.map((descriptor) => [descriptor.id, descriptor] as const)
  );
  const pipeline = prepared.authoredSource as {
    stages: readonly Readonly<{
      id: string;
      skill: string;
      role?: string;
    }>[];
  };

  return pipeline.stages.map((stage) => {
    const skillId = `skill:${stage.skill}`;
    const descriptor = descriptorById.get(skillId);
    if (descriptor === undefined) {
      throw new Error(
        `Capability descriptor for ${skillId} is not in the production catalog.`
      );
    }
    const skillDigest = descriptor.version as Digest;
    const access =
      stage.role === 'reviewer' || stage.role === 'verifier' ? 'read' : 'write';
    const binding: RuntimeCapabilityBinding = {
      nodeId: `stage:${stage.id}`,
      authoredCapability: { id: skillId, version: descriptor.version },
      contract: { id: stage.skill, version: '1', digest: skillDigest },
      actionKind: 'agent',
      resultContract: { id: `${stage.skill}-result`, version: '1', digest: skillDigest },
      evidenceContract: { id: `${stage.skill}-evidence`, version: '1', digest: skillDigest },
      recovery: 'suspend-if-ambiguous',
      workspace: { access: access as 'read' | 'write', resources: ['worktree'] },
      effects: [
        {
          slot: 'workspace',
          kind: 'workspace',
          resource: 'worktree',
          recovery: 'suspend-if-ambiguous',
        },
      ],
      adapter: { id: `adapter:${stage.skill}`, version: '1', contentDigest: skillDigest },
    };
    return binding;
  });
}

/**
 * Resolve v2 hierarchical-path capability bindings for a v1 definition whose
 * normalized form carries a v2 construct (see `definitionRequiresV2Lowering`).
 * Produces:
 *  - `root:<nodeId>` bindings for root AtomicStage nodes — including the
 *    members of a normalized `parallelGroup`, which are root AtomicStages
 *  - `root:<fanOutId>` synthetic evaluator bindings for FanOut nodes
 *  - `declaration:<bodyId>/node:<phaseId>` bindings for BoundedLoop body phases
 *
 * `Join` nodes deliberately get no binding: the Join pass derives its state
 * from committed member results and is never admitted as an Action.
 */
function resolveV2MigrationCapabilityBindings(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot
): readonly RuntimeCapabilityBinding[] {
  const descriptorById = new Map(
    catalog.descriptors.map((descriptor) => [descriptor.id, descriptor] as const)
  );
  const bindings: RuntimeCapabilityBinding[] = [];

  for (const node of prepared.definition.root.nodes) {
    // ECP-4: FanOut condition evaluators need a synthetic binding; legacy
    // Gate/Choice metadata carriers do not.
    const evaluator = orchestrationEvaluatorCapabilityFor(node);
    if (evaluator !== null) {
      bindings.push(buildEvaluatorBinding(`root:${node.id}`, evaluator));
      continue;
    }
    if (node.kind === 'Gate' || node.kind === 'Choice') continue;

    if (node.kind === 'AtomicStage') {
      const path = `root:${node.id}`;
      const skillId = node.capability.id;
      const descriptor = descriptorById.get(skillId);
      if (descriptor === undefined) {
        throw new Error(
          `Capability descriptor for ${skillId} is not in the production catalog.`
        );
      }
      const skillDigest = descriptor.version as Digest;
      const skillName = skillId.startsWith('skill:') ? skillId.slice('skill:'.length) : skillId;
      bindings.push(buildBinding(path, skillName, descriptor.version, skillDigest, inferAccess(node)));
      continue;
    }

    if (node.kind === 'BoundedLoop') {
      // Only ReviewCycle-shaped BoundedLoops are processed.
      const cleanExit = node.exits.clean;
      const continueExit = node.exits.needs_fix;
      if (cleanExit?.action !== 'exit' || continueExit?.action !== 'continue') {
        continue;
      }
      const declaration = prepared.definition.declarations.find(
        (d) => d.id === node.body
      );
      if (declaration === undefined) continue;
      for (const phaseNode of declaration.graph.nodes) {
        if (phaseNode.kind !== 'AtomicStage') continue;
        const path = `declaration:${declaration.id}/node:${phaseNode.id}`;
        const skillId = phaseNode.capability.id;
        const descriptor = descriptorById.get(skillId);
        if (descriptor === undefined) {
          throw new Error(
            `Capability descriptor for ${skillId} is not in the production catalog.`
          );
        }
        const skillDigest = descriptor.version as Digest;
        const skillName = skillId.startsWith('skill:') ? skillId.slice('skill:'.length) : skillId;
        const rcPhase = typeof phaseNode.reviewCyclePhase === 'string' ? phaseNode.reviewCyclePhase : null;
        const gcPhase = typeof (phaseNode as unknown as Readonly<{ goalCyclePhase?: unknown }>).goalCyclePhase === 'string'
          ? (phaseNode as unknown as Readonly<{ goalCyclePhase: string }>).goalCyclePhase
          : null;
        const isWrite = rcPhase === 'fix' || gcPhase === 'work';
        bindings.push(buildBinding(path, skillName, descriptor.version, skillDigest, isWrite ? 'write' : 'read'));
      }
      continue;
    }

    if (node.kind === 'Finish') continue;
  }

  return bindings;
}

/**
 * ECP-4: bind a synthetic orchestration-evaluator capability. The FanOut
 * condition evaluator (`parallel-dispatch`) and the v2-authored Choice
 * evaluator (`choice-select`) are produced by normalization/authoring, not by
 * an authored stage, so no production catalog descriptor backs them. Without a
 * binding the reconciler admits the evaluator and the facade's action builder
 * throws `No capability/policy binding for root:<node>` at the first FanOut —
 * i.e. plan creation succeeds and the real CLI Run dies mid-flight.
 *
 * The digest is derived deterministically from the capability name and the
 * node path, so the sealed profile digest stays stable across launches of the
 * same definition.
 */
function buildEvaluatorBinding(
  path: string,
  capabilityName: 'parallel-dispatch' | 'choice-select'
): RuntimeCapabilityBinding {
  const digest = domainDigest(
    'ecp4-orchestration-evaluator/1',
    capabilityName,
    path
  );
  return {
    nodeId: path,
    authoredCapability: { id: `capability:${capabilityName}`, version: '1' },
    contract: { id: capabilityName, version: '1', digest },
    actionKind: 'agent',
    resultContract: { id: `${capabilityName}-result`, version: '1', digest },
    evidenceContract: { id: `${capabilityName}-evidence`, version: '1', digest },
    recovery: 'suspend-if-ambiguous',
    // The evaluator only reads committed Record state to decide which members
    // (or which branch) are active. It never touches the worktree, so it takes
    // no workspace reservation and declares no effects — matching the
    // `workspace: { access: 'none' }` the lowerer gives the plan node.
    workspace: { access: 'none', resources: [] },
    effects: [],
    adapter: { id: `adapter:${capabilityName}`, version: '1', contentDigest: digest },
  };
}

/** Policy stage for a synthetic orchestration evaluator (read-only, no gate). */
function synthesizeEvaluatorPolicyStage(
  nodeId: string,
  capabilityName: 'parallel-dispatch' | 'choice-select'
): EffectiveRunPolicy['stages'][number] {
  return {
    nodeId,
    role: capabilityName === 'parallel-dispatch' ? 'dispatcher' : 'planner',
    model: 'default',
    effort: 'default',
    runtime: 'codex',
    sandbox: 'read-only',
    gate: false,
    sessionReuse: 'never',
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
  };
}

function inferAccess(node: AtomicStageNode): 'read' | 'write' {
  // Infer workspace access from the legacy stage's role. Reviewer/verifier
  // stages get read; all others get write.
  const legacy = (node as AtomicStageNode & { legacy?: { role?: string } }).legacy;
  if (legacy?.role === 'reviewer' || legacy?.role === 'verifier') {
    return 'read';
  }
  return 'write';
}

function buildBinding(
  nodeId: string,
  skillName: string,
  version: string,
  skillDigest: Digest,
  access: 'read' | 'write'
): RuntimeCapabilityBinding {
  return {
    nodeId,
    authoredCapability: { id: `skill:${skillName}`, version },
    contract: { id: skillName, version: '1', digest: skillDigest },
    actionKind: 'agent',
    resultContract: { id: `${skillName}-result`, version: '1', digest: skillDigest },
    evidenceContract: { id: `${skillName}-evidence`, version: '1', digest: skillDigest },
    recovery: 'suspend-if-ambiguous',
    workspace: { access, resources: ['worktree'] },
    effects: [
      {
        slot: 'workspace',
        kind: 'workspace',
        resource: 'worktree',
        recovery: 'suspend-if-ambiguous',
      },
    ],
    adapter: { id: `adapter:${skillName}`, version: '1', contentDigest: skillDigest },
  };
}

/**
 * ECP-2: Resolve capability bindings for a v2 authored definition with
 * CompositeRef, BoundedLoop, and root-level AtomicStage nodes.
 * Generates `root:<id>` bindings for root AtomicStages and
 * `declaration:<declId>/node:<stageId>` bindings for declaration body stages.
 */
function resolveV2AuthoredCapabilityBindings(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot
): readonly RuntimeCapabilityBinding[] {
  const descriptorById = new Map(
    catalog.descriptors.map((descriptor) => [descriptor.id, descriptor] as const)
  );
  const definition = prepared.definition;
  const bindings: RuntimeCapabilityBinding[] = [];

  for (const node of definition.root.nodes) {
    // ECP-4: FanOut/Choice evaluators get a synthetic binding (see
    // buildEvaluatorBinding) — no authored stage backs them.
    const evaluator = orchestrationEvaluatorCapabilityFor(node);
    if (evaluator !== null) {
      bindings.push(buildEvaluatorBinding(`root:${node.id}`, evaluator));
      continue;
    }

    if (node.kind === 'AtomicStage') {
      const path = `root:${node.id}`;
      const skillId = node.capability.id;
      const descriptor = descriptorById.get(skillId);
      if (descriptor === undefined) {
        throw new Error(
          `Capability descriptor for ${skillId} is not in the production catalog.`
        );
      }
      const skillDigest = descriptor.version as Digest;
      const skillName = skillId.startsWith('skill:') ? skillId.slice('skill:'.length) : skillId;
      bindings.push(buildBinding(path, skillName, descriptor.version, skillDigest, 'write'));
    }

    if (node.kind === 'CompositeRef') {
      const declaration = definition.declarations.find(
        (d) => d.id === node.declarationId
      );
      if (declaration === undefined) continue;
      for (const bodyNode of declaration.graph.nodes) {
        if (bodyNode.kind !== 'AtomicStage') continue;
        const path = `declaration:${declaration.id}/node:${bodyNode.id}`;
        const skillId = bodyNode.capability.id;
        const descriptor = descriptorById.get(skillId);
        if (descriptor === undefined) {
          throw new Error(
            `Capability descriptor for ${skillId} is not in the production catalog.`
          );
        }
        const skillDigest = descriptor.version as Digest;
        const skillName = skillId.startsWith('skill:') ? skillId.slice('skill:'.length) : skillId;
        bindings.push(buildBinding(path, skillName, descriptor.version, skillDigest, 'write'));
      }
    }

    if (node.kind === 'BoundedLoop') {
      const declaration = definition.declarations.find(
        (d) => d.id === node.body
      );
      if (declaration === undefined) continue;
      for (const bodyNode of declaration.graph.nodes) {
        if (bodyNode.kind !== 'AtomicStage') continue;
        const path = `declaration:${declaration.id}/node:${bodyNode.id}`;
        const skillId = bodyNode.capability.id;
        const descriptor = descriptorById.get(skillId);
        if (descriptor === undefined) {
          throw new Error(
            `Capability descriptor for ${skillId} is not in the production catalog.`
          );
        }
        const skillDigest = descriptor.version as Digest;
        const skillName = skillId.startsWith('skill:') ? skillId.slice('skill:'.length) : skillId;
        const access = typeof bodyNode.reviewCyclePhase === 'string' && bodyNode.reviewCyclePhase === 'fix' ? 'write' : 'read';
        bindings.push(buildBinding(path, skillName, descriptor.version, skillDigest, access));
      }
    }
  }

  return bindings;
}

/**
 * Remap policy stages for a v2 authored definition. Generates one policy stage
 * per capability binding path.
 */
function remapPolicyStagesForV2Authored(
  prepared: PreparedDefinition
): readonly EffectiveRunPolicy['stages'][number][] {
  const definition = prepared.definition;
  const stages: EffectiveRunPolicy['stages'][number][] = [];

  for (const node of definition.root.nodes) {
    // ECP-4: mirror the synthetic evaluator capability bindings.
    const evaluator = orchestrationEvaluatorCapabilityFor(node);
    if (evaluator !== null) {
      stages.push(synthesizeEvaluatorPolicyStage(`root:${node.id}`, evaluator));
      continue;
    }
    if (node.kind === 'AtomicStage') {
      stages.push(synthesizeReviewCyclePolicyStage(`root:${node.id}`, 'review'));
    }
    if (node.kind === 'CompositeRef') {
      const declaration = definition.declarations.find(
        (d) => d.id === node.declarationId
      );
      if (declaration === undefined) continue;
      for (const bodyNode of declaration.graph.nodes) {
        if (bodyNode.kind !== 'AtomicStage') continue;
        stages.push(synthesizeReviewCyclePolicyStage(
          `declaration:${declaration.id}/node:${bodyNode.id}`,
          'fix'
        ));
      }
    }
    if (node.kind === 'BoundedLoop') {
      const declaration = definition.declarations.find(
        (d) => d.id === node.body
      );
      if (declaration === undefined) continue;
      for (const bodyNode of declaration.graph.nodes) {
        if (bodyNode.kind !== 'AtomicStage') continue;
        const phase = typeof bodyNode.reviewCyclePhase === 'string' ? bodyNode.reviewCyclePhase : 'fix';
        stages.push(synthesizeReviewCyclePolicyStage(
          `declaration:${declaration.id}/node:${bodyNode.id}`,
          phase
        ));
      }
    }
  }

  return stages;
}

/**
 * Build a full sealed {@link RuntimeExecutionProfile} for a new launch (task
 * 3.4): resolve capability bindings from the authoritative catalog and freeze
 * them together with the effective policy stages and the source revision. The
 * caller supplies the policy stages (from the existing effective-stage
 * metadata resolver) and the path-independent source revision.
 *
 * When the definition needs v2 lowering (`definitionRequiresV2Lowering`), the
 * policy stages are remapped to v2 hierarchical paths so they align with the v2
 * capability bindings and lowerer.
 */
export function resolveRuntimeExecutionProfile(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot,
  policyStages: readonly EffectiveRunPolicy['stages'][number][],
  sourceRevision: RuntimeExecutionProfileInput['sourceRevision'],
  limits: Readonly<{ maxAttempts: number; maxActions: number }>
): RuntimeExecutionProfile {
  const capabilities = resolveCapabilityBindings(prepared, catalog);
  // ECP-2: v2 authored definitions need their own policy stage mapping.
  // ECP-5 (D4): the v1 remap is gated by the SAME shared predicate as the
  // bindings above, so policy stages and capability bindings are always keyed
  // alike — an Action is built by looking BOTH up under one hierarchical path.
  const finalPolicyStages = prepared.authoredVersion === 2
    ? remapPolicyStagesForV2Authored(prepared)
    : definitionRequiresV2Lowering(prepared)
      ? remapPolicyStagesForV2(prepared, policyStages)
      : [...policyStages];

  return createRuntimeExecutionProfile({
    sourceRevision,
    capabilities: [...capabilities],
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: limits.maxAttempts,
      maxActions: limits.maxActions,
      stages: [...finalPolicyStages],
    },
  });
}

/**
 * Resolve the DISCOVERY projection of a prepared definition's execution
 * profile — the capability bindings engine-support analysis compares against
 * the expected node-ID set, plus the discovery digest.
 *
 * ECP-5 (task 6.1). Read planes have no Run: `pipeline show` and the
 * management pipeline-detail endpoint cannot seal a launch profile (that needs
 * a source revision and the run's frozen policy), so they used to pass `null`
 * to `analyzeReconcilerSupport` — which short-circuits to
 * `execution_profile_unavailable` for EVERY pipeline. The effect was that no
 * read plane could ever report a `supported_*` reason, including the
 * `supported_v2_parallel` that `executable-parallel-pipelines` scenario 1
 * requires `rasen pipeline show` to report.
 *
 * The support verdict depends only on the resolved capability node IDs, which
 * are a pure function of `(prepared, catalog)` — policy stages and the source
 * revision feed the sealed profile's digests, never the verdict. So discovery
 * resolves exactly those bindings, through the SAME `resolveCapabilityBindings`
 * the launch profile uses (never a second implementation), and reports the
 * DISCOVERY digest — deliberately the same synthetic marker
 * `analyzeReconcilerSupport` already used for a null profile, so a digest read
 * from a read plane can never be mistaken for the profile a Run froze.
 *
 * Returns `null` — i.e. `execution_profile_unavailable`, fail-closed — when the
 * bindings cannot be resolved at all (a capability missing from the catalog),
 * which is the same verdict discovery gave before and is strictly more truthful
 * than a partial binding set.
 */
export function resolveDiscoveryReconcilerSupportProfile(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot
): ReconcilerSupportProfile | null {
  let capabilities: readonly RuntimeCapabilityBinding[];
  try {
    capabilities = resolveCapabilityBindings(prepared, catalog);
  } catch {
    return null;
  }
  return {
    profileDigest: domainDigest(
      'reconciler-support-profile/1',
      prepared.plan.digest
    ),
    capabilities,
  };
}

/**
 * Remap v1 policy stages (keyed by `stage:<id>`) to v2 hierarchical paths
 * (`root:stage:<id>` for root AtomicStages — including normalized
 * `parallelGroup` members — `root:<fanOutId>` for FanOut evaluators, and
 * `declaration:<bodyId>/node:<phaseId>` for BoundedLoop body phases). Stages
 * absorbed into a BoundedLoop (verify/review-loop) are dropped; their
 * ReviewCycle body phases get fresh policy stages synthesized from the
 * declaration. `Join` nodes get no policy stage — they are never admitted.
 */
function remapPolicyStagesForV2(
  prepared: PreparedDefinition,
  policyStages: readonly EffectiveRunPolicy['stages'][number][]
): readonly EffectiveRunPolicy['stages'][number][] {
  const stageByNodeId = new Map(policyStages.map((s) => [s.nodeId, s] as const));
  const remapped: EffectiveRunPolicy['stages'][number][] = [];

  for (const node of prepared.definition.root.nodes) {
    // ECP-4: keep the policy stages aligned with the capability bindings —
    // both are looked up by hierarchical path when an Action is built.
    const evaluator = orchestrationEvaluatorCapabilityFor(node);
    if (evaluator !== null) {
      remapped.push(synthesizeEvaluatorPolicyStage(`root:${node.id}`, evaluator));
      continue;
    }
    if (node.kind === 'Gate' || node.kind === 'Choice') continue;

    if (node.kind === 'AtomicStage') {
      const legacyStageId = (node as AtomicStageNode & { legacyStageId?: string }).legacyStageId;
      const sourceKey = legacyStageId ? `stage:${legacyStageId}` : null;
      const base = sourceKey ? stageByNodeId.get(sourceKey) : undefined;
      const path = `root:${node.id}`;
      remapped.push(remapPolicyStage(path, base));
      continue;
    }

    if (node.kind === 'BoundedLoop') {
      const cleanExit = node.exits.clean;
      const continueExit = node.exits.needs_fix;
      if (cleanExit?.action !== 'exit' || continueExit?.action !== 'continue') continue;
      const declaration = prepared.definition.declarations.find(
        (d) => d.id === node.body
      );
      if (declaration === undefined) continue;
      for (const phaseNode of declaration.graph.nodes) {
        if (phaseNode.kind !== 'AtomicStage') continue;
        const rcPhase = typeof phaseNode.reviewCyclePhase === 'string' ? phaseNode.reviewCyclePhase : null;
        const gcPhase = typeof (phaseNode as unknown as Readonly<{ goalCyclePhase?: unknown }>).goalCyclePhase === 'string'
          ? (phaseNode as unknown as Readonly<{ goalCyclePhase: string }>).goalCyclePhase
          : null;
        // Map goal-cycle phases to the same roles as review-cycle phases.
        // work → fix (implementer/write), judge → review (reviewer/read).
        const phase = rcPhase ?? (gcPhase === 'work' ? 'fix' : gcPhase === 'judge' ? 'review' : 'review');
        const path = `declaration:${declaration.id}/node:${phaseNode.id}`;
        remapped.push(synthesizeReviewCyclePolicyStage(path, phase));
      }
      continue;
    }

    if (node.kind === 'Finish') continue;
  }

  return remapped;
}

function remapPolicyStage(
  nodeId: string,
  base: EffectiveRunPolicy['stages'][number] | undefined
): EffectiveRunPolicy['stages'][number] {
  if (base === undefined) {
    return synthesizeDefaultPolicyStage(nodeId);
  }
  return { ...base, nodeId };
}

function synthesizeReviewCyclePolicyStage(
  nodeId: string,
  phase: string
): EffectiveRunPolicy['stages'][number] {
  const isFix = phase === 'fix';
  return {
    nodeId,
    role: isFix ? 'implementer' : 'reviewer',
    model: 'default',
    effort: 'default',
    runtime: 'codex',
    sandbox: isFix ? 'workspace-write' : 'read-only',
    gate: false,
    sessionReuse: 'never',
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
  };
}

function synthesizeDefaultPolicyStage(
  nodeId: string
): EffectiveRunPolicy['stages'][number] {
  return {
    nodeId,
    role: 'implementer',
    model: 'default',
    effort: 'default',
    runtime: 'codex',
    sandbox: 'workspace-write',
    gate: false,
    sessionReuse: 'never',
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'default',
      model: 'default',
      effort: 'default',
      runtime: 'default',
      sandbox: 'default',
      gate: 'default',
      sessionReuse: 'default',
      handoffTokenLimit: 'default',
      reuseRoundLimit: 'default',
    },
  };
}
