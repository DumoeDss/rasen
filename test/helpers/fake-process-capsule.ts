import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';

import {
  PROCESS_CAPSULE_PROTOCOL_VERSION,
  type ResolvedProcessCapsule,
} from '../../src/core/session-host/process-capsule/resolver.js';
import { asProcessRef, type ProcessRef } from '../../src/core/session-host/process-scope.js';

/**
 * A scripted ProcessCapsule controller PROCESS, injected at the `spawn` seam.
 *
 * The point of seaming here rather than substituting a fake ProcessScope: the
 * production adapter (`native-process-scope.ts`, a byte-pinned file) stays in
 * the loop, so frame parsing, deferred lifecycle, control bounds, and failure
 * typing are all real code. Only the helper binary is simulated.
 */

const HELPER_PATH = 'C:\\rasen\\fake-process-capsule.exe';

/** Capsule protocol frame kinds, mirrored from native-process-scope.ts. */
export const PREPARE = 0x01;
export const ACTIVATE = 0x02;
export const TERMINATE = 0x04;
export const INSPECT = 0x05;
export const PREPARED = 0x81;
export const ACTIVATED = 0x82;
export const ROOT_EXIT = 0x85;
export const ERROR = 0x86;
export const SCOPE_EMPTY = 0x87;
export const OBSERVATION = 0x88;

/** Native observation codes the capsule's one-shot probe emits. */
export const PROBE_LIVE = 1;
export const PROBE_CLOSED = 2;
export const PROBE_FOREIGN = 3;
export const PROBE_UNKNOWN = 9;

export type ControllerBehaviour =
  | 'acknowledge'
  /** Controller dies before acknowledging: the SEC-001 transport-loss shape. */
  | 'lose-transport-on-terminate'
  /** Controller accepts the frame and never answers: the control-timeout shape. */
  | 'silent-on-terminate'
  /** Controller answers a cancel with a protocol-level ERROR frame. */
  | 'protocol-error-on-terminate';

export interface CapsuleScript {
  controller?: ControllerBehaviour;
  /** Observation byte the one-shot probe answers with, or a failure mode. */
  probe?: number | 'close-without-observation' | 'silent';
}

export function encodeFrame(kind: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.allocUnsafe(5);
  header[0] = kind;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/** PREPARED payload: [refLen u32be][native ref bytes][displayPid u32be]. */
function preparedPayload(nativeRef: string, displayPid: number): Buffer {
  const bytes = Buffer.from(nativeRef, 'utf8');
  const head = Buffer.allocUnsafe(4);
  head.writeUInt32BE(bytes.length);
  const pid = Buffer.allocUnsafe(4);
  pid.writeUInt32BE(displayPid);
  return Buffer.concat([head, bytes, pid]);
}

export class FakeCapsuleProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly received: number[] = [];
  killed = false;
  private pending = Buffer.alloc(0);

  constructor(
    readonly pid: number,
    readonly mode: string,
    private readonly script: CapsuleScript,
    private readonly nativeRef: string
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitFrame(kind: number, payload: Buffer = Buffer.alloc(0)): void {
    this.stdout.write(encodeFrame(kind, payload));
  }

  /** Daemon-side controller death without a protocol answer. */
  loseTransport(): void {
    this.emit('close');
  }

  private consume(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 5) {
      const length = this.pending.readUInt32BE(1);
      if (this.pending.length < 5 + length) break;
      const kind = this.pending[0];
      this.pending = this.pending.subarray(5 + length);
      this.received.push(kind);
      this.dispatch(kind);
    }
  }

  private dispatch(kind: number): void {
    if (this.mode === '--controller') {
      if (kind === PREPARE) {
        this.emitFrame(PREPARED, preparedPayload(this.nativeRef, 4242));
        return;
      }
      if (kind === ACTIVATE) {
        this.emitFrame(ACTIVATED);
        return;
      }
      if (kind === TERMINATE) {
        const behaviour = this.script.controller ?? 'acknowledge';
        if (behaviour === 'acknowledge') this.emitFrame(SCOPE_EMPTY);
        else if (behaviour === 'lose-transport-on-terminate') this.loseTransport();
        else if (behaviour === 'protocol-error-on-terminate') {
          this.emitFrame(ERROR, Buffer.from('capsule refused the cancel', 'utf8'));
        }
        // 'silent-on-terminate' answers nothing at all, on purpose.
      }
      return;
    }
    // One-shot probe modes ('--inspect' / '--terminate').
    if (kind !== INSPECT) return;
    const probe = this.script.probe ?? PROBE_FOREIGN;
    if (probe === 'silent') return;
    if (probe === 'close-without-observation') {
      this.emit('close', 3);
      return;
    }
    this.emitFrame(OBSERVATION, Buffer.from([probe]));
  }
}

export interface CapsuleSeam {
  spawn: typeof nodeSpawn;
  resolve: () => ResolvedProcessCapsule;
  controllers: FakeCapsuleProcess[];
  probes: FakeCapsuleProcess[];
}

export function capsuleSeam(
  script: CapsuleScript = {},
  nativeRef = 'win32-fake-scope-00000001'
): CapsuleSeam {
  const controllers: FakeCapsuleProcess[] = [];
  const probes: FakeCapsuleProcess[] = [];
  let nextPid = 9100;
  const fake = (_command: string, args: readonly string[]) => {
    nextPid += 1;
    const mode = args[0];
    const child = new FakeCapsuleProcess(nextPid, mode, script, nativeRef);
    if (mode === '--controller') controllers.push(child);
    else probes.push(child);
    return child as unknown as ChildProcess;
  };
  const resolved: ResolvedProcessCapsule = {
    helperPath: HELPER_PATH,
    protocolVersion: PROCESS_CAPSULE_PROTOCOL_VERSION,
    artifact: {
      platform: 'win32',
      arch: 'x64',
      path: HELPER_PATH,
      length: 0,
      sha256: '0'.repeat(64),
      capabilities: [],
      provenance: 'build-inputs',
      compiler: 'fake',
      sourceSha256: '0'.repeat(64),
    },
  };
  return {
    spawn: fake as unknown as typeof nodeSpawn,
    resolve: () => resolved,
    controllers,
    probes,
  };
}

/** The ProcessRef a given native ref decodes to, for foreign/stale-ref cases. */
export function refFor(nativeRef: string): ProcessRef {
  return asProcessRef(
    `rasen-process-scope/1:${Buffer.from(nativeRef, 'utf8').toString('base64url')}`
  );
}
