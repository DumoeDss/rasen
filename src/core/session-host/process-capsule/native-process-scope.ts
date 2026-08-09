import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';

import {
  asProcessRef,
  ProcessScopeError,
  type LiveProcessScope,
  type BackendRootExit,
  type PreparedProcessScope,
  type ProcessControlPhase,
  type ProcessObservation,
  type ProcessPrepareInput,
  type ProcessRef,
  type ProcessScope,
  type ScopeEmptyReceipt,
  type TerminationIntent,
  type TerminationReceipt,
} from '../process-scope.js';
import {
  PROCESS_CAPSULE_PROTOCOL_VERSION,
  resolvePackagedProcessCapsule,
  type ResolvedProcessCapsule,
} from './resolver.js';
import { sweepSettledTerminals, type RetentionProbe } from './scope-retention.js';

const MAX_FRAME_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const DEFAULT_CONTROL_TIMEOUT_MS = 10_000;
const PREPARE = 0x01;
const ACTIVATE = 0x02;
const INPUT = 0x03;
const TERMINATE = 0x04;
const INSPECT = 0x05;
const PREPARED = 0x81;
const ACTIVATED = 0x82;
const OUTPUT = 0x83;
const ERROR_OUTPUT = 0x84;
const ROOT_EXIT = 0x85;
const ERROR = 0x86;
const SCOPE_EMPTY = 0x87;
const OBSERVATION = 0x88;

function appendString(parts: Buffer[], value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  parts.push(length, bytes);
}

function encodeLaunch(input: ProcessPrepareInput, nonce: string): Buffer {
  const parts: Buffer[] = [];
  const protocol = Buffer.allocUnsafe(2);
  protocol.writeUInt16BE(PROCESS_CAPSULE_PROTOCOL_VERSION);
  parts.push(protocol);
  appendString(parts, nonce);
  appendString(parts, input.command);
  appendString(parts, input.cwd);
  parts.push(Buffer.from([input.windowsVerbatimArguments ? 1 : 0]));
  const argCount = Buffer.allocUnsafe(4);
  argCount.writeUInt32BE(input.args.length);
  parts.push(argCount);
  for (const arg of input.args) appendString(parts, arg);
  const entries = Object.entries(input.env).sort(([left], [right]) => left.localeCompare(right));
  const envCount = Buffer.allocUnsafe(4);
  envCount.writeUInt32BE(entries.length);
  parts.push(envCount);
  for (const [key, value] of entries) {
    appendString(parts, key);
    appendString(parts, value);
  }
  const payload = Buffer.concat(parts);
  if (payload.length > MAX_FRAME_BYTES) {
    throw new ProcessScopeError('containment-prepare-failed', 'ProcessCapsule launch frame exceeds its bound.');
  }
  return payload;
}

function frame(kind: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length > MAX_FRAME_BYTES) {
    throw new ProcessScopeError('process-control-lost', 'ProcessCapsule frame exceeds its bound.');
  }
  const header = Buffer.allocUnsafe(5);
  header[0] = kind;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

class CapsuleFrames {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): Array<{ kind: number; payload: Buffer }> {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Array<{ kind: number; payload: Buffer }> = [];
    while (this.pending.length >= 5) {
      const length = this.pending.readUInt32BE(1);
      if (length > MAX_FRAME_BYTES) {
        throw new ProcessScopeError('process-control-lost', 'ProcessCapsule emitted an oversized frame.');
      }
      if (this.pending.length < 5 + length) break;
      frames.push({ kind: this.pending[0], payload: this.pending.subarray(5, 5 + length) });
      this.pending = this.pending.subarray(5 + length);
    }
    return frames;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // Every protocol phase owns a deferred, while a failure may happen before
  // callers await later phases. Attach a sink to avoid process-global
  // unhandled-rejection noise without changing the original promise outcome.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function decodePrepared(payload: Buffer): { ref: ProcessRef; displayPid: number } {
  if (payload.length < 8) throw new ProcessScopeError('containment-not-established', 'Prepared receipt is truncated.');
  const length = payload.readUInt32BE(0);
  if (length < 16 || length > 4096 || payload.length !== 8 + length) {
    throw new ProcessScopeError('containment-not-established', 'Prepared receipt has an invalid ProcessRef.');
  }
  const nativeRef = payload.subarray(4, 4 + length).toString('utf8');
  const displayPid = payload.readUInt32BE(4 + length);
  const ref = asProcessRef(`rasen-process-scope/1:${Buffer.from(nativeRef, 'utf8').toString('base64url')}`);
  return { ref, displayPid };
}

function nativeRef(ref: ProcessRef): Buffer {
  const encoded = String(ref).slice('rasen-process-scope/1:'.length);
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length < 16 || bytes.length > 4096) {
    throw new ProcessScopeError('process-authority-uncertain', 'ProcessRef payload is invalid.');
  }
  return bytes;
}

class CapsuleClient {
  readonly output = new PassThrough();
  readonly errorOutput = new PassThrough();
  readonly prepared = deferred<{ ref: ProcessRef; displayPid: number }>();
  readonly activated = deferred<void>();
  readonly rootExited = deferred<BackendRootExit>();
  readonly closed = deferred<ScopeEmptyReceipt>();
  readonly stdin: Writable;
  ref?: ProcessRef;
  displayPid?: number;
  state: 'preparing' | 'prepared' | 'live' | 'root-exited' | 'closed' = 'preparing';
  controlAvailable = true;
  private failed?: ProcessScopeError;

  constructor(readonly child: ChildProcess) {
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new ProcessScopeError('containment-prepare-failed', 'ProcessCapsule did not expose bounded control pipes.');
    }
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        try {
          this.send(INPUT, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
    });
    const parser = new CapsuleFrames();
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const item of parser.push(chunk)) this.accept(item.kind, item.payload);
      } catch (error) {
        this.fail(error);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => this.errorOutput.write(chunk));
    child.once('error', (error) => this.fail(error));
    child.once('close', () => {
      const previous = this.state;
      if (previous === 'preparing') {
        this.fail(new ProcessScopeError('containment-prepare-failed', 'ProcessCapsule closed before PREPARED.'));
      } else if (previous === 'prepared') {
        this.fail(new ProcessScopeError('activation-failed', 'ProcessCapsule closed before ACTIVATED.'));
      } else if (previous !== 'closed') {
        this.fail(new ProcessScopeError(
          'process-control-lost',
          'ProcessCapsule controller closed before exact SCOPE_EMPTY.',
          undefined,
          'scope-empty',
        ));
      }
    });
  }

  send(kind: number, payload: Buffer = Buffer.alloc(0)): void {
    if (!this.child.stdin || this.child.stdin.destroyed || this.state === 'closed') {
      throw this.failed ?? new ProcessScopeError('process-control-lost', 'ProcessCapsule control pipe is closed.');
    }
    this.child.stdin.write(frame(kind, payload));
  }

  private accept(kind: number, payload: Buffer): void {
    if (kind === PREPARED && this.state === 'preparing') {
      const receipt = decodePrepared(payload);
      this.ref = receipt.ref;
      this.displayPid = receipt.displayPid;
      this.state = 'prepared';
      this.prepared.resolve(receipt);
      return;
    }
    if (kind === ACTIVATED && this.state === 'prepared') {
      this.state = 'live';
      this.activated.resolve();
      return;
    }
    if (kind === OUTPUT && this.state === 'live') {
      this.output.write(payload);
      return;
    }
    if (kind === ERROR_OUTPUT) {
      this.errorOutput.write(payload);
      return;
    }
    if (kind === ROOT_EXIT && this.state === 'live' && payload.length === 4) {
      this.state = 'root-exited';
      this.output.end();
      this.errorOutput.end();
      this.rootExited.resolve({
        state: 'root-exited',
        code: payload.readInt32BE(0),
        signal: null,
      });
      return;
    }
    if (
      kind === SCOPE_EMPTY &&
      payload.length === 0 &&
      (this.state === 'prepared' || this.state === 'live' || this.state === 'root-exited')
    ) {
      this.state = 'closed';
      this.output.end();
      this.errorOutput.end();
      this.closed.resolve({ state: 'scope-empty' });
      return;
    }
    if (kind === ERROR) {
      const code = this.state === 'preparing'
        ? 'containment-prepare-failed'
        : this.state === 'prepared'
          ? 'activation-failed'
          : 'process-control-lost';
      this.fail(new ProcessScopeError(code, payload.toString('utf8').slice(0, 2048)));
      return;
    }
    this.fail(new ProcessScopeError('process-control-lost', `Unexpected ProcessCapsule frame ${kind}.`));
  }

  private fail(error: unknown): void {
    const failure = error instanceof ProcessScopeError
      ? error
      : new ProcessScopeError('process-control-lost', 'ProcessCapsule control failed.', { cause: error });
    this.failed = failure;
    this.controlAvailable = false;
    this.prepared.reject(failure);
    this.activated.reject(failure);
    this.rootExited.reject(failure);
    this.closed.reject(failure);
  }
}

async function awaitControl<T>(
  phase: ProcessControlPhase,
  acknowledgement: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProcessScopeError(
      'process-control-timeout',
      `ProcessCapsule ${phase} acknowledgement timed out.`,
      undefined,
      phase,
    )), timeoutMs);
  });
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    abort = () => reject(new ProcessScopeError(
      'process-control-lost',
      `ProcessCapsule ${phase} control was cancelled.`,
      undefined,
      phase,
    ));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([acknowledgement, timeout, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abort) signal.removeEventListener('abort', abort);
  }
}

export interface NativeProcessScopeOptions {
  resolve?: () => ResolvedProcessCapsule;
  spawn?: typeof spawn;
  /** Test-only mutation mode; production construction never sets this. */
  controllerMode?:
    | '--controller'
    | '--controller-test-duplicate-job-handle'
    | '--controller-test-early-activation'
    | '--controller-test-macos-birth-unavailable'
    | '--controller-test-posix-orphan-group'
    | '--controller-test-withhold-activate'
    | '--controller-test-withhold-first-terminate';
  onControllerSpawn?: (pid: number) => void;
  controlTimeoutMs?: number;
  /** Test-only introspection of the retention map; never set in production. */
  retentionProbe?: RetentionProbe;
}

function helperEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = ['SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'HOME', 'USERPROFILE'];
  return Object.fromEntries(allowed.flatMap((key) => source[key] ? [[key, source[key]!]] : []));
}

async function oneShotProbe(
  helper: ResolvedProcessCapsule,
  operation: '--inspect' | '--terminate' | '--terminate-owned',
  ref: ProcessRef,
  spawnProcess: typeof spawn,
  timeoutMs: number,
): Promise<ProcessObservation> {
  const child = spawnProcess(helper.helperPath, [operation], {
    cwd: process.cwd(),
    env: helperEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout) throw new ProcessScopeError('process-authority-uncertain', 'ProcessCapsule probe pipes are unavailable.');
  const result = deferred<number>();
  const parser = new CapsuleFrames();
  const phase: ProcessControlPhase = operation === '--inspect' ? 'inspect' : 'terminate';
  let settled = false;
  const failProbe = (error: unknown) => {
    if (settled) return;
    settled = true;
    result.reject(
      error instanceof ProcessScopeError
        ? new ProcessScopeError(error.code, error.message, { cause: error }, phase)
        : new ProcessScopeError(
          'process-authority-uncertain',
          'ProcessCapsule probe framing failed.',
          { cause: error },
          phase,
        ),
    );
  };
  // Containment mirrors the resident client's stdout handler. Frame parsing can
  // throw (oversized or corrupt length field) and this is an EventEmitter
  // callback: without the try/catch the throw escapes as an uncaught exception
  // and takes the daemon down instead of becoming typed uncertainty. Every
  // non-observation frame is likewise rejected as a typed protocol failure
  // rather than ignored until the close/timeout deadline.
  child.stdout.on('data', (chunk: Buffer) => {
    if (settled) return;
    try {
      for (const item of parser.push(chunk)) {
        if (item.kind === OBSERVATION && item.payload.length === 1) {
          settled = true;
          result.resolve(item.payload[0]);
          return;
        }
        if (item.kind === ERROR) {
          failProbe(new ProcessScopeError(
            'process-authority-uncertain',
            item.payload.toString('utf8').slice(0, 2048),
          ));
          return;
        }
        failProbe(new ProcessScopeError(
          'process-authority-uncertain',
          `Unexpected ProcessCapsule probe frame ${item.kind}.`,
        ));
        return;
      }
    } catch (error) {
      failProbe(error);
    }
  });
  child.once('error', failProbe);
  child.once('close', (code) => {
    failProbe(new ProcessScopeError(
      'process-authority-uncertain',
      `ProcessCapsule probe closed before observation (code ${String(code)}).`
    ));
  });
  child.stdin.end(frame(INSPECT, nativeRef(ref)));
  try {
    const state = await awaitControl(phase, result.promise, timeoutMs);
    if (state === 1) return { state: 'live', controllable: true };
    if (state === 2) return { state: 'closed', controllable: false };
    if (state === 3) return { state: 'foreign', controllable: false };
    return { state: 'uncertain', controllable: false, diagnostic: 'native exact observation unavailable' };
  } catch (error) {
    // A probe that timed out or broke the protocol is malfunctioning; it is not
    // left running to leak a process.
    child.kill('SIGKILL');
    throw error;
  }
}

export function createNativeProcessScope(options: NativeProcessScopeOptions = {}): ProcessScope {
  const resolve = options.resolve ?? (() => resolvePackagedProcessCapsule());
  const spawnProcess = options.spawn ?? spawn;
  const controlTimeoutMs = options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
  const clients = new Map<ProcessRef, CapsuleClient>();
  // Retention lifecycle (RC-005): a client that reached exact SCOPE_EMPTY
  // ('closed') is a definite terminal and is releasable; a control-lost client
  // keeps its non-closed state and is retained for reconciliation. Shared rule
  // in scope-retention.ts.
  const isSettledTerminal = (client: CapsuleClient): boolean => client.state === 'closed';
  options.retentionProbe?.(() => [...clients.keys()]);

  function receiptFrom(observation: ProcessObservation): TerminationReceipt {
    if (observation.state === 'closed') return { state: 'closed', gracefulAttempted: false, forced: true };
    if (observation.state === 'foreign') {
      return { state: 'uncertain', gracefulAttempted: false, forced: false, diagnostic: 'process identity is foreign' };
    }
    if (observation.state === 'uncertain') {
      return { state: 'uncertain', gracefulAttempted: false, forced: false, diagnostic: observation.diagnostic };
    }
    return { state: 'retained', gracefulAttempted: false, forced: false, diagnostic: 'scope remains live' };
  }

  return {
    async prepare(input): Promise<PreparedProcessScope> {
      // Release predecessor clients that already reached exact SCOPE_EMPTY;
      // control-lost clients carry no closed terminal and are retained.
      sweepSettledTerminals(clients, isSettledTerminal);
      const helper = resolve();
      const child = spawnProcess(helper.helperPath, [options.controllerMode ?? '--controller'], {
        cwd: input.cwd,
        env: helperEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
      if (typeof child.pid === 'number') options.onControllerSpawn?.(child.pid);
      const client = new CapsuleClient(child);
      const nonce = randomBytes(24).toString('hex');
      client.send(PREPARE, encodeLaunch(input, nonce));
      let prepared: { ref: ProcessRef; displayPid: number };
      try {
        prepared = await awaitControl('prepare', client.prepared.promise, controlTimeoutMs, input.signal);
      } catch (error) {
        child.kill('SIGKILL');
        if (error instanceof ProcessScopeError && error.code === 'process-control-timeout') {
          throw new ProcessScopeError(
            'containment-prepare-failed',
            'ProcessCapsule preparation timed out.',
            { cause: error },
            'prepare',
          );
        }
        throw error;
      }
      clients.set(prepared.ref, client);
      let finished = false;
      return {
        ref: prepared.ref,
        displayPid: prepared.displayPid,
        async activate(): Promise<LiveProcessScope> {
          if (finished || client.state !== 'prepared') {
            throw new ProcessScopeError('activation-failed', 'ProcessCapsule activation is exactly once.');
          }
          finished = true;
          client.send(ACTIVATE);
          await awaitControl('activate', client.activated.promise, controlTimeoutMs, input.signal);
          return {
            ref: prepared.ref,
            displayPid: prepared.displayPid,
            stdin: client.stdin,
            stdout: client.output,
            stderr: client.errorOutput,
            rootExited: client.rootExited.promise,
            closed: client.closed.promise,
          };
        },
        async abort(reason): Promise<TerminationReceipt> {
          void reason;
          if (client.state === 'closed') return { state: 'closed', gracefulAttempted: false, forced: false };
          client.send(TERMINATE);
          try {
            await awaitControl('abort', client.closed.promise, controlTimeoutMs, input.signal);
            return { state: 'closed', gracefulAttempted: false, forced: true };
          } catch (error) {
            if (error instanceof ProcessScopeError) {
              return {
                state: 'uncertain',
                gracefulAttempted: false,
                forced: true,
                diagnostic: error.message,
                failure: {
                  code: error.code === 'process-control-timeout'
                    ? 'process-control-timeout'
                    : 'process-control-lost',
                  phase: 'abort',
                },
              };
            }
            throw error;
          }
        },
      };
    },
    async inspect(ref) {
      const local = clients.get(ref);
      if (local && local.state !== 'closed' && local.controlAvailable) {
        const state = local.state === 'preparing' || local.state === 'prepared'
          ? 'prepared'
          : local.state;
        return { state, controllable: true };
      }
      return oneShotProbe(resolve(), '--inspect', ref, spawnProcess, controlTimeoutMs);
    },
    async terminate(ref, intent: TerminationIntent) {
      void intent;
      const local = clients.get(ref);
      if (local && local.state !== 'closed' && local.controlAvailable) {
        try {
          local.send(TERMINATE);
          await awaitControl(
            'scope-empty',
            local.closed.promise,
            Math.max(controlTimeoutMs, intent.graceMs + controlTimeoutMs),
          );
        } catch (error) {
          if (error instanceof ProcessScopeError) {
            return {
              state: 'uncertain',
              gracefulAttempted: true,
              forced: true,
              diagnostic: error.message,
              failure: {
                code: error.code === 'process-control-timeout'
                  ? 'process-control-timeout'
                  : 'process-control-lost',
                phase: 'scope-empty',
              },
            };
          }
          throw error;
        }
        return { state: 'closed', gracefulAttempted: true, forced: true };
      }
      const observation = await oneShotProbe(
        resolve(),
        local ? '--terminate-owned' : '--terminate',
        ref,
        spawnProcess,
        controlTimeoutMs,
      );
      return receiptFrom(observation);
    },
  };
}
