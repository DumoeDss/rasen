import type { WindowsPrivateAuthorityReference } from './private-reference.js';

/**
 * The provider drives the reopen sequence itself, so it needs the identity tuple
 * at two distinct instants. `pre-open` is read before any handle exists;
 * `post-open` is read after every handle is open. Requiring the complete tuple
 * to be unchanged across the pair is what closes the window in which the
 * referenced process exits between lookup and use and a new process takes its
 * identifier.
 */
export type WindowsIdentityProbeStage = 'pre-open' | 'post-open';

export interface WindowsAuthorityTerminalRecord {
  readonly outcome: 'exact-scope-empty';
  readonly scopeId: string;
  readonly generation: string;
  readonly bootIdentity: string;
  readonly soleHandleAttestation: string;
}

export type WindowsAuthorityIdentityProbe =
  | {
      readonly state: 'authority-present';
      readonly bootIdentity: string;
      readonly guardianProcessId: number;
      readonly guardianCreationTime: string;
      readonly endpointServerProcessId: number;
      readonly endpointOwnerSid: string;
      readonly endpointAuthentication: 'authenticated' | 'rejected';
      readonly soleHandleAttestation: string;
    }
  | {
      readonly state: 'authority-absent';
      readonly bootIdentity: string;
      readonly endpointPresent: boolean;
      /**
       * Non-null only when the trusted state root still carries the attestation
       * the guardian wrote at prepare. Null means the last-handle inference has
       * no proof behind it, and the recovery must retain uncertainty instead of
       * manufacturing an exact-empty receipt for a workload that may be live.
       */
      readonly soleHandleAttestation: string | null;
      readonly terminalRecord: WindowsAuthorityTerminalRecord | null;
    }
  // Split into unit discriminants on purpose: TypeScript does not remove a
  // union-typed discriminant member from the negative branch of an `||` chain,
  // so a single combined member would silently defeat narrowing here.
  | { readonly state: 'authority-unavailable'; readonly diagnosticCode: string }
  | { readonly state: 'authority-uncertain'; readonly diagnosticCode: string }
  | { readonly state: 'control-loss'; readonly diagnosticCode: string };

export type WindowsRecoveryClassification =
  | { readonly disposition: 'proceed' }
  | {
      readonly disposition: 'exact-scope-empty';
      readonly basis: 'durable-terminal-record' | 'last-handle-rule';
    }
  | {
      readonly disposition: 'retained';
      readonly state:
        | 'authority-unavailable'
        | 'authority-uncertain'
        | 'identity-drift'
        | 'event-gap'
        | 'control-loss';
      readonly diagnosticCode: string;
    };

const PROBE_PRESENT_KEYS = Object.freeze([
  'state',
  'bootIdentity',
  'guardianProcessId',
  'guardianCreationTime',
  'endpointServerProcessId',
  'endpointOwnerSid',
  'endpointAuthentication',
  'soleHandleAttestation',
] as const);
const PROBE_ABSENT_KEYS = Object.freeze([
  'state',
  'bootIdentity',
  'endpointPresent',
  'soleHandleAttestation',
  'terminalRecord',
] as const);
const PROBE_RETAINED_KEYS = Object.freeze(['state', 'diagnosticCode'] as const);
const TERMINAL_RECORD_KEYS = Object.freeze([
  'outcome',
  'scopeId',
  'generation',
  'bootIdentity',
  'soleHandleAttestation',
] as const);

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function retained(
  state: Extract<WindowsRecoveryClassification, { disposition: 'retained' }>['state'],
  diagnosticCode: string
): WindowsRecoveryClassification {
  return Object.freeze({ disposition: 'retained', state, diagnosticCode });
}

function malformedProbe(): WindowsRecoveryClassification {
  return retained('control-loss', 'native-transport-lost');
}

function validTerminalRecord(value: unknown): value is WindowsAuthorityTerminalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, TERMINAL_RECORD_KEYS) &&
    record.outcome === 'exact-scope-empty' &&
    typeof record.scopeId === 'string' &&
    typeof record.generation === 'string' &&
    typeof record.bootIdentity === 'string' &&
    typeof record.soleHandleAttestation === 'string';
}

export function parseWindowsAuthorityIdentityProbe(
  value: unknown
): WindowsAuthorityIdentityProbe | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.state === 'authority-present') {
    if (
      !exactKeys(record, PROBE_PRESENT_KEYS) ||
      typeof record.bootIdentity !== 'string' ||
      !Number.isSafeInteger(record.guardianProcessId) ||
      Number(record.guardianProcessId) <= 0 ||
      typeof record.guardianCreationTime !== 'string' ||
      !Number.isSafeInteger(record.endpointServerProcessId) ||
      Number(record.endpointServerProcessId) <= 0 ||
      typeof record.endpointOwnerSid !== 'string' ||
      (record.endpointAuthentication !== 'authenticated' &&
        record.endpointAuthentication !== 'rejected') ||
      typeof record.soleHandleAttestation !== 'string'
    ) {
      return undefined;
    }
    return Object.freeze({ ...record }) as unknown as WindowsAuthorityIdentityProbe;
  }
  if (record.state === 'authority-absent') {
    if (
      !exactKeys(record, PROBE_ABSENT_KEYS) ||
      typeof record.bootIdentity !== 'string' ||
      typeof record.endpointPresent !== 'boolean' ||
      (record.soleHandleAttestation !== null &&
        typeof record.soleHandleAttestation !== 'string') ||
      (record.terminalRecord !== null && !validTerminalRecord(record.terminalRecord))
    ) {
      return undefined;
    }
    return Object.freeze({
      ...record,
      ...(record.terminalRecord === null
        ? {}
        : { terminalRecord: Object.freeze({ ...(record.terminalRecord as object) }) }),
    }) as unknown as WindowsAuthorityIdentityProbe;
  }
  if (
    record.state === 'authority-unavailable' ||
    record.state === 'authority-uncertain' ||
    record.state === 'control-loss'
  ) {
    if (!exactKeys(record, PROBE_RETAINED_KEYS) || typeof record.diagnosticCode !== 'string') {
      return undefined;
    }
    return Object.freeze({ ...record }) as unknown as WindowsAuthorityIdentityProbe;
  }
  return undefined;
}

function presentTupleUnchanged(
  left: Extract<WindowsAuthorityIdentityProbe, { state: 'authority-present' }>,
  right: Extract<WindowsAuthorityIdentityProbe, { state: 'authority-present' }>
): boolean {
  return left.bootIdentity === right.bootIdentity &&
    left.guardianProcessId === right.guardianProcessId &&
    left.guardianCreationTime === right.guardianCreationTime &&
    left.endpointServerProcessId === right.endpointServerProcessId &&
    left.endpointOwnerSid === right.endpointOwnerSid &&
    left.endpointAuthentication === right.endpointAuthentication &&
    left.soleHandleAttestation === right.soleHandleAttestation;
}

function classifyPresent(
  reference: WindowsPrivateAuthorityReference,
  probe: Extract<WindowsAuthorityIdentityProbe, { state: 'authority-present' }>
): WindowsRecoveryClassification | undefined {
  if (probe.guardianProcessId !== reference.guardianProcessId) {
    return retained('identity-drift', 'identity-drift');
  }
  // Process-id reuse is detectable only here: a recycled identifier carries a
  // different creation FILETIME, and nothing else in the tuple would notice.
  if (probe.guardianCreationTime !== reference.guardianCreationTime) {
    return retained('identity-drift', 'guardian-birth-identity-differs');
  }
  if (probe.endpointServerProcessId !== reference.guardianProcessId) {
    return retained('identity-drift', 'endpoint-server-differs');
  }
  if (probe.endpointOwnerSid !== reference.endpointOwnerSid) {
    return retained('identity-drift', 'endpoint-owner-differs');
  }
  if (probe.soleHandleAttestation !== reference.soleHandleAttestation) {
    return retained('identity-drift', 'sole-handle-attestation-absent');
  }
  if (probe.endpointAuthentication !== 'authenticated') {
    return retained('control-loss', 'control-unavailable');
  }
  return undefined;
}

/**
 * The nine distinct observations of Decision 9's table, kept distinct. The
 * second and third rows are the dangerous pair: "the guardian died, therefore
 * the kernel emptied the Job" is sound only because the guardian held the last
 * handle, so the third row requires the attestation to be corroborated and
 * retains uncertainty when it is not.
 */
export function classifyWindowsAuthorityRecovery(
  reference: WindowsPrivateAuthorityReference,
  preOpenValue: unknown,
  postOpenValue: unknown
): WindowsRecoveryClassification {
  const preOpen = parseWindowsAuthorityIdentityProbe(preOpenValue);
  if (!preOpen) return malformedProbe();
  if (preOpen.state !== 'authority-present' && preOpen.state !== 'authority-absent') {
    return retained(preOpen.state, preOpen.diagnosticCode);
  }
  // Boot first: a prior-boot reference must never be allowed to match on a
  // recycled numeric identifier, so no identifier is compared until the boot
  // this reference was minted on is proven to be the boot we are running on.
  if (preOpen.bootIdentity !== reference.bootIdentity) {
    return retained('identity-drift', 'identity-drift');
  }
  if (preOpen.state === 'authority-absent') {
    if (preOpen.endpointPresent) {
      return retained('identity-drift', 'endpoint-server-differs');
    }
    const terminal = preOpen.terminalRecord;
    if (terminal) {
      const exact = terminal.scopeId === reference.scopeId &&
        terminal.generation === reference.generation &&
        terminal.bootIdentity === reference.bootIdentity &&
        terminal.soleHandleAttestation === reference.soleHandleAttestation;
      return exact
        ? Object.freeze({ disposition: 'exact-scope-empty', basis: 'durable-terminal-record' })
        : retained('event-gap', 'ledger-conflict');
    }
    if (preOpen.soleHandleAttestation === reference.soleHandleAttestation) {
      return Object.freeze({ disposition: 'exact-scope-empty', basis: 'last-handle-rule' });
    }
    return retained('authority-uncertain', 'guardian-absent-without-record');
  }
  const presentFailure = classifyPresent(reference, preOpen);
  if (presentFailure) return presentFailure;
  const postOpen = parseWindowsAuthorityIdentityProbe(postOpenValue);
  if (!postOpen) return malformedProbe();
  if (postOpen.state !== 'authority-present') {
    return retained('identity-drift', 'post-open-identity-changed');
  }
  const postFailure = classifyPresent(reference, postOpen);
  if (postFailure) return postFailure;
  if (!presentTupleUnchanged(preOpen, postOpen)) {
    return retained('identity-drift', 'post-open-identity-changed');
  }
  return Object.freeze({ disposition: 'proceed' });
}
