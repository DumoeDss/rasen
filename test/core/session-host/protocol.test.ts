import { describe, expect, it } from 'vitest';

import {
  BoundedNdjsonDecoder,
  reduceBackendTurnEvents,
} from '../../../src/core/session-host/protocol.js';

describe('hosted Session stream protocol', () => {
  it('decodes multibyte NDJSON split at every byte boundary', () => {
    const decoder = new BoundedNdjsonDecoder({ maxLineBytes: 1024, maxOutputBytes: 4096 });
    const bytes = Buffer.from(
      '{"type":"init","sessionId":"backend-1"}\n{"type":"result","sessionId":"backend-1","content":"你好"}\n',
      'utf8'
    );

    const values: unknown[] = [];
    for (const byte of bytes) values.push(...decoder.push(Buffer.from([byte])));
    values.push(...decoder.finish());

    expect(values).toEqual([
      { type: 'init', sessionId: 'backend-1' },
      { type: 'result', sessionId: 'backend-1', content: '你好' },
    ]);

    const together = new BoundedNdjsonDecoder({ maxLineBytes: 1024, maxOutputBytes: 4096 });
    expect(together.push(Buffer.from('\n  \n{"type":"one"}\n{"type":"two"}\n'))).toEqual([
      { type: 'one' },
      { type: 'two' },
    ]);
  });

  it('rejects malformed, oversized, and trailing partial events with typed failures', () => {
    expect(() => {
      const decoder = new BoundedNdjsonDecoder({ maxLineBytes: 8, maxOutputBytes: 100 });
      decoder.push(Buffer.from('{"too":"long"}\n'));
    }).toThrowError(/protocol-line-limit/);

    expect(() => {
      const decoder = new BoundedNdjsonDecoder({ maxLineBytes: 100, maxOutputBytes: 100 });
      decoder.push(Buffer.from('{oops}\n'));
    }).toThrowError(/protocol-malformed-json/);

    expect(() => {
      const decoder = new BoundedNdjsonDecoder({ maxLineBytes: 100, maxOutputBytes: 100 });
      decoder.push(Buffer.from('{"type":"init"}'));
      decoder.finish();
    }).toThrowError(/protocol-truncated-event/);
  });

  it('accepts one init and one matching terminal result while bounding unknown diagnostics', () => {
    const reduced = reduceBackendTurnEvents(
      [
        { type: 'init', sessionId: 'backend-1' },
        { type: 'progress', detail: 'x'.repeat(200) },
        { type: 'result', sessionId: 'backend-1', content: 'done' },
      ],
      { expectedBackendSessionId: undefined, maxDiagnosticBytes: 32 }
    );

    expect(reduced).toMatchObject({
      backendSessionId: 'backend-1',
      result: 'done',
    });
    expect(Buffer.byteLength(reduced.diagnostics, 'utf8')).toBeLessThanOrEqual(32);
  });

  it.each([
    {
      name: 'missing init',
      events: [{ type: 'result', sessionId: 'backend-1', content: 'done' }],
      error: 'protocol-missing-init',
    },
    {
      name: 'duplicate init',
      events: [
        { type: 'init', sessionId: 'backend-1' },
        { type: 'init', sessionId: 'backend-1' },
        { type: 'result', sessionId: 'backend-1', content: 'done' },
      ],
      error: 'protocol-duplicate-init',
    },
    {
      name: 'missing result',
      events: [{ type: 'init', sessionId: 'backend-1' }],
      error: 'protocol-missing-result',
    },
    {
      name: 'invalid event',
      events: [42],
      error: 'protocol-invalid-event',
    },
    {
      name: 'identity drift',
      events: [
        { type: 'init', sessionId: 'backend-1' },
        { type: 'result', sessionId: 'backend-2', content: 'done' },
      ],
      error: 'protocol-session-mismatch',
    },
    {
      name: 'duplicate result',
      events: [
        { type: 'init', sessionId: 'backend-1' },
        { type: 'result', sessionId: 'backend-1', content: 'done' },
        { type: 'result', sessionId: 'backend-1', content: 'again' },
      ],
      error: 'protocol-duplicate-result',
    },
  ])('rejects $name', ({ events, error }) => {
    expect(() => reduceBackendTurnEvents(events, { maxDiagnosticBytes: 64 })).toThrowError(error);
  });
});
