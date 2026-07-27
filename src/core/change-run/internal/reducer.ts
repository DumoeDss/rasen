import { z } from 'zod';

import {
  ChangeRunContractError,
  decodeEvidenceRef,
  decodeRunAction,
  decodeWorkspaceRevision,
  type AttemptId,
  type Digest,
  type EffectId,
  type EvidenceRef,
  type InvocationId,
  type JsonValue,
  type RunAction,
  type WorkspaceRevision,
} from '../contracts.js';
import {
  deriveActionId,
  deriveAttemptId,
  deriveEffectId,
} from './identity.js';
import {
  closeCommittedActions,
  decodeCanonicalRunRecord,
  digestCanonicalRunRecord,
  type CanonicalRunRecord,
  type CommittedAction,
  type CommittedTransition,
  type RunTerminalOutcome,
} from './record.js';
import {
  CanonicalWaitError,
  createCanonicalWait,
  decodeCanonicalWait,
  type CanonicalWait,
} from './waits.js';

export type RunStimulus =
  | Readonly<{
      kind: 'admit-action';
      action: RunAction;
      attemptOrdinal: number;
      deliveryMode: 'grant' | 'defer';
    }>
  | Readonly<{ kind: 'grant-action'; actionId: string }>
  | Readonly<{
      kind: 'commit-action-result';
      actionId: string;
      status: 'succeeded' | 'failed' | 'blocked';
      receiptDigest: Digest;
      result: JsonValue;
      evidence: readonly EvidenceRef[];
    }>
  | Readonly<{
      kind: 'observe-effect';
      actionId: string;
      effectId: string;
      status: 'succeeded' | 'failed' | 'not_executed';
      receiptDigest: Digest;
      observation: JsonValue;
      evidence: readonly EvidenceRef[];
    }>
  | Readonly<{
      kind: 'observe-infrastructure';
      actionId: string;
      receiptDigest: Digest;
      code: string;
      retryable: boolean;
      artifactDigest: Digest;
      evidence: readonly EvidenceRef[];
    }>
  | Readonly<{ kind: 'await-gate'; wait: CanonicalWait & { kind: 'gate' } }>
  | Readonly<{ kind: 'suspend'; wait: CanonicalWait }>
  | Readonly<{ kind: 'resume-wait'; waitId: string }>
  | Readonly<{
      kind: 'decide-gate';
      waitId: string;
      decisionId: string;
      outcome: string;
    }>
  | Readonly<{
      kind: 'accept-workspace-revision';
      waitId: string;
      revision: WorkspaceRevision;
      evidence: readonly EvidenceRef[];
    }>
  | Readonly<{ kind: 'escalate'; code: string; reason?: string }>
  | Readonly<{ kind: 'cancel'; reason?: string }>
  | Readonly<{ kind: 'finish'; outcome: string }>;

export type RunReductionFailureCode =
  | 'invalid_stimulus'
  | 'terminal_record'
  | 'illegal_transition'
  | 'action_not_active'
  | 'effect_identity_conflict'
  | 'wait_identity_conflict'
  | 'control_not_allowed'
  | 'execution_budget_exhausted';

export interface RunReductionFailure {
  readonly code: RunReductionFailureCode;
  readonly message: string;
}

export type RunReductionResult =
  | Readonly<{ ok: true; record: CanonicalRunRecord }>
  | Readonly<{ ok: false; failure: RunReductionFailure }>;

const HEX = '[0-9a-f]{64}';
const identity = <Prefix extends string>(prefix: Prefix) =>
  z.string().regex(new RegExp(`^${prefix}:${HEX}$`));
const DigestSchema = z.string().regex(new RegExp(`^sha256:${HEX}$`));
const SafeIntegerSchema = z.number().int().nonnegative().safe();

const StimulusSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('admit-action'),
    action: z.unknown(),
    attemptOrdinal: SafeIntegerSchema,
    deliveryMode: z.enum(['grant', 'defer']),
  }),
  z.strictObject({
    kind: z.literal('grant-action'),
    actionId: identity('action'),
  }),
  z.strictObject({
    kind: z.literal('commit-action-result'),
    actionId: identity('action'),
    status: z.enum(['succeeded', 'failed', 'blocked']),
    receiptDigest: DigestSchema,
    result: z.json(),
    evidence: z.array(z.unknown()).max(64),
  }),
  z.strictObject({
    kind: z.literal('observe-effect'),
    actionId: identity('action'),
    effectId: identity('effect'),
    status: z.enum(['succeeded', 'failed', 'not_executed']),
    receiptDigest: DigestSchema,
    observation: z.json(),
    evidence: z.array(z.unknown()).max(64),
  }),
  z.strictObject({
    kind: z.literal('observe-infrastructure'),
    actionId: identity('action'),
    receiptDigest: DigestSchema,
    code: z.string().min(1).max(256),
    retryable: z.boolean(),
    artifactDigest: DigestSchema,
    evidence: z.array(z.unknown()).max(64),
  }),
  z.strictObject({ kind: z.literal('await-gate'), wait: z.unknown() }),
  z.strictObject({ kind: z.literal('suspend'), wait: z.unknown() }),
  z.strictObject({
    kind: z.literal('resume-wait'),
    waitId: identity('wait'),
  }),
  z.strictObject({
    kind: z.literal('decide-gate'),
    waitId: identity('wait'),
    decisionId: z.string().min(1).max(256),
    outcome: z.string().min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal('accept-workspace-revision'),
    waitId: identity('wait'),
    revision: z.unknown(),
    evidence: z.array(z.unknown()).min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal('escalate'),
    code: z.string().min(1).max(256),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    kind: z.literal('cancel'),
    reason: z.string().max(4096).optional(),
  }),
  z.strictObject({
    kind: z.literal('finish'),
    outcome: z.string().min(1).max(256),
  }),
]);

function failure(
  code: RunReductionFailureCode,
  message: string
): RunReductionResult {
  return Object.freeze({
    ok: false,
    failure: Object.freeze({ code, message }),
  });
}

function parseEvidence(values: readonly unknown[]): readonly EvidenceRef[] {
  return values.map((value) => decodeEvidenceRef(value));
}

export function decodeRunStimulus(
  value: unknown,
  record: CanonicalRunRecord
): RunStimulus {
  const parsed = StimulusSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `/${issue.path.join('/')}: ${issue.message}`)
        .join('; ')
    );
  }
  const stimulus = parsed.data;
  switch (stimulus.kind) {
    case 'admit-action':
      return {
        ...stimulus,
        action: decodeRunAction(stimulus.action),
      } as RunStimulus;
    case 'await-gate': {
      const wait = decodeCanonicalWait(stimulus.wait, record.runId);
      if (wait.kind !== 'gate') {
        throw new Error('await-gate requires a canonical Gate wait.');
      }
      return { ...stimulus, wait };
    }
    case 'suspend':
      return {
        ...stimulus,
        wait: decodeCanonicalWait(stimulus.wait, record.runId),
      };
    case 'commit-action-result':
    case 'observe-effect':
    case 'observe-infrastructure':
      return {
        ...stimulus,
        evidence: parseEvidence(stimulus.evidence),
      } as RunStimulus;
    case 'accept-workspace-revision':
      return {
        ...stimulus,
        revision: decodeWorkspaceRevision(stimulus.revision),
        evidence: parseEvidence(stimulus.evidence),
      } as unknown as RunStimulus;
    default:
      return stimulus as RunStimulus;
  }
}

function statusFor(
  actions: CanonicalRunRecord['actions'],
  waits: readonly CanonicalWait[]
): 'running' | 'waiting' {
  return Object.values(actions).some((action) => action.state === 'active') ||
    waits.length === 0
    ? 'running'
    : 'waiting';
}

function sortedActions(
  actions: CanonicalRunRecord['actions']
): CanonicalRunRecord['actions'] {
  return Object.fromEntries(
    Object.entries(actions).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )
  );
}

function sortedWaits(waits: readonly CanonicalWait[]): readonly CanonicalWait[] {
  return [...waits].sort((left, right) =>
    left.waitId < right.waitId ? -1 : left.waitId > right.waitId ? 1 : 0
  );
}

type TransitionWithoutOrdinal =
  CommittedTransition extends infer Transition
    ? Transition extends { readonly transitionOrdinal: number }
      ? Omit<Transition, 'transitionOrdinal'>
      : never
    : never;

interface RecordDelta {
  readonly actions?: CanonicalRunRecord['actions'];
  readonly waits?: readonly CanonicalWait[];
  readonly currentWorkspaceRevision?: WorkspaceRevision;
  readonly terminal?: RunTerminalOutcome;
  readonly status?: CanonicalRunRecord['status'];
}

function commit(
  record: CanonicalRunRecord,
  transitions: readonly TransitionWithoutOrdinal[],
  delta: RecordDelta = {}
): CanonicalRunRecord {
  const appended = transitions.map((transition, offset) => ({
    ...transition,
    transitionOrdinal: record.transitions.length + offset,
  })) as readonly CommittedTransition[];
  const actions = sortedActions(delta.actions ?? record.actions);
  const waits = sortedWaits(delta.waits ?? record.waits);
  const terminal = delta.terminal;
  const status =
    delta.status ??
    (terminal === undefined ? statusFor(actions, waits) : terminal.kind);
  return decodeCanonicalRunRecord({
    ...record,
    recordVersion: record.recordVersion + 1,
    previousRecordDigest: digestCanonicalRunRecord(record),
    status,
    counters: {
      attempts: new Set(
        Object.values(actions).map((action) => action.action.attemptId)
      ).size,
      actions: Object.keys(actions).length,
      transitions: record.transitions.length + appended.length,
    },
    transitions: [...record.transitions, ...appended],
    actions,
    waits,
    currentWorkspaceRevision:
      delta.currentWorkspaceRevision ?? record.currentWorkspaceRevision,
    ...(terminal === undefined ? { terminal: undefined } : { terminal }),
  });
}

function terminalTransition(
  terminal: RunTerminalOutcome
): TransitionWithoutOrdinal {
  switch (terminal.kind) {
    case 'completed':
      return { kind: 'RunFinished', outcome: terminal.outcome };
    case 'escalated':
      return {
        kind: 'RunEscalated',
        code: terminal.code,
        ...(terminal.reason === undefined ? {} : { reason: terminal.reason }),
      };
    case 'failed':
      return {
        kind: 'RunFailed',
        code: terminal.code,
        ...(terminal.reason === undefined ? {} : { reason: terminal.reason }),
      };
    case 'cancelled':
      return {
        kind: 'RunCancelled',
        ...(terminal.reason === undefined ? {} : { reason: terminal.reason }),
      };
  }
}

function terminate(
  record: CanonicalRunRecord,
  terminal: RunTerminalOutcome
): RunReductionResult {
  if (record.transitions.length >= record.limits.maxTransitions) {
    return failure(
      'execution_budget_exhausted',
      'No bounded transition slot remains for a terminal outcome.'
    );
  }
  return {
    ok: true,
    record: commit(record, [terminalTransition(terminal)], {
      actions: closeCommittedActions(record.actions),
      waits: [],
      terminal,
      status: terminal.kind,
    }),
  };
}

function terminateAtLimit(
  record: CanonicalRunRecord,
  limit:
    | 'attempts'
    | 'actions'
    | 'record revisions'
    | 'transitions'
    | 'evidence'
): RunReductionResult {
  const common = {
    code: 'execution_budget_exhausted',
    reason: `Sealed ${limit} limit reached.`,
  } as const;
  return terminate(
    record,
    record.limits.limitOutcome === 'failed'
      ? { kind: 'failed', ...common }
      : { kind: 'escalated', ...common }
  );
}

function reserveTransitionCapacity(
  record: CanonicalRunRecord,
  required: number
): RunReductionResult | null {
  if (
    record.recordVersion + 2 >=
    record.limits.maxRecordRevisions
  ) {
    return terminateAtLimit(record, 'record revisions');
  }
  if (
    record.transitions.length + required >=
    record.limits.maxTransitions
  ) {
    return terminateAtLimit(record, 'transitions');
  }
  return null;
}

function replaceAction(
  record: CanonicalRunRecord,
  actionId: string,
  action: CommittedAction
): CanonicalRunRecord['actions'] {
  return { ...record.actions, [actionId]: action };
}

function findWait(
  record: CanonicalRunRecord,
  waitId: string
): CanonicalWait | undefined {
  return record.waits.find((wait) => wait.waitId === waitId);
}

function removeWait(
  record: CanonicalRunRecord,
  waitId: string
): readonly CanonicalWait[] {
  return record.waits.filter((wait) => wait.waitId !== waitId);
}

function closeActionForWait(
  committed: CommittedAction,
  wait: CanonicalWait
): CommittedAction {
  return {
    ...committed,
    state: 'blocked',
    deliveryState: 'closed',
    effects:
      wait.kind === 'uncertain-effect'
        ? committed.effects.map((effect) =>
            wait.effectIds.includes(effect.effectId)
              ? { ...effect, state: 'uncertain' }
              : effect
          )
        : committed.effects,
  };
}

export function reduceCanonicalRunRecord(
  inputRecord: CanonicalRunRecord,
  inputStimulus: RunStimulus
): RunReductionResult {
  let record: CanonicalRunRecord;
  let stimulus: RunStimulus;
  try {
    record = decodeCanonicalRunRecord(inputRecord);
    stimulus = decodeRunStimulus(inputStimulus, record);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid Run stimulus.';
    if (
      error instanceof ChangeRunContractError ||
      error instanceof CanonicalWaitError ||
      error instanceof Error
    ) {
      return failure('invalid_stimulus', message);
    }
    return failure('invalid_stimulus', message);
  }

  if (record.terminal !== undefined) {
    return failure('terminal_record', 'A terminal Record cannot be reduced.');
  }

  switch (stimulus.kind) {
    case 'admit-action': {
      const transitionCount = stimulus.deliveryMode === 'grant' ? 2 : 1;
      const capacity = reserveTransitionCapacity(record, transitionCount);
      if (capacity !== null) return capacity;
      if (record.actions[stimulus.action.actionId] !== undefined) {
        return failure(
          'illegal_transition',
          'An ActionId can be admitted only once.'
        );
      }
      if (stimulus.action.runId !== record.runId) {
        return failure(
          'illegal_transition',
          'Action RunId does not match the canonical Record.'
        );
      }
      const expectedAttemptId = deriveAttemptId(
        stimulus.action.invocationId as InvocationId,
        stimulus.attemptOrdinal
      );
      if (stimulus.action.attemptId !== expectedAttemptId) {
        return failure(
          'illegal_transition',
          'AttemptId does not match its committed attempt ordinal.'
        );
      }
      for (const effect of stimulus.action.effects) {
        if (
          effect.effectId !==
          deriveEffectId(
            stimulus.action.invocationId as InvocationId,
            effect.slot
          )
        ) {
          return failure(
            'effect_identity_conflict',
            'EffectId does not match its Invocation/effect slot.'
          );
        }
      }
      const expectedActionId = deriveActionId(
        stimulus.action.attemptId as AttemptId,
        stimulus.action.kind,
        stimulus.action.effects.map((effect) => ({
          slot: effect.slot,
          effectId: effect.effectId as EffectId,
        }))
      );
      if (stimulus.action.actionId !== expectedActionId) {
        return failure(
          'illegal_transition',
          'ActionId does not bind the exact Attempt/kind/effect set.'
        );
      }
      if (record.counters.actions + 1 > record.limits.maxActions) {
        return terminateAtLimit(record, 'actions');
      }
      const attemptExists = Object.values(record.actions).some(
        (action) => action.action.attemptId === stimulus.action.attemptId
      );
      if (attemptExists) {
        return failure(
          'illegal_transition',
          'An AttemptId can admit only one canonical Action.'
        );
      }
      const priorOrdinals = Object.values(record.actions)
        .filter(
          (action) =>
            action.action.invocationId === stimulus.action.invocationId
        )
        .map((action) => action.attemptOrdinal);
      const nextOrdinal =
        priorOrdinals.length === 0 ? 0 : Math.max(...priorOrdinals) + 1;
      if (stimulus.attemptOrdinal !== nextOrdinal) {
        return failure(
          'illegal_transition',
          'Attempt ordinals must be gap-free within one Invocation.'
        );
      }
      if (
        record.counters.attempts + 1 > record.limits.maxAttempts
      ) {
        return terminateAtLimit(record, 'attempts');
      }
      const committed: CommittedAction = {
        action: stimulus.action,
        attemptOrdinal: stimulus.attemptOrdinal,
        deliveryState:
          stimulus.deliveryMode === 'grant'
            ? 'granted'
            : 'admitted_undelivered',
        state: 'active',
        effects: stimulus.action.effects.map((effect) => ({
          slot: effect.slot,
          effectId: effect.effectId,
          state: 'admitted',
        })),
      };
      const transitions: TransitionWithoutOrdinal[] = [
        {
          kind: 'ActionAdmitted',
          actionId: stimulus.action.actionId,
          attemptId: stimulus.action.attemptId,
        },
      ];
      if (stimulus.deliveryMode === 'grant') {
        transitions.push({
          kind: 'ActionGranted',
          actionId: stimulus.action.actionId,
        });
      }
      return {
        ok: true,
        record: commit(record, transitions, {
          actions: replaceAction(
            record,
            stimulus.action.actionId,
            committed
          ),
        }),
      };
    }
    case 'grant-action': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      const committed = record.actions[stimulus.actionId];
      if (
        committed === undefined ||
        committed.state !== 'active' ||
        committed.deliveryState !== 'admitted_undelivered'
      ) {
        return failure(
          'action_not_active',
          'Only an active undelivered Action can be granted.'
        );
      }
      return {
        ok: true,
        record: commit(
          record,
          [{ kind: 'ActionGranted', actionId: stimulus.actionId }],
          {
            actions: replaceAction(record, stimulus.actionId, {
              ...committed,
              deliveryState: 'granted',
            }),
          }
        ),
      };
    }
    case 'observe-effect': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      const committed = record.actions[stimulus.actionId];
      if (committed === undefined || committed.state !== 'active') {
        return failure(
          'action_not_active',
          'Effect observation requires an active Action.'
        );
      }
      if (
        stimulus.evidence.length >
        record.limits.maxEvidenceRefsPerAction
      ) {
        return terminateAtLimit(record, 'evidence');
      }
      const effectIndex = committed.effects.findIndex(
        (effect) => effect.effectId === stimulus.effectId
      );
      const effect = committed.effects[effectIndex];
      if (effect === undefined || effect.state !== 'admitted') {
        return failure(
          'effect_identity_conflict',
          'Effect observation must address one unresolved Action effect.'
        );
      }
      const effects = [...committed.effects];
      effects[effectIndex] = {
        ...effect,
        state: stimulus.status,
        receiptDigest: stimulus.receiptDigest,
        observation: stimulus.observation,
        evidence: stimulus.evidence,
      };
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ActionEffectObserved',
              actionId: stimulus.actionId,
              effectId: stimulus.effectId,
              status: stimulus.status,
            },
          ],
          {
            actions: replaceAction(record, stimulus.actionId, {
              ...committed,
              effects,
            }),
          }
        ),
      };
    }
    case 'commit-action-result': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      const committed = record.actions[stimulus.actionId];
      if (committed === undefined || committed.state !== 'active') {
        return failure(
          'action_not_active',
          'Domain result requires an active Action.'
        );
      }
      if (
        stimulus.evidence.length >
        record.limits.maxEvidenceRefsPerAction
      ) {
        return terminateAtLimit(record, 'evidence');
      }
      if (
        stimulus.status === 'succeeded' &&
        committed.effects.some((effect) => effect.state === 'admitted')
      ) {
        return failure(
          'illegal_transition',
          'A successful domain result cannot close before required effects.'
        );
      }
      let waits = record.waits;
      let nextAction: CommittedAction = {
        ...committed,
        deliveryState: 'closed',
        state: stimulus.status === 'blocked' ? 'blocked' : 'closed',
        result: {
          status: stimulus.status,
          receiptDigest: stimulus.receiptDigest,
          result: stimulus.result,
          evidence: stimulus.evidence,
        },
      };
      if (stimulus.status === 'blocked') {
        const resultObject =
          stimulus.result !== null &&
          typeof stimulus.result === 'object' &&
          !Array.isArray(stimulus.result) &&
          typeof (
            stimulus.result as Readonly<Record<string, JsonValue>>
          ).reasonCode === 'string'
            ? (stimulus.result as Readonly<Record<string, JsonValue>>)
                .reasonCode
            : undefined;
        const reasonCode =
          typeof resultObject === 'string'
            ? resultObject
            : 'domain_blocked';
        const wait = createCanonicalWait(record.runId, {
          kind: 'domain-blocked',
          nodeId: committed.action.nodeId,
          invocationId: committed.action.invocationId,
          occurrence: 0,
          attemptId: committed.action.attemptId,
          actionId: committed.action.actionId,
          effectIds: committed.action.effects.map((effect) => effect.effectId),
          reasonCode,
          evidence: [...stimulus.evidence],
        });
        waits = sortedWaits([...record.waits, wait]);
      }
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ActionResultCommitted',
              actionId: stimulus.actionId,
              status: stimulus.status,
            },
          ],
          {
            actions: replaceAction(record, stimulus.actionId, nextAction),
            waits,
          }
        ),
      };
    }
    case 'observe-infrastructure': {
      const capacity = reserveTransitionCapacity(record, 2);
      if (capacity !== null) return capacity;
      const committed = record.actions[stimulus.actionId];
      if (committed === undefined || committed.state !== 'active') {
        return failure(
          'action_not_active',
          'Infrastructure observation requires an active Action.'
        );
      }
      if (
        stimulus.evidence.length >
        record.limits.maxEvidenceRefsPerAction
      ) {
        return terminateAtLimit(record, 'evidence');
      }
      const effectIds = committed.action.effects.map(
        (effect) => effect.effectId
      );
      const wait = createCanonicalWait(record.runId, {
        kind: 'infrastructure',
        nodeId: committed.action.nodeId,
        invocationId: committed.action.invocationId,
        occurrence: 0,
        attemptId: committed.action.attemptId,
        actionId: committed.action.actionId,
        effectIds,
        code: stimulus.code,
        retryable: stimulus.retryable,
        artifactDigest: stimulus.artifactDigest,
      });
      const nextAction: CommittedAction = {
        ...committed,
        state: 'blocked',
        deliveryState: 'closed',
        effects: committed.effects.map((effect) => ({
          ...effect,
          state:
            effect.state === 'admitted'
              ? 'infrastructure_failed'
              : effect.state,
        })),
        infrastructure: {
          receiptDigest: stimulus.receiptDigest,
          code: stimulus.code,
          retryable: stimulus.retryable,
          artifactDigest: stimulus.artifactDigest,
          evidence: stimulus.evidence,
        },
      };
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ActionInfrastructureObserved',
              actionId: stimulus.actionId,
              code: stimulus.code,
            },
            { kind: 'RunSuspended', waitId: wait.waitId },
          ],
          {
            actions: replaceAction(record, stimulus.actionId, nextAction),
            waits: [...record.waits, wait],
          }
        ),
      };
    }
    case 'await-gate': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      if (findWait(record, stimulus.wait.waitId) !== undefined) {
        return failure(
          'illegal_transition',
          'A wait identity can be admitted only once.'
        );
      }
      return {
        ok: true,
        record: commit(
          record,
          [{ kind: 'GateAwaiting', waitId: stimulus.wait.waitId }],
          { waits: [...record.waits, stimulus.wait] }
        ),
      };
    }
    case 'suspend': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      if (findWait(record, stimulus.wait.waitId) !== undefined) {
        return failure(
          'illegal_transition',
          'A wait identity can be admitted only once.'
        );
      }
      let actions = record.actions;
      if ('actionId' in stimulus.wait) {
        const committed = record.actions[stimulus.wait.actionId];
        if (committed === undefined || committed.state !== 'active') {
          return failure(
            'action_not_active',
            'An action-bound suspension requires an active Action.'
          );
        }
        actions = replaceAction(
          record,
          stimulus.wait.actionId,
          closeActionForWait(committed, stimulus.wait)
        );
      }
      return {
        ok: true,
        record: commit(
          record,
          [{ kind: 'RunSuspended', waitId: stimulus.wait.waitId }],
          { actions, waits: [...record.waits, stimulus.wait] }
        ),
      };
    }
    case 'resume-wait': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      const wait = findWait(record, stimulus.waitId);
      if (wait === undefined) {
        return failure(
          'wait_identity_conflict',
          'Resume must address one exact active WaitId.'
        );
      }
      const resumable =
        wait.kind === 'domain-blocked' ||
        wait.kind === 'capability-unavailable' ||
        wait.kind === 'workspace-reservation' ||
        (wait.kind === 'infrastructure' && wait.retryable);
      if (!resumable) {
        return failure(
          'control_not_allowed',
          `Wait kind ${wait.kind} does not allow ordinary resume.`
        );
      }
      return {
        ok: true,
        record: commit(
          record,
          [{ kind: 'RunResumed', waitId: wait.waitId }],
          { waits: removeWait(record, wait.waitId) }
        ),
      };
    }
    case 'decide-gate': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      const wait = findWait(record, stimulus.waitId);
      if (wait === undefined || wait.kind !== 'gate') {
        return failure(
          'wait_identity_conflict',
          'Gate decision must address one exact active Gate WaitId.'
        );
      }
      if (!wait.decisionIds.includes(stimulus.decisionId)) {
        return failure(
          'control_not_allowed',
          'Gate decision is not declared by the frozen wait.'
        );
      }
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'GateDecided',
              waitId: wait.waitId,
              decisionId: stimulus.decisionId,
              outcome: stimulus.outcome,
            },
          ],
          { waits: removeWait(record, wait.waitId) }
        ),
      };
    }
    case 'accept-workspace-revision': {
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      const wait = findWait(record, stimulus.waitId);
      if (wait === undefined || wait.kind !== 'workspace-drift') {
        return failure(
          'wait_identity_conflict',
          'Workspace acceptance must address one exact active drift WaitId.'
        );
      }
      if (
        JSON.stringify(stimulus.revision) !== JSON.stringify(wait.observed)
      ) {
        return failure(
          'control_not_allowed',
          'Accepted revision must equal the exact observed drift revision.'
        );
      }
      if (
        stimulus.evidence.length >
        record.limits.maxEvidenceRefsPerAction
      ) {
        return terminateAtLimit(record, 'evidence');
      }
      return {
        ok: true,
        record: commit(
          record,
          [{ kind: 'WorkspaceRevisionAccepted', waitId: wait.waitId }],
          {
            waits: removeWait(record, wait.waitId),
            currentWorkspaceRevision: stimulus.revision,
          }
        ),
      };
    }
    case 'escalate':
      return terminate(record, {
        kind: 'escalated',
        code: stimulus.code,
        ...(stimulus.reason === undefined
          ? {}
          : { reason: stimulus.reason }),
      });
    case 'cancel':
      return terminate(record, {
        kind: 'cancelled',
        ...(stimulus.reason === undefined
          ? {}
          : { reason: stimulus.reason }),
      });
    case 'finish':
      return terminate(record, {
        kind: 'completed',
        outcome: stimulus.outcome,
      });
  }
}

/**
 * The candidate-commit seam (task 5.7). Applies a sequence of stimuli as ONE
 * candidate Record revision: each stimulus is validated against the
 * accumulating intermediate state exactly as `reduceCanonicalRunRecord` does,
 * but the N intermediate revisions are collapsed into a single revision over
 * the original base (recordVersion = base + 1, predecessor = base digest, all
 * appended transitions carried with gap-free ordinals).
 *
 * This is what lets the reconciler land "one completion plus all mechanically
 * implied downstream admissions/waits" in one candidate Record rather than one
 * revision per stimulus. The batch is atomic: the first stimulus that returns
 * a typed failure aborts the whole batch and nothing is committed.
 */
export function reduceCandidateBatch(
  base: CanonicalRunRecord,
  stimuli: readonly RunStimulus[]
): RunReductionResult {
  if (stimuli.length === 0) {
    return { ok: true, record: base };
  }
  let working = base;
  for (const stimulus of stimuli) {
    const step = reduceCanonicalRunRecord(working, stimulus);
    if (!step.ok) {
      return step;
    }
    working = step.record;
  }
  // Collapse the intermediate revision chain into one candidate revision over
  // the original base. Transitions/actions/waits/counters/status/terminal are
  // the final accumulated values; only the version pointer is re-rooted.
  return {
    ok: true,
    record: decodeCanonicalRunRecord({
      ...working,
      recordVersion: (base.recordVersion as number) + 1,
      previousRecordDigest: digestCanonicalRunRecord(base),
    }),
  };
}
