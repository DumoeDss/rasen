import { createHash, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  createProviderAuthorityReference,
  providerAuthorityReferenceBytesForDispatch,
} from '../reference-codec.js';
import type { ProviderAuthorityReference } from '../types.js';
import {
  WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
  WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
} from './contracts.js';

const REFERENCE_SCHEMA = 'rasen-windows-process-authority-reference/1' as const;
const MAX_REFERENCE_BYTES = 2_048;

/** `JOBOBJECT_BASIC_LIMIT_INFORMATION.LimitFlags` bits this provider reasons about. */
export const JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x0000_0800;
export const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x0000_1000;
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;

/**
 * Kill-on-job-close set, both breakaway permissions clear, every other limit
 * clear. `SetInformationJobObject` succeeding is not evidence; the preparer
 * reads the mask back and this codec requires bit-exact equality, so a Job whose
 * observed mask permits breakaway can never be minted into a durable reference.
 */
export const WINDOWS_EXPECTED_JOB_LIMIT_MASK = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

/**
 * Boot identity must be exact. Tick-derived values (`GetTickCount64`, unbiased
 * interrupt time, system-time subtraction) move across sleep, hibernate and
 * clock adjustment and are therefore not enumerable here at all.
 *
 * Both entries are *values read from the kernel*. The named-pipe namespace's
 * non-persistence across a reboot is a second, independent proof and is
 * deliberately absent from this list: the two fail in different ways — the
 * identity value can be unobtainable on an edition where the source is denied,
 * while the endpoint proof can only be defeated by an attacker who already
 * holds the scope id — so naming the namespace as an identity *source* would
 * collapse them and leave one failure mode silently uncovered.
 */
export const WINDOWS_BOOT_IDENTITY_SOURCES = Object.freeze([
  'nt-system-boot-environment-information',
  'nt-system-time-of-day-boot-time',
] as const);

export type WindowsBootIdentitySource = (typeof WINDOWS_BOOT_IDENTITY_SOURCES)[number];

const REFERENCE_KEYS = Object.freeze([
  'schema',
  'providerId',
  'referenceVersion',
  'scopeId',
  'generation',
  'scopeCapability',
  'controlCapability',
  'preparationOperationId',
  'launchDigest',
  'bootIdentity',
  'bootIdentitySource',
  'guardianProcessId',
  'guardianCreationTime',
  'endpointOwnerSid',
  'stateRootOwnerSid',
  'jobLimitMask',
  'activeProcessCountAtPortAssociation',
  'soleHandleAttestation',
  'helperProtocolVersion',
  'artifactSha256',
  'sourceSha256',
] as const);

export interface WindowsPrivateAuthorityReferenceInput {
  /** Native-generated random one-use scope id; also names the control endpoint. */
  readonly scopeId: string;
  readonly generation: string;
  readonly scopeCapability: string;
  readonly controlCapability: string;
  readonly preparationOperationId: string;
  readonly launchDigest: string;
  readonly bootIdentity: string;
  readonly bootIdentitySource: WindowsBootIdentitySource;
  readonly guardianProcessId: number;
  /** Exact `GetProcessTimes` creation `FILETIME`, as an unsigned 64-bit decimal string. */
  readonly guardianCreationTime: string;
  readonly endpointOwnerSid: string;
  readonly stateRootOwnerSid: string;
  readonly jobLimitMask: number;
  /** Attests the completion port was associated while the Job was still empty. */
  readonly activeProcessCountAtPortAssociation: number;
  readonly soleHandleAttestation: string;
  readonly helperProtocolVersion: typeof WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION;
  readonly artifactSha256: string;
  readonly sourceSha256: string;
}

export interface WindowsPrivateAuthorityReference
  extends WindowsPrivateAuthorityReferenceInput {
  readonly schema: typeof REFERENCE_SCHEMA;
  readonly providerId: typeof WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID;
  readonly referenceVersion: typeof WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION;
}

interface ReferenceBody extends Record<string, unknown> {
  readonly integrityAlgorithm: 'sha256';
  readonly integrityDigest: string;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function canonicalBase64Url(value: unknown, bytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === bytes && decoded.toString('base64url') === value;
}

function digest(value: object): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function orderedRecord(
  value: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validU64(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)) return false;
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}

/**
 * `S-1-<authority>-<sub-authority>...`. Bounded to the documented 15
 * sub-authority maximum so a reference can never carry an unbounded string.
 */
function validSid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^S-1-(?:\d{1,10}|0x[0-9a-f]{12})(?:-\d{1,10}){1,15}$/.test(value);
}

function validBootIdentity(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value) &&
    /[1-9a-f]/.test(value);
}

function validFields(value: Record<string, unknown>): boolean {
  return value.schema === REFERENCE_SCHEMA &&
    value.providerId === WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID &&
    value.referenceVersion === WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION &&
    canonicalBase64Url(value.scopeId, 16) &&
    canonicalBase64Url(value.generation, 16) &&
    canonicalBase64Url(value.scopeCapability, 32) &&
    canonicalBase64Url(value.controlCapability, 32) &&
    value.scopeCapability !== value.controlCapability &&
    typeof value.preparationOperationId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value.preparationOperationId) &&
    validDigest(value.launchDigest) &&
    validBootIdentity(value.bootIdentity) &&
    typeof value.bootIdentitySource === 'string' &&
    (WINDOWS_BOOT_IDENTITY_SOURCES as readonly string[]).includes(value.bootIdentitySource) &&
    Number.isSafeInteger(value.guardianProcessId) &&
    Number(value.guardianProcessId) > 0 &&
    Number(value.guardianProcessId) <= 0xff_ff_ff_ff &&
    validU64(value.guardianCreationTime) &&
    value.guardianCreationTime !== '0' &&
    validSid(value.endpointOwnerSid) &&
    validSid(value.stateRootOwnerSid) &&
    value.jobLimitMask === WINDOWS_EXPECTED_JOB_LIMIT_MASK &&
    value.activeProcessCountAtPortAssociation === 0 &&
    canonicalBase64Url(value.soleHandleAttestation, 32) &&
    value.helperProtocolVersion === WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION &&
    validDigest(value.artifactSha256) &&
    validDigest(value.sourceSha256);
}

function validatePreimage(value: Record<string, unknown>): WindowsPrivateAuthorityReference {
  if (!exactKeys(value, REFERENCE_KEYS) || !validFields(value)) {
    throw new TypeError('Windows process-authority private reference is malformed.');
  }
  return Object.freeze(orderedRecord(value, REFERENCE_KEYS)) as unknown as
    WindowsPrivateAuthorityReference;
}

function encode(preimage: Record<string, unknown>): ProviderAuthorityReference {
  const canonicalPreimage = validatePreimage(preimage);
  const body: ReferenceBody = {
    ...canonicalPreimage,
    integrityAlgorithm: 'sha256',
    integrityDigest: digest(canonicalPreimage),
  };
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  if (bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new TypeError('Windows process-authority private reference exceeds its bound.');
  }
  return createProviderAuthorityReference(WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION, bytes);
}

/**
 * The scope id, generation and both capabilities are attested native values.
 * This layer validates and preserves them; it never generates or backfills one.
 */
export function createWindowsPrivateAuthorityReference(
  input: WindowsPrivateAuthorityReferenceInput
): ProviderAuthorityReference {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Windows process-authority private reference is malformed.');
  }
  return encode({
    schema: REFERENCE_SCHEMA,
    providerId: WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
    referenceVersion: WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
    scopeId: input.scopeId,
    generation: input.generation,
    scopeCapability: input.scopeCapability,
    controlCapability: input.controlCapability,
    preparationOperationId: input.preparationOperationId,
    launchDigest: input.launchDigest,
    bootIdentity: input.bootIdentity,
    bootIdentitySource: input.bootIdentitySource,
    guardianProcessId: input.guardianProcessId,
    guardianCreationTime: input.guardianCreationTime,
    endpointOwnerSid: input.endpointOwnerSid,
    stateRootOwnerSid: input.stateRootOwnerSid,
    jobLimitMask: input.jobLimitMask,
    activeProcessCountAtPortAssociation: input.activeProcessCountAtPortAssociation,
    soleHandleAttestation: input.soleHandleAttestation,
    helperProtocolVersion: input.helperProtocolVersion,
    artifactSha256: input.artifactSha256,
    sourceSha256: input.sourceSha256,
  });
}

export function decodeWindowsPrivateAuthorityReference(
  reference: ProviderAuthorityReference
): WindowsPrivateAuthorityReference {
  try {
    if (!String(reference).startsWith(
      `rasen-provider-authority/${WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION}:`
    )) {
      throw new TypeError('future reference');
    }
    const bytes = Buffer.from(providerAuthorityReferenceBytesForDispatch(reference));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_BYTES) {
      throw new TypeError('bounded reference');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('reference object');
    }
    const body = parsed as Record<string, unknown>;
    if (
      !exactKeys(body, [...REFERENCE_KEYS, 'integrityAlgorithm', 'integrityDigest']) ||
      body.integrityAlgorithm !== 'sha256' ||
      !validDigest(body.integrityDigest)
    ) {
      throw new TypeError('closed reference');
    }
    const preimage = Object.fromEntries(
      Object.entries(body).filter(
        ([key]) => key !== 'integrityAlgorithm' && key !== 'integrityDigest'
      )
    );
    const decoded = validatePreimage(preimage);
    const expectedDigest = digest(decoded);
    if (!timingSafeEqual(
      Buffer.from(expectedDigest, 'hex'),
      Buffer.from(body.integrityDigest, 'hex')
    )) {
      throw new TypeError('reference integrity');
    }
    const canonicalBody = {
      ...decoded,
      integrityAlgorithm: 'sha256',
      integrityDigest: expectedDigest,
    };
    if (JSON.stringify(canonicalBody) !== text) throw new TypeError('noncanonical reference');
    return decoded;
  } catch {
    throw new TypeError('Windows process-authority private reference is malformed.');
  }
}

export interface WindowsPrivateAuthorityReferenceDiagnostic {
  readonly classification: 'redacted-windows-process-authority-reference';
  readonly providerId: typeof WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID;
  readonly protocolVersion: typeof WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION;
  readonly providerReferenceVersion: typeof WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION;
  /** One-way digest of the full sensitive reference; cannot be replayed for control. */
  readonly referenceDigest: string;
}

/**
 * The scope id, both capabilities, the endpoint path and the guardian identity
 * never reach diagnostics. Only the redacted tuple and a one-way digest do.
 */
export function toWindowsPrivateAuthorityReferenceDiagnostic(
  reference: ProviderAuthorityReference
): WindowsPrivateAuthorityReferenceDiagnostic {
  decodeWindowsPrivateAuthorityReference(reference);
  return Object.freeze({
    classification: 'redacted-windows-process-authority-reference',
    providerId: WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
    protocolVersion: WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION,
    providerReferenceVersion: WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
    referenceDigest: createHash('sha256').update(String(reference), 'utf8').digest('hex'),
  });
}
