import type { PreparedDefinition } from '../../pipeline-registry/definition.js';
import type { RuntimeExecutionProfile } from '../../pipeline-registry/execution-plan-internal.js';
import type { PipelineYaml } from '../../pipeline-registry/types.js';
import type { Digest, RunId } from '../contracts.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanGateInput,
  type RuntimePlanInput,
  type RuntimePlanNodeInput,
} from './runtime-plan.js';

/**
 * The private runtime-plan lowerer (task 3.2). It bridges the public
 * Definition + RuntimeExecutionProfile model to the private RuntimePlan the
 * pure reconciler consumes, so the reconciler runs on real plans rather than
 * hand-built fixtures.
 *
 * Only the supported v1 bug-fix root-DAG shape is lowered in this slice
 * (matching `analyzeReconcilerSupport`); Composite/BoundedLoop/GoalLoop/
 * FanOut/Join authored semantics are rejected by `createRuntimePlan` after
 * lowering, never silently interpreted.
 */
export interface LoweredGatePolicy {
  readonly decisionIds: readonly string[];
  readonly outcomes: Readonly<Record<string, 'proceed' | 'fail' | 'escalate'>>;
}

export const DEFAULT_LOWERED_GATE_POLICY: LoweredGatePolicy = Object.freeze({
  decisionIds: Object.freeze(['approve', 'reject']),
  outcomes: Object.freeze({ approve: 'proceed', reject: 'escalate' }),
});

export type RuntimePlanLowererErrorCode =
  | 'unsupported_definition_version'
  | 'lowerer_shape_mismatch';

export class RuntimePlanLowererError extends Error {
  constructor(
    readonly code: RuntimePlanLowererErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RuntimePlanLowererError';
  }
}

function gateInput(
  stageId: string,
  policy: LoweredGatePolicy
): RuntimePlanGateInput {
  return {
    gateId: `${stageId}-gate`,
    decisionIds: [...policy.decisionIds],
    outcomes: { ...policy.outcomes },
  };
}

/**
 * Produce the private {@link RuntimePlanInput} from a prepared Definition and a
 * frozen execution profile. The returned input is fed through
 * {@link createRuntimePlan} for structural validation and topological freezing.
 */
export function lowerRuntimePlanInput(
  prepared: PreparedDefinition,
  profile: RuntimeExecutionProfile,
  runId: RunId,
  gatePolicy: LoweredGatePolicy = DEFAULT_LOWERED_GATE_POLICY
): RuntimePlanInput {
  if (prepared.authoredVersion !== 1) {
    throw new RuntimePlanLowererError(
      'unsupported_definition_version',
      'The runtime plan lowerer supports only v1 authored definitions in this slice.'
    );
  }
  const pipeline = prepared.authoredSource as PipelineYaml;
  if (
    typeof pipeline.name !== 'string' ||
    !Array.isArray(pipeline.stages) ||
    pipeline.stages.length === 0
  ) {
    throw new RuntimePlanLowererError(
      'lowerer_shape_mismatch',
      'Authored v1 definition does not have a valid PipelineYaml shape.'
    );
  }
  const capabilityByPath = new Map(
    profile.capabilities.map((binding) => [binding.nodeId, binding] as const)
  );
  const nodes: RuntimePlanNodeInput[] = pipeline.stages.map((stage) => {
    const path = `stage:${stage.id}`;
    const capability = capabilityByPath.get(path);
    if (capability === undefined) {
      throw new RuntimePlanLowererError(
        'lowerer_shape_mismatch',
        `No capability binding for node ${path}.`
      );
    }
    const node: RuntimePlanNodeInput = {
      kind: 'atomic',
      hierarchicalPath: path,
      requires: stage.requires.map((required) => `stage:${required}`),
      admissionKind: capability.actionKind,
      workspace: { access: capability.workspace.access },
      adaptiveVerify: stage.verifyPolicy === 'adaptive',
      ...(stage.gate ? { gate: gateInput(stage.id, gatePolicy) } : {}),
    };
    return node;
  });

  return {
    runId,
    pipeline: pipeline.name,
    // The plan envelope digest is stored as raw hex; the canonical Digest
    // identity carries the sha256: prefix, so bind the prefixed form here.
    planDigest: `sha256:${prepared.digests.plan}` as Digest,
    profileDigest: profile.profileDigest,
    sourceRevisionDigest: profile.sourceRevision.semanticDigest as Digest,
    capabilityDigest: profile.capabilityProfileDigest,
    policyDigest: profile.policyDigest,
    implicitFinishOutcome: `${pipeline.name}-completed`,
    nodes,
  };
}

export function lowerRuntimePlan(
  prepared: PreparedDefinition,
  profile: RuntimeExecutionProfile,
  runId: RunId,
  gatePolicy: LoweredGatePolicy = DEFAULT_LOWERED_GATE_POLICY
): RuntimePlan {
  return createRuntimePlan(lowerRuntimePlanInput(prepared, profile, runId, gatePolicy));
}
