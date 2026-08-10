import type { ExactScopeEmptyReceipt } from './process-authority/coordinator.js';

export const HOST_REGISTRY_SCHEMA = 'rasen-session-host-registry/2' as const;
export const LEGACY_HOST_REGISTRY_SCHEMA = 'rasen-session-host-registry/1' as const;
export const HOST_EVENT_SCHEMA = 'rasen-session-host-event/1' as const;
export const EXACT_TEACHER_SESSION_ATTEMPT_SCHEMA =
  'rasen-exact-teacher-session-attempt/1' as const;

export const EXACT_TEACHER_ATTEMPT_PHASES = Object.freeze([
  'canonical-preflight',
  'baseline-stable',
  'authority-prepared-inert',
  'authority-published-inert',
  'activated',
  'request-sent',
  'result-quarantined',
  'hosted-receipt-verified',
  'retirement-pending',
  'exact-scope-empty',
  'final-observation-stable',
  'advice-validated',
  'canonical-settled',
] as const);

export type ExactTeacherAttemptPhase = (typeof EXACT_TEACHER_ATTEMPT_PHASES)[number];

export interface ExactTeacherProviderTuple {
  readonly providerId: string;
  readonly capabilityId: string;
  readonly protocolVersion: number;
}

export interface ExactTeacherHostedReceiptIdentity {
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly resultRef: string;
  readonly resultDigest: string;
}

/**
 * Domain-owned restart facts for the dedicated exact Teacher lane. The full
 * ProcessRef is durable control authority, so this value is intentionally
 * retained in the private registry Record and omitted from SessionHostView.
 */
export interface ExactTeacherSessionAttemptFacts {
  readonly schema: typeof EXACT_TEACHER_SESSION_ATTEMPT_SCHEMA;
  readonly recordVersion: 1;
  readonly attemptId: string;
  readonly provider: ExactTeacherProviderTuple;
  readonly processRef: string;
  readonly runId: string;
  readonly actionId: string;
  readonly invocationId: string;
  readonly attempt: number;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly journalRevision: number;
  readonly phase: ExactTeacherAttemptPhase;
  readonly baselineIdentity?: string;
  readonly hostedReceipt?: ExactTeacherHostedReceiptIdentity;
  readonly quarantineIdentity?: string;
}

export interface ExactTeacherAttemptSeed {
  readonly attemptId: string;
  readonly provider: ExactTeacherProviderTuple;
  readonly runId: string;
  readonly actionId: string;
  readonly invocationId: string;
  readonly attempt: number;
  readonly stableSessionId: string;
  readonly requestId: string;
}

export interface ExactTeacherAttemptPhaseCommit {
  readonly processRef?: string;
  readonly baselineIdentity?: string;
  readonly hostedReceipt?: ExactTeacherHostedReceiptIdentity;
  readonly quarantineIdentity?: string;
  /** Host-only: journal first, then project atomically with process facts. */
  readonly deferSessionProjection?: boolean;
}

export interface ExactTeacherAttemptPhaseCommitter {
  commit(
    seed: ExactTeacherAttemptSeed,
    phase: ExactTeacherAttemptPhase,
    facts?: ExactTeacherAttemptPhaseCommit
  ): Promise<void>;
  load(attemptId: string): ExactTeacherSessionAttemptFacts | undefined;
  loadRecovery(
    attemptId: string
  ): Promise<ExactTeacherAttemptRecoverySnapshot | undefined>;
}

export type ExactTeacherAttemptRecoveryLoadFailureReason =
  | 'authority-identity-mismatch'
  | 'durable-frontier-conflict'
  | 'durable-journal-malformed'
  | 'durable-session-state-unavailable';

/**
 * Bounded fail-closed result from joining the two private durable recovery
 * stores. It intentionally carries no underlying diagnostic or authority
 * facts because the Module may summarize the reason for a public caller.
 */
export class ExactTeacherAttemptRecoveryLoadError extends Error {
  readonly reason: ExactTeacherAttemptRecoveryLoadFailureReason;

  constructor(reason: ExactTeacherAttemptRecoveryLoadFailureReason) {
    super(`Exact Teacher durable recovery retained: ${reason}.`);
    this.name = 'ExactTeacherAttemptRecoveryLoadError';
    this.reason = reason;
  }
}

/** Private restart-union snapshot; never projected through SessionHostView. */
export interface ExactTeacherAttemptRecoverySnapshot {
  readonly journal: Readonly<{
    schema: 'rasen-exact-teacher-attempt-journal/1';
    recordVersion: 1;
    revision: number;
    attemptId: string;
    provider: ExactTeacherProviderTuple;
    processRef?: string;
    runId: string;
    actionId: string;
    invocationId: string;
    attempt: number;
    stableSessionId: string;
    requestId: string;
    baselineIdentity?: string;
    hostedReceipt?: ExactTeacherHostedReceiptIdentity;
    quarantineIdentity?: string;
    phase: ExactTeacherAttemptPhase;
  }>;
  readonly session?: HostedSessionRecord;
}

export const HOST_FAILURE_CODES = [
  'invalid-input',
  'unsupported-backend',
  'session-not-found',
  'session-busy',
  'session-retired',
  'session-failed',
  'cwd-mismatch',
  'cwd-unavailable',
  'stale-generation',
  'registry-busy',
  'registry-corrupt',
  'backend-protocol-unsupported',
  'backend-protocol-failed',
  'backend-spawn-failed',
  'backend-output-limit',
  'backend-timeout',
  'turn-outcome-unknown',
] as const;

export type SessionHostFailureCode = (typeof HOST_FAILURE_CODES)[number];

export type HostedSessionState =
  | 'starting'
  | 'idle'
  | 'active'
  | 'cancelling'
  | 'interrupted'
  | 'recovering'
  | 'failed'
  | 'retiring'
  | 'retired';

export type CompatibleSessionState =
  | 'starting'
  | 'running'
  | 'exiting'
  | 'exited';

export type HostedRequestState =
  | 'prepared'
  | 'sent'
  | 'settled'
  | 'cancelled'
  | 'ambiguous';

export type HostedSessionSandbox = 'read-only' | 'workspace-write';

/**
 * Server-resolved reuse authority. It is persisted on first admission and
 * must match every subsequent turn addressed to the stable Session.
 */
export interface HostedSessionAuthority {
  invocationId: string;
  role: string;
  workspaceInstanceId: string;
  backend: 'hosted';
  handoffTokensUsed: number;
  reuseRoundsServed: number;
}

export interface HostedRequestRecord {
  requestId: string;
  inputDigest: string;
  generation: number;
  state: HostedRequestState;
  preparedAt: string;
  sentAt?: string;
  settledAt?: string;
  resultDigest?: string;
  resultRef?: string;
  diagnostic?: string;
}

/**
 * Best-effort tier limits, recorded before activation so an operator sees them
 * before any workload code runs. Absence means the exact tier.
 */
export interface HostedProcessDeclaration {
  tier: 'best-effort';
  exactCancel: false;
  scopeEmptyProof: false;
}

export type HostedProcessTerminalOutcome = 'cancelled' | 'completed' | 'never-activated';

/**
 * Permanent honest terminal of a declared best-effort scope. Release never
 * rewrites it into a clean or proven-empty outcome.
 */
export interface HostedProcessTerminal {
  outcome: HostedProcessTerminalOutcome;
  emptiness: 'unproven';
  /** Human-readable Record surface, e.g. "cancelled / emptiness-unproven". */
  label: string;
  /** Diagnostic detail only; never scope-emptiness proof. */
  groupObservedEmpty: boolean;
  forced: boolean;
  recordedAt: string;
}

export interface HostedProcessFacts {
  generation: number;
  ownerToken: string;
  /** Opaque ProcessScope capability. Host code never decodes this value. */
  runtimeRef: string;
  /** Optional observation only; never accepted by a control method. */
  displayPid?: number;
  preparedAt: string;
  /** Present only for a declared best-effort scope; written before activation. */
  declaration?: HostedProcessDeclaration;
}

export interface HostedSessionRecord {
  sessionId: string;
  backend: string;
  backendVersion?: string;
  backendSessionId?: string;
  cwd: string;
  cwdDigest: string;
  /** Frozen server-owned turn bounds for this stable Session. */
  turnLimits?: TurnLimits;
  /** Defaults to workspace-write only when decoding a pre-authority record. */
  sandbox?: HostedSessionSandbox;
  /** Absent only for legacy/generic hosted-session callers. */
  authority?: HostedSessionAuthority;
  hostState: HostedSessionState;
  generation: number;
  /** Monotonic lifecycle CAS, independent of backend process generation. */
  revision?: number;
  createdAt: string;
  updatedAt: string;
  requests: HostedRequestRecord[];
  /**
   * Fixed-size, monotonic Bloom tombstone for terminal request ids removed
   * from the detailed retention window. A hit is treated as outcome-unknown;
   * false positives are safe refusals and settled ids have no false negatives.
   */
  prunedRequestFilter?: string;
  process?: HostedProcessFacts;
  /** Private restart-union facts for the separate exact Teacher host only. */
  exactTeacherAttempt?: ExactTeacherSessionAttemptFacts;
  /**
   * Survives the clearing of `process`: the honest terminal a declared
   * best-effort scope reached, kept permanently on the released record.
   */
  processTerminal?: HostedProcessTerminal;
  recoveryReason?: string;
  retirementReason?: string;
}

export interface SessionHostView {
  sessionId: string;
  backend: string;
  backendVersion?: string;
  backendSessionId?: string;
  cwd: string;
  /** Digest of the registry-owned canonical cwd, used for authority correlation. */
  cwdDigest: string;
  /** Present for Sessions created by a runtime that freezes hosted bounds. */
  turnLimits?: TurnLimits;
  sandbox: HostedSessionSandbox;
  authority?: HostedSessionAuthority;
  hostState: HostedSessionState;
  state: CompatibleSessionState;
  generation: number;
  pid?: number;
  currentRequest?: Pick<
    HostedRequestRecord,
    'requestId' | 'state' | 'generation' | 'resultDigest' | 'resultRef'
  >;
  /** Visible before the workload starts when the scope declares its limits. */
  processDeclaration?: HostedProcessDeclaration;
  /** The honest terminal an operator reads; never a clean-cancel claim. */
  processTerminal?: HostedProcessTerminal;
  recoveryReason?: string;
  retirementReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TurnLimits {
  /** Compatibility/default overall clock. */
  timeoutMs: number;
  initTimeoutMs?: number;
  noOutputTimeoutMs?: number;
  overallTimeoutMs?: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxLineBytes?: number;
  maxDiagnosticBytes?: number;
}

/**
 * Durable, server-minted evidence for one hosted execute request. Verification
 * always re-reads the registry and the content-addressed result store; this
 * object is not self-authorizing merely because a caller can serialize it.
 */
export interface HostedTurnReceipt {
  readonly format: 'rasen-session-host-turn-receipt/1';
  readonly stableSessionId: string;
  readonly backend: string;
  readonly backendSessionId?: string;
  readonly requestId: string;
  readonly requestState: HostedRequestState;
  readonly cwd: string;
  readonly cwdDigest: string;
  readonly sandbox: HostedSessionSandbox;
  readonly authority?: HostedSessionAuthority;
  readonly resultRef?: string;
  readonly resultDigest?: string;
  readonly result?: string;
  readonly replayed: boolean;
}

export type SessionHostCommand =
  | {
      op: 'execute';
      requestId: string;
      sessionId?: string;
      /**
       * Server-derived stable identity for a fresh frozen Action. Unlike
       * `sessionId`, this may create the Session when absent and reopens the
       * same durable Session when the Action grant is recovered.
       */
      newSessionId?: string;
      backend: string;
      cwd: string;
      input: string;
      limits: TurnLimits;
      /** Frozen by the server from the granted Action, never from worker output. */
      sandbox?: HostedSessionSandbox;
      /** Frozen by the server from canonical Run/Action authority. */
      authority?: Omit<HostedSessionAuthority, 'handoffTokensUsed' | 'reuseRoundsServed'>;
      /** Server-computed continuation handoff usage added after settlement. */
      handoffTokens?: number;
      /** Dedicated exact-Teacher Module coordination; never accepted from HTTP. */
      exactTeacherAttempt?: Readonly<{
        mode: 'prepare-only' | 'send-prepared';
        seed: ExactTeacherAttemptSeed;
      }>;
    }
  | { op: 'cancel'; sessionId: string; reason: string }
  | { op: 'restart'; sessionId: string }
  | { op: 'retire'; sessionId: string; reason: string };

export type SessionHostOutcome =
  | {
      ok: true;
      op: SessionHostCommand['op'];
      session: SessionHostView;
      requestId?: string;
      result?: string;
      resultDigest?: string;
      resultRef?: string;
      receipt?: HostedTurnReceipt;
      /** Trusted exact-Teacher callers only; never projected by SessionHostView. */
      exactScopeEmptyReceipt?: ExactScopeEmptyReceipt;
      replayed?: boolean;
    }
  | {
      ok: false;
      op: SessionHostCommand['op'];
      code: SessionHostFailureCode;
      message: string;
      session?: SessionHostView;
      requestId?: string;
      receipt?: HostedTurnReceipt;
    };

export interface SessionRecoveryReport {
  ready: boolean;
  inspected: number;
  recovered: number;
  interrupted: number;
  failed: number;
  diagnostics: string[];
}

export interface SessionHostFilter {
  backend?: string;
  state?: HostedSessionState;
}

export interface SessionHost {
  dispatch(command: SessionHostCommand): Promise<SessionHostOutcome>;
  inspect(sessionId: string): SessionHostView | undefined;
  list(filter?: SessionHostFilter): SessionHostView[];
  /** Verify a receipt against durable registry facts and CAS result bytes. */
  verifyTurnReceipt(receipt: HostedTurnReceipt): boolean;
  reconcileOnStart(): Promise<SessionRecoveryReport>;
  shutdown(reason: 'daemon-stop' | 'server-shutdown'): Promise<void>;
}

const TRANSITIONS: Readonly<Record<HostedSessionState, readonly HostedSessionState[]>> = {
  starting: ['idle', 'active', 'failed', 'retiring'],
  idle: ['active', 'recovering', 'retiring'],
  active: ['idle', 'cancelling', 'interrupted', 'failed', 'retiring'],
  cancelling: ['idle', 'interrupted', 'failed', 'retiring'],
  interrupted: ['recovering', 'retiring', 'failed'],
  recovering: ['idle', 'active', 'interrupted', 'failed', 'retiring'],
  failed: ['retiring'],
  retiring: ['retired'],
  retired: [],
};

export function canTransitionHostedSession(
  from: HostedSessionState,
  to: HostedSessionState
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function projectHostedCompatibilityState(
  state: HostedSessionState
): CompatibleSessionState {
  if (state === 'starting') return 'starting';
  if (state === 'cancelling' || state === 'retiring') return 'exiting';
  if (state === 'failed' || state === 'retired') return 'exited';
  return 'running';
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TURN_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_TURN_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_TURN_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TURN_LINE_BYTES = 1024 * 1024;
const MAX_TURN_DIAGNOSTIC_BYTES = 64 * 1024;

export type SessionHostCommandValidation =
  | { ok: true; command: SessionHostCommand }
  | { ok: false; code: 'invalid-input'; message: string };

function invalid(message: string): SessionHostCommandValidation {
  return { ok: false, code: 'invalid-input', message };
}

export function validateSessionHostCommand(
  value: unknown
): SessionHostCommandValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Session host command must be an object.');
  }
  const command = value as Record<string, unknown>;
  if (command.op === 'execute') {
    const allowed = new Set([
      'op',
      'requestId',
      'sessionId',
      'newSessionId',
      'backend',
      'cwd',
      'input',
      'limits',
      'sandbox',
      'authority',
      'handoffTokens',
      'exactTeacherAttempt',
    ]);
    if (Object.keys(command).some((key) => !allowed.has(key))) {
      return invalid('Execute command contains an unsupported field.');
    }
    if (typeof command.requestId !== 'string' || !UUID_PATTERN.test(command.requestId)) {
      return invalid('requestId must be a UUID.');
    }
    if (
      command.sessionId !== undefined &&
      (typeof command.sessionId !== 'string' || !UUID_PATTERN.test(command.sessionId))
    ) {
      return invalid('sessionId must be a UUID when provided.');
    }
    if (
      command.newSessionId !== undefined &&
      (typeof command.newSessionId !== 'string' ||
        !UUID_PATTERN.test(command.newSessionId))
    ) {
      return invalid('newSessionId must be a UUID when provided.');
    }
    if (command.sessionId !== undefined && command.newSessionId !== undefined) {
      return invalid('sessionId and newSessionId are mutually exclusive.');
    }
    if (typeof command.backend !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(command.backend)) {
      return invalid('backend must be a named backend id.');
    }
    if (typeof command.cwd !== 'string' || command.cwd.length === 0) {
      return invalid('cwd must be a non-empty path.');
    }
    if (typeof command.input !== 'string' || command.input.length === 0) {
      return invalid('input must be a non-empty string.');
    }
    if (
      command.sandbox !== undefined &&
      command.sandbox !== 'read-only' &&
      command.sandbox !== 'workspace-write'
    ) {
      return invalid('sandbox must be read-only or workspace-write.');
    }
    if (command.authority !== undefined) {
      const authority = command.authority as Record<string, unknown>;
      const allowedAuthorityKeys = new Set([
        'invocationId',
        'role',
        'workspaceInstanceId',
        'backend',
      ]);
      if (
        typeof authority !== 'object' ||
        authority === null ||
        Array.isArray(authority) ||
        Object.keys(authority).some((key) => !allowedAuthorityKeys.has(key)) ||
        typeof authority.invocationId !== 'string' ||
        authority.invocationId.length === 0 ||
        typeof authority.role !== 'string' ||
        authority.role.length === 0 ||
        typeof authority.workspaceInstanceId !== 'string' ||
        authority.workspaceInstanceId.length === 0 ||
        authority.backend !== 'hosted'
      ) {
        return invalid('authority must be the exact hosted invocation/role/workspace tuple.');
      }
    }
    if (
      command.handoffTokens !== undefined &&
      (!Number.isSafeInteger(command.handoffTokens) || Number(command.handoffTokens) < 0)
    ) {
      return invalid('handoffTokens must be a non-negative safe integer.');
    }
    if (command.exactTeacherAttempt !== undefined) {
      const control = command.exactTeacherAttempt as Record<string, unknown>;
      const seed = control.seed as Record<string, unknown> | undefined;
      const provider = seed?.provider as Record<string, unknown> | undefined;
      const allowedControl = new Set(['mode', 'seed']);
      const allowedSeed = new Set([
        'attemptId',
        'provider',
        'runId',
        'actionId',
        'invocationId',
        'attempt',
        'stableSessionId',
        'requestId',
      ]);
      const allowedProvider = new Set([
        'providerId',
        'capabilityId',
        'protocolVersion',
      ]);
      if (
        typeof control !== 'object' ||
        control === null ||
        Array.isArray(control) ||
        Object.keys(control).some((key) => !allowedControl.has(key)) ||
        (control.mode !== 'prepare-only' && control.mode !== 'send-prepared') ||
        typeof seed !== 'object' ||
        seed === null ||
        Array.isArray(seed) ||
        Object.keys(seed).some((key) => !allowedSeed.has(key)) ||
        typeof seed.attemptId !== 'string' ||
        seed.attemptId.length === 0 ||
        typeof seed.runId !== 'string' ||
        seed.runId.length === 0 ||
        typeof seed.actionId !== 'string' ||
        seed.actionId.length === 0 ||
        typeof seed.invocationId !== 'string' ||
        seed.invocationId.length === 0 ||
        !Number.isSafeInteger(seed.attempt) ||
        Number(seed.attempt) <= 0 ||
        seed.stableSessionId !== command.newSessionId &&
          seed.stableSessionId !== command.sessionId ||
        seed.requestId !== command.requestId ||
        typeof provider !== 'object' ||
        provider === null ||
        Array.isArray(provider) ||
        Object.keys(provider).some((key) => !allowedProvider.has(key)) ||
        typeof provider.providerId !== 'string' ||
        provider.providerId.length === 0 ||
        typeof provider.capabilityId !== 'string' ||
        provider.capabilityId.length === 0 ||
        !Number.isSafeInteger(provider.protocolVersion) ||
        Number(provider.protocolVersion) <= 0
      ) {
        return invalid('exactTeacherAttempt must be one exact server-derived attempt seed.');
      }
    }
    const limits = command.limits as Record<string, unknown> | undefined;
    const allowedLimitKeys = new Set([
      'timeoutMs',
      'initTimeoutMs',
      'noOutputTimeoutMs',
      'overallTimeoutMs',
      'maxInputBytes',
      'maxOutputBytes',
      'maxLineBytes',
      'maxDiagnosticBytes',
    ]);
    if (
      !limits ||
      typeof limits !== 'object' ||
      Array.isArray(limits) ||
      Object.keys(limits).some((key) => !allowedLimitKeys.has(key)) ||
      !['timeoutMs', 'maxInputBytes', 'maxOutputBytes'].every(
        (key) => Number.isInteger(limits[key]) && Number(limits[key]) > 0
      )
    ) {
      return invalid('limits must contain positive timeout/input/output bounds.');
    }
    if (
      Number(limits.timeoutMs) > MAX_TURN_TIMEOUT_MS ||
      (limits.initTimeoutMs !== undefined &&
        (!Number.isInteger(limits.initTimeoutMs) ||
          Number(limits.initTimeoutMs) <= 0 ||
          Number(limits.initTimeoutMs) > MAX_TURN_TIMEOUT_MS)) ||
      (limits.noOutputTimeoutMs !== undefined &&
        (!Number.isInteger(limits.noOutputTimeoutMs) ||
          Number(limits.noOutputTimeoutMs) <= 0 ||
          Number(limits.noOutputTimeoutMs) > MAX_TURN_TIMEOUT_MS)) ||
      (limits.overallTimeoutMs !== undefined &&
        (!Number.isInteger(limits.overallTimeoutMs) ||
          Number(limits.overallTimeoutMs) <= 0 ||
          Number(limits.overallTimeoutMs) > MAX_TURN_TIMEOUT_MS)) ||
      Number(limits.maxInputBytes) > MAX_TURN_INPUT_BYTES ||
      Number(limits.maxOutputBytes) > MAX_TURN_OUTPUT_BYTES ||
      (limits.maxLineBytes !== undefined &&
        (!Number.isInteger(limits.maxLineBytes) ||
          Number(limits.maxLineBytes) <= 0 ||
          Number(limits.maxLineBytes) > MAX_TURN_LINE_BYTES)) ||
      (limits.maxDiagnosticBytes !== undefined &&
        (!Number.isInteger(limits.maxDiagnosticBytes) ||
          Number(limits.maxDiagnosticBytes) <= 0 ||
          Number(limits.maxDiagnosticBytes) > MAX_TURN_DIAGNOSTIC_BYTES))
    ) {
      return invalid('limits exceed the server-owned hosted Session bounds.');
    }
    if (Buffer.byteLength(command.input, 'utf8') > Number(limits.maxInputBytes)) {
      return invalid('input exceeds maxInputBytes.');
    }
    return { ok: true, command: command as unknown as SessionHostCommand };
  }
  if (command.op === 'cancel' || command.op === 'retire') {
    if (Object.keys(command).some((key) => !['op', 'sessionId', 'reason'].includes(key))) {
      return invalid(`${command.op} command contains an unsupported field.`);
    }
    if (typeof command.sessionId !== 'string' || !UUID_PATTERN.test(command.sessionId)) {
      return invalid('sessionId must be a UUID.');
    }
    if (
      typeof command.reason !== 'string' ||
      command.reason.trim().length === 0 ||
      Buffer.byteLength(command.reason, 'utf8') > 256
    ) {
      return invalid('reason must be non-empty.');
    }
    return { ok: true, command: command as unknown as SessionHostCommand };
  }
  if (command.op === 'restart') {
    if (Object.keys(command).some((key) => !['op', 'sessionId'].includes(key))) {
      return invalid('restart command contains an unsupported field.');
    }
    if (typeof command.sessionId !== 'string' || !UUID_PATTERN.test(command.sessionId)) {
      return invalid('sessionId must be a UUID.');
    }
    return { ok: true, command: command as unknown as SessionHostCommand };
  }
  return invalid('Unsupported Session host operation.');
}

const SENSITIVE_ASSIGNMENT =
  /\b(token|secret|password|authorization|credential|private[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi;

export function sanitizeHostDiagnostic(value: string, maxBytes = 1024): string {
  const redacted = value.replace(SENSITIVE_ASSIGNMENT, '$1=[REDACTED]');
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.byteLength <= maxBytes) return redacted;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

export function toSessionHostView(record: HostedSessionRecord): SessionHostView {
  const current = [...record.requests]
    .reverse()
    .find((request) =>
      ['prepared', 'sent', 'ambiguous', 'cancelled', 'settled'].includes(request.state)
    );
  return {
    sessionId: record.sessionId,
    backend: record.backend,
    ...(record.backendVersion ? { backendVersion: record.backendVersion } : {}),
    ...(record.backendSessionId ? { backendSessionId: record.backendSessionId } : {}),
    cwd: record.cwd,
    cwdDigest: record.cwdDigest,
    ...(record.turnLimits ? { turnLimits: { ...record.turnLimits } } : {}),
    sandbox: record.sandbox ?? 'workspace-write',
    ...(record.authority ? { authority: { ...record.authority } } : {}),
    hostState: record.hostState,
    state: projectHostedCompatibilityState(record.hostState),
    generation: record.generation,
    ...(record.process?.displayPid ? { pid: record.process.displayPid } : {}),
    ...(current
      ? {
          currentRequest: {
            requestId: current.requestId,
            state: current.state,
            generation: current.generation,
            ...(current.resultDigest ? { resultDigest: current.resultDigest } : {}),
            ...(current.resultRef ? { resultRef: current.resultRef } : {}),
          },
        }
      : {}),
    ...(record.process?.declaration
      ? { processDeclaration: { ...record.process.declaration } }
      : {}),
    ...(record.processTerminal ? { processTerminal: { ...record.processTerminal } } : {}),
    ...(record.recoveryReason ? { recoveryReason: record.recoveryReason } : {}),
    ...(record.retirementReason ? { retirementReason: record.retirementReason } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
