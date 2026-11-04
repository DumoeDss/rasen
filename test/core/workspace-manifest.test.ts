import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkspaceManifestError,
  observeStableWorkspaceManifest,
} from '../../src/core/workspace-manifest.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const roots: string[] = [];

function repository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workspace-manifest-'));
  roots.push(root);
  const run = (args: string[]) => {
    const result = spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Rasen Test',
        GIT_AUTHOR_EMAIL: 'rasen@example.invalid',
        GIT_COMMITTER_NAME: 'Rasen Test',
        GIT_COMMITTER_EMAIL: 'rasen@example.invalid',
      },
    });
    if (result.status !== 0) throw new Error(result.stderr || 'git fixture failed');
  };
  run(['init', '--quiet']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n', 'utf8');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'tracked\n', 'utf8');
  run(['add', '.gitignore', 'tracked.txt']);
  run(['commit', '--quiet', '-m', 'fixture']);
  fs.mkdirSync(path.join(root, 'ignored'));
  fs.writeFileSync(path.join(root, 'ignored', 'late.txt'), 'ignored-a\n', 'utf8');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n', 'utf8');
  return fs.realpathSync.native(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

describe('stable bounded no-follow workspace manifest', () => {
  it('covers tracked, untracked, and ignored entries', () => {
    const root = repository();
    const before = observeStableWorkspaceManifest({ cwd: root });
    fs.writeFileSync(path.join(root, 'ignored', 'late.txt'), 'ignored-b\n', 'utf8');
    const afterIgnored = observeStableWorkspaceManifest({ cwd: root });
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked-b\n', 'utf8');
    const afterUntracked = observeStableWorkspaceManifest({ cwd: root });

    expect(afterIgnored.digest).not.toBe(before.digest);
    expect(afterUntracked.digest).not.toBe(afterIgnored.digest);
    expect(before.entries).toBeGreaterThanOrEqual(5);
  });

  it('rejects file metadata drift between initial lstat, open, read, and final fstat', () => {
    const root = repository();
    let changed = false;
    expect(() => observeStableWorkspaceManifest({
      cwd: root,
      internalInstabilityRetries: 0,
      onPhase(event) {
        if (
          !changed &&
          event.phase === 'after-file-read' &&
          event.relativePath === 'tracked.txt'
        ) {
          changed = true;
          fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n', 'utf8');
        }
      },
    })).toThrowError(expect.objectContaining({
      code: 'persistent-instability',
    }));
  });

  it('retries the whole observation only for classified internal directory instability', () => {
    const root = repository();
    let injected = false;
    const starts: number[] = [];
    const result = observeStableWorkspaceManifest({
      cwd: root,
      internalInstabilityRetries: 1,
      onPhase(event) {
        if (event.phase === 'observation-start') starts.push(event.attempt);
        if (
          !injected &&
          event.phase === 'after-directory-enumeration' &&
          event.relativePath === '.'
        ) {
          injected = true;
          fs.writeFileSync(path.join(root, 'injected.txt'), 'late child\n', 'utf8');
        }
      },
    });

    expect(result.attempts).toBe(2);
    expect(starts).toEqual([1, 2]);
  });

  it('does not retry permission, path, decoding, bounds, or unsupported-entry failures', () => {
    const root = repository();
    let starts = 0;
    expect(() => observeStableWorkspaceManifest({
      cwd: root,
      internalInstabilityRetries: 3,
      onPhase(event) {
        if (event.phase === 'observation-start') {
          starts += 1;
          throw new WorkspaceManifestError(
            'permission',
            'fixture permission refusal'
          );
        }
      },
    })).toThrowError(expect.objectContaining({ code: 'permission' }));
    expect(starts).toBe(1);
  });
});
