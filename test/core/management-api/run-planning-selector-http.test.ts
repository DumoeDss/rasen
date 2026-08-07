import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import { startManagementServer, type ManagementServerHandle } from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import type { RunControlSpawnCall, RunControlSpawner } from '../../../src/core/management-api/run-control.js';
import {
  getProjectRegistryPath,
  serializeProjectRegistryState,
  type ProjectRegistryEntryState,
} from '../../../src/core/project-registry.js';
import { getGlobalDataDir } from '../../../src/core/global-config.js';
import {
  derivePlanningSpaceId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
} from '../../../src/core/change-run/internal/identity.js';
import { createCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/contracts.js';

const TOKEN = 'planning-selector-token';
const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<Digest>(`sha256:${char.repeat(64)}`);

interface HttpResult {
  status: number;
  json: any;
}

function request(
  port: number,
  method: string,
  requestPath: string,
  body?: unknown
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      agent: false,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(raw === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(raw),
            }),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}

function workspaceId(root: string, home: string): WorkspaceInstanceId {
  const stat = fs.statSync(root, { bigint: true });
  return deriveWorkspaceInstanceId(
    derivePlanningSpaceId(home),
    readPhysicalIdentity({
      device: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
    })
  );
}

function registryEntry(projectId: string, home: string): ProjectRegistryEntryState {
  return {
    projectId,
    name: home,
    mode: 'in-repo',
    home,
    lastSeen: '2026-08-02T00:00:00.000Z',
  };
}

function writeRegistry(entries: Readonly<Record<string, ProjectRegistryEntryState>>): void {
  const file = getProjectRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeProjectRegistryState({ version: 1, projects: { ...entries } }));
}

function publishRun(
  root: string,
  home: string,
  runId: RunId,
  workspaceInstanceId: WorkspaceInstanceId = workspaceId(
    root,
    `project-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
  )
) {
  const plan = createRuntimePlan({
    runId,
    pipeline: 'selector-fixture',
    planDigest: digest('1'),
    profileDigest: digest('2'),
    sourceRevisionDigest: digest('3'),
    capabilityDigest: digest('4'),
    policyDigest: digest('5'),
    implicitFinishOutcome: 'done',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: 'root/one',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'read' },
      },
    ],
  });
  const record = createCanonicalRunRecord({
    runId,
    runOrdinal: 1,
    change: {
      planningSpaceId: derivePlanningSpaceId(home),
      projectId: 'selector-project',
      changeId: 'selector-change',
      instanceId: branded<ChangeInstanceId>(`change-instance:${'6'.repeat(64)}`),
    },
    workspaceInstanceId,
    pipeline: plan.pipeline,
    launchRequestDigest: digest('7'),
    planDigest: plan.planDigest,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    capabilityDigest: plan.capabilityDigest,
    policyDigest: plan.policyDigest,
    executionProfileDigest: plan.profileDigest,
    initialWorkspaceRevision: {
      format: 'workspace-revision/1',
      head: { kind: 'commit', digest: digest('8'), detached: false },
      treeDigest: digest('8'),
      dirtyWorktreeDigest: digest('8'),
    },
    inputs: {},
    limits: {
      maxAttempts: 12,
      maxActions: 64,
      maxRecordRevisions: 256,
      maxTransitions: 4096,
      maxEvidenceRefsPerAction: 16,
      limitOutcome: 'escalated',
    },
  });
  const store = createFilesystemRunStore(path.join(getGlobalDataDir(), 'runs'));
  store.create(runId, record);
  store.writePlan?.(runId, plan);
  return record;
}

describe('planning:<full-id> exact Run authority over real HTTP', () => {
  let base: string;
  let launchRoot: string;
  let selectedRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let server: ManagementServerHandle | undefined;
  let spawnCalls: RunControlSpawnCall[];

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-planning-http-'));
    launchRoot = path.join(base, 'launch');
    selectedRoot = path.join(base, 'selected');
    for (const root of [launchRoot, selectedRoot]) {
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    }
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = path.join(base, 'config');
    process.env.XDG_DATA_HOME = path.join(base, 'data');
    spawnCalls = [];
  });

  afterEach(async () => {
    await server?.stopServer();
    process.env = originalEnv;
    fs.rmSync(base, { recursive: true, force: true });
  });

  async function start(spawner?: RunControlSpawner): Promise<ManagementServerHandle> {
    const context: ManagementApiContext = {
      token: TOKEN,
      launchProjectRoot: launchRoot,
      launchProjectRef: { projectId: 'launch-project', name: 'launch', root: launchRoot },
      version: '0.0.0-test',
      uiAssetsDir: null,
    };
    const fake: RunControlSpawner = spawner ?? (async (call) => {
      spawnCalls.push(call);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ runId: call.argv[5], disposition: 'advanced', status: 'running' }),
        stderr: '',
        timedOut: false,
      };
    });
    server = await startManagementServer({ context, sessions: { runControlSpawner: fake } });
    return server;
  }

  it('uses one exact registered root for list, detail, and control', async () => {
    const home = 'selected-home';
    fs.writeFileSync(path.join(selectedRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nprojectId: selector-project\n');
    writeRegistry({ [selectedRoot]: registryEntry('selector-project', home) });
    const planningSpaceId = derivePlanningSpaceId(home);
    const runId = branded<RunId>(`run:${'9'.repeat(64)}`);
    const record = publishRun(selectedRoot, home, runId);
    const h = await start();
    const selector = encodeURIComponent(`planning:${planningSpaceId}`);

    const list = await request(h.port, 'GET', `/api/v1/runs?space=${selector}`);
    const detail = await request(
      h.port,
      'GET',
      `/api/v1/runs/selector-change/${encodeURIComponent(runId)}?space=${selector}`
    );
    const control = await request(
      h.port,
      'POST',
      `/api/v1/runs/selector-change/${encodeURIComponent(runId)}?space=${selector}`,
      {
        control: {
          format: 'change-run-control/1',
          ref: { change: { projectRoot: selectedRoot, changeId: 'selector-change' }, runId },
          expectedRecordVersion: record.recordVersion,
          command: { kind: 'cancel' },
        },
      }
    );

    expect(list.status).toBe(200);
    expect(list.json.reconcilerRuns.map((entry: any) => entry.runId)).toContain(runId);
    expect(detail.status).toBe(200);
    expect(detail.json.workspace.scope).toBe('current');
    expect(detail.json.sections[0].allowedControls).not.toHaveLength(0);
    expect(control.status).toBe(200);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.cwd).toBe(selectedRoot);
  });

  it('keeps an exact other-worktree Run read-only and rejects control without spawning', async () => {
    const home = 'other-home';
    fs.writeFileSync(path.join(selectedRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\nprojectId: selector-project\n');
    writeRegistry({ [selectedRoot]: registryEntry('selector-project', home) });
    const planningSpaceId = derivePlanningSpaceId(home);
    const runId = branded<RunId>(`run:${'a'.repeat(64)}`);
    const record = publishRun(
      selectedRoot,
      home,
      runId,
      branded<WorkspaceInstanceId>(`workspace-instance:${'f'.repeat(64)}`)
    );
    const h = await start();
    const selector = encodeURIComponent(`planning:${planningSpaceId}`);
    const detailPath = `/api/v1/runs/selector-change/${encodeURIComponent(runId)}?space=${selector}`;

    const list = await request(h.port, 'GET', `/api/v1/runs?space=${selector}`);
    const detail = await request(h.port, 'GET', detailPath);
    const control = await request(h.port, 'POST', detailPath, {
      control: {
        format: 'change-run-control/1',
        ref: { change: { projectRoot: selectedRoot, changeId: 'selector-change' }, runId },
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'cancel' },
      },
    });

    expect(list.status).toBe(200);
    expect(list.json.reconcilerRuns.map((entry: any) => entry.runId)).not.toContain(runId);
    expect(detail.status).toBe(200);
    expect(detail.json.workspace.scope).toBe('other');
    expect(detail.json.sections[0].allowedControls).toEqual([]);
    expect(control.status).toBe(403);
    expect(control.json.error.code).toBe('workspace-scope-mismatch');
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns typed unavailable for an unregistered PlanningSpaceId on every route', async () => {
    writeRegistry({});
    const unavailable = branded<PlanningSpaceId>(`planning-space:${'b'.repeat(64)}`);
    const runId = branded<RunId>(`run:${'c'.repeat(64)}`);
    const h = await start();
    const selector = encodeURIComponent(`planning:${unavailable}`);
    const detailPath = `/api/v1/runs/selector-change/${encodeURIComponent(runId)}?space=${selector}`;

    const results = await Promise.all([
      request(h.port, 'GET', `/api/v1/runs?space=${selector}`),
      request(h.port, 'GET', detailPath),
      request(h.port, 'POST', detailPath, { control: {} }),
    ]);
    for (const result of results) {
      expect(result.status).toBe(404);
      expect(result.json.error.code).toBe('planning_selector_unavailable');
    }
    expect(spawnCalls).toHaveLength(0);
  });

  it('rejects duplicate-clone planning and project selectors as ambiguous on every route', async () => {
    const cloneA = path.join(base, 'clone-a');
    const cloneB = path.join(base, 'clone-b');
    for (const root of [cloneA, cloneB]) {
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    }
    writeRegistry({
      [cloneA]: registryEntry('duplicate-project', 'shared-planning-home'),
      [cloneB]: registryEntry('duplicate-project', 'shared-planning-home'),
    });
    const planning = derivePlanningSpaceId('shared-planning-home');
    const runId = branded<RunId>(`run:${'d'.repeat(64)}`);
    const h = await start();

    for (const selectorValue of [
      `planning:${planning}`,
      'project:duplicate-project',
    ]) {
      const selector = encodeURIComponent(selectorValue);
      const detailPath = `/api/v1/runs/selector-change/${encodeURIComponent(runId)}?space=${selector}`;
      const results = await Promise.all([
        request(h.port, 'GET', `/api/v1/runs?space=${selector}`),
        request(h.port, 'GET', detailPath),
        request(h.port, 'POST', detailPath, { control: {} }),
      ]);
      for (const result of results) {
        expect(result.status).toBe(409);
        expect(result.json.error.code).toMatch(/_selector_ambiguous$/);
      }
    }
    expect(spawnCalls).toHaveLength(0);
  });
});
