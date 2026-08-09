import { createHash, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';

import type {
  ProcessAuthorityProviderDescriptor,
  ProcessAuthorityReference,
  ProcessAuthoritySelection,
  ProviderAuthorityReference,
} from './types.js';

const PROCESS_AUTHORITY_REFERENCE_PREFIX = 'rasen-process-authority/1:';
const PROVIDER_AUTHORITY_REFERENCE_PATTERN =
  /^rasen-provider-authority\/([1-9][0-9]{0,8}):([A-Za-z0-9_-]+)$/;
const PROCESS_AUTHORITY_REFERENCE_PATTERN =
  /^rasen-process-authority\/([1-9][0-9]{0,8}):([A-Za-z0-9_-]+)$/;
const IDENTITY_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/;
const KNOWN_ENVELOPE_VERSION = 1;
const MAX_PROVIDER_REFERENCE_BYTES = 4096;
const MAX_ENVELOPE_BYTES = 16 * 1024;
const ENVELOPE_KEYS = Object.freeze([
  'schemaVersion',
  'providerId',
  'capabilityId',
  'protocolVersion',
  'providerReferenceVersion',
  'providerReferenceBytes',
  'integrityAlgorithm',
  'integrityDigest',
] as const);

interface EnvelopePreimage {
  readonly schemaVersion: typeof KNOWN_ENVELOPE_VERSION;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly protocolVersion: number;
  readonly providerReferenceVersion: number;
  readonly providerReferenceBytes: string;
  readonly integrityAlgorithm: 'sha256';
}

interface EnvelopeBody extends EnvelopePreimage {
  readonly integrityDigest: string;
}

export interface DispatchableProcessAuthorityReference {
  readonly state: 'dispatchable';
  readonly reference: ProcessAuthorityReference;
  readonly selection: ProcessAuthoritySelection;
  readonly providerReferenceVersion: number;
  readonly providerReference: ProviderAuthorityReference;
  readonly integrityIdentity: string;
}

export type ProcessAuthorityReferenceFailureReason =
  | 'malformed-reference'
  | 'unknown-envelope-version'
  | 'integrity-mismatch'
  | 'tuple-mismatch'
  | 'provider-reference-version-mismatch';

export interface NonDispatchableProcessAuthorityReference {
  readonly state: 'authority-unavailable';
  readonly reason: ProcessAuthorityReferenceFailureReason;
  readonly reference: string;
  readonly diagnostic: string;
}

export type ProcessAuthorityReferenceDecodeResult =
  | DispatchableProcessAuthorityReference
  | NonDispatchableProcessAuthorityReference;

function fail(
  reference: string,
  reason: ProcessAuthorityReferenceFailureReason,
  diagnostic: string
): NonDispatchableProcessAuthorityReference {
  return Object.freeze({ state: 'authority-unavailable', reason, reference, diagnostic });
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function decodeCanonicalBase64Url(value: string, maximumBytes: number): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.byteLength === 0 ||
    decoded.byteLength > maximumBytes ||
    decoded.toString('base64url') !== value
  ) {
    return undefined;
  }
  return decoded;
}

function providerReferenceParts(reference: ProviderAuthorityReference): {
  version: number;
  bytes: Buffer;
} {
  const match = PROVIDER_AUTHORITY_REFERENCE_PATTERN.exec(String(reference));
  if (!match) throw new TypeError('Provider authority reference is malformed.');
  const version = Number(match[1]);
  const bytes = decodeCanonicalBase64Url(match[2], MAX_PROVIDER_REFERENCE_BYTES);
  if (!isPositiveVersion(version) || !bytes) {
    throw new TypeError('Provider authority reference is malformed or exceeds its bound.');
  }
  return { version, bytes };
}

export function createProviderAuthorityReference(
  providerReferenceVersion: number,
  bytes: Uint8Array
): ProviderAuthorityReference {
  if (!isPositiveVersion(providerReferenceVersion)) {
    throw new TypeError('Provider-reference version must be a positive safe integer.');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROVIDER_REFERENCE_BYTES) {
    throw new TypeError('Provider authority bytes are empty or exceed their bound.');
  }
  const copy = Buffer.from(bytes);
  return `rasen-provider-authority/${providerReferenceVersion}:${copy.toString('base64url')}` as ProviderAuthorityReference;
}

export function providerAuthorityReferenceBytesForDispatch(
  reference: ProviderAuthorityReference
): Uint8Array {
  return Uint8Array.from(providerReferenceParts(reference).bytes);
}

function preimage(
  descriptor: Pick<
    ProcessAuthorityProviderDescriptor,
    'providerId' | 'capabilityId' | 'protocolVersion' | 'providerReferenceVersion'
  >,
  providerReferenceBytes: string
): EnvelopePreimage {
  return {
    schemaVersion: KNOWN_ENVELOPE_VERSION,
    providerId: descriptor.providerId,
    capabilityId: descriptor.capabilityId,
    protocolVersion: descriptor.protocolVersion,
    providerReferenceVersion: descriptor.providerReferenceVersion,
    providerReferenceBytes,
    integrityAlgorithm: 'sha256',
  };
}

/** Corruption/canonical-identity digest only; never provider identity or signer authority. */
function digest(value: EnvelopePreimage): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function encodeBody(value: EnvelopePreimage): ProcessAuthorityReference {
  const body: EnvelopeBody = { ...value, integrityDigest: digest(value) };
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  if (bytes.byteLength > MAX_ENVELOPE_BYTES) {
    throw new TypeError('Process-authority envelope exceeds its bound.');
  }
  return `${PROCESS_AUTHORITY_REFERENCE_PREFIX}${bytes.toString('base64url')}` as ProcessAuthorityReference;
}

export function encodeProcessAuthorityReference(
  descriptor: ProcessAuthorityProviderDescriptor,
  providerReference: ProviderAuthorityReference
): ProcessAuthorityReference {
  if (!IDENTITY_PATTERN.test(descriptor.providerId) || !IDENTITY_PATTERN.test(descriptor.capabilityId)) {
    throw new TypeError('Process-authority descriptor identity is malformed.');
  }
  if (!isPositiveVersion(descriptor.protocolVersion) || !isPositiveVersion(descriptor.providerReferenceVersion)) {
    throw new TypeError('Process-authority descriptor version is malformed.');
  }
  const provider = providerReferenceParts(providerReference);
  if (provider.version !== descriptor.providerReferenceVersion) {
    throw new TypeError('Provider authority reference version does not match its descriptor.');
  }
  return encodeBody(preimage(descriptor, provider.bytes.toString('base64url')));
}

function parseKnownEnvelope(reference: string, encoded: string): EnvelopeBody | NonDispatchableProcessAuthorityReference {
  const bytes = decodeCanonicalBase64Url(encoded, MAX_ENVELOPE_BYTES);
  if (!bytes) return fail(reference, 'malformed-reference', 'Process-authority envelope encoding is malformed.');
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return fail(reference, 'malformed-reference', 'Process-authority envelope body is malformed.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(reference, 'malformed-reference', 'Process-authority envelope body is not an object.');
  }
  const fields = value as Partial<Record<(typeof ENVELOPE_KEYS)[number], unknown>>;
  const keys = Object.keys(value);
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    keys.some((key) => !ENVELOPE_KEYS.includes(key as (typeof ENVELOPE_KEYS)[number])) ||
    fields.schemaVersion !== KNOWN_ENVELOPE_VERSION ||
    typeof fields.providerId !== 'string' ||
    !IDENTITY_PATTERN.test(fields.providerId) ||
    typeof fields.capabilityId !== 'string' ||
    !IDENTITY_PATTERN.test(fields.capabilityId) ||
    !isPositiveVersion(fields.protocolVersion) ||
    !isPositiveVersion(fields.providerReferenceVersion) ||
    typeof fields.providerReferenceBytes !== 'string' ||
    !decodeCanonicalBase64Url(fields.providerReferenceBytes, MAX_PROVIDER_REFERENCE_BYTES) ||
    fields.integrityAlgorithm !== 'sha256' ||
    typeof fields.integrityDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(fields.integrityDigest)
  ) {
    return fail(reference, 'malformed-reference', 'Process-authority envelope schema or bounds are invalid.');
  }
  const knownPreimage = preimage(
    {
      providerId: fields.providerId,
      capabilityId: fields.capabilityId,
      protocolVersion: fields.protocolVersion,
      providerReferenceVersion: fields.providerReferenceVersion,
    },
    fields.providerReferenceBytes
  );
  const expectedDigest = digest(knownPreimage);
  const actualDigest = fields.integrityDigest;
  if (!timingSafeEqual(Buffer.from(expectedDigest, 'hex'), Buffer.from(actualDigest, 'hex'))) {
    return fail(reference, 'integrity-mismatch', 'Process-authority envelope integrity does not match.');
  }
  const body: EnvelopeBody = { ...knownPreimage, integrityDigest: actualDigest };
  if (JSON.stringify(body) !== text) {
    return fail(reference, 'malformed-reference', 'Process-authority envelope is not canonical.');
  }
  return body;
}

export function decodeProcessAuthorityReferenceForDispatch(
  reference: string,
  expectedDescriptor?: ProcessAuthorityProviderDescriptor
): ProcessAuthorityReferenceDecodeResult {
  if (reference.length > PROCESS_AUTHORITY_REFERENCE_PREFIX.length + MAX_ENVELOPE_BYTES * 2) {
    return fail(reference, 'malformed-reference', 'Process-authority reference exceeds its bound.');
  }
  const match = PROCESS_AUTHORITY_REFERENCE_PATTERN.exec(reference);
  if (!match) return fail(reference, 'malformed-reference', 'Process-authority reference is malformed.');
  const version = Number(match[1]);
  const boundedFutureBytes = decodeCanonicalBase64Url(match[2], MAX_ENVELOPE_BYTES);
  if (!boundedFutureBytes) {
    return fail(reference, 'malformed-reference', 'Process-authority envelope encoding is malformed.');
  }
  if (version !== KNOWN_ENVELOPE_VERSION) {
    return fail(
      reference,
      'unknown-envelope-version',
      'Process-authority envelope version is not supported by this runtime.'
    );
  }
  const parsed = parseKnownEnvelope(reference, match[2]);
  if ('state' in parsed) return parsed;
  if (
    expectedDescriptor &&
    (parsed.providerId !== expectedDescriptor.providerId ||
      parsed.capabilityId !== expectedDescriptor.capabilityId ||
      parsed.protocolVersion !== expectedDescriptor.protocolVersion)
  ) {
    return fail(reference, 'tuple-mismatch', 'Process-authority provider tuple does not match.');
  }
  if (
    expectedDescriptor &&
    parsed.providerReferenceVersion !== expectedDescriptor.providerReferenceVersion
  ) {
    return fail(
      reference,
      'provider-reference-version-mismatch',
      'Process-authority provider-reference version does not match.'
    );
  }
  const providerBytes = decodeCanonicalBase64Url(
    parsed.providerReferenceBytes,
    MAX_PROVIDER_REFERENCE_BYTES
  );
  if (!providerBytes) {
    return fail(reference, 'malformed-reference', 'Provider authority reference is malformed.');
  }
  return Object.freeze({
    state: 'dispatchable',
    reference: reference as ProcessAuthorityReference,
    selection: Object.freeze({
      providerId: parsed.providerId,
      capabilityId: parsed.capabilityId,
      protocolVersion: parsed.protocolVersion,
    }),
    providerReferenceVersion: parsed.providerReferenceVersion,
    providerReference: createProviderAuthorityReference(
      parsed.providerReferenceVersion,
      providerBytes
    ),
    integrityIdentity: parsed.integrityDigest,
  });
}

export function reencodeProcessAuthorityReference(
  decoded: DispatchableProcessAuthorityReference
): ProcessAuthorityReference {
  const provider = providerReferenceParts(decoded.providerReference);
  return encodeBody(preimage({
    ...decoded.selection,
    providerReferenceVersion: decoded.providerReferenceVersion,
  }, provider.bytes.toString('base64url')));
}

export interface ProcessAuthorityReferenceView {
  readonly classification: 'redacted-process-authority-reference';
  readonly schemaVersion: typeof KNOWN_ENVELOPE_VERSION;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly protocolVersion: number;
  readonly providerReferenceVersion: number;
  /** One-way digest of the full sensitive reference; cannot be replayed for control. */
  readonly referenceDigest: string;
}

export function toProcessAuthorityReferenceView(
  reference: ProcessAuthorityReference
): ProcessAuthorityReferenceView {
  const decoded = decodeProcessAuthorityReferenceForDispatch(String(reference));
  if (decoded.state !== 'dispatchable') {
    throw new TypeError('Cannot redact a malformed process-authority reference.');
  }
  return Object.freeze({
    classification: 'redacted-process-authority-reference',
    schemaVersion: KNOWN_ENVELOPE_VERSION,
    providerId: decoded.selection.providerId,
    capabilityId: decoded.selection.capabilityId,
    protocolVersion: decoded.selection.protocolVersion,
    providerReferenceVersion: decoded.providerReferenceVersion,
    referenceDigest: createHash('sha256').update(String(reference), 'utf8').digest('hex'),
  });
}
