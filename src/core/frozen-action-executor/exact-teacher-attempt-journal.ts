import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  EXACT_TEACHER_ATTEMPT_PHASES,
  type ExactTeacherAttemptPhase,
  type ExactTeacherHostedReceiptIdentity,
} from '../session-host/contracts.js';
import type { ProcessAuthoritySelection } from '../session-host/process-authority/index.js';
import { decodeProcessAuthorityReferenceForDispatch } from '../session-host/process-authority/reference-codec.js';

export {
  EXACT_TEACHER_ATTEMPT_PHASES,
  type ExactTeacherAttemptPhase,
  type ExactTeacherHostedReceiptIdentity,
} from '../session-host/contracts.js';

export const EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA =
  'rasen-exact-teacher-attempt-journal/1' as const;

export interface ExactTeacherAttemptJournalRecord {
  readonly schema: typeof EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA;
  readonly recordVersion: 1;
  readonly revision: number;
  readonly attemptId: string;
  readonly provider: ProcessAuthoritySelection;
  readonly processRef?: string;
  readonly runId: string;
  readonly actionId: string;
  readonly invocationId: string;
  readonly attempt: number;
  readonly stableSessionId: string;
  readonly requestId: string;
  readonly baselineIdentity?: string;
  readonly hostedReceipt?: ExactTeacherHostedReceiptIdentity;
  readonly quarantineIdentity?: string;
  readonly phase: ExactTeacherAttemptPhase;
}

export interface ExactTeacherAttemptJournalAdvance {
  readonly revision: number;
  readonly phase: ExactTeacherAttemptPhase;
  readonly processRef?: string;
  readonly baselineIdentity?: string;
  readonly hostedReceipt?: ExactTeacherHostedReceiptIdentity;
  readonly quarantineIdentity?: string;
}

export interface ExactTeacherAttemptJournal {
  create(record: ExactTeacherAttemptJournalRecord): ExactTeacherAttemptJournalRecord;
  load(attemptId: string): ExactTeacherAttemptJournalRecord | undefined;
  advance(
    attemptId: string,
    expectedRevision: number,
    next: ExactTeacherAttemptJournalAdvance
  ): ExactTeacherAttemptJournalRecord;
}

export interface ExactTeacherAttemptJournalOptions {
  readonly root: string;
}

const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_IDENTITY_BYTES = 512;
const MAX_REFERENCE_BYTES = 16 * 1024;
const RECORD_KEYS = Object.freeze([
  'schema',
  'recordVersion',
  'revision',
  'attemptId',
  'provider',
  'processRef',
  'runId',
  'actionId',
  'invocationId',
  'attempt',
  'stableSessionId',
  'requestId',
  'baselineIdentity',
  'hostedReceipt',
  'quarantineIdentity',
  'phase',
] as const);
const PROVIDER_KEYS = Object.freeze([
  'providerId',
  'capabilityId',
  'protocolVersion',
] as const);
const RECEIPT_KEYS = Object.freeze([
  'stableSessionId',
  'requestId',
  'resultRef',
  'resultDigest',
] as const);
const DOCUMENT_KEYS = Object.freeze([
  ...RECORD_KEYS,
  'integrityAlgorithm',
  'integrityDigest',
] as const);
const ADVANCE_KEYS = Object.freeze([
  'revision',
  'phase',
  'processRef',
  'baselineIdentity',
  'hostedReceipt',
  'quarantineIdentity',
] as const);
const PHASE_INDEX = new Map(EXACT_TEACHER_ATTEMPT_PHASES.map((phase, index) => [phase, index]));
const BASELINE_REQUIRED_FROM = PHASE_INDEX.get('baseline-stable')!;
const PROCESS_REF_REQUIRED_FROM = PHASE_INDEX.get('authority-prepared-inert')!;
const HOSTED_RECEIPT_REQUIRED_FROM = PHASE_INDEX.get('result-quarantined')!;

interface PersistedExactTeacherAttemptJournalRecord extends ExactTeacherAttemptJournalRecord {
  readonly integrityAlgorithm: 'sha256';
  readonly integrityDigest: string;
}

interface RootIdentity {
  readonly realPath: string;
  readonly device: bigint;
  readonly inode: bigint;
}

function exactAllowedKeys(value: object, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function boundedText(value: unknown, maximum = MAX_IDENTITY_BYTES): value is string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    return false;
  }
  return Buffer.byteLength(value, 'utf8') <= maximum;
}

function validProvider(value: unknown): value is ProcessAuthoritySelection {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    exactAllowedKeys(value, PROVIDER_KEYS) &&
    Object.keys(value).length === PROVIDER_KEYS.length &&
    boundedText((value as { providerId?: unknown }).providerId) &&
    boundedText((value as { capabilityId?: unknown }).capabilityId) &&
    Number.isSafeInteger((value as { protocolVersion?: unknown }).protocolVersion) &&
    Number((value as { protocolVersion?: unknown }).protocolVersion) > 0;
}

function validProcessRef(
  value: unknown,
  provider: ProcessAuthoritySelection
): value is string {
  if (!boundedText(value, MAX_REFERENCE_BYTES)) return false;
  const decoded = decodeProcessAuthorityReferenceForDispatch(value);
  return decoded.state === 'dispatchable' &&
    decoded.selection.providerId === provider.providerId &&
    decoded.selection.capabilityId === provider.capabilityId &&
    decoded.selection.protocolVersion === provider.protocolVersion;
}

function validReceipt(
  value: unknown,
  stableSessionId: string,
  requestId: string
): value is ExactTeacherHostedReceiptIdentity {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactAllowedKeys(value, RECEIPT_KEYS) ||
    Object.keys(value).length !== RECEIPT_KEYS.length
  ) {
    return false;
  }
  const receipt = value as Partial<ExactTeacherHostedReceiptIdentity>;
  return receipt.stableSessionId === stableSessionId &&
    receipt.requestId === requestId &&
    boundedText(receipt.resultRef) &&
    typeof receipt.resultDigest === 'string' &&
    /^[a-f0-9]{64}$/u.test(receipt.resultDigest);
}

function normalizedRecord(value: unknown): ExactTeacherAttemptJournalRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !exactAllowedKeys(value, RECORD_KEYS)
  ) {
    throw new TypeError('Exact Teacher attempt journal record fields are malformed.');
  }
  const record = value as Partial<ExactTeacherAttemptJournalRecord>;
  const phaseIndex = PHASE_INDEX.get(record.phase as ExactTeacherAttemptPhase);
  if (
    record.schema !== EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA ||
    record.recordVersion !== 1 ||
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) <= 0 ||
    !boundedText(record.attemptId) ||
    !validProvider(record.provider) ||
    !boundedText(record.runId) ||
    !boundedText(record.actionId) ||
    !boundedText(record.invocationId) ||
    !Number.isSafeInteger(record.attempt) ||
    Number(record.attempt) <= 0 ||
    !boundedText(record.stableSessionId) ||
    !boundedText(record.requestId) ||
    phaseIndex === undefined ||
    (record.baselineIdentity !== undefined && !boundedText(record.baselineIdentity)) ||
    (phaseIndex < BASELINE_REQUIRED_FROM && record.baselineIdentity !== undefined) ||
    (phaseIndex >= BASELINE_REQUIRED_FROM && record.baselineIdentity === undefined) ||
    (record.processRef !== undefined && !validProcessRef(record.processRef, record.provider!)) ||
    (phaseIndex < PROCESS_REF_REQUIRED_FROM && record.processRef !== undefined) ||
    (phaseIndex >= PROCESS_REF_REQUIRED_FROM && record.processRef === undefined) ||
    (record.hostedReceipt !== undefined &&
      !validReceipt(record.hostedReceipt, record.stableSessionId, record.requestId)) ||
    (phaseIndex < HOSTED_RECEIPT_REQUIRED_FROM && record.hostedReceipt !== undefined) ||
    (phaseIndex >= HOSTED_RECEIPT_REQUIRED_FROM && record.hostedReceipt === undefined) ||
    (record.quarantineIdentity !== undefined &&
      !/^quarantine:sha256:[a-f0-9]{64}$/u.test(record.quarantineIdentity)) ||
    (phaseIndex < HOSTED_RECEIPT_REQUIRED_FROM && record.quarantineIdentity !== undefined) ||
    (phaseIndex >= HOSTED_RECEIPT_REQUIRED_FROM && record.quarantineIdentity === undefined) ||
    (record.hostedReceipt !== undefined &&
      record.quarantineIdentity !==
        `quarantine:sha256:${record.hostedReceipt.resultDigest}`)
  ) {
    throw new TypeError('Exact Teacher attempt journal record is malformed.');
  }
  return Object.freeze({
    schema: EXACT_TEACHER_ATTEMPT_JOURNAL_SCHEMA,
    recordVersion: 1,
    revision: record.revision!,
    attemptId: record.attemptId!,
    provider: Object.freeze({ ...record.provider! }),
    ...(record.processRef === undefined ? {} : { processRef: record.processRef }),
    runId: record.runId!,
    actionId: record.actionId!,
    invocationId: record.invocationId!,
    attempt: record.attempt!,
    stableSessionId: record.stableSessionId!,
    requestId: record.requestId!,
    ...(record.baselineIdentity === undefined
      ? {}
      : { baselineIdentity: record.baselineIdentity }),
    ...(record.hostedReceipt === undefined
      ? {}
      : { hostedReceipt: Object.freeze({ ...record.hostedReceipt }) }),
    ...(record.quarantineIdentity === undefined
      ? {}
      : { quarantineIdentity: record.quarantineIdentity }),
    phase: record.phase!,
  });
}

function digestPreimage(value: Omit<PersistedExactTeacherAttemptJournalRecord, 'integrityDigest'>): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function persisted(record: ExactTeacherAttemptJournalRecord): PersistedExactTeacherAttemptJournalRecord {
  const preimage = { ...record, integrityAlgorithm: 'sha256' as const };
  return Object.freeze({ ...preimage, integrityDigest: digestPreimage(preimage) });
}

function attemptFile(root: string, attemptId: string): string {
  const digest = createHash('sha256').update(attemptId, 'utf8').digest('hex');
  return path.join(root, `${digest}.attempt.json`);
}

function rootIdentity(root: string): RootIdentity {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Exact Teacher attempt journal root provenance is invalid.');
  }
  return Object.freeze({
    realPath: fs.realpathSync.native(root),
    device: BigInt(stat.dev),
    inode: BigInt(stat.ino),
  });
}

function prepareRoot(value: string): RootIdentity {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError('Exact Teacher attempt journal root must be an absolute trusted path.');
  }
  fs.mkdirSync(value, { recursive: true, mode: 0o700 });
  return rootIdentity(value);
}

function validateRoot(expected: RootIdentity): void {
  const current = rootIdentity(expected.realPath);
  if (
    current.realPath !== expected.realPath ||
    current.device !== expected.device ||
    current.inode !== expected.inode
  ) {
    throw new TypeError('Exact Teacher attempt journal root identity changed.');
  }
}

function flushDirectoryBestEffort(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform !== 'win32' ||
      !['EINVAL', 'EPERM', 'EACCES', 'EBADF', 'EISDIR'].includes(code ?? '')
    ) {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function durableReplace(root: string, target: string, record: ExactTeacherAttemptJournalRecord): void {
  const document = persisted(record);
  const bytes = Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new TypeError('Exact Teacher attempt journal record exceeds its byte bound.');
  }
  const temporary = path.join(root, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  flushDirectoryBestEffort(root);
}

function readRecord(target: string): ExactTeacherAttemptJournalRecord | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_DOCUMENT_BYTES) {
    throw new TypeError('Exact Teacher attempt journal durable record is malformed.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(target));
  } catch (error) {
    throw new TypeError('Exact Teacher attempt journal durable UTF-8 is malformed.', {
      cause: error,
    });
  }
  if (!text.endsWith('\n')) {
    throw new TypeError('Exact Teacher attempt journal durable record is malformed.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(0, -1));
  } catch (error) {
    throw new TypeError('Exact Teacher attempt journal durable JSON is malformed.', {
      cause: error,
    });
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !exactAllowedKeys(parsed, DOCUMENT_KEYS) ||
    Object.keys(parsed).length < DOCUMENT_KEYS.length - 4
  ) {
    throw new TypeError('Exact Teacher attempt journal durable record fields are malformed.');
  }
  const document = parsed as Partial<PersistedExactTeacherAttemptJournalRecord>;
  if (
    document.integrityAlgorithm !== 'sha256' ||
    typeof document.integrityDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(document.integrityDigest)
  ) {
    throw new TypeError('Exact Teacher attempt journal integrity is malformed.');
  }
  const { integrityDigest, integrityAlgorithm, ...record } = document;
  const preimage = { ...record, integrityAlgorithm } as Omit<
    PersistedExactTeacherAttemptJournalRecord,
    'integrityDigest'
  >;
  const expected = digestPreimage(
    preimage
  );
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(integrityDigest, 'hex'))) {
    throw new TypeError('Exact Teacher attempt journal integrity check failed.');
  }
  if (`${JSON.stringify(document)}\n` !== text) {
    throw new TypeError('Exact Teacher attempt journal durable encoding is non-canonical.');
  }
  return normalizedRecord(record);
}

function sameRecord(
  left: ExactTeacherAttemptJournalRecord,
  right: ExactTeacherAttemptJournalRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIdentity(
  current: ExactTeacherAttemptJournalRecord,
  next: ExactTeacherAttemptJournalRecord
): boolean {
  return current.attemptId === next.attemptId &&
    JSON.stringify(current.provider) === JSON.stringify(next.provider) &&
    current.runId === next.runId &&
    current.actionId === next.actionId &&
    current.invocationId === next.invocationId &&
    current.attempt === next.attempt &&
    current.stableSessionId === next.stableSessionId &&
    current.requestId === next.requestId &&
    (current.baselineIdentity === undefined ||
      current.baselineIdentity === next.baselineIdentity) &&
    (current.processRef === undefined || current.processRef === next.processRef) &&
    (current.hostedReceipt === undefined ||
      JSON.stringify(current.hostedReceipt) === JSON.stringify(next.hostedReceipt)) &&
    (current.quarantineIdentity === undefined ||
      current.quarantineIdentity === next.quarantineIdentity);
}

export function createExactTeacherAttemptJournal(
  options: ExactTeacherAttemptJournalOptions
): ExactTeacherAttemptJournal {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !exactAllowedKeys(options, ['root']) ||
    Object.keys(options).length !== 1
  ) {
    throw new TypeError('Exact Teacher attempt journal options are malformed.');
  }
  const identity = prepareRoot(options.root);
  const root = identity.realPath;

  const load = (attemptId: string): ExactTeacherAttemptJournalRecord | undefined => {
    if (!boundedText(attemptId)) {
      throw new TypeError('Exact Teacher attempt journal identity is malformed.');
    }
    validateRoot(identity);
    const record = readRecord(attemptFile(root, attemptId));
    if (record !== undefined && record.attemptId !== attemptId) {
      throw new TypeError('Exact Teacher attempt journal identity binding is malformed.');
    }
    return record;
  };

  return Object.freeze({
    create(value: ExactTeacherAttemptJournalRecord) {
      validateRoot(identity);
      const record = normalizedRecord(value);
      const target = attemptFile(root, record.attemptId);
      const existing = readRecord(target);
      if (existing !== undefined) {
        if (sameRecord(existing, record)) return existing;
        throw new TypeError('Exact Teacher attempt journal identity already has conflicting facts.');
      }
      durableReplace(root, target, record);
      return load(record.attemptId)!;
    },
    load,
    advance(
      attemptId: string,
      expectedRevision: number,
      next: ExactTeacherAttemptJournalAdvance
    ) {
      if (
        next === null ||
        typeof next !== 'object' ||
        Array.isArray(next) ||
        !exactAllowedKeys(next, ADVANCE_KEYS)
      ) {
        throw new TypeError('Exact Teacher attempt journal advance fields are malformed.');
      }
      const current = load(attemptId);
      if (current === undefined) {
        throw new TypeError('Exact Teacher attempt journal identity is unavailable.');
      }
      if (current.revision !== expectedRevision || next.revision !== expectedRevision + 1) {
        throw new TypeError('Exact Teacher attempt journal revision is stale or non-monotonic.');
      }
      const currentPhase = PHASE_INDEX.get(current.phase)!;
      const nextPhase = PHASE_INDEX.get(next.phase);
      if (nextPhase === undefined || nextPhase !== currentPhase + 1) {
        throw new TypeError('Exact Teacher attempt journal phase transition is non-monotonic.');
      }
      const candidate = normalizedRecord({
        ...current,
        revision: next.revision,
        phase: next.phase,
        ...(next.baselineIdentity === undefined
          ? {}
          : { baselineIdentity: next.baselineIdentity }),
        ...(next.processRef === undefined ? {} : { processRef: next.processRef }),
        ...(next.hostedReceipt === undefined ? {} : { hostedReceipt: next.hostedReceipt }),
        ...(next.quarantineIdentity === undefined
          ? {}
          : { quarantineIdentity: next.quarantineIdentity }),
      });
      if (!sameIdentity(current, candidate)) {
        throw new TypeError('Exact Teacher attempt journal authority identity is immutable.');
      }
      durableReplace(root, attemptFile(root, attemptId), candidate);
      return load(attemptId)!;
    },
  });
}
