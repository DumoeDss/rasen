import { z } from 'zod';

import { domainDigest } from '../change-run/internal/identity.js';
import type { Digest } from '../change-run/contracts.js';
import type {
  CapabilityDescriptor,
  ChangeRunPlan,
  PreparedDefinition,
} from './definition.js';
import {
  definitionRequiresV2Lowering,
  orchestrationEvaluatorCapabilityFor,
} from './definition.js';
import {
  planValueDigest,
  type DefinitionPlanPayload,
} from './definition-plan-internal.js';
import type { PipelineYaml, Stage } from './types.js';
import { FrozenInferenceRouteSchema } from '../omnicross/contracts.js';
import { WorkerContractZodSchema } from '../worker-contracts.js';

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
const BrandedDigestSchema = DigestSchema.transform(
  (value): Digest => value as Digest
);
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

const AttestationAuthoritySchema = z.strictObject({
  format: z.literal('change-run-attestation-authority/1'),
  algorithm: z.literal('ed25519'),
  keyId: z.string().min(1).max(256),
  keyVersion: z.string().min(1).max(128),
  publicKey: z.strictObject({
    format: z.literal('spki-der'),
    encoding: z.literal('base64'),
    value: z.string().min(1).max(4096),
    digest: DigestSchema,
  }),
});

const RuntimeCapabilityBindingBaseShape = {
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
  adapter: ArtifactSchema.extend({
    attestationAuthority: AttestationAuthoritySchema,
  }).strict(),
} as const;

const RuntimeCapabilityBindingSchema = z.discriminatedUnion('actionKind', [
  z.strictObject({
    ...RuntimeCapabilityBindingBaseShape,
    actionKind: z.literal('agent'),
  }),
  z.strictObject({
    ...RuntimeCapabilityBindingBaseShape,
    actionKind: z.literal('command'),
    command: z.strictObject({
      executable: z.strictObject({
        identity: z.string().min(1).max(256),
        contentDigest: BrandedDigestSchema,
      }),
      argv: z.array(z.string().max(64 * 1024)).max(256),
      env: z.record(z.string().max(128), z.string().max(64 * 1024)),
      workingDirectory: z
        .string()
        .min(1)
        .max(1024)
        .refine((value) => !value.startsWith('/') && !value.includes('\\')),
      timeoutMs: z.number().int().positive().safe(),
    }),
  }),
  z.strictObject({
    ...RuntimeCapabilityBindingBaseShape,
    actionKind: z.literal('host'),
    host: z.strictObject({
      operation: z.enum(['workspace-apply', 'verify', 'ship', 'archive']),
    }),
  }),
]);

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
      /**
       * ECP-5 (D9): the AUTHORED reuse scope, verbatim, beside the two-value
       * `sessionReuse` contract above.
       *
       * Resolution flattens four authored scopes onto two contract values, so
       * `stage`, `run-planner`, and `review-thread` all become
       * `same-invocation` and become indistinguishable in the Record. Unlike
       * `handoffTokenLimit`/`reuseRoundLimit` — values NOBODY chose, which a
       * contract-level rule can protect retroactively — this destroys intent an
       * author DID express, and no future rule can recover what was never
       * recorded. It has to be captured at write time.
       *
       * Optional and undefined-dropped: absent when nothing was authored or the
       * stage is synthesized, so every existing profile digest is unchanged.
       * Nothing reads it in 0.1.6; the Session execution layer is its first
       * reader.
       */
      sessionReuseAuthored: z
        .enum(['none', 'stage', 'run-planner', 'review-thread'])
        .optional(),
      handoffTokenLimit: z.number().int().nonnegative().safe(),
      reuseRoundLimit: z.number().int().nonnegative().safe(),
      /**
       * Structured worker return selected from immutable Definition semantics.
       * Optional only for decoding profiles written before this authority existed.
       */
      workerContract: WorkerContractZodSchema.optional(),
      /** Credential-free logical route frozen at admission. */
      inference: FrozenInferenceRouteSchema.optional(),
      provenance: PolicyProvenanceSchema,
    })
  ),
});

const ConsultationPositiveBound = z.number().int().positive().safe();

/**
 * Frozen opt-in mapping from one source profile path to one exact advisory
 * Teacher profile path. The collection is optional and undefined-dropped so a
 * legacy profile preserves its serialized shape and every pre-change digest.
 */
export const RuntimeConsultationBindingZodSchema = z.strictObject({
  sourceProfilePath: z.string().min(1).max(1024).refine((value) => !value.includes('\\')),
  teacherProfilePath: z.string().min(1).max(1024).refine((value) => !value.includes('\\')),
  maxConsultationsPerInvocation: ConsultationPositiveBound.max(64),
  maxTeacherAttemptsPerConsultation: ConsultationPositiveBound.max(16),
  limits: z.strictObject({
    maxQuestionBytes: ConsultationPositiveBound.max(64 * 1024),
    maxAdviceBytes: ConsultationPositiveBound.max(128 * 1024),
    maxAttemptedApproaches: ConsultationPositiveBound.max(32),
    maxConstraints: ConsultationPositiveBound.max(32),
    maxEvidencePointers: ConsultationPositiveBound.max(64),
    maxAdviceSteps: ConsultationPositiveBound.max(64),
    maxCautions: ConsultationPositiveBound.max(32),
    maxEvidenceNotes: ConsultationPositiveBound.max(64),
  }),
});

export type RuntimeConsultationBinding = Readonly<
  z.infer<typeof RuntimeConsultationBindingZodSchema>
>;

const RuntimeExecutionProfileInputSchema = z.strictObject({
  sourceRevision: SourceRevisionSchema,
  capabilities: z.array(RuntimeCapabilityBindingSchema),
  policy: EffectiveRunPolicySchema,
  consultations: z.array(RuntimeConsultationBindingZodSchema).max(256).optional(),
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
  const consultations = parsed.data.consultations?.slice().sort((left, right) =>
    compareStrings(left.sourceProfilePath, right.sourceProfilePath)
  );
  if (consultations !== undefined) {
    const capabilityByPath = new Map(
      capabilities.map((binding) => [binding.nodeId, binding] as const)
    );
    const policyByPath = new Map(
      policy.stages.map((stage) => [stage.nodeId, stage] as const)
    );
    const sourcePaths = new Set<string>();
    const teacherPaths = new Set<string>();
    for (const binding of consultations) {
      if (sourcePaths.has(binding.sourceProfilePath)) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          `Consultation source path ${binding.sourceProfilePath} is bound more than once.`
        );
      }
      sourcePaths.add(binding.sourceProfilePath);
      teacherPaths.add(binding.teacherProfilePath);
      if (binding.sourceProfilePath === binding.teacherProfilePath) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          'A consultation source and Teacher profile path must be distinct.'
        );
      }
      const sourceCapability = capabilityByPath.get(binding.sourceProfilePath);
      const sourcePolicy = policyByPath.get(binding.sourceProfilePath);
      const teacherCapability = capabilityByPath.get(binding.teacherProfilePath);
      const teacherPolicy = policyByPath.get(binding.teacherProfilePath);
      if (sourceCapability === undefined || sourcePolicy === undefined) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          `Consultation source profile path ${binding.sourceProfilePath} is not frozen in the execution profile.`
        );
      }
      if (
        sourceCapability.actionKind !== 'agent' ||
        sourcePolicy.sessionReuse !== 'same-invocation'
      ) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          `Consultation source ${binding.sourceProfilePath} must be a same-invocation agent Action.`
        );
      }
      if (teacherCapability === undefined || teacherPolicy === undefined) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          `Consultation Teacher profile path ${binding.teacherProfilePath} is not frozen in the execution profile.`
        );
      }
      if (
        teacherCapability.actionKind !== 'agent' ||
        teacherPolicy.sandbox !== 'read-only' ||
        (teacherCapability.workspace.access !== 'none' &&
          teacherCapability.workspace.access !== 'read') ||
        teacherCapability.effects.length !== 0
      ) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          `Consultation Teacher ${binding.teacherProfilePath} must be an effect-free read-only agent with none/read workspace authority.`
        );
      }
    }
    for (const teacherPath of teacherPaths) {
      if (sourcePaths.has(teacherPath)) {
        throw new PlanIntegrityError(
          'unsupported_execution_profile',
          'A consultation Teacher cannot itself be an eligible consultation source.'
        );
      }
    }
  }
  return {
    sourceRevision: parsed.data.sourceRevision,
    capabilities,
    policy,
    ...(consultations === undefined ? {} : { consultations }),
  };
}

export function createRuntimeExecutionProfile(
  input: RuntimeExecutionProfileInput
): RuntimeExecutionProfile {
  const normalized = normalizeProfileInput(input);
  const capabilityProfileDigest = domainDigest(
    'runtime-capability-profile/1',
    normalized.consultations === undefined
      ? normalized.capabilities
      : {
          capabilities: normalized.capabilities,
          consultations: normalized.consultations,
        }
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
    ...(parsed.data.consultations === undefined
      ? {}
      : { consultations: parsed.data.consultations }),
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

/**
 * Re-open a persisted public execution profile and recompute every digest.
 * This is intentionally a verifier, not a permissive cast: Run resume uses it
 * to recover the launch-time trust root without consulting the mutable host
 * catalog and must fail closed if the stored profile was changed.
 */
export function openRuntimeExecutionProfile(
  value: unknown
): RuntimeExecutionProfile {
  return decodeRuntimeProfile(value);
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

/**
 * The projection of a RuntimeExecutionProfile that engine-support analysis
 * actually reads: the resolved capability node IDs (compared against the
 * expected set for the definition's execution shape) and a digest to report.
 *
 * ECP-5 (task 6.1): `RuntimeExecutionProfile` satisfies this structurally, so
 * the launch call site is unchanged — but DISCOVERY call sites (`pipeline
 * show`, the management pipeline-detail endpoint, and therefore the Canvas
 * `EngineSupportPanel`) have no Run and cannot freeze a launch profile. They
 * used to pass `null`, which made every pipeline report
 * `execution_profile_unavailable` and left `supported_*` unreachable from any
 * read plane. They now pass a discovery projection
 * (`resolveDiscoveryReconcilerSupportProfile`), which resolves the same
 * bindings from the same catalog without sealing a profile.
 */
export interface ReconcilerSupportProfile {
  readonly profileDigest: Digest;
  readonly capabilities: readonly { readonly nodeId: string }[];
}

/**
 * The profile's capability node IDs, SORTED — the order every expected-node-ID
 * set below is built in.
 *
 * ECP-5 (task 6.1): a sealed launch profile arrives pre-sorted by
 * `normalizeProfileInput`, so the comparisons below silently depended on that
 * normalization having happened. A discovery profile resolves the same
 * bindings without sealing anything, and its natural (definition) order made
 * every supported pipeline report `unsupported_pipeline_shape` — a false
 * NEGATIVE produced purely by ordering. Sorting here makes the analyzer
 * independent of how its input was built, which is the property the three
 * comparisons always assumed.
 */
function supportProfileNodeIds(
  profile: ReconcilerSupportProfile
): readonly string[] {
  return profile.capabilities
    .map((binding) => binding.nodeId)
    .sort(compareStrings);
}

export interface ReconcilerSupportAnalysis {
  readonly availableEngines: readonly ('legacy' | 'reconciler')[];
  readonly reconcilerSupport: Readonly<{
    supported: boolean;
    reason:
      | 'supported_root_dag_bug_fix'
      | 'supported_v2_review_cycle'
      | 'supported_v2_executable'
      | 'supported_v2_parallel'
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
  // ECP-4: stages with parallelGroup/condition are now supported via
  // FanOut/Join normalization. Only non-standard kinds and loops remain
  // unsupported by the v2 runtime (goal loops are handled separately).
  return pipeline.stages.some(
    (stage) =>
      stage.kind !== 'standard' ||
      stage.loop !== undefined
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

/**
 * ECP-5 (D4): the capability-binding node IDs a v1 definition that needs v2
 * lowering is EXPECTED to carry. This mirrors `resolveV2MigrationCapabilityBindings`
 * node-for-node — root AtomicStages (including normalized `parallelGroup`
 * members) and FanOut/Choice evaluators bind under `root:<id>`; a
 * ReviewCycle-shaped BoundedLoop binds every AtomicStage of its body
 * declaration; Gate, legacy Choice, Join, and Finish bind nothing.
 *
 * It exists so the strict comparison below and the binding resolver derive the
 * expected set from ONE rule. The two inline copies this replaces disagreed
 * about body-node selection, and their divergence is what made
 * `supported_v2_parallel` unreachable for v1 parallel-only pipelines.
 */
function expectedV2MigrationNodeIds(
  prepared: PreparedDefinition
): readonly string[] {
  const ids: string[] = [];
  for (const node of prepared.definition.root.nodes) {
    if (orchestrationEvaluatorCapabilityFor(node) !== null) {
      ids.push(`root:${node.id}`);
      continue;
    }
    if (node.kind === 'AtomicStage') {
      ids.push(`root:${node.id}`);
      continue;
    }
    if (node.kind === 'BoundedLoop') {
      if (
        node.exits.clean?.action !== 'exit' ||
        node.exits.needs_fix?.action !== 'continue'
      ) {
        continue;
      }
      const declaration = prepared.definition.declarations.find(
        (candidate) => candidate.id === node.body
      );
      if (declaration === undefined) continue;
      for (const phaseNode of declaration.graph.nodes) {
        if (phaseNode.kind !== 'AtomicStage') continue;
        ids.push(`declaration:${declaration.id}/node:${phaseNode.id}`);
      }
      if (node.lifecycle.strategy.capability !== undefined) {
        ids.push(`root:${node.id}/strategy`);
      }
    }
  }
  return ids.sort(compareStrings);
}

export function analyzeReconcilerSupport(
  prepared: PreparedDefinition,
  profile: ReconcilerSupportProfile | null
): ReconcilerSupportAnalysis {
  const profileDigest =
    profile?.profileDigest ??
    domainDigest('reconciler-support-profile/1', prepared.plan.digest);
  // Detect v1 definitions whose normalized form supports v2 ReviewCycle.
  const hasV2ReviewCycle = prepared.definition.root.nodes.some(
    (node) =>
      node.kind === 'BoundedLoop' &&
      node.exits.clean?.action === 'exit' &&
      node.exits.needs_fix?.action === 'continue'
  );
  // ECP-5 (D4): the ONE rule that also routes lowering and binding resolution.
  // A v1 definition whose only v2 construct is `parallelGroup` reaches the v2
  // branch here for the first time — previously it fell to the flat bug-fix
  // check and reported `unsupported_pipeline_shape` against `root:<id>`
  // bindings it could never have produced.
  const requiresV2 = definitionRequiresV2Lowering(prepared);
  const unsupported = (
    reason: ReconcilerSupportAnalysis['reconcilerSupport']['reason']
  ): ReconcilerSupportAnalysis =>
    deepFreeze({
      availableEngines:
        prepared.authoredVersion === 1
          ? requiresV2
            ? ['legacy', 'reconciler']
            : ['legacy']
          : prepared.capability.executionMode === 'reconciler'
            ? ['reconciler']
            : [],
      reconcilerSupport: { supported: false, reason, profileDigest },
    });

  if (prepared.authoredVersion === 2) {
    if (prepared.capability.executionMode !== 'reconciler') {
      return unsupported('unsupported_pipeline_semantics');
    }
    if (profile === null) {
      return unsupported('execution_profile_unavailable');
    }
    // ECP-2: include root AtomicStages and ALL declaration body AtomicStages
    // referenced by root-level CompositeRef/BoundedLoop nodes — not just
    // ReviewCyclePhase-tagged ones — so Custom Composite definitions are
    // admitted.  Only declarations actually referenced from root contribute
    // (matching resolveCapabilityBindings).
    const referencedDeclarationIds = new Set<string>();
    for (const rootNode of prepared.definition.root.nodes) {
      if (rootNode.kind === 'CompositeRef') {
        referencedDeclarationIds.add(rootNode.declarationId);
      } else if (rootNode.kind === 'BoundedLoop') {
        referencedDeclarationIds.add(rootNode.body);
      }
    }
    // ECP-4: FanOut/Choice evaluator nodes carry a synthetic capability
    // binding (`parallel-dispatch` / `choice-select`), so they belong in the
    // expected set — otherwise the strict shape check below rejects every
    // definition with a parallel section.
    const expectedRootIds = prepared.definition.root.nodes
      .filter(
        (node) =>
          node.kind === 'AtomicStage' ||
          orchestrationEvaluatorCapabilityFor(node) !== null
      )
      .map((node) => `root:${node.id}`);
    const expectedStrategyIds = prepared.definition.root.nodes
      .filter(
        (node) =>
          node.kind === 'BoundedLoop' &&
          node.lifecycle.strategy.capability !== undefined
      )
      .map((node) => `root:${node.id}/strategy`);
    const expectedBodyIds = prepared.definition.declarations
      .filter((declaration) =>
        referencedDeclarationIds.has(declaration.id)
      )
      .flatMap((declaration) =>
        declaration.graph.nodes
          .filter((node) => node.kind === 'AtomicStage')
          .map(
            (node) => `declaration:${declaration.id}/node:${node.id}`
          )
      );
    const expectedNodeIds = [
      ...expectedRootIds,
      ...expectedBodyIds,
      ...expectedStrategyIds,
    ].sort(
      compareStrings
    );
    if (
      expectedNodeIds.length === 0 ||
      JSON.stringify(supportProfileNodeIds(profile)) !==
        JSON.stringify(expectedNodeIds)
    ) {
      return unsupported('unsupported_pipeline_shape');
    }
    return deepFreeze({
      availableEngines: ['reconciler'],
      reconcilerSupport: {
        supported: true,
        reason: 'supported_v2_executable',
        profileDigest: profile.profileDigest,
      },
    });
  }
  const pipeline = prepared.authoredSource as PipelineYaml;

  // ECP-5 (D4): ONE v2 branch for every v1 definition the v2 lowerer owns —
  // a ReviewCycle/GoalLoop BoundedLoop, a normalized `parallelGroup`, or both.
  // The expected binding set is derived by the shared helper that mirrors the
  // binding resolver, and the strict comparison stays fail-closed: an
  // incomplete binding set reports `unsupported_pipeline_shape` BEFORE any Run
  // is created rather than dying mid-Run at admission with
  // `No capability/policy binding`.
  if (requiresV2) {
    if (profile === null) {
      return unsupported('execution_profile_unavailable');
    }
    const expectedNodeIds = expectedV2MigrationNodeIds(prepared);
    if (
      expectedNodeIds.length === 0 ||
      JSON.stringify(supportProfileNodeIds(profile)) !==
        JSON.stringify(expectedNodeIds)
    ) {
      return unsupported('unsupported_pipeline_shape');
    }
    return deepFreeze({
      availableEngines: ['legacy', 'reconciler'],
      reconcilerSupport: {
        supported: true,
        // A loop-bearing definition keeps its ReviewCycle reason even when it
        // ALSO fans out (full-feature does both); a definition whose only v2
        // construct is `parallelGroup` reports the parallel reason.
        reason: hasV2ReviewCycle
          ? 'supported_v2_review_cycle'
          : 'supported_v2_parallel',
        profileDigest: profile.profileDigest,
      },
    });
  }
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
    JSON.stringify(supportProfileNodeIds(profile)) !==
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
