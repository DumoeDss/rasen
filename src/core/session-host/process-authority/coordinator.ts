import { createHash, randomUUID } from 'node:crypto';

import { encodeProcessAuthorityReference } from './reference-codec.js';
import { resolveProcessAuthorityReferenceForDispatch } from './reference-resolution.js';
import {
  ProcessAuthorityProviderRegistry,
  createEmptyProcessAuthorityProviderRegistry,
  selectProcessAuthorityProviderFromRegistry,
} from './registry.js';
import type {
  AuthorityOperationContext,
  AuthorityOperationPhase,
  AuthorityPrepareInput,
  ProcessAuthorityProviderSelectionResult,
  ProcessAuthorityReference,
  ProcessAuthoritySelection,
  ProviderControlOutcome,
  ProviderObservation,
  ProviderPreparedAuthority,
  ProviderAuthorityReference,
} from './types.js';

export const PROCESS_AUTHORITY_PUBLICATION_VERSION = 1 as const;
const PUBLICATION_ACKNOWLEDGEMENT_SCHEMA = 'rasen-process-authority-publication/1' as const;
const DEFAULT_OPERATION_TIMEOUT_MS = 10_000;
const SETTLEMENT_FINGERPRINT_MAX_DEPTH = 8;
const SETTLEMENT_FINGERPRINT_MAX_KEYS = 32;
const SETTLEMENT_FINGERPRINT_MAX_NODES = 256;
const SETTLEMENT_FINGERPRINT_MAX_TEXT = 256;
const PROVIDER_DIAGNOSTIC_MAX_LENGTH = 2_048;
export const PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT = 1_024 as const;
export const PROCESS_AUTHORITY_RECEIPT_CACHE_LIMIT = 1_024 as const;
export const PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT = 1_024 as const;

export interface MonotonicClock {
  now(): number;
}

export interface AuthorityScheduler {
  set(
    delayMs: number,
    onElapsed: () => void,
    context: AuthorityOperationContext
  ): unknown;
  clear(token: unknown): void;
}

export interface AuthorityOperationDiagnostic {
  readonly kind: 'late-settlement' | 'operation-id-conflict';
  readonly phase: AuthorityOperationPhase;
  readonly operationId: string;
  readonly diagnostic: string;
}

export interface ProcessAuthorityPublicationBinding {
  readonly reference: ProcessAuthorityReference;
  readonly referenceDigest: string;
  readonly preparationOperationId: string;
  readonly publicationVersion: typeof PROCESS_AUTHORITY_PUBLICATION_VERSION;
}

export interface ProcessAuthorityPublicationAcknowledgement {
  readonly schema: typeof PUBLICATION_ACKNOWLEDGEMENT_SCHEMA;
  readonly referenceDigest: string;
  readonly preparationOperationId: string;
  readonly publicationVersion: typeof PROCESS_AUTHORITY_PUBLICATION_VERSION;
}

export type ProcessAuthorityPublisher = (
  binding: ProcessAuthorityPublicationBinding,
  context: AuthorityOperationContext
) => Promise<ProcessAuthorityPublicationAcknowledgement>;

export interface ProcessAuthorityOrderingConflict {
  readonly state: 'ordering-conflict';
  readonly reference: ProcessAuthorityReference;
  readonly phase: 'publish' | 'activate' | 'abort';
  readonly diagnostic: string;
}

export interface ExactScopeEmptyReceipt {
  readonly state: 'exact-scope-empty';
  readonly reference: ProcessAuthorityReference;
}

const exactScopeEmptyReceipts = new WeakSet<object>();

function mintExactScopeEmptyReceipt(
  reference: ProcessAuthorityReference
): ExactScopeEmptyReceipt {
  const receipt: ExactScopeEmptyReceipt = Object.freeze({
    state: 'exact-scope-empty',
    reference,
  });
  exactScopeEmptyReceipts.add(receipt);
  return receipt;
}

export interface LiveProcessAuthority {
  readonly state: 'live';
  readonly reference: ProcessAuthorityReference;
}

export interface InertProcessAuthorityObservation {
  readonly state: 'prepared-inert' | 'published-inert';
  readonly reference: ProcessAuthorityReference;
}

export type RootExitedProcessAuthority =
  | {
      readonly state: 'root-exited';
      readonly reference: ProcessAuthorityReference;
      readonly code: number;
      readonly signal: string | null;
    }
  | {
      readonly state: 'root-exited';
      readonly reference: ProcessAuthorityReference;
      readonly code: null;
      readonly signal: string;
    };

export interface RetainedProcessAuthorityFailure {
  readonly state:
    | 'authority-unavailable'
    | 'authority-uncertain'
    | 'identity-drift'
    | 'event-gap'
    | 'timeout'
    | 'control-loss';
  readonly reference: ProcessAuthorityReference;
  readonly phase?: AuthorityOperationPhase;
  readonly diagnostic: string;
}

export type ProcessAuthorityLifecycleOutcome =
  | InertProcessAuthorityObservation
  | LiveProcessAuthority
  | RootExitedProcessAuthority
  | ExactScopeEmptyReceipt
  | RetainedProcessAuthorityFailure
  | ProcessAuthorityOrderingConflict;

export interface PublishedProcessAuthority {
  readonly state: 'published-inert';
  readonly reference: ProcessAuthorityReference;
  currentState(): string;
  activate(): Promise<ProcessAuthorityLifecycleOutcome>;
  abort(reason: string): Promise<ProcessAuthorityLifecycleOutcome>;
}

export interface PreparedProcessAuthority {
  readonly state: 'prepared-inert';
  readonly reference: ProcessAuthorityReference;
  readonly preparationOperationId: string;
  readonly publicationBinding: ProcessAuthorityPublicationBinding;
  currentState(): string;
  publish(
    publisher: ProcessAuthorityPublisher
  ): Promise<
    | PublishedProcessAuthority
    | ProcessAuthorityOrderingConflict
    | RetainedProcessAuthorityFailure
  >;
  abort(reason: string): Promise<ProcessAuthorityLifecycleOutcome>;
}

export type ProcessAuthorityPreparationResult =
  | PreparedProcessAuthority
  | {
      readonly state: 'timeout' | 'control-loss';
      readonly phase: 'prepare';
      readonly selection: ProcessAuthoritySelection;
      readonly diagnostic: string;
    }
  | {
      readonly state: 'authority-unavailable';
      readonly selection: ProcessAuthoritySelection;
      readonly diagnostic: string;
    };

export interface ProcessAuthorityCoordinatorOptions {
  readonly registry?: ProcessAuthorityProviderRegistry;
  readonly clock?: MonotonicClock;
  readonly scheduler?: AuthorityScheduler;
  readonly operationId?: () => string;
  readonly operationTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: AuthorityOperationDiagnostic) => void;
}

export interface ProcessAuthorityCoordinator {
  selection(selection: ProcessAuthoritySelection): ProcessAuthorityProviderSelectionResult;
  prepare(
    selection: ProcessAuthoritySelection,
    input: AuthorityPrepareInput,
    signal?: AbortSignal
  ): Promise<ProcessAuthorityPreparationResult>;
  inspect(
    reference: ProcessAuthorityReference,
    signal?: AbortSignal
  ): Promise<ProcessAuthorityLifecycleOutcome>;
  observeExactScopeEmpty(
    reference: ProcessAuthorityReference,
    signal?: AbortSignal
  ): Promise<ProcessAuthorityLifecycleOutcome>;
  terminate(
    reference: ProcessAuthorityReference,
    intent: import('./types.js').AuthorityTerminationIntent,
    signal?: AbortSignal
  ): Promise<ProcessAuthorityLifecycleOutcome>;
}

interface BoundedSuccess<T> {
  readonly state: 'settled';
  readonly value: T;
  readonly context: AuthorityOperationContext;
}

interface BoundedFailure {
  readonly state: 'timeout' | 'control-loss';
  readonly context: AuthorityOperationContext;
  readonly diagnostic: string;
}

type BoundedResult<T> = BoundedSuccess<T> | BoundedFailure;

function defaultScheduler(): AuthorityScheduler {
  return {
    set(delayMs, onElapsed) {
      return setTimeout(onElapsed, delayMs);
    },
    clear(token) {
      clearTimeout(token as NodeJS.Timeout);
    },
  };
}

function referenceDigest(reference: ProcessAuthorityReference): string {
  return createHash('sha256').update(String(reference), 'utf8').digest('hex');
}

/**
 * Diagnostic-only, cycle-safe identity for comparing late settlements. It is
 * deliberately bounded and never decides authority state or release.
 */
function settlementFingerprint(value: unknown): string {
  const hash = createHash('sha256');
  const seen = new WeakMap<object, number>();
  let nodes = 0;
  const append = (text: string) => {
    hash.update(text.slice(0, SETTLEMENT_FINGERPRINT_MAX_TEXT), 'utf8');
    hash.update('\0');
  };
  const visit = (current: unknown, depth: number): void => {
    if (current === null) {
      append('null');
      return;
    }
    const kind = typeof current;
    if (kind === 'string') {
      append(`string:${current as string}`);
      return;
    }
    if (kind === 'number') {
      const number = current as number;
      append(`number:${Number.isNaN(number) ? 'NaN' : Object.is(number, -0) ? '-0' : String(number)}`);
      return;
    }
    if (kind === 'boolean' || kind === 'undefined' || kind === 'bigint') {
      append(`${kind}:${String(current)}`);
      return;
    }
    if (kind === 'symbol') {
      append('symbol');
      return;
    }
    if (kind === 'function') {
      append('function');
      return;
    }
    const object = current as object;
    try {
      if (object instanceof AbortSignal) {
        append(`AbortSignal:${object.aborted ? 'aborted' : 'active'}`);
        return;
      }
    } catch {
      append('object:prototype-unavailable');
    }
    const existing = seen.get(object);
    if (existing !== undefined) {
      append(`cycle:${existing}`);
      return;
    }
    if (nodes >= SETTLEMENT_FINGERPRINT_MAX_NODES || depth >= SETTLEMENT_FINGERPRINT_MAX_DEPTH) {
      append('object:bounded');
      return;
    }
    const identity = nodes;
    nodes += 1;
    seen.set(object, identity);
    let keys: string[];
    try {
      keys = Object.keys(object).sort().slice(0, SETTLEMENT_FINGERPRINT_MAX_KEYS);
    } catch {
      append('object:keys-unavailable');
      return;
    }
    append(`object:${identity}:keys:${keys.length}`);
    for (const key of keys) {
      append(`key:${key}`);
      try {
        visit(Reflect.get(object, key), depth + 1);
      } catch {
        append('property:unavailable');
      }
    }
  };
  try {
    visit(value, 0);
    return hash.digest('hex');
  } catch {
    return createHash('sha256').update('unfingerprintable-settlement').digest('hex');
  }
}

function boundedResultFingerprint<T>(result: BoundedResult<T>): string {
  return settlementFingerprint(result.state === 'settled'
    ? {
        state: result.state,
        phase: result.context.phase,
        operationId: result.context.operationId,
        valueKind: typeof result.value,
      }
    : {
        state: result.state,
        phase: result.context.phase,
        operationId: result.context.operationId,
        diagnostic: result.diagnostic,
      });
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

const PREPARE_TEXT_LIMIT = 32 * 1024;
const PREPARE_ARGS_LIMIT = 4_096;
const PREPARE_ENV_LIMIT = 4_096;
const TERMINATION_REASON_LIMIT = 2_048;
const TERMINATION_GRACE_LIMIT = 86_400_000;

function boundedText(value: unknown, allowEmpty = true): value is string {
  return typeof value === 'string' &&
    value.length <= PREPARE_TEXT_LIMIT &&
    (allowEmpty || value.length > 0) &&
    !value.includes('\0');
}

function snapshotPrepareInput(value: AuthorityPrepareInput): AuthorityPrepareInput | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const keys = Object.keys(value).sort();
    const hasWindowsVerbatimArguments = keys.includes('windowsVerbatimArguments');
    const expected = hasWindowsVerbatimArguments
      ? ['args', 'command', 'cwd', 'env', 'windowsVerbatimArguments']
      : ['args', 'command', 'cwd', 'env'];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      return undefined;
    }
    const command = Reflect.get(value, 'command');
    const argsValue = Reflect.get(value, 'args');
    const cwd = Reflect.get(value, 'cwd');
    const envValue = Reflect.get(value, 'env');
    const windowsVerbatimArguments = hasWindowsVerbatimArguments
      ? Reflect.get(value, 'windowsVerbatimArguments')
      : undefined;
    if (!boundedText(command, false) || !boundedText(cwd, false)) return undefined;
    if (!Array.isArray(argsValue)) return undefined;
    const argsLength = Reflect.get(argsValue, 'length');
    if (
      typeof argsLength !== 'number' ||
      !Number.isSafeInteger(argsLength) ||
      argsLength < 0 ||
      argsLength > PREPARE_ARGS_LIMIT
    ) {
      return undefined;
    }
    const args: string[] = [];
    for (let index = 0; index < argsLength; index += 1) {
      const argument = Reflect.get(argsValue, String(index));
      if (!boundedText(argument)) return undefined;
      args.push(argument);
    }
    if (!envValue || typeof envValue !== 'object' || Array.isArray(envValue)) return undefined;
    const envKeys = Object.keys(envValue).sort();
    if (envKeys.length > PREPARE_ENV_LIMIT) return undefined;
    const env = Object.fromEntries(envKeys.map((key) => {
      const entry = Reflect.get(envValue, key);
      if (!boundedText(key, false) || !boundedText(entry)) {
        throw new TypeError('malformed environment entry');
      }
      return [key, entry];
    }));
    if (
      hasWindowsVerbatimArguments &&
      typeof windowsVerbatimArguments !== 'boolean'
    ) {
      return undefined;
    }
    return Object.freeze({
      command,
      args: Object.freeze(args),
      cwd,
      env: Object.freeze(env),
      ...(hasWindowsVerbatimArguments
        ? { windowsVerbatimArguments }
        : {}),
    });
  } catch {
    return undefined;
  }
}

function snapshotTerminationIntent(
  value: import('./types.js').AuthorityTerminationIntent
): import('./types.js').AuthorityTerminationIntent | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (!hasExactKeys(value, ['reason', 'graceMs'])) return undefined;
    const reason = Reflect.get(value, 'reason');
    const graceMs = Reflect.get(value, 'graceMs');
    if (
      typeof reason !== 'string' ||
      reason.length === 0 ||
      reason.length > TERMINATION_REASON_LIMIT ||
      reason.includes('\0') ||
      typeof graceMs !== 'number' ||
      !Number.isSafeInteger(graceMs) ||
      graceMs < 0 ||
      graceMs > TERMINATION_GRACE_LIMIT
    ) {
      return undefined;
    }
    return Object.freeze({ reason, graceMs });
  } catch {
    return undefined;
  }
}

function snapshotAbortReason(value: string): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= TERMINATION_REASON_LIMIT &&
    !value.includes('\0')
    ? value
    : undefined;
}

interface CapturedProviderPreparedAuthority {
  readonly reference: ProviderAuthorityReference;
  activate(context: AuthorityOperationContext): Promise<ProviderObservation>;
}

function snapshotProviderPreparedAuthority(
  value: ProviderPreparedAuthority
): CapturedProviderPreparedAuthority | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const reference = Reflect.get(value, 'reference');
    const activate = Reflect.get(value, 'activate');
    if (typeof reference !== 'string' || typeof activate !== 'function') return undefined;
    return Object.freeze({
      reference: reference as ProviderAuthorityReference,
      activate(context: AuthorityOperationContext) {
        try {
          return Promise.resolve(Reflect.apply(activate, value, [context])) as Promise<ProviderObservation>;
        } catch (error) {
          return Promise.reject(error);
        }
      },
    });
  } catch {
    return undefined;
  }
}

function normalizeProviderOutcome(
  value: unknown
): ProviderObservation | ProviderControlOutcome | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const state = Reflect.get(record, 'state');
    if (typeof state !== 'string') return undefined;
    if (
      state === 'prepared-inert' ||
      state === 'published-inert' ||
      state === 'live' ||
      state === 'exact-scope-empty'
    ) {
      return hasExactKeys(record, ['state']) ? { state } : undefined;
    }
    if (state === 'root-exited') {
      if (!hasExactKeys(record, ['state', 'code', 'signal'])) return undefined;
      const code = Reflect.get(record, 'code');
      const signal = Reflect.get(record, 'signal');
      if (
        (code !== null && !Number.isSafeInteger(code)) ||
        (signal !== null && (typeof signal !== 'string' || signal.length > 128)) ||
        (code === null && signal === null)
      ) {
        return undefined;
      }
      return code === null
        ? { state, code: null, signal: signal as string }
        : { state, code: code as number, signal: signal as string | null };
    }
    if (
      state === 'authority-unavailable' ||
      state === 'authority-uncertain' ||
      state === 'identity-drift' ||
      state === 'event-gap'
    ) {
      if (!hasExactKeys(record, ['state', 'diagnostic'])) return undefined;
      const diagnostic = Reflect.get(record, 'diagnostic');
      if (typeof diagnostic !== 'string' || diagnostic.length > PROVIDER_DIAGNOSTIC_MAX_LENGTH) {
        return undefined;
      }
      return { state, diagnostic };
    }
    if (state === 'timeout' || state === 'control-loss') {
      if (!hasExactKeys(record, ['state', 'phase', 'diagnostic'])) return undefined;
      const outcomePhase = Reflect.get(record, 'phase');
      const diagnostic = Reflect.get(record, 'diagnostic');
      if (
        ![
          'prepare',
          'publish',
          'activate',
          'inspect',
          'terminate',
          'abort',
          'exact-empty-observation',
        ].includes(outcomePhase as string) ||
        typeof diagnostic !== 'string' ||
        diagnostic.length > PROVIDER_DIAGNOSTIC_MAX_LENGTH
      ) {
        return undefined;
      }
      return { state, phase: outcomePhase as AuthorityOperationPhase, diagnostic };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function createProcessAuthorityPublicationAcknowledgement(
  binding: ProcessAuthorityPublicationBinding
): ProcessAuthorityPublicationAcknowledgement {
  if (
    binding.publicationVersion !== PROCESS_AUTHORITY_PUBLICATION_VERSION ||
    !/^[a-f0-9]{64}$/.test(binding.referenceDigest) ||
    typeof binding.preparationOperationId !== 'string' ||
    binding.preparationOperationId.length === 0 ||
    binding.preparationOperationId.length > 128
  ) {
    throw new TypeError('Process-authority publication binding is malformed.');
  }
  return Object.freeze({
    schema: PUBLICATION_ACKNOWLEDGEMENT_SCHEMA,
    referenceDigest: binding.referenceDigest,
    preparationOperationId: binding.preparationOperationId,
    publicationVersion: binding.publicationVersion,
  });
}

function isExactAcknowledgement(
  acknowledgement: ProcessAuthorityPublicationAcknowledgement,
  binding: ProcessAuthorityPublicationBinding
): boolean {
  try {
    if (!acknowledgement || typeof acknowledgement !== 'object') return false;
    const keys = Object.keys(acknowledgement).sort();
    const expectedKeys = [
      'schema',
      'referenceDigest',
      'preparationOperationId',
      'publicationVersion',
    ].sort();
    return (
      keys.length === expectedKeys.length &&
      keys.every((key, index) => key === expectedKeys[index]) &&
      acknowledgement.schema === PUBLICATION_ACKNOWLEDGEMENT_SCHEMA &&
      acknowledgement.referenceDigest === binding.referenceDigest &&
      acknowledgement.preparationOperationId === binding.preparationOperationId &&
      acknowledgement.publicationVersion === binding.publicationVersion
    );
  } catch {
    return false;
  }
}

function orderingConflict(
  reference: ProcessAuthorityReference,
  phase: ProcessAuthorityOrderingConflict['phase'],
  currentState: string
): ProcessAuthorityOrderingConflict {
  return Object.freeze({
    state: 'ordering-conflict',
    reference,
    phase,
    diagnostic: `Process-authority ${phase} is not permitted from ${currentState}.`,
  });
}

function attachProviderOutcome(
  reference: ProcessAuthorityReference,
  phase: AuthorityOperationPhase,
  rawOutcome: unknown
): ProcessAuthorityLifecycleOutcome {
  const outcome = normalizeProviderOutcome(rawOutcome);
  if (!outcome) {
    return Object.freeze({
      state: 'control-loss',
      reference,
      phase,
      diagnostic: `Process-authority ${phase} provider returned an invalid fulfilled outcome.`,
    });
  }
  if (outcome.state === 'prepared-inert' || outcome.state === 'published-inert') {
    return Object.freeze({ state: outcome.state, reference });
  }
  if (outcome.state === 'live') return Object.freeze({ state: 'live', reference });
  if (outcome.state === 'root-exited') {
    return outcome.code === null
      ? Object.freeze({
          state: 'root-exited',
          reference,
          code: null,
          signal: outcome.signal,
        })
      : Object.freeze({
          state: 'root-exited',
          reference,
          code: outcome.code,
          signal: outcome.signal,
        });
  }
  if (outcome.state === 'exact-scope-empty') {
    return mintExactScopeEmptyReceipt(reference);
  }
  if (
    outcome.state === 'authority-unavailable' ||
    outcome.state === 'authority-uncertain' ||
    outcome.state === 'identity-drift' ||
    outcome.state === 'event-gap'
  ) {
    return Object.freeze({ state: outcome.state, reference, diagnostic: outcome.diagnostic });
  }
  if (outcome.state === 'timeout' || outcome.state === 'control-loss') {
    return Object.freeze({
      state: outcome.state,
      reference,
      phase,
      diagnostic: outcome.diagnostic,
    });
  }
  return Object.freeze({
    state: 'control-loss',
    reference,
    phase,
    diagnostic: `Provider returned ${outcome.state} during ${phase}.`,
  });
}

/** The only public release-eligibility discriminator for durable authority. */
export function isExactScopeEmptyReceipt(
  outcome: unknown
): outcome is ExactScopeEmptyReceipt {
  return typeof outcome === 'object' && outcome !== null && exactScopeEmptyReceipts.has(outcome);
}

export function createProcessAuthorityCoordinator(
  options: ProcessAuthorityCoordinatorOptions = {}
): ProcessAuthorityCoordinator {
  if ('providers' in options) {
    throw new TypeError(
      'Raw process-authority providers are forbidden; provide a manifest-bound registry.'
    );
  }
  const registry = options.registry ?? createEmptyProcessAuthorityProviderRegistry();
  const clock = options.clock ?? { now: () => performance.now() };
  const scheduler = options.scheduler ?? defaultScheduler();
  const nextOperationId = options.operationId ?? randomUUID;
  const timeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Process-authority operation timeout must be positive and finite.');
  }
  const exactEmptyReceipts = new Map<string, ExactScopeEmptyReceipt>();
  const referenceLifecycles = new Map<string, 'active' | 'retired'>();
  let referenceReservations = 0;
  const operationLedger = new Map<string, {
    readonly phase: AuthorityOperationPhase;
    readonly identity: string;
    readonly status: 'in-flight' | 'settled';
  }>();

  function emitDiagnostic(diagnostic: AuthorityOperationDiagnostic): void {
    try {
      options.onDiagnostic?.(Object.freeze(diagnostic));
    } catch {
      // Diagnostics are observational and must never influence authority settlement.
    }
  }

  function operationIdentity(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  }

  function settleOperationReservation(
    operationId: string,
    phase: AuthorityOperationPhase,
    identity: string
  ): void {
    const reservation = operationLedger.get(operationId);
    if (
      reservation?.phase === phase &&
      reservation.identity === identity &&
      reservation.status === 'in-flight'
    ) {
      operationLedger.set(operationId, { phase, identity, status: 'settled' });
    }
  }

  function evictOldestSettledOperation(): boolean {
    for (const [operationId, entry] of operationLedger) {
      if (entry.status === 'settled') {
        operationLedger.delete(operationId);
        return true;
      }
    }
    return false;
  }

  function retainOrRelease(outcome: ProcessAuthorityLifecycleOutcome): ProcessAuthorityLifecycleOutcome {
    if (!isExactScopeEmptyReceipt(outcome)) return outcome;
    const key = String(outcome.reference);
    if (referenceLifecycles.has(key)) referenceLifecycles.set(key, 'retired');
    const existing = exactEmptyReceipts.get(key);
    if (existing) return existing;
    if (exactEmptyReceipts.size >= PROCESS_AUTHORITY_RECEIPT_CACHE_LIMIT) {
      const oldest = exactEmptyReceipts.keys().next().value as string | undefined;
      if (oldest !== undefined) exactEmptyReceipts.delete(oldest);
    }
    exactEmptyReceipts.set(key, outcome);
    return outcome;
  }

  function reserveReferenceSlot(): boolean {
    if (
      referenceLifecycles.size + referenceReservations >=
      PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT
    ) {
      return false;
    }
    referenceReservations += 1;
    return true;
  }

  function registerRecoveredReference(reference: ProcessAuthorityReference): boolean {
    const key = String(reference);
    if (referenceLifecycles.has(key)) return true;
    if (
      referenceLifecycles.size + referenceReservations >=
      PROCESS_AUTHORITY_REFERENCE_TOMBSTONE_LIMIT
    ) {
      return false;
    }
    referenceLifecycles.set(key, 'active');
    return true;
  }

  async function bounded<T>(
    phase: AuthorityOperationPhase,
    identity: string,
    operation: (context: AuthorityOperationContext) => Promise<T>,
    externalSignal?: AbortSignal
  ): Promise<BoundedResult<T>> {
    const controller = new AbortController();
    const operationId = nextOperationId();
    if (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 128) {
      throw new TypeError('Process-authority operation id is malformed.');
    }
    const context = Object.freeze({
      phase,
      operationId,
      deadline: clock.now() + timeoutMs,
      signal: controller.signal,
    });
    const recorded = operationLedger.get(operationId);
    if (recorded) {
      emitDiagnostic({
        kind: 'operation-id-conflict',
        phase,
        operationId,
        diagnostic: recorded.phase === phase && recorded.identity === identity
          ? `Process-authority operation id was reused while ${recorded.status}.`
          : `Process-authority operation id conflicts with ${recorded.phase} or a different target.`,
      });
      return Object.freeze({
        state: 'control-loss',
        context,
        diagnostic: 'Process-authority operation id is not unique.',
      });
    }
    while (
      operationLedger.size >= PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT &&
      evictOldestSettledOperation()
    ) {
      // Settled replay guards are retained up to the fixed ledger bound. Active
      // reservations are never evicted because that would permit redispatch.
    }
    if (operationLedger.size >= PROCESS_AUTHORITY_OPERATION_LEDGER_LIMIT) {
      emitDiagnostic({
        kind: 'operation-id-conflict',
        phase,
        operationId,
        diagnostic: 'Process-authority in-flight operation reservation capacity is exhausted.',
      });
      return Object.freeze({
        state: 'control-loss',
        context,
        diagnostic: 'Process-authority operation reservation capacity is exhausted.',
      });
    }
    operationLedger.set(operationId, { phase, identity, status: 'in-flight' });
    return new Promise<BoundedResult<T>>((resolve) => {
      let settled = false;
      let recordedResultIdentity = '';
      let token: unknown;
      let tokenAssigned = false;
      let clearPending = false;
      let timerCleared = false;
      let removeExternalAbort: () => void = () => undefined;
      const clearTimer = () => {
        if (timerCleared) return;
        if (!tokenAssigned) {
          clearPending = true;
          return;
        }
        timerCleared = true;
        try {
          scheduler.clear(token);
        } catch {
          // Timer cleanup is best-effort after semantic settlement and cannot
          // be allowed to replace the bounded authority outcome.
        }
      };
      const settle = (result: BoundedResult<T>) => {
        if (settled) {
          const lateIdentity = boundedResultFingerprint(result);
          if (recordedResultIdentity !== lateIdentity) {
            emitDiagnostic({
              kind: 'late-settlement',
              phase,
              operationId,
              diagnostic: `Process-authority ${phase} settled after its recorded result.`,
            });
          }
          return;
        }
        settled = true;
        clearTimer();
        try {
          removeExternalAbort();
        } catch {
          // Caller observation cleanup cannot change semantic settlement.
        }
        settleOperationReservation(operationId, phase, identity);
        recordedResultIdentity = boundedResultFingerprint(result);
        resolve(result);
      };
      const settleObserved = (result: BoundedResult<T>) => {
        let settledAt: number;
        try {
          settledAt = clock.now();
        } catch {
          settle({
            state: 'control-loss',
            context,
            diagnostic: `Process-authority ${phase} monotonic deadline observation failed.`,
          });
          return;
        }
        if (settledAt >= context.deadline) {
          controller.abort();
          settle({
            state: 'timeout',
            context,
            diagnostic: `Process-authority ${phase} settled after its monotonic deadline.`,
          });
          return;
        }
        settle(result);
      };
      try {
        token = scheduler.set(timeoutMs, () => {
          controller.abort();
          settle({
            state: 'timeout',
            context,
            diagnostic: `Process-authority ${phase} did not settle before its deadline.`,
          });
        }, context);
        tokenAssigned = true;
        if (clearPending) clearTimer();
      } catch {
        tokenAssigned = true;
        settle({
          state: 'control-loss',
          context,
          diagnostic: `Process-authority ${phase} deadline scheduling failed.`,
        });
      }
      if (externalSignal && !settled) {
        const onExternalAbort = () => {
          controller.abort();
          settle({
            state: 'control-loss',
            context,
            diagnostic: `Process-authority ${phase} was cancelled before exact settlement.`,
          });
        };
        if (externalSignal.aborted) onExternalAbort();
        else {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
          removeExternalAbort = () => externalSignal.removeEventListener('abort', onExternalAbort);
        }
      }
      Promise.resolve()
        .then(() => settled ? undefined : operation(context))
        .then(
          (value) => {
            if (value !== undefined || !settled) {
              settleObserved({ state: 'settled', value: value as T, context });
            }
          },
          () => settleObserved({
            state: 'control-loss',
            context,
            diagnostic: `Process-authority ${phase} provider control was lost.`,
          })
        );
    });
  }

  async function prepare(
    selection: ProcessAuthoritySelection,
    input: AuthorityPrepareInput,
    signal?: AbortSignal
  ): Promise<ProcessAuthorityPreparationResult> {
    const selected = selectProcessAuthorityProviderFromRegistry(registry, selection);
    if (selected.state !== 'selected') return selected;
    const exactSelection = Object.freeze({
      providerId: selected.descriptor.providerId,
      capabilityId: selected.descriptor.capabilityId,
      protocolVersion: selected.descriptor.protocolVersion,
    });
    const exactInput = snapshotPrepareInput(input);
    if (!exactInput) {
      return Object.freeze({
        state: 'authority-unavailable',
        selection: exactSelection,
        diagnostic: 'Process-authority prepare input is malformed or exceeds its bound.',
      });
    }
    if (!reserveReferenceSlot()) {
      return Object.freeze({
        state: 'authority-unavailable',
        selection: exactSelection,
        diagnostic: 'Process-authority reference tombstone capacity is exhausted.',
      });
    }
    let reservationHeld = true;
    const releaseReservation = () => {
      if (!reservationHeld) return;
      reservationHeld = false;
      referenceReservations -= 1;
    };
    let preparation: BoundedResult<ProviderPreparedAuthority>;
    try {
      preparation = await bounded(
        'prepare',
        operationIdentity({
          selection: exactSelection,
          input: {
            command: exactInput.command,
            args: exactInput.args,
            cwd: exactInput.cwd,
            env: Object.entries(exactInput.env),
            windowsVerbatimArguments: exactInput.windowsVerbatimArguments ?? false,
          },
        }),
        (context) => selected.provider.prepare(exactInput, context),
        signal
      );
    } catch (error) {
      releaseReservation();
      throw error;
    }
    if (preparation.state !== 'settled') {
      releaseReservation();
      return Object.freeze({
        state: preparation.state,
        phase: 'prepare',
        selection: exactSelection,
        diagnostic: preparation.diagnostic,
      });
    }
    const providerPrepared = snapshotProviderPreparedAuthority(preparation.value);
    if (!providerPrepared) {
      releaseReservation();
      return Object.freeze({
        state: 'authority-unavailable',
        selection: exactSelection,
        diagnostic: 'Process-authority provider returned an invalid inert preparation.',
      });
    }
    let reference: ProcessAuthorityReference;
    try {
      reference = encodeProcessAuthorityReference(
        selected.descriptor,
        providerPrepared.reference
      );
    } catch {
      releaseReservation();
      return Object.freeze({
        state: 'authority-unavailable',
        selection: exactSelection,
        diagnostic: 'Process-authority provider returned an invalid opaque reference.',
      });
    }
    if (referenceLifecycles.has(String(reference))) {
      releaseReservation();
      return Object.freeze({
        state: 'authority-unavailable',
        selection: exactSelection,
        diagnostic: 'Process-authority provider reference reuse is forbidden.',
      });
    }
    referenceLifecycles.set(String(reference), 'active');
    releaseReservation();
    let state = 'prepared-inert';
    const binding: ProcessAuthorityPublicationBinding = Object.freeze({
      reference,
      referenceDigest: referenceDigest(reference),
      preparationOperationId: preparation.context.operationId,
      publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION,
    });

    const abort = async (reason: string): Promise<ProcessAuthorityLifecycleOutcome> => {
      if (
        state !== 'prepared-inert' &&
        state !== 'published-inert' &&
        state !== 'publication-uncertain'
      ) {
        return orderingConflict(reference, 'abort', state);
      }
      const exactReason = snapshotAbortReason(reason);
      if (!exactReason) {
        return Object.freeze({
          state: 'control-loss',
          reference,
          phase: 'abort',
          diagnostic: 'Process-authority abort reason is malformed or exceeds its bound.',
        });
      }
      state = 'aborting';
      const result = await bounded(
        'abort',
        operationIdentity({ reference, reason: exactReason }),
        (context) => selected.provider.abort(providerPrepared.reference, exactReason, context)
      );
      if (result.state !== 'settled') {
        state = result.state;
        return Object.freeze({
          state: result.state,
          reference,
          phase: 'abort',
          diagnostic: result.diagnostic,
        });
      }
      const outcome = retainOrRelease(attachProviderOutcome(reference, 'abort', result.value));
      state = outcome.state;
      return outcome;
    };

    let published: PublishedProcessAuthority | undefined;
    const prepared: PreparedProcessAuthority = Object.freeze({
      state: 'prepared-inert',
      reference,
      preparationOperationId: preparation.context.operationId,
      publicationBinding: binding,
      currentState: () => state,
      async publish(publisher: ProcessAuthorityPublisher) {
        if (state !== 'prepared-inert') return orderingConflict(reference, 'publish', state);
        if (typeof publisher !== 'function') {
          return orderingConflict(reference, 'publish', state);
        }
        state = 'publishing';
        const publication = await bounded(
          'publish',
          operationIdentity({ reference, binding }),
          (context) => publisher(binding, context)
        );
        if (publication.state !== 'settled') {
          state = 'publication-uncertain';
          return Object.freeze({
            state: publication.state,
            reference,
            phase: 'publish',
            diagnostic: publication.diagnostic,
          });
        }
        if (!isExactAcknowledgement(publication.value, binding)) {
          state = 'publication-uncertain';
          return Object.freeze({
            state: 'control-loss',
            reference,
            phase: 'publish',
            diagnostic: 'Process-authority publication acknowledgement is invalid or mismatched.',
          });
        }
        state = 'published-inert';
        published ??= Object.freeze({
          state: 'published-inert',
          reference,
          currentState: () => state,
          async activate() {
            if (state !== 'published-inert') {
              return orderingConflict(reference, 'activate', state);
            }
            state = 'activating';
            const result = await bounded(
              'activate',
              operationIdentity({ reference }),
              (context) => providerPrepared.activate(context)
            );
            if (result.state !== 'settled') {
              state = result.state;
              return Object.freeze({
                state: result.state,
                reference,
                phase: 'activate',
                diagnostic: result.diagnostic,
              });
            }
            const outcome = retainOrRelease(
              attachProviderOutcome(reference, 'activate', result.value)
            );
            state = outcome.state;
            return outcome;
          },
          abort,
        });
        return published;
      },
      abort,
    });
    return prepared;
  }

  function unavailableReference(
    reference: ProcessAuthorityReference,
    diagnostic: string
  ): RetainedProcessAuthorityFailure {
    return Object.freeze({ state: 'authority-unavailable', reference, diagnostic });
  }

  async function observe(
    reference: ProcessAuthorityReference,
    phase: 'inspect' | 'exact-empty-observation',
    signal?: AbortSignal
  ): Promise<ProcessAuthorityLifecycleOutcome> {
    const released = exactEmptyReceipts.get(String(reference));
    if (released) return released;
    const resolved = resolveProcessAuthorityReferenceForDispatch(registry, String(reference));
    if (resolved.state !== 'dispatchable') {
      return unavailableReference(reference, resolved.diagnostic);
    }
    if (!registerRecoveredReference(reference)) {
      return unavailableReference(
        reference,
        'Process-authority reference tombstone capacity is exhausted.'
      );
    }
    const result = await bounded(
      phase,
      operationIdentity({ reference }),
      (context) => resolved.provider.inspect(resolved.providerReference, context),
      signal
    );
    if (result.state !== 'settled') {
      return Object.freeze({
        state: result.state,
        reference,
        phase,
        diagnostic: result.diagnostic,
      });
    }
    return retainOrRelease(attachProviderOutcome(reference, phase, result.value));
  }

  async function terminate(
    reference: ProcessAuthorityReference,
    intent: import('./types.js').AuthorityTerminationIntent,
    signal?: AbortSignal
  ): Promise<ProcessAuthorityLifecycleOutcome> {
    const released = exactEmptyReceipts.get(String(reference));
    if (released) return released;
    const resolved = resolveProcessAuthorityReferenceForDispatch(registry, String(reference));
    if (resolved.state !== 'dispatchable') {
      return unavailableReference(reference, resolved.diagnostic);
    }
    const exactIntent = snapshotTerminationIntent(intent);
    if (!exactIntent) {
      return Object.freeze({
        state: 'control-loss',
        reference,
        phase: 'terminate',
        diagnostic: 'Process-authority termination intent is malformed or exceeds its bound.',
      });
    }
    if (!registerRecoveredReference(reference)) {
      return unavailableReference(
        reference,
        'Process-authority reference tombstone capacity is exhausted.'
      );
    }
    const result = await bounded(
      'terminate',
      operationIdentity({ reference, intent: exactIntent }),
      (context) => resolved.provider.terminate(resolved.providerReference, exactIntent, context),
      signal
    );
    if (result.state !== 'settled') {
      return Object.freeze({
        state: result.state,
        reference,
        phase: 'terminate',
        diagnostic: result.diagnostic,
      });
    }
    return retainOrRelease(attachProviderOutcome(reference, 'terminate', result.value));
  }

  return Object.freeze({
    selection(selection: ProcessAuthoritySelection) {
      return selectProcessAuthorityProviderFromRegistry(registry, selection);
    },
    prepare,
    inspect(reference: ProcessAuthorityReference, signal?: AbortSignal) {
      return observe(reference, 'inspect', signal);
    },
    observeExactScopeEmpty(reference: ProcessAuthorityReference, signal?: AbortSignal) {
      return observe(reference, 'exact-empty-observation', signal);
    },
    terminate,
  });
}
