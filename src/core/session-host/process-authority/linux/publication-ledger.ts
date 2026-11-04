import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  PROCESS_AUTHORITY_PUBLICATION_VERSION,
  createProcessAuthorityPublicationAcknowledgement,
  type ProcessAuthorityPublicationBinding,
  type ProcessAuthorityPublisher,
} from '../coordinator.js';
import {
  decodeProcessAuthorityReferenceForDispatch,
  encodeProcessAuthorityReference,
  reencodeProcessAuthorityReference,
} from '../reference-codec.js';
import type {
  AuthorityOperationContext,
  ProcessAuthorityProviderDescriptor,
  ProcessAuthorityReference,
  ProviderAuthorityReference,
} from '../types.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from './contracts.js';
import {
  decodeLinuxPrivateAuthorityReference,
  type LinuxPrivateAuthorityReference,
} from './private-reference.js';

const RECORD_SCHEMA = 'rasen-linux-authority-publication/1' as const;
const RECORD_VERSION = 1 as const;
const HEAD_SCHEMA = 'rasen-linux-authority-publication-head/1' as const;
const PHASE_SCHEMA = 'rasen-linux-authority-phase-journal/1' as const;
const MAX_RECORD_BYTES = 16 * 1024;
const RECORD_KEYS = Object.freeze([
  'schema',
  'recordVersion',
  'referenceDigest',
  'preparationOperationId',
  'publicationVersion',
  'providerId',
  'protocolVersion',
  'providerReferenceVersion',
  'generation',
  'launchDigest',
  'publicationOperationId',
  'integrityAlgorithm',
  'integrityDigest',
] as const);
const HEAD_KEYS = Object.freeze([
  'schema',
  'recordVersion',
  'referenceDigest',
  'preparationOperationId',
  'providerId',
  'protocolVersion',
  'providerReferenceVersion',
  'generation',
  'launchDigest',
  'integrityAlgorithm',
  'integrityDigest',
] as const);
const PHASE_KEYS = Object.freeze([
  'schema',
  'recordVersion',
  'phaseSequence',
  'phase',
  'referenceDigest',
  'preparationOperationId',
  'providerId',
  'protocolVersion',
  'providerReferenceVersion',
  'generation',
  'launchDigest',
  'integrityAlgorithm',
  'integrityDigest',
] as const);
const authenticLedgers = new WeakSet<LinuxAuthorityPublicationLedger>();

export type LinuxAuthorityPublicationLookup =
  | { readonly state: 'prepared-inert' }
  | { readonly state: 'published-inert' }
  | {
      readonly state: 'authority-uncertain';
      readonly diagnosticCode: 'ledger-malformed' | 'ledger-missing' | 'ledger-unavailable';
    }
  | { readonly state: 'event-gap'; readonly diagnosticCode: 'ledger-conflict' };

interface PublicationIdentity {
  readonly reference: ProcessAuthorityReference;
  readonly referenceDigest: string;
  readonly descriptor: ProcessAuthorityProviderDescriptor;
  readonly providerReference: ProviderAuthorityReference;
  readonly privateReference: LinuxPrivateAuthorityReference;
}

interface PublicationRecordPreimage {
  readonly schema: typeof RECORD_SCHEMA;
  readonly recordVersion: typeof RECORD_VERSION;
  readonly referenceDigest: string;
  readonly preparationOperationId: string;
  readonly publicationVersion: typeof PROCESS_AUTHORITY_PUBLICATION_VERSION;
  readonly providerId: string;
  readonly protocolVersion: number;
  readonly providerReferenceVersion: number;
  readonly generation: string;
  readonly launchDigest: string;
  readonly publicationOperationId: string;
  readonly integrityAlgorithm: 'sha256';
}

interface PublicationRecord extends PublicationRecordPreimage {
  readonly integrityDigest: string;
}

interface PublicationHeadPreimage {
  readonly schema: typeof HEAD_SCHEMA;
  readonly recordVersion: typeof RECORD_VERSION;
  readonly referenceDigest: string;
  readonly preparationOperationId: string;
  readonly providerId: string;
  readonly protocolVersion: number;
  readonly providerReferenceVersion: number;
  readonly generation: string;
  readonly launchDigest: string;
  readonly integrityAlgorithm: 'sha256';
}

interface PublicationHead extends PublicationHeadPreimage {
  readonly integrityDigest: string;
}

interface PhaseRecordPreimage {
  readonly schema: typeof PHASE_SCHEMA;
  readonly recordVersion: typeof RECORD_VERSION;
  readonly phaseSequence: 1 | 2;
  readonly phase: 'prepared' | 'published';
  readonly referenceDigest: string;
  readonly preparationOperationId: string;
  readonly providerId: string;
  readonly protocolVersion: number;
  readonly providerReferenceVersion: number;
  readonly generation: string;
  readonly launchDigest: string;
  readonly integrityAlgorithm: 'sha256';
}

interface PhaseRecord extends PhaseRecordPreimage {
  readonly integrityDigest: string;
}

export interface LinuxAuthorityPublicationLedgerOptions {
  readonly root: string;
}

interface LedgerRootIdentity {
  readonly realPath: string;
  readonly device: bigint;
  readonly inode: bigint;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function sameDescriptor(
  actual: ProcessAuthorityProviderDescriptor,
  expected: ProcessAuthorityProviderDescriptor
): boolean {
  return actual.providerId === expected.providerId &&
    actual.capabilityId === expected.capabilityId &&
    actual.protocolVersion === expected.protocolVersion &&
    actual.commonContractVersion === expected.commonContractVersion &&
    actual.providerReferenceVersion === expected.providerReferenceVersion &&
    actual.semantics.length === expected.semantics.length &&
    actual.semantics.every((semantic, index) => semantic === expected.semantics[index]);
}

function exactLinuxDescriptor(
  descriptor: ProcessAuthorityProviderDescriptor
): ProcessAuthorityProviderDescriptor {
  if (sameDescriptor(descriptor, LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR)) {
    return LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR;
  }
  if (sameDescriptor(descriptor, LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR)) {
    return LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR;
  }
  throw new TypeError('Linux authority publication descriptor is not exact.');
}

function descriptorForProviderId(providerId: string): ProcessAuthorityProviderDescriptor {
  if (providerId === LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId) {
    return LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR;
  }
  if (providerId === LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR.providerId) {
    return LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR;
  }
  throw new TypeError('Linux authority publication provider is not exact.');
}

function publicationIdentity(
  descriptor: ProcessAuthorityProviderDescriptor,
  providerReference: ProviderAuthorityReference
): PublicationIdentity {
  const exactDescriptor = exactLinuxDescriptor(descriptor);
  const privateReference = decodeLinuxPrivateAuthorityReference(providerReference);
  if (privateReference.providerId !== exactDescriptor.providerId) {
    throw new TypeError('Linux authority publication provider reference does not match its descriptor.');
  }
  const reference = encodeProcessAuthorityReference(exactDescriptor, providerReference);
  return Object.freeze({
    reference,
    referenceDigest: sha256(String(reference)),
    descriptor: exactDescriptor,
    providerReference,
    privateReference,
  });
}

function identityFromBinding(binding: ProcessAuthorityPublicationBinding): PublicationIdentity {
  if (
    !binding ||
    typeof binding !== 'object' ||
    Array.isArray(binding) ||
    !exactKeys(binding, [
      'reference',
      'referenceDigest',
      'preparationOperationId',
      'publicationVersion',
    ]) ||
    binding.publicationVersion !== PROCESS_AUTHORITY_PUBLICATION_VERSION
  ) {
    throw new TypeError('Linux authority publication binding is malformed.');
  }
  const decoded = decodeProcessAuthorityReferenceForDispatch(String(binding.reference));
  if (decoded.state !== 'dispatchable' || reencodeProcessAuthorityReference(decoded) !== binding.reference) {
    throw new TypeError('Linux authority publication binding reference is not canonical.');
  }
  const descriptor = descriptorForProviderId(decoded.selection.providerId);
  const identity = publicationIdentity(descriptor, decoded.providerReference);
  if (
    identity.reference !== binding.reference ||
    identity.referenceDigest !== binding.referenceDigest ||
    identity.privateReference.preparationOperationId !== binding.preparationOperationId
  ) {
    throw new TypeError('Linux authority publication binding identity or operation differs.');
  }
  return identity;
}

function recordPreimage(
  identity: PublicationIdentity,
  context: AuthorityOperationContext
): PublicationRecordPreimage {
  if (
    context.phase !== 'publish' ||
    typeof context.operationId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(context.operationId) ||
    context.signal.aborted
  ) {
    throw new TypeError('Linux authority publication operation context is malformed or cancelled.');
  }
  return Object.freeze({
    schema: RECORD_SCHEMA,
    recordVersion: RECORD_VERSION,
    referenceDigest: identity.referenceDigest,
    preparationOperationId: identity.privateReference.preparationOperationId,
    publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION,
    providerId: identity.descriptor.providerId,
    protocolVersion: identity.descriptor.protocolVersion,
    providerReferenceVersion: identity.descriptor.providerReferenceVersion,
    generation: identity.privateReference.generation,
    launchDigest: identity.privateReference.launchDigest,
    publicationOperationId: context.operationId,
    integrityAlgorithm: 'sha256',
  });
}

function completeRecord(preimage: PublicationRecordPreimage): PublicationRecord {
  return Object.freeze({
    ...preimage,
    integrityDigest: sha256(JSON.stringify(preimage)),
  });
}

function completeHead(identity: PublicationIdentity): PublicationHead {
  const preimage: PublicationHeadPreimage = Object.freeze({
    schema: HEAD_SCHEMA,
    recordVersion: RECORD_VERSION,
    referenceDigest: identity.referenceDigest,
    preparationOperationId: identity.privateReference.preparationOperationId,
    providerId: identity.descriptor.providerId,
    protocolVersion: identity.descriptor.protocolVersion,
    providerReferenceVersion: identity.descriptor.providerReferenceVersion,
    generation: identity.privateReference.generation,
    launchDigest: identity.privateReference.launchDigest,
    integrityAlgorithm: 'sha256',
  });
  return Object.freeze({
    ...preimage,
    integrityDigest: sha256(JSON.stringify(preimage)),
  });
}

function completePhase(
  identity: PublicationIdentity,
  phase: 'prepared' | 'published'
): PhaseRecord {
  const preimage: PhaseRecordPreimage = Object.freeze({
    schema: PHASE_SCHEMA,
    recordVersion: RECORD_VERSION,
    phaseSequence: phase === 'prepared' ? 1 : 2,
    phase,
    referenceDigest: identity.referenceDigest,
    preparationOperationId: identity.privateReference.preparationOperationId,
    providerId: identity.descriptor.providerId,
    protocolVersion: identity.descriptor.protocolVersion,
    providerReferenceVersion: identity.descriptor.providerReferenceVersion,
    generation: identity.privateReference.generation,
    launchDigest: identity.privateReference.launchDigest,
    integrityAlgorithm: 'sha256',
  });
  return Object.freeze({
    ...preimage,
    integrityDigest: sha256(JSON.stringify(preimage)),
  });
}

function validRecordShape(value: Record<string, unknown>): boolean {
  return exactKeys(value, RECORD_KEYS) &&
    value.schema === RECORD_SCHEMA &&
    value.recordVersion === RECORD_VERSION &&
    typeof value.referenceDigest === 'string' && /^[a-f0-9]{64}$/.test(value.referenceDigest) &&
    typeof value.preparationOperationId === 'string' &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(value.preparationOperationId) &&
    value.publicationVersion === PROCESS_AUTHORITY_PUBLICATION_VERSION &&
    (value.providerId === LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId ||
      value.providerId === LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR.providerId) &&
    value.protocolVersion === 1 &&
    value.providerReferenceVersion === 1 &&
    typeof value.generation === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value.generation) &&
    typeof value.launchDigest === 'string' && /^[a-f0-9]{64}$/.test(value.launchDigest) &&
    typeof value.publicationOperationId === 'string' &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(value.publicationOperationId) &&
    value.integrityAlgorithm === 'sha256' &&
    typeof value.integrityDigest === 'string' && /^[a-f0-9]{64}$/.test(value.integrityDigest);
}

function parseRecord(text: string): PublicationRecord | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!validRecordShape(record)) return undefined;
    const { integrityDigest, ...preimage } = record as unknown as PublicationRecord;
    const expected = sha256(JSON.stringify(preimage));
    if (!timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(integrityDigest, 'hex')
    )) {
      return undefined;
    }
    if (JSON.stringify({ ...preimage, integrityDigest }) !== text) return undefined;
    return Object.freeze({ ...preimage, integrityDigest }) as PublicationRecord;
  } catch {
    return undefined;
  }
}

function parseHead(text: string): PublicationHead | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
      !exactKeys(record, HEAD_KEYS) ||
      record.schema !== HEAD_SCHEMA ||
      record.recordVersion !== RECORD_VERSION ||
      typeof record.referenceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.referenceDigest) ||
      typeof record.preparationOperationId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(record.preparationOperationId) ||
      (record.providerId !== LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId &&
        record.providerId !== LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR.providerId) ||
      record.protocolVersion !== 1 ||
      record.providerReferenceVersion !== 1 ||
      typeof record.generation !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(record.generation) ||
      typeof record.launchDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.launchDigest) ||
      record.integrityAlgorithm !== 'sha256' ||
      typeof record.integrityDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.integrityDigest)
    ) {
      return undefined;
    }
    const { integrityDigest, ...preimage } = record as unknown as PublicationHead;
    const expected = sha256(JSON.stringify(preimage));
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integrityDigest, 'hex'))) {
      return undefined;
    }
    if (JSON.stringify({ ...preimage, integrityDigest }) !== text) return undefined;
    return Object.freeze({ ...preimage, integrityDigest }) as PublicationHead;
  } catch {
    return undefined;
  }
}

function parsePhaseRecord(text: string): PhaseRecord | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (
      !exactKeys(record, PHASE_KEYS) ||
      record.schema !== PHASE_SCHEMA ||
      record.recordVersion !== RECORD_VERSION ||
      !((record.phaseSequence === 1 && record.phase === 'prepared') ||
        (record.phaseSequence === 2 && record.phase === 'published')) ||
      typeof record.referenceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.referenceDigest) ||
      typeof record.preparationOperationId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(record.preparationOperationId) ||
      (record.providerId !== LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId &&
        record.providerId !== LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR.providerId) ||
      record.protocolVersion !== 1 ||
      record.providerReferenceVersion !== 1 ||
      typeof record.generation !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(record.generation) ||
      typeof record.launchDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.launchDigest) ||
      record.integrityAlgorithm !== 'sha256' ||
      typeof record.integrityDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.integrityDigest)
    ) {
      return undefined;
    }
    const { integrityDigest, ...preimage } = record as unknown as PhaseRecord;
    const expected = sha256(JSON.stringify(preimage));
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integrityDigest, 'hex'))) {
      return undefined;
    }
    if (JSON.stringify({ ...preimage, integrityDigest }) !== text) return undefined;
    return Object.freeze({ ...preimage, integrityDigest }) as PhaseRecord;
  } catch {
    return undefined;
  }
}

function recordMatchesIdentity(record: PublicationRecord, identity: PublicationIdentity): boolean {
  return record.referenceDigest === identity.referenceDigest &&
    record.preparationOperationId === identity.privateReference.preparationOperationId &&
    record.publicationVersion === PROCESS_AUTHORITY_PUBLICATION_VERSION &&
    record.providerId === identity.descriptor.providerId &&
    record.protocolVersion === identity.descriptor.protocolVersion &&
    record.providerReferenceVersion === identity.descriptor.providerReferenceVersion &&
    record.generation === identity.privateReference.generation &&
    record.launchDigest === identity.privateReference.launchDigest;
}

function recordEquals(left: PublicationRecord, right: PublicationRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function headMatchesIdentity(head: PublicationHead, identity: PublicationIdentity): boolean {
  return head.referenceDigest === identity.referenceDigest &&
    head.preparationOperationId === identity.privateReference.preparationOperationId &&
    head.providerId === identity.descriptor.providerId &&
    head.protocolVersion === identity.descriptor.protocolVersion &&
    head.providerReferenceVersion === identity.descriptor.providerReferenceVersion &&
    head.generation === identity.privateReference.generation &&
    head.launchDigest === identity.privateReference.launchDigest;
}

function phaseMatchesIdentity(record: PhaseRecord, identity: PublicationIdentity): boolean {
  return record.referenceDigest === identity.referenceDigest &&
    record.preparationOperationId === identity.privateReference.preparationOperationId &&
    record.providerId === identity.descriptor.providerId &&
    record.protocolVersion === identity.descriptor.protocolVersion &&
    record.providerReferenceVersion === identity.descriptor.providerReferenceVersion &&
    record.generation === identity.privateReference.generation &&
    record.launchDigest === identity.privateReference.launchDigest;
}

function fsyncDirectory(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function validateRoot(root: string, expected?: LedgerRootIdentity): LedgerRootIdentity {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Linux authority publication ledger root provenance is invalid.');
  }
  const realPath = fs.realpathSync.native(root);
  const identity = Object.freeze({
    realPath,
    device: BigInt(stat.dev),
    inode: BigInt(stat.ino),
  });
  if (
    expected &&
    (identity.realPath !== expected.realPath ||
      identity.device !== expected.device ||
      identity.inode !== expected.inode)
  ) {
    throw new TypeError('Linux authority publication ledger root identity changed.');
  }
  if (process.platform !== 'win32') {
    const uid = process.getuid?.();
    if ((uid !== undefined && stat.uid !== uid) || (stat.mode & 0o777) !== 0o700) {
      throw new TypeError('Linux authority publication ledger root ownership or mode is invalid.');
    }
    const parent = path.dirname(realPath);
    const parentStat = fs.lstatSync(parent);
    if (
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink() ||
      (uid !== undefined && parentStat.uid !== uid) ||
      (parentStat.mode & 0o022) !== 0
    ) {
      throw new TypeError('Linux authority publication ledger parent ownership or mode is invalid.');
    }
  }
  return identity;
}

function validateOwnedDirectory(stat: fs.Stats): boolean {
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  if (process.platform === 'win32') return true;
  const uid = process.getuid?.();
  return (uid === undefined || stat.uid === uid) && (stat.mode & 0o077) === 0;
}

interface PreparedLedgerRoot {
  readonly root: string;
  readonly operationalRoot: string;
  readonly rootFd?: number;
  readonly identity: LedgerRootIdentity;
}

function prepareRoot(value: string): PreparedLedgerRoot {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('Linux authority publication ledger root must be an absolute trusted path.');
  }
  const root = path.resolve(value);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const identity = validateRoot(root);
  if (process.platform !== 'linux') {
    return Object.freeze({ root, operationalRoot: root, identity });
  }
  const rootFd = fs.openSync(
    root,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW
  );
  try {
    const stat = fs.fstatSync(rootFd);
    if (
      !stat.isDirectory() ||
      BigInt(stat.dev) !== identity.device ||
      BigInt(stat.ino) !== identity.inode
    ) {
      throw new TypeError('Linux authority publication ledger directory handle differs.');
    }
    return Object.freeze({
      root,
      operationalRoot: `/proc/self/fd/${rootFd}`,
      rootFd,
      identity,
    });
  } catch (error) {
    fs.closeSync(rootFd);
    throw error;
  }
}

export class LinuxAuthorityPublicationLedger {
  readonly #root: string;
  readonly #operationalRoot: string;
  readonly #rootFd?: number;
  readonly #rootIdentity: LedgerRootIdentity;

  constructor(options: LinuxAuthorityPublicationLedgerOptions) {
    if (new.target !== LinuxAuthorityPublicationLedger) {
      throw new TypeError('Linux authority publication ledger requires an exact capability instance.');
    }
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      !exactKeys(options, ['root'])
    ) {
      throw new TypeError('Linux authority publication ledger options are malformed.');
    }
    const preparedRoot = prepareRoot(options.root);
    this.#root = preparedRoot.root;
    this.#operationalRoot = preparedRoot.operationalRoot;
    this.#rootFd = preparedRoot.rootFd;
    this.#rootIdentity = preparedRoot.identity;
    authenticLedgers.add(this);
    Object.freeze(this);
  }

  #entryPath(referenceDigest: string): string {
    return path.join(this.#operationalRoot, `${referenceDigest}.entry`);
  }

  #headPath(referenceDigest: string): string {
    return path.join(this.#operationalRoot, `${referenceDigest}.publication-head`);
  }

  #phasePath(referenceDigest: string): string {
    return path.join(this.#operationalRoot, `${referenceDigest}.phase-journal`);
  }

  #validateRoot(): void {
    validateRoot(this.#root, this.#rootIdentity);
    if (this.#rootFd !== undefined) {
      const stat = fs.fstatSync(this.#rootFd);
      if (
        !stat.isDirectory() ||
        BigInt(stat.dev) !== this.#rootIdentity.device ||
        BigInt(stat.ino) !== this.#rootIdentity.inode
      ) {
        throw new TypeError('Linux authority publication ledger directory handle changed.');
      }
    }
  }

  #readHead(identity: PublicationIdentity): PublicationHead | undefined | 'malformed' {
    const headPath = this.#headPath(identity.referenceDigest);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(headPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return 'malformed';
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size === 0 ||
      stat.size > MAX_RECORD_BYTES ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
      (process.platform !== 'win32' &&
        process.getuid?.() !== undefined && stat.uid !== process.getuid?.())
    ) {
      return 'malformed';
    }
    return parseHead(fs.readFileSync(headPath, 'utf8')) ?? 'malformed';
  }

  #readPhase(identity: PublicationIdentity): PhaseRecord | undefined | 'malformed' {
    const phasePath = this.#phasePath(identity.referenceDigest);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(phasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return 'malformed';
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size === 0 ||
      stat.size > MAX_RECORD_BYTES * 2 ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
      (process.platform !== 'win32' &&
        process.getuid?.() !== undefined && stat.uid !== process.getuid?.())
    ) {
      return 'malformed';
    }
    const text = fs.readFileSync(phasePath, 'utf8');
    if (!text.endsWith('\n')) return 'malformed';
    const lines = text.slice(0, -1).split('\n');
    if (lines.length < 1 || lines.length > 2) return 'malformed';
    const prepared = parsePhaseRecord(lines[0]!);
    if (!prepared || prepared.phase !== 'prepared' || !phaseMatchesIdentity(prepared, identity)) {
      return 'malformed';
    }
    if (lines.length === 1) return prepared;
    const published = parsePhaseRecord(lines[1]!);
    if (!published || published.phase !== 'published' || !phaseMatchesIdentity(published, identity)) {
      return 'malformed';
    }
    return published;
  }

  #recordPreparedIdentity(identity: PublicationIdentity): void {
    const existing = this.#readPhase(identity);
    if (existing !== undefined) {
      if (existing !== 'malformed' && phaseMatchesIdentity(existing, identity)) return;
      throw new TypeError('Linux authority phase journal contains conflicting provenance.');
    }
    const target = this.#phasePath(identity.referenceDigest);
    const record = completePhase(identity, 'prepared');
    let fd: number | undefined;
    try {
      fd = fs.openSync(target, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
      fs.fsyncSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const raced = this.#readPhase(identity);
      if (raced === undefined || raced === 'malformed' || !phaseMatchesIdentity(raced, identity)) {
        throw new TypeError('Linux authority phase journal contains conflicting provenance.');
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fsyncDirectory(this.#operationalRoot);
  }

  #recordPublishedIdentity(identity: PublicationIdentity): void {
    const existing = this.#readPhase(identity);
    if (existing === 'malformed' || existing === undefined) {
      throw new TypeError('Linux authority prepared phase journal is unavailable.');
    }
    if (existing.phase === 'published') return;
    const fd = fs.openSync(this.#phasePath(identity.referenceDigest), 'a', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(completePhase(identity, 'published'))}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncDirectory(this.#operationalRoot);
  }

  recordPrepared(
    descriptor: ProcessAuthorityProviderDescriptor,
    providerReference: ProviderAuthorityReference
  ): void {
    this.#validateRoot();
    this.#recordPreparedIdentity(publicationIdentity(descriptor, providerReference));
  }

  #commitHead(identity: PublicationIdentity): void {
    const desired = completeHead(identity);
    this.#reconcileUncommittedHeads(identity.referenceDigest);
    const existing = this.#readHead(identity);
    if (existing !== undefined) {
      if (existing !== 'malformed' && headMatchesIdentity(existing, identity)) return;
      throw new TypeError('Linux authority publication head contains conflicting provenance.');
    }
    const target = this.#headPath(identity.referenceDigest);
    const temporary = path.join(
      this.#operationalRoot,
      `.${identity.referenceDigest}.${randomUUID()}.tmp-head`
    );
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, Buffer.from(JSON.stringify(desired), 'utf8'));
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    try {
      fs.linkSync(temporary, target);
      fs.unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const raced = this.#readHead(identity);
      if (raced === undefined || raced === 'malformed' || !headMatchesIdentity(raced, identity)) {
        throw new TypeError('Linux authority publication head contains conflicting provenance.');
      }
      fs.unlinkSync(temporary);
    }
    fsyncDirectory(this.#operationalRoot);
  }

  #reconcileUncommittedHeads(referenceDigest: string): void {
    const pattern = new RegExp(
      `^\\.${referenceDigest}\\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.tmp-head$`
    );
    for (const name of fs.readdirSync(this.#operationalRoot)) {
      if (!pattern.test(name)) continue;
      const candidate = path.join(this.#operationalRoot, name);
      const stat = fs.lstatSync(candidate);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size === 0 ||
        stat.size > MAX_RECORD_BYTES ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
        (process.platform !== 'win32' &&
          process.getuid?.() !== undefined && stat.uid !== process.getuid?.())
      ) {
        throw new TypeError('Linux authority publication partial-head provenance is invalid.');
      }
      fs.unlinkSync(candidate);
    }
  }

  #reconcileUncommittedEntries(referenceDigest: string): void {
    const pattern = new RegExp(
      `^\\.${referenceDigest}\\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.tmp-entry$`
    );
    for (const name of fs.readdirSync(this.#operationalRoot)) {
      if (!pattern.test(name)) continue;
      const entry = path.join(this.#operationalRoot, name);
      const stat = fs.lstatSync(entry);
      if (!validateOwnedDirectory(stat)) {
        throw new TypeError('Linux authority publication partial-entry provenance is invalid.');
      }
      const children = fs.readdirSync(entry);
      if (
        children.length > 1 ||
        children.some((child) => child !== '.publication.tmp' && child !== 'publication.json')
      ) {
        throw new TypeError('Linux authority publication partial entry is not closed.');
      }
      for (const child of children) {
        const childPath = path.join(entry, child);
        const childStat = fs.lstatSync(childPath);
        if (
          !childStat.isFile() ||
          childStat.isSymbolicLink() ||
          childStat.size > MAX_RECORD_BYTES ||
          (process.platform !== 'win32' && (childStat.mode & 0o077) !== 0) ||
          (process.platform !== 'win32' &&
            process.getuid?.() !== undefined &&
            childStat.uid !== process.getuid?.())
        ) {
          throw new TypeError('Linux authority publication partial file provenance is invalid.');
        }
        fs.unlinkSync(childPath);
      }
      fs.rmdirSync(entry);
    }
  }

  #readRecord(identity: PublicationIdentity): PublicationRecord | undefined | 'malformed' {
    this.#validateRoot();
    const entry = this.#entryPath(identity.referenceDigest);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return 'malformed';
    }
    if (!validateOwnedDirectory(stat)) return 'malformed';
    const files = fs.readdirSync(entry);
    if (files.length !== 1 || files[0] !== 'publication.json') return 'malformed';
    const recordPath = path.join(entry, 'publication.json');
    const recordStat = fs.lstatSync(recordPath);
    if (
      !recordStat.isFile() ||
      recordStat.isSymbolicLink() ||
      recordStat.size === 0 ||
      recordStat.size > MAX_RECORD_BYTES ||
      (process.platform !== 'win32' &&
        process.getuid?.() !== undefined &&
        recordStat.uid !== process.getuid?.()) ||
      (process.platform !== 'win32' && (recordStat.mode & 0o077) !== 0)
    ) {
      return 'malformed';
    }
    return parseRecord(fs.readFileSync(recordPath, 'utf8')) ?? 'malformed';
  }

  lookup(
    descriptor: ProcessAuthorityProviderDescriptor,
    providerReference: ProviderAuthorityReference
  ): LinuxAuthorityPublicationLookup {
    let identity: PublicationIdentity;
    try {
      identity = publicationIdentity(descriptor, providerReference);
    } catch {
      return Object.freeze({
        state: 'authority-uncertain',
        diagnosticCode: 'ledger-unavailable',
      });
    }
    try {
      this.#validateRoot();
      const phase = this.#readPhase(identity);
      const record = this.#readRecord(identity);
      const head = this.#readHead(identity);
      if (phase === undefined) {
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: 'ledger-missing',
        });
      }
      if (phase === 'malformed' || !phaseMatchesIdentity(phase, identity)) {
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: 'ledger-malformed',
        });
      }
      if (phase.phase === 'prepared') {
        if (record === undefined && head === undefined) {
          return Object.freeze({ state: 'prepared-inert' });
        }
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: 'ledger-malformed',
        });
      }
      if (record === undefined) {
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: head !== undefined &&
            (head === 'malformed' || !headMatchesIdentity(head, identity))
            ? 'ledger-malformed'
            : 'ledger-missing',
        });
      }
      if (record === 'malformed') {
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: 'ledger-malformed',
        });
      }
      if (!recordMatchesIdentity(record, identity)) {
        return Object.freeze({ state: 'event-gap', diagnosticCode: 'ledger-conflict' });
      }
      if (head === undefined || head === 'malformed' || !headMatchesIdentity(head, identity)) {
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: 'ledger-malformed',
        });
      }
      return Object.freeze({ state: 'published-inert' });
    } catch {
      return Object.freeze({
        state: 'authority-uncertain',
        diagnosticCode: 'ledger-unavailable',
      });
    }
  }

  requirePublished(
    descriptor: ProcessAuthorityProviderDescriptor,
    providerReference: ProviderAuthorityReference
  ): Exclude<LinuxAuthorityPublicationLookup, { readonly state: 'prepared-inert' }> {
    const result = this.lookup(descriptor, providerReference);
    return result.state === 'prepared-inert'
      ? Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-missing' })
      : result;
  }

  commit(
    binding: ProcessAuthorityPublicationBinding,
    context: AuthorityOperationContext
  ): void {
    this.#validateRoot();
    const identity = identityFromBinding(binding);
    this.#recordPreparedIdentity(identity);
    const desired = completeRecord(recordPreimage(identity, context));
    const entry = this.#entryPath(identity.referenceDigest);
    const existing = this.#readRecord(identity);
    if (existing !== undefined) {
      if (existing !== 'malformed' && recordEquals(existing, desired)) {
        this.#commitHead(identity);
        this.#recordPublishedIdentity(identity);
        return;
      }
      throw new TypeError('Linux authority publication ledger contains conflicting provenance.');
    }

    this.#reconcileUncommittedEntries(identity.referenceDigest);
    this.#commitHead(identity);

    const temporaryEntry = path.join(
      this.#operationalRoot,
      `.${identity.referenceDigest}.${randomUUID()}.tmp-entry`
    );
    fs.mkdirSync(temporaryEntry, { mode: 0o700 });
    const temporary = path.join(temporaryEntry, '.publication.tmp');
    const stagedPath = path.join(temporaryEntry, 'publication.json');
    const bytes = Buffer.from(JSON.stringify(desired), 'utf8');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECORD_BYTES) {
      throw new TypeError('Linux authority publication record exceeds its bound.');
    }
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(temporary, stagedPath);
    fsyncDirectory(temporaryEntry);
    try {
      fs.renameSync(temporaryEntry, entry);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) throw error;
      const raced = this.#readRecord(identity);
      if (raced === undefined || raced === 'malformed' || !recordEquals(raced, desired)) {
        throw new TypeError('Linux authority publication ledger contains conflicting provenance.');
      }
      this.#recordPublishedIdentity(identity);
      return;
    }
    fsyncDirectory(this.#operationalRoot);
    this.#recordPublishedIdentity(identity);
  }
}

Object.freeze(LinuxAuthorityPublicationLedger.prototype);

export function createLinuxAuthorityPublicationLedger(
  options: LinuxAuthorityPublicationLedgerOptions
): LinuxAuthorityPublicationLedger {
  return new LinuxAuthorityPublicationLedger(options);
}

export function createLinuxAuthorityPublicationPublisher(
  ledger: LinuxAuthorityPublicationLedger
): ProcessAuthorityPublisher {
  assertExactLedger(ledger);
  return async (binding, context) => {
    Reflect.apply(LinuxAuthorityPublicationLedger.prototype.commit, ledger, [binding, context]);
    return createProcessAuthorityPublicationAcknowledgement(binding);
  };
}

export interface LinuxAuthorityPublicationAccess {
  readonly recordPrepared: LinuxAuthorityPublicationLedger['recordPrepared'];
  readonly lookup: LinuxAuthorityPublicationLedger['lookup'];
  readonly requirePublished: LinuxAuthorityPublicationLedger['requirePublished'];
}

function assertExactLedger(ledger: LinuxAuthorityPublicationLedger): void {
  if (
    !authenticLedgers.has(ledger) ||
    Object.getPrototypeOf(ledger) !== LinuxAuthorityPublicationLedger.prototype ||
    !Object.isFrozen(ledger) ||
    !Object.isFrozen(LinuxAuthorityPublicationLedger.prototype)
  ) {
    throw new TypeError('Linux authority publication ledger provenance is invalid.');
  }
}

export function createLinuxAuthorityPublicationAccess(
  ledger: LinuxAuthorityPublicationLedger
): LinuxAuthorityPublicationAccess {
  assertExactLedger(ledger);
  const recordPrepared: LinuxAuthorityPublicationLedger['recordPrepared'] =
    (descriptor, reference) =>
      Reflect.apply(LinuxAuthorityPublicationLedger.prototype.recordPrepared, ledger, [
        descriptor,
        reference,
      ]);
  const lookup: LinuxAuthorityPublicationLedger['lookup'] = (descriptor, reference) =>
    Reflect.apply(LinuxAuthorityPublicationLedger.prototype.lookup, ledger, [descriptor, reference]);
  const requirePublished: LinuxAuthorityPublicationLedger['requirePublished'] =
    (descriptor, reference) => {
      const result = lookup(descriptor, reference);
      return result.state === 'prepared-inert'
        ? Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-missing' })
        : result;
    };
  return Object.freeze({ recordPrepared, lookup, requirePublished });
}
