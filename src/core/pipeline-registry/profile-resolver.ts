import type { Digest } from '../change-run/contracts.js';
import type {
  AtomicStageNode,
  BoundedLoopNode,
  PreparedDefinition,
  CompositeDeclaration,
} from './definition.js';
import type { CapabilityCatalogSnapshot } from './definition.js';
import type {
  EffectiveRunPolicy,
  RuntimeCapabilityBinding,
  RuntimeExecutionProfile,
  RuntimeExecutionProfileInput,
} from './execution-plan-internal.js';
import { createRuntimeExecutionProfile } from './execution-plan-internal.js';

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
    throw new Error('Capability resolution supports only v1 authored definitions.');
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
        const phase = typeof phaseNode.reviewCyclePhase === 'string' ? phaseNode.reviewCyclePhase : 'review';
        bindings.push(buildBinding(path, skillName, descriptor.version, skillDigest, phase === 'fix' ? 'write' : 'read'));
      }
      continue;
    }

    if (node.kind === 'Finish') continue;
  }

  return bindings;
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
  const finalPolicyStages = hasReviewCycleBoundedLoop(prepared)
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
        const phase = typeof phaseNode.reviewCyclePhase === 'string' ? phaseNode.reviewCyclePhase : 'review';
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
