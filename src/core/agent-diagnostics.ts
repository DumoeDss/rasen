import { StringDecoder } from 'node:string_decoder';

export const DEFAULT_AGENT_DIAGNOSTIC_LIMIT_BYTES = 8 * 1024;
const REDACTED = '<redacted>';
const SENSITIVE_KEY =
  /api.?key|authorization|cookie|credential|password|passwd|private.?key|secret|token/i;

function redactString(value: string, secrets: readonly string[] = []): string {
  const explicitlyRedacted = [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((current, secret) => current.split(secret).join(REDACTED), value);
  return explicitlyRedacted
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(
      /\b(api[_ -]?key|authorization|cookie|credential|password|passwd|private[_ -]?key|secret|token)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      `$1$2${REDACTED}`
    )
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(https?:\/\/)[^/\s@]+@/gi, `$1${REDACTED}@`);
}

function redactDiagnosticValue(
  value: unknown,
  key?: string,
  depth = 0,
  secrets: readonly string[] = []
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value, secrets);
  if (depth >= 8) return '<truncated>';
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => redactDiagnosticValue(item, undefined, depth + 1, secrets));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactDiagnosticValue(entryValue, entryKey, depth + 1, secrets),
        ])
    );
  }
  return value;
}

function redactStructuredValue(
  value: unknown,
  key: string | undefined,
  secrets: readonly string[],
  seen: WeakMap<object, unknown>
): unknown {
  if (typeof value === 'string') {
    return key && SENSITIVE_KEY.test(key) ? REDACTED : redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    const redacted: unknown[] = [];
    seen.set(value, redacted);
    for (const item of value) {
      redacted.push(
        item && typeof item === 'object' && seen.has(item)
          ? seen.get(item)
          : redactStructuredValue(item, undefined, secrets, seen)
      );
    }
    return redacted;
  }
  if (value && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    seen.set(value, redacted);
    for (const [entryKey, entryValue] of Object.entries(value)) {
      redacted[entryKey] =
        entryValue && typeof entryValue === 'object' && seen.has(entryValue)
          ? seen.get(entryValue)
          : redactStructuredValue(entryValue, entryKey, secrets, seen);
    }
    return redacted;
  }
  return value;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;
  const marker = '…<truncated>';
  const contentLimit = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let end = contentLimit;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${encoded.subarray(0, end).toString('utf8')}${marker}`;
}

export function sanitizeAgentDiagnostic(
  value: unknown,
  maxBytes = DEFAULT_AGENT_DIAGNOSTIC_LIMIT_BYTES,
  secrets: Iterable<string> = []
): string {
  const redacted = redactDiagnosticValue(value, undefined, 0, [...secrets]);
  const rendered = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return truncateUtf8(rendered ?? String(redacted), maxBytes);
}

/**
 * Redact explicit in-memory secret values while preserving every array element,
 * object field, and nesting level of a validated structured result. Diagnostic
 * size/depth bounding belongs only to `sanitizeAgentDiagnostic`.
 */
export function sanitizeAgentDiagnosticValue<T>(
  value: T,
  secrets: Iterable<string> = []
): T {
  return redactStructuredValue(
    value,
    undefined,
    [...secrets],
    new WeakMap<object, unknown>()
  ) as T;
}

export class BoundedUtf8Capture {
  private readonly decoder = new StringDecoder('utf8');
  private value = '';
  private capturedBytes = 0;
  private ended = false;
  exceeded = false;

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    const accepted = bytes.subarray(0, Math.max(0, this.maxBytes - this.capturedBytes));
    this.capturedBytes += accepted.length;
    this.value += this.decoder.write(accepted);
    if (accepted.length < bytes.length) this.exceeded = true;
  }

  finish(): string {
    if (!this.ended) {
      this.ended = true;
      this.value += this.decoder.end();
    }
    return this.value;
  }
}
