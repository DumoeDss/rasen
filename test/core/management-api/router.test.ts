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
  options: { method: string; path: string; headers?: Record<string, string> }
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
    request.end();
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

    it('405s a non-GET on /api/v1/changes', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'DELETE', path: '/api/v1/changes', headers: authed() });
      expect(res.status).toBe(405);
    });

    it('405s a non-GET on /api/v1/runs', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'PUT', path: '/api/v1/runs', headers: authed() });
      expect(res.status).toBe(405);
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
