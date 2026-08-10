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
import {
  decodeProcessAuthorityReferenceForDispatch,
} from '../reference-codec.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from './contracts.js';
import {
  createLinuxBrokerPrivateAuthorityReference,
  createLinuxPrimaryPrivateAuthorityReference,
  decodeLinuxPrivateAuthorityReference,
  type LinuxBrokerPrivateAuthorityReferenceInput,
  type LinuxPrivateAuthorityReference,
  type LinuxPrimaryPrivateAuthorityReferenceInput,
} from './private-reference.js';
import {
  createLinuxAuthorityPublicationAccess,
  createLinuxAuthorityPublicationLedger,
  createLinuxAuthorityPublicationPublisher,
  type LinuxAuthorityPublicationLedger,
  type LinuxAuthorityPublicationLookup,
} from './publication-ledger.js';
import {
  createLinuxBrokerNativeAssembly,
  createLinuxPrimaryNativeAssembly,
} from './native-assembly.js';
import {
  mapLinuxNativeControlOutcome,
  mapLinuxNativeObservation,
} from './outcomes.js';
import {
  assertLinuxBrokerPreparationDeliveryLedger,
  createLinuxBrokerPreparationDeliveryLedger,
  type LinuxBrokerPreparationDeliveryBinding,
  type LinuxBrokerPreparationDeliveryLedger,
  type LinuxBrokerPreparationDeliveryOrphan,
} from './preparation-delivery-ledger.js';

export type LinuxAuthorityMode = 'user-pidns' | 'broker-pidns-cgroupv2';

const MAX_LINUX_PATH_BYTES = 32 * 1024;
const MAX_LINUX_ARGUMENTS = 128;
const MAX_LINUX_ARGUMENT_BYTES = 128 * 1024;
const MAX_LINUX_ENVIRONMENT = 128;
const MAX_LINUX_ENVIRONMENT_KEY_BYTES = 1024;
const MAX_LINUX_ENVIRONMENT_VALUE_BYTES = 128 * 1024;
const LINUX_BROKER_PREPARATION_RECOVERY_BRAND = Symbol(
  'rasen.linux.broker-preparation-delivery-recovery'
);

export interface LinuxAuthorityNativePrepareRequest {
  readonly mode: LinuxAuthorityMode;
  readonly input: AuthorityPrepareInput;
  readonly preparationOperationId: string;
  readonly launchDigest: string;
}

export interface LinuxAuthorityExpectedArtifactIdentity {
  readonly helperProtocolVersion: 1;
  readonly artifactSha256: string;
  readonly sourceSha256: string;
}

export interface LinuxAuthorityPublicationCommit {
  readonly referenceDigest: string;
  readonly preparationOperationId: string;
  readonly generation: string;
  readonly launchDigest: string;
  readonly publicationOperationId: string;
}

export interface LinuxAuthorityNativeTransport {
  prepare(
    request: LinuxAuthorityNativePrepareRequest,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  preparationDeliveryDigest?(request: LinuxAuthorityNativePrepareRequest): string;
  prepareDelivery?(
    request: LinuxAuthorityNativePrepareRequest,
    binding: LinuxBrokerPreparationDeliveryBinding,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  recoverPreparedDelivery?(
    binding: LinuxBrokerPreparationDeliveryBinding,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  acknowledgePreparedDelivery?(
    reference: LinuxPrivateAuthorityReference,
    binding: LinuxBrokerPreparationDeliveryBinding,
    context: AuthorityOperationContext
  ): Promise<void>;
  abortPreparedDelivery?(
    binding: LinuxBrokerPreparationDeliveryBinding,
    reason: string,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  recordPublication?(
    reference: LinuxPrivateAuthorityReference,
    binding: LinuxAuthorityPublicationCommit,
    context: AuthorityOperationContext
  ): Promise<void>;
  activate(
    reference: LinuxPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  inspect(
    reference: LinuxPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  terminate(
    reference: LinuxPrivateAuthorityReference,
    intent: AuthorityTerminationIntent,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  abort(
    reference: LinuxPrivateAuthorityReference,
    reason: string,
    context: AuthorityOperationContext
  ): Promise<unknown>;
}

export interface LinuxAuthorityRuntimeOpener {
  open(reference: LinuxPrivateAuthorityReference): ProviderBackedProcessRuntime;
}

export interface LinuxBrokerPreparationDeliveryReconciliationEntry {
  readonly preparationOperationId: string;
  readonly initialState: LinuxBrokerPreparationDeliveryOrphan['state'];
  readonly disposition: 'acknowledged' | 'reconciled' | 'retained';
  readonly reference?: ProviderAuthorityReference;
  readonly retainedState?:
    | 'authority-unavailable'
    | 'authority-uncertain'
    | 'identity-drift'
    | 'event-gap'
    | 'timeout'
    | 'control-loss';
}

export interface LinuxBrokerPreparationDeliveryOrphanReconciliationResult {
  readonly visited: number;
  readonly acknowledged: number;
  readonly reconciled: number;
  readonly retained: number;
  readonly entries: readonly LinuxBrokerPreparationDeliveryReconciliationEntry[];
}

export interface LinuxBrokerPreparationDeliveryRecovery {
  readonly [LINUX_BROKER_PREPARATION_RECOVERY_BRAND]: true;
  recover(
    preparationOperationId: string,
    input: AuthorityPrepareInput,
    context: AuthorityOperationContext
  ): Promise<ProviderPreparationResult>;
  reconcileOrphans(
    context: AuthorityOperationContext
  ): Promise<LinuxBrokerPreparationDeliveryOrphanReconciliationResult>;
}

export interface LinuxProcessAuthorityProviderBundle {
  readonly provider: ProcessAuthorityProvider;
  readonly availability:
    | { readonly state: 'available' }
    | { readonly state: 'authority-unavailable'; readonly diagnostic: string };
  readonly publishAuthority: ReturnType<typeof createLinuxAuthorityPublicationPublisher>;
  readonly preparationDeliveryRecovery?: LinuxBrokerPreparationDeliveryRecovery;
  openRuntime(reference: ProcessAuthorityReference): ProviderBackedProcessRuntime;
}

export interface LinuxProcessAuthorityProviderBundleOptions {
  readonly transport: LinuxAuthorityNativeTransport;
  readonly runtimeOpener: LinuxAuthorityRuntimeOpener;
  readonly ledger: LinuxAuthorityPublicationLedger;
  readonly artifactIdentity: LinuxAuthorityExpectedArtifactIdentity;
  readonly deliveryLedger?: LinuxBrokerPreparationDeliveryLedger;
  /** Trusted assembly fact; test adapters default to available. */
  readonly runtimeAvailable?: boolean;
}

export interface LinuxProcessAuthorityProductionOptions {
  readonly stateRoot: string;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function snapshotLaunch(input: AuthorityPrepareInput): AuthorityPrepareInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Linux process-authority launch input is malformed.');
  }
  const keys = Object.keys(input).sort();
  const hasWindowsFlag = keys.includes('windowsVerbatimArguments');
  const expected = hasWindowsFlag
    ? ['args', 'command', 'cwd', 'env', 'windowsVerbatimArguments']
    : ['args', 'command', 'cwd', 'env'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Linux process-authority launch input is not closed.');
  }
  if (
    typeof input.command !== 'string' ||
    !path.posix.isAbsolute(input.command) ||
    input.command.includes('\0') ||
    Buffer.byteLength(input.command, 'utf8') > MAX_LINUX_PATH_BYTES ||
    typeof input.cwd !== 'string' ||
    !path.posix.isAbsolute(input.cwd) ||
    input.cwd.includes('\0') ||
    Buffer.byteLength(input.cwd, 'utf8') > MAX_LINUX_PATH_BYTES ||
    input.windowsVerbatimArguments === true ||
    !Array.isArray(input.args) ||
    input.args.length > MAX_LINUX_ARGUMENTS ||
    !input.args.every((argument) =>
      typeof argument === 'string' &&
      Buffer.byteLength(argument, 'utf8') <= MAX_LINUX_ARGUMENT_BYTES &&
      !argument.includes('\0')
    ) ||
    !input.env ||
    typeof input.env !== 'object' ||
    Array.isArray(input.env)
  ) {
    throw new TypeError('Linux process-authority launch input is malformed.');
  }
  const envKeys = Object.keys(input.env).sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  );
  if (envKeys.length > MAX_LINUX_ENVIRONMENT) {
    throw new TypeError('Linux process-authority launch environment exceeds its bound.');
  }
  const env = Object.create(null) as Record<string, string>;
  for (const key of envKeys) {
    const value = input.env[key];
    if (
      key.length === 0 ||
      Buffer.byteLength(key, 'utf8') > MAX_LINUX_ENVIRONMENT_KEY_BYTES ||
      key.includes('\0') ||
      key.includes('=') ||
      typeof value !== 'string' ||
      Buffer.byteLength(value, 'utf8') > MAX_LINUX_ENVIRONMENT_VALUE_BYTES ||
      value.includes('\0')
    ) {
      throw new TypeError('Linux process-authority launch environment is malformed.');
    }
    env[key] = value;
  }
  return Object.freeze({
    command: input.command,
    args: Object.freeze([...input.args]),
    cwd: input.cwd,
    env: Object.freeze(env),
  });
}

export function digestLinuxAuthorityLaunch(input: AuthorityPrepareInput): string {
  const snapshot = snapshotLaunch(input);
  const chunks: Buffer[] = [Buffer.from('RPL1', 'ascii')];
  const putString = (value: string): void => {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    chunks.push(length, bytes);
  };
  putString(snapshot.command);
  putString(snapshot.cwd);
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

function captureTransport(transport: LinuxAuthorityNativeTransport): LinuxAuthorityNativeTransport {
  if (
    !transport ||
    typeof transport !== 'object' ||
    Array.isArray(transport) ||
    typeof transport.prepare !== 'function' ||
    typeof transport.activate !== 'function' ||
    typeof transport.inspect !== 'function' ||
    typeof transport.terminate !== 'function' ||
    typeof transport.abort !== 'function'
  ) {
    throw new TypeError('Linux process-authority native transport is incomplete.');
  }
  return Object.freeze({
    prepare: transport.prepare.bind(transport),
    ...(typeof transport.preparationDeliveryDigest === 'function'
      ? { preparationDeliveryDigest: transport.preparationDeliveryDigest.bind(transport) }
      : {}),
    ...(typeof transport.prepareDelivery === 'function'
      ? { prepareDelivery: transport.prepareDelivery.bind(transport) }
      : {}),
    ...(typeof transport.recoverPreparedDelivery === 'function'
      ? { recoverPreparedDelivery: transport.recoverPreparedDelivery.bind(transport) }
      : {}),
    ...(typeof transport.acknowledgePreparedDelivery === 'function'
      ? { acknowledgePreparedDelivery: transport.acknowledgePreparedDelivery.bind(transport) }
      : {}),
    ...(typeof transport.abortPreparedDelivery === 'function'
      ? { abortPreparedDelivery: transport.abortPreparedDelivery.bind(transport) }
      : {}),
    ...(typeof transport.recordPublication === 'function'
      ? { recordPublication: transport.recordPublication.bind(transport) }
      : {}),
    activate: transport.activate.bind(transport),
    inspect: transport.inspect.bind(transport),
    terminate: transport.terminate.bind(transport),
    abort: transport.abort.bind(transport),
  });
}

function captureRuntimeOpener(opener: LinuxAuthorityRuntimeOpener): LinuxAuthorityRuntimeOpener {
  if (!opener || typeof opener !== 'object' || typeof opener.open !== 'function') {
    throw new TypeError('Linux process-authority runtime opener is incomplete.');
  }
  return Object.freeze({ open: opener.open.bind(opener) });
}

function ledgerOutcome(
  result: Exclude<LinuxAuthorityPublicationLookup, { readonly state: 'prepared-inert' | 'published-inert' }>,
  phase: AuthorityOperationContext['phase']
): ProviderObservation {
  if (result.state === 'event-gap') {
    return Object.freeze({
      state: 'event-gap',
      diagnostic: `Linux process authority is retained (${result.diagnosticCode}).`,
    });
  }
  return Object.freeze({
    state: 'authority-uncertain',
    diagnostic: `Linux process authority is retained (${result.diagnosticCode}).`,
    ...(phase === 'activate' && result.diagnosticCode === 'ledger-unavailable'
      ? {} : {}),
  });
}

function isExactNativeInert(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    exactKeys(value, ['state']) && (value as { state?: unknown }).state === 'inert';
}

function decodeForProvider(
  descriptor: ProcessAuthorityProviderDescriptor,
  reference: ProviderAuthorityReference
): LinuxPrivateAuthorityReference | undefined {
  try {
    const decoded = decodeLinuxPrivateAuthorityReference(reference);
    return decoded.providerId === descriptor.providerId ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function createPreparedReference(
  mode: LinuxAuthorityMode,
  identity: Pick<LinuxAuthorityNativePrepareRequest, 'preparationOperationId' | 'launchDigest'>,
  expectedArtifact: LinuxAuthorityExpectedArtifactIdentity,
  nativeResult: unknown
): ProviderAuthorityReference | ProviderPreparationUnavailable {
  if (!nativeResult || typeof nativeResult !== 'object' || Array.isArray(nativeResult)) {
    throw new TypeError('Linux process-authority prepare outcome is malformed.');
  }
  const result = nativeResult as Record<string, unknown>;
  if (
    result.state === 'authority-unavailable' &&
    exactKeys(result, ['state', 'diagnosticCode']) &&
    result.diagnosticCode === 'prepare-unavailable'
  ) {
    return Object.freeze({
      state: 'authority-unavailable',
      diagnostic: 'selected provider prerequisites unavailable',
    });
  }
  if (result.state !== 'inert' || !exactKeys(result, ['state', 'attestation'])) {
    throw new TypeError('Linux process-authority prepare outcome is malformed.');
  }
  const attestation = result.attestation;
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw new TypeError('Linux process-authority prepare attestation is malformed.');
  }
  const record = attestation as Record<string, unknown>;
  if (
    record.preparationOperationId !== identity.preparationOperationId ||
    record.launchDigest !== identity.launchDigest ||
    record.helperProtocolVersion !== expectedArtifact.helperProtocolVersion ||
    record.artifactSha256 !== expectedArtifact.artifactSha256 ||
    record.sourceSha256 !== expectedArtifact.sourceSha256
  ) {
    throw new TypeError('Linux process-authority prepare attestation identity binding differs.');
  }
  const reference = mode === 'user-pidns'
    ? createLinuxPrimaryPrivateAuthorityReference(
        record as unknown as LinuxPrimaryPrivateAuthorityReferenceInput
      )
    : createLinuxBrokerPrivateAuthorityReference(
        record as unknown as LinuxBrokerPrivateAuthorityReferenceInput
      );
  const decoded = decodeLinuxPrivateAuthorityReference(reference);
  if (
    decoded.preparationOperationId !== identity.preparationOperationId ||
    decoded.launchDigest !== identity.launchDigest ||
    decoded.artifactSha256 !== expectedArtifact.artifactSha256 ||
    decoded.sourceSha256 !== expectedArtifact.sourceSha256
  ) {
    throw new TypeError('Linux process-authority prepare attestation identity binding differs.');
  }
  return reference;
}

function assertPreparationRecoveryContext(context: AuthorityOperationContext): void {
  if (!context || typeof context !== 'object' || Array.isArray(context) ||
      !exactKeys(context, ['phase', 'operationId', 'deadline', 'signal']) ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(context.operationId) ||
      !Number.isFinite(context.deadline) || context.deadline <= 0 ||
      !context.signal || typeof context.signal !== 'object' ||
      typeof context.signal.aborted !== 'boolean') {
    throw new TypeError('Linux broker preparation delivery recovery context is malformed.');
  }
}

function assertPreparationRecoveryActive(context: AuthorityOperationContext): void {
  if (context.signal.aborted || performance.now() >= context.deadline) {
    throw new TypeError('Linux broker preparation delivery recovery expired or was cancelled.');
  }
}

function decodeExactBrokerDeliveryReference(
  reference: ProviderAuthorityReference,
  binding: LinuxBrokerPreparationDeliveryBinding,
  expectedArtifact: LinuxAuthorityExpectedArtifactIdentity
): LinuxPrivateAuthorityReference {
  const decoded = decodeLinuxPrivateAuthorityReference(reference);
  if (decoded.mode !== 'broker-pidns-cgroupv2' ||
      decoded.preparationOperationId !== binding.preparationOperationId ||
      decoded.launchDigest !== binding.launchDigest ||
      decoded.artifactSha256 !== expectedArtifact.artifactSha256 ||
      decoded.sourceSha256 !== expectedArtifact.sourceSha256) {
    throw new TypeError('Linux broker durable delivery reference identity differs.');
  }
  return decoded;
}

function createBundle(
  mode: LinuxAuthorityMode,
  descriptor: ProcessAuthorityProviderDescriptor,
  options: LinuxProcessAuthorityProviderBundleOptions
): LinuxProcessAuthorityProviderBundle {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, [
      'transport', 'runtimeOpener', 'ledger', 'artifactIdentity',
      ...(options.deliveryLedger === undefined ? [] : ['deliveryLedger']),
      ...(options.runtimeAvailable === undefined ? [] : ['runtimeAvailable']),
    ])
  ) {
    throw new TypeError('Linux process-authority provider options are malformed.');
  }
  const transport = captureTransport(options.transport);
  const runtimeOpener = captureRuntimeOpener(options.runtimeOpener);
  const publicationAccess = createLinuxAuthorityPublicationAccess(options.ledger);
  const ledgerPublisher = createLinuxAuthorityPublicationPublisher(options.ledger);
  if (mode === 'broker-pidns-cgroupv2' && typeof transport.recordPublication !== 'function') {
    throw new TypeError('Linux broker transport lacks the publisher-owned publication seam.');
  }
  const publishAuthority: ReturnType<typeof createLinuxAuthorityPublicationPublisher> =
    async (binding, context) => {
      const acknowledgement = await ledgerPublisher(binding, context);
      if (mode === 'broker-pidns-cgroupv2') {
        const decoded = decodeProcessAuthorityReferenceForDispatch(String(binding.reference), descriptor);
        if (decoded.state !== 'dispatchable') {
          throw new TypeError('Linux broker publication reference is not dispatchable.');
        }
        const privateReference = decodeForProvider(descriptor, decoded.providerReference);
        if (!privateReference) {
          throw new TypeError('Linux broker publication reference is invalid.');
        }
        await transport.recordPublication!(privateReference, Object.freeze({
          referenceDigest: binding.referenceDigest,
          preparationOperationId: binding.preparationOperationId,
          generation: privateReference.generation,
          launchDigest: privateReference.launchDigest,
          publicationOperationId: context.operationId,
        }), context);
      }
      return acknowledgement;
    };
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
    throw new TypeError('Linux process-authority expected artifact identity is malformed.');
  }
  const expectedArtifact = Object.freeze({ ...options.artifactIdentity });
  const deliveryLedger = options.deliveryLedger;
  if (mode === 'broker-pidns-cgroupv2' && deliveryLedger !== undefined &&
      (typeof transport.preparationDeliveryDigest !== 'function' ||
        typeof transport.prepareDelivery !== 'function' ||
        typeof transport.recoverPreparedDelivery !== 'function' ||
        typeof transport.acknowledgePreparedDelivery !== 'function' ||
        typeof transport.abortPreparedDelivery !== 'function')) {
    throw new TypeError('Linux broker transport lacks durable preparation delivery seams.');
  }
  if (deliveryLedger !== undefined) {
    assertLinuxBrokerPreparationDeliveryLedger(deliveryLedger);
  }

  const preparedAuthority = (
    reference: ProviderAuthorityReference,
    decoded: LinuxPrivateAuthorityReference
  ): ProviderPreparationResult => Object.freeze({
    reference,
    async activate(activateContext: AuthorityOperationContext): Promise<ProviderObservation> {
      const publication = publicationAccess.requirePublished(descriptor, reference);
      if (publication.state !== 'published-inert') {
        return ledgerOutcome(publication, activateContext.phase);
      }
      return mapLinuxNativeObservation(
        await transport.activate(decoded, activateContext),
        'published-inert',
        activateContext.phase
      );
    },
  });

  const recordPreparedOrAbort = async (
    reference: ProviderAuthorityReference,
    decoded: LinuxPrivateAuthorityReference,
    context: AuthorityOperationContext
  ): Promise<void> => {
    try {
      publicationAccess.recordPrepared(descriptor, reference);
    } catch (error) {
      await transport.abort(decoded, 'preparation-phase-journal-failed', context);
      throw new TypeError('Linux process-authority preparation phase could not be retained.', {
        cause: error,
      });
    }
  };

  let preparationDeliveryRecovery: LinuxBrokerPreparationDeliveryRecovery | undefined;
  if (mode === 'broker-pidns-cgroupv2' && deliveryLedger) {
    const recoveryLedger = deliveryLedger;
    const abortOrRetain = async (
      orphan: LinuxBrokerPreparationDeliveryOrphan,
      context: AuthorityOperationContext
    ): Promise<LinuxBrokerPreparationDeliveryReconciliationEntry> => {
      assertPreparationRecoveryActive(context);
      try {
        const outcome = mapLinuxNativeControlOutcome(
          await transport.abortPreparedDelivery!(
            orphan.binding,
            'fresh-controller-undelivered-preparation',
            context
          ),
          context.phase
        );
        assertPreparationRecoveryActive(context);
        if (outcome.state === 'exact-scope-empty') {
          recoveryLedger.reconcile(orphan.binding, 'exact-scope-empty');
          return Object.freeze({
            preparationOperationId: orphan.binding.preparationOperationId,
            initialState: orphan.state,
            disposition: 'reconciled',
          });
        }
        const retainedState = [
          'authority-unavailable', 'authority-uncertain', 'identity-drift',
          'event-gap', 'timeout', 'control-loss',
        ].includes(outcome.state)
          ? outcome.state as LinuxBrokerPreparationDeliveryReconciliationEntry['retainedState']
          : 'authority-uncertain';
        return Object.freeze({
          preparationOperationId: orphan.binding.preparationOperationId,
          initialState: orphan.state,
          disposition: 'retained',
          retainedState,
        });
      } catch {
        assertPreparationRecoveryActive(context);
        return Object.freeze({
          preparationOperationId: orphan.binding.preparationOperationId,
          initialState: orphan.state,
          disposition: 'retained',
          retainedState: 'control-loss',
        });
      }
    };

    const acknowledgeExactReference = async (
      orphan: LinuxBrokerPreparationDeliveryOrphan,
      reference: ProviderAuthorityReference,
      context: AuthorityOperationContext
    ): Promise<LinuxBrokerPreparationDeliveryReconciliationEntry> => {
      const decoded = decodeExactBrokerDeliveryReference(
        reference,
        orphan.binding,
        expectedArtifact
      );
      if (orphan.state === 'Intent') {
        recoveryLedger.storeReference(orphan.binding, reference);
      }
      assertPreparationRecoveryActive(context);
      try {
        publicationAccess.recordPrepared(descriptor, reference);
        await transport.acknowledgePreparedDelivery!(decoded, orphan.binding, context);
        assertPreparationRecoveryActive(context);
        recoveryLedger.acknowledge(orphan.binding);
      } catch {
        assertPreparationRecoveryActive(context);
        return Object.freeze({
          preparationOperationId: orphan.binding.preparationOperationId,
          initialState: orphan.state,
          disposition: 'retained',
          reference,
          retainedState: 'control-loss',
        });
      }
      return Object.freeze({
        preparationOperationId: orphan.binding.preparationOperationId,
        initialState: orphan.state,
        disposition: 'acknowledged',
        reference,
      });
    };

    const settleOrphan = async (
      orphan: LinuxBrokerPreparationDeliveryOrphan,
      context: AuthorityOperationContext
    ): Promise<LinuxBrokerPreparationDeliveryReconciliationEntry> => {
      assertPreparationRecoveryActive(context);
      let reference = orphan.reference;
      if (orphan.state === 'Intent') {
        try {
          const native = await transport.recoverPreparedDelivery!(orphan.binding, context);
          assertPreparationRecoveryActive(context);
          const prepared = createPreparedReference(
            mode,
            orphan.binding,
            expectedArtifact,
            native
          );
          if (typeof prepared !== 'string') return abortOrRetain(orphan, context);
          reference = prepared;
        } catch {
          assertPreparationRecoveryActive(context);
          return abortOrRetain(orphan, context);
        }
      }
      try {
        if (reference === undefined) throw new TypeError('Missing orphan reference.');
        return await acknowledgeExactReference(orphan, reference, context);
      } catch {
        assertPreparationRecoveryActive(context);
        return abortOrRetain(orphan, context);
      }
    };

    async function reconcileOrphans(
      context: AuthorityOperationContext
    ): Promise<LinuxBrokerPreparationDeliveryOrphanReconciliationResult> {
      if (arguments.length !== 1) {
        throw new TypeError(
          'Linux broker preparation delivery reconciliation forbids external callbacks.'
        );
      }
      assertPreparationRecoveryContext(context);
      assertPreparationRecoveryActive(context);
      const orphans = recoveryLedger.discoverPendingOrphans();
      assertPreparationRecoveryActive(context);
      const entries: LinuxBrokerPreparationDeliveryReconciliationEntry[] = [];
      for (const orphan of orphans) {
        assertPreparationRecoveryActive(context);
        entries.push(await settleOrphan(orphan, context));
        assertPreparationRecoveryActive(context);
      }
      return Object.freeze({
        visited: entries.length,
        acknowledged: entries.filter((entry) => entry.disposition === 'acknowledged').length,
        reconciled: entries.filter((entry) => entry.disposition === 'reconciled').length,
        retained: entries.filter((entry) => entry.disposition === 'retained').length,
        entries: Object.freeze(entries),
      });
    }

    async function recover(
      preparationOperationId: string,
      input: AuthorityPrepareInput,
      context: AuthorityOperationContext
    ): Promise<ProviderPreparationResult> {
      if (arguments.length !== 3 || context.phase !== 'prepare' ||
          context.operationId !== preparationOperationId ||
          !/^[A-Za-z0-9._:-]{1,128}$/.test(preparationOperationId)) {
        throw new TypeError('Linux broker preparation delivery recovery input is malformed.');
      }
      assertPreparationRecoveryContext(context);
      const exactInput = snapshotLaunch(input);
      const request: LinuxAuthorityNativePrepareRequest = Object.freeze({
        mode,
        input: exactInput,
        preparationOperationId,
        launchDigest: digestLinuxAuthorityLaunch(exactInput),
      });
      const reconciled = await reconcileOrphans(context);
      if (reconciled.retained > 0) {
        throw new TypeError(
          'Linux broker preparation delivery retains unresolved prior ownership.'
        );
      }
      assertPreparationRecoveryActive(context);
      const prepareDigest = transport.preparationDeliveryDigest!(request);
      const delivery = recoveryLedger.begin(
        preparationOperationId,
        prepareDigest,
        request.launchDigest,
        context
      );
      if (delivery.state === 'Reconciled') {
        throw new TypeError('Linux broker preparation delivery was already exactly reconciled.');
      }
      if (delivery.reference !== undefined) {
        const decoded = decodeExactBrokerDeliveryReference(
          delivery.reference,
          delivery.binding,
          expectedArtifact
        );
        if (delivery.state === 'ReferenceStored') {
          await recordPreparedOrAbort(delivery.reference, decoded, context);
          await transport.acknowledgePreparedDelivery!(decoded, delivery.binding, context);
          assertPreparationRecoveryActive(context);
          recoveryLedger.acknowledge(delivery.binding);
        } else {
          publicationAccess.recordPrepared(descriptor, delivery.reference);
        }
        return preparedAuthority(delivery.reference, decoded);
      }
      const native = delivery.created
        ? await transport.prepareDelivery!(request, delivery.binding, context)
        : await transport.recoverPreparedDelivery!(delivery.binding, context);
      assertPreparationRecoveryActive(context);
      const reference = createPreparedReference(mode, request, expectedArtifact, native);
      if (typeof reference !== 'string') return reference;
      const decoded = decodeExactBrokerDeliveryReference(
        reference,
        delivery.binding,
        expectedArtifact
      );
      recoveryLedger.storeReference(delivery.binding, reference);
      await recordPreparedOrAbort(reference, decoded, context);
      await transport.acknowledgePreparedDelivery!(decoded, delivery.binding, context);
      assertPreparationRecoveryActive(context);
      recoveryLedger.acknowledge(delivery.binding);
      return preparedAuthority(reference, decoded);
    }

    preparationDeliveryRecovery = Object.freeze({
      [LINUX_BROKER_PREPARATION_RECOVERY_BRAND]: true as const,
      recover,
      reconcileOrphans,
    });
  }

  const provider: ProcessAuthorityProvider = Object.freeze({
    descriptor,
    async prepare(
      input: AuthorityPrepareInput,
      context: AuthorityOperationContext
    ): Promise<ProviderPreparationResult> {
      if (preparationDeliveryRecovery) {
        return preparationDeliveryRecovery.recover(context.operationId, input, context);
      }
      const exactInput = snapshotLaunch(input);
      const request: LinuxAuthorityNativePrepareRequest = Object.freeze({
        mode,
        input: exactInput,
        preparationOperationId: context.operationId,
        launchDigest: digestLinuxAuthorityLaunch(exactInput),
      });
      const nativeResult = await transport.prepare(request, context);
      const reference = createPreparedReference(mode, request, expectedArtifact, nativeResult);
      if (typeof reference !== 'string') return reference;
      const decoded = decodeLinuxPrivateAuthorityReference(reference);
      await recordPreparedOrAbort(reference, decoded, context);
      return preparedAuthority(reference, decoded);
    },
    async inspect(
      reference: ProviderAuthorityReference,
      context: AuthorityOperationContext
    ): Promise<ProviderObservation> {
      const decoded = decodeForProvider(descriptor, reference);
      if (!decoded) {
        return Object.freeze({
          state: 'authority-unavailable',
          diagnostic: 'Linux process authority is retained (reference-invalid).',
        });
      }
      const native = await transport.inspect(decoded, context);
      if (isExactNativeInert(native)) {
        const publication = publicationAccess.lookup(descriptor, reference);
        if (publication.state === 'prepared-inert' || publication.state === 'published-inert') {
          return mapLinuxNativeObservation(native, publication.state, context.phase);
        }
        return ledgerOutcome(publication, context.phase);
      }
      return mapLinuxNativeObservation(native, 'prepared-inert', context.phase);
    },
    async terminate(
      reference: ProviderAuthorityReference,
      intent: AuthorityTerminationIntent,
      context: AuthorityOperationContext
    ): Promise<ProviderControlOutcome> {
      const decoded = decodeForProvider(descriptor, reference);
      if (!decoded) {
        return Object.freeze({
          state: 'authority-unavailable',
          diagnostic: 'Linux process authority is retained (reference-invalid).',
        });
      }
      return mapLinuxNativeControlOutcome(
        await transport.terminate(decoded, intent, context),
        context.phase
      );
    },
    async abort(
      reference: ProviderAuthorityReference,
      reason: string,
      context: AuthorityOperationContext
    ): Promise<ProviderControlOutcome> {
      const decoded = decodeForProvider(descriptor, reference);
      if (!decoded) {
        return Object.freeze({
          state: 'authority-unavailable',
          diagnostic: 'Linux process authority is retained (reference-invalid).',
        });
      }
      return mapLinuxNativeControlOutcome(
        await transport.abort(decoded, reason, context),
        context.phase
      );
    },
  });

  return Object.freeze({
    provider,
    availability: options.runtimeAvailable === false
      ? Object.freeze({
          state: 'authority-unavailable' as const,
          diagnostic: 'Linux process-authority runtime bridge is unavailable.',
        })
      : Object.freeze({ state: 'available' as const }),
    publishAuthority,
    ...(preparationDeliveryRecovery === undefined ? {} : { preparationDeliveryRecovery }),
    openRuntime(reference: ProcessAuthorityReference): ProviderBackedProcessRuntime {
      const decoded = decodeProcessAuthorityReferenceForDispatch(String(reference), descriptor);
      if (decoded.state !== 'dispatchable') {
        throw new TypeError('Linux process-authority runtime reference is unavailable.');
      }
      const privateReference = decodeForProvider(descriptor, decoded.providerReference);
      if (!privateReference) {
        throw new TypeError('Linux process-authority runtime reference is unavailable.');
      }
      return runtimeOpener.open(privateReference);
    },
  });
}

/** @internal Test-only injected adapter; not exported from the Linux production index. */
export function createLinuxPrimaryProcessAuthorityProviderBundleForTesting(
  options: LinuxProcessAuthorityProviderBundleOptions
): LinuxProcessAuthorityProviderBundle {
  return createBundle(
    'user-pidns',
    LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
    options
  );
}

/** @internal Test-only injected adapter; not exported from the Linux production index. */
export function createLinuxBrokerProcessAuthorityProviderBundleForTesting(
  options: LinuxProcessAuthorityProviderBundleOptions
): LinuxProcessAuthorityProviderBundle {
  return createBundle(
    'broker-pidns-cgroupv2',
    LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
    options
  );
}

function exactProductionStateRoot(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('Linux process-authority production state root is malformed.');
  }
  const root = path.resolve(value);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Linux process-authority production state root provenance is invalid.');
  }
  if (process.platform !== 'win32') {
    const uid = process.getuid?.();
    if ((uid !== undefined && stat.uid !== uid) || (stat.mode & 0o7777) !== 0o700) {
      throw new TypeError('Linux process-authority production state root ownership or mode is invalid.');
    }
  }
  const realRoot = fs.realpathSync.native(root);
  if (process.platform !== 'win32') {
    const uid = process.getuid?.();
    let ancestor = path.dirname(realRoot);
    while (true) {
      const ancestorStat = fs.lstatSync(ancestor);
      if (
        !ancestorStat.isDirectory() ||
        ancestorStat.isSymbolicLink() ||
        (uid !== undefined && ancestorStat.uid !== uid && ancestorStat.uid !== 0) ||
        (ancestorStat.mode & 0o7022) !== 0
      ) {
        throw new TypeError(
          'Linux process-authority production state ancestor ownership or mode is invalid.'
        );
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  return realRoot;
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
    throw new TypeError('Linux process-authority production directory provenance is invalid.');
  }
  if (process.platform !== 'win32') {
    const uid = process.getuid?.();
    if ((uid !== undefined && stat.uid !== uid) || (stat.mode & 0o7777) !== 0o700) {
      throw new TypeError('Linux process-authority production directory ownership or mode is invalid.');
    }
  }
  const realDirectory = fs.realpathSync.native(directory);
  if (path.dirname(realDirectory) !== stateRoot) {
    throw new TypeError('Linux process-authority production directory escaped its state root.');
  }
  return realDirectory;
}

function unavailableNativeAssembly(): {
  readonly transport: LinuxAuthorityNativeTransport;
  readonly runtimeOpener: LinuxAuthorityRuntimeOpener;
  readonly artifactIdentity: LinuxAuthorityExpectedArtifactIdentity;
} {
  const retained = Object.freeze({
    state: 'authority-unavailable',
    diagnosticCode: 'artifact-unavailable',
  });
  return Object.freeze({
    artifactIdentity: Object.freeze({
      helperProtocolVersion: 1,
      artifactSha256: 'e'.repeat(64),
      sourceSha256: 'f'.repeat(64),
    }),
    runtimeOpener: Object.freeze({
      open(): never {
        throw new TypeError('Linux process-authority native runtime is unavailable.');
      },
    }),
    transport: Object.freeze({
      async prepare() {
        return { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' };
      },
      async recordPublication() {
        throw new TypeError('Linux process-authority native publication is unavailable.');
      },
      async activate() { return retained; },
      async inspect() { return retained; },
      async terminate() { return retained; },
      async abort() { return retained; },
    }),
  });
}

function productionBundle(
  mode: LinuxAuthorityMode,
  options: LinuxProcessAuthorityProductionOptions
): LinuxProcessAuthorityProviderBundle {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactKeys(options, ['stateRoot'])
  ) {
    throw new TypeError('Linux process-authority production options forbid dependency injection.');
  }
  const stateRoot = exactProductionStateRoot(options.stateRoot);
  const runtimeRoot = exactProductionChildDirectory(stateRoot, 'runtime');
  // The native guardian overmounts runtimeRoot with a mode-000 tmpfs inside the
  // workload mount namespace. Keeping publication truth beneath that exact root
  // makes it path-inaccessible to the same mapped workload UID.
  const publicationRoot = exactProductionChildDirectory(runtimeRoot, 'publication-ledger');
  const deliveryRoot = mode === 'broker-pidns-cgroupv2'
    ? exactProductionChildDirectory(runtimeRoot, 'preparation-delivery-ledger')
    : undefined;
  const ledger = createLinuxAuthorityPublicationLedger({ root: publicationRoot });
  const deliveryLedger = deliveryRoot === undefined
    ? undefined
    : createLinuxBrokerPreparationDeliveryLedger({ root: deliveryRoot });
  let assembly = unavailableNativeAssembly();
  let runtimeAvailable = false;
  let durablePreparationDeliveryAvailable = false;
  if (mode === 'user-pidns') {
    try {
      assembly = createLinuxPrimaryNativeAssembly(runtimeRoot);
      runtimeAvailable = true;
    } catch {
      assembly = unavailableNativeAssembly();
    }
  } else {
    try {
      assembly = createLinuxBrokerNativeAssembly(runtimeRoot);
      runtimeAvailable = true;
      durablePreparationDeliveryAvailable = true;
    } catch {
      assembly = unavailableNativeAssembly();
    }
  }
  return createBundle(
    mode,
    mode === 'user-pidns'
      ? LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR
      : LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
    {
      transport: assembly.transport,
      runtimeOpener: assembly.runtimeOpener,
      ledger,
      ...(deliveryLedger === undefined || !durablePreparationDeliveryAvailable
        ? {}
        : { deliveryLedger }),
      artifactIdentity: assembly.artifactIdentity,
      runtimeAvailable,
    }
  );
}

export function createLinuxPrimaryProcessAuthorityProviderBundle(
  options: LinuxProcessAuthorityProductionOptions
): LinuxProcessAuthorityProviderBundle {
  return productionBundle('user-pidns', options);
}

export function createLinuxBrokerProcessAuthorityProviderBundle(
  options: LinuxProcessAuthorityProductionOptions
): LinuxProcessAuthorityProviderBundle {
  return productionBundle('broker-pidns-cgroupv2', options);
}
