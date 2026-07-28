import { describe, expect, it } from 'vitest';

import {
  WorkspaceError,
  blobDigest,
  deriveDirtyWorktreeDigest,
  deriveTreeDigest,
  deriveWorkspaceRevision,
  detectWorkspaceDrift,
  verifyWriterBefore,
  verifyWriterNotExecuted,
  workspaceMatches,
  type WorkspaceManifest,
} from '../../../src/core/change-run/internal/workspace.js';
import type { Digest } from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const digest = (c: string) => branded<Digest>(`sha256:${c.repeat(64)}`);
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

interface Entry {
  readonly path: string;
  readonly content: string;
}

function cleanManifest(
  paths: readonly Entry[] = [{ path: 'src/a.ts', content: 'a' }],
  overrides: Partial<WorkspaceManifest> = {}
): WorkspaceManifest {
  const headTree = paths.map((entry) => ({
    path: entry.path,
    mode: '100644',
    blobDigest: blobDigest(bytes(entry.content)),
  }));
  return {
    head: { kind: 'commit', digest: digest('h'), detached: false },
    headTree,
    index: headTree.map((entry) => ({ ...entry, stage: 0 })),
    trackedWorking: paths.map((entry) => ({
      path: entry.path,
      bytes: bytes(entry.content),
      mode: '100644',
    })),
    untracked: [],
    symlinks: [],
    submodules: [],
    ...overrides,
  };
}

describe('WorkspaceRevision head + tree digest (8.1)', () => {
  it('records commit / unborn / detached HEAD', () => {
    expect(
      deriveWorkspaceRevision(cleanManifest([], { head: { kind: 'unborn' } })).head
    ).toEqual({ kind: 'unborn', detached: false });
    expect(
      deriveWorkspaceRevision(
        cleanManifest([], { head: { kind: 'detached', digest: digest('d') } })
      ).head
    ).toEqual({ kind: 'commit', digest: digest('d'), detached: true });
    expect(deriveWorkspaceRevision(cleanManifest()).head).toEqual({
      kind: 'commit',
      digest: digest('h'),
      detached: false,
    });
  });

  it('is deterministic and order-independent across path enumeration', () => {
    const entries = [
      { path: 'a/b.ts', content: 'b' },
      { path: 'a/a.ts', content: 'a' },
      { path: 'z.ts', content: 'z' },
    ];
    const forward = cleanManifest(entries);
    const reversed = cleanManifest([...entries].reverse());
    expect(deriveTreeDigest(forward)).toBe(deriveTreeDigest(reversed));
    expect(deriveDirtyWorktreeDigest(forward)).toBe(deriveDirtyWorktreeDigest(reversed));
    // Same manifest twice -> identical.
    expect(deriveWorkspaceRevision(forward)).toEqual(deriveWorkspaceRevision(forward));
  });

  it('changes treeDigest when HEAD tree, index, working bytes, untracked, or symlinks change', () => {
    const base = cleanManifest();
    expect(deriveTreeDigest(base)).not.toBe(
      deriveTreeDigest(
        cleanManifest([{ path: 'src/a.ts', content: 'changed' }])
      )
    );
    expect(deriveTreeDigest(base)).not.toBe(
      deriveTreeDigest(
        cleanManifest(undefined, {
          untracked: [{ path: 'new.ts', bytes: bytes('n') }],
        })
      )
    );
    expect(deriveTreeDigest(base)).not.toBe(
      deriveTreeDigest(
        cleanManifest(undefined, {
          head: { kind: 'commit', digest: digest('x'), detached: false },
        })
      )
    );
  });

  it('normalizes Windows backslash paths and Unicode NFC before digesting', () => {
    const slash = cleanManifest([{ path: 'src/a.ts', content: 'a' }]);
    const backslash = cleanManifest([{ path: 'src\\a.ts', content: 'a' }]);
    expect(deriveTreeDigest(slash)).toBe(deriveTreeDigest(backslash));
  });

  it('keeps a clean working tree dirty-digest stable and distinguishes dirty states', () => {
    const clean = cleanManifest();
    const cleanDigest = deriveDirtyWorktreeDigest(clean);
    // Staged change (index diverges from HEAD; working matches index).
    const staged: WorkspaceManifest = {
      ...cleanManifest([{ path: 'src/a.ts', content: 'a' }]),
      index: [{ path: 'src/a.ts', stage: 0, mode: '100644', blobDigest: blobDigest(bytes('staged')) }],
      trackedWorking: [{ path: 'src/a.ts', bytes: bytes('staged'), mode: '100644' }],
    };
    expect(deriveDirtyWorktreeDigest(staged)).not.toBe(cleanDigest);
    // Unstaged change (working diverges from index).
    const unstaged: WorkspaceManifest = {
      ...cleanManifest([{ path: 'src/a.ts', content: 'staged' }]),
      trackedWorking: [{ path: 'src/a.ts', bytes: bytes('unstaged'), mode: '100644' }],
    };
    expect(deriveDirtyWorktreeDigest(unstaged)).not.toBe(cleanDigest);
    // Untracked content.
    const withUntracked = cleanManifest(undefined, {
      untracked: [{ path: 'u.ts', bytes: bytes('u') }],
    });
    expect(deriveDirtyWorktreeDigest(withUntracked)).not.toBe(cleanDigest);
  });
});

describe('submodule cleanliness (8.2a)', () => {
  it('accepts a clean initialized submodule', () => {
    const manifest = cleanManifest(undefined, {
      submodules: [
        {
          path: 'vendor/lib',
          gitlinkCommit: digest('g'),
          headCommit: digest('g'),
          innerClean: true,
          supported: true,
        },
      ],
    });
    expect(() => deriveWorkspaceRevision(manifest)).not.toThrow();
  });

  it('fails workspace-submodule-dirty when a submodule has inner dirtiness', () => {
    const manifest = cleanManifest(undefined, {
      submodules: [
        {
          path: 'vendor/lib',
          gitlinkCommit: digest('g'),
          headCommit: digest('g'),
          innerClean: false,
          supported: true,
        },
      ],
    });
    expect(() => deriveWorkspaceRevision(manifest)).toThrowError(WorkspaceError);
  });

  it('fails workspace-submodule-unsupported for an uninitialized/unreadable submodule', () => {
    const manifest = cleanManifest(undefined, {
      submodules: [
        { path: 'vendor/lib', gitlinkCommit: digest('g'), innerClean: false, supported: false },
      ],
    });
    expect(() => deriveWorkspaceRevision(manifest)).toThrowError(WorkspaceError);
  });
});

describe('writer completion + workspace drift (8.3/8.4)', () => {
  const before = deriveWorkspaceRevision(cleanManifest());
  const changed = deriveWorkspaceRevision(
    cleanManifest([{ path: 'src/a.ts', content: 'changed' }])
  );
  const dirtyOnly = deriveWorkspaceRevision(
    cleanManifest(undefined, {
      untracked: [{ path: 'u.ts', bytes: bytes('u') }],
    })
  );

  it('matches identical revisions and distinguishes tree/dirty drift', () => {
    expect(workspaceMatches(before, before)).toBe(true);
    expect(workspaceMatches(before, changed)).toBe(false);
    expect(workspaceMatches(before, dirtyOnly)).toBe(false);
  });

  it('classifies unchanged vs drifted', () => {
    expect(detectWorkspaceDrift(before, before)).toBe('unchanged');
    expect(detectWorkspaceDrift(before, changed)).toBe('drifted');
    expect(detectWorkspaceDrift(before, dirtyOnly)).toBe('drifted');
  });

  it('accepts a writer whose expected before matches the observed before', () => {
    expect(verifyWriterBefore(before, before)).toBe('unchanged');
  });

  it('rejects a writer whose expected before was externally or stalely changed', () => {
    expect(verifyWriterBefore(before, changed)).toBe('drifted');
    expect(verifyWriterBefore(before, dirtyOnly)).toBe('drifted');
  });

  it('proves a not_executed writer left no delta and detects a spurious one', () => {
    expect(verifyWriterNotExecuted(before, before)).toBe(true);
    expect(verifyWriterNotExecuted(before, changed)).toBe(false);
  });
});
