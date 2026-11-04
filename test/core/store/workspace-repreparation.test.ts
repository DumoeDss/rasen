/**
 * `fix-store-workspace-pair-transactions` — re-preparing a Change workspace.
 *
 * The field failure this suite pins: the official transaction that prepares a
 * fresh verified checkout refused twice before any write, and the refusal's own
 * repair ("re-plan") reproduced the same verdict forever. Two mechanisms, one in
 * each half of the transaction:
 *
 *   1. plan-side  — the plan ignores the machine index entry that already
 *      records a pair for this Change, so it blesses a create that apply will
 *      then refuse.
 *   2. apply-side — for a side the plan CREATES, revalidation compares the
 *      index entry's recorded `worktreeInstanceId` against a live survey of a
 *      destination that does not exist yet. An absent destination has no
 *      identity, so a surviving non-empty recorded id makes the inequality
 *      certain and `workspace_plan_stale` is guaranteed.
 *
 * THE DEFECT-PIN CONVENTION USED HERE. This file was first written with TWO
 * describe blocks against the same fixtures:
 *
 *   - `fixed contract`, stating what the change promises, RED against pre-fix
 *     code. That run is the fail-first evidence
 *     (`evidence/baseline-red-solo.txt`: 8 failed, 4 passed).
 *   - `DEFECT PIN (pre-fix behaviour)`, stating what the code did in the exact
 *     words of its own refusal, GREEN against pre-fix code -- which is what
 *     proved the fixed-contract tests landed on THIS defect rather than on some
 *     unrelated error.
 *
 * After the fix both blocks flipped together
 * (`evidence/postfix-inversion-defect-pins-red.txt`: the ten contract tests
 * green, both pins red), and the pins were then DELETED. Their deletion is the
 * record that the behaviour they described no longer exists; re-adding one is
 * how a regression would be caught in the act.
 *
 * Real Git throughout, on disposable temp fixtures. The live planning stores on
 * this machine are read-only evidence and are never touched. Every test carries
 * an explicit timeout: the 30s default passes solo and fails under the parallel
 * load of the store suites, where it reads as a broken assertion rather than as
 * a timeout.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireOwnerAwareFileLock,
  releaseOwnerAwareFileLock,
} from '../../../src/core/file-state.js';
import { isStoreWorkspaceError } from '../../../src/core/store/workspace/diagnostics.js';
import { deriveWorktreeIdentity } from '../../../src/core/store/workspace/identity.js';
import { scopeLockKey, workspaceLockPath } from '../../../src/core/store/workspace/locks.js';
import { StoreWorkspace } from '../../../src/core/store/workspace/module.js';
import {
  readWorkspaceIndexEntry,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from '../../../src/core/store/workspace/registry.js';
import type {
  ImmutableWorkspacePlan,
  PreparedChangeWorkspace,
} from '../../../src/core/store/workspace/types.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';
const STORE_BRANCH = 'release/0.2';
const STORE_REF = `refs/heads/${STORE_BRANCH}`;
const BRANCH = `refs/heads/change/${LINE}/${PROJECT}/${CHANGE}`;
const BRANCH_NAME = BRANCH.slice('refs/heads/'.length);
const ZERO_IDENTITY = `wt_${'0'.repeat(64)}`;

/**
 * Real worktree creation and removal on Windows costs seconds per call, and
 * several of these tests do it three times. The 30s default is a trap here: it
 * passes solo and fails under parallel load, where the failure reads as a
 * broken assertion rather than as a timeout.
 */
const REAL_GIT_TIMEOUT_MS = 180_000;

interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
}

function refusalOf(error: unknown): Refusal {
  if (!isStoreWorkspaceError(error)) throw error;
  return {
    code: error.workspaceCode,
    message: error.message,
    ...(error.expected === undefined ? {} : { expected: error.expected }),
    ...(error.actual === undefined ? {} : { actual: error.actual }),
  };
}

/** Runs `call`, returning the refusal it raised. Fails when it resolves. */
async function refusalFrom(call: () => Promise<unknown>): Promise<Refusal> {
  let resolved: unknown;
  try {
    resolved = await call();
  } catch (error) {
    return refusalOf(error);
  }
  throw new Error(
    `expected a refusal, but the call resolved with ${JSON.stringify(resolved).slice(0, 400)}`
  );
}

describe('re-preparing a Change workspace pair', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;
  let advanceCounter = 0;

  beforeEach(async () => {
    advanceCounter = 0;
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-repreparation-',
      projects: [PROJECT],
      storeBranches: [STORE_BRANCH],
      projectBranches: [STORE_BRANCH],
      lines: [
        {
          id: LINE,
          storeRef: STORE_REF,
          codeRefs: { [PROJECT]: STORE_REF },
        },
      ],
    });
    planningWorktree = f.beside('store-planning-redesign');
    executionWorktree = f.beside('app-a-redesign');
  });

  afterEach(() => {
    f.cleanup();
  });

  function input(overrides: Record<string, unknown> = {}) {
    return {
      store: f.storeId,
      project: PROJECT,
      targetLine: LINE,
      changeId: CHANGE,
      planningWorktree,
      executionWorktree,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      intent: 'existing-change' as const,
      ...overrides,
    } as Parameters<StoreWorkspace['plan']>[0];
  }

  function seedChange(): string {
    return f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    }).instanceId;
  }

  async function entry(): Promise<WorkspaceIndexEntry | null> {
    return readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      f.planningScopeId(PROJECT, LINE),
      CHANGE
    );
  }

  function preconditionIds(plan: ImmutableWorkspacePlan): string {
    return plan.preconditions.map((candidate) => candidate.id).join(', ');
  }

  /** Seeds the Change, plans, applies, and asserts the pair reached `bound`. */
  async function prepareBoundPair(): Promise<{
    readonly plan: ImmutableWorkspacePlan;
    readonly result: PreparedChangeWorkspace;
    readonly changeInstanceId: string;
  }> {
    const changeInstanceId = seedChange();
    const built = await f.workspace().plan(input());
    expect(built.applicable, JSON.stringify(built.blockers)).toBe(true);
    const result = await f.workspace().apply(built.token!);
    expect(result.bindingState).toBe('bound');
    expect(result.workspacePairId).toBeDefined();
    // The wedge is only armed once the index entry carries non-empty ids.
    const recorded = await entry();
    expect(recorded?.planning.worktreeInstanceId).toMatch(/^wt_/u);
    expect(recorded?.execution.worktreeInstanceId).toMatch(/^wt_/u);
    return { plan: built, result, changeInstanceId };
  }

  /** Tears the planning side down the way an operator does, leaving the entry. */
  function removePlanningWorktree(): void {
    // `--force` because the planning marker under `.rasen/` is untracked run
    // state this Module itself wrote; without it Git refuses the removal.
    f.git(f.storeRoot, ['worktree', 'remove', '--force', planningWorktree]);
    f.git(f.storeRoot, ['worktree', 'prune']);
    expect(fs.existsSync(planningWorktree)).toBe(false);
  }

  /** Advances the target line's Store ref by one commit. Returns the new OID. */
  function advanceStoreLine(): string {
    advanceCounter += 1;
    f.write(f.at(`advance-${advanceCounter}.md`), `advance ${advanceCounter}\n`);
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', `advance the line (${advanceCounter})`]);
    f.git(f.storeRoot, ['branch', '-f', STORE_BRANCH, 'HEAD']);
    return f.refOid(f.storeRoot, STORE_REF);
  }

  // ===========================================================================
  // The fixed contract. RED against pre-fix code.
  // ===========================================================================

  describe('fixed contract', () => {
    it(
      'applies a re-plan whose created destination is simply absent (task 2.2)',
      async () => {
        const { result: first, changeInstanceId } = await prepareBoundPair();
        const recordedBefore = await entry();
        removePlanningWorktree();

        const replan = await f.workspace().plan(input());
        expect(replan.applicable, JSON.stringify(replan.blockers)).toBe(true);
        expect(replan.planning.disposition).toBe('create');
        expect(replan.planning.root).toBe(planningWorktree);

        const applied = await f.workspace().apply(replan.token!);

        // The worktree is back, on the pair branch, at the frozen commit.
        expect(applied.created).toContain(planningWorktree);
        expect(f.git(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
        expect(f.git(planningWorktree, ['rev-parse', 'HEAD']).trim()).toBe(
          replan.planning.fromOid
        );
        // ...and the entry is re-recorded from the newly created state.
        const recordedAfter = await entry();
        expect(recordedAfter?.planning.worktreeInstanceId).toMatch(/^wt_/u);
        expect(recordedAfter?.phase).toBe('bound');
        // The Change instance identity is unchanged by re-preparation.
        expect(recordedAfter?.changeInstanceId).toBe(changeInstanceId);
        // A pair identity is a function of the Change instance and the two
        // worktree instance ids, and a worktree instance id is derived from its
        // canonical repository and worktree PATHS. Re-creating at the SAME
        // recorded root therefore re-derives the SAME pair identity, and the
        // spec's "re-preparing changes the pair identity" holds for the case it
        // names — prepared again with NEW worktrees — which is the
        // fresh-destination flow below, not this one. Asserting a difference
        // here would assert something the identity model cannot produce.
        expect(applied.workspacePairId).toBe(first.workspacePairId);
        expect(recordedBefore?.planning.worktreeInstanceId).toBe(
          recordedAfter?.planning.worktreeInstanceId
        );
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'refuses a second pair at a fresh destination while the recorded pair is live, and converges after cleanup (task 3.2)',
      async () => {
        const { result: first } = await prepareBoundPair();
        const freshPlanning = f.beside('store-planning-redesign-second');

        const blocked = await f.workspace().plan(input({ planningWorktree: freshPlanning }));

        expect(blocked.applicable).toBe(false);
        expect(blocked.token).toBeUndefined();
        const blocker = blocked.blockers.find(
          (candidate) => candidate.id === 'planning-recorded-pair-single'
        );
        expect(blocker, JSON.stringify(blocked.blockers)).toBeDefined();
        expect(blocker?.code).toBe('workspace_already_bound');
        expect(blocker?.detail).toContain(planningWorktree);
        expect(blocker?.detail).toContain('rasen store workspace cleanup --change');
        // Nothing was created and the recorded pair is untouched.
        expect(fs.existsSync(freshPlanning)).toBe(false);
        expect(fs.existsSync(planningWorktree)).toBe(true);

        // The named repair works, and the same fresh destination then applies.
        const cleanup = await f.workspace().planCleanup({
          store: f.storeId,
          project: PROJECT,
          targetLine: LINE,
          changeId: CHANGE,
          startPath: f.storeRoot,
          globalDataDir: f.globalDataDir,
        });
        expect(cleanup.applicable, JSON.stringify(cleanup.blockers)).toBe(true);
        await f.workspace().applyCleanup(cleanup.token!);
        expect(await entry()).toBeNull();

        const reprepared = await f.workspace().plan(input({ planningWorktree: freshPlanning }));
        expect(reprepared.applicable, JSON.stringify(reprepared.blockers)).toBe(true);
        const applied = await f.workspace().apply(reprepared.token!);
        expect(applied.created).toContain(freshPlanning);
        expect(f.git(freshPlanning, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
        // NEW worktrees, so this is the case the spec's "re-preparing an
        // existing Change changes the pair identity" scenario names.
        expect(applied.workspacePairId).toBeDefined();
        expect(applied.workspacePairId).not.toBe(first.workspacePairId);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'states the re-creation of a vanished recorded pair in the preview (task 3.3)',
      async () => {
        await prepareBoundPair();
        removePlanningWorktree();

        // Planned WITHOUT naming a destination: the recorded root is the
        // default, which is the path the field flow takes.
        const replan = await f
          .workspace()
          .plan(input({ planningWorktree: undefined, executionWorktree: undefined }));

        expect(replan.applicable, JSON.stringify(replan.blockers)).toBe(true);
        const recreated = replan.preconditions.find(
          (candidate) => candidate.id === 'planning-recorded-pair-recreated'
        );
        expect(recreated, preconditionIds(replan)).toBeDefined();
        expect(recreated?.satisfied).toBe(true);
        expect(recreated?.detail).toContain(planningWorktree);
        expect(replan.planning.root).toBe(planningWorktree);
        // The execution side is untouched and stays a reuse, so it reports no
        // re-creation at all.
        expect(
          replan.preconditions.some(
            (candidate) => candidate.id === 'execution-recorded-pair-recreated'
          )
        ).toBe(false);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it.skipIf(process.platform !== 'win32')(
      'treats a case-aliased spelling of the recorded root as the same root (task 3.3)',
      async () => {
        await prepareBoundPair();
        removePlanningWorktree();

        // Same directory, different spelling. On Windows this is ONE path, so
        // it must neither block as a second pair nor plan a different root.
        const aliased = path.join(
          path.dirname(planningWorktree),
          path.basename(planningWorktree).toUpperCase()
        );
        expect(aliased).not.toBe(planningWorktree);

        const replan = await f.workspace().plan(input({ planningWorktree: aliased }));

        expect(replan.applicable, JSON.stringify(replan.blockers)).toBe(true);
        expect(
          replan.blockers.some((candidate) => candidate.code === 'workspace_already_bound')
        ).toBe(false);
        const recreated = replan.preconditions.find(
          (candidate) => candidate.id === 'planning-recorded-pair-recreated'
        );
        expect(recreated?.satisfied).toBe(true);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'names the ref and frozen commit every created side is born from (task 4.1)',
      async () => {
        seedChange();
        const plan = await f.workspace().plan(input());
        const storeOid = f.refOid(f.storeRoot, STORE_REF);
        const codeOid = f.refOid(f.projectRoot(PROJECT), STORE_REF);

        for (const [side, oid] of [
          ['planning', storeOid],
          ['execution', codeOid],
        ] as const) {
          const disclosed = plan.preconditions.find(
            (candidate) => candidate.id === `${side}-created-from`
          );
          expect(disclosed, preconditionIds(plan)).toBeDefined();
          expect(disclosed?.satisfied).toBe(true);
          expect(disclosed?.detail).toContain(STORE_REF);
          expect(disclosed?.detail).toContain(oid);
        }

        // A reuse side is not created, so it discloses no birth commit.
        await f.workspace().apply(plan.token!);
        const second = await f.workspace().plan(input());
        expect(second.planning.disposition).toBe('reuse');
        expect(second.execution.disposition).toBe('reuse');
        expect(
          second.preconditions.filter((candidate) => candidate.id.endsWith('-created-from'))
        ).toEqual([]);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'still refuses a resumed created destination that is a different incarnation (task 2.3)',
      async () => {
        seedChange();
        const plan = await f.workspace().plan(input());
        expect(plan.planning.disposition).toBe('create');

        // The state an interrupted apply leaves: the destination exists, on the
        // planned ref, created from the frozen commit — and the index entry
        // records THAT root.
        f.git(f.storeRoot, [
          'worktree',
          'add',
          '-b',
          BRANCH_NAME,
          planningWorktree,
          plan.planning.fromOid,
        ]);
        f.git(f.projectRoot(PROJECT), [
          'worktree',
          'add',
          '-b',
          BRANCH_NAME,
          executionWorktree,
          plan.execution.fromOid,
        ]);
        const live = await deriveWorktreeIdentity(f.dependencies, planningWorktree);
        const liveExecution = await deriveWorktreeIdentity(f.dependencies, executionWorktree);
        expect(live?.worktreeInstanceId).toMatch(/^wt_/u);

        const recordEntry = async (planningIdentity: string): Promise<void> => {
          await writeWorkspaceIndexEntry(f.dependencies.coordination(f.globalDataDir), {
            version: 1,
            planningScopeId: f.planningScopeId(PROJECT, LINE),
            storeUid: f.storeUid,
            storeId: f.storeId,
            projectId: PROJECT,
            targetLineId: LINE,
            changeId: CHANGE,
            planning: {
              root: planningWorktree,
              repositoryIdentity: live?.repositoryIdentity ?? '',
              worktreeInstanceId: planningIdentity,
              ref: BRANCH,
              headOid: plan.planning.fromOid,
            },
            execution: {
              root: executionWorktree,
              repositoryIdentity: liveExecution?.repositoryIdentity ?? '',
              worktreeInstanceId: liveExecution?.worktreeInstanceId ?? '',
              ref: BRANCH,
              headOid: plan.execution.fromOid,
            },
            planId: plan.planId,
            phase: 'planning-worktree-created',
            recordedAt: '2026-08-07T00:00:00.000Z',
            updatedAt: '2026-08-07T00:00:00.000Z',
          });
        };

        // A recorded identity for THIS root that disagrees with the live one is
        // still a refusal, and it names both values. This is the assertion the
        // D1 narrowing must not absorb; it is mutation-proved by task 2.3.
        await recordEntry(ZERO_IDENTITY);
        const refusal = await refusalFrom(() => f.workspace().apply(plan.token!));
        expect(refusal.code).toBe('workspace_plan_stale');
        expect(refusal.message).toContain('identity of the created planning worktree');
        expect(refusal.expected).toBe(ZERO_IDENTITY);
        expect(refusal.actual).toBe(live?.worktreeInstanceId);

        // The SAME root with the MATCHING recorded identity resumes instead.
        await recordEntry(live?.worktreeInstanceId ?? '');
        const resumed = await f.workspace().apply(plan.token!);
        expect(resumed.created).toEqual([]);
        expect(resumed.reused).toContain(planningWorktree);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'prepares in one invocation on a line that advanced moments before (task 4.4)',
      async () => {
        seedChange();
        const advanced = advanceStoreLine();

        const outcome = await f.workspace().prepare(input());

        expect(outcome.plan.applicable, JSON.stringify(outcome.plan.blockers)).toBe(true);
        expect(outcome.plan.targetLine.storeRefOid).toBe(advanced);
        expect(outcome.prepared).toBeDefined();
        expect(outcome.prepared?.created).toContain(planningWorktree);
        expect(f.git(planningWorktree, ['rev-parse', 'HEAD']).trim()).toBe(advanced);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'still refuses stale when a competitor moves the ref inside the compound window, and converges on repeat (task 4.4)',
      async () => {
        seedChange();

        // The seam: the compound persists its plan between building it and
        // applying it, so a hook on that write is exactly the mid-window
        // instant a competing process would commit in.
        let fired = false;
        const racing = {
          ...f.dependencies,
          coordination: (globalDataDir?: string) => {
            const inner = f.dependencies.coordination(globalDataDir);
            return {
              ...inner,
              writeJson: async (relativePath: string, value: unknown): Promise<string> => {
                const written = await inner.writeJson(relativePath, value);
                if (!fired && relativePath.startsWith('plans/')) {
                  fired = true;
                  advanceStoreLine();
                }
                return written;
              },
            };
          },
        };

        const refusal = await refusalFrom(() =>
          new StoreWorkspace(racing, { globalDataDir: f.globalDataDir }).prepare(input())
        );
        expect(fired).toBe(true);
        expect(refusal.code).toBe('workspace_plan_stale');
        expect(refusal.message).toContain(STORE_REF);
        expect(refusal.expected).toBeDefined();
        expect(refusal.actual).toBeDefined();
        expect(refusal.expected).not.toBe(refusal.actual);
        expect(fs.existsSync(planningWorktree)).toBe(false);

        // The world holds still, and repeating the invocation converges.
        const outcome = await f.workspace().prepare(input());
        expect(outcome.prepared?.created).toContain(planningWorktree);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'fails the compound with a named lock holder rather than deadlocking (task 4.4)',
      async () => {
        seedChange();
        const coordination = f.dependencies.coordination(f.globalDataDir);
        const key = scopeLockKey({
          storeUid: f.storeUid,
          projectId: PROJECT,
          targetLineId: LINE,
        });
        // Held OUTSIDE the module's own async context, so the acquisition the
        // compound attempts is genuine contention rather than re-entry.
        const handle = await acquireOwnerAwareFileLock({
          lockPath: workspaceLockPath(coordination, key),
          errorFor: (kind, info) => new Error(`${kind}: ${info.lockPath}`),
          holder: 'a competing rasen session',
        });
        try {
          const refusal = await refusalFrom(() => f.workspace().prepare(input()));
          expect(refusal.code).toBe('workspace_lock_unavailable');
          expect(refusal.message).toContain('a competing rasen session');
        } finally {
          await releaseOwnerAwareFileLock(handle);
        }
        expect(fs.existsSync(planningWorktree)).toBe(false);
      },
      REAL_GIT_TIMEOUT_MS
    );

    // ---- the pair branch an earlier pair left behind ----------------------
    //
    // Neither `git worktree remove` nor `workspace cleanup` deletes a branch,
    // so every re-preparation meets its own previous branch. `git worktree add
    // -b` fails outright on one that exists, which made every shape above
    // unreachable until the plan learned to look.

    it(
      'reattaches the pair branch an earlier pair left behind rather than re-minting it',
      async () => {
        await prepareBoundPair();
        // Work committed on the pair branch: the branch is the Change's, and
        // re-preparation must neither discard it nor rewind it to the line.
        f.write(path.join(planningWorktree, 'work.md'), 'planning work\n');
        f.git(planningWorktree, ['add', 'work.md']);
        f.git(planningWorktree, ['commit', '-m', 'work on the pair branch']);
        const branchTip = f.refOid(f.storeRoot, BRANCH);
        const lineTip = f.refOid(f.storeRoot, STORE_REF);
        expect(branchTip).not.toBe(lineTip);
        removePlanningWorktree();
        expect(f.git(f.storeRoot, ['branch', '--list', BRANCH_NAME]).trim()).not.toBe('');

        const replan = await f.workspace().plan(input());

        expect(replan.applicable, JSON.stringify(replan.blockers)).toBe(true);
        expect(replan.planning.createsBranch).toBe(false);
        expect(replan.planning.fromOid).toBe(branchTip);
        const reattached = replan.preconditions.find(
          (candidate) => candidate.id === 'planning-branch-reattached'
        );
        expect(reattached, preconditionIds(replan)).toBeDefined();
        expect(reattached?.satisfied).toBe(true);
        expect(reattached?.detail).toContain(branchTip);
        // The disclosure names the commit it is really born from, which is the
        // branch's own tip and NOT the line's.
        const disclosed = replan.preconditions.find(
          (candidate) => candidate.id === 'planning-created-from'
        );
        expect(disclosed?.detail).toContain(BRANCH);
        expect(disclosed?.detail).toContain(branchTip);

        const applied = await f.workspace().apply(replan.token!);
        expect(applied.created).toContain(planningWorktree);
        expect(f.git(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
        expect(f.git(planningWorktree, ['rev-parse', 'HEAD']).trim()).toBe(branchTip);
        expect(fs.existsSync(path.join(planningWorktree, 'work.md'))).toBe(true);
        // The line itself did not move, and the branch was not rewound to it.
        expect(f.refOid(f.storeRoot, STORE_REF)).toBe(lineTip);
        expect(f.refOid(f.storeRoot, BRANCH)).toBe(branchTip);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'refuses a created side whose pair branch another worktree already has checked out',
      async () => {
        seedChange();
        const squatter = f.beside('hand-made-on-the-pair-branch');
        f.git(f.storeRoot, ['worktree', 'add', '-b', BRANCH_NAME, squatter, 'refs/heads/main']);

        const plan = await f.workspace().plan(input());

        expect(plan.applicable).toBe(false);
        expect(plan.token).toBeUndefined();
        const blocker = plan.blockers.find(
          (candidate) => candidate.id === 'planning-branch-usable'
        );
        expect(blocker, JSON.stringify(plan.blockers)).toBeDefined();
        expect(blocker?.code).toBe('workspace_ref_mismatch');
        expect(blocker?.detail).toContain(squatter);
        // Nothing created, and the other worktree keeps its HEAD.
        expect(fs.existsSync(planningWorktree)).toBe(false);
        expect(f.git(squatter, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
      },
      REAL_GIT_TIMEOUT_MS
    );

    it(
      'refuses stale when the reattached pair branch moves between planning and applying',
      async () => {
        await prepareBoundPair();
        removePlanningWorktree();
        const replan = await f.workspace().plan(input());
        expect(replan.planning.createsBranch).toBe(false);
        const frozen = replan.planning.fromOid;

        // A competitor advances the pair branch after the plan froze its tip.
        // The target line is untouched, so this refusal can only come from the
        // branch precondition.
        f.write(f.at('moved-the-pair-branch.md'), 'moved\n');
        f.git(f.storeRoot, ['add', 'moved-the-pair-branch.md']);
        f.git(f.storeRoot, ['commit', '-m', 'a commit the pair branch will point at']);
        f.git(f.storeRoot, ['branch', '-f', BRANCH_NAME, 'HEAD']);
        const moved = f.refOid(f.storeRoot, BRANCH);
        expect(moved).not.toBe(frozen);

        const refusal = await refusalFrom(() => f.workspace().apply(replan.token!));

        expect(refusal.code).toBe('workspace_plan_stale');
        expect(refusal.message).toContain(BRANCH);
        expect(refusal.expected).toBe(frozen);
        expect(refusal.actual).toBe(moved);
        expect(fs.existsSync(planningWorktree)).toBe(false);
      },
      REAL_GIT_TIMEOUT_MS
    );
  });

  // ===========================================================================
  // Designed behaviour that survives this change unchanged.
  // ===========================================================================

  describe('designed staleness', () => {
    it(
      'refuses a moved Store ref, naming both the frozen and the live commit (task 1.4)',
      async () => {
        seedChange();
        const plan = await f.workspace().plan(input());
        const frozen = plan.targetLine.storeRefOid;
        const moved = advanceStoreLine();
        expect(moved).not.toBe(frozen);

        const refusal = await refusalFrom(() => f.workspace().apply(plan.token!));

        expect(refusal.code).toBe('workspace_plan_stale');
        expect(refusal.message).toContain(STORE_REF);
        expect(refusal.expected).toBe(frozen);
        expect(refusal.actual).toBe(moved);
        // Refused BEFORE any write: no worktree exists at the moved position.
        expect(fs.existsSync(planningWorktree)).toBe(false);
        expect(fs.existsSync(executionWorktree)).toBe(false);

        // Re-planning is the designed repair, and it converges.
        const replan = await f.workspace().plan(input());
        expect(replan.applicable, JSON.stringify(replan.blockers)).toBe(true);
        expect(replan.targetLine.storeRefOid).toBe(moved);
        const applied = await f.workspace().apply(replan.token!);
        expect(applied.created).toContain(planningWorktree);
      },
      REAL_GIT_TIMEOUT_MS
    );
  });

});
