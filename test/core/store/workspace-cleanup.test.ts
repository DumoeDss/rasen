/**
 * `store-planning-worktree-bindings` tasks 10.8 and 10.10 — safe cleanup.
 *
 * The refusals ARE the feature. Removal happens only when all eight
 * preconditions hold, there is no `--force`, and there is no partial removal.
 * Everything this suite asserts is either "it refused and listed why" or "it
 * removed exactly the two recorded roots and this pair's index entry, and
 * nothing else on disk moved".
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { statusFromError } from '../../../src/commands/workflow/shared.js';
import { canonicalBytes } from '../../../src/core/canonical-json.js';
import { StoreError } from '../../../src/core/store/errors.js';
import { buildCleanupPlan, cleanupGateError } from '../../../src/core/store/workspace/cleanup.js';
import {
  productionStoreWorkspaceDependencies,
  withDeterministicWorkspaceIdentity,
  type StoreWorkspaceDependencies,
} from '../../../src/core/store/workspace/dependencies.js';
import { StoreWorkspace } from '../../../src/core/store/workspace/module.js';
import {
  readWorkspaceIndexEntry,
  writeWorkspaceIndexEntry,
} from '../../../src/core/store/workspace/registry.js';
import {
  scopeLockKey,
  workspaceLockPath,
} from '../../../src/core/store/workspace/locks.js';
import { deriveWorktreeIdentity } from '../../../src/core/store/workspace/identity.js';
import type { ImmutableCleanupPlan } from '../../../src/core/store/workspace/types.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';

/**
 * `设计文档.md`, written as escapes on purpose.
 *
 * The name is what is under test — Git quotes any path with non-ASCII bytes
 * under the default `core.quotePath` — and escapes keep this file pure ASCII,
 * so no editor, terminal, or encoding audit between here and CI can silently
 * change the bytes the assertion compares.
 */
const NON_ASCII_NAME = '\u8bbe\u8ba1\u6587\u6863.md';

function codeOf(error: unknown): string {
  if (error instanceof StoreError) return error.diagnostic.code;
  throw error;
}

/**
 * A pid the kernel affirmatively reports as gone. `spawnSync` returns only
 * after the child has exited, so its pid is dead by the time we read it —
 * which is what `acquireOwnerAwareFileLock` treats as stealable.
 */
function provablyDeadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  if (child.pid === undefined) throw new Error('could not spawn a probe process');
  return child.pid;
}

/** Worktree roots Git still lists, normalized — Git prints `/` on Windows. */
function listedWorktreeRoots(fixture: StoreWorkspaceFixture, repoRoot: string): string[] {
  return fixture
    .git(repoRoot, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => comparableRoot(line.slice('worktree '.length).trim()));
}

function comparableRoot(value: string): string {
  const forwardSlashed = value.split('\\').join('/');
  return process.platform === 'win32' ? forwardSlashed.toLowerCase() : forwardSlashed;
}

function blockerIds(plan: ImmutableCleanupPlan): readonly string[] {
  return plan.blockers.map((entry) => entry.id).sort();
}

/**
 * Every WORKING-TREE file under `root`, relative and POSIX, for a byte-level
 * snapshot. `.git` is excluded on purpose: removing a linked worktree is
 * supposed to delete its administrative directory under `.git/worktrees`, so
 * including it would assert the opposite of the intended behavior. Refs are
 * asserted separately and explicitly.
 */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      out[path.relative(root, absolute).split(path.sep).join('/')] = fs
        .readFileSync(absolute)
        .toString('base64');
    }
  };
  walk(root);
  return out;
}

describe('workspace cleanup', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;
  let scopeId: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-cleanup-',
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
      changeId: CHANGE,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      ...overrides,
    } as Parameters<StoreWorkspace['planCleanup']>[0];
  }

  async function prepare(): Promise<void> {
    const built = await f.workspace().plan({
      ...(selectors() as object),
      planningWorktree,
      executionWorktree,
    } as Parameters<StoreWorkspace['plan']>[0]);
    expect(built.applicable, JSON.stringify(built.blockers)).toBe(true);
    await f.workspace().apply(built.token!);
  }

  // ---- the removable case ------------------------------------------------

  it('removes exactly the two recorded roots and this pair index entry', async () => {
    await prepare();
    const storeBefore = snapshot(f.storeRoot);
    const codeBefore = snapshot(f.projectRoot(PROJECT));
    const branchesBefore = {
      store: f.git(f.storeRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads']),
      code: f.git(f.projectRoot(PROJECT), ['for-each-ref', '--format=%(refname)', 'refs/heads']),
    };

    const plan = await f.workspace().planCleanup(selectors());
    expect(blockerIds(plan)).toEqual([]);
    expect(plan.applicable).toBe(true);
    expect(plan.targets.map((target) => target.side)).toEqual(['execution', 'planning']);
    // Each target lists all eight preconditions, satisfied or not.
    for (const target of plan.targets) {
      expect(target.preconditions).toHaveLength(8);
      expect(target.removable).toBe(true);
      // The pair's OWN binding document is listed separately from the user's
      // untracked work, and is not what blocks removal.
      expect(target.untracked).toEqual([]);
      expect(target.ownRunState).toEqual([
        target.side === 'planning'
          ? '.rasen/planning-line.json'
          : '.rasen/planning-binding.json',
      ]);
    }

    const result = await f.workspace().applyCleanup(plan.token!);

    expect(result.phase).toBe('complete');
    expect([...result.removed].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(result.indexEntryRemoved).toBe(true);
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    // Nothing else moved: not the integration checkout, not the main code
    // checkout, and not a single ref.
    expect(snapshot(f.storeRoot)).toEqual(storeBefore);
    expect(snapshot(f.projectRoot(PROJECT))).toEqual(codeBefore);
    expect(f.git(f.storeRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe(
      branchesBefore.store
    );
    expect(f.git(f.projectRoot(PROJECT), ['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe(
      branchesBefore.code
    );
    // The index entry is gone, and it went LAST.
    expect(
      await readWorkspaceIndexEntry(
        f.dependencies.coordination(f.globalDataDir),
        scopeId,
        CHANGE
      )
    ).toBeNull();
  });

  it('previews without writing anything', async () => {
    await prepare();
    const planningBefore = snapshot(planningWorktree);
    const storeBefore = snapshot(f.storeRoot);

    await f.workspace().planCleanup(selectors());

    expect(snapshot(planningWorktree)).toEqual(planningBefore);
    expect(snapshot(f.storeRoot)).toEqual(storeBefore);
  });

  it('leaves the Change directory in the Store integration checkout alone', async () => {
    await prepare();
    // A Change directory the operator committed into the Store proper.
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'another-change',
    });
    const changeDir = path.join(
      f.storeRoot,
      'rasen',
      'projects',
      PROJECT,
      'changes',
      'another-change'
    );
    const before = snapshot(changeDir);

    const plan = await f.workspace().planCleanup(selectors());
    await f.workspace().applyCleanup(plan.token!);

    expect(snapshot(changeDir)).toEqual(before);
  });

  // ---- refusals ----------------------------------------------------------

  it('refuses when no pair is recorded for the Change', async () => {
    const plan = await f.workspace().planCleanup(selectors());

    expect(plan.applicable).toBe(false);
    expect(plan.targets).toEqual([]);
    expect(blockerIds(plan)).toEqual(['pair-recorded']);
    expect(plan.token).toBeUndefined();
    await expect(f.workspace().applyCleanup({
      planId: plan.planId,
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
      indexFingerprint: plan.indexFingerprint,
    })).rejects.toThrow();
  });

  it('pins the no-entry plan id to a fixed value on fixed input, not merely to a fresh recompute', async () => {
    // `buildCleanupPlan`'s no-entry branch (cleanup.ts:170) hashes
    // `{ scope, changeId, createdAt }` directly — no fixture, no live Git, and
    // the fixture's own randomUUID storeUid make a REAL fixture call
    // non-reproducible across runs. This anchor calls the real production
    // function on fully hand-built, non-random input instead, so the literal
    // below is not fabricated data pretending to be a hash — it is the actual
    // output of `buildCleanupPlan`, just on input the test controls end to end.
    const dataDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-cleanup-planid-'))
    );
    try {
      const dependencies: StoreWorkspaceDependencies = withDeterministicWorkspaceIdentity(
        productionStoreWorkspaceDependencies,
        { now: '2026-08-07T00:00:00.000Z' }
      );
      const scope = {
        storeUid: 'store-uid-1',
        storeId: 'store-1',
        storeRoot: '/store/root',
        projectId: 'app-a',
        targetLineId: 'line-0.2',
        planningScopeId: 'scope-1',
      };
      const plan = await buildCleanupPlan(dependencies, {
        scope,
        changeId: 'my-change',
        entry: null,
        includeUntracked: false,
        integrationRef: 'refs/heads/main',
        codeRef: 'refs/heads/main',
        flavor: 'native',
        globalDataDir: dataDir,
      });

      expect(plan.applicable).toBe(false);
      expect(plan.planId).toBe(
        'cdf2a9c1d8d6eb8e71200b95bd902e44c914cc7bee87bdffa1564bdac7d4b091'
      );

      // Mutation proof: only `changeId` differs, and the plan id changes to a
      // second independently pinned literal.
      const otherChange = await buildCleanupPlan(dependencies, {
        scope,
        changeId: 'other-change',
        entry: null,
        includeUntracked: false,
        integrationRef: 'refs/heads/main',
        codeRef: 'refs/heads/main',
        flavor: 'native',
        globalDataDir: dataDir,
      });
      expect(otherChange.planId).toBe(
        '83e4f5a24e19de0df520875994240c0b1e56b5af6d7d204c8b0c91e303d7ab88'
      );
    } finally {
      cleanupTempPath(dataDir);
    }
  });

  // DIGEST ANCHOR (tasks 6.1-6.3, site cleanup.ts:251 — the WITH-entry branch,
  // the sibling of the no-entry pinned-literal anchor above at cleanup.ts:170).
  // This branch's `body` embeds `targets`, which embed live Git facts (worktree
  // instance ids, ref reachability) surveyed from a real fixture, so it cannot
  // use a portable hardcoded hex literal the way the no-entry branch does. It
  // uses the same INDEPENDENTLY-RECONSTRUCTED-AND-REHASHED technique as
  // plan.ts:794's anchor (workspace-plan.test.ts): `buildCleanupPlan` returns
  // `{ planId, createdAt, ...body, ...(token && { token }) }` (cleanup.ts
  // 252-268), so every field the digest covers is also present directly on the
  // returned plan. The test reconstructs `body`'s field set from the plan's OWN
  // reported output — never by re-invoking the production hashing call —
  // recomputes the digest with its own `createHash`/`canonicalBytes`, and
  // asserts it against the real `planId`.
  it(
    'cleanup plan id is exactly sha256(canonicalBytes(body)) hex, over body and nothing else',
    async () => {
      await prepare();
      const plan = await f.workspace().planCleanup(selectors());
      expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);

      const { planId, createdAt, token, ...reconstructedBody } = plan;
      expect(Object.keys(reconstructedBody).sort()).toEqual(
        [
          'schemaVersion',
          'scope',
          'changeId',
          'targets',
          'indexFingerprint',
          'includeUntracked',
          'applicable',
          'blockers',
        ].sort()
      );

      const expectedPlanId = createHash('sha256')
        .update(canonicalBytes(reconstructedBody))
        .digest('hex');

      expect(plan.planId).toBe(expectedPlanId);
      expect(plan.planId).toMatch(/^[0-9a-f]{64}$/u);

      // STRENGTHENING (review round 1, Minor 3). Same reasoning as the sibling
      // anchor at plan.ts:794 (workspace-plan.test.ts): the reconstruction above
      // calls production's `canonicalBytes` on both sides, so it cannot notice a
      // `canonicalBytes` serialization shift — that class of break moves the
      // real `planId` and `expectedPlanId` together. `schemaVersion`, `changeId`,
      // `includeUntracked`, and `applicable` carry no live Git fact in this
      // scenario, so their canonical bytes are a fixed literal, computed offline
      // and hardcoded here, independent of calling `canonicalBytes` again at
      // test time. This reddens on a serialization shift the comparison above
      // cannot detect.
      expect(
        canonicalBytes({
          schemaVersion: reconstructedBody.schemaVersion,
          changeId: reconstructedBody.changeId,
          includeUntracked: reconstructedBody.includeUntracked,
          applicable: reconstructedBody.applicable,
        }).toString('utf8')
      ).toBe(
        '{"applicable":true,"changeId":"redesign-routing","includeUntracked":false,"schemaVersion":1}'
      );
    }
  );

  it('refuses a tracked modification and lists the file, discarding nothing', async () => {
    await prepare();
    fs.writeFileSync(path.join(executionWorktree, 'README.md'), 'user edit\n', 'utf8');

    const plan = await f.workspace().planCleanup(selectors());

    expect(blockerIds(plan)).toEqual(['execution-4-clean-tree']);
    expect(plan.blockers[0]?.detail).toContain('README.md');
    expect(plan.applicable).toBe(false);
    // The edit is still there.
    expect(fs.readFileSync(path.join(executionWorktree, 'README.md'), 'utf8')).toBe('user edit\n');
  });

  it('refuses untracked files by default, lists them, and accepts them only when told', async () => {
    await prepare();
    fs.writeFileSync(path.join(executionWorktree, 'scratch.txt'), 'not in git\n', 'utf8');

    const refused = await f.workspace().planCleanup(selectors());
    expect(blockerIds(refused)).toEqual(['execution-5-untracked-accepted']);
    expect(refused.targets.find((target) => target.side === 'execution')?.untracked).toEqual([
      'scratch.txt',
    ]);
    expect(refused.blockers[0]?.detail).toContain('scratch.txt');
    expect(fs.existsSync(path.join(executionWorktree, 'scratch.txt'))).toBe(true);

    const accepted = await f.workspace().planCleanup(selectors({ includeUntracked: true }));
    expect(accepted.applicable).toBe(true);
    expect(accepted.includeUntracked).toBe(true);
    // Applying it removes exactly the files the plan printed.
    const result = await f.workspace().applyCleanup(accepted.token!);
    expect(result.phase).toBe('complete');
    expect(fs.existsSync(executionWorktree)).toBe(false);
  });

  it('refuses unmerged work, naming the unreachable commit, and merges nothing', async () => {
    await prepare();
    fs.writeFileSync(path.join(planningWorktree, 'note.md'), 'planning work\n', 'utf8');
    f.git(planningWorktree, ['add', '.']);
    f.git(planningWorktree, ['commit', '-m', 'unmerged planning work']);
    const unmerged = f.git(planningWorktree, ['rev-parse', 'HEAD']).trim();
    const integrationBefore = f.refOid(f.storeRoot, 'refs/heads/release/0.2');

    const plan = await f.workspace().planCleanup(selectors());

    expect(blockerIds(plan)).toEqual(['planning-6-reachable-from-recorded-ref']);
    expect(plan.blockers[0]?.actual).toBe(unmerged);
    expect(plan.blockers[0]?.detail).toContain('never merges or rebases');
    expect(plan.applicable).toBe(false);
    // Nothing was merged, rebased, or moved.
    expect(f.refOid(f.storeRoot, 'refs/heads/release/0.2')).toBe(integrationBefore);
    expect(fs.existsSync(planningWorktree)).toBe(true);
  });

  it('refuses a worktree that has moved to another ref', async () => {
    await prepare();
    f.git(planningWorktree, ['switch', '--quiet', '--create', 'somewhere-else']);

    const plan = await f.workspace().planCleanup(selectors());
    expect(blockerIds(plan)).toContain('planning-3-recorded-ref');
    const blocker = plan.blockers.find((entry) => entry.id === 'planning-3-recorded-ref');
    expect(blocker?.expected).toBe(`refs/heads/change/${LINE}/${PROJECT}/${CHANGE}`);
    expect(blocker?.actual).toBe('refs/heads/somewhere-else');
  });

  it('refuses a repository main checkout, which cleanup never removes', async () => {
    await prepare();
    // Rewrite the recorded execution side to name the code repository's MAIN
    // checkout — consistently, with its real instance id, ref, and HEAD — so
    // the ONLY thing that can refuse is precondition 2.
    const coordination = f.dependencies.coordination(f.globalDataDir);
    const entry = await readWorkspaceIndexEntry(coordination, scopeId, CHANGE);
    const main = await deriveWorktreeIdentity(f.dependencies, f.projectRoot(PROJECT));
    expect(main).not.toBeNull();
    await writeWorkspaceIndexEntry(coordination, {
      ...entry!,
      execution: {
        root: f.projectRoot(PROJECT),
        repositoryIdentity: main!.repositoryIdentity,
        worktreeInstanceId: main!.worktreeInstanceId,
        ref: f.git(f.projectRoot(PROJECT), ['symbolic-ref', '--quiet', 'HEAD']).trim(),
        headOid: f.git(f.projectRoot(PROJECT), ['rev-parse', 'HEAD']).trim(),
      },
    });

    const plan = await f.workspace().planCleanup(selectors());

    expect(blockerIds(plan)).toEqual(['execution-2-linked-worktree']);
    expect(plan.blockers[0]?.detail).toContain("main checkout, which cleanup never removes");
    expect(plan.applicable).toBe(false);
    expect(plan.token).toBeUndefined();
    expect(fs.existsSync(f.projectRoot(PROJECT))).toBe(true);
  });

  it('refuses while a scope lock is held elsewhere, and names the lock FILE', async () => {
    await prepare();
    const lockPath = workspaceLockPath(
      f.dependencies.coordination(f.globalDataDir),
      scopeLockKey({ storeUid: f.storeUid, projectId: PROJECT, targetLineId: LINE })
    );
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, `holder: another rasen command\npid: ${process.pid}\n`, 'utf8');

    const plan = await f.workspace().planCleanup(selectors());
    expect(blockerIds(plan)).toEqual([
      'execution-8-no-lock-held',
      'planning-8-no-lock-held',
    ]);
    expect(plan.blockers[0]?.detail).toContain('scope app-a@line-0.2');
    // A lock filename is a sha256 of the key material, so the label alone tells
    // the user to resolve a precondition without telling them where it lives.
    expect(plan.blockers[0]?.detail).toContain(lockPath);
    expect(plan.blockers[0]?.actual).toContain(lockPath);
  });

  it('does not call a lock held when its owner is provably dead, because the acquirer would steal it', async () => {
    // The failure this pins: a `rasen store workspace apply` killed with Ctrl-C
    // leaves its lock file behind. `acquireOwnerAwareFileLock` steals a lock
    // whose recorded pid is provably dead, so a probe that answered "held" for
    // the same file would state a precondition that no amount of waiting can
    // satisfy — and cleanup has no --force, so the scope would be wedged.
    await prepare();
    const lockPath = workspaceLockPath(
      f.dependencies.coordination(f.globalDataDir),
      scopeLockKey({ storeUid: f.storeUid, projectId: PROJECT, targetLineId: LINE })
    );
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      `holder: a rasen command that was killed\npid: ${provablyDeadPid()}\n`,
      'utf8'
    );

    const plan = await f.workspace().planCleanup(selectors());

    expect(blockerIds(plan)).toEqual([]);
    expect(plan.applicable).toBe(true);
  });

  it('still refuses on a lock whose holder cannot be established', async () => {
    // Everything the ACQUIRER would wait on still blocks: only an affirmative
    // "no such process" recovers a lock, never an unreadable or pid-less one.
    await prepare();
    const lockPath = workspaceLockPath(
      f.dependencies.coordination(f.globalDataDir),
      scopeLockKey({ storeUid: f.storeUid, projectId: PROJECT, targetLineId: LINE })
    );
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, 'holder: an unnamed holder\n', 'utf8');

    const plan = await f.workspace().planCleanup(selectors());

    expect(blockerIds(plan)).toEqual([
      'execution-8-no-lock-held',
      'planning-8-no-lock-held',
    ]);
  });

  // ---- precondition 7: no live session ------------------------------------

  function writeSessionContext(dataDir: string, id: string, body: unknown): string {
    const contextPath = path.join(dataDir, 'sessions', id, 'context.json');
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    fs.writeFileSync(contextPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    return contextPath;
  }

  it('refuses a worktree a live session context still references', async () => {
    await prepare();
    writeSessionContext(f.globalDataDir, 'sess_live', {
      version: 2,
      execution: { root: executionWorktree, worktree: { root: executionWorktree } },
    });

    const plan = await f.workspace().planCleanup(selectors());

    expect(blockerIds(plan)).toEqual(['execution-7-no-live-session']);
    expect(plan.blockers[0]?.detail).toContain(executionWorktree);
    expect(plan.blockers[0]?.code).toBe('workspace_cleanup_unsafe');
    expect(plan.applicable).toBe(false);
    expect(plan.token).toBeUndefined();
    expect(fs.existsSync(executionWorktree)).toBe(true);
  });

  it('counts a session context it cannot read as referencing everything', async () => {
    await prepare();
    const contextPath = path.join(f.globalDataDir, 'sessions', 'sess_broken', 'context.json');
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    fs.writeFileSync(contextPath, '{ this is not JSON', 'utf8');

    const plan = await f.workspace().planCleanup(selectors());

    // Both sides, because a session that cannot be inspected is not a session
    // that may be assumed finished.
    expect(blockerIds(plan)).toEqual([
      'execution-7-no-live-session',
      'planning-7-no-live-session',
    ]);
    expect(plan.blockers[0]?.detail).toContain(contextPath);
  });

  it('scans sessions under the REAL machine root when no data directory is threaded', async () => {
    // The path the CLI actually takes. `src/commands/workspace.ts` constructs
    // `new StoreWorkspace()` with no options and calls `planCleanup` with no
    // `globalDataDir`, so every argument this suite normally supplies is
    // absent — and an omitted machine root used to mean "no sessions exist",
    // which made precondition 7 satisfied-by-construction in production while
    // every unit test passed the argument that hid it.
    await prepare();
    writeSessionContext(f.globalDataDir, 'sess_live', {
      version: 2,
      planning: { root: planningWorktree, worktree: { root: planningWorktree } },
    });

    const previousHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = f.globalDataDir;
    try {
      const bare = new StoreWorkspace(f.dependencies);
      const plan = await bare.planCleanup({
        store: f.storeId,
        project: PROJECT,
        targetLine: LINE,
        changeId: CHANGE,
        startPath: f.storeRoot,
      });

      expect(blockerIds(plan)).toEqual(['planning-7-no-live-session']);
      expect(plan.blockers[0]?.detail).toContain(planningWorktree);
      expect(plan.applicable).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.RASEN_HOME;
      else process.env.RASEN_HOME = previousHome;
    }
  });

  // ---- paths Git has to quote --------------------------------------------

  it('lists and removes an untracked file whose name is not ASCII', async () => {
    await prepare();
    fs.writeFileSync(path.join(executionWorktree, NON_ASCII_NAME), 'draft\n', 'utf8');

    const refused = await f.workspace().planCleanup(selectors());

    expect(blockerIds(refused)).toEqual(['execution-5-untracked-accepted']);
    // The census names the FILE. Under `core.quotePath` Git prints it as
    // `"\350\256\276..."`, and an adapter that only strips the quotes yields a
    // 24-character string no filesystem call can resolve.
    expect(refused.targets.find((target) => target.side === 'execution')?.untracked).toEqual([
      NON_ASCII_NAME,
    ]);
    expect(refused.blockers[0]?.detail).toContain(NON_ASCII_NAME);

    const accepted = await f.workspace().planCleanup(selectors({ includeUntracked: true }));
    expect(accepted.applicable).toBe(true);

    // And applying it actually removes the file, rather than resolving an
    // escaped name to nothing, swallowing the ENOENT, and wedging the index at
    // `removing-execution` when `git worktree remove` then refuses.
    const result = await f.workspace().applyCleanup(accepted.token!);
    expect(result.phase).toBe('complete');
    expect(fs.existsSync(executionWorktree)).toBe(false);
  });

  it('reports a modified non-ASCII tracked path as itself', async () => {
    // Asserted against the code repository's MAIN checkout, which the fixture
    // wrote and committed itself, so the fixture's Git and the Module's Git
    // agree on line endings there (see the implementation report's judgment
    // call 4).
    const repo = f.projectRoot(PROJECT);
    f.write(path.join(repo, NON_ASCII_NAME), 'first\n');
    f.git(repo, ['add', '.']);
    f.git(repo, ['commit', '-m', 'seed a non-ASCII tracked file']);
    fs.writeFileSync(path.join(repo, NON_ASCII_NAME), 'second\n', 'utf8');

    const dirty = await f.dependencies.git.dirtyEntries(repo);

    expect(dirty.map((entry) => entry.path)).toEqual([NON_ASCII_NAME]);
  });

  it('surfaces a Git failure as workspace_git_failed, on the seam that has no fallback', async () => {
    // Task 5.6 requires a Git-level failure to be surfaced AS ITSELF. The
    // `store workspace` group has adapter-level fallbacks; the resolver seam
    // reached by `rasen new change --json` does not, and `statusFromError`
    // branches on a code — so an uncoded error arrives there as the generic
    // `change_error`.
    const raised = await f.dependencies.git
      .removeWorktree(f.projectRoot(PROJECT), f.beside('never-a-worktree'))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(raised).not.toBeNull();
    expect(codeOf(raised)).toBe('workspace_git_failed');
    expect(statusFromError(raised).code).toBe('workspace_git_failed');
  });

  it('lists every failed precondition at once, with no force and no partial removal', async () => {
    await prepare();
    fs.writeFileSync(path.join(executionWorktree, 'README.md'), 'user edit\n', 'utf8');
    fs.writeFileSync(path.join(planningWorktree, 'scratch.txt'), 'not in git\n', 'utf8');

    const plan = await f.workspace().planCleanup(selectors());
    expect(blockerIds(plan)).toEqual([
      'execution-4-clean-tree',
      'planning-5-untracked-accepted',
    ]);

    // The refusal names every failed precondition at once.
    const gate = cleanupGateError(plan) as StoreError;
    expect(gate.diagnostic.code).toBe('workspace_cleanup_unsafe');
    expect(gate.diagnostic.message).toContain('execution-4-clean-tree');
    expect(gate.diagnostic.message).toContain('planning-5-untracked-accepted');
    expect(gate.diagnostic.fix).toContain('no --force and no partial removal');
    // Two targets, eight preconditions each. The total is a constant; adding
    // the blocker count made the "expected" figure grow with the number of
    // failures, so the user read a number matching nothing at all.
    expect((gate as unknown as { expected?: string }).expected).toBe(
      '16 preconditions satisfied'
    );
    expect((gate as unknown as { actual?: string }).actual).toBe('2 unsatisfied');

    // An unsafe plan carries no token and is never persisted, so there is
    // nothing to apply — that is what "no partial removal" means mechanically.
    expect(plan.token).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(
          f.globalDataDir,
          'planning-workspaces',
          'plans',
          `cleanup-${plan.planId}.json`
        )
      )
    ).toBe(false);
    await expect(f.workspace().applyStoredCleanupPlan(plan.planId)).rejects.toThrow();

    // Neither worktree was touched.
    expect(fs.existsSync(planningWorktree)).toBe(true);
    expect(fs.existsSync(executionWorktree)).toBe(true);
  });

  // ---- interruption and resume ------------------------------------------

  it('resumes from the recorded phase after an interrupted removal', async () => {
    await prepare();
    const plan = await f.workspace().planCleanup(selectors());
    expect(plan.applicable).toBe(true);

    let calls = 0;
    const failing: StoreWorkspaceDependencies = {
      ...f.dependencies,
      git: {
        ...f.dependencies.git,
        removeWorktree: async (repoRoot, worktreeRoot) => {
          calls += 1;
          if (calls === 2) throw new Error('injected removeWorktree failure');
          return f.dependencies.git.removeWorktree(repoRoot, worktreeRoot);
        },
      },
    };

    await expect(
      new StoreWorkspace(failing, { globalDataDir: f.globalDataDir }).applyCleanup(plan.token!)
    ).rejects.toThrow('injected removeWorktree failure');

    // The execution side is gone; the planning side is not; the phase says so.
    expect(fs.existsSync(executionWorktree)).toBe(false);
    expect(fs.existsSync(planningWorktree)).toBe(true);
    const entry = await readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      scopeId,
      CHANGE
    );
    expect(entry?.phase).toBe('removing-planning');
    // The index entry is still there: it goes last, so an interrupted cleanup
    // resumes from the record rather than concluding from an absent directory.
    expect(entry?.execution.root).toBe(executionWorktree);

    const resumed = await f.workspace().applyCleanup(plan.token!);
    expect(resumed.phase).toBe('complete');
    expect(resumed.removed).toEqual([planningWorktree]);
    expect(resumed.indexEntryRemoved).toBe(true);
    expect(fs.existsSync(planningWorktree)).toBe(false);
  });

  // ---- what a stored plan can no longer vouch for -------------------------

  it('re-checks reachability before the first removal, and removes nothing when it fails', async () => {
    await prepare();
    const plan = await f.workspace().planCleanup(selectors());
    expect(plan.applicable).toBe(true);

    // The user previews cleanup, then commits new work on the planning branch,
    // then applies. Reachability is the one precondition that exists to prevent
    // losing work, and it is the only one Git does not backstop at removal.
    fs.writeFileSync(path.join(planningWorktree, 'note.md'), 'work after the preview\n', 'utf8');
    f.git(planningWorktree, ['add', '.']);
    f.git(planningWorktree, ['commit', '-m', 'committed after the preview']);

    const raised = await f
      .workspace()
      .applyCleanup(plan.token!)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(raised).not.toBeNull();
    expect(codeOf(raised)).toBe('workspace_cleanup_unsafe');
    expect((raised as StoreError).diagnostic.message).toContain('not reachable from');
    // NOTHING was removed. The execution side is the first target, so a check
    // run inside the removal loop would already have taken it — which is the
    // partial removal this capability forbids.
    expect(fs.existsSync(planningWorktree)).toBe(true);
    expect(fs.existsSync(executionWorktree)).toBe(true);
    const entry = await readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      scopeId,
      CHANGE
    );
    expect(entry).not.toBeNull();
    expect([
      'removing-execution',
      'removed-execution',
      'removing-planning',
      'removed-planning',
      'pruned',
      'complete',
    ]).not.toContain(entry?.phase);
  });

  it('refuses an apply after a sibling Change was prepared in the same scope', async () => {
    await prepare();
    const plan = await f.workspace().planCleanup(selectors());
    expect(plan.applicable).toBe(true);

    // A concurrent preparation in the same scope. The token carries an index
    // fingerprint, but comparing it to the STORED PLAN compares a document with
    // itself, so nothing noticed.
    const sibling = await f.workspace().plan({
      ...(selectors({ changeId: 'sibling-change' }) as object),
      planningWorktree: f.beside('store-planning-sibling'),
      executionWorktree: f.beside('app-a-sibling'),
    } as Parameters<StoreWorkspace['plan']>[0]);
    expect(sibling.applicable, JSON.stringify(sibling.blockers)).toBe(true);
    await f.workspace().apply(sibling.token!);

    const raised = await f
      .workspace()
      .applyCleanup(plan.token!)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(raised).not.toBeNull();
    expect(codeOf(raised)).toBe('workspace_plan_stale');
    expect(fs.existsSync(planningWorktree)).toBe(true);
    expect(fs.existsSync(executionWorktree)).toBe(true);
  });

  it('prunes the repository of a side that vanished between preview and apply', async () => {
    await prepare();
    const plan = await f.workspace().planCleanup(selectors());
    expect(plan.applicable).toBe(true);
    const codeRepo = f.projectRoot(PROJECT);
    const target = comparableRoot(executionWorktree);

    // The user deletes the execution worktree directory by hand.
    fs.rmSync(executionWorktree, { recursive: true, force: true });
    // Git still lists it, which is what makes the assertion below able to fail.
    expect(listedWorktreeRoots(f, codeRepo)).toContain(target);

    const result = await f.workspace().applyCleanup(plan.token!);

    expect(result.phase).toBe('complete');
    // `advance('pruned')` and `phase: 'complete'` both claim the prune ran. It
    // has to have run in the CODE repository too, or a later `worktree add` at
    // that destination fails with "already registered" against a path that does
    // not exist — reported as `workspace_destination_exists`.
    expect(listedWorktreeRoots(f, codeRepo)).not.toContain(target);
    expect(listedWorktreeRoots(f, f.storeRoot)).not.toContain(comparableRoot(planningWorktree));
  });

  it('removes an unbound pair, which trivially satisfies reachability', async () => {
    await prepare();
    const entry = await readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      scopeId,
      CHANGE
    );
    // Never bound: no Change instance and no pair id, so the workspace lock key
    // is the provisional one and the branch has no commits of its own.
    expect(entry?.changeInstanceId).toBeUndefined();
    expect(entry?.workspacePairId).toBeUndefined();

    const plan = await f.workspace().planCleanup(selectors());
    expect(plan.applicable).toBe(true);
    const result = await f.workspace().applyCleanup(plan.token!);
    expect(result.phase).toBe('complete');
    expect(result.indexEntryRemoved).toBe(true);
  });
});
