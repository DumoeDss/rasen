export const HOST_REGISTRY_SCHEMA = 'rasen-session-host-registry/2' as const;
export const LEGACY_HOST_REGISTRY_SCHEMA = 'rasen-session-host-registry/1' as const;
export const HOST_EVENT_SCHEMA = 'rasen-session-host-event/1' as const;

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

export type SessionHostCommand =
  | {
      op: 'execute';
      requestId: string;
      sessionId?: string;
      backend: string;
      cwd: string;
      input: string;
      limits: TurnLimits;
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
      replayed?: boolean;
    }
  | {
      ok: false;
      op: SessionHostCommand['op'];
      code: SessionHostFailureCode;
      message: string;
      session?: SessionHostView;
      requestId?: string;
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
      'backend',
      'cwd',
      'input',
      'limits',
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
    if (typeof command.backend !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(command.backend)) {
      return invalid('backend must be a named backend id.');
    }
    if (typeof command.cwd !== 'string' || command.cwd.length === 0) {
      return invalid('cwd must be a non-empty path.');
    }
    if (typeof command.input !== 'string' || command.input.length === 0) {
      return invalid('input must be a non-empty string.');
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
