import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import {
  getProjectRegistryPath,
  registerProject,
  updateProjectRegistryState,
} from '../../../src/core/project-registry.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'test-token-space-scoping';

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

function writeChange(root: string, name: string, extra?: (changeDir: string) => void): void {
  const changeDir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Proposal\n');
  extra?.(changeDir);
}

describe('management API space scoping (planning-space-addressing design D2/D6)', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-space-scope-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    launchRoot = path.join(tempDir, 'launch');
    createOpenSpecRoot(launchRoot);
    writeChange(launchRoot, 'launch-change');

    originalEnv = { ...process.env };
    // RASEN_HOME short-circuits getGlobalDataDir() to this exact path, so the
    // registrations below (globalDataDir: dataDir) and the server's default
    // reads resolve to the same machine home.
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    await handle?.stopServer();
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  describe('cross-space reads (design D2/D7)', () => {
    it('GET /api/v1/changes?space=project:<B> answers for B while the daemon was launched in A', async () => {
      const projectB = path.join(tempDir, 'project-b');
      createOpenSpecRoot(projectB);
      writeChange(projectB, 'b-change');
      await registerProject({ projectRoot: projectB, projectId: 'proj-b', mode: 'in-repo' }, { globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes?space=project:proj-b', headers: authed() });
      expect(res.status).toBe(200);
      const names = (res.json() as any).changes.map((c: any) => c.name);
      expect(names).toEqual(['b-change']);
    });

    it('GET /api/v1/changes?space=store:<id> answers for the store', async () => {
      const storeRoot = path.join(tempDir, 'team-store');
      createOpenSpecRoot(storeRoot);
      writeChange(storeRoot, 'store-change');
      await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes?space=store:team', headers: authed() });
      expect(res.status).toBe(200);
      const names = (res.json() as any).changes.map((c: any) => c.name);
      expect(names).toEqual(['store-change']);
    });

    it('GET /api/v1/runs?space=project:<B> resolves against B, not the launch project', async () => {
      const projectB = path.join(tempDir, 'project-b-runs');
      createOpenSpecRoot(projectB);
      writeChange(projectB, 'b-run-change', (dir) =>
        fs.writeFileSync(path.join(dir, 'auto-run.json'), JSON.stringify({ pipeline: 'small-feature', stages: {} }))
      );
      await registerProject({ projectRoot: projectB, projectId: 'proj-b-runs', mode: 'in-repo' }, { globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/runs?space=project:proj-b-runs', headers: authed() });
      expect(res.status).toBe(200);
      const entry = (res.json() as any).runs.find((r: any) => r.name === 'b-run-change');
      expect(entry.autoRun.kind).toBe('ok');
      expect(entry.autoRun.state.pipeline).toBe('small-feature');
    });

    it('no selector stays byte-compatible: GET /api/v1/changes answers for the launch project', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes', headers: authed() });
      expect(res.status).toBe(200);
      const names = (res.json() as any).changes.map((c: any) => c.name);
      expect(names).toEqual(['launch-change']);
    });
  });

  describe('selector errors (design D1)', () => {
    it('400 invalid_space for a bare selector', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes?space=team', headers: authed() });
      expect(res.status).toBe(400);
      expect((res.json() as any).error.code).toBe('invalid_space');
    });

    it('404 space_not_found for an unknown project', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/changes?space=project:ghost', headers: authed() });
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('space_not_found');
    });
  });

  describe('submission lands in the selected space (change-submission spec)', () => {
    it('POST /api/v1/changes with body space=store:<id> creates the change under the store root', async () => {
      const storeRoot = path.join(tempDir, 'submit-store');
      createOpenSpecRoot(storeRoot);
      await registerStore({ id: 'submit-team', localPath: storeRoot, globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'store-submitted-change', description: 'From a store-scoped submission', space: 'store:submit-team' }),
      });
      expect(res.status).toBe(201);
      // The change landed under the STORE root, not the launch project.
      expect(fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'store-submitted-change', 'proposal.md'))).toBe(true);
      expect(fs.existsSync(path.join(launchRoot, 'rasen', 'changes', 'store-submitted-change'))).toBe(false);
    }, 15_000);

    it('POST /api/v1/changes with an unresolvable space rejects before spawning', async () => {
      const h = await startServer();
      const res = await req(h.port, {
        method: 'POST',
        path: '/api/v1/changes',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'never-created', description: 'desc', space: 'store:ghost' }),
      });
      expect(res.status).toBe(404);
      expect((res.json() as any).error.code).toBe('space_not_found');
      expect(fs.existsSync(path.join(launchRoot, 'rasen', 'changes', 'never-created'))).toBe(false);
    });
  });

  describe('GET /api/v1/spaces (design D4/D6)', () => {
    it('lists both namespaces type-tagged, filters dead roots without mutating the registry, dedupes store roots, and validates members', async () => {
      // Live in-repo project.
      const liveProject = path.join(tempDir, 'live-project');
      createOpenSpecRoot(liveProject);
      await registerProject({ projectRoot: liveProject, projectId: 'live-proj', mode: 'in-repo' }, { globalDataDir: dataDir });

      // Dead in-repo project (registered, then its root deleted).
      const deadProject = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-space-dead-'));
      createOpenSpecRoot(deadProject);
      await registerProject({ projectRoot: deadProject, projectId: 'dead-proj', mode: 'in-repo' }, { globalDataDir: dataDir });
      fs.rmSync(deadProject, { recursive: true, force: true });

      // A store, plus its own root ALSO registered as an in-repo project
      // (the self-registration dedupe case).
      const storeRoot = path.join(tempDir, 'members-store');
      createOpenSpecRoot(storeRoot);
      await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: dataDir });
      await registerProject({ projectRoot: storeRoot, projectId: 'store-self', mode: 'in-repo' }, { globalDataDir: dataDir });

      // A pointer-repo member of the store, and a pointer repo naming a
      // different store (must be excluded from team's members).
      const member = path.join(tempDir, 'member-repo');
      fs.mkdirSync(path.join(member, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(member, 'rasen', 'config.yaml'), 'store: team\n');
      await registerProject({ projectRoot: member, projectId: 'member-proj', mode: 'store' }, { globalDataDir: dataDir });

      const stranger = path.join(tempDir, 'stranger-repo');
      fs.mkdirSync(path.join(stranger, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(stranger, 'rasen', 'config.yaml'), 'store: other-store\n');
      await registerProject({ projectRoot: stranger, projectId: 'stranger-proj', mode: 'store' }, { globalDataDir: dataDir });

      const registryPath = getProjectRegistryPath({ globalDataDir: dataDir });
      const registryBefore = fs.readFileSync(registryPath, 'utf-8');

      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/spaces', headers: authed() });
      expect(res.status).toBe(200);
      const spaces = (res.json() as any).spaces as Array<any>;

      const projectSpaces = spaces.filter((s) => s.type === 'project');
      const storeSpaces = spaces.filter((s) => s.type === 'store');

      // Live in-repo projects only; the dead root is gone, and the store's own
      // root is presented once (as the store), never duplicated as a project.
      expect(projectSpaces.map((s) => s.id).sort()).toEqual(['live-proj']);

      expect(storeSpaces).toHaveLength(1);
      const team = storeSpaces[0];
      expect(team.id).toBe('team');
      expect(team.name).toBe('team');
      expect(team.root).toBe(FileSystemUtils.canonicalizeExistingPath(storeRoot));
      // Members reflect current pointers: the member is included, the stranger
      // (pointing elsewhere) is excluded even though it is a `mode: store` entry.
      expect(team.members.map((m: any) => m.projectId)).toEqual(['member-proj']);

      // Read-only: the request left the registry byte-for-byte unchanged.
      expect(fs.readFileSync(registryPath, 'utf-8')).toBe(registryBefore);
    });

    it('401s /api/v1/spaces without a token', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/spaces' });
      expect(res.status).toBe(401);
      expect((res.json() as any).error.code).toBe('unauthorized');
    });

    it('admits POST on /api/v1/spaces to the creation bridge (space-creation), 405s PUT and DELETE', async () => {
      const h = await startServer();
      // POST is now admitted (space-creation): a bad body reaches validation as
      // a 400, proving it is routed to the bridge rather than method-rejected.
      const post = await req(h.port, {
        method: 'POST',
        path: '/api/v1/spaces',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'banana', path: '/tmp/x' }),
      });
      expect(post.status).toBe(400);
      expect((post.json() as any).error.code).toBe('invalid_input');

      for (const method of ['PUT', 'DELETE']) {
        const res = await req(h.port, { method, path: '/api/v1/spaces', headers: authed() });
        expect(res.status, method).toBe(405);
        expect((res.json() as any).error.code).toBe('method_not_allowed');
      }
    });

    it('tolerates one trailing slash on /api/v1/spaces/', async () => {
      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/spaces/', headers: authed() });
      expect(res.status).toBe(200);
      expect(Array.isArray((res.json() as any).spaces)).toBe(true);
    });
  });

  describe('worktree-aware spaces (worktree-aware-spaces D3)', () => {
    /** A committed git repo with `rasen/` planning shape at `root`. */
    function initRepoRoot(root: string, gitEnv: NodeJS.ProcessEnv): void {
      createOpenSpecRoot(root);
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: root, env: gitEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: root, env: gitEnv, stdio: 'ignore' });
    }

    it('collapses legacy worktree-duplicate entries to one project row carrying the live worktree count', async () => {
      const repoRoot = path.join(tempDir, 'wt-collapse-main');
      const gitEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
      initRepoRoot(repoRoot, gitEnv);

      const wtA = path.join(tempDir, 'wt-collapse-a');
      const wtB = path.join(tempDir, 'wt-collapse-b');
      execFileSync('git', ['worktree', 'add', wtA], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', wtB], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });

      const { entry, canonicalPath } = await registerProject(
        { projectRoot: repoRoot, projectId: 'wt-proj', mode: 'in-repo' },
        { globalDataDir: dataDir }
      );

      // Seed two legacy worktree-keyed duplicates sharing the main entry's home.
      await updateProjectRegistryState(
        (current) => ({
          version: 1,
          projects: {
            ...(current?.projects ?? {}),
            [FileSystemUtils.canonicalizeExistingPath(wtA)]: { ...entry, name: 'wt-collapse-a', lastSeen: '2026-07-09T12:00:00.000Z' },
            [FileSystemUtils.canonicalizeExistingPath(wtB)]: { ...entry, name: 'wt-collapse-b', lastSeen: '2026-07-09T12:00:00.000Z' },
          },
        }),
        { globalDataDir: dataDir }
      );

      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/spaces', headers: authed() });
      const spaces = (res.json() as any).spaces as any[];
      const rows = spaces.filter((s) => s.type === 'project' && s.id === 'wt-proj');
      expect(rows).toHaveLength(1);
      expect(rows[0].root).toBe(canonicalPath);
      expect(rows[0].worktreeCount).toBe(3);

      for (const wt of [wtA, wtB]) {
        execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
      }
    });

    it('keeps independent clones (same projectId, distinct homes) as separate rows', async () => {
      const cloneA = path.join(tempDir, 'clone-a');
      const cloneB = path.join(tempDir, 'clone-b');
      createOpenSpecRoot(cloneA);
      createOpenSpecRoot(cloneB);
      // Not git repos, so gitWorktreeList yields no inventory — but distinct
      // homes keep them ungrouped regardless.
      await registerProject({ projectRoot: cloneA, projectId: 'clone-proj', mode: 'in-repo' }, { globalDataDir: dataDir });
      await registerProject({ projectRoot: cloneB, projectId: 'clone-proj', mode: 'in-repo' }, { globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, { method: 'GET', path: '/api/v1/spaces', headers: authed() });
      const spaces = (res.json() as any).spaces as any[];
      const rows = spaces.filter((s) => s.type === 'project' && s.id === 'clone-proj');
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.worktreeCount === undefined)).toBe(true);
    });

    it('serves the live worktree inventory with per-worktree active-change counts', async () => {
      const repoRoot = path.join(tempDir, 'wt-inv-main');
      const gitEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
      initRepoRoot(repoRoot, gitEnv);

      const worktreePath = path.join(tempDir, 'wt-inv-feat');
      execFileSync('git', ['worktree', 'add', '-b', 'feat/x', worktreePath], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
      // Two active changes on the linked worktree, none on main.
      writeChange(worktreePath, 'wt-change-1');
      writeChange(worktreePath, 'wt-change-2');

      await registerProject({ projectRoot: repoRoot, projectId: 'wt-inv-proj', mode: 'in-repo' }, { globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/spaces/worktrees?space=project:wt-inv-proj',
        headers: authed(),
      });
      expect(res.status).toBe(200);
      const worktrees = (res.json() as any).worktrees as any[];
      expect(worktrees).toHaveLength(2);
      const main = worktrees.find((w) => w.isMain);
      const linked = worktrees.find((w) => !w.isMain);
      expect(main.activeChangeCount).toBe(0);
      expect(linked.branch).toBe('feat/x');
      expect(linked.activeChangeCount).toBe(2);
      // Wire `root` is canonical platform form (review M1 fix, spaces.ts's
      // canonicalizeOrResolve), not the raw git-porcelain value — guards
      // against a future revert reintroducing the Windows separator mismatch.
      expect(linked.root).toBe(FileSystemUtils.canonicalizeExistingPath(worktreePath));

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
    });

    it('returns an empty inventory for a non-git space root', async () => {
      const plain = path.join(tempDir, 'plain-proj');
      createOpenSpecRoot(plain);
      await registerProject({ projectRoot: plain, projectId: 'plain-proj-id', mode: 'in-repo' }, { globalDataDir: dataDir });

      const h = await startServer();
      const res = await req(h.port, {
        method: 'GET',
        path: '/api/v1/spaces/worktrees?space=project:plain-proj-id',
        headers: authed(),
      });
      expect(res.status).toBe(200);
      expect((res.json() as any).worktrees).toEqual([]);
    });

    it('resolves a worktree root path selector to the owning project without mutating the registry', async () => {
      const repoRoot = path.join(tempDir, 'wt-sel-main');
      const gitEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
      initRepoRoot(repoRoot, gitEnv);
      const worktreePath = path.join(tempDir, 'wt-sel-feat');
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
      writeChange(worktreePath, 'wt-sel-change');

      await registerProject({ projectRoot: repoRoot, projectId: 'wt-sel-proj', mode: 'in-repo' }, { globalDataDir: dataDir });
      const registryPath = getProjectRegistryPath({ globalDataDir: dataDir });
      const before = fs.readFileSync(registryPath, 'utf-8');

      const h = await startServer();
      const selector = `project:${FileSystemUtils.canonicalizeExistingPath(worktreePath)}`;
      const res = await req(h.port, {
        method: 'GET',
        path: `/api/v1/changes?space=${encodeURIComponent(selector)}`,
        headers: authed(),
      });
      expect(res.status).toBe(200);
      // The changes answered are the worktree's OWN branch-local changes.
      const changes = (res.json() as any).changes as any[];
      expect(changes.map((c) => c.name)).toContain('wt-sel-change');
      // Read-only resolution: the registry is untouched.
      expect(fs.readFileSync(registryPath, 'utf-8')).toBe(before);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
    });

    it('guards the worktrees path: 401 without a token, 405 on POST', async () => {
      const h = await startServer();
      const noToken = await req(h.port, { method: 'GET', path: '/api/v1/spaces/worktrees' });
      expect(noToken.status).toBe(401);
      expect((noToken.json() as any).error.code).toBe('unauthorized');

      const post = await req(h.port, { method: 'POST', path: '/api/v1/spaces/worktrees', headers: authed() });
      expect(post.status).toBe(405);
      expect((post.json() as any).error.code).toBe('method_not_allowed');
    });
  });
});
