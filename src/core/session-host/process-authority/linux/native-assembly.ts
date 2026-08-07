import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { ProviderBackedProcessRuntime } from '../process-scope-adapter.js';
import type {
  AuthorityOperationContext,
  AuthorityTerminationIntent,
  ProviderObservation,
} from '../types.js';
import {
  resolveLinuxProcessAuthorityArtifact,
  resolveLinuxProcessAuthorityArtifactForTesting,
  type LinuxProcessAuthorityArtifactResolutionOptions,
  type LinuxProcessAuthorityResolvedArtifact,
} from './artifact-resolver.js';
import type { LinuxProcessAuthorityBuildIdentity } from './build-authority.js';
import type {
  LinuxAuthorityExpectedArtifactIdentity,
  LinuxAuthorityNativePrepareRequest,
  LinuxAuthorityNativeTransport,
  LinuxAuthorityPublicationCommit,
  LinuxAuthorityRuntimeOpener,
} from './provider.js';
import {
  createLinuxBrokerPrivateAuthorityReference,
  decodeLinuxPrivateAuthorityReference,
  type LinuxBrokerPrivateAuthorityReferenceInput,
  type LinuxPrivateAuthorityReference,
} from './private-reference.js';
import type { LinuxBrokerPreparationDeliveryBinding } from './preparation-delivery-ledger.js';

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const FRAME_HEADER_BYTES = 12;
const BROKER_GUARDIAN_REFERENCE_MAGIC = 'BGR1';
const BROKER_CLIENT_REFERENCE_MAGIC = 'BCR1';
const FRAME = Object.freeze({
  prepare: 0x01,
  openRuntime: 0x02,
  activate: 0x03,
  inspect: 0x04,
  abort: 0x05,
  terminate: 0x06,
  input: 0x07,
  closeInput: 0x08,
  prepared: 0x81,
  runtimeReady: 0x82,
  activated: 0x83,
  observation: 0x84,
  output: 0x85,
  errorOutput: 0x86,
  event: 0x87,
  exactScopeEmpty: 0x88,
  failure: 0xff,
} as const);

type HelperProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export interface LinuxAuthorityNativeAssembly {
  readonly transport: LinuxAuthorityNativeTransport;
  readonly runtimeOpener: LinuxAuthorityRuntimeOpener;
  readonly artifactIdentity: LinuxAuthorityExpectedArtifactIdentity;
}

class ByteReader {
  #offset = 0;
  constructor(readonly bytes: Buffer) {}

  take(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || this.#offset + length > this.bytes.length) {
      throw new TypeError('Linux process-authority native payload is truncated.');
    }
    const value = this.bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  u8(): number { return this.take(1)[0]!; }
  u16(): number { return this.take(2).readUInt16BE(0); }
  u32(): number { return this.take(4).readUInt32BE(0); }
  u64(): bigint { return this.take(8).readBigUInt64BE(0); }
  i32(): number { return this.take(4).readInt32BE(0); }

  string16(maximum = 256): string {
    const length = this.u16();
    if (length === 0 || length > maximum) {
      throw new TypeError('Linux process-authority native string exceeds its bound.');
    }
    const bytes = this.take(length);
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (value.includes('\0')) throw new TypeError('Linux process-authority native string is malformed.');
    return value;
  }

  done(): void {
    if (this.#offset !== this.bytes.length) {
      throw new TypeError('Linux process-authority native payload contains trailing bytes.');
    }
  }
}

function u16(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function u32(value: number): Buffer {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function encodeBrokerPublicationBinding(binding: LinuxAuthorityPublicationCommit): Buffer {
  if (
    !/^[a-f0-9]{64}$/.test(binding.referenceDigest) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(binding.preparationOperationId) ||
    !/^[A-Za-z0-9_-]{22}$/.test(binding.generation) ||
    Buffer.from(binding.generation, 'base64url').byteLength !== 16 ||
    !/^[a-f0-9]{64}$/.test(binding.launchDigest) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(binding.publicationOperationId)
  ) {
    throw new TypeError('Linux broker publication binding is malformed.');
  }
  return Buffer.concat([
    Buffer.from('BPB1', 'ascii'),
    u16(1),
    fixedHex(binding.referenceDigest),
    text16(binding.preparationOperationId),
    fixedBase64Url(binding.generation, 16),
    fixedHex(binding.launchDigest),
    text16(binding.publicationOperationId),
  ]);
}

function encodeBrokerPreparationPayload(
  request: LinuxAuthorityNativePrepareRequest,
  runtimeRoot: string,
  artifact: LinuxProcessAuthorityResolvedArtifact
): Buffer {
  const prepare = encodePrepare(request, runtimeRoot);
  return Buffer.concat([
    Buffer.from('BGP1', 'ascii'),
    u16(1),
    fixedHex(artifact.artifact.sha256),
    fixedHex(artifact.artifact.sourceSha256),
    u32(prepare.byteLength),
    prepare,
  ]);
}

function brokerPreparationPayloadDigest(payload: Buffer): string {
  return createHash('sha256')
    .update('rasen-broker-prepared-delivery-payload-v1\0', 'utf8')
    .update(u32(payload.byteLength))
    .update(payload)
    .digest('hex');
}

function encodeBrokerPreparationDeliveryBinding(
  binding: LinuxBrokerPreparationDeliveryBinding
): Buffer {
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(binding.preparationOperationId) ||
    !/^[a-f0-9]{64}$/.test(binding.prepareDigest) ||
    !/^[a-f0-9]{64}$/.test(binding.launchDigest) ||
    !/^[A-Za-z0-9_-]{43}$/.test(binding.recoveryCapability)
  ) {
    throw new TypeError('Linux broker preparation delivery binding is malformed.');
  }
  return Buffer.concat([
    Buffer.from('BDB1', 'ascii'),
    u16(1),
    text16(binding.preparationOperationId),
    fixedHex(binding.prepareDigest),
    fixedHex(binding.launchDigest),
    fixedBase64Url(binding.recoveryCapability, 32),
  ]);
}

function encodeBrokerPreparationDeliveryRequest(
  binding: LinuxBrokerPreparationDeliveryBinding,
  payload: Buffer
): Buffer {
  if (brokerPreparationPayloadDigest(payload) !== binding.prepareDigest) {
    throw new TypeError('Linux broker preparation payload digest differs from delivery binding.');
  }
  const encodedBinding = encodeBrokerPreparationDeliveryBinding(binding);
  return Buffer.concat([
    Buffer.from('BDR1', 'ascii'), u16(1), u16(encodedBinding.byteLength), encodedBinding,
    u32(payload.byteLength), payload,
  ]);
}

function encodeBrokerPreparationAcknowledgement(
  binding: LinuxBrokerPreparationDeliveryBinding,
  referenceBytes: Buffer
): Buffer {
  const encodedBinding = encodeBrokerPreparationDeliveryBinding(binding);
  const referenceDigest = createHash('sha256').update(referenceBytes).digest();
  return Buffer.concat([
    Buffer.from('BDA1', 'ascii'), u16(1), u16(encodedBinding.byteLength), encodedBinding,
    referenceDigest,
  ]);
}

function remainingBudgetMs(context: AuthorityOperationContext): number {
  const remaining = Math.trunc(context.deadline - performance.now());
  if (!Number.isSafeInteger(remaining) || remaining <= 0 || context.signal.aborted) {
    throw new Error('Linux process-authority native operation deadline expired.');
  }
  return Math.min(300_000, remaining);
}

function u64(value: string): Buffer {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function fixedHex(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Linux native digest is malformed.');
  return Buffer.from(value, 'hex');
}

function fixedBase64Url(value: string, length: number): Buffer {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.byteLength !== length || bytes.toString('base64url') !== value) {
    throw new TypeError('Linux native capability is malformed.');
  }
  return bytes;
}

function text32(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u32(bytes.byteLength), bytes]);
}

function text16(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength === 0 || bytes.byteLength > 0xffff) {
    throw new TypeError('Linux native identity string exceeds its bound.');
  }
  return Buffer.concat([u16(bytes.byteLength), bytes]);
}

function frame(kind: number, payload: Buffer): Buffer {
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new TypeError('Linux process-authority native frame exceeds its bound.');
  }
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.write('RPA1', 0, 'ascii');
  header.writeUInt16BE(1, 4);
  header[6] = kind;
  header[7] = 0;
  header.writeUInt32BE(payload.byteLength, 8);
  return Buffer.concat([header, payload]);
}

function parseFrame(bytes: Buffer): { readonly kind: number; readonly payload: Buffer } {
  if (
    bytes.byteLength < FRAME_HEADER_BYTES ||
    bytes.subarray(0, 4).toString('ascii') !== 'RPA1' ||
    bytes.readUInt16BE(4) !== 1 ||
    bytes[7] !== 0
  ) {
    throw new TypeError('Linux process-authority native frame header is malformed.');
  }
  const length = bytes.readUInt32BE(8);
  if (length > MAX_FRAME_BYTES || bytes.byteLength !== FRAME_HEADER_BYTES + length) {
    throw new TypeError('Linux process-authority native frame length is malformed.');
  }
  return Object.freeze({ kind: bytes[6]!, payload: bytes.subarray(FRAME_HEADER_BYTES) });
}

function encodePrepare(request: LinuxAuthorityNativePrepareRequest, runtimeRoot: string): Buffer {
  const chunks: Buffer[] = [u16(1), text32(request.preparationOperationId), text32(runtimeRoot)];
  chunks.push(text32(request.input.command), text32(request.input.cwd));
  chunks.push(u32(request.input.args.length));
  for (const argument of request.input.args) chunks.push(text32(argument));
  const entries = Object.entries(request.input.env);
  chunks.push(u32(entries.length));
  for (const [key, value] of entries) chunks.push(text32(key), text32(value));
  return Buffer.concat(chunks);
}

function decodePrepared(payload: Buffer): Record<string, unknown> {
  const input = new ByteReader(payload);
  if (input.u16() !== 1 || input.u16() !== 1) {
    throw new TypeError('Linux prepared attestation version is unsupported.');
  }
  const generation = input.take(16).toString('base64url');
  const scopeCapability = input.take(32).toString('base64url');
  const controlCapability = input.take(32).toString('base64url');
  const preparationOperationId = input.string16();
  const launchDigest = input.take(32).toString('hex');
  const artifactSha256 = input.take(32).toString('hex');
  const sourceSha256 = input.take(32).toString('hex');
  const bootId = input.string16(64);
  const guardianPid = input.u32();
  const guardianStartTicks = input.u64().toString(10);
  const pidNamespaceDevice = input.u64().toString(10);
  const pidNamespaceInode = input.u64().toString(10);
  input.done();
  return Object.freeze({
    generation,
    scopeCapability,
    controlCapability,
    preparationOperationId,
    launchDigest,
    bootId,
    guardianPid,
    guardianStartTicks,
    pidNamespaceDevice,
    pidNamespaceInode,
    helperProtocolVersion: 1,
    artifactSha256,
    sourceSha256,
  });
}

function decodeBrokerPrepared(
  payload: Buffer,
  expectedRuntimeRoot: string
): Record<string, unknown> {
  const input = new ByteReader(payload);
  if (
    input.take(4).toString('ascii') !== BROKER_CLIENT_REFERENCE_MAGIC ||
    input.u16() !== 1
  ) {
    throw new TypeError('Linux broker client reference header is malformed.');
  }
  const guardianLength = input.u32();
  if (guardianLength === 0 || guardianLength > 32 * 1024 + 32 * 1024 + 32) {
    throw new TypeError('Linux broker guardian reference exceeds its bound.');
  }
  const guardianBytes = input.take(guardianLength);
  const brokerInstallSha256 = input.take(32).toString('hex');
  const brokerKeyId = input.take(32).toString('hex');
  const brokerLeaseToken = input.take(32).toString('base64url');
  const cgroupDevice = input.u64().toString(10);
  const cgroupInode = input.u64().toString(10);
  input.done();

  const guardian = new ByteReader(guardianBytes);
  if (
    guardian.take(4).toString('ascii') !== BROKER_GUARDIAN_REFERENCE_MAGIC ||
    guardian.u16() !== 1
  ) {
    throw new TypeError('Linux broker guardian reference header is malformed.');
  }
  const runtimeLength = guardian.u32();
  if (runtimeLength === 0 || runtimeLength > 32 * 1024) {
    throw new TypeError('Linux broker runtime root exceeds its bound.');
  }
  const runtimeRoot = new TextDecoder('utf-8', { fatal: true })
    .decode(guardian.take(runtimeLength));
  if (runtimeRoot !== expectedRuntimeRoot || !path.posix.isAbsolute(runtimeRoot)) {
    throw new TypeError('Linux broker runtime root differs from its immutable request.');
  }
  const attestationLength = guardian.u32();
  if (attestationLength === 0 || attestationLength > 32 * 1024) {
    throw new TypeError('Linux broker guardian attestation exceeds its bound.');
  }
  const attestation = decodePrepared(guardian.take(attestationLength));
  guardian.done();
  return Object.freeze({
    ...attestation,
    brokerInstallSha256,
    brokerKeyId,
    brokerLeaseToken,
    cgroupDevice,
    cgroupInode,
  });
}

function encodeAttestation(reference: LinuxPrivateAuthorityReference): Buffer {
  return Buffer.concat([
    u16(1),
    u16(reference.helperProtocolVersion),
    fixedBase64Url(reference.generation, 16),
    fixedBase64Url(reference.scopeCapability, 32),
    fixedBase64Url(reference.controlCapability, 32),
    text16(reference.preparationOperationId),
    fixedHex(reference.launchDigest),
    fixedHex(reference.artifactSha256),
    fixedHex(reference.sourceSha256),
    text16(reference.bootId),
    u32(reference.guardianPid),
    u64(reference.guardianStartTicks),
    u64(reference.pidNamespaceDevice),
    u64(reference.pidNamespaceInode),
  ]);
}

function encodeNativeReference(
  reference: LinuxPrivateAuthorityReference,
  runtimeRoot: string
): Buffer {
  const attestation = encodeAttestation(reference);
  if (reference.mode === 'user-pidns') return attestation;
  const runtime = Buffer.from(runtimeRoot, 'utf8');
  if (
    runtime.byteLength === 0 ||
    runtime.byteLength > 32 * 1024 ||
    !path.posix.isAbsolute(runtimeRoot) ||
    runtimeRoot.includes('\0')
  ) {
    throw new TypeError('Linux broker runtime root is malformed.');
  }
  const guardian = Buffer.concat([
    Buffer.from(BROKER_GUARDIAN_REFERENCE_MAGIC, 'ascii'),
    u16(1),
    u32(runtime.byteLength),
    runtime,
    u32(attestation.byteLength),
    attestation,
  ]);
  return Buffer.concat([
    Buffer.from(BROKER_CLIENT_REFERENCE_MAGIC, 'ascii'),
    u16(1),
    u32(guardian.byteLength),
    guardian,
    fixedHex(reference.brokerInstallSha256),
    fixedHex(reference.brokerKeyId),
    fixedBase64Url(reference.brokerLeaseToken, 32),
    u64(reference.cgroupDevice),
    u64(reference.cgroupInode),
  ]);
}

const SIGNALS = Object.freeze([
  '', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS',
  'SIGFPE', 'SIGKILL', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGPIPE', 'SIGALRM',
  'SIGTERM', 'SIGSTKFLT', 'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP', 'SIGTTIN',
  'SIGTTOU', 'SIGURG', 'SIGXCPU', 'SIGXFSZ', 'SIGVTALRM', 'SIGPROF', 'SIGWINCH',
  'SIGIO', 'SIGPWR', 'SIGSYS',
] as const);

function decodeJournal(payload: Buffer): ProviderObservation {
  if (
    payload.byteLength < 8 ||
    payload.subarray(0, 4).toString('ascii') !== 'RPJ1' ||
    payload.readUInt16BE(4) !== 1
  ) {
    throw new TypeError('Linux guardian journal header is malformed.');
  }
  const count = payload.readUInt16BE(6);
  if (count === 0 || count > 16 || payload.byteLength !== 8 + count * 16) {
    throw new TypeError('Linux guardian journal length is malformed.');
  }
  let last: ProviderObservation = { state: 'prepared-inert' };
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * 16;
    const sequence = payload.readBigUInt64BE(offset);
    const kind = payload[offset + 8]!;
    const tag = payload[offset + 9]!;
    const reserved = payload.readUInt16BE(offset + 10);
    const value = payload.readInt32BE(offset + 12);
    if (sequence !== BigInt(index + 1) || reserved !== 0) {
      throw new TypeError('Linux guardian journal sequence is malformed.');
    }
    if (kind === 1 && tag === 0 && value === 0 && index === 0) {
      last = { state: 'prepared-inert' };
    } else if (kind === 2 && tag === 0 && value === 0 && index === 1) {
      last = { state: 'live' };
    } else if (kind === 3 && index === 2 && tag === 1 && value >= 0 && value <= 255) {
      last = { state: 'root-exited', code: value, signal: null };
    } else if (kind === 3 && index === 2 && tag === 2 && SIGNALS[value]) {
      last = { state: 'root-exited', code: null, signal: SIGNALS[value] };
    } else if (kind === 4 && tag === 0 && value === 0 && index + 1 === count) {
      last = { state: 'exact-scope-empty' };
    } else {
      throw new TypeError('Linux guardian journal transition is malformed.');
    }
  }
  return Object.freeze(last);
}

function failureOutcome(payload: Buffer): Record<string, unknown> {
  if (payload.byteLength !== 3 || payload.readUInt16BE(0) !== 1) {
    throw new TypeError('Linux native failure payload is malformed.');
  }
  const mapping: Record<number, readonly [string, string]> = {
    1: ['authority-unavailable', 'native-unavailable'],
    2: ['authority-uncertain', 'native-uncertain'],
    3: ['identity-drift', 'identity-drift'],
    4: ['event-gap', 'event-gap'],
    5: ['timeout', 'native-operation-timeout'],
    6: ['control-loss', 'native-transport-lost'],
    7: ['authority-unavailable', 'reference-invalid'],
    8: ['authority-unavailable', 'artifact-unavailable'],
    9: ['authority-uncertain', 'native-state-retained'],
  };
  const mapped = mapping[payload[2]!];
  if (!mapped) throw new TypeError('Linux native failure code is unsupported.');
  return Object.freeze({ state: mapped[0], diagnosticCode: mapped[1] });
}

function spawnPinned(
  artifact: LinuxProcessAuthorityResolvedArtifact,
  arguments_: readonly string[]
): HelperProcess {
  return spawn('/proc/self/fd/3', [...arguments_], {
    stdio: ['pipe', 'pipe', 'pipe', artifact.executableFd],
    windowsHide: true,
  }) as HelperProcess;
}

async function invoke(
  artifact: LinuxProcessAuthorityResolvedArtifact,
  arguments_: readonly string[],
  request: Buffer,
  context: AuthorityOperationContext
): Promise<{ readonly kind: number; readonly payload: Buffer }> {
  const child = spawnPinned(artifact, arguments_);
  const chunks: Buffer[] = [];
  const diagnosticChunks: Buffer[] = [];
  let total = 0;
  let diagnosticBytes = 0;
  let stdinError: NodeJS.ErrnoException | undefined;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  const abort = () => child.kill('SIGKILL');
  context.signal.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', (chunk: Buffer) => {
    total += chunk.byteLength;
    if (total > MAX_FRAME_BYTES + FRAME_HEADER_BYTES) {
      child.kill('SIGKILL');
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    if (diagnosticBytes >= 4_096) return;
    const bounded = Buffer.from(chunk).subarray(0, 4_096 - diagnosticBytes);
    diagnosticBytes += bounded.byteLength;
    diagnosticChunks.push(bounded);
  });
  child.stdin.on('error', (error: NodeJS.ErrnoException) => { stdinError = error; });
  child.stdin.end(request);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        resolve();
      });
    });
  } finally {
    context.signal.removeEventListener('abort', abort);
  }
  if (context.signal.aborted || total > MAX_FRAME_BYTES + FRAME_HEADER_BYTES) {
    throw new Error('Linux process-authority native operation was cancelled or over-bound.');
  }
  if (total === 0) {
    const diagnostic = Buffer.concat(diagnosticChunks).toString('utf8')
      .replaceAll(/[\u0000-\u001f\u007f]+/gu, ' ')
      .trim()
      .slice(0, 1_024);
    throw new Error(
      `Linux process-authority helper closed without a frame (${String(exitCode)}/` +
      `${String(exitSignal)}${stdinError?.code ? `, stdin ${stdinError.code}` : ''})` +
      `${diagnostic ? `: ${diagnostic}` : '.'}`
    );
  }
  return parseFrame(Buffer.concat(chunks));
}

function controlArguments(
  operation: 'activate' | 'inspect' | 'abort' | 'terminate',
  runtimeRoot: string,
  deadlineMs: number,
  graceMs = 0
): string[] {
  const result = [operation, '--runtime-root', runtimeRoot];
  if (operation === 'terminate') result.push('--grace-ms', String(graceMs));
  result.push('--deadline-ms', String(deadlineMs));
  return result;
}

export interface LinuxAuthorityRuntimeTestChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null) => void): this;
}

function runtimeForChild(
  child: LinuxAuthorityRuntimeTestChild,
  reference: LinuxPrivateAuthorityReference,
  readyByGeneration: Map<string, Promise<void>>,
  runtimeRoot = ''
): ProviderBackedProcessRuntime {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let rootResolve!: (value: ProviderObservation) => void;
  let rootReject!: (reason: unknown) => void;
  let emptyResolve!: (value: ProviderObservation) => void;
  let emptyReject!: (reason: unknown) => void;
  const rootExited = new Promise<ProviderObservation>((resolve, reject) => {
    rootResolve = resolve;
    rootReject = reject;
  });
  const exactScopeEmpty = new Promise<ProviderObservation>((resolve, reject) => {
    emptyResolve = resolve;
    emptyReject = reject;
  });
  let readyResolve!: () => void;
  let readyReject!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  readyByGeneration.set(reference.generation, ready);
  let pending = Buffer.alloc(0);
  let sawReady = false;
  let readySettled = false;
  let rootSettled = false;
  let emptySettled = false;
  let failed = false;
  let input: Writable | undefined;
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    const exact = error instanceof Error
      ? error
      : new Error('Linux runtime bridge lost exact protocol authority.');
    if (!readySettled) {
      readySettled = true;
      readyReject(exact);
    }
    if (!rootSettled) {
      rootSettled = true;
      rootReject(exact);
    }
    if (!emptySettled) {
      emptySettled = true;
      emptyReject(exact);
    }
    input?.destroy();
    child.stdin.destroy();
    stdout.destroy();
    stderr.destroy();
  };
  child.stdout.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    try {
      while (pending.byteLength >= FRAME_HEADER_BYTES) {
        if (pending.subarray(0, 4).toString('ascii') !== 'RPA1') {
          throw new TypeError('Linux runtime frame magic is malformed.');
        }
        const length = pending.readUInt32BE(8);
        if (length > MAX_FRAME_BYTES) throw new TypeError('Linux runtime frame exceeds its bound.');
        if (pending.byteLength < FRAME_HEADER_BYTES + length) break;
        const next = parseFrame(pending.subarray(0, FRAME_HEADER_BYTES + length));
        pending = pending.subarray(FRAME_HEADER_BYTES + length);
        if (!sawReady) {
          if (next.kind !== FRAME.runtimeReady || next.payload.byteLength !== 0) {
            throw new TypeError('Linux runtime did not establish its exact bridge.');
          }
          sawReady = true;
          readySettled = true;
          readyResolve();
        } else if (next.kind === FRAME.output) {
          stdout.write(next.payload);
        } else if (next.kind === FRAME.errorOutput) {
          stderr.write(next.payload);
        } else if (next.kind === FRAME.event || next.kind === FRAME.exactScopeEmpty) {
          const observation = decodeJournal(next.payload);
          if (observation.state === 'root-exited' && !rootSettled) {
            rootSettled = true;
            rootResolve(observation);
          }
          if (observation.state === 'exact-scope-empty') {
            if (!rootSettled) {
              rootSettled = true;
              rootReject(new Error(
                'Linux runtime reached exact empty without a root-exit observation.'
              ));
            }
            emptySettled = true;
            emptyResolve(observation);
            stdout.end();
            stderr.end();
          }
        } else if (next.kind === FRAME.failure) {
          throw new Error(JSON.stringify(failureOutcome(next.payload)));
        } else {
          throw new TypeError('Linux runtime frame kind is unexpected.');
        }
      }
    } catch (error) {
      child.kill('SIGKILL');
      fail(error);
    }
  });
  child.once('error', fail);
  child.once('close', (code) => {
    readyByGeneration.delete(reference.generation);
    if (
      !sawReady ||
      code !== 0 ||
      pending.byteLength !== 0 ||
      !rootSettled ||
      !emptySettled
    ) {
      fail(new Error('Linux runtime bridge closed without exact terminal proof.'));
    }
  });
  child.stdin.write(frame(FRAME.openRuntime, encodeNativeReference(reference, runtimeRoot)));
  input = new Writable({
    write(chunk, _encoding, callback) {
      child.stdin.write(frame(FRAME.input, Buffer.from(chunk)), callback);
    },
    final(callback) {
      child.stdin.end(frame(FRAME.closeInput, Buffer.alloc(0)), callback);
    },
  });
  return Object.freeze({
    stdin: input,
    stdout,
    stderr,
    rootExited: rootExited as ProviderBackedProcessRuntime['rootExited'],
    exactScopeEmpty: exactScopeEmpty as ProviderBackedProcessRuntime['exactScopeEmpty'],
  });
}

function runtimeFor(
  artifact: LinuxProcessAuthorityResolvedArtifact,
  runtimeRoot: string,
  reference: LinuxPrivateAuthorityReference,
  readyByGeneration: Map<string, Promise<void>>
): ProviderBackedProcessRuntime {
  return runtimeForChild(
    spawnPinned(artifact, controlArguments('inspect', runtimeRoot, 300_000)
      .map((value, index) => index === 0 ? 'open-runtime' : value)),
    reference,
    readyByGeneration,
    runtimeRoot
  );
}

/** @internal Deterministic protocol-liveness seam; absent from the Linux public index. */
export function openLinuxAuthorityRuntimeBridgeForTesting(
  child: LinuxAuthorityRuntimeTestChild,
  reference: LinuxPrivateAuthorityReference,
  runtimeRoot = ''
): ProviderBackedProcessRuntime {
  return runtimeForChild(child, reference, new Map<string, Promise<void>>(), runtimeRoot);
}

/** @internal Exact Rust broker-reference codec seam; absent from the Linux public index. */
export function encodeLinuxBrokerReferenceForTesting(
  reference: LinuxPrivateAuthorityReference,
  runtimeRoot: string
): Buffer {
  if (reference.mode !== 'broker-pidns-cgroupv2') {
    throw new TypeError('Linux broker reference test seam requires broker mode.');
  }
  return encodeNativeReference(reference, runtimeRoot);
}

/** @internal Exact Rust broker-reference codec seam; absent from the Linux public index. */
export function decodeLinuxBrokerPreparedForTesting(
  payload: Buffer,
  runtimeRoot: string
): Record<string, unknown> {
  return decodeBrokerPrepared(payload, runtimeRoot);
}

function createLinuxNativeAssembly(
  runtimeRoot: string,
  mode: 'user-pidns' | 'broker-pidns-cgroupv2',
  resolvedArtifact?: LinuxProcessAuthorityResolvedArtifact
): LinuxAuthorityNativeAssembly {
  const packageRoot = path.resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
  const artifactPath = path.join(
    'dist',
    'native',
    `linux-${process.arch}`,
    mode === 'user-pidns'
      ? 'rasen-linux-process-authority-helper'
      : 'rasen-linux-process-authority-broker-client'
  );
  const artifact = resolvedArtifact ?? resolveLinuxProcessAuthorityArtifact({
    packageRoot,
    artifactPath,
    mode,
  });
  const readyByGeneration = new Map<string, Promise<void>>();
  const brokerPreparePayload = (request: LinuxAuthorityNativePrepareRequest): Buffer =>
    encodeBrokerPreparationPayload(request, runtimeRoot, artifact);
  const decodePrepareResponse = (
    response: { readonly kind: number; readonly payload: Buffer }
  ): Record<string, unknown> => {
    if (response.kind === FRAME.failure) {
      const failure = failureOutcome(response.payload);
      return failure.state === 'authority-unavailable'
        ? { state: 'authority-unavailable', diagnosticCode: 'prepare-unavailable' }
        : failure;
    }
    if (response.kind !== FRAME.prepared) {
      throw new TypeError('Linux native prepare returned an unexpected frame.');
    }
    return {
      state: 'inert',
      attestation: mode === 'user-pidns'
        ? decodePrepared(response.payload)
        : decodeBrokerPrepared(response.payload, runtimeRoot),
    };
  };
  const transport: LinuxAuthorityNativeTransport = Object.freeze({
    async prepare(
      request: LinuxAuthorityNativePrepareRequest,
      context: AuthorityOperationContext
    ) {
      const response = await invoke(
        artifact,
        [
          'prepare',
          '--artifact-sha256', artifact.artifact.sha256,
          '--source-sha256', artifact.artifact.sourceSha256,
          '--deadline-ms', String(remainingBudgetMs(context)),
        ],
        frame(FRAME.prepare, encodePrepare(request, runtimeRoot)),
        context
      );
      return decodePrepareResponse(response);
    },
    preparationDeliveryDigest(request: LinuxAuthorityNativePrepareRequest) {
      if (mode !== 'broker-pidns-cgroupv2') {
        throw new TypeError('Linux primary authority has no broker delivery digest seam.');
      }
      return brokerPreparationPayloadDigest(brokerPreparePayload(request));
    },
    async prepareDelivery(
      request: LinuxAuthorityNativePrepareRequest,
      binding: LinuxBrokerPreparationDeliveryBinding,
      context: AuthorityOperationContext
    ) {
      if (mode !== 'broker-pidns-cgroupv2') {
        throw new TypeError('Linux primary authority has no broker delivery seam.');
      }
      const payload = brokerPreparePayload(request);
      const response = await invoke(
        artifact,
        [
          'prepare',
          '--artifact-sha256', artifact.artifact.sha256,
          '--source-sha256', artifact.artifact.sourceSha256,
          '--deadline-ms', String(remainingBudgetMs(context)),
        ],
        frame(FRAME.prepare, encodeBrokerPreparationDeliveryRequest(binding, payload)),
        context
      );
      return decodePrepareResponse(response);
    },
    async recoverPreparedDelivery(
      binding: LinuxBrokerPreparationDeliveryBinding,
      context: AuthorityOperationContext
    ) {
      if (mode !== 'broker-pidns-cgroupv2') {
        throw new TypeError('Linux primary authority has no broker delivery recovery seam.');
      }
      const response = await invoke(
        artifact,
        ['recover-preparation', '--deadline-ms', String(remainingBudgetMs(context))],
        frame(FRAME.prepare, encodeBrokerPreparationDeliveryBinding(binding)),
        context
      );
      return decodePrepareResponse(response);
    },
    async acknowledgePreparedDelivery(
      reference: LinuxPrivateAuthorityReference,
      binding: LinuxBrokerPreparationDeliveryBinding,
      context: AuthorityOperationContext
    ) {
      if (mode !== 'broker-pidns-cgroupv2' || reference.mode !== mode) {
        throw new TypeError('Linux primary or mismatched authority has no broker delivery ACK seam.');
      }
      const encodedReference = encodeNativeReference(reference, runtimeRoot);
      const response = await invoke(
        artifact,
        ['acknowledge-preparation', '--runtime-root', runtimeRoot,
          '--deadline-ms', String(remainingBudgetMs(context))],
        frame(FRAME.inspect, Buffer.concat([
          u32(encodedReference.byteLength),
          encodedReference,
          encodeBrokerPreparationAcknowledgement(binding, encodedReference),
        ])),
        context
      );
      if (response.kind === FRAME.failure) {
        throw new Error('Linux broker preparation delivery acknowledgement failed closed.');
      }
      if (response.kind !== FRAME.observation || response.payload.byteLength !== 0) {
        throw new TypeError('Linux broker preparation delivery acknowledgement was malformed.');
      }
    },
    async abortPreparedDelivery(
      binding: LinuxBrokerPreparationDeliveryBinding,
      _reason: string,
      context: AuthorityOperationContext
    ) {
      if (mode !== 'broker-pidns-cgroupv2') {
        throw new TypeError('Linux primary authority has no broker delivery abort seam.');
      }
      const recovered = await invoke(
        artifact,
        ['recover-preparation', '--deadline-ms', String(remainingBudgetMs(context))],
        frame(FRAME.prepare, encodeBrokerPreparationDeliveryBinding(binding)),
        context
      );
      if (recovered.kind === FRAME.failure) return failureOutcome(recovered.payload);
      if (recovered.kind !== FRAME.prepared) {
        throw new TypeError('Linux broker delivery abort recovery returned an unexpected frame.');
      }
      const attestation = decodeBrokerPrepared(recovered.payload, runtimeRoot);
      if (attestation.preparationOperationId !== binding.preparationOperationId ||
          attestation.launchDigest !== binding.launchDigest ||
          attestation.artifactSha256 !== artifact.artifact.sha256 ||
          attestation.sourceSha256 !== artifact.artifact.sourceSha256) {
        throw new TypeError('Linux broker delivery abort reference identity differs.');
      }
      const reference = decodeLinuxPrivateAuthorityReference(
        createLinuxBrokerPrivateAuthorityReference(
          attestation as unknown as LinuxBrokerPrivateAuthorityReferenceInput
        )
      );
      const response = await invoke(
        artifact,
        controlArguments('abort', runtimeRoot, remainingBudgetMs(context)),
        frame(FRAME.abort, encodeNativeReference(reference, runtimeRoot)),
        context
      );
      if (response.kind === FRAME.failure) return failureOutcome(response.payload);
      return response.kind === FRAME.exactScopeEmpty
        ? { state: 'exact-scope-empty' }
        : decodeJournal(response.payload);
    },
    async recordPublication(
      reference: LinuxPrivateAuthorityReference,
      binding: LinuxAuthorityPublicationCommit,
      context: AuthorityOperationContext
    ) {
      if (mode !== 'broker-pidns-cgroupv2') {
        throw new TypeError('Linux primary authority has no broker publication seam.');
      }
      const encodedReference = encodeNativeReference(reference, runtimeRoot);
      const response = await invoke(
        artifact,
        ['record-publication', '--runtime-root', runtimeRoot,
          '--deadline-ms', String(remainingBudgetMs(context))],
        frame(FRAME.inspect, Buffer.concat([
          u32(encodedReference.byteLength),
          encodedReference,
          encodeBrokerPublicationBinding(binding),
        ])),
        context
      );
      if (response.kind === FRAME.failure) throw new Error('Linux broker publication failed closed.');
      if (response.kind !== FRAME.observation || response.payload.byteLength !== 0) {
        throw new TypeError('Linux broker publication returned an unexpected frame.');
      }
    },
    async activate(
      reference: LinuxPrivateAuthorityReference,
      context: AuthorityOperationContext
    ) {
      await readyByGeneration.get(reference.generation);
      const response = await invoke(
        artifact,
        controlArguments('activate', runtimeRoot, remainingBudgetMs(context)),
        frame(FRAME.activate, encodeNativeReference(reference, runtimeRoot)),
        context
      );
      if (response.kind === FRAME.failure) return failureOutcome(response.payload);
      if (response.kind !== FRAME.activated || response.payload.byteLength !== 0) {
        throw new TypeError('Linux native activation returned an unexpected frame.');
      }
      return { state: 'live' };
    },
    async inspect(
      reference: LinuxPrivateAuthorityReference,
      context: AuthorityOperationContext
    ) {
      const response = await invoke(
        artifact,
        controlArguments('inspect', runtimeRoot, remainingBudgetMs(context)),
        frame(FRAME.inspect, encodeNativeReference(reference, runtimeRoot)),
        context
      );
      if (response.kind === FRAME.failure) return failureOutcome(response.payload);
      if (response.kind !== FRAME.observation && response.kind !== FRAME.exactScopeEmpty) {
        throw new TypeError('Linux native inspection returned an unexpected frame.');
      }
      const outcome = decodeJournal(response.payload);
      return outcome.state === 'prepared-inert' || outcome.state === 'published-inert'
        ? { state: 'inert' }
        : outcome;
    },
    async terminate(
      reference: LinuxPrivateAuthorityReference,
      intent: AuthorityTerminationIntent,
      context: AuthorityOperationContext
    ) {
      const response = await invoke(
        artifact,
        controlArguments(
          'terminate',
          runtimeRoot,
          remainingBudgetMs(context),
          intent.graceMs
        ),
        frame(FRAME.terminate, encodeNativeReference(reference, runtimeRoot)),
        context
      );
      if (response.kind === FRAME.failure) return failureOutcome(response.payload);
      return response.kind === FRAME.exactScopeEmpty
        ? { state: 'exact-scope-empty' }
        : decodeJournal(response.payload);
    },
    async abort(
      reference: LinuxPrivateAuthorityReference,
      _reason: string,
      context: AuthorityOperationContext
    ) {
      const response = await invoke(
        artifact,
        controlArguments('abort', runtimeRoot, remainingBudgetMs(context)),
        frame(FRAME.abort, encodeNativeReference(reference, runtimeRoot)),
        context
      );
      if (response.kind === FRAME.failure) return failureOutcome(response.payload);
      return response.kind === FRAME.exactScopeEmpty
        ? { state: 'exact-scope-empty' }
        : decodeJournal(response.payload);
    },
  });
  const runtimeOpener: LinuxAuthorityRuntimeOpener = Object.freeze({
    open(reference: LinuxPrivateAuthorityReference) {
      return runtimeFor(artifact, runtimeRoot, reference, readyByGeneration);
    },
  });
  return Object.freeze({
    transport,
    runtimeOpener,
    artifactIdentity: Object.freeze({
      helperProtocolVersion: 1,
      artifactSha256: artifact.artifact.sha256,
      sourceSha256: artifact.artifact.sourceSha256,
    }),
  });
}

export function createLinuxPrimaryNativeAssembly(runtimeRoot: string): LinuxAuthorityNativeAssembly {
  return createLinuxNativeAssembly(runtimeRoot, 'user-pidns');
}

/** @internal Actual-Linux current-artifact seam; absent from the Linux public index. */
export function createLinuxPrimaryNativeAssemblyForTesting(
  runtimeRoot: string,
  resolution: LinuxProcessAuthorityArtifactResolutionOptions,
  authority: LinuxProcessAuthorityBuildIdentity
): LinuxAuthorityNativeAssembly {
  if (resolution.mode !== 'user-pidns' || authority.mode !== 'user-pidns') {
    throw new TypeError('Linux primary native test assembly requires the exact primary mode.');
  }
  return createLinuxNativeAssembly(
    runtimeRoot,
    'user-pidns',
    resolveLinuxProcessAuthorityArtifactForTesting(resolution, authority)
  );
}

export function createLinuxBrokerNativeAssembly(runtimeRoot: string): LinuxAuthorityNativeAssembly {
  return createLinuxNativeAssembly(runtimeRoot, 'broker-pidns-cgroupv2');
}
