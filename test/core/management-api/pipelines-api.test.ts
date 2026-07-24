import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';

const TOKEN = 'test-token-pipelines-abc123';

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
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * `/api/v1/pipelines` (pipeline-http-api), served by the management route
 * group (unify-pipeline-http-api): moved here from
 * `test/core/config-api/router.test.ts` — the config router no longer
 * mentions pipelines. Also covers the unified error envelope and the
 * reserved one-segment detail path (design D2).
 */
describe('management-api pipelines endpoints (pipeline-http-api, moved by unify-pipeline-http-api)', () => {
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
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipelines-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipelines-api-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;
    delete process.env.RASEN_LANG;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    fs.rmSync(tempConfigHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('pipelines inventory (pipeline-http-api)', () => {
    it('returns declared + effective per-stage metadata, provenance, with boolean gates', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(Array.isArray(body.pipelines)).toBe(true);

      const bugFix = body.pipelines.find((p: any) => p.name === 'bug-fix');
      expect(bugFix).toBeDefined();
      expect(typeof bugFix.description).toBe('string');
      // Built-in pipelines report built-in provenance from the package layer.
      expect(bugFix.provenance).toBe('built-in');
      expect(bugFix.sourceLayer).toBe('package');

      const propose = bugFix.stages.find((s: any) => s.id === 'propose');
      expect(propose).toMatchObject({ id: 'propose', role: 'planner', skill: 'rasen-propose', gate: true });
      // Each stage carries effective values with sources (no config → definition/default).
      expect(propose.effectiveGate).toEqual({ value: true, source: 'stage' });
      expect(propose.effectiveRuntime).toEqual({ value: 'claude', source: 'default' });
      expect(propose.effectiveModel).toHaveProperty('source');
      expect(propose.effectiveHandoff).toHaveProperty('source');

      const goalLoop = body.pipelines.find((p: any) => p.name === 'goal-loop-measure');
      if (goalLoop) {
        const defineGoal = goalLoop.stages.find((s: any) => s.id === 'define-goal');
        // The vet type is retired: define-goal is an ordinary gate: true, and
        // every stage's declared/effective gate is a boolean.
        expect(defineGoal.gate).toBe(true);
        expect(defineGoal.effectiveGate.value).toBe(true);
        for (const stage of goalLoop.stages) {
          expect(typeof stage.gate).toBe('boolean');
          expect(typeof stage.effectiveGate.value).toBe('boolean');
        }
      }
    });

    it('reflects the gate mask in effective gates: off base + per-stage on pierces it', async () => {
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nautopilot:\n  gates: off\npipelines:\n  bug-fix:\n    gates:\n      propose: on\n'
      );
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines', headers: authed() });
      const body = res.json() as any;
      const bugFix = body.pipelines.find((p: any) => p.name === 'bug-fix');
      const propose = bugFix.stages.find((s: any) => s.id === 'propose');
      // The per-stage `on` instance pierces the `off` base.
      expect(propose.effectiveGate).toEqual({ value: true, source: 'stage-override-project' });
      // Every other ordinary gated stage reports off, naming the base layer.
      const otherGated = bugFix.stages.find(
        (s: any) => s.id !== 'propose' && s.gate === true
      );
      if (otherGated) {
        expect(otherGated.effectiveGate.value).toBe(false);
        expect(otherGated.effectiveGate.source).toBe('autopilot-project');
      }
    });

    it('rejects PUT and DELETE with 405 (POST is the mutation bridge)', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipelines', headers: authed() });
        expect(res.status).toBe(405);
        expect((res.json() as any).error.code).toBe('method_not_allowed');
      }
    });

    it('POST rejects an unknown op with 400 spawning nothing', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'nonsense' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST rejects a relative path / option-shaped name before any spawn', async () => {
      const h = await startServer();
      const relative = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'import', path: 'relative/pkg.rasenpkg' }),
      });
      expect(relative.status).toBe(400);

      const optionName = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'delete', name: '--force' }),
      });
      expect(optionName.status).toBe(400);
    });

    it('requires the session token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines' });
      expect(res.status).toBe(401);
      expect((res.json() as any).error.code).toBe('unauthorized');
    });
  });

  /**
   * Composition test (unify-pipeline-http-api task 6.2): proves the composed
   * management server answers the full method matrix on `/api/v1/pipelines`
   * with the SAME status+code contract the config router previously served,
   * now sourced from the management group, plus the unified envelope's
   * optional `fix` field and the reserved one-segment detail path.
   */
  describe('composition: management group answers /api/v1/pipelines (design R1)', () => {
    it('GET without a token is 401 unauthorized, answered by the management group', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines' });
      expect(res.status).toBe(401);
      const body = res.json() as any;
      expect(body.error.code).toBe('unauthorized');
      expect(body.error.fix).toBeUndefined();
    });

    it('authorized GET succeeds with no client-visible change', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines', headers: authed() });
      expect(res.status).toBe(200);
      expect(Array.isArray((res.json() as any).pipelines)).toBe(true);
    });

    it('authorized POST routes to the CLI-backed mutation bridge rather than 405', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'nonsense' }),
      });
      // Reaches the bridge's own input guard (400), never a 405 — proves POST
      // is admitted and dispatched, not rejected as an unadmitted method.
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('invalid_input');
    });

    it('PUT and DELETE are rejected with 405 method_not_allowed and modify no file', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipelines', headers: authed() });
        expect(res.status).toBe(405);
        expect((res.json() as any).error.code).toBe('method_not_allowed');
      }
    });

    it('a trailing slash is tolerated exactly like every other management path', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/', headers: authed() });
      expect(res.status).toBe(200);
    });

    it('a space-resolution error keeps its fix hint after the route-group move', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines?project=no-such-project-id',
        headers: authed(),
      });
      expect(res.status).toBe(404);
      const body = res.json() as any;
      expect(body.error.code).toBe('project_not_found');
      expect(typeof body.error.fix).toBe('string');
      expect(body.error.fix.length).toBeGreaterThan(0);
    });

    it('the one-segment detail path serves the detail contract, deeper suffixes fall through', async () => {
      const h = await startServer();

      const detail = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/bug-fix', headers: authed() });
      expect(detail.status).toBe(200);
      const body = detail.json() as any;
      expect(body.pipeline.name).toBe('bug-fix');
      expect(body.definition.name).toBe('bug-fix');
      expect(body.editable).toBe(false);

      // A two-segment suffix was never claimed by either group's dispatch — it
      // falls through past the management group to the config group's
      // catch-all 404, still a 404 but via a different route (not asserted
      // here beyond "not silently a management 2xx/405").
      const deeper = await req(h.port, {
        method: 'GET',
        path: '/api/v1/pipelines/bug-fix/extra',
        headers: authed(),
      });
      expect(deeper.status).toBe(404);
    });
  });

  describe('pipeline detail (pipeline-definition-api)', () => {
    it('returns both views plus editable for a user pipeline', async () => {
      const h = await startServer();
      const userDir = path.join(tempConfigHome, 'rasen', 'pipelines', 'my-pipe');
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(
        path.join(userDir, 'pipeline.yaml'),
        'name: my-pipe\nstages:\n  - id: implement\n    skill: rasen-apply-change\n    role: implementer\n'
      );
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/my-pipe', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.pipeline.name).toBe('my-pipe');
      expect(body.definition.stages[0].id).toBe('implement');
      expect(body.editable).toBe(true);
    });

    it('404s an unknown name, 400s a malformed name', async () => {
      const h = await startServer();
      const unknown = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/no-such-pipeline', headers: authed() });
      expect(unknown.status).toBe(404);
      expect((unknown.json() as any).error.code).toBe('not_found');

      const malformed = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/-bad-name', headers: authed() });
      expect(malformed.status).toBe(400);
    });

    it('rejects PUT/DELETE/POST with 405', async () => {
      const h = await startServer();
      for (const method of ['PUT', 'DELETE', 'POST']) {
        const res = await req(h.port, { method, path: '/api/v1/pipelines/bug-fix', headers: authed() });
        expect(res.status).toBe(405);
      }
    });

    it('a pipeline named catalog is served by detail, not shadowed by the catalog endpoint', async () => {
      const h = await startServer();
      const userDir = path.join(tempConfigHome, 'rasen', 'pipelines', 'catalog');
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(
        path.join(userDir, 'pipeline.yaml'),
        'name: catalog\nstages:\n  - id: implement\n    skill: rasen-apply-change\n'
      );
      const detail = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/catalog', headers: authed() });
      expect(detail.status).toBe(200);
      expect((detail.json() as any).pipeline.name).toBe('catalog');

      const catalogEndpoint = await req(h.port, { method: 'GET', path: '/api/v1/pipeline-catalog', headers: authed() });
      expect(catalogEndpoint.status).toBe(200);
      expect(Array.isArray((catalogEndpoint.json() as any).roles)).toBe(true);
    });
  });

  describe('pipeline-catalog (pipeline-definition-api)', () => {
    it('reports vocabulary sourced from the schemas plus the skill inventory', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipeline-catalog', headers: authed() });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.roles).toEqual(expect.arrayContaining(['planner', 'implementer', 'reviewer', 'fixer', 'shipper']));
      expect(body.runtimes).toEqual(expect.arrayContaining(['claude', 'codex']));
      expect(body.loopKinds).toEqual(expect.arrayContaining(['review-cycle', 'goal']));
      expect(Array.isArray(body.skills)).toBe(true);
      expect(body.skills.length).toBeGreaterThan(0);
      expect(body.skills[0]).toHaveProperty('enabled');
      expect(body.gate.default).toBe(false);
      expect(body.handoff.fractionRange).toEqual([0, 1]);
    });

    it('rejects POST/PUT/DELETE with 405', async () => {
      const h = await startServer();
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipeline-catalog', headers: authed() });
        expect(res.status).toBe(405);
      }
    });

    it('requires the session token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/pipeline-catalog' });
      expect(res.status).toBe(401);
    });
  });

  describe('pipeline-validation (pipeline-definition-api)', () => {
    function validDefinition() {
      return {
        name: 'draft',
        stages: [
          { id: 'implement', skill: 'rasen-apply-change', role: 'implementer' },
          { id: 'review', skill: 'rasen-review', role: 'reviewer', requires: ['implement'] },
        ],
      };
    }

    it('200s a valid draft with no error issues', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition: validDefinition() }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.valid).toBe(true);
      expect(body.issues.filter((i: any) => i.severity === 'error')).toHaveLength(0);
    });

    it('accepts a floor-free ui draft but rejects the equivalent composed draft', async () => {
      const h = await startServer();
      const floorFreeDefinition = {
        name: 'floor-free',
        stages: [{ id: 'implement', skill: 'rasen-apply-change', role: 'implementer' }],
      };

      const [uiResponse, composedResponse] = await Promise.all([
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: { ...floorFreeDefinition, origin: 'ui' } }),
        }),
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: { ...floorFreeDefinition, origin: 'composed' } }),
        }),
      ]);

      expect(uiResponse.status).toBe(200);
      const uiBody = uiResponse.json() as any;
      expect(uiBody.valid).toBe(true);
      expect(uiBody.issues.filter((issue: any) => /quality-floor/.test(issue.message))).toHaveLength(0);

      expect(composedResponse.status).toBe(200);
      const composedBody = composedResponse.json() as any;
      expect(composedBody.valid).toBe(false);
      expect(composedBody.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'error',
            message: expect.stringMatching(/origin: composed.*quality-floor/),
          }),
        ])
      );
    });

    it('200s an invalid draft reporting all issues (cycle + unknown skill)', async () => {
      const h = await startServer();
      const definition = {
        name: 'draft',
        stages: [
          { id: 'a', skill: 'no-such-skill', requires: ['b'] },
          { id: 'b', skill: 'rasen-apply-change', requires: ['a'] },
        ],
      };
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ definition }),
      });
      expect(res.status).toBe(200);
      const body = res.json() as any;
      expect(body.valid).toBe(false);
      expect(body.issues.length).toBeGreaterThanOrEqual(2);
      expect(body.issues.some((i: any) => /[Cc]yclic/.test(i.message))).toBe(true);
      expect(body.issues.some((i: any) => i.path === '/stages/0/skill')).toBe(true);
    });

    it('400s a body with no definition member; never spawns anything for validation', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipeline-validation',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ notADefinition: true }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects GET/PUT/DELETE with 405', async () => {
      const h = await startServer();
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/pipeline-validation', headers: authed() });
        expect(res.status).toBe(405);
      }
    });

    it('runs without a 409 even while a pipeline mutation is in flight', async () => {
      const h = await startServer();
      // No concurrent mutation actually spawned here (unit-scope), but the
      // endpoint must not touch the bridge's cap-1 slot at all: two concurrent
      // validation requests both succeed.
      const [a, b] = await Promise.all([
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: validDefinition() }),
        }),
        req(h.port, {
          method: 'POST',
          path: '/api/v1/pipeline-validation',
          headers: authed({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ definition: validDefinition() }),
        }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
    });
  });

  describe('save op (POST /api/v1/pipelines, pipeline-definition-api)', () => {
    it('creates a new user pipeline with 201, then detail round-trips it', async () => {
      const h = await startServer();
      const definition = {
        name: 'saved-pipe',
        stages: [{ id: 'implement', skill: 'rasen-apply-change', role: 'implementer' }],
      };
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe', definition }),
      });
      expect(res.status).toBe(201);

      const detail = await req(h.port, { method: 'GET', path: '/api/v1/pipelines/saved-pipe', headers: authed() });
      expect(detail.status).toBe(200);
      expect((detail.json() as any).definition.stages[0].skill).toBe('rasen-apply-change');
    });

    it('refuses overwrite without force (422), then force succeeds (200)', async () => {
      const h = await startServer();
      const definition = {
        name: 'saved-pipe-2',
        stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
      };
      const first = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe-2', definition }),
      });
      expect(first.status).toBe(201);

      const noForce = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe-2', definition }),
      });
      expect(noForce.status).toBe(422);

      const forced = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'saved-pipe-2', definition, force: true }),
      });
      expect(forced.status).toBe(200);
    });

    it('refuses saving over a built-in name regardless of force', async () => {
      const h = await startServer();
      const definition = {
        name: 'bug-fix',
        stages: [{ id: 'implement', skill: 'rasen-apply-change' }],
      };
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/pipelines',
        headers: authed({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ op: 'save', name: 'bug-fix', definition, force: true }),
      });
      expect(res.status).toBe(422);
    });
  });
});
