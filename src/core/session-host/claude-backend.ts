import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Writable } from 'node:stream';

import {
  createAgentCliResolver,
  prepareAgentCliSpawn,
  spawnAgentCliSync,
} from '../agent-cli-process.js';
import { CLAUDE_CLI_VERSION_PREMISE } from '../claude/premise.js';
import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendClosure,
  BackendEvent,
  BackendTermination,
  BackendTurn,
  BackendTurnStream,
} from './backend.js';
import { createHostedProcessScope } from './process-capsule/hosted-process-scope.js';
import {
  isDeclaredUnprovenReceipt,
  receiptAuthorizesRelease,
  type BestEffortScopeDeclaration,
  type DeclaredUnprovenReceipt,
  type LiveProcessScope,
  type ProcessRef,
  type ProcessScope,
} from './process-scope.js';
import { BoundedNdjsonDecoder, SessionProtocolError } from './protocol.js';

export const CLAUDE_SESSION_STREAM_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
] as const;

const REQUIRED_HELP_TOKENS = [
  '-p, --print',
  '--input-format <format>',
  '--output-format <format>',
  '-r, --resume',
] as const;

export interface ClaudeProtocolPremise {
  ok: boolean;
  version: string;
  missing?: string[];
}

export class ClaudeSessionBackendError extends Error {
  constructor(
    readonly code:
      | 'backend-protocol-unsupported'
      | 'backend-spawn-failed'
      | 'backend-protocol-failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ClaudeSessionBackendError';
  }
}

export interface ClaudeSessionBackendOptions {
  resolveBinary?: () => Promise<string | null>;
  verifyProtocol?: (binary: string) => Promise<ClaudeProtocolPremise>;
  env?: NodeJS.ProcessEnv;
  processScope?: ProcessScope;
  killGraceMs?: number;
}

export function verifyClaudeSessionProtocol(binary: string): ClaudeProtocolPremise {
  const version = spawnAgentCliSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const help = spawnAgentCliSync(binary, ['--help'], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const versionText = typeof version.stdout === 'string' ? version.stdout.trim() : '';
  const helpText = typeof help.stdout === 'string' ? help.stdout : '';
  const missing = REQUIRED_HELP_TOKENS.filter((token) => !helpText.includes(token));
  return {
    ok:
      !version.error &&
      version.status === 0 &&
      !help.error &&
      help.status === 0 &&
      missing.length === 0,
    version: versionText || 'unknown',
    ...(missing.length > 0 ? { missing: [...missing] } : {}),
  };
}

class TurnQueue implements AsyncIterable<BackendEvent> {
  private readonly values: BackendEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private done = false;
  private error: unknown;

  constructor(private readonly onDrained: () => void) {}

  push(value: BackendEvent): void {
    if (this.done) return;
    this.values.push(value);
    this.wake();
  }

  finish(): void {
    this.done = true;
    this.wake();
  }

  fail(error: unknown): void {
    this.error = error;
    this.done = true;
    this.wake();
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<BackendEvent> {
    try {
      for (;;) {
        while (this.values.length > 0) yield this.values.shift()!;
        if (this.done) {
          if (this.error) throw this.error;
          return;
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
    } finally {
      this.onDrained();
    }
  }
}

function normalizeClaudeEvent(value: unknown): BackendEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionProtocolError('protocol-invalid-event', 'Claude event must be an object.');
  }
  const event = value as Record<string, unknown>;
  if (
    event.type === 'system' &&
    event.subtype === 'init' &&
    typeof event.session_id === 'string' &&
    event.session_id
  ) {
    return { type: 'init', sessionId: event.session_id };
  }
  if (event.type === 'system' && event.subtype === 'init') {
    throw new SessionProtocolError(
      'protocol-invalid-event',
      'Claude init event has no Session identity.'
    );
  }
  if (
    event.type === 'result' &&
    typeof event.session_id === 'string' &&
    typeof event.result === 'string'
  ) {
    return { type: 'result', sessionId: event.session_id, content: event.result };
  }
  if (event.type === 'result') {
    throw new SessionProtocolError(
      'protocol-invalid-event',
      'Claude result event is missing its Session identity or result body.'
    );
  }
  return {
    type: 'diagnostic',
    eventType: typeof event.type === 'string' ? event.type : 'unknown',
    ...(typeof event.subtype === 'string' ? { subtype: event.subtype } : {}),
  };
}

function writeStreamMessage(stdin: Writable, turn: BackendTurn): Promise<void> {
  if (stdin.destroyed || !stdin.writable) {
    throw new ClaudeSessionBackendError(
      'backend-protocol-failed',
      'Claude stream stdin is not writable.'
    );
  }
  const message = `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: turn.input }],
    },
  })}\n`;
  if (Buffer.byteLength(message, 'utf8') > turn.limits.maxInputBytes + 512) {
    throw new ClaudeSessionBackendError(
      'backend-protocol-failed',
      'Claude stream input envelope exceeds its bounded transport allowance.'
    );
  }
  return new Promise<void>((resolve, reject) => {
    stdin.write(message, 'utf8', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

class ClaudeResidentTransport implements AgentSessionTransport {
  readonly runtimeRef: ProcessRef;
  readonly displayPid?: number;
  readonly closed: Promise<BackendClosure | undefined>;
  private decoder?: BoundedNdjsonDecoder;
  private active?: TurnQueue;
  private activeResultSeen = false;
  private backendSessionId?: string;
  private protocolViolation?: Error;
  private rootExitedState = false;
  private closedState = false;
  private resolveClosed!: (closure: BackendClosure | undefined) => void;
  private closeError?: unknown;
  /** Honest terminal observed on the scope's own close; exact tier leaves it unset. */
  private scopeTerminal?: DeclaredUnprovenReceipt;

  constructor(
    private readonly live: LiveProcessScope,
    private readonly processScope: ProcessScope,
    private readonly killGraceMs: number,
    /** Pre-start best-effort declaration; absent means the exact tier. */
    private readonly declaration?: BestEffortScopeDeclaration
  ) {
    this.runtimeRef = live.ref;
    this.displayPid = live.displayPid;
    this.closed = new Promise<BackendClosure | undefined>((resolve) => {
      this.resolveClosed = resolve;
    });

    live.stdout.on('data', (chunk: Buffer) => {
      try {
        if (!this.decoder) {
          throw new ClaudeSessionBackendError(
            'backend-protocol-failed',
            'Claude emitted output outside a requested turn.'
          );
        }
        for (const raw of this.decoder.push(chunk)) this.accept(raw);
      } catch (error) {
        this.protocolViolation = error instanceof Error
          ? error
          : new ClaudeSessionBackendError('backend-protocol-failed', 'Claude output parsing failed.');
        this.active?.fail(error);
      }
    });
    live.stderr.on('data', () => {
      // Deliberately drain without retaining arbitrary backend/prompt output.
    });
    live.stdout.on('error', (error) => this.close(error));
    live.stderr.on('error', (error) => this.close(error));
    void live.rootExited.then(({ code, signal }) => {
      this.rootExitedState = true;
      const error = new ClaudeSessionBackendError(
        'backend-protocol-failed',
        `Claude backend root exited while its process scope remains retained (code ${String(code)}, signal ${String(signal)}).`
      );
      this.protocolViolation = error;
      this.active?.fail(error);
    }, (error) => {
      this.protocolViolation = error instanceof Error
        ? error
        : new ClaudeSessionBackendError('backend-protocol-failed', 'Claude root-exit observation failed.');
      this.active?.fail(this.protocolViolation);
    });
    void live.closed.then((receipt) => {
      // Natural completion of a declared scope settles its honest terminal
      // here; the exact tier settles a proven scope-empty receipt and records
      // nothing, exactly as before.
      if (isDeclaredUnprovenReceipt(receipt)) this.scopeTerminal = receipt;
      this.close();
    }, (error) => this.close(error));
  }

  send(turn: BackendTurn): BackendTurnStream {
    if (this.closedState || this.rootExitedState) {
      throw this.closeError ?? new ClaudeSessionBackendError('backend-protocol-failed', 'Claude transport is closed.');
    }
    if (this.active) {
      throw new ClaudeSessionBackendError(
        'backend-protocol-failed',
        'Claude transport already has one active turn.'
      );
    }
    if (this.protocolViolation) throw this.protocolViolation;
    if (this.decoder) this.decoder.finish();
    this.decoder = new BoundedNdjsonDecoder({
      maxLineBytes: turn.limits.maxLineBytes ?? Math.min(turn.limits.maxOutputBytes, 256 * 1024),
      maxOutputBytes: turn.limits.maxOutputBytes,
    });
    let queue: TurnQueue;
    queue = new TurnQueue(() => {
      if (this.active === queue) {
        this.active = undefined;
        this.activeResultSeen = false;
      }
    });
    this.active = queue;
    if (this.backendSessionId) queue.push({ type: 'init', sessionId: this.backendSessionId });
    const accepted = writeStreamMessage(this.live.stdin, turn).catch((error) => {
      queue.fail(
        new ClaudeSessionBackendError(
          'backend-protocol-failed',
          'Claude stream input could not be accepted.',
          { cause: error }
        )
      );
      throw error;
    });
    // The host durably advances prepared -> sent only after this exact write
    // callback resolves. Events may queue concurrently without being lost.
    return Object.assign(queue, { accepted });
  }

  async terminate(reason: string): Promise<BackendTermination> {
    void reason;
    if (this.closedState) return { closed: true, cancelledBeforeWork: false };
    this.live.stdin.destroy();
    const receipt = await this.processScope.terminate(this.runtimeRef, {
      reason,
      graceMs: this.killGraceMs,
    });
    // Declaration-gated: an exact-tier scope still closes only on a proven
    // scope-empty receipt. A declared best-effort scope also closes on its
    // honest declared-unproven terminal, which is terminal by design. The
    // terminal itself is reported, not collapsed into the boolean: the host
    // owns the release gate and needs the terminal to persist it.
    return {
      closed: receiptAuthorizesRelease(receipt, this.declaration !== undefined),
      cancelledBeforeWork: false,
      ...(receipt.state === 'declared-unproven' && receipt.unproven
        ? { unproven: receipt.unproven }
        : {}),
    };
  }

  private accept(raw: unknown): void {
    const event = normalizeClaudeEvent(raw);
    const queue = this.active;
    if (!queue) {
      this.protocolViolation = new ClaudeSessionBackendError(
        'backend-protocol-failed',
        'Claude emitted an uncorrelated event outside an active turn.'
      );
      return;
    }
    if (this.activeResultSeen) {
      const error = new ClaudeSessionBackendError(
        'backend-protocol-failed',
        'Claude emitted an event after the terminal result for one turn.'
      );
      this.protocolViolation = error;
      queue.fail(error);
      return;
    }
    if (event.type === 'init') {
      const sessionId = (event as { sessionId: string }).sessionId;
      if (this.backendSessionId) {
        // The synthetic per-turn identity and an actual backend init are two
        // events. Forward the latter even when ids match so the neutral
        // reducer can enforce exactly one init.
        queue.push(event);
        return;
      }
      this.backendSessionId = sessionId;
      queue.push(event);
      return;
    }
    if (event.type === 'result') {
      this.activeResultSeen = true;
      queue.push(event);
      queue.finish();
      return;
    }
    queue.push(event);
  }

  private close(error?: unknown): void {
    if (this.closedState) return;
    this.closedState = true;
    this.closeError = error;
    try {
      this.decoder?.finish();
    } catch (decoderError) {
      error = decoderError;
    }
    if (this.active) {
      if (error) this.active.fail(error);
      else this.active.fail(
        new ClaudeSessionBackendError(
          'backend-protocol-failed',
          'Claude resident transport closed before a terminal result.'
        )
      );
    }
    // Exact tier resolves `undefined` exactly as it always did: only a declared
    // scope's honest terminal changes what this promise carries.
    this.resolveClosed(this.scopeTerminal ? { unproven: this.scopeTerminal } : undefined);
  }
}

export function createClaudeSessionBackend(
  options: ClaudeSessionBackendOptions = {}
): AgentSessionBackend {
  const resolveBinary = options.resolveBinary ?? createAgentCliResolver();
  const verifyProtocol =
    options.verifyProtocol ?? (async (binary: string) => verifyClaudeSessionProtocol(binary));
  const env = options.env ?? process.env;
  const processScope = options.processScope ?? createHostedProcessScope();
  const killGraceMs = options.killGraceMs ?? 5_000;

  const backendEnvironment = (): Record<string, string> => {
    const allowed = [
      'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'HOME', 'USERPROFILE',
      'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TMP', 'TEMP', 'LANG',
      'LC_ALL', 'TERM', 'NO_COLOR', 'FORCE_COLOR', 'NODE_PATH',
    ];
    return Object.fromEntries(allowed.flatMap((key) => env[key] ? [[key, env[key]!]] : []));
  };

  return {
    id: 'claude',
    version: CLAUDE_CLI_VERSION_PREMISE,
    async prepare(input) {
      if (input.signal.aborted) {
        throw new ClaudeSessionBackendError(
          'backend-spawn-failed',
          'Claude process admission was cancelled before backend resolution.'
        );
      }
      const binary = await resolveBinary();
      if (!binary) {
        throw new ClaudeSessionBackendError(
          'backend-spawn-failed',
          'Claude CLI binary is unavailable.'
        );
      }
      const premise = await verifyProtocol(binary);
      if (!premise.ok) {
        throw new ClaudeSessionBackendError(
          'backend-protocol-unsupported',
          `Installed Claude CLI ${premise.version} lacks the required resident stream-json protocol${premise.missing?.length ? ` (${premise.missing.join(', ')})` : ''}.`
        );
      }
      if (input.signal.aborted) {
        throw new ClaudeSessionBackendError(
          'backend-spawn-failed',
          'Claude process admission was cancelled before spawn.'
        );
      }
      const stat = fs.statSync(input.cwd);
      if (!stat.isDirectory()) {
        throw new ClaudeSessionBackendError(
          'backend-spawn-failed',
          'Claude Session cwd is not a directory.'
        );
      }
      const cwd = fs.realpathSync.native(input.cwd);
      const args = [
        ...CLAUDE_SESSION_STREAM_ARGS,
        ...(input.resumeSessionId ? ['--resume', input.resumeSessionId] : []),
      ];
      const preparedSpawn = prepareAgentCliSpawn(binary, args, process.platform, env);
      let command = preparedSpawn.command;
      if (!path.isAbsolute(command) && process.platform === 'win32' && /^cmd\.exe$/i.test(command)) {
        const systemRoot = env.SystemRoot ?? env.WINDIR;
        if (systemRoot) command = path.join(systemRoot, 'System32', 'cmd.exe');
      }
      if (!path.isAbsolute(command)) {
        throw new ClaudeSessionBackendError(
          'backend-spawn-failed',
          'Claude backend command must resolve to an absolute server-owned executable.'
        );
      }
      let prepared;
      try {
        prepared = await processScope.prepare({
          command,
          args: preparedSpawn.args,
          cwd,
          env: backendEnvironment(),
          ...(preparedSpawn.windowsOptions.windowsVerbatimArguments
            ? { windowsVerbatimArguments: true }
            : {}),
          signal: input.signal,
        });
      } catch (error) {
        throw new ClaudeSessionBackendError(
          'backend-spawn-failed',
          'Claude resident transport could not be spawned.',
          { cause: error }
        );
      }
      return {
        runtimeRef: prepared.ref,
        ...(prepared.displayPid ? { displayPid: prepared.displayPid } : {}),
        ...(prepared.declaration ? { declaration: prepared.declaration } : {}),
        activate: async () => {
          const live = await prepared.activate();
          return new ClaudeResidentTransport(
            live,
            processScope,
            killGraceMs,
            prepared.declaration
          );
        },
        abort: (reason: string) => prepared.abort(reason),
      };
    },
  };
}
