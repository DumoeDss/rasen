/**
 * `store-planning-worktree-bindings` task 12.5 — path identity and destination
 * construction under `path.win32` and `path.posix`.
 *
 * Everything in `identity.ts` and the destination rule in `plan.ts` takes an
 * explicit `StorePlanningPathFlavor`, and until now every one of them has only
 * ever run on the host's native flavor. That is the single biggest blind spot
 * in this change: a Windows drive-letter alias that derives two worktree
 * identities silently creates a second binding, and a containment check that
 * folds case on the wrong flavor either lets a write escape a worktree root or
 * refuses a legitimate one.
 *
 * The first three blocks pin the pure functions on BOTH flavors explicitly, so
 * a `win32` claim is proven on a POSIX host and vice versa. The fourth drives
 * `deriveWorktreeIdentity` and `isLinkedWorktree` through a substitutable
 * filesystem/Git adapter whose `canonicalizeExisting` resolves aliases exactly
 * as its Interface documents — short names, junctions, and drive-letter case
 * cannot be conjured as real files on a POSIX CI host, and on Windows they
 * cannot be conjured deterministically. The last block runs real Git over the
 * path shapes that historically break: a non-ASCII worktree name, a path long
 * enough to cross the classic MAX_PATH budget, and an alias spelling of a real
 * directory.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  executionAssociationPath,
  planningMarkerPath,
} from '../../../src/core/store/workspace/binding.js';
import {
  comparablePath,
  deriveWorktreeIdentity,
  isContainedIn,
  isLinkedWorktree,
  pathApiFor,
  samePath,
} from '../../../src/core/store/workspace/identity.js';
import { defaultWorktreeDestination } from '../../../src/core/store/workspace/plan.js';
import {
  productionStoreWorkspaceDependencies,
  type StoreWorkspaceDependencies,
  type WorkspaceFileSystem,
  type WorkspaceGit,
  type WorktreeListEntry,
} from '../../../src/core/store/workspace/dependencies.js';
import { isStoreWorkspaceError } from '../../../src/core/store/workspace/diagnostics.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

/** A Chinese worktree name — three characters, nine UTF-8 bytes. */
const CHINESE = '结算规则';
/** Does THIS host's `native` flavor fold case? Only Windows does. */
const NATIVE_FOLDS_CASE = process.platform === 'win32';

describe('workspace path identity — comparablePath and samePath', () => {
  it('folds case on win32 and preserves it on posix', () => {
    expect(comparablePath('C:\\Stores\\Team', 'win32')).toBe('c:\\stores\\team');
    expect(comparablePath('c:/STORES/team', 'win32')).toBe('c:\\stores\\team');
    expect(comparablePath('/stores/Team', 'posix')).toBe('/stores/Team');
    // Each flavor emits only its own separator, whatever host is running.
    expect(comparablePath('C:\\Stores\\Team', 'win32')).not.toContain('/');
    expect(comparablePath('/stores/team', 'posix')).not.toContain('\\');
  });

  it('normalizes redundant separators and traversal segments', () => {
    expect(comparablePath('C:\\stores\\\\team\\..\\team\\.', 'win32')).toBe('c:\\stores\\team');
    expect(comparablePath('/stores//team/../team/.', 'posix')).toBe('/stores/team');
  });

  it('treats every win32 spelling of one path as the same path', () => {
    const spellings = [
      'C:\\Stores\\Team',
      'c:\\stores\\team',
      'C:/Stores/Team',
      'c:/stores//team/',
      'C:\\Stores\\Other\\..\\Team',
    ];
    for (const spelling of spellings) {
      expect(samePath(spelling, 'C:\\Stores\\Team', 'win32'), spelling).toBe(true);
    }
  });

  it('keeps two posix paths that differ only in case distinct', () => {
    expect(samePath('/stores/Team', '/stores/team', 'posix')).toBe(false);
    // Separator and traversal normalization still applies on posix.
    expect(samePath('/stores//team/', '/stores/other/../team', 'posix')).toBe(true);
  });

  it('applies the host platform rule, and only the host platform rule, to native', () => {
    // `native` is the only flavor whose answer depends on where it runs, so it
    // is stated as a function of the host rather than pinned to one answer.
    const left = NATIVE_FOLDS_CASE ? 'C:\\Stores\\Team' : '/stores/Team';
    const right = NATIVE_FOLDS_CASE ? 'c:\\stores\\team' : '/stores/team';
    expect(samePath(left, right, 'native')).toBe(NATIVE_FOLDS_CASE);
    expect(pathApiFor('native')).toBe(path);
    expect(pathApiFor('win32')).toBe(path.win32);
    expect(pathApiFor('posix')).toBe(path.posix);
  });
});

describe('workspace path identity — containment', () => {
  it('accepts a nested path and the root itself on both flavors', () => {
    expect(isContainedIn('C:\\stores\\team', 'C:\\stores\\team', 'win32')).toBe(true);
    expect(isContainedIn('C:\\stores\\team', 'C:\\stores\\team\\.rasen\\x.json', 'win32')).toBe(
      true
    );
    expect(isContainedIn('/stores/team', '/stores/team', 'posix')).toBe(true);
    expect(isContainedIn('/stores/team', '/stores/team/.rasen/x.json', 'posix')).toBe(true);
  });

  it('refuses a sibling whose name merely starts with the root name', () => {
    // The prefix trap: a plain `startsWith` would call this contained, and the
    // destination it admits is a DIFFERENT worktree.
    expect(isContainedIn('C:\\stores\\team', 'C:\\stores\\team-2\\file', 'win32')).toBe(false);
    expect(isContainedIn('/stores/team', '/stores/team-2/file', 'posix')).toBe(false);
  });

  it('refuses an escape, however it is spelled', () => {
    expect(isContainedIn('C:\\stores\\team', 'C:\\stores\\team\\..\\other', 'win32')).toBe(false);
    expect(isContainedIn('C:\\stores\\team', 'D:\\stores\\team\\file', 'win32')).toBe(false);
    expect(isContainedIn('/stores/team', '/stores/team/../other', 'posix')).toBe(false);
    expect(isContainedIn('/stores/team', '/etc/passwd', 'posix')).toBe(false);
  });

  it('folds case for containment on win32 and not on posix', () => {
    expect(isContainedIn('C:\\Stores\\Team', 'c:\\stores\\team\\.rasen', 'win32')).toBe(true);
    expect(isContainedIn('/stores/Team', '/stores/team/.rasen', 'posix')).toBe(false);
  });

  it('contains the marker and association each plan writes, on both flavors', () => {
    // This is the containment precondition `plan.ts` asserts before `apply`
    // writes either file. Both sides are spelled out literally rather than
    // derived, so a change to either path rule shows up here.
    expect(planningMarkerPath('C:\\worktrees\\store--fix-a', 'win32')).toBe(
      'C:\\worktrees\\store--fix-a\\.rasen\\planning-line.json'
    );
    expect(executionAssociationPath('/worktrees/app--fix-a', 'posix')).toBe(
      '/worktrees/app--fix-a/.rasen/planning-binding.json'
    );
    expect(
      isContainedIn(
        'C:\\worktrees\\store--fix-a',
        'C:\\worktrees\\store--fix-a\\.rasen\\planning-line.json',
        'win32'
      )
    ).toBe(true);
    expect(
      isContainedIn(
        '/worktrees/app--fix-a',
        '/worktrees/app--fix-a/.rasen/planning-binding.json',
        'posix'
      )
    ).toBe(true);
    // ...and does not contain the neighbouring pair's marker.
    expect(
      isContainedIn(
        'C:\\worktrees\\store--fix-a',
        'C:\\worktrees\\store--fix-b\\.rasen\\planning-line.json',
        'win32'
      )
    ).toBe(false);
  });
});

describe('workspace path identity — default worktree destination', () => {
  it('names a sibling of the repository root on both flavors', () => {
    expect(defaultWorktreeDestination('C:\\repos\\store-integration', 'fix-a', 'win32')).toBe(
      'C:\\repos\\store-integration--fix-a'
    );
    expect(defaultWorktreeDestination('/repos/store-integration', 'fix-a', 'posix')).toBe(
      '/repos/store-integration--fix-a'
    );
  });

  it('normalizes the base and every separator form to the requested flavor', () => {
    expect(defaultWorktreeDestination('C:/repos//store/', 'fix-a', 'win32')).toBe(
      'C:\\repos\\store--fix-a'
    );
    expect(defaultWorktreeDestination('/repos//store/', 'fix-a', 'posix')).toBe(
      '/repos/store--fix-a'
    );
  });

  it('carries a non-ASCII repository name through byte for byte', () => {
    expect(defaultWorktreeDestination(`C:\\repos\\${CHINESE}`, 'fix-a', 'win32')).toBe(
      `C:\\repos\\${CHINESE}--fix-a`
    );
    expect(defaultWorktreeDestination(`/repos/${CHINESE}`, 'fix-a', 'posix')).toBe(
      `/repos/${CHINESE}--fix-a`
    );
  });

  it('builds a destination past the classic MAX_PATH budget without truncating it', () => {
    const deep = `C:\\repos\\${'d'.repeat(120)}\\${'e'.repeat(120)}\\store`;
    const destination = defaultWorktreeDestination(deep, 'fix-a', 'win32');
    expect(destination.length).toBeGreaterThan(260);
    expect(destination).toBe(`C:\\repos\\${'d'.repeat(120)}\\${'e'.repeat(120)}\\store--fix-a`);
    expect(isContainedIn(destination, `${destination}\\.rasen`, 'win32')).toBe(true);
  });

  it('keeps two sibling destinations on one repository distinct', () => {
    expect(defaultWorktreeDestination('/repos/store', 'fix-a', 'posix')).not.toBe(
      defaultWorktreeDestination('/repos/store', 'fix-b', 'posix')
    );
    // ...and neither contains the other.
    expect(
      isContainedIn(
        defaultWorktreeDestination('/repos/store', 'fix-a', 'posix'),
        defaultWorktreeDestination('/repos/store', 'fix-ab', 'posix'),
        'posix'
      )
    ).toBe(false);
  });
});

/**
 * A filesystem/Git adapter whose `canonicalizeExisting` behaves exactly as the
 * Interface documents — "symlinks, Windows short names, and drive-letter case
 * resolved" — for a table of alias spellings the test declares. Every member
 * this suite does not use throws, so a future reader can see at a glance what
 * identity derivation actually touches.
 */
function fakeDependencies(input: {
  readonly canonical: Readonly<Record<string, string>>;
  readonly repositoryPaths?: Readonly<
    Record<string, { readonly toplevel: string; readonly commonDir: string }>
  >;
  readonly worktrees?: readonly WorktreeListEntry[];
}): StoreWorkspaceDependencies {
  const unused = (name: string) => (): never => {
    throw new Error(`${name} is not used by the path-identity suite`);
  };
  const canonicalize = (target: string): string => {
    const resolved = input.canonical[target];
    if (resolved === undefined) {
      const error = new Error(`ENOENT: no such file or directory, realpath '${target}'`);
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      throw error;
    }
    return resolved;
  };
  const fileSystem: WorkspaceFileSystem = {
    statKind: unused('statKind'),
    readText: unused('readText'),
    listNames: unused('listNames'),
    mkdirp: unused('mkdirp'),
    writeText: unused('writeText'),
    removeFile: unused('removeFile'),
    removeDirectoryIfEmpty: unused('removeDirectoryIfEmpty'),
    canonicalizeExisting: canonicalize,
  };
  const git: WorkspaceGit = {
    repositoryPaths: async (root) => input.repositoryPaths?.[root] ?? null,
    worktreeList: async () => input.worktrees ?? null,
    resolveRef: unused('resolveRef'),
    headOid: unused('headOid'),
    checkedOutRef: unused('checkedOutRef'),
    commitExists: unused('commitExists'),
    dirtyEntries: unused('dirtyEntries'),
    untrackedFiles: unused('untrackedFiles'),
    isAncestor: unused('isAncestor'),
    addWorktree: unused('addWorktree'),
    removeWorktree: unused('removeWorktree'),
    pruneWorktrees: unused('pruneWorktrees'),
  };
  return {
    fs: fileSystem,
    git,
    coordination: unused('coordination'),
    snapshotProjects: unused('snapshotProjects'),
    now: () => new Date('2026-08-07T00:00:00.000Z'),
    mintInstanceSeed: unused('mintInstanceSeed'),
    randomToken: unused('randomToken'),
  } as StoreWorkspaceDependencies;
}

describe('workspace worktree identity — alias spellings and failure', () => {
  const COMMON_DIR = 'C:\\repos\\store\\.git';
  const CANONICAL_ROOT = 'C:\\repos\\store--fix-a';

  /**
   * Four ways one Windows directory is spelled: a lower-case drive letter, an
   * 8.3 short name, a junction, and a forward-slash separator form. Git prints
   * whichever the caller handed it, so every one of them reaches
   * `canonicalizeExisting`, which is where they collapse.
   */
  const ALIASES: Readonly<Record<string, string>> = {
    'C:\\repos\\store--fix-a': CANONICAL_ROOT,
    'c:\\repos\\store--fix-a': CANONICAL_ROOT,
    'C:\\repos\\STOREF~1': CANONICAL_ROOT,
    'C:\\junctions\\current': CANONICAL_ROOT,
    'C:/repos/store--fix-a': CANONICAL_ROOT,
    'C:\\repos\\store\\.git': COMMON_DIR,
    'c:\\repos\\store\\.git': COMMON_DIR,
  };

  it('derives one worktree instance id from every alias spelling', async () => {
    const ids = new Set<string>();
    const worktreeIdentities = new Set<string>();
    for (const spelling of [
      'C:\\repos\\store--fix-a',
      'c:\\repos\\store--fix-a',
      'C:\\repos\\STOREF~1',
      'C:\\junctions\\current',
      'C:/repos/store--fix-a',
    ]) {
      const dependencies = fakeDependencies({
        canonical: ALIASES,
        repositoryPaths: {
          [spelling]: { toplevel: spelling, commonDir: 'c:\\repos\\store\\.git' },
        },
      });
      const identity = await deriveWorktreeIdentity(dependencies, spelling, 'win32');
      expect(identity, spelling).not.toBeNull();
      // The canonical root is recorded verbatim; the IDENTITY is the folded one.
      expect(identity?.canonicalRoot, spelling).toBe(CANONICAL_ROOT);
      expect(identity?.worktreeIdentity, spelling).toBe('c:\\repos\\store--fix-a');
      expect(identity?.repositoryIdentity, spelling).toBe('c:\\repos\\store\\.git');
      ids.add(identity!.worktreeInstanceId);
      worktreeIdentities.add(identity!.worktreeIdentity);
    }
    expect(worktreeIdentities.size).toBe(1);
    expect(ids.size).toBe(1);
    expect([...ids][0].startsWith('wt_')).toBe(true);
  });

  it('gives two linked worktrees of one repository one repository identity and two instance ids', async () => {
    const canonical = {
      '/repos/store--fix-a': '/repos/store--fix-a',
      '/repos/store--fix-b': '/repos/store--fix-b',
      '/repos/store/.git': '/repos/store/.git',
    };
    const derive = async (root: string) =>
      deriveWorktreeIdentity(
        fakeDependencies({
          canonical,
          repositoryPaths: { [root]: { toplevel: root, commonDir: '/repos/store/.git' } },
        }),
        root,
        'posix'
      );

    const first = await derive('/repos/store--fix-a');
    const second = await derive('/repos/store--fix-b');

    expect(first?.repositoryIdentity).toBe('/repos/store/.git');
    expect(second?.repositoryIdentity).toBe('/repos/store/.git');
    expect(first?.worktreeIdentity).toBe('/repos/store--fix-a');
    expect(second?.worktreeIdentity).toBe('/repos/store--fix-b');
    expect(first?.worktreeInstanceId).not.toBe(second?.worktreeInstanceId);
  });

  it('keeps two posix worktrees differing only in case distinct', async () => {
    // The mirror of the win32 alias case: on posix these ARE two directories,
    // so folding them would merge two real worktrees into one binding.
    const canonical = {
      '/repos/Store--fix-a': '/repos/Store--fix-a',
      '/repos/store--fix-a': '/repos/store--fix-a',
      '/repos/store/.git': '/repos/store/.git',
    };
    const derive = async (root: string) =>
      deriveWorktreeIdentity(
        fakeDependencies({
          canonical,
          repositoryPaths: { [root]: { toplevel: root, commonDir: '/repos/store/.git' } },
        }),
        root,
        'posix'
      );
    expect((await derive('/repos/Store--fix-a'))?.worktreeInstanceId).not.toBe(
      (await derive('/repos/store--fix-a'))?.worktreeInstanceId
    );
  });

  it('reports no identity for a path that is not inside a work tree', async () => {
    const dependencies = fakeDependencies({ canonical: {}, repositoryPaths: {} });
    expect(await deriveWorktreeIdentity(dependencies, '/not/a/repo', 'posix')).toBeNull();
  });

  it('fails closed when an identity input cannot be canonicalized', async () => {
    // The whole point: never fall back to the literal string. A literal-string
    // identity would make two spellings of one worktree look like two.
    const dependencies = fakeDependencies({
      canonical: { '/repos/store/.git': '/repos/store/.git' },
      repositoryPaths: {
        '/repos/store--fix-a': {
          toplevel: '/repos/store--fix-a',
          commonDir: '/repos/store/.git',
        },
      },
    });
    let raised: unknown;
    try {
      await deriveWorktreeIdentity(dependencies, '/repos/store--fix-a', 'posix');
    } catch (error) {
      raised = error;
    }
    expect(isStoreWorkspaceError(raised)).toBe(true);
    expect((raised as { diagnostic: { code: string } }).diagnostic.code).toBe(
      'workspace_identity_unavailable'
    );
    expect(String((raised as Error).message)).toContain('/repos/store--fix-a');
  });

  it('recognizes a linked worktree addressed through an alias Git did not print', async () => {
    const worktrees: readonly WorktreeListEntry[] = [
      { root: 'C:\\repos\\store', main: true, detached: false, bare: false },
      { root: CANONICAL_ROOT, main: false, detached: false, bare: false },
    ];
    const dependencies = fakeDependencies({
      canonical: { ...ALIASES, 'C:\\repos\\store': 'C:\\repos\\store' },
      worktrees,
    });

    // The junction spelling matches no printed root by string comparison, so
    // the canonical fallback is the only thing that can answer this.
    expect(await isLinkedWorktree(dependencies, 'C:\\junctions\\current', 'win32')).toBe(true);
    // The main checkout is never a linked worktree, however it is spelled.
    expect(await isLinkedWorktree(dependencies, 'C:\\repos\\store', 'win32')).toBe(false);
    // A path that is not in the list at all yields no answer, not a false one.
    expect(await isLinkedWorktree(dependencies, 'C:\\repos\\elsewhere', 'win32')).toBeNull();
  });
});

describe('workspace worktree identity — real Git over awkward real paths', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) cleanupTempPath(tempDirs.pop() as string);
  });

  function makeTempDir(prefix: string): string {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
  }

  function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
    return execFileSync('git', ['-C', cwd, ...args], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
  }

  it('derives one identity per real linked worktree, including a non-ASCII and a long name', async () => {
    const tempDir = makeTempDir('rasen-workspace-paths-');
    const env = isolatedGitEnv(tempDir);
    const repoRoot = path.join(tempDir, 'store');
    fs.mkdirSync(repoRoot, { recursive: true });
    git(repoRoot, ['init', '--initial-branch=main'], env);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# store\n', 'utf8');
    git(repoRoot, ['add', '.'], env);
    git(repoRoot, ['commit', '-m', 'seed'], env);

    const chineseWorktree = path.join(tempDir, `store--${CHINESE}`);
    const longWorktree = path.join(tempDir, `store--${'d'.repeat(80)}`);
    git(repoRoot, ['worktree', 'add', '-b', 'line/a', chineseWorktree, 'HEAD'], env);
    git(repoRoot, ['worktree', 'add', '-b', 'line/b', longWorktree, 'HEAD'], env);

    const dependencies = productionStoreWorkspaceDependencies;

    const main = await deriveWorktreeIdentity(dependencies, repoRoot);
    const chinese = await deriveWorktreeIdentity(dependencies, chineseWorktree);
    const long = await deriveWorktreeIdentity(dependencies, longWorktree);

    // The Chinese name survives into the canonical root byte for byte.
    expect(chinese?.canonicalRoot).toBe(fs.realpathSync.native(chineseWorktree));
    expect(chinese?.canonicalRoot.endsWith(CHINESE)).toBe(true);
    expect(long?.canonicalRoot).toBe(fs.realpathSync.native(longWorktree));
    // One repository, three worktrees, one repository identity, three ids.
    expect(chinese?.repositoryIdentity).toBe(main?.repositoryIdentity);
    expect(long?.repositoryIdentity).toBe(main?.repositoryIdentity);
    expect(
      new Set([
        main?.worktreeInstanceId,
        chinese?.worktreeInstanceId,
        long?.worktreeInstanceId,
      ]).size
    ).toBe(3);

    // Only the two added ones are LINKED; the original checkout is not.
    expect(await isLinkedWorktree(dependencies, chineseWorktree)).toBe(true);
    expect(await isLinkedWorktree(dependencies, longWorktree)).toBe(true);
    expect(await isLinkedWorktree(dependencies, repoRoot)).toBe(false);
  });

  it('derives the same identity through a real alias spelling of one worktree', async () => {
    const tempDir = makeTempDir('rasen-workspace-alias-');
    const env = isolatedGitEnv(tempDir);
    const repoRoot = path.join(tempDir, 'store');
    fs.mkdirSync(repoRoot, { recursive: true });
    git(repoRoot, ['init', '--initial-branch=main'], env);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# store\n', 'utf8');
    git(repoRoot, ['add', '.'], env);
    git(repoRoot, ['commit', '-m', 'seed'], env);
    const worktree = path.join(tempDir, 'store--fix-a');
    git(repoRoot, ['worktree', 'add', '-b', 'line/a', worktree, 'HEAD'], env);

    const dependencies = productionStoreWorkspaceDependencies;
    const direct = await deriveWorktreeIdentity(dependencies, worktree);

    // Alias 1: a redundant traversal spelling of the same directory. This one
    // works on every host and needs no elevated privileges.
    // Assembled with the separator rather than `path.join`, which would
    // normalize the traversal away before the code under test ever saw it.
    const traversal = `${tempDir}${path.sep}store${path.sep}..${path.sep}store--fix-a`;
    expect(traversal).not.toBe(worktree);
    expect((await deriveWorktreeIdentity(dependencies, traversal))?.worktreeInstanceId).toBe(
      direct?.worktreeInstanceId
    );

    // Alias 2: a real junction (Windows) or directory symlink (POSIX). Both
    // need a privilege the CI host may not grant, so an unavailable link is
    // skipped rather than failed — the traversal alias above still holds.
    const link = path.join(tempDir, 'alias-link');
    let linked = false;
    try {
      fs.symlinkSync(worktree, link, process.platform === 'win32' ? 'junction' : 'dir');
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      const aliased = await deriveWorktreeIdentity(dependencies, link);
      expect(aliased?.canonicalRoot).toBe(direct?.canonicalRoot);
      expect(aliased?.worktreeInstanceId).toBe(direct?.worktreeInstanceId);
      expect(await isLinkedWorktree(dependencies, link)).toBe(true);
    }

    // Alias 3: drive-letter case, which only exists on Windows.
    if (process.platform === 'win32' && /^[A-Za-z]:/.test(worktree)) {
      const flipped = `${worktree[0] === worktree[0].toUpperCase() ? worktree[0].toLowerCase() : worktree[0].toUpperCase()}${worktree.slice(1)}`;
      expect(flipped).not.toBe(worktree);
      expect((await deriveWorktreeIdentity(dependencies, flipped))?.worktreeInstanceId).toBe(
        direct?.worktreeInstanceId
      );
    }
  });
});
