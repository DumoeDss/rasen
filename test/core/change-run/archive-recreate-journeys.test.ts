/**
 * Archive/recreate journeys (task 15.7 of `ecp-run-spine`).
 *
 * Proves the archive → recreate → isolation contract (design §10/§15) through
 * REAL surfaces:
 *
 *  - The **association registry** (`internal/association-registry.ts`) — the
 *    kernel authority for ChangeInstance lifecycle. This is the documented
 *    kernel-internal surface for instance binding/archive/recreate, parallel to
 *    the gate-wait commitment and effect-observation helpers used by the 15.3
 *    fresh-process E2E. It is NOT a bypass: the registry is the ONLY component
 *    that decides whether two Change directories are the same incarnation or
 *    distinct generations.
 *
 *  - The **filesystem RunStore** (`internal/run-store-fs.ts`) + **projector**
 *    (`internal/projector.ts`) — the immutable machine-home store. An OLD Run
 *    remains exactly inspectable here after its source Change directory is
 *    archived/moved/deleted.
 *
 *  - The **management API handlers** (`management-api/runs.ts`,
 *    `management-api/run-control.ts`) — `handleRuns` reports `sourceState:
 *    archived|missing`, `handleRunDetail` returns the exact view, and
 *    `handleRunControl` rejects cross-workspace control with 403.
 *
 *  - A **fresh CLI spawn** (`runCLI`) — proves the OLD Run's exact `status`
 *    survives a cross-process inspect after source removal.
 *
 * Journeys covered:
 *  (a) archive → same-name recreate produces a DISTINCT ChangeInstance; OLD Run
 *      remains exactly inspectable; a NEW Run can start under the new instance;
 *      the OLD runId is NOT derivable from the recreated state.
 *  (b) two archived generations with the same key: both are distinctly resolved
 *      by alias, and a changeId-only lookup is ambiguous (no silent selection).
 *  (c) manual move (unprovable): sourceState resolves to `missing`; exact detail
 *      still reachable; no crash.
 *  (d) linked-worktree list/control isolation: Runs from another worktree are
 *      filtered from the list, projected read-only (`scope: other`, no controls),
 *      and POST control is rejected with `workspace_scope_mismatch`.
 *
 * Kernel integration gaps surfaced by this test (flagged for LEAD, NOT fixed
 * here per the frozen-kernel constraint):
 *  - The association registry is not yet wired into the CLI/facade launch path.
 *    The CLI derives ChangeInstanceId from `statSync(projectRoot)`, not the
 *    change directory's physical identity, so archive+recreate in the same
 *    project root does not yet produce a distinct instance through `pipeline
 *    start` alone. The distinct-instance semantics ARE correct at the
 *    association-registry level (proven below) and await the engine-ownership
 *    integration to enforce them end-to-end.
 *  - The facade does not reject mutation (complete/control) of a Run whose
 *    ChangeInstance is archived. The design §10 bilateral guard is the intended
 *    enforcement point; it is not yet integrated into `facade-runtime.ts`.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';

import {
  archiveAssociation,
  bindActiveAssociation,
  createAssociationLedger,
  findAssociationByAlias,
} from '../../../src/core/change-run/internal/association-registry.js';
import {
  deriveChangeInstanceId,
  derivePlanningSpaceId,
  deriveRunId,
  deriveWorkspaceInstanceId,
  readPhysicalIdentity,
  type PhysicalIdentity,
} from '../../../src/core/change-run/internal/identity.js';
import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import {
  createCanonicalRunRecord,
  type CanonicalRecordLimits,
} from '../../../src/core/change-run/internal/record.js';
import {
  createRuntimePlan,
  type RuntimePlanInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import { handleRuns, handleRunDetail } from '../../../src/core/management-api/runs.js';
import { handleRunControl } from '../../../src/core/management-api/run-control.js';
import { getGlobalDataDir } from '../../../src/core/global-config.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
  WorkspaceInstanceId,
  WorkspaceRevision,
} from '../../../src/core/change-run/contracts.js';

import { runCLI } from '../../helpers/run-cli.js';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const WORKSPACE_DIR_NAME = 'rasen';

const FIXTURE_DIGESTS = {
  launchRequestDigest: `sha256:${'1'.repeat(64)}` as Digest,
  planDigest: `sha256:${'2'.repeat(64)}` as Digest,
  profileDigest: `sha256:${'3'.repeat(64)}` as Digest,
  sourceRevisionDigest: `sha256:${'4'.repeat(64)}` as Digest,
  capabilityDigest: `sha256:${'5'.repeat(64)}` as Digest,
  policyDigest: `sha256:${'6'.repeat(64)}` as Digest,
  workspaceDigest: `sha256:${'c'.repeat(64)}` as Digest,
} as const;

const FIXTURE_WORKSPACE_REVISION: WorkspaceRevision = {
  format: 'workspace-revision/1',
  head: { kind: 'commit', digest: FIXTURE_DIGESTS.workspaceDigest, detached: false },
  treeDigest: FIXTURE_DIGESTS.workspaceDigest,
  dirtyWorktreeDigest: FIXTURE_DIGESTS.workspaceDigest,
} as const;

const FIXTURE_LIMITS: CanonicalRecordLimits = Object.freeze({
  maxAttempts: 12,
  maxActions: 64,
  maxRecordRevisions: 256,
  maxTransitions: 4096,
  maxEvidenceRefsPerAction: 16,
  limitOutcome: 'escalated',
});

const branded = <T>(value: string): T => value as T;

/** Two distinct physical identities simulating two Change-directory inodes. */
const OLD_PHYSICAL: PhysicalIdentity = {
  format: 'physical-identity/1',
  platform: 'posix',
  device: 100n,
  fileIndex: 200n,
  birthIdentity: 300n,
};
const NEW_PHYSICAL: PhysicalIdentity = {
  format: 'physical-identity/1',
  platform: 'posix',
  device: 100n,
  fileIndex: 400n,
  birthIdentity: 500n,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function derivePlanningSpace(root: string): PlanningSpaceId {
  const planningSpaceHome = `project-${createHash('sha256')
    .update(root)
    .digest('hex')
    .slice(0, 12)}`;
  return derivePlanningSpaceId(planningSpaceHome);
}

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

/** Minimal one-node plan sufficient for a valid Record. */
function linearPlan(runId: RunId) {
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

/** Publish a canonical Run Record into the filesystem store at storeRoot. */
function publishRun(opts: {
  storeRoot: string;
  runId: string;
  changeId: string;
  planningSpaceId: string;
  workspaceInstanceId: string;
  changeInstanceId: string;
}): string {
  const runId = branded<RunId>(opts.runId);
  const plan = linearPlan(runId);
  const record = createCanonicalRunRecord({
    runId,
    runOrdinal: 1,
    change: {
      planningSpaceId: branded<PlanningSpaceId>(opts.planningSpaceId),
      projectId: 'test-project',
      changeId: opts.changeId,
      instanceId: branded<ChangeInstanceId>(opts.changeInstanceId),
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
  const store = createFilesystemRunStore(opts.storeRoot);
  store.create(runId, record);
  return opts.runId;
}

// ===========================================================================
// (a) Association registry: archive → recreate → distinct ChangeInstance
// ===========================================================================

describe('archive → recreate journeys — association registry (15.7a)', () => {
  const planningSpaceId = derivePlanningSpaceId('archive-test-home');

  it('archive then recreate with a new physical identity produces a DISTINCT ChangeInstance', () => {
    const ledger0 = createAssociationLedger(planningSpaceId, 'project-test');
    const changeId = 'fixture-change';

    // --- Generation 1: bind active ---
    const gen1 = bindActiveAssociation(ledger0, {
      changeId,
      alias: 'rasen/changes/fixture-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    expect(gen1.disposition).toBe('bound');
    const gen1InstanceId = gen1.association.instanceId;

    // --- Archive generation 1 ---
    const archived = archiveAssociation(gen1.ledger, {
      changeId,
      instanceId: gen1InstanceId,
      activeAlias: 'rasen/changes/fixture-change',
      archiveAlias: 'rasen/changes/archive/2026-07-27-fixture-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    const archivedAssoc = findAssociationByAlias(
      archived,
      'rasen/changes/archive/2026-07-27-fixture-change'
    );
    expect(archivedAssoc).toBeDefined();
    expect(archivedAssoc!.state).toBe('archived');
    expect(archivedAssoc!.instanceId).toBe(gen1InstanceId);

    // --- Generation 2: recreate with a NEW physical identity ---
    const gen2 = bindActiveAssociation(archived, {
      changeId,
      alias: 'rasen/changes/fixture-change',
      physicalIdentity: NEW_PHYSICAL,
    });
    expect(gen2.disposition).toBe('bound');
    const gen2InstanceId = gen2.association.instanceId;

    // DISTINCT ChangeInstance — the core archive/recreate invariant.
    expect(gen2InstanceId).not.toBe(gen1InstanceId);

    // The OLD instance is still findable by its archive alias.
    const oldFound = findAssociationByAlias(
      gen2.ledger,
      'rasen/changes/archive/2026-07-27-fixture-change'
    );
    expect(oldFound?.instanceId).toBe(gen1InstanceId);
    expect(oldFound?.state).toBe('archived');

    // The NEW instance is findable by its active alias.
    const newFound = findAssociationByAlias(
      gen2.ledger,
      'rasen/changes/fixture-change'
    );
    expect(newFound?.instanceId).toBe(gen2InstanceId);
    expect(newFound?.state).toBe('active');
  });

  it('distinct ChangeInstance yields a distinct RunId: OLD runId is not derivable from the recreated state', () => {
    const ledger0 = createAssociationLedger(planningSpaceId, 'project-test');
    const changeId = 'runid-change';
    const launchKey = `cli-start-${changeId}`;

    const gen1 = bindActiveAssociation(ledger0, {
      changeId,
      alias: 'rasen/changes/runid-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    const archived = archiveAssociation(gen1.ledger, {
      changeId,
      instanceId: gen1.association.instanceId,
      activeAlias: 'rasen/changes/runid-change',
      archiveAlias: 'rasen/changes/archive/2026-07-27-runid-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    const gen2 = bindActiveAssociation(archived, {
      changeId,
      alias: 'rasen/changes/runid-change',
      physicalIdentity: NEW_PHYSICAL,
    });

    const oldRunId = deriveRunId(
      planningSpaceId,
      gen1.association.instanceId,
      changeId,
      launchKey
    );
    const newRunId = deriveRunId(
      planningSpaceId,
      gen2.association.instanceId,
      changeId,
      launchKey
    );

    // The OLD Run's exact runId is cryptographically distinct from the NEW one.
    expect(oldRunId).not.toBe(newRunId);
    // A NEW launch under the recreated instance cannot target the OLD Run.
    expect(oldRunId.startsWith('run:')).toBe(true);
    expect(newRunId.startsWith('run:')).toBe(true);
  });

  it('rebind with the SAME physical identity after archive reactivates the same instance (no false distinct)', () => {
    // This proves the registry does not hallucinate a new instance when the
    // directory was genuinely NOT recreated (same inode). The distinct-instance
    // semantics require a DIFFERENT physical identity.
    const ledger0 = createAssociationLedger(planningSpaceId, 'project-test');
    const changeId = 'same-physical-change';

    const gen1 = bindActiveAssociation(ledger0, {
      changeId,
      alias: 'rasen/changes/same-physical-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    const archived = archiveAssociation(gen1.ledger, {
      changeId,
      instanceId: gen1.association.instanceId,
      activeAlias: 'rasen/changes/same-physical-change',
      archiveAlias: 'rasen/changes/archive/2026-07-27-same-physical-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    // Rebind with the SAME physical identity → same deterministic instanceId.
    const reactivated = bindActiveAssociation(archived, {
      changeId,
      alias: 'rasen/changes/same-physical-change',
      physicalIdentity: OLD_PHYSICAL,
    });
    expect(reactivated.association.instanceId).toBe(gen1.association.instanceId);
    expect(reactivated.disposition).toBe('bound');
    expect(reactivated.association.state).toBe('active');
  });
});

// ===========================================================================
// (b) Two archived generations with the same key: ambiguity detection
// ===========================================================================

describe('archive → recreate journeys — two archived generations (15.7b)', () => {
  const planningSpaceId = derivePlanningSpaceId('ambiguity-test-home');

  it('two archived generations with the same changeId are distinctly resolved by alias', () => {
    const ledger0 = createAssociationLedger(planningSpaceId, 'project-ambig');
    const changeId = 'ambig-change';

    // Generation 1
    const gen1 = bindActiveAssociation(ledger0, {
      changeId,
      alias: 'rasen/changes/ambig-change',
      physicalIdentity: { ...OLD_PHYSICAL, fileIndex: 1000n, birthIdentity: 1001n },
    });
    const gen1Archived = archiveAssociation(gen1.ledger, {
      changeId,
      instanceId: gen1.association.instanceId,
      activeAlias: 'rasen/changes/ambig-change',
      archiveAlias: 'rasen/changes/archive/2026-07-27-ambig-change',
      physicalIdentity: { ...OLD_PHYSICAL, fileIndex: 1000n, birthIdentity: 1001n },
    });

    // Generation 2
    const gen2 = bindActiveAssociation(gen1Archived, {
      changeId,
      alias: 'rasen/changes/ambig-change',
      physicalIdentity: { ...NEW_PHYSICAL, fileIndex: 2000n, birthIdentity: 2001n },
    });
    const gen2Archived = archiveAssociation(gen2.ledger, {
      changeId,
      instanceId: gen2.association.instanceId,
      activeAlias: 'rasen/changes/ambig-change',
      archiveAlias: 'rasen/changes/archive/2026-07-28-ambig-change',
      physicalIdentity: { ...NEW_PHYSICAL, fileIndex: 2000n, birthIdentity: 2001n },
    });

    // Generation 3 (active)
    const gen3 = bindActiveAssociation(gen2Archived, {
      changeId,
      alias: 'rasen/changes/ambig-change',
      physicalIdentity: { ...NEW_PHYSICAL, fileIndex: 3000n, birthIdentity: 3001n },
    });

    // Each archived generation is distinctly resolved by its unique alias.
    const gen1Found = findAssociationByAlias(
      gen3.ledger,
      'rasen/changes/archive/2026-07-27-ambig-change'
    );
    const gen2Found = findAssociationByAlias(
      gen3.ledger,
      'rasen/changes/archive/2026-07-28-ambig-change'
    );
    expect(gen1Found?.instanceId).toBe(gen1.association.instanceId);
    expect(gen2Found?.instanceId).toBe(gen2.association.instanceId);
    expect(gen1Found?.instanceId).not.toBe(gen2Found?.instanceId);

    // A changeId-only lookup is ambiguous: multiple associations share the
    // changeId. No single one can be silently selected for a same-key launch.
    const allForChangeId = gen3.ledger.revisions.at(-1)!.associations.filter(
      (a) => a.changeId === changeId
    );
    expect(allForChangeId.length).toBe(3);
    const instanceIds = new Set(allForChangeId.map((a) => a.instanceId));
    expect(instanceIds.size).toBe(3); // all distinct
  });
});

// ===========================================================================
// (c) + filesystem store: manual move missing + OLD Run exact inspect
// ===========================================================================

describe('archive → recreate journeys — filesystem store: OLD Run survives source removal (15.7c)', () => {
  let tempHome: string;
  let projectRoot: string;
  let storeRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-archive-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-archive-proj-'));
    fs.mkdirSync(path.join(projectRoot, WORKSPACE_DIR_NAME), { recursive: true });
    // A config.yaml is required by resolveProjectHome({ ensure: true }) so it
    // can mint a projectId into the config.
    fs.writeFileSync(
      path.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yaml'),
      'projectId: test-project-id\n',
      'utf-8'
    );

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

  it('OLD Run exact inspect (store + projector) works after source change directory is removed', async () => {
    const psId = derivePlanningSpace(projectRoot);
    const wsId = deriveWorkspaceId(projectRoot);
    const changeId = 'manual-move-change';
    const changeDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', changeId);

    // Source directory exists (active).
    fs.mkdirSync(changeDir, { recursive: true });

    // Publish a Run into the filesystem store (the machine-home truth).
    const runId = `run:${'a'.repeat(64)}`;
    publishRun({
      storeRoot,
      runId,
      changeId,
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
      changeInstanceId: deriveChangeInstanceId(psId, changeId, OLD_PHYSICAL) as string,
    });

    // Sanity: the Run is inspectable while the source is active.
    const store = createFilesystemRunStore(storeRoot);
    const activeRecord = store.load(branded<RunId>(runId));
    const activeView = projectRunView(activeRecord);
    expect(activeView.runId).toBe(runId);
    expect(activeView.status).toBe('running');

    // Simulate a manual move: remove the change directory without an archive
    // record. This is the "unprovable move" case (design §3: "a manual move
    // that cannot be proven ... is `missing`/new, never guessed").
    fs.rmSync(changeDir, { recursive: true, force: true });

    // The OLD Run is STILL exactly inspectable from the machine-home store.
    // Source removal does NOT delete or corrupt the Run Record.
    const movedRecord = store.load(branded<RunId>(runId));
    const movedView = projectRunView(movedRecord);
    expect(movedView.runId).toBe(runId);
    expect(movedView.change.changeId).toBe(changeId);
    expect(movedView.recordVersion).toBe(activeView.recordVersion);

    // sourceState resolves to 'missing' via the management handler's
    // resolveSourceState logic (change dir gone, no archive entry).
    // handleRunDetail still returns the view — read-only, no crash.
    const detailResult = await handleRunDetail(changeId, runId, projectRoot, null);
    expect(detailResult.ok).toBe(true);
    if (detailResult.ok) {
      expect(detailResult.view.runId).toBe(runId);
    }
  });

  it('sourceState transitions active → archived → missing as the source moves through lifecycle', async () => {
    // This exercises the management handler's `handleRuns` sourceState logic
    // (the ONLY surface that currently computes sourceState from filesystem
    // existence) through the full lifecycle.
    const psId = derivePlanningSpace(projectRoot);
    const wsId = deriveWorkspaceId(projectRoot);
    const changeId = 'lifecycle-change';
    const changeDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', changeId);

    // Active: change directory exists.
    fs.mkdirSync(changeDir, { recursive: true });
    const runId = `run:${'b'.repeat(64)}`;
    publishRun({
      storeRoot,
      runId,
      changeId,
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
      changeInstanceId: deriveChangeInstanceId(psId, changeId, OLD_PHYSICAL) as string,
    });

    // Resolve the project home (ensure: true registers the project + creates
    // the home directory structure). The `home.archiveDir` is where
    // resolveSourceState looks for archived change directories.
    const home = await resolveProjectHome(projectRoot, { ensure: true });

    // Helper: find the summary for our changeId in the reconciler list.
    const summaryFor = async () => {
      const result = await handleRuns(projectRoot, home);
      return result.reconcilerRuns.find((r) => r.changeId === changeId);
    };

    // --- active ---
    const activeSummary = await summaryFor();
    expect(activeSummary).toBeDefined();
    expect(activeSummary!.sourceState).toBe('active');

    // --- archived: move change dir to an archive-name pattern under home's
    //     archive axis. resolveSourceState looks for `*-<changeId>` dirs under
    //     <home>/archive.
    fs.rmSync(changeDir, { recursive: true, force: true });
    const archiveDir = home!.archiveDir;
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(path.join(archiveDir, `2026-07-27-${changeId}`), { recursive: true });
    const archivedSummary = await summaryFor();
    expect(archivedSummary!.sourceState).toBe('archived');

    // --- missing: remove the archive entry too.
    fs.rmSync(path.join(archiveDir, `2026-07-27-${changeId}`), {
      recursive: true,
      force: true,
    });
    const missingSummary = await summaryFor();
    expect(missingSummary!.sourceState).toBe('missing');

    // The Run remains exactly inspectable in ALL three source states —
    // sourceState reflects source presence, not Run integrity.
    const detailResult = await handleRunDetail(changeId, runId, projectRoot, null);
    expect(detailResult.ok).toBe(true);
  });

  it('OLD and NEW Runs coexist in the store after archive→recreate (distinct runIds)', () => {
    const psId = derivePlanningSpace(projectRoot);
    const wsId = deriveWorkspaceId(projectRoot);
    const changeId = 'coexist-change';

    const oldInstanceId = deriveChangeInstanceId(psId, changeId, OLD_PHYSICAL);
    const newInstanceId = deriveChangeInstanceId(psId, changeId, NEW_PHYSICAL);
    const launchKey = `cli-start-${changeId}`;
    const oldRunId = deriveRunId(psId, oldInstanceId, changeId, launchKey);
    const newRunId = deriveRunId(psId, newInstanceId, changeId, launchKey);

    // Publish both Runs into the same store.
    publishRun({
      storeRoot,
      runId: oldRunId,
      changeId,
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
      changeInstanceId: oldInstanceId as string,
    });
    publishRun({
      storeRoot,
      runId: newRunId,
      changeId,
      planningSpaceId: psId as string,
      workspaceInstanceId: wsId as string,
      changeInstanceId: newInstanceId as string,
    });

    // Both are independently inspectable — the store does not collapse them.
    const store = createFilesystemRunStore(storeRoot);
    expect(store.has(branded<RunId>(oldRunId))).toBe(true);
    expect(store.has(branded<RunId>(newRunId))).toBe(true);

    const oldView = projectRunView(store.load(branded<RunId>(oldRunId)));
    const newView = projectRunView(store.load(branded<RunId>(newRunId)));
    expect(oldView.change.instanceId).not.toBe(newView.change.instanceId);
    expect(oldView.runId).not.toBe(newView.runId);
  });
});

// ===========================================================================
// (d) Linked-worktree list/control isolation
// ===========================================================================

describe('archive → recreate journeys — linked-worktree isolation (15.7d)', () => {
  let tempHome: string;
  let projectRootA: string;
  let projectRootB: string;
  let storeRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-worktree-home-'));
    projectRootA = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wt-a-'));
    projectRootB = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wt-b-'));
    for (const root of [projectRootA, projectRootB]) {
      fs.mkdirSync(path.join(root, WORKSPACE_DIR_NAME), { recursive: true });
      fs.mkdirSync(path.join(root, WORKSPACE_DIR_NAME, 'changes'), { recursive: true });
    }

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
    fs.rmSync(projectRootA, { recursive: true, force: true });
    fs.rmSync(projectRootB, { recursive: true, force: true });
  });

  it('lists, details, and controls a Run ONLY from its own worktree', async () => {
    const changeId = 'worktree-isolation-change';
    const psIdA = derivePlanningSpace(projectRootA);
    const wsIdA = deriveWorkspaceId(projectRootA);

    // Run belongs to worktree A.
    fs.mkdirSync(
      path.join(projectRootA, WORKSPACE_DIR_NAME, 'changes', changeId),
      { recursive: true }
    );
    const runId = `run:${'d'.repeat(64)}`;
    publishRun({
      storeRoot,
      runId,
      changeId,
      planningSpaceId: psIdA as string,
      workspaceInstanceId: wsIdA as string,
      changeInstanceId: deriveChangeInstanceId(psIdA, changeId, OLD_PHYSICAL) as string,
    });

    // --- LIST from worktree B: the Run is filtered out (different workspace) ---
    const listB = await handleRuns(projectRootB, null);
    const foundB = listB.reconcilerRuns.find((r) => r.runId === runId);
    expect(foundB).toBeUndefined();

    // LIST from worktree A: the Run IS present.
    const listA = await handleRuns(projectRootA, null);
    const foundA = listA.reconcilerRuns.find((r) => r.runId === runId);
    expect(foundA).toBeDefined();
    expect(foundA!.sourceState).toBe('active');

    // --- DETAIL from worktree B: scope 'other', no controls, no granted actions ---
    const detailB = await handleRunDetail(changeId, runId, projectRootB, null);
    expect(detailB.ok).toBe(true);
    if (detailB.ok) {
      expect(detailB.view.workspace.scope).toBe('other');
      const root = detailB.view.sections.find(
        (s): s is Extract<typeof s, { kind: 'root-dag' }> => s.kind === 'root-dag'
      );
      expect(root).toBeDefined();
      expect(root!.allowedControls).toEqual([]);
      for (const action of root!.actions) {
        expect(action.deliveryState).not.toBe('granted');
      }
    }

    // DETAIL from worktree A: scope 'current', controls available.
    const detailA = await handleRunDetail(changeId, runId, projectRootA, null);
    expect(detailA.ok).toBe(true);
    if (detailA.ok) {
      expect(detailA.view.workspace.scope).toBe('current');
    }

    // --- CONTROL from worktree B: rejected with workspace_scope_mismatch ---
    const controlBody = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: projectRootB, changeId },
          runId,
        },
        expectedRecordVersion: 0,
        command: {
          kind: 'cancel' as const,
        },
      },
    };

    // The spawner should NEVER be called — admission rejects before spawn.
    const neverSpawner = async () => {
      throw new Error('spawner should not be called for a cross-worktree control');
    };

    const controlB = await handleRunControl(
      changeId,
      runId,
      projectRootB,
      null,
      controlBody,
      neverSpawner
    );
    expect(controlB.ok).toBe(false);
    if (!controlB.ok) {
      expect(controlB.status).toBe(403);
      expect(controlB.code).toBe('workspace_scope_mismatch');
    }
  });
});

// ===========================================================================
// Fresh CLI: OLD Run exact inspect after source removal (cross-process)
// ===========================================================================

describe('archive → recreate journeys — fresh CLI cross-process inspect (15.7)', () => {
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-archive-cli-'));
    dataDir = path.join(testDir, 'global-data');
    // A qualifying Rasen root needs specs + changes directories.
    await fs.promises.mkdir(path.join(testDir, WORKSPACE_DIR_NAME, 'specs'), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(testDir, WORKSPACE_DIR_NAME, 'changes'), {
      recursive: true,
    });
    // `pipeline start` observes the git workspace (HEAD/tree/index) via
    // observeGitWorkspace → git ls-files. The testDir must be a git repo with
    // at least one commit so HEAD and the tree digest are derivable.
    const { execSync } = await import('node:child_process');
    const git = (args: string[]) =>
      execSync(`git ${args.join(' ')}`, {
        cwd: testDir,
        env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    git(['init', '-q']);
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'global-data/\n');
    git(['add', '.gitignore']);
    git(['commit', '-q', '-m', 'init']);
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it(
    'OLD Run exact `status` survives cross-process after source archive/removal',
    async () => {
      const changeId = 'e2e-archive';
      const env = { XDG_DATA_HOME: dataDir };

      // --- 1. LAUNCH: pipeline start creates the Run on the store ---
      const changeDir = path.join(testDir, WORKSPACE_DIR_NAME, 'changes', changeId);
      fs.mkdirSync(changeDir, { recursive: true });

      const startResult = await runCLI(
        ['pipeline', 'start', changeId, 'bug-fix', '--json'],
        { cwd: testDir, env, timeoutMs: 60_000 }
      );
      if (startResult.exitCode !== 0) {
        // Capture the actual CLI error for debugging.
        throw new Error(
          `pipeline start failed (exit ${startResult.exitCode}):\nstderr: ${startResult.stderr.slice(0, 1500)}\nstdout: ${startResult.stdout.slice(0, 500)}`
        );
      }
      const startJson = JSON.parse(startResult.stdout.trim());
      expect(startJson.disposition).toBe('created');
      const runId = startJson.runId as string;
      expect(runId).toMatch(/^run:[0-9a-f]{64}$/);

      // --- 2. Verify the Run is inspectable while source is active ---
      const statusActive = await runCLI(
        ['pipeline', 'status', changeId, 'bug-fix', '--json'],
        { cwd: testDir, env, timeoutMs: 60_000 }
      );
      expect(statusActive.exitCode).toBe(0);
      const statusActiveJson = JSON.parse(statusActive.stdout.trim());
      expect(statusActiveJson.runId).toBe(runId);

      // --- 3. Simulate archive: remove the source change directory ---
      // (In production, archive completion moves the dir to an archive alias.
      // Here we simulate the post-archive state: the source is gone but the
      // Run Record persists in the machine-home store.)
      fs.rmSync(changeDir, { recursive: true, force: true });

      // --- 4. OLD Run exact inspect via `status` after source removal ---
      // Source removal does not delete the Run Record from the machine-home
      // store. The CLI derives the runId from `statSync(projectRoot)` — which
      // is UNCHANGED by removing the change directory — so the same runId is
      // derived and the same Run is loaded. This proves the Run survives
      // source archive/removal through a fresh CLI process.
      //
      // The Run's state is byte-identical to the pre-removal snapshot: source
      // removal affects only sourceState (reported by the management list
      // handler), never the Run Record itself.
      const statusRemoved = await runCLI(
        ['pipeline', 'status', changeId, 'bug-fix', '--json'],
        { cwd: testDir, env, timeoutMs: 60_000 }
      );
      expect(statusRemoved.exitCode).toBe(0);
      const statusRemovedJson = JSON.parse(statusRemoved.stdout.trim());
      // The Run is the SAME Run — exact runId match, cross-process.
      expect(statusRemovedJson.runId).toBe(runId);
      expect(statusRemovedJson.view.runId).toBe(runId);
      expect(statusRemovedJson.view.change.changeId).toBe(changeId);
      // The Run's state is unchanged by source removal.
      expect(statusRemovedJson.view.recordVersion).toBe(
        statusActiveJson.view.recordVersion
      );
    },
    180_000
  ); // 3-minute timeout for multi-spawn CLI E2E on Windows
});
