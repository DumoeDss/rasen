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
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { killProcessTree } from './kill-tree.js';
import type { SessionKind, SessionRecord, SessionRegistry, TerminationReason } from './session-registry.js';

const IS_WINDOWS = process.platform === 'win32';

/** Bounded tail retained per stream for diagnostics (design D2's "64 KiB ring-buffer tails"). */
const TAIL_BYTES = 64 * 1024;

/** Grace period between SIGTERM and SIGKILL on the supervised process tree. */
const DEFAULT_KILL_GRACE_MS = 5_000;

const DEFAULT_MAX_CONCURRENT = 3;

export interface LaunchInput {
  kind: SessionKind;
  /** The whitelist entry's skill invocation, e.g. `/rasen:auto` (design D1). */
  skill: string;
  task: string;
  cwd: string;
  changeName?: string;
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

export interface SessionTails {
  stdout: string;
  stderr: string;
}

export interface SessionSupervisor {
  launch(input: LaunchInput): Promise<LaunchResult>;
  kill(id: string): KillResult;
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

export interface CreateSessionSupervisorOptions {
  registry: SessionRegistry;
  /** Resolves the agent CLI binary path, or null if none can be found — injectable so tests can point at a fixture (design D1's resolver, task 1.4). */
  resolveAgentCli: () => Promise<string | null>;
  maxConcurrent?: number;
  killGraceMs?: number;
}

function appendTail(current: string, chunk: string): string {
  const combined = current + chunk;
  if (combined.length <= TAIL_BYTES) return combined;
  return combined.slice(combined.length - TAIL_BYTES);
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

export function createSessionSupervisor(options: CreateSessionSupervisorOptions): SessionSupervisor {
  const { registry, resolveAgentCli } = options;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  const active = new Map<string, ActiveEntry>();
  const tails = new Map<string, SessionTails>();
  let liveCount = 0;
  // Set synchronously as `shutdownAll`'s first statement (review m1) — closes
  // the window where `stopServer` reaps its snapshot of live sessions before
  // the listener stops accepting requests: without this, a `POST` landing in
  // that window spawns a session `shutdownAll` never observed, orphaning it
  // even on a *clean* exit.
  let draining = false;

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
    });
    tails.set(record.id, { stdout: '', stderr: '' });

    const promptToken = `${input.skill} ${input.task}`;
    const argv = ['-p', promptToken, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];

    let child;
    try {
      child = spawn(claudeBin, argv, {
        cwd: input.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
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
    await Promise.all(waits);
  }

  return { launch, kill, getRecord, list, getTails, shutdownAll };
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
