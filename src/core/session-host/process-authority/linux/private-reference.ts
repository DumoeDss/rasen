import { createHash, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  createProviderAuthorityReference,
  providerAuthorityReferenceBytesForDispatch,
} from '../reference-codec.js';
import type { ProviderAuthorityReference } from '../types.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID,
  LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID,
  LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
} from './contracts.js';

const REFERENCE_SCHEMA = 'rasen-linux-process-authority-reference/1' as const;
const MAX_REFERENCE_BYTES = 2_048;
const PRIMARY_KEYS = Object.freeze([
  'schema',
  'mode',
  'providerId',
  'referenceVersion',
  'generation',
  'scopeCapability',
  'controlCapability',
  'preparationOperationId',
  'launchDigest',
  'bootId',
  'guardianPid',
  'guardianStartTicks',
  'pidNamespaceDevice',
  'pidNamespaceInode',
  'helperProtocolVersion',
  'artifactSha256',
  'sourceSha256',
] as const);
const BROKER_EXTENSION_KEYS = Object.freeze([
  'brokerInstallSha256',
  'brokerKeyId',
  'brokerLeaseToken',
  'cgroupDevice',
  'cgroupInode',
] as const);

export interface LinuxPrimaryPrivateAuthorityReferenceInput {
  readonly generation: string;
  readonly scopeCapability: string;
  readonly controlCapability: string;
  readonly preparationOperationId: string;
  readonly launchDigest: string;
  readonly bootId: string;
  readonly guardianPid: number;
  readonly guardianStartTicks: string;
  readonly pidNamespaceDevice: string;
  readonly pidNamespaceInode: string;
  readonly helperProtocolVersion: typeof LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION;
  readonly artifactSha256: string;
  readonly sourceSha256: string;
}

export interface LinuxBrokerPrivateAuthorityReferenceInput
  extends LinuxPrimaryPrivateAuthorityReferenceInput {
  readonly brokerInstallSha256: string;
  readonly brokerKeyId: string;
  readonly brokerLeaseToken: string;
  readonly cgroupDevice: string;
  readonly cgroupInode: string;
}

export interface LinuxPrimaryPrivateAuthorityReference
  extends LinuxPrimaryPrivateAuthorityReferenceInput {
  readonly schema: typeof REFERENCE_SCHEMA;
  readonly mode: 'user-pidns';
  readonly providerId: typeof LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID;
  readonly referenceVersion: typeof LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION;
}

export interface LinuxBrokerPrivateAuthorityReference
  extends LinuxBrokerPrivateAuthorityReferenceInput {
  readonly schema: typeof REFERENCE_SCHEMA;
  readonly mode: 'broker-pidns-cgroupv2';
  readonly providerId: typeof LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID;
  readonly referenceVersion: typeof LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION;
}

export type LinuxPrivateAuthorityReference =
  | LinuxPrimaryPrivateAuthorityReference
  | LinuxBrokerPrivateAuthorityReference;

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

function validCommonFields(value: Record<string, unknown>): boolean {
  return value.schema === REFERENCE_SCHEMA &&
    value.referenceVersion === LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION &&
    canonicalBase64Url(value.generation, 16) &&
    canonicalBase64Url(value.scopeCapability, 32) &&
    canonicalBase64Url(value.controlCapability, 32) &&
    typeof value.preparationOperationId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(value.preparationOperationId) &&
    validDigest(value.launchDigest) &&
    typeof value.bootId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.bootId) &&
    Number.isSafeInteger(value.guardianPid) &&
    Number(value.guardianPid) > 0 &&
    validU64(value.guardianStartTicks) &&
    validU64(value.pidNamespaceDevice) &&
    validU64(value.pidNamespaceInode) &&
    value.helperProtocolVersion === LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION &&
    validDigest(value.artifactSha256) &&
    validDigest(value.sourceSha256);
}

function validatePreimage(value: Record<string, unknown>): LinuxPrivateAuthorityReference {
  const primary = value.mode === 'user-pidns';
  const broker = value.mode === 'broker-pidns-cgroupv2';
  const expected = broker ? [...PRIMARY_KEYS, ...BROKER_EXTENSION_KEYS] : [...PRIMARY_KEYS];
  if (!exactKeys(value, expected) || !validCommonFields(value)) {
    throw new TypeError('Linux process-authority private reference is malformed.');
  }
  if (
    primary &&
    value.providerId === LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID
  ) {
    return Object.freeze(orderedRecord(value, expected)) as unknown as
      LinuxPrimaryPrivateAuthorityReference;
  }
  if (
    broker &&
    value.providerId === LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID &&
    validDigest(value.brokerInstallSha256) &&
    validDigest(value.brokerKeyId) &&
    canonicalBase64Url(value.brokerLeaseToken, 32) &&
    validU64(value.cgroupDevice) &&
    validU64(value.cgroupInode)
  ) {
    return Object.freeze(orderedRecord(value, expected)) as unknown as
      LinuxBrokerPrivateAuthorityReference;
  }
  throw new TypeError('Linux process-authority private reference is malformed.');
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
    throw new TypeError('Linux process-authority private reference exceeds its bound.');
  }
  return createProviderAuthorityReference(LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION, bytes);
}

export function createLinuxPrimaryPrivateAuthorityReference(
  input: LinuxPrimaryPrivateAuthorityReferenceInput
): ProviderAuthorityReference {
  return encode({
    schema: REFERENCE_SCHEMA,
    mode: 'user-pidns',
    providerId: LINUX_PRIMARY_PROCESS_AUTHORITY_PROVIDER_ID,
    referenceVersion: LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
    ...input,
  });
}

export function createLinuxBrokerPrivateAuthorityReference(
  input: LinuxBrokerPrivateAuthorityReferenceInput
): ProviderAuthorityReference {
  return encode({
    schema: REFERENCE_SCHEMA,
    mode: 'broker-pidns-cgroupv2',
    providerId: LINUX_BROKER_PROCESS_AUTHORITY_PROVIDER_ID,
    referenceVersion: LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
    generation: input.generation,
    scopeCapability: input.scopeCapability,
    controlCapability: input.controlCapability,
    preparationOperationId: input.preparationOperationId,
    launchDigest: input.launchDigest,
    bootId: input.bootId,
    guardianPid: input.guardianPid,
    guardianStartTicks: input.guardianStartTicks,
    pidNamespaceDevice: input.pidNamespaceDevice,
    pidNamespaceInode: input.pidNamespaceInode,
    helperProtocolVersion: input.helperProtocolVersion,
    artifactSha256: input.artifactSha256,
    sourceSha256: input.sourceSha256,
    brokerInstallSha256: input.brokerInstallSha256,
    brokerKeyId: input.brokerKeyId,
    brokerLeaseToken: input.brokerLeaseToken,
    cgroupDevice: input.cgroupDevice,
    cgroupInode: input.cgroupInode,
  });
}

export function decodeLinuxPrivateAuthorityReference(
  reference: ProviderAuthorityReference
): LinuxPrivateAuthorityReference {
  try {
    if (!String(reference).startsWith(`rasen-provider-authority/${LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION}:`)) {
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
    const mode = body.mode;
    const expected = mode === 'broker-pidns-cgroupv2'
      ? [...PRIMARY_KEYS, ...BROKER_EXTENSION_KEYS, 'integrityAlgorithm', 'integrityDigest']
      : [...PRIMARY_KEYS, 'integrityAlgorithm', 'integrityDigest'];
    if (
      !exactKeys(body, expected) ||
      body.integrityAlgorithm !== 'sha256' ||
      !validDigest(body.integrityDigest)
    ) {
      throw new TypeError('closed reference');
    }
    const preimage = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'integrityAlgorithm' && key !== 'integrityDigest')
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
    throw new TypeError('Linux process-authority private reference is malformed.');
  }
}

export interface LinuxPrivateAuthorityReferenceDiagnostic {
  readonly classification: 'redacted-linux-process-authority-reference';
  readonly providerId: LinuxPrivateAuthorityReference['providerId'];
  readonly mode: LinuxPrivateAuthorityReference['mode'];
  readonly protocolVersion: typeof LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION;
  readonly providerReferenceVersion: typeof LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION;
  readonly referenceDigest: string;
}

export function toLinuxPrivateAuthorityReferenceDiagnostic(
  reference: ProviderAuthorityReference
): LinuxPrivateAuthorityReferenceDiagnostic {
  const decoded = decodeLinuxPrivateAuthorityReference(reference);
  return Object.freeze({
    classification: 'redacted-linux-process-authority-reference',
    providerId: decoded.providerId,
    mode: decoded.mode,
    protocolVersion: LINUX_PROCESS_AUTHORITY_PROTOCOL_VERSION,
    providerReferenceVersion: LINUX_PROCESS_AUTHORITY_REFERENCE_VERSION,
    referenceDigest: createHash('sha256').update(String(reference), 'utf8').digest('hex'),
  });
}
