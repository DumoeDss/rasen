import type { Digest } from '../change-run/contracts.js';
import type {
  AtomicStageNode,
  BoundedLoopNode,
  PreparedDefinition,
  CompositeDeclaration,
} from './definition.js';
import type { CapabilityCatalogSnapshot } from './definition.js';
import { orchestrationEvaluatorCapabilityFor } from './definition.js';
import type {
  EffectiveRunPolicy,
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
 * When the normalized definition contains a ReviewCycle BoundedLoop (D4
 * migration for `bug-fix` and `small-feature`), bindings are synthesized for
 * the v2 hierarchical paths (`root:<nodeId>` and `declaration:<bodyId>/node:<phase>`)
 * so the v2 lowerer and reconciler can drive the ReviewCycle body.
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

  // D4 migration: when the normalized definition has a ReviewCycle BoundedLoop,
  // produce v2 hierarchical-path bindings for both root AtomicStage nodes and
  // BoundedLoop body phases. This makes v1 built-ins route through the same
  // ReviewCycle body as authored v2 definitions.
  if (hasReviewCycleBoundedLoop(prepared)) {
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
 * Detect whether the normalized definition contains a ReviewCycle-shaped
 * BoundedLoop (exits.clean + exits.needs_fix). Used to switch between the
 * v1 atomic profile path and the v2 ReviewCycle migration path.
 */
function hasReviewCycleBoundedLoop(prepared: PreparedDefinition): boolean {
  return prepared.definition.root.nodes.some(
    (node) =>
      node.kind === 'BoundedLoop' &&
      node.exits.clean?.action === 'exit' &&
      node.exits.needs_fix?.action === 'continue'
  );
}

/**
 * Resolve v2 hierarchical-path capability bindings for a v1 definition whose
 * normalized form contains a ReviewCycle BoundedLoop. Produces:
 *  - `root:<nodeId>` bindings for root AtomicStage nodes
 *  - `declaration:<bodyId>/node:<phaseId>` bindings for BoundedLoop body phases
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
 * When the definition has a ReviewCycle BoundedLoop (D4 migration), the policy
 * stages are remapped to v2 hierarchical paths so they align with the v2
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
  const finalPolicyStages = prepared.authoredVersion === 2
    ? remapPolicyStagesForV2Authored(prepared)
    : hasReviewCycleBoundedLoop(prepared)
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
 * Remap v1 policy stages (keyed by `stage:<id>`) to v2 hierarchical paths
 * (`root:stage:<id>` for root AtomicStages, `declaration:<bodyId>/node:<phaseId>`
 * for BoundedLoop body phases). Stages absorbed into a BoundedLoop (verify/
 * review-loop) are dropped; their ReviewCycle body phases get fresh policy
 * stages synthesized from the declaration.
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
