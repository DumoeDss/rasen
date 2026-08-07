import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ProviderBackedProcessRuntime } from '../process-scope-adapter.js';
import type {
  AuthorityOperationContext,
  AuthorityPrepareInput,
  AuthorityTerminationIntent,
  ProcessAuthorityProvider,
  ProcessAuthorityProviderDescriptor,
  ProcessAuthorityReference,
  ProviderAuthorityReference,
  ProviderControlOutcome,
  ProviderObservation,
  ProviderPreparationResult,
  ProviderPreparationUnavailable,
} from '../types.js';
import { decodeProcessAuthorityReferenceForDispatch } from '../reference-codec.js';
import { WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR } from './contracts.js';
import { createWindowsNativeAssembly } from './native-assembly.js';
import {
  createWindowsPrivateAuthorityReference,
  decodeWindowsPrivateAuthorityReference,
  WINDOWS_BOOT_IDENTITY_SOURCES,
  WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  type WindowsPrivateAuthorityReference,
  type WindowsPrivateAuthorityReferenceInput,
} from './private-reference.js';
import {
  createWindowsAuthorityPublicationAccess,
  createWindowsAuthorityPublicationLedger,
  createWindowsAuthorityPublicationPublisher,
  type WindowsAuthorityPublicationLedger,
  type WindowsAuthorityPublicationLookup,
} from './publication-ledger.js';
import {
  mapWindowsNativeControlOutcome,
  mapWindowsNativeObservation,
  windowsRetainedDiagnostic,
} from './outcomes.js';
import {
  classifyWindowsAuthorityRecovery,
  parseWindowsAuthorityIdentityProbe,
  type WindowsIdentityProbeStage,
  type WindowsRecoveryClassification,
} from './recovery.js';

export type { WindowsAuthorityMode } from './build-authority.js';

const MAX_WINDOWS_PATH_LENGTH = 32_767;
const MAX_WINDOWS_ARGUMENTS = 128;
const MAX_WINDOWS_ARGUMENT_LENGTH = 32_767;
const MAX_WINDOWS_ENVIRONMENT = 128;
const MAX_WINDOWS_ENVIRONMENT_KEY_LENGTH = 1_024;
const MAX_WINDOWS_ENVIRONMENT_VALUE_LENGTH = 32_767;

/**
 * A member that had already called `CreateProcessW` when the sweep ran produces
 * a `NEW_PROCESS` message after the terminate, so force must be re-applied
 * until the authority reports empty. That loop lives in the guardian, not here:
 * the guardian holds the completion port and is therefore the only layer that
 * can observe `NEW_PROCESS` at all, and a second loop at this layer would put
 * two deadline implementations in one control path.
 *
 * `reterminate-required` is consequently *not* part of the contract this layer
 * accepts. If one ever arrives it is a closed-protocol violation and is
 * classified as control loss, so a regression that resurrects the second loop
 * fails loudly instead of quietly working.
 */
const WINDOWS_RETERMINATE_SIGNAL = 'reterminate-required';

export interface WindowsAuthorityNativePrepareRequest {
  readonly input: AuthorityPrepareInput;
  readonly preparationOperationId: string;
  readonly launchDigest: string;
}

export interface WindowsAuthorityExpectedArtifactIdentity {
  readonly helperProtocolVersion: 1;
  readonly artifactSha256: string;
  readonly sourceSha256: string;
}

export interface WindowsAuthorityNativeTransport {
  prepare(
    request: WindowsAuthorityNativePrepareRequest,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  /**
   * Reads the complete durable identity tuple. The provider calls this twice —
   * before any handle exists and again after every handle is open — and refuses
   * to observe or control unless both reads agree.
   */
  probeIdentity(
    reference: WindowsPrivateAuthorityReference,
    stage: WindowsIdentityProbeStage,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  activate(
    reference: WindowsPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  inspect(
    reference: WindowsPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  /**
   * Bounded, best-effort, and explicitly non-authoritative: it closes the root's
   * standard input and waits. Its result is a hint only — the provider always
   * proceeds to authority-wide force, because Windows has no SIGTERM and a
   * quiet interval is not an empty event.
   */
  attemptGraceful(
    reference: WindowsPrivateAuthorityReference,
    intent: AuthorityTerminationIntent,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  terminate(
    reference: WindowsPrivateAuthorityReference,
    intent: AuthorityTerminationIntent,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  abort(
    reference: WindowsPrivateAuthorityReference,
    reason: string,
    context: AuthorityOperationContext
  ): Promise<unknown>;
}

export interface WindowsAuthorityRuntimeOpener {
  open(reference: WindowsPrivateAuthorityReference): ProviderBackedProcessRuntime;
}

export interface WindowsProcessAuthorityProviderBundle {
  readonly provider: ProcessAuthorityProvider;
  readonly publishAuthority: ReturnType<typeof createWindowsAuthorityPublicationPublisher>;
  openRuntime(reference: ProcessAuthorityReference): ProviderBackedProcessRuntime;
}

export interface WindowsProcessAuthorityProviderBundleOptions {
  readonly transport: WindowsAuthorityNativeTransport;
  readonly runtimeOpener: WindowsAuthorityRuntimeOpener;
  readonly ledger: WindowsAuthorityPublicationLedger;
  readonly artifactIdentity: WindowsAuthorityExpectedArtifactIdentity;
}

export interface WindowsProcessAuthorityProductionOptions {
  readonly stateRoot: string;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function snapshotLaunch(input: AuthorityPrepareInput): Required<
  Pick<AuthorityPrepareInput, 'command' | 'args' | 'cwd' | 'env' | 'windowsVerbatimArguments'>
> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Windows process-authority launch input is malformed.');
  }
  const keys = Object.keys(input).sort();
  const hasVerbatim = keys.includes('windowsVerbatimArguments');
  const expected = hasVerbatim
    ? ['args', 'command', 'cwd', 'env', 'windowsVerbatimArguments']
    : ['args', 'command', 'cwd', 'env'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Windows process-authority launch input is not closed.');
  }
  if (
    typeof input.command !== 'string' ||
    !path.win32.isAbsolute(input.command) ||
    input.command.includes('\0') ||
    input.command.length > MAX_WINDOWS_PATH_LENGTH ||
    typeof input.cwd !== 'string' ||
    !path.win32.isAbsolute(input.cwd) ||
    input.cwd.includes('\0') ||
    input.cwd.length > MAX_WINDOWS_PATH_LENGTH ||
    (hasVerbatim && typeof input.windowsVerbatimArguments !== 'boolean') ||
    !Array.isArray(input.args) ||
    input.args.length > MAX_WINDOWS_ARGUMENTS ||
    !input.args.every((argument) =>
      typeof argument === 'string' &&
      argument.length <= MAX_WINDOWS_ARGUMENT_LENGTH &&
      !argument.includes('\0')
    ) ||
    !input.env ||
    typeof input.env !== 'object' ||
    Array.isArray(input.env)
  ) {
    throw new TypeError('Windows process-authority launch input is malformed.');
  }
  const envKeys = Object.keys(input.env).sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  );
  if (envKeys.length > MAX_WINDOWS_ENVIRONMENT) {
    throw new TypeError('Windows process-authority launch environment exceeds its bound.');
  }
  // Windows environment names are case-insensitive; two spellings of one name
  // would make the materialised block ambiguous, so the snapshot refuses them.
  const seen = new Set<string>();
  const env = Object.create(null) as Record<string, string>;
  for (const key of envKeys) {
    const value = input.env[key];
    const folded = key.toUpperCase();
    if (
      key.length === 0 ||
      key.length > MAX_WINDOWS_ENVIRONMENT_KEY_LENGTH ||
      key.includes('\0') ||
      key.includes('=') ||
      seen.has(folded) ||
      typeof value !== 'string' ||
      value.length > MAX_WINDOWS_ENVIRONMENT_VALUE_LENGTH ||
      value.includes('\0')
    ) {
      throw new TypeError('Windows process-authority launch environment is malformed.');
    }
    seen.add(folded);
    env[key] = value;
  }
  return Object.freeze({
    command: input.command,
    args: Object.freeze([...input.args]),
    cwd: input.cwd,
    env: Object.freeze(env),
    windowsVerbatimArguments: input.windowsVerbatimArguments === true,
  });
}

/**
 * The domain-separated launch digest.
 *
 * `RWL1` is not this layer's choice: it is `launch.rs:canonical_bytes`, and the
 * guardian digests the launch it was actually given with that prefix
 * (`guardian.rs:524`). `createPreparedReference` then requires the attested
 * `launchDigest` to equal the one computed here, so the two producers must agree
 * byte for byte or no real attestation can ever be accepted.
 *
 * This constant read `RPW1` until a native assembly first fed a real attestation
 * through the production factory. Nothing had ever compared the two, because
 * nothing had ever produced both: every existing test computes the expected
 * digest with this same function, so the mismatch was invisible to all of them
 * and would have made production `prepare` throw
 * "attestation identity binding differs" on every healthy host.
 */
export function digestWindowsAuthorityLaunch(input: AuthorityPrepareInput): string {
  const snapshot = snapshotLaunch(input);
  const chunks: Buffer[] = [Buffer.from('RWL1', 'ascii')];
  const putString = (value: string): void => {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    chunks.push(length, bytes);
  };
  putString(snapshot.command);
  putString(snapshot.cwd);
  chunks.push(Buffer.from([snapshot.windowsVerbatimArguments ? 1 : 0]));
  const argumentCount = Buffer.allocUnsafe(4);
  argumentCount.writeUInt32BE(snapshot.args.length);
  chunks.push(argumentCount);
  for (const argument of snapshot.args) putString(argument);
  const entries = Object.entries(snapshot.env);
  const environmentCount = Buffer.allocUnsafe(4);
  environmentCount.writeUInt32BE(entries.length);
  chunks.push(environmentCount);
  for (const [key, value] of entries) {
    putString(key);
    putString(value);
  }
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}

function captureTransport(
  transport: WindowsAuthorityNativeTransport
): WindowsAuthorityNativeTransport {
  if (
    !transport ||
    typeof transport !== 'object' ||
    Array.isArray(transport) ||
    typeof transport.prepare !== 'function' ||
    typeof transport.probeIdentity !== 'function' ||
    typeof transport.activate !== 'function' ||
    typeof transport.inspect !== 'function' ||
    typeof transport.attemptGraceful !== 'function' ||
    typeof transport.terminate !== 'function' ||
    typeof transport.abort !== 'function'
  ) {
    throw new TypeError('Windows process-authority native transport is incomplete.');
  }
  return Object.freeze({
    prepare: transport.prepare.bind(transport),
    probeIdentity: transport.probeIdentity.bind(transport),
    activate: transport.activate.bind(transport),
    inspect: transport.inspect.bind(transport),
    attemptGraceful: transport.attemptGraceful.bind(transport),
    terminate: transport.terminate.bind(transport),
    abort: transport.abort.bind(transport),
  });
}

function captureRuntimeOpener(
  opener: WindowsAuthorityRuntimeOpener
): WindowsAuthorityRuntimeOpener {
  if (!opener || typeof opener !== 'object' || typeof opener.open !== 'function') {
    throw new TypeError('Windows process-authority runtime opener is incomplete.');
  }
  return Object.freeze({ open: opener.open.bind(opener) });
}

function retainedObservation(
  state: 'authority-unavailable' | 'authority-uncertain' | 'identity-drift' | 'event-gap',
  diagnosticCode: string
): ProviderObservation & ProviderControlOutcome {
  return Object.freeze({
    state,
    diagnostic: windowsRetainedDiagnostic(diagnosticCode),
  }) as ProviderObservation & ProviderControlOutcome;
}

function retainedPhaseOutcome(
  state: 'timeout' | 'control-loss',
  phase: AuthorityOperationContext['phase'],
  diagnosticCode: string
): ProviderObservation & ProviderControlOutcome {
  return Object.freeze({
    state,
    phase,
    diagnostic: windowsRetainedDiagnostic(diagnosticCode),
  }) as ProviderObservation & ProviderControlOutcome;
}

function classificationOutcome(
  classification: Extract<WindowsRecoveryClassification, { disposition: 'retained' }>,
  phase: AuthorityOperationContext['phase']
): ProviderObservation & ProviderControlOutcome {
  return classification.state === 'control-loss'
    ? retainedPhaseOutcome('control-loss', phase, classification.diagnosticCode)
    : retainedObservation(classification.state, classification.diagnosticCode);
}

function ledgerOutcome(
  result: Exclude<
    WindowsAuthorityPublicationLookup,
    { readonly state: 'prepared-inert' | 'published-inert' }
  >
): ProviderObservation {
  return result.state === 'event-gap'
    ? retainedObservation('event-gap', result.diagnosticCode)
    : retainedObservation('authority-uncertain', result.diagnosticCode);
}

function isExactNativeInert(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    exactKeys(value, ['state']) && (value as { state?: unknown }).state === 'inert';
}

function isReterminateSignal(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (value as { state?: unknown }).state === WINDOWS_RETERMINATE_SIGNAL;
}

function decodeForProvider(
  reference: ProviderAuthorityReference
): WindowsPrivateAuthorityReference | undefined {
  try {
    return decodeWindowsPrivateAuthorityReference(reference);
  } catch {
    return undefined;
  }
}

/**
 * Task 4.8. `design.md:202-204` enumerates the Windows unavailability causes and
 * promises each returns typed `authority-unavailable`. Section 8's census
 * measured what the helper actually emits for them — `reference-invalid`,
 * `native-uncertain`, and in one case a raw localized OS error — and **no probe
 * produced `authority-unavailable`** (`S8-F3`). This is the mapping that makes
 * the promise true, and it lives here rather than in the helper because the
 * helper's job is to report what it observed, not to decide the common contract's
 * verdict.
 *
 * The set is closed. An unrecognised code is *not* silently widened into
 * unavailable — it stays malformed, so a new native failure mode surfaces as a
 * loud rejection rather than as a quiet "prerequisites unavailable".
 */
const WINDOWS_UNAVAILABLE_PREREQUISITES: ReadonlyMap<string, string> = new Map([
  ['ambient-job-refuses-nesting', 'the host process is inside an ambient Job that refuses nesting'],
  ['job-limit-mask-differs', 'the Job limit mask could not be set to the exact expected value'],
  ['completion-port-associated-late', 'the completion port could not be associated on an empty Job'],
  ['boot-identity-unobtainable', 'no exact boot identity source is obtainable'],
  ['endpoint-not-first-instance', 'the control endpoint name could not be created as a first instance'],
  ['state-root-untrusted', 'the trusted state root is missing, wrongly owned, or reached through a reparse point'],
  ['artifact-unavailable', 'the resolved native artifact failed its manifest identity check'],
  ['native-unavailable', 'a native prerequisite is denied or unsupported on this host'],
]);

function unavailablePrerequisite(code: string): ProviderPreparationUnavailable {
  const cause = WINDOWS_UNAVAILABLE_PREREQUISITES.get(code);
  return Object.freeze({
    state: 'authority-unavailable',
    // Bounded: one sentence, a closed cause, and the code. No path, no SID, no
    // scope id, no capability, and nothing carried through from a native string.
    diagnostic: cause
      ? `selected provider prerequisites unavailable: ${cause} (${code})`
      : 'selected provider prerequisites unavailable',
  });
}

/**
 * Task 4.8's other half: revalidate every attested fact before `prepared-inert`
 * is returned. `SetInformationJobObject` succeeding is not evidence and neither
 * is a helper saying `inert` — the attested values are re-checked here against
 * the contract's expected constants, and a mismatch is typed unavailable rather
 * than a thrown malformation, because a mask that came back different is a
 * prerequisite this host did not meet, not a corrupt message.
 *
 * It runs on the **raw attestation**, before the private-reference codec. That
 * ordering is load-bearing and was not obvious: the codec already rejects a
 * wrong mask and a non-zero port count, but it rejects them by throwing
 * "private reference is malformed" — which is the wrong verdict. A host whose
 * Job would not take the exact mask has not sent us a corrupt message; it has
 * failed a prerequisite, and the contract says that is typed unavailable. The
 * first version of this function ran after the codec and was unreachable dead
 * code; the tests caught it.
 */
function revalidateAttestedFacts(
  record: Record<string, unknown>
): ProviderPreparationUnavailable | undefined {
  // Each check fires only when the field is PRESENT AND WRONG. An absent or
  // wrongly-typed field is a malformed message, not a failed prerequisite, and
  // must keep reaching the codec's rejection — otherwise a helper that simply
  // omitted a value would be reported as a host that cannot run the authority.
  if (
    typeof record.jobLimitMask === 'number' &&
    record.jobLimitMask !== WINDOWS_EXPECTED_JOB_LIMIT_MASK
  ) {
    return unavailablePrerequisite('job-limit-mask-differs');
  }
  if (
    typeof record.activeProcessCountAtPortAssociation === 'number' &&
    record.activeProcessCountAtPortAssociation !== 0
  ) {
    return unavailablePrerequisite('completion-port-associated-late');
  }
  if (
    typeof record.bootIdentitySource === 'string' &&
    !WINDOWS_BOOT_IDENTITY_SOURCES.includes(
      record.bootIdentitySource as (typeof WINDOWS_BOOT_IDENTITY_SOURCES)[number]
    )
  ) {
    return unavailablePrerequisite('boot-identity-unobtainable');
  }
  return undefined;
}

function createPreparedReference(
  identity: Pick<WindowsAuthorityNativePrepareRequest, 'preparationOperationId' | 'launchDigest'>,
  expectedArtifact: WindowsAuthorityExpectedArtifactIdentity,
  nativeResult: unknown
): ProviderAuthorityReference | ProviderPreparationUnavailable {
  if (!nativeResult || typeof nativeResult !== 'object' || Array.isArray(nativeResult)) {
    throw new TypeError('Windows process-authority prepare outcome is malformed.');
  }
  const result = nativeResult as Record<string, unknown>;
  if (
    result.state === 'authority-unavailable' &&
    exactKeys(result, ['state', 'diagnosticCode']) &&
    typeof result.diagnosticCode === 'string' &&
    (result.diagnosticCode === 'prepare-unavailable' ||
      WINDOWS_UNAVAILABLE_PREREQUISITES.has(result.diagnosticCode))
  ) {
    return unavailablePrerequisite(result.diagnosticCode);
  }
  if (result.state !== 'inert' || !exactKeys(result, ['state', 'attestation'])) {
    throw new TypeError('Windows process-authority prepare outcome is malformed.');
  }
  const attestation = result.attestation;
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw new TypeError('Windows process-authority prepare attestation is malformed.');
  }
  const record = attestation as Record<string, unknown>;
  if (
    record.preparationOperationId !== identity.preparationOperationId ||
    record.launchDigest !== identity.launchDigest ||
    record.helperProtocolVersion !== expectedArtifact.helperProtocolVersion ||
    record.artifactSha256 !== expectedArtifact.artifactSha256 ||
    record.sourceSha256 !== expectedArtifact.sourceSha256
  ) {
    throw new TypeError('Windows process-authority prepare attestation identity binding differs.');
  }
  // Task 4.8: revalidate the attested authority facts BEFORE the codec, so a
  // failed prerequisite is typed unavailable rather than "malformed reference".
  const unavailable = revalidateAttestedFacts(record);
  if (unavailable) return unavailable;
  // The scope id, generation and both capabilities are carried through exactly
  // as attested. Nothing here invents or backfills one.
  const reference = createWindowsPrivateAuthorityReference(
    record as unknown as WindowsPrivateAuthorityReferenceInput
  );
  const decoded = decodeWindowsPrivateAuthorityReference(reference);
  if (
    decoded.preparationOperationId !== identity.preparationOperationId ||
    decoded.launchDigest !== identity.launchDigest ||
    decoded.artifactSha256 !== expectedArtifact.artifactSha256 ||
    decoded.sourceSha256 !== expectedArtifact.sourceSha256
  ) {
    throw new TypeError('Windows process-authority prepare attestation identity binding differs.');
  }
  return reference;
}

function createBundle(
  descriptor: ProcessAuthorityProviderDescriptor,
  options: WindowsProcessAuthorityProviderBundleOptions
): WindowsProcessAuthorityProviderBundle {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, ['transport', 'runtimeOpener', 'ledger', 'artifactIdentity'])
  ) {
    throw new TypeError('Windows process-authority provider options are malformed.');
  }
  if (
    !options.artifactIdentity ||
    typeof options.artifactIdentity !== 'object' ||
    Array.isArray(options.artifactIdentity) ||
    !exactKeys(options.artifactIdentity, [
      'helperProtocolVersion',
      'artifactSha256',
      'sourceSha256',
    ]) ||
    options.artifactIdentity.helperProtocolVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(options.artifactIdentity.artifactSha256) ||
    !/^[a-f0-9]{64}$/.test(options.artifactIdentity.sourceSha256)
  ) {
    throw new TypeError('Windows process-authority expected artifact identity is malformed.');
  }
  const transport = captureTransport(options.transport);
  const runtimeOpener = captureRuntimeOpener(options.runtimeOpener);
  const publicationAccess = createWindowsAuthorityPublicationAccess(options.ledger);
  const publishAuthority = createWindowsAuthorityPublicationPublisher(options.ledger);
  const expectedArtifact = Object.freeze({ ...options.artifactIdentity });

  /**
   * Decision 9's ordering, enforced here rather than trusted to the helper:
   * decode and bounds-check with no native call, then read the identity tuple
   * before any handle exists, then read it again after every handle is open, and
   * require the complete tuple to be unchanged before anything is observed or
   * controlled.
   */
  const reopen = async (
    decoded: WindowsPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<WindowsRecoveryClassification> => {
    let preOpen: unknown;
    try {
      preOpen = await transport.probeIdentity(decoded, 'pre-open', context);
    } catch {
      return Object.freeze({
        disposition: 'retained',
        state: 'control-loss',
        diagnosticCode: 'native-transport-lost',
      });
    }
    const parsed = parseWindowsAuthorityIdentityProbe(preOpen);
    if (parsed?.state !== 'authority-present') {
      return classifyWindowsAuthorityRecovery(decoded, preOpen, undefined);
    }
    let postOpen: unknown;
    try {
      postOpen = await transport.probeIdentity(decoded, 'post-open', context);
    } catch {
      return Object.freeze({
        disposition: 'retained',
        state: 'control-loss',
        diagnosticCode: 'native-transport-lost',
      });
    }
    return classifyWindowsAuthorityRecovery(decoded, preOpen, postOpen);
  };

  const preparedAuthority = (
    reference: ProviderAuthorityReference,
    decoded: WindowsPrivateAuthorityReference
  ): ProviderPreparationResult => Object.freeze({
    reference,
    async activate(activateContext: AuthorityOperationContext): Promise<ProviderObservation> {
      // The exact durable record is required *before* the root is created, and
      // activation writes no publication state of its own. There is no publish
      // frame in the helper protocol and none is synthesized here.
      const publication = publicationAccess.requirePublished(descriptor, reference);
      if (publication.state !== 'published-inert') return ledgerOutcome(publication);
      return mapWindowsNativeObservation(
        await transport.activate(decoded, activateContext),
        'published-inert',
        activateContext.phase
      );
    },
  });

  const recordPreparedOrAbort = async (
    reference: ProviderAuthorityReference,
    decoded: WindowsPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<void> => {
    try {
      publicationAccess.recordPrepared(descriptor, reference);
    } catch (error) {
      await transport.abort(decoded, 'preparation-phase-journal-failed', context);
      throw new TypeError('Windows process-authority preparation phase could not be retained.', {
        cause: error,
      });
    }
  };

  /**
   * One authority-wide force request. The guardian converges on the authority's
   * own empty event and returns a terminal outcome or a bounded timeout; this
   * layer only bounds the request against the shared abort signal and refuses
   * to turn a non-terminal answer into an empty receipt.
   */
  const forceOnce = async (
    decoded: WindowsPrivateAuthorityReference,
    intent: AuthorityTerminationIntent,
    context: AuthorityOperationContext
  ): Promise<ProviderControlOutcome> => {
    if (context.signal.aborted) {
      return retainedPhaseOutcome('timeout', context.phase, 'terminate-deadline-expired');
    }
    const raw = await transport.terminate(decoded, intent, context);
    if (isReterminateSignal(raw)) {
      return retainedPhaseOutcome('control-loss', context.phase, 'native-transport-lost');
    }
    if (context.signal.aborted) {
      return retainedPhaseOutcome('timeout', context.phase, 'terminate-deadline-expired');
    }
    return mapWindowsNativeControlOutcome(raw, context.phase);
  };

  const provider: ProcessAuthorityProvider = Object.freeze({
    descriptor,
    async prepare(
      input: AuthorityPrepareInput,
      context: AuthorityOperationContext
    ): Promise<ProviderPreparationResult> {
      const exactInput = snapshotLaunch(input);
      const request: WindowsAuthorityNativePrepareRequest = Object.freeze({
        input: exactInput,
        preparationOperationId: context.operationId,
        launchDigest: digestWindowsAuthorityLaunch(exactInput),
      });
      const nativeResult = await transport.prepare(request, context);
      const reference = createPreparedReference(request, expectedArtifact, nativeResult);
      if (typeof reference !== 'string') return reference;
      const decoded = decodeWindowsPrivateAuthorityReference(reference);
      await recordPreparedOrAbort(reference, decoded, context);
      return preparedAuthority(reference, decoded);
    },
    async inspect(
      reference: ProviderAuthorityReference,
      context: AuthorityOperationContext
    ): Promise<ProviderObservation> {
      const decoded = decodeForProvider(reference);
      if (!decoded) return retainedObservation('authority-unavailable', 'reference-invalid');
      const classification = await reopen(decoded, context);
      if (classification.disposition === 'retained') {
        return classificationOutcome(classification, context.phase);
      }
      if (classification.disposition === 'exact-scope-empty') {
        return Object.freeze({ state: 'exact-scope-empty' });
      }
      const native = await transport.inspect(decoded, context);
      if (isExactNativeInert(native)) {
        const publication = publicationAccess.lookup(descriptor, reference);
        if (publication.state === 'prepared-inert' || publication.state === 'published-inert') {
          return mapWindowsNativeObservation(native, publication.state, context.phase);
        }
        return ledgerOutcome(publication);
      }
      return mapWindowsNativeObservation(native, 'prepared-inert', context.phase);
    },
    async terminate(
      reference: ProviderAuthorityReference,
      intent: AuthorityTerminationIntent,
      context: AuthorityOperationContext
    ): Promise<ProviderControlOutcome> {
      const decoded = decodeForProvider(reference);
      if (!decoded) return retainedObservation('authority-unavailable', 'reference-invalid');
      const classification = await reopen(decoded, context);
      if (classification.disposition === 'retained') {
        return classificationOutcome(classification, context.phase);
      }
      if (classification.disposition === 'exact-scope-empty') {
        return Object.freeze({ state: 'exact-scope-empty' });
      }
      if (intent.graceMs > 0) {
        // Deliberately discarded. A graceful step observing quiet is not an
        // empty event, so force is issued unconditionally and the receipt can
        // only ever come from the authority's own convergence.
        await transport.attemptGraceful(decoded, intent, context);
      }
      return forceOnce(decoded, intent, context);
    },
    async abort(
      reference: ProviderAuthorityReference,
      reason: string,
      context: AuthorityOperationContext
    ): Promise<ProviderControlOutcome> {
      const decoded = decodeForProvider(reference);
      if (!decoded) return retainedObservation('authority-unavailable', 'reference-invalid');
      const classification = await reopen(decoded, context);
      if (classification.disposition === 'retained') {
        return classificationOutcome(classification, context.phase);
      }
      if (classification.disposition === 'exact-scope-empty') {
        return Object.freeze({ state: 'exact-scope-empty' });
      }
      return mapWindowsNativeControlOutcome(
        await transport.abort(decoded, reason, context),
        context.phase
      );
    },
  });

  return Object.freeze({
    provider,
    publishAuthority,
    openRuntime(reference: ProcessAuthorityReference): ProviderBackedProcessRuntime {
      const decoded = decodeProcessAuthorityReferenceForDispatch(String(reference), descriptor);
      if (decoded.state !== 'dispatchable') {
        throw new TypeError('Windows process-authority runtime reference is unavailable.');
      }
      const privateReference = decodeForProvider(decoded.providerReference);
      if (!privateReference) {
        throw new TypeError('Windows process-authority runtime reference is unavailable.');
      }
      return runtimeOpener.open(privateReference);
    },
  });
}

/**
 * The injected seam. Production does not bypass it — `createWindowsProcess-
 * AuthorityProviderBundle` delegates here, so the assembled provider behaviour
 * is the same code in both cases and this is not a parallel implementation.
 */
export function createWindowsProcessAuthorityProviderBundleWithTransport(
  options: WindowsProcessAuthorityProviderBundleOptions
): WindowsProcessAuthorityProviderBundle {
  return createBundle(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, options);
}

function exactProductionStateRoot(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('Windows process-authority production state root is malformed.');
  }
  const root = path.resolve(value);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Windows process-authority production state root provenance is invalid.');
  }
  // Owner SID and DACL verification is not reachable from Node; the native
  // helper owns that check. This layer establishes the reparse-free real path
  // that every later validation is anchored to.
  return fs.realpathSync.native(root);
}

function exactProductionChildDirectory(stateRoot: string, name: string): string {
  const directory = path.join(stateRoot, name);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Windows process-authority production directory provenance is invalid.');
  }
  const realDirectory = fs.realpathSync.native(directory);
  if (path.dirname(realDirectory) !== stateRoot) {
    throw new TypeError('Windows process-authority production directory escaped its state root.');
  }
  return realDirectory;
}

/**
 * The fallback when no native assembly can be built - which in a source checkout
 * is the normal case, because `WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES` is
 * empty until packaging writes it and artifact resolution therefore cannot
 * succeed.
 *
 * Unavailability never selects another provider, never falls back to a process
 * group, a toolhelp snapshot, `taskkill`, WMI or the legacy capsule helper, and
 * never starts workload code. It returns typed unavailable and retains.
 */
function unavailableNativeAssembly(): Pick<
  WindowsProcessAuthorityProviderBundleOptions,
  'transport' | 'runtimeOpener' | 'artifactIdentity'
> {
  const retained = Object.freeze({
    state: 'authority-unavailable',
    diagnosticCode: 'artifact-unavailable',
  });
  return Object.freeze({
    artifactIdentity: Object.freeze({
      helperProtocolVersion: 1 as const,
      artifactSha256: 'e'.repeat(64),
      sourceSha256: 'f'.repeat(64),
    }),
    runtimeOpener: Object.freeze({
      open(): never {
        throw new TypeError('Windows process-authority native runtime is unavailable.');
      },
    }),
    transport: Object.freeze({
      async prepare() {
        return { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' };
      },
      async probeIdentity() {
        return { state: 'authority-unavailable', diagnosticCode: 'artifact-unavailable' };
      },
      async activate() { return retained; },
      async inspect() { return retained; },
      async attemptGraceful() { return { state: 'not-observed' }; },
      async terminate() { return retained; },
      async abort() { return retained; },
    }),
  });
}

/**
 * The production entry point. It is a thin, directly tested wrapper over the
 * injected seam: it validates the trusted state root, constructs the concrete
 * ledger beneath it, resolves the native assembly (fail-closed when no packaged
 * artifact is pinned), and delegates. It registers nothing as a ProcessScope
 * default.
 */
export function createWindowsProcessAuthorityProviderBundle(
  options: WindowsProcessAuthorityProductionOptions
): WindowsProcessAuthorityProviderBundle {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, ['stateRoot'])
  ) {
    throw new TypeError('Windows process-authority production options forbid dependency injection.');
  }
  const stateRoot = exactProductionStateRoot(options.stateRoot);
  const runtimeRoot = exactProductionChildDirectory(stateRoot, 'runtime');
  const publicationRoot = exactProductionChildDirectory(runtimeRoot, 'publication-ledger');
  const ledger = createWindowsAuthorityPublicationLedger({ root: publicationRoot });
  // The real assembly, exactly as the sibling provider wires its own
  // (`linux/provider.ts:1042`). Resolution is the only thing that can refuse it,
  // and it refuses by throwing, so the fallback below is reached when - and only
  // when - no packaged artifact is bound by build-pinned authority.
  let assembly: Pick<
    WindowsProcessAuthorityProviderBundleOptions,
    'transport' | 'runtimeOpener' | 'artifactIdentity'
  >;
  try {
    assembly = createWindowsNativeAssembly(runtimeRoot);
  } catch {
    assembly = unavailableNativeAssembly();
  }
  return createWindowsProcessAuthorityProviderBundleWithTransport({
    transport: assembly.transport,
    runtimeOpener: assembly.runtimeOpener,
    ledger,
    artifactIdentity: assembly.artifactIdentity,
  });
}
