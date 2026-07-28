/**
 * Per-thread parse of a Codex rollout (design D5) — the Codex analog of
 * Claude's message.id dedup. A rollout's `token_count` events fire on every
 * stream update; `info.total_token_usage` is a MONOTONIC CUMULATIVE
 * counter, not a per-request delta. The rule: each `token_count` event
 * whose cumulative total differs from the last-recorded value contributes
 * exactly one derived request record; an event whose cumulative total is
 * unchanged from the last recorded one is a re-emission and is skipped (the
 * Codex counterpart of a repeated `message.id` line).
 *
 * PER-REQUEST FIGURES (design D4): each `token_count` event also carries
 * `info.last_token_usage` — the harness's OWN per-request increment, present
 * on 99.6% of events (full-corpus survey). That is the PRIMARY source of a
 * derived request's token figures. When an event lacks it (older CLI
 * versions), the request's figures fall back to the cumulative-delta against
 * the previous recorded snapshot. Both are tracked: the cumulative endpoint
 * total is exposed so aggregation can cross-check the summed increments
 * against it (design D4). The first recorded event's cumulative delta is the
 * raw cumulative value itself.
 *
 * Turn boundaries come from `task_started`/`task_complete`/`turn_aborted`
 * `event_msg` rows — each derived request is attributed to whichever turn is
 * open when it is recorded. A `turn_aborted` closes the open turn and marks
 * it aborted (design D5); it carries no `turn_id`, so it closes whichever
 * turn is currently open.
 *
 * BETWEEN-REQUEST MARKERS (design D2): counts of `context_compacted`,
 * `thread_rolled_back`, and `user_message` events observed since the previous
 * derived request are attached to each request — the Codex analog of Claude's
 * `BetweenLines`, feeding cache-rebuild cause attribution.
 *
 * CONTEXT ESTIMATE (design D6, pinned against the real corpus): the
 * per-request context size is `input_tokens` from the primary source. Codex's
 * `input_tokens` is the FULL prompt size and already INCLUDES
 * `cached_input_tokens` as a subset (verified against real rollouts); adding
 * cached/cache-write would double-count, so context = `input_tokens` alone.
 *
 * Fail-soft boundary (design D3): a line that fails to parse as JSON is
 * skipped, matching the Claude-side convention. A `token_count` event
 * missing `info`/`info.total_token_usage`, or carrying a non-numeric token
 * field, IS format drift and throws {@link TranscriptFormatError}. A field a
 * given CLI version simply did not emit — a missing `last_token_usage`,
 * `model_context_window`, or a field inside a present `last_token_usage` — is
 * ABSENCE, tolerated, never drift.
 */
import * as fs from 'node:fs';

import { TranscriptFormatError } from './errors.js';

/** Counts of between-request events since the previous derived request (design D2). */
export interface CodexBetweenMarkers {
  compacted: number;
  rolledBack: number;
  userMessage: number;
}

export interface CodexDeltaRequest {
  ts: number | null;
  turnId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  /**
   * Per-request context size = `inputTokens` from the primary source (design
   * D6). Codex `input_tokens` already includes `cachedInputTokens`, so this is
   * the full prompt size, not a sum.
   */
  contextEstimate: number;
  /** True when figures came from `last_token_usage`; false when from cumulative-delta fallback. */
  fromIncrement: boolean;
  /** Between-request event markers since the previous derived request. */
  markers: CodexBetweenMarkers;
}

export interface CodexTurnBoundary {
  turnId: string;
  start: number | null;
  end: number | null;
  aborted?: boolean;
}

export interface CodexEndpointTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface ParseCodexResult {
  requests: CodexDeltaRequest[];
  turnBoundaries: CodexTurnBoundary[];
  /** Final cumulative snapshot — the endpoint for the increment cross-check (design D4). Null when no request was derived. */
  cumulativeEndpoint: CodexEndpointTotals | null;
  /** Latest-seen `info.model_context_window`, or `session_meta.context_window` fallback; null when neither present (design D6). */
  modelContextWindow: number | null;
}

interface CumulativeSnapshot {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

function readNumberField(
  obj: Record<string, unknown>,
  key: string,
  objLabel: string,
  rolloutPath: string,
  lineNumber: number
): number {
  const v = obj[key];
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number') {
    throw new TranscriptFormatError(
      `Codex token_count event's ${objLabel}.${key} is not a number`,
      rolloutPath,
      lineNumber,
      `expected a number, got ${typeof v}`
    );
  }
  return v;
}

function readSnapshot(
  usage: Record<string, unknown>,
  objLabel: string,
  rolloutPath: string,
  lineNumber: number
): CumulativeSnapshot {
  return {
    input_tokens: readNumberField(usage, 'input_tokens', objLabel, rolloutPath, lineNumber),
    cached_input_tokens: readNumberField(usage, 'cached_input_tokens', objLabel, rolloutPath, lineNumber),
    cache_write_input_tokens: readNumberField(usage, 'cache_write_input_tokens', objLabel, rolloutPath, lineNumber),
    output_tokens: readNumberField(usage, 'output_tokens', objLabel, rolloutPath, lineNumber),
    reasoning_output_tokens: readNumberField(usage, 'reasoning_output_tokens', objLabel, rolloutPath, lineNumber),
    total_tokens: readNumberField(usage, 'total_tokens', objLabel, rolloutPath, lineNumber),
  };
}

export function parseCodexRolloutFile(rolloutPath: string): ParseCodexResult {
  let content: string;
  try {
    content = fs.readFileSync(rolloutPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read Codex rollout: ${rolloutPath}`);
  }

  const requests: CodexDeltaRequest[] = [];
  const turnBoundaries: CodexTurnBoundary[] = [];
  const openTurns = new Map<string, CodexTurnBoundary>();
  let currentTurnId: string | null = null;
  let last: CumulativeSnapshot | null = null;
  let modelContextWindow: number | null = null;
  const pendingMarkers: CodexBetweenMarkers = { compacted: 0, rolledBack: 0, userMessage: 0 };

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // a single unparseable line is skipped — not format drift
    }

    if (row.type === 'session_meta') {
      // context_window is a latest-fallback source for the model window (design D6).
      const payload = row.payload as Record<string, unknown> | undefined;
      const cw = payload?.context_window;
      if (typeof cw === 'number' && modelContextWindow === null) modelContextWindow = cw;
      continue;
    }
    if (row.type !== 'event_msg') continue;
    const payload = row.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;
    const ts = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : null;

    if (payload.type === 'task_started') {
      const turnId = payload.turn_id;
      if (typeof turnId === 'string') {
        currentTurnId = turnId;
        const boundary: CodexTurnBoundary = { turnId, start: ts, end: null };
        openTurns.set(turnId, boundary);
        turnBoundaries.push(boundary);
      }
      continue;
    }
    if (payload.type === 'task_complete') {
      const turnId = payload.turn_id;
      if (typeof turnId === 'string') {
        const boundary = openTurns.get(turnId);
        if (boundary) boundary.end = ts;
        if (currentTurnId === turnId) currentTurnId = null;
      }
      continue;
    }
    if (payload.type === 'turn_aborted') {
      // No turn_id on the abort event — close whichever turn is open (design D5).
      if (currentTurnId !== null) {
        const boundary = openTurns.get(currentTurnId);
        if (boundary) {
          boundary.end = ts;
          boundary.aborted = true;
        }
        currentTurnId = null;
      }
      continue;
    }
    if (payload.type === 'context_compacted') {
      pendingMarkers.compacted++;
      continue;
    }
    if (payload.type === 'thread_rolled_back') {
      pendingMarkers.rolledBack++;
      continue;
    }
    if (payload.type === 'user_message') {
      pendingMarkers.userMessage++;
      continue;
    }
    if (payload.type !== 'token_count') continue;

    const info = payload.info as Record<string, unknown> | undefined;
    if (!info || typeof info !== 'object') {
      throw new TranscriptFormatError(
        'Codex token_count event is missing "info"',
        rolloutPath,
        lineNumber,
        'expected payload.info to be an object'
      );
    }
    if (typeof info.model_context_window === 'number') {
      modelContextWindow = info.model_context_window;
    }
    const totalUsage = info.total_token_usage as Record<string, unknown> | undefined;
    if (!totalUsage || typeof totalUsage !== 'object') {
      throw new TranscriptFormatError(
        'Codex token_count event is missing "info.total_token_usage"',
        rolloutPath,
        lineNumber,
        'expected a cumulative usage object; the harness may have changed the rollout format'
      );
    }

    const snapshot = readSnapshot(totalUsage, 'total_token_usage', rolloutPath, lineNumber);

    if (last !== null && snapshot.total_tokens === last.total_tokens) {
      continue; // re-emission of the same cumulative state — skip
    }

    // Cumulative-delta figures (fallback source + the basis of the endpoint cross-check).
    const cumulativeDelta = {
      inputTokens: snapshot.input_tokens - (last?.input_tokens ?? 0),
      cachedInputTokens: snapshot.cached_input_tokens - (last?.cached_input_tokens ?? 0),
      cacheWriteInputTokens: snapshot.cache_write_input_tokens - (last?.cache_write_input_tokens ?? 0),
      outputTokens: snapshot.output_tokens - (last?.output_tokens ?? 0),
      reasoningOutputTokens: snapshot.reasoning_output_tokens - (last?.reasoning_output_tokens ?? 0),
      totalTokens: snapshot.total_tokens - (last?.total_tokens ?? 0),
    };

    // last_token_usage is PRIMARY when present (design D4); absence => fallback, no drift.
    const lastUsage = info.last_token_usage;
    let figures = cumulativeDelta;
    let fromIncrement = false;
    if (lastUsage && typeof lastUsage === 'object') {
      const inc = readSnapshot(lastUsage as Record<string, unknown>, 'last_token_usage', rolloutPath, lineNumber);
      figures = {
        inputTokens: inc.input_tokens,
        cachedInputTokens: inc.cached_input_tokens,
        cacheWriteInputTokens: inc.cache_write_input_tokens,
        outputTokens: inc.output_tokens,
        reasoningOutputTokens: inc.reasoning_output_tokens,
        totalTokens: inc.total_tokens,
      };
      fromIncrement = true;
    }

    requests.push({
      ts,
      turnId: currentTurnId,
      inputTokens: figures.inputTokens,
      cachedInputTokens: figures.cachedInputTokens,
      cacheWriteInputTokens: figures.cacheWriteInputTokens,
      outputTokens: figures.outputTokens,
      reasoningOutputTokens: figures.reasoningOutputTokens,
      totalTokens: figures.totalTokens,
      contextEstimate: figures.inputTokens,
      fromIncrement,
      markers: { ...pendingMarkers },
    });
    pendingMarkers.compacted = 0;
    pendingMarkers.rolledBack = 0;
    pendingMarkers.userMessage = 0;
    last = snapshot;
  }

  const cumulativeEndpoint: CodexEndpointTotals | null =
    last === null
      ? null
      : {
          inputTokens: last.input_tokens,
          cachedInputTokens: last.cached_input_tokens,
          cacheWriteInputTokens: last.cache_write_input_tokens,
          outputTokens: last.output_tokens,
          reasoningOutputTokens: last.reasoning_output_tokens,
          totalTokens: last.total_tokens,
        };

  return { requests, turnBoundaries, cumulativeEndpoint, modelContextWindow };
}
