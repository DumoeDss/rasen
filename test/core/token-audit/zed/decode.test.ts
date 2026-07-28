import { describe, expect, it } from 'vitest';

import { decodeZedThread } from '../../../../src/core/token-audit/zed/decode.js';
import { TranscriptFormatError } from '../../../../src/core/token-audit/errors.js';
import type { ZedThreadRow } from '../../../../src/core/token-audit/zed/database.js';

/** A precomputed zstd frame (base64) of a known payload — see the fixture note in decode. */
const ZSTD_BASE64 =
  'KLUv/SDXhQQAQokdHWA11gHg1lATSbb2K/E/F3vcYxgYBoXwn1AaBIFd00ZxFIaR3VsUvvGxgDFyO3vTrMEnQLzWrhBsdcDI677uLXgtWCLI+kSpnvExnCmR1ceAQ585SEwdpitLLZ9j4/MhIOtGALdYIj9RGpP74W16s6xqkYnLMggAQ8UB6zl8sEwniBZkLypZ1eQnOMwn';

function row(overrides: Partial<ZedThreadRow>): ZedThreadRow {
  return {
    id: 'thread-1',
    summary: 'Summary',
    createdAt: '2026-07-22T15:04:33Z',
    updatedAt: '2026-07-22T18:59:49Z',
    dataType: 'json',
    parentId: null,
    folderPaths: null,
    data: new Uint8Array(),
    ...overrides,
  };
}

function jsonBytes(payload: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf-8'));
}

describe('decodeZedThread', () => {
  it('extracts token totals, retained requests, model, version, and first command from a json payload', () => {
    const payload = {
      version: '0.3.0',
      model: 'claude-opus-4',
      cumulative_token_usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 },
      request_token_usage: [{}, {}, {}],
      messages: [{ Assistant: {} }, { User: { content: 'the first user command' } }, { Compaction: {} }],
    };
    const d = decodeZedThread(row({ data: jsonBytes(payload), folderPaths: JSON.stringify(['/w/proj', '/w/other']) }));
    expect(d.inputTokens).toBe(1000);
    expect(d.cachedInputTokens).toBe(5000);
    expect(d.outputTokens).toBe(200);
    expect(d.retainedRequests).toBe(3);
    expect(d.model).toBe('claude-opus-4');
    expect(d.dataVersion).toBe('0.3.0');
    expect(d.firstUserCommand).toBe('the first user command');
    expect(d.workingDir).toBe('/w/proj'); // primary folder path
    expect(d.firstTs).toBe(Date.parse('2026-07-22T15:04:33Z'));
    expect(d.lastTs).toBe(Date.parse('2026-07-22T18:59:49Z'));
  });

  it('falls back to the row summary for the title and tolerates missing optional fields', () => {
    const payload = { cumulative_token_usage: { input_tokens: 1 } };
    const d = decodeZedThread(row({ data: jsonBytes(payload), summary: 'Row Title', folderPaths: null }));
    expect(d.title).toBe('Row Title');
    expect(d.workingDir).toBeNull();
    expect(d.model).toBeNull();
    expect(d.firstUserCommand).toBeNull();
    expect(d.cachedInputTokens).toBe(0);
    expect(d.outputTokens).toBe(0);
    expect(d.retainedRequests).toBe(0);
  });

  it('decodes a zstd-compressed payload', () => {
    const d = decodeZedThread(
      row({ dataType: 'zstd', data: new Uint8Array(Buffer.from(ZSTD_BASE64, 'base64')) })
    );
    expect(d.inputTokens).toBe(7);
    expect(d.cachedInputTokens).toBe(5);
    expect(d.outputTokens).toBe(3);
    expect(d.retainedRequests).toBe(4);
    expect(d.model).toBe('m-zstd');
    expect(d.firstUserCommand).toBe('zstd hello world');
  });

  it('counts retained requests when request_token_usage is an object map', () => {
    const payload = { cumulative_token_usage: { input_tokens: 1 }, request_token_usage: { a: {}, b: {} } };
    expect(decodeZedThread(row({ data: jsonBytes(payload) })).retainedRequests).toBe(2);
  });

  it('fails soft on an unrecognized data_type', () => {
    expect(() => decodeZedThread(row({ dataType: 'brotli', data: new Uint8Array([1, 2, 3]) }))).toThrow(
      TranscriptFormatError
    );
  });

  it('fails soft on a payload with no cumulative_token_usage', () => {
    expect(() => decodeZedThread(row({ data: jsonBytes({ messages: [] }) }))).toThrow(/cumulative_token_usage/);
  });

  it('fails soft on non-JSON payload bytes', () => {
    expect(() => decodeZedThread(row({ dataType: 'json', data: new Uint8Array(Buffer.from('not json{', 'utf-8')) }))).toThrow(
      TranscriptFormatError
    );
  });

  it('returns null timestamps for a null created_at', () => {
    const d = decodeZedThread(row({ data: jsonBytes({ cumulative_token_usage: {} }), createdAt: null }));
    expect(d.firstTs).toBeNull();
  });
});
