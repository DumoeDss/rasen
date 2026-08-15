/**
 * `store-planning-worktree-bindings` tasks 7.1–7.7 — the two-phase pair.
 *
 * `WorkspacePairId` needs a `ChangeInstanceId`; a `ChangeInstanceId` is minted
 * by `createChange`; `createChange` requires a verified planning worktree. That
 * circle is why preparation and binding are two phases:
 *
 *     plan/apply    ->  PREPARED  (scope + both worktrees, no pair id)
 *     createChange  ->  BOUND     (Change instance + pair id completed)
 *
 * The four binding states are not decoration: `unbound` means nothing is
 * prepared for the scope, `drifted` means the recorded pair disagrees with live
 * Git, and a command that needs the pair refuses on both.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreError } from '../../../src/core/store/errors.js';
import { deriveWorkspacePairId } from '../../../src/core/store/planning-identity.js';
import {
  StoreWorkspace,
  assertPlanningWorktreeUnbound,
  completeChangeBinding,
} from '../../../src/core/store/workspace/module.js';
import { serializeBindingFact } from '../../../src/core/store/workspace/binding.js';
import { readWorkspaceIndexEntry } from '../../../src/core/store/workspace/registry.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';

function codeOf(error: unknown): string {
  if (error instanceof StoreError) return error.diagnostic.code;
  throw error;
}

describe('workspace pairing: prepared to bound', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;
  let scopeId: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-pairing-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    planningWorktree = f.beside('store-planning-redesign');
    executionWorktree = f.beside('app-a-redesign');
    scopeId = f.planningScopeId(PROJECT, LINE);
  });

  afterEach(() => {
    f.cleanup();
  });

  function selectors(overrides: Record<string, unknown> = {}) {
    return {
      store: f.storeId,
      project: PROJECT,
      targetLine: LINE,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      ...overrides,
    } as Parameters<StoreWorkspace['describe']>[0];
  }

  function planInput(overrides: Record<string, unknown> = {}) {
    return {
      ...selectors(),
      changeId: CHANGE,
      planningWorktree,
      executionWorktree,
      ...overrides,
    } as Parameters<StoreWorkspace['plan']>[0];
  }

  async function prepare(overrides: Record<string, unknown> = {}): Promise<void> {
    const built = await f.workspace().plan(planInput(overrides));
    expect(built.applicable, JSON.stringify(built.blockers)).toBe(true);
    await f.workspace().apply(built.token!);
  }

  function bindingInput(overrides: Record<string, unknown> = {}) {
    return {
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: PROJECT,
      targetLineId: LINE,
      planningScopeId: scopeId,
      changeId: CHANGE,
      planningRoot: planningWorktree,
      globalDataDir: f.globalDataDir,
      ...overrides,
    };
  }

  // ---- the four binding states ------------------------------------------

  it('describes a scope with no prepared workspace as unbound and says so', async () => {
    const description = await f.workspace().describe(selectors());

    expect(description.bindingState).toBe('unbound');
    expect(description.prepared).toBe(false);
    expect(description.planning).toBeUndefined();
    expect(description.execution).toBeUndefined();
    expect(description.findings).toHaveLength(1);
    expect(description.findings[0]?.code).toBe('workspace_not_prepared');
    expect(description.findings[0]?.message).toContain(`project '${PROJECT}'`);
    expect(description.findings[0]?.message).toContain(`target line '${LINE}'`);
    expect(description.scope?.planningScopeId).toBe(scopeId);
  });

  it('describes a prepared pair as prepared, with no Change instance and no pair id', async () => {
    await prepare();

    const description = await f.workspace().describe(selectors({ changeId: CHANGE }));

    expect(description.bindingState).toBe('prepared');
    expect(description.prepared).toBe(true);
    expect(description.changeId).toBe(CHANGE);
    // Absent facts are ABSENT, never null and never guessed.
    expect(description.changeInstanceId).toBeUndefined();
    expect(description.workspacePairId).toBeUndefined();
    expect(description.planning?.root).toBe(planningWorktree);
    expect(description.execution?.root).toBe(executionWorktree);
    expect(description.findings).toEqual([]);
  });

  it('completes the pair when the Change is created, and describes it as bound', async () => {
    await prepare();
    const seeded = f.seedChange({
      root: planningWorktree,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });

    const completed = await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    );

    expect(completed.bindingState).toBe('bound');
    expect(completed.workspacePairId?.startsWith('wp_')).toBe(true);
    // The pair id is derived from the Change instance and BOTH worktree
    // instances, so it is reproducible from facts the index already records.
    const entry = await readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      scopeId,
      CHANGE
    );
    expect(completed.workspacePairId).toBe(
      deriveWorkspacePairId({
        changeInstanceId: seeded.instanceId,
        planningWorktreeInstanceId: entry!.planning.worktreeInstanceId,
        executionWorktreeInstanceId: entry!.execution.worktreeInstanceId,
      })
    );
    expect(entry?.phase).toBe('bound');
    expect(entry?.changeInstanceId).toBe(seeded.instanceId);

    const description = await f.workspace().describe(selectors({ changeId: CHANGE }));
    expect(description.bindingState).toBe('bound');
    expect(description.changeInstanceId).toBe(seeded.instanceId);
    expect(description.workspacePairId).toBe(completed.workspacePairId);
  });

  it('describes a pair whose worktree has been removed as drifted, and rewrites nothing', async () => {
    await prepare();
    const seeded = f.seedChange({
      root: planningWorktree,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    );
    const before = fs.readFileSync(
      path.join(f.globalDataDir, 'planning-workspaces', 'index', `${scopeId}.json`)
    );

    // The user deleted the directory out from under the pair — the ordinary
    // way a recorded worktree goes missing.
    fs.rmSync(executionWorktree, { recursive: true, force: true });

    const description = await f.workspace().describe(selectors({ changeId: CHANGE }));
    expect(description.bindingState).toBe('drifted');
    const absent = description.findings.find(
      (finding) => finding.code === 'workspace_worktree_absent'
    );
    expect(absent?.message).toContain(executionWorktree);
    expect(absent?.severity).toBe('error');
    // Reporting drift changes nothing.
    expect(
      fs
        .readFileSync(path.join(f.globalDataDir, 'planning-workspaces', 'index', `${scopeId}.json`))
        .equals(before)
    ).toBe(true);
  });

  it('writes nothing while describing, in any state', async () => {
    await prepare();
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${scopeId}.json`
    );
    const before = fs.readFileSync(indexPath);
    const markerBefore = fs.readFileSync(
      path.join(planningWorktree, '.rasen', 'planning-line.json')
    );

    await f.workspace().describe(selectors({ changeId: CHANGE }));
    await f.workspace().describe(selectors());

    expect(fs.readFileSync(indexPath).equals(before)).toBe(true);
    expect(
      fs.readFileSync(path.join(planningWorktree, '.rasen', 'planning-line.json')).equals(markerBefore)
    ).toBe(true);
    expect(await f.dependencies.git.dirtyEntries(f.storeRoot)).toEqual([]);
  });

  // ---- the second-Change rule -------------------------------------------

  it('refuses a second Change in a bound planning worktree, from the record and not a scan', async () => {
    await prepare();
    const seeded = f.seedChange({
      root: planningWorktree,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    );

    const error = await assertPlanningWorktreeUnbound(
      bindingInput({ changeId: 'second-change' }),
      f.dependencies
    ).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_already_bound');
    expect((error as StoreError).diagnostic.message).toContain(CHANGE);
    expect((error as StoreError).diagnostic.target).toBe(planningWorktree);
    // The decision came from the RECORDED binding: the planning worktree holds
    // no directory for the second Change at all, so a scan could not have
    // produced this answer.
    expect(
      fs.existsSync(
        path.join(planningWorktree, 'rasen', 'projects', PROJECT, 'changes', 'second-change')
      )
    ).toBe(false);
  });

  it('permits the SAME Change to reach binding twice, which is how an interrupted run completes', async () => {
    await prepare();
    const own = await assertPlanningWorktreeUnbound(bindingInput(), f.dependencies);
    expect(own?.changeId).toBe(CHANGE);
  });

  it('permits a second Change in a planning worktree that is prepared but not yet bound', async () => {
    // `unbound` is the state a prepared-but-never-bound pair sits in; the rule
    // is one active Change INSTANCE per planning worktree, and there is none.
    await prepare();
    await expect(
      assertPlanningWorktreeUnbound(bindingInput({ changeId: 'second-change' }), f.dependencies)
    ).resolves.toBeNull();
  });

  // ---- scope disagreement at completion ----------------------------------

  it('refuses to complete a binding whose marker names another project or line', async () => {
    await prepare();
    const seeded = f.seedChange({
      root: planningWorktree,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    // Rewrite the marker to declare another line. The Change's committed
    // identity is the authority, so the marker loses — by refusing, never by
    // being rewritten.
    f.write(
      path.join(planningWorktree, '.rasen', 'planning-line.json'),
      serializeBindingFact({
        version: 1,
        storeUid: f.storeUid,
        storeId: f.storeId,
        projectId: PROJECT,
        targetLineId: 'line-0.3',
        executionRoot: executionWorktree,
      })
    );
    const markerBefore = fs.readFileSync(
      path.join(planningWorktree, '.rasen', 'planning-line.json')
    );

    const error = await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    ).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_marker_conflict');
    expect((error as StoreError).diagnostic.message).toContain('line-0.3');
    expect((error as StoreError).diagnostic.fix).toContain('neither carrier is rewritten');
    expect(
      fs.readFileSync(path.join(planningWorktree, '.rasen', 'planning-line.json')).equals(markerBefore)
    ).toBe(true);
  });

  it('refuses to complete a binding whose marker names another STORE', async () => {
    // `storeUid`, `projectId`, and `targetLineId` are orthogonal dimensions and
    // `projectId` is portable, so a marker written for a different Store with
    // the same project and line is a real conflict — and a comparison that
    // checks only the last two waves it through, recording `storeUid: B` beside
    // an on-disk marker saying `storeUid: A`. The capability names this layer.
    await prepare();
    const seeded = f.seedChange({
      root: planningWorktree,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    const otherStoreUid = '11111111-2222-3333-4444-555555555555';
    expect(otherStoreUid).not.toBe(f.storeUid);
    f.write(
      path.join(planningWorktree, '.rasen', 'planning-line.json'),
      serializeBindingFact({
        version: 1,
        storeUid: otherStoreUid,
        storeId: 'another-store',
        projectId: PROJECT,
        targetLineId: LINE,
        executionRoot: executionWorktree,
      })
    );
    const markerBefore = fs.readFileSync(
      path.join(planningWorktree, '.rasen', 'planning-line.json')
    );

    const error = await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    ).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_marker_conflict');
    expect((error as StoreError).diagnostic.message).toContain(otherStoreUid);
    expect((error as StoreError).diagnostic.fix).toContain('neither carrier is rewritten');
    // Nothing was rewritten to agree, and no entry recorded the disagreement.
    expect(
      fs.readFileSync(path.join(planningWorktree, '.rasen', 'planning-line.json')).equals(markerBefore)
    ).toBe(true);
    const entry = await readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      scopeId,
      CHANGE
    );
    expect(entry?.changeInstanceId).toBeUndefined();
  });

  it('records the Change instance and says so when no execution side is known', async () => {
    // A planning-only creation: a hand-assembled planning worktree with a
    // marker that names no execution root. The pair id stays incomplete rather
    // than being invented.
    const handMade = f.beside('hand-made-planning');
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'hand/made', handMade, 'refs/heads/release/0.2']);
    f.write(
      path.join(handMade, '.rasen', 'planning-line.json'),
      serializeBindingFact({
        version: 1,
        storeUid: f.storeUid,
        storeId: f.storeId,
        projectId: PROJECT,
        targetLineId: LINE,
      })
    );
    const seeded = f.seedChange({
      root: handMade,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });

    const completed = await completeChangeBinding(
      bindingInput({ planningRoot: handMade, changeInstanceId: seeded.instanceId }),
      f.dependencies
    );

    expect(completed.bindingState).toBe('prepared');
    expect(completed.workspacePairId).toBeUndefined();
    expect(completed.findings.map((finding) => finding.code)).toEqual([
      'workspace_execution_side_unknown',
    ]);
    // The Change instance IS recorded either way — the index was repaired from
    // what is already true on disk.
    expect(completed.entry?.changeInstanceId).toBe(seeded.instanceId);
    expect(completed.entry?.planning.root).toBe(handMade);
  });

  // ---- worktree replacement (task 7.5) -----------------------------------

  it('recomputes a different pair id when a worktree instance is replaced', async () => {
    await prepare();
    const seeded = f.seedChange({
      root: planningWorktree,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    const first = await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    );
    expect(first.workspacePairId).toBeDefined();

    // The execution worktree is removed and recreated somewhere else. The
    // Change instance is unchanged; the worktree instance is not.
    f.git(f.projectRoot(PROJECT), ['worktree', 'remove', '--force', executionWorktree]);
    const replacement = f.beside('app-a-redesign-2');
    f.git(f.projectRoot(PROJECT), [
      'worktree',
      'add',
      replacement,
      `change/${LINE}/${PROJECT}/${CHANGE}`,
    ]);
    f.write(
      path.join(planningWorktree, '.rasen', 'planning-line.json'),
      serializeBindingFact({
        version: 1,
        storeUid: f.storeUid,
        storeId: f.storeId,
        projectId: PROJECT,
        targetLineId: LINE,
        executionRoot: replacement,
      })
    );
    // Clear the recorded execution side so the marker is what names it, which
    // is the "the worktree was removed and is being recreated" path.
    const coordination = f.dependencies.coordination(f.globalDataDir);
    const entry = await readWorkspaceIndexEntry(coordination, scopeId, CHANGE);
    await coordination.writeJson(`index/${scopeId}.json`, {
      version: 1,
      planningScopeId: scopeId,
      entries: [
        {
          ...entry,
          workspacePairId: undefined,
          execution: { root: '', repositoryIdentity: '', worktreeInstanceId: '', ref: '', headOid: '' },
        },
      ],
    });

    const second = await completeChangeBinding(
      bindingInput({ changeInstanceId: seeded.instanceId }),
      f.dependencies
    );

    expect(second.bindingState).toBe('bound');
    expect(second.entry?.changeInstanceId).toBe(seeded.instanceId);
    expect(second.entry?.execution.root).toBe(replacement);
    // Same Change instance, different worktree instance, therefore a different
    // pair identity — exactly as child 1 specifies.
    expect(second.workspacePairId).toBeDefined();
    expect(second.workspacePairId).not.toBe(first.workspacePairId);
  });
});
