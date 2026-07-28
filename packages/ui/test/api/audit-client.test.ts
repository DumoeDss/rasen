// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { initTokenFromLocation, isUnauthorized, resetTokenStateForTest } from '../../src/api/token.js';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const detail = {
  descriptor: {
    id: 'report.json',
    runtime: 'claude',
    sessionId: 'session',
    generatedAt: '2026-07-24T00:00:00.000Z',
    sessionStart: null,
    sessionEnd: null,
    memberCount: 1,
    modifiedAt: 1,
  },
  report: { schema: 'rasen-token-audit/2', session: { id: 'session', runtime: 'claude' } },
};

describe('audit API client', () => {
  beforeEach(() => {
    resetTokenStateForTest();
    window.history.replaceState({}, '', '/#token=audit-client-token');
    initTokenFromLocation();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetTokenStateForTest();
  });

  it('uses bearer-authenticated JSON requests for native execution', async () => {
    (fetch as any).mockResolvedValueOnce(response(200, detail));
    await client.runSessionAudit('codex', 'thread/id-is-opaque');
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/audits');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer audit-client-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ runtime: 'codex', sessionId: 'thread/id-is-opaque' });
  });

  it('uploads the File bytes raw with only an encoded filename hint and bearer token', async () => {
    (fetch as any).mockResolvedValueOnce(response(200, detail));
    const file = new File(['{}\n'], '..\\session.jsonl', { type: 'application/x-ndjson' });
    await client.importAuditFile(file);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/audits/import');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
    expect(init.headers.Authorization).toBe('Bearer audit-client-token');
    expect(init.headers['X-Rasen-Filename']).toBe('..%5Csession.jsonl');
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('encodes report ids and narrows standard error envelopes', async () => {
    (fetch as any).mockResolvedValueOnce(response(409, {
      error: { code: 'audit_busy', message: 'Busy.', fix: 'Retry.' },
    }));
    await expect(client.getAuditReport('nested/name.json')).rejects.toMatchObject({
      code: 'audit_busy',
      status: 409,
      fix: 'Retry.',
    });
    expect((fetch as any).mock.calls[0][0]).toBe('/api/v1/audits/nested%2Fname.json');
  });

  it('marks the central auth state unauthorized on audit 401', async () => {
    (fetch as any).mockResolvedValueOnce(response(401, {
      error: { code: 'unauthorized', message: 'No.' },
    }));
    await expect(client.listAuditReports()).rejects.toMatchObject({ status: 401 });
    expect(isUnauthorized()).toBe(true);
  });
});
