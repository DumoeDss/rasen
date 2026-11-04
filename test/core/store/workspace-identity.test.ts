/**
 * `store-planning-worktree-bindings` tasks 3.1–3.3 and 3.9 — worktree identity
 * against real Git.
 *
 * `workspace-windows-paths.test.ts` pins the FLAVOR rules with a substitutable
 * adapter, because Windows aliases cannot be conjured on a POSIX host. This
 * suite pins the same contract against actual repositories and actual linked
 * worktrees, which is where the two identity inputs — the shared common
 * directory and the per-worktree toplevel — actually come from.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreError } from '../../../src/core/store/errors.js';
import {
  deriveWorktreeIdentity,
  isLinkedWorktree,
  listWorktrees,
} from '../../../src/core/store/workspace/identity.js';
import { surveyWorktree } from '../../../src/core/store/workspace/binding.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

describe('workspace worktree identity against real Git', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-identity-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('gives every linked worktree of one repository the same repository identity and a distinct instance', async () => {
    const first = f.beside('store--fix-a');
    const second = f.beside('store--fix-b');
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'line/a', first, 'HEAD']);
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'line/b', second, 'HEAD']);

    const main = await deriveWorktreeIdentity(f.dependencies, f.storeRoot);
    const a = await deriveWorktreeIdentity(f.dependencies, first);
    const b = await deriveWorktreeIdentity(f.dependencies, second);

    // The repository half is the shared common directory — one value for all
    // three — and it is a canonical PATH, never a minted identifier.
    expect(a?.repositoryIdentity).toBe(main?.repositoryIdentity);
    expect(b?.repositoryIdentity).toBe(main?.repositoryIdentity);
    expect(toPosix(a?.canonicalCommonDir ?? '')).toBe(
      toPosix(path.join(fs.realpathSync.native(f.storeRoot), '.git'))
    );
    // The worktree half differs per worktree, so the instance ids do too.
    expect(new Set([main, a, b].map((identity) => identity?.worktreeInstanceId)).size).toBe(3);
    for (const identity of [main, a, b]) {
      expect(identity?.worktreeInstanceId.startsWith('wt_')).toBe(true);
    }
    // A code repository is a DIFFERENT repository, whatever its worktrees.
    const code = await deriveWorktreeIdentity(f.dependencies, f.projectRoot(PROJECT));
    expect(code?.repositoryIdentity).not.toBe(main?.repositoryIdentity);
  });

  it('distinguishes the main checkout from its linked worktrees', async () => {
    const linked = f.beside('store--fix-a');
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'line/a', linked, 'HEAD']);

    expect(await isLinkedWorktree(f.dependencies, f.storeRoot)).toBe(false);
    expect(await isLinkedWorktree(f.dependencies, linked)).toBe(true);
    // Git lists the main checkout first, which is what `repositoryMainCheckout`
    // relies on; the list is otherwise just locators.
    const entries = await listWorktrees(f.dependencies, linked);
    expect(entries?.[0]?.main).toBe(true);
    expect(toPosix(entries?.[0]?.root ?? '')).toBe(toPosix(f.storeRoot));
    expect(entries?.length).toBe(2);
  });

  it('reports no identity for a directory that is not inside a work tree', async () => {
    const plain = f.beside('not-a-repo');
    fs.mkdirSync(plain, { recursive: true });
    expect(await deriveWorktreeIdentity(f.dependencies, plain)).toBeNull();
  });

  it('fails closed when a real worktree root cannot be canonicalized', async () => {
    const linked = f.beside('store--fix-a');
    f.git(f.storeRoot, ['worktree', 'add', '-b', 'line/a', linked, 'HEAD']);
    // Git answers normally; only canonicalization fails. The whole point of
    // decision 3 is that this yields NO identity rather than the literal path.
    const failing = {
      ...f.dependencies,
      fs: {
        ...f.dependencies.fs,
        canonicalizeExisting: (target: string): string => {
          throw new Error(`EACCES: permission denied, realpath '${target}'`);
        },
      },
    };

    let raised: unknown;
    try {
      await deriveWorktreeIdentity(failing, linked);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(StoreError);
    expect((raised as StoreError).diagnostic.code).toBe('workspace_identity_unavailable');
    expect((raised as StoreError).diagnostic.message).toContain(linked);

    // ...and the caller that guards a project mutation turns that into a
    // refusal rather than proceeding: the worktree is simply not verified.
    const facts = await surveyWorktree(failing, {
      side: 'planning',
      root: linked,
      repositoryRoot: linked,
      flavor: 'native',
    }).catch(() => null);
    expect(facts?.worktreeInstanceId).toBeUndefined();
  });

  it('records the project id and a path-shaped repository identity, minting no repo_ identity', async () => {
    // Decision 3: `projectId` is the portable execution-repository fact, and
    // canonical repository identity exists only for local drift detection.
    const facts = await surveyWorktree(f.dependencies, {
      side: 'execution',
      root: f.projectRoot(PROJECT),
      repositoryRoot: f.projectRoot(PROJECT),
      flavor: 'native',
    });
    expect(facts.exists).toBe(true);
    expect(facts.repositoryIdentity?.startsWith('repo_')).toBe(false);
    expect(toPosix(facts.repositoryIdentity ?? '').toLowerCase()).toContain('/.git');
    expect(facts.worktreeInstanceId?.startsWith('wt_')).toBe(true);
  });

  it('has no repo_ identity minted anywhere in the workspace or target-line Modules', () => {
    // A source-level guard, in the shape children 2 and 3 established: the
    // absence of a second portable repository identity is a decision, and the
    // cheapest place to keep it is where a future edit would reintroduce it.
    const roots = [
      path.join(process.cwd(), 'src', 'core', 'store', 'workspace'),
      path.join(process.cwd(), 'src', 'core', 'store'),
    ];
    const offenders: string[] = [];
    const files = new Set<string>();
    for (const root of roots) {
      for (const name of fs.readdirSync(root, { withFileTypes: true })) {
        if (!name.isFile() || !name.name.endsWith('.ts')) continue;
        files.add(path.join(root, name.name));
      }
    }
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // The mint helpers all go through `hashIdentity('<prefix>_', ...)`, so a
      // new portable identity is visible as its prefix literal.
      if (/hashIdentity\(\s*'repo_/u.test(text) || /'repo_'/u.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
