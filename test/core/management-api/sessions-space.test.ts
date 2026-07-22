import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { getStoreMetadataPath } from '../../../src/core/store/foundation.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'test-token-sessions-space';

interface HttpResult {
  status: number;
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
          resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) });
        });
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

function writeChange(root: string, name: string, extra?: (changeDir: string) => void): void {
  const changeDir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal\n');
  extra?.(changeDir);
}

describe('sessions space attribution (planning-space-addressing design D3)', () => {
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

  async function launchSession(port: number, body: Record<string, unknown>): Promise<HttpResult> {
    return req(port, {
      method: 'POST',
      path: '/api/v1/sessions',
      headers: { ...authed(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-sessions-space-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    launchRoot = path.join(tempDir, 'launch');
    createOpenSpecRoot(launchRoot);

    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
    process.env.RASEN_CLAUDE_BIN = fakeClaudeBin;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  it('launches into an explicitly selected space: subprocess cwd is the space root and the record carries that attribution', async () => {
    const projectB = path.join(tempDir, 'project-b');
    createOpenSpecRoot(projectB);
    await registerProject({ projectRoot: projectB, projectId: 'proj-b', mode: 'in-repo' }, { globalDataDir: dataDir });

    const h = await startServer();
    const res = await launchSession(h.port, { kind: 'auto', task: 'MODE=fast-exit x', space: 'project:proj-b' });
    expect(res.status).toBe(201);
    const session = (res.json() as any).session;
    expect(session.cwd).toBe(FileSystemUtils.canonicalizeExistingPath(projectB));
    expect(session.space).toEqual({ type: 'project', id: 'proj-b', root: FileSystemUtils.canonicalizeExistingPath(projectB) });
  });

  it('an unresolvable space selector spawns nothing', async () => {
    const h = await startServer();
    const res = await launchSession(h.port, { kind: 'auto', task: 'MODE=fast-exit x', space: 'store:ghost' });
    expect(res.status).toBe(404);
    expect((res.json() as any).error.code).toBe('space_not_found');

    const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
    expect((listRes.json() as any).sessions).toEqual([]);
  });

  it('filters the listing by space; the unfiltered listing returns every session', async () => {
    const projectB = path.join(tempDir, 'filter-b');
    createOpenSpecRoot(projectB);
    await registerProject({ projectRoot: projectB, projectId: 'filter-b', mode: 'in-repo' }, { globalDataDir: dataDir });
    const storeRoot = path.join(tempDir, 'filter-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'filter-team', localPath: storeRoot, globalDataDir: dataDir });

    const h = await startServer();
    const inB = (await launchSession(h.port, { kind: 'auto', task: 'MODE=fast-exit b', space: 'project:filter-b' })).json() as any;
    const inStore = (await launchSession(h.port, { kind: 'auto', task: 'MODE=fast-exit s', space: 'store:filter-team' })).json() as any;

    const filtered = await req(h.port, { method: 'GET', path: '/api/v1/sessions?space=project:filter-b', headers: authed() });
    const filteredIds = (filtered.json() as any).sessions.map((e: any) => e.session.id);
    expect(filteredIds).toEqual([inB.session.id]);

    const all = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
    const allIds = (all.json() as any).sessions.map((e: any) => e.session.id).sort();
    expect(allIds).toEqual([inB.session.id, inStore.session.id].sort());
  });

  it('joins run-state against the session\'s own space (change in B joined while the daemon was launched in A)', async () => {
    const projectB = path.join(tempDir, 'join-b');
    createOpenSpecRoot(projectB);
    writeChange(projectB, 'b-change', (dir) =>
      fs.writeFileSync(path.join(dir, 'auto-run.json'), JSON.stringify({ pipeline: 'small-feature', stages: {} }))
    );
    await registerProject({ projectRoot: projectB, projectId: 'join-b', mode: 'in-repo' }, { globalDataDir: dataDir });

    const h = await startServer();
    const launched = (await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit x',
      changeName: 'b-change',
      space: 'project:join-b',
    })).json() as any;

    const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
    const entry = (listRes.json() as any).sessions.find((e: any) => e.session.id === launched.session.id);
    expect(entry.runState.kind).toBe('ok');
    expect(entry.runState.autoRun.kind).toBe('ok');
    expect(entry.runState.autoRun.state.pipeline).toBe('small-feature');
  });

  it('freezes the attribution: it survives a later change to the space\'s registration', async () => {
    const storeRoot = path.join(tempDir, 'frozen-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'frozen-team', localPath: storeRoot, globalDataDir: dataDir });

    const h = await startServer();
    const launched = (await launchSession(h.port, { kind: 'auto', task: 'MODE=fast-exit x', space: 'store:frozen-team' })).json() as any;
    const id = launched.session.id;
    expect(launched.session.space).toEqual({
      type: 'store',
      id: 'frozen-team',
      root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
    });

    // Break the store's identity metadata after launch — the frozen record
    // must not re-derive or drop its attribution.
    fs.rmSync(getStoreMetadataPath(storeRoot), { force: true });

    const detail = await req(h.port, { method: 'GET', path: `/api/v1/sessions/${id}`, headers: authed() });
    expect(detail.status).toBe(200);
    expect((detail.json() as any).session.space).toEqual({
      type: 'store',
      id: 'frozen-team',
      root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
    });
  });
});
