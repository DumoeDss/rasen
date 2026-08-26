/**
 * `store-planning-worktree-bindings` task 4.9 — plan construction.
 *
 * A plan is READ-ONLY and TOTAL. Read-only means a preview writes nothing
 * anywhere, including the machine data directory when it cannot be applied;
 * total means it reports EVERY unsatisfied precondition rather than stopping at
 * the first, because a user who fixes one problem and re-runs to find the next
 * is a user the plan failed.
 *
 * The plan id is the digest of the plan's MEANING. `createdAt` sits beside it
 * on purpose: a wall clock inside the digest would make every re-plan a
 * different plan, and re-planning is exactly how a user checks nothing moved.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalBytes } from '../../../src/core/canonical-json.js';
import { StoreError } from '../../../src/core/store/errors.js';
import { workspaceBranchRef } from '../../../src/core/store/workspace/plan.js';
import type { ImmutableWorkspacePlan } from '../../../src/core/store/workspace/types.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';
const BRANCH = `refs/heads/change/${LINE}/${PROJECT}/${CHANGE}`;

function codeOf(error: unknown): string {
  if (error instanceof StoreError) return error.diagnostic.code;
  throw error;
}

function unsatisfied(plan: ImmutableWorkspacePlan): readonly string[] {
  return plan.blockers.map((entry) => entry.id).sort();
}

/**
 * Same real-Git fixture class as its sibling workspace suites: the cost per
 * case is worktree and commit wall-clock time, not source size. The 30s
 * default passes solo and fails under the parallel load of the store suites,
 * where a timeout reads as a broken assertion rather than as a timeout --
 * which is what two of this file's siblings did once the re-preparation suite
 * joined the same run.
 */
describe('workspace plan construction', { timeout: 180_000 }, () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-plan-',
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
      ...overrides,
    } as Parameters<ReturnType<StoreWorkspaceFixture['workspace']>['plan']>[0];
  }

  function machineFileCount(): number {
    const root = path.join(f.globalDataDir, 'planning-workspaces');
    if (!fs.existsSync(root)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) count += 1;
    }
    return count;
  }

  // ---- the happy plan ----------------------------------------------------

  it('freezes both ref OIDs and creates each worktree from the frozen commit, not the ref name', async () => {
    const storeOid = f.refOid(f.storeRoot, 'refs/heads/release/0.2');
    const codeOid = f.refOid(f.projectRoot(PROJECT), 'refs/heads/release/0.2');

    const plan = await f.workspace().plan(input());

    expect(plan.applicable).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.intent).toBe('new-change');
    expect(plan.pathFlavor).toBe('native');
    expect(plan.targetLine).toEqual({
      targetLineId: LINE,
      storeRef: 'refs/heads/release/0.2',
      storeRefOid: storeOid,
      codeRef: 'refs/heads/release/0.2',
      codeRefOid: codeOid,
    });
    expect(plan.planning).toMatchObject({
      side: 'planning',
      root: planningWorktree,
      disposition: 'create',
      ref: BRANCH,
      fromOid: storeOid,
      createsBranch: true,
    });
    expect(plan.execution).toMatchObject({
      side: 'execution',
      root: executionWorktree,
      disposition: 'create',
      ref: BRANCH,
      fromOid: codeOid,
      createsBranch: true,
    });
    // The branch is a LOCATOR built from the triple; nothing parses it back.
    expect(BRANCH).toBe(
      workspaceBranchRef({ targetLineId: LINE, projectId: PROJECT, changeId: CHANGE })
    );
  });

  it('builds the closed action list with an absolute destination for each action', async () => {
    const plan = await f.workspace().plan(input());

    expect(plan.actions.map((action) => action.kind)).toEqual([
      'create-planning-worktree',
      'create-execution-worktree',
      'write-planning-marker',
      'write-execution-association',
      'record-index-entry',
    ]);
    expect(plan.actions.map((action) => action.destination)).toEqual([
      planningWorktree,
      executionWorktree,
      path.join(planningWorktree, '.rasen', 'planning-line.json'),
      path.join(executionWorktree, '.rasen', 'planning-binding.json'),
      path.join(
        f.globalDataDir,
        'planning-workspaces',
        'index',
        `${f.planningScopeId(PROJECT, LINE)}.json`
      ),
    ]);
    // Every write action carries the digest of the exact bytes it will produce.
    for (const action of plan.actions.filter((entry) => entry.kind.startsWith('write-'))) {
      expect(action.digest, action.kind).toMatch(/^[0-9a-f]{64}$/u);
    }
    // ...and only the two worktree actions carry a source commit.
    expect(
      plan.actions.filter((action) => action.fromOid !== undefined).map((action) => action.kind)
    ).toEqual(['create-planning-worktree', 'create-execution-worktree']);
  });

  it('produces an identical plan and plan id for equal inputs', async () => {
    const first = await f.workspace().plan(input());
    const second = await f.workspace().plan(input());

    expect(second.planId).toBe(first.planId);
    expect(second.token).toEqual(first.token);
    // Everything except the recorded instant is identical, and the instant is
    // NOT in the digest.
    expect({ ...second, createdAt: '' }).toEqual({ ...first, createdAt: '' });
    expect(first.createdAt).toBe('2026-08-07T00:00:00.000Z');
  });

  // DIGEST ANCHOR (tasks 6.1-6.3, site plan.ts:794). The existing tests above
  // ("produces an identical plan id for equal inputs", "changes the plan id
  // when a frozen input changes") are RELATIONALLY BLIND: they compare one
  // production `planId` to another production `planId`. A uniform mutation of
  // the digest formula itself — e.g. `digest('hex')` -> `digest('base64')`, or
  // accidentally folding `createdAt` into the hashed body — moves both sides
  // of every one of those comparisons together, so none of them would notice.
  //
  // This anchor cannot use a hardcoded hex literal the way the four
  // Git-independent sites (locks.ts:128, binding.ts:93, registry.ts:201,
  // cleanup.ts:170) do, because `body` embeds live Git facts (frozen ref
  // OIDs, worktree instance ids) that differ per machine/run. Instead it uses
  // the INDEPENDENTLY-RECONSTRUCTED-AND-REHASHED technique: `buildWorkspacePlan`
  // returns `{ planId, createdAt, ...body, ...(token && { token }) }` (plan.ts
  // line 814-819), so every field that went into the digest is ALSO present
  // directly on the returned plan. The test reconstructs `body`'s exact field
  // set from the plan's OWN reported output (never by re-invoking the
  // production hashing call), computes the digest itself with its own
  // `createHash`/`canonicalBytes` calls, and asserts the result against the
  // real `planId` — comparing production output to an independently-derived
  // expected value, not production output to production output.
  it(
    'plan id is exactly sha256(canonicalBytes(body)) hex, over body and nothing else',
    async () => {
      const plan = await f.workspace().plan(input());

      const { planId, createdAt, token, ...reconstructedBody } = plan;
      // `schemaVersion` is not part of ImmutableWorkspacePlan's declared type
      // (it lives only inside `body` before the spread), but TypeScript's
      // structural typing means it still ends up as an own-enumerable key on
      // the actual runtime object, exactly like every other `body` field.
      expect(Object.keys(reconstructedBody).sort()).toEqual(
        [
          'schemaVersion',
          'intent',
          'scope',
          'targetLine',
          'targetLineCatalog',
          'storeMetadataPath',
          'changeId',
          'pathFlavor',
          'planning',
          'execution',
          'actions',
          'preconditions',
          'indexFingerprint',
          'applicable',
          'blockers',
        ].sort()
      );

      const expectedPlanId = createHash('sha256')
        .update(canonicalBytes(reconstructedBody))
        .digest('hex');

      expect(plan.planId).toBe(expectedPlanId);
      expect(plan.planId).toMatch(/^[0-9a-f]{64}$/u);

      // STRENGTHENING (review round 1, Minor 3). The reconstruction above still
      // calls production's `canonicalBytes` on both sides of the comparison, so
      // it is symmetric under a `canonicalBytes` serialization shift (e.g. a key
      // ordering or escaping change): that class of break moves the real
      // `planId` and this test's `expectedPlanId` together, and neither
      // reddens. This assertion does not share that blind spot: `schemaVersion`,
      // `intent`, `changeId`, and `pathFlavor` carry no live Git fact for this
      // fixture, so their canonical bytes are a fixed literal, computed offline
      // with the real `canonicalize` package and hardcoded here — never
      // recomputed at test time. A `canonicalBytes`/RFC 8785 serialization
      // change reddens this line even though the full-body comparison above
      // stays green.
      expect(
        canonicalBytes({
          schemaVersion: reconstructedBody.schemaVersion,
          intent: reconstructedBody.intent,
          changeId: reconstructedBody.changeId,
          pathFlavor: reconstructedBody.pathFlavor,
        }).toString('utf8')
      ).toBe(
        '{"changeId":"redesign-routing","intent":"new-change","pathFlavor":"native","schemaVersion":1}'
      );
    },
    10_000
  );

  it('changes the plan id when a frozen input changes', async () => {
    const before = await f.workspace().plan(input());
    // Move the Store ref. The plan freezes OIDs, so the plan is a different
    // plan even though every selector is the same.
    f.write(f.at('moved.md'), 'moved\n');
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', 'move release/0.2']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const after = await f.workspace().plan(input());
    expect(after.targetLine.storeRefOid).not.toBe(before.targetLine.storeRefOid);
    expect(after.planId).not.toBe(before.planId);
  });

  it('writes the plan under the machine data directory and nothing into either repository', async () => {
    const plan = await f.workspace().plan(input());

    const planPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'plans',
      `${plan.planId}.json`
    );
    expect(fs.existsSync(planPath)).toBe(true);
    expect((JSON.parse(fs.readFileSync(planPath, 'utf8')) as { planId: string }).planId).toBe(
      plan.planId
    );
    // No worktree was created and no repository was touched.
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    expect(f.git(f.storeRoot, ['status', '--porcelain'])).toBe('');
    expect(f.git(f.projectRoot(PROJECT), ['status', '--porcelain'])).toBe('');
    expect(f.git(f.storeRoot, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1).toBe(1);
  });

  // ---- totality ----------------------------------------------------------

  it('reports every unsatisfied precondition rather than stopping at the first', async () => {
    // Three independent problems at once: both destinations are occupied by
    // directories that are not worktrees, and the Change already exists.
    for (const destination of [planningWorktree, executionWorktree]) {
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'stray.txt'), 'occupied\n', 'utf8');
    }
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });

    const plan = await f.workspace().plan(input());

    expect(plan.applicable).toBe(false);
    expect(plan.token).toBeUndefined();
    expect(unsatisfied(plan)).toEqual([
      'change-not-already-created',
      'execution-destination-available',
      'planning-destination-available',
    ]);
    // Each blocker carries its refusal code and, where there are two values to
    // disagree about, both of them.
    for (const id of ['planning-destination-available', 'execution-destination-available']) {
      const blocker = plan.blockers.find((entry) => entry.id === id);
      expect(blocker?.code, id).toBe('workspace_destination_exists');
      expect(blocker?.detail, id).toContain('never overwrites or merges into');
    }
    const change = plan.blockers.find((entry) => entry.id === 'change-not-already-created');
    expect(change?.code).toBe('workspace_already_bound');
    expect(change?.actual).toBe(
      path.join(f.storeRoot, 'rasen', 'projects', PROJECT, 'changes', CHANGE)
    );
    // Nothing was touched: the occupied destinations are byte-identical.
    expect(fs.readFileSync(path.join(planningWorktree, 'stray.txt'), 'utf8')).toBe('occupied\n');
  });

  it('writes nothing at all when the plan cannot be applied', async () => {
    fs.mkdirSync(planningWorktree, { recursive: true });
    fs.writeFileSync(path.join(planningWorktree, 'stray.txt'), 'occupied\n', 'utf8');

    const before = machineFileCount();
    const plan = await f.workspace().plan(input());

    expect(plan.applicable).toBe(false);
    // A preview is a READ: an inapplicable plan is not even persisted.
    expect(machineFileCount()).toBe(before);
    expect(
      fs.existsSync(path.join(f.globalDataDir, 'planning-workspaces', 'plans', `${plan.planId}.json`))
    ).toBe(false);
  });

  it('refuses to reuse a RECORDED worktree that has moved to another ref, and switches nothing', async () => {
    // This is the spec scenario: "the RECORDED planning worktree is checked out
    // on a different ref". The pair has to exist first for there to be a
    // recorded ref to disagree with.
    const prepared = await f.workspace().plan(input());
    await f.workspace().apply(prepared.token!);
    f.git(planningWorktree, ['switch', '--quiet', '--create', 'user-moved-me']);
    const headBefore = f.git(planningWorktree, ['rev-parse', 'HEAD']).trim();

    const plan = await f.workspace().plan(input());

    expect(unsatisfied(plan)).toContain('planning-ref-matches');
    const blocker = plan.blockers.find((entry) => entry.id === 'planning-ref-matches');
    expect(blocker?.code).toBe('workspace_ref_mismatch');
    expect(blocker?.expected).toBe(BRANCH);
    expect(blocker?.actual).toBe('refs/heads/user-moved-me');
    expect(blocker?.detail).toContain('refuses rather than switching it');
    // Nothing moved: the HEAD, the ref, and the working tree are as the user
    // left them.
    expect(f.git(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/user-moved-me'
    );
    expect(f.git(planningWorktree, ['rev-parse', 'HEAD']).trim()).toBe(headBefore);
    // Dirtiness is asserted through the Module's OWN Git adapter rather than
    // through the fixture's `git`: the fixture runs Git with an empty global
    // config while the adapter inherits the host's, so in a worktree Git itself
    // checked out the two disagree about line-ending normalization. Production
    // never mixes the two, and this is the view every precondition uses.
    expect(await f.dependencies.git.dirtyEntries(planningWorktree)).toEqual([]);
  });

  it('adopts the ref a freshly reused worktree is already on, because nothing is recorded yet', async () => {
    // Deliberate, and stated in `plan.ts`: with no recorded pair there is
    // nothing for the ref to disagree WITH, and preparation never moves a HEAD.
    // The adopted ref is printed in the preview the user reads before applying,
    // so it is visible rather than silent (design decision 9).
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'unrelated', planningWorktree, 'HEAD']);

    const plan = await f.workspace().plan(input());

    expect(plan.planning.disposition).toBe('reuse');
    expect(plan.planning.ref).toBe('refs/heads/unrelated');
    expect(plan.planning.createsBranch).toBe(false);
    const reported = plan.preconditions.find((entry) => entry.id === 'planning-ref-matches');
    expect(reported?.satisfied).toBe(true);
    expect(reported?.detail).toContain('refs/heads/unrelated');
    // The HEAD is untouched either way.
    expect(f.git(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/unrelated'
    );
  });

  it('refuses to reuse a worktree with a detached HEAD, because a pair records a ref', async () => {
    f.git(f.storeRoot, ['worktree', 'add', '--detach', planningWorktree, 'HEAD']);

    const plan = await f.workspace().plan(input());

    const blocker = plan.blockers.find((entry) => entry.id === 'planning-ref-matches');
    expect(blocker?.code).toBe('workspace_ref_mismatch');
    expect(blocker?.actual).toBe('(detached HEAD)');
  });

  it('refuses the Store integration checkout as a planning worktree', async () => {
    const plan = await f.workspace().plan(input({ planningWorktree: f.storeRoot }));

    const blocker = plan.blockers.find((entry) => entry.id === 'planning-is-linked-worktree');
    expect(blocker?.actual).toBe('the main checkout');
    expect(blocker?.code).toBe('workspace_ref_mismatch');
    expect(plan.applicable).toBe(false);
  });

  it('permits the project main checkout as the execution side', async () => {
    // A pair may legitimately execute in the code repository's main checkout;
    // only the Store integration checkout is categorically unauthorized. The
    // WHOLE plan has to agree: the sibling precondition blessed this exact
    // input from the start, and the containment veto used to contradict it.
    // The old test asserted only the blessing — which is how two contradictory
    // preconditions shipped green — so this one asserts the full applicable
    // face, not one satisfied fact.
    f.git(f.projectRoot(PROJECT), ['switch', '--quiet', '--create', 'temp-branch']);
    const plan = await f.workspace().plan(
      input({ executionWorktree: f.projectRoot(PROJECT) })
    );
    const linked = plan.preconditions.find((entry) => entry.id === 'execution-is-linked-worktree');
    expect(linked?.satisfied).toBe(true);
    expect(plan.applicable).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.token).toBeDefined();
    expect(plan.execution.disposition).toBe('reuse');
    const containment = plan.preconditions.find(
      (entry) => entry.id === 'execution-root-outside-repository'
    );
    expect(containment?.satisfied).toBe(true);
    expect(containment?.detail).toBe(
      `${f.projectRoot(PROJECT)} is the execution repository's main checkout, which a pair may legitimately use for execution.`
    );
  });

  it('keeps the blessing for an aliased spelling of the main checkout', async () => {
    // The exemption keys on samePath — resolved and case-folded per the plan's
    // flavor — never on literal string equality, because the repository root
    // it compares against is what `git worktree list` prints, which can differ
    // from the operator's spelling in drive-letter case or trailing
    // separators. The alias is assembled with separators rather than
    // `path.join`, which would normalize it away before the code under test
    // ever saw it; the case flip only exists on Windows.
    f.git(f.projectRoot(PROJECT), ['switch', '--quiet', '--create', 'temp-branch']);
    const direct = f.projectRoot(PROJECT);
    const alias =
      process.platform === 'win32' && /^[A-Za-z]:/.test(direct)
        ? `${direct[0] === direct[0].toUpperCase() ? direct[0].toLowerCase() : direct[0].toUpperCase()}${direct.slice(1)}${path.sep}`
        : `${direct}${path.sep}.${path.sep}`;
    expect(alias).not.toBe(direct);

    const plan = await f.workspace().plan(input({ executionWorktree: alias }));

    expect(plan.applicable).toBe(true);
    expect(plan.blockers).toEqual([]);
    const containment = plan.preconditions.find(
      (entry) => entry.id === 'execution-root-outside-repository'
    );
    expect(containment?.satisfied).toBe(true);
    expect(containment?.detail).toContain(
      'main checkout, which a pair may legitimately use for execution.'
    );
  });

  it('leaves a dirty reused worktree alone, because preparation does not touch it', async () => {
    f.git(f.projectRoot(PROJECT), ['worktree', 'add', '-b', BRANCH.slice('refs/heads/'.length), executionWorktree, 'HEAD']);
    fs.writeFileSync(path.join(executionWorktree, 'README.md'), 'uncommitted edit\n', 'utf8');

    const plan = await f.workspace().plan(input());

    expect(plan.execution.disposition).toBe('reuse');
    expect(unsatisfied(plan)).not.toContain('execution-ref-matches');
    // The edit is still there and still uncommitted.
    expect(fs.readFileSync(path.join(executionWorktree, 'README.md'), 'utf8')).toBe(
      'uncommitted edit\n'
    );
    expect(f.git(executionWorktree, ['status', '--porcelain'])).toContain('README.md');
  });

  // ---- containment on both flavors ---------------------------------------

  it('asserts marker containment against the planned root on the plan flavor', async () => {
    const plan = await f.workspace().plan(input());
    const contained = plan.preconditions.filter((entry) => entry.id.endsWith('-marker-contained'));
    expect(contained.map((entry) => entry.id)).toEqual([
      'planning-marker-contained',
      'execution-marker-contained',
    ]);
    expect(contained.every((entry) => entry.satisfied)).toBe(true);
    expect(contained[0]?.detail).toContain(
      path.join(planningWorktree, '.rasen', 'planning-line.json')
    );
  });

  it('refuses a planned root inside its own repository checkout', async () => {
    // The containment check above is structurally incapable of failing: a
    // marker path is two fixed literals joined onto its own root. The
    // containment fact that CAN be false is about the ROOT, which is what
    // `--planning-worktree` / `--execution-worktree` supply — and a worktree
    // nested inside its own repository shows up there as untracked content,
    // which contradicts "the integration checkout SHALL remain byte-identical".
    const insideStore = await f.workspace().plan(
      input({ planningWorktree: f.at('nested-planning') })
    );
    expect(unsatisfied(insideStore)).toContain('planning-root-outside-repository');
    expect(insideStore.applicable).toBe(false);
    const storeBlocker = insideStore.blockers.find(
      (entry) => entry.id === 'planning-root-outside-repository'
    );
    expect(storeBlocker?.actual).toBe(f.at('nested-planning'));
    expect(storeBlocker?.code).toBe('workspace_destination_exists');

    const insideCode = await f.workspace().plan(
      input({
        executionWorktree: path.join(f.projectRoot(PROJECT), 'nested-execution'),
      })
    );
    expect(unsatisfied(insideCode)).toContain('execution-root-outside-repository');
    expect(insideCode.applicable).toBe(false);
  });

  it('refuses a pair whose two roots are the same path or nested', async () => {
    const nested = await f.workspace().plan(
      input({
        planningWorktree: f.beside('one-tree'),
        executionWorktree: f.beside('one-tree', 'inner'),
      })
    );
    expect(unsatisfied(nested)).toContain('pair-roots-disjoint');
    expect(nested.applicable).toBe(false);

    const identical = await f.workspace().plan(
      input({
        planningWorktree: f.beside('same-tree'),
        executionWorktree: f.beside('same-tree'),
      })
    );
    expect(unsatisfied(identical)).toContain('pair-roots-disjoint');
    expect(identical.applicable).toBe(false);
  });

  it('reports both root containment checks as satisfied for the normal case', async () => {
    // The other half of discrimination: the new preconditions must not fire on
    // the destinations the CLI documents ("beside the store checkout").
    const plan = await f.workspace().plan(input());
    const ids = plan.preconditions.map((entry) => entry.id);
    for (const id of [
      'planning-root-outside-repository',
      'execution-root-outside-repository',
      'pair-roots-disjoint',
    ]) {
      expect(ids, id).toContain(id);
      expect(plan.preconditions.find((entry) => entry.id === id)?.satisfied, id).toBe(true);
    }
    expect(plan.applicable).toBe(true);
  });

  it('refuses a foreign path flavor rather than emitting a destination nothing can open', async () => {
    // The Store root is spelled in the host's flavor, so planning it as the
    // other one cannot produce a real path. `workspace-windows-paths.test.ts`
    // pins the per-function rules; this pins that the PLAN honours the flavor
    // it was given instead of silently falling back to native.
    const foreign = process.platform === 'win32' ? 'posix' : 'win32';
    await expect(f.workspace().plan(input({ pathFlavor: foreign }))).rejects.toThrow();
  });

  // ---- refusals raised before a plan exists ------------------------------

  it('refuses a scope with no project, no target line, or no code locator', async () => {
    expect(
      codeOf(
        await f
          .workspace()
          .plan(input({ project: undefined }))
          .catch((error: unknown) => error)
      )
    ).toBe('workspace_project_unresolved');
    expect(
      codeOf(
        await f
          .workspace()
          .plan(input({ targetLine: undefined }))
          .catch((error: unknown) => error)
      )
    ).toBe('workspace_target_line_unknown');

    // A line with no locator for this project cannot produce an execution side.
    f.writeTargetLine({ id: LINE, storeRef: 'refs/heads/release/0.2' });
    expect(
      codeOf(await f.workspace().plan(input()).catch((error: unknown) => error))
    ).toBe('target_line_ref_unresolved');
  });

  it('refuses a second Change in a planning worktree the index already records', async () => {
    const first = await f.workspace().plan(input());
    await f.workspace().apply(first.token!);

    const error = await f
      .workspace()
      .plan(input({ changeId: 'second-change' }))
      .catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('workspace_already_bound');
    expect((error as StoreError).diagnostic.message).toContain(CHANGE);
    // Decided from the RECORDED binding, not from a scan of the planning tree.
    expect((error as StoreError).diagnostic.fix).toContain('second planning worktree');
  });

  // ---- existing-change intent -------------------------------------------

  it('verifies an already-minted identity under intent existing-change', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });

    const plan = await f.workspace().plan(input({ intent: 'existing-change' }));
    expect(plan.intent).toBe('existing-change');
    expect(plan.changeInstanceId).toBe(seeded.instanceId);
    expect(plan.applicable).toBe(true);
  });

  it('refuses to bind a Change frozen against another line', async () => {
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: 'line-0.3',
      changeId: CHANGE,
    });

    const error = await f
      .workspace()
      .plan(input({ intent: 'existing-change' }))
      .catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('target_line_mismatch');
    expect((error as StoreError).diagnostic.message).toContain('line-0.3');
  });
});
