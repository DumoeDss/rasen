import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { AuthorityOperationContext, ProviderAuthorityReference } from '../types.js';

const SCHEMA = 'rasen-linux-broker-preparation-delivery/1' as const;
const VERSION = 1 as const;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_PENDING_ORPHANS = 64;
type DeliveryPhase = 'Intent' | 'ReferenceStored' | 'Acknowledged' | 'Reconciled';
export type LinuxBrokerPreparationDeliveryReconciledDisposition = 'exact-scope-empty';
const PHASE_SUFFIX: Readonly<Record<DeliveryPhase, string>> = Object.freeze({
  Intent: 'intent',
  ReferenceStored: 'reference',
  Acknowledged: 'acknowledged',
  Reconciled: 'reconciled',
});
const RECORD_KEYS = Object.freeze([
  'schema', 'recordVersion', 'preparationOperationId', 'prepareDigest', 'launchDigest',
  'recoveryCapability', 'originalDeadline', 'phase', 'reference', 'referenceDigest',
  'reconciledDisposition', 'integrityAlgorithm', 'integrityDigest',
] as const);
const authenticLedgers = new WeakSet<LinuxBrokerPreparationDeliveryLedger>();

export interface LinuxBrokerPreparationDeliveryBinding {
  readonly preparationOperationId: string;
  readonly prepareDigest: string;
  readonly launchDigest: string;
  readonly recoveryCapability: string;
}

export interface LinuxBrokerPreparationDeliveryLedgerOptions {
  readonly root: string;
}

interface DeliveryRecordPreimage {
  readonly schema: typeof SCHEMA;
  readonly recordVersion: typeof VERSION;
  readonly preparationOperationId: string;
  readonly prepareDigest: string;
  readonly launchDigest: string;
  readonly recoveryCapability: string;
  readonly originalDeadline: number;
  readonly phase: DeliveryPhase;
  readonly reference: string | null;
  readonly referenceDigest: string | null;
  readonly reconciledDisposition: LinuxBrokerPreparationDeliveryReconciledDisposition | null;
  readonly integrityAlgorithm: 'sha256';
}

interface DeliveryRecord extends DeliveryRecordPreimage {
  readonly integrityDigest: string;
}

export interface LinuxBrokerPreparationDeliveryEntry {
  readonly state: DeliveryPhase;
  readonly created: boolean;
  readonly binding: LinuxBrokerPreparationDeliveryBinding;
  readonly reference?: ProviderAuthorityReference;
  readonly reconciledDisposition?: LinuxBrokerPreparationDeliveryReconciledDisposition;
}

export interface LinuxBrokerPreparationDeliveryOrphan {
  readonly state: 'Intent' | 'ReferenceStored';
  readonly binding: LinuxBrokerPreparationDeliveryBinding;
  readonly originalDeadline: number;
  readonly reference?: ProviderAuthorityReference;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validateBinding(binding: LinuxBrokerPreparationDeliveryBinding): void {
  if (
    !binding || typeof binding !== 'object' || Array.isArray(binding) ||
    !exactKeys(binding, [
      'preparationOperationId', 'prepareDigest', 'launchDigest', 'recoveryCapability',
    ]) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(binding.preparationOperationId) ||
    !/^[a-f0-9]{64}$/.test(binding.prepareDigest) ||
    !/^[a-f0-9]{64}$/.test(binding.launchDigest) ||
    !/^[A-Za-z0-9_-]{43}$/.test(binding.recoveryCapability) ||
    Buffer.from(binding.recoveryCapability, 'base64url').byteLength !== 32
  ) {
    throw new TypeError('Linux broker preparation delivery binding is malformed.');
  }
}

function complete(preimage: DeliveryRecordPreimage): DeliveryRecord {
  return Object.freeze({ ...preimage, integrityDigest: sha256(JSON.stringify(preimage)) });
}

function validRecord(
  value: Record<string, unknown>
): value is DeliveryRecord & Record<string, unknown> {
  return exactKeys(value, RECORD_KEYS) &&
    value.schema === SCHEMA && value.recordVersion === VERSION &&
    typeof value.preparationOperationId === 'string' &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(value.preparationOperationId) &&
    typeof value.prepareDigest === 'string' && /^[a-f0-9]{64}$/.test(value.prepareDigest) &&
    typeof value.launchDigest === 'string' && /^[a-f0-9]{64}$/.test(value.launchDigest) &&
    typeof value.recoveryCapability === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(value.recoveryCapability) &&
    Number.isFinite(value.originalDeadline) && (value.originalDeadline as number) > 0 &&
    ['Intent', 'ReferenceStored', 'Acknowledged', 'Reconciled'].includes(String(value.phase)) &&
    ((value.phase === 'Intent' && value.reference === null && value.referenceDigest === null &&
        value.reconciledDisposition === null) ||
      ((value.phase === 'ReferenceStored' || value.phase === 'Acknowledged') &&
        typeof value.reference === 'string' && value.reference.length > 0 &&
        typeof value.referenceDigest === 'string' && /^[a-f0-9]{64}$/.test(value.referenceDigest) &&
        sha256(value.reference) === value.referenceDigest && value.reconciledDisposition === null) ||
      (value.phase === 'Reconciled' &&
        ((value.reference === null && value.referenceDigest === null) ||
          (typeof value.reference === 'string' && value.reference.length > 0 &&
            typeof value.referenceDigest === 'string' &&
            /^[a-f0-9]{64}$/.test(value.referenceDigest) &&
            sha256(value.reference) === value.referenceDigest)) &&
        value.reconciledDisposition === 'exact-scope-empty')) &&
    value.integrityAlgorithm === 'sha256' &&
    typeof value.integrityDigest === 'string' && /^[a-f0-9]{64}$/.test(value.integrityDigest);
}

function parseRecord(text: string): DeliveryRecord {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validRecord(value as Record<string, unknown>)) {
    throw new TypeError('Linux broker preparation delivery record is malformed.');
  }
  const { integrityDigest, ...preimage } = value as DeliveryRecord;
  const expected = sha256(JSON.stringify(preimage));
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integrityDigest, 'hex')) ||
      JSON.stringify({ ...preimage, integrityDigest }) !== text) {
    throw new TypeError('Linux broker preparation delivery record integrity differs.');
  }
  return Object.freeze({ ...preimage, integrityDigest });
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

interface DeliveryRootIdentity {
  readonly root: string;
  readonly device: number;
  readonly inode: number;
}

function prepareRoot(rootValue: string): DeliveryRootIdentity {
  if (typeof rootValue !== 'string' || !path.isAbsolute(rootValue) || rootValue.includes('\0')) {
    throw new TypeError('Linux broker preparation delivery root is malformed.');
  }
  fs.mkdirSync(rootValue, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync.native(path.resolve(rootValue));
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 ||
        (process.getuid?.() !== undefined && stat.uid !== process.getuid?.())))) {
    throw new TypeError('Linux broker preparation delivery root provenance is invalid.');
  }
  return Object.freeze({ root, device: stat.dev, inode: stat.ino });
}

export class LinuxBrokerPreparationDeliveryLedger {
  readonly #root: string;
  readonly #rootDevice: number;
  readonly #rootInode: number;

  constructor(options: LinuxBrokerPreparationDeliveryLedgerOptions) {
    if (new.target !== LinuxBrokerPreparationDeliveryLedger || !options ||
        typeof options !== 'object' || Array.isArray(options) || !exactKeys(options, ['root'])) {
      throw new TypeError('Linux broker preparation delivery ledger options are malformed.');
    }
    const identity = prepareRoot(options.root);
    this.#root = identity.root;
    this.#rootDevice = identity.device;
    this.#rootInode = identity.inode;
    authenticLedgers.add(this);
    Object.freeze(this);
  }

  #key(operationId: string): string {
    return sha256(`rasen-linux-broker-delivery-controller-v1\0${operationId}`);
  }

  #assertRootIdentity(): void {
    const stat = fs.lstatSync(this.#root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== this.#rootDevice ||
        stat.ino !== this.#rootInode || fs.realpathSync.native(this.#root) !== this.#root ||
        (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 ||
          (process.getuid?.() !== undefined && stat.uid !== process.getuid?.())))) {
      throw new TypeError('Linux broker preparation delivery root identity changed.');
    }
  }

  #path(operationId: string, phase: DeliveryPhase): string {
    return path.join(this.#root, `${this.#key(operationId)}.${PHASE_SUFFIX[phase]}`);
  }

  #validateRecordStat(stat: fs.Stats, allowEmpty = false): void {
    if (!stat.isFile() || stat.isSymbolicLink() || (!allowEmpty && stat.size <= 0) ||
        stat.size > MAX_RECORD_BYTES ||
        (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 ||
          (process.getuid?.() !== undefined && stat.uid !== process.getuid?.())))) {
      throw new TypeError('Linux broker preparation delivery record provenance is invalid.');
    }
  }

  #readEnumeratedRecord(name: string, phase: DeliveryPhase): DeliveryRecord {
    this.#assertRootIdentity();
    const target = path.join(this.#root, name);
    let fd: number | undefined;
    try {
      fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      this.#validateRecordStat(fs.fstatSync(fd));
      const record = parseRecord(fs.readFileSync(fd, 'utf8'));
      if (record.phase !== phase ||
          name !== `${this.#key(record.preparationOperationId)}.${PHASE_SUFFIX[phase]}`) {
        throw new TypeError('Linux broker preparation delivery enumerated identity differs.');
      }
      this.#assertRootIdentity();
      return record;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  #readPhase(operationId: string, phase: DeliveryPhase): DeliveryRecord | undefined {
    this.#assertRootIdentity();
    const target = this.#path(operationId, phase);
    let fd: number | undefined;
    try {
      fd = fs.openSync(
        target,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
      );
      this.#validateRecordStat(fs.fstatSync(fd));
      const record = parseRecord(fs.readFileSync(fd, 'utf8'));
      if (record.phase !== phase || record.preparationOperationId !== operationId) {
        throw new TypeError('Linux broker preparation delivery phase identity differs.');
      }
      this.#assertRootIdentity();
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  #sameBase(left: DeliveryRecord, right: DeliveryRecord): boolean {
    return left.schema === right.schema && left.recordVersion === right.recordVersion &&
      left.preparationOperationId === right.preparationOperationId &&
      left.prepareDigest === right.prepareDigest && left.launchDigest === right.launchDigest &&
      left.recoveryCapability === right.recoveryCapability &&
      left.originalDeadline === right.originalDeadline &&
      left.integrityAlgorithm === right.integrityAlgorithm;
  }

  #read(operationId: string): DeliveryRecord | undefined {
    const intent = this.#readPhase(operationId, 'Intent');
    const reference = this.#readPhase(operationId, 'ReferenceStored');
    const acknowledged = this.#readPhase(operationId, 'Acknowledged');
    const reconciled = this.#readPhase(operationId, 'Reconciled');
    if (!intent) {
      if (reference || acknowledged || reconciled) {
        throw new TypeError('Linux broker preparation delivery phase chain has a gap.');
      }
      return undefined;
    }
    if (reference && !this.#sameBase(intent, reference)) {
      throw new TypeError('Linux broker preparation delivery reference phase conflicts.');
    }
    if (acknowledged && (!reference || !this.#sameBase(reference, acknowledged) ||
        acknowledged.reference !== reference.reference ||
        acknowledged.referenceDigest !== reference.referenceDigest)) {
      throw new TypeError('Linux broker preparation delivery acknowledgement phase conflicts.');
    }
    if (reconciled && (acknowledged || !this.#sameBase(intent, reconciled) ||
        (reference !== undefined && (reconciled.reference !== reference.reference ||
          reconciled.referenceDigest !== reference.referenceDigest)) ||
        (reference === undefined && (reconciled.reference !== null ||
          reconciled.referenceDigest !== null)))) {
      throw new TypeError('Linux broker preparation delivery reconciliation phase conflicts.');
    }
    return reconciled ?? acknowledged ?? reference ?? intent;
  }

  #discoverPendingRecords(): readonly DeliveryRecord[] {
    this.#assertRootIdentity();
    const pending: DeliveryRecord[] = [];
    const committedPattern = /^([a-f0-9]{64})\.(intent|reference|acknowledged|reconciled)$/;
    const temporaryPattern = /^\.([a-f0-9]{64})\.(intent|reference|acknowledged|reconciled)\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/;
    const suffixPhase = Object.freeze({
      intent: 'Intent',
      reference: 'ReferenceStored',
      acknowledged: 'Acknowledged',
      reconciled: 'Reconciled',
    } as const);
    const directory = fs.opendirSync(this.#root);
    try {
      for (;;) {
        const entry = directory.readSync();
        if (!entry) break;
        const committedMatch = committedPattern.exec(entry.name);
        const temporaryMatch = temporaryPattern.exec(entry.name);
        if (!committedMatch && !temporaryMatch) {
          throw new TypeError('Linux broker preparation delivery directory contains an unknown entry.');
        }
        if (temporaryMatch) {
          const stat = fs.lstatSync(path.join(this.#root, entry.name));
          this.#validateRecordStat(stat, true);
          continue;
        }
        const suffix = committedMatch![2] as keyof typeof suffixPhase;
        const phase = suffixPhase[suffix];
        const record = this.#readEnumeratedRecord(entry.name, phase);
        const current = this.#read(record.preparationOperationId);
        if (!current) {
          throw new TypeError('Linux broker preparation delivery phase chain has a gap.');
        }
        if (phase === 'Intent' &&
            (current.phase === 'Intent' || current.phase === 'ReferenceStored')) {
          pending.push(current);
          if (pending.length > MAX_PENDING_ORPHANS) {
            throw new TypeError('Linux broker preparation delivery orphan enumeration exceeds its bound.');
          }
        }
      }
    } finally {
      directory.closeSync();
    }
    this.#assertRootIdentity();
    return Object.freeze(pending);
  }

  discoverPendingOrphans(): readonly LinuxBrokerPreparationDeliveryOrphan[] {
    const pending = this.#discoverPendingRecords().map((current) =>
      Object.freeze({
        state: current.phase as 'Intent' | 'ReferenceStored',
        binding: Object.freeze({
          preparationOperationId: current.preparationOperationId,
          prepareDigest: current.prepareDigest,
          launchDigest: current.launchDigest,
          recoveryCapability: current.recoveryCapability,
        }),
        originalDeadline: current.originalDeadline,
        ...(current.reference === null
          ? {}
          : { reference: current.reference as ProviderAuthorityReference }),
      }));
    pending.sort((left, right) =>
      this.#key(left.binding.preparationOperationId)
        .localeCompare(this.#key(right.binding.preparationOperationId)));
    return Object.freeze(pending);
  }

  #appendPhase(next: DeliveryRecord): { readonly record: DeliveryRecord; readonly created: boolean } {
    this.#assertRootIdentity();
    const target = this.#path(next.preparationOperationId, next.phase);
    const existing = this.#readPhase(next.preparationOperationId, next.phase);
    if (existing) return Object.freeze({ record: existing, created: false });
    const temporary = path.join(
      this.#root,
      `.${this.#key(next.preparationOperationId)}.${PHASE_SUFFIX[next.phase]}.${randomUUID()}.tmp`
    );
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(next), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    let created = false;
    try {
      this.#assertRootIdentity();
      try {
        fs.linkSync(temporary, target);
        created = true;
        fsyncDirectory(this.#root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      this.#assertRootIdentity();
      const committed = this.#readPhase(next.preparationOperationId, next.phase);
      if (!committed) {
        throw new TypeError('Linux broker preparation delivery phase commit disappeared.');
      }
      return Object.freeze({ record: committed, created });
    } catch (error) {
      throw error;
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* best effort after immutable link */ }
    }
  }

  begin(
    preparationOperationId: string,
    prepareDigest: string,
    launchDigest: string,
    context: AuthorityOperationContext
  ): LinuxBrokerPreparationDeliveryEntry {
    if (context.phase !== 'prepare' || context.operationId !== preparationOperationId ||
        context.signal.aborted || !Number.isFinite(context.deadline) || context.deadline <= 0) {
      throw new TypeError('Linux broker preparation delivery context is malformed.');
    }
    const existing = this.#read(preparationOperationId);
    if (existing) {
      if (existing.prepareDigest !== prepareDigest || existing.launchDigest !== launchDigest) {
        throw new TypeError('Linux broker preparation operation conflicts with durable intent.');
      }
      return this.#entry(existing, false);
    }
    const recoveryCapability = randomBytes(32).toString('base64url');
    const binding = Object.freeze({
      preparationOperationId, prepareDigest, launchDigest, recoveryCapability,
    });
    validateBinding(binding);
    const record = complete(Object.freeze({
      schema: SCHEMA,
      recordVersion: VERSION,
      preparationOperationId,
      prepareDigest,
      launchDigest,
      recoveryCapability,
      originalDeadline: context.deadline,
      phase: 'Intent',
      reference: null,
      referenceDigest: null,
      reconciledDisposition: null,
      integrityAlgorithm: 'sha256',
    }));
    const committed = this.#appendPhase(record);
    if (committed.record.prepareDigest !== prepareDigest ||
        committed.record.launchDigest !== launchDigest) {
      throw new TypeError('Linux broker preparation operation conflicts with durable intent.');
    }
    return this.#entry(this.#read(preparationOperationId) ?? committed.record, committed.created);
  }

  storeReference(
    binding: LinuxBrokerPreparationDeliveryBinding,
    reference: ProviderAuthorityReference
  ): LinuxBrokerPreparationDeliveryEntry {
    validateBinding(binding);
    const current = this.#read(binding.preparationOperationId);
    if (!current || !this.#matches(current, binding)) {
      throw new TypeError('Linux broker preparation delivery intent is unavailable or conflicting.');
    }
    if (current.phase !== 'Intent') {
      if (current.reference === reference) return this.#entry(current, false);
      throw new TypeError('Linux broker preparation delivery reference conflicts.');
    }
    const next = complete(Object.freeze({
      ...this.#preimage(current),
      phase: 'ReferenceStored',
      reference: String(reference),
      referenceDigest: sha256(String(reference)),
    }));
    const committed = this.#appendPhase(next).record;
    if (!this.#matches(committed, binding) || committed.reference !== reference) {
      throw new TypeError('Linux broker preparation delivery reference conflicts.');
    }
    return this.#entry(this.#read(binding.preparationOperationId) ?? committed, false);
  }

  acknowledge(binding: LinuxBrokerPreparationDeliveryBinding): LinuxBrokerPreparationDeliveryEntry {
    validateBinding(binding);
    const current = this.#read(binding.preparationOperationId);
    if (!current || !this.#matches(current, binding) || current.phase === 'Intent') {
      throw new TypeError('Linux broker preparation delivery reference is not durably stored.');
    }
    if (current.phase === 'Acknowledged') return this.#entry(current, false);
    const next = complete(Object.freeze({ ...this.#preimage(current), phase: 'Acknowledged' }));
    const committed = this.#appendPhase(next).record;
    if (!this.#matches(committed, binding) || committed.reference !== current.reference ||
        committed.referenceDigest !== current.referenceDigest) {
      throw new TypeError('Linux broker preparation delivery acknowledgement conflicts.');
    }
    return this.#entry(this.#read(binding.preparationOperationId) ?? committed, false);
  }

  reconcile(
    binding: LinuxBrokerPreparationDeliveryBinding,
    disposition: LinuxBrokerPreparationDeliveryReconciledDisposition
  ): LinuxBrokerPreparationDeliveryEntry {
    validateBinding(binding);
    if (disposition !== 'exact-scope-empty') {
      throw new TypeError('Linux broker preparation delivery reconciliation is not exact empty.');
    }
    const current = this.#read(binding.preparationOperationId);
    if (!current || !this.#matches(current, binding) || current.phase === 'Acknowledged') {
      throw new TypeError('Linux broker preparation delivery reconciliation is out of order.');
    }
    if (current.phase === 'Reconciled') {
      if (current.reconciledDisposition === disposition) return this.#entry(current, false);
      throw new TypeError('Linux broker preparation delivery reconciliation conflicts.');
    }
    const next = complete(Object.freeze({
      ...this.#preimage(current),
      phase: 'Reconciled',
      reconciledDisposition: disposition,
    }));
    const committed = this.#appendPhase(next).record;
    if (!this.#matches(committed, binding) ||
        committed.reconciledDisposition !== disposition ||
        committed.reference !== current.reference ||
        committed.referenceDigest !== current.referenceDigest) {
      throw new TypeError('Linux broker preparation delivery reconciliation conflicts.');
    }
    return this.#entry(this.#read(binding.preparationOperationId) ?? committed, false);
  }

  #matches(record: DeliveryRecord, binding: LinuxBrokerPreparationDeliveryBinding): boolean {
    return record.preparationOperationId === binding.preparationOperationId &&
      record.prepareDigest === binding.prepareDigest && record.launchDigest === binding.launchDigest &&
      timingSafeEqual(Buffer.from(record.recoveryCapability, 'base64url'),
        Buffer.from(binding.recoveryCapability, 'base64url'));
  }

  #preimage(record: DeliveryRecord): DeliveryRecordPreimage {
    const { integrityDigest: _integrityDigest, ...preimage } = record;
    return preimage;
  }

  #entry(record: DeliveryRecord, created: boolean): LinuxBrokerPreparationDeliveryEntry {
    const binding = Object.freeze({
      preparationOperationId: record.preparationOperationId,
      prepareDigest: record.prepareDigest,
      launchDigest: record.launchDigest,
      recoveryCapability: record.recoveryCapability,
    });
    return Object.freeze({
      state: record.phase,
      created,
      binding,
      ...(record.reference === null ? {} : { reference: record.reference as ProviderAuthorityReference }),
      ...(record.reconciledDisposition === null
        ? {}
        : { reconciledDisposition: record.reconciledDisposition }),
    });
  }
}

Object.freeze(LinuxBrokerPreparationDeliveryLedger.prototype);

export function createLinuxBrokerPreparationDeliveryLedger(
  options: LinuxBrokerPreparationDeliveryLedgerOptions
): LinuxBrokerPreparationDeliveryLedger {
  return new LinuxBrokerPreparationDeliveryLedger(options);
}

/** @internal Provider-bundle construction guard; not an authority operation seam. */
export function assertLinuxBrokerPreparationDeliveryLedger(
  ledger: LinuxBrokerPreparationDeliveryLedger
): void {
  if (!authenticLedgers.has(ledger) ||
      Object.getPrototypeOf(ledger) !== LinuxBrokerPreparationDeliveryLedger.prototype ||
      !Object.isFrozen(ledger) ||
      !Object.isFrozen(LinuxBrokerPreparationDeliveryLedger.prototype)) {
    throw new TypeError('Linux broker preparation delivery ledger provenance is invalid.');
  }
}
