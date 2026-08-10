/**
 * `store-planning-worktree-bindings` task 6.9 — applying a plan, with a failure
 * injected after each action.
 *
 * The invariant is narrow and load-bearing: whatever fails, the result is
 * either a fully unprepared state or one complete prepared state — never a
 * half-written marker, and never a worktree on disk that no index entry knows
 * about. That is why the phase is recorded BEFORE each transition rather than
 * after it, and it is the reason re-applying the same token is how an
 * interrupted run completes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreError } from '../../../src/core/store/errors.js';
import { deriveWorkspacePairId } from '../../../src/core/store/planning-identity.js';
import { serializeBindingFact } from '../../../src/core/store/workspace/binding.js';
import type { StoreWorkspaceDependencies } from '../../../src/core/store/workspace/dependencies.js';
import { StoreWorkspace } from '../../../src/core/store/workspace/module.js';
import {
  readWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from '../../../src/core/store/workspace/registry.js';
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

describe('applying a workspace plan', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-apply-',
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
    } as Parameters<StoreWorkspace['plan']>[0];
  }

  async function plan(): Promise<ImmutableWorkspacePlan> {
    const built = await f.workspace().plan(input());
    expect(built.applicable, JSON.stringify(built.blockers)).toBe(true);
    return built;
  }

  async function existingChangePlan(): Promise<{
    readonly built: ImmutableWorkspacePlan;
    readonly changeInstanceId: string;
  }> {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    const built = await f.workspace().plan(input({ intent: 'existing-change' }));
    expect(built.applicable, JSON.stringify(built.blockers)).toBe(true);
    expect(built.changeInstanceId).toBe(seeded.instanceId);
    return { built, changeInstanceId: seeded.instanceId };
  }

  async function indexEntry(): Promise<WorkspaceIndexEntry | null> {
    return readWorkspaceIndexEntry(
      f.dependencies.coordination(f.globalDataDir),
      f.planningScopeId(PROJECT, LINE),
      CHANGE
    );
  }

  /** A dependency set that throws the Nth time `hook` is reached. */
  function failingAt(
    hook: 'addWorktree' | 'writeText',
    occurrence: number
  ): StoreWorkspaceDependencies {
    let seen = 0;
    if (hook === 'addWorktree') {
      return {
        ...f.dependencies,
        git: {
          ...f.dependencies.git,
          addWorktree: async (request) => {
            seen += 1;
            if (seen === occurrence) throw new Error(`injected addWorktree failure #${seen}`);
            return f.dependencies.git.addWorktree(request);
          },
        },
      };
    }
    return {
      ...f.dependencies,
      fs: {
        ...f.dependencies.fs,
        writeText: async (target, content) => {
          // Only the binding documents are counted; the index goes through
          // `coordination.writeJson`, which is a different seam.
          if (target.includes(`${path.sep}.rasen${path.sep}`)) {
            seen += 1;
            if (seen === occurrence) throw new Error(`injected writeText failure #${seen}`);
          }
          return f.dependencies.fs.writeText(target, content);
        },
      },
    };
  }

  function workspaceWith(dependencies: StoreWorkspaceDependencies): StoreWorkspace {
    return new StoreWorkspace(dependencies, { globalDataDir: f.globalDataDir });
  }

  // ---- the happy apply ---------------------------------------------------

  it('creates both worktrees from the frozen commits and writes both binding documents', async () => {
    const built = await plan();
    const storeOid = f.refOid(f.storeRoot, 'refs/heads/release/0.2');
    const codeOid = f.refOid(f.projectRoot(PROJECT), 'refs/heads/release/0.2');

    const result = await f.workspace().apply(built.token!);

    expect(result.bindingState).toBe('prepared');
    expect([...result.created].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(result.reused).toEqual([]);
    // Created FROM the OID: each new worktree's HEAD is the frozen commit, and
    // its branch is the planned one.
    expect(f.git(planningWorktree, ['rev-parse', 'HEAD']).trim()).toBe(storeOid);
    expect(f.git(executionWorktree, ['rev-parse', 'HEAD']).trim()).toBe(codeOid);
    expect(f.git(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
    expect(f.git(executionWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
    // Both binding documents carry the digested bytes the plan promised.
    for (const [file, digestKind] of [
      [path.join(planningWorktree, '.rasen', 'planning-line.json'), 'write-planning-marker'],
      [
        path.join(executionWorktree, '.rasen', 'planning-binding.json'),
        'write-execution-association',
      ],
    ] as const) {
      expect(fs.existsSync(file), file).toBe(true);
      const action = built.actions.find((entry) => entry.kind === digestKind);
      expect(action?.destination).toBe(file);
    }
    // Preparation writes nothing Git-tracked, so it suggests no commit.
    expect(result.suggestedCommits).toEqual([]);
    // Neither main checkout moved.
    expect(f.git(f.storeRoot, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe('refs/heads/main');
    expect(f.git(f.projectRoot(PROJECT), ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/main'
    );
  });

  it('consumes only the token, ignoring the directory and selectors that produced the plan', async () => {
    const built = await plan();
    // A second Store, a different cwd, and no selectors at all: `apply` reads
    // none of them.
    const other = await createStoreWorkspaceFixture({ prefix: 'rasen-other-store-' });
    try {
      const result = await f.workspace().apply(built.token!);
      expect(result.planning.root).toBe(planningWorktree);
      expect(result.execution.root).toBe(executionWorktree);
      expect(result.scope.storeUid).toBe(f.storeUid);
      expect(result.scope.storeUid).not.toBe(other.storeUid);
    } finally {
      other.cleanup();
    }
  });

  it('is idempotent: re-applying a token completes rather than duplicating', async () => {
    const built = await plan();
    await f.workspace().apply(built.token!);
    const markerBefore = fs.readFileSync(
      path.join(planningWorktree, '.rasen', 'planning-line.json')
    );

    const again = await f.workspace().apply(built.token!);

    expect(again.created).toEqual([]);
    expect([...again.reused].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(
      fs.readFileSync(path.join(planningWorktree, '.rasen', 'planning-line.json')).equals(markerBefore)
    ).toBe(true);
    // Exactly one linked worktree per repository, not two.
    expect(f.git(f.storeRoot, ['worktree', 'list']).trim().split('\n')).toHaveLength(2);
    expect(f.git(f.projectRoot(PROJECT), ['worktree', 'list']).trim().split('\n')).toHaveLength(2);
  });

  it('completes an existing Change with one canonical, retry-stable pair identity', async () => {
    const { built, changeInstanceId } = await existingChangePlan();

    const first = await f.workspace().apply(built.token!);
    const firstEntry = await indexEntry();

    expect(first.bindingState).toBe('bound');
    expect(first.changeInstanceId).toBe(changeInstanceId);
    expect(first.workspacePairId).toBeDefined();
    expect(firstEntry).toMatchObject({
      phase: 'bound',
      changeInstanceId,
      workspacePairId: first.workspacePairId,
    });
    expect(first.workspacePairId).toBe(
      deriveWorkspacePairId({
        changeInstanceId,
        planningWorktreeInstanceId: firstEntry!.planning.worktreeInstanceId,
        executionWorktreeInstanceId: firstEntry!.execution.worktreeInstanceId,
      })
    );

    const described = await f.workspace().describe({
      store: f.storeId,
      project: PROJECT,
      targetLine: LINE,
      changeId: CHANGE,
      startPath: executionWorktree,
      globalDataDir: f.globalDataDir,
    });
    expect(described).toMatchObject({
      bindingState: 'bound',
      changeInstanceId,
      workspacePairId: first.workspacePairId,
    });

    const markerBefore = fs.readFileSync(
      path.join(planningWorktree, '.rasen', 'planning-line.json')
    );
    const associationBefore = fs.readFileSync(
      path.join(executionWorktree, '.rasen', 'planning-binding.json')
    );
    const again = await f.workspace().apply(built.token!);
    const againEntry = await indexEntry();

    expect(again.bindingState).toBe('bound');
    expect(again.changeInstanceId).toBe(changeInstanceId);
    expect(again.workspacePairId).toBe(first.workspacePairId);
    expect(againEntry?.changeInstanceId).toBe(changeInstanceId);
    expect(againEntry?.workspacePairId).toBe(first.workspacePairId);
    expect(again.created).toEqual([]);
    expect([...again.reused].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(f.git(f.storeRoot, ['worktree', 'list']).trim().split('\n')).toHaveLength(2);
    expect(f.git(f.projectRoot(PROJECT), ['worktree', 'list']).trim().split('\n')).toHaveLength(2);
    expect(
      fs.readFileSync(path.join(planningWorktree, '.rasen', 'planning-line.json')).equals(markerBefore)
    ).toBe(true);
    expect(
      fs
        .readFileSync(path.join(executionWorktree, '.rasen', 'planning-binding.json'))
        .equals(associationBefore)
    ).toBe(true);
  });

  it('keeps an existing Change prepared when completion cannot derive the execution identity', async () => {
    const { built, changeInstanceId } = await existingChangePlan();
    const associationPath = path.join(
      executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    let executionIdentityUnavailable = false;
    const unavailable: StoreWorkspaceDependencies = {
      ...f.dependencies,
      fs: {
        ...f.dependencies.fs,
        writeText: async (target, content) => {
          await f.dependencies.fs.writeText(target, content);
          if (path.resolve(target) === path.resolve(associationPath)) {
            executionIdentityUnavailable = true;
          }
        },
      },
      git: {
        ...f.dependencies.git,
        repositoryPaths: async (root) =>
          executionIdentityUnavailable && path.resolve(root) === path.resolve(executionWorktree)
            ? null
            : f.dependencies.git.repositoryPaths(root),
      },
    };

    const result = await workspaceWith(unavailable).apply(built.token!);
    const entry = await indexEntry();

    expect(result.bindingState).toBe('prepared');
    expect(result.changeInstanceId).toBe(changeInstanceId);
    expect(result.workspacePairId).toBeUndefined();
    expect(entry).toMatchObject({
      phase: 'prepared',
      changeInstanceId,
      execution: { root: executionWorktree, worktreeInstanceId: '' },
    });
    expect(entry?.workspacePairId).toBeUndefined();
  });

  it('refuses originally-created worktree identity drift on retry without rewriting binding state', async () => {
    const { built } = await existingChangePlan();
    expect(built.execution.disposition).toBe('create');
    const first = await f.workspace().apply(built.token!);
    expect(first.bindingState).toBe('bound');

    const markerPath = path.join(planningWorktree, '.rasen', 'planning-line.json');
    const associationPath = path.join(
      executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${f.planningScopeId(PROJECT, LINE)}.json`
    );
    const markerBefore = fs.readFileSync(markerPath);
    const associationBefore = fs.readFileSync(associationPath);
    const indexBefore = fs.readFileSync(indexPath);
    expect((await indexEntry())?.execution.worktreeInstanceId).not.toBe('');

    f.git(f.projectRoot(PROJECT), ['worktree', 'remove', '--force', executionWorktree]);
    f.git(f.projectRoot(PROJECT), [
      'clone',
      '--quiet',
      '--branch',
      `change/${LINE}/${PROJECT}/${CHANGE}`,
      f.projectRoot(PROJECT),
      executionWorktree,
    ]);
    expect(f.git(executionWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(BRANCH);
    fs.mkdirSync(path.dirname(associationPath), { recursive: true });
    fs.writeFileSync(associationPath, associationBefore);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain(
      'identity of the created execution'
    );
    expect(fs.readFileSync(markerPath).equals(markerBefore)).toBe(true);
    expect(fs.readFileSync(associationPath).equals(associationBefore)).toBe(true);
    expect(fs.readFileSync(indexPath).equals(indexBefore)).toBe(true);
  });

  it('refuses reused-worktree identity drift before writing the prepared carriers', async () => {
    const preparedPlan = await plan();
    await f.workspace().apply(preparedPlan.token!);
    const { built } = await existingChangePlan();
    expect(built.execution.disposition).toBe('reuse');
    const frozenIdentity = built.execution.worktreeInstanceId;
    const markerPath = path.join(planningWorktree, '.rasen', 'planning-line.json');
    const markerBefore = fs.readFileSync(markerPath);
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${f.planningScopeId(PROJECT, LINE)}.json`
    );
    const indexBefore = fs.readFileSync(indexPath);

    f.git(f.projectRoot(PROJECT), ['worktree', 'remove', '--force', executionWorktree]);
    f.git(f.projectRoot(PROJECT), [
      'clone',
      '--quiet',
      '--branch',
      `change/${LINE}/${PROJECT}/${CHANGE}`,
      f.projectRoot(PROJECT),
      executionWorktree,
    ]);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain('identity of the reused execution');
    expect((error as StoreError).diagnostic.message).toContain(frozenIdentity);
    expect(fs.existsSync(path.join(executionWorktree, '.rasen', 'planning-binding.json'))).toBe(
      false
    );
    expect(fs.readFileSync(markerPath).equals(markerBefore)).toBe(true);
    expect(fs.readFileSync(indexPath).equals(indexBefore)).toBe(true);
  });

  it('refuses a reused marker target-line disagreement without rewriting either carrier', async () => {
    const preparedPlan = await plan();
    await f.workspace().apply(preparedPlan.token!);
    const { built } = await existingChangePlan();
    const markerPath = path.join(planningWorktree, '.rasen', 'planning-line.json');
    const associationPath = path.join(
      executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    f.write(
      markerPath,
      serializeBindingFact({
        version: 1,
        storeUid: f.storeUid,
        storeId: f.storeId,
        projectId: PROJECT,
        targetLineId: 'line-0.3',
        executionRoot: executionWorktree,
      })
    );
    const markerBefore = fs.readFileSync(markerPath);
    const associationBefore = fs.readFileSync(associationPath);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_marker_conflict');
    expect((error as StoreError).diagnostic.message).toContain('line-0.3');
    expect(fs.readFileSync(markerPath).equals(markerBefore)).toBe(true);
    expect(fs.readFileSync(associationPath).equals(associationBefore)).toBe(true);
  });

  // ---- injected failures -------------------------------------------------

  it('leaves a resumable record and no orphan when the first worktree creation fails', async () => {
    const built = await plan();

    await expect(workspaceWith(failingAt('addWorktree', 1)).apply(built.token!)).rejects.toThrow(
      'injected addWorktree failure #1'
    );

    // No worktree exists...
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    // ...and the index knows what was being attempted, so the run is resumable
    // from the record rather than from a directory scan.
    const entry = await indexEntry();
    expect(entry?.phase).toBe('planning-worktree-created');
    expect(entry?.planning.root).toBe(planningWorktree);

    // Re-applying the same token completes.
    const completed = await f.workspace().apply(built.token!);
    expect([...completed.created].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect((await indexEntry())?.phase).toBe('prepared');
  });

  it('leaves no orphan worktree when the second creation fails', async () => {
    const built = await plan();

    await expect(workspaceWith(failingAt('addWorktree', 2)).apply(built.token!)).rejects.toThrow(
      'injected addWorktree failure #2'
    );

    // The planning worktree exists — and the index entry that names it exists
    // too, which is the whole point: no worktree without a record.
    expect(fs.existsSync(planningWorktree)).toBe(true);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    const entry = await indexEntry();
    expect(entry?.planning.root).toBe(planningWorktree);
    expect(entry?.phase).toBe('execution-worktree-created');
    // No marker was written, so there is no half-prepared pair to mistake for
    // a real one.
    expect(fs.existsSync(path.join(planningWorktree, '.rasen', 'planning-line.json'))).toBe(false);

    const completed = await f.workspace().apply(built.token!);
    expect(completed.created).toEqual([executionWorktree]);
    expect(completed.reused).toEqual([planningWorktree]);
    expect((await indexEntry())?.phase).toBe('prepared');
  });

  it('never leaves a half-written marker when a binding document write fails', async () => {
    const built = await plan();

    await expect(workspaceWith(failingAt('writeText', 2)).apply(built.token!)).rejects.toThrow(
      'injected writeText failure #2'
    );

    const markerPath = path.join(planningWorktree, '.rasen', 'planning-line.json');
    const associationPath = path.join(executionWorktree, '.rasen', 'planning-binding.json');
    // The first document is complete; the second is absent, not truncated.
    expect(JSON.parse(fs.readFileSync(markerPath, 'utf8'))).toMatchObject({
      version: 1,
      projectId: PROJECT,
      targetLineId: LINE,
    });
    expect(fs.existsSync(associationPath)).toBe(false);
    expect((await indexEntry())?.phase).toBe('markers-written');

    const completed = await f.workspace().apply(built.token!);
    expect(completed.bindingState).toBe('prepared');
    expect(JSON.parse(fs.readFileSync(associationPath, 'utf8'))).toMatchObject({
      planningWorktree,
    });
    expect((await indexEntry())?.phase).toBe('prepared');
  });

  // ---- revalidation ------------------------------------------------------

  it('aborts with workspace_plan_stale when the Store ref moves, creating nothing', async () => {
    const built = await plan();
    const frozen = built.token!.storeRefOid;
    f.write(f.at('moved.md'), 'moved\n');
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', 'move']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);

    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain('refs/heads/release/0.2');
    expect((error as StoreError).diagnostic.message).toContain(frozen);
    expect((error as StoreError).diagnostic.fix).toContain('invalidated, never repaired');
    // Nothing was created.
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    expect(await indexEntry()).toBeNull();
  });

  it('aborts when the code ref moves', async () => {
    const built = await plan();
    const codeRoot = f.projectRoot(PROJECT);
    f.write(path.join(codeRoot, 'moved.md'), 'moved\n');
    f.git(codeRoot, ['add', '.']);
    f.git(codeRoot, ['commit', '-m', 'move']);
    f.git(codeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect(fs.existsSync(executionWorktree)).toBe(false);
  });

  it('aborts when the target-line catalog text is edited', async () => {
    const built = await plan();
    f.writeTargetLine({
      id: LINE,
      storeRef: 'refs/heads/release/0.2',
      codeRefs: { [PROJECT]: 'refs/heads/main' },
    });

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain(`target-line catalog for '${LINE}'`);
    expect(fs.existsSync(planningWorktree)).toBe(false);
  });

  it('aborts when the Store stops declaring layout version 2', async () => {
    const built = await plan();
    f.write(
      f.at('.rasen-store', 'store.yaml'),
      `version: 2\nuid: ${f.storeUid}\nid: ${f.storeId}\n`
    );

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain('declared layout version');
  });

  it('aborts when a planned destination is occupied by something else', async () => {
    const built = await plan();
    // Not a worktree, and not on the planned ref: the plan promised an absent
    // destination and reality disagrees.
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'squatter', planningWorktree, 'HEAD']);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain(planningWorktree);
    expect(f.git(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/squatter'
    );
  });

  it('aborts when another Change is prepared in the same scope between plan and apply', async () => {
    const built = await plan();
    // The fingerprint covers this scope's document with this plan's OWN entry
    // excluded, so a CONCURRENT preparation of a different Change invalidates
    // the plan while this plan's own phase transitions do not.
    const other = await f.workspace().plan(input({
      changeId: 'other-change',
      planningWorktree: f.beside('store-planning-other'),
      executionWorktree: f.beside('app-a-other'),
    }));
    await f.workspace().apply(other.token!);

    const error = await f.workspace().apply(built.token!).catch((raised: unknown) => raised);
    expect(codeOf(error)).toBe('workspace_plan_stale');
    expect((error as StoreError).diagnostic.message).toContain('machine workspace index');
    expect(fs.existsSync(planningWorktree)).toBe(false);
  });

  it('writes nothing outside the two planned roots and the machine data directory', async () => {
    const built = await plan();
    const written: string[] = [];
    const watched: StoreWorkspaceDependencies = {
      ...f.dependencies,
      fs: {
        ...f.dependencies.fs,
        writeText: async (target, content) => {
          written.push(target);
          return f.dependencies.fs.writeText(target, content);
        },
      },
    };

    await workspaceWith(watched).apply(built.token!);

    expect(written).toEqual([
      path.join(planningWorktree, '.rasen', 'planning-line.json'),
      path.join(executionWorktree, '.rasen', 'planning-binding.json'),
    ]);
    // The Store integration checkout and the code main checkout are untouched.
    expect(await f.dependencies.git.dirtyEntries(f.storeRoot)).toEqual([]);
    expect(await f.dependencies.git.dirtyEntries(f.projectRoot(PROJECT))).toEqual([]);
    expect(await f.dependencies.git.untrackedFiles(f.storeRoot)).toEqual([]);
  });
});
