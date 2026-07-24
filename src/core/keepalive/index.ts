/**
 * Keepalive primitives for `rasen agent wait` (cli-agent-wait spec).
 *
 * Subagent prompt caches live for 5 minutes and expire while a worker idles
 * between pipeline stages; a resumed worker then rewrites its whole context
 * at cache-write pricing. The only cache-safe way to keep a parked worker
 * warm is a busy-wait beat: a bounded blocking tool call that returns before
 * the TTL lapses, so every continuation is a clean tool-result extension of
 * the cached prefix. This module holds the beat-side primitives:
 *
 *  - the signal-file protocol the LEAD uses to resume or stand down a parked
 *    worker (`<changeRoot>/signals/<role>.json`, atomic write, consume-on-read)
 *  - persistent beat counting with an economic cap per role family
 *  - agent-runtime detection and the keepalive gate (Claude Code on by
 *    default, Codex off — the cost model is Claude-cache-specific)
 *
 * The command in src/commands/agent.ts is a thin consumer; the orchestration
 * playbook documents the LEAD-side conventions.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Beat duration: must return inside BOTH the 5-minute cache TTL and the
 * harness's default Bash tool timeout (120s) — a longer default beat gets the
 * whole wait call killed/backgrounded by the tool timeout when the worker
 * forgets to raise it, which silently defeats the keepalive. Callers may set
 * `--beat-seconds` up to MAX_BEAT_SECONDS, but then MUST also raise the tool
 * timeout on their side.
 */
export const DEFAULT_BEAT_SECONDS = 100;
export const MAX_BEAT_SECONDS = 300;
/** Signal-file poll cadence within a beat. */
export const POLL_INTERVAL_MS = 5000;
/** Beat state older than this is a leftover from a dead park episode. */
export const STALE_STATE_MS = 2 * 60 * 60 * 1000;
/**
 * A signal already on disk when a NEW park episode starts is honored only if
 * written within this grace window; older files are leftovers from a prior
 * episode (e.g. a standDown the LEAD wrote after the previous worker exited)
 * and would otherwise insta-kill every subsequent park.
 */
export const STALE_SIGNAL_MS = 120_000;
/**
 * Context floor below which keepalive is skipped. Default 0 = gate disabled;
 * set `keepalive.contextFloor` in config to re-enable.
 */
export const DEFAULT_CONTEXT_FLOOR = 0;

// ---------------------------------------------------------------------------
// Signal-file protocol
// ---------------------------------------------------------------------------

export interface KeepaliveSignal {
  kind: 'resume' | 'standDown';
  /** LEAD-authored instruction payload, returned verbatim to the worker on resume. */
  instruction?: string;
  ts?: string;
}

/** Role keys become file names; keep them to a conservative identifier set. */
export function isValidRoleKey(roleKey: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(roleKey);
}

export function signalsDir(changeRoot: string): string {
  return path.join(changeRoot, 'signals');
}

export function signalFilePath(changeRoot: string, roleKey: string): string {
  return path.join(signalsDir(changeRoot), `${roleKey}.json`);
}

export function beatStatePath(changeRoot: string, roleKey: string): string {
  return path.join(signalsDir(changeRoot), '.state', `${roleKey}.json`);
}

/**
 * Atomic signal write (temp file + rename) so the polling reader never sees a
 * half-written JSON. Exposed for the LEAD side and tests; the playbook
 * documents the same temp+rename convention for Write-tool authors.
 */
export function writeSignalAtomic(changeRoot: string, roleKey: string, signal: KeepaliveSignal): string {
  const target = signalFilePath(changeRoot, roleKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), ...signal }), 'utf-8');
  fs.renameSync(tmp, target);
  return target;
}

/**
 * Read the role's signal file if present. A malformed file is consumed
 * (deleted) and reported as absent, so one bad write cannot poison every
 * subsequent beat.
 */
export function readSignal(changeRoot: string, roleKey: string): KeepaliveSignal | null {
  const file = signalFilePath(changeRoot, roleKey);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  try {
    // Strip a UTF-8 BOM: Windows-side LEADs writing signals via PowerShell
    // (Set-Content/Out-File -Encoding utf8) prepend one, and JSON.parse
    // rejects it — without this the signal is swallowed as a poison pill.
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as KeepaliveSignal;
    if (parsed && (parsed.kind === 'resume' || parsed.kind === 'standDown')) return parsed;
  } catch {
    // fall through to poison-pill removal
  }
  void consumeSignal(changeRoot, roleKey);
  return null;
}

/**
 * Discard a pre-existing signal that predates the current park episode.
 * Called once before the FIRST beat of an episode: a signal file whose mtime
 * is older than `STALE_SIGNAL_MS` before `now` was written for a previous
 * park (or a worker that already exited) and must not be delivered to the new
 * one. Returns true when a stale signal was consumed. Signals younger than
 * the grace window are left in place — the LEAD legitimately may write a
 * resume moments before the worker parks (no lost-wakeup).
 */
export async function discardStaleSignal(changeRoot: string, roleKey: string, now = Date.now()): Promise<boolean> {
  const file = signalFilePath(changeRoot, roleKey);
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return false;
  }
  if (now - mtimeMs <= STALE_SIGNAL_MS) return false;
  return consumeSignal(changeRoot, roleKey);
}

/**
 * Delete the signal file (consume semantics). Windows can transiently refuse
 * deletion of a just-written file (EBUSY/EPERM); retry briefly rather than
 * leaving a signal that would re-trigger on the next beat. `unlink` is
 * injectable because ESM namespace exports cannot be spied in tests.
 */
export async function consumeSignal(
  changeRoot: string,
  roleKey: string,
  unlink: (target: string) => void = fs.unlinkSync
): Promise<boolean> {
  const file = signalFilePath(changeRoot, roleKey);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      unlink(file);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return true;
      if (attempt === 2) return false;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Persistent beat state
// ---------------------------------------------------------------------------

export interface BeatState {
  beats: number;
  startedAt: string;
  maxBeats: number;
}

/**
 * Load the persisted beat state, applying the reset rules from the spec: a
 * missing/unreadable file, a changed cap, or a `startedAt` older than two
 * hours all start a fresh episode at zero beats.
 */
export function loadBeatState(changeRoot: string, roleKey: string, maxBeats: number, now = Date.now()): BeatState {
  const fresh: BeatState = { beats: 0, startedAt: new Date(now).toISOString(), maxBeats };
  let parsed: BeatState;
  try {
    parsed = JSON.parse(fs.readFileSync(beatStatePath(changeRoot, roleKey), 'utf-8')) as BeatState;
  } catch {
    return fresh;
  }
  if (
    typeof parsed?.beats !== 'number' ||
    parsed.maxBeats !== maxBeats ||
    !parsed.startedAt ||
    now - Date.parse(parsed.startedAt) > STALE_STATE_MS
  ) {
    return fresh;
  }
  return parsed;
}

export function saveBeatState(changeRoot: string, roleKey: string, state: BeatState): void {
  const file = beatStatePath(changeRoot, roleKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state), 'utf-8');
}

export function clearBeatState(changeRoot: string, roleKey: string): void {
  try {
    fs.unlinkSync(beatStatePath(changeRoot, roleKey));
  } catch {
    // absent is fine
  }
}

// ---------------------------------------------------------------------------
// Role-family caps
// ---------------------------------------------------------------------------

/**
 * Default beat cap (cli-agent-wait spec): a uniform 12 beats for every role,
 * the economic stop-loss at which a warm full rewrite (1.25x) costs the same
 * as the beats burned (12 x ~0.1x context each) — about 54 minutes of warmth
 * at the default beat length. `--max-beats` overrides per invocation.
 */
export function resolveRoleCap(_roleKey: string): number {
  return 12;
}

// ---------------------------------------------------------------------------
// Runtime detection and gate
// ---------------------------------------------------------------------------

export type AgentRuntime = 'claude' | 'codex' | 'unknown';

/**
 * Detect the hosting agent runtime from environment fingerprints.
 *
 * Priority: an explicit `RASEN_AGENT_RUNTIME` (deterministic override for
 * harnesses whose fingerprints drift) > Codex (`CODEX_SANDBOX`, set per exec
 * by codex-cli for its shell tools) > Claude Code (`CLAUDECODE`). Codex wins
 * over Claude because a codex-exec run nested under a Claude session inherits
 * `CLAUDECODE` from the parent environment. Anything else is `unknown`,
 * which the gate treats as off (fail-safe: no keepalive, current-day cost).
 */
export function detectAgentRuntime(env: NodeJS.ProcessEnv = process.env): AgentRuntime {
  const explicit = env.RASEN_AGENT_RUNTIME?.trim().toLowerCase();
  if (explicit === 'claude' || explicit === 'codex') return explicit;
  if (env.CODEX_SANDBOX && env.CODEX_SANDBOX.trim() !== '') return 'codex';
  if (env.CLAUDECODE && env.CLAUDECODE.trim() !== '') return 'claude';
  return 'unknown';
}

export interface KeepaliveConfig {
  runtimes: { claude: boolean; codex: boolean };
  contextFloor: number;
}

export const DEFAULT_KEEPALIVE_CONFIG: KeepaliveConfig = {
  runtimes: { claude: true, codex: false },
  contextFloor: DEFAULT_CONTEXT_FLOOR,
};

/** Shape of the optional `keepalive` block in the global config file. */
export interface KeepaliveConfigInput {
  runtimes?: { claude?: boolean; codex?: boolean };
  contextFloor?: number;
}

export function resolveKeepaliveConfig(input?: KeepaliveConfigInput | null): KeepaliveConfig {
  return {
    runtimes: {
      claude: input?.runtimes?.claude ?? DEFAULT_KEEPALIVE_CONFIG.runtimes.claude,
      codex: input?.runtimes?.codex ?? DEFAULT_KEEPALIVE_CONFIG.runtimes.codex,
    },
    contextFloor:
      typeof input?.contextFloor === 'number' && input.contextFloor >= 0
        ? input.contextFloor
        : DEFAULT_KEEPALIVE_CONFIG.contextFloor,
  };
}

/** True when the detected runtime is allowed to burn keepalive beats. */
export function isRuntimeGated(runtime: AgentRuntime, config: KeepaliveConfig): boolean {
  if (runtime === 'claude') return config.runtimes.claude;
  if (runtime === 'codex') return config.runtimes.codex;
  return false;
}
