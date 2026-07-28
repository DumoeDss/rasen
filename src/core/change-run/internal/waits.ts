import { z } from 'zod';

import {
  ChangeRunContractError,
  decodeEvidenceRef,
  decodeWorkspaceRevision,
  type ActionId,
  type AttemptId,
  type EffectId,
  type EvidenceRef,
  type InvocationId,
  type NodeId,
  type RootDagViewSection,
  type RunId,
  type WaitId,
  type WorkspaceInstanceId,
  type WorkspaceRevision,
} from '../contracts.js';
import {
  canonicalJson,
  deriveWaitId,
  domainDigest,
  type WaitIdentityContext,
} from './identity.js';

export type CanonicalWait = RootDagViewSection['waits'][number];

type WaitOf<Kind extends CanonicalWait['kind']> = Extract<
  CanonicalWait,
  { readonly kind: Kind }
>;

export type CanonicalWaitInput =
  | Omit<WaitOf<'gate'>, 'waitId'>
  | Omit<WaitOf<'domain-blocked'>, 'waitId'>
  | Omit<WaitOf<'infrastructure'>, 'waitId'>
  | Omit<WaitOf<'uncertain-effect'>, 'waitId'>
  | Omit<WaitOf<'capability-unavailable'>, 'waitId'>
  | Omit<WaitOf<'workspace-drift'>, 'waitId'>
  | Omit<WaitOf<'workspace-reservation'>, 'waitId'>;

export type CanonicalWaitErrorCode =
  | 'invalid_wait_contract'
  | 'unsupported_wait_version'
  | 'wait_identity_mismatch';

export class CanonicalWaitError extends Error {
  constructor(
    readonly code: CanonicalWaitErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'CanonicalWaitError';
  }
}

const HEX = '[0-9a-f]{64}';
const identity = <Prefix extends string>(prefix: Prefix) =>
  z.string().regex(new RegExp(`^${prefix}:${HEX}$`));
const DigestSchema = z.string().regex(new RegExp(`^sha256:${HEX}$`));
const WaitIdSchema = identity('wait');
const NodeIdSchema = identity('node');
const InvocationIdSchema = identity('invocation');
const AttemptIdSchema = identity('attempt');
const ActionIdSchema = identity('action');
const EffectIdSchema = identity('effect');
const WorkspaceInstanceIdSchema = identity('workspace-instance');
const SafeIntegerSchema = z.number().int().nonnegative().safe();

const WaitSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('gate'),
    waitId: WaitIdSchema,
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    gateId: z.string().min(1).max(256),
    decisionIds: z.array(z.string().min(1).max(256)).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal('domain-blocked'),
    waitId: WaitIdSchema,
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).max(64),
    reasonCode: z.string().min(1).max(256),
    evidence: z.array(z.unknown()).max(64),
  }),
  z.strictObject({
    kind: z.literal('infrastructure'),
    waitId: WaitIdSchema,
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
    kind: z.literal('uncertain-effect'),
    waitId: WaitIdSchema,
    nodeId: NodeIdSchema,
    invocationId: InvocationIdSchema,
    occurrence: SafeIntegerSchema,
    attemptId: AttemptIdSchema,
    actionId: ActionIdSchema,
    effectIds: z.array(EffectIdSchema).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal('capability-unavailable'),
    waitId: WaitIdSchema,
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
    kind: z.literal('workspace-drift'),
    waitId: WaitIdSchema,
    workspaceInstanceId: WorkspaceInstanceIdSchema,
    expected: z.unknown(),
    observed: z.unknown(),
  }),
  z.strictObject({
    kind: z.literal('workspace-reservation'),
    waitId: WaitIdSchema,
    workspaceInstanceId: WorkspaceInstanceIdSchema,
    // Intent carries only the stable local candidate identity (NodeId +
    // InvocationId + occurrence + access). The conflicting Run's identity
    // and any not-yet-admitted ActionId/AttemptId are deliberately absent:
    // a workspace-reservation wait records candidates the reconciler has
    // NOT admitted, so those identities do not exist yet, and the spec
    // forbids leaking the other Run's identity across the workspace lease.
    intents: z
      .array(
        z.strictObject({
          nodeId: NodeIdSchema,
          invocationId: InvocationIdSchema,
          occurrence: SafeIntegerSchema,
          access: z.enum(['read', 'write']),
        })
      )
      .min(1)
      .max(10_000),
  }),
]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new CanonicalWaitError(
        'invalid_wait_contract',
        `${label} must be strictly stable-sorted and unique.`
      );
    }
  }
}

function parseWait(value: unknown): CanonicalWait {
  const parsed = WaitSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `/${issue.path.join('/')}` : '/';
      return `${path}: ${issue.message}`;
    });
    throw new CanonicalWaitError(
      'invalid_wait_contract',
      issues.join('; '),
      issues
    );
  }

  const wait = parsed.data;
  if (wait.kind === 'domain-blocked') {
    return {
      ...wait,
      evidence: wait.evidence.map((item) => decodeEvidenceRef(item)),
    } as CanonicalWait;
  }
  if (wait.kind === 'workspace-drift') {
    return {
      ...wait,
      expected: decodeWorkspaceRevision(wait.expected),
      observed: decodeWorkspaceRevision(wait.observed),
    } as CanonicalWait;
  }
  return wait as CanonicalWait;
}

function waitContext(runId: RunId, wait: CanonicalWait): WaitIdentityContext {
  switch (wait.kind) {
    case 'gate':
      return {
        runId,
        kind: wait.kind,
        nodeId: wait.nodeId as NodeId,
        invocationId: wait.invocationId as InvocationId,
        occurrence: wait.occurrence,
        decisionOccurrence: wait.occurrence,
      };
    case 'domain-blocked':
    case 'infrastructure':
    case 'uncertain-effect':
    case 'capability-unavailable':
      return {
        runId,
        kind: wait.kind,
        nodeId: wait.nodeId as NodeId,
        invocationId: wait.invocationId as InvocationId,
        occurrence: wait.occurrence,
        attemptId: wait.attemptId as AttemptId,
        actionId: wait.actionId as ActionId,
        effectIds: wait.effectIds as unknown as readonly EffectId[],
      };
    case 'workspace-drift':
      return {
        runId,
        kind: wait.kind,
        workspaceInstanceId:
          wait.workspaceInstanceId as WorkspaceInstanceId,
        reservationIntentsDigest: domainDigest(
          'workspace-drift-context',
          wait.expected,
          wait.observed
        ),
      };
    case 'workspace-reservation':
      return {
        runId,
        kind: wait.kind,
        workspaceInstanceId:
          wait.workspaceInstanceId as WorkspaceInstanceId,
        reservationIntentsDigest: domainDigest(
          'workspace-reservation-intents',
          wait.intents
        ),
      };
  }
}

function validateWaitShape(wait: CanonicalWait): void {
  if (wait.kind === 'gate') {
    if (new Set(wait.decisionIds).size !== wait.decisionIds.length) {
      throw new CanonicalWaitError(
        'invalid_wait_contract',
        'Gate decision IDs must be unique in declared order.'
      );
    }
    return;
  }
  if (
    wait.kind === 'domain-blocked' ||
    wait.kind === 'infrastructure' ||
    wait.kind === 'uncertain-effect' ||
    wait.kind === 'capability-unavailable'
  ) {
    assertSortedUnique(wait.effectIds, `${wait.kind}.effectIds`);
    return;
  }
  if (wait.kind === 'workspace-reservation') {
    assertSortedUnique(
      wait.intents.map((intent) => canonicalJson(intent)),
      'workspace-reservation.intents'
    );
  }
}

export function decodeCanonicalWait(
  value: unknown,
  runId: RunId
): CanonicalWait {
  if (
    value !== null &&
    typeof value === 'object' &&
    'format' in value
  ) {
    throw new CanonicalWaitError(
      'unsupported_wait_version',
      'Canonical waits are embedded closed Record values and carry no independent format.'
    );
  }
  let wait: CanonicalWait;
  try {
    wait = parseWait(value);
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      throw new CanonicalWaitError(
        'invalid_wait_contract',
        error.message,
        error.issues
      );
    }
    throw error;
  }
  validateWaitShape(wait);
  const expected = deriveWaitId(waitContext(runId, wait));
  if (wait.waitId !== expected) {
    throw new CanonicalWaitError(
      'wait_identity_mismatch',
      `WaitId ${wait.waitId} does not match its exact ${wait.kind} context.`
    );
  }
  return deepFreeze(wait);
}

export function createCanonicalWait(
  runId: RunId,
  input: CanonicalWaitInput
): CanonicalWait {
  const normalized =
    input.kind === 'workspace-reservation'
      ? {
          ...input,
          intents: [...input.intents].sort((left, right) =>
            compareStrings(canonicalJson(left), canonicalJson(right))
          ),
        }
      : 'effectIds' in input
        ? {
            ...input,
            effectIds: [...input.effectIds].sort(compareStrings),
          }
        : input;
  const provisional = {
    ...normalized,
    waitId: `wait:${'0'.repeat(64)}` as WaitId,
  } as CanonicalWait;
  const wait = {
    ...normalized,
    waitId: deriveWaitId(waitContext(runId, provisional)),
  };
  return decodeCanonicalWait(wait, runId);
}

export type {
  EvidenceRef,
  WorkspaceRevision,
};
