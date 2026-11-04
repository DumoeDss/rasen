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
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
  WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
} from './contracts.js';
import {
  decodeWindowsPrivateAuthorityReference,
  type WindowsPrivateAuthorityReference,
} from './private-reference.js';

const RECORD_SCHEMA = 'rasen-windows-authority-publication/1' as const;
const RECORD_VERSION = 1 as const;
const HEAD_SCHEMA = 'rasen-windows-authority-publication-head/1' as const;
const PHASE_SCHEMA = 'rasen-windows-authority-phase-journal/1' as const;
const MAX_RECORD_BYTES = 16 * 1024;

/**
 * Decision 10 prescribes four Win32 steps: write a temporary in the same
 * directory, `FlushFileBuffers` the file handle, `MoveFileExW` with
 * `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH` over the target, then
 * `FlushFileBuffers` a directory handle opened with `FILE_FLAG_BACKUP_SEMANTICS`.
 *
 * Node reaches the first two exactly and the third only partly: `fs.renameSync`
 * is `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`, and no Node API requests
 * `MOVEFILE_WRITE_THROUGH`. The fourth is unreachable from Node at all —
 * opening a directory for `FlushFileBuffers` needs `FILE_FLAG_BACKUP_SEMANTICS`,
 * which `fs.openSync` never passes, so a directory flush fails with EPERM/EISDIR
 * on Windows. The compensating step is a post-rename reopen-and-flush of the
 * committed target, which forces the file's own data and its allocation
 * metadata but is not a documented substitute for the directory-entry flush.
 *
 * This constant is exported so the shortfall is visible in receipts rather than
 * argued in prose. Closing it requires the native helper's FFI, not this layer.
 */
export const WINDOWS_PUBLICATION_DURABILITY_BARRIER = Object.freeze({
  temporaryInSameDirectory: true,
  flushFileBuffersOnFileHandle: true,
  moveFileExReplaceExisting: true,
  moveFileExWriteThrough: false,
  flushFileBuffersOnDirectoryHandle: false,
  postRenameReopenAndFlush: true,
});

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

const authenticLedgers = new WeakSet<WindowsAuthorityPublicationLedger>();

export type WindowsAuthorityPublicationLookup =
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
  readonly privateReference: WindowsPrivateAuthorityReference;
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

export interface WindowsAuthorityPublicationLedgerOptions {
  readonly root: string;
}

interface LedgerRootIdentity {
  readonly realPath: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly birthtimeNs: bigint;
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

function exactWindowsDescriptor(
  descriptor: ProcessAuthorityProviderDescriptor
): ProcessAuthorityProviderDescriptor {
  if (sameDescriptor(descriptor, WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR)) {
    return WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR;
  }
  throw new TypeError('Windows authority publication descriptor is not exact.');
}

function descriptorForProviderId(providerId: string): ProcessAuthorityProviderDescriptor {
  if (providerId === WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID) {
    return WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR;
  }
  throw new TypeError('Windows authority publication provider is not exact.');
}

function publicationIdentity(
  descriptor: ProcessAuthorityProviderDescriptor,
  providerReference: ProviderAuthorityReference
): PublicationIdentity {
  const exactDescriptor = exactWindowsDescriptor(descriptor);
  const privateReference = decodeWindowsPrivateAuthorityReference(providerReference);
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
    throw new TypeError('Windows authority publication binding is malformed.');
  }
  const decoded = decodeProcessAuthorityReferenceForDispatch(String(binding.reference));
  if (
    decoded.state !== 'dispatchable' ||
    reencodeProcessAuthorityReference(decoded) !== binding.reference
  ) {
    throw new TypeError('Windows authority publication binding reference is not canonical.');
  }
  const descriptor = descriptorForProviderId(decoded.selection.providerId);
  const identity = publicationIdentity(descriptor, decoded.providerReference);
  if (
    identity.reference !== binding.reference ||
    identity.referenceDigest !== binding.referenceDigest ||
    identity.privateReference.preparationOperationId !== binding.preparationOperationId
  ) {
    throw new TypeError('Windows authority publication binding identity or operation differs.');
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
    throw new TypeError('Windows authority publication operation context is malformed or cancelled.');
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
  return Object.freeze({ ...preimage, integrityDigest: sha256(JSON.stringify(preimage)) });
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
  return Object.freeze({ ...preimage, integrityDigest: sha256(JSON.stringify(preimage)) });
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
  return Object.freeze({ ...preimage, integrityDigest: sha256(JSON.stringify(preimage)) });
}

function boundedIdentityFields(record: Record<string, unknown>): boolean {
  return typeof record.referenceDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(record.referenceDigest) &&
    typeof record.preparationOperationId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(record.preparationOperationId) &&
    record.providerId === WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID &&
    record.protocolVersion === 1 &&
    record.providerReferenceVersion === 1 &&
    typeof record.generation === 'string' && /^[A-Za-z0-9_-]{22}$/.test(record.generation) &&
    typeof record.launchDigest === 'string' && /^[a-f0-9]{64}$/.test(record.launchDigest) &&
    record.integrityAlgorithm === 'sha256' &&
    typeof record.integrityDigest === 'string' && /^[a-f0-9]{64}$/.test(record.integrityDigest);
}

function parseIntegrityBound<T extends { readonly integrityDigest: string }>(
  text: string,
  accept: (record: Record<string, unknown>) => boolean
): T | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (!accept(record)) return undefined;
    const { integrityDigest, ...preimage } = record as unknown as T;
    const expected = sha256(JSON.stringify(preimage));
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integrityDigest, 'hex'))) {
      return undefined;
    }
    if (JSON.stringify({ ...preimage, integrityDigest }) !== text) return undefined;
    return Object.freeze({ ...preimage, integrityDigest }) as T;
  } catch {
    return undefined;
  }
}

function parseRecord(text: string): PublicationRecord | undefined {
  return parseIntegrityBound<PublicationRecord>(text, (record) =>
    exactKeys(record, RECORD_KEYS) &&
    record.schema === RECORD_SCHEMA &&
    record.recordVersion === RECORD_VERSION &&
    record.publicationVersion === PROCESS_AUTHORITY_PUBLICATION_VERSION &&
    typeof record.publicationOperationId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(record.publicationOperationId) &&
    boundedIdentityFields(record));
}

function parseHead(text: string): PublicationHead | undefined {
  return parseIntegrityBound<PublicationHead>(text, (record) =>
    exactKeys(record, HEAD_KEYS) &&
    record.schema === HEAD_SCHEMA &&
    record.recordVersion === RECORD_VERSION &&
    boundedIdentityFields(record));
}

function parsePhaseRecord(text: string): PhaseRecord | undefined {
  return parseIntegrityBound<PhaseRecord>(text, (record) =>
    exactKeys(record, PHASE_KEYS) &&
    record.schema === PHASE_SCHEMA &&
    record.recordVersion === RECORD_VERSION &&
    ((record.phaseSequence === 1 && record.phase === 'prepared') ||
      (record.phaseSequence === 2 && record.phase === 'published')) &&
    boundedIdentityFields(record));
}

function matchesIdentity(
  record: {
    readonly referenceDigest: string;
    readonly preparationOperationId: string;
    readonly providerId: string;
    readonly protocolVersion: number;
    readonly providerReferenceVersion: number;
    readonly generation: string;
    readonly launchDigest: string;
  },
  identity: PublicationIdentity
): boolean {
  return record.referenceDigest === identity.referenceDigest &&
    record.preparationOperationId === identity.privateReference.preparationOperationId &&
    record.providerId === identity.descriptor.providerId &&
    record.protocolVersion === identity.descriptor.protocolVersion &&
    record.providerReferenceVersion === identity.descriptor.providerReferenceVersion &&
    record.generation === identity.privateReference.generation &&
    record.launchDigest === identity.privateReference.launchDigest;
}

function recordEquals(left: PublicationRecord, right: PublicationRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * `FILE_FLAG_BACKUP_SEMANTICS` is unreachable from `fs.openSync`, so a directory
 * flush cannot succeed on Windows. The attempt is retained because the same
 * ledger shape runs under a POSIX test host, and its failure is swallowed only
 * for the exact error codes Windows raises for "you may not open a directory".
 */
function flushDirectoryBestEffort(directory: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform !== 'win32' ||
      !['EINVAL', 'EPERM', 'EACCES', 'EBADF', 'EISDIR'].includes(code ?? '')
    ) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function flushCommittedFile(target: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(target, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EPERM', 'EACCES', 'EINVAL'].includes(code ?? '')) throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function directoryIdentity(candidate: string): LedgerRootIdentity {
  const stat = fs.lstatSync(candidate, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Windows authority publication ledger root provenance is invalid.');
  }
  return Object.freeze({
    realPath: fs.realpathSync.native(candidate),
    device: stat.dev,
    inode: stat.ino,
    birthtimeNs: stat.birthtimeNs,
  });
}

/**
 * A reparse point anywhere in the chain redirects the real path away from the
 * path the ledger was constructed on. The construction-time real path is the
 * anchor: every later validation resolves the stored real path again and
 * requires it, its volume and its file index to be unchanged. Comparing against
 * the caller's original string instead would false-reject 8.3 short names and
 * case variants, which are not redirection.
 */
function validateRoot(realRoot: string, expected: LedgerRootIdentity): void {
  const identity = directoryIdentity(realRoot);
  if (
    identity.realPath !== expected.realPath ||
    identity.device !== expected.device ||
    identity.inode !== expected.inode ||
    identity.birthtimeNs !== expected.birthtimeNs
  ) {
    throw new TypeError('Windows authority publication ledger root identity changed.');
  }
}

function prepareRoot(value: string): LedgerRootIdentity {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('Windows authority publication ledger root must be an absolute trusted path.');
  }
  const root = path.resolve(value);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return directoryIdentity(root);
}

function boundedRegularFile(candidate: string, maximum: number): fs.Stats | undefined | 'malformed' {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return 'malformed';
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maximum) {
    return 'malformed';
  }
  return stat;
}

export class WindowsAuthorityPublicationLedger {
  readonly #root: string;
  readonly #rootIdentity: LedgerRootIdentity;

  constructor(options: WindowsAuthorityPublicationLedgerOptions) {
    if (new.target !== WindowsAuthorityPublicationLedger) {
      throw new TypeError('Windows authority publication ledger requires an exact capability instance.');
    }
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      !exactKeys(options, ['root'])
    ) {
      throw new TypeError('Windows authority publication ledger options are malformed.');
    }
    const identity = prepareRoot(options.root);
    this.#root = identity.realPath;
    this.#rootIdentity = identity;
    authenticLedgers.add(this);
    Object.freeze(this);
  }

  #entryPath(referenceDigest: string): string {
    return path.join(this.#root, `${referenceDigest}.entry`);
  }

  #headPath(referenceDigest: string): string {
    return path.join(this.#root, `${referenceDigest}.publication-head`);
  }

  #phasePath(referenceDigest: string): string {
    return path.join(this.#root, `${referenceDigest}.phase-journal`);
  }

  #validateRoot(): void {
    validateRoot(this.#root, this.#rootIdentity);
  }

  #readHead(identity: PublicationIdentity): PublicationHead | undefined | 'malformed' {
    const headPath = this.#headPath(identity.referenceDigest);
    const stat = boundedRegularFile(headPath, MAX_RECORD_BYTES);
    if (stat === undefined || stat === 'malformed') return stat;
    return parseHead(fs.readFileSync(headPath, 'utf8')) ?? 'malformed';
  }

  #readPhase(identity: PublicationIdentity): PhaseRecord | undefined | 'malformed' {
    const phasePath = this.#phasePath(identity.referenceDigest);
    const stat = boundedRegularFile(phasePath, MAX_RECORD_BYTES * 2);
    if (stat === undefined || stat === 'malformed') return stat;
    const text = fs.readFileSync(phasePath, 'utf8');
    if (!text.endsWith('\n')) return 'malformed';
    const lines = text.slice(0, -1).split('\n');
    if (lines.length < 1 || lines.length > 2) return 'malformed';
    const prepared = parsePhaseRecord(lines[0]!);
    if (!prepared || prepared.phase !== 'prepared' || !matchesIdentity(prepared, identity)) {
      return 'malformed';
    }
    if (lines.length === 1) return prepared;
    const published = parsePhaseRecord(lines[1]!);
    if (!published || published.phase !== 'published' || !matchesIdentity(published, identity)) {
      return 'malformed';
    }
    return published;
  }

  #recordPreparedIdentity(identity: PublicationIdentity): void {
    const existing = this.#readPhase(identity);
    if (existing !== undefined) {
      if (existing !== 'malformed' && matchesIdentity(existing, identity)) return;
      throw new TypeError('Windows authority phase journal contains conflicting provenance.');
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
      if (raced === undefined || raced === 'malformed' || !matchesIdentity(raced, identity)) {
        throw new TypeError('Windows authority phase journal contains conflicting provenance.');
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    flushDirectoryBestEffort(this.#root);
  }

  #recordPublishedIdentity(identity: PublicationIdentity): void {
    const existing = this.#readPhase(identity);
    if (existing === 'malformed' || existing === undefined) {
      throw new TypeError('Windows authority prepared phase journal is unavailable.');
    }
    if (existing.phase === 'published') return;
    const fd = fs.openSync(this.#phasePath(identity.referenceDigest), 'a', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(completePhase(identity, 'published'))}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    flushDirectoryBestEffort(this.#root);
  }

  recordPrepared(
    descriptor: ProcessAuthorityProviderDescriptor,
    providerReference: ProviderAuthorityReference
  ): void {
    this.#validateRoot();
    this.#recordPreparedIdentity(publicationIdentity(descriptor, providerReference));
  }

  /** Writes a temporary in the same directory, flushes it, then replaces atomically. */
  #commitDurably(target: string, bytes: Buffer, suffix: string, referenceDigest: string): void {
    const temporary = path.join(this.#root, `.${referenceDigest}.${randomUUID()}.${suffix}`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }
    flushCommittedFile(target);
    flushDirectoryBestEffort(this.#root);
  }

  #reconcileUncommitted(referenceDigest: string, suffix: string): void {
    const pattern = new RegExp(
      `^\\.${referenceDigest}\\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.${suffix}$`
    );
    for (const name of fs.readdirSync(this.#root)) {
      if (!pattern.test(name)) continue;
      const candidate = path.join(this.#root, name);
      const stat = boundedRegularFile(candidate, MAX_RECORD_BYTES);
      if (stat === 'malformed') {
        throw new TypeError('Windows authority publication partial record provenance is invalid.');
      }
      if (stat !== undefined) fs.unlinkSync(candidate);
    }
  }

  #commitHead(identity: PublicationIdentity): void {
    const desired = completeHead(identity);
    this.#reconcileUncommitted(identity.referenceDigest, 'tmp-head');
    const existing = this.#readHead(identity);
    if (existing !== undefined) {
      if (existing !== 'malformed' && matchesIdentity(existing, identity)) return;
      throw new TypeError('Windows authority publication head contains conflicting provenance.');
    }
    this.#commitDurably(
      this.#headPath(identity.referenceDigest),
      Buffer.from(JSON.stringify(desired), 'utf8'),
      'tmp-head',
      identity.referenceDigest
    );
  }

  #readRecord(identity: PublicationIdentity): PublicationRecord | undefined | 'malformed' {
    const entry = this.#entryPath(identity.referenceDigest);
    const stat = boundedRegularFile(entry, MAX_RECORD_BYTES);
    if (stat === undefined || stat === 'malformed') return stat;
    return parseRecord(fs.readFileSync(entry, 'utf8')) ?? 'malformed';
  }

  lookup(
    descriptor: ProcessAuthorityProviderDescriptor,
    providerReference: ProviderAuthorityReference
  ): WindowsAuthorityPublicationLookup {
    let identity: PublicationIdentity;
    try {
      identity = publicationIdentity(descriptor, providerReference);
    } catch {
      return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-unavailable' });
    }
    try {
      this.#validateRoot();
      const phase = this.#readPhase(identity);
      const record = this.#readRecord(identity);
      const head = this.#readHead(identity);
      if (phase === undefined) {
        return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-missing' });
      }
      if (phase === 'malformed' || !matchesIdentity(phase, identity)) {
        return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-malformed' });
      }
      if (phase.phase === 'prepared') {
        if (record === undefined && head === undefined) {
          return Object.freeze({ state: 'prepared-inert' });
        }
        return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-malformed' });
      }
      if (record === undefined) {
        return Object.freeze({
          state: 'authority-uncertain',
          diagnosticCode: head !== undefined && (head === 'malformed' || !matchesIdentity(head, identity))
            ? 'ledger-malformed'
            : 'ledger-missing',
        });
      }
      if (record === 'malformed') {
        return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-malformed' });
      }
      if (
        !matchesIdentity(record, identity) ||
        record.publicationVersion !== PROCESS_AUTHORITY_PUBLICATION_VERSION
      ) {
        return Object.freeze({ state: 'event-gap', diagnosticCode: 'ledger-conflict' });
      }
      if (head === undefined || head === 'malformed' || !matchesIdentity(head, identity)) {
        return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-malformed' });
      }
      return Object.freeze({ state: 'published-inert' });
    } catch {
      return Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-unavailable' });
    }
  }

  requirePublished(
    descriptor: ProcessAuthorityProviderDescriptor,
    providerReference: ProviderAuthorityReference
  ): Exclude<WindowsAuthorityPublicationLookup, { readonly state: 'prepared-inert' }> {
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
    const existing = this.#readRecord(identity);
    if (existing !== undefined) {
      if (existing !== 'malformed' && recordEquals(existing, desired)) {
        this.#commitHead(identity);
        this.#recordPublishedIdentity(identity);
        return;
      }
      throw new TypeError('Windows authority publication ledger contains conflicting provenance.');
    }
    this.#reconcileUncommitted(identity.referenceDigest, 'tmp-entry');
    this.#commitHead(identity);
    const bytes = Buffer.from(JSON.stringify(desired), 'utf8');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECORD_BYTES) {
      throw new TypeError('Windows authority publication record exceeds its bound.');
    }
    this.#commitDurably(
      this.#entryPath(identity.referenceDigest),
      bytes,
      'tmp-entry',
      identity.referenceDigest
    );
    this.#recordPublishedIdentity(identity);
  }
}

Object.freeze(WindowsAuthorityPublicationLedger.prototype);

export function createWindowsAuthorityPublicationLedger(
  options: WindowsAuthorityPublicationLedgerOptions
): WindowsAuthorityPublicationLedger {
  return new WindowsAuthorityPublicationLedger(options);
}

function assertExactLedger(ledger: WindowsAuthorityPublicationLedger): void {
  if (
    !authenticLedgers.has(ledger) ||
    Object.getPrototypeOf(ledger) !== WindowsAuthorityPublicationLedger.prototype ||
    !Object.isFrozen(ledger) ||
    !Object.isFrozen(WindowsAuthorityPublicationLedger.prototype)
  ) {
    throw new TypeError('Windows authority publication ledger provenance is invalid.');
  }
}

/** Commits durably, then returns the acknowledgement — never the reverse order. */
export function createWindowsAuthorityPublicationPublisher(
  ledger: WindowsAuthorityPublicationLedger
): ProcessAuthorityPublisher {
  assertExactLedger(ledger);
  return async (binding, context) => {
    Reflect.apply(WindowsAuthorityPublicationLedger.prototype.commit, ledger, [binding, context]);
    return createProcessAuthorityPublicationAcknowledgement(binding);
  };
}

export interface WindowsAuthorityPublicationAccess {
  readonly recordPrepared: WindowsAuthorityPublicationLedger['recordPrepared'];
  readonly lookup: WindowsAuthorityPublicationLedger['lookup'];
  readonly requirePublished: WindowsAuthorityPublicationLedger['requirePublished'];
}

export function createWindowsAuthorityPublicationAccess(
  ledger: WindowsAuthorityPublicationLedger
): WindowsAuthorityPublicationAccess {
  assertExactLedger(ledger);
  const recordPrepared: WindowsAuthorityPublicationLedger['recordPrepared'] =
    (descriptor, reference) =>
      Reflect.apply(WindowsAuthorityPublicationLedger.prototype.recordPrepared, ledger, [
        descriptor,
        reference,
      ]);
  const lookup: WindowsAuthorityPublicationLedger['lookup'] = (descriptor, reference) =>
    Reflect.apply(WindowsAuthorityPublicationLedger.prototype.lookup, ledger, [
      descriptor,
      reference,
    ]);
  const requirePublished: WindowsAuthorityPublicationLedger['requirePublished'] =
    (descriptor, reference) => {
      const result = lookup(descriptor, reference);
      return result.state === 'prepared-inert'
        ? Object.freeze({ state: 'authority-uncertain', diagnosticCode: 'ledger-missing' })
        : result;
    };
  return Object.freeze({ recordPrepared, lookup, requirePublished });
}
