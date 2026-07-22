import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import { isManagementPath, type ManagementApiContext } from '../../../src/core/management-api/router.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'test-token-task-detail';

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

function writeChange(root: string, name: string, files: Record<string, string>): void {
  const dir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

describe('isManagementPath includes task-id paths', () => {
  it('recognizes /api/v1/tasks/<id> and tolerates one trailing slash, but not a deeper suffix', () => {
    expect(isManagementPath('/api/v1/tasks/redesign')).toBe(true);
    expect(isManagementPath('/api/v1/tasks/redesign/')).toBe(true);
    expect(isManagementPath('/api/v1/tasks/redesign/extra')).toBe(false);
    expect(isManagementPath('/api/v1/tasks/')).toBe(false);
  });
});

describe('GET /api/v1/tasks/:id (task-detail router wiring)', () => {
  let tempDir: string;
  let dataDir: string;
  let launchRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let handle: ManagementServerHandle;

  async function startServer(overrides: Partial<ManagementApiContext> = {}): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: launchRoot,
      launchProjectRef: { projectId: 'launch-proj', name: 'launch', root: launchRoot },
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-task-detail-api-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    launchRoot = path.join(tempDir, 'launch');
    createOpenSpecRoot(launchRoot);
    writeChange(launchRoot, 'redesign', { 'planning-context.md': '# Planning\n' });
    writeChange(launchRoot, 'redesign-api', { 'proposal.md': '# Proposal\n' });

    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  it('answers the launch project roster with 200 for a portfolio Task', async () => {
    const h = await startServer();
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/redesign', headers: authed() });
    expect(res.status).toBe(200);
    const body = res.json() as any;
    expect(body.task).toEqual({ id: 'redesign', kind: 'portfolio', label: 'redesign' });
    expect(body.children.map((c: any) => c.name)).toEqual(['redesign-api']);
  });

  it('405s a POST and a DELETE on a task-id path (GET-only)', async () => {
    const h = await startServer();
    for (const method of ['POST', 'DELETE', 'PUT']) {
      const res = await req(h.port, { method, path: '/api/v1/tasks/redesign', headers: authed() });
      expect(res.status, method).toBe(405);
    }
  });

  it('401s without a token', async () => {
    const h = await startServer();
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/redesign' });
    expect(res.status).toBe(401);
  });

  it('404s an unknown Task id', async () => {
    const h = await startServer();
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/ghost', headers: authed() });
    expect(res.status).toBe(404);
    expect((res.json() as any).error.code).toBe('task_not_found');
  });

  it('resolves ?space=project:<B> against B, not the launch project (parity with /changes)', async () => {
    const projectB = path.join(tempDir, 'project-b');
    createOpenSpecRoot(projectB);
    writeChange(projectB, 'b-change', { 'proposal.md': '# Proposal\n' });
    await registerProject({ projectRoot: projectB, projectId: 'proj-b', mode: 'in-repo' }, { globalDataDir: dataDir });

    const h = await startServer();
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/b-change?space=project:proj-b', headers: authed() });
    expect(res.status).toBe(200);
    const body = res.json() as any;
    expect(body.task).toEqual({ id: 'b-change', kind: 'single', label: 'b-change' });
  });

  it('400s a bare (prefix-less) selector, like /changes', async () => {
    const h = await startServer();
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/redesign?space=team', headers: authed() });
    expect(res.status).toBe(400);
    expect((res.json() as any).error.code).toBe('invalid_space');
  });

  it('404s space_not_found for an unknown project selector', async () => {
    const h = await startServer();
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/redesign?space=project:ghost', headers: authed() });
    expect(res.status).toBe(404);
    expect((res.json() as any).error.code).toBe('space_not_found');
  });

  it('400s project_required when launched outside a project with no selector', async () => {
    const h = await startServer({ launchProjectRoot: null, launchProjectRef: null });
    const res = await req(h.port, { method: 'GET', path: '/api/v1/tasks/redesign', headers: authed() });
    expect(res.status).toBe(400);
    expect((res.json() as any).error.code).toBe('project_required');
  });
});
