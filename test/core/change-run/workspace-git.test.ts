import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observeGitWorkspace } from '../../../src/core/change-run/internal/workspace-git.js';
import { deriveWorkspaceRevision } from '../../../src/core/change-run/internal/workspace.js';

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('observeGitWorkspace (real git)', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rasen-ws-'));
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 't@t']);
    git(repo, ['config', 'user.name', 't']);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('observes a committed file and derives a stable workspace revision', () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);

    const manifest = observeGitWorkspace(repo);
    expect(manifest.head.kind).toBe('commit');
    const revision = deriveWorkspaceRevision(manifest);
    expect(revision.head.kind).toBe('commit');
    expect(revision.treeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.headTree.some((e) => e.path === 'a.txt')).toBe(true);
    // Deterministic: a second observation of the same state yields the same digest.
    expect(deriveWorkspaceRevision(observeGitWorkspace(repo)).treeDigest).toBe(
      revision.treeDigest
    );
  });

  it('detects an unborn HEAD before the first commit', () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(repo, ['add', 'a.txt']);
    const manifest = observeGitWorkspace(repo);
    expect(manifest.head.kind).toBe('unborn');
  });

  it('captures untracked content in the manifest', () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'untracked.log'), 'noise');
    const manifest = observeGitWorkspace(repo);
    expect(manifest.untracked.some((e) => e.path === 'untracked.log')).toBe(true);
  });
});
