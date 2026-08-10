import { spawn } from 'node:child_process';
import path from 'node:path';
import { PassThrough, Writable, type Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { ProviderBackedProcessRuntime } from '../process-scope-adapter.js';
import type {
  AuthorityOperationContext,
  AuthorityPrepareInput,
  AuthorityTerminationIntent,
} from '../types.js';
import {
  resolveWindowsProcessAuthorityArtifact,
  resolveWindowsProcessAuthorityArtifactForTesting,
  type WindowsProcessAuthorityArtifactResolutionOptions,
  type WindowsProcessAuthorityResolvedArtifact,
} from './artifact-resolver.js';
import type { WindowsProcessAuthorityBuildIdentity } from './build-authority.js';
import type { WindowsPrivateAuthorityReference } from './private-reference.js';
import type {
  WindowsAuthorityExpectedArtifactIdentity,
  WindowsAuthorityNativePrepareRequest,
  WindowsAuthorityNativeTransport,
  WindowsAuthorityRuntimeOpener,
} from './provider.js';
import type { WindowsIdentityProbeStage } from './recovery.js';

/**
 * The Windows analogue of `linux/native-assembly.ts`.
 *
 * The shape is the sibling's: resolve the packaged helper once, then run it as a
 * short-lived process per verb and translate its output into the closed outcome
 * vocabulary. The differences are forced by the two helpers' surfaces, and each
 * one is called out where it lands:
 *
 * - Linux pins the executable by inherited descriptor and spawns
 *   `/proc/self/fd/3`. Windows cannot execute from a descriptor, so the pin is
 *   the resolver's before/after device-inode-digest check **plus** the helper
 *   hashing its own image at run time (`cli.rs:measure_own_artifact`) and the
 *   provider refusing any attestation whose `artifactSha256` differs from the
 *   resolved one. The binding is therefore closed by the program that actually
 *   ran, not only by the file that was inspected.
 * - Linux speaks a binary frame protocol over the helper's stdio. The Windows
 *   helper's CLI speaks lines: `RWA1-ATTESTATION canonical <json>`,
 *   `RWA1-PROBE <key=value>...`, and `RWA1-OBSERVATION <hex>`. Everything below
 *   parses those and nothing invents a field the helper did not print.
 * - Linux has an `open-runtime` verb that copies frames verbatim, so its runtime
 *   bridge is exact. The Windows `control --verb run` verb de-multiplexes the
 *   workload's output onto the helper's own stdout and stderr, mixed with its
 *   own receipt lines, and never forwards standard input. A bridge built on it
 *   would let a workload that printed `RWA1-OBSERVATION ...` forge an
 *   exact-scope-empty receipt. That is refused rather than approximated; see
 *   `openRuntime` below.
 */
export interface WindowsAuthorityNativeAssembly {
  readonly transport: WindowsAuthorityNativeTransport;
  readonly runtimeOpener: WindowsAuthorityRuntimeOpener;
  readonly artifactIdentity: WindowsAuthorityExpectedArtifactIdentity;
}

const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_DIAGNOSTIC_BYTES = 4_096;
const MAX_DIAGNOSTIC_TEXT = 512;
const OBSERVATION_BYTES = 32;
const ATTESTATION_CANONICAL_PREFIX = 'RWA1-ATTESTATION canonical ';
const PROBE_PREFIX = 'RWA1-PROBE ';
const OBSERVATION_PREFIX = 'RWA1-OBSERVATION ';
const HELPER_DIAGNOSTIC_PREFIX = 'rasen-windows-process-authority: ';

/** `guardian.rs:Phase`, which `encode_observation` writes as its first byte. */
const PHASE_PREPARED_INERT = 1;
const PHASE_LIVE = 2;
const PHASE_ROOT_EXITED = 3;
const PHASE_EXACT_SCOPE_EMPTY = 4;
const PHASE_RETAINED = 5;

/** `guardian.rs:encode_observation` flag bits, in the order it sets them. */
const FLAG_ACTIVATED = 1 << 0;
const FLAG_ROOT_STATUS = 1 << 1;
const FLAG_MAY_EMIT_EXACT_EMPTY = 1 << 2;
const FLAG_EVENT_GAP = 1 << 3;
const FLAG_CONTROL_LOSS = 1 << 4;

/** `protocol.rs:ROOT_STATUS_CODE_ONLY`. The other three tags are refused. */
const ROOT_STATUS_CODE_ONLY = 1;

const CONTROL_LOSS = Object.freeze({
  state: 'control-loss',
  diagnosticCode: 'native-transport-lost',
});

function controlLoss(): Record<string, unknown> {
  return CONTROL_LOSS as unknown as Record<string, unknown>;
}

function fail(message: string): never {
  throw new TypeError(`Windows process-authority native assembly ${message}`);
}

/**
 * The helper's option parser treats any token beginning with `--` as a new key
 * (`cli.rs:parse_options`) and drops empty `--arg` values
 * (`cli.rs:launch_from`). Either would silently change the launch the guardian
 * digests, so the transport refuses such a launch before spawning instead of
 * letting it surface later as an unexplained identity-binding mismatch.
 */
function transportable(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
    fail(`cannot carry ${label} through the helper command line.`);
  }
  return value;
}

function remainingBudgetMs(context: AuthorityOperationContext): number {
  const remaining = Math.trunc(context.deadline - performance.now());
  if (!Number.isSafeInteger(remaining) || remaining <= 0 || context.signal.aborted) {
    fail('operation deadline expired.');
  }
  return Math.min(300_000, remaining);
}

function boundedMilliseconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff_ff_ff_ff) {
    fail(`${label} is out of the helper's bound.`);
  }
  return value;
}

function base64UrlToHex(value: string, bytes: number, label: string): string {
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== bytes || decoded.toString('base64url') !== value) {
    fail(`${label} is malformed.`);
  }
  return decoded.toString('hex');
}

/**
 * The helper prints the boot identity as 32 plain hex characters
 * (`cli.rs:probe_identity`) while the attestation projects the same 16 bytes as
 * dashed GUID text (`attestation.rs:to_canonical_json`), and the reference
 * carries the latter. Comparing the two renderings directly would make every
 * healthy authority read as boot drift, so the probe rendering is converted to
 * the reference rendering here. Both are lossless renderings of the same bytes,
 * so a genuinely different boot identity still compares unequal.
 */
function guidTextFromHex(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) return undefined;
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-');
}

function boundedDiagnostic(value: string): string {
  return value
    .replaceAll(/[\u0000-\u001f\u007f]+/gu, ' ')
    .trim()
    .slice(0, MAX_DIAGNOSTIC_TEXT);
}

/**
 * The last line carrying a prefix. Last rather than first because the helper
 * writes its own receipt after anything it relayed, and a relayed line must
 * never be able to stand in for the receipt.
 */
function lastLineWithPrefix(text: string, prefix: string): string | undefined {
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index]!.trim();
    if (candidate.startsWith(prefix)) return candidate;
  }
  return undefined;
}

/** The helper's own failure text, with its program prefix removed. */
function helperDiagnostic(stderr: string): string {
  const line = lastLineWithPrefix(stderr, HELPER_DIAGNOSTIC_PREFIX);
  return boundedDiagnostic(
    line === undefined ? stderr : line.slice(HELPER_DIAGNOSTIC_PREFIX.length)
  );
}

interface HelperRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly diagnostic: string;
}

async function invoke(
  artifact: WindowsProcessAuthorityResolvedArtifact,
  arguments_: readonly string[],
  context: AuthorityOperationContext
): Promise<HelperRun> {
  if (context.signal.aborted) fail('operation was cancelled before the helper started.');
  const child = spawn(artifact.helperPath, [...arguments_], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdoutChunks: Buffer[] = [];
  const diagnosticChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let diagnosticBytes = 0;
  let overBound = false;
  let spawnFailure: Error | undefined;
  let code: number | null = null;
  const abort = (): void => {
    child.kill();
  };
  context.signal.addEventListener('abort', abort, { once: true });
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      overBound = true;
      child.kill();
      return;
    }
    stdoutChunks.push(Buffer.from(chunk));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    if (diagnosticBytes >= MAX_DIAGNOSTIC_BYTES) return;
    const bounded = Buffer.from(chunk).subarray(0, MAX_DIAGNOSTIC_BYTES - diagnosticBytes);
    diagnosticBytes += bounded.byteLength;
    diagnosticChunks.push(bounded);
  });
  try {
    await new Promise<void>((resolve) => {
      child.once('error', (error: Error) => {
        spawnFailure = error;
        resolve();
      });
      // The guardian is created with an explicit two-handle inherit list
      // (`cli.rs:spawn_guardian`), so it never holds this helper's standard
      // output. `close` therefore arrives when the helper exits and cannot be
      // held open by a surviving authority - the Linux sibling's daemon-lifetime
      // problem has no Windows counterpart here.
      child.once('close', (exitCode) => {
        code = exitCode;
        resolve();
      });
    });
  } finally {
    context.signal.removeEventListener('abort', abort);
  }
  if (spawnFailure) fail(`could not run the helper (${boundedDiagnostic(spawnFailure.message)}).`);
  if (overBound) fail('helper output exceeded its bound.');
  if (context.signal.aborted) fail('operation was cancelled.');
  return Object.freeze({
    code,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    diagnostic: helperDiagnostic(Buffer.concat(diagnosticChunks).toString('utf8')),
  });
}

// ---------------------------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------------------------

/**
 * Task 4.8's enumerated prerequisites, reached from the codes the helper really
 * emits. `S8-F3` measured that the helper reports `reference-invalid` for an
 * untrusted state root and `native-unavailable` / `artifact-unavailable` for the
 * rest; this is the one place that turns those into the contract's vocabulary,
 * and the set is closed - anything else is a loud rejection, never a quiet
 * "prerequisites unavailable".
 */
const PREPARE_UNAVAILABLE_BY_DIAGNOSTIC: ReadonlyMap<string, string> = new Map([
  ['native-unavailable', 'native-unavailable'],
  ['artifact-unavailable', 'artifact-unavailable'],
  ['reference-invalid', 'state-root-untrusted'],
]);

/**
 * `attestation.rs:violations()` is the crate's own list of the conditions that
 * must hold before `prepared-inert`. Each one is a prerequisite this host did
 * not meet, so each maps onto an enumerated unavailability rather than onto a
 * malformed message.
 */
const PREPARE_UNAVAILABLE_BY_VIOLATION: ReadonlyMap<string, string> = new Map([
  ['job-limit-mask-is-not-exact', 'job-limit-mask-differs'],
  ['kill-on-job-close-is-not-enabled', 'job-limit-mask-differs'],
  ['breakaway-is-permitted', 'job-limit-mask-differs'],
  ['completion-port-was-associated-after-a-member-existed', 'completion-port-associated-late'],
  ['boot-identity-is-absent', 'boot-identity-unobtainable'],
  ['boot-identity-source-is-not-an-enumerated-candidate', 'boot-identity-unobtainable'],
]);

function unavailablePrepareOutcome(diagnostic: string): Record<string, unknown> {
  const mapped = PREPARE_UNAVAILABLE_BY_DIAGNOSTIC.get(diagnostic);
  if (mapped) return { state: 'authority-unavailable', diagnosticCode: mapped };
  if (diagnostic.startsWith('authority-unavailable: attestation violations')) {
    for (const [violation, code] of PREPARE_UNAVAILABLE_BY_VIOLATION) {
      if (diagnostic.includes(violation)) {
        return { state: 'authority-unavailable', diagnosticCode: code };
      }
    }
    // Still a violation of a `prepared-inert` precondition, so still a failed
    // prerequisite - just not one the design enumerated by name.
    return { state: 'authority-unavailable', diagnosticCode: 'native-unavailable' };
  }
  fail(`prepare failed with an unrecognised native diagnostic (${diagnostic}).`);
}

function prepareArguments(
  request: WindowsAuthorityNativePrepareRequest,
  runtimeRoot: string
): string[] {
  const input: AuthorityPrepareInput = request.input;
  const arguments_ = [
    'prepare',
    '--operation', transportable(request.preparationOperationId, 'the preparation operation id'),
    '--state-root', transportable(runtimeRoot, 'the trusted state root'),
    '--executable', transportable(input.command, 'the launch executable'),
    '--cwd', transportable(input.cwd, 'the launch working directory'),
  ];
  for (const argument of input.args) {
    arguments_.push('--arg', transportable(argument, 'a launch argument'));
  }
  for (const [key, value] of Object.entries(input.env)) {
    arguments_.push('--env', transportable(`${key}=${value}`, 'a launch environment entry'));
  }
  // Last on purpose: the helper reads a token as a flag only when no value
  // follows it, so a trailing position is what makes this a flag rather than a
  // key that swallows the next argument.
  if (input.windowsVerbatimArguments === true) arguments_.push('--verbatim-arguments');
  return arguments_;
}

function parsePrepareAttestation(stdout: string): Record<string, unknown> {
  const line = lastLineWithPrefix(stdout, ATTESTATION_CANONICAL_PREFIX);
  if (line === undefined) fail('prepare produced no canonical attestation.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(ATTESTATION_CANONICAL_PREFIX.length)) as unknown;
  } catch {
    fail('prepare attestation is not canonical JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('prepare attestation is not an object.');
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// probe-identity
// ---------------------------------------------------------------------------------------------

/**
 * `RWA1-PROBE state=... key=value ...`. Values never contain a space: the helper
 * replaces the spaces inside the one field that could hold them with a control byte.
 */
function parseProbeFields(stdout: string): Record<string, string> | undefined {
  const line = lastLineWithPrefix(stdout, PROBE_PREFIX);
  if (line === undefined) return undefined;
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const token of line.slice(PROBE_PREFIX.length).split(' ')) {
    if (token.length === 0) continue;
    const separator = token.indexOf('=');
    if (separator <= 0) return undefined;
    fields[token.slice(0, separator)] = token.slice(separator + 1);
  }
  return fields;
}

function probeNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[0-9]{1,10}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Translate one probe line into the object `parseWindowsAuthorityIdentityProbe`
 * consumes. This is the adapter `S9-F5`'s fourth observation named as missing:
 * before it, the only producer of that object anywhere was a test fixture.
 *
 * Two shapes the helper can print have no member in `WindowsAuthorityIdentityProbe`
 * and are reported as the retained outcome closest to what was observed rather
 * than repaired into a present tuple:
 *
 * - `state=identity-drift`. The helper has already decided the reference names a
 *   different process, but it prints no observed birth identity, so an
 *   `authority-present` object could only be built by inventing one. It is
 *   reported as control loss carrying the `identity-drift` code, which keeps the
 *   cause in the receipt while refusing to fabricate the tuple that would let
 *   the classifier derive it. The contract's `identity-drift` **state** is
 *   unreachable through this transport until `recovery.ts` gains that member.
 * - `terminalRecord`. The helper's durable record is
 *   `RWJ1 <sequence> exact-scope-empty <detail>` (`journal.rs`), which carries no
 *   scope id, generation, boot identity or sole-handle attestation. The
 *   classifier compares all four against the reference before it accepts a
 *   durable-terminal-record receipt, so filling them from the reference would
 *   make that comparison vacuous and fabricate exact-scope-empty. It is reported
 *   as `null`, which leaves the corroborated last-handle rule as the only route
 *   to an empty receipt - strictly the more conservative of the two.
 */
function toIdentityProbe(
  fields: Record<string, string> | undefined
): Record<string, unknown> {
  if (!fields) return controlLoss();
  const bootIdentity = guidTextFromHex(fields.bootIdentity);
  switch (fields.state) {
    case 'authority-present': {
      const guardianProcessId = probeNumber(fields.guardianProcessId);
      const endpointServerProcessId = probeNumber(fields.endpointServerProcessId);
      if (
        bootIdentity === undefined ||
        guardianProcessId === undefined ||
        endpointServerProcessId === undefined ||
        typeof fields.guardianCreationTime !== 'string' ||
        typeof fields.endpointOwnerSid !== 'string' ||
        (fields.endpointAuthentication !== 'authenticated' &&
          fields.endpointAuthentication !== 'rejected') ||
        typeof fields.soleHandleAttestation !== 'string' ||
        fields.soleHandleAttestation === 'null'
      ) {
        // A present line the helper did not fully populate is not completed from
        // the reference; it is reported as control loss.
        return controlLoss();
      }
      return {
        state: 'authority-present',
        bootIdentity,
        guardianProcessId,
        guardianCreationTime: fields.guardianCreationTime,
        endpointServerProcessId,
        endpointOwnerSid: fields.endpointOwnerSid,
        endpointAuthentication: fields.endpointAuthentication,
        soleHandleAttestation: fields.soleHandleAttestation,
      };
    }
    case 'authority-absent': {
      if (
        bootIdentity === undefined ||
        (fields.endpointPresent !== 'true' && fields.endpointPresent !== 'false') ||
        typeof fields.soleHandleAttestation !== 'string'
      ) {
        return controlLoss();
      }
      return {
        state: 'authority-absent',
        bootIdentity,
        endpointPresent: fields.endpointPresent === 'true',
        soleHandleAttestation: fields.soleHandleAttestation === 'null'
          ? null
          : fields.soleHandleAttestation,
        terminalRecord: null,
      };
    }
    case 'identity-drift':
      return { state: 'control-loss', diagnosticCode: 'identity-drift' };
    case 'authority-uncertain':
      return { state: 'authority-uncertain', diagnosticCode: 'native-uncertain' };
    case 'authority-unavailable':
      return {
        state: 'authority-unavailable',
        diagnosticCode: fields.diagnosticCode === 'boot-identity-unobtainable'
          ? 'boot-identity-unobtainable'
          : 'native-unavailable',
      };
    default:
      return controlLoss();
  }
}

function probeArguments(
  reference: WindowsPrivateAuthorityReference,
  stage: WindowsIdentityProbeStage,
  runtimeRoot: string
): string[] {
  return [
    'probe-identity',
    '--scope', base64UrlToHex(reference.scopeId, 16, 'the scope id'),
    '--stage', stage,
    '--guardian-pid', String(reference.guardianProcessId),
    '--guardian-birth', reference.guardianCreationTime,
    '--owner-sid', transportable(reference.endpointOwnerSid, 'the endpoint owner identity'),
    '--sole-handle-token',
    base64UrlToHex(reference.soleHandleAttestation, 32, 'the sole-handle attestation'),
    '--state-root', transportable(runtimeRoot, 'the trusted state root'),
  ];
}

// ---------------------------------------------------------------------------------------------
// control
// ---------------------------------------------------------------------------------------------

function controlArguments(
  reference: WindowsPrivateAuthorityReference,
  verb: 'inspect' | 'abort' | 'terminate' | 'bridge',
  deadlineMs: number,
  graceMs = 0
): string[] {
  const arguments_ = [
    'control',
    '--scope', base64UrlToHex(reference.scopeId, 16, 'the scope id'),
    '--guardian-pid', String(reference.guardianProcessId),
    '--guardian-birth', reference.guardianCreationTime,
    '--owner-sid', transportable(reference.endpointOwnerSid, 'the endpoint owner identity'),
    '--capability', base64UrlToHex(reference.controlCapability, 32, 'the control capability'),
    '--verb', verb,
    '--deadline-ms', String(deadlineMs),
  ];
  if (verb === 'terminate') arguments_.push('--grace-ms', String(graceMs));
  return arguments_;
}

const RUNTIME_FRAME_HEADER_BYTES = 12;
const RUNTIME_MAX_FRAME_BYTES = 1024 * 1024;
const RUNTIME_FRAME = Object.freeze({
  activate: 0x03,
  abort: 0x05,
  terminate: 0x06,
  input: 0x07,
  closeInput: 0x08,
  runtimeReady: 0x82,
  activated: 0x83,
  output: 0x85,
  errorOutput: 0x86,
  event: 0x87,
  rootExited: 0x88,
  exactScopeEmpty: 0x89,
  failure: 0xff,
});

function runtimeFrame(kind: number, payload = Buffer.alloc(0)): Buffer {
  if (payload.byteLength > RUNTIME_MAX_FRAME_BYTES) {
    throw new TypeError('Windows process-authority runtime frame exceeds its bound.');
  }
  const header = Buffer.alloc(RUNTIME_FRAME_HEADER_BYTES);
  header.write('RWA1', 0, 'ascii');
  header.writeUInt16BE(1, 4);
  header[6] = kind;
  header[7] = 0;
  header.writeUInt32BE(payload.byteLength, 8);
  return Buffer.concat([header, payload]);
}

export interface WindowsAuthorityRuntimeTestChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null) => void): this;
}

export interface WindowsAuthorityRuntimeTestController {
  readonly runtime: ProviderBackedProcessRuntime;
  activate(context: AuthorityOperationContext): Promise<unknown>;
  terminate(
    intent: AuthorityTerminationIntent,
    context: AuthorityOperationContext
  ): Promise<unknown>;
  abort(context: AuthorityOperationContext): Promise<unknown>;
}

function runtimeControllerForChild(
  child: WindowsAuthorityRuntimeTestChild,
  remove: () => void
): WindowsAuthorityRuntimeTestController {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let pending = Buffer.alloc(0);
  let diagnosticBytes = 0;
  const diagnostics: Buffer[] = [];
  let readySettled = false;
  let activatedSettled = false;
  let rootSettled = false;
  let emptySettled = false;
  let failed = false;
  let readyResolve!: () => void;
  let readyReject!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let activatedResolve!: () => void;
  let activatedReject!: (reason: unknown) => void;
  const activated = new Promise<void>((resolve, reject) => {
    activatedResolve = resolve;
    activatedReject = reject;
  });
  let rootResolve!: (value: { state: 'root-exited'; code: number; signal: null }) => void;
  let rootReject!: (reason: unknown) => void;
  const rootExited = new Promise<{ state: 'root-exited'; code: number; signal: null }>(
    (resolve, reject) => {
      rootResolve = resolve;
      rootReject = reject;
    }
  );
  let emptyResolve!: (value: { state: 'exact-scope-empty' }) => void;
  let emptyReject!: (reason: unknown) => void;
  const exactScopeEmpty = new Promise<{ state: 'exact-scope-empty' }>(
    (resolve, reject) => {
      emptyResolve = resolve;
      emptyReject = reject;
    }
  );

  const fail = (reason: unknown): void => {
    if (failed) return;
    failed = true;
    remove();
    const error = reason instanceof Error
      ? reason
      : new Error('Windows runtime bridge lost exact protocol authority.');
    if (!readySettled) {
      readySettled = true;
      readyReject(error);
    }
    if (!activatedSettled) {
      activatedSettled = true;
      activatedReject(error);
    }
    if (!rootSettled) {
      rootSettled = true;
      rootReject(error);
    }
    if (!emptySettled) {
      emptySettled = true;
      emptyReject(error);
    }
    child.stdin.destroy();
    stdout.destroy(error);
    stderr.destroy(error);
  };

  child.stderr.on('data', (chunk: Buffer) => {
    if (diagnosticBytes >= MAX_DIAGNOSTIC_BYTES) return;
    const bounded = Buffer.from(chunk).subarray(0, MAX_DIAGNOSTIC_BYTES - diagnosticBytes);
    diagnosticBytes += bounded.byteLength;
    diagnostics.push(bounded);
  });
  child.stdout.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    try {
      while (pending.byteLength >= RUNTIME_FRAME_HEADER_BYTES) {
        if (
          pending.subarray(0, 4).toString('ascii') !== 'RWA1' ||
          pending.readUInt16BE(4) !== 1 ||
          pending[7] !== 0
        ) {
          throw new TypeError('Windows runtime frame header is malformed.');
        }
        const length = pending.readUInt32BE(8);
        if (length > RUNTIME_MAX_FRAME_BYTES) {
          throw new TypeError('Windows runtime frame exceeds its bound.');
        }
        if (pending.byteLength < RUNTIME_FRAME_HEADER_BYTES + length) break;
        const kind = pending[6]!;
        const payload = pending.subarray(
          RUNTIME_FRAME_HEADER_BYTES,
          RUNTIME_FRAME_HEADER_BYTES + length
        );
        pending = pending.subarray(RUNTIME_FRAME_HEADER_BYTES + length);
        if (!readySettled) {
          if (kind !== RUNTIME_FRAME.runtimeReady || payload.byteLength !== 0) {
            throw new TypeError('Windows runtime did not establish its exact bridge.');
          }
          readySettled = true;
          readyResolve();
          continue;
        }
        if (kind === RUNTIME_FRAME.activated) {
          if (payload.byteLength !== 4 || activatedSettled) {
            throw new TypeError('Windows runtime activation frame is malformed or duplicated.');
          }
          activatedSettled = true;
          activatedResolve();
        } else if (kind === RUNTIME_FRAME.output) {
          stdout.write(payload);
        } else if (kind === RUNTIME_FRAME.errorOutput) {
          stderr.write(payload);
        } else if (kind === RUNTIME_FRAME.event) {
          // Events remain provider-private diagnostics. Exact terminal authority
          // comes only from the dedicated terminal frames below.
        } else if (kind === RUNTIME_FRAME.rootExited) {
          if (payload.byteLength !== 5 || payload[0] !== ROOT_STATUS_CODE_ONLY || rootSettled) {
            throw new TypeError('Windows runtime root-exit frame is malformed or duplicated.');
          }
          rootSettled = true;
          rootResolve({
            state: 'root-exited',
            code: payload.readUInt32BE(1),
            signal: null,
          });
        } else if (kind === RUNTIME_FRAME.exactScopeEmpty) {
          if (payload.byteLength !== OBSERVATION_BYTES || emptySettled) {
            throw new TypeError('Windows runtime exact-empty frame is malformed or duplicated.');
          }
          if (!rootSettled) {
            rootSettled = true;
            rootReject(new Error(
              'Windows runtime reached exact empty without a root-exit observation.'
            ));
          }
          emptySettled = true;
          emptyResolve({ state: 'exact-scope-empty' });
          remove();
          stdout.end();
          stderr.end();
        } else if (kind === RUNTIME_FRAME.failure) {
          throw new Error('Windows authority runtime reported a typed failure.');
        } else {
          throw new TypeError('Windows runtime frame kind is unexpected.');
        }
      }
    } catch (error) {
      child.kill();
      fail(error);
    }
  });
  child.once('error', fail);
  child.once('close', (code) => {
    if (
      code !== 0 ||
      pending.byteLength !== 0 ||
      !readySettled ||
      !rootSettled ||
      !emptySettled
    ) {
      const diagnostic = boundedDiagnostic(
        Buffer.concat(diagnostics).toString('utf8')
      );
      fail(new Error(
        `Windows runtime bridge closed without exact terminal proof${
          diagnostic.length === 0 ? '' : ` (${diagnostic})`
        }.`
      ));
    }
  });

  const input = new Writable({
    write(chunk, _encoding, callback) {
      child.stdin.write(runtimeFrame(RUNTIME_FRAME.input, Buffer.from(chunk)), callback);
    },
    final(callback) {
      child.stdin.write(runtimeFrame(RUNTIME_FRAME.closeInput), callback);
    },
  });
  return Object.freeze({
    runtime: Object.freeze({
      stdin: input,
      stdout,
      stderr,
      rootExited: rootExited as ProviderBackedProcessRuntime['rootExited'],
      exactScopeEmpty: exactScopeEmpty as ProviderBackedProcessRuntime['exactScopeEmpty'],
    }),
    async activate(context: AuthorityOperationContext) {
      if (context.signal.aborted) return controlLoss();
      await ready;
      if (context.signal.aborted) return controlLoss();
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(runtimeFrame(RUNTIME_FRAME.activate), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await activated;
      return { state: 'live' };
    },
    async terminate(
      intent: AuthorityTerminationIntent,
      context: AuthorityOperationContext
    ) {
      if (context.signal.aborted) return controlLoss();
      const payload = Buffer.alloc(8);
      payload.writeUInt32BE(boundedMilliseconds(intent.graceMs, 'the graceful interval'), 0);
      payload.writeUInt32BE(boundedMilliseconds(
        Math.max(1, Math.trunc(context.deadline - performance.now())),
        'the termination deadline'
      ), 4);
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(runtimeFrame(RUNTIME_FRAME.terminate, payload), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await exactScopeEmpty;
      return { state: 'exact-scope-empty' };
    },
    async abort(context: AuthorityOperationContext) {
      if (context.signal.aborted) return controlLoss();
      const payload = Buffer.alloc(8);
      payload.writeUInt32BE(0, 0);
      payload.writeUInt32BE(boundedMilliseconds(
        Math.max(1, Math.trunc(context.deadline - performance.now())),
        'the abort deadline'
      ), 4);
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(runtimeFrame(RUNTIME_FRAME.abort, payload), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await exactScopeEmpty;
      return { state: 'exact-scope-empty' };
    },
  });
}

function openFramePreservingRuntime(
  artifact: WindowsProcessAuthorityResolvedArtifact,
  reference: WindowsPrivateAuthorityReference,
  remove: () => void
): WindowsAuthorityRuntimeTestController {
  return runtimeControllerForChild(
    spawn(
      artifact.helperPath,
      controlArguments(reference, 'bridge', 0xff_ff_ff_ff),
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    ),
    remove
  );
}

/** @internal Deterministic frame bridge seam; absent from the Windows public index. */
export function openWindowsAuthorityRuntimeControllerForTesting(
  child: WindowsAuthorityRuntimeTestChild
): WindowsAuthorityRuntimeTestController {
  return runtimeControllerForChild(child, () => undefined);
}

/**
 * The closed translation of the helper's failure text. Nothing here can produce
 * `exact-scope-empty`, `live` or `root-exited`: a failed control verb never
 * carries a receipt, and an unrecognised diagnostic stays control loss rather
 * than widening into unavailability.
 */
const CONTROL_OUTCOME_BY_DIAGNOSTIC: ReadonlyMap<string, Record<string, unknown>> = new Map([
  ['native-operation-timeout', { state: 'timeout', diagnosticCode: 'native-operation-timeout' }],
  ['native-uncertain', { state: 'authority-uncertain', diagnosticCode: 'native-uncertain' }],
  ['native-state-retained', { state: 'authority-uncertain', diagnosticCode: 'native-state-retained' }],
  ['native-ordering-conflict', { state: 'authority-uncertain', diagnosticCode: 'native-state-retained' }],
  ['native-unavailable', { state: 'authority-unavailable', diagnosticCode: 'native-unavailable' }],
  ['artifact-unavailable', { state: 'authority-unavailable', diagnosticCode: 'artifact-unavailable' }],
  ['reference-invalid', { state: 'authority-unavailable', diagnosticCode: 'reference-invalid' }],
  ['identity-drift', { state: 'identity-drift', diagnosticCode: 'identity-drift' }],
  ['event-gap', { state: 'event-gap', diagnosticCode: 'event-gap' }],
  ['native-transport-lost', { state: 'control-loss', diagnosticCode: 'native-transport-lost' }],
]);

function controlFailureOutcome(diagnostic: string): Record<string, unknown> {
  for (const [code, outcome] of CONTROL_OUTCOME_BY_DIAGNOSTIC) {
    // The helper emits some of these bare and some as `<code>: <explanation>`.
    if (diagnostic === code || diagnostic.startsWith(`${code}:`)) return { ...outcome };
  }
  return controlLoss();
}

/**
 * `guardian.rs:encode_observation`, decoded field by field. The phase byte alone
 * does not decide the answer: an `exact-scope-empty` phase must also carry the
 * flag the guardian only sets when the authority's own `ACTIVE_PROCESS_ZERO`
 * message arrived with a complete history, and a `root-exited` phase must carry
 * the single-branch status tag. Anything else is control loss, never a repaired
 * receipt.
 */
function decodeObservation(stdout: string): Record<string, unknown> {
  const line = lastLineWithPrefix(stdout, OBSERVATION_PREFIX);
  if (line === undefined) fail('control produced no observation.');
  const text = line.slice(OBSERVATION_PREFIX.length);
  if (!/^[a-f0-9]+$/.test(text) || text.length !== OBSERVATION_BYTES * 2) {
    fail('observation payload length is malformed.');
  }
  const bytes = Buffer.from(text, 'hex');
  const phase = bytes[0]!;
  const flags = bytes[1]!;
  const rootStatusPresent = bytes[6]! === 1;
  if (
    (flags & ~(FLAG_ACTIVATED | FLAG_ROOT_STATUS | FLAG_MAY_EMIT_EXACT_EMPTY |
      FLAG_EVENT_GAP | FLAG_CONTROL_LOSS)) !== 0 ||
    rootStatusPresent !== ((flags & FLAG_ROOT_STATUS) !== 0) ||
    (bytes[6]! !== 0 && bytes[6]! !== 1)
  ) {
    return controlLoss();
  }
  if (phase === PHASE_PREPARED_INERT) return { state: 'inert' };
  if (phase === PHASE_LIVE) return { state: 'live' };
  if (phase === PHASE_ROOT_EXITED) {
    if (!rootStatusPresent || bytes[7]! !== ROOT_STATUS_CODE_ONLY) return controlLoss();
    return { state: 'root-exited', code: bytes.readUInt32BE(8), signal: null };
  }
  if (phase === PHASE_EXACT_SCOPE_EMPTY) {
    if ((flags & FLAG_MAY_EMIT_EXACT_EMPTY) === 0) return controlLoss();
    return { state: 'exact-scope-empty' };
  }
  if (phase === PHASE_RETAINED) {
    return (flags & FLAG_EVENT_GAP) !== 0
      ? { state: 'event-gap', diagnosticCode: 'event-gap' }
      : controlLoss();
  }
  return controlLoss();
}

/**
 * A terminating verb may only ever report the authority's own empty event. The
 * helper returns success solely on `ExactScopeEmpty` (`cli.rs`), and this checks
 * the payload agrees rather than trusting the exit status.
 */
function terminalOutcome(stdout: string): Record<string, unknown> {
  const observation = decodeObservation(stdout);
  return observation.state === 'exact-scope-empty' ? observation : controlLoss();
}

// ---------------------------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------------------------

export const WINDOWS_PROCESS_AUTHORITY_HELPER_FILE =
  'rasen-windows-process-authority-helper.exe' as const;

function helperArtifactPath(): string {
  return path.posix.join('dist', 'native', `win32-${process.arch}`,
    WINDOWS_PROCESS_AUTHORITY_HELPER_FILE);
}

function assemble(
  runtimeRoot: string,
  artifact: WindowsProcessAuthorityResolvedArtifact
): WindowsAuthorityNativeAssembly {
  const runtimeControllers = new Map<string, WindowsAuthorityRuntimeTestController>();
  const runtimeKey = (reference: WindowsPrivateAuthorityReference): string =>
    `${reference.scopeId}:${reference.generation}`;
  const transport: WindowsAuthorityNativeTransport = Object.freeze({
    async prepare(
      request: WindowsAuthorityNativePrepareRequest,
      context: AuthorityOperationContext
    ) {
      remainingBudgetMs(context);
      const run = await invoke(artifact, prepareArguments(request, runtimeRoot), context);
      if (run.code !== 0) return unavailablePrepareOutcome(run.diagnostic);
      return { state: 'inert', attestation: parsePrepareAttestation(run.stdout) };
    },
    async probeIdentity(
      reference: WindowsPrivateAuthorityReference,
      stage: WindowsIdentityProbeStage,
      context: AuthorityOperationContext
    ) {
      remainingBudgetMs(context);
      const run = await invoke(artifact, probeArguments(reference, stage, runtimeRoot), context);
      if (run.code !== 0) return controlLoss();
      const fields = parseProbeFields(run.stdout);
      // Branch on what the helper said, not on the translation: a `pre-open`
      // present line translates to control loss precisely because it is missing
      // the endpoint half, so testing the translated state here would discard
      // the very case this second step exists to complete.
      if (stage === 'post-open' || fields?.state !== 'authority-present') {
        return toIdentityProbe(fields);
      }
      // The helper's `pre-open` verb deliberately opens no handle, so it reports
      // the guardian half of the tuple and the endpoint's mere existence - not
      // the serving process id, the owner identity or the authentication result
      // that `recovery.ts` requires of a present probe. Those three can only be
      // read by opening the endpoint. So the pre-open stage is the pre-open verb
      // proving the guardian's birth identity with no handle open, followed by a
      // second helper process that opens the endpoint and reads the rest. Every
      // value still comes from the kernel; none is completed from the reference.
      //
      // What this does NOT reproduce is Decision 9's literal ordering, in which
      // one process holds its handles across both reads. It cannot: each helper
      // process closes its handles when it exits, so no handle can span two
      // invocations. The ordering that does hold is the one the helper enforces
      // inside `control`, which connects, rereads through its own open handles,
      // and refuses to issue anything on a difference.
      const completed = await invoke(
        artifact,
        probeArguments(reference, 'post-open', runtimeRoot),
        context
      );
      if (completed.code !== 0) return controlLoss();
      return toIdentityProbe(parseProbeFields(completed.stdout));
    },
    async activate(
      reference: WindowsPrivateAuthorityReference,
      context: AuthorityOperationContext
    ) {
      const controller = runtimeControllers.get(runtimeKey(reference));
      return controller === undefined
        ? { state: 'control-loss', diagnosticCode: 'native-transport-lost' }
        : controller.activate(context);
    },
    async inspect(
      reference: WindowsPrivateAuthorityReference,
      context: AuthorityOperationContext
    ) {
      const run = await invoke(
        artifact,
        controlArguments(reference, 'inspect', remainingBudgetMs(context)),
        context
      );
      return run.code === 0
        ? decodeObservation(run.stdout)
        : controlFailureOutcome(run.diagnostic);
    },
    async attemptGraceful() {
      // Deliberately not observed. There is no verb that closes the root's
      // standard input, and the graceful interval is delivered natively instead:
      // `terminate` passes `--grace-ms`, and the guardian waits it out before
      // applying force. The provider discards this result either way, so
      // reporting a quiet interval as an observation would add a claim with
      // nothing behind it.
      return { state: 'not-observed' };
    },
    async terminate(
      reference: WindowsPrivateAuthorityReference,
      intent: AuthorityTerminationIntent,
      context: AuthorityOperationContext
    ) {
      const run = await invoke(
        artifact,
        controlArguments(
          reference,
          'terminate',
          remainingBudgetMs(context),
          boundedMilliseconds(intent.graceMs, 'the graceful interval')
        ),
        context
      );
      return run.code === 0 ? terminalOutcome(run.stdout) : controlFailureOutcome(run.diagnostic);
    },
    async abort(
      reference: WindowsPrivateAuthorityReference,
      _reason: string,
      context: AuthorityOperationContext
    ) {
      const run = await invoke(
        artifact,
        controlArguments(reference, 'abort', remainingBudgetMs(context)),
        context
      );
      return run.code === 0 ? terminalOutcome(run.stdout) : controlFailureOutcome(run.diagnostic);
    },
    hasResidentRuntime(reference: WindowsPrivateAuthorityReference) {
      return runtimeControllers.has(runtimeKey(reference));
    },
    async terminateResident(
      reference: WindowsPrivateAuthorityReference,
      intent: AuthorityTerminationIntent,
      context: AuthorityOperationContext
    ) {
      const controller = runtimeControllers.get(runtimeKey(reference));
      return controller === undefined
        ? { state: 'control-loss', diagnosticCode: 'native-transport-lost' }
        : controller.terminate(intent, context);
    },
    async abortResident(
      reference: WindowsPrivateAuthorityReference,
      _reason: string,
      context: AuthorityOperationContext
    ) {
      const controller = runtimeControllers.get(runtimeKey(reference));
      return controller === undefined
        ? { state: 'control-loss', diagnosticCode: 'native-transport-lost' }
        : controller.abort(context);
    },
  });
  const runtimeOpener: WindowsAuthorityRuntimeOpener = Object.freeze({
    open(reference: WindowsPrivateAuthorityReference): ProviderBackedProcessRuntime {
      const key = runtimeKey(reference);
      if (runtimeControllers.has(key)) {
        throw new TypeError('Windows process-authority runtime bridge is already open.');
      }
      let controller!: WindowsAuthorityRuntimeTestController;
      controller = openFramePreservingRuntime(artifact, reference, () => {
        if (runtimeControllers.get(key) === controller) runtimeControllers.delete(key);
      });
      runtimeControllers.set(key, controller);
      return controller.runtime;
    },
  });
  return Object.freeze({
    transport,
    runtimeOpener,
    artifactIdentity: Object.freeze({
      helperProtocolVersion: 1 as const,
      artifactSha256: artifact.artifact.sha256,
      sourceSha256: artifact.artifact.sourceSha256,
    }),
  });
}

export function createWindowsNativeAssembly(runtimeRoot: string): WindowsAuthorityNativeAssembly {
  const packageRoot = path.resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
  return assemble(
    runtimeRoot,
    resolveWindowsProcessAuthorityArtifact({ packageRoot, artifactPath: helperArtifactPath() })
  );
}

/** @internal Actual-Windows current-artifact seam; absent from the Windows public index. */
export function createWindowsNativeAssemblyForTesting(
  runtimeRoot: string,
  resolution: WindowsProcessAuthorityArtifactResolutionOptions,
  authority: WindowsProcessAuthorityBuildIdentity
): WindowsAuthorityNativeAssembly {
  return assemble(
    runtimeRoot,
    resolveWindowsProcessAuthorityArtifactForTesting(resolution, authority)
  );
}
