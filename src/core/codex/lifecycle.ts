/**
 * Codex worker lifecycle: warm continuation, death detection, failure
 * retry classification, single-writer-per-thread discipline, and
 * cross-session warm-seed distillation.
 *
 * Builds on `codex-runtime-exec-core`'s shipped primitives (the invocation
 * builder's additive `resume` option lives in `invocation.ts`; rollout
 * reading lives in `rollout.ts`). This file holds everything specific to a
 * worker OUTLIVING one dispatch — the tier-2 layer the parity dossier's
 * solutions 02/03/04/06 live-verified against codex-cli
 * {@link CODEX_CLI_VERSION_PREMISE}.
 *
 * Pure core throughout: reads the filesystem and computes; never spawns a
 * process, sleeps, prints, or exits. The caller (the orchestration playbook)
 * owns process lifecycle and retry execution.
 */
import * as fs from 'node:fs';
import { CODEX_CLI_VERSION_PREMISE } from './codex-home.js';
import type { TurnFailedEvent } from './exec-events.js';
import type { RolloutConversation, RolloutConversationTurn, RolloutFinalAnswerRecord } from './rollout.js';

// ---------------------------------------------------------------------------
// Death detection (design D2)
// ---------------------------------------------------------------------------

export interface ThreadDeathResult {
  dead: boolean;
  /** Timestamp of the last unmatched turn-opening row, when `dead` is true. */
  lastOpenedAt?: string;
}

/**
 * Turn-boundary vocabulary this matcher accepts. Live-verified on this
 * machine (codex-cli {@link CODEX_CLI_VERSION_PREMISE}) by killing a
 * throwaway `codex exec` process mid-turn and inspecting the resulting
 * rollout JSONL directly: the real rollout event log uses ONLY the
 * `event_msg` family — `task_started` opens a turn; `task_complete` or
 * `turn_aborted` closes one (a scan of ~40 real rollouts on this machine
 * found `turn_aborted` used for both a TUI interrupt and, by the same
 * mechanism, would cover a killed process). The dotted `turn.*` names
 * (`turn.started`/`turn.completed`/`turn.failed`) were NEVER observed as
 * either a rollout `event_msg` payload type or a rollout top-level type in
 * that scan — they are exec `--json` STDOUT stream vocabulary only, a
 * different capture surface that is not persisted into the rollout file.
 *
 * Per design D2, the matcher still accepts the dotted forms defensively (an
 * older/differently-configured install, or a caller who feeds it exec-stream
 * rows instead of rollout rows, costs nothing extra to tolerate): a wrong
 * guess here degrades to "extra accepted names", never a missed real closer.
 */
const TURN_OPENER_TYPES = new Set(['task_started', 'turn.started']);
const TURN_CLOSER_TYPES = new Set([
  'task_complete',
  'turn.completed',
  'turn.failed',
  'turn_failed',
  'turn_aborted',
]);

/** Event type name(s) a row carries — top-level `type`, and/or `event_msg.payload.type`. */
function eventTypesForRow(row: Record<string, unknown>): string[] {
  const types: string[] = [];
  if (typeof row.type === 'string') types.push(row.type);
  if (row.type === 'event_msg') {
    const payload = row.payload as Record<string, unknown> | undefined;
    if (payload && typeof payload.type === 'string') types.push(payload.type);
  }
  return types;
}

function rowTimestamp(row: Record<string, unknown>): string | undefined {
  return typeof row.timestamp === 'string' ? row.timestamp : undefined;
}

/**
 * Pure death-detection logic over pre-parsed rollout rows, for testability
 * without touching the filesystem. A thread is dead-in-flight when the LAST
 * turn-opening row has no subsequent turn-closing row. A rollout with no
 * opener at all is `{ dead: false }` — idle, not dead (mirrors exec-core's
 * "no token_count = 0%, not an error" convention).
 */
export function detectDeathInRows(rows: Record<string, unknown>[]): ThreadDeathResult {
  // `isOpen` tracks whether the last-seen opener has been closed yet;
  // `openedAt` is purely the reported timestamp and must stay independent of
  // it — an opener row with no `timestamp` field is still an open turn.
  let isOpen = false;
  let openedAt: string | undefined;
  for (const row of rows) {
    const types = eventTypesForRow(row);
    if (types.some((t) => TURN_OPENER_TYPES.has(t))) {
      isOpen = true;
      openedAt = rowTimestamp(row);
    }
    if (types.some((t) => TURN_CLOSER_TYPES.has(t))) {
      isOpen = false;
      openedAt = undefined;
    }
  }
  return isOpen ? { dead: true, lastOpenedAt: openedAt } : { dead: false };
}

function readJsonlRows(filePath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
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

/**
 * Read a thread's rollout JSONL and report whether it died mid-turn. See
 * {@link detectDeathInRows} for the matching rule; malformed/blank lines are
 * skipped (design D8's tolerant-reader convention).
 */
export function detectThreadDeath(rolloutPath: string): ThreadDeathResult {
  return detectDeathInRows(readJsonlRows(rolloutPath));
}

/**
 * Named constant (per the repo's "if we generate it, track it by name" rule)
 * a caller composes into a resume message after detecting death-in-flight.
 * Encodes E02's observed loss mode directly: the killed turn's in-progress
 * command output (e.g. a `sleep 30` that never finished) is not part of the
 * restored context on resume, even though everything committed BEFORE the
 * kill survives intact. This module never auto-injects it — whether a resume
 * is a revival is the caller's knowledge, not this module's.
 */
export const CODEX_REVIVAL_NOTICE =
  'Your previous turn was interrupted before it completed. The last action in that turn may not have finished — do not trust any claim from that turn about a command outcome or file contents. Re-verify the actual file and command state before continuing.';

// ---------------------------------------------------------------------------
// Failure retry classification and backoff (design D4)
// ---------------------------------------------------------------------------

export type TurnFailureKind = 'retryable' | 'fatal' | 'unknown';

export interface TurnFailureClassification {
  kind: TurnFailureKind;
  /** Which rule matched, quoting the matched fragment — makes every verdict auditable. */
  reason: string;
}

/**
 * Ordered (first match wins), case-insensitive substring rules over a
 * `turn.failed` error message. Live-verified fragments:
 *  - retryable: E02's observed transient `429 Too Many Requests` (recovered
 *    on retry ~20s later — the failure this classifier exists to unblock);
 *  - fatal: E05's `404 Not Found: model … is not available` (will never
 *    succeed without a config change — retrying is pointless).
 * Anything else is `unknown`, deliberately NOT collapsed into `fatal`: the
 * dossier only proves these two classes, and the caller decides `unknown`
 * policy. Encoding an unproven failure as fatal would silently forbid retry
 * on e.g. a transient 500 this module has never observed.
 */
const RETRYABLE_PATTERNS = ['429', 'too many requests', 'rate limit'];
const FATAL_PATTERNS = ['404', 'not available'];

function turnFailureMessage(input: TurnFailedEvent | string): string {
  return typeof input === 'string' ? input : (input.error?.message ?? '');
}

/**
 * Classify a `turn.failed` error as retryable, fatal, or unknown. Accepts
 * either the raw error message string or the {@link TurnFailedEvent} shape
 * `exec-events.ts` produces. `reason` always quotes the matched fragment (or
 * states that nothing matched) so every verdict is auditable, not guessed.
 */
export function classifyTurnFailure(input: TurnFailedEvent | string): TurnFailureClassification {
  const message = turnFailureMessage(input);
  const lower = message.toLowerCase();

  for (const pattern of RETRYABLE_PATTERNS) {
    if (lower.includes(pattern)) {
      return { kind: 'retryable', reason: `matched "${pattern}" in: ${message}` };
    }
  }
  for (const pattern of FATAL_PATTERNS) {
    if (lower.includes(pattern)) {
      return { kind: 'fatal', reason: `matched "${pattern}" in: ${message}` };
    }
  }
  return {
    kind: 'unknown',
    reason: message ? `no retryable/fatal pattern matched: ${message}` : 'no error message to classify',
  };
}

export interface BackoffOptions {
  /** Delay for attempt 1, before doubling. Defaults to 20s (E02's observed recovery scale). */
  baseMs?: number;
  /** Delay never exceeds this cap. Defaults to 120s. */
  maxMs?: number;
}

/**
 * Deterministic (no jitter) capped exponential backoff: `baseMs * 2^(attempt-1)`,
 * capped at `maxMs`. Pure function — the caller sleeps. Attempts are numbered
 * from 1. No jitter because the LEAD retries a handful of workers, not a
 * thundering herd, and deterministic values are exactly testable (design D4).
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? 20_000;
  const maxMs = options.maxMs ?? 120_000;
  const delay = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, maxMs);
}

// ---------------------------------------------------------------------------
// Single-writer-per-thread claims (design D5)
// ---------------------------------------------------------------------------

/**
 * In-process registry enforcing "one thread id, one writer" for parallel
 * dispatch (E08 verified N-process parallelism is safe precisely because
 * threads are never shared — the untested, presumed-unsafe case is two
 * concurrent resumes of ONE thread id). Deliberately per-process only: the
 * LEAD is a single Claude session and the only dispatcher in rasen's
 * architecture today, so in-process coverage is the real concurrency
 * surface. A cross-process lock file was considered and rejected — it would
 * write outside the repo (breaking pure-core read-only discipline), leak on
 * crash (a stale lock needs a TTL policy this module has no way to enforce),
 * and defend against an architecture rasen does not have.
 *
 * OPERATOR INVARIANT (not enforced by this registry, must hold by convention):
 * a given thread id has at most one writer GLOBALLY, across every process and
 * every machine that might resume it. rasen's run-state ownership of a change
 * is already single-session by convention, so this holds today; a second LEAD
 * process resuming the same thread id is out of scope for this in-process
 * registry and would not be caught here.
 */
const threadWriterClaims = new Set<string>();

/**
 * Claim exclusive in-process write access to a thread id. Throws an
 * actionable error naming the thread id if it is already claimed. Returns a
 * release function; calling it more than once is safe (idempotent).
 */
export function claimThreadWriter(threadId: string): () => void {
  if (threadWriterClaims.has(threadId)) {
    throw new Error(
      `Thread "${threadId}" already has a writer claim in this process — two concurrent resumes of one thread id is the untested/presumed-unsafe case (E08). Release the existing claim before claiming again.`
    );
  }
  threadWriterClaims.add(threadId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    threadWriterClaims.delete(threadId);
  };
}

/** Whether a thread id currently has an in-process writer claim held. */
export function isThreadWriterClaimed(threadId: string): boolean {
  return threadWriterClaims.has(threadId);
}

// ---------------------------------------------------------------------------
// Cross-session warm seed (design D6)
// ---------------------------------------------------------------------------

export interface DistilledWarmSeed {
  turns: RolloutConversationTurn[];
  finalAnswers: RolloutFinalAnswerRecord[];
}

/**
 * Distill a rollout's reconstructed conversation into warm-seed content:
 * keep the user/assistant turns as-is; among final-answer records, DROP only
 * `agent_message` records whose `phase` is exactly `'commentary'` (an
 * intermediate progress update, not a seedable answer) — a blacklist, not a
 * whitelist on `'final_answer'`, so a record with no `phase` (a
 * `task_complete` record, or a shape-drifted `agent_message`) OR an
 * unrecognized-but-present `phase` value is kept either way. This matches
 * design D6's own risk mitigation verbatim ("distiller treats missing/
 * UNKNOWN phase as 'keep'"): a whitelist on `'final_answer'` would silently
 * drop a record whose phase drifted to some other string, which is exactly
 * the loss design D6 rules out.
 *
 * Then deduplicate exact-text repeats, but ONLY across the two SOURCES
 * (`agent_message` vs `task_complete`) — the live-verified rollout shape
 * duplicates one terminal answer across both event kinds (`agent_message`
 * phase `final_answer` AND `task_complete.last_agent_message`), and a warm
 * seed should see that pair once. Two records from the SAME source (e.g. two
 * different turns whose `agent_message` answers both happen to read "DONE")
 * are NOT deduped against each other — collapsing same-source repeats would
 * be a wider policy than design D6 states ("deduplicate exact-text repeats
 * against `task_complete` records") and would silently erase a legitimately
 * repeated answer from an unrelated turn.
 *
 * Pure function over an already-read {@link RolloutConversation}, not a file
 * reader, so a caller can compose it with either a fresh
 * `readRolloutConversation` call or an already-cached conversation.
 */
export function distillWarmSeed(conversation: RolloutConversation): DistilledWarmSeed {
  const kept: RolloutFinalAnswerRecord[] = [];
  const keptAgentMessageTexts = new Set<string>();
  const keptTaskCompleteTexts = new Set<string>();

  for (const record of conversation.finalAnswerRecords) {
    if (record.source === 'agent_message' && record.phase === 'commentary') {
      continue; // drop only commentary-phase agent messages
    }
    if (record.source === 'agent_message') {
      if (keptTaskCompleteTexts.has(record.text)) continue; // cross-source dup of an already-kept task_complete
      keptAgentMessageTexts.add(record.text);
    } else {
      if (keptAgentMessageTexts.has(record.text)) continue; // cross-source dup of an already-kept agent_message
      keptTaskCompleteTexts.add(record.text);
    }
    kept.push(record);
  }

  return { turns: conversation.turns, finalAnswers: kept };
}
