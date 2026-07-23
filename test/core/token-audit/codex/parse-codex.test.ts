import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseCodexRolloutFile } from '../../../../src/core/token-audit/parse-codex.js';
import { TranscriptFormatError } from '../../../../src/core/token-audit/errors.js';

function tokenCount(usage: Record<string, number>): string {
  return JSON.stringify({
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: usage, model_context_window: 300_000 } },
  });
}

function taskStarted(turnId: string, ts = '2026-01-01T00:00:00.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } });
}

function taskComplete(turnId: string, ts = '2026-01-01T00:00:10.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } });
}

describe('parseCodexRolloutFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-codex-parse-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, lines: string[]): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
    return p;
  }

  it("derives the first request's delta as the raw cumulative snapshot", () => {
    const p = write('r1.jsonl', [
      taskStarted('t1'),
      tokenCount({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1260 }),
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      inputTokens: 1000, cachedInputTokens: 200, cacheWriteInputTokens: 0,
      outputTokens: 50, reasoningOutputTokens: 10, totalTokens: 1260, turnId: 't1',
    });
  });

  it('skips a re-emission whose cumulative total is unchanged from the last recorded value', () => {
    const p = write('r2.jsonl', [
      taskStarted('t1'),
      tokenCount({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1260 }),
      tokenCount({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1260 }), // re-emission
      tokenCount({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1260 }), // re-emission
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests).toHaveLength(1);
  });

  it('computes a second request as the delta against the previous cumulative snapshot', () => {
    const p = write('r3.jsonl', [
      taskStarted('t1'),
      tokenCount({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 50, reasoning_output_tokens: 10, total_tokens: 1260 }),
      taskComplete('t1'),
      taskStarted('t2'),
      tokenCount({ input_tokens: 1500, cached_input_tokens: 300, output_tokens: 80, reasoning_output_tokens: 15, total_tokens: 1895 }),
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      inputTokens: 500, cachedInputTokens: 100, outputTokens: 30, reasoningOutputTokens: 5, totalTokens: 635, turnId: 't2',
    });
  });

  it('attributes requests to the turn open at the time they were recorded, via task_started/task_complete boundaries', () => {
    const p = write('turns.jsonl', [
      taskStarted('t1', '2026-01-01T00:00:00.000Z'),
      tokenCount({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 }),
      taskComplete('t1', '2026-01-01T00:00:05.000Z'),
      taskStarted('t2', '2026-01-01T00:00:10.000Z'),
      tokenCount({ input_tokens: 200, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 210 }),
      taskComplete('t2', '2026-01-01T00:00:15.000Z'),
    ]);
    const { requests, turnBoundaries } = parseCodexRolloutFile(p);
    expect(requests.map((r) => r.turnId)).toEqual(['t1', 't2']);
    expect(turnBoundaries).toEqual([
      { turnId: 't1', start: Date.parse('2026-01-01T00:00:00.000Z'), end: Date.parse('2026-01-01T00:00:05.000Z') },
      { turnId: 't2', start: Date.parse('2026-01-01T00:00:10.000Z'), end: Date.parse('2026-01-01T00:00:15.000Z') },
    ]);
  });

  it('skips a single unparseable JSON line without throwing', () => {
    const p = write('skip.jsonl', [
      taskStarted('t1'),
      tokenCount({ input_tokens: 10, total_tokens: 10 }),
      '{ not json',
    ]);
    const { requests } = parseCodexRolloutFile(p);
    expect(requests).toHaveLength(1);
  });

  it('throws TranscriptFormatError when a token_count event is missing info.total_token_usage', () => {
    const p = write('missing.jsonl', [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000 } } }),
    ]);
    expect(() => parseCodexRolloutFile(p)).toThrow(TranscriptFormatError);
  });

  it('throws TranscriptFormatError when a total_token_usage field is non-numeric', () => {
    const p = write('nonnum.jsonl', [
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, total_tokens: 'fifteen' } } },
      }),
    ]);
    expect(() => parseCodexRolloutFile(p)).toThrow(TranscriptFormatError);
  });
});
