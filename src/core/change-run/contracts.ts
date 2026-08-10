import { z } from 'zod';
import {
  AgentContinuationGrantZodSchema,
  decodeAgentContinuationGrant,
  type AgentContinuationGrant,
  type ConsultationContentLimits,
} from './consultation-contracts.js';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type Digest = Brand<string, 'Digest'>;
export type PlanningSpaceId = Brand<string, 'PlanningSpaceId'>;
export type ChangeInstanceId = Brand<string, 'ChangeInstanceId'>;
export type WorkspaceInstanceId = Brand<string, 'WorkspaceInstanceId'>;
export type RunId = Brand<string, 'RunId'>;
export type NodeId = Brand<string, 'NodeId'>;
export type InvocationId = Brand<string, 'InvocationId'>;
export type AttemptId = Brand<string, 'AttemptId'>;
export type EffectId = Brand<string, 'EffectId'>;
export type ActionId = Brand<string, 'ActionId'>;
export type WaitId = Brand<string, 'WaitId'>;
export type LaunchRequestId = Brand<string, 'LaunchRequestId'>;
export type RecordVersion = Brand<number, 'RecordVersion'>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ChangeRunContractErrorCode =
  | 'invalid_run_contract'
  | 'unsupported_contract_version'
  | 'unsupported_view_version'
  | 'invalid_run_invariant';

export class ChangeRunContractError extends Error {
  constructor(
    readonly code: ChangeRunContractErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'ChangeRunContractError';
  }
}

const IDENTITY_HEX = '[0-9a-f]{64}';
const identity = <Prefix extends string>(prefix: Prefix) =>
  z.string().regex(new RegExp(`^${prefix}:${IDENTITY_HEX}$`));
const DigestSchema = z.string().regex(new RegExp(`^sha256:${IDENTITY_HEX}$`));
const PlanningSpaceIdSchema = identity('planning-space');
const ChangeInstanceIdSchema = identity('change-instance');
const WorkspaceInstanceIdSchema = identity('workspace-instance');
const RunIdSchema = identity('run');
const NodeIdSchema = identity('node');
const InvocationIdSchema = identity('invocation');
const AttemptIdSchema = identity('attempt');
const EffectIdSchema = identity('effect');
const ActionIdSchema = identity('action');
const WaitIdSchema = identity('wait');
const SafeIntegerSchema = z.number().int().nonnegative().safe();
const UuidShape = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const JsonValueSchema = z.json();

const WorkspaceRevisionSchema = z.strictObject({
  format: z.literal('workspace-revision/1'),
  head: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('commit'),
      digest: DigestSchema,
      detached: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal('unborn'),
      detached: z.literal(false),
    }),
  ]),
  treeDigest: DigestSchema,
  dirtyWorktreeDigest: DigestSchema,
});

export type WorkspaceRevision = Readonly<z.infer<typeof WorkspaceRevisionSchema>>;

const EvidenceProducerSchema = z.strictObject({
  id: z.string().min(1).max(256),
  version: z.string().min(1).max(128),
  identityDigest: DigestSchema,
});

const EvidenceBindingSchema = z.strictObject({
  planningSpaceId: PlanningSpaceIdSchema,
  changeInstanceId: ChangeInstanceIdSchema,
  projectId: z.string().min(1).max(256),
  changeId: z.string().min(1).max(128),
  runId: RunIdSchema,
  actionId: ActionIdSchema,
  effectId: EffectIdSchema.optional(),
  treeDigest: DigestSchema.optional(),
  schema: z.string().min(1).max(256),
});

const LegacyEvidenceRefV1Schema = z.strictObject({
  format: z.literal('change-run-evidence-ref/1'),
  store: z.literal('change-run'),
  evidenceDigest: DigestSchema,
  contentDigest: DigestSchema,
  mediaType: z.string().min(1).max(256),
  size: SafeIntegerSchema,
  observationKind: z.string().min(1).max(256),
  producer: EvidenceProducerSchema,
  binding: EvidenceBindingSchema,
});

const EvidenceProofV1Schema = z.strictObject({
  format: z.literal('change-run-evidence-proof/1'),
  authorityDigest: DigestSchema,
  signature: z.string().min(1).max(256),
});

const AttestedEvidenceRefV2Schema = z.strictObject({
  format: z.literal('change-run-evidence-ref/2'),
  evidenceDigest: DigestSchema,
  contentDigest: DigestSchema,
  mediaType: z.string().min(1).max(256),
  sizeBytes: SafeIntegerSchema,
  observationKind: z.string().min(1).max(256),
  producer: EvidenceProducerSchema,
  binding: EvidenceBindingSchema,
  proof: EvidenceProofV1Schema,
});

const EvidenceRefSchema = z.discriminatedUnion('format', [
  LegacyEvidenceRefV1Schema,
  AttestedEvidenceRefV2Schema,
]);

export type LegacyEvidenceRefV1 = Readonly<
  z.infer<typeof LegacyEvidenceRefV1Schema>
>;
export type AttestedEvidenceRefV2 = Readonly<
  z.infer<typeof AttestedEvidenceRefV2Schema>
>;
export type EvidenceRef = Readonly<z.infer<typeof EvidenceRefSchema>>;

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

export type AttestationAuthority = Readonly<
  z.infer<typeof AttestationAuthoritySchema>
>;

const AdapterSchema = z.strictObject({
  id: z.string().min(1).max(256),
  version: z.string().min(1).max(128),
  artifactDigest: DigestSchema,
});

const ActorRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    format: z.literal('change-run-actor/1'),
    kind: z.literal('agent'),
    identityDigest: DigestSchema,
    role: z.string().min(1).max(128),
    provider: z.string().min(1).max(128),
    runtime: z.string().min(1).max(128),
    principalIdentityDigest: DigestSchema,
    sessionIdentityDigest: DigestSchema,
    adapter: AdapterSchema,
  }),
  z.strictObject({
    format: z.literal('change-run-actor/1'),
    kind: z.literal('command'),
    identityDigest: DigestSchema,
    adapter: AdapterSchema,
    executable: z.strictObject({
      id: z.string().min(1).max(256),
      artifactDigest: DigestSchema,
    }),
  }),
  z.strictObject({
    format: z.literal('change-run-actor/1'),
    kind: z.literal('host'),
    identityDigest: DigestSchema,
    adapter: AdapterSchema,
    principalIdentityDigest: DigestSchema,
  }),
]);

export type ActorRef = Readonly<z.infer<typeof ActorRefSchema>>;

const EvidenceUseAuthoritySchema = z.strictObject({
  producer: EvidenceProducerSchema,
  observationKind: z.string().min(1).max(256),
  schema: z.string().min(1).max(256),
  mediaType: z.string().min(1).max(256),
});

/**
 * Immutable completion authority copied into every newly admitted Action.
 * The field is optional only so pre-authority Records remain decodable and
 * inspectable; every completion mutation fails closed when an old Action lacks it.
 */
const CompletionAuthoritySchema = z.strictObject({
  format: z.literal('change-run-completion-authority/1'),
  actor: ActorRefSchema,
  actorAttestation: EvidenceUseAuthoritySchema,
  observations: z.strictObject({
    domainActionResult: EvidenceUseAuthoritySchema,
    effectObservation: EvidenceUseAuthoritySchema,
    infrastructureObservation: EvidenceUseAuthoritySchema,
  }),
  /**
   * Additive for legacy decoding. Newly admitted executable Actions always
   * carry this frozen public trust root; completion fails closed when absent.
   */
  attestationAuthority: AttestationAuthoritySchema.optional(),
});

export type CompletionAuthority = Readonly<
  z.infer<typeof CompletionAuthoritySchema>
>;

const EffectDescriptorSchema = z.strictObject({
  slot: z.string().min(1).max(128),
  effectId: EffectIdSchema,
  kind: z.enum(['workspace', 'external']),
  resource: z.string().min(1).max(512),
  recovery: z.enum(['retry-same-action', 'suspend-if-ambiguous']),
  operation: z.strictObject({
    operationKey: z.string().min(1).max(512),
    ownershipMarkerContract: z.string().min(1).max(256),
    conflictPolicy: z.enum(['fail', 'uncertain']),
  }),
});

const CapabilityBindingSchema = z.strictObject({
  id: z.string().min(1).max(256),
  authoredVersion: z.string().min(1).max(128),
  contractId: z.string().min(1).max(256),
  contractVersion: z.string().min(1).max(128),
  contractDigest: DigestSchema,
  artifact: z.strictObject({
    id: z.string().min(1).max(256),
    version: z.string().min(1).max(128),
    contentDigest: DigestSchema,
  }),
});

const RunActionBaseShape = {
  format: z.literal('change-run-action/1'),
  runId: RunIdSchema,
  nodeId: NodeIdSchema,
  invocationId: InvocationIdSchema,
  attemptId: AttemptIdSchema,
  actionId: ActionIdSchema,
  effects: z.array(EffectDescriptorSchema).max(64),
  executionProfileDigest: DigestSchema,
  capability: CapabilityBindingSchema,
  resultContractDigest: DigestSchema,
  evidenceContractDigest: DigestSchema,
  completionAuthority: CompletionAuthoritySchema.optional(),
  policyDigest: DigestSchema,
  workspace: z.strictObject({
    access: z.enum(['none', 'read', 'write']),
    resources: z.array(z.string().min(1).max(512)).max(64),
  }),
  expectedBeforeWorkspace: WorkspaceRevisionSchema,
} as const;

const RunActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...RunActionBaseShape,
    kind: z.literal('agent'),
    agent: z.strictObject({
      role: z.string().min(1).max(128),
      model: z.string().min(1).max(256),
      reasoningEffort: z.string().min(1).max(128),
      runtime: z.string().min(1).max(128),
      sandbox: z.string().min(1).max(128),
      input: JsonValueSchema,
      consultation: z
        .strictObject({
          eligible: z.literal(true),
          sourceProfilePath: z.string().min(1).max(1024),
          teacherProfilePath: z.string().min(1).max(1024),
          bindingDigest: DigestSchema,
        })
        .optional(),
      session: z.strictObject({
        reuse: z.enum(['never', 'same-invocation']),
        /**
         * ECP-5 (D9): the authored reuse scope, verbatim. Optional and
         * undefined-dropped — absent when nothing was authored or the stage was
         * synthesized, so existing action digests are byte-identical. It exists
         * because the two-value `reuse` above cannot express the four authored
         * scopes, and an author's expressed intent is not recoverable after the
         * fact. Nothing enforces it in 0.1.6.
         */
        sessionReuseAuthored: z
          .enum(['none', 'stage', 'run-planner', 'review-thread'])
          .optional(),
        /**
         * PLACEHOLDER — see the `ecp-change-run-runtime` requirement
         * "Recorded session guidance is placeholder until a slice defines its
         * authoritative source". 0.1.6 offers no config or authoring surface
         * for these two, so every 0.1.6-era recorded value is a placeholder by
         * definition, not an operator's or author's choice. A future reader
         * MUST derive real limits from its own slice's authoritative source —
         * in particular, enforcing the recorded `reuseRoundLimit: 1` would
         * forbid reviewer reuse across review rounds, the primary reuse
         * pattern.
         */
        handoffTokenLimit: SafeIntegerSchema,
        reuseRoundLimit: SafeIntegerSchema,
      }),
    }),
  }),
  z.strictObject({
    ...RunActionBaseShape,
    kind: z.literal('command'),
    command: z.strictObject({
      artifact: z.strictObject({
        id: z.string().min(1).max(256),
        version: z.string().min(1).max(128),
        contentDigest: DigestSchema,
      }),
      executable: z.strictObject({
        identity: z.string().min(1).max(256),
        contentDigest: DigestSchema,
      }),
      argv: z.array(z.string().max(64 * 1024)).max(256),
      env: z.record(z.string().max(128), z.string().max(64 * 1024)),
      workspaceInstanceId: WorkspaceInstanceIdSchema,
      workingDirectory: z
        .string()
        .min(1)
        .max(1024)
        .refine((value) => !value.startsWith('/') && !value.includes('\\')),
      timeoutMs: SafeIntegerSchema,
      shell: z.literal(false),
    }),
  }),
  z.strictObject({
    ...RunActionBaseShape,
    kind: z.literal('host'),
    host: z.strictObject({
      operation: z.enum(['workspace-apply', 'verify', 'ship', 'archive']),
      input: JsonValueSchema,
    }),
  }),
]);

export type RunAction = Readonly<z.infer<typeof RunActionSchema>>;

const ChangeRefSchema = z.strictObject({
  projectRoot: z.string().min(1).max(4096),
  changeId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const ExactChangeRunRefSchema = z.strictObject({
  change: ChangeRefSchema,
  runId: RunIdSchema,
});

export type ChangeRef = Readonly<z.infer<typeof ChangeRefSchema>>;
export type ExactChangeRunRef = Readonly<z.infer<typeof ExactChangeRunRefSchema>>;

const CompletionBaseShape = {
  format: z.literal('change-run-completion/1'),
  change: ChangeRefSchema,
  runId: RunIdSchema,
  actionId: ActionIdSchema,
  invocationId: InvocationIdSchema,
  receiptDigest: DigestSchema,
  actor: ActorRefSchema,
  actorAttestation: EvidenceRefSchema,
  evidence: z.array(EvidenceRefSchema).max(64),
} as const;

const CompleteRunActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...CompletionBaseShape,
    kind: z.literal('domain-action-result'),
    status: z.enum(['succeeded', 'failed', 'blocked']),
    result: JsonValueSchema,
  }),
  z.strictObject({
    ...CompletionBaseShape,
    kind: z.literal('effect-observation'),
    effectId: EffectIdSchema,
    status: z.enum(['succeeded', 'failed', 'not_executed']),
    observation: JsonValueSchema,
  }),
  z.strictObject({
    ...CompletionBaseShape,
    kind: z.literal('infrastructure-observation'),
    status: z.literal('infrastructure_failed'),
    error: z.strictObject({
      code: z.string().min(1).max(256),
      retryable: z.boolean(),
      adapterArtifactDigest: DigestSchema,
    }),
  }),
]);

export type CompleteRunAction = Readonly<z.infer<typeof CompleteRunActionSchema>>;

const ControlCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resume'), waitId: WaitIdSchema }),
  z.strictObject({
    kind: z.literal('decision'),
    waitId: WaitIdSchema,
    decisionId: z.string().min(1).max(256),
    outcome: z.string().min(1).max(256),
    evidence: z.array(EvidenceRefSchema).max(64).optional(),
  }),
  z.strictObject({
    kind: z.literal('accept-workspace-revision'),
    waitId: WaitIdSchema,
    revision: WorkspaceRevisionSchema,
    evidence: z.array(EvidenceRefSchema).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal('escalate'),
    reason: z.string().min(1).max(4096),
  }),
  z.strictObject({
    kind: z.literal('cancel'),
    reason: z.string().max(4096).optional(),
  }),
]);

const ChangeRunControlRequestSchema = z.strictObject({
  format: z.literal('change-run-control/1'),
  ref: ExactChangeRunRefSchema,
  expectedRecordVersion: SafeIntegerSchema,
  command: ControlCommandSchema,
});

export type ChangeRunControlRequest = Readonly<
  z.infer<typeof ChangeRunControlRequestSchema>
>;

const EffectViewSchema = z.strictObject({
  slot: z.string().min(1).max(128),
  effectId: EffectIdSchema,
  state: z.enum([
    'admitted',
    'succeeded',
    'failed',
    'not_executed',
    'uncertain',
    'infrastructure_failed',
  ]),
});

const WaitBaseShape = {
  waitId: WaitIdSchema,
} as const;
const WaitViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('gate'),
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    gateId: z.string().min(1).max(256),
    decisionIds: z.array(z.string().min(1).max(256)).max(64),
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('domain-blocked'),
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).max(64),
    reasonCode: z.string().min(1).max(256),
    evidence: z.array(EvidenceRefSchema).max(64),
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('human-required'),
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).max(64),
    loopPath: z.string().min(1).max(1024),
    phase: z.string().min(1).max(256),
    blockerFingerprint: DigestSchema,
    reasonCode: z.string().min(1).max(256),
    outcome: z.string().min(1).max(256),
    evidence: z.array(EvidenceRefSchema).max(64),
    decisionIds: z.tuple([z.literal('retry'), z.literal('escalate')]),
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('infrastructure'),
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).max(64),
    code: z.string().min(1).max(256),
    retryable: z.boolean(),
    artifactDigest: DigestSchema,
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('uncertain-effect'),
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).min(1).max(64),
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('capability-unavailable'),
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).max(64),
    code: z.string().min(1).max(256),
    capabilityDigest: DigestSchema,
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('workspace-drift'),
    workspaceInstanceId: WorkspaceInstanceIdSchema,
    expected: WorkspaceRevisionSchema,
    observed: WorkspaceRevisionSchema,
  }),
  z.strictObject({
    ...WaitBaseShape,
    kind: z.literal('workspace-reservation'),
    workspaceInstanceId: WorkspaceInstanceIdSchema,
    intents: z.array(
      z.strictObject({
        nodeId: NodeIdSchema,
        invocationId: InvocationIdSchema,
        occurrence: SafeIntegerSchema,
        access: z.enum(['read', 'write']),
      })
    ),
  }),
]);

const AllowedControlSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resume'), waitId: WaitIdSchema }),
  z.strictObject({
    kind: z.literal('decision'),
    waitId: WaitIdSchema,
    decisionId: z.string().min(1).max(256),
    outcomes: z.array(z.string().min(1).max(256)).max(64),
  }),
  z.strictObject({
    kind: z.literal('accept-workspace-revision'),
    waitId: WaitIdSchema,
    revision: WorkspaceRevisionSchema,
  }),
  z.strictObject({ kind: z.literal('escalate') }),
  z.strictObject({ kind: z.literal('cancel') }),
]);

const TerminalViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('completed'),
    outcome: z.string().min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal('escalated'),
    code: z.string().min(1).max(256),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    kind: z.literal('failed'),
    code: z.string().min(1).max(256),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    kind: z.literal('cancelled'),
    reason: z.string().max(4096).optional(),
  }),
]);

const RunActionViewSchema = z.strictObject({
  format: z.literal('change-run-action-view/1'),
  kind: z.enum(['agent', 'command', 'host']),
  actionId: ActionIdSchema,
  invocationId: InvocationIdSchema,
  attemptId: AttemptIdSchema,
  nodeId: NodeIdSchema,
  deliveryState: z.enum(['admitted_undelivered', 'granted', 'paused', 'closed']),
  capability: z.strictObject({
    id: z.string().min(1).max(256),
    contractVersion: z.string().min(1).max(128),
    contractDigest: DigestSchema,
    artifactDigest: DigestSchema,
  }),
  completionAuthority: CompletionAuthoritySchema.optional(),
  expectedBeforeWorkspace: WorkspaceRevisionSchema.optional(),
  effects: z.array(EffectViewSchema).max(64),
});

const RootDagViewSectionSchema = z.strictObject({
  kind: z.literal('root-dag'),
  version: z.literal(1),
  frontier: z.array(NodeIdSchema),
  activeInvocations: z.array(
    z.strictObject({
      invocationId: InvocationIdSchema,
      nodeId: NodeIdSchema,
      attemptId: AttemptIdSchema,
      actionIds: z.array(ActionIdSchema),
      effects: z.array(EffectViewSchema).max(64),
    })
  ),
  actions: z.array(RunActionViewSchema),
  waits: z.array(WaitViewSchema),
  terminal: TerminalViewSchema.optional(),
  workspace: z.strictObject({
    current: WorkspaceRevisionSchema,
    expectedByActiveWriters: z.array(WorkspaceRevisionSchema),
  }),
  effectDiagnostics: z.array(
    EffectViewSchema.extend({ reason: z.string().max(4096).optional() })
  ),
  allowedControls: z.array(AllowedControlSchema),
});

export type RootDagViewSection = Readonly<
  z.infer<typeof RootDagViewSectionSchema>
>;

const ReviewCycleFindingSchema = z.strictObject({
  id: z.string().min(1).max(256),
  severity: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  claim: z.string().min(1).max(4096),
  location: z.string().min(1).max(1024).optional(),
});

const ReviewCycleActorsSchema = z
  .strictObject({
    fixer: ActorRefSchema.optional(),
    verifier: ActorRefSchema.optional(),
    lastActor: ActorRefSchema.optional(),
  });

const ReviewCycleViewSectionSchema = z.strictObject({
  kind: z.literal('review-cycle'),
  version: z.literal(1),
  loopPath: z.string().min(1).max(512),
  round: SafeIntegerSchema,
  phase: z.enum(['review', 'triage', 'fix', 're-review']),
  outcome: z.enum(['clean', 'exhausted']).optional(),
  findings: z.array(ReviewCycleFindingSchema),
  actors: ReviewCycleActorsSchema,
  waitReason: z.string().min(1).max(256).optional(),
  maxRounds: SafeIntegerSchema,
});

export type ReviewCycleViewSection = Readonly<
  z.infer<typeof ReviewCycleViewSectionSchema>
>;

const GoalViewSectionSchema = z.strictObject({
  kind: z.literal('goal'),
  version: z.literal(1),
  loopPath: z.string().min(1).max(1024),
  variant: z.enum(['measure', 'evaluate', 'research']),
  round: SafeIntegerSchema,
  phase: z.enum(['work', 'judge']),
  outcome: z.enum(['satisfied', 'exhausted']).optional(),
  lastScore: z.number().finite().optional(),
  lastGaps: z.array(z.string().min(1).max(4096)).max(1024),
  waitReason: z.string().min(1).max(256).optional(),
});

export type GoalViewSection = Readonly<z.infer<typeof GoalViewSectionSchema>>;

const UsedMaxSchema = z.strictObject({
  used: SafeIntegerSchema,
  max: SafeIntegerSchema,
});

const BoundedLoopLifecycleViewSectionSchema = z.strictObject({
  kind: z.literal('bounded-loop-lifecycle'),
  version: z.literal(1),
  loopPath: z.string().min(1).max(1024),
  bodyKind: z.enum(['review-cycle', 'goal-cycle', 'composite']),
  state: z.enum([
    'running',
    'waiting',
    'strategizing',
    'human-required',
    'terminal',
  ]),
  iteration: SafeIntegerSchema,
  phase: z.string().min(1).max(256),
  limits: z.strictObject({
    iterations: UsedMaxSchema,
    actions: UsedMaxSchema,
    budget: UsedMaxSchema,
  }),
  progressFingerprint: DigestSchema.optional(),
  stallStreak: SafeIntegerSchema,
  blockerFingerprint: DigestSchema.optional(),
  blockedStreak: SafeIntegerSchema,
  strategy: z.strictObject({
    attempts: SafeIntegerSchema,
    maxAttempts: SafeIntegerSchema,
    active: SafeIntegerSchema.optional(),
  }),
  wait: z
    .strictObject({
      waitId: WaitIdSchema,
      kind: z.string().min(1).max(256),
      reasonCode: z.string().min(1).max(256).optional(),
    })
    .optional(),
  outcome: z
    .strictObject({
      kind: z.enum([
        'completed',
        'iteration-limit',
        'action-limit',
        'budget-limit',
        'stalled',
        'blocked',
        'strategy-exhausted',
        'failed',
        'cancelled',
      ]),
      disposition: z.enum(['exit', 'escalate', 'fail', 'cancel']),
      value: z.string().min(1).max(256).optional(),
    })
    .optional(),
});

export type BoundedLoopLifecycleViewSection = Readonly<
  z.infer<typeof BoundedLoopLifecycleViewSectionSchema>
>;

const ConsultationViewSectionSchema = z.strictObject({
  kind: z.literal('consultation'),
  version: z.literal(1),
  entries: z.array(
    z.strictObject({
      consultationId: identity('consultation'),
      ordinal: SafeIntegerSchema.min(1),
      state: z.enum([
        'requested',
        'teacher-active',
        'advice-committed',
        'continuation-granted',
        'continued',
        'unavailable',
        'continuation-outcome-unknown',
        'closed',
      ]),
      source: z.strictObject({
        actionId: ActionIdSchema,
        invocationId: InvocationIdSchema,
        attemptId: AttemptIdSchema,
        occurrence: SafeIntegerSchema,
        stableSessionId: UuidShape,
        model: z.string().min(1).max(256),
        runtime: z.string().min(1).max(128),
        questionDigest: DigestSchema,
        evidenceDigests: z.array(DigestSchema).max(64),
      }),
      teacher: z.strictObject({
        actionId: ActionIdSchema.optional(),
        invocationId: InvocationIdSchema.optional(),
        attemptId: AttemptIdSchema.optional(),
        model: z.string().min(1).max(256).optional(),
        runtime: z.string().min(1).max(128).optional(),
        adviceDecision: z.enum(['plan', 'correction', 'stop']).optional(),
        adviceDigest: DigestSchema.optional(),
        evidenceDigests: z.array(DigestSchema).max(64),
      }),
      counters: z.strictObject({
        consultations: UsedMaxSchema,
        teacherAttempts: UsedMaxSchema,
      }),
      limits: z.strictObject({
        maxQuestionBytes: z.number().int().positive().safe(),
        maxAdviceBytes: z.number().int().positive().safe(),
        maxAttemptedApproaches: z.number().int().positive().safe(),
        maxConstraints: z.number().int().positive().safe(),
        maxEvidencePointers: z.number().int().positive().safe(),
        maxAdviceSteps: z.number().int().positive().safe(),
        maxCautions: z.number().int().positive().safe(),
        maxEvidenceNotes: z.number().int().positive().safe(),
      }),
      continuation: z
        .strictObject({
          requestId: UuidShape,
          inputDigest: DigestSchema,
          state: z.enum(['granted', 'settled', 'ambiguous']),
        })
        .optional(),
      failure: z
        .strictObject({
          code: z.string().min(1).max(256),
          detail: z.string().min(1).max(4096).optional(),
        })
        .optional(),
    })
  ),
});

export type ConsultationViewSection = Readonly<
  z.infer<typeof ConsultationViewSectionSchema>
>;
export type ChangeRunViewSection =
  | RootDagViewSection
  | ReviewCycleViewSection
  | GoalViewSection
  | BoundedLoopLifecycleViewSection
  | ConsultationViewSection
  | Readonly<Record<string, unknown>>;

const DriftStateSchema = z.enum(['unchanged', 'changed', 'unavailable']);
const DriftViewSchema = z.strictObject({
  definition: DriftStateSchema,
  sourceRevision: z.strictObject({
    provenance: DriftStateSchema,
    content: DriftStateSchema,
    semantic: DriftStateSchema,
    current: z
      .strictObject({
        layer: z.enum(['project', 'user', 'package']),
        sourceId: z.string().min(1).max(512),
        authoredContentDigest: DigestSchema,
        semanticDigest: DigestSchema,
      })
      .optional(),
  }),
  capability: DriftStateSchema,
  policy: DriftStateSchema,
  workspace: DriftStateSchema,
  currentCapabilityProfileDigest: DigestSchema.optional(),
  currentPolicyDigest: DigestSchema.optional(),
});

const ChangeRunViewCoreSchema = z.strictObject({
  format: z.literal('change-run-view/1'),
  engine: z.literal('reconciler'),
  runId: RunIdSchema,
  change: z.strictObject({
    planningSpaceId: PlanningSpaceIdSchema,
    projectId: z.string().min(1).max(256),
    changeId: z.string().min(1).max(128),
    instanceId: ChangeInstanceIdSchema,
  }),
  recordVersion: SafeIntegerSchema,
  status: z.enum([
    'running',
    'waiting',
    'completed',
    'escalated',
    'failed',
    'cancelled',
  ]),
  sourceState: z.enum(['active', 'archived', 'missing']),
  workspace: z.strictObject({
    instanceId: WorkspaceInstanceIdSchema,
    scope: z.enum(['current', 'other']),
  }),
  drift: DriftViewSchema,
  sections: z.array(z.unknown()),
});

export interface ChangeRunView
  extends Omit<z.infer<typeof ChangeRunViewCoreSchema>, 'sections'> {
  readonly sections: readonly ChangeRunViewSection[];
}

const ChangeRunReceiptCoreSchema = z.strictObject({
  format: z.literal('change-run-receipt/1'),
  disposition: z.enum([
    'created',
    'reused',
    'advanced',
    'idempotent',
    'waiting',
    'terminal',
  ]),
  view: z.unknown(),
  actions: z.array(RunActionSchema),
  continuationGrants: z.array(z.unknown()).optional(),
});

export interface ChangeRunReceipt
  extends Omit<
    z.infer<typeof ChangeRunReceiptCoreSchema>,
    'view' | 'actions' | 'continuationGrants'
  > {
  readonly view: ChangeRunView;
  readonly actions: readonly RunAction[];
  readonly continuationGrants?: readonly AgentContinuationGrant[];
}

/**
 * Canonical authority required to decode continuation grants carried by a
 * receipt. Receipt views and grants share one caller-controlled wire envelope,
 * so neither may supply the frozen limits used to decode the other.
 */
export interface ChangeRunReceiptContinuationAuthority {
  readonly source: 'canonical-record';
  resolveContinuationLimits(query: Readonly<{
    runId: RunId;
    recordVersion: RecordVersion;
    workspaceInstanceId: WorkspaceInstanceId;
    consultationId: string;
    sourceActionId: ActionId;
  }>): ConsultationContentLimits | undefined;
}

export interface ReceiptDispositionFacts {
  readonly created: boolean;
  readonly reused: boolean;
  readonly idempotent: boolean;
  readonly becameTerminal: boolean;
  readonly grantedActionCount: number;
  readonly waitCount: number;
}

export type ChangeRunReceiptDisposition = ChangeRunReceipt['disposition'];

export function deriveReceiptDisposition(
  facts: ReceiptDispositionFacts
): ChangeRunReceiptDisposition {
  if (
    !Number.isSafeInteger(facts.grantedActionCount) ||
    facts.grantedActionCount < 0 ||
    !Number.isSafeInteger(facts.waitCount) ||
    facts.waitCount < 0
  ) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      'Receipt disposition counts must be non-negative safe integers.'
    );
  }
  if (facts.created) return 'created';
  if (facts.reused) return 'reused';
  if (facts.idempotent) return 'idempotent';
  if (facts.becameTerminal) return 'terminal';
  if (facts.grantedActionCount === 0 && facts.waitCount > 0) return 'waiting';
  return 'advanced';
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function contractError(error: z.ZodError): ChangeRunContractError {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `/${issue.path.join('/')}` : '/';
    return `${path}: ${issue.message}`;
  });
  return new ChangeRunContractError(
    'invalid_run_contract',
    issues.join('; '),
    issues
  );
}

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw contractError(result.error);
  return deepFreeze(result.data);
}

function assertMajor(value: unknown, expected: string, errorCode: ChangeRunContractErrorCode): void {
  if (
    value !== null &&
    typeof value === 'object' &&
    'format' in value &&
    (value as { format?: unknown }).format !== expected
  ) {
    throw new ChangeRunContractError(
      errorCode,
      `Unsupported contract format ${JSON.stringify(
        (value as { format?: unknown }).format
      )}; expected ${expected}.`
    );
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertSortedUnique(
  values: readonly string[],
  label: string
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        `${label} must be strictly stable-sorted and unique.`
      );
    }
  }
}

function assertRootDagInvariants(
  section: RootDagViewSection,
  status: ChangeRunView['status'],
  scope: ChangeRunView['workspace']['scope']
): void {
  assertSortedUnique(section.frontier, 'frontier');
  assertSortedUnique(
    section.activeInvocations.map((item) => item.invocationId),
    'activeInvocations'
  );
  assertSortedUnique(
    section.actions.map((item) => item.actionId),
    'actions'
  );
  assertSortedUnique(
    section.waits.map((item) => item.waitId),
    'waits'
  );
  assertSortedUnique(
    section.effectDiagnostics.map((item) => item.effectId),
    'effectDiagnostics'
  );
  assertSortedUnique(
    section.allowedControls.map(canonical),
    'allowedControls'
  );

  const actionIds = new Set(section.actions.map((item) => item.actionId));
  const effectIds = new Set(
    section.effectDiagnostics.map((item) => item.effectId)
  );
  for (const invocation of section.activeInvocations) {
    assertSortedUnique(invocation.actionIds, 'activeInvocation.actionIds');
    assertSortedUnique(
      invocation.effects.map((effect) => effect.slot),
      'activeInvocation.effects'
    );
    for (const actionId of invocation.actionIds) {
      if (!actionIds.has(actionId)) {
        throw new ChangeRunContractError(
          'invalid_run_invariant',
          'Active invocation references an absent ActionView.'
        );
      }
    }
    for (const effect of invocation.effects) {
      if (!effectIds.has(effect.effectId)) {
        throw new ChangeRunContractError(
          'invalid_run_invariant',
          'Active invocation references an absent effect diagnostic.'
        );
      }
    }
  }
  for (const actionView of section.actions) {
    assertSortedUnique(
      actionView.effects.map((effect) => effect.slot),
      'action.effects'
    );
  }

  const isTerminal = [
    'completed',
    'escalated',
    'failed',
    'cancelled',
  ].includes(status);
  if (
    isTerminal !== (section.terminal !== undefined) ||
    (isTerminal &&
      (section.actions.length > 0 ||
        section.waits.length > 0 ||
        section.allowedControls.length > 0))
  ) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      'Terminal status and root section members are mutually exclusive.'
    );
  }
  if (!isTerminal) {
    const expectedStatus =
      section.actions.some((item) => item.deliveryState !== 'closed') ||
      section.frontier.length > 0
        ? 'running'
        : section.waits.length > 0
          ? 'waiting'
          : null;
    if (expectedStatus !== null && status !== expectedStatus) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        `Run status ${status} does not match root frontier priority ${expectedStatus}.`
      );
    }
  }
  if (
    scope === 'other' &&
    (section.allowedControls.length > 0 ||
      section.actions.some((item) => item.deliveryState === 'granted'))
  ) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      'Other-worktree views cannot expose controls or granted Actions.'
    );
  }
}

export function decodeWorkspaceRevision(value: unknown): WorkspaceRevision {
  assertMajor(value, 'workspace-revision/1', 'unsupported_contract_version');
  return decode(WorkspaceRevisionSchema, value);
}

export function decodeEvidenceRef(value: unknown): EvidenceRef {
  const format =
    value !== null && typeof value === 'object'
      ? (value as { format?: unknown }).format
      : undefined;
  if (
    format !== 'change-run-evidence-ref/1' &&
    format !== 'change-run-evidence-ref/2'
  ) {
    throw new ChangeRunContractError(
      'unsupported_contract_version',
      `Unsupported contract format ${JSON.stringify(format)}; expected change-run-evidence-ref/1 or change-run-evidence-ref/2.`
    );
  }
  return decode(EvidenceRefSchema, value);
}

export function decodeAttestationAuthority(
  value: unknown
): AttestationAuthority {
  return decode(AttestationAuthoritySchema, value);
}

export function decodeActorRef(value: unknown): ActorRef {
  assertMajor(value, 'change-run-actor/1', 'unsupported_contract_version');
  return decode(ActorRefSchema, value);
}

export function decodeRunAction(value: unknown): RunAction {
  assertMajor(value, 'change-run-action/1', 'unsupported_contract_version');
  const action = decode(RunActionSchema, value);
  assertSortedUnique(
    action.effects.map((effect) => effect.slot),
    'RunAction.effects'
  );
  assertSortedUnique(action.workspace.resources, 'RunAction.workspace.resources');
  return action;
}

export function decodeCompletion(value: unknown): CompleteRunAction {
  assertMajor(
    value,
    'change-run-completion/1',
    'unsupported_contract_version'
  );
  return decode(CompleteRunActionSchema, value);
}

export function decodeControl(value: unknown): ChangeRunControlRequest {
  assertMajor(value, 'change-run-control/1', 'unsupported_contract_version');
  return decode(ChangeRunControlRequestSchema, value);
}

export function decodeChangeRunView(value: unknown): ChangeRunView {
  assertMajor(value, 'change-run-view/1', 'unsupported_view_version');
  const core = decode(ChangeRunViewCoreSchema, value);
  const sections = core.sections.map((section) => {
    if (
      section !== null &&
      typeof section === 'object' &&
      'kind' in section &&
      (section as { kind?: unknown }).kind === 'root-dag'
    ) {
      return decode(RootDagViewSectionSchema, section);
    }
    if (
      section !== null &&
      typeof section === 'object' &&
      'kind' in section &&
      (section as { kind?: unknown }).kind === 'review-cycle'
    ) {
      return decode(ReviewCycleViewSectionSchema, section);
    }
    if (
      section !== null &&
      typeof section === 'object' &&
      'kind' in section &&
      (section as { kind?: unknown }).kind === 'goal' &&
      'version' in section &&
      (section as { version?: unknown }).version === 1
    ) {
      return decode(GoalViewSectionSchema, section);
    }
    if (
      section !== null &&
      typeof section === 'object' &&
      'kind' in section &&
      (section as { kind?: unknown }).kind === 'bounded-loop-lifecycle' &&
      'version' in section &&
      (section as { version?: unknown }).version === 1
    ) {
      return decode(BoundedLoopLifecycleViewSectionSchema, section);
    }
    if (
      section !== null &&
      typeof section === 'object' &&
      'kind' in section &&
      (section as { kind?: unknown }).kind === 'consultation' &&
      'version' in section &&
      (section as { version?: unknown }).version === 1
    ) {
      return decode(ConsultationViewSectionSchema, section);
    }
    const additive = z
      .object({
        kind: z.string().min(1),
        version: SafeIntegerSchema,
      })
      .passthrough()
      .safeParse(section);
    if (!additive.success) throw contractError(additive.error);
    return deepFreeze(additive.data);
  });
  const roots = sections.filter(
    (section): section is RootDagViewSection =>
      section.kind === 'root-dag' && section.version === 1
  );
  if (roots.length !== 1) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      'change-run-view/1 must contain exactly one root-dag/1 section.'
    );
  }
  assertRootDagInvariants(roots[0], core.status, core.workspace.scope);
  return deepFreeze({ ...core, sections });
}

function sameConsultationLimits(
  left: ConsultationContentLimits,
  right: ConsultationContentLimits
): boolean {
  return (
    left.maxQuestionBytes === right.maxQuestionBytes &&
    left.maxAdviceBytes === right.maxAdviceBytes &&
    left.maxAttemptedApproaches === right.maxAttemptedApproaches &&
    left.maxConstraints === right.maxConstraints &&
    left.maxEvidencePointers === right.maxEvidencePointers &&
    left.maxAdviceSteps === right.maxAdviceSteps &&
    left.maxCautions === right.maxCautions &&
    left.maxEvidenceNotes === right.maxEvidenceNotes
  );
}

export function decodeChangeRunReceipt(
  value: unknown,
  continuationAuthority: ChangeRunReceiptContinuationAuthority
): ChangeRunReceipt {
  assertMajor(
    value,
    'change-run-receipt/1',
    'unsupported_contract_version'
  );
  const core = decode(ChangeRunReceiptCoreSchema, value);
  const view = decodeChangeRunView(core.view);
  const actions = core.actions.map((action) => decodeRunAction(action));
  if (
    (core.disposition === 'waiting' && view.status !== 'waiting') ||
    (core.disposition === 'terminal' &&
      !['completed', 'escalated', 'failed', 'cancelled'].includes(view.status))
  ) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      `Receipt disposition ${core.disposition} does not match view status ${view.status}.`
    );
  }
  if (
    ['reused', 'idempotent', 'waiting', 'terminal'].includes(
      core.disposition
    ) &&
    actions.length > 0
  ) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      `${core.disposition} receipts cannot carry execution grants.`
    );
  }
  if (view.workspace.scope === 'other' && actions.length > 0) {
    throw new ChangeRunContractError(
      'invalid_run_invariant',
      'Other-worktree receipts cannot carry execution grants.'
    );
  }
  const root = view.sections.find(
    (section): section is RootDagViewSection => section.kind === 'root-dag'
  )!;
  const granted = new Set(
    root.actions
      .filter((item) => item.deliveryState === 'granted')
      .map((item) => item.actionId)
  );
  for (const action of actions) {
    if (action.runId !== view.runId || !granted.has(action.actionId)) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        'Every executable receipt Action must match a granted ActionView in the same Run.'
      );
    }
  }
  const { continuationGrants: rawContinuationGrants, ...receiptCore } = core;
  const consultationSection = view.sections.find(
    (section): section is ConsultationViewSection =>
      section.kind === 'consultation' && section.version === 1
  );
  const continuationGrants = rawContinuationGrants?.map((item) => {
    const grantShape = decode(AgentContinuationGrantZodSchema, item);
    const entry = consultationSection?.entries.find(
      (candidate) => candidate.consultationId === grantShape.consultationId
    );
    if (entry === undefined) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        'Continuation receipt grant has no matching canonical consultation view.'
      );
    }
    const limits = continuationAuthority.resolveContinuationLimits({
      runId: view.runId as RunId,
      recordVersion: view.recordVersion as RecordVersion,
      workspaceInstanceId: view.workspace.instanceId as WorkspaceInstanceId,
      consultationId: grantShape.consultationId,
      sourceActionId: grantShape.sourceActionId as ActionId,
    });
    if (limits === undefined) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        'Continuation receipt grant has no independently verified canonical frozen-limit authority.'
      );
    }
    if (!sameConsultationLimits(entry.limits, limits)) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        'Continuation receipt view limits do not match canonical frozen-limit authority.'
      );
    }
    return decodeAgentContinuationGrant(item, limits);
  });
  for (const grant of continuationGrants ?? []) {
    const entry = consultationSection?.entries.find(
      (candidate) => candidate.consultationId === grant.consultationId
    );
    if (
      grant.runId !== view.runId ||
      grant.workspaceInstanceId !== view.workspace.instanceId ||
      grant.expectedRecordVersion !== view.recordVersion ||
      entry === undefined ||
      entry.state !== 'continuation-granted' ||
      entry.source.actionId !== grant.sourceActionId ||
      entry.source.invocationId !== grant.sourceInvocationId ||
      entry.source.attemptId !== grant.sourceAttemptId ||
      entry.source.stableSessionId !== grant.stableSessionId ||
      entry.continuation?.requestId !== grant.requestId ||
      entry.continuation.inputDigest !== grant.inputDigest
    ) {
      throw new ChangeRunContractError(
        'invalid_run_invariant',
        'Continuation receipt grant does not match its canonical consultation view.'
      );
    }
  }
  return deepFreeze({
    ...receiptCore,
    view,
    actions,
    ...(continuationGrants === undefined
      ? {}
      : {
          continuationGrants,
        }),
  });
}
