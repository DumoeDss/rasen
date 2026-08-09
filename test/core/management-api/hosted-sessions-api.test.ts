import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendTurn,
} from '../../../src/core/session-host/backend.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createSessionHostRegistry } from '../../../src/core/session-host/registry.js';
import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import { prepareTestSessionTransport } from '../../helpers/session-host-backend.js';

const TOKEN = 'hosted-session-local-token';
let handle: ManagementServerHandle | undefined;
const roots: string[] = [];

function request(
  port: number,
  options: { method: string; path: string; body?: unknown; auth?: boolean }
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        agent: false,
        headers: {
          ...(options.auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

afterEach(async () => {
  await handle?.stopServer();
  handle = undefined;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('authenticated daemon-local hosted Session routes', () => {
  it('creates, lists, inspects, projects compatibly, and retires without client argv', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-hosted-http-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    const backend: AgentSessionBackend = {
      id: 'replay',
      async prepare() {
        const transport: AgentSessionTransport = {
          rootPid: 9876,
          closed: new Promise<void>(() => undefined),
          send(turn: BackendTurn) {
            const events = (async function* () {
              yield { type: 'init', sessionId: 'backend-http-1' };
              yield { type: 'result', sessionId: 'backend-http-1', content: `ok:${turn.input}` };
            })();
            return Object.assign(events, { accepted: Promise.resolve() });
          },
          async terminate() {
            return { closed: true, cancelledBeforeWork: false };
          },
        };
        return prepareTestSessionTransport(transport);
      },
    };
    const host = createSessionHost({
      registry: createSessionHostRegistry({ stateDir: path.join(root, 'state') }),
      backends: [backend],
    });
    handle = await startManagementServer({
      context: {
        token: TOKEN,
        launchProjectRoot: null,
        launchProjectRef: null,
        version: 'test',
        uiAssetsDir: null,
      },
      sessions: { sessionHostOverride: host },
    });

    const body = {
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'CJK 多行\n& | ^ % --resume',
      limits: { timeoutMs: 2000, maxInputBytes: 4096, maxOutputBytes: 4096 },
    };
    expect(
      await request(handle.port, {
        method: 'POST',
        path: '/api/v1/hosted-sessions/execute',
        body,
      })
    ).toMatchObject({ status: 401 });

    expect(
      await request(handle.port, {
        method: 'POST',
        path: '/api/v1/hosted-sessions/execute',
        body: { ...body, binary: 'C:\\untrusted\\agent.exe' },
        auth: true,
      })
    ).toMatchObject({
      status: 400,
      body: { ok: false, code: 'invalid-input' },
    });

    const created = await request(handle.port, {
      method: 'POST',
      path: '/api/v1/hosted-sessions/execute',
      body,
      auth: true,
    });
    expect(created).toMatchObject({
      status: 201,
      body: {
        ok: true,
        result: `ok:${body.input}`,
        session: { backend: 'replay', backendSessionId: 'backend-http-1', hostState: 'idle' },
      },
    });
    const id = created.body.session.sessionId as string;

    expect(
      await request(handle.port, {
        method: 'POST',
        path: `/api/v1/hosted-sessions/${id}/restart`,
        auth: true,
        body: { argv: ['--dangerously-skip-permissions'] },
      })
    ).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid-input' } },
    });
    expect(
      await request(handle.port, {
        method: 'DELETE',
        path: `/api/v1/hosted-sessions/${id}`,
        auth: true,
      })
    ).toMatchObject({ status: 405 });

    expect(
      await request(handle.port, { method: 'GET', path: `/api/v1/hosted-sessions/${id}`, auth: true })
    ).toMatchObject({ status: 200, body: { session: { sessionId: id } } });
    expect(
      await request(handle.port, { method: 'GET', path: '/api/v1/sessions', auth: true })
    ).toMatchObject({
      status: 200,
      body: {
        sessions: [
          {
            session: {
              id,
              kind: 'hosted',
              task: 'Hosted agent session',
              state: 'running',
              hostState: 'idle',
            },
            runState: { kind: 'absent' },
          },
        ],
      },
    });

    expect(
      await request(handle.port, {
        method: 'POST',
        path: `/api/v1/hosted-sessions/${id}/retire`,
        auth: true,
        body: { reason: 'done' },
      })
    ).toMatchObject({ status: 200, body: { ok: true, session: { hostState: 'retired' } } });
  });
});
