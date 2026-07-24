import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { MAX_AUDIT_IMPORT_BYTES } from '../../../src/core/token-audit/management.js';

const TOKEN = 'audit-api-token';

function auditReport(id = 'saved-session') {
  return {
    schema: 'rasen-token-audit/2',
    generatedAt: '2026-07-24T00:00:00.000Z',
    session: {
      id,
      runtime: 'claude',
      mainTranscript: '/private/source.jsonl',
      start: 1,
      end: 2,
      durationMs: 1,
      agentCount: 0,
    },
    pricing: { cacheReadX: 0.1, cacheWriteMainX: 1.25, cacheWriteSubX: 1.25 },
    totals: {
      requests: 0,
      outputTokens: 0,
      inputRaw: 0,
      cacheWrite: 0,
      cacheRead: 0,
      billedInputEq: 0,
      churn: { tokens: 0, events: 0, byCause: {} },
      resumes: { hit: 0, miss: 0, missRewrote: 0 },
    },
    byModel: {},
    gapHistogram: {},
    agents: [],
    requests: { columns: [], classes: [], rows: [] },
    churnEvents: [],
  };
}

function request(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string> = {},
  body?: string | Buffer
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: requestPath, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text,
            json: text.startsWith('{') ? JSON.parse(text) : undefined,
          });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function incompleteUpload(
  port: number,
  headers: Record<string, string>
): Promise<{ status: number; socketDestroyed: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.on('connect', () => {
      const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
      socket.write(
        `POST /api/v1/audits/import HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n${headerLines.join('\r\n')}\r\n\r\n`
      );
      socket.write(Buffer.alloc(64 * 1024));
    });
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
    });
    socket.on('close', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      const match = /^HTTP\/1\.1 (\d+)/.exec(response);
      resolve({ status: match ? Number(match[1]) : 0, socketDestroyed: socket.destroyed });
    });
  });
}

describe('management audit API', () => {
  let root: string;
  let dataHome: string;
  let handle: ManagementServerHandle;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-audits-api-'));
    dataHome = path.join(root, 'machine');
    fs.mkdirSync(path.join(dataHome, 'analytics'), { recursive: true });
    fs.writeFileSync(path.join(dataHome, 'analytics', 'saved.json'), JSON.stringify(auditReport()));
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: null,
      launchProjectRef: null,
      version: 'audit-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({
      context,
      sessions: {
        audit: {
          env: { RASEN_HOME: dataHome },
          claudeProjectsRoot: path.join(root, 'missing-claude'),
          codexHome: path.join(root, 'missing-codex'),
          zedDbPath: path.join(root, 'missing-zed.db'),
        },
      },
    });
  });

  afterEach(async () => {
    await handle.stopServer();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const auth = () => ({ Authorization: `Bearer ${TOKEN}` });

  it('requires auth and serves list/detail with daemon identity headers', async () => {
    expect((await request(handle.port, 'GET', '/api/v1/audits')).status).toBe(401);
    const list = await request(handle.port, 'GET', '/api/v1/audits/', auth());
    expect(list.status).toBe(200);
    expect(list.json.reports[0].id).toBe('saved.json');
    expect(list.headers['x-rasen-daemon']).toBe('audit-test');

    const detail = await request(handle.port, 'GET', '/api/v1/audits/saved.json', auth());
    expect(detail.status).toBe(200);
    expect(detail.json.report.session.id).toBe('saved-session');
  });

  it('enforces exact route depth, methods, traversal denial, and strict native request fields', async () => {
    expect((await request(handle.port, 'DELETE', '/api/v1/audits', auth())).status).toBe(405);
    expect((await request(handle.port, 'GET', '/api/v1/audits/saved.json/extra', auth())).status).toBe(404);
    expect((await request(handle.port, 'GET', '/api/v1/audits/%2e%2e%5Csaved.json', auth())).status).toBe(404);

    const pathField = await request(
      handle.port,
      'POST',
      '/api/v1/audits',
      { ...auth(), 'Content-Type': 'application/json' },
      JSON.stringify({ runtime: 'claude', sessionId: 'x', path: '/secret' })
    );
    expect(pathField.status).toBe(400);
    expect(pathField.json.error.code).toBe('invalid_audit_request');
  });

  it('returns fail-soft session diagnostics and bounds the requested limit', async () => {
    const sessions = await request(handle.port, 'GET', '/api/v1/audits/sessions?limit=5', auth());
    expect(sessions.status).toBe(200);
    expect(sessions.json.sessions).toEqual([]);
    expect(sessions.json.diagnostics).toHaveLength(3);
    expect(sessions.json.diagnostics.every((item: any) => item.available === false)).toBe(true);
    expect((await request(handle.port, 'GET', '/api/v1/audits/sessions?limit=9999', auth())).status).toBe(400);
  });

  it('imports raw report bytes with a basename hint and rejects declared oversize bodies', async () => {
    const body = Buffer.from(JSON.stringify(auditReport('imported-session')));
    const imported = await request(
      handle.port,
      'POST',
      '/api/v1/audits/import',
      {
        ...auth(),
        'X-Rasen-Filename': encodeURIComponent('../picked.json'),
        'Content-Length': String(body.length),
      },
      body
    );
    expect(imported.status).toBe(200);
    expect(imported.json.descriptor.id).toBe('picked.json');

    const oversize = await request(
      handle.port,
      'POST',
      '/api/v1/audits/import',
      {
        ...auth(),
        'X-Rasen-Filename': 'huge.jsonl',
        'Content-Length': String(MAX_AUDIT_IMPORT_BYTES + 1),
      }
    );
    expect(oversize.status).toBe(413);
    expect(oversize.json.error.code).toBe('payload_too_large');
  });

  it('terminates incomplete upload sockets after declared oversize and early validation rejection', async () => {
    const oversized = await incompleteUpload(handle.port, {
      ...auth(),
      'X-Rasen-Filename': 'huge.jsonl',
      'Content-Length': String(MAX_AUDIT_IMPORT_BYTES + 1),
    });
    expect(oversized).toEqual({
      status: 413,
      socketDestroyed: true,
    });

    const invalid = await incompleteUpload(handle.port, {
      ...auth(),
      'Content-Length': '65536',
    });
    expect(invalid).toEqual({
      status: 400,
      socketDestroyed: true,
    });
  });

  it('serves the same-origin viewer asset without a token or sensitive query input', async () => {
    const viewer = await request(handle.port, 'GET', '/assets/audit-viewer.html');
    expect(viewer.status).toBe(200);
    expect(viewer.headers['content-type']).toContain('text/html');
    expect(viewer.body).toContain('rasen-audit-ready');
    expect(viewer.body).toContain("event.origin !== location.origin");
  });
});
