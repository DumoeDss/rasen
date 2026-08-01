import { z } from 'zod';

import {
  ChangeRunContractError,
  decodeActorRef,
  decodeEvidenceRef,
  decodeRunAction,
  decodeWorkspaceRevision,
  type ActorRef,
  type ChangeInstanceId,
  type Digest,
  type EvidenceRef,
  type JsonValue,
  type PlanningSpaceId,
  type RecordVersion,
  type RunAction,
  type RunId,
  type WaitId,
  type WorkspaceInstanceId,
  type WorkspaceRevision,
} from '../contracts.js';
import { domainDigest } from './identity.js';
import {
  CanonicalWaitError,
  decodeCanonicalWait,
  type CanonicalWait,
} from './waits.js';

export type CanonicalRecordErrorCode =
  | 'invalid_record_contract'
  | 'unsupported_record_version'
  | 'invalid_record_invariant';

export class CanonicalRecordError extends Error {
  constructor(
    readonly code: CanonicalRecordErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'CanonicalRecordError';
  }
}

export type RunTerminalOutcome =
  | Readonly<{ kind: 'completed'; outcome: string }>
  | Readonly<{ kind: 'escalated'; code: string; reason?: string }>
  | Readonly<{ kind: 'failed'; code: string; reason?: string }>
  | Readonly<{ kind: 'cancelled'; reason?: string }>;

export type CommittedEffectState =
  | 'admitted'
  | 'succeeded'
  | 'failed'
  | 'not_executed'
  | 'uncertain'
  | 'infrastructure_failed';

export interface CommittedEffect {
  readonly slot: string;
  readonly effectId: string;
  readonly state: CommittedEffectState;
  readonly receiptDigest?: Digest;
  readonly observation?: JsonValue;
  readonly evidence?: readonly EvidenceRef[];
}

export interface CommittedDomainResult {
  readonly status: 'succeeded' | 'failed' | 'blocked';
  readonly receiptDigest: Digest;
  readonly result: JsonValue;
  readonly evidence: readonly EvidenceRef[];
  readonly actor?: ActorRef;
  readonly actorAttestation?: EvidenceRef;
}

export interface CommittedInfrastructureObservation {
  readonly receiptDigest: Digest;
  readonly code: string;
  readonly retryable: boolean;
  readonly artifactDigest: Digest;
  readonly evidence: readonly EvidenceRef[];
}

export interface CommittedAction {
  readonly action: RunAction;
  readonly attemptOrdinal: number;
  readonly deliveryState: 'admitted_undelivered' | 'granted' | 'closed';
  readonly state: 'active' | 'blocked' | 'closed';
  readonly effects: readonly CommittedEffect[];
  readonly result?: CommittedDomainResult;
  readonly infrastructure?: CommittedInfrastructureObservation;
}

interface TransitionBase {
  readonly transitionOrdinal: number;
}

export type CommittedTransition =
  | (TransitionBase & Readonly<{ kind: 'RunStarted' }>)
  | (TransitionBase &
      Readonly<{
        kind: 'ActionAdmitted';
        actionId: string;
        attemptId: string;
      }>)
  | (TransitionBase &
      Readonly<{ kind: 'ActionGranted'; actionId: string }>)
  | (TransitionBase &
      Readonly<{
        kind: 'ActionResultCommitted';
        actionId: string;
        status: 'succeeded' | 'failed' | 'blocked';
      }>)
  | (TransitionBase &
      Readonly<{
        kind: 'ActionEffectObserved';
        actionId: string;
        effectId: string;
        status: 'succeeded' | 'failed' | 'not_executed';
      }>)
  | (TransitionBase &
      Readonly<{
        kind: 'ActionInfrastructureObserved';
        actionId: string;
        code: string;
      }>)
  | (TransitionBase &
      Readonly<{ kind: 'GateAwaiting'; waitId: string }>)
  | (TransitionBase &
      Readonly<{
        kind: 'GateDecided';
        waitId: string;
        decisionId: string;
        outcome: string;
      }>)
  | (TransitionBase &
      Readonly<{
        kind: 'HumanDecisionCommitted';
        waitId: string;
        actionId: string;
        decisionId: 'retry' | 'escalate';
        outcome: string;
        evidence: readonly Digest[];
      }>)
  | (TransitionBase &
      Readonly<{
        kind: 'DomainBlockedWaitConsumedByStrategy';
        waitId: string;
        actionId: string;
        strategyNodeId: string;
        trigger: string;
      }>)
  | (TransitionBase &
      Readonly<{ kind: 'WorkspaceRevisionAccepted'; waitId: string }>)
  | (TransitionBase &
      Readonly<{ kind: 'RunSuspended'; waitId: string }>)
  | (TransitionBase &
      Readonly<{ kind: 'RunResumed'; waitId: string }>)
  | (TransitionBase &
      Readonly<{ kind: 'RunEscalated'; code: string; reason?: string }>)
  | (TransitionBase &
      Readonly<{ kind: 'RunFailed'; code: string; reason?: string }>)
  | (TransitionBase &
      Readonly<{ kind: 'RunCancelled'; reason?: string }>)
  | (TransitionBase &
      Readonly<{ kind: 'RunFinished'; outcome: string }>);

export interface CanonicalRecordLimits {
  readonly maxAttempts: number;
  readonly maxActions: number;
  readonly maxRecordRevisions: number;
  readonly maxTransitions: number;
  readonly maxEvidenceRefsPerAction: number;
  readonly limitOutcome: 'failed' | 'escalated';
}

export interface CanonicalRecordCounters {
  readonly attempts: number;
  readonly actions: number;
  readonly transitions: number;
}

export interface CanonicalRunRecord {
  readonly format: 'change-run-record/1';
  readonly runId: RunId;
  readonly runOrdinal: number;
  readonly change: Readonly<{
    planningSpaceId: PlanningSpaceId;
    projectId: string;
    changeId: string;
    instanceId: ChangeInstanceId;
  }>;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly pipeline: string;
  readonly engine: 'reconciler';
  readonly launchRequestDigest: Digest;
  readonly planDigest: Digest;
  readonly sourceRevisionDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly policyDigest: Digest;
  readonly executionProfileDigest: Digest;
  readonly initialWorkspaceRevision: WorkspaceRevision;
  readonly currentWorkspaceRevision: WorkspaceRevision;
  readonly recordVersion: RecordVersion;
  readonly previousRecordDigest: Digest | null;
  readonly status:
    | 'running'
    | 'waiting'
    | 'completed'
    | 'escalated'
    | 'failed'
    | 'cancelled';
  readonly limits: CanonicalRecordLimits;
  readonly counters: CanonicalRecordCounters;
  readonly transitions: readonly CommittedTransition[];
  readonly actions: Readonly<Record<string, CommittedAction>>;
  readonly waits: readonly CanonicalWait[];
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly terminal?: RunTerminalOutcome;
}

export interface CreateCanonicalRunRecord {
  readonly runId: RunId;
  readonly runOrdinal: number;
  readonly change: CanonicalRunRecord['change'];
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly pipeline: string;
  readonly launchRequestDigest: Digest;
  readonly planDigest: Digest;
  readonly sourceRevisionDigest: Digest;
  readonly capabilityDigest: Digest;
  readonly policyDigest: Digest;
  readonly executionProfileDigest: Digest;
  readonly initialWorkspaceRevision: WorkspaceRevision;
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly limits: CanonicalRecordLimits;
}

const HEX = '[0-9a-f]{64}';
const identity = <Prefix extends string>(prefix: Prefix) =>
  z.string().regex(new RegExp(`^${prefix}:${HEX}$`));
const DigestSchema = z.string().regex(new RegExp(`^sha256:${HEX}$`));
const SafeIntegerSchema = z.number().int().nonnegative().safe();
const ActionIdSchema = identity('action');
const AttemptIdSchema = identity('attempt');
const EffectIdSchema = identity('effect');
const WaitIdSchema = identity('wait');
const NodeIdSchema = identity('node');

const TerminalSchema = z.discriminatedUnion('kind', [
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

const TransitionOrdinal = { transitionOrdinal: SafeIntegerSchema } as const;
const TransitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...TransitionOrdinal, kind: z.literal('RunStarted') }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('ActionAdmitted'),
    actionId: ActionIdSchema,
    attemptId: AttemptIdSchema,
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('ActionGranted'),
    actionId: ActionIdSchema,
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('ActionResultCommitted'),
    actionId: ActionIdSchema,
    status: z.enum(['succeeded', 'failed', 'blocked']),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('ActionEffectObserved'),
    actionId: ActionIdSchema,
    effectId: EffectIdSchema,
    status: z.enum(['succeeded', 'failed', 'not_executed']),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('ActionInfrastructureObserved'),
    actionId: ActionIdSchema,
    code: z.string().min(1).max(256),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('GateAwaiting'),
    waitId: WaitIdSchema,
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('GateDecided'),
    waitId: WaitIdSchema,
    decisionId: z.string().min(1).max(256),
    outcome: z.string().min(1).max(256),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('HumanDecisionCommitted'),
    waitId: WaitIdSchema,
    actionId: ActionIdSchema,
    decisionId: z.enum(['retry', 'escalate']),
    outcome: z.string().min(1).max(256),
    evidence: z.array(DigestSchema).max(64),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('DomainBlockedWaitConsumedByStrategy'),
    waitId: WaitIdSchema,
    actionId: ActionIdSchema,
    strategyNodeId: NodeIdSchema,
    trigger: z.string().min(1).max(256),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('WorkspaceRevisionAccepted'),
    waitId: WaitIdSchema,
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('RunSuspended'),
    waitId: WaitIdSchema,
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('RunResumed'),
    waitId: WaitIdSchema,
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('RunEscalated'),
    code: z.string().min(1).max(256),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('RunFailed'),
    code: z.string().min(1).max(256),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('RunCancelled'),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    ...TransitionOrdinal,
    kind: z.literal('RunFinished'),
    outcome: z.string().min(1).max(256),
  }),
]);

const EffectSchema = z.strictObject({
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
  receiptDigest: DigestSchema.optional(),
  observation: z.json().optional(),
  evidence: z.array(z.unknown()).max(64).optional(),
});

const ResultSchema = z.strictObject({
  status: z.enum(['succeeded', 'failed', 'blocked']),
  receiptDigest: DigestSchema,
  result: z.json(),
  evidence: z.array(z.unknown()).max(64),
  actor: z.unknown().optional(),
  actorAttestation: z.unknown().optional(),
});

const InfrastructureSchema = z.strictObject({
  receiptDigest: DigestSchema,
  code: z.string().min(1).max(256),
  retryable: z.boolean(),
  artifactDigest: DigestSchema,
  evidence: z.array(z.unknown()).max(64),
});

const CommittedActionSchema = z.strictObject({
  action: z.unknown(),
  attemptOrdinal: SafeIntegerSchema,
  deliveryState: z.enum(['admitted_undelivered', 'granted', 'closed']),
  state: z.enum(['active', 'blocked', 'closed']),
  effects: z.array(EffectSchema).max(64),
  result: ResultSchema.optional(),
  infrastructure: InfrastructureSchema.optional(),
});

const LimitsSchema = z.strictObject({
  maxAttempts: SafeIntegerSchema,
  maxActions: SafeIntegerSchema,
  maxRecordRevisions: SafeIntegerSchema.min(2),
  maxTransitions: SafeIntegerSchema.min(2),
  maxEvidenceRefsPerAction: SafeIntegerSchema.max(64),
  limitOutcome: z.enum(['failed', 'escalated']),
});

const RecordSchema = z.strictObject({
  format: z.literal('change-run-record/1'),
  runId: identity('run'),
  runOrdinal: SafeIntegerSchema,
  change: z.strictObject({
    planningSpaceId: identity('planning-space'),
    projectId: z.string().min(1).max(256),
    changeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    instanceId: identity('change-instance'),
  }),
  workspaceInstanceId: identity('workspace-instance'),
  pipeline: z.string().min(1).max(256),
  engine: z.literal('reconciler'),
  launchRequestDigest: DigestSchema,
  planDigest: DigestSchema,
  sourceRevisionDigest: DigestSchema,
  capabilityDigest: DigestSchema,
  policyDigest: DigestSchema,
  executionProfileDigest: DigestSchema,
  initialWorkspaceRevision: z.unknown(),
  currentWorkspaceRevision: z.unknown(),
  recordVersion: SafeIntegerSchema,
  previousRecordDigest: DigestSchema.nullable(),
  status: z.enum([
    'running',
    'waiting',
    'completed',
    'escalated',
    'failed',
    'cancelled',
  ]),
  limits: LimitsSchema,
  counters: z.strictObject({
    attempts: SafeIntegerSchema,
    actions: SafeIntegerSchema,
    transitions: SafeIntegerSchema,
  }),
  transitions: z.array(TransitionSchema).max(50_000),
  actions: z.record(z.string(), z.unknown()),
  waits: z.array(z.unknown()).max(10_000),
  inputs: z.record(z.string(), z.json()),
  terminal: TerminalSchema.optional(),
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function issues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `/${issue.path.join('/')}` : '/';
    return `${path}: ${issue.message}`;
  });
}

function parseEvidence(values: readonly unknown[]): readonly EvidenceRef[] {
  try {
    return values.map((value) => decodeEvidenceRef(value));
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      throw new CanonicalRecordError(
        'invalid_record_contract',
        error.message,
        error.issues
      );
    }
    throw error;
  }
}

function parseCommittedAction(value: unknown): CommittedAction {
  const parsed = CommittedActionSchema.safeParse(value);
  if (!parsed.success) {
    const parsedIssues = issues(parsed.error);
    throw new CanonicalRecordError(
      'invalid_record_contract',
      parsedIssues.join('; '),
      parsedIssues
    );
  }
  let action: RunAction;
  try {
    action = decodeRunAction(parsed.data.action);
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      throw new CanonicalRecordError(
        'invalid_record_contract',
        error.message,
        error.issues
      );
    }
    throw error;
  }
  return {
    ...parsed.data,
    action,
    effects: parsed.data.effects.map((effect) => ({
      ...effect,
      ...(effect.evidence === undefined
        ? {}
        : { evidence: parseEvidence(effect.evidence) }),
    })),
    ...(parsed.data.result === undefined
      ? {}
      : {
          result: {
            ...parsed.data.result,
            evidence: parseEvidence(parsed.data.result.evidence),
            ...(parsed.data.result.actorAttestation === undefined
              ? {}
              : {
                  actorAttestation: decodeEvidenceRef(
                    parsed.data.result.actorAttestation
                  ),
                }),
            ...(parsed.data.result.actor === undefined
              ? {}
              : {
                  actor: decodeActorRef(parsed.data.result.actor),
                }),
          },
        }),
    ...(parsed.data.infrastructure === undefined
      ? {}
      : {
          infrastructure: {
            ...parsed.data.infrastructure,
            evidence: parseEvidence(parsed.data.infrastructure.evidence),
          },
        }),
  } as unknown as CommittedAction;
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new CanonicalRecordError(
        'invalid_record_invariant',
        `${label} must be strictly stable-sorted and unique.`
      );
    }
  }
}

function assertActionInvariants(
  record: CanonicalRunRecord,
  key: string,
  committed: CommittedAction
): void {
  const action = committed.action;
  if (key !== action.actionId) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Canonical action map key must equal the embedded ActionId.'
    );
  }
  if (action.runId !== record.runId) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Canonical action must belong to the enclosing Run.'
    );
  }
  if (
    action.kind === 'command' &&
    action.command.workspaceInstanceId !== record.workspaceInstanceId
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Command Action workspace identity must match the canonical Record.'
    );
  }
  const expectedEffects = action.effects.map((effect) => ({
    slot: effect.slot,
    effectId: effect.effectId,
  }));
  const actualEffects = committed.effects.map((effect) => ({
    slot: effect.slot,
    effectId: effect.effectId,
  }));
  if (JSON.stringify(actualEffects) !== JSON.stringify(expectedEffects)) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Committed effect slots must exactly match the frozen Action.'
    );
  }
  if (
    (committed.state === 'active') !==
    (committed.deliveryState !== 'closed')
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Only active Actions may remain deliverable.'
    );
  }
  if (
    committed.result !== undefined &&
    committed.infrastructure !== undefined
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Domain and infrastructure observations are mutually exclusive.'
    );
  }
  if (
    committed.result !== undefined &&
    committed.result.evidence.length >
      record.limits.maxEvidenceRefsPerAction
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Action result exceeds the sealed evidence-ref limit.'
    );
  }
  if (
    committed.infrastructure !== undefined &&
    committed.infrastructure.evidence.length >
      record.limits.maxEvidenceRefsPerAction
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Infrastructure observation exceeds the sealed evidence-ref limit.'
    );
  }
  for (const effect of committed.effects) {
    if (
      effect.evidence !== undefined &&
      effect.evidence.length > record.limits.maxEvidenceRefsPerAction
    ) {
      throw new CanonicalRecordError(
        'invalid_record_invariant',
        'Effect observation exceeds the sealed evidence-ref limit.'
      );
    }
  }
}

function assertRecordInvariants(record: CanonicalRunRecord): void {
  if (
    (record.recordVersion === 0) !==
    (record.previousRecordDigest === null)
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Only Record version zero may omit its predecessor digest.'
    );
  }
  if (
    record.transitions.length === 0 ||
    record.transitions[0]?.kind !== 'RunStarted' ||
    record.transitions.some(
      (transition, index) =>
        transition.transitionOrdinal !== index ||
        (index > 0 && transition.kind === 'RunStarted')
    )
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Transition history must start once with RunStarted and use gap-free ordinals.'
    );
  }
  const actionEntries = Object.entries(record.actions);
  const attempts = new Set(
    actionEntries.map(([, committed]) => committed.action.attemptId)
  );
  if (
    record.counters.transitions !== record.transitions.length ||
    record.counters.actions !== actionEntries.length ||
    record.counters.attempts !== attempts.size
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Canonical counters must equal committed transitions/actions/attempts.'
    );
  }
  if (
    record.counters.transitions > record.limits.maxTransitions ||
    record.counters.actions > record.limits.maxActions ||
    record.counters.attempts > record.limits.maxAttempts ||
    record.recordVersion >= record.limits.maxRecordRevisions
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Canonical counters exceed sealed execution limits.'
    );
  }
  assertSortedUnique(Object.keys(record.actions), 'actions');
  for (const [key, committed] of actionEntries) {
    assertActionInvariants(record, key, committed);
  }
  assertSortedUnique(
    record.waits.map((wait) => wait.waitId),
    'waits'
  );
  const actionIds = new Set(Object.keys(record.actions));
  for (const wait of record.waits) {
    if ('actionId' in wait && !actionIds.has(wait.actionId)) {
      throw new CanonicalRecordError(
        'invalid_record_invariant',
        'A canonical wait references an absent Action.'
      );
    }
  }

  const terminalStatuses = [
    'completed',
    'escalated',
    'failed',
    'cancelled',
  ];
  const isTerminal = terminalStatuses.includes(record.status);
  if (isTerminal !== (record.terminal !== undefined)) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Terminal status and terminal outcome must be present together.'
    );
  }
  if (
    record.terminal !== undefined &&
    record.terminal.kind !== record.status
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Terminal outcome kind must match Record status.'
    );
  }
  if (
    isTerminal &&
    (record.waits.length > 0 ||
      actionEntries.some(([, action]) => action.state !== 'closed'))
  ) {
    throw new CanonicalRecordError(
      'invalid_record_invariant',
      'Terminal Records cannot retain waits or non-closed Actions.'
    );
  }
  if (!isTerminal) {
    const hasActiveAction = actionEntries.some(
      ([, action]) => action.state === 'active'
    );
    const expected =
      hasActiveAction || record.waits.length === 0 ? 'running' : 'waiting';
    if (record.status !== expected) {
      throw new CanonicalRecordError(
        'invalid_record_invariant',
        `Non-terminal Record status must be ${expected}.`
      );
    }
  }
}

export function decodeCanonicalRunRecord(
  value: unknown
): CanonicalRunRecord {
  if (
    value !== null &&
    typeof value === 'object' &&
    'format' in value &&
    (value as { format?: unknown }).format !== 'change-run-record/1'
  ) {
    throw new CanonicalRecordError(
      'unsupported_record_version',
      `Unsupported canonical Record format ${JSON.stringify(
        (value as { format?: unknown }).format
      )}.`
    );
  }
  const parsed = RecordSchema.safeParse(value);
  if (!parsed.success) {
    const parsedIssues = issues(parsed.error);
    throw new CanonicalRecordError(
      'invalid_record_contract',
      parsedIssues.join('; '),
      parsedIssues
    );
  }
  let initialWorkspaceRevision: WorkspaceRevision;
  let currentWorkspaceRevision: WorkspaceRevision;
  try {
    initialWorkspaceRevision = decodeWorkspaceRevision(
      parsed.data.initialWorkspaceRevision
    );
    currentWorkspaceRevision = decodeWorkspaceRevision(
      parsed.data.currentWorkspaceRevision
    );
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      throw new CanonicalRecordError(
        'invalid_record_contract',
        error.message,
        error.issues
      );
    }
    throw error;
  }

  const actions = Object.fromEntries(
    Object.entries(parsed.data.actions)
      .map(([key, action]) => [key, parseCommittedAction(action)] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
  let waits: readonly CanonicalWait[];
  try {
    waits = parsed.data.waits.map((wait) =>
      decodeCanonicalWait(wait, parsed.data.runId as RunId)
    );
  } catch (error) {
    if (error instanceof CanonicalWaitError) {
      throw new CanonicalRecordError(
        'invalid_record_contract',
        error.message,
        error.issues
      );
    }
    throw error;
  }

  const record = {
    ...parsed.data,
    runId: parsed.data.runId as RunId,
    change: {
      ...parsed.data.change,
      planningSpaceId: parsed.data.change
        .planningSpaceId as PlanningSpaceId,
      instanceId: parsed.data.change.instanceId as ChangeInstanceId,
    },
    workspaceInstanceId:
      parsed.data.workspaceInstanceId as WorkspaceInstanceId,
    initialWorkspaceRevision,
    currentWorkspaceRevision,
    recordVersion: parsed.data.recordVersion as RecordVersion,
    previousRecordDigest: parsed.data.previousRecordDigest as Digest | null,
    transitions: parsed.data.transitions as readonly CommittedTransition[],
    actions,
    waits,
    terminal: parsed.data.terminal as RunTerminalOutcome | undefined,
  } as CanonicalRunRecord;
  assertRecordInvariants(record);
  return deepFreeze(record);
}

export function createCanonicalRunRecord(
  input: CreateCanonicalRunRecord
): CanonicalRunRecord {
  return decodeCanonicalRunRecord({
    format: 'change-run-record/1',
    ...input,
    engine: 'reconciler',
    currentWorkspaceRevision: input.initialWorkspaceRevision,
    recordVersion: 0,
    previousRecordDigest: null,
    status: 'running',
    counters: { attempts: 0, actions: 0, transitions: 1 },
    transitions: [{ kind: 'RunStarted', transitionOrdinal: 0 }],
    actions: {},
    waits: [],
  });
}

export function digestCanonicalRunRecord(
  record: CanonicalRunRecord
): Digest {
  return domainDigest('change-run-record', record);
}

export function closeCommittedActions(
  actions: CanonicalRunRecord['actions']
): CanonicalRunRecord['actions'] {
  return Object.fromEntries(
    Object.entries(actions).map(([key, committed]) => [
      key,
      {
        ...committed,
        deliveryState: 'closed',
        state: 'closed',
      },
    ])
  );
}
