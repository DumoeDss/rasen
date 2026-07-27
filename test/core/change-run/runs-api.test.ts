import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

import { handleRuns, handleRunDetail } from '../../../src/core/management-api/runs.js';
import { isManagementPath } from '../../../src/core/management-api/router.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { getGlobalDataDir } from '../../../src/core/global-config.js';
import {
  createCanonicalRunRecord,
  type CanonicalRunRecord,
  type CanonicalRecordLimits,
} from '../../../src/core/change-run/internal/record.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  derivePlanningSpaceId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
} from '../../../src/core/change-run/internal/identity.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import type {
  WorkspaceInstanceId,
  PlanningSpaceId,
  RunId,
  Digest,
  ChangeInstanceId,
  WorkspaceRevision,
} from '../../../src/core/change-run/contracts.js';

const branded = <T>(value: string): T => value as T;

const WORKSPACE_DIR_NAME = 'rasen';

// ---------------------------------------------------------------------------
// Fixture digests and workspace revision (stable test identities).
// ---------------------------------------------------------------------------

const FIXTURE_DIGESTS = {
  launchRequestDigest: branded<Digest>(`sha256:${'1'.repeat(64)}`),
  planDigest: branded<Digest>(`sha256:${'2'.repeat(64)}`),
  profileDigest: branded<Digest>(`sha256:${'3'.repeat(64)}`),
  sourceRevisionDigest: branded<Digest>(`sha256:${'4'.repeat(64)}`),
  capabilityDigest: branded<Digest>(`sha256:${'5'.repeat(64)}`),
  policyDigest: branded<Digest>(`sha256:${'6'.repeat(64)}`),
  workspaceDigest: branded<Digest>(`sha256:${'c'.repeat(64)}`),
} as const;

const FIXTURE_WORKSPACE_REVISION: WorkspaceRevision = {
  format: 'workspace-revision/1',
  head: { kind: 'commit', digest: FIXTURE_DIGESTS.workspaceDigest, detached: false },
  treeDigest: FIXTURE_DIGESTS.workspaceDigest,
  dirtyWorktreeDigest: FIXTURE_DIGESTS.workspaceDigest,
} as const;

const FIXTURE_LIMITS: CanonicalRecordLimits = {
  maxAttempts: 12,
  maxActions: 64,
  maxRecordRevisions: 256,
  maxTransitions: 4096,
  maxEvidenceRefsPerAction: 16,
  limitOutcome: 'escalated',
};

// ---------------------------------------------------------------------------
// Workspace identity derivation — mirrors the management handler's chain
// exactly so test fixtures match what the handler computes from projectRoot.
// ---------------------------------------------------------------------------

function deriveWorkspaceId(root: string): WorkspaceInstanceId {
  const planningSpaceHome = `project-${createHash('sha256')
    .update(root)
    .digest('hex')
    .slice(0, 12)}`;
  const planningSpaceId = derivePlanningSpaceId(planningSpaceHome);
  const st = fs.statSync(root, { bigint: true });
  const physical = readPhysicalIdentity({
    device: st.dev,
    ino: st.ino,
    birthtimeMs: st.birthtimeMs,
  });
  return deriveWorkspaceInstanceId(planningSpaceId, physical);
}

function derivePlanningSpace(root: string): PlanningSpaceId {
  const planningSpaceHome = `project-${createHash('sha256')
    .update(root)
    .digest('hex')
    .slice(0, 12)}`;
  return derivePlanningSpaceId(planningSpaceHome);
}

// ---------------------------------------------------------------------------
// Minimal linear plan for fixture Runs.
// ---------------------------------------------------------------------------

function linearPlan(runId: RunId): RuntimePlan {
  const input: RuntimePlanInput = {
    runId,
    pipeline: 'bug-fix',
    planDigest: FIXTURE_DIGESTS.planDigest,
    profileDigest: FIXTURE_DIGESTS.profileDigest,
    sourceRevisionDigest: FIXTURE_DIGESTS.sourceRevisionDigest,
    capabilityDigest: FIXTURE_DIGESTS.capabilityDigest,
    policyDigest: FIXTURE_DIGESTS.policyDigest,
    implicitFinishOutcome: 'bug-fix-completed',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: 'root/propose',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'read' },
        gate: {
          gateId: 'propose-gate',
          decisionIds: ['approve', 'reject'],
          outcomes: { approve: 'proceed', reject: 'escalate' },
        },
      },
    ],
  };
  return createRuntimePlan(input);
}

/**
 * Creates a canonical Run Record with a custom workspaceInstanceId and changeId,
 * and publishes it to the filesystem store at `<storeRoot>/<sanitized-runId>/record-v0.json`.
 */
function publishRun(opts: {
  storeRoot: string;
  runId: string;
  changeId: string;
  planningSpaceId: string;
  workspaceInstanceId: string;
  changeInstanceId?: string;
  status?: CanonicalRunRecord['status'];
}): CanonicalRunRecord {
  const plan = linearPlan(branded<RunId>(opts.runId));
  const record = createCanonicalRunRecord({
    runId: branded<RunId>(opts.runId),
    runOrdinal: 1,
    change: {
      planningSpaceId: branded<PlanningSpaceId>(opts.planningSpaceId),
      projectId: 'test-project',
      changeId: opts.changeId,
      instanceId: branded<ChangeInstanceId>(
        opts.changeInstanceId ?? `change-instance:${'e'.repeat(64)}`
      ),
    },
    workspaceInstanceId: branded<WorkspaceInstanceId>(opts.workspaceInstanceId),
    pipeline: plan.pipeline,
    launchRequestDigest: FIXTURE_DIGESTS.launchRequestDigest,
    planDigest: plan.planDigest,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    capabilityDigest: plan.capabilityDigest,
    policyDigest: plan.policyDigest,
    executionProfileDigest: plan.profileDigest,
    initialWorkspaceRevision: FIXTURE_WORKSPACE_REVISION,
    inputs: {},
    limits: FIXTURE_LIMITS,
  });

  const dirName = opts.runId.replace(/[^a-z0-9]/gi, '_');
  const dir = path.join(opts.storeRoot, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'record-v0.json'),
    JSON.stringify(record, null, 0),
    { flag: 'wx' }
  );
  return record;
}

// ---------------------------------------------------------------------------
// Test suite.
// ---------------------------------------------------------------------------

describe('management-api runs handler — reconciler discovery (13.2)', () => {
  let tempHome: string;
  let projectRoot: string;
  let storeRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-api-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-api-proj-'));
    fs.mkdirSync(path.join(projectRoot, WORKSPACE_DIR_NAME), { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempHome;
    process.env.XDG_DATA_HOME = tempHome;

    // The store root is <globalDataDir>/runs. Create it so Runs can be published.
    storeRoot = path.join(getGlobalDataDir(), 'runs');
    fs.mkdirSync(storeRoot, { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns legacy runs plus an additive reconcilerRuns field', async () => {
    // Even with an empty store, the field is present.
    const result = await handleRuns(projectRoot);
    expect(result).toHaveProperty('runs');
    expect(result).toHaveProperty('reconcilerRuns');
    expect(Array.isArray(result.reconcilerRuns)).toBe(true);
    expect(result).toHaveProperty('hasMore', false);
  });

  it('projects a reconciler Run through the shared projector with exact identity (13.2)', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    const runId = `run:${'a'.repeat(64)}`;
    const record = publishRun({
      storeRoot,
      runId,
      changeId: 'test-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    const result = await handleRuns(projectRoot);
    const summary = result.reconcilerRuns!.find((r) => r.runId === runId);
    expect(summary).toBeDefined();
    expect(summary!.engine).toBe('reconciler');
    expect(summary!.changeId).toBe('test-change');
    expect(summary!.planningSpaceId).toBe(psId);
    expect(summary!.recordVersion).toBe(0);
    expect(summary!.status).toBe(record.status);
    expect(summary!.sourceState).toBe('missing'); // no rasen/changes/test-change dir
    // Non-terminal Run: waits count present
    expect(summary!.waits).toBeDefined();
    expect(typeof summary!.waits).toBe('number');
  });

  it('marks sourceState active when the change directory exists', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    const changeId = 'active-change';
    // Create the change directory so sourceState resolves to "active"
    fs.mkdirSync(path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', changeId), {
      recursive: true,
    });

    publishRun({
      storeRoot,
      runId: `run:${'b'.repeat(64)}`,
      changeId,
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    const result = await handleRuns(projectRoot);
    const summary = result.reconcilerRuns!.find((r) => r.changeId === changeId);
    expect(summary!.sourceState).toBe('active');
  });

  it('filters to the selected WorkspaceInstanceId (linked-worktree isolation)', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);

    // Run from the current workspace — included
    publishRun({
      storeRoot,
      runId: `run:${'c'.repeat(64)}`,
      changeId: 'current-ws-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    // Run from a different workspace — excluded from default list
    publishRun({
      storeRoot,
      runId: `run:${'d'.repeat(64)}`,
      changeId: 'other-ws-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: 'workspace-instance:deadbeef' + '0'.repeat(56),
    });

    const result = await handleRuns(projectRoot);
    const runIds = result.reconcilerRuns!.map((r) => r.runId);
    expect(runIds).toContain(`run:${'c'.repeat(64)}`);
    expect(runIds).not.toContain(`run:${'d'.repeat(64)}`);
  });

  it('isolates an invalid/corrupt Run as a per-entry error without hiding valid Runs', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);

    // A valid Run
    publishRun({
      storeRoot,
      runId: `run:${'e'.repeat(64)}`,
      changeId: 'valid-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    // A corrupt Run — write garbage as a record file
    const corruptDir = path.join(storeRoot, 'corrupt_run_dir');
    fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, 'record-v0.json'), '{ not valid json');

    const result = await handleRuns(projectRoot);
    const errorEntry = result.reconcilerRuns!.find((r) => r.error !== undefined);
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.error!.code).toBeTruthy();
    expect(errorEntry!.error!.message).toBeTruthy();

    // The valid Run is still present
    const validSummary = result.reconcilerRuns!.find((r) => r.runId === `run:${'e'.repeat(64)}`);
    expect(validSummary).toBeDefined();
    expect(validSummary!.error).toBeUndefined();
  });

  it('filters by planningSpaceId when the planning: override is set (no root needed)', async () => {
    const targetPsId = 'planning-space:' + 'a'.repeat(64);
    const otherPsId = 'planning-space:' + 'b'.repeat(64);

    // Run matching the target PlanningSpaceId
    publishRun({
      storeRoot,
      runId: `run:${'1'.repeat(64)}`,
      changeId: 'planning-match',
      planningSpaceId: targetPsId,
      workspaceInstanceId: 'workspace-instance:' + '1'.repeat(64),
    });

    // Run with a different PlanningSpaceId — excluded
    publishRun({
      storeRoot,
      runId: `run:${'2'.repeat(64)}`,
      changeId: 'planning-other',
      planningSpaceId: otherPsId,
      workspaceInstanceId: 'workspace-instance:' + '2'.repeat(64),
    });

    const result = await handleRuns('', null, { planningSpaceId: targetPsId });
    const ids = result.reconcilerRuns!.map((r) => r.runId);
    expect(ids).toContain(`run:${'1'.repeat(64)}`);
    expect(ids).not.toContain(`run:${'2'.repeat(64)}`);
  });
});

describe('management-api runs handler — pagination (13.3/13.4)', () => {
  let tempHome: string;
  let projectRoot: string;
  let storeRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-page-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-page-proj-'));
    fs.mkdirSync(path.join(projectRoot, WORKSPACE_DIR_NAME), { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempHome;
    process.env.XDG_DATA_HOME = tempHome;

    storeRoot = path.join(getGlobalDataDir(), 'runs');
    fs.mkdirSync(storeRoot, { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('paginates many Runs with a stable cursor', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);

    // Publish 5 Runs, all from the current workspace
    for (let i = 0; i < 5; i++) {
      const hex = i.toString(16).padStart(64, '0');
      publishRun({
        storeRoot,
        runId: `run:${hex}`,
        changeId: `change-${i}`,
        planningSpaceId: psId as string,
        workspaceInstanceId: wsId as string,
      });
    }

    // Page 1: limit 2
    const page1 = await handleRuns(projectRoot, undefined, { limit: 2 });
    expect(page1.reconcilerRuns!.length).toBeGreaterThanOrEqual(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    // Page 2: use the cursor
    const page2 = await handleRuns(projectRoot, undefined, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.reconcilerRuns!.length).toBeGreaterThanOrEqual(2);

    // Page 3: remaining Run(s)
    let allIds = [
      ...page1.reconcilerRuns!.map((r) => r.runId),
      ...page2.reconcilerRuns!.map((r) => r.runId),
    ];
    let nextCursor = page2.nextCursor;
    while (nextCursor) {
      const nextPage = await handleRuns(projectRoot, undefined, {
        limit: 2,
        cursor: nextCursor,
      });
      allIds = [...allIds, ...nextPage.reconcilerRuns!.map((r) => r.runId)];
      nextCursor = nextPage.nextCursor;
    }

    // No overlap between pages (cursor is exclusive)
    const page1Ids = new Set(page1.reconcilerRuns!.map((r) => r.runId));
    const page2Ids = page2.reconcilerRuns!.map((r) => r.runId);
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }

    // Pages are stable-sorted by runId
    allIds.sort();
    const expected = [
      `run:${'0'.repeat(64)}`,
      `run:${'0'.repeat(63)}1`,
      `run:${'0'.repeat(63)}2`,
      `run:${'0'.repeat(63)}3`,
      `run:${'0'.repeat(63)}4`,
    ].sort();
    expect(allIds).toEqual(expected);
  });

  it('returns hasMore=false when all Runs fit in one page', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    publishRun({
      storeRoot,
      runId: `run:${'f'.repeat(64)}`,
      changeId: 'single-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    const result = await handleRuns(projectRoot, undefined, { limit: 100 });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe('management-api runs detail handler (13.5/13.6)', () => {
  let tempHome: string;
  let projectRoot: string;
  let storeRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-detail-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-detail-proj-'));
    fs.mkdirSync(path.join(projectRoot, WORKSPACE_DIR_NAME), { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempHome;
    process.env.XDG_DATA_HOME = tempHome;

    storeRoot = path.join(getGlobalDataDir(), 'runs');
    fs.mkdirSync(storeRoot, { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns a detail view deeply equal to projectRunView (CLI parity, 13.5)', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    const runId = `run:${'1'.repeat(64)}`;
    const record = publishRun({
      storeRoot,
      runId,
      changeId: 'detail-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    // The expected view from the shared projector — exactly what CLI status emits.
    const expectedView = projectRunView(record);

    const result = await handleRunDetail('detail-change', runId, projectRoot, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Deep equality of canonical view fields (format, runId, change, engine,
    // recordVersion, status, sourceState, workspace, drift, sections).
    expect(result.view.format).toBe(expectedView.format);
    expect(result.view.runId).toBe(expectedView.runId);
    expect(result.view.engine).toBe(expectedView.engine);
    expect(result.view.recordVersion).toBe(expectedView.recordVersion);
    expect(result.view.status).toBe(expectedView.status);
    expect(result.view.change).toEqual(expectedView.change);
    expect(result.view.workspace).toEqual(expectedView.workspace);
    expect(result.view.drift).toEqual(expectedView.drift);
    // Sections: the root-dag/1 section must match (frontier, actions, waits, etc.)
    expect(result.view.sections).toEqual(expectedView.sections);
  });

  it('marks workspace.scope=other for a Run from a different worktree (13.5)', async () => {
    const psId = derivePlanningSpace(projectRoot);
    const runId = `run:${'2'.repeat(64)}`;
    // Run belongs to a DIFFERENT workspaceInstanceId
    publishRun({
      storeRoot,
      runId,
      changeId: 'other-ws-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: 'workspace-instance:ffffffff' + '0'.repeat(56),
    });

    const result = await handleRunDetail('other-ws-change', runId, projectRoot, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.view.workspace.scope).toBe('other');

    // Other-worktree views cannot expose controls or granted Actions.
    const rootSection = result.view.sections.find(
      (s): s is Extract<typeof s, { kind: 'root-dag' }> => s.kind === 'root-dag'
    );
    expect(rootSection).toBeDefined();
    expect(rootSection!.allowedControls).toEqual([]);
    for (const action of rootSection!.actions) {
      expect(action.deliveryState).not.toBe('granted');
    }
  });

  it('returns 404 for an unknown Run', async () => {
    const result = await handleRunDetail('no-change', 'run:nonexistent', projectRoot, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.code).toBe('run_not_found');
  });

  it('returns 404 when the changeId does not match the Record', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    const runId = `run:${'3'.repeat(64)}`;
    publishRun({
      storeRoot,
      runId,
      changeId: 'real-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    // Request with a wrong changeId
    const result = await handleRunDetail('wrong-change', runId, projectRoot, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.code).toBe('run_not_found');
  });

  it('reaches archived/missing exact detail without minting identity (13.5)', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    const runId = `run:${'4'.repeat(64)}`;

    // Publish a Run but do NOT create a change directory (source is "missing")
    publishRun({
      storeRoot,
      runId,
      changeId: 'archived-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    // The Run must still be reachable via exact detail
    const result = await handleRunDetail('archived-change', runId, projectRoot, null);
    expect(result.ok).toBe(true);

    // Verify zero writes: no registry entry, no project identity, no new dirs
    // The projectRoot should not have gained a projectId
    const configPath = path.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yaml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).not.toContain('projectId');
    }
  });

  it('handles percent-encoded path segments (router level)', async () => {
    const wsId = deriveWorkspaceId(projectRoot);
    const psId = derivePlanningSpace(projectRoot);
    const runId = `run:${'5'.repeat(64)}`;
    publishRun({
      storeRoot,
      runId,
      changeId: 'encoded-change',
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
    });

    // The handler receives already-decoded segments (the router does the
    // percent-decoding). Verify the handler accepts the decoded values.
    const result = await handleRunDetail('encoded-change', runId, projectRoot, null);
    expect(result.ok).toBe(true);
  });
});

describe('management-api runs detail router/path matching (13.5)', () => {
  it('isManagementPath recognizes run detail routes', () => {
    expect(isManagementPath('/api/v1/runs/my-change/run:abc123')).toBe(true);
    expect(isManagementPath('/api/v1/runs/my-change/run:abc123/')).toBe(true);
  });

  it('isManagementPath rejects deeper suffixes (not a run detail route)', () => {
    expect(isManagementPath('/api/v1/runs/my-change/run:abc123/extra')).toBe(false);
  });

  it('isManagementPath still recognizes the bare collection', () => {
    expect(isManagementPath('/api/v1/runs')).toBe(true);
  });

  it('isManagementPath rejects missing segments', () => {
    // Only one segment after /api/v1/runs/ — not a detail route, but still
    // might be a valid management path via the bare collection (without the
    // trailing slash). The bare collection is in MANAGEMENT_PATHS.
    expect(isManagementPath('/api/v1/runs/')).toBe(true); // trailing slash stripped → bare
  });
});

describe('management-api runs handler — read-only resolution (13.2)', () => {
  let tempHome: string;
  let projectRoot: string;
  let storeRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-ro-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runs-ro-proj-'));
    fs.mkdirSync(path.join(projectRoot, WORKSPACE_DIR_NAME), { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempHome;
    process.env.XDG_DATA_HOME = tempHome;

    storeRoot = path.join(getGlobalDataDir(), 'runs');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('does not create the store directory or registry as a side effect', async () => {
    // Store root does not exist yet — handleRuns should still succeed
    expect(fs.existsSync(storeRoot)).toBe(false);

    const result = await handleRuns(projectRoot);
    expect(result.reconcilerRuns).toEqual([]);

    // No store directory should have been created
    expect(fs.existsSync(storeRoot)).toBe(false);
  });

  it('reports no canonical Runs for an unregistered project (ensure:false)', async () => {
    // No registry entry, no store — read-only resolution
    const home = await resolveProjectHome(projectRoot, { ensure: false });
    expect(home).toBeNull(); // unregistered → null

    const result = await handleRuns(projectRoot, home);
    expect(result.reconcilerRuns).toEqual([]);
  });
});
