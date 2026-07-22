import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Wraps the real `resolveProjectHome` with a call-counting spy (design D5,
// m4: the server must resolve the project home at most once per server —
// cached once found, re-probed only while still null) — passthrough to the
// actual implementation so behavior is unaffected.
const resolveProjectHomeSpy = vi.fn();
vi.mock('../../../src/core/project-home.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/project-home.js')>();
  return {
    ...actual,
    resolveProjectHome: (...args: Parameters<typeof actual.resolveProjectHome>) => {
      resolveProjectHomeSpy(...args);
      return actual.resolveProjectHome(...args);
    },
  };
});

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';

const TOKEN = 'test-token-mgmt-abc123';

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
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

describe('management-api router (integration, via real http server)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle;

  async function startServer(overrides: Partial<ManagementApiContext> = {}): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'proj', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
      ...overrides,
    };
    handle = await startManagementServer({ context });
    return handle;
  }

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
  }

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mgmt-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mgmt-api-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;

    resolveProjectHomeSpy.mockClear();
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    fs.rmSync(tempConfigHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('auth', () => {
    it('401s a management request with no token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status' });
      expect(res.status).toBe(401);
      expect((res.json() as any).error.code).toBe('unauthorized');
    });

    it('200s a management request with the correct token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.version).toBe('0.0.0-test');
      expect(typeof body.pid).toBe('number');
      expect(body.project).toEqual({ projectId: 'launch-proj', name: 'proj', root: projectRoot });
    });
  });

  describe('method guard', () => {
    it('405s a non-GET on /api/v1/status', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'POST', path: '/api/v1/status', headers: authed() });
      expect(res.status).toBe(405);
      expect((res.json() as any).error.code).toBe('method_not_allowed');
    });

    it('405s a non-GET, non-POST on /api/v1/changes', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'DELETE', path: '/api/v1/changes', headers: authed() });
      expect(res.status).toBe(405);
    });

    it('405s PUT on /api/v1/changes', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'PUT', path: '/api/v1/changes', headers: authed() });
      expect(res.status).toBe(405);
    });

    it('405s PUT and DELETE on /api/v1/status', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/status', headers: authed() });
        expect(res.status, method).toBe(405);
      }
    });

    it('405s POST on /api/v1/status', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'POST', path: '/api/v1/status', headers: authed() });
      expect(res.status).toBe(405);
    });

    it('405s POST on /api/v1/runs', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'POST', path: '/api/v1/runs', headers: authed() });
      expect(res.status).toBe(405);
    });

    it('405s a non-GET on /api/v1/runs', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'PUT', path: '/api/v1/runs', headers: authed() });
      expect(res.status).toBe(405);
    });
  });

  describe('POST /api/v1/changes (change-submission)', () => {
    it('401s an unauthenticated POST without spawning', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        body: JSON.stringify({ name: 'unauth-change', description: 'desc' }),
      });
      expect(res.status).toBe(401);
      expect(fs.existsSync(path.join(projectRoot, 'rasen', 'changes', 'unauth-change'))).toBe(false);
    });

    it('creates a real change via the CLI subprocess and responds 201', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'router-submitted-change', description: 'Submitted from a test' }),
      });

      expect(res.status).toBe(201);
      const body = res.json() as any;
      expect(body.change.id).toBe('router-submitted-change');

      const proposalPath = path.join(projectRoot, 'rasen', 'changes', 'router-submitted-change', 'proposal.md');
      expect(fs.existsSync(proposalPath)).toBe(true);

      // Fresh-read requirement: a follow-up GET /api/v1/changes lists it.
      const listRes = await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      const names = (listRes.json() as any).changes.map((c: any) => c.name);
      expect(names).toContain('router-submitted-change');
    });

    it('responds 400 for an invalid name without creating anything', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Not Valid', description: 'desc' }),
      });
      expect(res.status).toBe(400);
    });

    it('responds 409 no_project when launched outside a project', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: authed(),
        body: JSON.stringify({ name: 'no-project-change', description: 'desc' }),
      });
      expect(res.status).toBe(409);
      expect((res.json() as any).error.code).toBe('no_project');
    });

    it('carries no Access-Control-Allow-Origin header on a POST response', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: authed(),
        body: JSON.stringify({ name: 'cors-check-change', description: 'desc' }),
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('still carries the identity headers on a POST response', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: authed(),
        body: JSON.stringify({ name: 'identity-check-change', description: 'desc' }),
      });
      expect(res.headers['x-rasen-daemon']).toBe('0.0.0-test');
      expect(res.headers['x-rasen-pid']).toBe(String(process.pid));
    });

    it('does not widen getActiveChangeIds scope: a planning-only dir without proposal.md stays invisible', async () => {
      const h = await startServer();
      // A change directory with tasks.md but no proposal.md — the two SHALL
      // NOT clauses (management-http-api, board-ui) forbid a wider scan even
      // now that a write endpoint exists.
      const planningOnlyDir = path.join(projectRoot, 'rasen', 'changes', 'planning-only-no-proposal');
      fs.mkdirSync(planningOnlyDir, { recursive: true });
      fs.writeFileSync(path.join(planningOnlyDir, 'tasks.md'), '- [ ] 1.1 A task\n');

      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      const names = (res.json() as any).changes.map((c: any) => c.name);
      expect(names).not.toContain('planning-only-no-proposal');
    });
  });

  describe('GET /api/v1/local-paths (local-path-browsing)', () => {
    it('401s without a token and enumerates nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/local-paths' });
      expect(res.status).toBe(401);
    });

    it('starts at home when no path is supplied', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/local-paths', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.home).toBe(true);
      expect(Array.isArray(body.entries)).toBe(true);
    });

    it('405s POST on /api/v1/local-paths', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'POST', path: '/api/v1/local-paths', headers: authed() });
      expect(res.status).toBe(405);
      expect((res.json() as any).error.code).toBe('method_not_allowed');
    });

    it('400s a relative path with invalid_path', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/local-paths?path=relative%2Fdir',
        headers: authed(),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('invalid_path');
    });
  });

  describe('/api/v1/spaces admission (space-creation)', () => {
    it('serves GET (listing) under the management posture', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/spaces', headers: authed() });
      expect(res.status).toBe(200);
      expect(Array.isArray((res.json() as any).spaces)).toBe(true);
    });

    it('admits POST to the creation bridge (a bad kind reaches validation as 400, not 405)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/spaces',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'banana', path: '/tmp/whatever' }),
      });
      // Routed to the bridge (not method-rejected): validation answers 400.
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('invalid_input');
    });

    it('401s an unauthenticated POST and spawns nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/spaces',
        body: JSON.stringify({ kind: 'project', path: '/tmp/whatever' }),
      });
      expect(res.status).toBe(401);
    });

    it('405s PUT and DELETE on /api/v1/spaces', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/spaces', headers: authed() });
        expect(res.status, method).toBe(405);
      }
    });
  });

  describe('identity headers (design D3)', () => {
    it('are present on a 200 management response', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status', headers: authed() });
      expect(res.headers['x-rasen-daemon']).toBe('0.0.0-test');
      expect(res.headers['x-rasen-pid']).toBe(String(process.pid));
    });

    it('are present on a 401 response', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status' });
      expect(res.status).toBe(401);
      expect(res.headers['x-rasen-daemon']).toBe('0.0.0-test');
      expect(res.headers['x-rasen-pid']).toBeDefined();
    });

    it('are present on a delegated config-api response', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/health', headers: authed() });
      expect(res.status).toBe(200);
      expect(res.headers['x-rasen-daemon']).toBe('0.0.0-test');
      expect(res.headers['x-rasen-pid']).toBeDefined();
    });

    it('are present on a static (no-UI-package hint page) response', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/board' });
      expect(res.status).toBe(200);
      expect(res.headers['x-rasen-daemon']).toBe('0.0.0-test');
      expect(res.headers['x-rasen-pid']).toBeDefined();
    });
  });

  describe('delegation (design D2)', () => {
    it('answers /api/v1/health through the management server with the same token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/health', headers: authed() });
      expect(res.status).toBe(200);
      expect((res.json() as any).ok).toBe(true);
    });

    it('answers /api/v1/config through the management server with the same token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/config', headers: authed() });
      expect(res.status).toBe(200);
      expect(Array.isArray((res.json() as any).entries)).toBe(true);
    });

    it('404s an unmatched /api/ route (delegated behavior preserved)', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/nope', headers: authed() });
      expect(res.status).toBe(404);
    });
  });

  describe('unauthenticated project-less server', () => {
    it('reports project: null on /api/v1/status when launched outside a project', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status', headers: authed() });
      expect((res.json() as any).project).toBeNull();
    });

    it('reports an empty runs listing when launched outside a project', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, { method: 'GET', path: '/api/v1/runs', headers: authed() });
      expect(res.status).toBe(200);
      expect((res.json() as any).runs).toEqual([]);
    });

    it('errors on /api/v1/changes when launched outside a project', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('project_required');
    });
  });

  describe('trailing-slash tolerance (design D6, t1)', () => {
    it('answers /api/v1/status/ (one trailing slash) identically to /api/v1/status', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status/', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.version).toBe('0.0.0-test');
    });

    it('does not treat a deeper suffix as a management path (falls through to config 404)', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/status/extra', headers: authed() });
      expect(res.status).toBe(404);
    });
  });

  describe('server-lifetime project-home caching (design D5, m4)', () => {
    it('resolves the project home once for a registered project across multiple board-load request pairs', async () => {
      // ensure: true (default) mints identity + registers, so the server's
      // read-only (`ensure: false`) probe resolves to a non-null home.
      await resolveProjectHome(projectRoot);
      resolveProjectHomeSpy.mockClear();

      const h = await startServer();

      await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      await req(h.port, { method: 'GET', path: '/api/v1/runs', headers: authed() });
      await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      await req(h.port, { method: 'GET', path: '/api/v1/runs', headers: authed() });

      // One successful resolution total — every request after the first hit
      // reuses the cached home instead of re-probing the filesystem.
      expect(resolveProjectHomeSpy).toHaveBeenCalledTimes(1);
    });

    it('re-probes on every request while the project is unregistered (null result never cached)', async () => {
      const h = await startServer();

      await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      await req(h.port, { method: 'GET', path: '/api/v1/runs', headers: authed() });

      expect(resolveProjectHomeSpy).toHaveBeenCalledTimes(2);
    });

    it('picks up a project registered mid-session on the next request, without a restart', async () => {
      const changeDir = path.join(projectRoot, 'rasen', 'changes', 'mid-session-change');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal\n');

      const h = await startServer();

      // First request: the project is not yet registered, so the home
      // resolves to null and there is no workDir to check — the changeDir
      // has no auto-run.json either, so the run state is absent.
      const first = await req(h.port, { method: 'GET', path: '/api/v1/runs', headers: authed() });
      const firstEntry = (first.json() as any).runs.find((r: any) => r.name === 'mid-session-change');
      expect(firstEntry.autoRun).toEqual({ kind: 'absent' });

      // Register the project mid-session (mints identity + a registry
      // entry) and write auto-run.json only into the now-resolvable
      // workDir — the changeDir copy stays absent, so a response can only
      // report `ok` here by actually resolving (not reusing a stale null)
      // and reading from the workDir.
      const home = await resolveProjectHome(projectRoot);
      const workDir = home!.workDir('mid-session-change');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'full-feature', stages: {} })
      );

      const second = await req(h.port, { method: 'GET', path: '/api/v1/runs', headers: authed() });
      const secondEntry = (second.json() as any).runs.find((r: any) => r.name === 'mid-session-change');
      expect(secondEntry.autoRun.kind).toBe('ok');
      if (secondEntry.autoRun.kind === 'ok') {
        expect(secondEntry.autoRun.state.pipeline).toBe('full-feature');
      }
    });
  });

  describe('freshness (design: no cache, per-request filesystem read)', () => {
    it('reflects an on-disk change mutated between two requests', async () => {
      const h = await startServer();
      const changeDir = path.join(projectRoot, 'rasen', 'changes', 'freshness-change');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal\n');

      const first = await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      expect(first.status).toBe(200);
      expect((first.json() as any).changes.map((c: any) => c.name)).toEqual(['freshness-change']);

      fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [x] 1.1 A task\n');

      const second = await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      const change = (second.json() as any).changes.find((c: any) => c.name === 'freshness-change');
      expect(change.taskProgress).toEqual({ total: 1, completed: 1 });
    });
  });
});
