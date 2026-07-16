import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startConfigApiServer, type ConfigApiServerHandle } from '../../../src/core/config-api/server.js';
import type { ConfigApiContext } from '../../../src/core/config-api/router.js';
import { getGlobalConfigPath } from '../../../src/core/global-config.js';
import { registerProject } from '../../../src/core/project-registry.js';

const TOKEN = 'test-token-abc123';

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
        agent: false, // never reuse a keep-alive socket across test requests
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
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

describe('config-api router (integration, via real http server)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let otherProjectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ConfigApiServerHandle;

  async function startServer(overrides: Partial<ConfigApiContext> = {}): Promise<ConfigApiServerHandle> {
    const context: ConfigApiContext = {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'proj', root: projectRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
      ...overrides,
    };
    handle = await startConfigApiServer({ context });
    return handle;
  }

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, ...extra };
  }

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-api-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-api-other-proj-'));
    fs.mkdirSync(path.join(otherProjectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(otherProjectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    fs.rmSync(tempConfigHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(otherProjectRoot, { recursive: true, force: true });
  });

  describe('auth', () => {
    it('rejects a request with no token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/health' });
      expect(res.status).toBe(401);
      expect((res.json() as any).error.code).toBe('unauthorized');
    });

    it('rejects a request with the wrong token', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/health',
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a request with the correct token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/health', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.version).toBe('0.0.0-test');
      expect(body.project).toEqual({ projectId: 'launch-proj', name: 'proj', root: projectRoot });
    });
  });

  describe('config list/get', () => {
    it('lists effective entries with sources', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/config', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      const threshold = body.entries.find((e: any) => e.definition.key === 'handoff.threshold');
      expect(threshold.source).toBe('default');
      expect(threshold.definition.constraints).toEqual({ type: 'number', enumValues: undefined, range: { gt: 0, lte: 1 } });
    });

    it('gets a single key', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/config/handoff.threshold',
        headers: authed(),
      });
      expect(res.status).toBe(200);
      expect((res.json() as any).entry.definition.key).toBe('handoff.threshold');
    });

    it('404s an unregistered key with code unknown_key', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/config/not.a.real.key',
        headers: authed(),
      });
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('unknown_key');
    });
  });

  describe('writes', () => {
    it('rejects a PUT with no content-type', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/repoMode',
        headers: authed(),
        body: JSON.stringify({ scope: 'global', value: 'solo' }),
      });
      expect(res.status).toBe(415);
    });

    it('rejects a PUT with a missing scope, without writing anything', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/repoMode',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ value: 'solo' }),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('scope_required');
      expect(fs.existsSync(getGlobalConfigPath())).toBe(false);
    });

    it('rejects an out-of-enum global value with invalid_value and does not write', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/repoMode',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'global', value: 'bogus' }),
      });
      expect(res.status).toBe(400);
      const body = res.json() as any;
      expect(body.error.code).toBe('invalid_value');
      expect(body.error.message).toContain('solo');
      expect(fs.existsSync(getGlobalConfigPath())).toBe(false);
    });

    it('rejects a machine-managed key with not_settable', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/telemetry.anonymousId',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'global', value: 'abc' }),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('not_settable');
    });

    it('sets a project-scope value and re-resolves it', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/handoff.threshold',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 0.4 }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.entry.value).toBe(0.4);
      expect(body.entry.source).toBe('project');
      const yaml = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(yaml).toContain('threshold: 0.4');
    });

    it('unsets a project value, reverting to the global layer', async () => {
      const h = await startServer();
      await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/handoff.threshold',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'global', value: 0.6 }),
      });
      await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/handoff.threshold',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 0.4 }),
      });

      const res = await req(h.port, {
        method: 'DELETE',
        path: '/api/v1/config/handoff.threshold?scope=project',
        headers: authed({ 'Content-Type': 'application/json' }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.entry.value).toBe(0.6);
      expect(body.entry.source).toBe('global');
    });

    it('MIN4 regression: a global PUT touches only the target key, leaving never-set keys absent', async () => {
      const h = await startServer();
      await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/repoMode',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'global', value: 'solo' }),
      });
      const raw = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
      expect(raw).toEqual({ repoMode: 'solo' });
      expect(raw).not.toHaveProperty('proactive');
      expect(raw).not.toHaveProperty('profile');
    });

    it('rejects a project-scope write with no resolvable project (no fallback to global)', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/handoff.threshold',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 0.4 }),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('project_required');
      expect(fs.existsSync(getGlobalConfigPath())).toBe(false);
    });

    it('rejects a body over the size cap with 413', async () => {
      const h = await startServer();
      const bigValue = 'x'.repeat(70 * 1024);
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/schema',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: bigValue }),
      });
      expect(res.status).toBe(413);
    });
  });

  describe('invalid on-disk values', () => {
    it('surfaces a warning without rewriting the file', async () => {
      fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
      fs.writeFileSync(getGlobalConfigPath(), JSON.stringify({ handoff: { threshold: 5 } }));

      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/config/handoff.threshold',
        headers: authed(),
      });
      const body = res.json() as any;
      expect(body.entry.value).toBe(5);
      expect(body.entry.warnings[0]).toContain('Invalid global value on disk');

      const rawAfter = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
      expect(rawAfter).toEqual({ handoff: { threshold: 5 } }); // untouched
    });

    it('B1 regression: a corrupt (unparseable) global config file is never clobbered by a PUT', async () => {
      fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
      const corrupt = '{ "proactive": false, "repoMode": "solo", }'; // trailing comma
      fs.writeFileSync(getGlobalConfigPath(), corrupt);

      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/handoff.threshold',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'global', value: 0.3 }),
      });

      expect(res.status).not.toBe(200);
      expect(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).toBe(corrupt);
    });

    it('B1 regression: a corrupt global config file is never clobbered by a DELETE', async () => {
      fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
      const corrupt = '{ "proactive": false, }';
      fs.writeFileSync(getGlobalConfigPath(), corrupt);

      const h = await startServer();
      const res = await req(h.port, {
        method: 'DELETE',
        path: '/api/v1/config/repoMode?scope=global',
        headers: authed({ 'Content-Type': 'application/json' }),
      });

      expect(res.status).not.toBe(200);
      expect(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).toBe(corrupt);
    });
  });

  describe('review-round-1 fixes (M1-M4)', () => {
    it('M1: malformed percent-encoding in the key path returns 400, not 500', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/config/%zz',
        headers: authed(),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('bad_request');
    });

    it('M1: malformed percent-encoding on a static path falls back to the hint page, not a 500', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/%zz' });
      expect(res.status).toBe(200);
    });

    it('M2: a non-string body "project" on PUT is rejected, not silently ignored', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/handoff.threshold',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 0.4, project: 123 }),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('bad_request');
      // Must not have silently written to the launch project either.
      const launchYaml = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(launchYaml).not.toContain('threshold');
    });

    it('M3: a wrong-scope write on a real (single-scope) key answers invalid_scope, not unknown_key', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: '/api/v1/config/repoMode', // global-only key
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 'solo' }),
      });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('invalid_scope');
    });

    it('M4: a global fs-layer write failure maps to write_failed, not internal_error', async () => {
      if (process.platform === 'win32') return; // chmod-based permission denial is unreliable on Windows
      fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
      // Make the config directory read-only so the write throws something
      // other than GlobalConfigWriteError (an fs-layer failure, e.g. EACCES).
      fs.chmodSync(path.dirname(getGlobalConfigPath()), 0o500);

      const h = await startServer();
      try {
        const res = await req(h.port, {
          method: 'PUT',
          path: '/api/v1/config/repoMode',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ scope: 'global', value: 'solo' }),
        });
        if (process.getuid?.() === 0) {
          return; // root bypasses the fs permission bit; nothing to assert
        }
        expect(res.status).toBe(500);
        expect((res.json() as any).error.code).toBe('write_failed');
      } finally {
        fs.chmodSync(path.dirname(getGlobalConfigPath()), 0o700);
      }
    });
  });

  describe('project addressing', () => {
    it('addresses a project by root path via query param', async () => {
      const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/config?project=${encodeURIComponent(projectRoot)}`,
        headers: authed(),
      });
      // projectRoot has never been registered, so the registry has no entry for it.
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('project_not_found');
    });

    it('404s an unknown project selector', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/config?project=does-not-exist',
        headers: authed(),
      });
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('project_not_found');
    });

    it('a cross-project write (by registered project id, distinct from the launch project) lands in that project\'s config.yaml, not the launch project\'s', async () => {
      const { entry } = await registerProject({
        projectRoot: otherProjectRoot,
        projectId: 'other-proj',
        mode: 'in-repo',
      });

      const h = await startServer(); // launch project is `projectRoot`, not `otherProjectRoot`
      const res = await req(h.port, {
        method: 'PUT',
        path: `/api/v1/config/handoff.threshold?project=${entry.projectId}`,
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 0.7 }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.entry.value).toBe(0.7);

      const otherYaml = fs.readFileSync(path.join(otherProjectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(otherYaml).toContain('threshold: 0.7');
      const launchYaml = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(launchYaml).not.toContain('threshold');
    });

    it('a cross-project write addressed by root path also lands in the right config.yaml', async () => {
      await registerProject({ projectRoot: otherProjectRoot, projectId: 'other-proj-2', mode: 'in-repo' });

      const h = await startServer();
      const res = await req(h.port, {
        method: 'PUT',
        path: `/api/v1/config/handoff.threshold?project=${encodeURIComponent(otherProjectRoot)}`,
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope: 'project', value: 0.8 }),
      });
      expect(res.status).toBe(200);
      const otherYaml = fs.readFileSync(path.join(otherProjectRoot, 'rasen', 'config.yaml'), 'utf-8');
      expect(otherYaml).toContain('threshold: 0.8');
    });
  });

  describe('projects endpoint', () => {
    it('returns an empty list when the registry has never been written', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/projects', headers: authed() });
      expect(res.status).toBe(200);
      expect((res.json() as any).projects).toEqual([]);
    });
  });

  describe('static fallback', () => {
    it('serves the install-hint page at / when no UI package is resolved (no auth required)', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/' });
      expect(res.status).toBe(200);
      expect(res.body).toContain('not installed');
    });
  });

  describe('unmatched routes', () => {
    it('404s an unmatched /api/ route', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/nope', headers: authed() });
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('not_found');
    });

    it('405s an unsupported method on /api/v1/health', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'POST', path: '/api/v1/health', headers: authed() });
      expect(res.status).toBe(405);
    });
  });
});
