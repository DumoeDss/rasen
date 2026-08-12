/**
 * `store-planning-worktree-bindings` tasks 2.5–2.8 — `StoreTargetLines`.
 *
 * A target line is a stable IDENTITY whose Git refs are mutable LOCATORS. The
 * three claims this suite exists to hold down are the ones the capability spec
 * states and that nothing else in the tree checks:
 *
 *   - Lines are authored explicitly. A branch that merely looks like a line is
 *     not one, and nothing completes a line from a similar name (task 2.5).
 *   - The identifier never moves while its locators do, and a locator an active
 *     Change depends on is never removed.
 *   - Resolution never falls back — not to HEAD, not to the current branch, not
 *     to a similar ref — and never succeeds partially.
 */
import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreError } from '../../../src/core/store/errors.js';
import {
  StoreTargetLinesModule,
  assertTargetLineMatchesChange,
} from '../../../src/core/store/target-lines.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';

/**
 * Git prints worktree roots with forward slashes on Windows, so the Store
 * checkout a command resolves may be spelled differently from the fixture's
 * native path while naming the same directory. Comparisons of ROOTS normalize;
 * comparisons of computed DESTINATIONS do not, because those go through the
 * layout contract and are native by construction.
 */
function toPosix(value: string): string {
  return value.split('\\').join('/');
}

function codeOf(error: unknown): string {
  if (error instanceof StoreError) return error.diagnostic.code;
  throw error;
}

async function refusal(action: () => Promise<unknown>): Promise<StoreError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

describe('store target lines', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-target-lines-',
      projects: [PROJECT],
      storeBranches: ['release/0.2', 'release/0.3'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function query() {
    return { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
  }

  // ---- authoring ---------------------------------------------------------

  it('authors a line at the catalog path the layout contract names, and stages nothing', async () => {
    const record = await f.targetLines().add({
      ...query(),
      targetLineId: LINE_03,
      storeRef: 'refs/heads/release/0.3',
    });

    const expected = f.at('.rasen-store', 'target-lines', `${LINE_03}.yaml`);
    expect(record.path).toBe(expected);
    expect(record.targetLineId).toBe(LINE_03);
    expect(record.storeRef).toBe('refs/heads/release/0.3');
    expect(record.projects).toEqual({});
    expect(fs.readFileSync(expected, 'utf8')).toContain('storeRef: refs/heads/release/0.3');
    // The catalog is Git-tracked Store content: the file is written, the index
    // is not touched, and the user is told what to commit.
    expect(f.git(f.storeRoot, ['diff', '--cached', '--name-only'])).toBe('');
    expect(record.suggestedCommits?.[0]?.pathspecs).toEqual([
      `.rasen-store/target-lines/${LINE_03}.yaml`,
    ]);
    expect(toPosix(record.suggestedCommits?.[0]?.repoRoot ?? '')).toBe(toPosix(f.storeRoot));
    expect(toPosix(record.suggestedCommits?.[0]?.command ?? '')).toContain(
      `git -C ${toPosix(f.storeRoot)} add -- .rasen-store/target-lines/${LINE_03}.yaml`
    );
  });

  it('records a project code locator when one is supplied with the project', async () => {
    const record = await f.targetLines().add({
      ...query(),
      targetLineId: LINE_03,
      storeRef: 'refs/heads/release/0.3',
      project: PROJECT,
      codeRef: 'refs/heads/release/0.2',
    });
    expect(record.projects).toEqual({ [PROJECT]: { codeRef: 'refs/heads/release/0.2' } });
  });

  it('refuses --project without --code-ref rather than recording an empty locator', async () => {
    const error = await refusal(() =>
      f.targetLines().add({
        ...query(),
        targetLineId: LINE_03,
        storeRef: 'refs/heads/release/0.3',
        project: PROJECT,
      })
    );
    expect(codeOf(error)).toBe('target_line_unknown');
    expect(fs.existsSync(f.at('.rasen-store', 'target-lines', `${LINE_03}.yaml`))).toBe(false);
  });

  it('refuses to overwrite an existing line and leaves the catalog byte-identical', async () => {
    const catalogPath = f.at('.rasen-store', 'target-lines', `${LINE_02}.yaml`);
    const before = fs.readFileSync(catalogPath);

    const error = await refusal(() =>
      f.targetLines().add({
        ...query(),
        targetLineId: LINE_02,
        storeRef: 'refs/heads/main',
      })
    );

    expect(codeOf(error)).toBe('target_line_exists');
    expect(error.diagnostic.message).toContain(catalogPath);
    expect(fs.readFileSync(catalogPath).equals(before)).toBe(true);
  });

  it('refuses an identifier the portable contract rejects, without sanitizing it', async () => {
    for (const invalid of ['Line 0.4', '../escape', 'line--0.4', '']) {
      await expect(
        f.targetLines().add({
          ...query(),
          targetLineId: invalid,
          storeRef: 'refs/heads/main',
        }),
        invalid
      ).rejects.toThrow();
    }
    // Nothing was written under any spelling.
    expect(fs.readdirSync(f.at('.rasen-store', 'target-lines'))).toEqual([`${LINE_02}.yaml`]);
  });

  it('refuses a ref that is not a full Git ref name', async () => {
    await expect(
      f.targetLines().add({ ...query(), targetLineId: LINE_03, storeRef: 'release/0.3' })
    ).rejects.toThrow();
    expect(fs.existsSync(f.at('.rasen-store', 'target-lines', `${LINE_03}.yaml`))).toBe(false);
  });

  // ---- a branch name is never a line -------------------------------------

  it('never resolves, creates, or offers a line a branch name merely suggests', async () => {
    // A branch whose name embeds a plausible identifier, and a Change-style
    // locator branch that embeds the real line's id. Neither is a line.
    f.git(f.storeRoot, ['branch', 'line-9.9']);
    f.git(f.storeRoot, ['branch', `change/${LINE_03}/${PROJECT}/redesign`]);

    for (const invented of ['line-9.9', LINE_03]) {
      expect(codeOf(await refusal(() => f.targetLines().show({ ...query(), targetLineId: invented }))))
        .toBe('target_line_unknown');
      expect(
        codeOf(await refusal(() => f.targetLines().resolve({ ...query(), targetLineId: invented })))
      ).toBe('target_line_unknown');
    }
    // `list` reports what is DECLARED, which is still just the one line.
    expect((await f.targetLines().list(query())).map((record) => record.targetLineId)).toEqual([
      LINE_02,
    ]);
  });

  // ---- list and show -----------------------------------------------------

  it('lists every declared line, including one whose refs do not resolve', async () => {
    await f.targetLines().add({
      ...query(),
      targetLineId: LINE_03,
      storeRef: 'refs/heads/never-created',
    });

    const listed = await f.targetLines().list(query());
    expect(listed.map((record) => record.targetLineId)).toEqual([LINE_02, LINE_03]);
    expect(listed[1]?.storeRef).toBe('refs/heads/never-created');
    // `show` is the same projection for one line, and neither reads Git.
    expect((await f.targetLines().show({ ...query(), targetLineId: LINE_03 })).storeRef).toBe(
      'refs/heads/never-created'
    );
  });

  // ---- locators move, identity does not ----------------------------------

  it('keeps the identifier and the single catalog when a locator moves from a branch to a tag', async () => {
    f.git(f.storeRoot, ['tag', 'v0.2.0', 'refs/heads/release/0.2']);
    const tagOid = f.refOid(f.storeRoot, 'refs/tags/v0.2.0');

    const moved = await f.targetLines().setRef({
      ...query(),
      targetLineId: LINE_02,
      storeRef: 'refs/tags/v0.2.0',
    });

    expect(moved.targetLineId).toBe(LINE_02);
    expect(moved.storeRef).toBe('refs/tags/v0.2.0');
    expect(moved.path).toBe(f.at('.rasen-store', 'target-lines', `${LINE_02}.yaml`));
    // Exactly one catalog still exists — a locator edit never forks the line.
    expect(fs.readdirSync(f.at('.rasen-store', 'target-lines'))).toEqual([`${LINE_02}.yaml`]);
    // The per-project locator the edit did not name survived untouched.
    expect(moved.projects).toEqual({ [PROJECT]: { codeRef: 'refs/heads/release/0.2' } });
    // ...and the line now resolves to the tag's commit.
    const resolved = await f.targetLines().resolve({ ...query(), targetLineId: LINE_02 });
    expect(resolved.storeRefOid).toBe(tagOid);
  });

  it('refuses a set-ref that names no locator to move', async () => {
    expect(
      codeOf(await refusal(() => f.targetLines().setRef({ ...query(), targetLineId: LINE_02 })))
    ).toBe('target_line_unknown');
  });

  it('refuses a code locator edit that names no project', async () => {
    expect(
      codeOf(
        await refusal(() =>
          f.targetLines().setRef({
            ...query(),
            targetLineId: LINE_02,
            codeRef: 'refs/heads/main',
          })
        )
      )
    ).toBe('target_line_unknown');
  });

  it('refuses removing a code locator an active Change on that line still depends on', async () => {
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE_02,
      changeId: 'redesign-routing',
    });
    const catalogPath = f.at('.rasen-store', 'target-lines', `${LINE_02}.yaml`);
    const before = fs.readFileSync(catalogPath);

    const error = await refusal(() =>
      f.targetLines().setRef({
        ...query(),
        targetLineId: LINE_02,
        project: PROJECT,
        removeCodeRef: true,
      })
    );

    expect(codeOf(error)).toBe('target_line_locator_in_use');
    expect(error.diagnostic.message).toContain('redesign-routing');
    expect(fs.readFileSync(catalogPath).equals(before)).toBe(true);
  });

  it('removes a code locator no active Change depends on', async () => {
    // The same Change, frozen against a DIFFERENT line, must not block it.
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE_03,
      changeId: 'other-line-change',
    });
    await f.targetLines().add({
      ...query(),
      targetLineId: LINE_03,
      storeRef: 'refs/heads/release/0.3',
    });

    const edited = await f.targetLines().setRef({
      ...query(),
      targetLineId: LINE_02,
      project: PROJECT,
      removeCodeRef: true,
    });
    expect(edited.projects).toEqual({});
  });

  // ---- resolution --------------------------------------------------------

  it('resolves both sides to the commit OIDs each repository currently names', async () => {
    const resolved = await f.targetLines().resolve({
      ...query(),
      targetLineId: LINE_02,
      project: PROJECT,
    });

    expect(resolved).toEqual({
      targetLineId: LINE_02,
      storeRef: 'refs/heads/release/0.2',
      storeRefOid: f.refOid(f.storeRoot, 'refs/heads/release/0.2'),
      codeRef: 'refs/heads/release/0.2',
      codeRefOid: f.refOid(f.projectRoot(PROJECT), 'refs/heads/release/0.2'),
    });
    // The two OIDs come from two different repositories and are not the same
    // commit, so a resolution that read one repository twice would be visible.
    expect(resolved.storeRefOid).not.toBe(resolved.codeRefOid);
  });

  it('resolves the Store side alone when no project is selected', async () => {
    const resolved = await f.targetLines().resolve({ ...query(), targetLineId: LINE_02 });
    expect(resolved.codeRef).toBeUndefined();
    expect(resolved.codeRefOid).toBeUndefined();
  });

  it('fails closed on a Store locator that names no ref, naming the field and repository', async () => {
    await f.targetLines().setRef({
      ...query(),
      targetLineId: LINE_02,
      storeRef: 'refs/heads/never-created',
    });

    const error = await refusal(() =>
      f.targetLines().resolve({ ...query(), targetLineId: LINE_02, project: PROJECT })
    );
    expect(codeOf(error)).toBe('target_line_ref_unresolved');
    expect(error.diagnostic.message).toContain('storeRef');
    expect(toPosix(error.diagnostic.message)).toContain(toPosix(f.storeRoot));
    // No fallback was selected: HEAD, the current branch, and the similarly
    // named `refs/heads/release/0.2` all exist and none of them was used.
    expect(error.diagnostic.message).not.toContain('release/0.2');
  });

  it('fails closed on a project code locator that names no ref', async () => {
    await f.targetLines().setRef({
      ...query(),
      targetLineId: LINE_02,
      project: PROJECT,
      codeRef: 'refs/heads/never-created',
    });

    const error = await refusal(() =>
      f.targetLines().resolve({ ...query(), targetLineId: LINE_02, project: PROJECT })
    );
    expect(codeOf(error)).toBe('target_line_ref_unresolved');
    expect(error.diagnostic.message).toContain(`projects.${PROJECT}.codeRef`);
    expect(toPosix(error.diagnostic.message)).toContain(toPosix(f.projectRoot(PROJECT)));
  });

  it('never resolves a partial ref name to the refs beneath it', async () => {
    // `git for-each-ref refs/heads/dup` matches BOTH children, because Git's
    // pattern matching reaches every ref below a component boundary. The
    // adapter keeps only an exact name match, so a locator that names a ref
    // PREFIX resolves to nothing rather than to whatever sits underneath.
    f.git(f.storeRoot, ['branch', 'dup/one', 'refs/heads/main']);
    f.git(f.storeRoot, ['branch', 'dup/two', 'refs/heads/release/0.2']);
    expect(
      f.git(f.storeRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads/dup']).split('\n')
    ).toContain('refs/heads/dup/one');

    await f.targetLines().setRef({
      ...query(),
      targetLineId: LINE_02,
      storeRef: 'refs/heads/dup',
    });
    const error = await refusal(() =>
      f.targetLines().resolve({ ...query(), targetLineId: LINE_02 })
    );
    expect(codeOf(error)).toBe('target_line_ref_unresolved');
    expect(error.diagnostic.message).toContain('names no ref');
    expect(error.diagnostic.message).not.toContain('dup/one');
  });

  it('refuses an ambiguous locator instead of picking one of the matches', async () => {
    // The production Git adapter filters to an exact name, so ambiguity cannot
    // reach the Module through it (see the case above). The rule still has to
    // hold for the substitutable adapter the Module is written against, and
    // this is the only place it can be stated.
    const ambiguous = new StoreTargetLinesModule({
      ...f.dependencies,
      git: {
        ...f.dependencies.git,
        resolveRef: async () => [
          { ref: 'refs/heads/release/0.2', oid: 'a'.repeat(40), objectType: 'commit' },
          { ref: 'refs/heads/release/0.2', oid: 'b'.repeat(40), objectType: 'commit' },
        ],
      },
    });

    const error = await refusal(() =>
      ambiguous.resolve({ ...query(), targetLineId: LINE_02 })
    );
    expect(codeOf(error)).toBe('target_line_ref_unresolved');
    expect(error.diagnostic.message).toContain('ambiguous');
    // Every claimant is listed and none is chosen.
    expect(error.diagnostic.message).toContain('a'.repeat(40));
    expect(error.diagnostic.message).toContain('b'.repeat(40));
  });

  it('refuses a locator that resolves to something other than a commit', async () => {
    // An annotated tag of a TREE is a ref that resolves, but not to a commit.
    const treeOid = f.git(f.storeRoot, ['rev-parse', 'HEAD^{tree}']).trim();
    f.git(f.storeRoot, ['tag', 'tree-tag', treeOid]);
    await f.targetLines().setRef({
      ...query(),
      targetLineId: LINE_02,
      storeRef: 'refs/tags/tree-tag',
    });

    const error = await refusal(() =>
      f.targetLines().resolve({ ...query(), targetLineId: LINE_02 })
    );
    expect(codeOf(error)).toBe('target_line_ref_unresolved');
    expect(error.diagnostic.message).toContain('not a commit');
  });

  it('reports a missing project locator instead of resolving the Store side alone', async () => {
    await f.targetLines().add({
      ...query(),
      targetLineId: LINE_03,
      storeRef: 'refs/heads/release/0.3',
    });

    const error = await refusal(() =>
      f.targetLines().resolve({ ...query(), targetLineId: LINE_03, project: PROJECT })
    );
    expect(codeOf(error)).toBe('target_line_ref_unresolved');
    expect(error.diagnostic.message).toContain(`no code locator for project '${PROJECT}'`);
    expect(error.diagnostic.fix).toContain('rasen store target-line set-ref');
  });

  // ---- the mismatch gate -------------------------------------------------

  it('refuses a command that resolves a line other than the one the Change froze', () => {
    let raised: unknown;
    try {
      assertTargetLineMatchesChange({
        changeId: 'redesign-routing',
        frozenTargetLineId: LINE_02,
        resolvedTargetLineId: LINE_03,
        source: 'the --target-line selector',
      });
    } catch (error) {
      raised = error;
    }
    expect(codeOf(raised)).toBe('target_line_mismatch');
    // BOTH lines are named, which is what makes the refusal actionable.
    expect((raised as StoreError).diagnostic.message).toContain(LINE_02);
    expect((raised as StoreError).diagnostic.message).toContain(LINE_03);
    expect((raised as StoreError).diagnostic.fix).toContain(`--target-line ${LINE_02}`);
  });

  it('accepts a command that resolves the line the Change froze', () => {
    expect(() =>
      assertTargetLineMatchesChange({
        changeId: 'redesign-routing',
        frozenTargetLineId: LINE_02,
        resolvedTargetLineId: LINE_02,
      })
    ).not.toThrow();
  });
});
