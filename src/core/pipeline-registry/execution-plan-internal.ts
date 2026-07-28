import { z } from 'zod';

import { domainDigest } from '../change-run/internal/identity.js';
import type { Digest } from '../change-run/contracts.js';
import type {
  CapabilityDescriptor,
  ChangeRunPlan,
  PreparedDefinition,
} from './definition.js';
import {
  planValueDigest,
  type DefinitionPlanPayload,
} from './definition-plan-internal.js';
import type { PipelineYaml, Stage } from './types.js';

export type PlanIntegrityErrorCode =
  | 'unsupported_plan_version'
  | 'plan_integrity'
  | 'unsupported_execution_profile';

export class PlanIntegrityError extends Error {
  constructor(
    readonly code: PlanIntegrityErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'PlanIntegrityError';
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new PlanIntegrityError(
      'plan_integrity',
      `${label} must contain exactly ${wanted.join(', ')}.`
    );
  }
}

function readEnvelope(value: unknown): {
  version: 1;
  digest: string;
  payload: Record<string, unknown>;
} {
  if (!isRecord(value)) {
    throw new PlanIntegrityError('plan_integrity', 'Stored plan must be an object.');
  }
  if (value.version !== 1) {
    throw new PlanIntegrityError(
      'unsupported_plan_version',
      `Unsupported stored ChangeRunPlan version ${JSON.stringify(value.version)}.`
    );
  }
  assertExactKeys(value, ['version', 'digest', 'payload'], 'Stored plan envelope');
  if (
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.digest) ||
    !isRecord(value.payload)
  ) {
    throw new PlanIntegrityError(
      'plan_integrity',
      'Stored plan digest or payload is malformed.'
    );
  }
  return {
    version: 1,
    digest: value.digest,
    payload: value.payload,
  };
}

function readBasePayload(
  payload: Record<string, unknown>,
  extraKeys: readonly string[] = []
): DefinitionPlanPayload {
  assertExactKeys(
    payload,
    ['definition', 'catalogVersion', 'capabilities', ...extraKeys],
    'Stored plan payload'
  );
  if (
    payload.catalogVersion !== 1 ||
    !Array.isArray(payload.capabilities) ||
    !isRecord(payload.definition) ||
    payload.definition.version !== 2 ||
    !isRecord(payload.definition.root) ||
    !Array.isArray(payload.definition.root.nodes) ||
    !Array.isArray(payload.definition.root.connections)
  ) {
    throw new PlanIntegrityError(
      'plan_integrity',
      'Stored Definition payload has an invalid closed v1 shape.'
    );
  }
  return {
    definition: payload.definition,
    catalogVersion: 1,
    capabilities:
      payload.capabilities as readonly Readonly<CapabilityDescriptor>[],
  };
}

function calculatePlanDigests(
  payload: DefinitionPlanPayload & Record<string, unknown>
): {
  sourceDigest: string;
  capabilityDigest: string;
  planDigest: string;
} {
  const sourceDigest = planValueDigest(payload.definition);
  const capabilityDigest = planValueDigest({
    version: payload.catalogVersion,
    descriptors: payload.capabilities,
  });
  return {
    sourceDigest,
    capabilityDigest,
    planDigest: planValueDigest({
      version: 1,
      sourceDigest,
      capabilityDigest,
      payload,
    }),
  };
}

export interface OpenedDefinitionPlan extends DefinitionPlanPayload {
  readonly sourceDigest: string;
  readonly capabilityDigest: string;
  readonly planDigest: string;
}

export function openDefinitionPlan(value: unknown): OpenedDefinitionPlan {
  const envelope = readEnvelope(value);
  const payload = readBasePayload(envelope.payload);
  const digests = calculatePlanDigests(
    payload as DefinitionPlanPayload & Record<string, unknown>
  );
  if (digests.planDigest !== envelope.digest) {
    throw new PlanIntegrityError(
      'plan_integrity',
      'Stored plan digest does not match its canonical payload.'
    );
  }
  return deepFreeze({
    ...structuredClone(payload),
    ...digests,
  });
}

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const SourceRevisionSchema = z.strictObject({
  layer: z.enum(['project', 'user', 'package']),
  kind: z.string().min(1).max(128),
  sourceId: z.string().min(1).max(512).refine((value) => !value.includes('\\')),
  authoredContentDigest: DigestSchema,
  semanticDigest: DigestSchema,
});

const ArtifactSchema = z.strictObject({
  id: z.string().min(1).max(256),
  version: z.string().min(1).max(128),
  contentDigest: DigestSchema,
});

const RuntimeCapabilityBindingSchema = z.strictObject({
  nodeId: z.string().min(1).max(512),
  authoredCapability: z.strictObject({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
  }),
  contract: z.strictObject({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    digest: DigestSchema,
  }),
  actionKind: z.enum(['agent', 'command', 'host']),
  resultContract: z.strictObject({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    digest: DigestSchema,
  }),
  evidenceContract: z.strictObject({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    digest: DigestSchema,
  }),
  recovery: z.enum(['retry-same-action', 'suspend-if-ambiguous']),
  workspace: z.strictObject({
    access: z.enum(['none', 'read', 'write']),
    resources: z.array(z.string().min(1).max(512)).max(64),
  }),
  effects: z
    .array(
      z.strictObject({
        slot: z.string().min(1).max(128),
        kind: z.enum(['workspace', 'external']),
        resource: z.string().min(1).max(512),
        recovery: z.enum(['retry-same-action', 'suspend-if-ambiguous']),
      })
    )
    .max(64),
  adapter: ArtifactSchema,
});

const PolicyProvenanceSchema = z.strictObject({
  role: z.string().min(1).max(128),
  model: z.string().min(1).max(128),
  effort: z.string().min(1).max(128),
  runtime: z.string().min(1).max(128),
  sandbox: z.string().min(1).max(128),
  gate: z.string().min(1).max(128),
  sessionReuse: z.string().min(1).max(128),
  handoffTokenLimit: z.string().min(1).max(128),
  reuseRoundLimit: z.string().min(1).max(128),
});

const EffectiveRunPolicySchema = z.strictObject({
  format: z.literal('effective-run-policy/1'),
  maxAttempts: z.number().int().positive().safe(),
  maxActions: z.number().int().positive().safe(),
  stages: z.array(
    z.strictObject({
      nodeId: z.string().min(1).max(512),
      role: z.string().min(1).max(128),
      model: z.string().min(1).max(256),
      effort: z.string().min(1).max(128),
      runtime: z.string().min(1).max(128),
      sandbox: z.enum(['read-only', 'workspace-write']),
      gate: z.boolean(),
      sessionReuse: z.enum(['never', 'same-invocation']),
      handoffTokenLimit: z.number().int().nonnegative().safe(),
      reuseRoundLimit: z.number().int().nonnegative().safe(),
      provenance: PolicyProvenanceSchema,
    })
  ),
});

const RuntimeExecutionProfileInputSchema = z.strictObject({
  sourceRevision: SourceRevisionSchema,
  capabilities: z.array(RuntimeCapabilityBindingSchema),
  policy: EffectiveRunPolicySchema,
});

const RuntimeExecutionProfileSchema = RuntimeExecutionProfileInputSchema.extend({
  format: z.literal('change-run-execution-profile/1'),
  capabilityProfileDigest: DigestSchema,
  policyDigest: DigestSchema,
  profileDigest: DigestSchema,
}).strict();

export type SourceRevision = Readonly<z.infer<typeof SourceRevisionSchema>>;
export type RuntimeCapabilityBinding = Readonly<
  z.infer<typeof RuntimeCapabilityBindingSchema>
>;
export type EffectiveRunPolicy = Readonly<
  z.infer<typeof EffectiveRunPolicySchema>
>;
type RuntimeExecutionProfileShape = z.infer<
  typeof RuntimeExecutionProfileSchema
>;
export interface RuntimeExecutionProfile
  extends Omit<
    RuntimeExecutionProfileShape,
    'capabilityProfileDigest' | 'policyDigest' | 'profileDigest'
  > {
  readonly capabilityProfileDigest: Digest;
  readonly policyDigest: Digest;
  readonly profileDigest: Digest;
}
export type RuntimeExecutionProfileInput = Readonly<
  z.infer<typeof RuntimeExecutionProfileInputSchema>
>;

function zodPlanError(error: z.ZodError): PlanIntegrityError {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `/${issue.path.join('/')}` : '/';
    return `${path}: ${issue.message}`;
  });
  return new PlanIntegrityError(
    'unsupported_execution_profile',
    issues.join('; '),
    issues
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeProfileInput(
  input: RuntimeExecutionProfileInput
): RuntimeExecutionProfileInput {
  const parsed = RuntimeExecutionProfileInputSchema.safeParse(input);
  if (!parsed.success) throw zodPlanError(parsed.error);
  const capabilities = parsed.data.capabilities
    .map((binding) => ({
      ...binding,
      workspace: {
        ...binding.workspace,
        resources: [...binding.workspace.resources].sort(compareStrings),
      },
      effects: [...binding.effects].sort((left, right) =>
        compareStrings(left.slot, right.slot)
      ),
    }))
    .sort((left, right) => compareStrings(left.nodeId, right.nodeId));
  const policy = {
    ...parsed.data.policy,
    stages: [...parsed.data.policy.stages].sort((left, right) =>
      compareStrings(left.nodeId, right.nodeId)
    ),
  };
  return {
    sourceRevision: parsed.data.sourceRevision,
    capabilities,
    policy,
  };
}

export function createRuntimeExecutionProfile(
  input: RuntimeExecutionProfileInput
): RuntimeExecutionProfile {
  const normalized = normalizeProfileInput(input);
  const capabilityProfileDigest = domainDigest(
    'runtime-capability-profile/1',
    normalized.capabilities
  );
  const policyDigest = domainDigest(
    'effective-run-policy/1',
    normalized.policy
  );
  const profileDigest = domainDigest('runtime-execution-profile/1', {
    sourceRevision: normalized.sourceRevision,
    capabilityProfileDigest,
    policyDigest,
  });
  return deepFreeze({
    format: 'change-run-execution-profile/1',
    ...normalized,
    capabilityProfileDigest,
    policyDigest,
    profileDigest,
  }) as RuntimeExecutionProfile;
}

function decodeRuntimeProfile(value: unknown): RuntimeExecutionProfile {
  const parsed = RuntimeExecutionProfileSchema.safeParse(value);
  if (!parsed.success) throw zodPlanError(parsed.error);
  const recreated = createRuntimeExecutionProfile({
    sourceRevision: parsed.data.sourceRevision,
    capabilities: parsed.data.capabilities,
    policy: parsed.data.policy,
  });
  if (
    recreated.capabilityProfileDigest !==
      parsed.data.capabilityProfileDigest ||
    recreated.policyDigest !== parsed.data.policyDigest ||
    recreated.profileDigest !== parsed.data.profileDigest
  ) {
    throw new PlanIntegrityError(
      'plan_integrity',
      'Stored runtime execution profile digest does not match its canonical values.'
    );
  }
  return recreated;
}

export function sealRuntimeExecutionPlan(
  basePlan: ChangeRunPlan,
  profile: RuntimeExecutionProfile
): ChangeRunPlan {
  const opened = openDefinitionPlan(basePlan);
  const checkedProfile = decodeRuntimeProfile(profile);
  const payload = deepFreeze({
    definition: opened.definition,
    catalogVersion: opened.catalogVersion,
    capabilities: opened.capabilities,
    executionProfile: checkedProfile,
  });
  const digests = calculatePlanDigests(
    payload as DefinitionPlanPayload & Record<string, unknown>
  );
  return deepFreeze({
    version: 1,
    digest: digests.planDigest,
    payload,
  }) as ChangeRunPlan;
}

export interface OpenedRuntimeExecutionPlan extends OpenedDefinitionPlan {
  readonly profile: RuntimeExecutionProfile;
  readonly profileDigest: Digest;
}

export function openRuntimeExecutionPlan(
  value: unknown
): OpenedRuntimeExecutionPlan {
  const envelope = readEnvelope(value);
  const payload = readBasePayload(envelope.payload, ['executionProfile']);
  const profile = decodeRuntimeProfile(envelope.payload.executionProfile);
  const fullPayload = {
    ...payload,
    executionProfile: profile,
  };
  const digests = calculatePlanDigests(
    fullPayload as DefinitionPlanPayload & Record<string, unknown>
  );
  if (digests.planDigest !== envelope.digest) {
    throw new PlanIntegrityError(
      'plan_integrity',
      'Stored runtime plan digest does not match its canonical payload.'
    );
  }
  return deepFreeze({
    ...structuredClone(payload),
    ...digests,
    profile,
    profileDigest: profile.profileDigest,
  });
}

export interface RuntimeDriftObservation {
  readonly sourceRevision: Readonly<{
    provenance: 'unchanged' | 'changed' | 'unavailable';
    content: 'unchanged' | 'changed' | 'unavailable';
    semantic: 'unchanged' | 'changed' | 'unavailable';
  }>;
  readonly capability: 'unchanged' | 'changed' | 'unavailable';
  readonly policy: 'unchanged' | 'changed' | 'unavailable';
}

export function observeRuntimeDrift(
  frozen: RuntimeExecutionProfile,
  current: RuntimeExecutionProfile | null
): RuntimeDriftObservation {
  if (current === null) {
    return deepFreeze({
      sourceRevision: {
        provenance: 'unavailable',
        content: 'unavailable',
        semantic: 'unavailable',
      },
      capability: 'unavailable',
      policy: 'unavailable',
    });
  }
  return deepFreeze({
    sourceRevision: {
      provenance:
        frozen.sourceRevision.layer === current.sourceRevision.layer &&
        frozen.sourceRevision.kind === current.sourceRevision.kind &&
        frozen.sourceRevision.sourceId === current.sourceRevision.sourceId
          ? 'unchanged'
          : 'changed',
      content:
        frozen.sourceRevision.authoredContentDigest ===
        current.sourceRevision.authoredContentDigest
          ? 'unchanged'
          : 'changed',
      semantic:
        frozen.sourceRevision.semanticDigest ===
        current.sourceRevision.semanticDigest
          ? 'unchanged'
          : 'changed',
    },
    capability:
      frozen.capabilityProfileDigest === current.capabilityProfileDigest
        ? 'unchanged'
        : 'changed',
    policy:
      frozen.policyDigest === current.policyDigest ? 'unchanged' : 'changed',
  });
}

export interface ReconcilerSupportAnalysis {
  readonly availableEngines: readonly ('legacy' | 'reconciler')[];
  readonly reconcilerSupport: Readonly<{
    supported: boolean;
    reason:
      | 'supported_root_dag_bug_fix'
      | 'unsupported_definition_version'
      | 'unsupported_pipeline_shape'
      | 'unsupported_pipeline_semantics'
      | 'execution_profile_unavailable';
    profileDigest: Digest;
  }>;
}

const BUG_FIX_STAGES = [
  ['propose', 'rasen-propose', []],
  ['apply', 'rasen-apply-change', ['propose']],
  ['verify', 'rasen-review', ['apply']],
  ['ship', 'rasen-ship', ['verify']],
  ['archive', 'rasen-archive-change', ['ship']],
] as const;

function hasUnsupportedSemantics(pipeline: PipelineYaml): boolean {
  return pipeline.stages.some(
    (stage) =>
      stage.kind !== 'standard' ||
      stage.loop !== undefined ||
      stage.parallelGroup !== undefined ||
      stage.condition !== undefined
  );
}

function hasExactBugFixShape(pipeline: PipelineYaml): boolean {
  if (
    pipeline.name !== 'bug-fix' ||
    pipeline.stages.length !== BUG_FIX_STAGES.length
  ) {
    return false;
  }
  return BUG_FIX_STAGES.every(([id, skill, requires], index) => {
    const stage: Stage | undefined = pipeline.stages[index];
    return (
      stage?.id === id &&
      stage.skill === skill &&
      JSON.stringify(stage.requires) === JSON.stringify(requires) &&
      (id !== 'verify' || stage.verifyPolicy === 'adaptive')
    );
  });
}

export function analyzeReconcilerSupport(
  prepared: PreparedDefinition,
  profile: RuntimeExecutionProfile | null
): ReconcilerSupportAnalysis {
  const profileDigest =
    profile?.profileDigest ??
    domainDigest('reconciler-support-profile/1', prepared.plan.digest);
  const unsupported = (
    reason: ReconcilerSupportAnalysis['reconcilerSupport']['reason']
  ): ReconcilerSupportAnalysis =>
    deepFreeze({
      availableEngines: prepared.authoredVersion === 1 ? ['legacy'] : [],
      reconcilerSupport: { supported: false, reason, profileDigest },
    });

  if (prepared.authoredVersion !== 1) {
    return unsupported('unsupported_definition_version');
  }
  const pipeline = prepared.authoredSource as PipelineYaml;
  if (hasUnsupportedSemantics(pipeline)) {
    return unsupported('unsupported_pipeline_semantics');
  }
  if (!hasExactBugFixShape(pipeline)) {
    return unsupported('unsupported_pipeline_shape');
  }
  if (profile === null) {
    return unsupported('execution_profile_unavailable');
  }
  const expectedNodeIds = BUG_FIX_STAGES.map(([id]) => `stage:${id}`).sort(
    compareStrings
  );
  if (
    JSON.stringify(profile.capabilities.map((binding) => binding.nodeId)) !==
    JSON.stringify(expectedNodeIds)
  ) {
    return unsupported('unsupported_pipeline_shape');
  }
  return deepFreeze({
    availableEngines: ['legacy', 'reconciler'],
    reconcilerSupport: {
      supported: true,
      reason: 'supported_root_dag_bug_fix',
      profileDigest: profile.profileDigest,
    },
  });
}
