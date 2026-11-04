import { z } from 'zod';

import {
  ChangeRunContractError,
  decodeEvidenceRef,
  decodeRunAction,
  decodeWorkspaceRevision,
  type ActorRef,
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
  committedActionOccurrence,
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
import {
  CommittedConsultationZodSchema,
  closeConsultationsForSource,
  failTeacherAttempt,
  grantContinuation,
  linkTeacherAction,
  markContinuationAmbiguous,
  settleContinuation,
  type CommittedConsultation,
} from './consultation-lifecycle.js';

export type RunStimulus =
  | Readonly<{
      kind: 'admit-action';
      action: RunAction;
      attemptOrdinal: number;
      deliveryMode: 'grant' | 'defer';
    }>
  | Readonly<{ kind: 'grant-action'; actionId: string }>
  | Readonly<{
      kind: 'request-consultation';
      consultation: CommittedConsultation;
    }>
  | Readonly<{
      kind: 'link-consultation-teacher';
      consultationId: string;
      teacherActionId: string;
    }>
  | Readonly<{
      kind: 'commit-consultation-advice';
      consultation: CommittedConsultation;
    }>
  | Readonly<{
      kind: 'fail-consultation-teacher';
      consultationId: string;
      teacherActionId: string;
      detail: string;
    }>
  | Readonly<{
      kind: 'grant-consultation-continuation';
      consultationId: string;
    }>
  | Readonly<{
      kind: 'settle-consultation-continuation';
      consultationId: string;
      resultDigest: Digest;
    }>
  | Readonly<{
      kind: 'mark-consultation-continuation-ambiguous';
      consultationId: string;
      detail: string;
    }>
  | Readonly<{
      kind: 'commit-action-result';
      actionId: string;
      status: 'succeeded' | 'failed' | 'blocked';
      receiptDigest: Digest;
      result: JsonValue;
      evidence: readonly EvidenceRef[];
      actor?: ActorRef;
      actorAttestation?: EvidenceRef;
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
  | Readonly<{
      kind: 'await-human-required';
      wait: CanonicalWait & { kind: 'human-required' };
    }>
  | Readonly<{
      kind: 'consume-domain-blocked-wait-for-strategy';
      waitId: string;
      actionId: string;
      strategyNodeId: string;
      trigger: string;
    }>
  | Readonly<{ kind: 'suspend'; wait: CanonicalWait }>
  | Readonly<{ kind: 'resume-wait'; waitId: string }>
  | Readonly<{
      kind: 'decide-gate';
      waitId: string;
      decisionId: string;
      outcome: string;
    }>
  | Readonly<{
      kind: 'decide-human';
      waitId: string;
      decisionId: 'retry' | 'escalate';
      outcome: string;
      evidence: readonly EvidenceRef[];
    }>
  | Readonly<{
      kind: 'accept-workspace-revision';
      waitId: string;
      revision: WorkspaceRevision;
      evidence: readonly EvidenceRef[];
    }>
  | Readonly<{ kind: 'escalate'; code: string; reason?: string }>
  | Readonly<{ kind: 'fail'; code: string; reason?: string }>
  | Readonly<{ kind: 'cancel'; reason?: string }>
  | Readonly<{ kind: 'finish'; outcome: string }>;

export type RunReductionFailureCode =
  | 'invalid_stimulus'
  | 'terminal_record'
  | 'illegal_transition'
  | 'action_not_active'
  | 'consultation_identity_conflict'
  | 'consultation_not_active'
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
    kind: z.literal('request-consultation'),
    consultation: CommittedConsultationZodSchema,
  }),
  z.strictObject({
    kind: z.literal('fail-consultation-teacher'),
    consultationId: identity('consultation'),
    teacherActionId: identity('action'),
    detail: z.string().min(1).max(4096),
  }),
  z.strictObject({
    kind: z.literal('link-consultation-teacher'),
    consultationId: identity('consultation'),
    teacherActionId: identity('action'),
  }),
  z.strictObject({
    kind: z.literal('commit-consultation-advice'),
    consultation: CommittedConsultationZodSchema,
  }),
  z.strictObject({
    kind: z.literal('grant-consultation-continuation'),
    consultationId: identity('consultation'),
  }),
  z.strictObject({
    kind: z.literal('settle-consultation-continuation'),
    consultationId: identity('consultation'),
    resultDigest: DigestSchema,
  }),
  z.strictObject({
    kind: z.literal('mark-consultation-continuation-ambiguous'),
    consultationId: identity('consultation'),
    detail: z.string().min(1).max(4096),
  }),
  z.strictObject({
    kind: z.literal('commit-action-result'),
    actionId: identity('action'),
    status: z.enum(['succeeded', 'failed', 'blocked']),
    receiptDigest: DigestSchema,
    result: z.json(),
    evidence: z.array(z.unknown()).max(64),
    actor: z.unknown().optional(),
    actorAttestation: z.unknown().optional(),
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
  z.strictObject({ kind: z.literal('await-human-required'), wait: z.unknown() }),
  z.strictObject({
    kind: z.literal('consume-domain-blocked-wait-for-strategy'),
    waitId: identity('wait'),
    actionId: identity('action'),
    strategyNodeId: identity('node'),
    trigger: z.string().min(1).max(256),
  }),
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
    kind: z.literal('decide-human'),
    waitId: identity('wait'),
    decisionId: z.enum(['retry', 'escalate']),
    outcome: z.string().min(1).max(256),
    evidence: z.array(z.unknown()).max(64),
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
    kind: z.literal('fail'),
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
    case 'request-consultation':
    case 'commit-consultation-advice':
      return {
        ...stimulus,
        consultation: stimulus.consultation as unknown as CommittedConsultation,
      };
    case 'await-gate': {
      const wait = decodeCanonicalWait(stimulus.wait, record.runId);
      if (wait.kind !== 'gate') {
        throw new Error('await-gate requires a canonical Gate wait.');
      }
      return { ...stimulus, wait };
    }
    case 'await-human-required': {
      const wait = decodeCanonicalWait(stimulus.wait, record.runId);
      if (wait.kind !== 'human-required') {
        throw new Error('await-human-required requires a canonical human-required wait.');
      }
      return { ...stimulus, wait };
    }
    case 'consume-domain-blocked-wait-for-strategy':
      return stimulus;
    case 'suspend':
      return {
        ...stimulus,
        wait: decodeCanonicalWait(stimulus.wait, record.runId),
      };
    case 'commit-action-result':
      return {
        ...stimulus,
        evidence: parseEvidence(stimulus.evidence),
        ...(stimulus.actorAttestation === undefined
          ? {}
          : {
              actorAttestation: decodeEvidenceRef(
                stimulus.actorAttestation as unknown
              ),
            }),
      } as RunStimulus;
    case 'observe-effect':
    case 'observe-infrastructure':
      return {
        ...stimulus,
        evidence: parseEvidence(stimulus.evidence),
      } as RunStimulus;
    case 'decide-human':
      return {
        ...stimulus,
        evidence: parseEvidence(stimulus.evidence),
      };
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
  readonly consultations?: CanonicalRunRecord['consultations'];
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
    ...(delta.consultations === undefined && record.consultations === undefined
      ? {}
      : { consultations: delta.consultations ?? record.consultations }),
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
      consultations:
        record.consultations === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(record.consultations).map(([key, consultation]) => [
                key,
                consultation.state === 'closed'
                  ? consultation
                  : {
                      ...consultation,
                      state: 'closed' as const,
                      failure: {
                        code: 'source-terminal' as const,
                        detail: 'The Run reached a terminal state.',
                      },
                    },
              ])
            ),
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
    case 'request-consultation': {
      const consultation = stimulus.consultation;
      const existing = record.consultations?.[consultation.consultationId];
      if (existing !== undefined) {
        return JSON.stringify(existing) === JSON.stringify(consultation)
          ? { ok: true, record }
          : failure(
              'consultation_identity_conflict',
              'ConsultationId was reused with a different canonical payload.'
            );
      }
      const source = record.actions[consultation.source.actionId];
      if (
        source === undefined ||
        source.state !== 'active' ||
        source.action.invocationId !== consultation.source.invocationId ||
        source.action.attemptId !== consultation.source.attemptId
      ) {
        return failure(
          'consultation_not_active',
          'Consultation request must pause the exact active source Action.'
        );
      }
      const transitions: TransitionWithoutOrdinal[] = [
        {
          kind: 'ConsultationRequested',
          consultationId: consultation.consultationId,
          sourceActionId: consultation.source.actionId,
          ordinal: consultation.ordinal,
        },
      ];
      if (consultation.state === 'unavailable') {
        transitions.push({
          kind: 'ConsultationUnavailable',
          consultationId: consultation.consultationId,
          reason:
            consultation.failure?.code ?? 'consultation-limit-exhausted',
        });
      }
      const capacity = reserveTransitionCapacity(record, transitions.length);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(record, transitions, {
          actions: replaceAction(record, source.action.actionId, {
            ...source,
            state: 'consultation-paused',
            deliveryState: 'paused',
          }),
          consultations: {
            ...(record.consultations ?? {}),
            [consultation.consultationId]: consultation,
          },
        }),
      };
    }
    case 'link-consultation-teacher': {
      const consultation = record.consultations?.[stimulus.consultationId];
      const teacherAction = record.actions[stimulus.teacherActionId]?.action;
      if (consultation === undefined || teacherAction === undefined) {
        return failure(
          'consultation_not_active',
          'Teacher linkage requires the requested consultation and admitted Teacher Action.'
        );
      }
      let linked: CommittedConsultation;
      try {
        linked = linkTeacherAction(consultation, teacherAction);
      } catch (error) {
        return failure(
          'consultation_identity_conflict',
          error instanceof Error ? error.message : 'Invalid Teacher linkage.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ConsultationTeacherLinked',
              consultationId: linked.consultationId,
              teacherActionId: teacherAction.actionId,
              teacherAttempt: linked.teacher.attemptOrdinal,
            },
          ],
          {
            consultations: {
              ...(record.consultations ?? {}),
              [linked.consultationId]: linked,
            },
          }
        ),
      };
    }
    case 'commit-consultation-advice': {
      const next = stimulus.consultation;
      const current = record.consultations?.[next.consultationId];
      if (
        current === undefined ||
        current.state !== 'teacher-active' ||
        next.state !== 'advice-committed' ||
        current.teacher.actionId !== next.teacher.actionId ||
        current.source.actionId !== next.source.actionId ||
        JSON.stringify(current.binding) !== JSON.stringify(next.binding)
      ) {
        return failure(
          'consultation_identity_conflict',
          'Advice settlement does not advance the exact active Teacher consultation.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ConsultationAdviceCommitted',
              consultationId: next.consultationId,
              teacherActionId: next.teacher.actionId!,
              decision: next.teacher.advice!.decision,
            },
          ],
          {
            consultations: {
              ...(record.consultations ?? {}),
              [next.consultationId]: next,
            },
          }
        ),
      };
    }
    case 'fail-consultation-teacher': {
      const current = record.consultations?.[stimulus.consultationId];
      if (
        current === undefined ||
        current.state !== 'teacher-active' ||
        current.teacher.actionId !== stimulus.teacherActionId
      ) {
        return failure(
          'consultation_identity_conflict',
          'Teacher failure must address the exact active consultation attempt.'
        );
      }
      let failed: CommittedConsultation;
      try {
        failed = failTeacherAttempt(current, stimulus.detail);
      } catch (error) {
        return failure(
          'consultation_identity_conflict',
          error instanceof Error ? error.message : 'Invalid Teacher attempt failure.'
        );
      }
      const capacity = reserveTransitionCapacity(record, failed.state === 'unavailable' ? 2 : 1);
      if (capacity !== null) return capacity;
      const transitions: TransitionWithoutOrdinal[] = [
        {
          kind: 'ConsultationTeacherAttemptFailed',
          consultationId: current.consultationId,
          teacherActionId: stimulus.teacherActionId,
          exhausted: failed.state === 'unavailable',
        },
      ];
      if (failed.state === 'unavailable') {
        transitions.push({
          kind: 'ConsultationUnavailable',
          consultationId: failed.consultationId,
          reason: 'teacher-attempt-limit-exhausted',
        });
      }
      const failedTeacherAction = record.actions[stimulus.teacherActionId]!;
      return {
        ok: true,
        record: commit(record, transitions, {
          actions: replaceAction(
            record,
            stimulus.teacherActionId,
            {
              ...failedTeacherAction,
              state: 'blocked',
              deliveryState: 'closed',
            }
          ),
          consultations: {
            ...(record.consultations ?? {}),
            [failed.consultationId]: failed,
          },
        }),
      };
    }
    case 'grant-consultation-continuation': {
      const current = record.consultations?.[stimulus.consultationId];
      if (
        current === undefined ||
        (current.state !== 'advice-committed' && current.state !== 'unavailable')
      ) {
        return failure(
          'consultation_not_active',
          'Continuation grant requires committed advice or bounded unavailability.'
        );
      }
      let granted: ReturnType<typeof grantContinuation>;
      try {
        granted = grantContinuation({ record, consultation: current });
      } catch (error) {
        return failure(
          'consultation_identity_conflict',
          error instanceof Error ? error.message : 'Invalid continuation grant.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ConsultationContinuationGranted',
              consultationId: current.consultationId,
              requestId: granted.grant.requestId,
            },
          ],
          {
            consultations: {
              ...(record.consultations ?? {}),
              [current.consultationId]: granted.consultation,
            },
          }
        ),
      };
    }
    case 'settle-consultation-continuation': {
      const current = record.consultations?.[stimulus.consultationId];
      if (current?.state === 'continued') {
        return current.continuation?.resultDigest === stimulus.resultDigest
          ? { ok: true, record }
          : failure(
              'consultation_identity_conflict',
              'Settled continuation identity conflicts with a different result digest.'
            );
      }
      if (current === undefined) {
        return failure('consultation_not_active', 'Consultation is absent.');
      }
      const source = record.actions[current.source.actionId];
      if (source === undefined || source.state !== 'consultation-paused') {
        return failure(
          'consultation_not_active',
          'Continuation settlement requires the exact paused source Action.'
        );
      }
      let settled: CommittedConsultation;
      try {
        settled = settleContinuation(current, stimulus.resultDigest);
      } catch (error) {
        return failure(
          'consultation_identity_conflict',
          error instanceof Error ? error.message : 'Invalid continuation settlement.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ConsultationContinuationSettled',
              consultationId: current.consultationId,
              requestId: current.continuation!.requestId,
            },
          ],
          {
            actions: replaceAction(record, source.action.actionId, {
              ...source,
              state: 'active',
              deliveryState: 'granted',
            }),
            consultations: {
              ...(record.consultations ?? {}),
              [current.consultationId]: settled,
            },
          }
        ),
      };
    }
    case 'mark-consultation-continuation-ambiguous': {
      const current = record.consultations?.[stimulus.consultationId];
      if (current?.state === 'continuation-outcome-unknown') {
        return { ok: true, record };
      }
      if (current === undefined) {
        return failure('consultation_not_active', 'Consultation is absent.');
      }
      let ambiguous: CommittedConsultation;
      try {
        ambiguous = markContinuationAmbiguous(current, stimulus.detail);
      } catch (error) {
        return failure(
          'consultation_identity_conflict',
          error instanceof Error ? error.message : 'Invalid ambiguous continuation.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'ConsultationContinuationAmbiguous',
              consultationId: current.consultationId,
              requestId: current.continuation!.requestId,
            },
          ],
          {
            consultations: {
              ...(record.consultations ?? {}),
              [current.consultationId]: ambiguous,
            },
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
          ...(stimulus.actor === undefined ? {} : { actor: stimulus.actor }),
          ...(stimulus.actorAttestation === undefined
            ? {}
            : { actorAttestation: stimulus.actorAttestation }),
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
          occurrence: committedActionOccurrence(record, committed),
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
            consultations: closeConsultationsForSource(
              record.consultations,
              stimulus.actionId
            ),
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
    case 'await-human-required': {
      const existing = findWait(record, stimulus.wait.waitId);
      if (existing !== undefined) {
        return existing.kind === 'human-required'
          ? { ok: true, record }
          : failure(
              'wait_identity_conflict',
              'A human-required wait identity conflicts with an existing wait.'
            );
      }
      const source = record.waits.find(
        (wait) =>
          wait.kind === 'domain-blocked' &&
          wait.actionId === stimulus.wait.actionId
      );
      if (source === undefined) {
        return failure(
          'wait_identity_conflict',
          'Human-required suspension requires the exact active domain-blocked wait.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [{ kind: 'RunSuspended', waitId: stimulus.wait.waitId }],
          {
            waits: [
              ...removeWait(record, source.waitId),
              stimulus.wait,
            ],
          }
        ),
      };
    }
    case 'consume-domain-blocked-wait-for-strategy': {
      const wait = findWait(record, stimulus.waitId);
      if (
        wait === undefined ||
        wait.kind !== 'domain-blocked' ||
        wait.actionId !== stimulus.actionId
      ) {
        return failure(
          'wait_identity_conflict',
          'Strategy wait consumption must address the exact active domain-blocked WaitId and ActionId.'
        );
      }
      const source = record.actions[stimulus.actionId];
      if (source?.result?.status !== 'blocked') {
        return failure(
          'illegal_transition',
          'Strategy wait consumption requires a committed blocked domain result.'
        );
      }
      const capacity = reserveTransitionCapacity(record, 1);
      if (capacity !== null) return capacity;
      return {
        ok: true,
        record: commit(
          record,
          [
            {
              kind: 'DomainBlockedWaitConsumedByStrategy',
              waitId: wait.waitId,
              actionId: wait.actionId,
              strategyNodeId: stimulus.strategyNodeId,
              trigger: stimulus.trigger,
            },
          ],
          { waits: removeWait(record, wait.waitId) }
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
        if (committed === undefined) {
          return failure(
            'action_not_active',
            'An action-bound suspension requires an existing Action.'
          );
        }
        // A capability-unavailable wait may bind to an already-closed action.
        // The complex adaptive route case: verify completed with a complex
        // route (action is closed), and the next step's required capability
        // is not available. The wait records the capability gap without
        // re-closing the action.
        const allowClosed = stimulus.wait.kind === 'capability-unavailable';
        if (committed.state !== 'active' && !allowClosed) {
          return failure(
            'action_not_active',
            'An action-bound suspension requires an active Action.'
          );
        }
        if (committed.state === 'active') {
          actions = replaceAction(
            record,
            stimulus.wait.actionId,
            closeActionForWait(committed, stimulus.wait)
          );
        }
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
    case 'decide-human': {
      const wait = findWait(record, stimulus.waitId);
      if (wait === undefined || wait.kind !== 'human-required') {
        return failure(
          'wait_identity_conflict',
          'Human decision must address one exact active human-required WaitId.'
        );
      }
      if (!wait.decisionIds.includes(stimulus.decisionId)) {
        return failure(
          'control_not_allowed',
          'Human decision is not declared by the frozen wait.'
        );
      }
      if (stimulus.evidence.length > record.limits.maxEvidenceRefsPerAction) {
        return terminateAtLimit(record, 'evidence');
      }
      const transitions: readonly TransitionWithoutOrdinal[] = [
        {
          kind: 'HumanDecisionCommitted',
          waitId: wait.waitId,
          actionId: wait.actionId,
          decisionId: stimulus.decisionId,
          outcome: stimulus.outcome,
          evidence: stimulus.evidence.map(
            (item) => item.evidenceDigest as Digest
          ),
        },
      ];
      if (stimulus.decisionId === 'retry') {
        const capacity = reserveTransitionCapacity(record, 1);
        if (capacity !== null) return capacity;
        return {
          ok: true,
          record: commit(record, transitions, {
            waits: removeWait(record, wait.waitId),
          }),
        };
      }
      const capacity = reserveTransitionCapacity(record, 2);
      if (capacity !== null) return capacity;
      const terminal: RunTerminalOutcome = {
        kind: 'escalated',
        code: wait.outcome,
        reason: stimulus.outcome,
      };
      return {
        ok: true,
        record: commit(record, [...transitions, terminalTransition(terminal)], {
          actions: closeCommittedActions(record.actions),
          waits: [],
          terminal,
          status: terminal.kind,
        }),
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
    case 'fail':
      return terminate(record, {
        kind: 'failed',
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
  // the final accumulated values; only the version pointer is re-rooted. A
  // continuation grant created inside the intermediate chain must bind that
  // same collapsed head, not the temporary per-stimulus revision where the
  // grant happened.
  const committedRecordVersion = ((base.recordVersion as number) + 1) as CanonicalRunRecord['recordVersion'];
  const grantedConsultationIds = new Set(
    working.transitions
      .slice(base.transitions.length)
      .filter(
        (transition): transition is Extract<CommittedTransition, { kind: 'ConsultationContinuationGranted' }> =>
          transition.kind === 'ConsultationContinuationGranted'
      )
      .map((transition) => transition.consultationId)
  );
  const consultations =
    working.consultations === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(working.consultations).map(([id, consultation]) => [
            id,
            grantedConsultationIds.has(id) && consultation.continuation !== undefined
              ? {
                  ...consultation,
                  continuation: {
                    ...consultation.continuation,
                    expectedRecordVersion: committedRecordVersion,
                  },
                }
              : consultation,
          ])
        );
  return {
    ok: true,
    record: decodeCanonicalRunRecord({
      ...working,
      recordVersion: committedRecordVersion,
      previousRecordDigest: digestCanonicalRunRecord(base),
      ...(consultations === undefined ? {} : { consultations }),
    }),
  };
}
