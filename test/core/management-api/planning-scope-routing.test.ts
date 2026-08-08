import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveProjectPlanningSpaceFromRoot,
  resolveSpaceSelector,
} from '../../../src/core/config-api/project-addressing.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import { resolveSessionLaunchContext } from '../../../src/core/management-api/session-launch-context.js';
import { createChangeSubmitter } from '../../../src/core/management-api/submit.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { buildRuntimeContext } from '../../../src/core/session-runtime-context.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const TOKEN = 'planning-scope-routing-token';
const STORE_UID = '123e4567-e89b-42d3-a456-426614174111';
const TARGET_LINE = 'line-0.2';

interface HttpResult {
  status: number;
  json(): any;
}

function request(port: number, requestPath: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: requestPath,
        headers: { Authorization: `Bearer ${TOKEN}` },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(body) });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeChange(changesDir: string, changeId: string): void {
  write(path.join(changesDir, changeId, 'proposal.md'), `# ${changeId}\n`);
}

interface BoundFixture {
  projectRoot: string;
  storeRoot: string;
  projectId: string;
  storeId: string;
  partitionChanges: string;
}

describe('management StorePlanning scope routing', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let server: ManagementServerHandle | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-management-scope-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    await server?.stopServer();
    server = undefined;
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  async function boundFixture(options: {
    projectId?: string;
    storeId?: string;
    localPlanning?: boolean;
    storeDeclaration?: string;
  } = {}): Promise<BoundFixture> {
    const projectId = options.projectId ?? 'project-a';
    const storeId = options.storeId ?? 'team-store';
    const projectRoot = path.join(tempDir, `${projectId}-checkout`);
    const storeRoot = path.join(tempDir, `${storeId}-store`);
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });

    write(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      `version: 2\nuid: ${STORE_UID}\nid: ${storeId}\nlayoutVersion: 2\n`
    );
    write(
      path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
      `version: 2\nprojectId: ${projectId}\nid: ${projectId}\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T00:00:00.000Z\n`
    );
    write(
      path.join(storeRoot, '.rasen-store', 'target-lines', `${TARGET_LINE}.yaml`),
      `version: 1\nid: ${TARGET_LINE}\nstoreRef: refs/heads/release/0.2\nprojects:\n  ${projectId}:\n    codeRef: refs/heads/release/0.2\n`
    );
    write(
      path.join(storeRoot, '.rasen', 'planning-line.json'),
      `${JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId,
        projectId,
        targetLineId: TARGET_LINE,
      })}\n`
    );

    const declaration = options.storeDeclaration ??
      `store:\n  uid: ${STORE_UID}\n  id: ${storeId}\n`;
    write(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\n${declaration}`
    );
    write(
      path.join(projectRoot, '.rasen', 'planning-binding.json'),
      `${JSON.stringify({
        version: 1,
        storeUid: STORE_UID,
        storeId,
        projectId,
        targetLineId: TARGET_LINE,
        planningWorktree: storeRoot,
        executionRoot: projectRoot,
      })}\n`
    );
    if (options.localPlanning) {
      writeChange(path.join(projectRoot, 'rasen', 'changes'), 'stale-local-change');
    }

    const projectHome = path.join(storeRoot, 'rasen', 'projects', projectId);
    const partitionChanges = path.join(projectHome, 'changes');
    write(path.join(projectHome, 'config.yaml'), `schema: spec-driven\nprojectId: ${projectId}\n`);
    fs.mkdirSync(path.join(projectHome, 'specs'), { recursive: true });
    writeChange(partitionChanges, 'partition-change');

    await registerStore({ id: storeId, localPath: storeRoot, globalDataDir: dataDir });
    await registerProject(
      { projectRoot, projectId, mode: 'store' },
      { globalDataDir: dataDir }
    );
    return { projectRoot, storeRoot, projectId, storeId, partitionChanges };
  }

  async function standaloneFixture(projectId = 'standalone-project'): Promise<string> {
    const projectRoot = path.join(tempDir, projectId);
    createOpenSpecRoot(projectRoot);
    write(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\n`
    );
    writeChange(path.join(projectRoot, 'rasen', 'changes'), 'local-change');
    await registerProject(
      { projectRoot, projectId, mode: 'in-repo' },
      { globalDataDir: dataDir }
    );
    return projectRoot;
  }

  async function startServer(launchRoot: string, projectId: string): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: launchRoot,
      launchProjectRef: { projectId, name: projectId, root: launchRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    server = await startManagementServer({ context });
    return server;
  }

  it('resolves unbound project content locally and bound project content from its Store partition', async () => {
    const standaloneRoot = await standaloneFixture();
    const bound = await boundFixture();

    const standalone = await resolveSpaceSelector('project:standalone-project');
    expect(standalone.ok).toBe(true);
    if (!standalone.ok || standalone.space.type !== 'project') return;
    expect(standalone.space.planningScope.ref.mode).toBe('standalone');
    expect(standalone.space.changesDir).toBe(path.join(standaloneRoot, 'rasen', 'changes'));

    const project = await resolveSpaceSelector(`project:${bound.projectId}`);
    expect(project.ok).toBe(true);
    if (!project.ok || project.space.type !== 'project') return;
    expect(project.space.planningScope.ref).toMatchObject({
      mode: 'store-project',
      storeUid: STORE_UID,
      projectId: bound.projectId,
      targetLineId: TARGET_LINE,
    });
    expect(project.space.changesDir).toBe(bound.partitionChanges);
    expect(project.space.executionRoot).toBe(fs.realpathSync.native(bound.projectRoot));
  });

  it('keeps same-id Store and project namespaces distinct', async () => {
    const bound = await boundFixture({ projectId: 'shared-id', storeId: 'shared-id' });
    const project = await resolveSpaceSelector('project:shared-id');
    const store = await resolveSpaceSelector('store:shared-id');

    expect(project.ok && project.space.type).toBe('project');
    expect(store.ok && store.space.type).toBe('store');
    if (project.ok && project.space.type === 'project') {
      expect(project.space.changesDir).toBe(bound.partitionChanges);
    }
    if (store.ok) {
      expect(store.space.root).toBe(fs.realpathSync.native(bound.storeRoot));
    }
  });

  it('opens Store project Changes that use a project-local schema', async () => {
    const bound = await boundFixture();
    const projectHome = path.join(bound.storeRoot, 'rasen', 'projects', bound.projectId);
    const schemaDir = path.join(projectHome, 'schemas', 'project-flow');
    fs.cpSync(path.join(process.cwd(), 'schemas', 'spec-driven'), schemaDir, {
      recursive: true,
    });
    const schemaPath = path.join(schemaDir, 'schema.yaml');
    fs.writeFileSync(
      schemaPath,
      fs.readFileSync(schemaPath, 'utf8').replace('name: spec-driven', 'name: project-flow'),
      'utf8'
    );
    write(
      path.join(bound.partitionChanges, 'partition-change', '.openspec.yaml'),
      'schema: project-flow\ncreated: 2026-08-06\n'
    );
    const h = await startServer(bound.projectRoot, bound.projectId);

    const response = await request(
      h.port,
      `/api/v1/changes?space=project:${bound.projectId}`
    );

    expect(response.status).toBe(200);
    expect(response.json()).toMatchObject({
      changes: [{ name: 'partition-change', schemaName: 'project-flow' }],
      errors: [],
    });
  });

  it('returns project_scope_required for Store aggregate project-content endpoints', async () => {
    const bound = await boundFixture();
    const h = await startServer(bound.projectRoot, bound.projectId);

    for (const endpoint of [
      '/api/v1/changes',
      '/api/v1/archive',
      '/api/v1/runs',
      '/api/v1/tasks/partition-change',
      '/api/v1/spaces/worktrees',
    ]) {
      const response = await request(h.port, `${endpoint}?space=store:${bound.storeId}`);
      expect(response.status, endpoint).toBe(400);
      expect(response.json().error.code, endpoint).toBe('project_scope_required');
    }
  });

  it('uses the launch project only as identity/execution hint and reads bound Store truth', async () => {
    const bound = await boundFixture({ localPlanning: true });
    const h = await startServer(bound.projectRoot, bound.projectId);
    const response = await request(h.port, '/api/v1/changes');

    expect(response.status).toBe(200);
    expect(response.json().changes.map((change: { name: string }) => change.name)).toEqual([
      'partition-change',
    ]);
  });

  it('passes complete Store/project/target-line selection to scoped Change submission', async () => {
    const bound = await boundFixture();
    const resolved = await resolveSpaceSelector(`project:${bound.projectId}`);
    expect(resolved.ok && resolved.space.type).toBe('project');
    if (!resolved.ok || resolved.space.type !== 'project') return;

    const submit = createChangeSubmitter(
      { launchProjectRoot: bound.projectRoot },
      {
        cliEntryOverride: path.join(
          process.cwd(),
          'test',
          'fixtures',
          'management-api',
          'argv-capture-cli.mjs'
        ),
      }
    );
    const result = await submit('scoped-change', 'Scoped description', resolved.space);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const capture = JSON.parse(result.response.change.path) as { argv: string[]; cwd: string };
    expect(capture.cwd).toBe(fs.realpathSync.native(bound.projectRoot));
    expect(capture.argv).toEqual([
      'new',
      'change',
      'scoped-change',
      '--proposal=Scoped description',
      '--json',
      '--store',
      STORE_UID,
      '--project',
      bound.projectId,
      '--target-line',
      TARGET_LINE,
    ]);
  });

  it('launches a bound project from its execution checkout with complete frozen planning facts', async () => {
    const bound = await boundFixture();
    const result = await resolveSessionLaunchContext({
      space: `project:${bound.projectId}`,
      launchProject: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.context.planningSpace === undefined) return;
    expect(result.context).toMatchObject({
      cwd: fs.realpathSync.native(bound.projectRoot),
      attachedRoots: [fs.realpathSync.native(bound.storeRoot)],
      planningSpace: {
        type: 'project',
        id: bound.projectId,
        planning: {
          storeUid: STORE_UID,
          storeId: bound.storeId,
          projectId: bound.projectId,
          targetLineId: TARGET_LINE,
        },
      },
      execution: {
        kind: 'project',
        projectId: bound.projectId,
        root: fs.realpathSync.native(bound.projectRoot),
      },
    });

    const runtime = buildRuntimeContext({
      sessionId: 'management-scope-session',
      space: result.context.planningSpace,
      execution: result.context.execution,
    });
    expect(runtime?.planning).toEqual({
      type: 'store',
      uid: STORE_UID,
      id: bound.storeId,
      projectId: bound.projectId,
      targetLineId: TARGET_LINE,
      root: fs.realpathSync.native(bound.storeRoot),
    });
  });

  it('maps a found project with an unavailable Store binding to space_unavailable', async () => {
    const projectRoot = path.join(tempDir, 'unavailable-project');
    fs.mkdirSync(projectRoot, { recursive: true });
    write(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: unavailable-project\nstore: missing-store\n'
    );
    await registerProject(
      { projectRoot, projectId: 'unavailable-project', mode: 'store' },
      { globalDataDir: dataDir }
    );

    const resolved = await resolveSpaceSelector('project:unavailable-project');
    expect(resolved).toMatchObject({ ok: false, status: 409, code: 'space_unavailable' });
  });

  it('resolves explicit and launch-fallback scopes without modifying files or registries', async () => {
    const bound = await boundFixture();
    const before = snapshotDirectory(tempDir);

    const explicit = await resolveSpaceSelector(`project:${bound.projectId}`);
    const fallback = await resolveProjectPlanningSpaceFromRoot(bound.projectRoot);

    expect(explicit.ok).toBe(true);
    expect(fallback.ok).toBe(true);
    expect(snapshotDirectory(tempDir)).toEqual(before);
  });
});
