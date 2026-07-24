import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { readProjectConfig } from '../../../src/core/project-config.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'test-token-workflow-enablement';

interface HttpResult {
  status: number;
  body: string;
  json: () => any;
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
          resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

describe('workflow-enablement API (space-workflow-enablement design D4/D5)', () => {
  let tempDir: string;
  let dataDir: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle;

  async function startServer(): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'proj-a', name: 'proj-a', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({ context });
    return handle;
  }

  function authed(): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-enablement-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    projectRoot = path.join(tempDir, 'space-a');
    createOpenSpecRoot(projectRoot);

    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;

    await registerProject({ projectRoot, projectId: 'proj-a', mode: 'in-repo' }, { globalDataDir: dataDir });
  }, 20_000);

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  describe('GET /api/v1/workflow-enablement', () => {
    it('400 for a relative root (no filesystem probe)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/workflow-enablement?root=relative%2Fpath',
        headers: authed(),
      });
      expect(res.status).toBe(400);
    });

    it('404 for an absolute but unregistered root', async () => {
      const h = await startServer();
      const unregistered = path.join(tempDir, 'not-registered');
      fs.mkdirSync(unregistered, { recursive: true });
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-enablement?root=${encodeURIComponent(unregistered)}`,
        headers: authed(),
      });
      expect(res.status).toBe(404);
    });

    it('reports mode "profile" for a space with no override', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-enablement?root=${encodeURIComponent(projectRoot)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('profile');
      expect(Array.isArray(body.units)).toBe(true);
      expect(body.units.length).toBeGreaterThan(0);
    });

    it('names the governing profile lock for a locked space', async () => {
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nprofile: core\n');

      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-enablement?root=${encodeURIComponent(projectRoot)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('locked-profile');
      expect(body.lockedProfile).toBe('core');
    });

    it('carries no lock name for an unlocked space', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-enablement?root=${encodeURIComponent(projectRoot)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      expect(res.json().lockedProfile).toBeUndefined();
    });

    it('reports mode "override" and marks the override\'s resolved closure once one is set', async () => {
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nworkflows:\n  - review\n');

      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-enablement?root=${encodeURIComponent(projectRoot)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('override');
      const reviewUnit = body.units.find((u: any) => u.id === 'review');
      expect(reviewUnit.enabled).toBe(true);
    });
  });

  describe('POST /api/v1/workflow-enablement', () => {
    it('400 for an unknown op, writing nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'frobnicate' }),
      });
      expect(res.status).toBe(400);
      expect(readProjectConfig(projectRoot)?.workflows).toBeUndefined();
    });

    it('400 for an enable with an unknown catalog id, writing nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'enable', id: 'not-a-real-workflow-id' }),
      });
      expect(res.status).toBe(400);
      expect(readProjectConfig(projectRoot)?.workflows).toBeUndefined();
    });

    it('404 for a mutation addressed at an unregistered root', async () => {
      const h = await startServer();
      const unregistered = path.join(tempDir, 'not-registered-2');
      fs.mkdirSync(unregistered, { recursive: true });
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: unregistered, op: 'reset' }),
      });
      expect(res.status).toBe(404);
    });

    it('enable materializes a project override and applies it (installed becomes true)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'enable', id: 'review' }),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('override');
      const reviewUnit = body.units.find((u: any) => u.id === 'review');
      expect(reviewUnit.enabled).toBe(true);
      expect(readProjectConfig(projectRoot)?.workflows).toContain('review');
    }, 30_000);

    it('reset removes the override and returns the space to following the profile', async () => {
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nworkflows:\n  - review\n');

      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'reset' }),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('profile');
      expect(readProjectConfig(projectRoot)?.workflows).toBeUndefined();
    }, 30_000);

    it('set-profile writes the lock, clears an existing override, and applies', async () => {
      // Start with a per-space override so we can prove set-profile clears it (D4).
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nworkflows:\n  - review\n');

      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'set-profile', profile: 'core' }),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.mode).toBe('locked-profile');
      expect(body.lockedProfile).toBe('core');
      const config = readProjectConfig(projectRoot);
      expect(config?.profile).toBe('core');
      expect(config?.workflows).toBeUndefined();
    }, 30_000);

    it('set-profile refuses a "custom" or unknown profile, writing nothing', async () => {
      const h = await startServer();
      const custom = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'set-profile', profile: 'custom' }),
      });
      expect(custom.status).toBe(400);
      const unknown = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'set-profile', profile: 'no-such-profile' }),
      });
      expect(unknown.status).toBe(400);
      expect(readProjectConfig(projectRoot)?.profile).toBeUndefined();
    });

    it('clear-profile unsets the lock only and returns the space to the profile', async () => {
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nprofile: core\n');

      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'clear-profile' }),
      });
      expect(res.status).toBe(200);
      expect(res.json().mode).toBe('profile');
      expect(readProjectConfig(projectRoot)?.profile).toBeUndefined();
    }, 30_000);

    it('clear-profile leaves an existing workflows override untouched (design D4)', async () => {
      // A space that carries BOTH a lock and its own override: clearing the
      // lock must NOT touch the override — the space stays on its own selection.
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprofile: core\nworkflows:\n  - review\n'
      );

      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'clear-profile' }),
      });
      expect(res.status).toBe(200);
      const config = readProjectConfig(projectRoot);
      expect(config?.profile).toBeUndefined();
      expect(config?.workflows).toContain('review');
      // The override still governs.
      expect(res.json().mode).toBe('override');
    }, 30_000);

    it('a concurrent mutation is refused as busy', async () => {
      const h = await startServer();
      const first = req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'enable', id: 'review' }),
      });
      const second = req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'enable', id: 'cso' }),
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);
      const statuses = [firstResult.status, secondResult.status].sort();
      expect(statuses).toContain(409);
    }, 30_000);

    it('the cap-1 slot also covers the new profile ops (a concurrent set-profile is refused)', async () => {
      const h = await startServer();
      const first = req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'set-profile', profile: 'core' }),
      });
      const second = req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-enablement',
        headers: authed(),
        body: JSON.stringify({ root: projectRoot, op: 'clear-profile' }),
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);
      const statuses = [firstResult.status, secondResult.status].sort();
      expect(statuses).toContain(409);
    }, 30_000);
  });
});
