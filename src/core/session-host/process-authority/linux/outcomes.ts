import type {
  AuthorityOperationPhase,
  ProviderControlOutcome,
  ProviderObservation,
} from '../types.js';

export type LinuxNativeInertPhase = 'prepared-inert' | 'published-inert';

const RETAINED_STATES = Object.freeze([
  'authority-unavailable',
  'authority-uncertain',
  'identity-drift',
  'event-gap',
] as const);

const DIAGNOSTIC_CODES = new Set([
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
]);
const LINUX_SIGNAL_NAMES = new Set([
  'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS',
  'SIGFPE', 'SIGKILL', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGPIPE', 'SIGALRM',
  'SIGTERM', 'SIGSTKFLT', 'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP',
  'SIGTTIN', 'SIGTTOU', 'SIGURG', 'SIGXCPU', 'SIGXFSZ', 'SIGVTALRM',
  'SIGPROF', 'SIGWINCH', 'SIGIO', 'SIGPWR', 'SIGSYS',
]);

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function diagnostic(code: string): string {
  return `Linux process authority is retained (${code}).`;
}

function malformed(phase: AuthorityOperationPhase): ProviderObservation {
  return Object.freeze({
    state: 'control-loss',
    phase,
    diagnostic: 'Linux process-authority native outcome is malformed.',
  });
}

function mapClosedOutcome(
  value: unknown,
  inertPhase: LinuxNativeInertPhase | undefined,
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
    const code = record.code;
    const signal = record.signal;
    const codeBranch = Number.isSafeInteger(code) &&
      Number(code) >= 0 &&
      Number(code) <= 255 &&
      signal === null;
    const signalBranch = code === null &&
      typeof signal === 'string' &&
      LINUX_SIGNAL_NAMES.has(signal);
    if (codeBranch) return Object.freeze({ state, code: code as number, signal: null });
    if (signalBranch) return Object.freeze({ state, code: null, signal: signal as string });
    return malformed(phase);
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
      diagnostic: diagnostic(record.diagnosticCode),
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
      diagnostic: diagnostic(record.diagnosticCode),
    });
  }
  return malformed(phase);
}

export function mapLinuxNativeObservation(
  value: unknown,
  inertPhase: LinuxNativeInertPhase,
  phase: AuthorityOperationPhase
): ProviderObservation {
  return mapClosedOutcome(value, inertPhase, phase, true) as ProviderObservation;
}

export function mapLinuxNativeControlOutcome(
  value: unknown,
  phase: AuthorityOperationPhase
): ProviderControlOutcome {
  return mapClosedOutcome(value, undefined, phase, false) as ProviderControlOutcome;
}
