import { describe, expect, it } from 'vitest';
import {
  BoundedUtf8Capture,
  sanitizeAgentDiagnostic,
  sanitizeAgentDiagnosticValue,
} from '../../src/core/agent-diagnostics.js';

describe('runtime-neutral agent diagnostics', () => {
  it('redacts secrets in strings and structured values before returning diagnostics', () => {
    const rendered = sanitizeAgentDiagnostic({
      authorization: 'Bearer private-token',
      detail: 'api_key=secret-value https://user:pass@example.com/path',
    });
    expect(rendered).toContain('<redacted>');
    expect(rendered).not.toContain('private-token');
    expect(rendered).not.toContain('secret-value');
    expect(rendered).not.toContain('user:pass');
  });

  it('redacts structured results without diagnostic array, field, or depth truncation', () => {
    const secret = 'explicit-route-secret';
    const value = {
      gaps: Array.from({ length: 105 }, (_, index) => `gap-${index}: ${secret}`),
      nested: { one: { two: { three: { four: { five: { six: { seven: { eight: secret } } } } } } } },
    };
    const redacted = sanitizeAgentDiagnosticValue(value, [secret]);

    expect(redacted.gaps).toHaveLength(105);
    expect(redacted.gaps[104]).toBe('gap-104: <redacted>');
    expect(redacted.nested.one.two.three.four.five.six.seven.eight).toBe('<redacted>');
    expect(JSON.stringify(redacted)).not.toContain(secret);
  });

  it('truncates on a UTF-8 boundary within the requested byte budget', () => {
    const rendered = sanitizeAgentDiagnostic('中文'.repeat(100), 32);
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(32);
    expect(rendered).toContain('<truncated>');
    expect(rendered).not.toContain('\uFFFD');
  });

  it('captures split UTF-8 chunks up to the raw-byte limit and reports overflow', () => {
    const bytes = Buffer.from('中文A', 'utf8');
    const capture = new BoundedUtf8Capture(6);
    capture.append(bytes.subarray(0, 2));
    capture.append(bytes.subarray(2));
    expect(capture.finish()).toBe('中文');
    expect(capture.exceeded).toBe(true);
  });
});
