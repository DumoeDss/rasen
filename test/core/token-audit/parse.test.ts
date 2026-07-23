import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseTranscriptFile } from '../../../src/core/token-audit/parse.js';
import { TranscriptFormatError } from '../../../src/core/token-audit/errors.js';

describe('parseTranscriptFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-parse-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, lines: string[]): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
    return p;
  }

  function assistantLine(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: 'assistant',
      uuid: 'u1',
      timestamp: '2026-01-01T00:00:00.000Z',
      parentUuid: null,
      message: {
        id: 'msg-1',
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 3 },
      },
      ...overrides,
    });
  }

  it('dedupes usage by message.id, keeping the max output_tokens across duplicate lines', async () => {
    const p = write('t.jsonl', [
      JSON.stringify({
        type: 'assistant', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', parentUuid: null,
        message: { id: 'msg-1', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 3 } },
      }),
      JSON.stringify({
        type: 'assistant', uuid: 'u1b', timestamp: '2026-01-01T00:00:00.100Z', parentUuid: null,
        message: { id: 'msg-1', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 9 } },
      }),
    ]);
    const { requests } = await parseTranscriptFile({ path: p, kind: 'main' });
    expect(requests).toHaveLength(1);
    expect(requests[0].out).toBe(9);
    expect(requests[0].lastUuid).toBe('u1b');
  });

  it('counts tool_use calls and their tool_result char totals', async () => {
    const p = write('tools.jsonl', [
      JSON.stringify({
        type: 'assistant', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', parentUuid: null,
        message: {
          id: 'msg-1', model: 'claude-opus-4-8',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash' }],
          usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
        },
      }),
      JSON.stringify({
        type: 'user', uuid: 'u2', timestamp: '2026-01-01T00:00:01.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'abcde' }] },
      }),
    ]);
    const { tools } = await parseTranscriptFile({ path: p, kind: 'main' });
    expect(tools.Bash).toEqual({ calls: 1, resultChars: 5 });
  });

  it('skips a single unparseable JSON line without throwing', async () => {
    const p = write('skip.jsonl', [assistantLine(), '{ not json', '']);
    const { requests } = await parseTranscriptFile({ path: p, kind: 'main' });
    expect(requests).toHaveLength(1);
  });

  it('silently skips an assistant entry with no message.usage at all (M2: original-script parity, not format drift)', async () => {
    const p = write('no-usage.jsonl', [
      JSON.stringify({
        type: 'assistant', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', parentUuid: null,
        message: { id: 'msg-1', model: 'claude-opus-4-8', content: [] },
      }),
      assistantLine({ uuid: 'u2', message: { id: 'msg-2', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } }),
    ]);
    const { requests } = await parseTranscriptFile({ path: p, kind: 'main' });
    // The usage-free line contributes no request; parsing continues normally.
    expect(requests).toHaveLength(1);
    expect(requests[0].id).toBe('msg-2');
  });

  it('silently skips an assistant entry whose message.usage is not an object (e.g. a string)', async () => {
    const p = write('non-object-usage.jsonl', [
      JSON.stringify({
        type: 'assistant', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', parentUuid: null,
        message: { id: 'msg-1', model: 'claude-opus-4-8', content: [], usage: 'corrupted' },
      }),
    ]);
    const { requests } = await parseTranscriptFile({ path: p, kind: 'main' });
    expect(requests).toHaveLength(0);
  });

  it('throws TranscriptFormatError when a usage token field is non-numeric', async () => {
    const p = write('bad-field.jsonl', [
      JSON.stringify({
        type: 'assistant', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', parentUuid: null,
        message: {
          id: 'msg-1', model: 'claude-opus-4-8', content: [],
          usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 0, output_tokens: 'nine' },
        },
      }),
    ]);
    await expect(parseTranscriptFile({ path: p, kind: 'main' })).rejects.toThrow(TranscriptFormatError);
  });

  it('defaults an absent (undefined) usage field to 0 rather than throwing', async () => {
    const p = write('partial.jsonl', [
      JSON.stringify({
        type: 'assistant', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z', parentUuid: null,
        message: { id: 'msg-1', model: 'claude-opus-4-8', content: [], usage: { input_tokens: 10 } },
      }),
    ]);
    const { requests } = await parseTranscriptFile({ path: p, kind: 'main' });
    expect(requests[0]).toMatchObject({ in: 10, cw: 0, cr: 0, out: 0 });
  });
});
