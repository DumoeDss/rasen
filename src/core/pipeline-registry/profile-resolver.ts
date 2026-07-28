import type { Digest } from '../change-run/contracts.js';
import type { PreparedDefinition } from './definition.js';
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
 */
export function resolveCapabilityBindings(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot
): readonly RuntimeCapabilityBinding[] {
  if (prepared.authoredVersion !== 1) {
    throw new Error('Capability resolution supports only v1 authored definitions.');
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
 * Build a full sealed {@link RuntimeExecutionProfile} for a new launch (task
 * 3.4): resolve capability bindings from the authoritative catalog and freeze
 * them together with the effective policy stages and the source revision. The
 * caller supplies the policy stages (from the existing effective-stage
 * metadata resolver) and the path-independent source revision.
 */
export function resolveRuntimeExecutionProfile(
  prepared: PreparedDefinition,
  catalog: CapabilityCatalogSnapshot,
  policyStages: readonly EffectiveRunPolicy['stages'][number][],
  sourceRevision: RuntimeExecutionProfileInput['sourceRevision'],
  limits: Readonly<{ maxAttempts: number; maxActions: number }>
): RuntimeExecutionProfile {
  return createRuntimeExecutionProfile({
    sourceRevision,
    capabilities: [...resolveCapabilityBindings(prepared, catalog)],
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: limits.maxAttempts,
      maxActions: limits.maxActions,
      stages: [...policyStages],
    },
  });
}
