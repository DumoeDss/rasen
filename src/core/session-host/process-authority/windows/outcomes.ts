import type {
  AuthorityOperationPhase,
  ProviderControlOutcome,
  ProviderObservation,
} from '../types.js';

export type WindowsNativeInertPhase = 'prepared-inert' | 'published-inert';

/**
 * Windows exit statuses are `DWORD`. `0xC0000005` must reach the common contract
 * as 3221225477 — not as -1073741819 and not truncated. The still-running
 * sentinel `STILL_ACTIVE` (259) is a legitimate exit status and must never be
 * repaired into a live observation.
 */
export const WINDOWS_MAX_EXIT_STATUS = 0xff_ff_ff_ff;
export const WINDOWS_STILL_ACTIVE_SENTINEL = 259;

const RETAINED_STATES = Object.freeze([
  'authority-unavailable',
  'authority-uncertain',
  'identity-drift',
  'event-gap',
] as const);

const DIAGNOSTIC_CODES = new Set([
  // Shared vocabulary, mirroring the sibling provider's closed set.
  'native-state-retained',
  'native-operation-timeout',
  'native-transport-lost',
  'native-unavailable',
  'native-uncertain',
  'identity-drift',
  'event-gap',
  'ledger-unavailable',
  'ledger-conflict',
  'ledger-malformed',
  'ledger-missing',
  'reference-invalid',
  'artifact-unavailable',
  'prepare-unavailable',
  'control-unavailable',
  // Windows authority vocabulary.
  'job-limit-mask-differs',
  'completion-port-associated-late',
  'boot-identity-unobtainable',
  'endpoint-not-first-instance',
  'endpoint-owner-differs',
  'endpoint-server-differs',
  'guardian-birth-identity-differs',
  'guardian-absent-without-record',
  'sole-handle-attestation-absent',
  'post-open-identity-changed',
  'ambient-job-refuses-nesting',
  'state-root-untrusted',
  'terminate-deadline-expired',
]);

export type WindowsAuthorityDiagnosticCode = string;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

export function windowsRetainedDiagnostic(code: string): string {
  return `Windows process authority is retained (${code}).`;
}

function malformed(phase: AuthorityOperationPhase): ProviderObservation {
  return Object.freeze({
    state: 'control-loss',
    phase,
    diagnostic: 'Windows process-authority native outcome is malformed.',
  });
}

/**
 * Exactly one branch of the frozen `root-exited` union is reachable on Windows:
 * `{ code: <unsigned DWORD>, signal: null }`. Windows has no signals, so a
 * result that carries a signal name, carries neither branch, or carries a
 * sign-extended or truncated status is rejected as `control-loss` rather than
 * repaired into a plausible-looking status.
 */
function mapRootExited(
  record: Record<string, unknown>,
  phase: AuthorityOperationPhase
): ProviderObservation {
  const code = record.code;
  const signal = record.signal;
  if (signal !== null) return malformed(phase);
  if (
    typeof code !== 'number' ||
    !Number.isSafeInteger(code) ||
    code < 0 ||
    code > WINDOWS_MAX_EXIT_STATUS
  ) {
    return malformed(phase);
  }
  return Object.freeze({ state: 'root-exited', code, signal: null });
}

function mapClosedOutcome(
  value: unknown,
  inertPhase: WindowsNativeInertPhase | undefined,
  phase: AuthorityOperationPhase,
  allowInert: boolean
): ProviderObservation | ProviderControlOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return malformed(phase);
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (state === 'inert' && allowInert && inertPhase && exactKeys(record, ['state'])) {
    return Object.freeze({ state: inertPhase });
  }
  if (
    (state === 'live' || state === 'exact-scope-empty') &&
    exactKeys(record, ['state'])
  ) {
    return Object.freeze({ state });
  }
  if (state === 'root-exited' && exactKeys(record, ['state', 'code', 'signal'])) {
    return mapRootExited(record, phase);
  }
  if (
    typeof state === 'string' &&
    RETAINED_STATES.includes(state as (typeof RETAINED_STATES)[number]) &&
    exactKeys(record, ['state', 'diagnosticCode']) &&
    typeof record.diagnosticCode === 'string' &&
    DIAGNOSTIC_CODES.has(record.diagnosticCode)
  ) {
    return Object.freeze({
      state: state as (typeof RETAINED_STATES)[number],
      diagnostic: windowsRetainedDiagnostic(record.diagnosticCode),
    });
  }
  if (
    (state === 'timeout' || state === 'control-loss') &&
    exactKeys(record, ['state', 'diagnosticCode']) &&
    typeof record.diagnosticCode === 'string' &&
    DIAGNOSTIC_CODES.has(record.diagnosticCode)
  ) {
    return Object.freeze({
      state,
      phase,
      diagnostic: windowsRetainedDiagnostic(record.diagnosticCode),
    });
  }
  return malformed(phase);
}

export function mapWindowsNativeObservation(
  value: unknown,
  inertPhase: WindowsNativeInertPhase,
  phase: AuthorityOperationPhase
): ProviderObservation {
  return mapClosedOutcome(value, inertPhase, phase, true) as ProviderObservation;
}

export function mapWindowsNativeControlOutcome(
  value: unknown,
  phase: AuthorityOperationPhase
): ProviderControlOutcome {
  return mapClosedOutcome(value, undefined, phase, false) as ProviderControlOutcome;
}

export function isWindowsAuthorityDiagnosticCode(value: string): boolean {
  return DIAGNOSTIC_CODES.has(value);
}
