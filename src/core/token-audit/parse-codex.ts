/**
 * Per-thread parse of a Codex rollout (design D5) — the Codex analog of
 * Claude's message.id dedup. A rollout's `token_count` events fire on every
 * stream update; `info.total_token_usage` is a MONOTONIC CUMULATIVE
 * counter, not a per-request delta. The rule: each `token_count` event
 * whose cumulative total differs from the last-recorded value contributes
 * exactly one derived request record, with per-field deltas computed
 * against the previous recorded cumulative snapshot; an event whose
 * cumulative total is unchanged from the last recorded one is a
 * re-emission and is skipped (the Codex counterpart of a repeated
 * `message.id` line). The first recorded event's delta is the raw
 * cumulative value itself.
 *
 * Turn boundaries come from `task_started`/`task_complete` `event_msg` rows
 * (each carrying `turn_id`) — each derived request is attributed to
 * whichever turn is open when it is recorded.
 *
 * Fail-soft boundary (design D3): a line that fails to parse as JSON is
 * skipped, matching the Claude-side convention. A `token_count` event
 * missing `info`/`info.total_token_usage`, or carrying a non-numeric token
 * field, IS format drift and throws {@link TranscriptFormatError}.
 */
import * as fs from 'node:fs';

import { TranscriptFormatError } from './errors.js';

export interface CodexDeltaRequest {
  ts: number | null;
  turnId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexTurnBoundary {
  turnId: string;
  start: number | null;
  end: number | null;
}

export interface ParseCodexResult {
  requests: CodexDeltaRequest[];
  turnBoundaries: CodexTurnBoundary[];
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
  rolloutPath: string,
  lineNumber: number
): number {
  const v = obj[key];
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number') {
    throw new TranscriptFormatError(
      `Codex token_count event's total_token_usage.${key} is not a number`,
      rolloutPath,
      lineNumber,
      `expected a number, got ${typeof v}`
    );
  }
  return v;
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
    const totalUsage = info.total_token_usage as Record<string, unknown> | undefined;
    if (!totalUsage || typeof totalUsage !== 'object') {
      throw new TranscriptFormatError(
        'Codex token_count event is missing "info.total_token_usage"',
        rolloutPath,
        lineNumber,
        'expected a cumulative usage object; the harness may have changed the rollout format'
      );
    }

    const snapshot: CumulativeSnapshot = {
      input_tokens: readNumberField(totalUsage, 'input_tokens', rolloutPath, lineNumber),
      cached_input_tokens: readNumberField(totalUsage, 'cached_input_tokens', rolloutPath, lineNumber),
      cache_write_input_tokens: readNumberField(totalUsage, 'cache_write_input_tokens', rolloutPath, lineNumber),
      output_tokens: readNumberField(totalUsage, 'output_tokens', rolloutPath, lineNumber),
      reasoning_output_tokens: readNumberField(totalUsage, 'reasoning_output_tokens', rolloutPath, lineNumber),
      total_tokens: readNumberField(totalUsage, 'total_tokens', rolloutPath, lineNumber),
    };

    if (last !== null && snapshot.total_tokens === last.total_tokens) {
      continue; // re-emission of the same cumulative state — skip
    }

    requests.push({
      ts,
      turnId: currentTurnId,
      inputTokens: snapshot.input_tokens - (last?.input_tokens ?? 0),
      cachedInputTokens: snapshot.cached_input_tokens - (last?.cached_input_tokens ?? 0),
      cacheWriteInputTokens: snapshot.cache_write_input_tokens - (last?.cache_write_input_tokens ?? 0),
      outputTokens: snapshot.output_tokens - (last?.output_tokens ?? 0),
      reasoningOutputTokens: snapshot.reasoning_output_tokens - (last?.reasoning_output_tokens ?? 0),
      totalTokens: snapshot.total_tokens - (last?.total_tokens ?? 0),
    });
    last = snapshot;
  }

  return { requests, turnBoundaries };
}
