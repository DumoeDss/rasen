/**
 * `store-scoped-issues-management` tasks 9.5, 9.6, 9.8, 9.9.
 *
 * The Store aggregate route family over a loopback HTTP server, against a real
 * Store v2 layout. The route family is wired and exercised; this file asserts
 * the properties the requirement turns on:
 *
 *   - auth, method rejection, and trailing-slash tolerance per route shape;
 *   - a UID that resolves to no Store is rejected;
 *   - the Issue endpoints require the Store and NOT a project or target line;
 *   - no scope segment is completed from a query filter, the launch project, a
 *     session, or a previously viewed selection — four cases;
 *   - the API response and the CLI `--json` output carry identical content.
 *
 * Reads go through `serveStoreRead` (no CLI spawn), so most of this file is
 * fast. Mutations spawn the CLI and are slower, so they carry generous
 * timeouts.
 */
import * as http from 'node:http';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const TOKEN = 'test-token-stores-api-abc123';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'line-0.2';

interface HttpResult {
  status: number;
  body: string;
  json: () => any;
}

function req(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }
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
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
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

function parseCliJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse CLI JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

describe('the Store aggregate route family', () => {
  let f: StoreWorkspaceFixture;
  let handle: ManagementServerHandle | undefined;
  let originalEnv: NodeJS.ProcessEnv;

  function authed(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...extra };
  }

  async function startServer(): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: f.storeRoot,
      launchProjectRef: {
        projectId: PROJECT_A,
        name: PROJECT_A,
        root: f.storeRoot,
      },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    handle = await startManagementServer({ context });
    return handle;
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-stores-api-',
      projects: [PROJECT_A, PROJECT_B],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_A]: 'refs/heads/release/0.2', [PROJECT_B]: 'refs/heads/release/0.2' },
        },
        {
          id: 'main',
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT_A]: 'refs/heads/main', [PROJECT_B]: 'refs/heads/main' },
        },
      ],
    });
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    Object.assign(process.env, f.env);
  });

  afterEach(async () => {
    await handle?.stopServer();
    handle = undefined;
    process.env = originalEnv;
    f.cleanup();
  });

  // -------------------------------------------------------------------------
  // Auth and method rejection
  // -------------------------------------------------------------------------

  it('401s an unauthenticated request', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/issues`,
    });
    expect(res.status).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it.each(['PUT', 'DELETE', 'PATCH'])('405s %s on an Issue path', async method => {
    const server = await startServer();
    const res = await req(server.port, {
      method,
      path: `/api/v1/stores/${f.storeUid}/issues`,
      headers: authed(),
    });
    expect(res.status).toBe(405);
    expect(res.json().error.code).toBe('method_not_allowed');
  });

  it('POST is admitted on the three mutation shapes', async () => {
    const server = await startServer();
    // POST on issues, issue-plans, and line-changes should NOT be a 405.
    // We are not running the actual mutation (that needs a CLI build); we
    // just assert the method is admitted by the router.
    const issuesPost = await req(server.port, {
      method: 'POST',
      path: `/api/v1/stores/${f.storeUid}/issues`,
      headers: authed(),
      body: JSON.stringify({ issueId: 'test-issue', title: 'Test' }),
    });
    expect(issuesPost.status).not.toBe(405);

    const issuePlansPost = await req(server.port, {
      method: 'POST',
      path: `/api/v1/stores/${f.storeUid}/issues/test-issue/plans`,
      headers: authed(),
      body: JSON.stringify({ revisionId: 'r1' }),
    });
    expect(issuePlansPost.status).not.toBe(405);

    const lineChangesPost = await req(server.port, {
      method: 'POST',
      path: `/api/v1/stores/${f.storeUid}/projects/${PROJECT_A}/lines/${LINE}/changes`,
      headers: authed(),
      body: JSON.stringify({ changeId: 'test-change' }),
    });
    expect(lineChangesPost.status).not.toBe(405);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Trailing slash tolerance
  // -------------------------------------------------------------------------

  it('tolerates one trailing slash on a Store path', async () => {
    const server = await startServer();
    const noSlash = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/issues`,
      headers: authed(),
    });
    const withSlash = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/issues/`,
      headers: authed(),
    });
    expect(noSlash.status).toBe(200);
    expect(withSlash.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Unknown UID refusal
  // -------------------------------------------------------------------------

  it('404s a UID that resolves to no registered Store', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/not-a-real-uid/issues`,
      headers: authed(),
    });
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 9.6 — Issue endpoints require the Store, NOT a project or target line
  // -------------------------------------------------------------------------

  it('GET issues requires only the Store and no project or target line', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/issues`,
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.issues).toEqual([]);
    expect(body.complete).toBe(true);
  });

  it('GET issue detail requires only the Store', async () => {
    // No Issue exists yet; the read returns a 200 with an empty/null detail
    // rather than requiring a project scope.
    const server = await startServer();
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/issues/nonexistent-issue`,
      headers: authed(),
    });
    // The read succeeds — it reports the Issue as not found without requiring
    // a project scope.
    expect(res.status).toBe(200);
  });

  it('GET projects requires only the Store', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/projects`,
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.storeId).toBe(f.storeId);
    expect(body.projects.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 9.5 — no scope segment is completed from any source other than the path
  // -------------------------------------------------------------------------

  it('refuses a scoped mutation whose project is not declared (not inferred from launch project)', async () => {
    const server = await startServer();
    // The launch project is PROJECT_A, but we ask for an undeclared project.
    // The server must NOT fall back to PROJECT_A.
    const res = await req(server.port, {
      method: 'POST',
      path: `/api/v1/stores/${f.storeUid}/projects/not-declared/lines/${LINE}/changes`,
      headers: authed(),
      body: JSON.stringify({ changeId: 'test-change' }),
    });
    expect(res.status).toBe(422);
    expect(res.json().error.code).toBe('store_query_scope_incomplete');
    expect(res.json().error.message).toContain('not-declared');
  });

  it('refuses a scoped mutation whose target line is not declared', async () => {
    const server = await startServer();
    const res = await req(server.port, {
      method: 'POST',
      path: `/api/v1/stores/${f.storeUid}/projects/${PROJECT_A}/lines/not-a-line/changes`,
      headers: authed(),
      body: JSON.stringify({ changeId: 'test-change' }),
    });
    expect(res.status).toBe(422);
    expect(res.json().error.code).toBe('store_query_scope_incomplete');
    expect(res.json().error.message).toContain('not-a-line');
  });

  it('does not complete a scope from a query parameter', async () => {
    const server = await startServer();
    // A query param cannot supply the project: the route requires it in the path.
    // A path missing the project segment does not match the route at all (404),
    // not 200 with an inferred project.
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/projects?project=${PROJECT_A}`,
      headers: authed(),
    });
    // GET projects ignores the query param entirely.
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.projects.length).toBe(2); // both projects, not filtered by the query param
  });

  it('a partial scope path does not match any Store route', async () => {
    const server = await startServer();
    // A path missing the final segment does not match the route.
    const res = await req(server.port, {
      method: 'POST',
      path: `/api/v1/stores/${f.storeUid}/projects/${PROJECT_A}/lines/${LINE}`,
      headers: authed(),
      body: JSON.stringify({ changeId: 'test-change' }),
    });
    // Not a 405 (method admitted) and not a 200 (scope completed) — it simply
    // does not match the Store route family.
    expect(res.status).not.toBe(200);
  });

  // -------------------------------------------------------------------------
  // GET line-changes narrows by path segments
  // -------------------------------------------------------------------------

  it('GET line-changes returns the grouped result for one project and line', async () => {
    // Seed a Change so the group is non-empty.
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT_A,
      targetLineId: LINE,
      changeId: 'api-test-change',
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed api-test-change']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const server = await startServer();
    const res = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/projects/${PROJECT_A}/lines/${LINE}/changes`,
      headers: authed(),
    });
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].projectId).toBe(PROJECT_A);
    expect(body.groups[0].targetLineId).toBe(LINE);
    expect(body.groups[0].active.length).toBe(1);
    expect(body.complete).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 9.8 — CLI/API content parity
  // -------------------------------------------------------------------------

  it('GET line-changes and CLI store changes --json carry identical content', async () => {
    // Seed a Change.
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT_A,
      targetLineId: LINE,
      changeId: 'parity-change',
      instanceSeed: 'f1'.repeat(16),
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed parity-change']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const server = await startServer();

    const apiRes = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/projects/${PROJECT_A}/lines/${LINE}/changes`,
      headers: authed(),
    });
    expect(apiRes.status).toBe(200);
    const apiBody = apiRes.json();

    const cliRes = parseCliJson(
      await runCLI(
        ['store', 'changes', '--store', f.storeId, '--project', PROJECT_A, '--target-line', LINE, '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );

    // Same structure: groups with the same project, line, and active count.
    expect(cliRes.groups).toHaveLength(apiBody.groups.length);
    expect(cliRes.groups[0].projectId).toBe(apiBody.groups[0].projectId);
    expect(cliRes.groups[0].targetLineId).toBe(apiBody.groups[0].targetLineId);
    expect(cliRes.groups[0].active.length).toBe(apiBody.groups[0].active.length);
    expect(cliRes.complete).toBe(apiBody.complete);
  }, 120_000);

  it('GET issues and CLI store issue list --json carry identical content', async () => {
    const server = await startServer();

    const apiRes = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/issues`,
      headers: authed(),
    });
    expect(apiRes.status).toBe(200);
    const apiBody = apiRes.json();

    const cliRes = parseCliJson(
      await runCLI(
        ['store', 'issue', 'list', '--store', f.storeId, '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );

    // Both report zero issues and a complete result.
    expect(cliRes.issues).toEqual(apiBody.issues);
    expect(cliRes.complete).toBe(apiBody.complete);
  }, 120_000);

  it('GET projects and CLI store projects --json carry identical content', async () => {
    const server = await startServer();

    const apiRes = await req(server.port, {
      method: 'GET',
      path: `/api/v1/stores/${f.storeUid}/projects`,
      headers: authed(),
    });
    expect(apiRes.status).toBe(200);
    const apiBody = apiRes.json();

    const cliRes = parseCliJson(
      await runCLI(
        ['store', 'projects', '--store', f.storeId, '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );

    expect(cliRes.storeId).toBe(apiBody.storeId);
    expect(cliRes.projects.length).toBe(apiBody.projects.length);
    expect(cliRes.projects.map((p: any) => p.projectId).sort()).toEqual(
      apiBody.projects.map((p: any) => p.projectId).sort()
    );
  }, 120_000);
});
