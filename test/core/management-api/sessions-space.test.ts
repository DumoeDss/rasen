import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { getProjectHomeDir, registerProject } from '../../../src/core/project-registry.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { getStoreMetadataPath } from '../../../src/core/store/foundation.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
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

function createPointerProject(root: string, projectId: string, storeId: string): void {
  fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'rasen', 'config.yaml'),
    `schema: spec-driven\nprojectId: ${projectId}\nstore: ${storeId}\n`
  );
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

  it('requires explicit Store execution and creates no Session record when it is omitted', async () => {
    const storeRoot = path.join(tempDir, 'required-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'required-store', localPath: storeRoot, globalDataDir: dataDir });

    const h = await startServer();
    const res = await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit must-not-spawn',
      space: 'store:required-store',
    });

    expect(res.status).toBe(409);
    expect((res.json() as any).error.code).toBe('execution_required');
    const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
    expect((listRes.json() as any).sessions).toEqual([]);
  });

  it('records Store planning attribution while executing in a current member', async () => {
    const storeRoot = path.join(tempDir, 'member-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'member-store', localPath: storeRoot, globalDataDir: dataDir });
    const memberRoot = path.join(tempDir, 'member-project');
    createPointerProject(memberRoot, 'member-project-id', 'member-store');
    await registerProject(
      { projectRoot: memberRoot, projectId: 'member-project-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'member-project-id',
      roles: { planning: true, knowledge: true },
    });

    const h = await startServer();
    const res = await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit member',
      space: 'store:member-store',
      execution: 'project:member-project-id',
    });

    expect(res.status).toBe(201);
    const session = (res.json() as any).session;
    expect(session.cwd).toBe(FileSystemUtils.canonicalizeExistingPath(memberRoot));
    expect(session.space).toEqual({
      type: 'store',
      id: 'member-store',
      root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
    });
  });

  it('records the selected clone root when current Store members share a project id', async () => {
    const storeRoot = path.join(tempDir, 'clone-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'clone-store', localPath: storeRoot, globalDataDir: dataDir });
    const cloneA = path.join(tempDir, 'clone-a');
    const cloneB = path.join(tempDir, 'clone-b');
    createPointerProject(cloneA, 'shared-clone-id', 'clone-store');
    createPointerProject(cloneB, 'shared-clone-id', 'clone-store');
    await registerProject(
      { projectRoot: cloneA, projectId: 'shared-clone-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await registerProject(
      { projectRoot: cloneB, projectId: 'shared-clone-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'shared-clone-id',
      roles: { planning: true, knowledge: true },
    });

    const h = await startServer();
    const res = await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit clone-b',
      space: 'store:clone-store',
      execution: `project:${cloneB}`,
    });

    expect(res.status).toBe(201);
    const session = (res.json() as any).session;
    expect(session.cwd).toBe(FileSystemUtils.canonicalizeExistingPath(cloneB));
    expect(session.cwd).not.toBe(FileSystemUtils.canonicalizeExistingPath(cloneA));
    expect(session.space).toEqual({
      type: 'store',
      id: 'clone-store',
      root: FileSystemUtils.canonicalizeExistingPath(storeRoot),
    });
  });

  it('uses a selected linked member worktree as the observable Session cwd', async () => {
    const storeRoot = path.join(tempDir, 'worktree-store');
    createOpenSpecRoot(storeRoot);
    writeChange(storeRoot, 'worktree-change', dir =>
      fs.writeFileSync(
        path.join(dir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'store-decoy', stages: {} })
      )
    );
    await registerStore({ id: 'worktree-store', localPath: storeRoot, globalDataDir: dataDir });
    const mainRoot = path.join(tempDir, 'worktree-main');
    const worktreeRoot = path.join(tempDir, 'worktree-selected');
    createPointerProject(mainRoot, 'worktree-member-id', 'worktree-store');
    execFileSync('git', ['init'], { cwd: mainRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRoot });
    execFileSync('git', ['config', 'user.name', 'Rasen Test'], { cwd: mainRoot });
    execFileSync('git', ['add', '.'], { cwd: mainRoot });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: mainRoot });
    execFileSync('git', ['worktree', 'add', '-b', 'api-worktree', worktreeRoot], { cwd: mainRoot });
    const { entry: worktreeMemberEntry } = await registerProject(
      { projectRoot: mainRoot, projectId: 'worktree-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'worktree-member-id',
      roles: { planning: true, knowledge: true },
    });
    for (const [root, pipeline] of [
      [mainRoot, 'main-decoy'],
      [worktreeRoot, 'linked-authoritative'],
      [launchRoot, 'launch-decoy'],
    ] as const) {
      const ephemera = path.join(
        root,
        '.rasen',
        'changes',
        'worktree-change',
        'ephemera'
      );
      fs.mkdirSync(ephemera, { recursive: true });
      fs.writeFileSync(
        path.join(ephemera, 'auto-run.json'),
        JSON.stringify({ pipeline, stages: {} })
      );
    }
    const legacyWork = path.join(
      getProjectHomeDir(worktreeMemberEntry.home, { globalDataDir: dataDir }),
      'changes',
      'worktree-change',
      'work'
    );
    fs.mkdirSync(legacyWork, { recursive: true });
    fs.writeFileSync(
      path.join(legacyWork, 'auto-run.json'),
      JSON.stringify({ pipeline: 'legacy-home-decoy', stages: {} })
    );

    const h = await startServer();
    const res = await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit worktree',
      changeName: 'worktree-change',
      space: 'store:worktree-store',
      execution: `project:${worktreeRoot}`,
    });

    expect(res.status).toBe(201);
    expect((res.json() as any).session.cwd).toBe(
      FileSystemUtils.canonicalizeExistingPath(worktreeRoot)
    );
    const sessionId = (res.json() as any).session.id;
    const listRes = await req(h.port, {
      method: 'GET',
      path: '/api/v1/sessions?space=store%3Aworktree-store',
      headers: authed(),
    });
    const listed = (listRes.json() as any).sessions.find(
      (entry: any) => entry.session.id === sessionId
    );
    expect(listed.runState.kind).toBe('ok');
    expect(listed.runState.autoRun.state.pipeline).toBe('linked-authoritative');
  });

  it('uses the Store root for explicit planning-only execution', async () => {
    const storeRoot = path.join(tempDir, 'planning-only-store');
    createOpenSpecRoot(storeRoot);
    writeChange(storeRoot, 'planning-only-change', dir =>
      fs.writeFileSync(
        path.join(dir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'planning-decoy', stages: {} })
      )
    );
    await registerStore({ id: 'planning-only-store', localPath: storeRoot, globalDataDir: dataDir });

    const h = await startServer();
    const res = await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit planning',
      changeName: 'planning-only-change',
      space: 'store:planning-only-store',
      execution: 'planning',
    });

    expect(res.status).toBe(201);
    expect((res.json() as any).session.cwd).toBe(
      FileSystemUtils.canonicalizeExistingPath(storeRoot)
    );
    const listRes = await req(h.port, {
      method: 'GET',
      path: '/api/v1/sessions?space=store%3Aplanning-only-store',
      headers: authed(),
    });
    const listed = (listRes.json() as any).sessions.find(
      (entry: any) => entry.session.id === (res.json() as any).session.id
    );
    expect(listed.runState).toEqual({ kind: 'absent' });
  });

  it('rejects a stale Store pointer before creating a Session record', async () => {
    const storeRoot = path.join(tempDir, 'stale-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'stale-store', localPath: storeRoot, globalDataDir: dataDir });
    const memberRoot = path.join(tempDir, 'stale-member');
    createPointerProject(memberRoot, 'stale-member-id', 'other-store');
    await registerProject(
      { projectRoot: memberRoot, projectId: 'stale-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const h = await startServer();
    const res = await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit must-not-spawn',
      space: 'store:stale-store',
      execution: 'project:stale-member-id',
    });

    expect(res.status).toBe(409);
    // The stale pointer names a Store that is not this one and resolves to
    // nothing, and the selected Store holds no membership record for the
    // project — so neither authority vouches for it
    // (unified-session-runtime-context D6). The failure now names the missing
    // membership instead of a generic unavailability.
    expect((res.json() as any).error.code).toBe('execution_not_member');
    const listRes = await req(h.port, { method: 'GET', path: '/api/v1/sessions', headers: authed() });
    expect((listRes.json() as any).sessions).toEqual([]);
  });

  it('filters by Store space but joins competing terminal state from the frozen member execution', async () => {
    const storeRoot = path.join(tempDir, 'joined-store');
    createOpenSpecRoot(storeRoot);
    writeChange(storeRoot, 'store-change', (dir) =>
      fs.writeFileSync(
        path.join(dir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'store-decoy', stages: {} })
      )
    );
    await registerStore({ id: 'joined-store', localPath: storeRoot, globalDataDir: dataDir });
    const memberRoot = path.join(tempDir, 'joined-member');
    createPointerProject(memberRoot, 'joined-member-id', 'joined-store');
    const { entry: memberEntry } = await registerProject(
      { projectRoot: memberRoot, projectId: 'joined-member-id', mode: 'store' },
      { globalDataDir: dataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: 'joined-member-id',
      roles: { planning: true, knowledge: true },
    });
    const memberEphemera = path.join(
      memberRoot,
      '.rasen',
      'changes',
      'store-change',
      'ephemera'
    );
    fs.mkdirSync(memberEphemera, { recursive: true });
    fs.writeFileSync(
      path.join(memberEphemera, 'auto-run.json'),
      JSON.stringify({ pipeline: 'member-execution', stages: {} })
    );
    const memberLegacyWork = path.join(
      getProjectHomeDir(memberEntry.home, { globalDataDir: dataDir }),
      'changes',
      'store-change',
      'work'
    );
    fs.mkdirSync(memberLegacyWork, { recursive: true });
    fs.writeFileSync(
      path.join(memberLegacyWork, 'auto-run.json'),
      JSON.stringify({ pipeline: 'member-home-decoy', stages: {} })
    );

    const h = await startServer();
    const launched = (await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit joined',
      changeName: 'store-change',
      space: 'store:joined-store',
      execution: 'project:joined-member-id',
    })).json() as any;
    // Retarget the pointer after launch. Listing must trust the copied frozen
    // execution root and must not re-resolve Store membership.
    fs.writeFileSync(
      path.join(memberRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: joined-member-id\nstore: another-store\n'
    );

    const listRes = await req(h.port, {
      method: 'GET',
      path: '/api/v1/sessions?space=store%3Ajoined-store',
      headers: authed(),
    });
    const entries = (listRes.json() as any).sessions;
    expect(entries).toHaveLength(1);
    expect(entries[0].session.id).toBe(launched.session.id);
    expect(entries[0].session.cwd).toBe(FileSystemUtils.canonicalizeExistingPath(memberRoot));
    expect(entries[0].runState.kind).toBe('ok');
    expect(entries[0].runState.autoRun.state.pipeline).toBe('member-execution');
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
    const inStore = (await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit s',
      space: 'store:filter-team',
      execution: 'planning',
    })).json() as any;

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
    const launched = (await launchSession(h.port, {
      kind: 'auto',
      task: 'MODE=fast-exit x',
      space: 'store:frozen-team',
      execution: 'planning',
    })).json() as any;
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
