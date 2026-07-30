/**
 * Session supervisor (design D1/D2/D3/D5): spawns a headless `claude` CLI
 * session as a supervised long-runner, tracks it in the session registry,
 * bounds it with dual timeouts, and tree-kills it on demand or on timeout.
 * Adapted from omnicross `packages/cli-launcher/src/supervisor.ts` and
 * slice 2's `submit.ts` (responded/childClosed dual state, release-on-close
 * discipline) — but this supervisor manages a long-running detached process
 * tree rather than a single bounded subprocess.
 *
 * Three-point checklist (portfolio red line #3): SIGKILL escalation is keyed
 * off the child's `close` event (the pending forced-kill timer from
 * `kill-tree.ts` is cancelled once `close` fires, never assumed from
 * response timing); the concurrency slot and registry finalization are
 * released only from the same `close` handler; tests exercise a
 * SIGTERM-resistant fixture to prove the escalation actually fires
 * (test/core/management-api/supervisor.test.ts).
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { killProcessTree } from './kill-tree.js';
import {
  buildRuntimeContext,
  removeSessionRuntimeContext,
  writeSessionRuntimeContext,
  RASEN_SESSION_CONTEXT_ENV,
  type SessionContextPathOptions,
} from '../session-runtime-context.js';
import type { SessionExecution, SessionKind, SessionRecord, SessionRegistry, SessionSpace, TerminationReason } from './session-registry.js';

const IS_WINDOWS = process.platform === 'win32';

/** Bounded tail retained per stream for diagnostics (design D2's "64 KiB ring-buffer tails"). */
const TAIL_BYTES = 64 * 1024;

/** Grace period between SIGTERM and SIGKILL on the supervised process tree. */
const DEFAULT_KILL_GRACE_MS = 5_000;

const DEFAULT_MAX_CONCURRENT = 3;

export interface LaunchInput {
  kind: SessionKind;
  /** The whitelist entry's skill invocation, e.g. `/rasen-auto` (design D1). */
  skill: string;
  task: string;
  cwd: string;
  /** Server-resolved planning roots to expose in addition to cwd. */
  attachedRoots?: readonly string[];
  changeName?: string;
  /** Frozen planning-space attribution for this session (design D3). */
  space?: SessionSpace;
  /**
   * What this session works on, resolved at launch
   * (unified-session-runtime-context D2). Recorded on the session and written
   * into the session-local context file the child process is pointed at.
   */
  execution?: SessionExecution;
  timeoutMs: number;
  noOutputTimeoutMs: number;
}

export type LaunchResult =
  | { ok: true; record: SessionRecord }
  | { ok: false; status: 409; code: 'busy'; message: string }
  | { ok: false; status: 503; code: 'agent_cli_unavailable'; message: string }
  | { ok: false; status: 503; code: 'shutting_down'; message: string };

export type KillResult =
  | { ok: true; status: 202; record: SessionRecord }
  | { ok: true; status: 200; record: SessionRecord }
  | { ok: false; status: 404 };

export type HostState = 'starting' | 'idle' | 'waking' | 'lost' | 'retiring' | 'retired';

export interface HostTurnInput {
  /** Literal user text delivered as one stream-json user event over stdin. */
  message: string;
  /** Overall bound for this turn only; no host watchdog remains armed while idle. */
  timeoutMs: number;
  /** Silence bound for this turn only, reset by stdout or stderr activity. */
  noOutputTimeoutMs: number;
}

export interface CreateHostInput extends HostTurnInput {
  /** Trusted working directory, captured canonically and reused for recovery. */
  cwd: string;
  /** Trusted planning roots captured at creation and reused for recovery. */
  attachedRoots?: readonly string[];
  /** Frozen planning-space attribution for the host runtime context. */
  space?: SessionSpace;
  /** Frozen execution attribution for the host runtime context. */
  execution?: SessionExecution;
}

/**
 * Internal durable-recovery seam. Callers cannot replace cwd or identity:
 * these facts must come from a reconciled durable record.
 */
export interface RecoverHostInput extends HostTurnInput {
  cwd: string;
  attachedRoots?: readonly string[];
  space?: SessionSpace;
  execution?: SessionExecution;
  claudeSessionId: string;
}

export interface HostSnapshot {
  /** Stable for this supervisor's lifetime, even when recovery replaces the process. */
  id: string;
  state: HostState;
  cwd: string;
  pid?: number;
  /** Claude's stream-json session identity, used only for same-cwd recovery. */
  sessionId?: string;
  createdAt: number;
}

export type HostResultEnvelope = Record<string, unknown>;

export type HostErrorCode =
  | 'busy'
  | 'shutting_down'
  | 'agent_cli_unavailable'
  | 'host_not_found'
  | 'host_busy'
  | 'host_retired'
  | 'host_unrecoverable'
  | 'delivery_uncertain'
  | 'turn_timeout'
  | 'no_output_timeout'
  | 'write_failed';

export interface HostErrorResult {
  ok: false;
  status: 404 | 409 | 500 | 503 | 504;
  code: HostErrorCode;
  message: string;
  host?: HostSnapshot;
}

export type CreateHostResult =
  | { ok: true; host: HostSnapshot; result: HostResultEnvelope }
  | HostErrorResult;

export type WakeHostResult =
  | { ok: true; host: HostSnapshot; result: HostResultEnvelope }
  | HostErrorResult;

export type RetireHostResult =
  | { ok: true; host: HostSnapshot }
  | { ok: false; status: 404; code: 'host_not_found'; message: string };

export interface HostLifecycleEvent {
  type: 'lost';
  reason: 'process-close' | 'owner-shutdown';
  host: HostSnapshot;
}

export interface SessionTails {
  stdout: string;
  stderr: string;
}

export interface SessionSupervisor {
  launch(input: LaunchInput): Promise<LaunchResult>;
  kill(id: string): KillResult;
  createHost(input: CreateHostInput): Promise<CreateHostResult>;
  recoverHost(input: RecoverHostInput): Promise<WakeHostResult>;
  wakeHost(id: string, input: HostTurnInput): Promise<WakeHostResult>;
  retireHost(id: string): Promise<RetireHostResult>;
  subscribeHostLifecycle(listener: (event: HostLifecycleEvent) => void): () => void;
  getHost(id: string): HostSnapshot | undefined;
  getRecord(id: string): SessionRecord | undefined;
  list(): SessionRecord[];
  getTails(id: string): SessionTails | undefined;
  /** Tree-kills every still-live session (design D6); resolves once every 'close' has been observed or a bounded wait elapses. */
  shutdownAll(reason: TerminationReason): Promise<void>;
}

interface ActiveEntry {
  pid: number;
  closed: boolean;
  terminationReason: TerminationReason | null;
  /** Set once `killProcessTree` has actually been dispatched (review M2) — guards against a second escalation timer being armed. */
  killInitiated: boolean;
  triggerKill(reason: TerminationReason): void;
  onClosed: Promise<void>;
}

interface PendingHostTurn {
  delivered: boolean;
  settled: boolean;
  requireSessionId: boolean;
  noOutputTimeoutMs: number;
  result?: HostResultEnvelope;
  overallTimer?: NodeJS.Timeout;
  noOutputTimer?: NodeJS.Timeout;
  promise: Promise<HostTurnOutcome>;
  resolve(outcome: HostTurnOutcome): void;
}

type HostTurnOutcome =
  | { ok: true; result: HostResultEnvelope }
  | { ok: false; code: Extract<HostErrorCode, 'delivery_uncertain' | 'turn_timeout' | 'no_output_timeout' | 'write_failed'>; message: string };

interface HostProcess {
  child: ChildProcess;
  pid: number;
  closed: boolean;
  slotReleased: boolean;
  killInitiated: boolean;
  pendingKillCancel?: () => void;
  contextFilePath?: string;
  onClosed: Promise<void>;
  resolveClosed(): void;
}

interface HostEntry {
  id: string;
  state: HostState;
  cwd: string;
  attachedRoots: readonly string[];
  space?: SessionSpace;
  execution?: SessionExecution;
  sessionId?: string;
  pid?: number;
  createdAt: number;
  /** Protocol framing buffer; intentionally independent from the bounded diagnostic tails. */
  protocolBuffer: string;
  process?: HostProcess;
  pendingTurn?: PendingHostTurn;
  activeWake?: Promise<WakeHostResult>;
  retirePromise?: Promise<RetireHostResult>;
}

export interface CreateSessionSupervisorOptions {
  registry: SessionRegistry;
  /** Resolves the agent CLI binary path, or null if none can be found — injectable so tests can point at a fixture (design D1's resolver, task 1.4). */
  resolveAgentCli: () => Promise<string | null>;
  maxConcurrent?: number;
  killGraceMs?: number;
  /**
   * Where session-local context files live. Defaults to the machine data
   * directory; injectable so a test can point at its own temp root without
   * mutating process-wide environment.
   */
  sessionContextPaths?: SessionContextPathOptions;
}

function appendTail(current: string, chunk: string): string {
  const combined = current + chunk;
  if (combined.length <= TAIL_BYTES) return combined;
  return combined.slice(combined.length - TAIL_BYTES);
}

function encodeHostUserEvent(message: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: message }],
    },
  })}\n`;
}

function copyHost(entry: HostEntry): HostSnapshot {
  return {
    id: entry.id,
    state: entry.state,
    cwd: entry.cwd,
    ...(entry.pid !== undefined ? { pid: entry.pid } : {}),
    ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
    createdAt: entry.createdAt,
  };
}

/**
 * Best-effort parse of the stream-json `init` event for the claude CLI's
 * own session id (design D1/D2). Any parse failure — a non-JSON line, a
 * line that isn't the init event — degrades to "no id yet", never a
 * session failure; only ever inspects `stdout` lines, since that's where
 * `--output-format stream-json` writes NDJSON.
 */
function tryParseAgentSessionId(stdoutSoFar: string): string | undefined {
  const lines = stdoutSoFar.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { type?: unknown; subtype?: unknown; session_id?: unknown };
      if (parsed.type === 'system' && parsed.subtype === 'init' && typeof parsed.session_id === 'string') {
        return parsed.session_id;
      }
    } catch {
      // Not (yet) a complete JSON line, or not the init event — keep scanning.
    }
  }
  return undefined;
}

/**
 * cross-spawn's `cmd.exe`-aware escaper (CJS, no bundled types). Loaded lazily
 * via `createRequire` — the same pattern `commands/workset.ts` uses — so the
 * POSIX and native-`.exe` spawn paths never touch its module graph. cross-spawn
 * is an exact-pinned direct dependency; only its two pure string helpers are
 * used here, no spawning.
 */
interface CmdEscape {
  /** Caret-escape a bare command (the shim path) for `cmd.exe`. */
  command(arg: string): string;
  /** Quote + caret-escape one argument for `cmd.exe`; `doubleEscapeMetaChars` applies the escape twice. */
  argument(arg: string, doubleEscapeMetaChars?: boolean): string;
}
let cachedCmdEscape: CmdEscape | undefined;
function cmdEscape(): CmdEscape {
  if (cachedCmdEscape === undefined) {
    const require = createRequire(import.meta.url);
    cachedCmdEscape = require('cross-spawn/lib/util/escape') as CmdEscape;
  }
  return cachedCmdEscape;
}

/**
 * Windows-aware agent-CLI spawn (design D1). `.cmd`/`.bat` shims cannot be
 * spawned directly with `shell:false` on modern Node (post-CVE-2024-27980
 * hardening throws synchronously — `EINVAL`); `.mjs`/extensionless POSIX
 * binaries throw synchronously too (`EFTYPE`) since they are not directly
 * executable images on Windows. Route `.cmd`/`.bat` targets through the
 * command interpreter (`cmd.exe /d /s /c`).
 *
 * SECURITY (command injection): `cmd.exe /S /C` re-parses its trailing command
 * line as shell grammar, so Node's default per-arg quoting (CRT-style `\"`)
 * does NOT protect the task/prompt text — a literal `"` in it toggles cmd's
 * own quote state and lets `&`/`|`-chained commands run (reproduced PoC).
 * Instead, build the command line with cross-spawn's vetted `cmd.exe` escaper
 * and pass it verbatim (`windowsVerbatimArguments: true`) so Node does not
 * re-quote what is already escaped. Meta chars are DOUBLE-escaped because an
 * npm-generated `.cmd`/`.bat` shim re-expands `%*` through a SECOND `cmd.exe`
 * parse (it proxies to `node <cli> %*`); a single `^`-layer is consumed by the
 * first parse and the metachar would reach the shell live on the second.
 * Verified: this delivers arbitrary metacharacter-bearing task text to the
 * agent CLI as one inert literal argument, with no side-effect command run
 * (test/core/management-api/supervisor-injection.test.ts). Native `.exe` and
 * all of POSIX spawn the binary directly, exactly as before this change.
 *
 * NEWLINE LIMITATION (Windows shim only): a raw `\n`/`\r` cannot be represented
 * as argument data through `cmd.exe /C` — cmd truncates the entire command line
 * at the first newline, silently dropping the rest of the prompt AND the
 * trailing flags (no escaping survives it; cross-spawn does not escape newlines
 * either). Rather than silently mangle the launch, the Windows `.cmd`/`.bat`
 * branch REJECTS a newline-bearing argv up front by throwing — the supervisor's
 * spawn-`catch` turns it into a clear `503 agent_cli_unavailable`. This guard is
 * deliberately scoped to the Windows shim transport, NOT `validateTask`: a
 * newline in an argv element is passed literally and is a perfectly valid
 * multi-line prompt on POSIX (and for a native `.exe`), so a global validation
 * change would regress that legitimate feature.
 */
const WINDOWS_SHIM_NEWLINE = /[\r\n]/;

function spawnAgentCli(bin: string, argv: string[], options: SpawnOptions): ChildProcess {
  if (IS_WINDOWS && ['.cmd', '.bat'].includes(path.extname(bin).toLowerCase())) {
    const comSpec = process.env.ComSpec || 'cmd.exe';
    if (argv.some((arg) => WINDOWS_SHIM_NEWLINE.test(arg))) {
      throw new Error(
        'Multi-line task text (containing a newline or carriage return) is not supported when the agent CLI is a Windows .cmd/.bat shim: cmd.exe truncates its command line at the first newline. Provide the task as a single line.'
      );
    }
    const escape = cmdEscape();
    const escapedBin = escape.command(path.normalize(bin));
    const escapedArgs = argv.map((arg) => escape.argument(arg, true));
    const commandLine = [escapedBin, ...escapedArgs].join(' ');
    return spawn(comSpec, ['/d', '/s', '/c', `"${commandLine}"`], {
      ...options,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(bin, argv, { ...options, shell: false, windowsHide: true });
}

export function createSessionSupervisor(options: CreateSessionSupervisorOptions): SessionSupervisor {
  const { registry, resolveAgentCli } = options;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const sessionContextPaths = options.sessionContextPaths ?? {};

  const active = new Map<string, ActiveEntry>();
  const hosts = new Map<string, HostEntry>();
  const tails = new Map<string, SessionTails>();
  const hostLifecycleListeners = new Set<(event: HostLifecycleEvent) => void>();
  let liveCount = 0;
  // Set synchronously as `shutdownAll`'s first statement (review m1) — closes
  // the window where `stopServer` reaps its snapshot of live sessions before
  // the listener stops accepting requests: without this, a `POST` landing in
  // that window spawns a session `shutdownAll` never observed, orphaning it
  // even on a *clean* exit.
  let draining = false;

  function emitHostLifecycle(event: HostLifecycleEvent): void {
    for (const listener of hostLifecycleListeners) {
      try {
        listener(event);
      } catch {
        // Lifecycle observation is prompt metadata only. Reconciliation on the
        // next durable operation is the correctness fallback.
      }
    }
  }

  function hostError(
    entry: HostEntry | undefined,
    status: HostErrorResult['status'],
    code: HostErrorCode,
    message: string
  ): HostErrorResult {
    return {
      ok: false,
      status,
      code,
      message,
      ...(entry !== undefined ? { host: copyHost(entry) } : {}),
    };
  }

  function releaseHostSlot(processEntry?: HostProcess): void {
    if (processEntry?.slotReleased) return;
    if (processEntry) processEntry.slotReleased = true;
    liveCount -= 1;
  }

  function clearHostTurnTimers(turn: PendingHostTurn): void {
    if (turn.overallTimer) clearTimeout(turn.overallTimer);
    if (turn.noOutputTimer) clearTimeout(turn.noOutputTimer);
  }

  function settleHostTurn(entry: HostEntry, outcome: HostTurnOutcome): void {
    const turn = entry.pendingTurn;
    if (!turn || turn.settled) return;
    turn.settled = true;
    clearHostTurnTimers(turn);
    entry.pendingTurn = undefined;
    if (outcome.ok && entry.state !== 'retiring') {
      entry.state = 'idle';
    }
    turn.resolve(outcome);
  }

  function resetHostNoOutputTimer(entry: HostEntry, timeoutMs: number): void {
    const turn = entry.pendingTurn;
    if (!turn || turn.settled) return;
    if (turn.noOutputTimer) clearTimeout(turn.noOutputTimer);
    turn.noOutputTimer = setTimeout(() => {
      settleHostTurn(entry, {
        ok: false,
        code: 'no_output_timeout',
        message: `The reusable host produced no output for ${timeoutMs} ms.`,
      });
      if (entry.process) triggerHostKill(entry.process);
    }, timeoutMs);
    turn.noOutputTimer.unref?.();
  }

  function triggerHostKill(processEntry: HostProcess): void {
    if (processEntry.closed || processEntry.killInitiated) return;
    processEntry.killInitiated = true;
    if (processEntry.pid > 0) {
      const handle = killProcessTree(processEntry.pid, { graceMs: killGraceMs });
      processEntry.pendingKillCancel = handle.cancel;
    }
  }

  function settleHostStdinFailure(entry: HostEntry, processEntry: HostProcess, error: unknown): void {
    const turn = entry.pendingTurn;
    if (!turn || turn.settled) return;
    const delivered = turn.delivered;
    settleHostTurn(entry, {
      ok: false,
      code: delivered ? 'delivery_uncertain' : 'write_failed',
      message: delivered
        ? 'The stdin write failed after accepting the message; delivery is uncertain and was not replayed.'
        : error instanceof Error ? error.message : String(error),
    });
    if (!processEntry.closed) triggerHostKill(processEntry);
  }

  function inspectHostLine(entry: HostEntry, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: Record<string, unknown>;
    try {
      const candidate = JSON.parse(trimmed) as unknown;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
      parsed = candidate as Record<string, unknown>;
    } catch {
      return;
    }

    if (
      parsed.type === 'system'
      && parsed.subtype === 'init'
      && typeof parsed.session_id === 'string'
    ) {
      entry.sessionId = parsed.session_id;
      const pending = entry.pendingTurn;
      if (pending?.requireSessionId && pending.result) {
        settleHostTurn(entry, { ok: true, result: pending.result });
      }
      return;
    }
    if (parsed.type === 'result' && entry.pendingTurn) {
      if (entry.pendingTurn.requireSessionId && !entry.sessionId) {
        entry.pendingTurn.result = parsed;
        return;
      }
      settleHostTurn(entry, { ok: true, result: parsed });
    }
  }

  function consumeHostStdout(entry: HostEntry, text: string): void {
    entry.protocolBuffer += text;
    let newlineIndex = entry.protocolBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = entry.protocolBuffer.slice(0, newlineIndex);
      entry.protocolBuffer = entry.protocolBuffer.slice(newlineIndex + 1);
      inspectHostLine(entry, line);
      newlineIndex = entry.protocolBuffer.indexOf('\n');
    }
  }

  function createHostRuntimeContext(entry: HostEntry): string | undefined {
    const runtimeContext = buildRuntimeContext({
      sessionId: entry.id,
      ...(entry.space !== undefined ? { space: entry.space } : {}),
      ...(entry.execution !== undefined ? { execution: entry.execution } : {}),
    });
    if (!runtimeContext) return undefined;
    try {
      return writeSessionRuntimeContext(runtimeContext, sessionContextPaths);
    } catch {
      return undefined;
    }
  }

  function spawnHostProcess(entry: HostEntry, claudeBin: string, resumeSessionId?: string): HostProcess {
    const contextFilePath = createHostRuntimeContext(entry);
    const argv = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      ...(resumeSessionId !== undefined ? ['--resume', resumeSessionId] : []),
      ...entry.attachedRoots.flatMap((root) => ['--add-dir', root]),
    ];

    let child: ChildProcess;
    try {
      child = spawnAgentCli(claudeBin, argv, {
        cwd: entry.cwd,
        env: contextFilePath
          ? { ...process.env, [RASEN_SESSION_CONTEXT_ENV]: contextFilePath }
          : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: !IS_WINDOWS,
        windowsHide: IS_WINDOWS,
      });
    } catch (error) {
      if (contextFilePath) removeSessionRuntimeContext(entry.id, sessionContextPaths);
      throw error;
    }

    let resolveClosed: () => void = () => {};
    const onClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const processEntry: HostProcess = {
      child,
      pid: child.pid ?? -1,
      closed: false,
      slotReleased: false,
      killInitiated: false,
      ...(contextFilePath !== undefined ? { contextFilePath } : {}),
      onClosed,
      resolveClosed,
    };
    entry.process = processEntry;
    entry.pid = child.pid;
    entry.protocolBuffer = '';

    const onData = (streamKey: keyof SessionTails) => (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const current = tails.get(entry.id) ?? { stdout: '', stderr: '' };
      current[streamKey] = appendTail(current[streamKey], text);
      tails.set(entry.id, current);
      if (entry.pendingTurn) {
        resetHostNoOutputTimer(entry, entry.pendingTurn.noOutputTimeoutMs);
      }
      if (streamKey === 'stdout') consumeHostStdout(entry, text);
    };
    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));

    const finishProcess = (): void => {
      if (processEntry.closed) return;
      processEntry.closed = true;
      processEntry.pendingKillCancel?.();
      releaseHostSlot(processEntry);
      removeSessionRuntimeContext(entry.id, sessionContextPaths);
      let lossEvent: HostLifecycleEvent | undefined;
      if (entry.process === processEntry) {
        entry.process = undefined;
        entry.pid = undefined;
        if (entry.state !== 'retiring' && entry.state !== 'retired') {
          entry.state = 'lost';
          lossEvent = {
            type: 'lost',
            reason: draining ? 'owner-shutdown' : 'process-close',
            host: copyHost(entry),
          };
        }
        if (entry.pendingTurn) {
          const delivered = entry.pendingTurn.delivered;
          settleHostTurn(entry, {
            ok: false,
            code: delivered ? 'delivery_uncertain' : 'write_failed',
            message: delivered
              ? 'The host process closed after accepting the message but before returning a result; the message was not replayed.'
              : 'The host process closed before accepting the message.',
          });
        }
      }
      processEntry.resolveClosed();
      if (lossEvent) emitHostLifecycle(lossEvent);
    };
    // Writable write failures invoke the write callback and then emit
    // `error`. Keep a persistent consumer installed for the process lifetime
    // and route both signals through one idempotent pending-turn settlement.
    child.stdin?.on('error', (error) => {
      settleHostStdinFailure(entry, processEntry, error);
    });
    child.once('error', finishProcess);
    child.once('close', finishProcess);

    return processEntry;
  }

  function makePendingHostTurn(
    entry: HostEntry,
    input: HostTurnInput,
    requireSessionId: boolean
  ): PendingHostTurn {
    let resolveTurn: (outcome: HostTurnOutcome) => void = () => {};
    const promise = new Promise<HostTurnOutcome>((resolve) => {
      resolveTurn = resolve;
    });
    const turn: PendingHostTurn = {
      delivered: false,
      settled: false,
      requireSessionId,
      noOutputTimeoutMs: input.noOutputTimeoutMs,
      promise,
      resolve: resolveTurn,
    };
    entry.pendingTurn = turn;
    turn.overallTimer = setTimeout(() => {
      settleHostTurn(entry, {
        ok: false,
        code: 'turn_timeout',
        message: `The reusable host turn exceeded ${input.timeoutMs} ms.`,
      });
      if (entry.process) triggerHostKill(entry.process);
    }, input.timeoutMs);
    turn.overallTimer.unref?.();
    resetHostNoOutputTimer(entry, input.noOutputTimeoutMs);
    return turn;
  }

  async function deliverHostTurn(
    entry: HostEntry,
    input: HostTurnInput,
    requireSessionId = false
  ): Promise<HostTurnOutcome> {
    const processEntry = entry.process;
    if (!processEntry || processEntry.closed || !processEntry.child.stdin) {
      return {
        ok: false,
        code: 'write_failed',
        message: 'The reusable host has no writable process.',
      };
    }

    const turn = makePendingHostTurn(entry, input, requireSessionId);
    const writeFinished = new Promise<void>((resolve, reject) => {
      try {
        processEntry.child.stdin!.write(encodeHostUserEvent(input.message), 'utf-8', (error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
        // `Writable.write()` accepting the chunk establishes the ambiguity
        // boundary even when it returns false and waits for backpressure.
        turn.delivered = true;
      } catch (error) {
        reject(error);
      }
    });

    try {
      await Promise.race([
        writeFinished,
        turn.promise.then(() => undefined),
      ]);
    } catch (error) {
      settleHostStdinFailure(entry, processEntry, error);
    }

    const outcome = await turn.promise;
    if (
      !outcome.ok
      && ['turn_timeout', 'no_output_timeout', 'write_failed', 'delivery_uncertain'].includes(outcome.code)
      && !processEntry.closed
    ) {
      triggerHostKill(processEntry);
      await processEntry.onClosed;
    }
    return outcome;
  }

  function hostOutcomeError(entry: HostEntry, outcome: Exclude<HostTurnOutcome, { ok: true }>): HostErrorResult {
    const status = outcome.code === 'turn_timeout' || outcome.code === 'no_output_timeout'
      ? 504
      : outcome.code === 'write_failed' ? 500 : 409;
    return hostError(entry, status, outcome.code, outcome.message);
  }

  async function createHost(input: CreateHostInput): Promise<CreateHostResult> {
    if (draining) {
      return hostError(undefined, 503, 'shutting_down', 'The server is shutting down and is not admitting new hosts.');
    }
    if (liveCount >= maxConcurrent) {
      return hostError(undefined, 409, 'busy', `Maximum concurrent processes (${maxConcurrent}) already live.`);
    }

    let canonicalCwd: string;
    try {
      canonicalCwd = fs.realpathSync.native(input.cwd);
    } catch (error) {
      return hostError(undefined, 503, 'agent_cli_unavailable', error instanceof Error ? error.message : String(error));
    }

    // Capacity is reserved before the resolver await, sharing the same
    // synchronous admission gate as one-shot launches.
    liveCount += 1;
    const entry: HostEntry = {
      id: randomUUID(),
      state: 'starting',
      cwd: canonicalCwd,
      attachedRoots: Object.freeze([...(input.attachedRoots ?? [])]),
      ...(input.space !== undefined ? { space: { ...input.space } } : {}),
      ...(input.execution !== undefined ? { execution: { ...input.execution } } : {}),
      createdAt: Date.now(),
      protocolBuffer: '',
    };
    hosts.set(entry.id, entry);
    tails.set(entry.id, { stdout: '', stderr: '' });

    const claudeBin = await resolveAgentCli();
    if (draining) {
      releaseHostSlot();
      hosts.delete(entry.id);
      tails.delete(entry.id);
      return hostError(undefined, 503, 'shutting_down', 'The server is shutting down and is not admitting new hosts.');
    }
    if (!claudeBin) {
      releaseHostSlot();
      hosts.delete(entry.id);
      tails.delete(entry.id);
      return hostError(undefined, 503, 'agent_cli_unavailable', 'No agent CLI binary could be resolved on this machine.');
    }

    try {
      spawnHostProcess(entry, claudeBin);
    } catch (error) {
      releaseHostSlot();
      hosts.delete(entry.id);
      tails.delete(entry.id);
      removeSessionRuntimeContext(entry.id, sessionContextPaths);
      return hostError(undefined, 503, 'agent_cli_unavailable', error instanceof Error ? error.message : String(error));
    }

    const outcome = await deliverHostTurn(entry, input, true);
    if (!outcome.ok) {
      const failure = hostOutcomeError(entry, outcome);
      if (entry.process && !entry.process.closed) {
        triggerHostKill(entry.process);
        await entry.process.onClosed;
      }
      hosts.delete(entry.id);
      tails.delete(entry.id);
      removeSessionRuntimeContext(entry.id, sessionContextPaths);
      return { ...failure, host: undefined };
    }
    return { ok: true, host: copyHost(entry), result: outcome.result };
  }

  async function recoverHost(input: RecoverHostInput): Promise<WakeHostResult> {
    if (draining) {
      return hostError(
        undefined,
        503,
        'shutting_down',
        'The server is shutting down and is not admitting recovered hosts.'
      );
    }
    if (liveCount >= maxConcurrent) {
      return hostError(
        undefined,
        409,
        'busy',
        `Maximum concurrent processes (${maxConcurrent}) already live.`
      );
    }
    if (input.claudeSessionId.trim().length === 0) {
      return hostError(
        undefined,
        409,
        'host_unrecoverable',
        'Durable recovery requires the exact Claude session identity.'
      );
    }

    let canonicalCwd: string;
    let attachedRoots: readonly string[];
    try {
      canonicalCwd = fs.realpathSync.native(input.cwd);
      const identity = (value: string) => {
        const normalized = path.normalize(value);
        return IS_WINDOWS ? normalized.toLowerCase() : normalized;
      };
      if (identity(canonicalCwd) !== identity(input.cwd)) {
        return hostError(
          undefined,
          409,
          'host_unrecoverable',
          'The durable recovery cwd no longer matches its canonical identity.'
        );
      }
      attachedRoots = Object.freeze(
        [...(input.attachedRoots ?? [])].map((root) => {
          const canonical = fs.realpathSync.native(root);
          if (identity(canonical) !== identity(root)) {
            throw new Error(
              'A durable recovery attached root no longer matches its canonical identity.'
            );
          }
          return canonical;
        })
      );
    } catch (error) {
      return hostError(
        undefined,
        409,
        'host_unrecoverable',
        error instanceof Error ? error.message : String(error)
      );
    }

    // Reserve capacity synchronously before binary resolution or spawn, using
    // the same counter as live reusable hosts and one-shot sessions.
    liveCount += 1;
    const entry: HostEntry = {
      id: randomUUID(),
      state: 'lost',
      cwd: canonicalCwd,
      attachedRoots,
      ...(input.space !== undefined ? { space: { ...input.space } } : {}),
      ...(input.execution !== undefined
        ? { execution: { ...input.execution } }
        : {}),
      sessionId: input.claudeSessionId,
      createdAt: Date.now(),
      protocolBuffer: '',
    };
    hosts.set(entry.id, entry);
    tails.set(entry.id, { stdout: '', stderr: '' });

    const operation = runAcceptedWake(entry, input, true, true);
    entry.activeWake = operation;
    try {
      const result = await operation;
      if (!result.ok) {
        hosts.delete(entry.id);
        tails.delete(entry.id);
        removeSessionRuntimeContext(entry.id, sessionContextPaths);
        return { ...result, host: undefined };
      }
      return result;
    } finally {
      if (entry.activeWake === operation) entry.activeWake = undefined;
    }
  }

  async function runAcceptedWake(
    entry: HostEntry,
    input: HostTurnInput,
    recover: boolean,
    slotReserved: boolean
  ): Promise<WakeHostResult> {
    if (recover) {
      const claudeBin = await resolveAgentCli();
      if (draining) {
        if (slotReserved) releaseHostSlot();
        if (entry.state !== 'retiring') entry.state = 'lost';
        return hostError(entry, 503, 'shutting_down', 'The server is shutting down and is not admitting recovered hosts.');
      }
      if (!claudeBin) {
        if (slotReserved) releaseHostSlot();
        if (entry.state !== 'retiring') entry.state = 'lost';
        return hostError(entry, 503, 'agent_cli_unavailable', 'No agent CLI binary could be resolved on this machine.');
      }
      try {
        spawnHostProcess(entry, claudeBin, entry.sessionId);
      } catch (error) {
        if (slotReserved) releaseHostSlot();
        if (entry.state !== 'retiring') entry.state = 'lost';
        removeSessionRuntimeContext(entry.id, sessionContextPaths);
        return hostError(entry, 503, 'agent_cli_unavailable', error instanceof Error ? error.message : String(error));
      }
    }

    const outcome = await deliverHostTurn(entry, input);
    if (!outcome.ok) return hostOutcomeError(entry, outcome);
    return { ok: true, host: copyHost(entry), result: outcome.result };
  }

  function wakeHost(id: string, input: HostTurnInput): Promise<WakeHostResult> {
    const entry = hosts.get(id);
    if (!entry) {
      return Promise.resolve(hostError(undefined, 404, 'host_not_found', `Reusable host ${id} was not found.`));
    }
    if (entry.state === 'retired') {
      return Promise.resolve(hostError(entry, 409, 'host_retired', `Reusable host ${id} is retired.`));
    }
    if (entry.state === 'starting' || entry.state === 'waking' || entry.state === 'retiring') {
      return Promise.resolve(hostError(entry, 409, 'host_busy', `Reusable host ${id} is not idle.`));
    }
    if (draining) {
      return Promise.resolve(hostError(entry, 503, 'shutting_down', 'The server is shutting down and is not admitting host wakes.'));
    }

    const recover = entry.state === 'lost' || entry.process === undefined;
    if (recover && !entry.sessionId) {
      entry.state = 'lost';
      return Promise.resolve(hostError(
        entry,
        409,
        'host_unrecoverable',
        `Reusable host ${id} has no captured Claude session identity and cannot be resumed.`
      ));
    }
    if (recover && liveCount >= maxConcurrent) {
      entry.state = 'lost';
      return Promise.resolve(hostError(entry, 409, 'busy', `Maximum concurrent processes (${maxConcurrent}) already live.`));
    }

    // This state transition and recovery reservation are synchronous and
    // precede the first await, so overlap cannot write or spawn.
    entry.state = 'waking';
    if (recover) liveCount += 1;
    const operation = runAcceptedWake(entry, input, recover, recover);
    entry.activeWake = operation;
    void operation.finally(() => {
      if (entry.activeWake === operation) entry.activeWake = undefined;
    });
    return operation;
  }

  function retireHost(id: string): Promise<RetireHostResult> {
    const entry = hosts.get(id);
    if (!entry) {
      return Promise.resolve({
        ok: false,
        status: 404,
        code: 'host_not_found',
        message: `Reusable host ${id} was not found.`,
      });
    }
    if (entry.retirePromise) return entry.retirePromise;
    if (entry.state === 'retired') {
      return Promise.resolve({ ok: true, host: copyHost(entry) });
    }

    // Terminal admission gate: later wakes observe `retiring` immediately,
    // while an already accepted wake remains allowed to settle.
    entry.state = 'retiring';
    const retiring = (async (): Promise<RetireHostResult> => {
      if (entry.activeWake) await entry.activeWake;
      const processEntry = entry.process;
      if (processEntry && !processEntry.closed) {
        try {
          processEntry.child.stdin?.end();
        } catch {
          // A synchronous close race is equivalent to the asynchronous stdin
          // error consumed above; retirement still waits for actual close.
        }
        const escalationTimer = setTimeout(() => {
          triggerHostKill(processEntry);
        }, killGraceMs);
        escalationTimer.unref?.();
        await processEntry.onClosed;
        clearTimeout(escalationTimer);
      }
      removeSessionRuntimeContext(entry.id, sessionContextPaths);
      entry.pid = undefined;
      entry.state = 'retired';
      return { ok: true, host: copyHost(entry) };
    })();
    entry.retirePromise = retiring;
    return retiring;
  }

  function getHost(id: string): HostSnapshot | undefined {
    const entry = hosts.get(id);
    return entry ? copyHost(entry) : undefined;
  }

  /**
   * Drops a finished session's context file, plus those of any records the
   * same `finalize` call pruned past the retention cap (task 4.3). The prune
   * is the backstop: a session whose own cleanup was interrupted still loses
   * its context directory when its record leaves the registry. Removal is
   * best-effort — a leftover directory is inert because its session id no
   * longer resolves, and a failed unlink must never fail a finished session.
   */
  function releaseSessionContext(sessionId: string, prunedIds: readonly string[]): void {
    removeSessionRuntimeContext(sessionId, sessionContextPaths);
    for (const prunedId of prunedIds) {
      if (prunedId === sessionId) continue;
      removeSessionRuntimeContext(prunedId, sessionContextPaths);
    }
  }

  async function launch(input: LaunchInput): Promise<LaunchResult> {
    if (draining) {
      return {
        ok: false,
        status: 503,
        code: 'shutting_down',
        message: 'The server is shutting down and is not admitting new sessions.',
      };
    }

    if (liveCount >= maxConcurrent) {
      return { ok: false, status: 409, code: 'busy', message: `Maximum concurrent sessions (${maxConcurrent}) already live.` };
    }

    // Reserved BEFORE the `await` below (review M1): `launch` is async, and
    // everything up to the first `await` runs as one synchronous turn, so
    // two concurrent callers cannot both observe the pre-increment
    // `liveCount` — the second caller's cap check only runs once the first
    // has already reserved. Reserving after the `await resolveAgentCli()`
    // call (even though that resolver is cached) reopens exactly that
    // TOCTOU window: a proven repro got two live sessions past
    // `maxConcurrent: 1`. Decremented on every path below that ends
    // without a live entry in `active` — the 503 just below, and the
    // spawn-catch further down.
    liveCount += 1;

    const claudeBin = await resolveAgentCli();

    // N2 (child 1 hand-off): `draining` is only checked once, above, before
    // this `await`. A `shutdownAll` that starts while the resolver is
    // in-flight would otherwise let this launch proceed to spawn after the
    // drain snapshot — orphaning a session no shutdown will ever observe.
    // The injected cached `createAgentCliResolver()` yields for about one
    // microtask, but a daemon-supplied resolver may genuinely await I/O, so
    // this second check is unconditional rather than assumed-cheap-away.
    if (draining) {
      liveCount -= 1;
      return {
        ok: false,
        status: 503,
        code: 'shutting_down',
        message: 'The server is shutting down and is not admitting new sessions.',
      };
    }

    if (!claudeBin) {
      liveCount -= 1;
      return {
        ok: false,
        status: 503,
        code: 'agent_cli_unavailable',
        message: 'No agent CLI binary could be resolved on this machine.',
      };
    }

    const record = registry.create({
      kind: input.kind,
      task: input.task,
      cwd: input.cwd,
      ...(input.changeName !== undefined ? { changeName: input.changeName } : {}),
      ...(input.space !== undefined ? { space: input.space } : {}),
      ...(input.execution !== undefined ? { execution: input.execution } : {}),
    });
    tails.set(record.id, { stdout: '', stderr: '' });

    // Written BEFORE spawn, temp + rename, so the agent can never observe a
    // partial document (design D3, task 4.1). The child is handed the PATH —
    // never the JSON: the document would otherwise land in the process table,
    // every `ps` listing, and any log that dumps the environment, besides
    // hitting cmd.exe quoting and command-line length limits on Windows.
    // A write failure is not fatal: the session still launches and every
    // reader falls through to the pre-existing cwd derivation, which is the
    // documented "no session context" arm rather than a broken one.
    let contextFilePath: string | undefined;
    const runtimeContext = buildRuntimeContext({
      sessionId: record.id,
      ...(input.space !== undefined ? { space: input.space } : {}),
      ...(input.execution !== undefined ? { execution: input.execution } : {}),
    });
    if (runtimeContext) {
      try {
        contextFilePath = writeSessionRuntimeContext(runtimeContext, sessionContextPaths);
      } catch {
        contextFilePath = undefined;
      }
    }

    const promptToken = `${input.skill} ${input.task}`;
    const argv = [
      '-p',
      promptToken,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
      ...(input.attachedRoots ?? []).flatMap((root) => ['--add-dir', root]),
    ];

    let child;
    try {
      child = spawnAgentCli(claudeBin, argv, {
        cwd: input.cwd,
        env: contextFilePath
          ? { ...process.env, [RASEN_SESSION_CONTEXT_ENV]: contextFilePath }
          : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WINDOWS,
        windowsHide: IS_WINDOWS,
      });
    } catch (err) {
      liveCount -= 1;
      // N1 (child 1 hand-off): the `close`/`error` handlers below both
      // prune tails for every id `finalize` reports evicted past the
      // retention cap; this synchronous spawn-throw path (e.g. ENOENT on a
      // bad binary path) must do the same, symmetrically, or the tails map
      // leaks one entry per occurrence.
      const prunedIds = registry.finalize(record.id, 'spawn-error', null, null);
      for (const prunedId of prunedIds) tails.delete(prunedId);
      releaseSessionContext(record.id, prunedIds);
      return { ok: false, status: 503, code: 'agent_cli_unavailable', message: err instanceof Error ? err.message : String(err) };
    }

    registry.updateState(record.id, 'running', { pid: child.pid });

    let overallTimer: NodeJS.Timeout | undefined;
    let noOutputTimer: NodeJS.Timeout | undefined;
    let pendingKillCancel: (() => void) | undefined;

    let resolveClosed: () => void = () => {};
    const onClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const entry: ActiveEntry = {
      pid: child.pid ?? -1,
      closed: false,
      terminationReason: null,
      killInitiated: false,
      onClosed,
      triggerKill(reason) {
        if (entry.closed) return;
        if (!entry.terminationReason) entry.terminationReason = reason;
        registry.updateState(record.id, 'exiting', { terminationReason: entry.terminationReason });
        // Idempotent past the first dispatch (review M2): a second DELETE
        // on an already-'exiting' session, or a watchdog/overall timer
        // firing inside a DELETE's grace window, must not arm a second
        // escalation timer — `pendingKillCancel` would then only ever
        // point at the LATEST one, and the `close` handler's single
        // `pendingKillCancel?.()` call would leave the earlier timer
        // armed to fire a stale SIGKILL at `-pid` after the child (and
        // possibly its pgid) is already gone.
        if (entry.killInitiated) return;
        entry.killInitiated = true;
        if (typeof child.pid === 'number') {
          const handle = killProcessTree(child.pid, { graceMs: killGraceMs });
          pendingKillCancel = handle.cancel;
        }
      },
    };
    active.set(record.id, entry);

    function clearTimers(): void {
      if (overallTimer) clearTimeout(overallTimer);
      if (noOutputTimer) clearTimeout(noOutputTimer);
    }

    function resetNoOutputTimer(): void {
      if (noOutputTimer) clearTimeout(noOutputTimer);
      noOutputTimer = setTimeout(() => {
        entry.triggerKill('no-output-timeout');
      }, input.noOutputTimeoutMs);
      noOutputTimer.unref?.();
    }

    overallTimer = setTimeout(() => {
      entry.triggerKill('overall-timeout');
    }, input.timeoutMs);
    overallTimer.unref?.();
    resetNoOutputTimer();

    const onData = (streamKey: keyof SessionTails) => (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const current = tails.get(record.id) ?? { stdout: '', stderr: '' };
      current[streamKey] = appendTail(current[streamKey], text);
      tails.set(record.id, current);

      registry.touchOutput(record.id);
      resetNoOutputTimer();

      if (streamKey === 'stdout') {
        const agentSessionId = tryParseAgentSessionId(current.stdout);
        if (agentSessionId) {
          registry.updateState(record.id, registry.get(record.id)?.state ?? 'running', { agentSessionId });
        }
      }
    };
    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));

    child.on('error', () => {
      // Spawn-time or runtime dispatch error with no live process ever
      // confirmed — safe to release the slot immediately (mirrors submit.ts).
      // (review t1: this assumption holds for every realistic emitter of
      // Node's child_process 'error' — a failed spawn or a stream error
      // before any process existed; it would NOT hold for a hypothetical
      // 'error' fired on an already-running child, which 'close' still
      // handles separately and which this early release does not race.)
      if (entry.closed) return;
      entry.closed = true;
      clearTimers();
      pendingKillCancel?.();
      liveCount -= 1;
      active.delete(record.id);
      const prunedIds = registry.finalize(record.id, entry.terminationReason ?? 'spawn-error', null, null);
      for (const prunedId of prunedIds) tails.delete(prunedId);
      releaseSessionContext(record.id, prunedIds);
      resolveClosed();
    });

    child.on('close', (code, signal) => {
      if (entry.closed) return;
      entry.closed = true;
      clearTimers();
      // Escalation is keyed off this very event: cancel the pending forced
      // kill now that the child has actually closed, rather than letting a
      // stale SIGKILL fire at an already-gone (possibly PID-reused) process.
      pendingKillCancel?.();
      liveCount -= 1;
      active.delete(record.id);

      const reason: TerminationReason = entry.terminationReason ?? (signal ? 'signal' : 'exit');
      // `finalize` returns any OTHER records pruned past the retention cap
      // by this call (review m2) — their tails must be freed too, or the
      // tails map grows unbounded even though the registry stays capped at
      // MAX_EXITED_RECORDS.
      const prunedIds = registry.finalize(record.id, reason, code, signal);
      for (const prunedId of prunedIds) tails.delete(prunedId);
      releaseSessionContext(record.id, prunedIds);
      resolveClosed();
    });

    return { ok: true, record: registry.get(record.id)! };
  }

  function kill(id: string): KillResult {
    const record = registry.get(id);
    if (!record) return { ok: false, status: 404 };
    if (record.state === 'exited') return { ok: true, status: 200, record };

    const entry = active.get(id);
    if (entry) {
      entry.triggerKill('killed');
    } else {
      // No active handle (already settling) but the registry hasn't caught
      // up yet — nothing more to signal; the record will finalize on its own.
      registry.updateState(id, 'exiting', { terminationReason: 'killed' });
    }
    return { ok: true, status: 202, record: registry.get(id)! };
  }

  function getRecord(id: string): SessionRecord | undefined {
    return registry.get(id);
  }

  function list(): SessionRecord[] {
    return registry.list();
  }

  function getTails(id: string): SessionTails | undefined {
    return tails.get(id);
  }

  async function shutdownAll(reason: TerminationReason): Promise<void> {
    // First statement, synchronous, before any `await` (review m1): stops
    // admitting new launches immediately, closing the reap-then-close-
    // listener race — see the `draining` declaration above.
    draining = true;
    const waits: Promise<void>[] = [];
    for (const [id, entry] of active) {
      entry.triggerKill(reason);
      waits.push(entry.onClosed);
      void id;
    }
    for (const entry of hosts.values()) {
      const processEntry = entry.process;
      if (!processEntry || processEntry.closed) continue;
      triggerHostKill(processEntry);
      waits.push(processEntry.onClosed);
    }
    await Promise.all(waits);
  }

  function subscribeHostLifecycle(
    listener: (event: HostLifecycleEvent) => void
  ): () => void {
    hostLifecycleListeners.add(listener);
    return () => {
      hostLifecycleListeners.delete(listener);
    };
  }

  return {
    launch,
    kill,
    createHost,
    recoverHost,
    wakeHost,
    retireHost,
    subscribeHostLifecycle,
    getHost,
    getRecord,
    list,
    getTails,
    shutdownAll,
  };
}

// ---------------------------------------------------------------------------
// Agent CLI discovery (design D1, task 1.4)
// ---------------------------------------------------------------------------

/** Candidate executable names per platform (Windows needs the shim extensions; POSIX just the bare name). */
function candidateNames(): string[] {
  return IS_WINDOWS ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
}

/**
 * Resolves the agent CLI binary: `RASEN_CLAUDE_BIN` env override first (not
 * verified to exist — an explicit override is trusted, and a bad override
 * surfaces as a spawn error rather than a silent fallback), else a PATH
 * scan. Never influenced by client input (design D1).
 */
async function resolveAgentCliBin(): Promise<string | null> {
  const override = process.env.RASEN_CLAUDE_BIN;
  if (override) return override;

  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of candidateNames()) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        // review t3: a PATH hit that isn't actually executable (wrong
        // permissions, a stray non-executable file named `claude`) would
        // otherwise resolve here, spawn, and only fail later as a
        // same-session `spawn-error` — an up-front 503 is the honest
        // signal. `accessSync` throws (caught below) when the bit is
        // unset; on win32 X_OK degrades to an existence check, which is
        // already covered by `statSync` above, so this is a no-op there.
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Missing, unreadable, or not executable — keep scanning.
      }
    }
  }
  return null;
}

/** Builds a `resolveAgentCli` closure that resolves once and caches — server-lifetime, per `createSessionSupervisor` call (task 1.4). */
export function createAgentCliResolver(): () => Promise<string | null> {
  let cached: string | null | undefined;
  return async () => {
    if (cached !== undefined) return cached;
    cached = await resolveAgentCliBin();
    return cached;
  };
}
