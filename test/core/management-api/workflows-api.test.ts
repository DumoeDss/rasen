import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { scaffoldWorkflow, importWorkflow } from '../../../src/core/workflow-library.js';

const TOKEN = 'test-token-workflows-abc123';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
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

/**
 * Read-endpoint coverage for the workflow-http-api paths (design D3): the
 * listing, detail, and validation reads served under the management security
 * posture. Seeds a real user workflow into an isolated `RASEN_HOME` so the
 * in-process handlers (which read the catalog fresh from env each request)
 * agree with the CLI by construction. The mutation bridge's own mechanics
 * (argv, cap-1, 422 passthrough) live in `workflow-submit.test.ts`.
 */
describe('management-api workflow read endpoints (workflow-http-api design D3)', () => {
  let home: string;
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

  /** Scaffolds an empty draft under a fresh temp parent and returns its absolute path (not installed). */
  function draft(id: string): string {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-draft-'));
    return scaffoldWorkflow(id, path.join(parent, id));
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflows-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflows-api-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    // RASEN_HOME overrides XDG — isolate the user library so a seeded user
    // workflow is deterministic and cannot pick up the host machine's.
    process.env.RASEN_HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('GET /api/v1/workflows (listing)', () => {
    it('lists built-in and user workflows with kind/source/skill/digest, marking an unreferenced user workflow unused', async () => {
      await importWorkflow(draft('wt-unused-flow'));
      const h = await startServer();

      const res = await req(h.port, { method: 'GET', path: '/api/v1/workflows', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json();

      // Built-ins are present and annotated.
      const builtins = body.workflows.filter((w: any) => w.source === 'built-in');
      expect(builtins.length).toBeGreaterThan(0);
      for (const w of builtins) {
        expect(typeof w.id).toBe('string');
        expect(typeof w.kind).toBe('string');
        expect(typeof w.digest).toBe('string');
        expect(typeof w.skillName).toBe('string');
      }

      // The seeded user workflow is present, source 'user', and unused (no
      // global-selection, profile, dependency, pipeline, or ledger consumer) —
      // the same marker `workflow list --unused` computes.
      const seeded = body.workflows.find((w: any) => w.id === 'wt-unused-flow');
      expect(seeded).toBeDefined();
      expect(seeded.source).toBe('user');
      expect(seeded.unused).toBe(true);
    });

    it('reports an invalid user entry in the invalid collection rather than dropping it', async () => {
      // A directory whose manifest id disagrees with the directory name fails
      // validation and lands in `catalog.invalid`.
      const badDir = path.join(home, 'workflows', 'bad-flow');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(
        path.join(badDir, 'workflow.yaml'),
        'version: 1\nid: a-different-id\ncommand:\n  enabled: false\n'
      );
      fs.writeFileSync(
        path.join(badDir, 'SKILL.md'),
        '---\nname: rasen-bad-flow\ndescription: x\n---\n\n# bad-flow\n'
      );
      const h = await startServer();

      const res = await req(h.port, { method: 'GET', path: '/api/v1/workflows', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json();
      const invalid = body.invalid.find((e: any) => e.id === 'bad-flow');
      expect(invalid).toBeDefined();
      expect(invalid.valid).toBe(false);
      expect(Array.isArray(invalid.diagnostics)).toBe(true);
      expect(invalid.diagnostics.length).toBeGreaterThan(0);
    });

    it('reflects a workflow imported between two requests without a server restart (fresh read)', async () => {
      const h = await startServer();

      const before = (await req(h.port, { method: 'GET', path: '/api/v1/workflows', headers: authed() })).json();
      expect(before.workflows.some((w: any) => w.id === 'wt-fresh-flow')).toBe(false);

      await importWorkflow(draft('wt-fresh-flow'));

      const after = (await req(h.port, { method: 'GET', path: '/api/v1/workflows', headers: authed() })).json();
      expect(after.workflows.some((w: any) => w.id === 'wt-fresh-flow')).toBe(true);
    });
  });

  describe('GET /api/v1/workflows/<id> (detail)', () => {
    it('returns the definition and usage for a built-in, one segment deep', async () => {
      const h = await startServer();
      const list = (await req(h.port, { method: 'GET', path: '/api/v1/workflows', headers: authed() })).json();
      const builtinId = list.workflows.find((w: any) => w.source === 'built-in').id;

      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflows/${encodeURIComponent(builtinId)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.workflow.id).toBe(builtinId);
      expect(typeof body.workflow.skill.name).toBe('string');
      // The four dependency slots and file inventory are present.
      expect(body.workflow.requires).toHaveProperty('workflows');
      expect(body.workflow.requires).toHaveProperty('skills');
      expect(body.workflow.requires).toHaveProperty('pipelines');
      expect(body.workflow.requires).toHaveProperty('schemas');
      expect(Array.isArray(body.workflow.files)).toBe(true);
      expect(Array.isArray(body.usage)).toBe(true);
    });

    it('404s an id present in neither the valid nor invalid catalog', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/workflows/no-such-workflow-here',
        headers: authed(),
      });
      expect(res.status).toBe(404);
      expect(res.json().error.code).toBe('workflow_not_found');
    });

    it('does not answer a deeper suffix as a workflow path (falls through)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/workflows/some-id/extra',
        headers: authed(),
      });
      // Not a management path → handled by the rest of the server's routing,
      // never the workflow detail handler's 404 envelope.
      expect(res.status).not.toBe(200);
      expect(res.body).not.toContain('workflow_not_found');
    });
  });

  describe('GET /api/v1/workflow-validation', () => {
    it('validates an installed id as valid', async () => {
      await importWorkflow(draft('wt-valid-flow'));
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/workflow-validation?target=wt-valid-flow',
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.validation.valid).toBe(true);
      expect(body.validation.kind).toBe('installed');
    });

    it('validates a draft directory by absolute path without installing it (read-only)', async () => {
      const draftPath = draft('wt-draft-only'); // absolute, not imported
      const h = await startServer();

      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-validation?target=${encodeURIComponent(draftPath)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.validation.valid).toBe(true);
      expect(body.validation.kind).toBe('directory');

      // Read-only guarantee: validating the draft never installed it.
      const list = (await req(h.port, { method: 'GET', path: '/api/v1/workflows', headers: authed() })).json();
      expect(list.workflows.some((w: any) => w.id === 'wt-draft-only')).toBe(false);
    });

    it('accepts a Windows/POSIX-native absolute path built with path.join', async () => {
      // path.join yields the platform's native separator; the guard's
      // path.isAbsolute accepts both `E:\…` and `/…` forms.
      const draftParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wt-native-'));
      const nativeAbs = path.join(draftParent, 'wt-native');
      scaffoldWorkflow('wt-native', nativeAbs);
      expect(path.isAbsolute(nativeAbs)).toBe(true);
      const h = await startServer();

      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-validation?target=${encodeURIComponent(nativeAbs)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      expect(res.json().validation.kind).toBe('directory');
      fs.rmSync(draftParent, { recursive: true, force: true });
    });

    it('400s a relative target that matches no installed id, probing no filesystem location', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/workflow-validation?target=${encodeURIComponent('../somewhere/wf')}`,
        headers: authed(),
      });
      expect(res.status).toBe(400);
      expect(res.json().error.code).toBe('invalid_input');
    });
  });

  describe('auth and method guards', () => {
    it('401s the workflow paths with no token', async () => {
      const h = await startServer();
      for (const p of ['/api/v1/workflows', '/api/v1/workflow-validation?target=x', '/api/v1/workflows/some-id']) {
        const res = await req(h.port, { method: 'GET', path: p });
        expect(res.status, p).toBe(401);
        expect(res.json().error.code).toBe('unauthorized');
      }
    });

    it('405s PUT and DELETE on /api/v1/workflows', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/workflows', headers: authed() });
        expect(res.status, method).toBe(405);
        expect(res.json().error.code).toBe('method_not_allowed');
      }
    });

    it('405s POST on /api/v1/workflow-validation (GET-only)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflow-validation?target=x',
        headers: authed(),
      });
      expect(res.status).toBe(405);
    });

    it('405s PUT and DELETE on a workflow detail path', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/workflows/some-id', headers: authed() });
        expect(res.status, method).toBe(405);
      }
    });

    it('routes an authorized POST /api/v1/workflows to the bridge (unknown op → 400, not 405)', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/workflows',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'nope' }),
      });
      // Admitted (not 405); the bridge's own guard rejects the unknown op.
      expect(res.status).toBe(400);
    });
  });
});
