/**
 * Rollout JSONL location and parsing.
 *
 * Every `codex exec` thread persists to `~/.codex/sessions/<Y>/<M>/<D>/rollout-
 * <ISO-ts>-<threadId>.jsonl` (respecting `CODEX_HOME`). This module locates
 * that file from a thread id, then reads two things out of it: context
 * occupancy (from `token_count` events, which carry the model context window
 * inline — no external model-to-window lookup needed) and a reconstructed
 * conversation for cross-session warm seeding
 * (`docs/codex-parity/experiments/E03`, `solutions/06`). Readers tolerate
 * malformed/unknown lines by skipping them, matching the rest of this module
 * (design D8) — a truncated file from a killed process (E02) is expected
 * input, not corruption.
 *
 * Pinned to codex-cli {@link CODEX_CLI_VERSION_PREMISE}.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODEX_CLI_VERSION_PREMISE, resolveCodexHome } from './codex-home.js';

export interface FindRolloutPathOptions {
  /** Defaults to {@link resolveCodexHome}. */
  codexHome?: string;
  /** The thread's creation time, if known — enables the deterministic path. */
  timestamp?: Date;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `sessions/<YYYY>/<MM>/<DD>/rollout-<YYYY-MM-DDTHH-mm-ss>-<threadId>.jsonl`,
 * LOCAL-time-based. codex-cli names rollout files (and their date directory)
 * in the machine's local time, not UTC — confirmed by live inspection of a
 * real rollout on this machine: file `.../2026/07/12/rollout-2026-07-12T14-
 * 57-17-....jsonl` has a first-row `timestamp` of `2026-07-12T06:57:17.275Z`
 * (UTC+8 skew), and E01 shows the same offset. Since the reader and the codex
 * process that wrote the file share a machine, local-to-local comparison is
 * the correct match.
 */
function deterministicRolloutPath(sessionsDir: string, threadId: string, timestamp: Date): string {
  const year = String(timestamp.getFullYear());
  const month = pad2(timestamp.getMonth() + 1);
  const day = pad2(timestamp.getDate());
  const ts = `${year}-${month}-${day}T${pad2(timestamp.getHours())}-${pad2(timestamp.getMinutes())}-${pad2(timestamp.getSeconds())}`;
  return path.join(sessionsDir, year, month, day, `rollout-${ts}-${threadId}.jsonl`);
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function newestMatch(matches: Array<{ path: string; mtimeMs: number }>): string | undefined {
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0].path;
}

/** A rollout file found by {@link listRolloutFiles}, with its mtime for newest-first sorting. */
export interface RolloutFileEntry {
  path: string;
  mtimeMs: number;
}

/**
 * Bounded scan of the fixed-depth `sessions/<Y>/<M>/<D>/` tree, collecting
 * every `rollout-*.jsonl`-named file (codex-cli's own naming convention, the
 * same one `findRolloutPath` builds paths from). Bounded by the tree's fixed
 * three-level structure — no unbounded recursion. Tolerant `safeReadDir`/stat
 * semantics: unreadable directories yield no entries, a file that disappears
 * between readdir and stat is skipped (design D8). Unsorted — callers order
 * as needed (e.g. newest-first).
 */
export function listRolloutFiles(sessionsDir: string): RolloutFileEntry[] {
  const found: RolloutFileEntry[] = [];
  for (const yearEntry of safeReadDir(sessionsDir)) {
    if (!yearEntry.isDirectory()) continue;
    const yearDir = path.join(sessionsDir, yearEntry.name);
    for (const monthEntry of safeReadDir(yearDir)) {
      if (!monthEntry.isDirectory()) continue;
      const monthDir = path.join(yearDir, monthEntry.name);
      for (const dayEntry of safeReadDir(monthDir)) {
        if (!dayEntry.isDirectory()) continue;
        const dayDir = path.join(monthDir, dayEntry.name);
        for (const fileEntry of safeReadDir(dayDir)) {
          if (!fileEntry.isFile()) continue;
          if (!fileEntry.name.startsWith('rollout-')) continue;
          if (!fileEntry.name.endsWith('.jsonl')) continue;
          const full = path.join(dayDir, fileEntry.name);
          try {
            found.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
          } catch {
            // File disappeared between readdir and stat; skip.
          }
        }
      }
    }
  }
  return found;
}

/**
 * Bounded newest-first scan of the fixed-depth `sessions/<Y>/<M>/<D>/` tree
 * for a file whose name contains `threadId`, built on {@link listRolloutFiles}.
 */
function scanForRollout(sessionsDir: string, threadId: string): string | undefined {
  const matches = listRolloutFiles(sessionsDir).filter((entry) =>
    path.basename(entry.path).includes(threadId)
  );
  return newestMatch(matches);
}

/**
 * Flat-directory newest-first scan of `<codexHome>/archived_sessions/` for a
 * file whose name contains `threadId` — live-verified layout: unlike the
 * dated `sessions/<Y>/<M>/<D>/` tree, archived rollouts sit directly in one
 * flat directory (`docs/codex-parity/solutions/06`; confirmed on this
 * machine: `~/.codex/archived_sessions/rollout-<ts>-<id>.jsonl`).
 */
function scanArchivedSessions(codexHome: string, threadId: string): string | undefined {
  const archivedDir = path.join(codexHome, 'archived_sessions');
  const matches: Array<{ path: string; mtimeMs: number }> = [];
  for (const fileEntry of safeReadDir(archivedDir)) {
    if (!fileEntry.isFile()) continue;
    if (!fileEntry.name.endsWith('.jsonl')) continue;
    if (!fileEntry.name.includes(threadId)) continue;
    const full = path.join(archivedDir, fileEntry.name);
    try {
      matches.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
    } catch {
      // File disappeared between readdir and stat; skip.
    }
  }
  return newestMatch(matches);
}

/**
 * Locate a thread's rollout JSONL. Tries the deterministic dated path when a
 * creation timestamp is known, then a bounded newest-first scan of the active
 * sessions tree, then a flat-directory scan of `archived_sessions/` (a
 * rollout moved there by `codex archive`/`codex delete` per
 * `docs/codex-parity/solutions/06`), then reports absence explicitly (never
 * invents a path). All paths are built with {@link path.join}.
 */
export function findRolloutPath(threadId: string, options: FindRolloutPathOptions = {}): string | undefined {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const sessionsDir = path.join(codexHome, 'sessions');

  if (options.timestamp) {
    const deterministic = deterministicRolloutPath(sessionsDir, threadId, options.timestamp);
    if (fs.existsSync(deterministic)) return deterministic;
  }

  const active = scanForRollout(sessionsDir, threadId);
  if (active) return active;

  return scanArchivedSessions(codexHome, threadId);
}

/**
 * Parsed first line of a candidate rollout, or `undefined` when
 * unreadable/malformed/not `session_meta`. Shared by `agent-context.ts`'s
 * `findLatestRollout` (cwd/non-forked filtering) and
 * `src/core/token-audit/discover-codex.ts`'s subagent-family BFS
 * (`parent_thread_id` chain) — the one implementation of "read a rollout's
 * session_meta first line" (design D5, relocated from `agent-context.ts`'s
 * private `readSessionMeta`, behavior unchanged).
 */
export function readRolloutSessionMeta(rolloutPath: string): Record<string, unknown> | undefined {
  let content: string;
  try {
    content = fs.readFileSync(rolloutPath, 'utf-8');
  } catch {
    return undefined;
  }
  let firstLine: string | undefined;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      firstLine = trimmed;
      break;
    }
  }
  if (!firstLine) return undefined;
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (row.type !== 'session_meta') return undefined;
  const payload = row.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return payload as Record<string, unknown>;
}

function readJsonlLines(rolloutPath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(rolloutPath, 'utf-8');
  const rows: Record<string, unknown>[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      rows.push(parsed as Record<string, unknown>);
    }
  }
  return rows;
}

export interface RolloutOccupancy {
  totalTokens: number;
  modelContextWindow: number;
  /** totalTokens / modelContextWindow. */
  pct: number;
}

/**
 * Read context occupancy from a rollout's LAST `token_count` event
 * (`docs/codex-parity/experiments/E03`: `.payload.info.total_token_usage.total_tokens`
 * and `.payload.info.model_context_window`). Returns `null` when the rollout
 * has no `token_count` line yet — a normal "zero completed turns" signal, NOT
 * an error (design D8).
 */
export function readRolloutOccupancy(rolloutPath: string): RolloutOccupancy | null {
  const rows = readJsonlLines(rolloutPath);
  let last: RolloutOccupancy | null = null;
  for (const row of rows) {
    if (row.type !== 'event_msg') continue;
    const payload = row.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== 'token_count') continue;
    const info = payload.info as Record<string, unknown> | undefined;
    const totalUsage = info?.total_token_usage as Record<string, unknown> | undefined;
    const totalTokens = totalUsage?.total_tokens;
    const modelContextWindow = info?.model_context_window;
    if (typeof totalTokens === 'number' && typeof modelContextWindow === 'number') {
      last = {
        totalTokens,
        modelContextWindow,
        pct: modelContextWindow > 0 ? totalTokens / modelContextWindow : 0,
      };
    }
  }
  return last;
}

export interface RolloutConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * A single final-answer record with source/phase metadata, alongside the
 * plain-string `finalAnswers` array (design D6 — additive, existing field
 * unchanged). `phase` is read from the live-verified `agent_message` payload
 * field (`"commentary" | "final_answer"`, observed emitted once per
 * intermediate update AND once for the terminal answer); `task_complete`
 * records carry no phase — codex-runtime-lifecycle's `distillWarmSeed` uses
 * that absence as its "keep, missing metadata degrades to keep" signal.
 */
export interface RolloutFinalAnswerRecord {
  text: string;
  source: 'agent_message' | 'task_complete';
  phase?: string;
}

export interface RolloutConversation {
  /** Ordered user/assistant turns; developer-role scaffolding is omitted. */
  turns: RolloutConversationTurn[];
  /** `task_complete`/`agent_message` payload text, in file order. */
  finalAnswers: string[];
  /** Same records as `finalAnswers`, with source/phase metadata (design D6). */
  finalAnswerRecords: RolloutFinalAnswerRecord[];
  /** `turn_id`s from `task_started`/`task_complete` `event_msg` payloads, in file order. */
  turnIds: string[];
}

/**
 * Best-effort text extraction from a `response_item` message payload's
 * `content` (live-verified shape: `{"type":"message","role":...,"content":
 * [{"type":"input_text"|"output_text","text":"..."}]}`). Also accepts a plain
 * string `content` or a top-level `text` field for robustness against minor
 * shape drift; returns an empty string (never throws) for anything else, so
 * an unrecognized shape degrades to "no text" rather than crashing the reader
 * (design D8).
 */
function extractMessageText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined))
      .filter((text): text is string => typeof text === 'string')
      .join('');
  }
  if (typeof payload.text === 'string') return payload.text;
  return '';
}

/**
 * Reconstruct a rollout's conversation for warm seeding: ordered user/
 * assistant `response_item` turns (developer scaffolding skipped),
 * `task_complete`/`agent_message` final answers, and `turn_id`s from
 * `task_started`/`task_complete` payloads (`docs/codex-parity/solutions/06`).
 *
 * `response_item` rows nest their `role`/`content` under `payload` (live-
 * verified: `{"type":"response_item","payload":{"type":"message","role":
 * "user","content":[...]}}` — the dossier never showed a raw row, so this was
 * initially guessed flat and wrong; fixed against a real captured rollout). A
 * top-level fallback is kept for robustness against a differently-shaped row.
 */
export function readRolloutConversation(rolloutPath: string): RolloutConversation {
  const rows = readJsonlLines(rolloutPath);
  const turns: RolloutConversationTurn[] = [];
  const finalAnswers: string[] = [];
  const finalAnswerRecords: RolloutFinalAnswerRecord[] = [];
  const turnIds: string[] = [];

  for (const row of rows) {
    if (row.type === 'response_item') {
      const payload = (row.payload as Record<string, unknown> | undefined) ?? row;
      const role = payload.role;
      if (role === 'user' || role === 'assistant') {
        turns.push({ role, text: extractMessageText(payload) });
      }
      continue;
    }
    if (row.type === 'event_msg') {
      const payload = row.payload as Record<string, unknown> | undefined;
      if (!payload) continue;
      if (payload.type === 'task_complete') {
        // task_complete carries the final answer as `last_agent_message`
        // (live-verified); it may be null when the turn ended without one.
        const text = payload.last_agent_message;
        if (typeof text === 'string') {
          finalAnswers.push(text);
          finalAnswerRecords.push({ text, source: 'task_complete' });
        }
      } else if (payload.type === 'agent_message') {
        // agent_message carries its text as `message` and a `phase` field
        // (`"commentary" | "final_answer"`, live-verified).
        const text = payload.message;
        if (typeof text === 'string') {
          finalAnswers.push(text);
          const phase = payload.phase;
          finalAnswerRecords.push({
            text,
            source: 'agent_message',
            ...(typeof phase === 'string' ? { phase } : {}),
          });
        }
      }
      if (payload.type === 'task_started' || payload.type === 'task_complete') {
        const turnId = payload.turn_id;
        if (typeof turnId === 'string') turnIds.push(turnId);
      }
    }
  }

  return { turns, finalAnswers, finalAnswerRecords, turnIds };
}
