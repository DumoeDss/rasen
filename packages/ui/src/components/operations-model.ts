import type {
  ReconcilerRunSummary,
  SessionListEntry,
  SessionRecordWire,
  StoreChangeIssueLinkEntry,
} from '../api/types.js';

export type SessionPresentationGroup = 'active' | 'abnormal' | 'settled';

export interface SessionClassification {
  readonly groups: readonly SessionPresentationGroup[];
  readonly abnormal: boolean;
}

const ACTIVE_SESSION_STATES: readonly SessionRecordWire['state'][] = [
  'starting',
  'running',
  'exiting',
];

/** Closed presentation classification; no lifecycle fact is persisted. */
export function classifySession(entry: SessionListEntry): SessionClassification {
  const { session, runState } = entry;
  const joinedFailure =
    runState.kind === 'error' ||
    (runState.kind === 'ok' &&
      [runState.autoRun, runState.portfolio, runState.goalRun].some(read => read.kind === 'invalid'));
  const exitedFailure =
    session.state === 'exited' &&
    (session.terminationReason !== 'exit' ||
      (session.exitCode !== undefined && session.exitCode !== null && session.exitCode !== 0));
  const abnormal = joinedFailure || exitedFailure;
  const groups: SessionPresentationGroup[] = [];
  if (ACTIVE_SESSION_STATES.includes(session.state)) groups.push('active');
  if (abnormal) groups.push('abnormal');
  if (session.state === 'exited' && !abnormal) groups.push('settled');
  return { groups, abnormal };
}

export type ChangeAttribution =
  | {
      readonly kind: 'exact';
      readonly entry: StoreChangeIssueLinkEntry;
    }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly StoreChangeIssueLinkEntry[];
    }
  | {
      readonly kind: 'unavailable';
      readonly reason:
        | 'change-name-missing'
        | 'planning-only'
        | 'legacy-execution'
        | 'no-match'
        | 'identity-missing';
    };

export function attributeChange(
  input: { readonly projectId: string; readonly changeId: string },
  entries: readonly StoreChangeIssueLinkEntry[]
): ChangeAttribution {
  const candidates = entries.filter(
    entry =>
      entry.occurrence.change.projectId === input.projectId &&
      entry.occurrence.change.changeId === input.changeId
  );
  if (candidates.length === 0) return { kind: 'unavailable', reason: 'no-match' };
  if (
    candidates.length > 1 ||
    candidates.some(entry => entry.eligibility === 'identity-ambiguous')
  ) {
    return { kind: 'ambiguous', candidates };
  }
  const entry = candidates[0]!;
  if (entry.occurrence.change.changeInstanceId === null) {
    return { kind: 'unavailable', reason: 'identity-missing' };
  }
  return { kind: 'exact', entry };
}

/** Session attribution uses frozen execution identity only; cwd is never read. */
export function attributeSessionChange(
  session: SessionRecordWire,
  entries: readonly StoreChangeIssueLinkEntry[]
): ChangeAttribution {
  if (!session.changeName) return { kind: 'unavailable', reason: 'change-name-missing' };
  if (session.execution === undefined) return { kind: 'unavailable', reason: 'legacy-execution' };
  if (session.execution.kind === 'planning-only') {
    return { kind: 'unavailable', reason: 'planning-only' };
  }
  return attributeChange(
    {
      projectId: session.execution.projectId,
      changeId: session.changeName,
    },
    entries
  );
}

/** A Run is attributed by the exact member selector that returned it. */
export function attributeRunChange(
  run: ReconcilerRunSummary,
  projectId: string,
  entries: readonly StoreChangeIssueLinkEntry[]
): ChangeAttribution {
  return attributeChange({ projectId, changeId: run.changeId }, entries);
}
