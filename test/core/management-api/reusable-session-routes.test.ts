import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ManagementServerOwnerShutdownError,
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import type { ReusableSessionService } from '../../../src/core/management-api/reusable-session-api.js';
import { REUSABLE_SESSION_API_SCHEMA } from '../../../src/core/management-api/wire-types.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'reusable-session-route-token';
const RUN_ID = `run:${'a'.repeat(64)}`;

function request(
  port: number,
  method: string,
  requestPath: string,
  token?: string,
  body?: unknown
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  value: unknown;
}> {
  return new Promise((resolve, reject) => {
    const bytes =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method,
        agent: false,
        headers: {
          ...(token !== undefined
            ? { Authorization: `Bearer ${token}` }
            : {}),
          ...(bytes !== undefined
            ? {
                'Content-Type': 'application/json',
                'Content-Length': String(bytes.byteLength),
              }
            : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            value: text.length === 0 ? undefined : JSON.parse(text),
          });
        });
      }
    );
    req.on('error', reject);
    req.end(bytes);
  });
}

describe('authenticated reusable-session management routes', () => {
  let projectRoot: string;
  let server: ManagementServerHandle | undefined;
  let service: ReusableSessionService;
  let list: ReturnType<typeof vi.fn>;
  let wake: ReturnType<typeof vi.fn>;
  let ownerShutdown: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-reusable-routes-')
    );
    list = vi.fn(async () => ({
      schema: REUSABLE_SESSION_API_SCHEMA,
      ok: true as const,
      operation: 'list' as const,
      code: 'listed',
      runId: RUN_ID,
      sessions: [],
    }));
    wake = vi.fn(async () => ({
      schema: REUSABLE_SESSION_API_SCHEMA,
      ok: true as const,
      operation: 'wake' as const,
      code: 'completed',
      runId: RUN_ID,
      sessionKey: 'reviewer',
      disposition: 'completed' as const,
      terminalDisposition: 'completed' as const,
    }));
    ownerShutdown = vi.fn(async () => ({ ok: true as const }));
    service = {
      list,
      wake,
      retire: vi.fn(),
      updateTouchPolicy: vi.fn(),
      ownerShutdown,
    };
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: {
        projectId: 'project',
        name: 'project',
        root: projectRoot,
      },
      version: 'route-test-version',
      uiAssetsDir: null,
    };
    server = await startManagementServer({
      context,
      sessions: { reusableSessionService: service },
    });
  });

  afterEach(async () => {
    await server?.stopServer();
    await cleanupTempPathAsync(projectRoot);
  });

  it('authenticates before admission and stamps positive daemon identity', async () => {
    const unauthenticated = await request(
      server!.port,
      'GET',
      `/api/v1/reusable-sessions?runId=${RUN_ID}`
    );
    expect(unauthenticated.status).toBe(401);
    expect(list).not.toHaveBeenCalled();

    const authenticated = await request(
      server!.port,
      'GET',
      `/api/v1/reusable-sessions?runId=${RUN_ID}`,
      TOKEN
    );
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers['x-rasen-daemon'])
      .toBe('route-test-version');
    expect(Number(authenticated.headers['x-rasen-pid'])).toBe(process.pid);
    expect(list).toHaveBeenCalledOnce();
  });

  it('rejects query and method drift without invoking the resident service', async () => {
    const invalidQuery = await request(
      server!.port,
      'GET',
      `/api/v1/reusable-sessions?runId=${RUN_ID}&extra=1`,
      TOKEN
    );
    expect(invalidQuery.status).toBe(400);
    expect(invalidQuery.value).toMatchObject({
      schema: REUSABLE_SESSION_API_SCHEMA,
      ok: false,
      operation: 'list',
      code: 'invalid_request',
    });
    expect((await request(
      server!.port,
      'POST',
      '/api/v1/reusable-sessions',
      TOKEN,
      {}
    )).status).toBe(405);
    expect(list).not.toHaveBeenCalled();
  });

  it('passes one strict versioned wake document to the cached service and drains it', async () => {
    const body = {
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake',
      kind: 'interactive',
      runId: RUN_ID,
      sessionKey: 'reviewer',
      action: { schema: 'change-run-action/1' },
      cwd: projectRoot,
      touchPolicy: {
        mode: 'never',
        maxTouches: 0,
        deadlineAction: 'stop',
      },
    };
    const response = await request(
      server!.port,
      'POST',
      '/api/v1/reusable-sessions/wake',
      TOKEN,
      body
    );
    expect(response.status).toBe(200);
    expect(response.value).toMatchObject({
      schema: REUSABLE_SESSION_API_SCHEMA,
      ok: true,
      operation: 'wake',
    });
    expect(wake).toHaveBeenCalledWith(body);

    await server!.stopServer();
    server = undefined;
    expect(ownerShutdown).toHaveBeenCalledOnce();
  });

  it('surfaces reusable-owner drain failure from bounded server shutdown', async () => {
    ownerShutdown.mockResolvedValue({
      ok: false,
      code: 'owner_shutdown_failed',
      message: 'coordinator settlement failed',
      failures: [
        {
          runId: RUN_ID,
          code: 'registry_write_failed',
          message: 'safe failure',
        },
      ],
    });

    await expect(server!.stopServer()).rejects.toMatchObject({
      name: 'ManagementServerOwnerShutdownError',
      code: 'owner_shutdown_failed',
      message: 'coordinator settlement failed',
      failures: [
        {
          runId: RUN_ID,
          code: 'registry_write_failed',
          message: 'safe failure',
        },
      ],
    });
    const observable = new ManagementServerOwnerShutdownError(
      'coordinator settlement failed',
      [
        {
          runId: RUN_ID,
          code: 'registry_write_failed',
          message: 'safe failure',
        },
      ]
    );
    expect(JSON.stringify(observable.failures)).not.toMatch(
      /token|prompt|owner-secret|raw-message-id|lock-path/u
    );
    expect(ownerShutdown).toHaveBeenCalledOnce();
    server = undefined;
  });
});
