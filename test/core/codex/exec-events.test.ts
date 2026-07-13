import { describe, expect, it } from 'vitest';
import { extractThreadId, parseExecEventStream } from '../../../src/core/codex/exec-events.js';

// Fixtures mirror docs/codex-parity/experiments captures.

// E01 baseline PONG run.
const E01_STREAM = [
  '{"type":"thread.started","thread_id":"019f5504-86db-7cf1-9b59-5cdcf0f70672"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
  '{"type":"turn.completed","usage":{"input_tokens":8053,"cached_input_tokens":7680,"output_tokens":6,"reasoning_output_tokens":0}}',
].join('\n');

// E02c kill-mid-turn tail: thread.started + turn.started with no matching turn.completed/turn.failed.
const E02_KILL_TAIL = [
  '{"type":"thread.started","thread_id":"019f5508-c42a-7e51-9f72-1ffbab60f7ea"}',
  '{"type":"turn.started"}',
].join('\n');

describe('parseExecEventStream', () => {
  it('parses the E01 baseline stream into typed events', () => {
    const events = parseExecEventStream(E01_STREAM);
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      type: 'thread.started',
      thread_id: '019f5504-86db-7cf1-9b59-5cdcf0f70672',
    });
    expect(events[1]).toEqual({ type: 'turn.started' });
    expect(events[2].type).toBe('item.completed');
    expect(events[3].type).toBe('turn.completed');
  });

  it('parses the E02 kill-mid-turn tail: thread.started followed by an unmatched turn.started', () => {
    const events = parseExecEventStream(E02_KILL_TAIL);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('thread.started');
    expect(events[1].type).toBe('turn.started');
    expect(events.some((e) => e.type === 'turn.completed' || e.type === 'turn.failed')).toBe(false);
  });

  it('passes through turn.failed events with the raw error message (E01 401, E02 429)', () => {
    const events = parseExecEventStream(
      '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized"}}'
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('turn.failed');
    expect((events[0] as { error?: { message?: string } }).error?.message).toMatch(/401/);
  });

  it('tolerates malformed and blank lines by skipping them', () => {
    const text = [
      '{"type":"thread.started","thread_id":"abc"}',
      '',
      'not json',
      '   ',
      '{"type":"turn.completed"}',
    ].join('\n');
    const events = parseExecEventStream(text);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('thread.started');
    expect(events[1].type).toBe('turn.completed');
  });

  it('passes through an unrecognized event type', () => {
    const events = parseExecEventStream('{"type":"item.started","item":{"id":"item_1"}}');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('item.started');
  });
});

describe('extractThreadId', () => {
  it('extracts the thread id from raw --json stdout text (E01)', () => {
    expect(extractThreadId(E01_STREAM)).toBe('019f5504-86db-7cf1-9b59-5cdcf0f70672');
  });

  it('extracts the thread id from already-parsed events', () => {
    const events = parseExecEventStream(E02_KILL_TAIL);
    expect(extractThreadId(events)).toBe('019f5508-c42a-7e51-9f72-1ffbab60f7ea');
  });

  it('returns undefined when no thread.started event is present', () => {
    expect(extractThreadId('{"type":"turn.started"}\n{"type":"turn.completed"}')).toBeUndefined();
  });

  it('returns undefined for an empty stream', () => {
    expect(extractThreadId('')).toBeUndefined();
  });
});
