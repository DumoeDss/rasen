import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext, ManagementRouterOptions } from '../../../src/core/management-api/router.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'test-token-sessions-abc123';

const IS_WINDOWS = process.platform === 'win32';
/**
 * Windows-only evidence-gated buffer (design D5, mirrors
 * supervisor.test.ts's `KILL_SETTLE_BUFFER_MS`): a local timing probe
 * measured a single `taskkill /F /T` invocation at roughly 550-650ms
 * end-to-end on this machine, and Windows' graceful (non-`/F`) `taskkill`
 * phase is a documented near-no-op against a plain console process — every
 * Windows kill effectively waits out the full grace window before the
 * forced escalation actually lands. POSIX keeps every wait exactly as
 * tuned (buffer is 0).
 */
const KILL_SETTLE_BUFFER_MS = IS_WINDOWS ? 1800 : 0;

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}

function req(
  port: number,
  options: { method: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: options.method, path: options.path, headers: options.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

describe('sessions API (session-supervision design D1/D4)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle;

  async function startServer(
    overrides: Partial<ManagementApiContext> = {},
    sessions?: ManagementRouterOptions
  ): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'proj', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
      ...overrides,
    };
    handle = await startManagementServer({ context, sessions });
    return handle;
  }

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
  }

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-sessions-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-sessions-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;
    process.env.RASEN_CLAUDE_BIN = fakeClaudeBin;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    await cleanupTempPathAsync(tempConfigHome);
    await cleanupTempPathAsync(projectRoot);
  });

  describe('POST /api/v1/sessions', () => {
    it('401s an unauthenticated request without spawning', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        body: JSON.stringify({ kind: 'auto', task: 'MODE=fast-exit x' }),
      });
      expect(res.status).toBe(401);
    });

    it('201s a valid auto launch and the session then appears live in the listing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'auto', task: 'MODE=idle-after-init x' }),
      });
      expect(res.status).toBe(201);
      const body = res.json() as any;
      expect(body.session.kind).toBe('auto');
      expect(typeof body.session.id).toBe('string');

      const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
      const listed = (listRes.json() as any).sessions;
      expect(listed.some((entry: any) => entry.session.id === body.session.id)).toBe(true);

      // Clean up.
      await req(h.port, { method: 'DELETE', path: `/api/v1/sessions/${body.session.id}`, headers: authed() });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }, 10_000);

    it('400s an invalid kind and spawns nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'create-change', task: 'x' }),
      });
      expect(res.status).toBe(400);
      const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
      expect((listRes.json() as any).sessions).toEqual([]);
    });

    it('400s an empty task', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: '' }),
      });
      expect(res.status).toBe(400);
    });

    it('409s no_project when launched outside a project', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=fast-exit x' }),
      });
      expect(res.status).toBe(409);
      expect((res.json() as any).error.code).toBe('no_project');
    });

    it('409s busy once the concurrency cap is hit', async () => {
      const h = await startServer();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await req(h.port, {
          method: 'POST',
          path: '/api/v1/sessions',
          headers: authed(),
          body: JSON.stringify({ kind: 'auto', task: `MODE=idle-after-init ${i}` }),
        });
        expect(res.status, `launch ${i}`).toBe(201);
        ids.push((res.json() as any).session.id);
      }

      const overflow = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=idle-after-init overflow' }),
      });
      expect(overflow.status).toBe(409);
      expect((overflow.json() as any).error.code).toBe('busy');

      for (const id of ids) {
        await req(h.port, { method: 'DELETE', path: `/api/v1/sessions/${id}`, headers: authed() });
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }, 10_000);

    it('503s agent_cli_unavailable when no agent CLI resolves', async () => {
      delete process.env.RASEN_CLAUDE_BIN;
      // Also strip PATH so the scan finds nothing real named `claude`.
      const savedPath = process.env.PATH;
      process.env.PATH = '';
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=fast-exit x' }),
      });
      process.env.PATH = savedPath;
      expect(res.status).toBe(503);
      expect((res.json() as any).error.code).toBe('agent_cli_unavailable');
    });

    it('carries no Access-Control-Allow-Origin header', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=fast-exit x' }),
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      const id = (res.json() as any).session.id;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await req(h.port, { method: 'DELETE', path: `/api/v1/sessions/${id}`, headers: authed() });
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('401s without a token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/sessions' });
      expect(res.status).toBe(401);
    });

    it('joins run-state for a session launched with changeName', async () => {
      const h = await startServer();
      const changeDir = path.join(projectRoot, 'rasen', 'changes', 'joined-change');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal\n');
      fs.writeFileSync(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'small-feature', stages: {} })
      );

      const launchRes = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=idle-after-init x', changeName: 'joined-change' }),
      });
      expect(launchRes.status).toBe(201);
      const id = (launchRes.json() as any).session.id;

      const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
      const entry = (listRes.json() as any).sessions.find((e: any) => e.session.id === id);
      expect(entry.runState.kind).toBe('ok');
      expect(entry.runState.autoRun.kind).toBe('ok');
      expect(entry.runState.autoRun.state.pipeline).toBe('small-feature');

      await req(h.port, { method: 'DELETE', path: `/api/v1/sessions/${id}`, headers: authed() });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }, 10_000);

    it('reports runState absent for a session with no changeName', async () => {
      const h = await startServer();
      const launchRes = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=fast-exit x' }),
      });
      const id = (launchRes.json() as any).session.id;

      const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
      const entry = (listRes.json() as any).sessions.find((e: any) => e.session.id === id);
      expect(entry.runState).toEqual({ kind: 'absent' });
    });
  });

  describe('GET /api/v1/sessions/:id', () => {
    it('404s an unknown id', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
        headers: authed(),
      });
      expect(res.status).toBe(404);
    });

    it('returns the record plus output tails', async () => {
      const h = await startServer();
      const launchRes = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=stream-then-exit x' }),
      });
      const id = (launchRes.json() as any).session.id;
      await new Promise((resolve) => setTimeout(resolve, 300));

      const res = await req(h.port, { method: 'GET', path: `/api/v1/sessions/${id}`, headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.session.id).toBe(id);
      expect(typeof body.tails.stdout).toBe('string');
      expect(body.tails.stdout).toContain('thinking_tokens');
    }, 10_000);
  });

  describe('DELETE /api/v1/sessions/:id', () => {
    it('404s an unknown id', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'DELETE',
        path: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
        headers: authed(),
      });
      expect(res.status).toBe(404);
    });

    it('202s a live session, then the listing shows it exited/killed', async () => {
      // A short sessionKillGraceMs (the router's test/daemon-only override
      // point) rather than the 5s production default — otherwise this
      // test's own wait window below would need to outlast the default
      // grace, not just the kill-settle buffer.
      const h = await startServer({}, { sessionKillGraceMs: 100 });
      const launchRes = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=idle-after-init x' }),
      });
      const id = (launchRes.json() as any).session.id;

      const delRes = await req(h.port, { method: 'DELETE', path: `/api/v1/sessions/${id}`, headers: authed() });
      expect(delRes.status).toBe(202);
      expect((delRes.json() as any).session.state).toBe('exiting');

      await new Promise((resolve) => setTimeout(resolve, 400 + KILL_SETTLE_BUFFER_MS));

      const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
      const entry = (listRes.json() as any).sessions.find((e: any) => e.session.id === id);
      expect(entry.session.state).toBe('exited');
      expect(entry.session.terminationReason).toBe('killed');
    }, 10_000);

    it('is idempotent: DELETE on an already-exited session returns 200', async () => {
      const h = await startServer();
      const launchRes = await req(h.port, {
        method: 'POST',
        path: '/api/v1/sessions',
        headers: authed(),
        body: JSON.stringify({ kind: 'auto', task: 'MODE=fast-exit x' }),
      });
      const id = (launchRes.json() as any).session.id;
      await new Promise((resolve) => setTimeout(resolve, 300));

      const delRes = await req(h.port, { method: 'DELETE', path: `/api/v1/sessions/${id}`, headers: authed() });
      expect(delRes.status).toBe(200);
      expect((delRes.json() as any).session.state).toBe('exited');
    }, 10_000);
  });

  describe('method and routing edge cases (design D4/D6)', () => {
    it('405s DELETE on a non-sessions management endpoint', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'DELETE', path: '/api/v1/status', headers: authed() });
      expect(res.status).toBe(405);
    });

    it('a deeper suffix past the session id falls through (404 from config routing, not the sessions handler)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/sessions/some-id/extra',
        headers: authed(),
      });
      // Falls through to the config route group, which 404s unmatched /api/ paths.
      expect(res.status).toBe(404);
    });

    it('still carries identity headers on a sessions response', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
      expect(res.headers['x-rasen-daemon']).toBe('0.0.0-test');
      expect(res.headers['x-rasen-pid']).toBeDefined();
    });

    it('review m3 regression: a non-UUID single-segment id falls through to config routing (404), rather than being claimed by the sessions group', async () => {
      const h = await startServer();
      // Design D4: "validated as UUID format before lookup" — a junk
      // segment must not even be treated as a sessions path (it's not the
      // registry-miss 404 the sessions handler would itself produce; it's
      // the config route group's fallthrough 404, same as any other
      // unmatched /api/ path).
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/sessions/not-a-uuid',
        headers: authed(),
      });
      expect(res.status).toBe(404);
    });

    it('a UUID-shaped but unknown id is still handled by the sessions group (404 with the sessions not_found code)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
        headers: authed(),
      });
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('not_found');
    });
  });
});
