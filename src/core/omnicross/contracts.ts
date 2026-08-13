import { z } from 'zod';

const IdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'identifier contains control characters');

export const OmniCrossProviderUpstreamSchema = z
  .object({
    kind: z.literal('provider'),
    providerId: IdentifierSchema,
    keyId: IdentifierSchema.optional(),
  })
  .strict();

export const OmniCrossAccountUpstreamSchema = z
  .object({
    kind: z.literal('account'),
    providerId: IdentifierSchema,
    accountId: IdentifierSchema,
  })
  .strict();

export const OmniCrossAccountGroupUpstreamSchema = z
  .object({
    kind: z.literal('account-group'),
    providerId: IdentifierSchema,
    group: IdentifierSchema,
  })
  .strict();

export const OmniCrossAccountPoolUpstreamSchema = z
  .object({
    kind: z.literal('account-pool'),
    providerId: IdentifierSchema,
  })
  .strict();

export const OmniCrossUpstreamSchema = z.discriminatedUnion('kind', [
  OmniCrossProviderUpstreamSchema,
  OmniCrossAccountUpstreamSchema,
  OmniCrossAccountGroupUpstreamSchema,
  OmniCrossAccountPoolUpstreamSchema,
]);
export type OmniCrossUpstream = Readonly<z.infer<typeof OmniCrossUpstreamSchema>>;

export const StageInferenceSchema = z
  .object({
    broker: z.literal('omnicross'),
    upstream: OmniCrossUpstreamSchema,
  })
  .strict();
export type StageInference = Readonly<z.infer<typeof StageInferenceSchema>>;

export const OmniCrossConnectionIdentitySchema = z
  .object({
    endpoint: z.string().min(1).max(2048),
    controlTokenEnv: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    requestTimeoutMs: z.number().int().min(100).max(60_000),
    leaseTtlSeconds: z.number().int().min(30).max(3_600),
    configRevision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();
export type OmniCrossConnectionIdentity = Readonly<
  z.infer<typeof OmniCrossConnectionIdentitySchema>
>;

export const FrozenInferenceRouteSchema = z
  .object({
    broker: z.literal('omnicross'),
    runtime: z.enum(['claude', 'codex']),
    upstream: OmniCrossUpstreamSchema,
    model: z.string().min(1).max(256),
    connection: OmniCrossConnectionIdentitySchema,
  })
  .strict();
export type FrozenInferenceRoute = Readonly<z.infer<typeof FrozenInferenceRouteSchema>>;

export const RouteAttemptIdentitySchema = z
  .object({
    runId: z.string().min(1).max(512),
    stageId: z.string().min(1).max(256),
    attempt: z.number().int().positive().max(1_000_000),
    sessionId: z.string().min(1).max(512).optional(),
  })
  .strict();
export type RouteAttemptIdentity = Readonly<z.infer<typeof RouteAttemptIdentitySchema>>;

export const RouteLeaseExecutionSchema = z
  .object({
    runId: z.string().min(1).max(512),
    stageId: z.string().min(1).max(256),
    attempt: z.number().int().positive().max(1_000_000),
    sessionId: z.string().min(1).max(512).optional(),
  })
  .strict();

export const CreateRouteLeaseRequestSchema = z
  .object({
    schemaVersion: z.literal('omnicross.route-lease.request/1'),
    consumer: z.literal('rasen'),
    runtime: z.enum(['claude', 'codex']),
    upstream: OmniCrossUpstreamSchema,
    model: z.string().min(1).max(256),
    execution: RouteLeaseExecutionSchema,
    idempotencyKey: z.string().min(1).max(128),
    ttlSeconds: z.number().int().min(30).max(3_600).optional(),
  })
  .strict();
export type CreateRouteLeaseRequest = Readonly<
  z.infer<typeof CreateRouteLeaseRequestSchema>
>;

const LaunchDescriptorSchema = z
  .object({
    env: z
      .record(z.string().max(128), z.string().max(64 * 1024))
      .refine((value) => Object.keys(value).length <= 16, 'launch env has too many entries'),
    extraArgs: z.array(z.string().max(16 * 1024)).max(32),
  })
  .strict();

export const CreateRouteLeaseResponseSchema = z
  .object({
    schemaVersion: z.literal('omnicross.route-lease/1'),
    leaseId: IdentifierSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    runtime: z.enum(['claude', 'codex']),
    upstream: OmniCrossUpstreamSchema,
    model: z.string().min(1).max(256),
    launch: LaunchDescriptorSchema,
  })
  .strict();
export type CreateRouteLeaseResponse = Readonly<
  z.infer<typeof CreateRouteLeaseResponseSchema>
>;

export const RenewRouteLeaseRequestSchema = z
  .object({
    schemaVersion: z.literal('omnicross.route-lease.renew.request/1'),
    consumer: z.literal('rasen'),
    idempotencyKey: z.string().min(1).max(128),
    ttlSeconds: z.number().int().min(30).max(3_600).optional(),
  })
  .strict();
export type RenewRouteLeaseRequest = Readonly<
  z.infer<typeof RenewRouteLeaseRequestSchema>
>;

export const RenewRouteLeaseResponseSchema = z
  .object({
    schemaVersion: z.literal('omnicross.route-lease.metadata/1'),
    leaseId: IdentifierSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    runtime: z.enum(['claude', 'codex']),
    upstream: OmniCrossUpstreamSchema,
    model: z.string().min(1).max(256),
    status: z.enum(['active', 'released', 'expired']),
  })
  .strict();
export type RenewRouteLeaseResponse = Readonly<
  z.infer<typeof RenewRouteLeaseResponseSchema>
>;

export const ReleaseRouteLeaseRequestSchema = z
  .object({
    schemaVersion: z.literal('omnicross.route-lease.release.request/1'),
    consumer: z.literal('rasen'),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();
export type ReleaseRouteLeaseRequest = Readonly<
  z.infer<typeof ReleaseRouteLeaseRequestSchema>
>;

export const ReleaseRouteLeaseResponseSchema = z
  .object({
    schemaVersion: z.literal('omnicross.route-lease.release/1'),
    leaseId: IdentifierSchema,
    released: z.boolean(),
  })
  .strict();
export type ReleaseRouteLeaseResponse = Readonly<
  z.infer<typeof ReleaseRouteLeaseResponseSchema>
>;

export const OmniCrossDaemonErrorSchema = z
  .object({
    schemaVersion: z.literal('omnicross.error/1'),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2048),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type OmniCrossDaemonError = Readonly<
  z.infer<typeof OmniCrossDaemonErrorSchema>
>;

export const OMNICROSS_FAILURE_KINDS = [
  'invalid-config',
  'invalid-input',
  'daemon-unavailable',
  'daemon-timeout',
  'daemon-not-ready',
  'control-unauthorized',
  'unsupported-schema',
  'invalid-descriptor',
  'upstream-invalid',
  'model-invalid',
  'format-unsupported',
  'idempotency-conflict',
  'capacity-exhausted',
  'route-expired',
  'route-lost',
  'cancelled',
  'cleanup-failed',
] as const;

export const OmniCrossFailureSchema = z
  .object({
    kind: z.enum(OMNICROSS_FAILURE_KINDS),
    message: z.string().min(1).max(4096),
    retryable: z.boolean(),
    daemonCode: z.string().min(1).max(128).optional(),
  })
  .strict();
export type OmniCrossFailure = Readonly<z.infer<typeof OmniCrossFailureSchema>>;

export class OmniCrossRouteError extends Error {
  constructor(readonly failure: OmniCrossFailure) {
    super(failure.message);
    this.name = 'OmniCrossRouteError';
  }
}

export const OMNICROSS_ROUTE_LOST_ABORT = Object.freeze({
  kind: 'omnicross-route-lost' as const,
});

export function isOmniCrossRouteLostAbort(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === OMNICROSS_ROUTE_LOST_ABORT.kind
  );
}
