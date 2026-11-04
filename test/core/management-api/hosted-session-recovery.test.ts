import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AgentSessionBackend,
  AgentSessionTransport,
  BackendOpenInput,
  BackendTurn,
} from '../../../src/core/session-host/backend.js';
import { createSessionHost } from '../../../src/core/session-host/host.js';
import { createSessionHostRegistry } from '../../../src/core/session-host/registry.js';
import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import { prepareTestSessionTransport } from '../../helpers/session-host-backend.js';

const TOKEN = 'hosted-recovery-token';
const roots: string[] = [];
const handles: ManagementServerHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.stopServer();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function request(
  port: number,
  method: 'GET' | 'POST',
  requestPath: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      agent: false,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

class ResidentBackend implements AgentSessionBackend {
  readonly id = 'replay';
  readonly opens: BackendOpenInput[] = [];

  async prepare(input: BackendOpenInput) {
    this.opens.push(input);
    const backendSessionId = input.resumeSessionId ?? 'backend-replacement-1';
    const transport: AgentSessionTransport = {
      rootPid: 8181 + this.opens.length,
      closed: new Promise<void>(() => undefined),
      send(turn: BackendTurn) {
        const events = (async function* () {
          yield { type: 'init', sessionId: backendSessionId };
          yield { type: 'result', sessionId: backendSessionId, content: `ok:${turn.input}` };
        })();
        return Object.assign(events, { accepted: Promise.resolve() });
      },
      async terminate() {
        return { closed: true, cancelledBeforeWork: false };
      },
    };
    return prepareTestSessionTransport(transport);
  }
}

function server(host: ReturnType<typeof createSessionHost>) {
  return startManagementServer({
    context: {
      token: TOKEN,
      launchProjectRoot: null,
      launchProjectRef: null,
      version: 'test-replacement',
      uiAssetsDir: null,
    },
    sessions: { sessionHostOverride: host },
  }).then((handle) => {
    handles.push(handle);
    return handle;
  });
}

describe('hosted Session daemon replacement and shutdown composition', () => {
  it('preserves idle identity for exact resume and keeps retired state terminal across replacements', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-replacement-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    const stateDir = path.join(root, 'state');
    fs.mkdirSync(cwd);
    const limits = { timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096 };

    const firstBackend = new ResidentBackend();
    const firstHost = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [firstBackend],
    });
    const firstServer = await server(firstHost);
    const created = await request(firstServer.port, 'POST', '/api/v1/hosted-sessions/execute', {
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'first',
      limits,
    });
    expect(created).toMatchObject({
      status: 201,
      body: { ok: true, session: { hostState: 'idle', generation: 1 } },
    });
    const sessionId = created.body.session.sessionId as string;
    await firstServer.stopServer();
    handles.splice(handles.indexOf(firstServer), 1);

    const secondBackend = new ResidentBackend();
    const secondHost = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [secondBackend],
    });
    const secondServer = await server(secondHost);
    const recoveredInspect = await request(secondServer.port, 'GET', `/api/v1/hosted-sessions/${sessionId}`);
    expect(recoveredInspect).toMatchObject({
      status: 200,
      body: { session: { sessionId, hostState: 'idle', generation: 1 } },
    });
    expect(recoveredInspect.body.session).not.toHaveProperty('pid');
    const wake = await request(secondServer.port, 'POST', '/api/v1/hosted-sessions/execute', {
      requestId: randomUUID(),
      sessionId,
      backend: 'replay',
      cwd,
      input: 'second-only',
      limits,
    });
    expect(wake).toMatchObject({
      status: 201,
      body: { ok: true, result: 'ok:second-only', session: { sessionId, generation: 2 } },
    });
    expect(secondBackend.opens).toEqual([
      expect.objectContaining({ resumeSessionId: 'backend-replacement-1' }),
    ]);
    expect(await request(
      secondServer.port,
      'POST',
      `/api/v1/hosted-sessions/${sessionId}/retire`,
      { reason: 'terminal-before-replacement' }
    )).toMatchObject({ status: 200, body: { ok: true, session: { hostState: 'retired' } } });
    await secondServer.stopServer();
    handles.splice(handles.indexOf(secondServer), 1);

    const thirdHost = createSessionHost({
      registry: createSessionHostRegistry({ stateDir }),
      backends: [new ResidentBackend()],
    });
    const thirdServer = await server(thirdHost);
    expect(await request(thirdServer.port, 'GET', `/api/v1/hosted-sessions/${sessionId}`)).toMatchObject({
      status: 200,
      body: { session: { sessionId, hostState: 'retired', retirementReason: 'terminal-before-replacement' } },
    });
    expect(await request(
      thirdServer.port,
      'POST',
      `/api/v1/hosted-sessions/${sessionId}/restart`,
      {}
    )).toMatchObject({ status: 409, body: { ok: false, code: 'session-retired' } });
  });

  it('publishes active shutdown uncertainty before the server closes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-shutdown-'));
    roots.push(root);
    const cwd = path.join(root, 'checkout');
    fs.mkdirSync(cwd);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const backend: AgentSessionBackend = {
      id: 'replay',
      async prepare() {
        const transport: AgentSessionTransport = {
          rootPid: 9191,
          closed: new Promise<void>(() => undefined),
          send(turn: BackendTurn) {
            const events = (async function* () {
              await gate;
              throw new Error(`closed:${turn.requestId}`);
            })();
            return Object.assign(events, { accepted: Promise.resolve() });
          },
          async terminate() {
            release();
            return { closed: true, cancelledBeforeWork: false };
          },
        };
        return prepareTestSessionTransport(transport);
      },
    };
    const registry = createSessionHostRegistry({ stateDir: path.join(root, 'state') });
    const host = createSessionHost({ registry, backends: [backend] });
    const handle = await server(host);
    const pending = host.dispatch({
      op: 'execute',
      requestId: randomUUID(),
      backend: 'replay',
      cwd,
      input: 'active-at-server-stop',
      limits: { timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096 },
    });
    while (host.list()[0]?.hostState !== 'active') await new Promise((resolve) => setTimeout(resolve, 5));
    const sessionId = host.list()[0].sessionId;
    await handle.stopServer();
    handles.splice(handles.indexOf(handle), 1);
    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(host.inspect(sessionId)).toMatchObject({
      hostState: 'interrupted',
      currentRequest: { state: 'ambiguous' },
      recoveryReason: 'shutdown-outcome-unknown',
    });
    expect(host.inspect(sessionId)).not.toHaveProperty('pid');
  });

  it('refuses readiness when the durable registry is corrupt instead of inventing empty state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-corrupt-start-'));
    roots.push(root);
    const stateDir = path.join(root, 'state');
    const registry = createSessionHostRegistry({ stateDir });
    fs.mkdirSync(path.dirname(registry.paths.registryPath), { recursive: true });
    const corrupt = '{corrupt-hosted-registry';
    fs.writeFileSync(registry.paths.registryPath, corrupt, 'utf8');
    await expect(startManagementServer({
      context: {
        token: TOKEN,
        launchProjectRoot: null,
        launchProjectRef: null,
        version: 'test-corrupt',
        uiAssetsDir: null,
      },
      sessions: { sessionHostStateDir: stateDir },
    })).rejects.toThrow(/registry reconciliation failed/i);
    expect(fs.readFileSync(registry.paths.registryPath, 'utf8')).toBe(corrupt);
  });
});
