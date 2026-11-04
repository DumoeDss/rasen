import { StringDecoder } from 'node:string_decoder';

export type SessionProtocolFailureCode =
  | 'protocol-output-limit'
  | 'protocol-line-limit'
  | 'protocol-malformed-json'
  | 'protocol-truncated-event'
  | 'protocol-missing-init'
  | 'protocol-duplicate-init'
  | 'protocol-missing-result'
  | 'protocol-duplicate-result'
  | 'protocol-session-mismatch'
  | 'protocol-invalid-event';

export class SessionProtocolError extends Error {
  constructor(
    public readonly code: SessionProtocolFailureCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'SessionProtocolError';
  }
}

export interface BoundedNdjsonDecoderOptions {
  maxLineBytes: number;
  maxOutputBytes: number;
}

/**
 * Stateful byte-oriented NDJSON decoder. Buffering bytes until a newline is
 * intentional: it lets StringDecoder complete a UTF-8 code point even when
 * the child splits that code point across arbitrary stdout chunks.
 */
export class BoundedNdjsonDecoder {
  private pending = Buffer.alloc(0);
  private totalBytes = 0;
  private finished = false;

  constructor(private readonly limits: BoundedNdjsonDecoderOptions) {
    if (!Number.isInteger(limits.maxLineBytes) || limits.maxLineBytes <= 0) {
      throw new Error('maxLineBytes must be a positive integer.');
    }
    if (!Number.isInteger(limits.maxOutputBytes) || limits.maxOutputBytes <= 0) {
      throw new Error('maxOutputBytes must be a positive integer.');
    }
  }

  push(chunk: Buffer | string): unknown[] {
    if (this.finished) throw new Error('NDJSON decoder is already finished.');
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    this.totalBytes += bytes.byteLength;
    if (this.totalBytes > this.limits.maxOutputBytes) {
      throw new SessionProtocolError(
        'protocol-output-limit',
        `Backend output exceeded ${this.limits.maxOutputBytes} bytes.`
      );
    }
    this.pending = Buffer.concat([this.pending, bytes]);
    const values: unknown[] = [];
    for (;;) {
      const newline = this.pending.indexOf(0x0a);
      if (newline < 0) {
        if (this.pending.byteLength > this.limits.maxLineBytes) {
          throw new SessionProtocolError(
            'protocol-line-limit',
            `Backend event exceeded ${this.limits.maxLineBytes} bytes.`
          );
        }
        return values;
      }
      if (newline > this.limits.maxLineBytes) {
        throw new SessionProtocolError(
          'protocol-line-limit',
          `Backend event exceeded ${this.limits.maxLineBytes} bytes.`
        );
      }
      let line = this.pending.subarray(0, newline);
      this.pending = this.pending.subarray(newline + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length === 0 || line.toString('utf8').trim().length === 0) continue;
      values.push(this.parseLine(line));
    }
  }

  finish(): unknown[] {
    if (this.finished) return [];
    this.finished = true;
    if (this.pending.toString('utf8').trim().length > 0) {
      throw new SessionProtocolError(
        'protocol-truncated-event',
        'Backend closed with an incomplete NDJSON event.'
      );
    }
    this.pending = Buffer.alloc(0);
    return [];
  }

  private parseLine(line: Buffer): unknown {
    const decoder = new StringDecoder('utf8');
    const text = decoder.write(line) + decoder.end();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SessionProtocolError(
        'protocol-malformed-json',
        'Backend emitted malformed JSON.'
      );
    }
  }
}

export interface ReducedBackendTurn {
  backendSessionId: string;
  result: string;
  diagnostics: string;
}

interface ReduceBackendTurnOptions {
  expectedBackendSessionId?: string;
  maxDiagnosticBytes: number;
}

function eventObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionProtocolError(
      'protocol-invalid-event',
      'Backend event must be a JSON object.'
    );
  }
  return value as Record<string, unknown>;
}

function boundedUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

export function reduceBackendTurnEvents(
  events: Iterable<unknown>,
  options: ReduceBackendTurnOptions
): ReducedBackendTurn {
  let backendSessionId: string | undefined;
  let result: string | undefined;
  const diagnostics: string[] = [];

  for (const raw of events) {
    const event = eventObject(raw);
    if (event.type === 'init') {
      if (backendSessionId !== undefined) {
        throw new SessionProtocolError(
          'protocol-duplicate-init',
          'Backend emitted more than one init event for a turn.'
        );
      }
      if (typeof event.sessionId !== 'string' || event.sessionId.length === 0) {
        throw new SessionProtocolError(
          'protocol-invalid-event',
          'Backend init event has no Session identity.'
        );
      }
      backendSessionId = event.sessionId;
      if (
        options.expectedBackendSessionId !== undefined &&
        backendSessionId !== options.expectedBackendSessionId
      ) {
        throw new SessionProtocolError(
          'protocol-session-mismatch',
          'Backend init identity does not match the exact resumed Session.'
        );
      }
      continue;
    }
    if (event.type === 'result') {
      if (backendSessionId === undefined) {
        throw new SessionProtocolError(
          'protocol-missing-init',
          'Backend emitted a terminal result before init.'
        );
      }
      if (result !== undefined) {
        throw new SessionProtocolError(
          'protocol-duplicate-result',
          'Backend emitted more than one terminal result for a turn.'
        );
      }
      if (event.sessionId !== backendSessionId) {
        throw new SessionProtocolError(
          'protocol-session-mismatch',
          'Backend terminal result changed Session identity.'
        );
      }
      if (typeof event.content !== 'string') {
        throw new SessionProtocolError(
          'protocol-invalid-event',
          'Backend terminal result has no string content.'
        );
      }
      result = event.content;
      continue;
    }
    diagnostics.push(JSON.stringify(event));
  }

  if (backendSessionId === undefined) {
    throw new SessionProtocolError(
      'protocol-missing-init',
      'Backend turn ended without init.'
    );
  }
  if (result === undefined) {
    throw new SessionProtocolError(
      'protocol-missing-result',
      'Backend turn ended without a terminal result.'
    );
  }
  return {
    backendSessionId,
    result,
    diagnostics: boundedUtf8(diagnostics.join('\n'), options.maxDiagnosticBytes),
  };
}
