import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { getNamedProfilesDir } from '../../../src/core/named-profiles.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'test-token-profiles';

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

describe('profiles API (ui-profile-workflow-split profile-http-api design D1)', () => {
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

  function post(port: number, body: unknown): Promise<HttpResult> {
    return req(port, { method: 'POST', path: '/api/v1/profiles', headers: authed(), body: JSON.stringify(body) });
  }

  function list(port: number): Promise<HttpResult> {
    return req(port, { method: 'GET', path: '/api/v1/profiles', headers: authed() });
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profiles-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    projectRoot = path.join(tempDir, 'space-a');
    createOpenSpecRoot(projectRoot);

    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  }, 20_000);

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  describe('GET /api/v1/profiles', () => {
    it('lists built-ins plus saved profiles and surfaces a broken saved file', async () => {
      const h = await startServer();
      await post(h.port, { op: 'create', name: 'alpha', workflows: ['review'] });
      await post(h.port, { op: 'create', name: 'beta', workflows: ['cso'] });
      // A saved file that cannot be parsed must still appear, carrying its error.
      fs.mkdirSync(getNamedProfilesDir(), { recursive: true });
      fs.writeFileSync(path.join(getNamedProfilesDir(), 'broken.yaml'), 'version: 1\nworkflows: not-an-array\n');

      const res = await list(h.port);
      expect(res.status).toBe(200);
      const byName = new Map<string, any>(res.json().profiles.map((p: any) => [p.name, p]));

      expect(byName.get('full')?.builtIn).toBe(true);
      expect(byName.get('core')?.builtIn).toBe(true);
      expect(Array.isArray(byName.get('full')?.workflows)).toBe(true);

      expect(byName.get('alpha')?.builtIn).toBe(false);
      expect(byName.get('alpha')?.workflows).toContain('review');
      expect(byName.get('beta')?.workflows).toContain('cso');

      const broken = byName.get('broken');
      expect(broken).toBeDefined();
      expect(typeof broken.error).toBe('string');
      expect(broken.workflows).toBeUndefined();
    });
  });

  describe('POST /api/v1/profiles', () => {
    it('create persists a CLI-visible profile and returns the normalized definition', async () => {
      const h = await startServer();
      const res = await post(h.port, { op: 'create', name: 'my-set', workflows: ['review'] });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.profile.name).toBe('my-set');
      expect(body.profile.builtIn).toBe(false);
      expect(Array.isArray(body.profile.workflows)).toBe(true);
      expect(body.profile.workflows).toContain('review');
      // Persisted to the shared storage the CLI reads.
      expect(fs.existsSync(path.join(getNamedProfilesDir(), 'my-set.yaml'))).toBe(true);
      const listed = (await list(h.port)).json().profiles.map((p: any) => p.name);
      expect(listed).toContain('my-set');
    });

    it('update replaces membership of an existing saved profile', async () => {
      const h = await startServer();
      await post(h.port, { op: 'create', name: 'my-set', workflows: ['review'] });
      const res = await post(h.port, { op: 'update', name: 'my-set', workflows: ['cso', 'qa'] });
      expect(res.status).toBe(200);
      const workflows = res.json().profile.workflows;
      expect(workflows).toContain('cso');
      expect(workflows).toContain('qa');
      expect(workflows).not.toContain('review');
    });

    it('delete removes a saved profile from the listing', async () => {
      const h = await startServer();
      await post(h.port, { op: 'create', name: 'my-set', workflows: ['review'] });
      const res = await post(h.port, { op: 'delete', name: 'my-set' });
      expect(res.status).toBe(200);
      expect(res.json().deleted).toBe('my-set');
      const listed = (await list(h.port)).json().profiles.map((p: any) => p.name);
      expect(listed).not.toContain('my-set');
      expect(fs.existsSync(path.join(getNamedProfilesDir(), 'my-set.yaml'))).toBe(false);
    });

    it('refuses a reserved name and writes nothing', async () => {
      const h = await startServer();
      const res = await post(h.port, { op: 'create', name: 'core', workflows: ['review'] });
      expect(res.status).toBe(400);
      expect(res.json().error.code).toBe('reserved_name');
    });

    it('refuses a duplicate create with 409', async () => {
      const h = await startServer();
      await post(h.port, { op: 'create', name: 'dup', workflows: ['review'] });
      const res = await post(h.port, { op: 'create', name: 'dup', workflows: ['cso'] });
      expect(res.status).toBe(409);
      expect(res.json().error.code).toBe('already_exists');
      // Original membership is unchanged.
      const listed = new Map<string, any>((await list(h.port)).json().profiles.map((p: any) => [p.name, p]));
      expect(listed.get('dup').workflows).toContain('review');
    });

    it('refuses updating a missing profile with 404', async () => {
      const h = await startServer();
      const res = await post(h.port, { op: 'update', name: 'ghost', workflows: ['review'] });
      expect(res.status).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    });

    it('refuses updating a built-in profile', async () => {
      const h = await startServer();
      const res = await post(h.port, { op: 'update', name: 'full', workflows: ['review'] });
      expect(res.status).toBe(400);
      expect(res.json().error.code).toBe('reserved_name');
    });

    it('refuses membership naming an unknown workflow id', async () => {
      const h = await startServer();
      const res = await post(h.port, { op: 'create', name: 'bad', workflows: ['not-a-real-workflow'] });
      expect(res.status).toBe(400);
      expect(res.json().error.message).toContain('not-a-real-workflow');
      expect(fs.existsSync(path.join(getNamedProfilesDir(), 'bad.yaml'))).toBe(false);
    });

    it('refuses deleting a built-in profile', async () => {
      const h = await startServer();
      const res = await post(h.port, { op: 'delete', name: 'full' });
      expect(res.status).toBe(400);
      expect(res.json().error.code).toBe('reserved_name');
    });
  });
});
