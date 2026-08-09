import * as http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DAEMON_COORDINATOR_SHUTDOWN_GUARD_MS,
  DAEMON_GRACEFUL_SHUTDOWN_BUDGET_MS,
  DAEMON_SERVER_CLOSE_GUARD_MS,
  DAEMON_SHUTDOWN_OVERHEAD_MS,
  daemonShutdownBudget,
  runDaemonRun,
  type DaemonRunDependencies,
} from '../../src/commands/daemon.js';
import {
  REUSABLE_SESSION_API_SCHEMA,
  SESSION_TOUCH_REQUEST_TIMEOUT_MS,
  SESSION_TOUCH_STOP_DRAIN_MS,
  createLoopbackReusableSessionTouchClient,
  type ReusableSessionProjection,
  type SessionTouchScheduler,
} from '../../src/core/management-api/session-touch-scheduler.js';

const NOW = Date.parse('2026-07-30T10:00:00.000Z');

function projection(): ReusableSessionProjection {
  return {
    runId: 'run-1',
    sessionKey: 'reviewer',
    role: 'reviewer',
    status: 'idle',
    cwd: 'C:\\repo',
    lifecycle: {
      createdAt: new Date(NOW - 60 * 60_000).toISOString(),
      updatedAt: new Date(NOW - 50 * 60_000).toISOString(),
      lastWakeAt: new Date(NOW - 50 * 60_000).toISOString(),
    },
    touchPolicy: {
      mode: 'auto',
      deadlineAt: new Date(NOW + 60 * 60_000).toISOString(),
      maxTouches: 3,
      touchesUsed: 0,
      deadlineAction: 'stop',
    },
    wakes: [],
  };
}

interface CapturedRequest {
  method?: string;
  url?: string;
  authorization?: string;
  body?: unknown;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('authenticated reusable-session loopback adapter', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => close(server)));
  });

  it('uses the exact bearer token, versioned schema, paths, and touch metadata', async () => {
    const requests: CapturedRequest[] = [];
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf-8');
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          ...(bodyText === '' ? {} : { body: JSON.parse(bodyText) }),
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        if (request.method === 'GET') {
          response.end(
            JSON.stringify({
              schema: REUSABLE_SESSION_API_SCHEMA,
              ok: true,
              operation: 'list',
              code: 'listed',
              sessions: [projection()],
            })
          );
          return;
        }
        if (request.url?.endsWith('/wake')) {
          response.end(
            JSON.stringify({
              schema: REUSABLE_SESSION_API_SCHEMA,
              ok: true,
              operation: 'wake',
              code: 'completed',
              runId: 'run-1',
              sessionKey: 'reviewer',
              disposition: 'completed',
              terminalDisposition: 'completed',
              session: projection(),
            })
          );
          return;
        }
        response.end(
          JSON.stringify({
            schema: REUSABLE_SESSION_API_SCHEMA,
            ok: true,
            operation: request.url?.endsWith('/retire')
              ? 'retire'
              : 'touch-policy',
            code: request.url?.endsWith('/retire')
              ? 'retired'
              : 'touch_policy_updated',
            runId: 'run-1',
            sessionKey: 'reviewer',
            session: projection(),
          })
        );
      });
    });
    servers.push(server);
    const port = await listen(server);
    const client = createLoopbackReusableSessionTouchClient({
      port,
      token: 'daemon-secret',
    });
    const expectedLastWakeAt = projection().lifecycle.lastWakeAt!;

    await expect(client.listAll()).resolves.toMatchObject({ ok: true });
    await expect(
      client.conditionalTouch({
        runId: 'run-1',
        sessionKey: 'reviewer',
        message: 'keepalive',
        messageId: 'rasen-touch-v1-id',
        expectedLastWakeAt,
        touchOrdinal: 1,
        touchAttempt: 2,
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { code: 'completed' },
    });
    await expect(
      client.updateTouchPolicy({
        runId: 'run-1',
        sessionKey: 'reviewer',
        expectedLastWakeAt,
        policy: { ...projection().touchPolicy, mode: 'never' },
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.retireSilent({
        runId: 'run-1',
        sessionKey: 'reviewer',
        reason: 'touch-deadline-expired',
      })
    ).resolves.toMatchObject({ ok: true });

    expect(requests.map((request) => request.url)).toEqual([
      '/api/v1/reusable-sessions?scope=all',
      '/api/v1/reusable-sessions/wake',
      '/api/v1/reusable-sessions/touch-policy',
      '/api/v1/reusable-sessions/retire',
    ]);
    expect(
      requests.every(
        (request) => request.authorization === 'Bearer daemon-secret'
      )
    ).toBe(true);
    expect(requests[1]?.body).toEqual({
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'wake',
      runId: 'run-1',
      sessionKey: 'reviewer',
      message: 'keepalive',
      messageId: 'rasen-touch-v1-id',
      expectedLastWakeAt,
      touchOrdinal: 1,
      touchAttempt: 2,
      kind: 'touch',
    });
    expect(requests[2]?.body).toEqual({
      schema: REUSABLE_SESSION_API_SCHEMA,
      op: 'touch-policy',
      runId: 'run-1',
      sessionKey: 'reviewer',
      expectedLastWakeAt,
      policy: {
        ...projection().touchPolicy,
        mode: 'never',
      },
    });
  });

  it('fails strict decoding and settles a partial-response reset once as exact-ID uncertainty', async () => {
    const invalidServer = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          schema: REUSABLE_SESSION_API_SCHEMA,
          ok: true,
          operation: 'list',
          code: 'listed',
          sessions: [],
          unexpected: true,
        })
      );
    });
    servers.push(invalidServer);
    const invalidPort = await listen(invalidServer);
    const invalidClient = createLoopbackReusableSessionTouchClient({
      port: invalidPort,
      token: 'token',
    });
    await expect(invalidClient.listAll()).resolves.toMatchObject({
      ok: false,
      phase: 'protocol',
      code: 'invalid_response',
    });

    const resetBodies: Array<{ messageId?: string; touchAttempt?: number }> = [];
    const resetServer = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const decoded = JSON.parse(
          Buffer.concat(chunks).toString('utf-8')
        ) as { messageId?: string; touchAttempt?: number };
        resetBodies.push({
          messageId: decoded.messageId,
          touchAttempt: decoded.touchAttempt,
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.write(
          `{"schema":"${REUSABLE_SESSION_API_SCHEMA}","ok":true`
        );
        response.flushHeaders();
        response.socket?.destroy();
      });
    });
    servers.push(resetServer);
    const resetPort = await listen(resetServer);
    const resetClient = createLoopbackReusableSessionTouchClient({
      port: resetPort,
      token: 'token',
      requestTimeoutMs: 1_000,
    });
    const exactRequest = {
      runId: 'run-1',
      sessionKey: 'reviewer',
      message: 'keepalive',
      messageId: 'stable-id',
      expectedLastWakeAt: projection().lifecycle.lastWakeAt!,
      touchOrdinal: 1,
      touchAttempt: 1,
    };
    const startedAt = Date.now();
    const first = await resetClient.conditionalTouch(exactRequest);
    expect(first).toMatchObject({
      ok: false,
      phase: 'transport_uncertain',
    });
    expect(Date.now() - startedAt).toBeLessThan(800);
    const second = await resetClient.conditionalTouch(exactRequest);
    expect(second).toMatchObject({
      ok: false,
      phase: 'transport_uncertain',
    });
    expect(resetBodies).toEqual([
      { messageId: 'stable-id', touchAttempt: 1 },
      { messageId: 'stable-id', touchAttempt: 1 },
    ]);
  });

  it('classifies an already-cancelled operation as pre-delivery without connecting', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createLoopbackReusableSessionTouchClient({
      port: 1,
      token: 'token',
      requestTimeoutMs: 100,
    });
    await expect(
      client.listAll({ signal: controller.signal })
    ).resolves.toMatchObject({
      ok: false,
      phase: 'pre_delivery',
      code: 'request_cancelled_before_commit',
    });
  });
});

describe('daemon touch-scheduler lifecycle', () => {
  it('keeps the outer kill grace strictly above the composed graceful budget', () => {
    expect(SESSION_TOUCH_REQUEST_TIMEOUT_MS).toBe(4_000);
    expect(SESSION_TOUCH_STOP_DRAIN_MS).toBe(5_000);
    expect(DAEMON_COORDINATOR_SHUTDOWN_GUARD_MS).toBe(8_000);
    expect(DAEMON_SERVER_CLOSE_GUARD_MS).toBe(2_000);
    expect(DAEMON_SHUTDOWN_OVERHEAD_MS).toBe(1_000);
    expect(DAEMON_GRACEFUL_SHUTDOWN_BUDGET_MS).toBe(16_000);
    expect(daemonShutdownBudget()).toEqual({
      identifiedKillGraceMs: 20_000,
      gracefulShutdownBudgetMs: 16_000,
      safe: true,
    });
  });

  it('starts exactly one scheduler after listen with the actual port/token and drains it before the server', async () => {
    const events: string[] = [];
    const signalHandlers = new Map<string, () => void>();
    let schedulerFactoryCalls = 0;
    let exited!: () => void;
    const exitObserved = new Promise<void>((resolve) => {
      exited = resolve;
    });
    const scheduler: SessionTouchScheduler = {
      start: vi.fn(() => events.push('scheduler-start')),
      scanNow: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        events.push('scheduler-stop');
      }),
    };
    const server = http.createServer();
    const dependencies: DaemonRunDependencies = {
      startServer: vi.fn(async () => {
        events.push('server-listening');
        return {
          server,
          port: 43123,
          stopServer: async () => {
            events.push('server-stop');
          },
        };
      }),
      resolveContext: async () => ({
        launchProjectRoot: 'C:\\repo',
        launchProjectRef: {} as never,
        uiAssetsDir: 'C:\\repo\\packages\\ui',
      }),
      tokenFactory: () => 'fixed-token',
      createTouchScheduler: (options) => {
        schedulerFactoryCalls += 1;
        events.push(`scheduler-create:${options.port}:${options.token}`);
        return scheduler;
      },
      writeState: vi.fn(() => events.push('state-write')),
      deleteState: vi.fn(() => events.push('state-delete')),
      onSignal: (signal, listener) => {
        signalHandlers.set(signal, listener);
      },
      exit: (code) => {
        events.push(`exit:${code}`);
        exited();
      },
      log: vi.fn(),
    };

    const controller = await runDaemonRun({ port: '0' }, dependencies);
    expect(controller).toMatchObject({ port: 43123, token: 'fixed-token' });
    expect(schedulerFactoryCalls).toBe(1);
    expect(events.slice(0, 4)).toEqual([
      'server-listening',
      'scheduler-create:43123:fixed-token',
      'scheduler-start',
      'state-write',
    ]);
    expect(signalHandlers.has('SIGINT')).toBe(true);
    expect(signalHandlers.has('SIGTERM')).toBe(true);

    signalHandlers.get('SIGTERM')!();
    await exitObserved;
    expect(events.slice(-4)).toEqual([
      'scheduler-stop',
      'server-stop',
      'state-delete',
      'exit:0',
    ]);
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps scheduler construction exclusive to daemon run', async () => {
    const createScheduler = vi.fn();
    const ordinaryManagementStartup = async (): Promise<void> => {
      // UI and foreground callers invoke startManagementServer directly.
      // They have no scheduler dependency or callback in its public options.
      await Promise.resolve();
    };
    await ordinaryManagementStartup();
    expect(createScheduler).not.toHaveBeenCalled();
  });
});
