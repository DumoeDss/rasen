import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseCodexRolloutFile } from '../../../../src/core/token-audit/parse-codex.js';
import { TranscriptFormatError } from '../../../../src/core/token-audit/errors.js';

/** token_count with both cumulative and per-request increment (the modern shape). */
function tokenCountFull(
  total: Record<string, number>,
  last: Record<string, number>,
  opts: { window?: number; ts?: string } = {}
): string {
  const info: Record<string, unknown> = { total_token_usage: total, last_token_usage: last };
  if (opts.window !== undefined) info.model_context_window = opts.window;
  return JSON.stringify({
    timestamp: opts.ts ?? '2026-01-01T00:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info },
  });
}

/** token_count with only the cumulative counter (old-CLI shape, no last_token_usage/window). */
function tokenCountCumulativeOnly(total: Record<string, number>, ts = '2026-01-01T00:00:00.000Z'): string {
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: total } },
  });
}

function ev(type: string, extra: Record<string, unknown> = {}, ts = '2026-01-01T00:00:00.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type, ...extra } });
}

function sessionMeta(payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload });
}

describe('parseCodexRolloutFile — enrichment (last_token_usage / window / markers / aborted)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-codex-enrich-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  function write(name: string, lines: string[]): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
    return p;
  }

  it('uses last_token_usage as the primary per-request figure when present', () => {
    // Cumulative delta would say input 2000; the increment says 900. Increment wins.
    const p = write('inc.jsonl', [
      tokenCountFull(
        { input_tokens: 1100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1150 },
        { input_tokens: 1100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1150 }
      ),
      tokenCountFull(
        { input_tokens: 3100, cached_input_tokens: 900, cache_write_input_tokens: 0, output_tokens: 120, reasoning_output_tokens: 0, total_tokens: 3220 },
        { input_tokens: 900, cached_input_tokens: 850, cache_write_input_tokens: 0, output_tokens: 70, reasoning_output_tokens: 0, total_tokens: 970 }
      ),
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests).toHaveLength(2);
    expect(requests[0].fromIncrement).toBe(true);
    expect(requests[1]).toMatchObject({ inputTokens: 900, cachedInputTokens: 850, outputTokens: 70, fromIncrement: true });
    // contextEstimate = inputTokens of the primary source (not summed with cached).
    expect(requests[1].contextEstimate).toBe(900);
  });

  it('falls back to cumulative-delta when last_token_usage is absent (old CLI), no error', () => {
    const p = write('fallback.jsonl', [
      tokenCountCumulativeOnly({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1050 }),
      tokenCountCumulativeOnly({ input_tokens: 1600, cached_input_tokens: 200, output_tokens: 90, reasoning_output_tokens: 0, total_tokens: 1690 }),
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ inputTokens: 600, cachedInputTokens: 200, outputTokens: 40, fromIncrement: false });
  });

  it('handles a single file MIXING increment-bearing and increment-less events (primary vs fallback per event)', () => {
    const p = write('mixed.jsonl', [
      // ev1: has increment => primary
      tokenCountFull(
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 },
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 }
      ),
      // ev2: NO increment (old CLI) => cumulative-delta fallback against ev1's snapshot
      tokenCountCumulativeOnly({ input_tokens: 2000, cached_input_tokens: 0, output_tokens: 25, reasoning_output_tokens: 0, total_tokens: 2035 }),
      // ev3: has increment again => primary, independent of the fallback in between
      tokenCountFull(
        { input_tokens: 3500, cached_input_tokens: 100, output_tokens: 60, reasoning_output_tokens: 0, total_tokens: 3660 },
        { input_tokens: 900, cached_input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1020 }
      ),
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests.map((r) => r.fromIncrement)).toEqual([true, false, true]);
    expect(requests[0].inputTokens).toBe(1000); // increment
    expect(requests[1].inputTokens).toBe(1000); // cumulative delta 2000-1000, snapshot tracked through ev1
    expect(requests[2].inputTokens).toBe(900); // increment again
  });

  it('captures model_context_window from token_count events', () => {
    const p = write('win.jsonl', [
      tokenCountFull(
        { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 },
        { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 },
        { window: 258400 }
      ),
    ]);
    expect(parseCodexRolloutFile(p).modelContextWindow).toBe(258400);
  });

  it('falls back to session_meta.context_window for the window when token_count carries none', () => {
    const p = write('metawin.jsonl', [
      sessionMeta({ session_id: 's1', context_window: 128000 }),
      tokenCountCumulativeOnly({ input_tokens: 100, total_tokens: 100 }),
    ]);
    expect(parseCodexRolloutFile(p).modelContextWindow).toBe(128000);
  });

  it('records between-request markers (compacted / rolled_back / user_message) on the following request', () => {
    const p = write('markers.jsonl', [
      tokenCountFull(
        { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1020 },
        { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1020 }
      ),
      ev('context_compacted'),
      ev('user_message', { message: 'go on' }),
      tokenCountFull(
        { input_tokens: 1200, cached_input_tokens: 50, output_tokens: 40, reasoning_output_tokens: 0, total_tokens: 1240 },
        { input_tokens: 200, cached_input_tokens: 50, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 220 }
      ),
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests[0].markers).toEqual({ compacted: 0, rolledBack: 0, userMessage: 0 });
    expect(requests[1].markers).toEqual({ compacted: 1, rolledBack: 0, userMessage: 1 });
  });

  it('closes and marks the open turn on turn_aborted', () => {
    const p = write('aborted.jsonl', [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } }),
      tokenCountCumulativeOnly({ input_tokens: 100, total_tokens: 100 }, '2026-01-01T00:00:01.000Z'),
      ev('turn_aborted', { reason: 'interrupted' }, '2026-01-01T00:00:05.000Z'),
    ]);
    const { requests, turnBoundaries } = parseCodexRolloutFile(p);
    expect(requests[0].turnId).toBe('t1');
    expect(turnBoundaries).toHaveLength(1);
    expect(turnBoundaries[0]).toMatchObject({ turnId: 't1', end: Date.parse('2026-01-01T00:00:05.000Z'), aborted: true });
  });

  it('exposes the cumulative endpoint totals for the cross-check', () => {
    const p = write('endpoint.jsonl', [
      tokenCountFull(
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1050 },
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 1050 }
      ),
      tokenCountFull(
        { input_tokens: 2500, cached_input_tokens: 100, output_tokens: 90, reasoning_output_tokens: 0, total_tokens: 2590 },
        { input_tokens: 1500, cached_input_tokens: 100, output_tokens: 40, reasoning_output_tokens: 0, total_tokens: 1640 }
      ),
    ]);
    expect(parseCodexRolloutFile(p).cumulativeEndpoint).toMatchObject({ inputTokens: 2500, totalTokens: 2590 });
  });

  it('parses an all-absent old-format rollout (no last_token_usage, no window) without error', () => {
    const p = write('old.jsonl', [
      tokenCountCumulativeOnly({ input_tokens: 500, total_tokens: 500 }),
      tokenCountCumulativeOnly({ input_tokens: 900, total_tokens: 900 }),
    ]);
    const res = parseCodexRolloutFile(p);
    expect(res.requests).toHaveLength(2);
    expect(res.requests.every((r) => r.fromIncrement === false)).toBe(true);
    expect(res.modelContextWindow).toBeNull();
  });

  it('throws TranscriptFormatError when a last_token_usage field is non-numeric (drift, not absence)', () => {
    const p = write('drift.jsonl', [
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 10, total_tokens: 10 },
            last_token_usage: { input_tokens: 10, total_tokens: 'ten' },
          },
        },
      }),
    ]);
    expect(() => parseCodexRolloutFile(p)).toThrow(TranscriptFormatError);
  });
});
