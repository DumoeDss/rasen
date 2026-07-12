/**
 * `codex exec --json` event-stream parsing.
 *
 * `codex exec --json` prints one JSON object per line to stdout: `thread.started`
 * (carries the durable `thread_id`), `turn.started`/`turn.completed`/`turn.failed`
 * (bare — exec-mode gives no turn id, docs/codex-parity/solutions/14), and
 * `item.*` (streamed agent output). This reader is tolerant, line-oriented, and
 * skips malformed lines — same discipline as `computeContextFromTranscript`
 * (`src/core/agent-context.ts`) — because a truncated stream from a killed
 * process (E02) is a real, expected input, not corruption.
 *
 * Pinned to codex-cli {@link CODEX_CLI_VERSION_PREMISE}; event shapes may
 * drift on a newer CLI (design D11).
 */
import { CODEX_CLI_VERSION_PREMISE } from './codex-home.js';

export interface ThreadStartedEvent {
  type: 'thread.started';
  thread_id: string;
}

export interface TurnStartedEvent {
  type: 'turn.started';
}

export interface TurnCompletedEvent {
  type: 'turn.completed';
  usage?: Record<string, unknown>;
}

export interface TurnFailedEvent {
  type: 'turn.failed';
  /** Raw error payload — this module does not decide retryability (design D8). */
  error?: { message?: string; [key: string]: unknown };
}

export interface ItemEvent {
  type: `item.${string}`;
  item?: { id?: string; type?: string; text?: string; [key: string]: unknown };
}

/** Any event whose `type` did not match a known shape above. */
export interface UnknownExecEvent {
  type: string;
  [key: string]: unknown;
}

export type CodexExecEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | ItemEvent
  | UnknownExecEvent;

function classifyEvent(raw: Record<string, unknown>): CodexExecEvent {
  const type = raw.type;
  if (typeof type !== 'string') {
    // Spread first, then set `type` — spreading after would let a non-string
    // `raw.type` (e.g. a number) override the literal and violate
    // `UnknownExecEvent.type: string`.
    return { ...raw, type: 'unknown' } as UnknownExecEvent;
  }
  // Pass the parsed object through as-is; the `type` discriminant is enough
  // for callers to narrow via TypeScript without a copy per branch.
  return raw as unknown as CodexExecEvent;
}

/**
 * Parse `codex exec --json` stdout (JSONL) into typed events. Malformed or
 * blank lines are skipped rather than throwing — a truncated stream from a
 * killed process is expected input (E02's kill-mid-turn capture).
 */
export function parseExecEventStream(text: string): CodexExecEvent[] {
  const events: CodexExecEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    events.push(classifyEvent(parsed as Record<string, unknown>));
  }
  return events;
}

/**
 * Extract the `thread_id` from a `thread.started` event, accepting either
 * already-parsed events or raw `--json` stdout text. Returns undefined when
 * no `thread.started` event is present — the caller must report the id as
 * absent rather than inventing one.
 */
export function extractThreadId(input: CodexExecEvent[] | string): string | undefined {
  const events = typeof input === 'string' ? parseExecEventStream(input) : input;
  for (const event of events) {
    if (event.type === 'thread.started' && typeof (event as ThreadStartedEvent).thread_id === 'string') {
      return (event as ThreadStartedEvent).thread_id;
    }
  }
  return undefined;
}
